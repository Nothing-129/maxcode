import { fireEvent, render } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"

import { SidebarSectionHeader } from "@/components/conversations/sidebar-section-header"
import enMessages from "@/i18n/messages/en.json"
import { source } from "./contract-source"

describe("MaxCode contract: Recent creates a folderless chat", () => {
  it("routes Recent and Chats through the same chat action", () => {
    const list = source(
      "src/components/conversations/sidebar-conversation-list.tsx"
    )
    expect(list).toMatch(
      /onNewChat=\{\s*row\.section === "chats" \|\| row\.section === "recent"\s*\? handleNewChat\s*: undefined\s*\}/
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

  it("labels the Recent action New chat and invokes it without toggling", () => {
    const onNewChat = vi.fn()
    const onToggle = vi.fn()
    const { getByRole } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <SidebarSectionHeader
          section="recent"
          expanded
          onToggle={onToggle}
          onNewChat={onNewChat}
        />
      </NextIntlClientProvider>
    )
    fireEvent.click(getByRole("button", { name: "New chat" }))
    expect(onNewChat).toHaveBeenCalledOnce()
    expect(onToggle).not.toHaveBeenCalled()
  })
})
