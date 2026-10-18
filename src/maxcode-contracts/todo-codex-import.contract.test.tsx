import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import messages from "@/i18n/messages/en.json"
import { TodoImportConversationButton } from "@/components/todos/todo-import-conversation-button"
import { todoImportCodexSession, type Todo } from "@/lib/todos"

const h = vi.hoisted(() => ({
  state: {
    mode: "team",
    active_team_id: "team-a",
    connection_error: null as string | null,
  },
  openTab: vi.fn(),
  setRoute: vi.fn(),
  refreshConversations: vi.fn().mockResolvedValue(undefined),
  allFolders: [
    { id: 7, path: "/local/project", name: "Project", kind: "regular" },
  ],
}))

vi.mock("@/lib/todos", () => ({ todoImportCodexSession: vi.fn() }))
vi.mock("@/contexts/todos-view-context", () => ({
  useOptionalTodosView: () => ({ state: h.state }),
}))
vi.mock("@/contexts/workbench-route-context", () => ({
  useOptionalWorkbenchRoute: () => ({ setRoute: h.setRoute }),
}))
vi.mock("@/stores/app-workspace-store", () => ({
  useAppWorkspaceStore: Object.assign(
    (selector: (state: typeof h) => unknown) => selector(h),
    { getState: () => h }
  ),
}))
vi.mock("@/stores/tab-store", () => ({ useTabStore: { getState: () => h } }))
vi.mock("@/components/layout/workspace-folder-dialog", () => ({
  WorkspaceFolderDialog: () => null,
}))

const todo: Todo = {
  id: "task-one",
  title: "Continue work",
  content: "Task",
  status: "claimed",
  assignee_id: "me",
  creator_id: "sender",
  revision: 1,
  source_url: "https://team.example/share#abc",
  codex_import_available: true,
  created_at: "2026-10-18T00:00:00Z",
  updated_at: "2026-10-18T00:00:00Z",
}

function view(
  props: Partial<React.ComponentProps<typeof TodoImportConversationButton>> = {}
) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <TodoImportConversationButton todo={todo} {...props} />
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.state = { mode: "team", active_team_id: "team-a", connection_error: null }
})
afterEach(cleanup)

it("only offers import for todos with native session data", () => {
  const result = render(
    view({ todo: { ...todo, codex_import_available: false } })
  )
  expect(
    screen.queryByRole("button", { name: "Import and continue" })
  ).toBeNull()
  result.rerender(view())
  expect(
    screen.getByRole("button", { name: "Import and continue" })
  ).toBeEnabled()
})

it("captures the todo scope, requires a project and opens the imported native conversation once", async () => {
  let resolve!: (
    value: Awaited<ReturnType<typeof todoImportCodexSession>>
  ) => void
  vi.mocked(todoImportCodexSession).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  render(view())
  fireEvent.click(screen.getByRole("button", { name: "Import and continue" }))
  const confirm = screen.getByRole("button", { name: "Import and open" })
  expect(confirm).toBeDisabled()
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "7" } })
  h.state.active_team_id = "team-b"
  fireEvent.click(confirm)
  fireEvent.click(screen.getByRole("button", { name: "Importing…" }))
  expect(todoImportCodexSession).toHaveBeenCalledTimes(1)
  expect(todoImportCodexSession).toHaveBeenCalledWith({
    origin: { scope_id: "team-a", todo_id: todo.id },
    folder_id: 7,
  })
  expect(h.openTab).not.toHaveBeenCalled()
  await act(async () =>
    resolve({
      id: 91,
      folder_id: 7,
      agent_type: "codex",
      title: "Imported",
    } as Awaited<ReturnType<typeof todoImportCodexSession>>)
  )
  await waitFor(() =>
    expect(h.openTab).toHaveBeenCalledWith(7, 91, "codex", true, "Imported")
  )
  expect(h.refreshConversations).toHaveBeenCalledOnce()
  expect(h.setRoute).toHaveBeenCalledWith("conversations")
})

it("uses an explicit source origin and leaves failed imports retryable", async () => {
  vi.mocked(todoImportCodexSession).mockRejectedValue(
    new Error("Team is offline")
  )
  render(view({ origin: { scope_id: "source-team", todo_id: todo.id } }))
  fireEvent.click(screen.getByRole("button", { name: "Import and continue" }))
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "7" } })
  fireEvent.click(screen.getByRole("button", { name: "Import and open" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Team is offline")
  expect(todoImportCodexSession).toHaveBeenCalledWith({
    origin: { scope_id: "source-team", todo_id: todo.id },
    folder_id: 7,
  })
  expect(screen.getByRole("button", { name: "Import and open" })).toBeEnabled()
  expect(h.openTab).not.toHaveBeenCalled()
})
