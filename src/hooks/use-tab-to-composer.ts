"use client"

import { useEffect } from "react"

const editingSurface =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], .monaco-editor, .cm-editor, .xterm, [data-terminal-panel-region="true"]'

/** Include clipping ancestors: canvas cards and inactive panes can be offscreen. */
function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  let left = Math.max(0, rect.left)
  let top = Math.max(0, rect.top)
  let right = Math.min(window.innerWidth, rect.right)
  let bottom = Math.min(window.innerHeight, rect.bottom)

  for (
    let node: HTMLElement | null = element;
    node;
    node = node.parentElement
  ) {
    const style = getComputedStyle(node)
    if (
      node.hidden ||
      node.hasAttribute("inert") ||
      node.getAttribute("aria-hidden") === "true" ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.opacity === "0"
    ) {
      return false
    }
    if (node !== element) {
      const bounds = node.getBoundingClientRect()
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        left = Math.max(left, bounds.left)
        right = Math.min(right, bounds.right)
      }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        top = Math.max(top, bounds.top)
        bottom = Math.min(bottom, bounds.bottom)
      }
    }
  }
  return right > left && bottom > top
}

export function focusVisibleComposerOnTab(event: KeyboardEvent): void {
  if (
    event.key !== "Tab" ||
    event.defaultPrevented ||
    event.shiftKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.isComposing ||
    event.repeat
  ) {
    return
  }
  const active = document.activeElement
  if (
    (active instanceof Element && active.closest(editingSurface)) ||
    (event.target instanceof Element && event.target.closest(editingSurface))
  ) {
    return
  }
  // Never escape a focus trap or take keyboard navigation away from a menu.
  if (
    Array.from(
      document.querySelectorAll<HTMLElement>(
        '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [aria-modal="true"], dialog[open]'
      )
    ).some(isVisible)
  ) {
    return
  }
  const composer = Array.from(
    document.querySelectorAll<HTMLElement>(
      '.codeg-composer:not([data-disabled="true"]) [contenteditable="true"]'
    )
  ).find(isVisible)
  if (!composer) return
  composer.focus({ preventScroll: true })
  if (document.activeElement === composer) event.preventDefault()
}

/** One workspace listener, even when several conversation panes are mounted. */
export function useTabToComposer(): void {
  useEffect(() => {
    window.addEventListener("keydown", focusVisibleComposerOnTab)
    return () =>
      window.removeEventListener("keydown", focusVisibleComposerOnTab)
  }, [])
}
