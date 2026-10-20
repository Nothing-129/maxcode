import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { subscribe } from "@/lib/platform"
import { todoCall, type TodoState } from "@/lib/todos"
import { TodosViewProvider, useTodosView } from "@/contexts/todos-view-context"

vi.mock("@/lib/platform", () => ({ subscribe: vi.fn() }))
vi.mock("@/lib/todos", async (original) => ({
  ...(await original<typeof import("@/lib/todos")>()),
  todoCall: vi.fn(),
}))

afterEach(() => vi.resetAllMocks())

it("refreshes the visible todo board after an MCP mutation and unsubscribes", async () => {
  const unsubscribe = vi.fn()
  let changed: (() => void) | undefined
  vi.mocked(subscribe).mockImplementation(async (event, listener) => {
    if (event === "todos://changed") changed = () => listener({})
    return unsubscribe
  })
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
  vi.mocked(todoCall).mockResolvedValue(state)
  const { result, unmount } = renderHook(() => useTodosView(), {
    wrapper: TodosViewProvider,
  })
  await waitFor(() => expect(result.current.loading).toBe(false))
  await waitFor(() => expect(changed).toBeDefined())
  const before = vi.mocked(todoCall).mock.calls.length
  await act(async () => changed?.())
  await waitFor(() =>
    expect(vi.mocked(todoCall).mock.calls.length).toBeGreaterThan(before)
  )
  unmount()
  expect(unsubscribe).toHaveBeenCalledOnce()
  const after = vi.mocked(todoCall).mock.calls.length
  await act(async () => changed?.())
  expect(vi.mocked(todoCall).mock.calls.length).toBe(after)
})
