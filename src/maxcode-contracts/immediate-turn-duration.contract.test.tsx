import { render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  HistoricalMessageGroup,
  mergeConsecutiveAssistantTurns,
  type ThreadRenderItem,
} from "@/components/message/message-list-view"
import zhMessages from "@/i18n/messages/zh-CN.json"
import { adaptMessageTurn } from "@/lib/adapters/ai-elements-adapter"
import type { DbConversationDetail, MessageTurn } from "@/lib/types"
import {
  getTimelineTurns,
  resetConversationRuntimeStore,
  useConversationRuntimeStore,
} from "@/stores/conversation-runtime-store"

vi.mock("@/lib/api", () => ({ getFolderConversation: vi.fn() }))

const { getFolderConversation } = await import("@/lib/api")
const CID = 91
const START = Date.parse("2026-11-10T08:00:00.000Z")

function replyItem(turns: MessageTurn[]) {
  const items: ThreadRenderItem[] = turns.map((turn) => {
    const message = adaptMessageTurn(turn, {
      attachedResources: "Attached resources",
      toolCallFailed: "Tool failed",
    })
    return {
      key: turn.id,
      kind: "turn",
      group: {
        id: turn.id,
        role: "assistant",
        parts: message.content,
        images: [],
        resources: [],
        duration_ms: turn.duration_ms,
        completed_at: turn.completed_at,
      },
      phase: "persisted",
      isResponseComplete: true,
      showStats: false,
      isRoleTransition: false,
      previousUserIndex: null,
      previousUserAt: null,
      isLastAssistantRun: true,
      isThreadTail: true,
      sourceTurns: [turn],
    }
  })
  const merged = mergeConsecutiveAssistantTurns(items)
  const item = merged[0]
  if (!item || item.kind !== "turn") throw new Error("missing reply")
  return item
}

afterEach(() => {
  resetConversationRuntimeStore()
  vi.mocked(getFolderConversation).mockReset()
  vi.useRealTimers()
})

