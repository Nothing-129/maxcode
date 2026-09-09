export const OPEN_CONVERSATION_FIND_EVENT = "maxcode:open-conversation-find"

export function openConversationFind(conversationId: number) {
  window.dispatchEvent(
    new CustomEvent<number>(OPEN_CONVERSATION_FIND_EVENT, {
      detail: conversationId,
    })
  )
}
