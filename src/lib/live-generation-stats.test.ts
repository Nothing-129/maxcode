import { describe, expect, it } from "vitest"

import type { LiveMessage } from "@/contexts/acp-connections-context"
import {
  createLiveGenerationTiming,
  generationStatsFromLiveMessage,
  markLiveGenerationOutput,
  markLiveToolSettled,
} from "@/lib/live-generation-stats"

describe("live generation stats", () => {
  it("counts thinking as the first generated token", () => {
    let timing = createLiveGenerationTiming(1_000)
    timing = markLiveGenerationOutput(timing, 1_000, 0, false, 1_400)
    timing = markLiveGenerationOutput(timing, 1_000, 1, false, 1_900)
    const message: LiveMessage = {
      id: "m1",
      role: "assistant",
      startedAt: 1_000,
      generationTiming: timing,
      content: [
        { type: "thinking", text: "分析中" },
        { type: "text", text: "final answer" },
      ],
    }

    expect(generationStatsFromLiveMessage(message, 2_000)).toEqual({
      ttft_ms: 400,
      ttft_steps: 1,
      decode_ms: 600,
      decode_tokens: 6,
    })
  })

  it("starts a new model step after a settled tool without charging tool time", () => {
    let timing = createLiveGenerationTiming(1_000)
    timing = markLiveGenerationOutput(timing, 1_000, 0, false, 1_200)
    timing = markLiveToolSettled(timing, 1_000, 5_000)
    timing = markLiveGenerationOutput(timing, 1_000, 1, true, 5_300)
    timing = markLiveGenerationOutput(timing, 1_000, 1, false, 5_700)
    const message: LiveMessage = {
      id: "m2",
      role: "assistant",
      startedAt: 1_000,
      generationTiming: timing,
      content: [
        {
          type: "tool_call",
          info: {
            tool_call_id: "t1",
            title: "read",
            kind: "read",
            status: "completed",
            content: null,
            raw_input: "file.ts",
            raw_output_chunks: [],
            raw_output_total_bytes: 0,
            locations: null,
            meta: null,
            images: [],
          },
        },
        { type: "text", text: "done" },
      ],
    }

    const stats = generationStatsFromLiveMessage(message, 5_800)
    expect(stats?.ttft_ms).toBe(500)
    expect(stats?.ttft_steps).toBe(2)
    expect(stats?.decode_ms).toBe(500)
  })
})
