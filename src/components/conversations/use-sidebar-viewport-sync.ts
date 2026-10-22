import { useEffect, type RefObject } from "react"
import type { VirtualizerHandle } from "virtua"

// virtua settles scroll/measurement corrections after 150ms. Wait until those
// and native touch momentum are idle before checking the actual scrollport.
const SCROLL_SETTLE_MS = 200

export function useSidebarViewportSync(
  viewport: HTMLElement | null,
  virtualizer: RefObject<VirtualizerHandle | null>,
  rows: readonly unknown[]
) {
  useEffect(() => {
    if (!viewport) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const handle = virtualizer.current
        if (
          !handle ||
          viewport.clientHeight === 0 ||
          viewport.clientWidth === 0 ||
          viewport.ownerDocument.visibilityState === "hidden"
        ) {
          return
        }
        // A native clamp/reset can happen before virtua attaches its scroll
        // listener, or while the sidebar is hidden. Asking it to scroll to the
        // same offset does not emit a scroll event. Replay the notification so
        // it reads scrollTop again without moving the user's viewport.
        if (Math.abs(handle.scrollOffset - viewport.scrollTop) > 1) {
          viewport.dispatchEvent(new Event("scroll"))
        }
      }, SCROLL_SETTLE_MS)
    }
    const document = viewport.ownerDocument
    const window = document.defaultView
    const observer = new ResizeObserver(schedule)
    observer.observe(viewport)
    viewport.addEventListener("scroll", schedule, { passive: true })
    document.addEventListener("visibilitychange", schedule)
    window?.addEventListener("pageshow", schedule)
    schedule()
    return () => {
      clearTimeout(timer)
      observer.disconnect()
      viewport.removeEventListener("scroll", schedule)
      document.removeEventListener("visibilitychange", schedule)
      window?.removeEventListener("pageshow", schedule)
    }
  }, [viewport, virtualizer, rows])
}
