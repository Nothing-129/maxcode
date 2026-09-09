import { useIsMobile } from "@/hooks/use-mobile"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import en from "@/i18n/messages/en.json"
import { openConversationFind } from "@/lib/conversation-find-events"
import { source } from "./contract-source"
import { createRef } from "react"
import {
  ConversationFind,
  findConversationMessages,
} from "@/components/message/conversation-find"
import type { ThreadRenderItem } from "@/components/message/message-list-view"

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: vi.fn(() => false) }))

const items = [
  {
    key: "one",
    kind: "turn",
    group: { parts: [{ type: "text", text: "Alpha first message" }] },
  },
  { key: "typing", kind: "typing" },
  {
    key: "two",
    kind: "turn",
    group: { parts: [{ type: "text", text: "Second ALPHA reply" }] },
  },
] as ThreadRenderItem[]

function setup(active = true, historyOffset = 0) {
  const scrollToIndex = vi.fn()
  const load = vi.fn()
  const props = {
    conversationId: 42,
    items,
    active,
    scrollApiRef: { current: { scrollToIndex } },
    historyOffset,
    loadingHistory: false,
    onLoadHistory: load,
  }
  const view = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ConversationFind {...props} />
    </NextIntlClientProvider>
  )
  return { ...view, scrollToIndex, load, props }
}

describe("current conversation find contract", () => {
  it("opens from the title menu only for the active target and has no floating launcher", () => {
    setup()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    act(() => openConversationFind(43))
    expect(screen.queryByRole("search")).not.toBeInTheDocument()
    act(() => openConversationFind(42))
    expect(screen.getByRole("search")).toBeInTheDocument()
    fireEvent.keyDown(window, { key: "Escape" })
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    const header = source(
      "src/components/conversations/conversation-detail-header.tsx"
    )
    expect(header).toContain("openConversationFind(id)")
    expect(header).toContain('{tFind("title")}')
  })

  it("does not open or intercept find shortcuts on mobile", () => {
    vi.mocked(useIsMobile).mockReturnValue(true)
    try {
      const { load, scrollToIndex } = setup(true, 100)
      act(() => openConversationFind(42))
      expect(fireEvent.keyDown(window, { key: "f", ctrlKey: true })).toBe(true)
      expect(fireEvent.keyDown(window, { key: "f", metaKey: true })).toBe(true)
      expect(screen.queryByRole("search")).not.toBeInTheDocument()
      expect(load).not.toHaveBeenCalled()
      expect(scrollToIndex).not.toHaveBeenCalled()
    } finally {
      vi.mocked(useIsMobile).mockReturnValue(false)
    }
  })

  it("ignores menu requests in inactive conversations", () => {
    setup(false)
    act(() => openConversationFind(42))
    expect(screen.queryByRole("search")).not.toBeInTheDocument()
  })

  it("highlights mounted message text without changing its markup and clears on close", () => {
    const highlights = new Map<string, unknown>()
    vi.stubGlobal("CSS", { highlights })
    class TestHighlight {
      constructor(public ranges: Range[]) {}
    }
    vi.stubGlobal(
      "Highlight",
      class extends TestHighlight {
        constructor(...ranges: Range[]) {
          super(ranges)
        }
      }
    )
    try {
      const containerRef = createRef<HTMLDivElement>()
      render(
        <NextIntlClientProvider locale="en" messages={en}>
          <div ref={containerRef}>
            <div data-thread-index="0">
              <p>Alpha first message</p>
            </div>
            <ConversationFind
              conversationId={42}
              items={items}
              active
              scrollApiRef={{ current: { scrollToIndex: vi.fn() } }}
              containerRef={containerRef}
              historyOffset={0}
              loadingHistory={false}
              onLoadHistory={vi.fn()}
            />
          </div>
        </NextIntlClientProvider>
      )
      fireEvent.keyDown(window, { key: "f", ctrlKey: true })
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "alpha" },
      })
      const highlight = [...highlights.values()][0] as TestHighlight
      expect(highlight.ranges[0].toString()).toBe("Alpha")
      expect(
        containerRef.current?.querySelector("[data-thread-index]")?.innerHTML
      ).toBe("<p>Alpha first message</p>")
      fireEvent.keyDown(window, { key: "Escape" })
      expect(highlights.size).toBe(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it("matches literal text case insensitively, including nested and folded text", () => {
    expect(
      findConversationMessages(items, "alpha").map((m) => m.index)
    ).toEqual([0, 2])
    expect(findConversationMessages(items, "  ")).toEqual([])
    expect(findConversationMessages(items, "[.*")).toEqual([])
    const nested = [
      {
        key: "folded",
        kind: "turn",
        group: {
          parts: [
            {
              type: "goal-run",
              items: [{ type: "reasoning", content: "Hidden needle" }],
            },
          ],
        },
      },
    ] as ThreadRenderItem[]
    expect(findConversationMessages(nested, "needle")).toHaveLength(1)
  })
  it.each(["ctrlKey", "metaKey"])(
    "opens with %s+F, navigates virtual rows and closes with Escape",
    async (modifier) => {
      const { scrollToIndex } = setup()
      fireEvent.keyDown(window, { key: "f", [modifier]: true })
      const input = screen.getByRole("textbox", {
        name: "Find in conversation",
      })
      await waitFor(() => expect(input).toHaveFocus())
      fireEvent.change(input, { target: { value: "alpha" } })
      expect(scrollToIndex).toHaveBeenLastCalledWith(0, { align: "start" })
      expect(screen.getByText("2 matching messages")).toBeInTheDocument()
      expect(document.querySelector("mark")?.textContent).toBe("Alpha")
      fireEvent.keyDown(input, { key: "Enter" })
      expect(scrollToIndex).toHaveBeenLastCalledWith(2, { align: "start" })
      fireEvent.keyDown(input, { key: "Enter" })
      expect(scrollToIndex).toHaveBeenLastCalledWith(0, { align: "start" })
      fireEvent.keyDown(input, { key: "Enter", shiftKey: true })
      expect(scrollToIndex).toHaveBeenLastCalledWith(2, { align: "start" })
      fireEvent.keyDown(window, { key: "Escape" })
      expect(screen.queryByRole("search")).not.toBeInTheDocument()
    }
  )
  it("does not intercept shortcuts in inactive conversations", () => {
    setup(false)
    expect(fireEvent.keyDown(window, { key: "f", ctrlKey: true })).toBe(true)
    expect(screen.queryByRole("search")).not.toBeInTheDocument()
  })
  it("loads earlier pages once per boundary and offers explicit retries", () => {
    const { load, rerender, props } = setup(true, 100)
    fireEvent.keyDown(window, { key: "f", ctrlKey: true })
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "alpha" },
    })
    expect(load).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "beta" } })
    expect(load).toHaveBeenCalledTimes(1)
    fireEvent.click(
      screen.getByRole("button", { name: "Continue loading history" })
    )
    expect(load).toHaveBeenCalledTimes(2)
    rerender(
      <NextIntlClientProvider locale="en" messages={en}>
        <ConversationFind {...props} historyOffset={50} />
      </NextIntlClientProvider>
    )
    expect(load).toHaveBeenCalledTimes(3)
    fireEvent.keyDown(window, { key: "Escape" })
    rerender(
      <NextIntlClientProvider locale="en" messages={en}>
        <ConversationFind {...props} historyOffset={25} />
      </NextIntlClientProvider>
    )
    expect(load).toHaveBeenCalledTimes(3)
  })
})
