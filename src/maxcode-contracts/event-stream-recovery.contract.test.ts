import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { EventEnvelope, LiveSessionSnapshot } from "@/lib/types"
import type { AttachHandlers } from "@/lib/transport/types"
import { WebEventStream } from "@/lib/transport/web-event-stream"

function snapshot(seq: number, text = "snapshot"): LiveSessionSnapshot {
  return {
    connection_id: "conn-1",
    conversation_id: null,
    folder_id: null,
    status: "connected",
    external_id: null,
    live_message: {
      id: "message-1",
      role: "assistant",
      started_at: "2026-09-26T00:00:00Z",
      content: [{ kind: "text", text }],
    },
    active_tool_calls: [],
    pending_permission: null,
    modes: null,
    current_mode: null,
    config_options: null,
    prompt_capabilities: null,
    usage: null,
    fork_supported: false,
    available_commands: [],
    selectors_ready: false,
    event_seq: seq,
  }
}

function delta(seq: number, text = `delta-${seq}`): EventEnvelope {
  return { connection_id: "conn-1", type: "content_delta", seq, text }
}

function harness(overrides: Partial<AttachHandlers> = {}) {
  let open = true
  let ready: (() => void) | undefined
  const sendFrame = vi.fn(() => open)
  const unbind = vi.fn(() => {
    ready = undefined
  })
  const stream = new WebEventStream({
    isWsOpen: () => open,
    sendFrame,
    onWsReady: (callback) => {
      ready = callback
      return unbind
    },
  })
  const handlers = {
    onSnapshot: vi.fn<AttachHandlers["onSnapshot"]>(),
    onReplay: vi.fn<AttachHandlers["onReplay"]>(),
    onEvent: vi.fn<AttachHandlers["onEvent"]>(),
    onDetached: vi.fn<AttachHandlers["onDetached"]>(),
    ...overrides,
  }
  const sub = stream.attach("conn-1", {}, handlers)
  const receiveSnapshot = (seq: number, text?: string) => {
    stream.handleServerFrame({
      type: "snapshot",
      subscription_id: sub.subscriptionId,
      connection_id: "conn-1",
      snapshot: snapshot(seq, text),
      event_seq: seq,
    })
  }
  const receiveEvent = (seq: number, subscriptionId = sub.subscriptionId) => {
    stream.handleServerFrame({
      type: "event",
      subscription_id: subscriptionId,
      envelope: delta(seq),
    })
  }
  return {
    stream,
    sub,
    handlers,
    sendFrame,
    unbind,
    receiveSnapshot,
    receiveEvent,
    setOpen(value: boolean) {
      open = value
    },
    reconnect() {
      open = true
      ready?.()
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("MaxCode contract: recover failed event delivery with a clean snapshot", () => {
  it("resumes from successfully delivered events and replays", () => {
    const h = harness()
    h.receiveSnapshot(10)
    h.receiveEvent(11)
    h.reconnect()
    expect(h.sendFrame).toHaveBeenLastCalledWith({
      action: "attach",
      subscription_id: h.sub.subscriptionId,
      connection_id: "conn-1",
      since_seq: 11,
    })
    h.stream.handleServerFrame({
      type: "replay",
      subscription_id: h.sub.subscriptionId,
      connection_id: "conn-1",
      events: [delta(12), delta(13)],
      high_water_seq: 13,
    })
    expect(h.handlers.onReplay).toHaveBeenCalledWith([delta(12), delta(13)], 13)
    h.reconnect()
    expect(h.sendFrame).toHaveBeenLastCalledWith(
      expect.objectContaining({ since_seq: 13 })
    )
    h.stream.destroy()
  })

  it("isolates failed delivery from late old frames and sibling subscriptions", () => {
    const onEvent = vi.fn().mockImplementationOnce(() => {
      throw new Error("reducer failed")
    })
    const h = harness({ onEvent })
    h.receiveSnapshot(10)
    const oldId = h.sub.subscriptionId
    const siblingEvent = vi.fn()
    const sibling = h.stream.attach(
      "conn-2",
      {},
      {
        ...h.handlers,
        onEvent: siblingEvent,
      }
    )
    h.receiveEvent(11)
    expect(h.sub.subscriptionId).not.toBe(oldId)
    expect(h.sendFrame).toHaveBeenLastCalledWith({
      action: "attach",
      subscription_id: h.sub.subscriptionId,
      connection_id: "conn-1",
      since_seq: undefined,
    })
    h.receiveEvent(12, oldId)
    h.stream.handleServerFrame({
      type: "detached",
      subscription_id: oldId,
      reason: "lagged",
    })
    h.receiveEvent(13) // No deltas on partially applied state before recovery.
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(h.handlers.onDetached).not.toHaveBeenCalled()
    h.stream.handleServerFrame({
      type: "event",
      subscription_id: sibling.subscriptionId,
      envelope: { ...delta(1), connection_id: "conn-2" },
    })
    expect(siblingEvent).toHaveBeenCalledTimes(1)
    h.receiveSnapshot(13)
    expect(h.handlers.onSnapshot).toHaveBeenLastCalledWith(snapshot(13), 13, {
      recoverFromHandlerError: true,
    })
    h.receiveEvent(14)
    expect(onEvent).toHaveBeenLastCalledWith(delta(14))
    h.stream.destroy()
  })

  it("replaces a partially applied replay instead of duplicating its prefix", () => {
    let visible = ""
    const h = harness({
      onSnapshot: (value) => {
        const block = value.live_message?.content[0]
        visible = block?.kind === "text" ? block.text : ""
      },
      onReplay: (events) => {
        for (const event of events) {
          if (event.seq === 12) throw new Error("partial replay")
          if (event.type === "content_delta") visible += event.text
        }
      },
    })
    h.receiveSnapshot(10, "start")
    h.stream.handleServerFrame({
      type: "replay",
      subscription_id: h.sub.subscriptionId,
      connection_id: "conn-1",
      events: [delta(11, " one"), delta(12, " two")],
      high_water_seq: 12,
    })
    expect(visible).toBe("start one")
    h.reconnect()
    expect(h.sendFrame).toHaveBeenLastCalledWith(
      expect.objectContaining({ since_seq: undefined })
    )
    h.receiveSnapshot(12, "start one two")
    expect(visible).toBe("start one two")
    h.stream.destroy()
  })

  it("backs off repeated snapshot failures and resets after recovery", () => {
    const onSnapshot = vi.fn<AttachHandlers["onSnapshot"]>(() => {
      throw new Error("snapshot failed")
    })
    const h = harness({ onSnapshot })
    h.receiveSnapshot(10)
    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
      h.receiveSnapshot(10)
      const count = h.sendFrame.mock.calls.length
      vi.advanceTimersByTime(delay - 1)
      expect(h.sendFrame).toHaveBeenCalledTimes(count)
      vi.advanceTimersByTime(1)
      expect(h.sendFrame).toHaveBeenCalledTimes(count + 1)
    }
    onSnapshot.mockImplementation(() => {})
    h.receiveSnapshot(10)
    h.reconnect()
    expect(h.sendFrame).toHaveBeenLastCalledWith(
      expect.objectContaining({ since_seq: 10 })
    )
    onSnapshot.mockImplementation(() => {
      throw new Error("another failure")
    })
    h.receiveSnapshot(11)
    expect(h.sendFrame).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "attach", since_seq: undefined })
    )
    expect(vi.getTimerCount()).toBe(0)
    h.stream.destroy()
  })

  it("reconnects immediately during backoff without leaving a second retry", () => {
    const h = harness({
      onSnapshot: () => {
        throw new Error("snapshot failed")
      },
    })
    h.receiveSnapshot(10)
    h.receiveSnapshot(10)
    expect(vi.getTimerCount()).toBe(1)
    h.setOpen(false)
    h.reconnect()
    expect(vi.getTimerCount()).toBe(0)
    expect(h.sendFrame).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "attach", since_seq: undefined })
    )
    h.stream.destroy()
  })

  it("waits for reconnect if the socket closes during a failed delivery", () => {
    const onEvent = vi.fn<AttachHandlers["onEvent"]>()
    const h = harness({ onEvent })
    h.receiveSnapshot(10)
    onEvent.mockImplementation(() => {
      h.setOpen(false)
      throw new Error("delivery failed while offline")
    })
    h.sendFrame.mockClear()
    h.receiveEvent(11)
    expect(h.sendFrame).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    h.reconnect()
    expect(h.sendFrame).toHaveBeenCalledTimes(1)
    expect(h.sendFrame).toHaveBeenCalledWith({
      action: "attach",
      subscription_id: h.sub.subscriptionId,
      connection_id: "conn-1",
      since_seq: undefined,
    })
    h.stream.destroy()
  })

  it("cancels a recovery retry when the server removes the connection", () => {
    const h = harness({
      onSnapshot: () => {
        throw new Error("snapshot failed")
      },
    })
    h.receiveSnapshot(10)
    h.receiveSnapshot(10)
    h.stream.handleServerFrame({
      type: "detached",
      subscription_id: h.sub.subscriptionId,
      reason: "connection_gone",
    })
    expect(h.handlers.onDetached).toHaveBeenCalledWith("connection_gone")
    expect(vi.getTimerCount()).toBe(0)
    h.sendFrame.mockClear()
    h.reconnect()
    expect(h.sendFrame).not.toHaveBeenCalled()
    h.stream.destroy()
  })

  it.each(["detach", "destroy"] as const)(
    "cancels pending retries on %s using the original handle",
    (cleanup) => {
      const h = harness({
        onSnapshot: () => {
          throw new Error("snapshot failed")
        },
      })
      const originalHandle = h.sub
      h.receiveSnapshot(10)
      h.receiveSnapshot(10)
      expect(vi.getTimerCount()).toBe(1)
      if (cleanup === "detach") originalHandle.detach()
      else h.stream.destroy()
      expect(vi.getTimerCount()).toBe(0)
      h.sendFrame.mockClear()
      h.reconnect()
      vi.advanceTimersByTime(60_000)
      h.receiveEvent(11)
      expect(h.sendFrame).not.toHaveBeenCalled()
      expect(h.handlers.onEvent).not.toHaveBeenCalled()
      h.stream.destroy()
    }
  )

  it("does not revive a subscription detached by a throwing handler", () => {
    const onEvent = vi.fn<AttachHandlers["onEvent"]>()
    const h = harness({ onEvent })
    onEvent.mockImplementation(() => {
      h.sub.detach()
      throw new Error("failed after detach")
    })
    h.receiveEvent(1)
    h.sendFrame.mockClear()
    h.reconnect()
    expect(h.sendFrame).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    h.stream.destroy()
  })
})
