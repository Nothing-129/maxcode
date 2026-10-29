import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
import { TurnStatusLabel } from "@/components/message/turn-status"
import { NextIntlClientProvider } from "next-intl"
import { ContentPartsRenderer } from "@/components/message/content-parts-renderer"
import enMessages from "@/i18n/messages/en.json"
import type { AdaptedContentPart } from "@/lib/adapters/ai-elements-adapter"
import { source } from "./contract-source"
afterEach(cleanup)
it("animates enabled labels without animating settled labels", () => {
  const view = render(<TurnStatusLabel>等待响应</TurnStatusLabel>)
  expect(screen.getByRole("status")).not.toHaveClass(
    "maxcode-live-activity-label"
  )
  view.rerender(<TurnStatusLabel active>正在工作中...</TurnStatusLabel>)
  expect(screen.getByRole("status")).toHaveClass("maxcode-live-activity-label")
  view.rerender(<TurnStatusLabel>已完成</TurnStatusLabel>)
  expect(screen.getByRole("status")).not.toHaveClass(
    "maxcode-live-activity-label"
  )
})
it("wires live headers and count summaries while keeping completed summaries static", () => {
  expect(source("src/components/message/completed-turn-content.tsx")).toContain(
    'pendingLabel === tElapsed("thinkingPending")'
  )
  const code = source("src/components/message/content-parts-renderer.tsx")
  expect(code).toContain('active && "maxcode-live-activity-label"')
  expect(code).toContain(
    "isStreaming && !isResponseComplete && end === parts.length"
  )
  expect(code).toContain("active = false")
})
it("uses a steady CSS highlight and stops it for accessibility and hidden views", () => {
  const css = source("src/app/motion.css")
  const rules = css.slice(css.indexOf("/* Live transcript labels:"))
  expect(rules).toContain("maxcode-waiting-shine 1.8s linear infinite")
  expect(rules).not.toMatch(/opacity:|transform:/)
  // Match the original Shimmer: a light sweep on light themes, a dark
  // sweep on dark themes. Foreground-colored sweeps look almost static.
  expect(rules).toContain("var(--background) 50%")
  expect(rules).not.toContain("var(--foreground) 50%")
  expect(rules).toContain("prefers-reduced-motion: reduce")
  expect(rules).toContain("animation: none")
  expect(rules).toContain("animation-play-state: paused")
  expect(rules).toContain("color: CanvasText")
})

it("moves the sheen to the last activity interval and stops on prose or completion", () => {
  const work: AdaptedContentPart = {
    type: "reasoning",
    content: "Inspecting",
    isStreaming: false,
  }
  const text = (value: string): AdaptedContentPart => ({
    type: "text",
    text: value,
  })
  const timeline = (
    parts: AdaptedContentPart[],
    streaming = true,
    complete = false
  ) => (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ContentPartsRenderer
        parts={parts}
        role="assistant"
        isStreaming={streaming}
        isResponseComplete={complete}
      />
    </NextIntlClientProvider>
  )
  const parts = [
    work,
    text("First update"),
    work,
    work,
    text("Second update"),
    work,
    work,
    work,
  ]
  const view = render(timeline(parts))
  const active = () =>
    view.container.querySelectorAll(".maxcode-live-activity-label")
  expect(active()).toHaveLength(1)
  expect(active()[0]).toHaveTextContent("Thought 3 times")
  expect(
    screen
      .getByRole("button", { name: "Thought 1 time" })
      .querySelector(".maxcode-live-activity-label")
  ).toBeNull()
  view.rerender(timeline([...parts, text("Next update")]))
  expect(active()).toHaveLength(0)
  view.rerender(timeline([...parts, text("Next update"), work, text(" ")]))
  expect(active()).toHaveLength(1)
  expect(active()[0]).toHaveTextContent("Thought 1 time")
  view.rerender(timeline(parts, false))
  expect(active()).toHaveLength(0)
  view.rerender(timeline(parts, true, true))
  expect(active()).toHaveLength(0)
})
