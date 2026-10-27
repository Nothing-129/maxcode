import { cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GenerationActionIcon } from "@/components/chat/composer/generation-action-icon"
import { source } from "./contract-source"

const originalAnimate = Object.getOwnPropertyDescriptor(
  SVGElement.prototype,
  "animate"
)
const originalHaloAnimate = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "animate"
)
const cancelHalo = vi.fn()
const animateHalo = vi.fn(() => ({ cancel: cancelHalo }))
const cancel = vi.fn()
const animate = vi.fn(() => ({ cancel }))

beforeEach(() => {
  animateHalo.mockClear()
  cancelHalo.mockClear()
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: animateHalo,
  })
  animate.mockClear()
  cancel.mockClear()
  Object.defineProperty(SVGElement.prototype, "animate", {
    configurable: true,
    value: animate,
  })
})
afterEach(() => {
  cleanup()
  if (originalAnimate)
    Object.defineProperty(SVGElement.prototype, "animate", originalAnimate)
  else Reflect.deleteProperty(SVGElement.prototype, "animate")
  if (originalHaloAnimate)
    Object.defineProperty(HTMLElement.prototype, "animate", originalHaloAnimate)
  else Reflect.deleteProperty(HTMLElement.prototype, "animate")
  vi.restoreAllMocks()
})

describe("send readiness motion", () => {
  it("gives one short lift on becoming sendable, without replaying for further typing", () => {
    const view = render(<GenerationActionIcon running={false} />)
    expect(animate).not.toHaveBeenCalled()
    view.rerender(<GenerationActionIcon running={false} ready />)
    const send = view.container.querySelector('[data-generation-glyph="send"]')
    expect(animate).toHaveBeenCalledTimes(1)
    expect(animateHalo).toHaveBeenCalledTimes(1)
    expect(animateHalo.mock.contexts[0]).toBe(
      view.container.querySelector(".maxcode-send-ready-halo")
    )
    expect(animateHalo.mock.calls[0]).toEqual([
      [
        { boxShadow: "0 0 0 0px rgb(33 106 228 / 0%)" },
        { boxShadow: "0 0 0 5px rgb(33 106 228 / 24%)", offset: 0.4 },
        { boxShadow: "0 0 0 9px rgb(33 106 228 / 0%)" },
      ],
      { duration: 480, easing: "ease-out" },
    ])
    expect(animate.mock.contexts[0]).toBe(send)
    expect(animate.mock.calls[0]).toEqual([
      [
        { transform: "translateY(3px) scale(0.75)" },
        { transform: "translateY(-2px) scale(1.16)", offset: 0.5 },
        { transform: "translateY(0) scale(1)" },
      ],
      { duration: 380, easing: "ease-in-out" },
    ])
    view.rerender(<GenerationActionIcon running={false} ready />)
    expect(animate).toHaveBeenCalledTimes(1)
    view.rerender(<GenerationActionIcon running={false} />)
    expect(cancel).toHaveBeenCalledOnce()
    expect(cancelHalo).toHaveBeenCalledOnce()
    view.rerender(<GenerationActionIcon running={false} ready />)
    expect(animate).toHaveBeenCalledTimes(2)
  })

  it("does not bounce on restoring a draft or finishing generation", () => {
    const view = render(<GenerationActionIcon running={false} ready />)
    expect(animate).not.toHaveBeenCalled()
    view.rerender(<GenerationActionIcon running />)
    view.rerender(<GenerationActionIcon running={false} ready />)
    expect(animate).not.toHaveBeenCalled()
  })

  it("skips the lift for reduced motion", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
    } as MediaQueryList)
    const view = render(<GenerationActionIcon running={false} />)
    view.rerender(<GenerationActionIcon running={false} ready />)
    expect(animate).not.toHaveBeenCalled()
    expect(animateHalo).not.toHaveBeenCalled()
  })

  it("shares the actual disabled gate and softly transitions both foreground and background", () => {
    const input = source("src/components/chat/message-input.tsx")
    expect(input).toContain("disabled={sendDisabled}")
    expect(input).toContain("ready={!sendDisabled}")
    const css = source("src/app/interaction-motion.css")
    expect(css).toContain("background-color 280ms ease-out")
    expect(css).toContain("color 280ms ease-out")
  })
})
