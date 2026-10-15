import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useMobileVisualViewport } from "@/hooks/use-mobile-visual-viewport"
import { source } from "./contract-source"

const HEIGHT = "--maxcode-visual-viewport-height"
const TOP = "--maxcode-visual-viewport-top"
let viewport: EventTarget & { height: number; offsetTop: number; scale: number }
let pointer: EventTarget & { matches: boolean }

function resize(height: number, offsetTop = 0, scale = 1) {
  act(() => {
    Object.assign(viewport, { height, offsetTop, scale })
    viewport.dispatchEvent(new Event("resize"))
    vi.runOnlyPendingTimers()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  viewport = Object.assign(new EventTarget(), {
    height: 844,
    offsetTop: 0,
    scale: 1,
  })
  pointer = Object.assign(new EventTarget(), { matches: true })
  vi.stubGlobal("visualViewport", viewport)
  vi.stubGlobal("innerHeight", 844)
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => pointer)
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.documentElement.style.removeProperty(HEIGHT)
  document.documentElement.style.removeProperty(TOP)
})

describe("mobile browser keyboard viewport", () => {
  it("follows the visible area and browser panning, then restores full height", () => {
    const { unmount } = renderHook(useMobileVisualViewport)
    const style = document.documentElement.style
    expect(style.getPropertyValue(HEIGHT)).toBe("")
    resize(380, 90)
    expect(style.getPropertyValue(HEIGHT)).toBe("380px")
    expect(style.getPropertyValue(TOP)).toBe("90px")
    act(() => {
      viewport.offsetTop = 110
      viewport.dispatchEvent(new Event("scroll"))
      vi.runOnlyPendingTimers()
    })
    expect(style.getPropertyValue(TOP)).toBe("110px")
    resize(844)
    expect(style.getPropertyValue(HEIGHT)).toBe("")
    expect(style.getPropertyValue(TOP)).toBe("")
    unmount()
  })

  it("does not constrain pinch zoom or a mouse-controlled desktop", () => {
    const { unmount } = renderHook(useMobileVisualViewport)
    resize(400)
    resize(200, 80, 2)
    expect(document.documentElement.style.getPropertyValue(HEIGHT)).toBe("")
    pointer.matches = false
    resize(400)
    expect(document.documentElement.style.getPropertyValue(HEIGHT)).toBe("")
    unmount()
  })

  it("does not double-compensate when a native shell resizes the layout", () => {
    const { unmount } = renderHook(useMobileVisualViewport)
    vi.stubGlobal("innerHeight", 380)
    resize(380)
    expect(document.documentElement.style.getPropertyValue(HEIGHT)).toBe("")
    unmount()
  })

  it("cleans up pending events and restores previous frame values", () => {
    const style = document.documentElement.style
    style.setProperty(HEIGHT, "700px")
    const { unmount } = renderHook(useMobileVisualViewport)
    resize(400)
    viewport.dispatchEvent(new Event("resize"))
    unmount()
    act(() => vi.runOnlyPendingTimers())
    expect(style.getPropertyValue(HEIGHT)).toBe("700px")
    expect(style.getPropertyValue(TOP)).toBe("")
  })

  it("uses the same visible frame for the workspace and portalled forms", () => {
    const workspace = source("src/app/workspace/layout.tsx")
    expect(workspace).toContain("useMobileVisualViewport()")
    expect(workspace).toContain('className="maxcode-visible-viewport fixed')
    expect(source("src/components/ui/dialog.tsx")).toContain(
      'className="maxcode-visible-viewport pointer-events-none'
    )
    expect(source("src/app/globals.css")).toContain(
      "max-height: calc(var(--maxcode-visual-viewport-height, 100dvh) - 2rem)"
    )
  })
})
