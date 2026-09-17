"use client"

import { useCallback, useEffect, useRef } from "react"
import type { PointerEvent as ReactPointerEvent } from "react"
import type { DbConversationSummary } from "@/lib/types"
import { useTabStore } from "@/stores/tab-store"
import { sidebarConversationDropTarget } from "@/lib/conversation-drop-target"
import { formatConversationTitle } from "@/lib/conversation-title"
import {
  acquireDragSelectionGuard,
  releaseDragSelectionGuard,
} from "@/lib/drag-selection-guard"

// A release can recycle the source row. Suppress the browser's following
// pointer click at window capture phase, rather than relying on that row.
function suppressReleaseClick() {
  const consume = (event: MouseEvent) => {
    if (event.detail === 0) return
    event.preventDefault()
    event.stopImmediatePropagation()
    window.removeEventListener("click", consume, true)
  }
  window.addEventListener("click", consume, true)
  window.setTimeout(
    () => window.removeEventListener("click", consume, true),
    250
  )
}

/** Lives on the list so virtualization cannot tear down an in-flight drag. */
export function useSidebarConversationDrag(
  onSelect: (id: number, agentType: string, folderId: number) => void
) {
  const cleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanup.current?.(), [])
  return useCallback(
    (
      event: ReactPointerEvent<HTMLButtonElement>,
      conversation: DbConversationSummary
    ) => {
      if (
        event.button !== 0 ||
        event.pointerType !== "mouse" ||
        window.innerWidth < 768
      )
        return false
      cleanup.current?.()
      const { clientX: startX, clientY: startY, pointerId } = event
      let dragging = false
      const move = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return
        if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) < 6)
          return
        if (!dragging) {
          dragging = true
          acquireDragSelectionGuard()
        }
        const target = sidebarConversationDropTarget(e.clientX, e.clientY)
        useTabStore.getState().updateTabDrag({
          source: "sidebar",
          tabId: `sidebar-${conversation.agent_type}-${conversation.id}`,
          title: formatConversationTitle(conversation.title),
          x: e.clientX,
          y: e.clientY,
          overGroupId: target?.gid ?? null,
          direction: target?.direction ?? null,
        })
      }
      const cancel = () => {
        suppressReleaseClick()
        cleanup.current?.()
      }
      const keydown = (e: KeyboardEvent) => {
        if (e.key === "Escape") cancel()
      }
      const end = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return
        const target = dragging
          ? sidebarConversationDropTarget(e.clientX, e.clientY)
          : null
        cancel()
        if (target)
          useTabStore
            .getState()
            .openConversationInGroup(conversation, target.gid, target.direction)
        else if (!dragging)
          onSelect(
            conversation.id,
            conversation.agent_type,
            conversation.folder_id
          )
      }
      cleanup.current = () => {
        window.removeEventListener("pointermove", move)
        window.removeEventListener("pointerup", end)
        window.removeEventListener("pointercancel", cancel)
        window.removeEventListener("blur", cancel)
        window.removeEventListener("keydown", keydown)
        if (dragging) releaseDragSelectionGuard()
        useTabStore.getState().endTabDrag()
        cleanup.current = null
      }
      window.addEventListener("pointermove", move)
      window.addEventListener("pointerup", end)
      window.addEventListener("pointercancel", cancel)
      window.addEventListener("blur", cancel)
      window.addEventListener("keydown", keydown)
      return true
    },
    [onSelect]
  )
}
