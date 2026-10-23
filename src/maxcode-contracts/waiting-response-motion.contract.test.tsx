import { cleanup, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it } from "vitest"
import { WaitingDots } from "@/components/message/waiting-dots"
import { LiveTurnStats } from "@/components/message/live-turn-stats"
import type { LiveMessage } from "@/contexts/acp-connections-context"
import zh from "@/i18n/messages/zh-CN.json"
import { source } from "./contract-source"

afterEach(cleanup)

describe("MaxCode: waiting response text animation", () => {
  it("animates only waiting, stopping for confirmation, output and completion", () => {
    const message: LiveMessage = {
      id: "waiting-test",
      role: "assistant",
      content: [],
      startedAt: Date.now(),
    }
    const view = (awaitingUser = false, isStreaming = true, output = false) => (
      <NextIntlClientProvider locale="zh-CN" messages={zh}>
        <LiveTurnStats
          message={
            output
              ? { ...message, content: [{ type: "text", text: "你好" }] }
              : message
          }
          agentType="codex"
          awaitingUser={awaitingUser}
          isStreaming={isStreaming}
        />
      </NextIntlClientProvider>
    )
    const { rerender } = render(view())
    expect(screen.getByRole("status")).toHaveTextContent("等待响应")
    expect(screen.getByRole("status")).toHaveClass("maxcode-waiting-label")
    rerender(view(true))
    expect(screen.getByRole("status")).toHaveTextContent("等待你的确认")
    expect(screen.getByRole("status")).not.toHaveClass("maxcode-waiting-label")
    rerender(view(false, true, true))
    expect(screen.getByRole("status")).not.toHaveClass("maxcode-waiting-label")
    rerender(view(false, false))
    expect(screen.getByRole("status")).toHaveTextContent("响应已结束")
    expect(screen.getByRole("status")).not.toHaveClass("maxcode-waiting-label")
  })

  it("shows three decorative waiting dots and retains accessible status text", () => {
    const list = source("src/components/message/message-list-view.tsx")
    const pending = list.slice(
      list.indexOf("const PendingTypingIndicator"),
      list.indexOf("const AutoScrollOnSend")
    )
    expect(pending).toContain("<WaitingDots />")
    expect(pending).toContain('className="sr-only"')
    const { container } = render(<WaitingDots />)
    expect(container.querySelectorAll(".maxcode-waiting-dot")).toHaveLength(3)
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true")
    const css = source("src/app/motion.css")
    expect(css).toContain("animation-delay: 0.2s")
    expect(css).toContain("animation-delay: 0.4s")
    expect(css).toMatch(
      /prefers-reduced-motion: reduce[^}]*\.maxcode-waiting-dot\s*\{\s*animation: none/s
    )
    expect(pending).toContain('role="status"')
    expect(pending).not.toContain("<ActivityStatusIcon")
  })

  it("uses CSS-only motion, keeps reduced-motion text visible and pauses hidden tabs", () => {
    const css = source("src/app/motion.css")
    expect(css).toContain("maxcode-waiting-shine 1.8s linear infinite")
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.maxcode-waiting-label\s*\{\s*background-image: none;\s*color: inherit;\s*animation: maxcode-waiting-breathe/
    )
    expect(css).toContain(".conversation-tab-hidden .maxcode-waiting-label")
    expect(css).toContain("animation-play-state: paused")
    expect(css).toContain("color: CanvasText")
  })
})
