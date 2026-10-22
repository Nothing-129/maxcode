import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TodosPage } from "@/components/todos/todos-page"
import { TodoSourceDetailDialog } from "@/components/todos/todo-source-detail-dialog"
import { TodosViewProvider } from "@/contexts/todos-view-context"
import messages from "@/i18n/messages/en.json"
import {
  todoCall,
  todoOriginCall,
  type Todo,
  type TodoState,
} from "@/lib/todos"

vi.mock("@/lib/todos", async (original) => ({
  ...(await original<typeof import("@/lib/todos")>()),
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

const origin = { scope_id: "personal", todo_id: "todo" }
let todo: Todo
let state: TodoState

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  todo = {
    id: "todo",
    title: "Fix ASR",
    content: "ASR details",
    status: "claimed",
    assignee_id: "me",
    creator_id: "me",
    revision: 1,
    source_url: null,
    created_at: "2026-10-16T00:00:00Z",
    updated_at: "2026-10-16T00:00:00Z",
  }
  state = {
    mode: "personal",
    active_team_id: null,
    teams: [],
    self_id: "me",
    members: [{ id: "me", name: "Alex", avatar: "" }],
    todos: [todo],
    team_code: null,
    public_url: null,
  }
  vi.mocked(todoCall).mockImplementation(async () => state)
  vi.mocked(todoOriginCall).mockImplementation(async () => ({
    origin,
    scope_key: "personal",
    scope_name: "Personal",
    mode: "personal",
    self_id: "me",
    members: state.members,
    todo,
  }))
})

async function open(entry: "board" | "source") {
  const onClose = vi.fn()
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TodosViewProvider>
        {entry === "board" ? (
          <TodosPage />
        ) : (
          <TodoSourceDetailDialog origin={origin} onClose={onClose} />
        )}
      </TodosViewProvider>
    </NextIntlClientProvider>
  )
  if (entry === "board") {
    await userEvent.setup().click(await screen.findByText("Fix ASR"))
  }
  const dialog = await screen.findByRole("dialog")
  await within(dialog).findByText("ASR details")
  return { dialog, onClose }
}

describe.each(["board", "source"] as const)(
  "todo completion closes %s details",
  (entry) => {
    it.each([true, false])(
      "waits for persistence and closes only on success (%s)",
      async (success) => {
        const { dialog, onClose } = await open(entry)
        let finish!: () => void
        const pending = new Promise<void>((resolve, reject) => {
          finish = () =>
            success ? resolve() : reject(new Error("Host offline"))
        })
        if (entry === "board") {
          const normal = vi.mocked(todoCall).getMockImplementation()!
          vi.mocked(todoCall).mockImplementation(async (request) => {
            if (request.action === "complete") await pending
            return normal(request)
          })
        } else {
          const normal = vi.mocked(todoOriginCall).getMockImplementation()!
          vi.mocked(todoOriginCall).mockImplementation(async (request) => {
            if (request.action === "complete") await pending
            return normal(request)
          })
        }
        await userEvent.setup().click(
          within(dialog).getByRole("button", {
            name: messages.Todos.complete,
          })
        )
        expect(dialog).toBeInTheDocument()
        expect(onClose).not.toHaveBeenCalled()
        await act(async () => finish())
        if (success) {
          await waitFor(() => {
            if (entry === "board")
              expect(screen.queryByRole("dialog")).toBeNull()
            else expect(onClose).toHaveBeenCalledOnce()
          })
        } else {
          await waitFor(() =>
            expect(
              within(dialog).getByRole("button", {
                name: messages.Todos.complete,
              })
            ).toBeEnabled()
          )
          expect(dialog).toBeInTheDocument()
          expect(onClose).not.toHaveBeenCalled()
        }
      }
    )

    it.each(["unclaimed", "completed"] as const)(
      "keeps details open after acting on %s todos",
      async (status) => {
        todo.status = status
        const { dialog, onClose } = await open(entry)
        await userEvent.setup().click(
          within(dialog).getByRole("button", {
            name:
              status === "unclaimed"
                ? messages.Todos.claim
                : messages.Todos.reopen,
          })
        )
        await waitFor(() =>
          expect(
            within(dialog).getByRole("button", { name: "Edit" })
          ).toBeEnabled()
        )
        expect(dialog).toBeInTheDocument()
        expect(onClose).not.toHaveBeenCalled()
      }
    )
  }
)
