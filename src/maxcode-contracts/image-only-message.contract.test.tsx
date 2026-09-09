import { readFileSync } from "node:fs"
import { render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import enMessages from "@/i18n/messages/en.json"
import {
  HistoricalMessageGroup,
  type ResolvedMessageGroup,
} from "@/components/message/message-list-view"

import {
  buildUserMessageTextPartsFromDraft,
  getPromptDraftDisplayText,
  getPromptDraftMessageText,
} from "@/lib/prompt-draft"
import type { PromptInputBlock } from "@/lib/types"

vi.mock("@/components/message/use-create-task-from-message", () => ({
  useCreateTaskFromMessage: () => vi.fn(),
}))

const group: ResolvedMessageGroup = {
  id: "image-message",
  role: "user",
  parts: [],
  resources: [],
  images: [{ name: "screenshot.png", mime_type: "image/png", data: "AA==" }],
}

function message(parts: ResolvedMessageGroup["parts"]) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <HistoricalMessageGroup group={{ ...group, parts }} showStats={false} />
    </NextIntlClientProvider>
  )
}

describe("MaxCode: image-only user messages", () => {
  it.each([
    { parts: [] },
    { parts: [{ type: "text" as const, text: " \n\t " }] },
  ])("shows the image without an empty bubble for parts %j", ({ parts }) => {
    const { container } = render(message(parts))
    expect(screen.getByRole("img", { name: "screenshot.png" })).toBeTruthy()
    expect(container.querySelector(".chat-message-shell")).toBeNull()
    expect(screen.queryByTestId("collapsible-user-message-content")).toBeNull()
  })

  const imageBlocks: PromptInputBlock[] = [
    { type: "image", data: "AA==", mime_type: "image/png" },
    {
      type: "resource",
      uri: "clipboard://image.png",
      mime_type: "image/png",
      blob: "AA==",
    },
  ]

  it.each(imageBlocks)(
    "does not turn a $type draft summary into a caption",
    (image) => {
      const draft = {
        blocks: [image, { type: "text" as const, text: " \n " }],
        displayText: "Attached 1 attachment",
      }
      const { container } = render(
        message(buildUserMessageTextPartsFromDraft(draft, "Attached resources"))
      )
      expect(screen.getByRole("img", { name: "screenshot.png" })).toBeTruthy()
      expect(container.querySelector(".chat-message-shell")).toBeNull()
      expect(getPromptDraftDisplayText(draft, "Attached resources")).toBe(
        "Attached 1 attachment"
      )
      expect(
        getPromptDraftMessageText(
          { ...draft, displayText: "" },
          "Attached resources"
        )
      ).toBe("")
      const captioned = {
        ...draft,
        blocks: [image, { type: "text" as const, text: draft.displayText }],
      }
      expect(getPromptDraftMessageText(captioned, "Attached resources")).toBe(
        "Attached 1 attachment"
      )
    }
  )

  it("uses message text rather than draft summaries on both optimistic surfaces", () => {
    for (const path of [
      "src/components/conversations/conversation-detail-panel.tsx",
      "src/components/canvas/canvas-conversation-surface.tsx",
    ]) {
      const source = readFileSync(path, "utf8")
      const start = source.indexOf("function buildOptimisticUserTurn")
      const builder = source.slice(start, source.indexOf("\n}\n", start))
      expect(builder).toContain("getPromptDraftMessageText(draft,")
      expect(builder).toContain('if (text) blocks.push({ type: "text", text })')
      expect(builder).not.toContain("getPromptDraftDisplayText(draft,")
    }
  })

  it("keeps the text bubble when a caption accompanies an image", () => {
    const { container, rerender } = render(message([]))
    rerender(message([{ type: "text", text: "Describe this screenshot" }]))
    expect(screen.getByRole("img", { name: "screenshot.png" })).toBeTruthy()
    expect(
      container.querySelector(".chat-message-shell")?.textContent
    ).toContain("Describe this screenshot")
    rerender(message([]))
    expect(container.querySelector(".chat-message-shell")).toBeNull()
  })
})
