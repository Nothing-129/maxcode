import { TodoComposeDialog } from "@/components/todos/todo-compose-dialog"
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import enMessages from "@/i18n/messages/en.json"
import { TodosViewProvider } from "@/contexts/todos-view-context"
import { TodosPage } from "@/components/todos/todos-page"
import {
  consumePendingOpenTodo,
  consumePendingTodoDraft,
  requestOpenTodo,
} from "@/lib/todo-compose-events"
import {
  todoCall,
  todoOriginCall,
  type Todo,
  type TodoOrigin,
  type TodoOriginRequest,
  type TodoOriginResult,
  type TodoRequest,
  type TodoState,
} from "@/lib/todos"

vi.mock("@/lib/todos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/todos")>()),
  todoCall: vi.fn(),
  todoOriginCall: vi.fn(),
}))
vi.mock("@/components/todos/use-new-chat-from-todo", () => ({
  useNewChatFromTodo: () => vi.fn(),
}))
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

const sourceTeamId = "79fbd9742e864b1f8b3cfa88d38b2c5c"
const otherTeamId = "41d2a474801a4f00b3bdddb8a093eb50"
const sourceTodoId = "20da561085a74c658a43a162b1e2d69c"
const teamOrigin = { scope_id: sourceTeamId, todo_id: sourceTodoId }
const personalOrigin = { scope_id: "personal", todo_id: sourceTodoId }
const completedQuery = {
  completed_filter: "all",
  today: expect.any(String),
  completed_page: 1,
  completed_page_size: 20,
  completed_search: "",
}
let currentScope: string
let results: Map<string, TodoOriginResult>

function key(origin: TodoOrigin) {
  return `${origin.scope_id}:${origin.todo_id}`
}

function task(fields: Partial<Todo> = {}): Todo {
  return {
    id: sourceTodoId,
    title: "Exact source task",
    content: "Original source body",
    status: "claimed",
    assignee_id: "self",
    creator_id: "self",
    revision: 2,
    source_url: null,
    created_at: "2026-10-14T00:00:00Z",
    updated_at: "2026-10-14T00:00:00Z",
    ...fields,
  }
}

function result(
  origin: TodoOrigin,
  todo: Todo | null = task()
): TodoOriginResult {
  return {
    origin,
    scope_key:
      origin.scope_id === "personal" ? "personal" : `team:${origin.scope_id}`,
    scope_name: origin.scope_id === "personal" ? "Personal" : "Source team",
    mode: origin.scope_id === "personal" ? "personal" : "team",
    self_id: "self",
    members: [{ id: "self", name: "Alex", avatar: "" }],
    todo,
  }
}

function board(request?: TodoRequest): TodoState {
  return {
    mode: currentScope === "personal" ? "personal" : "team",
    active_team_id: currentScope === "personal" ? null : currentScope,
    teams: [
      { id: sourceTeamId, name: "Source team", is_local: false, url: null },
      { id: otherTeamId, name: "Other team", is_local: true, url: null },
    ],
    self_id: "self",
    members: [{ id: "self", name: "Alex", avatar: "" }],
    todos: [
      task({
        id: "86a56f3d74f04435b3732c817e114deb",
        title: "Visible completed page task",
        status: "completed",
      }),
    ],
    team_code: null,
    public_url: null,
    completed_pagination: {
      page: request?.completed_page ?? 1,
      page_size: 20,
      total: 41,
      search: request?.completed_search ?? "",
    },
  }
}

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <TodosViewProvider>
        <TodoComposeDialog />
        <TodosPage />
      </TodosViewProvider>
    </NextIntlClientProvider>
  )
}

