"use client"

import { useLayoutEffect, type RefObject } from "react"

/** Observe the document, animate its outer shell. Never replace the editor DOM. */
export function useComposerHeightMotion(
  ref: RefObject<HTMLElement | null>,
  ready: boolean
) {
  useLayoutEffect(() => {
    const root = ref.current
    const documentNode = root?.querySelector(".ProseMirror")
    if (!ready || !root || !documentNode || !root.animate) return
    let previous = root.getBoundingClientRect().height
    let width = root.getBoundingClientRect().width
    let animation: Animation | undefined
    // Measure with the shell at its final height. During expansion the visual
    // height is smaller than the document and OverlayScrollbars sees temporary
    // overflow, even though the final input can fit all of its content.
    const updateOverflow = () => {
      const viewport = root.querySelector<HTMLElement>(
        "[data-overlayscrollbars-viewport]"
      )
      if (viewport) {
        root.dataset.composerOverflow = String(
          viewport.scrollHeight - viewport.clientHeight > 1
        )
      }
    }
    updateOverflow()
    const observer = new ResizeObserver(() => {
      const current = root.getBoundingClientRect()
      const from =
        animation?.playState === "running" ? current.height : previous
      animation?.cancel()
      const target = root.getBoundingClientRect()
      updateOverflow()
      const resized = Math.abs(target.width - width) > 1
      width = target.width
      if (
        previous > 0 &&
        target.height > 0 &&
        !resized &&
        Math.abs(previous - target.height) > 1 &&
        !document.hidden &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        animation = root.animate(
          [{ height: `${from}px` }, { height: `${target.height}px` }],
          {
            duration: target.height < previous ? 120 : 180,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          }
        )
      }
      previous = target.height
    })
    observer.observe(documentNode)
    const content = root.querySelector("[data-composer-scroll-content]")
    if (content) observer.observe(content)
    return () => {
      observer.disconnect()
      animation?.cancel()
      delete root.dataset.composerOverflow
    }
  }, [ref, ready])
}
