import { strict as assert } from "node:assert"
import { bench, describe, vi } from "vitest"
import type {
  LiveContentBlock,
  LiveMessage,
  ToolCallInfo,
} from "@/contexts/acp-connections-context"
import type { DbConversationDetail, MessageTurn } from "@/lib/types"
import {
  type ConversationRuntimeSession,
  resetConversationRuntimeStore,
  selectTimelineTurns,
  useConversationRuntimeStore,
} from "@/stores/conversation-runtime-store"

// Only the I/O boundary is stubbed. All mutations, normalization, timeline
// assembly and cache lookups below run through the production store.
vi.mock("@/lib/api", () => ({
  getFolderConversation: () => {
    throw new Error("State benchmarks must not fetch history")
  },
  getFolderConversationTurns: () => {
    throw new Error("State benchmarks must not fetch history")
  },
}))

const BATCHES = 32
const STARTED_AT = Date.parse("2026-09-26T12:00:00.000Z")
const BASE_TEXT = "existing assistant text\n".repeat(4_096)
const TEXT_DELTA = " another streamed token"
const TOOL_CHUNK = "x".repeat(1_024)
const actions = useConversationRuntimeStore.getState().actions
const options = { time: 1_000, warmupTime: 250, iterations: 20 }

function turn(index: number): MessageTurn {
  return {
    id: `turn-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    blocks: [
      { type: "text", text: `Message ${index}: ${"history ".repeat(64)}` },
    ],
    timestamp: new Date(STARTED_AT - (20_000 - index) * 1_000).toISOString(),
  }
}

function detail(
  conversationId: number,
  turnCount: number
): DbConversationDetail {
  return {
    summary: {
      id: conversationId,
      folder_id: 1,
      title: "Runtime benchmark",
      title_locked: false,
      agent_type: "claude_code",
      status: "idle",
      kind: "regular",
      model: null,
      git_branch: null,
      external_id: null,
      message_count: turnCount,
      child_count: 0,
      created_at: new Date(STARTED_AT - 20_000_000).toISOString(),
      updated_at: new Date(STARTED_AT).toISOString(),
      pinned_at: null,
    },
    turns: Array.from({ length: turnCount }, (_, index) => turn(index)),
  }
}

function session(history: DbConversationDetail): ConversationRuntimeSession {
  return {
    conversationId: history.summary.id,
    externalId: null,
    dbConversationId: null,
    detail: history,
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

function timeline(conversationId: number) {
  return selectTimelineTurns(
    useConversationRuntimeStore.getState(),
    conversationId
  )
}

function live(content: LiveContentBlock[]): LiveMessage {
  return { id: "reply", role: "assistant", content, startedAt: STARTED_AT }
}

function seed(histories: DbConversationDetail[]) {
  resetConversationRuntimeStore()
  useConversationRuntimeStore.setState({
    byConversationId: new Map(
      histories.map((history) => [history.summary.id, session(history)])
    ),
  })
  for (const history of histories) {
    const id = history.summary.id
    actions.appendOptimisticTurn(
      id,
      { ...turn(20_000), id: "pending-user" },
      "token"
    )
    actions.setLiveMessage(id, live([{ type: "text", text: BASE_TEXT }]), true)
    // Prefix caches are warm for streaming cases, as they are after the
    // first displayed batch. The cold cases below measure the first build.
    assert.equal(timeline(id).length, history.turns.length + 2)
  }
}

function checkText(conversationId: number, historyCount: number) {
  const result = timeline(conversationId)
  assert.equal(result.length, historyCount + 2)
  assert.equal(result[result.length - 1].phase, "streaming")
  assert.deepEqual(result[result.length - 1].turn.blocks, [
    { type: "text", text: BASE_TEXT + TEXT_DELTA.repeat(BATCHES) },
  ])
}

describe("cold state hydration + first timeline (one operation = one load)", () => {
  for (const count of [2_000, 10_000]) {
    const history = detail(1, count)
    bench(
      `${count} loaded turns`,
      () => {
        // A fresh detail identity misses both caches. Fixture text generation
        // and JSON parsing are excluded; state hydration is included.
        useConversationRuntimeStore.setState({
          byConversationId: new Map([[1, session({ ...history })]]),
        })
        timeline(1)
      },
      {
        ...options,
        setup: () => resetConversationRuntimeStore(),
        teardown: () => {
          assert.equal(timeline(1).length, count)
          resetConversationRuntimeStore()
        },
      }
    )
  }
})

describe("streaming text (one operation = 32 flush batches)", () => {
  for (const count of [120, 2_000, 10_000]) {
    const history = detail(1, count)
    bench(
      `${count} loaded turns + 92 KiB live reply`,
      () => {
        // Each operation repeats the same bounded workload, with new message
        // objects so the session cache cannot hide the streaming work.
        let text = BASE_TEXT
        for (let batch = 0; batch < BATCHES; batch += 1) {
          text += TEXT_DELTA
          actions.setLiveMessage(1, live([{ type: "text", text }]), true)
          timeline(1)
        }
      },
      {
        ...options,
        setup: () => seed([history]),
        teardown: () => {
          checkText(1, count)
          resetConversationRuntimeStore()
        },
      }
    )
  }
})

function tool(id: string, chunks: string[], status: string): ToolCallInfo {
  return {
    tool_call_id: id,
    title: "Run command",
    kind: "execute",
    status,
    content: null,
    raw_input: '{"command":"pnpm test"}',
    raw_output_chunks: chunks,
    raw_output_total_bytes: chunks.reduce(
      (total, chunk) => total + chunk.length,
      0
    ),
    locations: null,
    meta: null,
    images: [],
  }
}

describe("tool output (one operation = 32 flush batches)", () => {
  const history = detail(1, 2_000)
  const completed: LiveContentBlock[] = Array.from(
    { length: 40 },
    (_, index) => ({
      type: "tool_call",
      info: tool(
        `done-${index}`,
        Array<string>(8).fill(TOOL_CHUNK),
        "completed"
      ),
    })
  )
  const initialChunks = Array<string>(256).fill(TOOL_CHUNK)
  const activeTool = tool("active", initialChunks, "in_progress")
  bench(
    "40 completed tools + 256 KiB active output growing by 1 KiB/batch",
    () => {
      let chunks = initialChunks
      for (let batch = 0; batch < BATCHES; batch += 1) {
        // Unchanged tools keep their chunk arrays; the active tool gets a new
        // array on every update, just like the connection reducer. Reusing
        // prerecorded active snapshots would incorrectly warm its join cache.
        chunks = [...chunks, TOOL_CHUNK]
        actions.setLiveMessage(
          1,
          live([
            ...completed,
            {
              type: "tool_call",
              info: {
                ...activeTool,
                raw_output_chunks: chunks,
                raw_output_total_bytes:
                  activeTool.raw_output_total_bytes +
                  (batch + 1) * TOOL_CHUNK.length,
              },
            },
          ]),
          true
        )
        timeline(1)
      }
    },
    {
      ...options,
      setup: () => seed([history]),
      teardown: () => {
        const blocks = timeline(1).flatMap((entry) => entry.turn.blocks)
        const output = blocks.find(
          (block) =>
            block.type === "tool_result" && block.tool_use_id === "active"
        )
        assert(output?.type === "tool_result")
        assert.equal(output.output_preview?.length, (256 + BATCHES) * 1_024)
        assert(
          timeline(1).some((entry) =>
            entry.inProgressToolCallIds?.has("active")
          )
        )
        resetConversationRuntimeStore()
      },
    }
  )
})

describe("retained sessions (one operation = 32 rounds, selectors read after every flush)", () => {
  const histories = Array.from({ length: 8 }, (_, index) =>
    detail(index + 1, 2_000)
  )
  for (const activeCount of [1, 8]) {
    let idleTimelines: ReturnType<typeof timeline>[] = []
    bench(
      `${activeCount} streaming / 8 retained conversations`,
      () => {
        let text = BASE_TEXT
        for (let batch = 0; batch < BATCHES; batch += 1) {
          text += TEXT_DELTA
          for (let id = 1; id <= activeCount; id += 1) {
            actions.setLiveMessage(id, live([{ type: "text", text }]), true)
            // A Zustand update notifies subscribers across all retained views.
            for (let viewedId = 1; viewedId <= 8; viewedId += 1)
              timeline(viewedId)
          }
        }
      },
      {
        ...options,
        setup: () => {
          seed(histories)
          idleTimelines = histories
            .slice(activeCount)
            .map((history) => timeline(history.summary.id))
        },
        teardown: () => {
          for (let id = 1; id <= activeCount; id += 1) checkText(id, 2_000)
          idleTimelines.forEach((cached, index) =>
            assert.equal(timeline(activeCount + index + 1), cached)
          )
          resetConversationRuntimeStore()
        },
      }
    )
  }
})