async function openSource(origin: TodoOrigin = personalOrigin) {
  act(() => requestOpenTodo(origin))
  return screen.findByRole("dialog")
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  consumePendingOpenTodo()
  consumePendingTodoDraft()
  currentScope = "personal"
  results = new Map([
    [key(personalOrigin), result(personalOrigin)],
    [key(teamOrigin), result(teamOrigin)],
  ])
  vi.mocked(todoCall).mockImplementation(async (request) => {
    if (request.action === "set_mode") {
      currentScope =
        request.mode === "personal"
          ? "personal"
          : (request.team_id ?? sourceTeamId)
    }
    return board(request)
  })
  vi.mocked(todoOriginCall).mockImplementation(async (request) => {
    const source = results.get(key(request.origin))!
    if (request.action === "get") return source
    if (source.todo) {
      const next = {
        ...source,
        todo: {
          ...source.todo,
          ...(request.action === "update"
            ? {
                title: request.title!,
                content: request.content!,
                assignee_id: request.assignee_id ?? null,
              }
            : {
                status:
                  request.action === "complete"
                    ? ("completed" as const)
                    : ("unclaimed" as const),
              }),
          revision: source.todo.revision + 1,
        },
      }
      results.set(key(request.origin), next)
      return next
    }
    return source
  })
})

