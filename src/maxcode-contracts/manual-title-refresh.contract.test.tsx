import { existsSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("MaxCode contract: manual title refresh is removed", () => {
  it.each([
    "src/components/conversations/sidebar-conversation-card.tsx",
    "src/components/conversations/conversation-detail-header.tsx",
    "src/components/tabs/tab-item.tsx",
  ])("does not expose title regeneration in %s", (path) => {
    const menu = source(path)
    expect(menu).not.toMatch(/useRefreshConversationTitle|refreshTitle/)
  })

  it("removes the unused frontend request and hook but keeps renaming", () => {
    expect(source("src/lib/api.ts")).not.toContain("refresh_conversation_title")
    expect(existsSync("src/hooks/use-refresh-conversation-title.ts")).toBe(
      false
    )
    expect(source("src/lib/api.ts")).toContain("updateConversationTitle")
    for (const path of [
      "src/components/conversations/sidebar-conversation-card.tsx",
      "src/components/conversations/conversation-detail-header.tsx",
    ]) {
      expect(source(path)).toContain("onSelect={handleRenameOpen}")
    }
  })
})
