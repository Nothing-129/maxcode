import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const context = vi.hoisted(() => ({
  isAtBottom: false,
  scrollToBottom: vi.fn(),
}))

vi.mock("use-stick-to-bottom", () => ({
  StickToBottom: {},
  useStickToBottomContext: () => context,
}))

import { MessageThreadScrollButton } from "@/components/ai-elements/message-thread"

beforeEach(() => {
  context.isAtBottom = false
  context.scrollToBottom.mockClear()
})

describe("MaxCode contract: scroll-to-bottom hit area", () => {
  it("handles clicks on the button surface as well as its arrow", () => {
    render(<MessageThreadScrollButton />)
    const button = screen.getByRole("button")
    fireEvent.click(button)
    fireEvent.click(button.querySelector("svg")!)
    expect(context.scrollToBottom).toHaveBeenCalledTimes(2)

    // jsdom cannot hit-test CSS: preserve the positioning guarantees too.
    expect(button).toHaveClass("pointer-events-auto", "z-10")
    expect(button).toHaveClass("active:not-aria-[haspopup]:translate-y-0")
    expect(button).not.toHaveClass("active:not-aria-[haspopup]:translate-y-px")
  })

  it("hides the control when already at the bottom", () => {
    context.isAtBottom = true
    render(<MessageThreadScrollButton />)
    expect(screen.queryByRole("button")).toBeNull()
  })
})
