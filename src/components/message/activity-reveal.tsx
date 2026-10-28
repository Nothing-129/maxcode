"use client"

import { useLayoutEffect, useRef, useState, type ReactNode } from "react"

/** Reveal newly arriving activity without replaying on count updates/history. */
export function ActivityReveal({
  live,
  children,
}: {
  live: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [enter] = useState(live)
  useLayoutEffect(() => {
    const node = ref.current
    if (
      !enter ||
      !node?.animate ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return
    const height = node.getBoundingClientRect().height
    if (height <= 0) return
    const overflow = node.style.overflow
    node.style.overflow = "hidden"
    const animation = node.animate(
      [{ height: "0px" }, { height: `${height}px` }],
      {
        duration: 320,
        easing: "cubic-bezier(0.25, 0.1, 0.25, 1)",
      }
    )
    const finish = () => {
      animation.cancel()
      node.style.overflow = overflow
    }
    animation.onfinish = finish
    // Opening details during entrance must immediately expose their full height.
    node.addEventListener("pointerdown", finish)
    node.addEventListener("keydown", finish)
    return () => {
      finish()
      node.removeEventListener("pointerdown", finish)
      node.removeEventListener("keydown", finish)
    }
  }, [enter])
  return (
    <div ref={ref} data-activity-reveal="">
      {children}
    </div>
  )
}
