import type { ConversationShareOptions } from "./types"
import type { TodoOrigin } from "./todos"

export const TODO_COMPOSE_EVENT = "maxcode:create-todo"
export const TODO_OPEN_EVENT = "maxcode:open-todo"

export interface TodoComposeDraft {
  title?: string
  text: string
  conversationId?: number
  shareOptions?: ConversationShareOptions
}

// Buffer actions until their workspace dialog or destination page mounts.
let pendingDraft: TodoComposeDraft | null = null
let pendingOpen: TodoOrigin | null = null

export function requestCreateTodo(draft: TodoComposeDraft) {
  pendingOpen = null
  pendingDraft = draft
  window.dispatchEvent(new CustomEvent(TODO_COMPOSE_EVENT))
}

export function consumePendingTodoDraft(): TodoComposeDraft | null {
  const draft = pendingDraft
  pendingDraft = null
  return draft
}

export function requestOpenTodo(origin: TodoOrigin) {
  pendingDraft = null
  pendingOpen = { ...origin }
  window.dispatchEvent(new CustomEvent(TODO_OPEN_EVENT))
}

export function consumePendingOpenTodo(): TodoOrigin | null {
  const origin = pendingOpen
  pendingOpen = null
  return origin
}
