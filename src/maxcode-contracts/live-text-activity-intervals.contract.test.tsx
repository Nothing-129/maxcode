import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it } from "vitest"

import { ContentPartsRenderer } from "@/components/message/content-parts-renderer"
import enMessages from "@/i18n/messages/en.json"
import type { AdaptedContentPart } from "@/lib/adapters/ai-elements-adapter"

const text = (value: string): AdaptedContentPart => ({
  type: "text",
  text: value,
})
const work: AdaptedContentPart = {
  type: "reasoning",
  content: "Inspecting the implementation",
  isStreaming: false,
}

// Live Markdown wraps characters for the fade; query the complete rendered
// response rather than requiring all its text to be in one DOM text node.
function responseText(value: string) {
  return screen.findByText((_, element) =>
    Boolean(element?.matches(".chat-markdown") && element.textContent === value)
  )
}

function timeline(
  parts: AdaptedContentPart[],
  role: "assistant" | "user" = "assistant"
) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ContentPartsRenderer parts={parts} role={role} isStreaming />
    </NextIntlClientProvider>
  )
}

describe("live text activity intervals", () => {
  it("collapses all live work from the first row, including the newest three", async () => {
    const prefix = [text("Starting"), work]
    const view = render(timeline(prefix))
    const summary = screen.getByRole("button", { name: "Thought 1 time" })
    expect(summary).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByText(work.content)).toBeNull()
    view.rerender(timeline([...prefix, work, work, work, work]))
    expect(screen.getByRole("button", { name: "Thought 5 times" })).toBe(
      summary
    )
    expect(summary).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("button", { name: "Thought" })).toBeNull()
    fireEvent.click(summary)
    expect(screen.getAllByText(work.content)).toHaveLength(5)
    view.rerender(timeline([...prefix, work, work, work, work, text("Update")]))
    expect(summary).toHaveAttribute("aria-expanded", "true")
    expect(await responseText("Update")).toBeVisible()
  })

  it("does not fold across a result card or fold user content", () => {
    const view = render(
      timeline([
        text("First"),
        work,
        { type: "turn-error", message: "Visible error" },
        text("Second"),
      ])
    )
    expect(
      screen.getByRole("button", { name: "Thought 1 time" })
    ).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByText(/Visible error/)).toBeVisible()
    view.rerender(timeline([text("First"), work, text("Second")], "user"))
    expect(screen.queryByRole("button", { name: /Thought 1 time/ })).toBeNull()
  })
})
