import { cleanup, render } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SidebarConversationCard } from "@/components/conversations/sidebar-conversation-card"
import {
  buildRows,
  type ConversationRow,
} from "@/components/conversations/sidebar-conversation-grouping"
import type { DbConversationSummary } from "@/lib/types"
import enMessages from "@/i18n/messages/en.json"
import { source } from "./contract-source"

vi.mock("@/lib/api", () => ({
  getUiPreferences: vi.fn(async () => null),
  updateUiPreferences: vi.fn(async (prefs: unknown) => prefs),
}))
vi.mock("@/lib/platform", () => ({
  subscribe: vi.fn(async () => () => {}),
  onTransportReconnect: vi.fn(() => null),
}))

const parent = {
  id: 1,
  folder_id: 10,
  title: "Parent session",
  title_locked: false,
  agent_type: "codex",
  status: "pending",
  kind: "regular",
  model: null,
  git_branch: null,
  external_id: null,
  message_count: 0,
  child_count: 1,
  created_at: "2026-10-27T00:00:00Z",
  updated_at: "2026-10-27T00:00:00Z",
  pinned_at: null,
} satisfies DbConversationSummary
const child = { ...parent, id: 2, parent_id: 1, child_count: 1 }
const grandchild = { ...parent, id: 3, parent_id: 2, child_count: 0 }
const noop = vi.fn()
const asyncNoop = vi.fn(async () => {})

afterEach(cleanup)

function rows(loading = false) {
  return buildRows({
    pinned: [],
    pinnedExpanded: true,
    orderedFolderIds: [10],
    byFolder: new Map([[10, [parent]]]),
    folderExpanded: {},
    folderTotalCounts: new Map([[10, 1]]),
    foldersExpanded: true,
    chatConversations: [],
    chatsExpanded: true,
    recentConversations: [parent],
    showRecent: true,
    todoGroups: [{ id: "todo-1", title: "Todo", conversations: [parent] }],
    showTodos: true,
    conversationExpanded: new Set([1, 2]),
    childrenByParent: loading
      ? new Map()
      : new Map([
          [1, [child]],
          [2, [grandchild]],
        ]),
  })
}

describe("sidebar session tree rails", () => {
  it("keeps Todo and Folder indent while Recent remains flat", () => {
    const roots = rows().filter(
      (r): r is ConversationRow =>
        r.kind === "conversation" && r.conversation.id === 1
    )
    expect(roots).toHaveLength(3)
    expect(roots.map((r) => r.depth).sort()).toEqual([0, 1, 1])
  })

  it("draws rails only for actual descendants in all three sections", () => {
    for (const row of rows()) {
      if (row.kind !== "conversation") continue
      const { container, unmount } = render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <SidebarConversationCard
            conversation={row.conversation}
            depth={row.depth}
            railFrom={row.depth - (row.subsessionDepth ?? 0)}
            isSelected={false}
            timeLabel="1m"
            onSelect={noop}
            onRename={asyncNoop}
            onDelete={asyncNoop}
            onStatusChange={asyncNoop}
          />
        </NextIntlClientProvider>
      )
      const treeDepth = row.conversation.id - 1
      expect(container.querySelectorAll("[data-subsession-rail]")).toHaveLength(
        treeDepth
      )
      expect(
        container.querySelectorAll("[data-conversation-rail]")
      ).toHaveLength(treeDepth > 0 ? 1 : 0)
      unmount()
    }
  })

  it("keeps loading connectors anchored to the session, excluding container indent", () => {
    const loadingRows = rows(true).filter(
      (r) => r.kind === "subsession-loading"
    )
    expect(loadingRows).toHaveLength(3)
    expect(loadingRows.map((r) => r.subsessionDepth)).toEqual([1, 1, 1])
    expect(loadingRows.map((r) => r.depth - r.subsessionDepth).sort()).toEqual([
      0, 1, 1,
    ])
    const list = source(
      "src/components/conversations/sidebar-conversation-list.tsx"
    )
    expect(list).toContain("railFrom={row.depth - (row.subsessionDepth ?? 0)}")
    expect(list).toContain("from={row.depth - row.subsessionDepth}")
  })
})
