import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import { AskQuestionCard } from "@/components/chat/ask-question-card"
import enMessages from "@/i18n/messages/en.json"

describe("MaxCode reference question picker", () => {
  it("uses a quiet numbered list while retaining explicit answer confirmation", () => {
    const onAnswer = vi.fn()
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AskQuestionCard
          question={{
            question_id: "reference",
            created_at: "2026-09-10T00:00:00Z",
            questions: [
              {
                id: "approach",
                header: "Approach",
                question: "Which approach?",
                multi_select: false,
                options: [
                  {
                    label: "Incremental (Recommended)",
                    description: "Small changes",
                  },
                  { label: "Rewrite", description: "Start fresh" },
                ],
              },
            ],
          }}
          onAnswer={onAnswer}
        />
      </NextIntlClientProvider>
    )
    const shell = screen.getByRole("group")
    expect(shell).toHaveClass("rounded-[20px]", "border-border", "shadow-sm")
    expect(shell).not.toHaveClass("shadow-lg", "border-primary/30")
    expect(screen.getAllByText("Which approach?")).toHaveLength(1)
    expect(
      screen.queryByText(enMessages.Folder.chat.askQuestion.subtitle)
    ).toBeNull()
    const first = screen.getAllByRole("radio")[0]
    const row = first.closest("label")!
    expect(row).toHaveClass("border", "bg-muted/70", "min-h-12", "items-center")
    expect(screen.getByText("Which approach?")).toHaveClass("font-semibold")
    expect(row.querySelector('[aria-hidden="true"]')).toHaveTextContent("1")
    fireEvent.click(first)
    expect(first).toHaveAttribute("aria-checked", "true")
    expect(row).toHaveClass("bg-foreground/10", "border-foreground/35")
    expect(row.querySelector('[aria-hidden="true"]')).toHaveClass(
      "bg-foreground",
      "text-background"
    )
    expect(onAnswer).not.toHaveBeenCalled()
    expect(container.querySelector("svg.lucide-pencil")).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", {
        name: enMessages.Folder.chat.askQuestion.submit,
      })
    )
    expect(onAnswer).toHaveBeenCalledWith("reference", {
      declined: false,
      answers: [
        { questionId: "approach", labels: ["Incremental (Recommended)"] },
      ],
    })
  })
})
