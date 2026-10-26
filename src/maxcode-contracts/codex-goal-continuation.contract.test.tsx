import { render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it } from "vitest"
import { GoalRunPart } from "@/components/message/goal-tool-call"
import { groupGoalRuns } from "@/lib/adapters/ai-elements-adapter"
import type { AdaptedGoalRunPart } from "@/lib/adapters/ai-elements-adapter"
import messages from "@/i18n/messages/en.json"

describe("Codex automatic goal continuation", () => {
  it("shows a running indicator at the bottom of an open goal after continuation starts", () => {
    const start: AdaptedGoalRunPart["start"] = {
      type: "tool-call",
      toolCallId: "goal-1",
      toolName: "create_goal",
      input: JSON.stringify({ objective: "Analyze calls" }),
      state: "output-available",
    }
    const part = groupGoalRuns(
      [start, { type: "text", text: "Continuing analysis" }],
      true
    )[0] as AdaptedGoalRunPart
    const ui = (run: AdaptedGoalRunPart) => (
      <NextIntlClientProvider locale="en" messages={messages}>
        <GoalRunPart
          part={run}
          renderPart={(item, key) =>
            item.type === "text" ? <div key={key}>{item.text}</div> : null
          }
        />
      </NextIntlClientProvider>
    )
    const { rerender } = render(ui(part))
    expect(screen.getByText("Continuing analysis")).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent(
      messages.Folder.chat.contentParts.goal.status.active
    )
    expect(screen.getByRole("status").querySelector("svg")).toHaveClass(
      "animate-spin"
    )
    rerender(ui({ ...part, isRunning: false }))
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    expect(screen.queryByText("Continuing analysis")).not.toBeInTheDocument()
  })
})
