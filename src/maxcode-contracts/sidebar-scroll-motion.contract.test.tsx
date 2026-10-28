import { useState } from "react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useSidebarScrollMotion } from "@/hooks/use-sidebar-scroll-motion"
import { source } from "./contract-source"

let frames: Map<number, FrameRequestCallback>
let sequence: number
let time: number
let reduced: boolean
let headerTop: number
const scrollBy = vi.fn()

function Sidebar({ empty = false }: { empty?: boolean }) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const { prepareReveal, cancel } = useSidebarScrollMotion(viewport)
  return (
    <div ref={setViewport} data-testid="viewport">
      <button
        onClick={() => {
          prepareReveal("header")
          setOpen(!open)
        }}
      >
        Expand
      </button>
      <button onClick={cancel}>Locate</button>
      <div data-y="header">
        <div data-sidebar-disclosure-row="header">Header</div>
      </div>
      {open && !empty && (
        <div data-y="child">
          <div data-sidebar-disclosure-row="child">Child</div>
        </div>
      )}
      <div data-y="tail">
        <div data-sidebar-disclosure-row="tail">Tail</div>
      </div>
    </div>
  )
}
function step() {
  act(() => {
    time += 16
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach((callback) => callback(time))
  })
}
function settle() {
  for (let i = 0; i < 50 && frames.size; i++) step()
}
function wheel(options: WheelEventInit = {}) {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY: 3,
    deltaMode: 1,
    ...options,
  })
  fireEvent(screen.getByTestId("viewport"), event)
  return event
}
beforeEach(() => {
  frames = new Map()
  sequence = 0
  time = 0
  reduced = false
  headerTop = 80
  scrollBy.mockClear()
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback)
    return sequence
  })
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id))
  vi.spyOn(window, "matchMedia").mockImplementation(
    () =>
      ({
        get matches() {
          return reduced
        },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList
  )
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(1000)
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(100)
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const top =
        this.dataset.y === "header"
          ? headerTop
          : this.dataset.y
            ? headerTop + 24
            : 0
      const height = this.dataset.y ? 24 : 100
      return {
        top,
        bottom: top + height,
        left: 0,
        right: 240,
        width: 240,
        height,
      } as DOMRect
    }
  )
  Object.defineProperty(HTMLElement.prototype, "scrollBy", {
    configurable: true,
    value: scrollBy,
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(HTMLElement.prototype, "scrollBy")
})

