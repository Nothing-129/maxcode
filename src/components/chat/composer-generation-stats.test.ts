import { describe, expect, it } from "vitest"

import {
  capEstimatedTokensToProviderTotal,
  canShowGenerationStats,
  chooseGenerationStatsDisplayMode,
  formatGenerationDuration,
  formatGenerationThroughput,
  getDisplayedGenerationStats,
  getGenerationFigures,
} from "./composer-generation-stats"

describe("composer generation stats", () => {
  it("matches DeepSeek Harness duration and throughput formatting", () => {
    expect(formatGenerationDuration(4_260)).toBe("4.3s")
    expect(formatGenerationDuration(162_000)).toBe("2m42s")
    expect(formatGenerationThroughput(876.6)).toBe("877")
    expect(formatGenerationThroughput(8.76)).toBe("8.8")
  })

  it("uses summed decode time and samples TTFT by recorded step", () => {
    expect(
      getGenerationFigures({
        ttft_ms: 8_520,
        ttft_steps: 2,
        decode_ms: 2_000,
        decode_tokens: 1_753,
      })
    ).toEqual({ averageTtft: "4.3s", throughput: "877" })
  })

  it("shows by measured free space instead of a fixed composer breakpoint", () => {
    const currentLayout = {
      rowWidth: 420,
      rowPadding: 16,
      leftWidth: 120,
      outerGap: 8,
      rightControlWidths: [32, 18],
      rightGap: 12,
      statsWidth: 160,
    }
    expect(canShowGenerationStats(currentLayout)).toBe(true)
    expect(canShowGenerationStats({ ...currentLayout, rowWidth: 330 })).toBe(
      false
    )
  })

  it("falls back from the full label to throughput, then hides", () => {
    expect(chooseGenerationStatsDisplayMode(true, true)).toBe("full")
    expect(chooseGenerationStatsDisplayMode(false, true)).toBe("throughput")
    expect(chooseGenerationStatsDisplayMode(false, false)).toBe("hidden")
  })

  it("shows the current streaming turn before it completes", () => {
    const stats = getDisplayedGenerationStats(
      {
        ttft_ms: 1_000,
        ttft_steps: 1,
        decode_ms: 1_000,
        decode_tokens: 10,
      },
      {
        id: "live-1",
        role: "assistant",
        startedAt: 10_000,
        content: [{ type: "thinking", text: "checking the current state" }],
        generationTiming: {
          steps: [
            {
              startedAt: 10_000,
              firstTokenAt: 12_000,
              lastTokenAt: 13_000,
              startContentIndex: 0,
            },
          ],
          nextStepStartedAt: null,
        },
      }
    )

    expect(stats?.ttft_ms).toBe(3_000)
    expect(stats?.ttft_steps).toBe(2)
    expect(stats?.decode_ms).toBe(2_000)
    expect(stats?.decode_tokens).toBeGreaterThan(10)
  })

  it("caps an inflated ACP estimate with provider-reported output usage", () => {
    const stats = capEstimatedTokensToProviderTotal(
      {
        ttft_ms: 183_616,
        ttft_steps: 38,
        decode_ms: 220_700,
        decode_tokens: 266_117,
      },
      15_932
    )

    expect(stats?.decode_tokens).toBe(15_932)
    expect(stats && getGenerationFigures(stats)).toEqual({
      averageTtft: "4.8s",
      throughput: "72",
    })
  })
})
