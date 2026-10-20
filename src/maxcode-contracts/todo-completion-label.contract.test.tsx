import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import { TodoCard } from "@/components/todos/todo-card"
import zhCN from "@/i18n/messages/zh-CN.json"
import zhTW from "@/i18n/messages/zh-TW.json"
import type { Todo } from "@/lib/todos"

vi.mock("@/components/todos/use-new-chat-from-todo", () => ({
  useNewChatFromTodo: () => vi.fn(),
}))

describe("todo completion action layout", () => {
  it.each([
    ["zh-CN", zhCN, "已完成"],
    ["zh-TW", zhTW, "已完成"],
  ] as const)(
    "distinguishes action from status through layout in %s",
    async (locale, messages, label) => {
      const onAction = vi.fn()
      const todo: Todo = {
        id: "todo",
        title: "ASR",
        content: "Fix ASR",
        status: "claimed",
        assignee_id: "me",
        creator_id: "me",
        revision: 1,
        source_url: null,
        created_at: "2026-10-16T00:00:00Z",
        updated_at: "2026-10-16T00:00:00Z",
      }
      const card = (item: Todo) => (
        <NextIntlClientProvider locale={locale} messages={messages}>
          <TodoCard
            todo={item}
            selfId="me"
            disabled={false}
            onOpen={vi.fn()}
            onEdit={vi.fn()}
            onDelete={vi.fn()}
            onAction={onAction}
          />
        </NextIntlClientProvider>
      )
      const { rerender } = render(card(todo))
      const complete = screen.getByRole("button", { name: label })
      expect(complete).toHaveAttribute("data-variant", "ghost")
      expect(complete).toHaveClass("rounded-md", "text-muted-foreground")
      expect(complete.querySelector("svg")).not.toBeNull()
      expect(complete.parentElement?.lastElementChild).toBe(complete)
      await userEvent.setup().click(complete)
      expect(onAction).toHaveBeenCalledWith("complete")

      rerender(card({ ...todo, status: "unclaimed", assignee_id: null }))
      const claim = screen.getByRole("button", { name: messages.Todos.claim })
      expect(claim).toHaveAttribute("data-variant", "ghost")
      expect(claim).toHaveClass("text-muted-foreground")
      await userEvent.setup().click(claim)
      expect(onAction).toHaveBeenCalledWith("claim")

      rerender(card({ ...todo, status: "completed" }))
      expect(screen.getByText("已完成")).toBeVisible()
      expect(screen.queryByRole("button", { name: label })).toBeNull()
      const reopen = screen.getByRole("button", { name: messages.Todos.reopen })
      expect(reopen).toBeVisible()
      expect(reopen).toHaveAttribute("data-variant", "ghost")
      await userEvent.setup().click(reopen)
      expect(onAction).toHaveBeenCalledWith("reopen")
    }
  )
})
