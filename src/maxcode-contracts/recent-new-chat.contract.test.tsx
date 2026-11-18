import { fireEvent, render } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"

import { SidebarSectionHeader } from "@/components/conversations/sidebar-section-header"
import enMessages from "@/i18n/messages/en.json"
import { source } from "./contract-source"

describe("MaxCode contract: Recent omits the duplicate New chat action", () => {
  it("keeps the folderless chat action on Chats alone", () => {
    const list = source(
      "src/components/conversations/sidebar-conversation-list.tsx"
    )
    expect(list).toMatch(
      /onNewChat=\{\s*row\.section === "chats"\s*\? handleNewChat\s*: undefined\s*\}/
    )
    const handler = list.slice(
      list.indexOf("  const handleNewChat ="),
      list.indexOf("  const handleNewConversation =")
    )
    expect(handler).toContain("openChatModeTab()")
    expect(handler).toContain("openConversations()")
    expect(handler).not.toContain("activeFolder")
    expect(handler).not.toContain("openNewConversationTab")
  })

  it("keeps Recent collapsible without exposing New chat", () => {
    const onNewChat = vi.fn()
    const onToggle = vi.fn()
    const { getByRole, queryByRole } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <SidebarSectionHeader
          section="recent"
          expanded
          onToggle={onToggle}
          onNewChat={onNewChat}
        />
      </NextIntlClientProvider>
    )
    expect(queryByRole("button", { name: "New chat" })).toBeNull()
    fireEvent.click(getByRole("button", { name: "Recent" }))
    expect(onToggle).toHaveBeenCalledWith("recent")
    expect(onNewChat).not.toHaveBeenCalled()
  })
})
