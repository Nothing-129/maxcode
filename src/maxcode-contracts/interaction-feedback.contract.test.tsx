import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  TurnFeedback,
  type TurnFeedbackKind,
} from "@/components/message/turn-feedback"
import { source } from "./contract-source"

const originalAnimate = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "animate"
)
const animations: {
  cancel: ReturnType<typeof vi.fn>
  onfinish?: () => void
}[] = []
const animate = vi.fn(function (this: HTMLElement) {
  const animation = {
    cancel: vi.fn(),
    onfinish: undefined as (() => void) | undefined,
  }
  animations.push(animation)
  return animation
})
beforeEach(() => {
  animations.length = 0
  animate.mockClear()
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false }))
  )
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
  vi.unstubAllGlobals()
})

const view = (ledger: Set<string>, kind: TurnFeedbackKind = "reply") => (
  <TurnFeedback
    kind={kind}
    token="round"
    ledger={ledger}
    waitingLabel="Waiting"
  >
    <h3 className="maxcode-turn-heading">Status</h3>
    <p>Response</p>
  </TurnFeedback>
)

describe("interaction feedback", () => {
  it("animates new content once, including after virtualized remounts", () => {
    const ledger = new Set<string>()
    const first = render(view(ledger, "send"))
    expect(animate).toHaveBeenCalledTimes(1)
    first.rerender(view(ledger, "send"))
    expect(animate).toHaveBeenCalledTimes(1)
    animations[0].onfinish?.()
    first.unmount()
    render(view(ledger, "send"))
    expect(animate).toHaveBeenCalledTimes(1)
    expect(animations[0].cancel).toHaveBeenCalled()
  })
  it("retries an entrance cancelled before completion instead of consuming it", () => {
    const ledger = new Set<string>()
    const first = render(view(ledger, "send"))
    first.unmount()
    render(view(ledger, "send"))
    expect(animate).toHaveBeenCalledTimes(2)
  })
  it("does not consume the reply animation for an empty streaming placeholder", () => {
    const ledger = new Set<string>()
    const { rerender } = render(
      <TurnFeedback
        kind="reply"
        token="round"
        ledger={ledger}
        waitingLabel="Waiting"
        contentReady={false}
      >
        Empty
      </TurnFeedback>
    )
    expect(animate).not.toHaveBeenCalled()
    rerender(view(ledger))
    expect(animate).toHaveBeenCalledTimes(1)
  })
  it("fades the pending dots out without reserving transcript space", () => {
    const ledger = new Set(["round:waiting"])
    render(view(ledger))
    expect(animate).toHaveBeenCalledTimes(2)
    const waiting = screen.getByText("Waiting").parentElement!
    expect(waiting).not.toHaveAttribute("hidden")
    expect(waiting).toHaveClass("absolute")
    expect(waiting.querySelectorAll(".maxcode-waiting-dot")).toHaveLength(3)
    animations[1].onfinish?.()
    expect(waiting).toHaveAttribute("hidden")
    expect(ledger.has("round:waiting")).toBe(false)
  })
  it("shows the ending cue and header feedback only for observed replies", () => {
    const first = render(view(new Set(), "complete"))
    expect(animate).not.toHaveBeenCalled()
    first.unmount()
    render(view(new Set(["round:observed-reply"]), "complete"))
    expect(animate).toHaveBeenCalledTimes(2)
    expect(
      document.querySelector("[data-completion-feedback]")
    ).toHaveTextContent("")
    expect(
      document.querySelector("[data-completion-feedback] svg")
    ).not.toBeNull()
    expect(animate.mock.contexts[0]).toBe(
      document.querySelector("[data-completion-feedback]")
    )
    expect(animate.mock.contexts[1]).toBe(screen.getByText("Status"))
    expect(
      document.querySelector("[data-completion-feedback]")
    ).not.toHaveAttribute("hidden")
    animations[0].onfinish?.()
    expect(
      document.querySelector("[data-completion-feedback]")
    ).toHaveAttribute("hidden")
  })
  it("removes spatial travel when reduced motion is enabled", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true }))
    )
    render(view(new Set(), "send"))
    expect(animate.mock.calls[0]).toEqual([
      [{ opacity: 0.2 }, { opacity: 1 }],
      { duration: 160, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    ])
  })
  it("preserves panel mounts and ties success feedback to confirmed success", () => {
    const layout = source("src/app/workspace/layout.tsx")
    expect(layout).toContain("<Sidebar keepVisible={sidebarAnimating}")
    expect(layout).toContain("inert={!terminalOpen}")
    expect(layout).toContain("data-panel-open={terminalOpen}")
    const css = source("src/app/motion.css")
    expect(css).toContain(
      '[data-sonner-toast][data-type="success"] [data-icon]'
    )
    expect(css).toContain(".maxcode-panel-content")
    expect(
      source("src/components/message/progress-sections.tsx")
    ).not.toContain("LiveActivityPreview")
  })
})
