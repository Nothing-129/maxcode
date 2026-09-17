"use client"

import { useEffect, useRef } from "react"
import type { PointerEvent as ReactPointerEvent } from "react"
import { useTabStore } from "@/stores/tab-store"
import { conversationDropTarget } from "@/lib/conversation-drop-target"
import {
  acquireDragSelectionGuard,
  releaseDragSelectionGuard,
} from "@/lib/drag-selection-guard"

/** Drag the title even when the workspace has no tab strip yet. */
export function useConversationDrag(tabId: string, title: string) {
  const cleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanup.current?.(), [])

  return (event: ReactPointerEvent<HTMLElement>) => {
    if (
      event.button !== 0 ||
      event.pointerType === "touch" ||
      window.innerWidth < 768
    )
      return
    cleanup.current?.()
    const start = { x: event.clientX, y: event.clientY }
    const pointerId = event.pointerId
    let dragging = false
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6)
        return
      if (!dragging) {
        dragging = true
        acquireDragSelectionGuard()
      }
      const target = conversationDropTarget(tabId, e.clientX, e.clientY)
      useTabStore.getState().updateTabDrag({
        tabId,
        title,
        x: e.clientX,
        y: e.clientY,
        overGroupId: target?.gid ?? null,
        direction: target?.direction ?? null,
      })
    }
    const cancel = () => cleanup.current?.()
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel()
    }
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      const target = dragging
        ? conversationDropTarget(tabId, e.clientX, e.clientY)
        : null
      cancel()
      if (target)
        useTabStore
          .getState()
          .dropTabInGroup(tabId, target.gid, target.direction)
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
  }
}
