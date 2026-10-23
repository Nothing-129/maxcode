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
  it("keeps three latest rows and preserves an expanded summary when more work and text arrive", () => {
    const prefix = [text("Starting"), work, work, work]
    const view = render(timeline(prefix))
    expect(screen.getAllByRole("button", { name: "Thought" })).toHaveLength(3)
    expect(screen.queryByRole("button", { name: /Thought 1 time/ })).toBeNull()

    view.rerender(timeline([...prefix, work]))
    const trigger = screen.getByRole("button", { name: "Thought 1 time" })
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    expect(screen.getAllByRole("button", { name: "Thought" })).toHaveLength(3)
    fireEvent.click(trigger)

    view.rerender(timeline([...prefix, work, work, text(" ")]))
    expect(screen.getByRole("button", { name: "Thought 2 times" })).toBe(
      trigger
    )
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    expect(screen.getAllByRole("button", { name: "Thought" })).toHaveLength(5)

    view.rerender(timeline([...prefix, work, work, text("Update")]))
    expect(screen.getByRole("button", { name: "Thought 5 times" })).toBe(
      trigger
    )
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("Update")).toBeVisible()
  })

  it("folds the complete interval on new text if the reader left it collapsed", () => {
    const parts = [work, work, work, work]
    const view = render(timeline(parts))
    expect(screen.getAllByRole("button", { name: "Thought" })).toHaveLength(3)
    view.rerender(timeline([...parts, text("First update")]))
    expect(
      screen.getByRole("button", { name: "Thought 4 times" })
    ).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("button", { name: "Thought" })).toBeNull()
  })

  it("summarizes grouped and standalone calls by kind without counting results twice", () => {
    const command = {
      type: "tool-call" as const,
      toolCallId: "command-1",
      toolName: "bash",
      input: "pwd",
      output: "ok",
      state: "output-available" as const,
    }
    render(
      timeline([
        text("Starting"),
        {
          type: "tool-group",
          items: [command, { ...command, toolCallId: "command-2" }],
          isStreaming: false,
        },
        work,
        { ...command, toolCallId: "read-1", toolName: "Read" },
        {
          type: "tool-result",
          toolCallId: "command-1",
          output: "ok",
          state: "output-available",
        },
        work,
        text("Update"),
      ])
    )
    expect(
      screen.getByRole("button", {
        name: "Read files 1 time · Ran 2 commands · Thought 2 times",
      })
    ).toHaveAttribute("aria-expanded", "false")
  })

  it("collapses on the next text token and preserves manual expansion on updates", () => {
    const prefix = [text("Starting work"), work]
    const view = render(timeline(prefix))
    expect(screen.queryByRole("button", { name: /Thought 1 time/ })).toBeNull()

    view.rerender(timeline([...prefix, text(" ")]))
    expect(screen.queryByRole("button", { name: /Thought 1 time/ })).toBeNull()

    view.rerender(timeline([...prefix, text("Progress report")]))
    const trigger = screen.getByRole("button", { name: /Thought 1 time/ })
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByText("Starting work")).toBeVisible()
    expect(screen.getByText("Progress report")).toBeVisible()
    expect(screen.queryByText(work.content)).toBeNull()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole("button", { name: "Thought" }))
    expect(screen.getByText(work.content)).toBeVisible()

    view.rerender(
      timeline([...prefix, text("Progress report continues"), work])
    )
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    expect(
      screen.getAllByRole("button", { name: /Thought 1 time/ })
    ).toHaveLength(1)
  })

  it("folds multiple closed intervals independently, including empty text residue", () => {
    render(
      timeline([
        text("First"),
        work,
        text(""),
        text("Second"),
        work,
        text("Third"),
        work,
      ])
    )
    expect(
      screen.getAllByRole("button", { name: /Thought 1 time/ })
    ).toHaveLength(2)
    for (const value of ["First", "Second", "Third"]) {
      expect(screen.getByText(value)).toBeVisible()
    }
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
    expect(screen.queryByRole("button", { name: /Thought 1 time/ })).toBeNull()
    expect(screen.getByText(/Visible error/)).toBeVisible()
    view.rerender(timeline([text("First"), work, text("Second")], "user"))
    expect(screen.queryByRole("button", { name: /Thought 1 time/ })).toBeNull()
  })
})
