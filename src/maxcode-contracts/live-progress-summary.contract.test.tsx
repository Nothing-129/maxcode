import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it } from "vitest"
import enMessages from "@/i18n/messages/en.json"
import { CompletedTurnContent } from "@/components/message/completed-turn-content"
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
describe("MaxCode contract: upstream-style progress disclosures", () => {
  it("keeps prose visible and folds intervening activity into expandable summaries", () => {
    const { rerender, container } = render(tree(steps(3)))
    for (let i = 0; i < 3; i++)
      expect(screen.getByText(`Progress note ${i}`)).toBeVisible()
    expect(screen.queryByText("2 steps")).toBeNull()
    expect(container.querySelector("[data-activity-section]")).toBeNull()
    const summaries = screen.getAllByRole("button", {
      name: "Read files 1 time · Thought 1 time",
    })
    expect(summaries[0]).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(summaries[0])
    const thinking = screen.getAllByRole("button", { name: "Thought" })
    expect(thinking).toHaveLength(2)
    expect(thinking[0]).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(thinking[0])
    expect(screen.getByText("Thought 0")).toBeVisible()
    expect(thinking[1]).toHaveAttribute("aria-expanded", "false")
    rerender(tree(steps(4)))
    expect(screen.getByText("Thought 0")).toBeVisible()
    expect(screen.getByText("Progress note 3")).toBeVisible()
  })
  it("preserves intermediate prose in cancelled turns without a final answer", () => {
    render(tree(steps(3), true))
    for (let i = 0; i < 3; i++)
      expect(screen.getByText(`Progress note ${i}`)).toBeVisible()
    expect(screen.queryByText("2 steps")).toBeNull()
  })
  it("keeps command groups directly expandable beside thinking", () => {
    render(
      tree([
        { type: "text", text: "Checking the project" },
        {
          type: "tool-group",
          isStreaming: false,
          items: [0, 1].map((i) => ({
            type: "tool-call" as const,
            toolCallId: `command-${i}`,
            toolName: "exec_command",
            input: JSON.stringify({ cmd: `echo check-${i}` }),
            state: "output-available" as const,
            output: "done",
          })),
        },
        { type: "reasoning", content: "Inspect results", isStreaming: false },
      ])
    )
    const commands = screen.getByRole("button", { name: "Ran 2 commands" })
    expect(commands).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(commands)
    expect(screen.getByRole("button", { name: /echo check-0/ })).toBeVisible()
    expect(screen.queryByText("Inspect results")).toBeNull()
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
