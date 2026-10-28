import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

function forbidsStatusGlyph(code: string) {
  expect(code).not.toContain('from "@/components/shared/activity-status-icon"')
  expect(code).not.toContain("<ActivityStatusIcon")
  expect(code).not.toMatch(/\bClock3\b/)
  expect(code).not.toContain("data-activity-status")
}

describe("MaxCode: model working-state labels stay text-only", () => {
  it("keeps live phase copy and never restores a status glyph beside it", () => {
    const stats = source("src/components/message/live-turn-stats.tsx")
    expect(stats).toContain("getAgentActivity")
    expect(stats).toContain('{t(retrying ? "retrying" : activity)}')
    forbidsStatusGlyph(stats)

    const list = source("src/components/message/message-list-view.tsx")
    const typing = list.slice(
      list.indexOf("export function stabilizePendingReply"),
      list.indexOf("const AutoScrollOnSend")
    )
    expect(list).toContain('feedbackText("awaitingUser")')
    expect(list).toContain('feedbackText("thinkingPending")')
    forbidsStatusGlyph(list)
    forbidsStatusGlyph(typing)
  })

  it("leaves tool-card status icons on the tool header, not the turn row", () => {
    expect(source("src/components/ai-elements/tool.tsx")).toContain(
      "<ActivityStatusIcon"
    )
  })
})
