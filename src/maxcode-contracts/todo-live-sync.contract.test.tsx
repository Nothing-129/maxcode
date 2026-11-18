import {
  act,
  fireEvent,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import type { ReactNode } from "react"
import { afterEach, expect, it, vi } from "vitest"
import { TodoSearchActions } from "@/components/todos/todo-search-actions"
import { TodosViewProvider, useTodosView } from "@/contexts/todos-view-context"
import { useTodoConversationGroups } from "@/hooks/use-todo-conversation-groups"
import enMessages from "@/i18n/messages/en.json"
import {
  todoCall,
  todoConversationGroups,
  type Todo,
  type TodoState,
} from "@/lib/todos"

vi.mock("@/lib/platform", () => ({
  subscribe: async () => () => {},
  onTransportReconnect: () => null,
}))
vi.mock("@/lib/todos", async (original) => ({
  ...(await original<typeof import("@/lib/todos")>()),
  todoCall: vi.fn(),
  todoConversationGroups: vi.fn(),
}))

const team = { id: "team-a", name: "Team A", is_local: false, url: null }
const state: TodoState = {
  mode: "team",
  active_team_id: team.id,
  teams: [team],
  self_id: "member",
  members: [],
  todos: [],
  team_code: null,
  public_url: null,
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

it("refreshes the connected team's todos and sidebar groups from the search row", async () => {
  let todo: Todo = {
    id: "todo-a",
    title: "Original todo",
    content: "",
    status: "claimed",
    assignee_id: "member",
    creator_id: "member",
    revision: 1,
    source_url: null,
    created_at: "2026-11-18T00:00:00Z",
    updated_at: "2026-11-18T00:00:00Z",
  }
  vi.mocked(todoCall).mockImplementation(async () => ({
    ...state,
    teams: [{ ...team, is_local: true }],
    todos: [todo],
  }))
  vi.mocked(todoConversationGroups).mockImplementation(async () => ({
    scope_key: "team:team-a",
    groups: [{ todo, conversation_ids: [1] }],
  }))
  const { result } = renderHook(
    () => ({
      todoTitle: useTodosView().state?.todos[0]?.title,
      groupTitle: useTodoConversationGroups()[0]?.todo.title,
    }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <TodosViewProvider>
            <TodoSearchActions canWrite />
            {children}
          </TodosViewProvider>
        </NextIntlClientProvider>
      ),
    }
  )
  await waitFor(() =>
    expect(result.current).toEqual({
      todoTitle: "Original todo",
      groupTitle: "Original todo",
    })
  )

  todo = { ...todo, title: "Updated todo", revision: 2 }
  const refreshButton = screen.getByRole("button", { name: "Refresh todos" })
  expect(refreshButton).toBeEnabled()
  fireEvent.click(refreshButton)
  await waitFor(() =>
    expect(result.current).toEqual({
      todoTitle: "Updated todo",
      groupTitle: "Updated todo",
    })
  )
})

it("reads a remote team's state on change and reconnect, without idle polling", async () => {
  vi.useFakeTimers()
  vi.mocked(todoCall).mockImplementation(async () => ({ ...state }))
  vi.mocked(todoConversationGroups).mockResolvedValue({
    scope_key: "team:team-a",
    groups: [],
  })
  let stream!: ReadableStreamDefaultController<Uint8Array>
  const fetchEvents = vi.fn(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            stream = controller
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } }
      )
  )
  vi.stubGlobal("fetch", fetchEvents)
  renderHook(() => useTodoConversationGroups(), { wrapper: TodosViewProvider })
  await act(async () => {})
  expect(fetchEvents).toHaveBeenCalledTimes(1)

  const send = async (text: string) => {
    await act(async () => stream.enqueue(new TextEncoder().encode(text)))
  }
  await send("data: refresh\n\n")
  expect(todoCall).toHaveBeenCalledTimes(2)
  const previousGroupReads = vi.mocked(todoConversationGroups).mock.calls.length
  await send(": keep-alive\n\n")
  await act(async () => vi.advanceTimersByTimeAsync(65_000))
  expect(todoCall).toHaveBeenCalledTimes(2)
  expect(todoConversationGroups).toHaveBeenCalledTimes(previousGroupReads)

  await send("data: ref")
  expect(todoCall).toHaveBeenCalledTimes(2)
  await send("resh\n\n")
  expect(todoCall).toHaveBeenCalledTimes(3)
  expect(todoConversationGroups).toHaveBeenCalledTimes(previousGroupReads + 1)

  await act(async () => stream.close())
  await act(async () => vi.advanceTimersByTimeAsync(2_000))
  expect(fetchEvents).toHaveBeenCalledTimes(2)
  const previousReads = vi.mocked(todoCall).mock.calls.length
  await send("data: refresh\n\n")
  expect(todoCall).toHaveBeenCalledTimes(previousReads + 1)
})

it("uses low-frequency refresh while an older team host has no change stream", async () => {
  vi.useFakeTimers()
  vi.mocked(todoCall).mockResolvedValue(state)
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 404 }))
  )
  renderHook(() => useTodosView(), { wrapper: TodosViewProvider })
  await act(async () => {})
  const previousReads = vi.mocked(todoCall).mock.calls.length
  await act(async () => vi.advanceTimersByTimeAsync(59_000))
  expect(todoCall).toHaveBeenCalledTimes(previousReads)
  await act(async () => vi.advanceTimersByTimeAsync(1_000))
  expect(todoCall).toHaveBeenCalledTimes(previousReads + 1)
})

it("keeps personal todos idle between local notifications", async () => {
  vi.useFakeTimers()
  vi.mocked(todoCall).mockResolvedValue({
    ...state,
    mode: "personal",
    active_team_id: null,
  })
  const fetchEvents = vi.fn()
  vi.stubGlobal("fetch", fetchEvents)
  renderHook(() => useTodosView(), { wrapper: TodosViewProvider })
  await act(async () => vi.advanceTimersByTimeAsync(60_000))
  expect(todoCall).toHaveBeenCalledTimes(1)
  expect(fetchEvents).not.toHaveBeenCalled()
})
