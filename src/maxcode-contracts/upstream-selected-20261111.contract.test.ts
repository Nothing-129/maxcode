import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { MessageTurn } from "@/lib/types"
import {
  resetConversationRuntimeStore,
  useConversationRuntimeStore,
} from "@/stores/conversation-runtime-store"
import {
  getCodeHighlightStats,
  highlightCode,
  HIGHLIGHT_LIMITS,
} from "@/lib/code-highlighter"

vi.mock("@/lib/api", () => ({ getFolderConversation: vi.fn() }))
const source = (path: string) => readFileSync(path, "utf8")
afterEach(() => resetConversationRuntimeStore())

describe("selected November upstream preserves MaxCode behavior", () => {
  it("keeps a completed Grok launch alive without resurrecting a reply", () => {
    const actions = useConversationRuntimeStore.getState().actions
    const launch: MessageTurn = {
      id: "launch",
      role: "assistant",
      timestamp: "2026-11-11T00:00:00Z",
      blocks: [
        {
          type: "tool_use",
          tool_use_id: "child-call",
          tool_name: "spawn_subagent",
          input_preview: null,
          meta: { preserved: true },
        },
      ],
    }
    actions.appendOptimisticTurn(71, launch, "launch")
    actions.completeTurn(71, null)
    actions.applyBackgroundTaskProgress(71, "child-call", {
      grokSubagentProgress: { toolCallCount: 7, durationMs: 2000 },
    })
    const session = useConversationRuntimeStore
      .getState()
      .byConversationId.get(71)!
    expect(session.liveMessage).toBeNull()
    expect(session.localTurns[0].blocks[0]).toMatchObject({
      meta: { preserved: true, grokSubagentProgress: { toolCallCount: 7 } },
    })
    const before = useConversationRuntimeStore.getState()
    actions.applyBackgroundTaskProgress(999, "child-call", {})
    expect(useConversationRuntimeStore.getState()).toBe(before)
  })

  it("cancels superseded code requests and never caches streaming prefixes", async () => {
    const controller = new AbortController()
    const stale = vi.fn()
    const options = {
      code: "const maxcode = true",
      language: "typescript",
      themes: ["github-light", "github-dark"] as [string, string],
      isIncomplete: true,
    }
    highlightCode({ ...options, signal: controller.signal }, stale)
    controller.abort()
    await new Promise<void>((resolve) => {
      const result = highlightCode(options, () => resolve())
      if (result) resolve()
    })
    expect(stale).not.toHaveBeenCalled()
    expect(getCodeHighlightStats().entries).toBe(0)
    expect(getCodeHighlightStats().estimatedBytes).toBeLessThanOrEqual(
      HIGHLIGHT_LIMITS.cacheBytes
    )
  })

  it("pins only maintained adapters and includes the independent fork test", () => {
    const registry = source("src-tauri/src/acp/registry.rs")
    for (const pin of [
      "claude-agent-acp@0.106.0",
      "codex-acp@2.6.0",
      "zcode-acp-server@0.83.3",
    ]) {
      expect(registry).toContain(pin)
    }
    expect(source("src-tauri/src/acp/fork.rs")).toContain(
      "upstream-selected-20261111.contract.rs"
    )
    const connection = source("src-tauri/src/acp/connection.rs")
    expect(connection).toContain(
      'Some("session_busy" | "session_provider_missing" | "provider_mismatch")'
    )
    expect(connection).toContain("register_yielding_question")
    expect(connection).toContain("ReplayedCompaction::Drop => continue")
  })

  it("ships the cancellation patch before Docker's frozen install", () => {
    const docker = source("Dockerfile")
    expect(docker.indexOf("COPY patches/")).toBeLessThan(
      docker.indexOf("RUN pnpm install")
    )
    expect(source("pnpm-workspace.yaml")).toContain(
      "streamdown@2.7.1: patches/streamdown@2.7.1.patch"
    )
    expect(source("patches/streamdown@2.7.1.patch")).toContain("abort.abort()")
  })
})
