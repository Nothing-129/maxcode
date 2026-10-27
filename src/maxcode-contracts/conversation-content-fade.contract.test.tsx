import { useRef } from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useSurfaceTransition } from "@/hooks/use-surface-transition"
import { source } from "./contract-source"

const originalAnimate = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "animate"
)
const cancel = vi.fn()
const animate = vi.fn(() => ({ cancel }))

function Conversation({
  id = "one",
  active = true,
  ready = true,
  text = "Existing reply",
}: {
  id?: string
  active?: boolean
  ready?: boolean
  text?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useSurfaceTransition(ref, id, {
    active,
    ready,
    durationMs: 280,
    initialOpacity: 0.15,
  })
  return (
    <section>
      <button>Toolbar</button>
      <div ref={ref} data-testid="reading-area">
        {text}
      </div>
      <input aria-label="Composer draft" defaultValue="" />
    </section>
  )
}

beforeEach(() => {
  cancel.mockClear()
  animate.mockClear()
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: animate,
  })
})
afterEach(() => {
  cleanup()
  if (originalAnimate)
    Object.defineProperty(HTMLElement.prototype, "animate", originalAnimate)
  else Reflect.deleteProperty(HTMLElement.prototype, "animate")
  vi.restoreAllMocks()
})

describe("conversation reading-area fade", () => {
  it("fades only the reading area for 280ms and preserves the draft, focus and scroll", () => {
    const view = render(<Conversation />)
    const reading = screen.getByTestId("reading-area")
    const draft = screen.getByRole("textbox")
    fireEvent.change(draft, { target: { value: "unfinished draft" } })
    draft.focus()
    reading.scrollTop = 240
    view.rerender(<Conversation id="two" text="Another reply" />)
    expect(animate).toHaveBeenCalledTimes(2)
    expect(animate.mock.contexts.every((node) => node === reading)).toBe(true)
    expect(animate).toHaveBeenLastCalledWith(
      [{ opacity: 0.15 }, { opacity: 1 }],
      { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
    )
    expect(screen.getByRole("textbox")).toBe(draft)
    expect(draft).toHaveValue("unfinished draft")
    expect(draft).toHaveFocus()
    expect(reading.scrollTop).toBe(240)
    expect(cancel).toHaveBeenCalledTimes(1)
  })
  it("waits until an active conversation is ready, including cached reactivation", () => {
    const view = render(<Conversation active={false} ready={false} />)
    expect(animate).not.toHaveBeenCalled()
    view.rerender(<Conversation active ready={false} />)
    expect(animate).not.toHaveBeenCalled()
    view.rerender(<Conversation active ready />)
    expect(animate).toHaveBeenCalledTimes(1)
    view.rerender(<Conversation active={false} />)
    expect(cancel).toHaveBeenCalledTimes(1)
    view.rerender(<Conversation active />)
    expect(animate).toHaveBeenCalledTimes(2)
  })
  it("does not replay on streaming deltas or later message updates", () => {
    const view = render(<Conversation />)
    view.rerender(<Conversation text="Existing reply, new words" />)
    view.rerender(<Conversation text="Existing reply, new words and more" />)
    expect(animate).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(cancel).toHaveBeenCalledTimes(1)
  })
  it("uses a shorter opacity-only fade for reduced motion", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
    } as MediaQueryList)
    render(<Conversation />)
    expect(animate).toHaveBeenCalledWith([{ opacity: 0.65 }, { opacity: 1 }], {
      duration: 120,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    })
  })
  it("keeps entry positioning instantaneous and gates animation on entry identity", () => {
    const thread = source("src/components/ai-elements/message-thread.tsx")
    expect(thread).toContain("useSurfaceTransition(contentRef, entryKey, {")
    expect(thread).toContain("durationMs: 280")
    expect(thread).toContain("initialOpacity: 0.15")
    expect(thread).toContain('scrollToBottom({ animation: "instant" })')
    expect(thread).toContain(
      "state.scrollTop = Math.max(0, state.calculatedTargetScrollTop)"
    )
    expect(
      source("src/components/conversations/conversation-detail-panel.tsx")
    ).not.toContain('"h-full maxcode-surface-enter"')
  })
})
