import { describe, expect, it } from "vitest"
import {
  groupTodos,
  todoConversationText,
} from "@/components/todos/board-columns"
import { reconcileTodoState } from "@/contexts/todos-view-context"
import type { Todo, TodoState } from "@/lib/todos"
import {
  consumePendingTodoDraft,
  requestCreateTodo,
} from "@/lib/todo-compose-events"
import { source } from "./contract-source"

const task = (
  id: string,
  status: Todo["status"],
  assignee_id: string | null
): Todo => ({
  id,
  status,
  assignee_id,
  title: id,
  content: "Fix customer export",
  creator_id: "alice",
  revision: 1,
  source_url: null,
  created_at: "2026-10-14T00:00:00Z",
  updated_at: "2026-10-14T00:00:00Z",
})

const state = (
  mode: TodoState["mode"],
  id: string | null,
  todos: Todo[]
): TodoState => ({
  mode,
  active_team_id: id,
  todos,
  teams: [],
  members: [],
  self_id: "alice",
  team_code: null,
  public_url: null,
})

describe("MaxCode: independent personal and team todos", () => {
  it("places every task once, separating my claims from other members' claims", () => {
    const tasks = [
      task("available", "unclaimed", null),
      task("mine", "claimed", "alice"),
      task("other", "claimed", "bob"),
      task("finished", "completed", "alice"),
    ]
    const columns = groupTodos(tasks, "alice")
    expect(columns.unclaimed.map((t) => t.id)).toEqual(["available"])
    expect(columns.mine.map((t) => t.id)).toEqual(["mine"])
    expect(columns.claimed.map((t) => t.id)).toEqual(["other"])
    expect(columns.completed.map((t) => t.id)).toEqual(["finished"])
    expect(Object.values(columns).flat()).toHaveLength(tasks.length)
    expect(groupTodos(tasks, "bob").mine.map((t) => t.id)).toEqual(["other"])
  })

  it("never lends personal or another team's cached data to an offline team", () => {
    const offline = {
      ...state("team", "team-b", []),
      connection_error: "Host offline",
    }
    expect(
      reconcileTodoState(
        state("personal", null, [task("private", "unclaimed", null)]),
        offline
      ).todos
    ).toEqual([])
    expect(
      reconcileTodoState(
        state("team", "team-a", [task("a", "unclaimed", null)]),
        offline
      ).todos
    ).toEqual([])
    expect(
      reconcileTodoState(
        state("team", "team-b", [task("cached", "unclaimed", null)]),
        offline
      ).todos.map((t) => t.id)
    ).toEqual(["cached"])
  })

  it("carries todo content and its shared conversation into an unsent draft", () => {
    const todo = {
      ...task("source", "unclaimed", null),
      source_url: "https://team.example/share#1234",
    }
    expect(todoConversationText(todo)).toBe(
      "Fix customer export\n\nhttps://team.example/share#1234"
    )
    const todoChat = source("src/components/todos/use-new-chat-from-todo.ts")
    expect(todoChat).toContain("saveMessageInputDraft(")
    expect(todoChat).toContain("freshDraft: true")
    expect(todoChat).toContain('setRoute("conversations")')
  })

  it("retains completed cache only for the identical scope, page and search", () => {
    const previous = {
      ...state("team", "team-b", [
        task("open", "unclaimed", null),
        task("done-page-two", "completed", "alice"),
      ]),
      completed_pagination: { page: 2, page_size: 20, total: 45, search: "" },
    }
    const offline = {
      ...state("team", "team-b", []),
      connection_error: "Host offline",
      completed_pagination: { page: 2, page_size: 20, total: 0, search: "" },
    }
    expect(reconcileTodoState(previous, offline).todos).toEqual(previous.todos)
    expect(reconcileTodoState(previous, offline).completed_pagination).toEqual(
      previous.completed_pagination
    )
    for (const query of [
      { ...offline.completed_pagination, page: 3 },
      { ...offline.completed_pagination, search: "different" },
    ]) {
      expect(
        reconcileTodoState(previous, {
          ...offline,
          completed_pagination: query,
        }).todos.map((todo) => todo.id)
      ).toEqual(["open"])
    }
  })

  it("preserves conversation handoffs until the new todo editor mounts", () => {
    consumePendingTodoDraft()
    requestCreateTodo({
      text: "Review the proposal",
      conversationId: 42,
      shareOptions: {
        rounds: [1],
        includeTools: false,
        includeThinking: false,
      },
    })
    expect(consumePendingTodoDraft()).toEqual({
      text: "Review the proposal",
      conversationId: 42,
      shareOptions: {
        rounds: [1],
        includeTools: false,
        includeThinking: false,
      },
    })
    expect(consumePendingTodoDraft()).toBeNull()
  })

  it("registers only the independent board and provider in the product", () => {
    const routes = source("src/components/workbench/workbench-content.tsx")
    expect(routes).toContain("tasks: TodosPage")
    expect(routes).not.toContain("@/components/tasks/")
    const layout = source("src/app/workspace/layout.tsx")
    expect(layout).toContain("<TodosViewProvider>")
    expect(layout).not.toContain("TasksViewProvider")
    expect(source("src/components/forge/forge-issue-row.tsx")).toContain(
      "showLegacyTasks = false"
    )
    expect(
      source("src/components/forge/forge-issue-detail-sheet.tsx")
    ).toContain("showLegacyTasks = false")
  })
})
