import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: generation stats", () => {
  it("folds the harness's exact first-token and decode boundaries", () => {
    const parser = source("src-tauri/src/parsers/deepseek.rs")
    const models = source("src-tauri/src/models/mod.rs")

    expect(parser).toContain('event_type == "assistant/chunk"')
    expect(parser).toContain("is_deepseek_token_delta")
    expect(parser).toContain("first_token_ms.saturating_sub(open.started_ms)")
    expect(parser).toContain("completed_ms.saturating_sub(first_token_ms)")
    expect(parser).toContain('usage.get("outputTokens")')
    expect(parser).toContain("stats.generation_stats = Some")
    expect(models).toContain("GenerationStats")
  })

  it("collects the same boundaries from live ACP agents, including thinking and tool-separated steps", () => {
    const connections = source("src/contexts/acp-connections-context.tsx")
    const liveStats = source("src/lib/live-generation-stats.ts")
    const storage = source("src/lib/generation-stats-storage.ts")
    const runtime = source("src/stores/conversation-runtime-store.ts")

    expect(connections).toContain("markLiveGenerationOutput")
    expect(connections).toContain("markLiveToolSettled")
    expect(liveStats).toContain('block.type === "thinking"')
    expect(liveStats).toContain("generationStatsFromLiveMessage")
    expect(runtime).toContain("observedGenerationStats")
    expect(runtime).toContain("mergeIncomingSessionStats")
    expect(runtime).toContain("saveGenerationStats")
    expect(storage).toContain("getActiveRemoteConnectionId")
  })

  it("groups the optional figures with right-side metrics and hides them in narrow composers", () => {
    const input = source("src/components/chat/message-input.tsx")
    const stats = source("src/components/chat/composer-generation-stats.tsx")

    const branch = input.indexOf("<ConversationFolderBranchPicker")
    const generation = input.indexOf("<ComposerGenerationStats")
    const contextUsage = input.indexOf("<ComposerContextUsage")
    expect(branch).toBeGreaterThan(-1)
    expect(generation).toBeGreaterThan(branch)
    expect(contextUsage).toBeGreaterThan(generation)
    expect(stats).toContain("canShowGenerationStats")
    expect(stats).toContain("chooseGenerationStatsDisplayMode")
    expect(stats).toContain('data-generation-stats="measure-throughput"')
    expect(stats).toContain("getDisplayedGenerationStats")
    expect(stats).toContain("capEstimatedTokensToProviderTotal")
    expect(stats).toContain("total_usage?.output_tokens")
    expect(stats).toContain("liveMessage")
    expect(stats).toContain("new ResizeObserver(measure)")
    expect(stats).not.toContain("@[38rem]:inline-flex")
    expect(stats).toContain('parts.join(" · ")')
  })
})
