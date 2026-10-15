import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MessageTurn, ConversationOutline } from "@/lib/types"
import type { ThreadRenderItem } from "@/components/message/message-list-view"
import type { MessageScrollContextValue } from "@/components/message/message-scroll-context"
import {
  buildHistoryMessageRailEntries,
  ConversationMessageRail,
} from "@/components/message/conversation-message-rail"
import { useMessageNavJump } from "@/components/message/use-message-nav-jump"
import { useConversationOutline } from "@/hooks/use-conversation-outline"
import { extendPrefixFingerprint, FNV_SEED_HEX } from "@/lib/turn-window"
import { extractSessionFilesGrouped } from "@/lib/session-files"

const mocks = vi.hoisted(() => ({
  outline: vi.fn(),
  load: vi.fn(),
  scroll: vi.fn(),
}))
vi.mock("@/lib/api", () => ({ getFolderConversationOutline: mocks.outline }))
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))

function raw(
  id: string,
  role: "user" | "assistant",
  text: string
): MessageTurn {
  return {
    id,
    role,
    blocks: [{ type: "text", text }],
    timestamp: "2026-10-15T00:00:00Z",
  }
}
function row(
  id: string,
  role: "user" | "assistant",
  text: string
): ThreadRenderItem {
  return {
    kind: "turn",
    group: { id, role, parts: [{ type: "text", text }] },
  } as ThreadRenderItem
}
const earlier = [
  raw("old-user", "user", "Earlier question"),
  raw("old-reply", "assistant", ""),
]
const loaded = [
  row("new-user", "user", "Current question"),
  row("new-reply", "assistant", "Current answer"),
]
const hash = extendPrefixFingerprint(FNV_SEED_HEX, earlier)!
const outline: ConversationOutline = {
  turns: earlier,
  turns_total: 4,
  prefix_hash: hash,
}

function Rail({
  items = loaded,
  count = 1,
  prefixHash = hash,
  offset = 2,
}: {
  items?: ThreadRenderItem[]
  count?: number
  prefixHash?: string
  offset?: number
}) {
  const history = useConversationOutline({
    fetchId: 27,
    offset,
    prefixHash,
    enabled: count > 0,
  })
  const entries = buildHistoryMessageRailEntries(
    items,
    history.state.status === "ready" ? history.state.turns : null,
    count
  )
  const indices = new Map(
    entries.flatMap((entry) =>
      entry.threadIndex != null ? [[entry.id, entry.threadIndex] as const] : []
    )
  )
  const scrollApiRef = {
    current: {
      scrollToIndex: mocks.scroll,
    } as unknown as MessageScrollContextValue,
  }
  const jump = useMessageNavJump({
    conversationId: 27,
    threadIndexByTurnId: indices,
    scrollApiRef,
    smooth: true,
    loadOlderTurnsThrough: mocks.load,
  })
  return (
    <ConversationMessageRail
      entries={entries}
      visibleIndex={0}
      scrollApiRef={scrollApiRef}
      onSelect={(entry) =>
        jump.select({
          turnId: entry.id,
          turnIndex: entry.turnIndex ?? null,
          threadIndex: entry.threadIndex,
        })
      }
      revealingTurnId={jump.revealingTurnId}
      earlier={
        history.state.status === "loading" || history.state.status === "error"
          ? history.state.status
          : null
      }
      onRetryEarlier={history.retry}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.outline.mockResolvedValue(outline)
  mocks.load.mockResolvedValue(false)
})
afterEach(cleanup)

