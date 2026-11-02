import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("MaxCode contract: mobile header conversation tools", () => {
  it("uses the active conversation menu without a duplicate new-chat entry", () => {
    const header = source(
      "src/components/conversations/conversation-detail-header.tsx"
    )
    expect(header).toContain(
      "<MobileHeaderActionsSlot active={activeTabId === tabId}>"
    )
    expect(header).toContain("{conversationMenuItems}")
    expect(header).not.toContain('t("newConversation")')
    const titleBar = source("src/components/layout/folder-title-bar.tsx")
    expect(titleBar).toContain("{isConversations && conversationActions}")
    expect(titleBar).toContain(
      "{!(isConversations && conversationActions) && ("
    )
    expect(titleBar).toContain('<Ellipsis className="size-[18px]" />')
    expect(titleBar).toContain('<DesktopChromeIcon name="sidebar" />')
    expect(titleBar).not.toContain("<Menu ")
    expect(titleBar).toMatch(
      /className="h-11 w-8 shrink-0 rounded-xl"\s+onClick=\{toggle\}/
    )
    expect(titleBar).toContain("[&_[role=menuitem]]:min-h-11")
  })
})
