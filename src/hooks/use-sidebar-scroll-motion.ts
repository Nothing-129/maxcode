"use client"

import { useCallback, useEffect, useLayoutEffect, useRef } from "react"

const ROW = "[data-sidebar-disclosure-row]"

/** Keep vertical wheel input on one frame-driven, critically damped trajectory. */
export function useSidebarScrollMotion(viewport: HTMLElement | null) {
  const stopWheel = useRef<() => void>(() => {})
  const revealFrame = useRef<number | null>(null)
  const pendingReveal = useRef<{ key: string; following?: string } | null>(null)
  const cancel = useCallback(() => {
    stopWheel.current()
    pendingReveal.current = null
    if (revealFrame.current !== null) cancelAnimationFrame(revealFrame.current)
    revealFrame.current = null
  }, [])
  const prepareReveal = useCallback(
    (key: string) => {
      cancel()
      const rows = viewport
        ? [...viewport.querySelectorAll<HTMLElement>(ROW)]
        : []
      const index = rows.findIndex(
        (node) => node.dataset.sidebarDisclosureRow === key
      )
      pendingReveal.current = {
        key,
        following: rows[index + 1]?.dataset.sidebarDisclosureRow,
      }
    },
    [cancel, viewport]
  )

  useEffect(() => {
    if (!viewport) return
    let frame: number | null = null
    let target = viewport.scrollTop
    let applied = target
    let position = target
    let velocity = 0
    let lastTime = 0
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)")
    const stop = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      target = applied = position = viewport.scrollTop
      velocity = 0
      lastTime = 0
    }
    stopWheel.current = stop
    const tick = (time: number) => {
      const elapsed = lastTime ? Math.min(time - lastTime, 48) : 16
      lastTime = time
      target = Math.max(
        0,
        Math.min(target, viewport.scrollHeight - viewport.clientHeight)
      )
      // Integrate a critically damped spring analytically. New wheel samples
      // move the destination without restarting the animation or dropping its
      // velocity. Keep subpixel position separately from rounded DOM offsets.
      const seconds = elapsed / 1000
      const frequency = 20
      const decay = Math.exp(-frequency * seconds)
      const displacement = position - target
      const momentum = velocity + frequency * displacement
      position = target + (displacement + momentum * seconds) * decay
      velocity = (velocity - frequency * momentum * seconds) * decay
      const max = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      position = Math.max(0, Math.min(position, max))
      viewport.scrollTop = position
      applied = viewport.scrollTop
      if (Math.abs(target - position) < 0.5 && Math.abs(velocity) < 5) {
        viewport.scrollTop = target
        stop()
      } else {
        frame = requestAnimationFrame(tick)
      }
    }
    const wheel = (event: WheelEvent) => {
      if (
        !event.cancelable ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        reduced.matches
      ) {
        stop()
        return
      }
      const delta = event.deltaY
      // WheelEvent cannot reliably identify a mouse vs. a trackpad. Both can
      // emit small fractional pixel deltas, including OS-coalesced wheel ticks.
      // Never switch between native jumps and smoothing mid-gesture.
      if (!delta || Math.abs(event.deltaX) > Math.abs(delta)) {
        stop()
        return
      }
      const element = event.target instanceof Element ? event.target : null
      if (
        element?.closest(
          "input, textarea, [contenteditable=true], [role=slider]"
        )
      )
        return
      const max = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      const offset =
        delta *
        (event.deltaMode === 1
          ? 32
          : event.deltaMode === 2
            ? viewport.clientHeight
            : 1)
      if (
        frame !== null &&
        Math.sign(offset) !== Math.sign(target - viewport.scrollTop)
      )
        stop()
      const next = Math.max(
        0,
        Math.min((frame === null ? viewport.scrollTop : target) + offset, max)
      )
      if (next === viewport.scrollTop && frame === null) return
      event.preventDefault()
      target = next
      if (frame === null) frame = requestAnimationFrame(tick)
    }
    const externalScroll = () => {
      // Virtualizer corrections, scrollbar drags and explicit navigation win.
      if (Math.abs(viewport.scrollTop - applied) > 2) stop()
    }
    viewport.addEventListener("wheel", wheel, { passive: false })
    viewport.addEventListener("scroll", externalScroll, { passive: true })
    viewport.addEventListener("pointerdown", cancel)
    viewport.addEventListener("touchstart", cancel, { passive: true })
    viewport.addEventListener("keydown", cancel)
    reduced.addEventListener("change", cancel)
    return () => {
      cancel()
      viewport.removeEventListener("wheel", wheel)
      viewport.removeEventListener("scroll", externalScroll)
      viewport.removeEventListener("pointerdown", cancel)
      viewport.removeEventListener("touchstart", cancel)
      viewport.removeEventListener("keydown", cancel)
      reduced.removeEventListener("change", cancel)
      stopWheel.current = () => {}
    }
  }, [viewport, cancel])

  useLayoutEffect(() => {
    const pending = pendingReveal.current
    if (!pending || !viewport) return
    pendingReveal.current = null
    revealFrame.current = requestAnimationFrame(() => {
      revealFrame.current = null
      const rows = [...viewport.querySelectorAll<HTMLElement>(ROW)]
      const index = rows.findIndex(
        (node) => node.dataset.sidebarDisclosureRow === pending.key
      )
      const header = rows[index]
      const child = rows[index + 1]
      if (
        !header ||
        !child ||
        child.dataset.sidebarDisclosureRow === pending.following
      )
        return
      // FLIP affects the inner row only. Measure virtua's unchanged wrappers.
      const bounds = viewport.getBoundingClientRect()
      const head = header.parentElement!.getBoundingClientRect()
      const next = child.parentElement!.getBoundingClientRect()
      const delta = Math.min(
        next.bottom - bounds.bottom + 8,
        head.top - bounds.top - 8
      )
      if (delta <= 0 || next.top < head.bottom - 1) return
      viewport.scrollBy({
        top: delta,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      })
    })
  })
  return { cancel, prepareReveal }
}
