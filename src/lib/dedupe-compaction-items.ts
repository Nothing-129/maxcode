import { contextCompactionPayload } from "@/lib/context-compaction"

type CompactionItem = {
  kind: string
  phase?: "persisted" | "optimistic" | "streaming"
  source?: "history" | "live"
  meta?: Record<string, unknown> | null
}

/**
 * The live ACP event and persisted Claude boundary have different IDs. Match
 * complete metadata across those sources one-to-one, keeping the first copy.
 * Repeated boundaries within one source are distinct events even when all their
 * counters agree. Missing source/metadata cannot establish a match.
 */
export function dedupeCompactionItems<T extends CompactionItem>(
  items: T[]
): T[] {
  const unmatched = new Map<string, { history: number; live: number }>()
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
    if (!source) return true
    const payload = contextCompactionPayload(item.meta)
    if (!payload) return true
    const counters = [payload.preTokens, payload.postTokens, payload.durationMs]
    if (
      !counters.every(
        (value) =>
          typeof value === "number" && Number.isFinite(value) && value >= 0
      ) ||
      [payload.trigger, payload.error].some(
        (value) => value != null && typeof value !== "string"
      )
    ) {
      return true
    }
    const key = JSON.stringify([
      ...counters,
      payload.trigger ?? null,
      payload.error ?? null,
    ])
    const counts = unmatched.get(key) ?? { history: 0, live: 0 }
    const counterpart = source === "history" ? "live" : "history"
    if (counts[counterpart] > 0) {
      counts[counterpart] -= 1
      dropped = true
      return false
    }
    counts[source] += 1
    unmatched.set(key, counts)
    return true
  })
  return dropped ? kept : items
}
