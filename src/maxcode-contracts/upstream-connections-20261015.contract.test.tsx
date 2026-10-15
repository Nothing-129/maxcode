import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { isConnectionReady } from "@/lib/queue-flush"
import type { AgentType } from "@/lib/types"
import { source } from "./contract-source"

const connection = vi.hoisted(() => ({
  agentType: "claude_code" as AgentType | null,
  status: "connected",
  errorAgent: "codex" as AgentType,
  setConfigOption: vi.fn(async () => {}),
}))

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))
vi.mock("@/contexts/acp-connections-context", () => {
  const actions = {
    setActiveKey: vi.fn(),
    touchActivity: vi.fn(),
    markConnectPending: vi.fn(),
    clearConnectPending: vi.fn(),
    releaseSurface: vi.fn(async () => {}),
  }
  return { getCachedSelectors: () => null, useAcpActions: () => actions }
})
vi.mock("@/contexts/task-context", () => {
  const context = { addTask: vi.fn(), updateTask: vi.fn(), removeTask: vi.fn() }
  return { useTaskContext: () => context }
})
vi.mock("@/hooks/use-connection", () => {
  const noop = vi.fn(async () => {})
  return {
    useConnection: () => ({
      ...connection,
      connectError: {
        agentType: connection.errorAgent,
        title: "connect failed",
        detail: "The selected agent configuration could not be read",
        opensAgentSettings: true,
      },
      selectorsReady: true,
      hasCachedSelectors: true,
      connect: noop,
      disconnect: noop,
      sendPrompt: noop,
      setMode: noop,
      cancel: noop,
      respondPermission: noop,
      modes: null,
      configOptions: null,
      isViewer: false,
      backgroundOutstanding: 0,
    }),
  }
})

import {
  shouldDisconnectOnUnmount,
  useConnectionLifecycle,
} from "@/hooks/use-connection-lifecycle"

beforeEach(() => {
  connection.agentType = "claude_code"
  connection.status = "connected"
  connection.errorAgent = "codex"
  connection.setConfigOption.mockClear()
})

describe("MaxCode contract: switching a connecting draft", () => {
  it("shows the selected agent's error and keeps its edits off the old connection", () => {
    const { result, rerender } = renderHook(
      ({ agentType }: { agentType: AgentType }) =>
        useConnectionLifecycle({
          contextKey: "draft-contract",
          agentType,
          isActive: false,
        }),
      { initialProps: { agentType: "codex" } }
    )
    expect(result.current.autoConnectError).toBe(
      "The selected agent configuration could not be read"
    )
    result.current.handleSetConfigOption("model", "gpt-5.4")
    expect(connection.setConfigOption).not.toHaveBeenCalled()

    rerender({ agentType: "grok" })
    expect(result.current.autoConnectError).toBeNull()
    connection.agentType = "grok"
    rerender({ agentType: "grok" })
    result.current.handleSetConfigOption("model", "grok-code-fast-1")
    expect(connection.setConfigOption).toHaveBeenCalledWith(
      "model",
      "grok-code-fast-1"
    )
  })

  it("flushes queued messages only after the selected agent, cwd and selectors agree", () => {
    expect(
      isConnectionReady("connecting", "/w", "/w", "codex", "codex", true)
    ).toBe(false)
    expect(
      isConnectionReady("connected", "/w", "/w", "grok", "codex", true)
    ).toBe(false)
    expect(
      isConnectionReady("connected", "/old", "/w", "codex", "codex", true)
    ).toBe(false)
    expect(
      isConnectionReady("connected", "/w", "/w", "codex", "codex", false)
    ).toBe(false)
    expect(
      isConnectionReady("connected", "/w", "/w", "codex", "codex", true)
    ).toBe(true)
    const panel = source(
      "src/components/conversations/conversation-detail-panel.tsx"
    )
    expect(panel).toContain("if (!connectionReadyRef.current) return")
    expect(panel).toContain("if (!connectionReady) return")
    expect(
      source("src/components/canvas/canvas-conversation-surface.tsx")
    ).toContain("if (connIsForOtherAgent) return")
  })

  it("keeps hidden local owners warm while viewers release their subscriptions", () => {
    expect(
      shouldDisconnectOnUnmount({
        status: "connected",
        isViewer: false,
        backgroundOutstanding: 0,
        preserveIdleOwner: true,
      })
    ).toBe(false)
    expect(
      shouldDisconnectOnUnmount({
        status: "connected",
        isViewer: true,
        backgroundOutstanding: 0,
        preserveIdleOwner: true,
      })
    ).toBe(true)
  })

  it("locks draft agent changes only once the first prompt starts binding", () => {
    const canvas = source(
      "src/components/canvas/canvas-conversation-surface.tsx"
    )
    expect(canvas).toContain("disabled={creating}")
    expect(canvas).toContain(
      "if (creatingRef.current || dbConversationIdRef.current != null) return"
    )
    expect(canvas).toContain("onSelect={handleDraftAgentChange}")
    expect(canvas).toContain("onFallback={handleDraftAgentChange}")
    const panel = source(
      "src/components/conversations/conversation-detail-panel.tsx"
    )
    expect(
      panel.match(
        /disabled=\{dbConversationId != null \|\| creatingConversation\}/g
      )
    ).toHaveLength(2)
    expect(
      panel.match(/if \(createConversationPendingRef.current\) return/g)?.length
    ).toBeGreaterThanOrEqual(2)
  })
})
