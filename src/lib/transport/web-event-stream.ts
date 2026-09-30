import type { EventEnvelope, LiveSessionSnapshot } from "@/lib/types"
import { randomUUID } from "@/lib/utils"
import type {
  AttachDetachReason,
  AttachHandlers,
  AttachOptions,
  EventStream,
  EventStreamSubscription,
} from "./types"

/**
 * Wire shape of the server-→-client attach protocol frames. Mirrors
 * `ServerMsg` in `src-tauri/src/web/ws_attach.rs`. Each frame carries the
 * `subscription_id` it belongs to so a single WebSocket multiplexes many
 * independent connection streams.
 */
type ServerAttachFrame =
  | {
      type: "snapshot"
      subscription_id: string
      connection_id: string
      snapshot: LiveSessionSnapshot
      event_seq: number
    }
  | {
      type: "replay"
      subscription_id: string
      connection_id: string
      events: EventEnvelope[]
      high_water_seq: number
    }
  | {
      type: "event"
      subscription_id: string
      envelope: EventEnvelope
    }
  | {
      type: "detached"
      subscription_id: string
      reason: AttachDetachReason
    }
  | { type: "pong" }

/**
 * Hook the EventStream needs from its host transport. Decoupled so the
 * stream doesn't reach into WebTransport internals.
 */
export interface AttachTransportHost {
  /** True if the underlying WS is currently in OPEN state. */
  isWsOpen(): boolean
  /**
   * Send a JSON-encoded frame over the WS. No-op (returns false) if the
   * WS isn't open — the stream relies on the `onWsReady` callback to
   * re-issue attach frames once the connection is back.
   */
  sendFrame(frame: object): boolean
  /**
   * Register a callback invoked every time the WS transitions to OPEN
   * (initial connect and every reconnect). Returns an unsubscribe fn.
   */
  onWsReady(callback: () => void): () => void
}

interface ActiveSub {
  subscriptionId: string
  connectionId: string
  /**
   * Highest `seq` successfully consumed for this subscription. Updated after
   * snapshot / replay / event handlers return. Used as `since_seq` when
   * re-attaching after a reconnect.
   */
  lastAppliedSeq: number | undefined
  recovering: boolean
  failures: number
  retryTimer: ReturnType<typeof setTimeout> | null
  handlers: AttachHandlers
}

export class WebEventStream implements EventStream {
  private subs = new Map<string, ActiveSub>()
  private unbindWsReady: (() => void) | null

  constructor(private host: AttachTransportHost) {
    // Re-attach all live subscriptions on every WS-ready transition. On
    // the initial connect this catches up subs that called attach() before
    // the WS opened; on reconnect it carries the running `lastAppliedSeq`
    // so the server can pick replay vs. snapshot.
    this.unbindWsReady = host.onWsReady(() => this.reattachAll())
  }

  attach(
    connectionId: string,
    options: AttachOptions,
    handlers: AttachHandlers
  ): EventStreamSubscription {
    const subscriptionId = randomUUID()
    const sub: ActiveSub = {
      subscriptionId,
      connectionId,
      lastAppliedSeq: options.sinceSeq,
      recovering: false,
      failures: 0,
      retryTimer: null,
      handlers,
    }
    this.subs.set(subscriptionId, sub)
    // If the WS is already open, send the attach frame immediately;
    // otherwise the `onWsReady` hook will replay it on next open.
    if (this.host.isWsOpen()) {
      this.sendAttach(subscriptionId)
    }
    return {
      get subscriptionId() {
        return sub.subscriptionId
      },
      detach: () => this.detach(sub.subscriptionId),
    }
  }

  /**
   * Called by the host transport when an attach-protocol frame arrives on
   * the WS. Routes by `subscription_id` and updates `lastAppliedSeq`.
   */
  handleServerFrame(frame: unknown): void {
    if (!isAttachFrame(frame)) return
    if (frame.type === "pong") return

    const sub = this.subs.get(frame.subscription_id)
    if (!sub) {
      // Stray frame for an unknown subscription. Possible races:
      //   - server's reply to an old subscription that we already detached
      //   - concurrent re-attach replaced the sub but server is still
      //     draining the previous attach's response
      // Either way, dropping is safe.
      return
    }

    switch (frame.type) {
      case "snapshot":
        this.deliver(sub, "onSnapshot", frame.event_seq, () =>
          sub.handlers.onSnapshot(
            frame.snapshot,
            frame.event_seq,
            sub.recovering ? { recoverFromHandlerError: true } : undefined
          )
        )
        break
      case "replay":
        if (sub.recovering) return
        this.deliver(sub, "onReplay", frame.high_water_seq, () =>
          sub.handlers.onReplay(frame.events, frame.high_water_seq)
        )
        break
      case "event":
        if (sub.recovering) return
        this.deliver(sub, "onEvent", frame.envelope.seq, () =>
          sub.handlers.onEvent(frame.envelope)
        )
        break
      case "detached":
        // Server unilaterally ended the sub. Remove from local map BEFORE
        // calling the user handler so any synchronous re-attach inside the
        // handler observes a clean slate (new subId, no leftover entry).
        this.subs.delete(frame.subscription_id)
        this.clearRetry(sub)
        safeInvoke("onDetached", () => sub.handlers.onDetached(frame.reason))
        break
    }
  }

