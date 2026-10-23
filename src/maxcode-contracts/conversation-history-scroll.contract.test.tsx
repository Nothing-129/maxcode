import type { ReactNode } from "react"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { source } from "./contract-source"

const threadOptions = vi.hoisted(() => vi.fn())
const context = vi.hoisted(() => ({
  isAtBottom: false,
  scrollToBottom: vi.fn(),
  reducedMotion: false,
}))

vi.mock("@/hooks/use-media-query", () => ({
  useMediaQuery: () => context.reducedMotion,
}))

vi.mock("use-stick-to-bottom", () => ({
  StickToBottom: ({
    children,
    initial,
    resize,
  }: {
    children: ReactNode
    initial?: unknown
    resize?: unknown
  }) => {
    threadOptions({ initial, resize })
    return <div>{typeof children === "function" ? null : children}</div>
  },
  useStickToBottomContext: () => context,
}))

import {
  MessageThread,
  MessageThreadScrollButton,
  THREAD_SCROLL_ANIMATION,
} from "@/components/ai-elements/message-thread"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  context.reducedMotion = false
})

describe("MaxCode contract: instant history positioning and manual bottom navigation", () => {
  it("uses instant positioning even for background history", () => {
    render(
      <MessageThread entryKey="task-a" active={false} ready>
        {null}
      </MessageThread>
    )
    expect(threadOptions).toHaveBeenLastCalledWith({
      initial: "instant",
      resize: "instant",
    })
  })

  it("positions initial history and later measurements instantly", () => {
    const { rerender } = render(<MessageThread>{null}</MessageThread>)
    expect(threadOptions).toHaveBeenLastCalledWith({
      initial: "instant",
      resize: "instant",
    })

    rerender(
      <MessageThread>
        {Array.from({ length: 50 }, (_, index) => (
          <div key={index}>Historical turn {index}</div>
        ))}
      </MessageThread>
    )
    expect(threadOptions).toHaveBeenLastCalledWith({
      initial: "instant",
      resize: "instant",
    })
  })

  it("keeps the arrow visible during travel and fades it out on arrival", async () => {
    let arrive!: (value: boolean) => void
    context.isAtBottom = false
    context.scrollToBottom.mockReturnValue(
      new Promise<boolean>((resolve) => {
        arrive = resolve
      })
    )
    const { rerender } = render(<MessageThreadScrollButton />)
    await waitFor(() => expect(screen.getByRole("button")).toBeVisible())
    fireEvent.click(screen.getByRole("button"))
    expect(context.scrollToBottom).toHaveBeenCalledWith({
      animation: THREAD_SCROLL_ANIMATION,
    })

    // Following is re-enabled immediately, before the viewport reaches the end.
    context.isAtBottom = true
    rerender(<MessageThreadScrollButton />)
    expect(screen.getByRole("button")).toBeVisible()
    await act(async () => {
      arrive(true)
    })
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull())
  })

  it("uses instant positioning for reduced motion in both paths", async () => {
    context.reducedMotion = true
    context.isAtBottom = false
    context.scrollToBottom.mockResolvedValue(true)
    render(<MessageThread>{null}</MessageThread>)
    expect(threadOptions).toHaveBeenLastCalledWith({
      initial: "instant",
      resize: "instant",
    })
    render(<MessageThreadScrollButton />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button"))
    })
    expect(context.scrollToBottom).toHaveBeenCalledWith({
      animation: "instant",
    })
  })

  it("uses the same policy for active and background conversation lists", () => {
    const list = source("src/components/message/message-list-view.tsx")
    const thread = list.match(/<MessageThread\b[^>]*>/)?.[0]
    expect(thread).toBeDefined()
    expect(thread).not.toMatch(/\b(initial|resize)=/)
  })
})
