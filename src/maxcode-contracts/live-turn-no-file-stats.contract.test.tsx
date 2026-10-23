import { cleanup, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LiveTurnStats } from "@/components/message/live-turn-stats"
import type { LiveMessage } from "@/contexts/acp-connections-context"
import zh from "@/i18n/messages/zh-CN.json"

vi.mock("@/hooks/use-token-output-speed", () => ({
  useTokenOutputSpeed: () => 1.8,
}))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("MaxCode: live status omits file change counters", () => {
  it.each([
    ["waiting", "等待响应"],
    ["thinking", "思考中..."],
    ["text", "工作中"],
  ] as const)(
    "preserves the original %s phase and separate clock",
    (phase, label) => {
      vi.spyOn(Date, "now").mockReturnValue(185_000)
      const content: LiveMessage["content"] =
        phase === "waiting" ? [] : [{ type: phase, text: "内容" }]
      const { container } = render(
        <NextIntlClientProvider locale="zh-CN" messages={zh}>
          <LiveTurnStats
            message={{
              id: "original",
              role: "assistant",
              startedAt: 0,
              content,
            }}
            agentType="codex"
          />
        </NextIntlClientProvider>
      )
      expect(screen.getByRole("status")).toHaveTextContent(label)
      expect(screen.getByText("3 分 5 秒")).toBeVisible()
      expect(container.querySelector(".lucide-timer")).toBeVisible()
      expect(screen.getByRole("status")).not.toHaveTextContent("3 分")
      expect(container.textContent?.match(/\|/g)).toHaveLength(2)
    }
  )

  it("keeps working time and output speed when tools modify files, without a trailing separator", () => {
    const message: LiveMessage = {
      id: "edit-turn",
      role: "assistant",
      startedAt: Date.now(),
      content: [
        {
          type: "tool_call",
          info: {
            tool_call_id: "write-1",
            title: "Write",
            kind: "write",
            status: "in_progress",
            raw_input: JSON.stringify({
              file_path: "/repo/a.ts",
              content: "one\ntwo",
            }),
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
    const { container } = render(
      <NextIntlClientProvider locale="zh-CN" messages={zh}>
        <LiveTurnStats message={message} agentType="codex" />
      </NextIntlClientProvider>
    )
    expect(screen.getByRole("status")).toHaveTextContent("执行工具中")
    expect(container.querySelector(".lucide-timer")).toBeVisible()
    expect(screen.getByText("0 秒")).toBeVisible()
    expect(screen.getByText("1.8 tok/s")).toBeVisible()
    expect(container.textContent).not.toMatch(/\d+F\s*\+|\+2\/-0/)
    expect(container.querySelector(".lucide-file-pen-line")).toBeNull()
    expect(container.textContent?.trim()).toMatch(/1\.8 tok\/s$/)
    expect(container.textContent?.match(/\|/g)).toHaveLength(2)
  })
})
