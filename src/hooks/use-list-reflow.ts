"use client"

import { useLayoutEffect, useRef, type RefObject } from "react"

/** Position-only FLIP, including moves between columns. No retained ghost rows. */
export function useListReflow(
  ref: RefObject<HTMLElement | null>,
  identity: string
) {
  const positions = useRef(new Map<string, { x: number; y: number }>())
  const animations = useRef<Animation[]>([])
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    animations.current.forEach((animation) => animation.cancel())
    animations.current = []
    const bounds = root.getBoundingClientRect()
    const next = new Map<string, { x: number; y: number }>()
    const reduced =
      document.hidden ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    root.querySelectorAll<HTMLElement>("[data-motion-item]").forEach((node) => {
      const id = node.dataset.motionItem!
      const rect = node.getBoundingClientRect()
      const point = { x: rect.left - bounds.left, y: rect.top - bounds.top }
      next.set(id, point)
      const previous = positions.current.get(id)
      if (!previous || reduced || !node.animate) return
      const x = previous.x - point.x
      const y = previous.y - point.y
      if (Math.abs(x) + Math.abs(y) < 1) return
      animations.current.push(
        node.animate(
          [{ transform: `translate(${x}px, ${y}px)` }, { transform: "none" }],
          { duration: 200, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
        )
      )
    })
    positions.current = next
  }, [ref, identity])
  useLayoutEffect(() => {
    const root = ref.current
    // Scrolling is navigation, not reordering: discard stale coordinates.
    const onScroll = () => positions.current.clear()
    root?.addEventListener("scroll", onScroll, true)
    return () => {
      root?.removeEventListener("scroll", onScroll, true)
      animations.current.forEach((animation) => animation.cancel())
    }
  }, [ref])
}
