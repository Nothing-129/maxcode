"use client"

import { useEffect } from "react"

const HEIGHT = "--maxcode-visual-viewport-height"
const TOP = "--maxcode-visual-viewport-top"

/** Keep fixed workspace/dialog frames above an overlaying mobile keyboard. */
export function useMobileVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const pointer = window.matchMedia("(pointer: coarse)")
    const style = document.documentElement.style
    const previousHeight = style.getPropertyValue(HEIGHT)
    const previousTop = style.getPropertyValue(TOP)
    let frame = 0
    const restore = () => {
      if (previousHeight) style.setProperty(HEIGHT, previousHeight)
      else style.removeProperty(HEIGHT)
      if (previousTop) style.setProperty(TOP, previousTop)
      else style.removeProperty(TOP)
    }
    const update = () => {
      frame = 0
      // Pinch zoom must remain browser-controlled. Native shells that already
      // resize the layout for IME also need no additional keyboard offset.
      if (
        !pointer.matches ||
        Math.abs(viewport.scale - 1) > 0.01 ||
        viewport.height <= 0 ||
        viewport.height >= window.innerHeight - 1
      ) {
        restore()
        return
      }
      style.setProperty(HEIGHT, `${viewport.height}px`)
      style.setProperty(TOP, `${Math.max(0, viewport.offsetTop)}px`)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    viewport.addEventListener("resize", schedule)
    viewport.addEventListener("scroll", schedule)
    window.addEventListener("resize", schedule)
    pointer.addEventListener("change", schedule)
    return () => {
      cancelAnimationFrame(frame)
      viewport.removeEventListener("resize", schedule)
      viewport.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
      pointer.removeEventListener("change", schedule)
      restore()
    }
  }, [])
}
