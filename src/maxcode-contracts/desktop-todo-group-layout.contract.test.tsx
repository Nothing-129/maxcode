import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SidebarTodoGroupHeader } from "@/components/conversations/sidebar-todo-group-header"
import messages from "@/i18n/messages/en.json"

afterEach(cleanup)

const createdAt = new Date(2026, 10, 2, 12).toISOString()

function showGroup() {
  const onToggle = vi.fn()
  const onOpen = vi.fn()
  const onNewConversation = vi.fn()
  const result = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SidebarTodoGroupHeader
        id="task"
        title="1026｜探索｜检查分组样式"
        createdAt={createdAt}
        expanded={false}
        status="pending_verification"
        onToggle={onToggle}
        onOpen={onOpen}
        onComplete={vi.fn()}
        onNewConversation={onNewConversation}
      />
    </NextIntlClientProvider>
  )
  return { ...result, onToggle, onOpen, onNewConversation }
}

describe("desktop todo group layout", () => {
  it("shows one title line above the creation date and status", () => {
    const { container } = showGroup()
    const title = screen.getByText("检查分组样式")
    expect(title).toHaveClass("truncate")
    const metadata = container.querySelector<HTMLElement>("[data-todo-meta]")!
    expect(within(metadata).getByText("1102")).toHaveAttribute(
      "datetime",
      createdAt
    )
    expect(within(metadata).getByText("To verify")).toBeInTheDocument()
    expect(title.closest("[data-todo-title]")).not.toContainElement(metadata)
    expect(screen.queryByText("1026")).not.toBeInTheDocument()
  })

  it("retains expansion, details and new-conversation actions", async () => {
    const { onToggle, onOpen, onNewConversation } = showGroup()
    const user = userEvent.setup()
    await user.click(screen.getByText("检查分组样式"))
    expect(onToggle).toHaveBeenCalledWith("task")
    await user.click(
      screen.getByRole("button", { name: /New conversation from/ })
    )
    expect(onNewConversation).toHaveBeenCalledWith("task")
    await user.click(screen.getByRole("button", { name: "More actions" }))
    await user.click(screen.getByRole("menuitem", { name: "View details" }))
    expect(onOpen).toHaveBeenCalledWith("task")
  })
})
