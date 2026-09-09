import { observeThreadOverflow } from "@/components/message/observe-thread-overflow"
import { source } from "./contract-source"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { RefObject } from "react"
import {
  buildMessageRailEntries,
  ConversationMessageRail,
} from "@/components/message/conversation-message-rail"
import type { ThreadRenderItem } from "@/components/message/message-list-view"
import type { MessageScrollContextValue } from "@/components/message/message-scroll-context"

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))

function turn(id: string, role: string, text: string): ThreadRenderItem {
  return {
    kind: "turn",
    group: { id, role, parts: [{ type: "text", text }] },
  } as ThreadRenderItem
}

describe("MaxCode contract: message tick rail", () => {
  it("pairs loaded user turns with reply previews and recomputes indices after prepends", () => {
    const items = [
      turn("u1", "user", "Question"),
      turn("a1", "assistant", "Answer"),
      turn("u2", "user", "Next"),
    ]
    expect(buildMessageRailEntries(items)).toEqual([
      { id: "u1", threadIndex: 0, question: "Question", answer: "Answer" },
      { id: "u2", threadIndex: 2, question: "Next", answer: "" },
    ])
    expect(
      buildMessageRailEntries([turn("old", "user", "Earlier"), ...items])[1]
        .threadIndex
    ).toBe(1)
  })

  it("marks the reading position, previews on focus and jumps using virtual row indices", async () => {
    const scrollToIndex = vi.fn()
    const scrollApiRef = {
      current: { scrollToIndex },
    } as RefObject<MessageScrollContextValue>
    render(
      <ConversationMessageRail
        entries={[
          {
            id: "u1",
            threadIndex: 0,
            question: "Question",
            answer: "Answer preview",
          },
          { id: "u2", threadIndex: 4, question: "Next", answer: "" },
        ]}
        visibleIndex={2}
        scrollApiRef={scrollApiRef}
      />
    )
    const first = screen.getByRole("button", { name: "1. Question" })
    expect(first).toHaveAttribute("aria-current", "location")
    fireEvent.focus(first)
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Answer preview"
    )
    fireEvent.click(screen.getByRole("button", { name: "2. Next" }))
    expect(scrollToIndex).toHaveBeenCalledWith(4, {
      align: "start",
      smooth: true,
    })
  })

  it("hides the rail below the 768px desktop breakpoint", () => {
    render(
      <ConversationMessageRail
        entries={[
          { id: "u1", threadIndex: 0, question: "Question", answer: "" },
        ]}
        visibleIndex={0}
        scrollApiRef={{ current: null }}
      />
    )
    const rail = screen.getByRole("navigation")
    expect(rail).toHaveClass("hidden", "md:flex")
    expect(rail).not.toHaveClass("flex")
  })

  it("renders no rail for an empty conversation", () => {
    const { container } = render(
      <ConversationMessageRail
        entries={[]}
        visibleIndex={0}
        scrollApiRef={{ current: null }}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe("message rail overflow visibility", () => {
  it("tracks fit, exact fit, overflow, resizing and hidden viewports", () => {
    let resize = () => {}
    const disconnect = vi.fn()
    const observe = vi.fn()
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback
        }
        observe = observe
        disconnect = disconnect
      }
    )
    try {
      const viewport = document.createElement("div")
      const content = document.createElement("div")
      let height = 500
      let scrollHeight = 300
      Object.defineProperties(viewport, {
        clientHeight: { get: () => height },
        scrollHeight: { get: () => scrollHeight },
      })
      const change = vi.fn()
      const stop = observeThreadOverflow(viewport, content, change)
      expect(change).toHaveBeenLastCalledWith(false)
      expect(observe).toHaveBeenCalledWith(viewport)
      expect(observe).toHaveBeenCalledWith(content)
      scrollHeight = 500
      resize()
      expect(change).toHaveBeenCalledTimes(1)
      scrollHeight = 501
      resize()
      expect(change).toHaveBeenCalledTimes(1)
      scrollHeight = 700
      resize()
      expect(change).toHaveBeenLastCalledWith(true)
      height = 800
      resize()
      expect(change).toHaveBeenLastCalledWith(false)
      height = 400
      resize()
      expect(change).toHaveBeenLastCalledWith(true)
      height = 0
      resize()
      expect(change).toHaveBeenLastCalledWith(false)
      stop()
      expect(disconnect).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("gates the rail on measured overflow instead of message count", () => {
    const view = source("src/components/message/message-list-view.tsx")
    expect(view).toContain("showMessageNav && threadOverflows &&")
    expect(view).toContain("onOverflowChange={setThreadOverflows}")
    expect(view).not.toContain("ConversationMessageNav")
    expect(view).not.toContain("extractSessionFilesGrouped")
  })
})
