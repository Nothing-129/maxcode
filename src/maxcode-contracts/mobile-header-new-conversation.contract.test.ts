import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: mobile header new conversation", () => {
  it("exposes new chat on the header right and keeps overflow desktop-only", () => {
    const header = source(
      "src/components/conversations/conversation-detail-header.tsx"
    )
    const buttons = [
      ...header.matchAll(/<(?:button|Button)\b[\s\S]*?<\/(?:button|Button)>/g),
    ].map((match) => match[0])
    const more = buttons.find((button) => button.includes('name="more"'))!
    expect(more).toContain('className="hidden ')
    expect(more).toContain("md:flex")
    const newChat = buttons.find((button) =>
      button.includes("onClick={handleNewConversation}")
    )!
    expect(header).toMatch(/\{displayTitle\}\s*<\/span>\s*<DropdownMenu>/)
    expect(newChat).not.toContain("md:hidden")
    expect(newChat).toContain("<Button")
    expect(newChat).toContain('variant="ghost"')
    expect(newChat).toContain('size="icon"')
    expect(newChat).toContain("h-11 w-8 shrink-0 rounded-xl")
    expect(newChat).toContain("md:size-6")
    const titleBar = source("src/components/layout/folder-title-bar.tsx")
    expect(titleBar).toContain('<Ellipsis className="size-[18px]" />')
    expect(titleBar).toContain('<Menu className="size-5" strokeWidth={1.8} />')
    expect(titleBar).toMatch(
      /className="h-11 w-8 shrink-0 rounded-xl"\s+onClick=\{toggle\}/
    )
    expect(titleBar).toMatch(
      /className="h-11 w-8 shrink-0 rounded-xl"\s+aria-label=\{tTitleBar\("workspaceTools"\)\}/
    )
    expect(newChat).toContain('className="size-[18px] md:size-4"')
    expect(newChat).toContain("md:text-muted-foreground")
    expect(newChat).not.toContain(" text-muted-foreground")
    expect(newChat).toContain('<SquarePen aria-hidden="true"')
    expect(newChat).toContain('aria-label={t("newConversation")}')
    expect(newChat).toContain("disabled={!folderPath}")
    expect(header).toContain("collapseSidebarOnNavigate()")
    expect(header).toContain(
      "openNewConversationTab(folderId, folderPath, { inheritFromActive: true })"
    )
  })
})
