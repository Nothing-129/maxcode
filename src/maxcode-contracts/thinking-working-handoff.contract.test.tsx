import { render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it } from "vitest"
import zhMessages from "@/i18n/messages/zh-CN.json"
import enMessages from "@/i18n/messages/en.json"
import {
  HistoricalMessageGroup,
  stabilizePendingReply,
  type ThreadRenderItem,
} from "@/components/message/message-list-view"
import { CompletedTurnContent } from "@/components/message/completed-turn-content"
import type { AdaptedContentPart } from "@/lib/adapters/ai-elements-adapter"
import { source } from "./contract-source"

const tree = (parts: AdaptedContentPart[]) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>
    <CompletedTurnContent completed={false} parts={parts} />
  </NextIntlClientProvider>
)

describe("thinking to working handoff", () => {
  it("keeps a continuous sheen on the same label when waiting becomes working", () => {
    const view = render(tree([]))
    const heading = screen.getByRole("button")
    expect(heading).toBeDisabled()
    expect(heading.querySelector("svg")).toBeNull()
    const label = screen.getByRole("status")
    const textNode = label.firstChild
    const classes = label.className
    expect(label).toHaveTextContent("Waiting for response...")
    expect(label).toHaveClass("maxcode-live-activity-label")
    expect(view.container.querySelector("[data-waiting-elapsed]")).toBeNull()
    view.rerender(tree([{ type: "text", text: "Reply arrived" }]))
    expect(screen.getByRole("status")).toBe(label)
    expect(label.firstChild).toBe(textNode)
    expect(label.className).toBe(classes)
    expect(label).toHaveTextContent("Working...")
    expect(
      view.container.querySelector(".chat-message-text")
    ).toHaveTextContent("Reply arrived")
    expect(heading).not.toBeDisabled()
    view.unmount()
  })

  it("keeps empty placeholders thinking, then updates the same status span", () => {
    const view = render(tree([{ type: "text", text: "" }]))
    const label = screen.getByText("Waiting for response...")
    const heading = label.parentElement
    expect(label).toHaveClass("maxcode-turn-status")
    view.rerender(tree([{ type: "text", text: "Checking messages" }]))
    const working = screen.getByText(enMessages.Folder.chat.messageList.working)
    expect(working).toBe(label)
    expect(working.parentElement).toBe(heading)
  })

  it("shares pending typography, keeps confirmation explicit and avoids dots", () => {
    const code = source("src/components/message/message-list-view.tsx")
    expect(code).toContain("stabilizePendingReply(")
    expect(code).toContain('feedbackText("awaitingUser")')
    expect(code).not.toContain("PendingTypingIndicator")
    expect(code).not.toContain("WaitingDots")
  })

  it("keeps the Chinese processing label and DOM stable through empty activity and first work", () => {
    const chinese = (parts: AdaptedContentPart[]) => (
      <NextIntlClientProvider locale="zh-CN" messages={zhMessages}>
        <CompletedTurnContent completed={false} parts={parts} />
      </NextIntlClientProvider>
    )
    const view = render(chinese([]))
    const processing = screen.getByText("等待响应...")
    const heading = processing.parentElement
    view.rerender(
      chinese([{ type: "reasoning", content: "", isStreaming: true }])
    )
    expect(screen.getByText("等待响应...")).toBe(processing)
    view.rerender(
      chinese([{ type: "tool-group", items: [], isStreaming: true }])
    )
    expect(screen.getByText("等待响应...")).toBe(processing)
    view.rerender(
      chinese([{ type: "reasoning", content: "Inspecting", isStreaming: true }])
    )
    expect(screen.getByText("正在工作中...")).toBe(processing)
    expect(processing.parentElement).toBe(heading)
  })
  it("retains the actual message heading across send confirmation and the first streamed reply", () => {
    const user: Extract<ThreadRenderItem, { kind: "turn" }> = {
      key: "user",
      kind: "turn",
      group: { id: "user", role: "user", parts: [], images: [], resources: [] },
      phase: "optimistic",
      isResponseComplete: true,
      showStats: false,
      isRoleTransition: false,
      previousUserIndex: null,
      previousUserAt: null,
      isLastAssistantRun: false,
      isThreadTail: true,
      sourceTurns: [],
    }
    const activeKey = "pending-reply-test:1"
    const rows = (items: ThreadRenderItem[]) => (
      <NextIntlClientProvider locale="zh-CN" messages={zhMessages}>
        {stabilizePendingReply(items, activeKey, true)
          .filter(
            (item) => item.kind === "turn" && item.group.role === "assistant"
          )
          .map(
            (item) =>
              item.kind === "turn" && (
                <div key={item.key} style={{ paddingTop: 16 }}>
                  <HistoricalMessageGroup
                    group={item.group}
                    showStats={false}
                    isResponseComplete={false}
                  />
                </div>
              )
          )}
      </NextIntlClientProvider>
    )
    const view = render(rows([user]))
    const label = screen.getByText("等待响应...")
    const heading = label.parentElement
    view.rerender(rows([{ ...user, phase: "persisted" }]))
    expect(screen.getByText("等待响应...")).toBe(label)
    const reply = {
      ...user,
      key: "streaming-agent-123",
      phase: "streaming" as const,
      isResponseComplete: false,
      isRoleTransition: true,
      group: {
        ...user.group,
        id: "agent-123",
        role: "assistant" as const,
        parts: [{ type: "text" as const, text: "开始检查" }],
      },
    }
    view.rerender(rows([user, reply]))
    expect(screen.getByText("正在工作中...")).toBe(label)
    expect(label.parentElement).toBe(heading)
    expect(heading?.isConnected).toBe(true)
    view.rerender(rows([user, { ...reply, key: "merged-agent-123" }]))
    expect(screen.getByText("正在工作中...")).toBe(label)
  })

  it("keeps status text opaque instead of restarting a shimmer on remount", () => {
    const css = source("src/app/globals.css")
    expect(css).toContain(
      ".maxcode-turn-status {\n  color: var(--muted-foreground);"
    )
    expect(css).not.toContain("maxcode-turn-status-sweep")
  })
})
