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
const animate = vi.fn(function (
  this: HTMLElement,
  _frames: Keyframe[],
  _options: KeyframeAnimationOptions
) {
  void _frames
  void _options
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
    <h3 className={kind === "complete" ? "maxcode-turn-heading" : undefined}>
      Status
    </h3>
    <p>Response</p>
  </TurnFeedback>
)

describe("interaction feedback", () => {
  it("animates new content once, including after virtualized remounts", () => {
    const ledger = new Set<string>()
    const first = render(view(ledger, "reply"))
    expect(animate).toHaveBeenCalledTimes(1)
    first.rerender(view(ledger, "reply"))
    expect(animate).toHaveBeenCalledTimes(1)
    animations[0].onfinish?.()
    first.unmount()
    render(view(ledger, "reply"))
    expect(animate).toHaveBeenCalledTimes(1)
    expect(animations[0].cancel).toHaveBeenCalled()
  })
  it("keeps sent bubbles static before and after confirmation and recycling", () => {
    const ledger = new Set<string>()
    const view = render(
      <TurnFeedback
        kind="send"
        token="bubble"
        ledger={ledger}
        waitingLabel="Waiting"
      >
        <div className="is-user">Text and attachments</div>
      </TurnFeedback>
    )
    expect(animate).not.toHaveBeenCalled()
    view.rerender(
      <TurnFeedback
        kind={null}
        token="bubble"
        ledger={ledger}
        waitingLabel="Waiting"
      >
        <div className="is-user">Text and attachments</div>
      </TurnFeedback>
    )
    expect(animate).not.toHaveBeenCalled()
    expect(screen.getByText("Text and attachments")).toBeVisible()
  })
  it("does not defer the whole-thread fade until the first send", () => {
    expect(source("src/components/message/message-list-view.tsx")).toContain(
      "ready={!detailLoading}"
    )
  })
  it("keeps historical rows static", () => {
    render(view(new Set(), null))
    expect(animate).not.toHaveBeenCalled()
  })
  it("retries an entrance cancelled before completion instead of consuming it", () => {
    const ledger = new Set<string>()
    const first = render(view(ledger, "reply"))
    first.unmount()
    render(view(ledger, "reply"))
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
  it("hands off pending to working without fading or overlaying either label", () => {
    const ledger = new Set(["round:waiting"])
    render(view(ledger))
    expect(animate).not.toHaveBeenCalled()
    expect(screen.queryByText("Waiting")).toBeNull()
    expect(screen.getByText("Response")).toBeVisible()
    expect(ledger.has("round:waiting")).toBe(false)
    expect(ledger.has("round:observed-reply")).toBe(true)
  })
  it("never replays a reply entrance on an already visible status heading", () => {
    const ledger = new Set<string>()
    render(
      <TurnFeedback
        kind="reply"
        token="round"
        ledger={ledger}
        waitingLabel="Waiting"
      >
        <div className="maxcode-turn-heading">Working</div>
      </TurnFeedback>
    )
    expect(animate).not.toHaveBeenCalled()
    expect(screen.getByText("Working")).toBeVisible()
  })
  it("settles only the existing heading on observed completion, without a checkmark", () => {
    const first = render(view(new Set(), "complete"))
    expect(animate).not.toHaveBeenCalled()
    first.unmount()
    const ledger = new Set(["round:observed-reply"])
    const current = render(view(ledger, "complete"))
    expect(animate).toHaveBeenCalledTimes(1)
    expect(animate.mock.contexts[0]).toBe(screen.getByText("Status"))
    expect(animate.mock.calls[0]).toEqual([
      [{ opacity: 0.65 }, { opacity: 1 }],
      { duration: 240, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    ])
    expect(document.querySelector("[data-completion-feedback]")).toBeNull()
    expect(current.container.querySelector("svg")).toBeNull()
    expect(screen.getByText("Response")).toBeVisible()
    animations[0].onfinish?.()
    current.unmount()
    render(view(ledger, "complete"))
    expect(animate).toHaveBeenCalledTimes(1)
  })
  it("removes spatial travel when reduced motion is enabled", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true }))
    )
    render(view(new Set(), "send"))
    expect(animate).not.toHaveBeenCalled()
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
