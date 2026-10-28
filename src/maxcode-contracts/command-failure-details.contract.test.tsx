import { fireEvent, render, screen, within } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it } from "vitest"
import { ContentPartsRenderer } from "@/components/message/content-parts-renderer"
import type { AdaptedToolCallPart } from "@/lib/adapters/ai-elements-adapter"
import zh from "@/i18n/messages/zh-CN.json"

describe("MaxCode: command failures remain visible", () => {
  it.each([true, false])(
    "keeps diagnostics accessible inside the collapsed command summary (streaming=%s)",
    (isStreaming) => {
      const items: AdaptedToolCallPart[] = [
        {
          type: "tool-call",
          toolCallId: "search",
          toolName: "exec_command",
          input: JSON.stringify({
            cmd: "rg Phone apps/server/Features/Owners*",
          }),
          state: "output-error",
          errorText: "zsh:1: no matches found: apps/server/Features/Owners*",
        },
        {
          type: "tool-call",
          toolCallId: "read",
          toolName: "exec_command",
          input: JSON.stringify({ cmd: "sed -n '370,435p' Owners.cs" }),
          state: "output-available",
          output: "public class Owner {}",
        },
        {
          type: "tool-call",
          toolCallId: "query",
          toolName: "exec_command",
          input: JSON.stringify({
            cmd: "uv run --with pymssql python query.py",
          }),
          state: "output-error",
          output: "Invalid object name 'CaseTrajectories'",
        },
      ]
      const before = JSON.stringify(items)
      render(
        <NextIntlClientProvider locale="zh-CN" messages={zh}>
          <ContentPartsRenderer
            role="assistant"
            parts={[{ type: "tool-group", isStreaming, items }]}
          />
        </NextIntlClientProvider>
      )
      const group = screen.getByRole("button", { name: "运行 3 个命令" })
      expect(group).toHaveAttribute("aria-expanded", "false")
      fireEvent.click(group)
      expect(screen.queryByText("错误")).toBeNull()
      expect(screen.queryByText(/执行异常/)).toBeNull()
      expect(screen.getByText("已完成")).toBeVisible()
      for (const [command, diagnostic] of [
        [/rg Phone/, "zsh:1: no matches found"],
        [/uv run/, "Invalid object name"],
      ] as const) {
        const header = screen.getByRole("button", { name: command })
        expect(within(header).queryByText("已完成")).toBeNull()
        expect(header).toHaveAttribute("aria-expanded", "true")
        expect(screen.getByText(new RegExp(diagnostic))).toBeVisible()
        fireEvent.click(header)
        expect(header).toHaveAttribute("aria-expanded", "false")
      }
      expect(JSON.stringify(items)).toBe(before)
    }
  )
})
