import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api", () => ({}))
vi.mock("@/lib/platform", () => ({ subscribe: vi.fn() }))

import {
  buildStreamingTurnsFromLiveMessage,
  parseHoldsTheLatestRound,
} from "./conversation-runtime-store"
import type { MessageTurn } from "@/lib/types"
import type {
  LiveContentBlock,
  LiveMessage,
} from "@/contexts/acp-connections-context"

describe("parseHoldsTheLatestRound", () => {
  const at = "2026-10-10T00:00:00Z"
  const user = (id: string): MessageTurn => ({
    id,
    role: "user",
    blocks: [],
    timestamp: at,
  })
  const reply = (id: string): MessageTurn => ({
    id,
    role: "assistant",
    blocks: [{ type: "text", text: id }],
    timestamp: at,
  })
  const failed = (id: string): MessageTurn => ({
    id,
    role: "system",
    blocks: [{ type: "turn_error", message: "API Error: 503" }],
    timestamp: at,
  })

  it("holds it when the parse ends on the reply", () => {
    expect(
      parseHoldsTheLatestRound([user("u"), reply("a")], [user("u"), reply("a")])
    ).toBe(true)
  })

  it("holds it when the parse ends on the line of the round that just failed", () => {
    expect(
      parseHoldsTheLatestRound(
        [user("u"), reply("a1"), failed("f")],
        [user("u"), reply("a"), failed("live-f")]
      )
    ).toBe(true)
  })

  it("is behind when it ends on an earlier failure and the newest round succeeded", () => {
    // Round A failed after streaming (parsed as two sub-turns), round B then
    // succeeded but is not on disk yet: locals [A, B] against parsed [A1, A2]
    // align with offset 0, so only this keeps B from A2's name.
    expect(
      parseHoldsTheLatestRound(
        [user("uA"), reply("A1"), reply("A2"), failed("fA")],
        [user("uA"), reply("A"), failed("live-fA"), user("uB"), reply("B")]
      )
    ).toBe(false)
  })

  it("is behind when it ends on the prompt or on any other system turn", () => {
    expect(parseHoldsTheLatestRound([user("u")], [user("u"), reply("a")])).toBe(
      false
    )
    expect(
      parseHoldsTheLatestRound(
        [
          user("u"),
          {
            id: "s",
            role: "system",
            blocks: [{ type: "text", text: "summary" }],
            timestamp: at,
          },
        ],
        [user("u"), failed("live-f")]
      )
    ).toBe(false)
    expect(parseHoldsTheLatestRound([], [])).toBe(false)
  })
})

describe("buildStreamingTurnsFromLiveMessage - a failed turn", () => {
  function live(content: LiveContentBlock[]): LiveMessage {
    return { id: "lm-fail", role: "assistant", content, startedAt: 0 }
  }

  it("closes the reply with a system turn holding the failure", () => {
    const { turns } = buildStreamingTurnsFromLiveMessage(
      1,
      live([
        { type: "text", text: "looking" },
        {
          type: "turn_error",
          message: "stream disconnected before completion",
          fromAgent: true,
        },
      ])
    )
    expect(turns.map((turn) => [turn.role, turn.blocks])).toEqual([
      ["assistant", [{ type: "text", text: "looking" }]],
      [
        "system",
        [
          {
            type: "turn_error",
            message: "stream disconnected before completion",
          },
        ],
      ],
    ])
  })

  it("is the whole turn when nothing else came back", () => {
    const { turns } = buildStreamingTurnsFromLiveMessage(
      1,
      live([{ type: "turn_error", message: "API Error: 503", fromAgent: true }])
    )
    expect(turns.map((turn) => turn.role)).toEqual(["system"])
  })
})
