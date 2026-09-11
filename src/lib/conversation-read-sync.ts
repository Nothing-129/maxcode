import { getTransport } from "@/lib/transport"
import { onTransportReconnect, subscribe } from "@/lib/platform"
import { conversationUnreadStorageKey } from "@/lib/conversation-unread-storage"
import { useConversationUnreadStore } from "@/stores/conversation-unread-store"

interface ReadReceipt {
  conversation_id: number
  receipt: string
}

const readListeners = new Set<(ids: number[]) => void>()

/** A read is meaningful even when this device has no local blue dot. */
export function publishConversationRead(ids: number[]): void {
  if (ids.length) for (const listener of readListeners) listener(ids)
}

export function startConversationReadSync(): () => void {
  const transport = getTransport()
  const key = `${conversationUnreadStorageKey()}:receipts`
  let receipts: Record<string, string> = {}
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "{}")
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      receipts = parsed as Record<string, string>
    }
  } catch {}
  let disposed = false
  let generation = 0
  const changed = new Map<number, number>()
  const pending = new Set<number>()
  let sending = false
  const apply = (value: ReadReceipt) => {
    if (disposed || receipts[value.conversation_id] === value.receipt) return
    changed.set(value.conversation_id, ++generation)
    receipts[value.conversation_id] = value.receipt
    useConversationUnreadStore.getState().applyRemoteRead(value.conversation_id)
    try {
      localStorage.setItem(key, JSON.stringify(receipts))
    } catch {}
  }
  const refresh = async () => {
    const started = generation
    try {
      const values = await transport.call<ReadReceipt[]>(
        "get_conversation_reads"
      )
      for (const value of values) {
        if ((changed.get(value.conversation_id) ?? 0) <= started) apply(value)
      }
    } catch (error) {
      console.warn("[ConversationUnread] read receipt refresh failed", error)
    }
  }
  const flush = async () => {
    if (disposed || sending || pending.size === 0) return
    sending = true
    const ids = [...pending]
    ids.forEach((id) => pending.delete(id))
    try {
      // The broadcast is authoritative. Do not replay a potentially older
      // HTTP response over a newer event from another client.
      await transport.call("mark_conversations_read", { ids })
    } catch (error) {
      ids.forEach((id) => pending.add(id))
      console.warn("[ConversationUnread] read receipt save failed", error)
      return
    } finally {
      sending = false
    }
    if (!disposed && pending.size) void flush()
  }
  const publish = (ids: number[]) => {
    ids.forEach((id) => pending.add(id))
    void flush()
  }
  readListeners.add(publish)
  let unlisten: (() => void) | undefined
  void subscribe<ReadReceipt>("conversation-read://changed", apply)
    .then((dispose) => {
      if (disposed) return dispose()
      unlisten = dispose
      void refresh()
      publish([...useConversationUnreadStore.getState().viewedIds])
    })
    .catch((error) =>
      console.warn("[ConversationUnread] subscription failed", error)
    )
  const recover = () => {
    void refresh()
    void flush()
  }
  const reconnect = onTransportReconnect(recover)
  const wake = () => {
    if (document.visibilityState === "visible") recover()
  }
  window.addEventListener("focus", recover)
  document.addEventListener("visibilitychange", wake)
  return () => {
    disposed = true
    readListeners.delete(publish)
    unlisten?.()
    reconnect?.()
    window.removeEventListener("focus", recover)
    document.removeEventListener("visibilitychange", wake)
  }
}
