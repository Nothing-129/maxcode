import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it } from "vitest"
import enMessages from "@/i18n/messages/en.json"
import { CompletedTurnContent } from "@/components/message/completed-turn-content"
import { groupProgressSections } from "@/components/message/progress-sections"
import type { AdaptedContentPart } from "@/lib/adapters/ai-elements-adapter"

function steps(count: number): AdaptedContentPart[] {
  return Array.from({ length: count }, (_, i): AdaptedContentPart[] => [
    { type: "text", text: `Progress note ${i}` },
    { type: "reasoning", content: `Thought ${i}`, isStreaming: false },
    {
      type: "tool-group",
      isStreaming: false,
      items: [
        {
          type: "tool-call",
          toolCallId: `call-${i}`,
          toolName: "Read",
          input: `{"file_path":"step-${i}.ts"}`,
          state: "output-available",
          output: "done",
        },
      ],
    },
  ]).flat()
}
function tree(parts: AdaptedContentPart[], completed = false) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CompletedTurnContent parts={parts} completed={completed} />
    </NextIntlClientProvider>
  )
}
describe("MaxCode contract: prose separates collapsed activity sections", () => {
  it("preserves every note while grouping the steps below each note", () => {
    const { rerender, container } = render(tree(steps(3)))
    for (let i = 0; i < 3; i++)
      expect(screen.getByText(`Progress note ${i}`)).toBeVisible()
    expect(screen.getAllByRole("button", { name: "2 steps" })).toHaveLength(3)
    expect(screen.queryByText("Thought 0")).toBeNull()
    expect(container.querySelector("[data-live-progress-preview]")).toBeNull()
    const groups = groupProgressSections(steps(3))
    expect(groups.map((section) => section.activity)).toEqual([
      false,
      true,
      false,
      true,
      false,
      true,
    ])
    expect(
      groups
        .filter((section) => section.activity)
        .every((section) => section.parts.every((part) => part.type !== "text"))
    ).toBe(true)
    fireEvent.click(screen.getAllByRole("button", { name: "2 steps" })[0])
    expect(
      screen.getAllByRole("button", { name: "2 steps" })[0]
    ).toHaveAttribute("aria-expanded", "true")
    expect(
      screen.getAllByRole("button", { name: "2 steps" })[1]
    ).toHaveAttribute("aria-expanded", "false")
    rerender(tree(steps(4)))
    for (let i = 0; i < 4; i++)
      expect(screen.getByText(`Progress note ${i}`)).toBeVisible()
    expect(
      screen.getAllByRole("button", { name: "2 steps" })[0]
    ).toHaveAttribute("aria-expanded", "true")
  })
  it("preserves all intermediate prose in cancelled turns without a final answer", () => {
    render(tree(steps(3), true))
    for (let i = 0; i < 3; i++)
      expect(screen.getByText(`Progress note ${i}`)).toBeVisible()
    expect(screen.getAllByRole("button", { name: "2 steps" })).toHaveLength(3)
  })
  it("keeps plans and artifacts outside the activity disclosures", () => {
    const plan: AdaptedContentPart = {
      type: "proposed-plan",
      markdown: "Review this plan",
      isStreaming: false,
    }
    const groups = groupProgressSections([...steps(1), plan, ...steps(1)])
    expect(
      groups.find((section) => section.parts.includes(plan))?.activity
    ).toBe(false)
    expect(groups.flatMap((section) => section.parts)).toEqual([
      ...steps(1),
      plan,
      ...steps(1),
    ])
  })
  it("folds the completed round while keeping its final answer visible", () => {
    render(tree([...steps(3), { type: "text", text: "Final answer" }], true))
    expect(screen.getByText("Final answer")).toBeVisible()
    expect(screen.queryByText("Progress note 0")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Finished working" }))
    for (let i = 0; i < 3; i++)
      expect(screen.getByText(`Progress note ${i}`)).toBeVisible()
  })
})
