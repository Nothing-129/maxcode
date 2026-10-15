import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useNewChatFromTodo } from "@/components/todos/use-new-chat-from-todo"
import { todoConversationText } from "@/components/todos/board-columns"
import {
  consumeAskSelectionPrompts,
  resetAskSelectionPromptsForTests,
} from "@/lib/ask-selection-handoff"
import {
  buildNewConversationDraftStorageKey,
  loadMessageInputDraftV2,
} from "@/lib/message-input-draft"
import {
  loadLastNewConversationContext,
  saveLastNewConversationContext,
} from "@/lib/last-new-conversation-context-storage"
import { saveLastActiveContext } from "@/lib/last-active-context-storage"
import { saveLastSelectedAgent } from "@/lib/last-selected-agent-storage"
import type { FolderDetail } from "@/lib/types"
import {
  resetAppWorkspaceStore,
  useAppWorkspaceStore,
} from "@/stores/app-workspace-store"
import { resetTabStore, useTabStore } from "@/stores/tab-store"

const { setRoute } = vi.hoisted(() => ({ setRoute: vi.fn() }))

vi.mock("@/contexts/workbench-route-context", () => ({
  useWorkbenchRoute: () => ({ setRoute }),
}))
vi.mock("@/lib/api", () => ({
  listOpenedTabs: vi.fn(),
  saveOpenedTabs: vi.fn(),
  getFolderConversation: vi.fn(),
}))
vi.mock("@/lib/platform", () => ({
  subscribe: vi.fn(),
  onTransportReconnect: vi.fn(),
}))

function folder(id: number, path: string): FolderDetail {
  return {
    id,
    name: path,
    path,
    kind: "regular",
    default_agent_type: "codex",
    git_branch: null,
    last_opened_at: "2026-10-14T00:00:00Z",
    sort_order: id,
    color: "blue",
    parent_id: null,
    alias: null,
    group_id: null,
  }
}

const folderA = folder(1, "/project-a")
const folderB = folder(2, "/project-b")

function viewHistoryB() {
  useTabStore.getState().openTab(2, 20, "claude_code", true, "History B")
}

function insertTodo(text = "Review the release") {
  const { result } = renderHook(() => useNewChatFromTodo(() => text))
  act(() => result.current())
  const state = useTabStore.getState()
  return state.rawTabs.find((tab) => tab.id === state.activeTabId)!
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  resetTabStore()
  resetAppWorkspaceStore()
  resetAskSelectionPromptsForTests()
  useAppWorkspaceStore.setState({
    folders: [folderA, folderB],
    allFolders: [folderA, folderB],
  })
  useTabStore.getState().setAgentAvailability(["codex", "claude_code"], true)
})

describe("MaxCode: todo drafts remember the last new conversation folder", () => {
  it("uses last created A while history B is active, with A's live path and agent", () => {
    const opened = useTabStore
      .getState()
      .openNewConversationTab(1, "/project-a/old-subdir")!
    useTabStore
      .getState()
      .bindConversationTab(opened.tabId, 10, "codex", "New conversation A")
    viewHistoryB()
    const renamedA = { ...folderA, path: "/project-a-moved" }
    useAppWorkspaceStore.setState({
      folders: [renamedA, folderB],
      allFolders: [renamedA, folderB],
    })

    const target = insertTodo()
    expect(target).toMatchObject({
      folderId: 1,
      workingDir: "/project-a-moved",
      agentType: "codex",
      conversationId: null,
    })
    expect(loadLastNewConversationContext()).toEqual({
      kind: "folder",
      folderId: 1,
    })
    expect(setRoute).toHaveBeenCalledWith("conversations")
  })

  it("preserves the folder's explicit agent selection instead of history's agent", () => {
    saveLastNewConversationContext({ kind: "folder", folderId: 1 })
    saveLastSelectedAgent(folderA.path, "grok")
    viewHistoryB()
    expect(insertTodo()).toMatchObject({ folderId: 1, agentType: "grok" })
  })

  it("keeps the last new chat folderless after opening project history", () => {
    const opened = useTabStore.getState().openChatModeTab()!
    useTabStore
      .getState()
      .bindConversationTab(opened.tabId, 10, "codex", "Chat")
    viewHistoryB()
    expect(insertTodo()).toMatchObject({
      isChat: true,
      folderId: 0,
      workingDir: undefined,
      conversationId: null,
    })
    expect(loadLastNewConversationContext()).toEqual({ kind: "chat" })
  })

  it("falls back to a live active folder when the remembered folder was removed", () => {
    saveLastNewConversationContext({ kind: "folder", folderId: 1 })
    useAppWorkspaceStore.setState({
      folders: [folderB],
      allFolders: [folderB],
    })
    viewHistoryB()
    expect(insertTodo()).toMatchObject({
      folderId: 2,
      workingDir: "/project-b",
      agentType: "codex",
    })
  })

  it("falls back to chat when neither remembered nor active folder is available", () => {
    saveLastNewConversationContext({ kind: "folder", folderId: 1 })
    useAppWorkspaceStore.setState({ folders: [], allFolders: [] })
    expect(insertTodo()).toMatchObject({ folderId: 0, isChat: true })
  })

  it("remembers folder selector retargets of an existing unsent draft", () => {
    const first = useTabStore
      .getState()
      .openNewConversationTab(1, folderA.path)!
    const retargeted = useTabStore
      .getState()
      .openNewConversationTab(2, folderB.path, { inheritFromActive: true })!
    expect(retargeted.tabId).toBe(first.tabId)
    expect(useTabStore.getState().draftRetargetRequests).toEqual([
      expect.objectContaining({ tabId: first.tabId, folderId: 2 }),
    ])
    expect(loadLastNewConversationContext()).toEqual({
      kind: "folder",
      folderId: 2,
    })
    useTabStore.getState().openChatModeTab()
    expect(loadLastNewConversationContext()).toEqual({ kind: "chat" })
  })

  it("persists across restart without active-draft recovery overwriting the selection", () => {
    useTabStore.getState().openNewConversationTab(1, folderA.path)
    saveLastActiveContext({ folderId: 2, isChat: false })
    resetTabStore()
    useTabStore.getState().recoverActiveContext()
    expect(useTabStore.getState().rawTabs[0].folderId).toBe(2)
    expect(loadLastNewConversationContext()).toEqual({
      kind: "folder",
      folderId: 1,
    })
  })

  it("persists the entire literal body and source link in a fresh unsent draft", () => {
    saveLastNewConversationContext({ kind: "folder", folderId: 1 })
    const text = todoConversationText({
      content: "  检查发布\n\n保留 **原文**\n",
      source_url: "https://example.com/share/conversation",
    } as Parameters<typeof todoConversationText>[0])
    const target = insertTodo(text)
    const identity = { folderId: target.folderId, agentType: target.agentType }
    expect(consumeAskSelectionPrompts(target.id, identity)).toEqual([])
    expect(
      consumeAskSelectionPrompts(
        target.id,
        { ...identity, folderId: 2 },
        "draft"
      )
    ).toEqual([])
    expect(consumeAskSelectionPrompts(target.id, identity, "draft")).toEqual([])
    expect(
      loadMessageInputDraftV2(buildNewConversationDraftStorageKey(target.id))
    ).toEqual({ kind: "legacyMarkdown", markdown: text })
    expect(consumeAskSelectionPrompts(target.id, identity, "draft")).toEqual([])
    expect(target.conversationId).toBeNull()
  })
})
