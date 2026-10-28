import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ActivityReveal } from "@/components/message/activity-reveal"
import { source } from "./contract-source"
const cancel = vi.fn()
const animate = vi.fn(() => ({ cancel, onfinish: null }))
const original = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "animate"
)
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }))
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    height: 24,
  } as DOMRect)
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: animate,
  })
})
afterEach(() => {
  cleanup()
  if (original)
    Object.defineProperty(HTMLElement.prototype, "animate", original)
  else Reflect.deleteProperty(HTMLElement.prototype, "animate")
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
it("opens only the height of arriving live activity and does not replay count updates", () => {
  const view = render(<ActivityReveal live>抓取 1 个资源</ActivityReveal>)
  expect(animate).toHaveBeenCalledWith(
    [{ height: "0px" }, { height: "24px" }],
    { duration: 320, easing: "cubic-bezier(0.25, 0.1, 0.25, 1)" }
  )
  view.rerender(<ActivityReveal live>抓取 2 个资源</ActivityReveal>)
  expect(animate).toHaveBeenCalledTimes(1)
  fireEvent.pointerDown(screen.getByText("抓取 2 个资源"))
  expect(cancel).toHaveBeenCalled()
  expect(screen.getByText("抓取 2 个资源").style.overflow).toBe("")
})
it("keeps history static even if the conversation later resumes", () => {
  const view = render(<ActivityReveal live={false}>History</ActivityReveal>)
  view.rerender(<ActivityReveal live>History</ActivityReveal>)
  expect(animate).not.toHaveBeenCalled()
})
it("skips expansion for reduced motion", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }))
  render(<ActivityReveal live>Activity</ActivityReveal>)
  expect(animate).not.toHaveBeenCalled()
})
it("wraps arriving summary intervals in the real renderer", () => {
  expect(source("src/components/message/content-parts-renderer.tsx")).toContain(
    "<ActivityReveal key={`interval-${index}`} live={isStreaming}>"
  )
})
