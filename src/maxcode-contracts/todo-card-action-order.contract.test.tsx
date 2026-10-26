import { render, screen, within } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import { TodoCard } from "@/components/todos/todo-card"
import en from "@/i18n/messages/en.json"
import type { Todo } from "@/lib/todos"

vi.mock("@/components/todos/use-new-chat-from-todo", () => ({
  useNewChatFromTodo: () => vi.fn(),
}))

describe("todo card action order", () => {
  it.each([false, true])(
    "places new conversation, import, then source in list=%s",
    (list) => {
      const todo: Todo = {
        id: "action-order",
        title: "Review",
        content: "Review the change",
        status: "unclaimed",
        assignee_id: null,
        creator_id: "me",
        revision: 1,
        source_url: "https://example.com/conversation",
        codex_import_available: true,
        created_at: "2026-10-26T00:00:00Z",
        updated_at: "2026-10-26T00:00:00Z",
      }
      render(
        <NextIntlClientProvider locale="en" messages={en}>
          <TodoCard
            todo={todo}
            selfId="me"
            disabled={false}
            list={list}
            onOpen={vi.fn()}
            onEdit={vi.fn()}
            onDelete={vi.fn()}
            onAction={vi.fn()}
          />
        </NextIntlClientProvider>
      )
      const chat = screen.getByRole("button", {
        name: en.Todos.insertIntoConversation,
      })
      const actions = within(chat.parentElement!)
      expect(
        Array.from(chat.parentElement!.querySelectorAll("button, a")).slice(
          0,
          3
        )
      ).toEqual([
        chat,
        actions.getByRole("button", { name: en.Todos.importCodexConversation }),
        actions.getByRole("link", { name: en.Todos.sourceConversation }),
      ])
    }
  )
})
