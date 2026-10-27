import { useRef, useState } from "react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useSidebarDisclosureMotion } from "@/hooks/use-sidebar-disclosure-motion"
import { source } from "./contract-source"

const originalAnimate = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "animate"
)
const cancel = vi.fn()
let finish: (() => void)[]
const animate = vi.fn(function (this: HTMLElement) {
  return {
    cancel,
    finished: new Promise<void>((resolve) => finish.push(resolve)),
  }
})

function List({ update = "" }: { update?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const prepare = useSidebarDisclosureMotion(ref)
  const [open, setOpen] = useState(false)
  const rows = open ? ["header", "child", "tail"] : ["header", "tail"]
  return (
    <div ref={ref} data-testid="list" data-bounds="root">
      <button
        onClick={() => {
          prepare()
          setOpen(!open)
        }}
      >
        Toggle
      </button>
      <span>{update}</span>
      {rows.map((id, index) => (
        <div key={id} data-sidebar-disclosure-row={id} data-y={index * 32}>
          <button id={`${id}-button`} data-conversation-id={id}>
            {id}
          </button>
        </div>
      ))}
    </div>
  )
}

beforeEach(() => {
  finish = []
  cancel.mockClear()
  animate.mockClear()
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: animate,
  })
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const top = Number(this.dataset.y ?? 0)
      const height = this.dataset.bounds === "root" ? 240 : 32
      return {
        x: 0,
        y: top,
        top,
        bottom: top + height,
        left: 0,
        right: 220,
        width: 220,
        height,
        toJSON() {},
      }
    }
  )
})
afterEach(() => {
  cleanup()
  if (originalAnimate)
    Object.defineProperty(HTMLElement.prototype, "animate", originalAnimate)
  else Reflect.deleteProperty(HTMLElement.prototype, "animate")
  vi.restoreAllMocks()
})

describe("sidebar group disclosure motion", () => {
  it("reveals new rows and moves the rows below, without animating initial or live updates", () => {
    const view = render(<List />)
    expect(animate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText("Toggle"))
    expect(animate).toHaveBeenCalledTimes(2)
    const entering = animate.mock.contexts.find(
      (node) => node.dataset.sidebarDisclosureRow === "child"
    )
    expect(entering).toBeTruthy()
    expect(animate.mock.calls).toContainEqual([
      [{ transform: "translateY(-32px)" }, { transform: "none" }],
      { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    ])
    view.rerender(<List update="streaming status changed" />)
    expect(animate).toHaveBeenCalledTimes(2)
  })

  it("collapses immediately while an inert, inaccessible snapshot fades away", async () => {
    render(<List />)
    fireEvent.click(screen.getByText("Toggle"))
    fireEvent.click(screen.getByText("Toggle"))
    const root = screen.getByTestId("list")
    expect(
      root.querySelector('[data-sidebar-disclosure-row="child"]')
    ).toBeNull()
    const exit = root.querySelector<HTMLElement>(
      "[data-sidebar-disclosure-exit]"
    )!
    expect(exit).toHaveAttribute("aria-hidden", "true")
    expect(exit.inert).toBe(true)
    expect(exit.style.pointerEvents).toBe("none")
    expect(exit.querySelector("[id], [data-conversation-id]")).toBeNull()
    expect(screen.queryAllByRole("button", { name: "child" })).toHaveLength(0)
    await act(async () => {
      finish.forEach((resolve) => resolve())
    })
    expect(root.querySelector("[data-sidebar-disclosure-exit]")).toBeNull()
  })

  it("cancels transitions on scrolling, another toggle, and unmount", () => {
    const view = render(<List />)
    fireEvent.click(screen.getByText("Toggle"))
    expect(cancel).not.toHaveBeenCalled()
    fireEvent.scroll(screen.getByTestId("list"))
    expect(cancel).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByText("Toggle"))
    expect(
      screen.getByTestId("list").querySelector("[data-sidebar-disclosure-exit]")
    ).not.toBeNull()
    fireEvent.click(screen.getByText("Toggle"))
    expect(
      screen.getByTestId("list").querySelector("[data-sidebar-disclosure-exit]")
    ).toBeNull()
    const count = cancel.mock.calls.length
    view.unmount()
    expect(cancel.mock.calls.length).toBeGreaterThan(count)
  })

  it("uses immediate expansion for reduced motion", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
    } as MediaQueryList)
    render(<List />)
    fireEvent.click(screen.getByText("Toggle"))
    expect(screen.getByRole("button", { name: "child" })).toBeVisible()
    fireEvent.click(screen.getByText("Toggle"))
    expect(animate).not.toHaveBeenCalled()
    expect(
      screen.getByTestId("list").querySelector("[data-sidebar-disclosure-exit]")
    ).toBeNull()
  })

  it("wires folder, todo and section toggles without altering virtualizer sizes", () => {
    const list = source(
      "src/components/conversations/sidebar-conversation-list.tsx"
    )
    expect(list).toContain("useSidebarDisclosureMotion(listSurfaceRef)")
    expect(list).toContain("data-sidebar-disclosure-row={rowKey(row)}")
    for (const name of [
      "toggleFolderGroup",
      "toggleTodoGroup",
      "toggleSection",
      "toggleFolder",
      "toggleRootGroup",
    ]) {
      const callback = list.slice(list.indexOf(`const ${name} = useCallback(`))
      expect(
        callback.slice(0, callback.indexOf("set", callback.indexOf("=>")))
      ).toContain("prepareDisclosure()")
    }
    expect(list).toContain("itemSize={32}")
    expect(list).toContain(
      'handle.scrollToIndex(idx, { align: "start", smooth: false })'
    )
    for (const name of [
      "sidebar-folder-group-header",
      "sidebar-todo-group-header",
      "sidebar-section-header",
    ]) {
      expect(source(`src/components/conversations/${name}.tsx`)).toContain(
        "maxcode-disclosure-chevron"
      )
    }
  })
})
