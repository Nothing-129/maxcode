"use client"

import { useLayoutEffect, type RefObject } from "react"

/** Animate a preserved surface without keying/remounting its children. */
export function useSurfaceTransition(
  ref: RefObject<HTMLElement | null>,
  identity: string,
  {
    active = true,
    ready = true,
    durationMs,
    initialOpacity = 0.65,
  }: {
    active?: boolean
    ready?: boolean
    durationMs?: number
    initialOpacity?: number
  } = {}
) {
  useLayoutEffect(() => {
    if (!active || !ready) return
    const node = ref.current
    if (!node?.animate) return
    const style = getComputedStyle(node)
    // The production CSS minifier converts 220ms to .22s.
    const duration = style.getPropertyValue("--motion-enter").trim()
    const configuredDuration =
      durationMs ?? parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000)
    const resolvedDuration = Number.isFinite(configuredDuration)
      ? configuredDuration
      : 220
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches
    const animation = node.animate(
      [{ opacity: reduced ? 0.65 : initialOpacity }, { opacity: 1 }],
      {
        duration: reduced ? Math.min(resolvedDuration, 120) : resolvedDuration,
        easing:
          style.getPropertyValue("--motion-ease").trim() ||
          "cubic-bezier(0.22, 1, 0.36, 1)",
      }
    )
    return () => animation.cancel()
  }, [ref, identity, active, ready, durationMs, initialOpacity])
}
