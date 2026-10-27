"use client"

import { useCallback, useLayoutEffect, useRef, type RefObject } from "react"

type Snapshot = {
  rect: DOMRect
  copy: HTMLElement
}

const ROW = "[data-sidebar-disclosure-row]"
const timing = { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }

/** Animate visible rows around explicit toggles without changing virtual sizes. */
export function useSidebarDisclosureMotion(ref: RefObject<HTMLElement | null>) {
  const pending = useRef<Map<string, Snapshot> | null>(null)
  const animations = useRef<Animation[]>([])
  const overlay = useRef<HTMLElement | null>(null)
  const scrollRoot = useRef<HTMLElement | null>(null)
  const clear = useCallback(() => {
    pending.current = null
    animations.current.forEach((animation) => animation.cancel())
    animations.current = []
    overlay.current?.remove()
    overlay.current = null
  }, [])

  const prepare = useCallback(() => {
    const root = ref.current
    if (
      !root ||
      document.hidden ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      clear()
      return
    }
    const bounds = root.getBoundingClientRect()
    const snapshots = new Map<string, Snapshot>()
    root.querySelectorAll<HTMLElement>(ROW).forEach((node) => {
      const rect = node.getBoundingClientRect()
      if (
        rect.bottom <= bounds.top ||
        rect.top >= bounds.bottom ||
        !rect.height
      )
        return
      snapshots.set(node.dataset.sidebarDisclosureRow!, {
        rect,
        copy: node.cloneNode(true) as HTMLElement,
      })
    })
    // Capture interpolated positions before canceling a previous transition.
    clear()
    pending.current = snapshots
  }, [ref, clear])

  useLayoutEffect(() => {
    const previous = pending.current
    pending.current = null
    const root = ref.current
    if (!root || !previous?.size) return
    if (
      document.hidden ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return
    const bounds = root.getBoundingClientRect()
    const current = new Set<string>()
    root.querySelectorAll<HTMLElement>(ROW).forEach((node) => {
      const id = node.dataset.sidebarDisclosureRow!
      current.add(id)
      const rect = node.getBoundingClientRect()
      if (
        !node.animate ||
        rect.bottom <= bounds.top ||
        rect.top >= bounds.bottom
      )
        return
      const before = previous.get(id)
      if (before) {
        const y = before.rect.top - rect.top
        if (Math.abs(y) < 1) return
        animations.current.push(
          node.animate(
            [{ transform: `translateY(${y}px)` }, { transform: "none" }],
            timing
          )
        )
      } else {
        animations.current.push(
          node.animate(
            [
              {
                opacity: 0,
                transform: "translateY(-6px)",
                clipPath: "inset(0 0 100% 0)",
              },
              { opacity: 1, transform: "none", clipPath: "inset(0)" },
            ],
            timing
          )
        )
      }
    })

    const layer = document.createElement("div")
    layer.dataset.sidebarDisclosureExit = ""
    layer.setAttribute("aria-hidden", "true")
    layer.inert = true
    Object.assign(layer.style, {
      position: "absolute",
      inset: "0",
      overflow: "hidden",
      pointerEvents: "none",
      zIndex: "20",
    })
    previous.forEach(({ copy, rect }, id) => {
      if (current.has(id)) return
      copy.removeAttribute("data-sidebar-disclosure-row")
      copy.removeAttribute("id")
      copy
        .querySelectorAll("[id]")
        .forEach((node) => node.removeAttribute("id"))
      for (const node of [copy, ...copy.querySelectorAll<HTMLElement>("*")]) {
        for (const name of [
          "data-conv-key",
          "data-conversation-id",
          "data-folder-id",
          "data-folder-group-id",
          "data-todo-group-id",
        ]) {
          node.removeAttribute(name)
        }
      }
      Object.assign(copy.style, {
        position: "absolute",
        left: `${rect.left - bounds.left}px`,
        top: `${rect.top - bounds.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        margin: "0",
        pointerEvents: "none",
      })
      layer.append(copy)
      if (!copy.animate) {
        copy.remove()
        return
      }
      const animation = copy.animate(
        [
          { opacity: 1, transform: "translateY(0)" },
          { opacity: 0, transform: "translateY(-8px)" },
        ],
        { duration: 180, easing: "ease-out", fill: "forwards" }
      )
      animations.current.push(animation)
      const remove = () => {
        copy.remove()
        if (!layer.childElementCount) layer.remove()
      }
      void animation.finished.then(remove, remove)
    })
    if (layer.childElementCount) {
      root.append(layer)
      overlay.current = layer
    }
  })

  useLayoutEffect(() => {
    const root = ref.current
    if (scrollRoot.current === root) return
    scrollRoot.current?.removeEventListener("scroll", clear, true)
    scrollRoot.current = root
    // Preserve existing scroll-before-collapse pinning and virtualizer geometry.
    root?.addEventListener("scroll", clear, true)
  })
  useLayoutEffect(() => {
    return () => {
      scrollRoot.current?.removeEventListener("scroll", clear, true)
      clear()
    }
  }, [clear])

  return prepare
}
