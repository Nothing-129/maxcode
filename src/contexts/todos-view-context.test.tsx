import { act, render, renderHook, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { todoCall, type TodoRequest, type TodoState } from "@/lib/todos"
import { TodosViewProvider, useTodosView } from "./todos-view-context"

vi.mock("@/lib/todos", async (original) => ({
  ...(await original<typeof import("@/lib/todos")>()),
  todoCall: vi.fn(),
}))

function Probe() {
  const { state, loading, error } = useTodosView()
  return (
    <div role="status">
      {loading ? "Loading" : `${state?.mode}:${error ?? "ready"}`}
    </div>
  )
}

function response(request: TodoRequest, page = request.completed_page ?? 1) {
  return {
    mode: "personal",
    active_team_id: null,
    self_id: "me",
    members: [],
    teams: [],
    todos: [],
    team_code: null,
    public_url: null,
    completed_pagination: {
      page,
      page_size: 20,
      total: 45,
      search: request.completed_search ?? "",
    },
  } satisfies TodoState
}

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("TodosViewProvider remote recovery", () => {
  it("ignores stale completed page responses and keeps polling the selected page", async () => {
    vi.useFakeTimers()
    let finishSecond!: () => void
    vi.mocked(todoCall).mockImplementation(async (request) => {
      if (request.completed_page === 2)
        await new Promise<void>((resolve) => {
          finishSecond = resolve
        })
      return response(request)
    })
    const { result } = renderHook(() => useTodosView(), {
      wrapper: TodosViewProvider,
    })
    await act(async () => {})
    let secondRead!: Promise<void>
    act(() => {
      secondRead = result.current.setCompletedPage(2)
    })
    await act(async () => {
      await result.current.setCompletedPage(3)
    })
    expect(result.current.state?.completed_pagination?.page).toBe(3)
    await act(async () => {
      finishSecond()
      await secondRead
    })
    expect(result.current.state?.completed_pagination?.page).toBe(3)
    await act(async () => {
      vi.advanceTimersByTime(5_000)
    })
    expect(todoCall).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "state", completed_page: 3 })
    )
  })

  it("uses the server's clamped page after a mutation and resets on scope switches", async () => {
    vi.useFakeTimers()
    vi.mocked(todoCall).mockImplementation(async (request) =>
      response(request, request.action === "delete" ? 2 : undefined)
    )
    const { result } = renderHook(() => useTodosView(), {
      wrapper: TodosViewProvider,
    })
    await act(async () => {})
    await act(async () => {
      await result.current.setCompletedPage(3)
      await result.current.mutate({ action: "delete", id: "last", revision: 1 })
    })
    expect(result.current.state?.completed_pagination?.page).toBe(2)
    await act(async () => {
      vi.advanceTimersByTime(5_000)
    })
    expect(todoCall).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "state", completed_page: 2 })
    )
    await act(async () => {
      await result.current.setCompletedSearch("needle")
      await result.current.mutate({ action: "set_mode", mode: "team" })
    })
    expect(todoCall).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "set_mode",
        completed_page: 1,
        completed_search: "",
      })
    )
  })

  it("lets a read slower than the polling interval settle into offline state", async () => {
    vi.useFakeTimers()
    let resolve!: (state: TodoState) => void
    vi.mocked(todoCall).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    render(
      <TodosViewProvider>
        <Probe />
      </TodosViewProvider>
    )
    expect(screen.getByRole("status")).toHaveTextContent("Loading")
    await act(async () => {
      vi.advanceTimersByTime(20_000)
    })
    expect(todoCall).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolve({
        mode: "team",
        active_team_id: "hosted-team",
        self_id: "member",
        members: [],
        teams: [],
        todos: [],
        team_code: null,
        public_url: null,
        connection_error: "Host timed out",
      })
    })
    expect(screen.getByRole("status")).toHaveTextContent("team:Host timed out")
    await act(async () => {
      vi.advanceTimersByTime(5_000)
    })
    expect(todoCall).toHaveBeenCalledTimes(2)
  })
})
