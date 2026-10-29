import { cleanup, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it } from "vitest"
import { LiveTurnStats } from "@/components/message/live-turn-stats"
import type {
  LiveContentBlock,
  LiveMessage,
} from "@/contexts/acp-connections-context"
import zhCN from "@/i18n/messages/zh-CN.json"
import zhTW from "@/i18n/messages/zh-TW.json"

afterEach(cleanup)

function tool(status: "in_progress" | "completed"): LiveContentBlock {
  return {
    type: "tool_call",
    info: {
      tool_call_id: "tool-1",
      title: "Read file",
      kind: "read",
      status,
      content: null,
      raw_input: null,
      raw_output_chunks: [],
      raw_output_total_bytes: 0,
      locations: null,
      meta: null,
      images: [],
    },
  }
}

describe("compact live working-state labels", () => {
  it.each([
    [
      "zh-CN",
      zhCN,
      ["等待响应", "思考中", "输出中", "执行中", "待确认", "重试中"],
    ],
    [
      "zh-TW",
      zhTW,
      ["等待回應", "思考中", "輸出中", "執行中", "待確認", "重試中"],
    ],
  ] as const)("uses six short phases in %s", (locale, messages, labels) => {
    const view = (
      content: LiveContentBlock[],
      awaitingUser = false,
      retrying = false
    ) => {
      const message: LiveMessage = {
        id: "message-1",
        role: "assistant",
        content,
        startedAt: Date.now(),
      }
      return (
        <NextIntlClientProvider locale={locale} messages={messages}>
          <LiveTurnStats
            message={message}
            agentType="codex"
            awaitingUser={awaitingUser}
            retrying={retrying}
          />
        </NextIntlClientProvider>
      )
    }
    const { rerender } = render(view([]))
    const expectLabel = (index: number) =>
      expect(screen.getByRole("status").textContent).toBe(labels[index])
    expectLabel(0)
    rerender(view([{ type: "thinking", text: "reasoning" }]))
    expectLabel(1)
    rerender(view([{ type: "text", text: "answer" }]))
    expectLabel(2)
    rerender(view([tool("in_progress")]))
    expectLabel(3)
    rerender(view([tool("in_progress")], true))
    expectLabel(4)
    rerender(view([], false, true))
    expectLabel(5)
    rerender(view([tool("completed")]))
    expectLabel(0)
    expect(messages.Folder.chat.liveTurnStats.thinkingPending).toBe(
      `${labels[0]}...`
    )
  })
})
