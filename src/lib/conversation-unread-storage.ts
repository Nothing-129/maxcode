"use client"

const UNREAD_KEY = "codeg.conversationUnread"

export function conversationUnreadStorageKey(): string {
  return UNREAD_KEY
}

/** Persist the unread conversation ids. Missing / unreadable storage is empty. */
export function loadUnreadConversationIds(): number[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(UNREAD_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const ids: number[] = []
    const seen = new Set<number>()
    for (const value of parsed) {
      if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
        continue
      }
      if (seen.has(value)) continue
      seen.add(value)
      ids.push(value)
    }
    return ids
  } catch {
    return []
  }
}

export function saveUnreadConversationIds(ids: Iterable<number>): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(UNREAD_KEY, JSON.stringify([...ids]))
  } catch {
    // private mode / quota — unread then lives in memory only
  }
}

export function clearUnreadConversationIds(): void {
  if (typeof window === "undefined") return
  try {
    localStorage.removeItem(UNREAD_KEY)
  } catch {
    // ignore
  }
}