describe("MaxCode: source todo navigation uses its captured scope and exact task", () => {
  it("consumes a request queued before mount and switches to the captured source team", async () => {
    requestOpenTodo(teamOrigin)
    renderPage()
    const dialog = await screen.findByRole("dialog")
    await within(dialog).findByText("Original source body")
    expect(todoCall).toHaveBeenCalledWith({
      ...completedQuery,
      action: "set_mode",
      mode: "team",
      team_id: sourceTeamId,
    })
    expect(todoOriginCall).toHaveBeenCalledWith({
      origin: teamOrigin,
      action: "get",
    })
    expect(
      within(dialog).getByText("Source team · Waiting for you")
    ).toBeInTheDocument()
    expect(consumePendingOpenTodo()).toBeNull()
  })

  it("switches from another team back to the captured personal source", async () => {
    currentScope = otherTeamId
    renderPage()
    await screen.findByText("Visible completed page task")
    const dialog = await openSource()
    await within(dialog).findByText("Original source body")
    expect(todoCall).toHaveBeenCalledWith({
      ...completedQuery,
      action: "set_mode",
      mode: "personal",
    })
    expect(todoOriginCall).toHaveBeenCalledWith({
      origin: personalOrigin,
      action: "get",
    })
    expect(
      within(dialog).getByText("Personal · Waiting for you")
    ).toBeInTheDocument()
  })

  it("opens a completed source even when it is absent from the current completed page", async () => {
    results.set(
      key(personalOrigin),
      result(personalOrigin, task({ status: "completed" }))
    )
    renderPage()
    await screen.findByText("Visible completed page task")
    expect(screen.queryByText("Exact source task")).not.toBeInTheDocument()
    const dialog = await openSource()
    await within(dialog).findByRole("heading", { name: "Exact source task" })
    expect(within(dialog).getByText("Personal · Completed")).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Reopen" })).toBeEnabled()
    expect(todoCall).not.toHaveBeenCalledWith(
      expect.objectContaining({ completed_page: 2 })
    )
    expect(todoOriginCall).toHaveBeenCalledWith({
      origin: personalOrigin,
      action: "get",
    })
  })

  it("edits and completes the exact source with its captured origin and latest revision", async () => {
    requestOpenTodo(teamOrigin)
    renderPage()
    const user = userEvent.setup()
    const detail = await screen.findByRole("dialog")
    await user.click(
      await within(detail).findByRole("button", { name: "Edit" })
    )
    const content = screen.getByLabelText("Todo content")
    await user.clear(content)
    await user.type(content, "Edited exact source body")
    await user.click(screen.getByRole("button", { name: "Save" }))
    await screen.findByText("Edited exact source body")
    expect(todoOriginCall).toHaveBeenCalledWith({
      action: "update",
      origin: teamOrigin,
      title: "Exact source task",
      content: "Edited exact source body",
      due_date: null,
      priority: null,
      assignee_id: "self",
      revision: 2,
    })
    await user.click(
      screen.getByRole("button", { name: enMessages.Todos.complete })
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(todoOriginCall).toHaveBeenCalledWith({
      action: "complete",
      origin: teamOrigin,
      revision: 3,
    })
    expect(todoCall).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "update" })
    )
    expect(todoCall).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "complete" })
    )
  })

  it("shows a missing source clearly without exposing write actions", async () => {
    results.set(key(personalOrigin), result(personalOrigin, null))
    renderPage()
    const dialog = await openSource()
    await within(dialog).findByText(enMessages.Todos.todoUnavailable)
    expect(
      within(dialog).queryByRole("button", { name: "Edit" })
    ).not.toBeInTheDocument()
    expect(
      within(dialog).queryByRole("button", { name: enMessages.Todos.complete })
    ).not.toBeInTheDocument()
  })

  it("retries an offline source lookup in the same captured scope", async () => {
    vi.mocked(todoOriginCall).mockRejectedValueOnce(new Error("Host offline"))
    renderPage()
    const dialog = await openSource()
    const user = userEvent.setup()
    await within(dialog).findByText(
      "Could not complete this action: Host offline"
    )
    await user.click(
      within(dialog).getByRole("button", { name: enMessages.Todos.retry })
    )
    await within(dialog).findByText("Original source body")
    expect(todoOriginCall).toHaveBeenNthCalledWith(1, {
      origin: personalOrigin,
      action: "get",
    })
    expect(todoOriginCall).toHaveBeenNthCalledWith(2, {
      origin: personalOrigin,
      action: "get",
    })
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Edit" })).toBeEnabled()
  })

  it("ignores a slow old lookup that resolves after a successful completion", async () => {
    const stale = deferred<TodoOriginResult>()
    const normal = vi.mocked(todoOriginCall).getMockImplementation()!
    let reads = 0
    vi.mocked(todoOriginCall).mockImplementation(
      (request: TodoOriginRequest) => {
        if (request.action === "get" && ++reads === 2) return stale.promise
        return normal(request)
      }
    )
    renderPage()
    const dialog = await openSource()
    await within(dialog).findByText("Original source body")
    act(() => window.dispatchEvent(new Event("online")))
    await waitFor(() => expect(reads).toBe(2))
    const user = userEvent.setup()
    await user.click(
      within(dialog).getByRole("button", { name: enMessages.Todos.complete })
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await act(async () => {
      stale.resolve(
        result(
          personalOrigin,
          task({ title: "Stale old title", content: "Stale old body" })
        )
      )
    })
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.queryByText("Stale old title")).not.toBeInTheDocument()
    expect(screen.queryByText("Stale old body")).not.toBeInTheDocument()
  })

  it("preserves editor input on conflict until loading the latest exact source", async () => {
    const normal = vi.mocked(todoOriginCall).getMockImplementation()!
    vi.mocked(todoOriginCall).mockImplementation(async (request) => {
      if (request.action === "update") {
        results.set(
          key(personalOrigin),
          result(
            personalOrigin,
            task({
              revision: 3,
              content: "Changed on the host",
            })
          )
        )
        throw new Error("Todo revision conflict")
      }
      return normal(request)
    })
    renderPage()
    const user = userEvent.setup()
    const detail = await openSource()
    await user.click(
      await within(detail).findByRole("button", { name: "Edit" })
    )
    await user.clear(screen.getByLabelText("Todo content"))
    await user.type(
      screen.getByLabelText("Todo content"),
      "My unsaved replacement"
    )
    await user.click(screen.getByRole("button", { name: "Save" }))
    const reload = await screen.findByRole("button", {
      name: "Load latest version",
    })
    expect(screen.getByLabelText("Todo content")).toHaveValue(
      "My unsaved replacement"
    )
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
    expect(todoOriginCall).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update",
        origin: personalOrigin,
        revision: 2,
        content: "My unsaved replacement",
      })
    )
    await user.click(reload)
    expect(screen.getByLabelText("Todo content")).toHaveValue(
      "Changed on the host"
    )
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled()
    expect(
      screen.queryByRole("button", { name: "Load latest version" })
    ).not.toBeInTheDocument()
  })
})
