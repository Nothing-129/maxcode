import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  loadGenerationStats,
  saveGenerationStats,
} from "@/lib/generation-stats-storage"

const { getRemoteId } = vi.hoisted(() => ({
  getRemoteId: vi.fn<() => string | null>(() => null),
}))

vi.mock("@/lib/transport", () => ({
  getActiveRemoteConnectionId: getRemoteId,
}))

describe("generation stats storage", () => {
  beforeEach(() => {
    localStorage.clear()
    getRemoteId.mockReturnValue(null)
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

  it("isolates remote backends and rejects malformed values", () => {
    getRemoteId.mockReturnValue("alpha")
    saveGenerationStats(7, {
      ttft_ms: 1,
      ttft_steps: 1,
      decode_ms: 1,
      decode_tokens: 1,
    })
    getRemoteId.mockReturnValue("beta")
    expect(loadGenerationStats(7)).toBeNull()
    localStorage.setItem(
      "codeg.generationStats:remote-beta:7",
      JSON.stringify({ ttft_ms: -1 })
    )
    expect(loadGenerationStats(7)).toBeNull()
  })
})
