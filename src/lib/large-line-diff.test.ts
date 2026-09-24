import { describe, expect, it } from "vitest"
import { computeLineDiff } from "@/components/merge/merge-diff"
import { computeSparseLineDiff } from "./large-line-diff"

describe("computeSparseLineDiff", () => {
  it("matches LCS counts through insertions, deletions and repeated lines", () => {
    let seed = 17
    const random = () => (seed = (seed * 48271) % 2147483647) % 5
    for (let caseIndex = 0; caseIndex < 100; caseIndex += 1) {
      const before = Array.from({ length: random() + 4 }, () =>
        String(random())
      )
      const after = Array.from({ length: random() + 4 }, () => String(random()))
      const actual = computeSparseLineDiff(before, after)!
      const expected = computeLineDiff(before, after)
      const counts = (hunks: typeof actual) => [
        hunks.reduce((sum, hunk) => sum + hunk.newLines.length, 0),
        hunks.reduce((sum, hunk) => sum + hunk.baseCount, 0),
      ]
      expect(counts(actual)).toEqual(counts(expected))

      const restored = [...before]
      for (const hunk of [...actual].reverse()) {
        restored.splice(hunk.baseStart, hunk.baseCount, ...hunk.newLines)
      }
      expect(restored).toEqual(after)
    }
  })
})
