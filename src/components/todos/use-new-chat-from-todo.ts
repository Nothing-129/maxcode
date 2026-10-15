"use client"

import { useCallback } from "react"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { groupOfTab, useTabStore } from "@/stores/tab-store"
import {
  buildNewConversationDraftStorageKey,
  saveMessageInputDraft,
} from "@/lib/message-input-draft"
import { loadLastNewConversationContext } from "@/lib/last-new-conversation-context-storage"
import type { TodoOrigin } from "@/lib/todos"

/** Prefill an unsent todo draft using the last new conversation's folder. */
export function useNewChatFromTodo(
  getText: () => string,
  getOrigins?: () => TodoOrigin[]
) {
  const { setRoute } = useWorkbenchRoute()

  return useCallback(() => {
    const text = getText()
    if (!text.trim()) return
    const state = useTabStore.getState()
    const active = state.rawTabs.find((tab) => tab.id === state.activeTabId)
    const { allFolders } = useAppWorkspaceStore.getState()
    const context = loadLastNewConversationContext()
    const rememberedFolder =
      context?.kind === "folder"
        ? allFolders.find((folder) => folder.id === context.folderId)
        : undefined
    const activeFolder = allFolders.find(
      (folder) => folder.id === active?.folderId
    )
    const folder = rememberedFolder ?? activeFolder
    const options = {
      freshDraft: true,
      ...(active
        ? {
            targetGroup: groupOfTab(
              state.groupOf,
              state.groupLayout,
              active.id
            ),
          }
        : {}),
    }
    const target =
      context?.kind !== "chat" && folder && folder.kind !== "chat"
        ? state.openNewConversationTab(folder.id, folder.path, options)
        : state.openChatModeTab(options)
    if (!target) return
    state.addDraftTodoOrigins(target.tabId, getOrigins?.() ?? [])
    // A fresh tab mounts its own composer from this key. Persisting directly
    // protects rapid successive opens and avoids a second append on mount.
    saveMessageInputDraft(
      buildNewConversationDraftStorageKey(target.tabId),
      text
    )
    setRoute("conversations")
  }, [getOrigins, getText, setRoute])
}
