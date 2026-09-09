import { describe, expect, it } from "vitest"
import { source } from "./contract-source"
import { getConversationRoundCount } from "@/components/chat/composer-generation-stats"
import type { DbConversationDetail, MessageTurn } from "@/lib/types"
import type { ConversationTimelineTurn } from "@/stores/conversation-runtime-store"

const user: MessageTurn = { id: "u1", role: "user", blocks: [], timestamp: "" }
const assistant: MessageTurn = { ...user, id: "a1", role: "assistant" }
function timeline(turns: MessageTurn[]): ConversationTimelineTurn[] {
  return turns.map((turn) => ({ key: turn.id, turn, phase: "persisted" }))
}
function detail(
  turns: MessageTurn[],
  extra: Partial<DbConversationDetail> = {}
) {
  return { turns, ...extra } as DbConversationDetail
}

describe("MaxCode: conversation rounds before TTFT", () => {
  it("counts user prompts, not assistant generation or system steps", () => {
    expect(getConversationRoundCount(null, [])).toBe(0)
    const turns = [
      user,
      assistant,
      { ...assistant, id: "a2" },
      { ...user, id: "s", role: "system" as const },
    ]
    expect(getConversationRoundCount(detail(turns), timeline(turns))).toBe(1)
    expect(getConversationRoundCount(null, timeline([user]))).toBe(1)
  })

  it("keeps the full count stable while paging and adds one pending user prompt", () => {
    const tail = [user, assistant]
    const partial = detail(tail, { turns_offset: 100, user_turns_total: 40 })
    expect(getConversationRoundCount(partial, timeline(tail))).toBe(40)
    const sent = [...tail, { ...user, id: "u2" }]
    expect(getConversationRoundCount(partial, timeline(sent))).toBe(41)
    const persisted = detail(sent, { turns_offset: 100, user_turns_total: 41 })
    expect(getConversationRoundCount(persisted, timeline(sent))).toBe(41)
    const older = [{ ...user, id: "old" }, ...sent]
    expect(
      getConversationRoundCount(
        detail(older, { turns_offset: 99, user_turns_total: 41 }),
        timeline(older)
      )
    ).toBe(41)
    expect(getConversationRoundCount(partial, timeline(tail))).toBe(40)
  })

  it("does not guess a full count from an old server's partial transcript", () => {
    expect(
      getConversationRoundCount(
        detail([user], { turns_offset: 10 }),
        timeline([user])
      )
    ).toBeNull()
  })

  it("places rounds before TTFT and includes them in the measured full label", () => {
    const component = source(
      "src/components/chat/composer-generation-stats.tsx"
    )
    const parts = component.slice(
      component.indexOf("const parts = ["),
      component.indexOf("const fullLabel")
    )
    expect(parts.indexOf('t("roundCount"')).toBeLessThan(
      parts.indexOf('t("ttftAverage"')
    )
    expect(component).toContain(
      "selectTimelineTurns(state, runtimeConversationId)"
    )
    const backend = source("src-tauri/src/commands/conversations.rs")
    const window = backend.slice(
      backend.indexOf("fn apply_turn_window("),
      backend.indexOf("/// `get_folder_conversation_core` plus")
    )
    expect(window.indexOf("detail.user_turns_total = Some(")).toBeLessThan(
      window.indexOf("detail.turns.drain")
    )
  })
})
