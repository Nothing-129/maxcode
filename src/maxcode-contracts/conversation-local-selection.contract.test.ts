import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { resetTabStore, useTabStore } from "@/stores/tab-store"
import {
  resetAppWorkspaceStore,
  useAppWorkspaceStore,
} from "@/stores/app-workspace-store"
import type { FolderDetail, OpenedTab } from "@/lib/types"

const { list, save } = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn() }))
vi.mock("@/lib/api", () => ({
  listOpenedTabs: list,
  saveOpenedTabs: save,
  getFolderConversation: vi.fn(),
}))

function item(id: number, active = false): OpenedTab {
  return {
    id,
    folder_id: 1,
    conversation_id: id,
    agent_type: "codex",
    position: id,
    is_active: active,
    is_pinned: true,
  }
}

beforeEach(async () => {
  localStorage.clear()
  resetTabStore()
  resetAppWorkspaceStore()
  vi.clearAllMocks()
  const folder = { id: 1, path: "/repo", name: "repo" } as FolderDetail
  useAppWorkspaceStore.setState({ folders: [folder], allFolders: [folder] })
  list.mockResolvedValue({ version: 1, items: [item(1757, true), item(2463)] })
  useTabStore.getState().hydrate()
  await vi.waitFor(() => expect(useTabStore.getState().tabsHydrated).toBe(true))
  // The same openTab action used by both pinned and ordinary sidebar rows.
  useTabStore.getState().openTab(1, 2463, "codex")
})

afterEach(() => {
  resetTabStore()
  resetAppWorkspaceStore()
  vi.useRealTimers()
})

function expectPinnedSelected() {
  const state = useTabStore.getState()
  expect(state.activeTabId).toBe("conv-1-codex-2463")
  expect(Object.values(state.groupSelection)).toContain("conv-1-codex-2463")
  expect(
    state.tabs.find((tab) => tab.id === state.activeTabId)?.conversationId
  ).toBe(2463)
}

describe("window-local conversation selection", () => {
  it("keeps the clicked pinned conversation when another window broadcasts its focus", () => {
    useTabStore.getState().handleTabsChanged({
      version: 2,
      origin: "other-window",
      tabs: [item(1757, true), item(2463), item(2476)],
    })
    expectPinnedSelected()
    expect(
      useTabStore.getState().tabs.some((tab) => tab.conversationId === 2476)
    ).toBe(true)
  })

  it("keeps the clicked conversation when saving loses a version conflict", async () => {
    vi.useFakeTimers()
    save.mockResolvedValue({
      accepted: false,
      version: 2,
      tabs: [item(1757, true), item(2463)],
    })
    useTabStore.getState().runSaveEffect()
    await vi.advanceTimersByTimeAsync(500)
    expectPinnedSelected()
  })

  it("keeps window selection when reconnect refetches another window's focus", async () => {
    list.mockResolvedValue({
      version: 2,
      items: [item(1757, true), item(2463)],
    })
    await useTabStore.getState().refetchTabs()
    expectPinnedSelected()
    // Remote focus alone must not start a save/broadcast ping-pong.
    useTabStore.getState().runSaveEffect()
    vi.useFakeTimers()
    useTabStore.getState().runSaveEffect()
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).not.toHaveBeenCalled()
  })

  it("still selects a surviving conversation when the current one is closed remotely", () => {
    useTabStore.getState().handleTabsChanged({
      version: 2,
      origin: "other-window",
      tabs: [item(1757, true)],
    })
    expect(useTabStore.getState().activeTabId).toBe("conv-1-codex-1757")
    expect(useTabStore.getState().tabs).toHaveLength(1)
  })
})
