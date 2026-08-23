"use client"

import { useCallback, useEffect, useRef } from "react"
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react"
import { useDragControls } from "motion/react"

/** Pixels of horizontal travel before a fine pointer (mouse / Mac trackpad)
 *  may start a tab reorder. Motion's own drag listener uses ~3px, which a
 *  trackpad click routinely exceeds, turning the click into a drag and then
 *  swallowing the close-button click. */
export const TAB_DRAG_ACTIVATION_PX = 16

const DRAG_EXCLUDED_SELECTOR =
  "button, input, textarea, select, a, [data-no-tab-drag]"

export function isTabDragExcludedTarget(target: EventTarget | null): boolean {
  const el =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null
  return el != null && el.closest(DRAG_EXCLUDED_SELECTOR) != null
}

/** Reorder is axis-locked to x; require a clearly horizontal swipe so the
 *  mostly-vertical jitter of a Mac trackpad click cannot arm the drag. */
export function hasHorizontalDragIntent(
  dx: number,
  dy: number,
  thresholdPx = TAB_DRAG_ACTIVATION_PX
): boolean {
  const absX = Math.abs(dx)
  return absX >= thresholdPx && absX >= Math.abs(dy)
}

interface UseLongPressDragOptions {
  enabled: boolean
  onStart: () => void
  onEnd: () => void
  longPressMs?: number
  scrollThresholdPx?: number
  dragSettleMs?: number
  onDragSettle?: () => void
  /** Fine-pointer (mouse / trackpad / pen) distance gate. 0 disables it. */
  distanceActivationPx?: number
}

