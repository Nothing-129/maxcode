import { afterEach, describe, expect, it, vi } from "vitest"

import type { DbConversationDetail, MessageTurn } from "@/lib/types"
import {
  getTimelineTurns,
  resetConversationRuntimeStore,
  useConversationRuntimeStore,
} from "@/stores/conversation-runtime-store"

vi.mock("@/lib/api", () => ({ getFolderConversation: vi.fn() }))

const { getFolderConversation } = await import("@/lib/api")
const CID = 99
const prompt: MessageTurn = {
  id: "optimistic-original",
  role: "user",
  blocks: [{ type: "text", text: "check my ACP connection" }],
  timestamp: "2026-09-30T02:48:40.000Z",
}
const reply: MessageTurn = {
  id: "parsed-reply",
  role: "assistant",
  blocks: [{ type: "text", text: "The connection has recovered." }],
  timestamp: "2026-09-30T02:53:17.000Z",
}

const actions = () => useConversationRuntimeStore.getState().actions
const ids = (cid = CID) => getTimelineTurns(cid).map((entry) => entry.turn.id)

async function loadHistory(user = { ...prompt, id: "parsed-user" }) {
  const detail: DbConversationDetail = {
    summary: {
      id: CID,
      folder_id: 1,
      title: "ACP",
      title_locked: false,
      agent_type: "codex",
      status: "completed",
      kind: "regular",
      model: null,
      git_branch: null,
      external_id: "codex-session",
      message_count: 2,
      child_count: 0,
      created_at: prompt.timestamp,
      updated_at: reply.timestamp,
      pinned_at: null,
    },
    turns: [user, reply],
  }
  vi.mocked(getFolderConversation).mockResolvedValueOnce(detail)
  actions().refetchDetail(CID)
  await vi.waitFor(() => {
    expect(
      useConversationRuntimeStore.getState().byConversationId.get(CID)?.detail
    ).toBe(detail)
  })
}

afterEach(() => {
  resetConversationRuntimeStore()
  vi.mocked(getFolderConversation).mockReset()
})

describe("completed user message replay", () => {
  it("does not append a viewer prompt again after history replaces its wire id", async () => {
    actions().appendViewerUserTurn(CID, prompt)
    actions().completeTurn(CID)
    await loadHistory()
    actions().appendViewerUserTurn(CID, {
      ...prompt,
      timestamp: "2026-09-30T02:53:18.000Z",
    })
    expect(ids()).toEqual(["parsed-user", "parsed-reply"])
  })

  it("remembers an owner's completed prompt even when no echo arrived during the turn", async () => {
    actions().appendOptimisticTurn(CID, prompt, prompt.id)
    actions().setLiveMessage(
      CID,
      {
        id: "live-reply",
        role: "assistant",
        content: [{ type: "text", text: "The connection has recovered." }],
        startedAt: Date.parse(prompt.timestamp),
      },
      true
    )
    actions().completeTurn(CID)
    await loadHistory()
    actions().appendViewerUserTurn(CID, prompt)
    expect(ids()).toEqual(["parsed-user", "parsed-reply"])
  })

  it("remembers an echo already deduped against the stamped history id", async () => {
    await loadHistory(prompt)
    actions().appendViewerUserTurn(CID, prompt)
    await loadHistory()
    actions().appendViewerUserTurn(CID, prompt)
    expect(ids()).toEqual(["parsed-user", "parsed-reply"])
  })

  it("keeps a genuinely new prompt with identical content and a different message id", async () => {
    actions().appendViewerUserTurn(CID, prompt)
    actions().completeTurn(CID)
    await loadHistory()
    actions().appendViewerUserTurn(CID, { ...prompt, id: "optimistic-new" })
    expect(ids()).toEqual(["parsed-user", "parsed-reply", "optimistic-new"])
  })

  it("preserves replay protection when a draft session migrates to a database row", async () => {
    actions().appendViewerUserTurn(-10, prompt)
    actions().completeTurn(-10)
    actions().migrateConversation(-10, CID)
    await loadHistory()
    actions().appendViewerUserTurn(CID, prompt)
    expect(ids()).toEqual(["parsed-user", "parsed-reply"])
  })
})
