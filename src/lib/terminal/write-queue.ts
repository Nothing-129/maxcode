/**
 * Ordered, single-flight write pump for terminal input.
 *
 * Terminal input must reach the PTY in exactly the order it was typed. The
 * transport `call()` channel underneath `terminalWrite` gives NO cross-call
 * ordering guarantee: requests are independent HTTP POSTs
 * (unordered, connection-pool-limited). Firing one
 * fire-and-forget call per keystroke therefore scrambles fast input.
 *
 * This queue restores ordering the way VS Code / xterm.js do it — a single
 * ordered channel — by serializing: at most ONE `send` is in flight, and the
 * next batch waits for the previous to resolve. Because the backend enqueues
 * bytes into its FIFO PTY-writer channel *before* the call returns, awaiting
 * each send guarantees end-to-end type order regardless of transport
 * reordering.
 *
 * Bytes typed while a send is in flight coalesce into the next batch — fewer,
 * larger sends, the same "event batching" the VS Code pty-host uses — so fast
 * typing and paste collapse to a handful of round-trips instead of one per
 * character.
 *
 * Failure policy: a failed send is DROPPED, never retried. The only "ack" the
 * transport gives us is the call resolving — there is no signal distinguishing
 * "the bytes reached the PTY" from "they didn't" when a request times out or
 * the connection drops mid-flight. Re-sending an ambiguous batch risks
 * DUPLICATING already-delivered input, and a duplicated control byte (Enter,
 * Ctrl-C, a pasted command) is worse in a shell than a dropped one. So we
 * favor at-most-once over at-least-once. (This matches the prior
 * fire-and-forget behavior on failure — we only add ordering, never a new
 * duplication risk. Eliminating loss too would require a backend write-ack /
 * idempotency layer, which is out of scope here.)
 */

export interface WriteQueue {
  /** Append input bytes; sent in order, coalescing under load. */
  enqueue: (data: string) => void
  /** Stop the pump and drop buffered bytes. Idempotent. */
  dispose: () => void
}

/**
 * Create an ordered single-flight write pump. `send` is the sink for one batch
 * of bytes (e.g. `(data) => terminalWrite(terminalId, data)`).
 */
export function createWriteQueue(
  send: (data: string) => Promise<void>
): WriteQueue {
  let pending = ""
  let flushing = false
  let stopped = false

  async function flush(): Promise<void> {
    if (flushing) return
    flushing = true
    try {
      while (!stopped && pending.length > 0) {
        const batch = pending
        pending = ""
        try {
          await send(batch)
        } catch {
          // Drop this batch — do NOT re-prepend/retry. We cannot tell whether
          // `batch` reached the PTY, and re-sending could duplicate delivered
          // input (worse than losing it, for a shell). Bytes typed *after*
          // this batch are still in `pending`, untouched, and go out next in
          // order; only the failed batch is lost.
          if (stopped) return
        }
      }
    } finally {
      flushing = false
    }
  }

  return {
    enqueue(data: string): void {
      if (stopped || data.length === 0) return
      pending += data
      void flush()
    },
    dispose(): void {
      stopped = true
      pending = ""
    },
  }
}
