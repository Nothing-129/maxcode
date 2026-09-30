import { contextCompactionPayload } from "@/lib/context-compaction"

type CompactionItem = {
  kind: string
  phase?: "persisted" | "optimistic" | "streaming"
  source?: "history" | "live"
  meta?: Record<string, unknown> | null
  callId?: string
}

/**
 * Exact call IDs identify Codex copies; Claude uses different IDs. Match
 * complete metadata across those sources one-to-one, keeping the first copy.
 * Repeated boundaries within one source are distinct events even when all their
 * counters agree. Missing source/metadata cannot establish a match.
 */
export function dedupeCompactionItems<T extends CompactionItem>(
  items: T[]
): T[] {
  type Source = "history" | "live"
  type Event = { source: Source | null; counterKey: string | null }
  const unmatched = new Map<string, { history: Set<Event>; live: Set<Event> }>()
  const namedEvents = new Map<string, Event>()
  let dropped = false
  const kept = items.filter((item) => {
    if (item.kind !== "compaction") return true
    const source =
      item.source ??
      (item.phase === "persisted"
        ? "history"
        : item.phase === "streaming" || item.phase === "optimistic"
          ? "live"
          : null)
    const payload = contextCompactionPayload(item.meta)
    const counters = payload
      ? [payload.preTokens, payload.postTokens, payload.durationMs]
      : []
    const counterKey =
      payload &&
      counters.every(
        (v) => typeof v === "number" && Number.isFinite(v) && v >= 0
      ) &&
      [payload.trigger, payload.error].every(
        (v) => v == null || typeof v === "string"
      )
        ? JSON.stringify([
            ...counters,
            payload.trigger ?? null,
            payload.error ?? null,
          ])
        : null
    const callId =
      typeof item.callId === "string" && item.callId.trim() ? item.callId : null
    const named = callId ? namedEvents.get(callId) : undefined
    if (named) {
      // Consume the cross-source pair so it cannot swallow a later real event.
      if (
        source &&
        named.source &&
        source !== named.source &&
        named.counterKey
      ) {
        unmatched.get(named.counterKey)?.[named.source].delete(named)
      }
      dropped = true
      return false
    }
    const matches = counterKey ? unmatched.get(counterKey) : undefined
    const counterpartSource = source === "history" ? "live" : "history"
    const counterpart = source
      ? matches?.[counterpartSource].values().next().value
      : undefined
    if (counterpart && matches) {
      matches[counterpartSource].delete(counterpart)
      if (callId) namedEvents.set(callId, counterpart)
      dropped = true
      return false
    }
    const event: Event = { source, counterKey }
    if (callId) namedEvents.set(callId, event)
    if (source && counterKey) {
      const bucket = matches ?? {
        history: new Set<Event>(),
        live: new Set<Event>(),
      }
      bucket[source].add(event)
      unmatched.set(counterKey, bucket)
    }
    return true
  })
  return dropped ? kept : items
}
