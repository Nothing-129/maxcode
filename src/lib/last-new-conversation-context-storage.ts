"use client"

const STORAGE_KEY = "codeg:last-new-conversation-context:v1"

/** Remember explicit draft creation and folder selection, independently of
 *  which history tab happens to be active. Resolve paths and agents from the
 *  live folder when opening the next draft; neither belongs in this hint. */
export type LastNewConversationContext =
  | { kind: "folder"; folderId: number }
  | { kind: "chat" }

export function loadLastNewConversationContext(): LastNewConversationContext | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return null
    const value = parsed as Record<string, unknown>
    if (value.kind === "chat") return { kind: "chat" }
    if (
      value.kind === "folder" &&
      typeof value.folderId === "number" &&
      Number.isInteger(value.folderId) &&
      value.folderId > 0
    ) {
      return { kind: "folder", folderId: value.folderId }
    }
    return null
  } catch {
    return null
  }
}

export function saveLastNewConversationContext(
  context: LastNewConversationContext
): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(context))
  } catch {
    /* Device-local hints are optional when storage is unavailable. */
  }
}
