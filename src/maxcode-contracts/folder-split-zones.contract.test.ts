import { beforeEach, describe, expect, it, vi } from "vitest"
import { source } from "./contract-source"
import { computeRects, firstLeafId, leafIds } from "@/lib/tab-group-layout"
import { splitDirectionAt } from "@/lib/conversation-drop-target"
import { resetTabStore, selectIsSplit, useTabStore } from "@/stores/tab-store"
import {
  resetAppWorkspaceStore,
  useAppWorkspaceStore,
} from "@/stores/app-workspace-store"
import type { DbConversationSummary, FolderDetail } from "@/lib/types"

vi.mock("@/lib/api", () => ({
  listOpenedTabs: vi.fn().mockResolvedValue([]),
  saveOpenedTabs: vi.fn().mockResolvedValue({}),
  getFolderConversation: vi.fn(),
}))
vi.mock("@/lib/platform", () => ({
  subscribe: vi.fn(),
  onTransportReconnect: vi.fn(),
}))

beforeEach(() => {
  localStorage.clear()
  resetAppWorkspaceStore()
  const folder = { id: 1, name: "repo", path: "/repo" } as FolderDetail
  useAppWorkspaceStore.setState({ folders: [folder], allFolders: [folder] })
  resetTabStore()
  useTabStore.getState().openNewConversationTab(1, "/repo")
})

function split(groupId: string, direction: "right" | "down" | "up") {
  const state = useTabStore.getState()
  state.dropTabInGroup(state.groupSelection[groupId], groupId, direction)
}

