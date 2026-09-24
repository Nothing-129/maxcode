import { describe, expect, it } from "vitest"
import {
  estimateChangedLineStats,
  countUnifiedDiffLineChanges,
} from "@/lib/line-change-stats"
import { generateUnifiedDiff } from "@/lib/unified-diff-generator"

describe("large reply file diff", () => {
  it("shows actual edits when a few changes span a large file", () => {
    const before = Array.from({ length: 1481 }, (_, i) => `line ${i}`)
    const after = [...before]
    after[0] = "edited first line"
    after[1480] = "edited last line"

    const stats = estimateChangedLineStats(before.join("\n"), after.join("\n"))
    const diff = generateUnifiedDiff(before.join("\n"), after.join("\n"))

    expect(stats).toEqual({ additions: 2, deletions: 2 })
    expect(diff).not.toBeNull()
    expect(countUnifiedDiffLineChanges(diff!)).toEqual(stats)
    expect((diff!.match(/^@@ /gm) ?? []).length).toBe(2)
  })
})
