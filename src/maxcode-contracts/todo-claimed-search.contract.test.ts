import { expect, it, vi } from "vitest"
import {
  todoSearch,
  type TodoSearchRequest,
  type TodoSummary,
} from "@/lib/todos"

const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock("@/lib/transport", () => ({ getTransport: () => ({ call }) }))

it("paginates eligible tasks across all legacy host pages and keeps the member scope", async () => {
  const rows: TodoSummary[] = Array.from({ length: 105 }, (_, i) => ({
    id: String(i),
    title: "Match",
    status: i >= 100 ? "claimed" : "completed",
    assignee_id: i === 100 ? "someone-else" : "me",
  }))
  call.mockImplementation(async (_, request: TodoSearchRequest) => {
    const page = request.page!
    const size = request.page_size!
    return {
      scope_id: request.scope_id,
      self_id: "me",
      members: [],
      todos: rows.slice((page - 1) * size, page * size),
      pagination: {
        page,
        page_size: size,
        total: rows.length,
        search: "Match",
      },
    }
  })
  const result = await todoSearch({
    scope_id: "team-a",
    search: "Match",
    only_mine: true,
    claimed_only: true,
    page: 2,
    page_size: 2,
  })
  expect(result.todos.map((todo) => todo.id)).toEqual(["103", "104"])
  expect(result.pagination).toMatchObject({ page: 2, total: 4 })
})
