import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DbConversationDetail, MessageTurn } from "@/lib/types"
import {
  resetConversationRuntimeStore,
  useConversationRuntimeStore,
  type ConversationRuntimeSession,
} from "@/stores/conversation-runtime-store"

vi.mock("@/lib/api", () => ({
  getFolderConversation: vi.fn(),
}))

const { getFolderConversation } = await import("@/lib/api")
const mockGet = vi.mocked(getFolderConversation)

const CID = 99

function userTurn(id: string, text: string): MessageTurn {
  return { id, role: "user", blocks: [{ type: "text", text }], timestamp: "" }
}

function assistantTurn(id: string, text: string): MessageTurn {
  return {
    id,
    role: "assistant",
    blocks: [{ type: "text", text }],
    timestamp: "",
  }
}

function detail(
  turns: MessageTurn[],
  watermark: number | null = null,
  inFlightUserTurnId: string | null = null
): DbConversationDetail {
  return {
    summary: {
      id: CID,
      folder_id: 1,
      agent_type: "claude_code",
      title: null,
      title_locked: false,
      status: "in_progress",
      kind: "regular",
      model: null,
      git_branch: null,
      external_id: "ext-1",
      message_count: turns.length,
      child_count: 0,
      created_at: "2026-07-18T00:00:00.000Z",
      updated_at: "2026-07-18T00:00:00.000Z",
      pinned_at: null,
    },
    turns,
    session_stats: null,
    transcript_watermark: watermark,
    in_flight_user_turn_id: inFlightUserTurnId,
  }
}

function emptySession(conversationId: number): ConversationRuntimeSession {
  return {
    conversationId,
    externalId: "ext-1",
    dbConversationId: null,
    detail: null,
    detailLoading: false,
    detailError: null,
    acpLoadError: null,
    localTurns: [],
    backgroundTurns: [],
    pendingBackgroundSettlements: [],
    optimisticTurns: [],
    liveMessage: null,
    syncState: "idle",
    activeTurnToken: null,
    lastTurnOwned: false,
    liveOwnsActiveTurn: false,
    delegationKickoffText: null,
    sessionStats: null,
    historyAssistantBaseline: null,
    batchBoundaryIndex: null,
    batchBoundaryPrefixHash: null,
    loadingOlderTurns: false,
    olderTurnsPrependEpoch: 0,
    pendingCleanup: false,
  }
}

function seed(overrides: Partial<ConversationRuntimeSession>): void {
  useConversationRuntimeStore.setState({
    byConversationId: new Map([[CID, { ...emptySession(CID), ...overrides }]]),
  })
}

function session(): ConversationRuntimeSession | undefined {
  return useConversationRuntimeStore.getState().byConversationId.get(CID)
}

function sync(): void {
  useConversationRuntimeStore.getState().actions.syncViewerDetail(CID)
}

beforeEach(() => {
  resetConversationRuntimeStore()
  mockGet.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("viewer sync request bounds", () => {
  it("coalesces a burst while HTTP is pending and follows up for a late update", async () => {
    vi.useFakeTimers()
    seed({ detail: detail([userTurn("u", "hi")], 10) })
    let resolve!: (value: DbConversationDetail) => void
    mockGet.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    mockGet.mockResolvedValue(
      detail([userTurn("u", "hi"), assistantTurn("a", "final")], 30)
    )

    sync()
    for (let n = 0; n < 1000; n++) sync()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(mockGet).toHaveBeenCalledTimes(1)

    resolve(detail([userTurn("u", "hi"), assistantTurn("a", "old")], 20))
    await vi.advanceTimersByTimeAsync(0)
    expect(mockGet).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(300)
    expect(mockGet).toHaveBeenCalledTimes(2)
    expect(session()?.detail?.transcript_watermark).toBe(30)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(mockGet).toHaveBeenCalledTimes(2)
  })

  it("bounds read-triggered metadata feedback without restarting the retry budget", async () => {
    vi.useFakeTimers()
    seed({ detail: detail([userTurn("u", "hi")], 10) })
    let emitted = 0
    mockGet.mockImplementation(async () => {
      // Simulate a backend upsert arriving before its detail response. Limit
      // the mock itself so the regression fails cleanly instead of overflowing.
      if (emitted++ < 50) sync()
      return detail([userTurn("u", "hi"), assistantTurn("a", "done")], 20)
    })

    sync()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(mockGet).toHaveBeenCalledTimes(5)
    expect(session()?.detail?.transcript_watermark).toBe(20)

    // A later independent event can start a fresh bounded sync.
    mockGet.mockResolvedValue(detail([assistantTurn("b", "new")], 30))
    sync()
    await vi.advanceTimersByTimeAsync(0)
    expect(mockGet).toHaveBeenCalledTimes(6)
    expect(session()?.detail?.transcript_watermark).toBe(30)
  })

  it("does not let failure plus repeated events bypass backoff or the attempt cap", async () => {
    vi.useFakeTimers()
    seed({ detail: detail([userTurn("u", "hi")], 10) })
    mockGet.mockRejectedValue(new Error("network unavailable"))
    sync()
    await vi.advanceTimersByTimeAsync(0)
    for (let n = 0; n < 1000; n++) sync()
    expect(mockGet).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(299)
    expect(mockGet).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(mockGet).toHaveBeenCalledTimes(5)
    expect(session()?.detail?.transcript_watermark).toBe(10)
  })
})