describe("MaxCode full-history navigation retains the question/answer tick rail", () => {
  it("keeps the loaded question/answer tooltip and makes no outline request against older servers", async () => {
    render(<Rail count={0} />)
    const tick = screen.getByRole("button", { name: "1. Current question" })
    fireEvent.focus(tick)
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Current answer"
    )
    expect(screen.getByRole("navigation")).toHaveClass("hidden", "md:flex")
    expect(mocks.outline).not.toHaveBeenCalled()
    fireEvent.click(tick)
    expect(mocks.scroll).toHaveBeenCalledWith(0, {
      align: "start",
      smooth: true,
    })
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it("pages an earlier tick through the verified seam and jumps after its row appears", async () => {
    let finish: (reached: boolean) => void = () => {}
    mocks.load.mockReturnValue(
      new Promise<boolean>((resolve) => {
        finish = resolve
      })
    )
    const { rerender } = render(<Rail />)
    const oldTick = await screen.findByRole("button", {
      name: "1. Earlier question",
    })
    expect(
      screen.getByRole("button", { name: "2. Current question" })
    ).toBeVisible()
    fireEvent.click(oldTick)
    expect(mocks.load).toHaveBeenCalledWith(27, 0)
    expect(oldTick).toHaveAttribute("aria-busy", "true")
    expect(mocks.scroll).not.toHaveBeenCalled()
    rerender(
      <Rail
        count={0}
        offset={0}
        items={[
          row("old-user", "user", "Earlier question"),
          row("old-reply", "assistant", "Earlier answer"),
          ...loaded,
        ]}
      />
    )
    await act(async () => finish(true))
    await waitFor(() =>
      expect(mocks.scroll).toHaveBeenCalledWith(0, {
        align: "start",
        smooth: false,
      })
    )
    expect(mocks.scroll).toHaveBeenCalledTimes(1)
  })

  it("rejects a stale outline, keeps loaded numbering, and offers a retry in the rail", async () => {
    const { rerender } = render(<Rail prefixHash="00000000000000ab" />)
    await screen.findByRole("button", { name: "loadEarlier" })
    expect(
      screen.queryByRole("button", { name: "1. Earlier question" })
    ).toBeNull()
    expect(
      screen.getByRole("button", { name: "2. Current question" })
    ).toBeVisible()
    expect(mocks.outline).toHaveBeenCalledTimes(1)
    mocks.outline.mockResolvedValue({
      ...outline,
      prefix_hash: "00000000000000ab",
    })
    fireEvent.click(screen.getByRole("button", { name: "loadEarlier" }))
    await screen.findByRole("button", { name: "1. Earlier question" })
    expect(mocks.outline).toHaveBeenCalledTimes(2)
    rerender(<Rail count={0} />)
  })

  it("never revives a jump whose paging failed when a later manual prepend reaches it", async () => {
    const { rerender } = render(<Rail />)
    fireEvent.click(
      await screen.findByRole("button", { name: "1. Earlier question" })
    )
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "1. Earlier question" })
      ).not.toHaveAttribute("aria-busy")
    )
    rerender(
      <Rail
        count={0}
        offset={0}
        items={[row("old-user", "user", "Earlier question"), ...loaded]}
      />
    )
    await act(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    )
    expect(mocks.scroll).not.toHaveBeenCalled()
  })

  it("deduplicates a rendered overlay copy and keeps replies crossing the window seam", () => {
    const entries = buildHistoryMessageRailEntries(
      [
        row("seam", "assistant", "Reply already loaded"),
        ...loaded,
        row("old-user", "user", "Earlier question"),
        row("overlay", "assistant", "Overlay answer"),
      ],
      earlier,
      1
    )
    expect(
      entries.map((entry) => [
        entry.id,
        entry.ordinal,
        entry.threadIndex,
        entry.turnIndex,
      ])
    ).toEqual([
      ["old-user", 1, 3, null],
      ["new-user", 2, 1, undefined],
    ])
    expect(entries[0].answer).toBe("Overlay answer")
    expect(entries[1].answer).toBe("Current answer")
    const seam = buildHistoryMessageRailEntries(
      [row("seam", "assistant", "Reply already loaded"), ...loaded],
      earlier,
      1
    )
    expect(seam[0].answer).toBe("Reply already loaded")
  })

  it("does not parse tool payloads while constructing ticks", () => {
    const toolTurn = raw("old-tool", "assistant", "")
    toolTurn.blocks = [
      {
        type: "tool_use",
        tool_use_id: "write",
        tool_name: "Write",
        get input_preview(): string {
          throw new Error("The rail must not parse file changes")
        },
      },
    ]
    expect(
      buildHistoryMessageRailEntries(loaded, [earlier[0], toolTurn], 1).map(
        (entry) => entry.question
      )
    ).toEqual(["Earlier question", "Current question"])
  })

  it("filters a late failed result even when its write turn has already been memoized", () => {
    const write = raw("write-turn", "assistant", "")
    write.blocks = [
      {
        type: "tool_use",
        tool_use_id: "write-call",
        tool_name: "Write",
        input_preview: '{"file_path":"/repo/failed.txt","content":"attempt"}',
      },
    ]
    const turns = [earlier[0], write]
    expect(extractSessionFilesGrouped(turns)[0].files).toHaveLength(1)
    const failed = raw("later-result", "assistant", "")
    failed.blocks = [
      {
        type: "tool_result",
        tool_use_id: "write-call",
        output_preview: "Denied",
        is_error: true,
      },
    ]
    expect(
      extractSessionFilesGrouped([...turns, failed], { includeEmpty: true })[0]
        .files
    ).toEqual([])
    expect(extractSessionFilesGrouped(turns)[0].files).toHaveLength(1)
  })
})
