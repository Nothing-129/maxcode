import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { VirtualizerHandle } from "virtua"
import { useSidebarViewportSync } from "@/components/conversations/use-sidebar-viewport-sync"

let resize: ResizeObserverCallback
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback
      }
      observe() {}
      disconnect() {}
    }
  )
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function setup() {
  const viewport = document.createElement("div")
  Object.defineProperties(viewport, {
    clientHeight: { value: 600, configurable: true },
    clientWidth: { value: 320, configurable: true },
  })
  const handle = { scrollOffset: 1000 }
  const virtualizer = { current: handle as VirtualizerHandle }
  // Model virtua's scroll subscription: rendering follows its stored offset.
  const scroll = vi.fn(() => {
    handle.scrollOffset = viewport.scrollTop
  })
  viewport.addEventListener("scroll", scroll)
  const view = renderHook(
    ({ rows }) => useSidebarViewportSync(viewport, virtualizer, rows),
    { initialProps: { rows: [1, 2, 3] } }
  )
  return { ...view, viewport, handle, scroll }
}
const settle = () => act(() => vi.advanceTimersByTime(201))

describe("sidebar virtualizer follows the native viewport", () => {
  it("recovers a missed native reset without moving scrollTop", () => {
    const { viewport, handle, scroll } = setup()
    settle()
    expect(scroll).toHaveBeenCalledOnce()
    expect(handle.scrollOffset).toBe(0)
    expect(viewport.scrollTop).toBe(0)
    settle()
    expect(scroll).toHaveBeenCalledOnce()
  })

  it("reconciles after row changes clamp the native offset", () => {
    const { viewport, handle, scroll, rerender } = setup()
    viewport.scrollTop = 1000
    settle()
    expect(scroll).not.toHaveBeenCalled()
    viewport.scrollTop = 120
    rerender({ rows: [1] })
    settle()
    expect(handle.scrollOffset).toBe(120)
  })

  it("waits for ongoing touch scrolling to settle", () => {
    const { viewport, handle, scroll } = setup()
    for (const offset of [900, 800, 700]) {
      act(() => vi.advanceTimersByTime(100))
      viewport.scrollTop = offset
      viewport.dispatchEvent(new Event("scroll"))
    }
    scroll.mockClear()
    // Simulate a final native adjustment whose notification was missed.
    viewport.scrollTop = 650
    act(() => vi.advanceTimersByTime(199))
    expect(handle.scrollOffset).toBe(700)
    expect(scroll).not.toHaveBeenCalled()
    settle()
    expect(handle.scrollOffset).toBe(650)
  })

  it("waits for a hidden sidebar to become visible and resize", () => {
    const { viewport, handle } = setup()
    Object.defineProperty(viewport, "clientWidth", {
      value: 0,
      configurable: true,
    })
    settle()
    expect(handle.scrollOffset).toBe(1000)
    Object.defineProperty(viewport, "clientWidth", { value: 320 })
    act(() => resize([], {} as ResizeObserver))
    settle()
    expect(handle.scrollOffset).toBe(0)
  })

  it("checks restored pages and cancels pending work on unmount", () => {
    const { handle, scroll, unmount } = setup()
    handle.scrollOffset = 0
    settle()
    handle.scrollOffset = 500
    window.dispatchEvent(new Event("pageshow"))
    settle()
    expect(handle.scrollOffset).toBe(0)
    scroll.mockClear()
    handle.scrollOffset = 500
    window.dispatchEvent(new Event("pageshow"))
    unmount()
    settle()
    expect(scroll).not.toHaveBeenCalled()
  })
})
