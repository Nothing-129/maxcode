import { createRef } from "react"
import type { StickToBottomContext } from "use-stick-to-bottom"
import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { MessageThread } from "@/components/ai-elements/message-thread"
import { VirtualizedMessageThread } from "@/components/message/virtualized-message-thread"

const observers = new Map<Element, ResizeObserverCallback[]>()

beforeEach(() => {
  observers.clear()
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) {
        observers.set(element, [
          ...(observers.get(element) ?? []),
          this.callback,
        ])
      }
      unobserve() {}
      disconnect() {}
    }
  )
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1)
  )
  vi.stubGlobal("cancelAnimationFrame", vi.fn())
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(10000)
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(500)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it("positions the real virtualized thread at the bottom before any animation frame", () => {
  const context = createRef<StickToBottomContext>()
  render(
    <MessageThread entryKey="loaded-task" active ready contextRef={context}>
      <VirtualizedMessageThread
        items={["first", "last"]}
        getItemKey={(item) => item}
        renderItem={(item) => <div>{item}</div>}
      />
    </MessageThread>
  )
  expect(context.current?.scrollRef.current).toBeInstanceOf(HTMLElement)
  expect(context.current?.scrollRef.current?.scrollTop).toBe(9499)
  expect(context.current?.state.isAtBottom).toBe(true)
})

it("positions after history arrives and on reactivation, while ordinary rerenders preserve reading", () => {
  const context = createRef<StickToBottomContext>()
  const view = (active: boolean, ready: boolean) => (
    <MessageThread
      entryKey="loaded-task"
      active={active}
      ready={ready}
      contextRef={context}
    >
      <VirtualizedMessageThread
        items={["first", "last"]}
        getItemKey={(item) => item}
        renderItem={(item) => <div>{item}</div>}
      />
    </MessageThread>
  )
  const { rerender } = render(view(true, false))
  expect(context.current?.scrollRef.current?.scrollTop).toBe(0)
  rerender(view(true, true))
  expect(context.current?.scrollRef.current?.scrollTop).toBe(9499)
  context.current!.scrollRef.current!.scrollTop = 100
  rerender(view(true, true))
  expect(context.current?.scrollRef.current?.scrollTop).toBe(100)
  rerender(view(false, true))
  rerender(view(true, true))
  expect(context.current?.scrollRef.current?.scrollTop).toBe(9499)
})

function resizeContent(context: StickToBottomContext, height = 2000) {
  const content = context.contentRef.current!
  act(() => {
    for (const callback of observers.get(content) ?? []) {
      callback(
        [
          {
            target: content,
            contentRect: { height },
          } as unknown as ResizeObserverEntry,
        ],
        {} as ResizeObserver
      )
    }
  })
}

function flushFrame() {
  const callbacks = vi.mocked(requestAnimationFrame).mock.calls.slice()
  vi.mocked(requestAnimationFrame).mockClear()
  act(() => {
    for (const [callback] of callbacks) callback(performance.now())
  })
}

it("reconciles a shrinking virtual history after its anchor adjustment", () => {
  const context = createRef<StickToBottomContext>()
  render(
    <MessageThread entryKey="refreshed-task" contextRef={context}>
      <VirtualizedMessageThread
        items={["first", "last"]}
        getItemKey={(item) => item}
        renderItem={(item) => <div>{item}</div>}
      />
    </MessageThread>
  )
  resizeContent(context.current!, 10000)
  flushFrame()
  // Measured rows are shorter than their estimates. Virtua restores an
  // earlier anchor after the content observer has delivered the new size.
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(2000)
  resizeContent(context.current!)
  context.current!.scrollRef.current!.scrollTop = 900
  flushFrame()
  expect(context.current!.scrollRef.current!.scrollTop).toBe(1499)

  // A user escape between observation and the frame cancels correction.
  resizeContent(context.current!)
  act(() => context.current!.stopScroll())
  context.current!.scrollRef.current!.scrollTop = 400
  flushFrame()
  expect(context.current!.scrollRef.current!.scrollTop).toBe(400)

  resizeContent(context.current!)
  flushFrame()
  expect(context.current!.scrollRef.current!.scrollTop).toBe(400)
})
