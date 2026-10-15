import { subscribe } from "./platform"

export const TODO_CONVERSATION_LINKS_CHANGED_EVENT =
  "maxcode:todo-conversation-links-changed"

export function notifyTodoConversationLinksChanged(conversationId: number) {
  window.dispatchEvent(
    new CustomEvent(TODO_CONVERSATION_LINKS_CHANGED_EVENT, {
      detail: { conversation_id: conversationId },
    })
  )
}

/** Same-client writes and other clients' backend events share one subscription. */
export function subscribeTodoConversationLinksChanged(
  listener: (conversationId: number) => void
) {
  let disposed = false
  let unlisten: (() => void) | undefined
  const local = (event: Event) => {
    const id = (event as CustomEvent<{ conversation_id: number }>).detail
      ?.conversation_id
    if (typeof id === "number") listener(id)
  }
  window.addEventListener(TODO_CONVERSATION_LINKS_CHANGED_EVENT, local)
  void Promise.resolve()
    .then(() =>
      subscribe<{ conversation_id: number }>(
        "todo-conversation-links://changed",
        (event) => !disposed && listener(event.conversation_id)
      )
    )
    .then((dispose) => {
      if (disposed) dispose?.()
      else unlisten = dispose
    })
    .catch(() => {})
  return () => {
    disposed = true
    window.removeEventListener(TODO_CONVERSATION_LINKS_CHANGED_EVENT, local)
    unlisten?.()
  }
}
