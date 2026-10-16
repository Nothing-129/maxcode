import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import en from "@/i18n/messages/en.json"
import { TodoCard, TodoCreationInfo } from "@/components/todos/todo-card"
import { TodosPage } from "@/components/todos/todos-page"
import { TodoSourceDetailDialog } from "@/components/todos/todo-source-detail-dialog"
import type { Todo, TodoState } from "@/lib/todos"

vi.mock("@/components/todos/use-new-chat-from-todo", () => ({
  useNewChatFromTodo: () => vi.fn(),
}))
vi.mock("@/contexts/todos-view-context", () => ({
  useTodosView: () => ({
    state,
    viewMode: "board",
    setCompletedSearch: vi.fn(),
    busy: false,
    error: null,
    mutate: vi.fn(),
    refetch: vi.fn(),
  }),
  useOptionalTodosView: () => ({ state }),
}))
vi.mock("@/lib/todos", async (original) => ({
  ...(await original<typeof import("@/lib/todos")>()),
  todoOriginCall: vi.fn(async () => ({
    todo,
    members: state.members,
    mode: "personal",
    self_id: "assignee",
  })),
}))
const todo: Todo = {
  id: "metadata",
  title: "Review release",
  content: "Release notes",
  creator_id: "creator",
  assignee_id: "assignee",
  status: "claimed",
  revision: 1,
  source_url: null,
  created_at: "2026-10-16T02:30:00Z",
  updated_at: "2026-10-16T05:00:00Z",
}
const state: TodoState = {
  mode: "personal",
  active_team_id: null,
  teams: [],
  self_id: "assignee",
  members: [
    { id: "creator", name: "Alex Creator", avatar: "" },
    { id: "assignee", name: "Sam Assignee", avatar: "" },
  ],
  todos: [todo],
  team_code: null,
  public_url: null,
}
function wrap(children: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" timeZone="Asia/Shanghai" messages={en}>
      {children}
    </NextIntlClientProvider>
  )
}
function expectMetadata(container: HTMLElement) {
  const scope = within(container)
  expect(scope.getByText("Created by")).toBeInTheDocument()
  expect(scope.getByText("Alex Creator")).toBeInTheDocument()
  expect(scope.getByText("Created at")).toBeInTheDocument()
  const time = container.querySelector("time")
  expect(time).toHaveAttribute("datetime", todo.created_at)
  expect(time?.textContent).toBe(
    new Intl.DateTimeFormat("en", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(todo.created_at))
  )
}

describe("MaxCode todo creation metadata", () => {
  it.each([false, true])(
    "shows creator separately from assignee (list=%s)",
    (list) => {
      const { container } = render(
        wrap(
          <TodoCard
            todo={todo}
            creator={state.members[0]}
            member={state.members[1]}
            selfId="assignee"
            disabled={false}
            list={list}
            onOpen={vi.fn()}
            onEdit={vi.fn()}
            onDelete={vi.fn()}
            onAction={vi.fn()}
          />
        )
      )
      expectMetadata(container)
      expect(screen.getByText("Sam Assignee")).toBeInTheDocument()
    }
  )
  it("retains the creator ID when the member is unavailable and handles invalid dates", () => {
    render(wrap(<TodoCreationInfo todo={{ ...todo, created_at: "invalid" }} />))
    expect(screen.getByText("creator")).toBeInTheDocument()
    expect(screen.getByText("invalid")).toBeInTheDocument()
  })
  it("includes creation metadata in the board detail", async () => {
    const user = userEvent.setup()
    render(wrap(<TodosPage />))
    await user.click(screen.getByRole("button", { name: /Review release/ }))
    expectMetadata(screen.getByRole("dialog"))
  })
  it("resolves the creator in source details independently of the current scope", async () => {
    render(
      wrap(
        <TodoSourceDetailDialog
          origin={{ scope_id: "personal", todo_id: todo.id }}
          onClose={vi.fn()}
        />
      )
    )
    await screen.findByText("Alex Creator")
    expectMetadata(screen.getByRole("dialog"))
  })
})
