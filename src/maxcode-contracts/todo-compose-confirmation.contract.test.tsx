import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TurnStats } from "@/components/message/turn-stats"
import { TodoComposeDialog } from "@/components/todos/todo-compose-dialog"
import { TodosViewProvider } from "@/contexts/todos-view-context"
import { todoCall, type TodoState } from "@/lib/todos"
import {
  consumePendingTodoDraft,
  requestCreateTodo,
} from "@/lib/todo-compose-events"
import en from "@/i18n/messages/en.json"

const setRoute = vi.hoisted(() => vi.fn())
vi.mock("@/contexts/workbench-route-context", () => ({
  useOptionalWorkbenchRoute: () => ({ setRoute }),
}))
vi.mock("@/components/message/use-new-chat-from-message", () => ({
  useNewChatFromMessage: () => () => {},
}))
vi.mock("@/lib/todos", async (original) => ({
  ...(await original<typeof import("@/lib/todos")>()),
  todoCall: vi.fn(),
}))
const state: TodoState = {
  mode: "personal",
  active_team_id: null,
  teams: [],
  self_id: "personal",
  members: [],
  todos: [],
  team_code: null,
  public_url: null,
}
const content =
  "## Release\n\nCheck [spec](https://example.com) and C:\\tools\\app.ts"
function mount() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TodosViewProvider>
        <div data-testid="current-conversation">Current conversation</div>
        <TurnStats copyText={content} isResponseComplete />
        <TodoComposeDialog />
      </TodosViewProvider>
    </NextIntlClientProvider>
  )
}
function creates() {
  return vi.mocked(todoCall).mock.calls.filter(([r]) => r.action === "create")
}
beforeEach(() => {
  vi.clearAllMocks()
  consumePendingTodoDraft()
  vi.mocked(todoCall).mockResolvedValue(state)
})

describe("MaxCode: one-click todos require editor confirmation in place", () => {
  it("prefills the message without navigation or creation, and cancel discards it", async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByLabelText(en.Todos.addMessage))
    expect(screen.getByRole("dialog", { name: "New todo" })).toBeInTheDocument()
    expect(
      screen.queryByText(en.Folder.conversationCard.shareScope)
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText("Todo content")).toHaveValue(content)
    expect(screen.getByTestId("current-conversation")).toBeInTheDocument()
    expect(creates()).toHaveLength(0)
    expect(setRoute).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(creates()).toHaveLength(0)
    await user.click(screen.getByLabelText(en.Todos.addMessage))
    expect(screen.getByLabelText("Todo content")).toHaveValue(content)
  })

  it("creates exactly once only after the user edits and saves the draft", async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByLabelText(en.Todos.addMessage))
    expect(creates()).toHaveLength(0)
    await user.clear(screen.getByLabelText("Todo content"))
    await user.type(screen.getByLabelText("Todo content"), "Confirmed content")
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(creates()).toHaveLength(1)
    expect(creates()[0][0]).toEqual(
      expect.objectContaining({
        action: "create",
        content: "Confirmed content",
      })
    )
    expect(setRoute).not.toHaveBeenCalled()
  })

  it("prefills the captured conversation title and body reference but waits for confirmation", async () => {
    const user = userEvent.setup()
    mount()
    act(() =>
      requestCreateTodo({
        title: "Release planning",
        text: "Release planning\n\nSee conversation: https://share.example.com/share#conversation",
        conversationId: 42,
        shareOptions: { includeTools: false },
      })
    )
    expect(screen.getByLabelText("Todo content")).toHaveValue(
      "Release planning\n\nSee conversation: https://share.example.com/share#conversation"
    )
    expect(screen.getByLabelText("Title (optional)")).toHaveValue(
      "Release planning"
    )
    expect(creates()).toHaveLength(0)
    await waitFor(() =>
      expect(screen.getByLabelText("Todo content")).toBeEnabled()
    )
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(creates()).toHaveLength(1))
    expect(creates()[0][0]).toEqual(
      expect.objectContaining({
        action: "create",
        title: "Release planning",
        content:
          "Release planning\n\nSee conversation: https://share.example.com/share#conversation",
        conversation_id: 42,
        share_options: { includeTools: false },
      })
    )
    expect(setRoute).not.toHaveBeenCalled()
  })
})
