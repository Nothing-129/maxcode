import type { TodoState } from "@/lib/todos"

export type Todo = TodoState["todos"][number]
export type TodoMember = TodoState["members"][number]
export type TodoColumn =
  | "unclaimed"
  | "claimed"
  | "mine"
  | "pending_verification"
  | "completed"

export const TODO_COLUMNS: TodoColumn[] = [
  "unclaimed",
  "claimed",
  "mine",
  "pending_verification",
  "completed",
]

export const TODO_COLUMN_LABELS = {
  unclaimed: "colUnclaimed",
  claimed: "colClaimed",
  mine: "colMine",
  pending_verification: "colPendingVerification",
  completed: "colCompleted",
} as const

export function todoColumn(todo: Todo, selfId: string | null): TodoColumn {
  if (todo.status === "pending_verification") return "pending_verification"
  if (todo.status === "completed") return "completed"
  if (!todo.assignee_id || todo.status === "unclaimed") return "unclaimed"
  return selfId !== null && todo.assignee_id === selfId ? "mine" : "claimed"
}

export function groupTodos(todos: Todo[], selfId: string | null) {
  const result: Record<TodoColumn, Todo[]> = {
    unclaimed: [],
    claimed: [],
    mine: [],
    pending_verification: [],
    completed: [],
  }
  for (const todo of todos) result[todoColumn(todo, selfId)].push(todo)
  return result
}

export function todoConversationText(todo: Todo): string {
  return [todo.content, todo.source_url].filter(Boolean).join("\n\n")
}
