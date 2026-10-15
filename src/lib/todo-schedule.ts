import type { Todo, TodoScheduleFilter } from "./todos"

/** Date-only deadlines use the viewer's local calendar, including DST days. */
export function todoToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

export function todoOverdue(todo: Todo, today = todoToday()): boolean {
  return todo.status !== "completed" && !!todo.due_date && todo.due_date < today
}

export function matchesTodoSchedule(
  todo: Todo,
  filter: TodoScheduleFilter,
  today = todoToday()
): boolean {
  switch (filter) {
    case "today":
      return todo.due_date === today
    case "overdue":
      return todoOverdue(todo, today)
    case "urgent":
      return todo.priority === "urgent"
    default:
      return true
  }
}
