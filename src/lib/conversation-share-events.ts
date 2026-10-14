export const OPEN_CONVERSATION_SHARE_EVENT = "maxcode:open-conversation-share"

/** Target one header, including when several conversation panes are mounted. */
export function openConversationShare(tabId: string) {
  window.dispatchEvent(
    new CustomEvent<string>(OPEN_CONVERSATION_SHARE_EVENT, { detail: tabId })
  )
}
