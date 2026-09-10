import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: mobile header new conversation", () => {
  it("exposes new chat directly on mobile and keeps overflow desktop-only", () => {
    const header = source(
      "src/components/conversations/conversation-detail-header.tsx"
    )
    const buttons = [...header.matchAll(/<button\b[\s\S]*?<\/button>/g)].map(
      (match) => match[0]
    )
    const more = buttons.find((button) => button.includes('name="more"'))!
    expect(more).toContain('className="hidden ')
    expect(more).toContain("md:flex")
    const newChat = buttons.find((button) =>
      button.includes("onClick={handleNewConversation}")
    )!
    expect(newChat).toContain("md:hidden")
    expect(newChat).toContain('<SquarePen aria-hidden="true"')
    expect(newChat).toContain('aria-label={t("newConversation")}')
    expect(newChat).toContain("disabled={!folderPath}")
    expect(header).toContain("collapseSidebarOnNavigate()")
    expect(header).toContain(
      "openNewConversationTab(folderId, folderPath, { inheritFromActive: true })"
    )
  })
})
