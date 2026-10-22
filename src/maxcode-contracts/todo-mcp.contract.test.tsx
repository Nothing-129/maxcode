import { readFileSync } from "node:fs"
import { resolve } from "node:path"
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

it("lets the server choose the selected scope and routes conversation requests to sharing", () => {
  const tools = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "src-tauri/src/acp/delegation/tool_schema.json"),
      "utf8"
    )
  ) as Array<{
    name: string
    description: string
    inputSchema: { required: string[]; properties: Record<string, unknown> }
  }>
  for (const name of [
    "create_todo",
    "create_todo_from_conversation",
    "list_todos",
  ]) {
    const tool = tools.find((entry) => entry.name === name)!
    expect(tool.inputSchema.required).not.toContain("scope_id")
  }
  const sharing = tools.find(
    (entry) => entry.name === "create_todo_from_conversation"
  )!
  expect(sharing.description).toContain("source_url")
  expect(sharing.description).toContain("把这个对话添加到待办")
  expect(sharing.inputSchema.properties).not.toHaveProperty("conversation_id")
  expect(sharing.inputSchema.properties).not.toHaveProperty("snapshot")
  expect(
    tools.find((entry) => entry.name === "create_todo")!.description
  ).toContain("create_todo_from_conversation")
  expect(
    tools.find((entry) => entry.name === "link_todo_to_conversation")!
      .description
  ).toContain("creates NO conversation share link")
})
