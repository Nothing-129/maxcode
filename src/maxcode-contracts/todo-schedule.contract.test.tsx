import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import en from "@/i18n/messages/en.json"
import type { Todo } from "@/lib/todos"
import {
  matchesTodoSchedule,
  todoOverdue,
  todoToday,
} from "@/lib/todo-schedule"
import { TodoEditorDialog } from "@/components/todos/todo-editor-dialog"
import { TodoSchedule } from "@/components/todos/todo-card"

vi.mock("@/components/todos/use-new-chat-from-todo", () => ({
  useNewChatFromTodo: () => vi.fn(),
}))
const item: Todo = {
  id: "schedule",
  title: "Release",
  content: "Check packaging",
  status: "claimed",
  assignee_id: "self",
  creator_id: "self",
  revision: 3,
  source_url: null,
  created_at: "2026-10-15",
  updated_at: "2026-10-15",
  due_date: "2026-10-14",
  priority: "urgent",
}
function wrap(node: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>
  )
}

describe("MaxCode: optional due dates and priority", () => {
  it("uses local calendar dates and never flags a completed task overdue", () => {
    expect(todoToday(new Date(2026, 9, 15, 0, 1))).toBe("2026-10-15")
    expect(todoOverdue(item, "2026-10-15")).toBe(true)
    expect(todoOverdue({ ...item, due_date: "2026-10-15" }, "2026-10-15")).toBe(
      false
    )
    expect(todoOverdue({ ...item, status: "completed" }, "2026-10-15")).toBe(
      false
    )
    expect(matchesTodoSchedule(item, "urgent")).toBe(true)
    expect(matchesTodoSchedule(item, "today", "2026-10-15")).toBe(false)
    expect(matchesTodoSchedule(item, "overdue", "2026-10-15")).toBe(true)
    expect(
      matchesTodoSchedule(
        { ...item, due_date: null, priority: null },
        "overdue"
      )
    ).toBe(false)
  })
  it("saves both fields with the task revision and supports clearing them", async () => {
    const user = userEvent.setup()
    const save = vi.fn().mockResolvedValue(undefined)
    render(
      wrap(
        <TodoEditorDialog
          todo={item}
          draft={null}
          members={[]}
          disabled={false}
          onClose={vi.fn()}
          onSubmit={save}
        />
      )
    )
    const due = screen.getByLabelText(en.Todos.dueDate)
    expect(due).toHaveValue("2026-10-14")
    fireEvent.change(due, { target: { value: "2026-10-20" } })
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "update",
          due_date: "2026-10-20",
          priority: "urgent",
          revision: 3,
        })
      )
    )
    fireEvent.change(due, { target: { value: "" } })
    await user.click(screen.getByLabelText(en.Todos.priority))
    await user.click(screen.getByRole("option", { name: "No priority" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(save).toHaveBeenLastCalledWith(
        expect.objectContaining({ due_date: null, priority: null })
      )
    )
  })
  it("shows priority and keeps completed dates without an overdue badge", () => {
    render(wrap(<TodoSchedule todo={{ ...item, status: "completed" }} />))
    expect(screen.getByText("Urgent")).toBeInTheDocument()
    expect(screen.getByText("Due · 2026-10-14")).toBeInTheDocument()
    expect(screen.queryByText(/Overdue/)).not.toBeInTheDocument()
  })
})