describe("MaxCode contract: direct drag conversation splits", () => {
  it("builds two columns, left-one/right-two, then four panes without buttons", () => {
    const first = firstLeafId(useTabStore.getState().groupLayout)
    const originalTab = useTabStore.getState().rawTabs[0]
    split(first, "right")
    let state = useTabStore.getState()
    expect(selectIsSplit(state)).toBe(true)
    const second = leafIds(state.groupLayout)[1]
    split(second, "down")
    state = useTabStore.getState()
    expect([...computeRects(state.groupLayout).groups.values()]).toEqual([
      { x: 0, y: 0, w: 50, h: 100 },
      { x: 50, y: 0, w: 50, h: 50 },
      { x: 50, y: 50, w: 50, h: 50 },
    ])
    split(first, "down")
    state = useTabStore.getState()
    expect(leafIds(state.groupLayout)).toHaveLength(4)
    expect(state.rawTabs).toContain(originalTab)
    for (const rect of computeRects(state.groupLayout).groups.values()) {
      expect(rect.w).toBe(50)
      expect(rect.h).toBe(50)
    }
    expect(new Set(state.rawTabs.map((tab) => tab.id)).size).toBe(4)
  })

  it("supports upper edge drops and resizes with minimum pane sizes", () => {
    const first = firstLeafId(useTabStore.getState().groupLayout)
    split(first, "up")
    const state = useTabStore.getState()
    const { groups, handles } = computeRects(state.groupLayout)
    expect(groups.get(first)?.y).toBe(50)
    state.resizeGroupSplit(handles[0].splitId, 0, 0.7)
    expect(
      computeRects(useTabStore.getState().groupLayout).groups.get(first)?.y
    ).toBe(70)
    state.resizeGroupSplit(handles[0].splitId, 0, 1)
    expect(
      computeRects(useTabStore.getState().groupLayout).groups.get(first)?.h
    ).toBeCloseTo(15)
  })

  it("restores valid persisted nested layouts and ratios", () => {
    const first = firstLeafId(useTabStore.getState().groupLayout)
    split(first, "right")
    split(leafIds(useTabStore.getState().groupLayout)[1], "down")
    const layout = useTabStore.getState().groupLayout
    localStorage.setItem("workspace:tab-groups:v1", JSON.stringify({ layout }))
    resetTabStore()
    expect(useTabStore.getState().groupLayout).toEqual(layout)
  })

  it("moves saved conversations to another pane without closing them", () => {
    const first = firstLeafId(useTabStore.getState().groupLayout)
    split(first, "right")
    const state = useTabStore.getState()
    const second = leafIds(state.groupLayout)[1]
    const saved = { ...state.rawTabs[0], id: "saved", conversationId: 42 }
    useTabStore.setState({ rawTabs: [...state.rawTabs, saved] })
    useTabStore.getState().dropTabInGroup("saved", second, null)
    expect(useTabStore.getState().groupOf.saved).toBe(second)
    expect(useTabStore.getState().rawTabs).toContain(saved)
    useTabStore.getState().dropTabInGroup("saved", first, "down")
    expect(leafIds(useTabStore.getState().groupLayout)).toHaveLength(3)
    expect(useTabStore.getState().rawTabs).toContain(saved)
  })

  it("ignores invalid groups and preserves draft ownership on cross-group drops", () => {
    const first = firstLeafId(useTabStore.getState().groupLayout)
    split(first, "right")
    const state = useTabStore.getState()
    const second = leafIds(state.groupLayout)[1]
    const draft = state.rawTabs[0].id
    state.dropTabInGroup(draft, second, "down")
    state.dropTabInGroup(draft, "missing", "right")
    expect(useTabStore.getState().groupLayout).toBe(state.groupLayout)
    expect(useTabStore.getState().rawTabs).toBe(state.rawTabs)
  })

  it("uses four bounded edge zones and a central move zone", () => {
    const rect = { left: 100, top: 50, width: 800, height: 600 }
    expect(splitDirectionAt(110, 350, rect)).toBe("left")
    expect(splitDirectionAt(890, 350, rect)).toBe("right")
    expect(splitDirectionAt(500, 60, rect)).toBe("up")
    expect(splitDirectionAt(500, 640, rect)).toBe("down")
    expect(splitDirectionAt(500, 350, rect)).toBeNull()
    expect(splitDirectionAt(99, 350, rect)).toBeNull()
  })

  it("wires title drag, edge previews and keeps mobile single-pane", () => {
    const header = source(
      "src/components/conversations/conversation-detail-header.tsx"
    )
    const panel = source(
      "src/components/conversations/conversation-detail-panel.tsx"
    )
    expect(header).toMatch(
      /onPointerDown=\{\(event\) => \{[\s\S]*?handleTitleDrag\(event\)/
    )
    expect(header).toContain('WebkitAppRegion: "no-drag"')
    expect(panel).toContain('data-split-preview={dragDirection ?? "center"}')
    expect(panel).toContain("const showSplitLayout = isSplit && !isMobile")
    expect(panel).toContain("<GroupSplitHandle")
    expect(panel).not.toContain("<TabBar")
    expect(panel).not.toContain("SplitStripCornerReserve")
  })
})

describe("MaxCode contract: drag saved conversations from sidebar folders", () => {
  const conversation = (id: number) =>
    ({
      id,
      folder_id: 1,
      agent_type: "codex",
      title: `Session ${id}`,
    }) as DbConversationSummary

  it("opens unopened conversations in exactly the dropped pane without replacing the original", () => {
    const original = useTabStore.getState().rawTabs[0]
    const root = firstLeafId(useTabStore.getState().groupLayout)
    useTabStore
      .getState()
      .openConversationInGroup(conversation(101), root, "right")
    let state = useTabStore.getState()
    const right = leafIds(state.groupLayout)[1]
    expect(state.groupSelection[right]).toBe("conv-1-codex-101")
    expect(state.rawTabs).toContain(original)
    state.openConversationInGroup(conversation(102), right, "down")
    state.openConversationInGroup(conversation(103), root, "down")
    state = useTabStore.getState()
    expect(leafIds(state.groupLayout)).toHaveLength(4)
    expect(state.rawTabs.map((tab) => tab.conversationId)).toEqual([
      null,
      101,
      102,
      103,
    ])
    expect(
      [...computeRects(state.groupLayout).groups.values()].every(
        (rect) => rect.w === 50 && rect.h === 50
      )
    ).toBe(true)
  })

  it("opens a center drop without splitting or retaining an invisible tab", () => {
    const original = useTabStore.getState().rawTabs[0]
    const root = firstLeafId(useTabStore.getState().groupLayout)
    useTabStore
      .getState()
      .openConversationInGroup(conversation(101), root, null)
    expect(leafIds(useTabStore.getState().groupLayout)).toEqual([root])
    expect(useTabStore.getState().activeTabId).toBe("conv-1-codex-101")
    expect(useTabStore.getState().rawTabs).not.toContain(original)
    expect(useTabStore.getState().rawTabs).toHaveLength(1)
  })

  it("moves an already open conversation without duplicating it", () => {
    const root = firstLeafId(useTabStore.getState().groupLayout)
    useTabStore
      .getState()
      .openConversationInGroup(conversation(101), root, "right")
    useTabStore
      .getState()
      .openConversationInGroup(conversation(101), root, null)
    const state = useTabStore.getState()
    expect(
      state.rawTabs.filter((tab) => tab.conversationId === 101)
    ).toHaveLength(1)
    expect(state.groupOf["conv-1-codex-101"]).toBe(root)
  })

  it("puts a sole existing conversation on the chosen edge and leaves a draft on its old side", () => {
    const root = firstLeafId(useTabStore.getState().groupLayout)
    useTabStore
      .getState()
      .openConversationInGroup(conversation(101), root, null)
    useTabStore
      .getState()
      .openConversationInGroup(conversation(101), root, "left")
    const state = useTabStore.getState()
    expect(leafIds(state.groupLayout)).toHaveLength(2)
    expect(state.groupSelection[leafIds(state.groupLayout)[0]]).toBe(
      "conv-1-codex-101"
    )
    expect(
      state.rawTabs.filter((tab) => tab.conversationId == null)
    ).toHaveLength(1)
  })

  it("wires gestures on sidebar conversation rows while keeping tab bars absent", () => {
    expect(
      source("src/components/conversations/sidebar-conversation-list.tsx")
    ).toContain("onConversationPointerDown={handleConversationPointerDown}")
    expect(
      source("src/components/conversations/sidebar-conversation-card.tsx")
    ).toContain("onConversationPointerDown?.(event, conversation)")
    expect(
      source("src/components/conversations/conversation-detail-panel.tsx")
    ).not.toContain("<TabBar")
  })
})
