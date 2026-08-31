import type { ReactElement } from "react"
import { render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import type { AdaptedContentPart } from "@/lib/adapters/ai-elements-adapter"
import { CompletedTurnContent } from "@/components/message/completed-turn-content"
import {
  advanceReplyFold,
  type ReplyFoldState,
} from "@/components/message/message-list-view"

const initialFold: ReplyFoldState = {
  signal: 0,
  epoch: 0,
  armed: false,
  running: false,
  runId: null,
  roundOpen: true,
  roundOpenUserPreference: null,
}

const parts: AdaptedContentPart[] = [
  {
    type: "reasoning",
    content: "Inspecting MaxCode custom behavior",
    isStreaming: false,
  },
  {
    type: "tool-call",
    toolCallId: "contract-command",
    toolName: "Read",
    input: '{"file_path":"src/app.tsx"}',
    state: "output-available",
    output: "source",
  },
  { type: "text", text: "The final answer stays visible." },
]

function withIntl(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe("MaxCode contract: completed reply folding", () => {
  it("keeps live work open and folds it as soon as the round completes", () => {
    const running = advanceReplyFold(initialFold, {
      sendSignal: 0,
      running: true,
      runId: "reply-1",
    })
    expect(running.roundOpen).toBe(true)

    const completed = advanceReplyFold(running, {
      sendSignal: 0,
      running: false,
      runId: "reply-1",
    })
    expect(completed.roundOpen).toBe(false)
    expect(completed.roundOpenUserPreference).toBeNull()

    withIntl(
      <CompletedTurnContent
        parts={parts}
        durationMs={5_000}
        completed
        currentRound
        roundOpen={completed.roundOpen}
        foldEpoch={completed.epoch}
      />
    )

    expect(
      screen.getByRole("button", { name: "Worked for 5s" })
    ).toHaveAttribute("aria-expanded", "false")
    expect(
      screen.queryByText("Inspecting MaxCode custom behavior")
    ).not.toBeInTheDocument()
    expect(screen.getByText("The final answer stays visible.")).toBeVisible()
  })

  it("preserves an explicit reader preference across completion", () => {
    const running: ReplyFoldState = {
      ...advanceReplyFold(initialFold, {
        sendSignal: 0,
        running: true,
        runId: "reply-2",
      }),
      roundOpenUserPreference: true,
    }

    const completed = advanceReplyFold(running, {
      sendSignal: 0,
      running: false,
      runId: "reply-2",
    })

    expect(completed.roundOpen).toBe(true)
  })
})
