import { describe, expect, it } from "vitest"

import type { LiveMessage } from "@/contexts/acp-connections-context"
import { getGenerationFigures } from "@/components/chat/composer-generation-stats"
import {
  createLiveGenerationTiming,
  generationStatsFromLiveMessage,
  markLiveGenerationOutput,
} from "@/lib/live-generation-stats"
import { loadGenerationStats } from "@/lib/generation-stats-storage"
import { estimateTokens } from "@/lib/token-speed"
import { source } from "./contract-source"

function streamedMessage(
  first: string,
  rest: string,
  elapsed: number
): LiveMessage {
  let timing = createLiveGenerationTiming(1_000)
  timing = markLiveGenerationOutput(
    timing,
    1_000,
    0,
    false,
    2_000,
    estimateTokens(first)
  )
  timing = markLiveGenerationOutput(timing, 1_000, 0, false, 2_000 + elapsed)
  return {
    id: "pi-stream",
    role: "assistant",
    startedAt: 1_000,
    generationTiming: timing,
    content: [{ type: "text", text: first + rest }],
  }
}

describe("MaxCode contract: Pi generation throughput", () => {
  it("does not divide a buffered response by a few milliseconds", () => {
    const stats = generationStatsFromLiveMessage(
      streamedMessage("x".repeat(60_000), "done", 1),
      90_000
    )!
    expect(getGenerationFigures(stats)).toEqual({
      averageTtft: "1s",
      throughput: null,
    })
  })

  it("excludes the first received chunk and completion wait from decode speed", () => {
    const message = streamedMessage(
      "x".repeat(60_000),
      "abcd".repeat(20),
      1_000
    )
    const live = generationStatsFromLiveMessage(message, 3_000)!
    expect(live.decode_tokens).toBe(20)
    expect(getGenerationFigures(live).throughput).toBe("20")
    expect(generationStatsFromLiveMessage(message, 90_000)).toEqual(live)
  })

  it("does not count large buffered tool payloads or tool results as generated text", () => {
    const message = streamedMessage("abcd", "abcd".repeat(20), 1_000)
    message.content.push({
      type: "tool_call",
      info: {
        tool_call_id: "pi-tool",
        title: "bash",
        kind: "execute",
        status: "completed",
        content: null,
        raw_input: "x".repeat(1_000_000),
        raw_output_chunks: ["y".repeat(1_000_000)],
        raw_output_total_bytes: 1_000_000,
        locations: null,
        meta: null,
        images: [],
      },
    })
    message.content.push({
      type: "thinking",
      text: "child".repeat(20_000),
      parentToolUseId: "pi-tool",
    })
    const stats = generationStatsFromLiveMessage(message, 30_000)!
    expect(stats.decode_tokens).toBe(20)
    expect(getGenerationFigures(stats).throughput).toBe("20")
  })

  it("does not infer decode duration from a delayed completion of one chunk", () => {
    const message = streamedMessage("x".repeat(60_000), "", 0)
    expect(generationStatsFromLiveMessage(message, 90_000)?.decode_ms).toBe(0)
  })

  it("records the first ACP delta's token baseline", () => {
    expect(source("src/contexts/acp-connections-context.tsx")).toContain(
      "estimateTokens(observedText)"
    )
  })

  it("excludes snapshot history when timing resumes after reconnect", () => {
    const prefix = "x".repeat(60_000)
    let timing = markLiveGenerationOutput(
      undefined,
      1_000,
      1,
      false,
      50_000,
      estimateTokens(prefix)
    )
    timing = markLiveGenerationOutput(timing, 1_000, 1, false, 51_000)
    const message: LiveMessage = {
      id: "pi-reconnected",
      role: "assistant",
      startedAt: 1_000,
      generationTiming: timing,
      content: [
        { type: "text", text: "old response".repeat(60_000) },
        { type: "thinking", text: prefix + "abcd".repeat(20) },
      ],
    }
    expect(generationStatsFromLiveMessage(message, 90_000)).toEqual({
      ttft_ms: 0,
      ttft_steps: 0,
      decode_ms: 1_000,
      decode_tokens: 20,
    })
  })

  it("ignores cached figures produced by the old estimator", () => {
    localStorage.setItem(
      "codeg.generationStats:local:871",
      JSON.stringify({
        ttft_ms: 1_000,
        ttft_steps: 1,
        decode_ms: 1,
        decode_tokens: 15_726,
      })
    )
    expect(loadGenerationStats(871)).toBeNull()
    localStorage.removeItem("codeg.generationStats:local:871")
  })
})
