import { cleanup, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it } from "vitest"
import { LiveTurnStats } from "@/components/message/live-turn-stats"
import { ContextCompactionCard } from "@/components/message/context-compaction-card"
import { getAgentActivity } from "@/lib/agent-activity"
import type {
  LiveContentBlock,
  LiveMessage,
} from "@/contexts/acp-connections-context"
import zh from "@/i18n/messages/zh-CN.json"

const meta = { contextCompaction: { version: 1 } }
const tool = (
  status: string,
  toolMeta: Record<string, unknown> | null = meta
): LiveContentBlock => ({
  type: "tool_call",
  info: {
    tool_call_id: "compact-1",
    title: "Context compaction",
    kind: "think",
    status,
    content: null,
    raw_input: null,
    raw_output_chunks: [],
    raw_output_total_bytes: 0,
    locations: null,
    meta: toolMeta,
    images: [],
  },
})
const message = (content: LiveContentBlock[]): LiveMessage => ({
  id: "turn-1",
  role: "assistant",
  startedAt: Date.now(),
  content,
})
afterEach(cleanup)

describe("Codex server compaction feedback", () => {
  it("shows the same explicit Chinese state in the card and bottom status then resumes output", () => {
    const tree = (running: boolean) => (
      <NextIntlClientProvider locale="zh-CN" messages={zh}>
        <ContextCompactionCard
          state={running ? "input-available" : "output-available"}
          meta={meta}
        />
        <LiveTurnStats
          agentType="codex"
          message={message(
            running
              ? [tool("in_progress")]
              : [tool("completed"), { type: "text", text: "继续回答" }]
          )}
        />
      </NextIntlClientProvider>
    )
    const view = render(tree(true))
    expect(screen.getByRole("status")).toHaveTextContent("正在压缩上下文")
    expect(screen.getAllByText("正在压缩上下文…")).toHaveLength(2)
    const dividerLabel = screen.getAllByText("正在压缩上下文…")[0]
    const dividerRow = dividerLabel.parentElement
    view.rerender(tree(false))
    expect(screen.getByText("上下文已压缩")).toBe(dividerLabel)
    expect(dividerLabel.parentElement).toBe(dividerRow)
    expect(screen.getByRole("status")).toHaveTextContent("输出中")
    expect(screen.queryByText("正在压缩上下文…")).not.toBeInTheDocument()
  })

  it("requires compaction metadata and clears on failure, completion, or settled turns", () => {
    expect(getAgentActivity(message([]), true, false)).toBe("waiting")
    expect(
      getAgentActivity(message([tool("in_progress", null)]), true, false)
    ).toBe("running")
    for (const status of ["pending", "in_progress"]) {
      expect(getAgentActivity(message([tool(status)]), true, false)).toBe(
        "compacting"
      )
    }
    for (const status of ["completed", "failed"]) {
      expect(getAgentActivity(message([tool(status)]), true, false)).toBe(
        "waiting"
      )
    }
    expect(getAgentActivity(message([tool("in_progress")]), false, false)).toBe(
      "settled"
    )
    expect(getAgentActivity(message([tool("in_progress")]), true, true)).toBe(
      "awaitingUser"
    )
  })
})
