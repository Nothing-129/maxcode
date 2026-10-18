import { TodoComposeDialog } from "@/components/todos/todo-compose-dialog"
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import enMessages from "@/i18n/messages/en.json"
import { TodosViewProvider } from "@/contexts/todos-view-context"
import {
  todoCall,
  type Todo,
  type TodoRequest,
  type TodoState,
} from "@/lib/todos"
import {
  consumePendingTodoDraft,
  requestCreateTodo,
} from "@/lib/todo-compose-events"
import { TodosPage } from "./todos-page"

const { newChat } = vi.hoisted(() => ({ newChat: vi.fn() }))

vi.mock("@/lib/todos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/todos")>()),
  todoCall: vi.fn(),
}))
vi.mock("./use-new-chat-from-todo", () => ({
  useNewChatFromTodo: (getText: () => string) => () => newChat(getText()),
}))
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({
    children,
    className,
  }: {
    children: React.ReactNode
    className?: string
  }) => <div className={className}>{children}</div>,
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

function state(fields: Partial<TodoState> = {}): TodoState {
  return {
    mode: "personal",
    active_team_id: null,
    teams: [],
    self_id: "me",
    members: [
      { id: "me", name: "Alex", avatar: "" },
      { id: "other", name: "Sam", avatar: "" },
    ],
    todos: [],
    team_code: null,
    public_url: null,
    ...fields,
  }
}

let serverState: TodoState
const completedQuery = {
  completed_filter: "all",
  today: expect.any(String),
  completed_page: 1,
  completed_page_size: 20,
  completed_search: "",
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

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  consumePendingTodoDraft()
  serverState = state()
  vi.mocked(todoCall).mockImplementation(async (request: TodoRequest) => {
    if (request.action === "create") {
      serverState = {
        ...serverState,
        todos: [
          ...serverState.todos,
          todo("new", {
            title: request.title || "Generated title",
            content: request.content,
            assignee_id: request.assignee_id,
            status: request.assignee_id ? "claimed" : "unclaimed",
          }),
        ],
      }
    } else if (request.action === "claim" || request.action === "complete") {
      serverState = {
        ...serverState,
        todos: serverState.todos.map((item) =>
          item.id === request.id
            ? {
                ...item,
                status: request.action === "claim" ? "claimed" : "completed",
                assignee_id:
                  request.action === "claim"
                    ? serverState.self_id
                    : item.assignee_id,
                revision: item.revision + 1,
              }
            : item
        ),
      }
    }
    return serverState
  })
})

