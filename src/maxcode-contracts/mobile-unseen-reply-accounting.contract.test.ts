import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { LiveMessage } from "@/contexts/acp-connections-context"
import type {
  DbConversationDetail,
  GenerationStats,
  MessageTurn,
} from "@/lib/types"
import {
  computeTurnMetadataPatches,
  getTimelineTurns,
  resetConversationRuntimeStore,
  useConversationRuntimeStore,
} from "@/stores/conversation-runtime-store"

vi.mock("@/lib/api", () => ({ getFolderConversation: vi.fn() }))
const { getFolderConversation } = await import("@/lib/api")
const read = vi.mocked(getFolderConversation)
const ID = -20
const SESSION = "mobile-accounting"
const at = "2026-10-20T00:00:00Z"
const actions = () => useConversationRuntimeStore.getState().actions
const session = () =>
  useConversationRuntimeStore.getState().byConversationId.get(ID)!
const user = (id: string): MessageTurn => ({
  id,
  role: "user",
  timestamp: at,
  blocks: [{ type: "text", text: "continue" }],
})
const assistant = (id: string, duration = 0): MessageTurn => ({
  id,
  role: "assistant",
  timestamp: at,
  blocks: [{ type: "text", text: id }],
  duration_ms: duration,
})
const live = (id: string): LiveMessage => ({
  id,
  role: "assistant",
  startedAt: Date.parse(at),
  content: [{ type: "text", text: id }],
})
const timing: GenerationStats = {
  ttft_ms: 123,
  ttft_steps: 1,
  decode_ms: 1000,
  decode_tokens: 40,
}
function detail(turns: MessageTurn[]): DbConversationDetail {
  return {
    summary: {
      id: 20,
      folder_id: 1,
      agent_type: "codex",
      title: null,
      title_locked: false,
      status: "completed",
      kind: "regular",
      model: null,
      git_branch: null,
      external_id: SESSION,
      message_count: turns.length,
      child_count: 0,
      created_at: at,
      updated_at: at,
      pinned_at: null,
    },
    turns,
    session_stats: { total_usage: null, total_duration_ms: 5000 },
    billing_usage: [
      {
        model: "codex-model",
        usage: {
          input_tokens: 100,
          output_tokens: 40,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    ],
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  resetConversationRuntimeStore()
  read.mockReset()
  actions().setExternalId(ID, SESSION)
  actions().setDbConversationId(ID, 20)
})
afterEach(() => {
  resetConversationRuntimeStore()
  vi.useRealTimers()
})

describe("MaxCode: mobile recovery keeps prompt identity and accounting", () => {
  it("assigns every parser slice to its prompt even when timestamps and prompt text repeat", () => {
    const patches = computeTurnMetadataPatches({
      localTurns: [user("u1"), assistant("l1"), user("u2"), assistant("l2")],
      parsedTurns: [
        user("p1"),
        assistant("p1-thinking", 2000),
        assistant("p1-text", 1000),
        user("p2"),
        assistant("p2-thinking", 4000),
        assistant("p2-text", 500),
      ],
      persistedAssistantCount: 0,
      parseOpensAtBatch: true,
      parseEndsWithAssistant: true,
    })
    expect(patches.map((patch) => [patch.index, patch.duration_ms])).toEqual([
      [1, 3000],
      [3, 4500],
    ])
    expect(patches.every((patch) => patch.source_turn_id == null)).toBe(true)
  })

  it("keeps a repeated pending prompt until every round exists on disk during snapshot recovery", async () => {
    actions().appendOptimisticTurn(ID, user("wire-u1"), "first")
    actions().setLiveMessage(ID, live("first-reply"), true)
    actions().completeTurn(ID)
    actions().appendOptimisticTurn(ID, user("wire-u2"), "second")
    actions().setLiveMessage(ID, live("second-head"), true)
    const firstOnly = detail([
      user("p-u1"),
      assistant("p-first-thinking"),
      assistant("p-first-text"),
    ])
    read.mockResolvedValue(firstOnly)
    actions().markTurnEndUnseen(SESSION)
    actions().recoverSettledDetail(ID, () => true, user("wire-u2"))
    await vi.advanceTimersByTimeAsync(300)
    expect(session().detail).toBeNull()
    expect(session().optimisticTurns.map((turn) => turn.id)).toEqual([
      "wire-u2",
    ])
    expect(session().liveMessage?.id).toBe("second-head")

    const complete = detail([
      ...firstOnly.turns,
      user("p-u2"),
      assistant("p-second-complete"),
    ])
    read.mockResolvedValue(complete)
    await vi.advanceTimersByTimeAsync(300)
    expect(session().detail?.turns).toEqual(complete.turns)
    expect(session().localTurns).toEqual([])
    expect(session().optimisticTurns).toEqual([])
    // An old snapshot's wire ID cannot resurrect the settled second prompt.
    actions().appendViewerUserTurn(ID, user("wire-u2"))
    expect(session().optimisticTurns).toEqual([])
    // The fallback consumed the old unseen-end mark. The next watched turn
    // keeps the ordinary no-refetch completion behavior.
    read.mockClear()
    actions().appendOptimisticTurn(ID, user("wire-u3"), "third")
    actions().setLiveMessage(ID, live("third-complete"), true)
    actions().completeTurn(ID)
    expect(read).not.toHaveBeenCalled()
  })

  it("loads a missed reply while retaining the queued prompt, live follow-up, and generation timing", async () => {
    actions().appendOptimisticTurn(ID, user("wire-u1"), "first")
    actions().setLiveMessage(ID, live("first-head"), true)
    useConversationRuntimeStore.setState({
      byConversationId: new Map([
        [
          ID,
          {
            ...session(),
            sessionStats: {
              total_usage: null,
              total_duration_ms: 0,
              generation_stats: timing,
            },
          },
        ],
      ]),
    })
    let resolve!: (value: DbConversationDetail) => void
    read.mockImplementationOnce(
      () => new Promise<DbConversationDetail>((done) => (resolve = done))
    )
    actions().markTurnEndUnseen(SESSION)
    actions().completeTurn(ID)
    actions().appendOptimisticTurn(ID, user("wire-u2"), "second")
    actions().setLiveMessage(ID, live("second-live"), true)
    const persisted = detail([user("p-u1"), assistant("complete-first")])
    resolve(persisted)
    await vi.advanceTimersByTimeAsync(0)

    expect(session().localTurns).toEqual([])
    expect(session().optimisticTurns.map((turn) => turn.id)).toEqual([
      "wire-u2",
    ])
    expect(session().liveMessage?.id).toBe("second-live")
    expect(session().syncState).toBe("awaiting_persist")
    expect(session().sessionStats?.generation_stats).toEqual(timing)
    expect(session().billingUsage).toEqual(persisted.billing_usage)
    expect(
      getTimelineTurns(ID).filter((item) => item.turn.id === "p-u1")
    ).toHaveLength(1)
  })
})
