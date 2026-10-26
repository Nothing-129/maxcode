"use client"

import { useRef, type TouchEvent } from "react"

interface SwipeStart {
  id: number
  x: number
  y: number
  time: number
}

// Leave text editing, controls and horizontally scrollable message content to
// their native gestures. In particular, code blocks must remain pannable.
function ownsGesture(target: EventTarget, container: HTMLElement) {
  if (!(target instanceof Element) || !container.contains(target)) return true
  if (
    target.closest(
      'input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="dialog"], [data-terminal-panel-region]'
    )
  ) {
    return true
  }
  for (let node: Element | null = target; node; node = node.parentElement) {
    if (
      node.scrollWidth > node.clientWidth + 1 &&
      /auto|scroll/.test(getComputedStyle(node).overflowX)
    ) {
      return true
    }
    if (node === container) break
  }
  return false
}

/** Mobile conversation surface only; never prevent native vertical scrolling. */
export function useConversationSidebarSwipe(
  enabled: boolean,
  onOpen: () => void
) {
  const start = useRef<SwipeStart | null>(null)
  const reset = () => {
    start.current = null
  }

  return {
    onTouchStart(event: TouchEvent<HTMLElement>) {
      reset()
      if (
        !enabled ||
        event.touches.length !== 1 ||
        ownsGesture(event.target, event.currentTarget) ||
        window.getSelection()?.toString()
      ) {
        return
      }
      const touch = event.touches[0]
      start.current = {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
      }
    },
    onTouchMove(event: TouchEvent<HTMLElement>) {
      const initial = start.current
      if (!initial) return
      const touch = event.touches[0]
      if (
        !enabled ||
        event.touches.length !== 1 ||
        touch.identifier !== initial.id
      ) {
        reset()
        return
      }
      const dx = touch.clientX - initial.x
      const dy = Math.abs(touch.clientY - initial.y)
      // Once a vertical/leftward gesture starts, it cannot turn into an open.
      if (dx < -12 || (dy > 12 && dy >= Math.abs(dx))) reset()
    },
    onTouchEnd(event: TouchEvent<HTMLElement>) {
      const initial = start.current
      reset()
      if (!enabled || !initial || event.touches.length !== 0) return
      const touch = Array.from(event.changedTouches).find(
        (item) => item.identifier === initial.id
      )
      if (!touch || window.getSelection()?.toString()) return
      const dx = touch.clientX - initial.x
      const dy = Math.abs(touch.clientY - initial.y)
      if (dx >= 64 && dx > dy * 2 && Date.now() - initial.time <= 700) {
        onOpen()
      }
    },
    onTouchCancel: reset,
  }
}
