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
import type { DbConversationSummary, FolderDetail } from "@/lib/types"
import type { TodoOrigin } from "@/lib/todos"

/** Prefer the most recently active linked conversation with a live folder. */
export function todoConversationContext(
  conversationIds: readonly number[],
  conversations: readonly DbConversationSummary[],
  folders: readonly FolderDetail[]
) {
  const ids = new Set(conversationIds)
  const candidates = conversations
    .filter((conversation) => ids.has(conversation.id))
    .sort(
      (a, b) =>
        (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0) ||
        b.id - a.id
    )
  for (const conversation of candidates) {
    if (conversation.kind === "chat") return { kind: "chat" } as const
    const folder = folders.find(
      (folder) => folder.id === conversation.folder_id
    )
    if (folder)
      return folder.kind === "chat"
        ? ({ kind: "chat" } as const)
        : ({ kind: "folder", folderId: folder.id } as const)
  }
  return null
}

export function openTodoConversationDraft(
  {
    text,
    origins = [],
    conversationIds,
    folderId,
  }: {
    text: string
    origins?: TodoOrigin[]
    conversationIds?: readonly number[]
    folderId?: number
  },
  activate: () => void
) {
  if (!text.trim()) return
  const state = useTabStore.getState()
  const active = state.rawTabs.find((tab) => tab.id === state.activeTabId)
  const { allFolders, conversations } = useAppWorkspaceStore.getState()
  const chosenFolder =
    folderId == null
      ? null
      : allFolders.find(
          (folder) => folder.id === folderId && folder.kind !== "chat"
        )
  if (folderId != null && !chosenFolder) return false
  const linkedContext = chosenFolder
    ? { kind: "folder" as const, folderId: chosenFolder.id }
    : todoConversationContext(conversationIds ?? [], conversations, allFolders)
  // Sidebar todo actions must never guess a folder when there is no sibling.
  if (conversationIds !== undefined && !linkedContext) return false
  const context = linkedContext ?? loadLastNewConversationContext()
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
      ? { targetGroup: groupOfTab(state.groupOf, state.groupLayout, active.id) }
      : {}),
  }
  const target =
    context?.kind !== "chat" && folder && folder.kind !== "chat"
      ? state.openNewConversationTab(folder.id, folder.path, options)
      : state.openChatModeTab(options)
  if (!target) return
  state.addDraftTodoOrigins(target.tabId, origins)
  saveMessageInputDraft(buildNewConversationDraftStorageKey(target.tabId), text)
  activate()
  return true
}

/** Open an independent unsent draft; callers may supply this todo's local chats. */
export function useNewChatFromTodo(
  getText: () => string,
  getOrigins?: () => TodoOrigin[],
  getConversationIds?: () => readonly number[]
) {
  const { setRoute } = useWorkbenchRoute()
  return useCallback(() => {
    openTodoConversationDraft(
      {
        text: getText(),
        origins: getOrigins?.(),
        conversationIds: getConversationIds?.(),
      },
      () => setRoute("conversations")
    )
  }, [getText, getOrigins, getConversationIds, setRoute])
}
