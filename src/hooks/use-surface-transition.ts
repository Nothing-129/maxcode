"use client"

import { useEffect, type RefObject } from "react"

/** Animate a preserved surface without keying/remounting its children. */
export function useSurfaceTransition(
  ref: RefObject<HTMLElement | null>,
  identity: string
) {
  useEffect(() => {
    const node = ref.current
    if (!node?.animate) return
    const style = getComputedStyle(node)
    // The production CSS minifier converts 220ms to .22s.
    const duration = style.getPropertyValue("--motion-enter").trim()
    const durationMs =
      parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000)
    const animation = node.animate([{ opacity: 0.65 }, { opacity: 1 }], {
      duration: Number.isFinite(durationMs) ? durationMs : 220,
      easing:
        style.getPropertyValue("--motion-ease").trim() ||
        "cubic-bezier(0.22, 1, 0.36, 1)",
    })
    return () => animation.cancel()
  }, [ref, identity])
}
