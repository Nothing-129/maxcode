import { render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it } from "vitest"
import enMessages from "@/i18n/messages/en.json"
import { CompletedTurnContent } from "@/components/message/completed-turn-content"
import type { AdaptedContentPart } from "@/lib/adapters/ai-elements-adapter"
import { source } from "./contract-source"

const tree = (parts: AdaptedContentPart[]) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>
    <CompletedTurnContent completed={false} parts={parts} />
  </NextIntlClientProvider>
)

describe("thinking to working handoff", () => {
  it("keeps empty placeholders thinking, then updates the same status span", () => {
    const view = render(tree([{ type: "text", text: "" }]))
    const label = screen.getByText("Thinking")
    const heading = label.parentElement
    expect(label).toHaveClass("maxcode-turn-status")
    view.rerender(tree([{ type: "text", text: "Checking messages" }]))
    const working = screen.getByText(enMessages.Folder.chat.messageList.working)
    expect(working).toBe(label)
    expect(working.parentElement).toBe(heading)
  })

  it("shares pending typography, keeps confirmation explicit and avoids dots", () => {
    const code = source("src/components/message/message-list-view.tsx")
    expect(code).toContain('className="pt-4"')
    expect(code).toContain("`${TURN_HEADING_CLASS} !border-transparent`")
    expect(code).toContain(
      '<TurnStatusLabel>{t("thinkingPending")}</TurnStatusLabel>'
    )
    expect(code).toContain('{t("awaitingUser")}')
    expect(code).not.toContain("WaitingDots")
    expect(source("src/components/message/turn-feedback.tsx")).toContain(
      'kind === "reply" && hadWaiting'
    )
  })

  it("disables the sweep for reduced motion", () => {
    expect(source("src/app/globals.css")).toMatch(
      /prefers-reduced-motion: reduce\)\s*\{\s*\.maxcode-turn-status\s*\{\s*animation: none/
    )
  })
})
