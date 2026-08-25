import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import type { AdaptedContentPart } from "@/lib/adapters/ai-elements-adapter"
import {
  ContentPartsRenderer,
  splitCompletedAssistantActivity,
} from "./content-parts-renderer"

const COMPLETED_PARTS: AdaptedContentPart[] = [
  { type: "text", text: "I will inspect the source." },
  { type: "reasoning", content: "Internal work detail", isStreaming: false },
  { type: "text", text: "Final answer" },
]

function renderParts(isResponseComplete: boolean) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ContentPartsRenderer
        parts={COMPLETED_PARTS}
        role="assistant"
        isResponseComplete={isResponseComplete}
        durationMs={68_000}
      />
    </NextIntlClientProvider>
  )
}

describe("completed assistant activity summary", () => {
  it("splits only a safe activity prefix from the final text", () => {
    const split = splitCompletedAssistantActivity(COMPLETED_PARTS)
    expect(split?.activity).toEqual(COMPLETED_PARTS.slice(0, 2))
    expect(split?.answer).toEqual(COMPLETED_PARTS.slice(2))

    const generatedImageBeforeAnswer: AdaptedContentPart[] = [
      {
        type: "generated-image",
        revisedPrompt: null,
        image: null,
        status: "completed",
      },
      COMPLETED_PARTS[1],
      COMPLETED_PARTS[2],
    ]
    expect(
      splitCompletedAssistantActivity(generatedImageBeforeAnswer)
    ).toBeNull()
  })

  it("collapses completed work while leaving the final answer visible", () => {
    renderParts(true)

    const trigger = screen.getByRole("button", {
      name: "Processed 1m 8s",
    })
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByText("Final answer")).toBeInTheDocument()
    expect(
      screen.queryByText("I will inspect the source.")
    ).not.toBeInTheDocument()

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("I will inspect the source.")).toBeInTheDocument()
  })

  it("keeps the live work log expanded in the normal timeline", () => {
    renderParts(false)

    expect(screen.queryByText("Processed 1m 8s")).not.toBeInTheDocument()
    expect(screen.getByText("I will inspect the source.")).toBeInTheDocument()
    expect(screen.getByText("Final answer")).toBeInTheDocument()
  })
})