describe("immediate completed-turn duration", () => {
  it("shows the running clock immediately and keeps it when parsed steps arrive", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(START)
    const actions = useConversationRuntimeStore.getState().actions
    actions.appendOptimisticTurn(
      CID,
      {
        id: "prompt",
        role: "user",
        blocks: [{ type: "text", text: "Check the project" }],
        timestamp: new Date(START).toISOString(),
      },
      "prompt"
    )
    actions.setLiveMessage(
      CID,
      {
        id: "reply",
        role: "assistant",
        startedAt: START,
        content: [
          { type: "text", text: "Checking the project." },
          {
            type: "tool_call",
            info: {
              tool_call_id: "read-1",
              title: "Read",
              kind: "read",
              status: "completed",
              content: "Done",
              raw_input: null,
              raw_output_chunks: [],
              raw_output_total_bytes: 0,
              locations: null,
              meta: {},
              images: [],
            },
          },
          { type: "text", text: "Finished." },
        ],
      },
      true
    )
    vi.setSystemTime(START + 67_800)
    actions.completeTurn(CID)

    const turns = getTimelineTurns(CID)
      .map((item) => item.turn)
      .filter((turn) => turn.role === "assistant")
    expect(turns).toHaveLength(2)
    const item = replyItem(turns)
    const view = render(
      <NextIntlClientProvider locale="zh-CN" messages={zhMessages}>
        <HistoricalMessageGroup
          group={item.group}
          sourceTurns={item.sourceTurns}
          showStats={false}
        />
      </NextIntlClientProvider>
    )
    expect(screen.getByText("用时 1 分 7 秒")).toBeInTheDocument()

    const detail: DbConversationDetail = {
      summary: {
        id: CID,
        folder_id: 1,
        agent_type: "codex",
        title: null,
        title_locked: false,
        status: "completed",
        kind: "regular",
        model: null,
        git_branch: null,
        external_id: "session",
        message_count: 3,
        child_count: 0,
        created_at: new Date(START).toISOString(),
        updated_at: new Date(START + 67_800).toISOString(),
        pinned_at: null,
      },
      turns: [
        {
          id: "parsed-prompt",
          role: "user",
          blocks: [{ type: "text", text: "Check the project" }],
          timestamp: new Date(START).toISOString(),
        },
        ...turns.map((turn, index) => ({
          id: `parsed-reply-${index}`,
          role: turn.role,
          blocks: turn.blocks,
          timestamp: turn.timestamp,
          duration_ms: index === 0 ? 10_000 : 40_000,
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
          completed_at: new Date(START + 67_800).toISOString(),
        })),
      ],
    }
    vi.mocked(getFolderConversation).mockResolvedValue(detail)
    actions.syncTurnMetadata(CID)
    await vi.advanceTimersByTimeAsync(1_500)

    const patchedTurns = getTimelineTurns(CID)
      .map((entry) => entry.turn)
      .filter((turn) => turn.role === "assistant")
    expect(patchedTurns.map((turn) => turn.duration_ms)).toEqual([
      10_000, 40_000,
    ])
    const patched = replyItem(patchedTurns)
    view.rerender(
      <NextIntlClientProvider locale="zh-CN" messages={zhMessages}>
        <HistoricalMessageGroup
          group={patched.group}
          sourceTurns={patched.sourceTurns}
          showStats={false}
        />
      </NextIntlClientProvider>
    )
    expect(screen.getByText("用时 1 分 7 秒")).toBeInTheDocument()
  })

  it("uses recorded durations for historical replies without a live clock", () => {
    const item = replyItem([
      {
        id: "history",
        role: "assistant",
        blocks: [{ type: "text", text: "Previous reply" }],
        timestamp: new Date(START).toISOString(),
        duration_ms: 42_000,
      },
    ])
    render(
      <NextIntlClientProvider locale="zh-CN" messages={zhMessages}>
        <HistoricalMessageGroup
          group={item.group}
          sourceTurns={item.sourceTurns}
          showStats={false}
        />
      </NextIntlClientProvider>
    )
    expect(screen.getByText("用时 42 秒")).toBeInTheDocument()
  })

  it("freezes a separate clock for each reply, including a sub-second reply", () => {
    vi.useFakeTimers()
    vi.setSystemTime(START)
    const actions = useConversationRuntimeStore.getState().actions
    const send = (id: string) => {
      actions.appendOptimisticTurn(
        CID,
        {
          id: `prompt-${id}`,
          role: "user",
          blocks: [{ type: "text", text: id }],
          timestamp: new Date(Date.now()).toISOString(),
        },
        id
      )
      actions.setLiveMessage(
        CID,
        {
          id,
          role: "assistant",
          startedAt: Date.now(),
          content: [{ type: "text", text: `Reply ${id}` }],
        },
        true
      )
    }

    send("first")
    vi.setSystemTime(START + 5_400)
    actions.completeTurn(CID)
    vi.setSystemTime(START + 100_000)
    send("second")
    actions.completeTurn(CID)

    const turns = getTimelineTurns(CID)
      .map((entry) => entry.turn)
      .filter((turn) => turn.role === "assistant")
    expect(turns).toHaveLength(2)
    const replies = turns.map((turn) => replyItem([turn]))
    render(
      <NextIntlClientProvider locale="zh-CN" messages={zhMessages}>
        {replies.map((item) => (
          <HistoricalMessageGroup
            key={item.key}
            group={item.group}
            sourceTurns={item.sourceTurns}
            showStats={false}
          />
        ))}
      </NextIntlClientProvider>
    )
    expect(screen.getByText("用时 5 秒")).toBeInTheDocument()
    expect(screen.getByText("用时 0 秒")).toBeInTheDocument()
  })

  it("adds separate clocks when consecutive replies appear as one group", () => {
    vi.useFakeTimers()
    vi.setSystemTime(START)
    const actions = useConversationRuntimeStore.getState().actions
    const startReply = (id: string) =>
      actions.setLiveMessage(
        CID,
        {
          id,
          role: "assistant",
          startedAt: Date.now(),
          content: [{ type: "text", text: `Reply ${id}` }],
        },
        true
      )

    startReply("first")
    vi.setSystemTime(START + 5_000)
    actions.completeTurn(CID)
    startReply("second")
    vi.setSystemTime(START + 8_000)
    actions.completeTurn(CID)

    const turns = getTimelineTurns(CID)
      .map((entry) => entry.turn)
      .filter((turn) => turn.role === "assistant")
    expect(turns).toHaveLength(2)
    const item = replyItem(turns)
    render(
      <NextIntlClientProvider locale="zh-CN" messages={zhMessages}>
        <HistoricalMessageGroup
          group={item.group}
          sourceTurns={item.sourceTurns}
          showStats={false}
        />
      </NextIntlClientProvider>
    )
    expect(screen.getByText("用时 8 秒")).toBeInTheDocument()
  })
})