export function useLongPressDrag({
  enabled,
  onStart,
  onEnd,
  longPressMs = 500,
  scrollThresholdPx = 10,
  dragSettleMs = 200,
  onDragSettle,
  distanceActivationPx = TAB_DRAG_ACTIVATION_PX,
}: UseLongPressDragOptions) {
  const dragControls = useDragControls()
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const longPressActiveRef = useRef(false)
  const isDraggingRef = useRef(false)
  const removeNativeTouchMoveGuardRef = useRef<(() => void) | null>(null)
  const removeDistanceActivationRef = useRef<(() => void) | null>(null)
  // Every pointerdown opens a new interaction; suppressedInteractionRef pins
  // which interaction's synthetic click should be swallowed. Advancing the id
  // on every pointer kind (including mouse on hybrid devices) keeps stale
  // touch suppression from bleeding into a follow-up mouse click, and rescues
  // iOS Safari (which omits the click after long-press) without a timer.
  const interactionIdRef = useRef(0)
  const suppressedInteractionRef = useRef<number | null>(null)

  const clearLongPressTimer = useCallback(() => {
    if (!longPressTimerRef.current) return
    clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = null
  }, [])

  const clearDragSettleTimer = useCallback(() => {
    if (!dragSettleTimerRef.current) return
    clearTimeout(dragSettleTimerRef.current)
    dragSettleTimerRef.current = null
  }, [])

  const stopNativeTouchMoveGuard = useCallback(() => {
    removeNativeTouchMoveGuardRef.current?.()
    removeNativeTouchMoveGuardRef.current = null
  }, [])

  const stopDistanceActivation = useCallback(() => {
    removeDistanceActivationRef.current?.()
    removeDistanceActivationRef.current = null
  }, [])

  const releaseGesture = useCallback(() => {
    clearLongPressTimer()
    touchStartRef.current = null
    stopNativeTouchMoveGuard()
    stopDistanceActivation()
    if (longPressActiveRef.current) {
      longPressActiveRef.current = false
      onEnd()
    }
  }, [
    clearLongPressTimer,
    onEnd,
    stopDistanceActivation,
    stopNativeTouchMoveGuard,
  ])

  const startNativeTouchMoveGuard = useCallback(() => {
    if (removeNativeTouchMoveGuardRef.current) return

    const preventScrollDuringLongPressDrag = (event: TouchEvent) => {
      if (longPressActiveRef.current) {
        if (event.cancelable) event.preventDefault()
        return
      }

      const start = touchStartRef.current
      const touch = event.touches[0]
      if (!start || !touch || !longPressTimerRef.current) return

      const movedX = Math.abs(touch.clientX - start.x)
      const movedY = Math.abs(touch.clientY - start.y)
      if (movedX > scrollThresholdPx || movedY > scrollThresholdPx) {
        clearLongPressTimer()
        touchStartRef.current = null
        stopNativeTouchMoveGuard()
        return
      }

      if (event.cancelable) event.preventDefault()
    }
    const releaseOnNativeTouchEnd = () => releaseGesture()

    window.addEventListener("touchmove", preventScrollDuringLongPressDrag, {
      capture: true,
      passive: false,
    })
    window.addEventListener("touchend", releaseOnNativeTouchEnd, {
      capture: true,
    })
    window.addEventListener("touchcancel", releaseOnNativeTouchEnd, {
      capture: true,
    })
    removeNativeTouchMoveGuardRef.current = () => {
      window.removeEventListener(
        "touchmove",
        preventScrollDuringLongPressDrag,
        true
      )
      window.removeEventListener("touchend", releaseOnNativeTouchEnd, true)
      window.removeEventListener("touchcancel", releaseOnNativeTouchEnd, true)
    }
  }, [
    clearLongPressTimer,
    releaseGesture,
    scrollThresholdPx,
    stopNativeTouchMoveGuard,
  ])

  useEffect(
    () => () => {
      clearLongPressTimer()
      clearDragSettleTimer()
      stopNativeTouchMoveGuard()
      stopDistanceActivation()
    },
    [
      clearDragSettleTimer,
      clearLongPressTimer,
      stopDistanceActivation,
      stopNativeTouchMoveGuard,
    ]
  )

  const startDistanceActivation = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (distanceActivationPx <= 0) return
      stopDistanceActivation()
      const pointerId = event.pointerId
      const startX = event.clientX
      const startY = event.clientY

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return
        // WebKit can deliver a final trackpad move after the click has already
        // released. Distance alone is not drag intent: without the primary
        // button this stale move must tear down the pending gesture, otherwise
        // selecting a tab can lift it into a drag as the finger moves away.
        if ((moveEvent.buttons & 1) === 0) {
          stopDistanceActivation()
          return
        }
        if (
          !hasHorizontalDragIntent(
            moveEvent.clientX - startX,
            moveEvent.clientY - startY,
            distanceActivationPx
          )
        ) {
          return
        }
        stopDistanceActivation()
        dragControls.start(moveEvent)
      }
      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) return
        stopDistanceActivation()
      }

      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
      window.addEventListener("pointercancel", onUp)
      removeDistanceActivationRef.current = () => {
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
        window.removeEventListener("pointercancel", onUp)
      }
    },
    [distanceActivationPx, dragControls, stopDistanceActivation]
  )

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const interactionId = ++interactionIdRef.current
      if (event.button !== 0) return
      if (isTabDragExcludedTarget(event.target)) return

      // Coarse touch still uses long-press so a scroll doesn't reorder tabs.
      // Mouse / trackpad / pen (and coarse=false touch, which WKWebView can
      // report for a Mac trackpad) use the distance gate instead — Motion's
      // built-in ~3px listener is too eager for a trackpad click.
      const useLongPress = enabled && event.pointerType !== "mouse"
      if (useLongPress) {
        clearLongPressTimer()
        if (event.pointerType === "touch") {
          startNativeTouchMoveGuard()
        }
        longPressActiveRef.current = false
        touchStartRef.current = { x: event.clientX, y: event.clientY }

        longPressTimerRef.current = setTimeout(() => {
          longPressTimerRef.current = null
          longPressActiveRef.current = true
          suppressedInteractionRef.current = interactionId
          onStart()
          dragControls.start(event.nativeEvent)
        }, longPressMs)
        return
      }

      startDistanceActivation(event)
    },
    [
      clearLongPressTimer,
      dragControls,
      enabled,
      longPressMs,
      onStart,
      startDistanceActivation,
      startNativeTouchMoveGuard,
    ]
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || event.pointerType === "mouse") return

      if (longPressActiveRef.current) {
        event.preventDefault()
        return
      }

      const start = touchStartRef.current
      if (!start) return

      const movedX = Math.abs(event.clientX - start.x)
      const movedY = Math.abs(event.clientY - start.y)
      if (movedX > scrollThresholdPx || movedY > scrollThresholdPx) {
        clearLongPressTimer()
        stopNativeTouchMoveGuard()
      }
    },
    [clearLongPressTimer, enabled, scrollThresholdPx, stopNativeTouchMoveGuard]
  )

  const onDragStart = useCallback(() => {
    isDraggingRef.current = true
    clearDragSettleTimer()
  }, [clearDragSettleTimer])

  const onDragEnd = useCallback(() => {
    releaseGesture()
    // The synthetic click after a drag fires almost immediately on
    // descendants; the settle delay keeps isDragging true long enough that
    // onClickCapture also swallows the post-drag click (e.g. close button).
    clearDragSettleTimer()
    dragSettleTimerRef.current = setTimeout(() => {
      dragSettleTimerRef.current = null
      isDraggingRef.current = false
      onDragSettle?.()
    }, dragSettleMs)
  }, [clearDragSettleTimer, dragSettleMs, onDragSettle, releaseGesture])

  // Capture-phase so suppression covers every interactive descendant (close
  // button, future actions, Radix context menu trigger) without each caller
  // having to opt in, and so a child's stopPropagation cannot route around
  // it. Wired to click, dblclick, and contextmenu because preventDefault on
  // click does not reliably cancel a follow-up dblclick across browsers, and
  // iOS Safari fires contextmenu on native long-press which would otherwise
  // open the Radix menu over an in-progress sort. Two suppression sources:
  // - the event belongs to a long-press interaction (matched by id), or
  // - a drag is active or still settling.
  const suppressInteractionEvent = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      const fromLongPress =
        suppressedInteractionRef.current === interactionIdRef.current
      if (!fromLongPress && !isDraggingRef.current) return
      if (fromLongPress) suppressedInteractionRef.current = null
      event.stopPropagation()
      event.preventDefault()
    },
    []
  )

  return {
    dragControls,
    gestureHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: releaseGesture,
      onPointerCancel: releaseGesture,
      onClickCapture: suppressInteractionEvent,
      onDoubleClickCapture: suppressInteractionEvent,
      onContextMenuCapture: suppressInteractionEvent,
      onDragStart,
      onDragEnd,
    },
  }
}