describe("independent todo board", () => {
  it("puts each task in exactly one column based on the current member", async () => {
    serverState = state({
      todos: [
        todo("free"),
        todo("mine", { status: "claimed", assignee_id: "me" }),
        todo("other", { status: "claimed", assignee_id: "other" }),
        todo("done", { status: "completed", assignee_id: "me" }),
      ],
    })
    renderPage()
    await screen.findByText("Todo free")
    const columns = ["Unclaimed", "Claimed", "Waiting for you", "Completed"]
    const titles = ["Todo free", "Todo other", "Todo mine", "Todo done"]
    columns.forEach((column, index) => {
      const section = screen.getByRole("region", { name: column })
      expect(within(section).getByText(titles[index])).toBeInTheDocument()
      expect(within(section).getAllByRole("article")).toHaveLength(1)
    })
    expect(screen.getAllByRole("article")).toHaveLength(4)
  })

  it("saves content without a title and lets the service generate it", async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole("button", { name: "New todo" }))
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
    expect(screen.queryByText("Model")).not.toBeInTheDocument()
    await user.type(
      screen.getByLabelText("Todo content"),
      "Review the release notes"
    )
    await user.click(screen.getByRole("button", { name: "Save" }))
    await screen.findByText("Generated title")
    expect(todoCall).toHaveBeenCalledWith({
      ...completedQuery,
      action: "create",
      due_date: null,
      priority: null,
      operation_id: expect.any(String),
      title: "",
      content: "Review the release notes",
      assignee_id: null,
    })
  })

  it("claims a task for the current member and completes it manually", async () => {
    const user = userEvent.setup()
    serverState = state({ todos: [todo("free")] })
    renderPage()
    await user.click(await screen.findByRole("button", { name: "Claim" }))
    await waitFor(() =>
      expect(
        within(
          screen.getByRole("region", { name: "Waiting for you" })
        ).getByText("Todo free")
      ).toBeInTheDocument()
    )
    expect(todoCall).toHaveBeenCalledWith({
      ...completedQuery,
      action: "claim",
      id: "free",
      revision: 1,
    })
    await user.click(screen.getByRole("button", { name: "Mark completed" }))
    await waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "Completed" })).getByText(
          "Todo free"
        )
      ).toBeInTheDocument()
    )
    expect(todoCall).toHaveBeenCalledWith({
      ...completedQuery,
      action: "complete",
      id: "free",
      revision: 2,
    })
  })

  it("preserves the creation identity and draft when a request is retried", async () => {
    const user = userEvent.setup()
    const normalCall = vi.mocked(todoCall).getMockImplementation()!
    let failed = false
    vi.mocked(todoCall).mockImplementation(async (request) => {
      if (request.action === "create" && !failed) {
        failed = true
        throw new Error("Response was interrupted")
      }
      return normalCall(request)
    })
    renderPage()
    await user.click(await screen.findByRole("button", { name: "New todo" }))
    await user.type(screen.getByLabelText("Todo content"), "Keep this draft")
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Response was interrupted"
    )
    expect(screen.getByLabelText("Todo content")).toHaveValue("Keep this draft")
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled()
    )
    await user.click(screen.getByRole("button", { name: "Save" }))
    await screen.findByText("Generated title")
    const attempts = vi
      .mocked(todoCall)
      .mock.calls.map(([request]) => request)
      .filter((request) => request.action === "create")
    expect(attempts).toHaveLength(2)
    expect(attempts[0].operation_id).toEqual(expect.any(String))
    expect(attempts[1].operation_id).toBe(attempts[0].operation_id)
  })

  it("creates request identities when native randomUUID is absent on HTTP origins", async () => {
    const user = userEvent.setup()
    const realCrypto = crypto
    vi.stubGlobal("crypto", {
      getRandomValues: realCrypto.getRandomValues.bind(realCrypto),
    })
    try {
      renderPage()
      await user.click(await screen.findByRole("button", { name: "New todo" }))
      await user.type(screen.getByLabelText("Todo content"), "Works over HTTP")
      await user.click(screen.getByRole("button", { name: "Save" }))
      await screen.findByText("Generated title")
      const create = vi
        .mocked(todoCall)
        .mock.calls.map(([request]) => request)
        .find((request) => request.action === "create")
      expect(create?.operation_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      )
      await user.click(screen.getByRole("button", { name: "Teams" }))
      await user.click(screen.getByRole("button", { name: "Create team" }))
      expect(screen.getByLabelText("Team name")).toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("keeps unsaved edits after a conflict and loads the latest revision only on request", async () => {
    const user = userEvent.setup()
    serverState = state({ todos: [todo("edit")] })
    const normalCall = vi.mocked(todoCall).getMockImplementation()!
    vi.mocked(todoCall).mockImplementation(async (request) => {
      if (request.action === "update") {
        if (request.revision === 1) {
          serverState = {
            ...serverState,
            todos: [
              todo("edit", {
                title: "Updated by Sam",
                content: "Sam’s changes",
                revision: 2,
              }),
            ],
          }
          throw new Error("Todo revision conflict")
        }
        serverState = {
          ...serverState,
          todos: [
            todo("edit", {
              title: request.title,
              content: request.content,
              revision: request.revision + 1,
            }),
          ],
        }
        return serverState
      }
      return normalCall(request)
    })
    renderPage()
    await user.click(await screen.findByRole("button", { name: /Todo edit/ }))
    await user.click(screen.getByRole("button", { name: "Edit" }))
    await user.clear(screen.getByLabelText("Todo content"))
    await user.type(screen.getByLabelText("Todo content"), "My unsaved work")
    await user.click(screen.getByRole("button", { name: "Save" }))
    const reload = await screen.findByRole("button", {
      name: "Load latest version",
    })
    expect(screen.getByLabelText("Todo content")).toHaveValue("My unsaved work")
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
    await user.click(reload)
    expect(screen.getByLabelText("Todo content")).toHaveValue("Sam’s changes")
    await user.clear(screen.getByLabelText("Todo content"))
    await user.type(screen.getByLabelText("Todo content"), "Combined solution")
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(todoCall).toHaveBeenCalledWith({
      ...completedQuery,
      action: "update",
      due_date: null,
      priority: null,
      id: "edit",
      title: "Updated by Sam",
      content: "Combined solution",
      assignee_id: null,
      revision: 2,
    })
  })

  it("keeps offline team todos read-only while allowing an unsent conversation draft", async () => {
    const user = userEvent.setup()
    serverState = state({
      mode: "team",
      active_team_id: "team",
      teams: [
        {
          id: "team",
          name: "Team",
          url: "https://team.example",
          is_local: false,
        },
      ],
      connection_error: "Host offline",
      todos: [todo("offline", { source_url: "https://team.example/s/abc" })],
    })
    renderPage()
    expect(await screen.findByRole("button", { name: "Claim" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "New todo" })).toBeDisabled()
    await user.click(
      screen.getByRole("button", { name: "Insert into a new conversation" })
    )
    expect(newChat).toHaveBeenCalledWith(
      "Content offline\n\nhttps://team.example/s/abc"
    )
    expect(
      vi
        .mocked(todoCall)
        .mock.calls.every(([request]) => request.action === "state")
    ).toBe(true)
  })

  it("carries a conversation share request through the todo editor", async () => {
    const user = userEvent.setup()
    act(() =>
      requestCreateTodo({
        text: "",
        conversationId: 42,
        shareOptions: { includeTools: false },
        includeCodexSession: true,
      })
    )
    renderPage()
    const input = await screen.findByLabelText("Todo content")
    await user.type(input, "Follow up on this conversation")
    await user.click(screen.getByRole("button", { name: "Save" }))
    await screen.findByText("Generated title")
    expect(todoCall).toHaveBeenCalledWith({
      ...completedQuery,
      action: "create",
      due_date: null,
      priority: null,
      operation_id: expect.any(String),
      title: "",
      content: "Follow up on this conversation",
      assignee_id: null,
      conversation_id: 42,
      share_options: { includeTools: false },
      include_codex_session: true,
    })
  })

  it("requires a name and raster avatar and retains the automatically opened team form on failure", async () => {
    const user = userEvent.setup({ applyAccept: false })
    const avatar = "data:image/webp;base64,AQID"
    const encodedDimensions: number[][] = []
    const close = vi.fn()
    serverState = state({ mode: "team", self_id: null, members: [] })
    const normalCall = vi.mocked(todoCall).getMockImplementation()!
    let joins = 0
    let rejectJoin: ((reason: Error) => void) | undefined
    vi.mocked(todoCall).mockImplementation(async (request) => {
      if (request.action === "join_team") {
        if (++joins === 1)
          await new Promise<never>((_, reject) => {
            rejectJoin = reject
          })
        serverState = state({
          mode: "team",
          active_team_id: "joined",
          teams: [
            {
              id: "joined",
              name: "Joined team",
              is_local: false,
              url: "https://team.example",
            },
          ],
        })
        return serverState
      }
      return normalCall(request)
    })
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 1024, height: 512, close }))
    )
    const drawing = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({
        drawImage: vi.fn(),
      } as unknown as CanvasRenderingContext2D)
    const encoding = vi
      .spyOn(HTMLCanvasElement.prototype, "toDataURL")
      .mockImplementation(function (this: HTMLCanvasElement) {
        encodedDimensions.push([this.width, this.height])
        return avatar
      })
    try {
      act(() => requestCreateTodo({ text: "Keep this conversation draft" }))
      renderPage()
      await user.click(await screen.findByRole("button", { name: "Join team" }))
      const joining = screen.getByRole("button", { name: "Join team" })
      await user.type(
        screen.getByLabelText("Team code"),
        "maxcode-team:example"
      )
      await user.type(screen.getByLabelText("Your name"), "Taylor")
      expect(joining).toBeDisabled()
      await user.upload(
        screen.getByLabelText("Upload avatar"),
        new File(["<svg/>"], "avatar.svg", { type: "image/svg+xml" })
      )
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Choose a valid PNG"
      )
      expect(joining).toBeDisabled()
      await user.upload(
        screen.getByLabelText("Upload avatar"),
        new File(["avatar"], "avatar.png", { type: "image/png" })
      )
      await waitFor(() => expect(joining).toBeEnabled())
      expect(encoding).toHaveBeenCalledWith("image/webp", 0.85)
      expect(encodedDimensions).toEqual([[256, 128]])
      expect(close).toHaveBeenCalledOnce()
      await user.click(joining)
      expect(screen.getByLabelText("Your name")).toHaveValue("Taylor")
      expect(screen.getByLabelText("Team code")).toHaveValue(
        "maxcode-team:example"
      )
      expect(joining).toBeInTheDocument()
      act(() => rejectJoin?.(new Error("Team host is unavailable")))
      await waitFor(() => expect(joining).toBeEnabled())
      expect(screen.getByLabelText("Your name")).toHaveValue("Taylor")
      expect(screen.getByLabelText("Team code")).toHaveValue(
        "maxcode-team:example"
      )
      await user.click(joining)
      await waitFor(() =>
        expect(todoCall).toHaveBeenCalledWith({
          ...completedQuery,
          action: "join_team",
          code: "maxcode-team:example",
          member_name: "Taylor",
          avatar,
        })
      )
      expect(await screen.findByLabelText("Todo content")).toHaveValue(
        "Keep this conversation draft"
      )
    } finally {
      drawing.mockRestore()
      encoding.mockRestore()
      vi.unstubAllGlobals()
    }
  })
})
