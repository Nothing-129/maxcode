import { afterEach, expect, it, vi } from "vitest"
import type { DbConversationDetail, MessageTurn } from "@/lib/types"
import {
  getTimelineTurns,
  resetConversationRuntimeStore,
  useConversationRuntimeStore,
} from "@/stores/conversation-runtime-store"

vi.mock("@/lib/api", () => ({ getFolderConversation: vi.fn() }))
const { getFolderConversation } = await import("@/lib/api")

const prompt: MessageTurn = {
  id: "broadcast-prompt",
  role: "user",
  blocks: [{ type: "text", text: "publish changes" }],
  timestamp: "2026-10-16T11:09:50Z",
}
const progress = ["Checking changes.", "Uploading the build."]
const baseDetail: DbConversationDetail = {
  summary: {
    id: 42,
    folder_id: 1,
    title: "publish",
    title_locked: false,
    agent_type: "codex",
    status: "in_progress",
    kind: "regular",
    model: null,
    git_branch: null,
    external_id: "running",
    message_count: 3,
    child_count: 0,
    created_at: prompt.timestamp,
    updated_at: prompt.timestamp,
    pinned_at: null,
  },
  turns: [
    prompt,
    ...progress.map(
      (text, index): MessageTurn => ({
        id: `turn-${index + 1}`,
        role: "assistant",
        blocks: [{ type: "text", text }],
        timestamp: prompt.timestamp,
        completed_at: prompt.timestamp,
      })
    ),
  ],
  in_flight_user_turn_id: prompt.id,
}

afterEach(() => {
  resetConversationRuntimeStore()
  vi.clearAllMocks()
})

it.each(
  ["history-first", "snapshot-first"].flatMap((order) =>
    [
      "publish changes",
      "服务／应用   包名\n百度统计\t\tcom.baidu.duershow.statistic",
    ].map((text) => ({ order, text }))
  )
)(
  "shows one prompt and one running reply when a phone attaches: $order / $text",
  async ({ order, text }) => {
    const spacedPrompt: MessageTurn = {
      ...prompt,
      blocks: [{ type: "text", text }],
    }
    const detail: DbConversationDetail = {
      ...baseDetail,
      turns: [spacedPrompt, ...baseDetail.turns.slice(1)],
    }
    vi.mocked(getFolderConversation).mockResolvedValue(detail)
    const runtime = useConversationRuntimeStore.getState().actions
    const snapshot = () => {
      runtime.setLiveMessage(
        42,
        {
          id: "reply",
          role: "assistant",
          startedAt: Date.parse(prompt.timestamp),
          content: [{ type: "text", text: progress.join("\n\n") }],
        },
        true
      )
      runtime.appendViewerUserTurn(42, spacedPrompt)
    }
    if (order === "snapshot-first") snapshot()
    runtime.refetchDetail(42)
    await vi.waitFor(() => {
      expect(
        useConversationRuntimeStore.getState().byConversationId.get(42)?.detail
      ).toBeTruthy()
    })
    if (order === "history-first") snapshot()

    const turns = getTimelineTurns(42)
    expect(turns.map((item) => item.turn.role)).toEqual(["user", "assistant"])
    expect(turns[0].turn.blocks).toEqual(spacedPrompt.blocks)
    expect(turns[1].phase).toBe("streaming")
    expect(turns[1].turn.blocks).toEqual([
      { type: "text", text: progress.join("\n\n") },
    ])

    const settled = { ...detail, in_flight_user_turn_id: null }
    vi.mocked(getFolderConversation).mockResolvedValue(settled)
    runtime.refetchDetail(42)
    await vi.waitFor(() => {
      expect(
        useConversationRuntimeStore.getState().byConversationId.get(42)?.detail
      ).toBe(settled)
    })
    const completed = getTimelineTurns(42)
    expect(completed.map((item) => item.turn.id)).toEqual([
      prompt.id,
      "turn-1",
      "turn-2",
    ])
    expect(completed[0].turn.blocks).toEqual(spacedPrompt.blocks)
    expect(completed.every((item) => item.phase === "persisted")).toBe(true)
  }
)

it("keeps all persisted progress when no live snapshot is available", async () => {
  vi.mocked(getFolderConversation).mockResolvedValue(baseDetail)
  useConversationRuntimeStore.getState().actions.refetchDetail(42)
  await vi.waitFor(() => expect(getTimelineTurns(42)).toHaveLength(3))
  expect(getTimelineTurns(42).map((item) => item.turn.id)).toEqual([
    prompt.id,
    "turn-1",
    "turn-2",
  ])
})
