import { describe, expect, it } from "vitest"
import { partitionOptimisticTurnsOnComplete } from "./conversation-runtime-store"
import type { MessageTurn } from "@/lib/types"

function userTurn(id: string, timestamp: string): MessageTurn {
  return {
    id,
    role: "user",
    blocks: [{ type: "text", text: id }],
    timestamp,
  }
}

describe("partitionOptimisticTurnsOnComplete", () => {
  const startedAt = Date.parse("2026-05-28T00:00:10.000Z")
  const before = userTurn("prompt-1", "2026-05-28T00:00:00.000Z")
  const after = userTurn("prompt-2", "2026-05-28T00:00:20.000Z")

  it("promotes every optimistic turn when there is no follow-up", () => {
    expect(
      partitionOptimisticTurnsOnComplete([before], "prompt-1", startedAt)
    ).toEqual({ promote: [before], keep: [] })
  })

  it("keeps the active follow-up and promotes the prompt that started this turn", () => {
    expect(
      partitionOptimisticTurnsOnComplete([before, after], "prompt-2", startedAt)
    ).toEqual({ promote: [before], keep: [after] })
  })

  it("keeps a lone optimistic turn stamped after the live stream started", () => {
    expect(
      partitionOptimisticTurnsOnComplete([after], "prompt-2", startedAt)
    ).toEqual({ promote: [], keep: [after] })
  })

  it("promotes viewer turns that have no active send token", () => {
    expect(
      partitionOptimisticTurnsOnComplete([before, after], null, startedAt)
    ).toEqual({ promote: [before, after], keep: [] })
  })
})