describe("sidebar scroll motion", () => {
  it("eases wheel notches, accumulates input and stops exactly at the destination", () => {
    render(<Sidebar />)
    const viewport = screen.getByTestId("viewport")
    expect(wheel().defaultPrevented).toBe(true)
    step()
    expect(viewport.scrollTop).toBeGreaterThan(0)
    expect(viewport.scrollTop).toBeLessThan(24)
    wheel()
    settle()
    expect(viewport.scrollTop).toBe(192)
    expect(frames.size).toBe(0)
  })
  it("smooths pixel-mode mouse notches with or without the deprecated legacy signal", () => {
    render(<Sidebar />)
    for (const legacy of [undefined, -120, -300]) {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: 100,
      })
      if (legacy !== undefined)
        Object.defineProperty(event, "wheelDeltaY", { value: legacy })
      fireEvent(screen.getByTestId("viewport"), event)
      expect(event.defaultPrevented).toBe(true)
      settle()
    }
    expect(screen.getByTestId("viewport").scrollTop).toBe(300)
  })
  it("responds immediately to reversed notches and clamps to boundaries", () => {
    render(<Sidebar />)
    const viewport = screen.getByTestId("viewport")
    wheel()
    step()
    wheel({ deltaY: -3 })
    settle()
    expect(viewport.scrollTop).toBe(0)
    expect(wheel({ deltaY: -3 }).defaultPrevented).toBe(false)
    wheel({ deltaY: 1000 })
    settle()
    expect(viewport.scrollTop).toBe(900)
  })
  it("smooths fractional OS wheel samples without switching to native jumps", () => {
    render(<Sidebar />)
    const viewport = screen.getByTestId("viewport")
    let total = 0
    for (const delta of [
      41.599998, 99.199997, 118.400002, 99.199997, 41.599998,
    ]) {
      const before = viewport.scrollTop
      const event = wheel({ deltaY: delta, deltaMode: 0 })
      total += delta
      expect(event.defaultPrevented).toBe(true)
      // Input changes the destination, never jumps the current scroll offset.
      expect(viewport.scrollTop).toBe(before)
      step()
      step()
      step()
    }
    expect(viewport.scrollTop).toBeLessThan(total)
    expect(frames.size).toBeGreaterThan(0)
    settle()
    expect(viewport.scrollTop).toBeCloseTo(400, 3)
  })
  it("smooths small continuous deltas and retains precision on integer scrollports", () => {
    render(<Sidebar />)
    const viewport = screen.getByTestId("viewport")
    let offset = 0
    Object.defineProperty(viewport, "scrollTop", {
      get: () => offset,
      set: (value) => {
        offset = Math.round(value)
      },
    })
    for (let i = 0; i < 20; i++) {
      expect(
        wheel({ deltaY: 2.5, deltaX: 0.5, deltaMode: 0 }).defaultPrevented
      ).toBe(true)
      step()
    }
    settle()
    expect(viewport.scrollTop).toBe(50)
    expect(frames.size).toBe(0)
  })
  it("keeps horizontal gestures, zoom and reduced-motion input native", () => {
    render(<Sidebar />)
    expect(wheel({ deltaX: 20, deltaY: 2 }).defaultPrevented).toBe(false)
    expect(wheel({ ctrlKey: true }).defaultPrevented).toBe(false)
    expect(wheel({ shiftKey: true }).defaultPrevented).toBe(false)
    reduced = true
    expect(wheel().defaultPrevented).toBe(false)
    expect(frames.size).toBe(0)
  })
  it("yields to scrollbar drags, explicit navigation and virtualizer corrections", () => {
    const view = render(<Sidebar />)
    const viewport = screen.getByTestId("viewport")
    wheel()
    step()
    fireEvent.pointerDown(viewport)
    expect(frames.size).toBe(0)
    wheel()
    step()
    fireEvent.click(screen.getByText("Locate"))
    expect(frames.size).toBe(0)
    wheel()
    step()
    viewport.scrollTop = 400
    fireEvent.scroll(viewport)
    expect(frames.size).toBe(0)
    wheel()
    view.unmount()
    expect(frames.size).toBe(0)
  })
  it("reveals only clipped newly expanded content while keeping its header visible", () => {
    render(<Sidebar />)
    fireEvent.click(screen.getByText("Expand"))
    step()
    expect(scrollBy).toHaveBeenCalledExactlyOnceWith({
      top: 36,
      behavior: "smooth",
    })
  })
  it("keeps already visible and empty groups still, and reveals instantly under reduced motion", () => {
    headerTop = 20
    const visible = render(<Sidebar />)
    fireEvent.click(screen.getByText("Expand"))
    step()
    expect(scrollBy).not.toHaveBeenCalled()
    visible.unmount()
    headerTop = 80
    const empty = render(<Sidebar empty />)
    fireEvent.click(screen.getByText("Expand"))
    step()
    expect(scrollBy).not.toHaveBeenCalled()
    empty.unmount()
    reduced = true
    render(<Sidebar />)
    fireEvent.click(screen.getByText("Expand"))
    step()
    expect(scrollBy).toHaveBeenCalledExactlyOnceWith({
      top: 36,
      behavior: "instant",
    })
  })
  it("retains the virtualizer's pre-collapse pin and makes locate respect reduced motion", () => {
    const list = source(
      "src/components/conversations/sidebar-conversation-list.tsx"
    )
    expect(list).toContain("useSidebarScrollMotion(viewportEl)")
    expect(list).toContain(
      'handle.scrollToIndex(idx, { align: "start", smooth: false })'
    )
    expect(list).toContain(
      'smooth: !window.matchMedia("(prefers-reduced-motion: reduce)").matches'
    )
    for (const key of [
      "folder-",
      "foldergroup-",
      "todo-group-",
      "section-",
      "rootgroup-",
    ])
      expect(list).toContain("prepareReveal(`" + key)
  })
})
