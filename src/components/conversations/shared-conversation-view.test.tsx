import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SharedConversationSnapshot } from "@/lib/types"
import { SharedConversationView } from "./shared-conversation-view"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

const TOKEN = "a".repeat(32)
const NOW = "2026-09-02T07:25:00Z"
const SNAPSHOT: SharedConversationSnapshot = {
  version: 1,
  title: "Public transcript",
  agent_type: "codex",
  model: "gpt-5",
  message_count: 1,
  created_at: NOW,
  updated_at: NOW,
  shared_at: NOW,
  turns: [
    {
      id: "assistant-1",
      role: "assistant",
      timestamp: NOW,
      blocks: [
        {
          type: "text",
          text: "Read [the docs](https://example.com/docs) and /repo/app.ts",
        },
      ],
    },
  ],
}

describe("SharedConversationView", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", `/share#${TOKEN}`)
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(SNAPSHOT), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
      )
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    window.history.replaceState(null, "", "/")
  })

  it("renders links without a WorkspaceProvider and keeps paths read-only", async () => {
    render(<SharedConversationView />)

    expect(
      await screen.findByRole("heading", { name: "Public transcript" })
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /the docs/ })).toHaveAttribute(
      "href",
      "https://example.com/docs"
    )
    expect(screen.getByText("/repo/app.ts")).not.toHaveAttribute("href")
  })
})
