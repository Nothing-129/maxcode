import { getTransport } from "./transport"
import type { ConversationShareOptions } from "./types"
import { todoContentWithConversationReference } from "./todo-conversation-reference"

export type TodoMode = "personal" | "team"
export type TodoPriority = "low" | "normal" | "high" | "urgent"
export type TodoScheduleFilter = "all" | "today" | "overdue" | "urgent"

export type TodoStatus =
  | "unclaimed"
  | "claimed"
  | "pending_verification"
  | "completed"

export interface TodoMember {
  id: string
  name: string
  avatar: string
}

export interface Todo {
  id: string
  title: string
  content: string
  status: TodoStatus
  assignee_id: string | null
  creator_id: string
  revision: number
  due_date?: string | null
  priority?: TodoPriority | null
  source_url: string | null
  codex_import_available?: boolean
  created_at: string
  updated_at: string
  completed_at?: string | null
}

export interface TodoTeam {
  id: string
  name: string
  url: string | null
  is_local: boolean
}

/** Captured when a todo opens a draft, independent of later scope switches. */
export interface TodoOrigin {
  scope_id: string
  todo_id: string
}

export interface TodoConversationGroup {
  todo: Pick<Todo, "id" | "title" | "status" | "assignee_id">
  conversation_ids: number[]
}

export type TodoSummary = Pick<Todo, "id" | "title" | "status" | "assignee_id">

export interface TodoSearchRequest {
  scope_id: string
  only_mine?: boolean
  search?: string
  page?: number
  page_size?: number
}

export interface TodoSearchResult {
  scope_id: string
  scope_key: string
  todos: TodoSummary[]
  members: TodoMember[]
  self_id: string
  pagination: { page: number; page_size: number; total: number; search: string }
}

export interface TodoConversationSource {
  origin: TodoOrigin
  scope_key: string
  scope_name: string
  mode: TodoMode
  todo: TodoSummary | null
  assignee: TodoMember | null
  connection_error?: string | null
}

export interface TodoConversationSourcesResult {
  conversation_id: number
  sources: TodoConversationSource[]
}

export type TodoConversationSourcesState = TodoConversationSourcesResult

export interface TodoOriginRequest {
  origin: TodoOrigin
  action:
    | "get"
    | "update"
    | "claim"
    | "release"
    | "finish"
    | "resume"
    | "verify"
    | "complete"
    | "reopen"
    | "delete"
  due_date?: string | null
  priority?: TodoPriority | null
  title?: string
  content?: string
  assignee_id?: string | null
  revision?: number
}

export interface TodoOriginResult {
  origin: TodoOrigin
  scope_key: string
  scope_name: string
  mode: TodoMode
  self_id: string
  members: TodoMember[]
  todo: Todo | null
}

export interface TodoConversationGroupsState {
  scope_key: string
  groups: TodoConversationGroup[]
  connection_error?: string | null
}

export interface TodoState {
  mode: TodoMode
  active_team_id: string | null
  teams: TodoTeam[]
  self_id: string | null
  members: TodoMember[]
  todos: Todo[]
  team_code: string | null
  public_url: string | null
  connection_error?: string | null
  completed_pagination?: TodoCompletedPagination
}

export interface TodoCompletedPagination {
  page: number
  page_size: number
  total: number
  search?: string
  filter?: TodoScheduleFilter
  today?: string
}

interface TodoCompletedQuery {
  completed_page?: number
  completed_page_size?: number
  completed_filter?: TodoScheduleFilter
  today?: string
  completed_search?: string
}

type TodoAction =
  | { action: "remove_team"; team_id: string }
  | { action: "dissolve_team"; team_id: string; name: string }
  | { action: "state" }
  | { action: "set_mode"; mode: TodoMode; team_id?: string }
  | {
      action: "create_team"
      minio_config?: import("./todo-storage").TodoMinioConfig
      name: string
      member_name: string
      avatar: string
      operation_id?: string
    }
  | {
      action: "join_team"
      code: string
      member_name: string
      avatar: string
    }
  | {
      action: "create"
      title: string
      content: string
      assignee_id: string | null
      conversation_id?: number
      share_options?: ConversationShareOptions
      include_codex_session?: boolean
      operation_id?: string
    }
  | {
      action: "update"
      id: string
      title: string
      content: string
      assignee_id: string | null
      revision: number
    }
  | {
      action:
        | "delete"
        | "claim"
        | "release"
        | "finish"
        | "resume"
        | "verify"
        | "complete"
        | "reopen"
      id: string
      revision: number
    }

export type TodoRequest = TodoAction &
  TodoCompletedQuery & {
    due_date?: string | null
    priority?: TodoPriority | null
  }

function normalizeTodoReference(todo: Todo, mode: TodoMode): Todo {
  const sourceUrl =
    mode === "personal" &&
    todo.source_url?.startsWith("/share#") &&
    typeof window !== "undefined"
      ? new URL(todo.source_url, window.location.origin).href
      : todo.source_url
  return {
    ...todo,
    source_url: sourceUrl,
    content: todoContentWithConversationReference(todo.content, sourceUrl),
  }
}

/** All team networking stays in the local backend; credentials never enter UI. */
export async function todoCall(request: TodoRequest): Promise<TodoState> {
  const state = await getTransport().call<TodoState>(
    "todo_call",
    {
      ...request,
    },
    { timeoutMs: 330_000 }
  )
  return {
    ...state,
    todos: state.todos.map((todo) => normalizeTodoReference(todo, state.mode)),
  }
}

/** Local conversation identities never leave the user's own backend. */
export async function todoConversationGroups(): Promise<TodoConversationGroupsState> {
  return getTransport().call<TodoConversationGroupsState>(
    "todo_conversation_groups"
  )
}

export function todoSearch(
  request: TodoSearchRequest
): Promise<TodoSearchResult> {
  return getTransport().call("todo_search", { ...request })
}

export function todoConversationLink(request: {
  conversation_id: number
  origin: TodoOrigin
  action: "link" | "unlink"
}): Promise<void> {
  return getTransport().call("todo_conversation_link", { ...request })
}

export function todoConversationSources(
  conversation_id: number
): Promise<TodoConversationSourcesResult> {
  return getTransport().call("todo_conversation_sources", { conversation_id })
}

export async function todoOriginCall(
  request: TodoOriginRequest
): Promise<TodoOriginResult> {
  const result = await getTransport().call<TodoOriginResult>(
    "todo_origin_call",
    {
      ...request,
    },
    { timeoutMs: 330_000 }
  )
  return {
    ...result,
    todo: result.todo ? normalizeTodoReference(result.todo, result.mode) : null,
  }
}

export function todoScopeKey(
  state: Pick<TodoState, "mode" | "active_team_id">
) {
  return state.mode === "personal"
    ? "personal"
    : `team:${state.active_team_id ?? "none"}`
}

export function todoImportCodexSession(request: {
  origin: TodoOrigin
  folder_id: number
}): Promise<import("./types").DbConversationSummary> {
  return getTransport().call("todo_import_codex_session", request, {
    timeoutMs: 330_000,
  })
}
