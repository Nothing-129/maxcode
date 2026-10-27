import { useRef } from "react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useListReflow } from "@/hooks/use-list-reflow"
import { useComposerHeightMotion } from "@/hooks/use-composer-height-motion"
import { StatusText } from "@/components/shared/status-text"
import { source } from "./contract-source"

const originalAnimate = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "animate"
)
const cancel = vi.fn()
const animate = vi.fn<
  (
    frames: Keyframe[],
    options: KeyframeAnimationOptions
  ) => { cancel: typeof cancel; playState: string }
>(() => ({ cancel, playState: "finished" }))
let height = 80
let resize: ResizeObserverCallback
const disconnect = vi.fn()
const observe = vi.fn()

function List({ order }: { order: string[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useListReflow(ref, order.join(","))
  return (
    <div ref={ref} data-testid="list">
      {order.map((id, index) => (
        <div key={id} data-motion-item={id} data-position={index}>
          {id}
        </div>
      ))}
    </div>
  )
}
function Composer({ ready = true }: { ready?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useComposerHeightMotion(ref, ready)
  return (
    <div ref={ref} data-testid="composer">
      <div data-overlayscrollbars-viewport="">
        <div data-composer-scroll-content="">
          <input className="ProseMirror" aria-label="Draft" />
        </div>
      </div>
    </div>
  )
}

beforeEach(() => {
  height = 80
  cancel.mockClear()
  animate.mockClear()
  observe.mockClear()
  disconnect.mockClear()
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: animate,
  })
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const y = Number(this.dataset.position ?? 0) * 50
      return {
        x: 0,
        y,
        top: y,
        left: 0,
        right: 400,
        bottom: y + height,
        width: 400,
        height,
        toJSON: () => ({}),
      }
    }
  )
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback
      }
      observe = observe
      disconnect = disconnect
    }
  )
})
afterEach(() => {
  cleanup()
  if (originalAnimate)
    Object.defineProperty(HTMLElement.prototype, "animate", originalAnimate)
  else Reflect.deleteProperty(HTMLElement.prototype, "animate")
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("refined interface motion", () => {
  it("animates changed positions, never the initial list or item dimensions", () => {
    const view = render(<List order={["a", "b"]} />)
    expect(animate).not.toHaveBeenCalled()
    view.rerender(<List order={["b", "a"]} />)
    expect(animate).toHaveBeenCalledTimes(2)
    expect(animate).toHaveBeenCalledWith(
      [{ transform: "translate(0px, 50px)" }, { transform: "none" }],
      { duration: 200, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
    )
    view.unmount()
    expect(cancel).toHaveBeenCalledTimes(2)
  })
  it("does not mistake scrolling for a task move", () => {
    const view = render(<List order={["a", "b"]} />)
    fireEvent.scroll(screen.getByTestId("list"))
    view.rerender(<List order={["b", "a"]} />)
    expect(animate).not.toHaveBeenCalled()
  })
  it("does not animate list movement under reduced motion", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
    } as MediaQueryList)
    const view = render(<List order={["a", "b"]} />)
    view.rerender(<List order={["b", "a"]} />)
    expect(animate).not.toHaveBeenCalled()
  })
  it("measures the editor document and changes shell height without replacing focus/draft", () => {
    const view = render(<Composer />)
    const input = screen.getByRole("textbox")
    input.focus()
    fireEvent.change(input, { target: { value: "unfinished draft" } })
    expect(observe).toHaveBeenCalledWith(input)
    expect(animate).not.toHaveBeenCalled()
    height = 140
    act(() => resize([], {} as ResizeObserver))
    expect(animate).toHaveBeenLastCalledWith(
      [{ height: "80px" }, { height: "140px" }],
      { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
    )
    expect(screen.getByRole("textbox")).toBe(input)
    expect(input).toHaveFocus()
    expect(input).toHaveValue("unfinished draft")
    height = 80
    act(() => resize([], {} as ResizeObserver))
    expect(animate.mock.calls[animate.mock.calls.length - 1][1]).toMatchObject({
      duration: 120,
    })
    view.unmount()
    expect(disconnect).toHaveBeenCalled()
  })
  it("ignores transient expansion overflow and shows a rail only for settled overflow", () => {
    const view = render(<Composer />)
    const root = screen.getByTestId("composer")
    const viewport = root.querySelector("[data-overlayscrollbars-viewport]")!
    // First expansion is already laid out naturally before its first animation.
    let clientHeight = 100
    let scrollHeight = 80
    Object.defineProperties(viewport, {
      clientHeight: { get: () => clientHeight },
      scrollHeight: { get: () => scrollHeight },
    })
    // Cancelling an in-progress shell animation restores its target geometry.
    cancel.mockImplementation(() => {
      clientHeight = height
    })
    for (const next of [100, 120, 140, 160]) {
      scrollHeight = next
      height = next
      act(() => resize([], {} as ResizeObserver))
      expect(root).toHaveAttribute("data-composer-overflow", "false")
    }
    // At the height cap, further lines really do require scrolling.
    scrollHeight = 200
    act(() => resize([], {} as ResizeObserver))
    expect(root).toHaveAttribute("data-composer-overflow", "true")
    scrollHeight = 160
    act(() => resize([], {} as ResizeObserver))
    expect(root).toHaveAttribute("data-composer-overflow", "false")
    expect(observe).toHaveBeenCalledWith(
      root.querySelector("[data-composer-scroll-content]")
    )
    view.unmount()
    expect(root).not.toHaveAttribute("data-composer-overflow")
    cancel.mockReset()
  })
  it("does not animate composer geometry when reduced motion is enabled", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
    } as MediaQueryList)
    render(<Composer />)
    height = 140
    act(() => resize([], {} as ResizeObserver))
    expect(animate).not.toHaveBeenCalled()
  })
  it("fades status changes only, keeping history mounts still", () => {
    const view = render(<StatusText value="running">Running</StatusText>)
    expect(screen.getByText("Running")).not.toHaveClass("maxcode-status-text")
    view.rerender(<StatusText value="success">Completed</StatusText>)
    expect(screen.getByText("Completed")).toHaveClass("maxcode-status-text")
  })
  it("keeps the sidebar highlight visible above opaque sibling rows", () => {
    const card = source(
      "src/components/conversations/sidebar-conversation-card.tsx"
    )
    expect(card).toContain('isSelected && "z-[1]"')
    expect(
      source("src/components/conversations/sidebar-conversation-list.tsx")
    ).toContain("item={SidebarVirtualRow}")
    expect(source("src/app/interaction-motion.css")).toContain(
      ".maxcode-sidebar-virtual-row:has([data-motion-selection]) {\n  z-index: 1;"
    )
    expect(card).toContain("durationMs={320}")
    expect(card).toContain("bg-black/[0.07] dark:bg-white/[0.1]")
    const indicator = source("src/components/shared/selection-indicator.tsx")
    expect(indicator).toContain("reduced ? 0 : durationMs / 1000")
  })
  it("wires the effects into production surfaces", () => {
    const bindings = [
      [
        "src/components/chat/composer/rich-composer.tsx",
        "useComposerHeightMotion(rootRef, Boolean(editor))",
      ],
      [
        "src/components/conversations/sidebar-conversation-card.tsx",
        "<SelectionIndicator",
      ],
      ["src/components/tabs/tab-item.tsx", "<SelectionIndicator"],
      [
        "src/components/files/file-workspace-tab-bar.tsx",
        "<SelectionIndicator",
      ],
      ["src/components/todos/todos-page.tsx", "useListReflow("],
      ["src/components/todos/todo-card.tsx", "data-motion-item={todo.id}"],
      ["src/components/ai-elements/tool.tsx", "<StatusText value={status}>"],
      ["src/components/ai-elements/reasoning.tsx", "maxcode-reasoning-content"],
    ]
    for (const [path, text] of bindings) expect(source(path)).toContain(text)
    expect(source("src/components/message/turn-feedback.tsx")).toContain(
      "translateY(4px)"
    )
    expect(source("src/app/interaction-motion.css")).not.toContain(
      "transition: all"
    )
  })
})
