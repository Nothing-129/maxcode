"use client"

import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { useTabStore, useTabActions } from "@/contexts/tab-context"
import type { AgentType } from "@/lib/types"

/**
 * Handles `/workspace?folderId=X&conversationId=Y&agent=Z` URLs.
 * Runs once after both folders and tabs have hydrated.
 */
export function DeepLinkBootstrap() {
  const foldersHydrated = useAppWorkspaceStore((s) => s.foldersHydrated)
  const tabsHydrated = useTabStore((s) => s.tabsHydrated)
  const { openTab } = useTabActions()
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    if (!foldersHydrated || !tabsHydrated) return
    ranRef.current = true

    if (typeof window === "undefined") return

    const params = new URLSearchParams(window.location.search)
    const rawFolderId = params.get("folderId")
    const rawConversationId = params.get("conversationId")
    const rawAgent = params.get("agent") as AgentType | null

    if (!rawFolderId && !rawConversationId) return

    const clearUrl = () => {
      try {
        window.history.replaceState({}, "", "/workspace")
      } catch {
        /* ignore */
      }
    }

    void (async () => {
      try {
        const folderId = rawFolderId ? Number(rawFolderId) : null
        const conversationId = rawConversationId
          ? Number(rawConversationId)
          : null

        if (folderId == null || !Number.isFinite(folderId)) return
        if (conversationId == null || !Number.isFinite(conversationId)) return
        if (!rawAgent) return

        // Read at run time: this effect fires once when hydration completes,
        // and getState() sees exactly the lists as of that moment.
        const { folders, addFolderToWorkspaceById, conversations } =
          useAppWorkspaceStore.getState()

        let folder = folders.find((f) => f.id === folderId)
        if (!folder) {
          try {
            folder = await addFolderToWorkspaceById(folderId)
          } catch (err) {
            console.error("[DeepLinkBootstrap] open folder failed:", err)
            toast.error("Unable to open linked folder")
            return
          }
        }

        const hasConv = conversations.some(
          (c) =>
            c.id === conversationId &&
            c.folder_id === folderId &&
            c.agent_type === rawAgent
        )
        if (!hasConv) {
          toast.error("Linked conversation not found")
          return
        }

        openTab(folderId, conversationId, rawAgent, true)
      } finally {
        clearUrl()
      }
    })()
  }, [foldersHydrated, tabsHydrated, openTab])

  return null
}
