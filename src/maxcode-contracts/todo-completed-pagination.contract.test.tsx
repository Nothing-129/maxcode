import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TodosPage } from "@/components/todos/todos-page"
import { TodosChromeActions } from "@/components/todos/todos-chrome-actions"
import { TodosViewProvider } from "@/contexts/todos-view-context"
import { matchesTodoSchedule } from "@/lib/todo-schedule"
import enMessages from "@/i18n/messages/en.json"
import {
  todoCall,
  type Todo,
  type TodoRequest,
  type TodoState,
} from "@/lib/todos"

vi.mock("@/lib/todos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/todos")>()),
  todoCall: vi.fn(),
}))
vi.mock("@/components/todos/use-new-chat-from-todo", () => ({
  useNewChatFromTodo: () => vi.fn(),
}))
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

function todo(id: string, fields: Partial<Todo> = {}): Todo {
  return {
    id,
    title: `Todo ${id}`,
    content: `Content ${id}`,
    status: "unclaimed",
    assignee_id: null,
    creator_id: "me",
    revision: 1,
    source_url: null,
    created_at: "2026-10-14T00:00:00Z",
    updated_at: "2026-10-14T00:00:00Z",
    ...fields,
  }
}

let records: Todo[]

function response(request: TodoRequest): TodoState {
  const search = request.completed_search?.trim() ?? ""
  const completed = records.filter(
    (item) =>
      item.status === "completed" &&
      matchesTodoSchedule(
        item,
        request.completed_filter ?? "all",
        request.today
      ) &&
      `${item.title}\n${item.content}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase())
  )
  const pageSize = request.completed_page_size ?? 20
  const pageCount = Math.max(1, Math.ceil(completed.length / pageSize))
  const page = Math.min(request.completed_page ?? 1, pageCount)
  return {
    mode: "personal",
    active_team_id: null,
    teams: [],
    self_id: "me",
    members: [{ id: "me", name: "Alex", avatar: "" }],
    todos: [
      ...records.filter((item) => item.status !== "completed"),
      ...completed.slice((page - 1) * pageSize, page * pageSize),
    ],
    team_code: null,
    public_url: null,
    completed_pagination: {
      page,
      page_size: pageSize,
      total: completed.length,
      search,
      filter: request.completed_filter ?? "all",
      today: request.today,
    },
  }
}

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <TodosViewProvider>
        <TodosChromeActions buttonClassName="" iconClassName="" />
        <TodosPage />
      </TodosViewProvider>
    </NextIntlClientProvider>
  )
}

function completedSection() {
  return within(screen.getByRole("region", { name: "Completed" }))
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  records = [
    ...Array.from({ length: 25 }, (_, index) => todo(`open-${index + 1}`)),
    ...Array.from({ length: 45 }, (_, index) =>
      todo(`done-${index + 1}`, { status: "completed" })
    ),
  ]
  vi.mocked(todoCall).mockImplementation(async (request) => {
    if (request.action === "delete")
      records = records.filter((item) => item.id !== request.id)
    return response(request)
  })
})

describe("MaxCode: paginate completed todos only", () => {
  it("queries completed pages while keeping all unfinished tasks visible during loading", async () => {
    const user = userEvent.setup()
    let finishRead: (() => void) | undefined
    const normalCall = vi.mocked(todoCall).getMockImplementation()!
    vi.mocked(todoCall).mockImplementation(async (request) => {
      if (request.action === "state" && request.completed_page === 2)
        await new Promise<void>((resolve) => {
          finishRead = resolve
        })
      return normalCall(request)
    })
    renderPage()
    await screen.findByText("Todo done-1")
    expect(completedSection().getAllByRole("article")).toHaveLength(20)
    expect(completedSection().getByText("45", { exact: true })).toBeVisible()
    expect(completedSection().getByText("Page 1 of 3")).toBeVisible()
    expect(
      within(screen.getByRole("region", { name: "Unclaimed" })).getAllByRole(
        "article"
      )
    ).toHaveLength(25)
    expect(screen.getAllByRole("navigation")).toHaveLength(1)

    await user.click(screen.getByRole("button", { name: "Next page" }))
    expect(screen.getByLabelText("Loading completed todos")).toBeVisible()
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled()
    expect(screen.queryByText("Todo done-1")).not.toBeInTheDocument()
    expect(screen.getByText("Todo open-25")).toBeVisible()
    await waitFor(() => expect(finishRead).toBeDefined())
    act(() => finishRead?.())
    await screen.findByText("Todo done-21")
    expect(completedSection().getByText("Page 2 of 3")).toBeVisible()
    expect(screen.queryByText("Todo done-1")).not.toBeInTheDocument()
    expect(todoCall).toHaveBeenCalledWith(
      expect.objectContaining({ action: "state", completed_page: 2 })
    )
  })

  it("preserves the completed page when changing layout and excludes paging from other status filters", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("Todo done-1")
    await user.click(screen.getByRole("button", { name: "Next page" }))
    await screen.findByText("Todo done-21")
    await user.click(screen.getByRole("button", { name: "Switch to list" }))
    expect(completedSection().getByText("Page 2 of 3")).toBeVisible()
    expect(screen.getByText("Todo open-25")).toBeVisible()
    expect(completedSection().getAllByRole("article")).toHaveLength(20)

    await user.click(screen.getByRole("combobox", { name: "Filter status" }))
    await user.click(screen.getByRole("option", { name: "Unclaimed" }))
    expect(screen.getAllByRole("article")).toHaveLength(25)
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
    expect(screen.queryByText("Todo done-21")).not.toBeInTheDocument()

    await user.click(screen.getByRole("combobox", { name: "Filter status" }))
    await user.click(screen.getByRole("option", { name: "Completed" }))
    expect(completedSection().getByText("Page 2 of 3")).toBeVisible()
    expect(screen.getAllByRole("article")).toHaveLength(20)
    expect(screen.queryByText("Todo open-25")).not.toBeInTheDocument()
  })

  it("searches completed todos beyond the loaded page and resets the query to page one", async () => {
    const user = userEvent.setup()
    records = records.map((item) =>
      item.id === "done-45" || item.id === "open-25"
        ? { ...item, title: `Needle ${item.id}` }
        : item
    )
    renderPage()
    await screen.findByText("Todo done-1")
    await user.click(screen.getByRole("button", { name: "Next page" }))
    await screen.findByText("Todo done-21")
    expect(screen.queryByText("Needle done-45")).not.toBeInTheDocument()
    await user.type(
      screen.getByRole("textbox", { name: "Search todos" }),
      "Needle"
    )
    await screen.findByText("Needle done-45")
    expect(screen.getByText("Needle open-25")).toBeVisible()
    expect(screen.queryByText("Todo open-1")).not.toBeInTheDocument()
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
    expect(todoCall).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "state",
        completed_page: 1,
        completed_search: "Needle",
      })
    )
  })

  it("clears stale completed results after a search transport failure and recovers on retry", async () => {
    const user = userEvent.setup()
    records = records.map((item) =>
      item.id === "done-45" || item.id === "open-25"
        ? { ...item, title: `Needle ${item.id}` }
        : item
    )
    const normalCall = vi.mocked(todoCall).getMockImplementation()!
    let failSearch = true
    vi.mocked(todoCall).mockImplementation(async (request) => {
      if (
        request.action === "state" &&
        request.completed_search === "Needle" &&
        failSearch
      ) {
        failSearch = false
        throw new Error("Network interrupted")
      }
      return normalCall(request)
    })
    renderPage()
    await screen.findByText("Todo done-1")
    await user.type(
      screen.getByRole("textbox", { name: "Search todos" }),
      "Needle"
    )
    await screen.findByRole("alert")
    expect(screen.queryByText("Todo done-1")).not.toBeInTheDocument()
    expect(screen.queryByText("Needle done-45")).not.toBeInTheDocument()
    expect(screen.getByText("Needle open-25")).toBeVisible()
    expect(
      screen.queryByLabelText("Loading completed todos")
    ).not.toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Completed" })).toHaveAttribute(
      "aria-busy",
      "false"
    )

    await user.click(screen.getByRole("button", { name: "Reconnect" }))
    await screen.findByText("Needle done-45")
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.getByText("Needle open-25")).toBeVisible()
    const searches = vi
      .mocked(todoCall)
      .mock.calls.map(([request]) => request)
      .filter(
        (request) =>
          request.action === "state" && request.completed_search === "Needle"
      )
    expect(searches).toHaveLength(2)
    expect(searches.every((request) => request.completed_page === 1)).toBe(true)
  })

  it("refreshes the completed total and returns to the previous page after deleting the last item", async () => {
    const user = userEvent.setup()
    records = records.filter(
      (item) => item.status !== "completed" || Number(item.id.slice(5)) <= 21
    )
    renderPage()
    await screen.findByText("Todo done-1")
    await user.click(screen.getByRole("button", { name: "Next page" }))
    await screen.findByText("Todo done-21")
    await user.click(
      completedSection().getByRole("button", { name: "More actions" })
    )
    await user.click(screen.getByRole("menuitem", { name: "Delete" }))
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" })
    )
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await screen.findByText("Todo done-1")
    expect(completedSection().getAllByRole("article")).toHaveLength(20)
    expect(completedSection().getByText("20", { exact: true })).toBeVisible()
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
    expect(screen.queryByText("Todo done-21")).not.toBeInTheDocument()
    expect(screen.getByText("Todo open-25")).toBeVisible()
  })
})

it("filters completed tasks on all pages before counting and resets the page", async () => {
  const user = userEvent.setup()
  records = records.map((item) => ({
    ...item,
    priority: ["done-41", "done-42", "done-43", "open-1"].includes(item.id)
      ? "urgent"
      : null,
  }))
  renderPage()
  await screen.findByRole("region", { name: "Completed" })
  await completedSection().findByText("Todo done-1")
  await user.click(screen.getByRole("button", { name: "Next page" }))
  await completedSection().findByText("Todo done-21")
  await user.click(
    screen.getByRole("combobox", { name: enMessages.Todos.scheduleFilter })
  )
  await user.click(screen.getByRole("option", { name: "Urgent" }))
  await completedSection().findByText("Todo done-41")
  expect(completedSection().getByText("Todo done-43")).toBeInTheDocument()
  expect(completedSection().queryByText("Todo done-21")).not.toBeInTheDocument()
  expect(screen.getByText("Todo open-1")).toBeInTheDocument()
  expect(screen.queryByText("Todo open-2")).not.toBeInTheDocument()
  expect(todoCall).toHaveBeenCalledWith(
    expect.objectContaining({
      action: "state",
      completed_filter: "urgent",
      completed_page: 1,
      today: expect.any(String),
    })
  )
})
