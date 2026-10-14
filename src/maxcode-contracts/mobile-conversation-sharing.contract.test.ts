import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: mobile conversation sharing", () => {
  it("exposes sharing in the rightmost tools menu for the active persisted conversation", () => {
    const chrome = source("src/components/layout/folder-title-bar.tsx")
    const menu = chrome.slice(chrome.indexOf("<DropdownMenu>"))
    expect(menu).toContain('aria-label={tTitleBar("workspaceTools")}')
    expect(menu).toMatch(
      /\{isConversations && \(\s*<DropdownMenuItem[\s\S]*?disabled=\{shareTabId == null\}[\s\S]*?openConversationShare\(shareTabId\)[\s\S]*?tCard\("shareConversation"\)/
    )
    expect(chrome).toContain("s.tabs.find((tab) => tab.id === s.activeTabId)")
    expect(chrome).toContain("tab?.conversationId != null ? tab.id : null")
  })

  it("reuses the existing dialog and scopes requests to one mounted pane", () => {
    const header = source(
      "src/components/conversations/conversation-detail-header.tsx"
    )
    expect(header).toContain(
      "if ((event as CustomEvent<string>).detail === tabId) handleShareOpen()"
    )
    expect(header).toContain(
      "window.addEventListener(OPEN_CONVERSATION_SHARE_EVENT, handleShareRequest)"
    )
    expect(header).toMatch(
      /window\.removeEventListener\(\s*OPEN_CONVERSATION_SHARE_EVENT,\s*handleShareRequest\s*\)/
    )
    expect(header.match(/open=\{shareTarget != null\}/g)).toHaveLength(1)
  })
})
