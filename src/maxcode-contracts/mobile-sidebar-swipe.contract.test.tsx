import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useConversationSidebarSwipe } from "@/hooks/use-conversation-sidebar-swipe"
import { source } from "./contract-source"

function Surface({
  enabled = true,
  open,
}: {
  enabled?: boolean
  open: () => void
}) {
  const handlers = useConversationSidebarSwipe(enabled, open)
  return (
    <section data-testid="surface" {...handlers}>
      <p data-testid="message">Message</p>
      <textarea aria-label="Composer" />
      <pre data-testid="code" style={{ overflowX: "auto" }}>
        Code
      </pre>
    </section>
  )
}

const touch = (x: number, y: number, identifier = 1) => ({
  clientX: x,
  clientY: y,
  identifier,
})

function swipe(target: HTMLElement, x = 150, y = 105) {
  fireEvent.touchStart(target, { touches: [touch(50, 100)] })
  fireEvent.touchMove(target, { touches: [touch(x, y)] })
  fireEvent.touchEnd(target, { touches: [], changedTouches: [touch(x, y)] })
}

describe("mobile conversation sidebar gesture", () => {
  it("opens once for a deliberate right swipe from the message body", () => {
    const open = vi.fn()
    render(<Surface open={open} />)
    swipe(screen.getByTestId("message"))
    expect(open).toHaveBeenCalledTimes(1)
  })

  it.each([
    [60, 100],
    [0, 100],
    [150, 250],
    [150, 160],
  ])(
    "ignores short, leftward, vertical and diagonal gestures (%s, %s)",
    (x, y) => {
      const open = vi.fn()
      render(<Surface open={open} />)
      swipe(screen.getByTestId("message"), x, y)
      expect(open).not.toHaveBeenCalled()
    }
  )

  it("preserves composer and horizontally scrollable code gestures", () => {
    const open = vi.fn()
    render(<Surface open={open} />)
    swipe(screen.getByRole("textbox"))
    const code = screen.getByTestId("code")
    Object.defineProperties(code, {
      scrollWidth: { value: 600 },
      clientWidth: { value: 300 },
    })
    swipe(code)
    expect(open).not.toHaveBeenCalled()
  })

  it.each(["cancel", "multitouch", "vertical-first", "long-press"])(
    "does not open after %s",
    (kind) => {
      const open = vi.fn()
      render(<Surface open={open} />)
      const target = screen.getByTestId("message")
      const now = vi.spyOn(Date, "now").mockReturnValue(1000)
      fireEvent.touchStart(target, { touches: [touch(50, 100)] })
      if (kind === "cancel") fireEvent.touchCancel(target)
      if (kind === "multitouch") {
        fireEvent.touchStart(target, {
          touches: [touch(50, 100), touch(60, 100, 2)],
        })
      }
      if (kind === "vertical-first") {
        fireEvent.touchMove(target, { touches: [touch(52, 130)] })
      }
      if (kind === "long-press") now.mockReturnValue(2000)
      fireEvent.touchEnd(target, {
        touches: [],
        changedTouches: [touch(150, 105)],
      })
      expect(open).not.toHaveBeenCalled()
      now.mockRestore()
    }
  )

  it("ignores disabled surfaces and a sidebar opened during the swipe", () => {
    const open = vi.fn()
    const { rerender } = render(<Surface enabled={false} open={open} />)
    swipe(screen.getByTestId("message"))
    rerender(<Surface open={open} />)
    fireEvent.touchStart(screen.getByTestId("message"), {
      touches: [touch(50, 100)],
    })
    rerender(<Surface enabled={false} open={open} />)
    fireEvent.touchEnd(screen.getByTestId("message"), {
      touches: [],
      changedTouches: [touch(150, 105)],
    })
    expect(open).not.toHaveBeenCalled()
  })

  it("binds the gesture to the mobile conversation surface", () => {
    const layout = source("src/app/workspace/layout.tsx")
    const mobile = layout
      .split("function MobileWorkspaceContent")[1]
      .split("function MobileFolderWorkspaceShell")[0]
    expect(mobile).toContain("isConversations && restored && !sidebarOpen")
    expect(mobile).toMatch(/showConversation \? \([\s\S]*?\.\.\.sidebarSwipe/)
    expect(layout.match(/\.\.\.sidebarSwipe/g)).toHaveLength(1)
  })
})
