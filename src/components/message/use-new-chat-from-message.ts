"use client"

import { useCallback } from "react"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { groupOfTab, useTabStore } from "@/stores/tab-store"
import { parkAskSelectionPrompt } from "@/lib/ask-selection-handoff"

/** Open the normal conversation composer with this message as an unsent draft. */
export function useNewChatFromMessage(getText: () => string) {
  const { setRoute } = useWorkbenchRoute()

  return useCallback(() => {
    const text = getText()
    if (!text.trim()) return
    const state = useTabStore.getState()
    const source = state.rawTabs.find((tab) => tab.id === state.activeTabId)
    const folder = useAppWorkspaceStore
      .getState()
      .allFolders.find((folder) => folder.id === source?.folderId)
    const options = {
      ...(source ? { forceAgent: source.agentType } : {}),
      ...(source
        ? {
            targetGroup: groupOfTab(
              state.groupOf,
              state.groupLayout,
              source.id
            ),
          }
        : {}),
    }
    const target =
      folder && folder.kind !== "chat"
        ? state.openNewConversationTab(
            folder.id,
            source?.workingDir ?? folder.path,
            options
          )
        : state.openChatModeTab(options)
    if (!target) return
    parkAskSelectionPrompt(target.tabId, {
      prompt: text,
      agentType: target.agentType,
      folderId: target.folderId,
      delivery: "draft",
    })
    setRoute("conversations")
  }, [getText, setRoute])
}
