import { useRef } from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SelectionActionBubble } from "@/components/message/selection-action-bubble"
import messages from "@/i18n/messages/en.json"

function Transcript() {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <div ref={ref}>
        <p>Selected message</p>
        <SelectionActionBubble containerRef={ref} onQuote={vi.fn()} />
      </div>
    </NextIntlClientProvider>
  )
}

function selectMessage() {
  const text = screen.getByText("Selected message")
  const range = document.createRange()
  range.selectNodeContents(text)
  vi.spyOn(range, "getBoundingClientRect").mockReturnValue({
    top: 100,
    bottom: 120,
    left: 0,
    width: 100,
    height: 20,
  } as DOMRect)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  return { text, selection }
}

function pointerDown(target: Element, pointerType: string) {
  const event = new Event("pointerdown", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "pointerType", { value: pointerType })
  fireEvent(target, event)
  return event
}

afterEach(() => {
  window.getSelection()?.removeAllRanges()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("mobile transcript selection menu", () => {
  it.each(["touch", "pen"])(
    "leaves native %s selection intact without a second toolbar, including after pointer cancellation",
    async (pointerType) => {
      vi.useFakeTimers()
      try {
        render(<Transcript />)
        const { text, selection } = selectMessage()
        const press = pointerDown(text, pointerType)
        fireEvent(document, new Event("selectionchange"))
        fireEvent.pointerCancel(text)
        await act(() => vi.runAllTimersAsync())
        fireEvent(document, new Event("selectionchange"))
        expect(screen.queryByRole("toolbar")).toBeNull()
        expect(selection.toString()).toBe("Selected message")
        expect(press.defaultPrevented).toBe(false)
        expect(fireEvent.contextMenu(text)).toBe(true)
      } finally {
        vi.useRealTimers()
      }
    }
  )

  it("uses the native menu for coarse-pointer selection without pointer events", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }))
    render(<Transcript />)
    const { selection } = selectMessage()
    fireEvent(document, new Event("selectionchange"))
    expect(screen.queryByRole("toolbar")).toBeNull()
    expect(selection.toString()).toBe("Selected message")
  })

  it("restores the custom toolbar when a hybrid device switches to a mouse", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }))
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 500,
      left: 0,
      width: 400,
      height: 500,
    } as DOMRect)
    vi.useFakeTimers()
    try {
      render(<Transcript />)
      const { text } = selectMessage()
      pointerDown(text, "touch")
      fireEvent.pointerUp(text)
      await act(() => vi.runAllTimersAsync())
      expect(screen.queryByRole("toolbar")).toBeNull()
      pointerDown(text, "mouse")
      fireEvent.pointerUp(text)
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(screen.getByRole("button", { name: "Quote" })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })
})
