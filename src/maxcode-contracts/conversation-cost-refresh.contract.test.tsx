import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useComposerCostEstimate } from "@/components/chat/composer-cost-estimate"
import {
  resetConversationRuntimeStore,
  useConversationRuntimeStore,
} from "@/stores/conversation-runtime-store"
import type {
  ConversationBillingUsage,
  DbConversationDetail,
} from "@/lib/types"

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("@/lib/api", () => ({
  getFolderConversation: vi.fn(),
  getFolderConversationTurns: vi.fn(),
  opencodeProviderCatalog: vi.fn(async () => [
    { id: "anthropic", models: [{ id: "claude-test", cost_in: 3 }] },
  ]),
}))
const { getFolderConversation } = await import("@/lib/api")
const mockGet = vi.mocked(getFolderConversation)
const CID = 77
const actions = () => useConversationRuntimeStore.getState().actions
const session = () =>
  useConversationRuntimeStore.getState().byConversationId.get(CID)!
const bucket = (tokens: number): ConversationBillingUsage[] => [
  {
    model: "claude-test",
    usage: {
      input_tokens: tokens,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  },
]
const detail: DbConversationDetail = {
  summary: {
    id: CID,
    folder_id: 1,
    agent_type: "claude_code",
    title: null,
    title_locked: false,
    status: "completed",
    kind: "regular",
    model: null,
    git_branch: null,
    external_id: "test-session",
    message_count: 0,
    child_count: 0,
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
    pinned_at: null,
  },
  turns: [],
  session_stats: null,
  billing_usage: bucket(10000),
}

beforeEach(async () => {
  vi.useFakeTimers()
  resetConversationRuntimeStore()
  mockGet.mockReset().mockResolvedValue(detail)
  actions().fetchDetail(CID)
  await vi.advanceTimersByTimeAsync(0)
  useConversationRuntimeStore.setState({
    byConversationId: new Map([
      [
        CID,
        {
          ...session(),
          localTurns: [
            {
              id: "local-reply",
              role: "assistant",
              blocks: [{ type: "text", text: "Completed reply" }],
              timestamp: "2026-09-10T00:00:01Z",
            },
          ],
        },
      ],
    ]),
  })
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  resetConversationRuntimeStore()
})

describe("composer cost refresh after a reply", () => {
  it("updates the mounted amount from billing-only metadata without replacing the reply", async () => {
    const { result, unmount } = renderHook(() => {
      const buckets = useConversationRuntimeStore(
        (s) => s.byConversationId.get(CID)?.detail?.billing_usage ?? null
      )
      return useComposerCostEstimate(buckets)
    })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current.inlineValue).toBe("$0.03")
    const localTurns = session().localTurns
    const history = session().detail!.turns
    mockGet.mockResolvedValue({ ...detail, billing_usage: bucket(20000) })
    actions().syncTurnMetadata(CID)
    await act(() => vi.advanceTimersByTimeAsync(1500))
    expect(result.current.inlineValue).toBe("$0.06")
    expect(session().localTurns).toBe(localTurns)
    expect(session().detail!.turns).toBe(history)
    expect(mockGet).toHaveBeenCalledTimes(2)
    unmount()
  })

  it.each([undefined, null])(
    "preserves known billing when the response contains %s",
    async (billing) => {
      mockGet.mockResolvedValue({ ...detail, billing_usage: billing })
      actions().syncTurnMetadata(CID)
      await vi.advanceTimersByTimeAsync(1500)
      expect(session().detail!.billing_usage).toEqual(bucket(10000))
    }
  )

  it("accepts empty billing totals instead of retaining an obsolete price", async () => {
    mockGet.mockResolvedValue({ ...detail, billing_usage: [] })
    actions().syncTurnMetadata(CID)
    await vi.advanceTimersByTimeAsync(1500)
    expect(session().detail!.billing_usage).toEqual([])
  })
})
