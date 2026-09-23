import { describe, expect, it } from "vitest"

import { dedupeCompactionItems } from "@/lib/dedupe-compaction-items"
import { source } from "./contract-source"

const divider = (
  key: string,
  payload: Record<string, unknown>,
  source?: "history" | "live"
) => ({
  key,
  kind: "compaction",
  source,
  meta: { contextCompaction: { version: 1, ...payload } },
})
const full = { preTokens: 108716, postTokens: 4462, durationMs: 92728 }

describe("MaxCode contract: Claude compaction uses the existing conversation layout", () => {
  it("keeps one boundary across live and history without losing surrounding replies", () => {
    const items = [
      { key: "before", kind: "turn" },
      divider("history-boundary", full, "history"),
      { key: "summary", kind: "turn" },
      divider("live-boundary", full, "live"),
      divider("later-boundary", { ...full, postTokens: 12000 }, "history"),
    ]
    const result = dedupeCompactionItems(items)
    expect(result.map((item) => item.key)).toEqual([
      "before",
      "history-boundary",
      "summary",
      "later-boundary",
    ])
    expect(result[0]).toBe(items[0])
    expect(items).toHaveLength(5)
  })

  it.each([
    {},
    { preTokens: 100, postTokens: 10 },
    { preTokens: 100, durationMs: 10 },
    { postTokens: 100, durationMs: 10 },
    { ...full, durationMs: Number.NaN },
    { ...full, durationMs: Number.POSITIVE_INFINITY },
    { ...full, durationMs: "92728" },
    { ...full, preTokens: -1 },
    { ...full, trigger: {} },
    { ...full, error: true },
  ])(
    "preserves separate events when metadata cannot identify them: %j",
    (payload) => {
      const items = [
        divider("first", payload, "history"),
        divider("second", payload, "live"),
      ]
      expect(dedupeCompactionItems(items)).toBe(items)
    }
  )

  it("retains Grok boolean boundaries and does not dedupe ordinary message metadata", () => {
    const items = [
      { key: "grok-1", kind: "compaction", meta: { contextCompaction: true } },
      { key: "grok-2", kind: "compaction", meta: { contextCompaction: true } },
      { ...divider("reply-1", full), kind: "turn" },
      { ...divider("reply-2", full), kind: "turn" },
    ]
    expect(dedupeCompactionItems(items)).toBe(items)
  })

  it.each(["history", "live"] as const)(
    "preserves separate boundaries from the same %s source",
    (source) => {
      const items = [
        divider("first", full, source),
        divider("second", full, source),
      ]
      expect(dedupeCompactionItems(items)).toBe(items)
    }
  )

  it("pairs counterparts one-to-one instead of consuming later real events", () => {
    const items = [
      divider("history-1", full, "history"),
      divider("history-2", full, "history"),
      divider("live-1", full, "live"),
      divider("live-2", full, "live"),
      divider("live-3", full, "live"),
    ]
    const result = dedupeCompactionItems(items)
    expect(result).toEqual([items[0], items[1], items[4]])
    expect(result[2]).toBe(items[4])
  })

  it("retains the first copy when the live source comes before history", () => {
    const items = [
      divider("live-1", full, "live"),
      divider("history-1", full, "history"),
      divider("history-2", full, "history"),
    ]
    expect(dedupeCompactionItems(items)).toEqual([items[0], items[2]])
  })

  it.each([
    [{ trigger: "manual" }, { trigger: "automatic" }],
    [{}, { error: "compaction failed" }],
    [{ error: "first failure" }, { error: "second failure" }],
  ])(
    "preserves events with different outcomes or triggers: %j / %j",
    (first, second) => {
      const items = [
        divider("first", { ...full, ...first }, "history"),
        divider("second", { ...full, ...second }, "live"),
      ]
      expect(dedupeCompactionItems(items)).toBe(items)
    }
  )

  it("keeps complete metadata when neither item's source is known", () => {
    const items = [divider("first", full), divider("second", full)]
    expect(dedupeCompactionItems(items)).toBe(items)
  })

  it("uses explicit origin for promoted local replies despite their persisted phase", () => {
    const items = [
      { ...divider("history", full, "history"), phase: "persisted" as const },
      { ...divider("local", full, "live"), phase: "persisted" as const },
    ]
    expect(dedupeCompactionItems(items)).toEqual([items[0]])
  })

  it("can correlate known phases while preserving metadata-free legacy items", () => {
    const items = [
      { ...divider("history", full), phase: "persisted" as const },
      { ...divider("live", full), phase: "streaming" as const },
      divider("legacy", full),
    ]
    expect(dedupeCompactionItems(items)).toEqual([items[0], items[2]])
  })

  it("connects dedupe before reply grouping and preserves the current divider renderer", () => {
    const view = source("src/components/message/message-list-view.tsx")
    expect(view).toMatch(
      /mergeConsecutiveAssistantTurns\(\s*dedupeCompactionItems\(rawItems\),/
    )
    expect(view).toMatch(/<ContextCompactionCard\s+[\s\S]*?meta=\{item\.meta\}/)
    expect(view).toContain('timelineTurns[i].key.startsWith("local-")')
    expect(view).toContain('phase !== "persisted"')
    const parser = source("src-tauri/src/parsers/claude.rs")
    expect(parser).toContain("compact_boundary")
    expect(parser).toContain("postTokens")
  })
})
