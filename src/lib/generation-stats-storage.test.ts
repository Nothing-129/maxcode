import { beforeEach, describe, expect, it } from "vitest"

import {
  loadGenerationStats,
  saveGenerationStats,
} from "@/lib/generation-stats-storage"

describe("generation stats storage", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("round-trips a local conversation", () => {
    const stats = {
      ttft_ms: 400,
      ttft_steps: 1,
      decode_ms: 800,
      decode_tokens: 40,
    }
    saveGenerationStats(7, stats)
    expect(loadGenerationStats(7)).toEqual(stats)
  })

  it("rejects malformed persisted values", () => {
    localStorage.setItem(
      "codeg.generationStats:local:7",
      JSON.stringify({ ttft_ms: -1 })
    )
    expect(loadGenerationStats(7)).toBeNull()
  })
})
