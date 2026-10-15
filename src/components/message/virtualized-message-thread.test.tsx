import type { ReactNode, Ref, RefObject } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { MessageScrollContextValue } from "@/components/message/message-scroll-context"

const testState = vi.hoisted(() => ({
  scrollRef: { current: null as HTMLDivElement | null },
  stopScroll: vi.fn(),
  virtuaScrollToIndex: vi.fn(),
  // The virtua handle's geometry: where the view is, where each row starts.
  scrollOffset: 0,
  itemOffset: (index: number) => index * 100,
}))

vi.mock("use-stick-to-bottom", () => ({
  useStickToBottomContext: () => ({
    scrollRef: testState.scrollRef,
    stopScroll: testState.stopScroll,
  }),
}))

vi.mock("virtua", async () => {
  const { useImperativeHandle } =
    await vi.importActual<typeof import("react")>("react")
  return {
    Virtualizer: ({
      children,
      ref,
    }: {
      children: ReactNode
      ref?: Ref<unknown>
    }) => {
      useImperativeHandle(ref, () => ({
        scrollToIndex: testState.virtuaScrollToIndex,
        getItemOffset: (index: number) => testState.itemOffset(index),
        get scrollOffset() {
          return testState.scrollOffset
        },
      }))
      return <>{children}</>
    },
  }
})

vi.mock("@/components/ai-elements/message-thread", () => ({
  MessageThreadContent: ({
    children,
    scrollClassName,
  }: {
    children: ReactNode
    scrollClassName?: string
  }) => (
    <div
      ref={(element) => {
        testState.scrollRef.current = element
      }}
      className={scrollClassName}
      data-testid="viewport"
    >
      {children}
    </div>
  ),
}))

import { VirtualizedMessageThread } from "@/components/message/virtualized-message-thread"

function renderThread(
  content: ReactNode = <div data-testid="content">text</div>
) {
  return render(
    <VirtualizedMessageThread
      items={[{ id: "message-1" }]}
      getItemKey={(item) => item.id}
      renderItem={() => content}
    />
  )
}

function pointerDown(element: HTMLElement, button: number) {
  fireEvent(element, new MouseEvent("pointerdown", { bubbles: true, button }))
}

beforeEach(() => {
  testState.scrollRef.current = null
  testState.stopScroll.mockReset()
  testState.virtuaScrollToIndex.mockReset()
  testState.scrollOffset = 0
  testState.itemOffset = (index: number) => index * 100
})

describe("VirtualizedMessageThread scroll API", () => {
  function renderWithScrollApi() {
    const scrollApiRef = {
      current: null,
    } as RefObject<MessageScrollContextValue | null>
    render(
      <VirtualizedMessageThread
        items={[{ id: "a" }, { id: "b" }]}
        getItemKey={(item) => item.id}
        renderItem={() => null}
        scrollApiRef={scrollApiRef}
        hasOlder
      />
    )
    return scrollApiRef
  }

  it("releases the stick-to-bottom lock before jumping up, past the loader row", () => {
    // Pinned at the bottom of a long thread; the target row starts far above.
    testState.scrollOffset = 5_000
    const scrollApiRef = renderWithScrollApi()
    scrollApiRef.current?.scrollToIndex(1, { align: "start", smooth: true })
    expect(testState.stopScroll).toHaveBeenCalledTimes(1)
    // Item 1 is virtua row 2: the loader row sits above the items.
    expect(testState.virtuaScrollToIndex).toHaveBeenCalledWith(2, {
      align: "start",
      smooth: true,
    })
    expect(testState.stopScroll.mock.invocationCallOrder[0]).toBeLessThan(
      testState.virtuaScrollToIndex.mock.invocationCallOrder[0]
    )
  })

  it.each([
    // The target row (virtua row 2, at 200px) starts inside the view…
    ["below the top of the view", 150],
    // …or exactly at its top.
    ["at the top of the view", 200],
  ])(
    "keeps the lock for a jump to a row starting %s",
    (_label, scrollOffset) => {
      // The jump can't move up, and a reply streaming in below must stay
      // followed.
      testState.scrollOffset = scrollOffset
      const scrollApiRef = renderWithScrollApi()
      scrollApiRef.current?.scrollToIndex(1, { align: "start", smooth: true })
      expect(testState.stopScroll).not.toHaveBeenCalled()
      expect(testState.virtuaScrollToIndex).toHaveBeenCalledWith(2, {
        align: "start",
        smooth: true,
      })
    }
  )
})

describe("VirtualizedMessageThread viewport focus", () => {
  it("focuses the viewport on a left click of transcript content", () => {
    renderThread()
    const viewport = screen.getByTestId("viewport")

    pointerDown(screen.getByTestId("content"), 0)

    expect(document.activeElement).toBe(viewport)
    expect(viewport.className).not.toContain("focus-visible:ring")
  })

  it("does not steal focus when an interactive control is clicked", () => {
    renderThread(<button data-testid="action">Action</button>)

    pointerDown(screen.getByTestId("action"), 0)

    expect(document.activeElement).not.toBe(screen.getByTestId("viewport"))
  })

  it("does not focus the viewport on a right click", () => {
    renderThread()

    pointerDown(screen.getByTestId("content"), 2)

    expect(document.activeElement).not.toBe(screen.getByTestId("viewport"))
  })
})
