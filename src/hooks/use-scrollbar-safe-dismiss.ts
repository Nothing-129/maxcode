"use client"

import { useCallback, useEffect, useRef } from "react"

// Radix `onPointerDownOutside` / `onFocusOutside` events: `CustomEvent`s carrying
// the original DOM event. Kept structural so this hook stays agnostic to which
// Radix surface (Popover / DropdownMenu) it guards.
type PointerDownOutsideEvent = CustomEvent<{ originalEvent: PointerEvent }>
type FocusOutsideEvent = CustomEvent<{ originalEvent: FocusEvent }>

// A focus-outside that lands shortly after a pointer-down which began INSIDE the
// content is treated as a side-effect of interacting with the content (grabbing
// its scrollbar), not a genuine outside focus. Covers the rare case where the
// refocus bounce arrives a hair after the pointer is released.
const INSIDE_POINTER_GRACE_MS = 500

/**
 * Keeps a Radix `DismissableLayer` surface (Popover / DropdownMenu content) open
 * while the user drags a scrollbar inside it. On WKWebView (not Chromium) this
 * otherwise dismisses the layer the instant the scrollbar is grabbed. The real
 * mechanism — confirmed by tracing live events in the actual WebView — is a
 * FOCUS bounce, not a pointer quirk:
 *
 *   pointerdown on `.os-scrollbar-handle` (inside the popover)
 *     → the popover's focused element blurs
 *     → WebKit immediately moves focus to the nearest `contenteditable` OUTSIDE
 *       the popover (here the Tiptap message composer)
 *     → Radix `useFocusOutside` sees a `focusin` on that outside element and
 *       dismisses.
 *
 * The pointer path is already safe: because the scrollbar is a real DOM node the
 * content `contains()` (an OverlayScrollbars bar, not a native one), Radix reads
 * the pointer-down as inside and never fires `pointerDownOutside`. So the fix is
 * entirely about the focus bounce.
 *
 * The distinguishing signal is NOT where focus landed (WebKit can bounce it
 * anywhere) but where the pointer interaction that caused it BEGAN. A scrollbar
 * drag starts with a `pointerdown` inside the content and is still held when the
 * spurious `focusin` fires; a genuine dismiss starts with a `pointerdown`
 * outside. So we track the originating pointer-down (a document capture listener)
 * and suppress a focus-outside whenever the in-flight — or just-ended — pointer
 * interaction started inside the content. This mirrors Radix's own
 * `hasPointerDownOutsideRef` guard, inverted for the inside case.
 *
 * Two smaller focus-outside shapes are also suppressed for good measure: focus
 * dropping to the document root, and focus bouncing back inside the content.
 * A genuine focus move to an outside element, with no inside pointer interaction
 * behind it, still dismisses as usual.
 *
 * Wire `contentRef` to the content and pass BOTH handlers to it.
 */
export function useScrollbarSafeDismiss<
  T extends HTMLElement = HTMLDivElement,
>() {
  const contentRef = useRef<T>(null)
  // Whether the most recent pointer-down began inside the content, whether a
  // pointer is currently held down, and when an inside pointer-down last
  // happened — together they tell a scrollbar drag apart from an outside click.
  const pointerDownInsideRef = useRef(false)
  const pointerIsDownRef = useRef(false)
  const lastInsidePointerDownAtRef = useRef(0)

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const content = contentRef.current
      const target = event.target
      const inside =
        !!content && target instanceof Node && content.contains(target)
      pointerDownInsideRef.current = inside
      pointerIsDownRef.current = true
      // Stamp inside-downs; clear on an outside-down so a genuine outside click
      // right after a scrollbar grab is never caught by the grace window below.
      lastInsidePointerDownAtRef.current = inside ? Date.now() : 0
    }
    const handlePointerUp = () => {
      pointerIsDownRef.current = false
    }
    // Capture phase so we see the pointer-down before anything stops it, and on
    // `document` so a native scrollbar-routed event is still observed. `blur`
    // clears a held-pointer flag that would otherwise stick if the pointer is
    // released off-window (no `pointerup`/`pointercancel` reaches us).
    document.addEventListener("pointerdown", handlePointerDown, true)
    document.addEventListener("pointerup", handlePointerUp, true)
    document.addEventListener("pointercancel", handlePointerUp, true)
    window.addEventListener("blur", handlePointerUp)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true)
      document.removeEventListener("pointerup", handlePointerUp, true)
      document.removeEventListener("pointercancel", handlePointerUp, true)
      window.removeEventListener("blur", handlePointerUp)
    }
  }, [])

  const onPointerDownOutside = useCallback((event: PointerDownOutsideEvent) => {
    const content = contentRef.current
    if (!content) return
    const { clientX, clientY } = event.detail.originalEvent
    const rect = content.getBoundingClientRect()
    const insideBox =
      rect.right > rect.left &&
      rect.bottom > rect.top &&
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    if (insideBox) event.preventDefault()
  }, [])

  const onFocusOutside = useCallback((event: FocusOutsideEvent) => {
    const content = contentRef.current
    if (!content) return
    const target = event.detail.originalEvent.target
    const doc = content.ownerDocument
    // Focus dropped to the document root, or bounced back inside the content —
    // spurious either way.
    const droppedToRoot =
      target == null || target === doc.body || target === doc.documentElement
    const movedInsideContent =
      target instanceof Node && content.contains(target)
    // The dominant WebKit case: focus was yanked to an outside contenteditable as
    // a side-effect of a pointer interaction that began inside the content (a
    // scrollbar grab). Suppress while that interaction is in flight, or within a
    // short grace window if the bounce lands just after release.
    const fromInsidePointer =
      (pointerIsDownRef.current && pointerDownInsideRef.current) ||
      Date.now() - lastInsidePointerDownAtRef.current < INSIDE_POINTER_GRACE_MS
    if (droppedToRoot || movedInsideContent || fromInsidePointer) {
      event.preventDefault()
    }
  }, [])

  return { contentRef, onPointerDownOutside, onFocusOutside }
}
