import { render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import en from "@/i18n/messages/en.json"
import { TodoCard } from "@/components/todos/todo-card"
import type { Todo } from "@/lib/todos"

vi.mock("@/components/todos/use-new-chat-from-todo", () => ({
  useNewChatFromTodo: () => vi.fn(),
}))
const todo: Todo = {
  id: "completion-time",
  title: "Completed task",
  content: "Task content",
  creator_id: "self",
  assignee_id: "self",
  status: "completed",
  revision: 3,
  source_url: null,
  created_at: "2026-10-15T01:00:00Z",
  updated_at: "2026-10-16T09:00:00Z",
  completed_at: "2026-10-16T02:30:00Z",
}
function card(item: Todo, list: boolean) {
  return (
    <NextIntlClientProvider locale="en" timeZone="Asia/Shanghai" messages={en}>
      <TodoCard
        todo={item}
        selfId="self"
        disabled={false}
        list={list}
        onOpen={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAction={vi.fn()}
      />
    </NextIntlClientProvider>
  )
}
describe("MaxCode todo completion time", () => {
  it.each([true, false])(
    "shows the actual completion time in local time (list=%s)",
    (list) => {
      const { container, rerender } = render(card(todo, list))
      expect(screen.getByText("Completed at")).toBeVisible()
      const time = container.querySelector(
        `time[datetime="${todo.completed_at}"]`
      )
      expect(time).not.toBeNull()
      expect(time?.textContent).toBe(
        new Intl.DateTimeFormat("en", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(todo.completed_at!))
      )
      rerender(card({ ...todo, status: "unclaimed" }, list))
      expect(screen.queryByText("Completed at")).not.toBeInTheDocument()
    }
  )
  it.each([undefined, null, "invalid"])(
    "shows unknown time without using the last edit (%s)",
    (completed_at) => {
      const { container } = render(card({ ...todo, completed_at }, true))
      expect(screen.getByText("Completed at")).toBeVisible()
      expect(screen.getByText("—")).toBeVisible()
      expect(
        container.querySelector(`time[datetime="${todo.updated_at}"]`)
      ).toBeNull()
    }
  )
})
