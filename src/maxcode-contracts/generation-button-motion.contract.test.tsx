import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { GenerationActionIcon } from "@/components/chat/composer/generation-action-icon"
import { source } from "./contract-source"

afterEach(cleanup)

describe("generation button motion", () => {
  it("retains both decorative glyphs across repeated running/send changes", () => {
    const view = render(<GenerationActionIcon running={false} />)
    const icon = view.container.firstElementChild
    const stop = icon?.querySelector('[data-generation-glyph="stop"]')
    const send = icon?.querySelector('[data-generation-glyph="send"]')
    expect(stop).not.toBeNull()
    expect(send).not.toBeNull()
    expect(icon).toHaveAttribute("aria-hidden", "true")
    for (const running of [true, false, true, false]) {
      view.rerender(<GenerationActionIcon running={running} />)
      expect(view.container.firstElementChild).toBe(icon)
      expect(icon).toHaveAttribute("data-running", String(running))
      expect(icon?.querySelector('[data-generation-glyph="stop"]')).toBe(stop)
      expect(icon?.querySelector('[data-generation-glyph="send"]')).toBe(send)
    }
  })

  it("animates both real stop buttons and send without delaying their actions", () => {
    const input = source("src/components/chat/message-input.tsx")
    const stops = [
      ...input.matchAll(/<Button\s+onClick=\{onCancel\}[\s\S]*?<\/Button>/g),
    ]
    expect(stops).toHaveLength(2)
    for (const [stop] of stops) {
      expect(stop).toContain('data-generation-running="true"')
      expect(stop).toContain("maxcode-generation-button")
      expect(stop).toContain("<GenerationActionIcon running />")
      expect(stop).toContain('aria-label={t("cancel")}')
    }
    const send = input.slice(input.indexOf("// MaxCode 发送钮"))
    expect(send).toContain('data-generation-running="false"')
    expect(send).toContain(
      "<GenerationActionIcon running={false} ready={!sendDisabled} />"
    )
    expect(send).toContain("onClick={handleSend}")
  })

  it("breathes only the halo, crossfades glyphs, and suppresses travel for reduced motion", () => {
    const css = source("src/app/interaction-motion.css")
    expect(css).toContain("maxcode-generation-halo 2s ease-in-out infinite")
    expect(css).toContain("transition: opacity 160ms ease-out")
    expect(css).toContain("scale: 1.04")
    expect(css).toContain("scale: 0.94")
    const reduced = css.slice(
      css.indexOf("@media (prefers-reduced-motion: reduce)")
    )
    expect(reduced).toContain("scale: 1")
    expect(reduced).toContain("animation: none")
    expect(reduced).toContain("transition-duration: 100ms")
  })
})
