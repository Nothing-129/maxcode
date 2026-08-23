import { act, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  hasHorizontalDragIntent,
  isTabDragExcludedTarget,
  TAB_DRAG_ACTIVATION_PX,
  useLongPressDrag,
} from "./use-long-press-drag"

const dragStart = vi.fn()

vi.mock("motion/react", () => ({
  useDragControls: () => ({
    start: (...args: unknown[]) => dragStart(...args),
  }),
}))

function Probe({
  enabled = false,
  distanceActivationPx = TAB_DRAG_ACTIVATION_PX,
}: {
  enabled?: boolean
  distanceActivationPx?: number
}) {
  const { gestureHandlers } = useLongPressDrag({
    enabled,
    onStart: () => {},
    onEnd: () => {},
    distanceActivationPx,
  })
  const { onDragStart, onDragEnd, ...handlers } = gestureHandlers
  void onDragStart
  void onDragEnd
  return (
    <div data-testid="tab" {...handlers}>
      tab
      <button type="button">close</button>
    </div>
  )
}

function dispatchPointer(
  target: EventTarget,
  type: "pointerdown" | "pointermove" | "pointerup",
  init: {
    pointerId: number
    button?: number
    buttons?: number
    pointerType?: string
    clientX?: number
    clientY?: number
  }
) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, {
    button: init.button ?? 0,
    buttons: init.buttons ?? (type === "pointerup" ? 0 : 1),
    pointerType: init.pointerType ?? "mouse",
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    pointerId: init.pointerId,
  })
  act(() => {
    target.dispatchEvent(event)
  })
}

describe("hasHorizontalDragIntent", () => {
  it("rejects trackpad-click jitter", () => {
    expect(hasHorizontalDragIntent(3, 4)).toBe(false)
    expect(hasHorizontalDragIntent(9, 2)).toBe(false)
    expect(hasHorizontalDragIntent(15, 2)).toBe(false)
    expect(hasHorizontalDragIntent(8, 12)).toBe(false)
  })

  it("accepts a clearly horizontal swipe at the threshold", () => {
    expect(hasHorizontalDragIntent(TAB_DRAG_ACTIVATION_PX, 0)).toBe(true)
    expect(hasHorizontalDragIntent(-20, 4)).toBe(true)
  })
})

describe("isTabDragExcludedTarget", () => {
  it("treats close buttons (and their icon children) as non-draggable", () => {
    const button = document.createElement("button")
    const icon = document.createElement("svg")
    button.appendChild(icon)
    expect(isTabDragExcludedTarget(button)).toBe(true)
    expect(isTabDragExcludedTarget(icon)).toBe(true)
  })

  it("lets the tab body start a drag", () => {
    const tab = document.createElement("div")
    expect(isTabDragExcludedTarget(tab)).toBe(false)
  })
})

describe("useLongPressDrag fine-pointer activation", () => {
  afterEach(() => {
    dragStart.mockClear()
  })

  it("does not start a drag on a click with small pointer travel", () => {
    render(<Probe />)
    const tab = screen.getByTestId("tab")
    dispatchPointer(tab, "pointerdown", {
      pointerId: 1,
      clientX: 100,
      clientY: 40,
    })
    dispatchPointer(window, "pointermove", {
      pointerId: 1,
      clientX: 104,
      clientY: 43,
    })
    dispatchPointer(window, "pointerup", { pointerId: 1 })
    expect(dragStart).not.toHaveBeenCalled()
  })

  it("starts a drag after a horizontal swipe past the threshold", () => {
    render(<Probe />)
    const tab = screen.getByTestId("tab")
    dispatchPointer(tab, "pointerdown", {
      pointerId: 1,
      clientX: 100,
      clientY: 40,
    })
    dispatchPointer(window, "pointermove", {
      pointerId: 1,
      clientX: 100 + TAB_DRAG_ACTIVATION_PX,
      clientY: 41,
    })
    expect(dragStart).toHaveBeenCalledTimes(1)
  })

  it("does not start a drag from movement after the primary button was released", () => {
    render(<Probe />)
    const tab = screen.getByTestId("tab")
    dispatchPointer(tab, "pointerdown", {
      pointerId: 1,
      clientX: 100,
      clientY: 40,
    })
    dispatchPointer(window, "pointermove", {
      pointerId: 1,
      buttons: 0,
      clientX: 100 + TAB_DRAG_ACTIVATION_PX + 20,
      clientY: 40,
    })
    expect(dragStart).not.toHaveBeenCalled()
  })

  it("does not arm a drag from the close button", () => {
    render(<Probe />)
    dispatchPointer(
      screen.getByRole("button", { name: "close" }),
      "pointerdown",
      {
        pointerId: 1,
        clientX: 180,
        clientY: 40,
      }
    )
    dispatchPointer(window, "pointermove", {
      pointerId: 1,
      clientX: 180 + TAB_DRAG_ACTIVATION_PX + 4,
      clientY: 40,
    })
    expect(dragStart).not.toHaveBeenCalled()
  })
})
