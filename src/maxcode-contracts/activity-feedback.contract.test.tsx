import { readFileSync } from "node:fs"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ActivityStatusIcon } from "@/components/shared/activity-status-icon"
import { getAgentActivity } from "@/lib/agent-activity"
import type {
  LiveContentBlock,
  LiveMessage,
} from "@/contexts/acp-connections-context"
import en from "@/i18n/messages/en.json"

vi.mock("@/components/ai-elements/code-block", () => ({
  CodeBlock: () => null,
}))
vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: () => null,
}))

import {
  Tool,
  ToolHeader,
  ToolContent,
  type ToolPart,
} from "@/components/ai-elements/tool"
import { LiveTurnStats } from "@/components/message/live-turn-stats"

const message = (content: LiveContentBlock[]): LiveMessage => ({
  id: "turn-1",
  role: "assistant",
  startedAt: Date.now(),
  content,
})
const text: LiveContentBlock = { type: "text", text: "Working" }
const thinking: LiveContentBlock = {
  type: "thinking",
  text: "Checking the code",
}
function tool(
  status: "pending" | "in_progress" | "completed" | "failed"
): LiveContentBlock {
  return {
    type: "tool_call",
    info: {
      tool_call_id: "tool-1",
      title: "Read",
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

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("agent activity feedback contract", () => {
  it("uses observed phases, including thinking after text and parallel tools", () => {
    expect(getAgentActivity(message([]), true, false)).toBe("waiting")
    expect(getAgentActivity(message([text]), true, false)).toBe("streaming")
    expect(getAgentActivity(message([text, thinking]), true, false)).toBe(
      "thinking"
    )
    expect(
      getAgentActivity(
        message([tool("in_progress"), text, tool("completed")]),
        true,
        false
      )
    ).toBe("running")
    expect(getAgentActivity(message([tool("pending")]), true, false)).toBe(
      "running"
    )
    expect(
      getAgentActivity(message([text, tool("completed")]), true, false)
    ).toBe("waiting")
    expect(getAgentActivity(message([tool("failed")]), true, false)).toBe(
      "waiting"
    )
  })

  it("prioritizes user decisions and never calls a stopped turn running", () => {
    expect(getAgentActivity(message([tool("in_progress")]), true, true)).toBe(
      "awaitingUser"
    )
    expect(getAgentActivity(message([tool("in_progress")]), false, true)).toBe(
      "settled"
    )
  })

  it("renders localized phase changes without pulsing the agent logo", () => {
    const view = (m: LiveMessage, awaitingUser = false) => (
      <NextIntlClientProvider locale="en" messages={en}>
        <LiveTurnStats
          message={m}
          agentType="codex"
          awaitingUser={awaitingUser}
        />
      </NextIntlClientProvider>
    )
    const { container, rerender } = render(view(message([])))
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for response")
    rerender(view(message([thinking])))
    expect(screen.getByRole("status")).toHaveTextContent("Thinking...")
    rerender(view(message([text])))
    expect(screen.getByRole("status")).toHaveTextContent("Streaming")
    rerender(view(message([tool("in_progress")])))
    expect(screen.getByRole("status")).toHaveTextContent("Running tools")
    rerender(view(message([tool("in_progress")]), true))
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for you")
    expect(container.querySelector(".animate-pulse")).toBeNull()
    expect(container.querySelector("[data-activity-status]")).toBeNull()
    expect(screen.getByText("- tok/s")).toBeInTheDocument()
  })

  it("wires blocking interactions through all transcript hosts", () => {
    for (const path of [
      "src/components/conversations/conversation-detail-panel.tsx",
      "src/components/canvas/canvas-conversation-surface.tsx",
      "src/components/message/live-transcript-view.tsx",
    ]) {
      const source = readFileSync(path, "utf8")
      expect(source).toMatch(/awaitingUser=\{/)
      for (const field of [
        "pendingPermission",
        "pendingQuestion",
        "pendingAskQuestion",
        "pendingPlanApproval",
      ]) {
        expect(
          source.slice(
            source.indexOf("awaitingUser={"),
            source.indexOf("awaitingUser={") + 350
          )
        ).toContain(field)
      }
    }
  })
})

describe("tool feedback contract", () => {
  function card(state: ToolPart["state"], recovered = false) {
    return (
      <NextIntlClientProvider locale="en" messages={en}>
        <Tool defaultOpen>
          <ToolHeader
            type="dynamic-tool"
            toolName="Read"
            state={state}
            recovered={recovered}
          />
          <ToolContent>
            <pre>stable selectable output</pre>
          </ToolContent>
        </Tool>
      </NextIntlClientProvider>
    )
  }

  it("animates real transitions, preserves output DOM and leaves disclosure alone", () => {
    const { container, rerender } = render(card("input-available"))
    const output = screen.getByText("stable selectable output")
    expect(container.querySelector('[data-transition="true"]')).toBeNull()
    rerender(card("output-available"))
    expect(
      container.querySelector(
        '[data-activity-status="success"] [data-transition="true"]'
      )
    ).not.toBeNull()
    expect(screen.getByText("stable selectable output")).toBe(output)
    const face = container.querySelector('[data-transition="true"]')
    rerender(card("output-available"))
    expect(container.querySelector('[data-transition="true"]')).toBe(face)
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true")
    fireEvent.click(screen.getByRole("button"))
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false")
  })

  it.each([
    ["approval-requested", "approval"],
    ["approval-responded", "responded"],
    ["input-streaming", "waiting"],
    ["output-error", "error"],
    ["output-denied", "denied"],
  ] as const)(
    "maps %s without losing its distinct meaning",
    (state, activity) => {
      const { container, rerender } = render(card("input-available"))
      rerender(card(state))
      expect(
        container.querySelector(`[data-activity-status="${activity}"]`)
      ).not.toBeNull()
    }
  )

  it("does not celebrate history mounts or replay after virtualization remount", () => {
    const first = render(card("output-available"))
    expect(first.container.querySelector('[data-transition="true"]')).toBeNull()
    first.unmount()
    const second = render(card("output-available"))
    expect(
      second.container.querySelector('[data-transition="true"]')
    ).toBeNull()
  })

  it("retains recovered-error wording rather than showing failure", () => {
    const { container } = render(card("output-error", true))
    expect(screen.getByText("Retry succeeded")).toBeInTheDocument()
    expect(container.querySelector('[data-activity-status="error"]')).toBeNull()
  })
})

describe("motion budget contract", () => {
  it("pauses running icons offscreen and releases the observer", () => {
    let notify: (entries: { isIntersecting: boolean }[]) => void = () => {}
    const disconnect = vi.fn()
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof notify) {
          notify = callback
        }
        observe() {}
        disconnect = disconnect
      }
    )
    const { container, unmount } = render(
      <ActivityStatusIcon status="running" />
    )
    const icon = container.querySelector("[data-activity-status]")
    expect(icon).toHaveAttribute("data-active", "false")
    act(() => notify([{ isIntersecting: true }]))
    expect(icon).toHaveAttribute("data-active", "true")
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true)
    act(() => document.dispatchEvent(new Event("visibilitychange")))
    expect(icon).toHaveAttribute("data-active", "false")
    hidden.mockReturnValue(false)
    act(() => document.dispatchEvent(new Event("visibilitychange")))
    expect(icon).toHaveAttribute("data-active", "true")
    act(() => notify([{ isIntersecting: false }]))
    expect(icon).toHaveAttribute("data-active", "false")
    unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it("disables every new animation for reduced motion and never animates card layout", () => {
    const css = readFileSync(
      "src/components/shared/activity-status-icon.module.css",
      "utf8"
    )
    expect(css).toContain("prefers-reduced-motion: reduce")
    expect(css).toContain("animation: none !important")
    expect(css).toContain("animation-play-state: paused")
    expect(css).not.toMatch(
      /(?:height|width|margin|padding):.*(?:transition|animation)/
    )
  })

  it("provides phase copy in all ten locales", () => {
    for (const locale of [
      "en",
      "zh-CN",
      "zh-TW",
      "ja",
      "ko",
      "de",
      "es",
      "fr",
      "pt",
      "ar",
    ]) {
      const messages = JSON.parse(
        readFileSync(`src/i18n/messages/${locale}.json`, "utf8")
      )
      for (const phase of [
        "waiting",
        "thinking",
        "streaming",
        "running",
        "awaitingUser",
        "settled",
      ]) {
        expect(messages.Folder.chat.liveTurnStats[phase]).toEqual(
          expect.any(String)
        )
      }
    }
  })
})