  destroy(): void {
    this.unbindWsReady?.()
    this.unbindWsReady = null
    for (const sub of this.subs.values()) this.clearRetry(sub)
    this.subs.clear()
    // Do NOT send detach frames here — destroy() is called when the
    // transport is going away (logout, remote-workspace switch), so the
    // WS will close anyway and the server cleans up subscribers on close.
  }

  private detach(subscriptionId: string): void {
    const sub = this.subs.get(subscriptionId)
    if (!sub) return
    this.subs.delete(subscriptionId)
    this.clearRetry(sub)
    // Best-effort: send detach so the server can free its forwarder task
    // immediately rather than wait for the next event drop. If the WS is
    // closed, the forwarder dies on its own when the broadcast receiver
    // drops at WS-close cleanup.
    if (this.host.isWsOpen()) {
      this.host.sendFrame({
        action: "detach",
        subscription_id: subscriptionId,
      })
    }
  }

  private deliver(
    sub: ActiveSub,
    name: string,
    seq: number,
    handler: () => void
  ): void {
    if (safeInvoke(name, handler)) {
      // A callback may detach synchronously. Never revive its subscription.
      if (this.subs.get(sub.subscriptionId) !== sub) return
      sub.lastAppliedSeq = seq
      sub.recovering = false
      sub.failures = 0
    } else if (this.subs.get(sub.subscriptionId) === sub) {
      this.recover(sub)
    }
  }

  private recover(sub: ActiveSub): void {
    const oldId = sub.subscriptionId
    this.clearRetry(sub)
    this.subs.delete(oldId)
    sub.subscriptionId = randomUUID()
    sub.lastAppliedSeq = undefined
    sub.recovering = true
    sub.failures += 1
    this.subs.set(sub.subscriptionId, sub)

    // A handler may have applied only part of a replay or event. Replaying
    // from either cursor can duplicate effects or skip data, so hydrate a
    // full snapshot. Rotate the wire id to reject the old forwarder's queued
    // events AND detached frames while the replacement is being established.
    if (!this.host.isWsOpen()) return
    this.host.sendFrame({ action: "detach", subscription_id: oldId })
    if (sub.failures === 1) {
      this.sendAttach(sub.subscriptionId)
      return
    }
    // A consistently failing snapshot must not create a tight request loop.
    // Reconnects can retry immediately; otherwise back off up to 30 seconds.
    const delay = Math.min(1_000 * 2 ** Math.min(sub.failures - 2, 5), 30_000)
    sub.retryTimer = setTimeout(() => {
      sub.retryTimer = null
      if (this.host.isWsOpen()) this.sendAttach(sub.subscriptionId)
    }, delay)
  }

  private clearRetry(sub: ActiveSub): void {
    if (sub.retryTimer !== null) clearTimeout(sub.retryTimer)
    sub.retryTimer = null
  }

  private sendAttach(subscriptionId: string): void {
    const sub = this.subs.get(subscriptionId)
    if (!sub) return
    this.host.sendFrame({
      action: "attach",
      subscription_id: subscriptionId,
      connection_id: sub.connectionId,
      since_seq: sub.lastAppliedSeq,
    })
  }

  private reattachAll(): void {
    for (const sub of this.subs.values()) {
      this.clearRetry(sub)
      this.sendAttach(sub.subscriptionId)
    }
  }
}

function isAttachFrame(frame: unknown): frame is ServerAttachFrame {
  if (!frame || typeof frame !== "object") return false
  const type = (frame as { type?: unknown }).type
  return (
    type === "snapshot" ||
    type === "replay" ||
    type === "event" ||
    type === "detached" ||
    type === "pong"
  )
}

function safeInvoke(name: string, fn: () => void): boolean {
  try {
    fn()
    return true
  } catch (err) {
    console.error(`[WebEventStream] ${name} handler threw:`, err)
    return false
  }
}
