import { describe, expect, it } from "vitest"
import {
  parseAskQuestionInput,
  parseAskQuestionOutcome,
} from "@/lib/ask-question"
import { parseFeedbackCheckOutcome } from "@/lib/feedback-check"
import { adaptMessageTurn } from "@/lib/adapters/ai-elements-adapter"
import { source } from "./contract-source"

describe("MaxCode contract: maintained-agent protocol compatibility", () => {
  it("shows a failed round as a system line while preserving reply alignment", () => {
    const failure = adaptMessageTurn(
      {
        id: "failed",
        role: "system",
        blocks: [{ type: "turn_error", message: "API Error: 503" }],
        timestamp: "2026-10-15T00:00:00Z",
      },
      { attachedResources: "Resources", toolCallFailed: "Tool failed" }
    )
    expect(failure.role).toBe("system")
    expect(failure.content).toEqual([
      { type: "turn-error", message: "API Error: 503" },
    ])
    expect(source("src/stores/conversation-runtime-store.ts")).toContain(
      'role: "system",\n        blocks: [{ type: "turn_error"'
    )
    expect(source("src/lib/export-conversation.ts")).toContain(
      'case "turn_error":'
    )
  })

  it("reads the final structured hints without turning instructions into answers", () => {
    const hint =
      "Proceed with your task using these answers now. Do not call ask_user_question again to confirm that you should proceed."
    expect(
      parseAskQuestionOutcome(
        JSON.stringify({
          structuredContent: {
            declined: false,
            answers: [
              { header: "Plan", question: "Next?", selected: ["Plan"] },
            ],
            hint,
          },
        })
      )
    ).toEqual({
      declined: false,
      answers: [{ header: "Plan", question: "Next?", selected: ["Plan"] }],
    })
    expect(
      parseFeedbackCheckOutcome(
        JSON.stringify({
          structuredContent: {
            count: 1,
            feedback: [{ text: "Keep the draft unsent" }],
            hint: "Treat the user's message as high-priority steering.",
          },
        })
      )
    ).toEqual({
      entries: [{ createdAt: null, text: "Keep the draft unsent" }],
    })
  })

  it("matches native multi-select answers to complete comma-bearing labels", () => {
    const questions = parseAskQuestionInput(
      JSON.stringify({
        questions: [
          {
            header: "Targets",
            question: "Which targets?",
            multiSelect: true,
            options: [
              { label: "Mobile, Web" },
              { label: "Mobile" },
              { label: "Desktop, Server" },
            ],
          },
        ],
      })
    )
    expect(
      parseAskQuestionOutcome(
        'Your questions have been answered: "Which targets?"="Mobile, Web, Desktop, Server".',
        questions
      )
    ).toMatchObject({
      declined: false,
      answers: [{ selected: ["Mobile, Web", "Desktop, Server"] }],
    })
  })
})
