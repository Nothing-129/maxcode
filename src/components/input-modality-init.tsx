"use client"

import { useEffect } from "react"

/** Menu focus restoration can inherit the editor's focus-visible state.
 * Track real input events across portals without blurring the restored trigger.
 */
export function InputModalityInit() {
  useEffect(() => {
    const root = document.documentElement
    const onPointerDown = () => {
      root.dataset.inputModality = "pointer"
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      root.dataset.inputModality = "keyboard"
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("keydown", onKeyDown, true)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("keydown", onKeyDown, true)
      delete root.dataset.inputModality
    }
  }, [])

  return null
}
