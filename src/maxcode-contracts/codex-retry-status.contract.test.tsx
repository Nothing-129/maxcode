import { act, cleanup, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiRetryBanner } from "@/components/chat/api-retry-banner"
import { LiveTurnStats } from "@/components/message/live-turn-stats"
import { apiRetryFromEvent, retrySecondsRemaining } from "@/lib/api-retry"
import { denormalizeSnapshot } from "@/lib/snapshot-denormalize"
import type { AcpEvent, LiveSessionSnapshot } from "@/lib/types"
import messages from "@/i18n/messages/zh-CN.json"

const event: Extract<AcpEvent, { type: "turn_retrying" }> = {
  type: "turn_retrying",
  message: "Model request interrupted",
  error_status: 429,
  attempt: 1,
  max_retries: 5,
  retry_delay_ms: 329_000,
  retry_at_ms: 429_000,
}

function banner(value: ReturnType<typeof apiRetryFromEvent> | null) {
  return (
    <NextIntlClientProvider locale="zh-CN" timeZone="UTC" messages={messages}>
      <ApiRetryBanner value={value} />
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(100_000)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("Codex retry visibility", () => {
  it("replaces the misleading waiting-response label while retrying", () => {
    render(
      <NextIntlClientProvider locale="zh-CN" timeZone="UTC" messages={messages}>
        <LiveTurnStats
          message={{
            id: "m",
            role: "assistant",
            content: [],
            startedAt: 100_000,
          }}
          agentType="codex"
          retrying
        />
      </NextIntlClientProvider>
    )
    expect(screen.getByRole("status")).toHaveTextContent("正在重试")
    expect(screen.getByRole("status")).not.toHaveTextContent("等待响应")
    expect(screen.getByRole("status")).not.toHaveClass("maxcode-waiting-label")
  })
  it("shows the cause, HTTP status, attempt and live countdown, not a silent spinner", () => {
    const retry = apiRetryFromEvent(event, "thread-a")
    const view = render(banner(retry))
    expect(screen.getByRole("status")).toHaveTextContent("请求被限流")
    expect(screen.getByRole("status")).toHaveTextContent("HTTP 429")
    expect(screen.getByRole("status")).toHaveTextContent("正在重试 1/5")
    expect(screen.getByRole("status")).toHaveTextContent("329 秒后重试")
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "authentication_failed"
    )
    act(() => vi.advanceTimersByTime(47_000))
    expect(screen.getByRole("status")).toHaveTextContent("282 秒后重试")
    act(() => vi.advanceTimersByTime(282_000))
    expect(screen.getByRole("status")).toHaveTextContent("正在重试 1/5")
    expect(screen.getByRole("status")).not.toHaveTextContent("秒后重试")
    // Only genuine recovery clears it, not the countdown hitting zero.
    view.rerender(banner(null))
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("uses the original deadline after refresh and handles a second backoff", () => {
    vi.setSystemTime(400_000)
    const view = render(banner(apiRetryFromEvent(event, "thread-a")))
    expect(screen.getByRole("status")).toHaveTextContent("29 秒后重试")
    view.rerender(
      banner(
        apiRetryFromEvent(
          { ...event, attempt: 2, retry_at_ms: 410_000 },
          "thread-a"
        )
      )
    )
    expect(screen.getByRole("status")).toHaveTextContent("正在重试 2/5")
    expect(screen.getByRole("status")).toHaveTextContent("10 秒后重试")
  })

  it("does not invent a cause, duration or retry when none is known", () => {
    render(
      banner(apiRetryFromEvent({ type: "turn_retrying", message: "" }, "a"))
    )
    expect(screen.getByRole("status")).toHaveTextContent("正在重试")
    expect(screen.getByRole("status")).not.toHaveTextContent("HTTP")
    expect(screen.getByRole("status")).not.toHaveTextContent("秒后重试")
    expect(retrySecondsRemaining(Number.NaN, 0)).toBeNull()
    expect(retrySecondsRemaining(null, 0)).toBeNull()
  })

  it("recovers only a currently prompting retry from the authoritative snapshot", () => {
    const snapshot: LiveSessionSnapshot = {
      connection_id: "c",
      conversation_id: null,
      folder_id: null,
      status: "prompting",
      external_id: "thread-a",
      live_message: null,
      active_tool_calls: [],
      pending_permission: null,
      modes: null,
      current_mode: null,
      config_options: null,
      prompt_capabilities: null,
      usage: null,
      fork_supported: false,
      available_commands: [],
      selectors_ready: true,
      event_seq: 12,
      turn_retrying: event,
    }
    expect(denormalizeSnapshot(snapshot).claudeApiRetry?.retryAtMs).toBe(
      429_000
    )
    expect(
      denormalizeSnapshot({ ...snapshot, status: "connected" }).claudeApiRetry
    ).toBeNull()
    expect(
      denormalizeSnapshot({ ...snapshot, turn_retrying: null }).claudeApiRetry
    ).toBeNull()
  })
})
