import { beforeEach, describe, expect, it, vi } from "vitest"
import { useTabStore, resetTabStore } from "@/stores/tab-store"
import {
  resetAppWorkspaceStore,
  useAppWorkspaceStore,
} from "@/stores/app-workspace-store"
import { leafIds, computeRects } from "@/lib/tab-group-layout"
import {
  buildNewConversationDraftStorageKey,
  clearMessageInputDraftV2,
  loadMessageInputDraftV2,
  saveMessageInputDraftV2,
} from "@/lib/message-input-draft"
import type { DbConversationSummary, FolderDetail } from "@/lib/types"
import { source } from "./contract-source"

vi.mock("@/lib/api", () => ({
  listOpenedTabs: vi.fn().mockResolvedValue([]),
  saveOpenedTabs: vi.fn().mockResolvedValue({}),
  getFolderConversation: vi.fn(),
}))
vi.mock("@/lib/platform", () => ({
  subscribe: vi.fn(),
  onTransportReconnect: vi.fn(),
}))
const conversation = (id: number) =>
  ({
    id,
    folder_id: 1,
    agent_type: "codex",
    title: `Session ${id}`,
  }) as DbConversationSummary
const doc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Do not lose this draft" },
        { type: "reference", attrs: { path: "/repo/a.ts", label: "a.ts" } },
      ],
    },
  ],
}

beforeEach(() => {
  localStorage.clear()
  resetAppWorkspaceStore()
  resetTabStore()
  const folder = { id: 1, path: "/repo", name: "repo" } as FolderDetail
  useAppWorkspaceStore.setState({ folders: [folder], allFolders: [folder] })
  useTabStore.getState().openNewConversationTab(1, "/repo")
})

function seedSplit() {
  const root = leafIds(useTabStore.getState().groupLayout)[0]
  useTabStore.getState().openConversationInGroup(conversation(1), root, null)
  useTabStore.getState().openConversationInGroup(conversation(2), root, "right")
  return root
}

describe("pane close and replacement without hidden tab stacks", () => {
  it("removes the entire closed pane and fills its space instead of revealing hidden conversations", () => {
    const root = seedSplit()
    const st = useTabStore.getState()
    const hidden = { ...st.rawTabs[0], id: "hidden", conversationId: 3 }
    useTabStore.setState({
      rawTabs: [...st.rawTabs, hidden],
      groupOf: { ...st.groupOf, hidden: root },
    })
    useTabStore.getState().closePane("conv-1-codex-1")
    const after = useTabStore.getState()
    expect(after.rawTabs.map((tab) => tab.conversationId)).toEqual([2])
    expect([...computeRects(after.groupLayout).groups.values()]).toEqual([
      { x: 0, y: 0, w: 100, h: 100 },
    ])
  })

  it("opens a fresh draft after the last pane closes", () => {
    const root = seedSplit()
    useTabStore.getState().closeGroup(root)
    useTabStore.getState().closePane("conv-1-codex-2")
    const st = useTabStore.getState()
    expect(st.rawTabs).toHaveLength(1)
    expect(st.rawTabs[0].conversationId).toBeNull()
    expect(st.activeTabId).toBe(st.rawTabs[0].id)
    expect(leafIds(st.groupLayout)).toHaveLength(1)
  })

  it("repeated center drops keep only the latest conversation", () => {
    const root = seedSplit()
    for (const id of [3, 4, 5])
      useTabStore
        .getState()
        .openConversationInGroup(conversation(id), root, null)
    expect(
      useTabStore
        .getState()
        .rawTabs.map((tab) => tab.conversationId)
        .sort()
    ).toEqual([2, 5])
    useTabStore.getState().closePane("conv-1-codex-5")
    expect(
      useTabStore.getState().rawTabs.map((tab) => tab.conversationId)
    ).toEqual([2])
  })

  it.each(["close", "replace"])(
    "archives rich drafts on %s and restores them after a store restart",
    (action) => {
      const st = useTabStore.getState()
      const draft = st.rawTabs[0]
      const key = buildNewConversationDraftStorageKey(draft.id)
      saveMessageInputDraftV2(key, doc)
      if (action === "close") st.closePane(draft.id)
      else
        st.openConversationInGroup(
          conversation(1),
          leafIds(st.groupLayout)[0],
          null
        )
      expect(
        useTabStore.getState().rawTabs.some((tab) => tab.id === draft.id)
      ).toBe(false)
      expect(useTabStore.getState().archivedPaneDrafts).toHaveLength(1)
      clearMessageInputDraftV2(key)
      resetTabStore()
      expect(useTabStore.getState().restorePaneDraft()).toBe(true)
      expect(useTabStore.getState().rawTabs).toHaveLength(1)
      expect(useTabStore.getState().rawTabs[0].id).toBe(draft.id)
      expect(loadMessageInputDraftV2(key)).toEqual({ kind: "doc", doc })
      expect(useTabStore.getState().archivedPaneDrafts).toHaveLength(0)
    }
  )

  it("routes closing controls through pane semantics and exposes draft recovery", () => {
    expect(
      source("src/components/layout/workspace-chrome-controller.tsx")
    ).toContain("closePane(activeTabId)")
    expect(
      source("src/components/conversations/conversation-detail-panel.tsx")
    ).toContain("closePane(activeTabId)")
    expect(
      source("src/components/conversations/conversation-detail-header.tsx")
    ).toContain('t("restorePaneDraft")')
  })
})
