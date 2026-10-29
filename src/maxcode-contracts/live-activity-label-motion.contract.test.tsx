import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
import { TurnStatusLabel } from "@/components/message/turn-status"
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
  expect(code).toMatch(/showCounts\s+active=\{isStreaming\}/)
  expect(code).toContain("active = false")
})
it("uses a steady CSS highlight and stops it for accessibility and hidden views", () => {
  const css = source("src/app/motion.css")
  const rules = css.slice(css.indexOf("/* Live transcript labels:"))
  expect(rules).toContain("maxcode-waiting-shine 1.8s linear infinite")
  expect(rules).not.toMatch(/opacity:|transform:/)
  expect(rules).toContain("prefers-reduced-motion: reduce")
  expect(rules).toContain("animation: none")
  expect(rules).toContain("animation-play-state: paused")
  expect(rules).toContain("color: CanvasText")
})
