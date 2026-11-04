import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SidebarTodoGroupHeader } from "@/components/conversations/sidebar-todo-group-header"
import type { TodoStatus } from "@/lib/todos"
import messages from "@/i18n/messages/en.json"

afterEach(cleanup)

function setup(status: TodoStatus = "claimed") {
  const onOpen = vi.fn()
  const onToggle = vi.fn()
  const onComplete = vi.fn()
  const onNewConversation = vi.fn()
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SidebarTodoGroupHeader
        id="task"
        title="Task title"
        expanded={false}
        status={status}
        onOpen={onOpen}
        onToggle={onToggle}
        onComplete={status === "completed" ? undefined : onComplete}
        onNewConversation={onNewConversation}
      />
    </NextIntlClientProvider>
  )
  return { onOpen, onToggle, onComplete, onNewConversation }
}

describe("todo details through the shared sidebar menu", () => {
  it.each(["claimed", "pending_verification", "completed"] as const)(
    "has identical actions from right click and ellipsis for %s",
    async (status) => {
      const callbacks = setup(status)
      const user = userEvent.setup()
      const more = screen.getByRole("button", { name: "More actions" })
      expect(more).toHaveClass(
        "[@media(hover:none)]:opacity-100",
        "[@media(pointer:coarse)]:opacity-100"
      )
      fireEvent.contextMenu(screen.getByText("Task title"))
      const labels = screen
        .getAllByRole("menuitem")
        .map((item) => item.textContent)
      expect(labels[0]).toBe("View details")
      expect(labels).toHaveLength(status === "completed" ? 1 : 3)
      await user.keyboard("{Escape}")
      await user.click(more)
      expect(more).toHaveAttribute("aria-expanded", "true")
      expect(
        screen.getAllByRole("menuitem").map((item) => item.textContent)
      ).toEqual(labels)
      await user.click(screen.getByRole("menuitem", { name: "View details" }))
      expect(callbacks.onOpen).toHaveBeenCalledExactlyOnceWith("task")
      expect(callbacks.onToggle).not.toHaveBeenCalled()
      expect(callbacks.onComplete).not.toHaveBeenCalled()
      expect(callbacks.onNewConversation).not.toHaveBeenCalled()
    }
  )

  it("keeps row expansion and new conversation independent from details", async () => {
    const callbacks = setup()
    const user = userEvent.setup()
    await user.click(screen.getByText("Task title"))
    expect(callbacks.onToggle).toHaveBeenCalledExactlyOnceWith("task")
    await user.click(
      screen.getByRole("button", { name: "New conversation from Task title" })
    )
    expect(callbacks.onNewConversation).toHaveBeenCalledExactlyOnceWith("task")
    expect(callbacks.onOpen).not.toHaveBeenCalled()
  })

  it("opens details by keyboard through the ellipsis", async () => {
    const callbacks = setup()
    const user = userEvent.setup()
    screen.getByRole("button", { name: "More actions" }).focus()
    await user.keyboard("{Enter}")
    const menu = await screen.findByRole("menu")
    expect(within(menu).getAllByRole("menuitem")[0]).toHaveTextContent(
      "View details"
    )
    await user.keyboard("{Home}{Enter}")
    expect(callbacks.onOpen).toHaveBeenCalledExactlyOnceWith("task")
    expect(callbacks.onToggle).not.toHaveBeenCalled()
  })
})
