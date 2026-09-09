import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("MaxCode: consistent newly sent message appearance", () => {
  it("uses the shared message renderer without fading optimistic messages", () => {
    const source = readFileSync(
      "src/components/message/message-list-view.tsx",
      "utf8"
    )
    const renderTurn = source.slice(
      source.indexOf('case "turn": {'),
      source.indexOf('case "typing":')
    )
    expect(renderTurn).toContain("<HistoricalMessageGroup")
    expect(renderTurn).not.toMatch(/dimmed|opacity|item\.phase/)
    const group = source.slice(
      source.indexOf("const HistoricalMessageGroup"),
      source.indexOf("const PendingTypingIndicator")
    )
    expect(group).toContain("<CollapsibleUserMessage parts={group.parts} />")
    expect(group).not.toMatch(/dimmed|opacity-/)
  })
})
