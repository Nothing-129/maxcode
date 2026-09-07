"use client"

import { useCallback, useSyncExternalStore } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { refreshConversationTitle } from "@/lib/api"
import { toErrorMessage } from "@/lib/app-error"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"

const pending = new Set<number>()
const listeners = new Set<() => void>()
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
function notify() {
  listeners.forEach((listener) => listener())
}

export function useRefreshConversationTitle(conversationId: number | null) {
  const t = useTranslations("Folder.conversationCard")
  const refreshConversations = useAppWorkspaceStore(
    (s) => s.refreshConversations
  )
  const refreshing = useSyncExternalStore(
    subscribe,
    () => conversationId != null && pending.has(conversationId),
    () => false
  )
  const refreshTitle = useCallback(async () => {
    if (conversationId == null || pending.has(conversationId)) return
    pending.add(conversationId)
    notify()
    try {
      await refreshConversationTitle(conversationId)
      refreshConversations()
      toast.success(t("refreshTitleSuccess"))
    } catch (error) {
      toast.error(t("refreshTitleFailed", { message: toErrorMessage(error) }))
    } finally {
      pending.delete(conversationId)
      notify()
    }
  }, [conversationId, refreshConversations, t])
  return {
    refreshTitle,
    refreshing,
    refreshTitleLabel: t(refreshing ? "refreshingTitle" : "refreshTitle"),
  }
}
