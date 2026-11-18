import { useState } from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import enMessages from "@/i18n/messages/en.json"
import { MessageScrollProvider } from "@/components/message/message-scroll-context"
import { CompletedTurnContent } from "@/components/message/completed-turn-content"
import type { AdaptedContentPart } from "@/lib/adapters/ai-elements-adapter"

const parts: AdaptedContentPart[] = [
  { type: "text", text: "Inspecting files" },
  {
    type: "tool-call",
    toolCallId: "live-read",
    toolName: "Read",
    input: '{"file_path":"src/app.tsx"}',
    state: "input-available",
  },
]

function LiveRound() {
  const [open, setOpen] = useState(true)
  return (
    <CompletedTurnContent
      parts={parts}
      completed={false}
      currentRound
      roundOpen={open}
      onRoundOpenChange={setOpen}
    />
  )
}

describe("live turn disclosure", () => {
  it.each([true, false])(
    "can reopen a working turn (controlled: %s)",
    async (controlled) => {
      const user = userEvent.setup()
      const stopFollowing = vi.fn()
      render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <MessageScrollProvider
            value={{ stopFollowing, scrollToIndex: () => {} }}
          >
            {controlled ? (
              <LiveRound />
            ) : (
              <CompletedTurnContent parts={parts} completed={false} />
            )}
          </MessageScrollProvider>
        </NextIntlClientProvider>
      )
      const trigger = screen.getByRole("button", { name: "Working..." })
      for (let i = 0; i < 3; i++) {
        await user.click(trigger.querySelector("span")!)
        expect(trigger).toHaveAttribute("aria-expanded", "false")
        stopFollowing.mockClear()
        await user.click(trigger.querySelector("span")!)
        expect(trigger).toHaveAttribute("aria-expanded", "true")
        expect(stopFollowing).toHaveBeenCalledTimes(1)
      }
      expect(
        screen.getByRole("button", { name: "Read files 1 time" })
      ).toBeVisible()
    }
  )
})
