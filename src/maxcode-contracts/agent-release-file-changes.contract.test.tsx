import { type ReactNode } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"

import { source } from "./contract-source"
import enMessages from "@/i18n/messages/en.json"
import type { LiveMessage } from "@/contexts/acp-connections-context"
import type { MessageTurn } from "@/lib/types"
import { extractReplyFileChanges } from "@/lib/session-files"
import { extractLiveEditStats } from "@/components/message/live-turn-stats"
import { ContentPartsRenderer } from "@/components/message/content-parts-renderer"

vi.mock("@/components/ai-elements/link-safety", () => ({
  FilePathLink: ({ children }: { children: ReactNode }) => (
    <span>{children}</span>
  ),
  useStreamdownLinkSafety: () => ({ enabled: false }),
}))
vi.mock("@/components/ai-elements/code-block", () => ({
  CodeBlock: ({ code }: { code: string }) => <pre>{code}</pre>,
}))
vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children: string }) => (
    <div>{children}</div>
  ),
}))

// Canonical input recovered from Codex 2.x's multiple standard Diff blocks.
const input = JSON.stringify({
  changes: {
    "/repo/a.ts": [
      { old_text: "oldFirst", new_text: "newFirst" },
      { old_text: "oldSecond", new_text: "newSecond" },
    ],
  },
})

describe("MaxCode reviewed agent releases preserve file changes", () => {
  it("renders every hunk for a single file", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ContentPartsRenderer
          role="assistant"
          parts={[
            {
              type: "tool-call",
              toolCallId: "edit-1",
              toolName: "edit",
              input,
              state: "output-available",
              toolStatus: "completed",
            },
          ]}
        />
      </NextIntlClientProvider>
    )
    fireEvent.click(screen.getByRole("button"))
    expect(container.textContent).toContain("oldFirst")
    expect(container.textContent).toContain("newFirst")
    expect(container.textContent).toContain("oldSecond")
    expect(container.textContent).toContain("newSecond")
  })

  it("counts both hunks live and in the persisted file summary", () => {
    const message: LiveMessage = {
      id: "a1",
      role: "assistant",
      startedAt: 0,
      content: [
        {
          type: "tool_call",
          info: {
            tool_call_id: "edit-1",
            title: "Editing files",
            kind: "edit",
            status: "completed",
            raw_input: input,
            content: null,
            raw_output_chunks: [],
            raw_output_total_bytes: 0,
            locations: null,
            meta: null,
            images: [],
          },
        },
      ],
    }
    expect(extractLiveEditStats(message)).toMatchObject({
      files: 1,
      additions: 2,
      deletions: 2,
    })
    const turns: MessageTurn[] = [
      {
        id: "a1",
        role: "assistant",
        timestamp: "2026-09-30T00:00:00Z",
        blocks: [
          {
            type: "tool_use",
            tool_name: "edit",
            tool_use_id: "edit-1",
            input_preview: input,
            status: "completed",
          },
        ],
      },
    ]
    const files = extractReplyFileChanges(turns)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ additions: 2, deletions: 2 })
    expect(files[0].diff).toContain("newFirst")
    expect(files[0].diff).toContain("newSecond")
  })

  it("executes the independent Rust wire regressions", () => {
    expect(source("src-tauri/src/acp/connection.rs")).toContain(
      "mod maxcode_agent_release_file_changes_contract;"
    )
    expect(
      source("src/maxcode-contracts/agent-release-file-changes.contract.rs")
    ).toContain(
      "fn maxcode_agent_release_codex_preserves_all_hunks_in_wire_order()"
    )
  })
})
