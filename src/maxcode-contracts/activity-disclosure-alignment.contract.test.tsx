import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import { ContentPartsRenderer } from "@/components/message/content-parts-renderer"
import type { AdaptedContentPart } from "@/lib/adapters/ai-elements-adapter"

const parts: AdaptedContentPart[] = [
  {
    type: "tool-group",
    isStreaming: false,
    items: [
      {
        type: "tool-call",
        toolName: "Read",
        toolCallId: "alignment-read",
        state: "output-available",
        input: JSON.stringify({ file_path: "/tmp/example.ts" }),
        output: "const example = 1",
      },
    ],
  },
  { type: "reasoning", content: "Inspect the result", isStreaming: false },
  { type: "text", text: "Final answer" },
]

function expectAlignedTitle(button: HTMLElement) {
  expect(button).toHaveClass(
    "w-fit",
    "max-w-full",
    "px-0",
    "justify-start",
    "text-left"
  )
  expect(button.firstElementChild?.tagName).toBe("SPAN")
  expect(button.lastElementChild).toHaveClass("lucide-chevron-right")
  expect(button.querySelector(".lucide-brain")).toBeNull()
}

describe("activity disclosure alignment", () => {
  it("keeps nested titles at the prose edge when the work log is expanded", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ContentPartsRenderer
          parts={parts}
          role="assistant"
          isResponseComplete
          durationMs={1000}
        />
      </NextIntlClientProvider>
    )
    const summary = screen.getByRole("button", { name: "Processed 1s" })
    expectAlignedTitle(summary)
    fireEvent.click(summary)
    const body = document.getElementById(
      summary.getAttribute("aria-controls")!
    )!
    expect(body.firstElementChild).not.toHaveClass("pl-3", "border-l")
    expect(
      screen.queryByRole("button", { name: "Read files 1 time" })
    ).toBeNull()
    expect(screen.queryByRole("button", { name: "Thought" })).toBeNull()
    expect(screen.getByText("Inspect the result")).toBeVisible()
    expect(screen.getByText("Final answer")).toBeVisible()
  })

  it("keeps tool title alignment through opening and closing its details", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ContentPartsRenderer parts={[parts[0]]} role="assistant" />
      </NextIntlClientProvider>
    )
    const group = screen.getByRole("button")
    const originalClass = group.className
    expectAlignedTitle(group)
    fireEvent.click(group)
    expect(group).toHaveAttribute("aria-expanded", "true")
    const body = document.getElementById(group.getAttribute("aria-controls")!)!
    expect(body.firstElementChild).not.toHaveClass("pl-3")
    expect(group.className).toBe(originalClass)
    fireEvent.click(group)
    expect(group).toHaveAttribute("aria-expanded", "false")
    expect(group.className).toBe(originalClass)
  })
})
