import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SidebarTodoGroupHeader } from "@/components/conversations/sidebar-todo-group-header"
import messages from "@/i18n/messages/en.json"

afterEach(cleanup)

const createdAt = new Date(2026, 10, 2, 12).toISOString()

function showGroup({
  title = "1026｜探索｜检查分组样式",
  created = createdAt,
}: {
  title?: string
  created?: string
} = {}) {
  const onToggle = vi.fn()
  const onOpen = vi.fn()
  const onNewConversation = vi.fn()
  const result = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SidebarTodoGroupHeader
        id="task"
        title={title}
        createdAt={created}
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

describe("mobile todo group layout", () => {
  it("shows a single-line title above its creation date and status", () => {
    const { container } = showGroup()
    const title = screen.getByText("检查分组样式")
    expect(title).toHaveClass("truncate")
    const meta = container.querySelector<HTMLElement>("[data-todo-meta]")!
    expect(within(meta).getByText("1102")).toHaveAttribute(
      "datetime",
      createdAt
    )
    expect(within(meta).getByText("To verify")).toBeInTheDocument()
    expect(screen.queryByText("1026")).not.toBeInTheDocument()
    expect(title.closest("[data-todo-title]")).not.toContainElement(meta)
  })

  it("keeps the date column when creation date is missing", () => {
    const { container } = showGroup({ title: "普通待办", created: "invalid" })
    const meta = container.querySelector<HTMLElement>("[data-todo-meta]")!
    expect(meta.children[0]).toBeEmptyDOMElement()
    expect(meta.children[1]).toHaveTextContent("To verify")
  })

  it("uses the structured title date if no creation date is available", () => {
    const { container } = showGroup({ created: "invalid" })
    const meta = container.querySelector<HTMLElement>("[data-todo-meta]")!
    expect(within(meta).getByText("1026")).toBeInTheDocument()
    expect(screen.getByText("检查分组样式")).toBeInTheDocument()
  })

  it("retains expansion, new conversation, and details menu on mobile", async () => {
    const { onToggle, onOpen, onNewConversation } = showGroup({
      title: "Task title",
    })
    const user = userEvent.setup()
    await user.click(screen.getByText("Task title"))
    expect(onToggle).toHaveBeenCalledWith("task")
    await user.click(
      screen.getByRole("button", { name: "New conversation from Task title" })
    )
    expect(onNewConversation).toHaveBeenCalledWith("task")
    await user.click(screen.getByRole("button", { name: "More actions" }))
    await user.click(screen.getByRole("menuitem", { name: "View details" }))
    expect(onOpen).toHaveBeenCalledWith("task")
  })
})
