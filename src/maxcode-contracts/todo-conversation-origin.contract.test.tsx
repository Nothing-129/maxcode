import { act, render, renderHook, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TodoConversationButton } from "@/components/todos/todo-card"
import { useNewChatFromTodo } from "@/components/todos/use-new-chat-from-todo"
import { useNewChatFromMessage } from "@/components/message/use-new-chat-from-message"
import { createChatConversation, createConversation } from "@/lib/api"
import {
  consumeAskSelectionPrompts,
  resetAskSelectionPromptsForTests,
} from "@/lib/ask-selection-handoff"
import { saveLastNewConversationContext } from "@/lib/last-new-conversation-context-storage"
import {
  buildNewConversationDraftStorageKey,
  loadMessageInputDraftV2,
  saveMessageInputDraft,
} from "@/lib/message-input-draft"
import { leafIds } from "@/lib/tab-group-layout"
import type { Todo, TodoOrigin, TodoState } from "@/lib/todos"
import type { FolderDetail } from "@/lib/types"
import {
  resetAppWorkspaceStore,
  useAppWorkspaceStore,
} from "@/stores/app-workspace-store"
import { resetTabStore, useTabStore } from "@/stores/tab-store"

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  setRoute: vi.fn(),
  todoState: null as TodoState | null,
}))

vi.mock("@/lib/transport", () => ({
  getTransport: () => ({ call: mocks.call }),
}))
vi.mock("@/contexts/workbench-route-context", () => ({
  useWorkbenchRoute: () => ({ setRoute: mocks.setRoute }),
}))
vi.mock("@/contexts/todos-view-context", () => ({
  useOptionalTodosView: () => ({ state: mocks.todoState }),
}))
vi.mock("@/lib/platform", () => ({
  subscribe: vi.fn(),
  onTransportReconnect: vi.fn(),
}))
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

const folder = {
  id: 1,
  name: "project",
  path: "/project",
  kind: "regular",
  default_agent_type: "codex",
} as FolderDetail
const otherFolder = { ...folder, id: 2, path: "/other" }
const todoId = "20da561085a74c658a43a162b1e2d69c"
const teamId = "79fbd9742e864b1f8b3cfa88d38b2c5c"
const personal: TodoOrigin = { scope_id: "personal", todo_id: todoId }
const team: TodoOrigin = { scope_id: teamId, todo_id: todoId }
const todo = {
  id: todoId,
  content: "Review this release",
  source_url: "https://example.test/share#source-conversation",
} as Todo
const hydrationStops: (() => void)[] = []

function activeDraft() {
  const state = useTabStore.getState()
  return state.rawTabs.find((tab) => tab.id === state.activeTabId)!
}

async function hydrateTabs() {
  await act(async () => {
    hydrationStops.push(useTabStore.getState().hydrate())
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  resetTabStore()
  resetAppWorkspaceStore()
  resetAskSelectionPromptsForTests()
  useAppWorkspaceStore.setState({
    folders: [folder, otherFolder],
    allFolders: [folder, otherFolder],
  })
  useTabStore.getState().setAgentAvailability(["codex", "grok"], true)
  saveLastNewConversationContext({ kind: "folder", folderId: 1 })
  mocks.todoState = null
  mocks.call.mockImplementation(async (command: string) => {
    if (command === "list_opened_tabs") return { version: 1, items: [] }
    if (command === "create_chat_conversation") {
      return { conversationId: 80, folderId: 2, folder: otherFolder }
    }
    return 70
  })
})

afterEach(() => {
  hydrationStops.splice(0).forEach((stop) => stop())
  resetTabStore()
})

describe("MaxCode: conversations retain the todos they were created from", () => {
  it("opens an independent draft on every todo action and deduplicates its own origins", () => {
    const { result } = renderHook(() =>
      useNewChatFromTodo(
        () => todo.content,
        () => [personal, team, personal]
      )
    )
    act(() => result.current())
    const first = activeDraft()
    act(() => result.current())
    const second = activeDraft()
    expect(second.id).not.toBe(first.id)
    expect(second.todoOrigins).toEqual([personal, team])
    expect(first.todoOrigins).toEqual([personal, team])
    expect(
      consumeAskSelectionPrompts(
        second.id,
        { agentType: second.agentType, folderId: second.folderId },
        "draft"
      )
    ).toEqual([])
    for (const draft of [first, second]) {
      expect(
        loadMessageInputDraftV2(buildNewConversationDraftStorageKey(draft.id))
      ).toEqual({ kind: "legacyMarkdown", markdown: todo.content })
      expect(draft.conversationId).toBeNull()
    }
  })

  it("keeps origins while the user retargets the folder, agent and chat mode", async () => {
    const target = useTabStore
      .getState()
      .openNewConversationTab(1, folder.path)!
    useTabStore.getState().addDraftTodoOrigins(target.tabId, [team])
    useTabStore.getState().openNewConversationTab(2, otherFolder.path)
    await act(async () => {
      useTabStore.getState().consumeDraftRetargets()
    })
    expect(activeDraft()).toMatchObject({ folderId: 2, todoOrigins: [team] })
    useTabStore.getState().confirmDraftAgent(target.tabId, "grok")
    useTabStore.getState().openChatModeTab()
    expect(activeDraft()).toMatchObject({ isChat: true, todoOrigins: [team] })
  })

  it("restores the captured scope with its draft after restart", async () => {
    await hydrateTabs()
    const target = useTabStore
      .getState()
      .openNewConversationTab(1, folder.path)!
    useTabStore.getState().addDraftTodoOrigins(target.tabId, [team, personal])
    resetTabStore()
    await hydrateTabs()
    expect(activeDraft()).toMatchObject({
      id: target.tabId,
      conversationId: null,
      todoOrigins: [team, personal],
    })
  })

  it("rejects malformed restored origins and deduplicates valid entries", async () => {
    await hydrateTabs()
    useTabStore.getState().openNewConversationTab(1, folder.path)
    const key = "workspace:tab-groups:v1"
    const blob = JSON.parse(localStorage.getItem(key)!)
    blob.drafts[0].todoOrigins = [
      null,
      {},
      { scope_id: "", todo_id: "wrong" },
      { scope_id: "personal", todo_id: 42 },
      { scope_id: "personal", todo_id: "not-a-uuid" },
      { scope_id: "unknown-team", todo_id: todoId },
      { scope_id: "team:" + teamId, todo_id: todoId },
      { scope_id: "personal", todo_id: "g".repeat(32) },
      team,
      personal,
      team,
    ]
    localStorage.setItem(key, JSON.stringify(blob))
    resetTabStore()
    await hydrateTabs()
    expect(activeDraft().todoOrigins).toEqual([team, personal])
  })

  it("captures the raw originating team ID when the todo button is clicked", () => {
    mocks.todoState = {
      mode: "team",
      active_team_id: teamId,
    } as TodoState
    const view = render(<TodoConversationButton todo={todo} />)
    act(() => screen.getByRole("button").click())
    const target = activeDraft()
    expect(target.todoOrigins).toEqual([team])
    mocks.todoState = { mode: "personal", active_team_id: null } as TodoState
    view.rerender(<TodoConversationButton todo={todo} />)
    expect(activeDraft().todoOrigins).toEqual([team])
    act(() => screen.getByRole("button").click())
    expect(activeDraft().id).not.toBe(target.id)
    expect(activeDraft().todoOrigins).toEqual([personal])
    expect(
      useTabStore.getState().rawTabs.find((tab) => tab.id === target.id)
        ?.todoOrigins
    ).toEqual([team])
  })

  it("does not treat a message or its source share link as a todo origin", () => {
    const { result } = renderHook(() =>
      useNewChatFromMessage(() => todo.source_url!)
    )
    act(() => result.current())
    expect(activeDraft().todoOrigins).toBeUndefined()
  })

  it("normalizes UUID representations and drops invalid origins before a draft can send", () => {
    const target = useTabStore
      .getState()
      .openNewConversationTab(1, folder.path)!
    useTabStore.getState().addDraftTodoOrigins(target.tabId, [
      {
        scope_id: "79FBD974-2E86-4B1F-8B3C-FA88D38B2C5C",
        todo_id: "20DA5610-85A7-4C65-8A43-A162B1E2D69C",
      },
      team,
      { scope_id: "personal", todo_id: "invalid" },
      { scope_id: "invalid", todo_id: todoId },
    ])
    expect(activeDraft().todoOrigins).toEqual([team])
  })

  it("keeps an existing document and two rapid todo opens completely separate", () => {
    const existing = useTabStore
      .getState()
      .openNewConversationTab(1, folder.path)!
    saveMessageInputDraft(
      buildNewConversationDraftStorageKey(existing.tabId),
      "An unrelated unsent document"
    )
    const first = renderHook(() =>
      useNewChatFromTodo(
        () => "Task A body",
        () => [personal]
      )
    )
    const second = renderHook(() =>
      useNewChatFromTodo(
        () => "Task B body",
        () => [team]
      )
    )
    act(() => first.result.current())
    const taskA = activeDraft()
    act(() => second.result.current())
    const taskB = activeDraft()
    expect(new Set([existing.tabId, taskA.id, taskB.id]).size).toBe(3)
    expect(taskA.todoOrigins).toEqual([personal])
    expect(taskB.todoOrigins).toEqual([team])
    for (const [id, markdown] of [
      [existing.tabId, "An unrelated unsent document"],
      [taskA.id, "Task A body"],
      [taskB.id, "Task B body"],
    ]) {
      expect(
        loadMessageInputDraftV2(buildNewConversationDraftStorageKey(id))
      ).toEqual({ kind: "legacyMarkdown", markdown })
    }
  })

  it("restores several independent todo drafts and their documents after restart", async () => {
    await hydrateTabs()
    const first = renderHook(() =>
      useNewChatFromTodo(
        () => "Task A body",
        () => [personal]
      )
    )
    const second = renderHook(() =>
      useNewChatFromTodo(
        () => "Task B body",
        () => [team]
      )
    )
    act(() => first.result.current())
    const taskA = activeDraft()
    act(() => second.result.current())
    const taskB = activeDraft()
    resetTabStore()
    await hydrateTabs()
    const state = useTabStore.getState()
    expect(state.rawTabs.map((tab) => tab.id)).toEqual([taskA.id, taskB.id])
    expect(state.activeTabId).toBe(taskB.id)
    expect(state.rawTabs.map((tab) => tab.todoOrigins)).toEqual([
      [personal],
      [team],
    ])
    expect(
      loadMessageInputDraftV2(buildNewConversationDraftStorageKey(taskA.id))
    ).toEqual({ kind: "legacyMarkdown", markdown: "Task A body" })
    expect(
      loadMessageInputDraftV2(buildNewConversationDraftStorageKey(taskB.id))
    ).toEqual({ kind: "legacyMarkdown", markdown: "Task B body" })
  })

  it("retargets the selected independent draft instead of the first draft in its group", async () => {
    const first = useTabStore
      .getState()
      .openNewConversationTab(1, folder.path, { freshDraft: true })!
    const second = useTabStore
      .getState()
      .openNewConversationTab(1, folder.path, { freshDraft: true })!
    useTabStore.getState().addDraftTodoOrigins(first.tabId, [personal])
    useTabStore.getState().addDraftTodoOrigins(second.tabId, [team])
    const retargeted = useTabStore
      .getState()
      .openNewConversationTab(2, otherFolder.path, {
        inheritFromActive: true,
      })!
    expect(retargeted.tabId).toBe(second.tabId)
    await act(async () => useTabStore.getState().consumeDraftRetargets())
    useTabStore.getState().confirmDraftAgent(second.tabId, "grok")
    useTabStore.getState().openChatModeTab()
    expect(activeDraft()).toMatchObject({
      id: second.tabId,
      isChat: true,
      agentType: "grok",
      todoOrigins: [team],
    })
    expect(
      useTabStore.getState().rawTabs.find((tab) => tab.id === first.tabId)
    ).toMatchObject({
      folderId: 1,
      agentType: "codex",
      todoOrigins: [personal],
    })
  })

  it("retargets an explicit nonfocused split's draft without changing its neighbor", async () => {
    const first = useTabStore
      .getState()
      .openNewConversationTab(1, folder.path, { freshDraft: true })!
    useTabStore.getState().splitTab(first.tabId, "right", { move: false })
    const neighbor = activeDraft()
    expect(neighbor.id).not.toBe(first.tabId)
    const target = useTabStore
      .getState()
      .openNewConversationTab(2, otherFolder.path, {
        draftTabId: first.tabId,
        inheritFromActive: true,
      })!
    expect(target.tabId).toBe(first.tabId)
    await act(async () => useTabStore.getState().consumeDraftRetargets())
    useTabStore.getState().switchTab(neighbor.id)
    const chat = useTabStore
      .getState()
      .openChatModeTab({ draftTabId: first.tabId })!
    expect(chat.tabId).toBe(first.tabId)
    expect(activeDraft()).toMatchObject({ id: first.tabId, isChat: true })
    expect(
      useTabStore.getState().rawTabs.find((tab) => tab.id === neighbor.id)
    ).toMatchObject({ folderId: 1, agentType: "codex" })
  })

  it("archives a displaced todo draft in a bound split and recovers its original body and origin", () => {
    const starter = useTabStore
      .getState()
      .openNewConversationTab(1, folder.path)!
    useTabStore.getState().splitTab(starter.tabId, "right", { move: false })
    const root = leafIds(useTabStore.getState().groupLayout)[0]
    useTabStore.setState({ groupFolder: { [root]: 1 } })
    useTabStore.getState().switchTab(starter.tabId)
    const first = renderHook(() =>
      useNewChatFromTodo(
        () => "Task A body",
        () => [personal]
      )
    )
    const second = renderHook(() =>
      useNewChatFromTodo(
        () => "Task B body",
        () => [team]
      )
    )
    act(() => first.result.current())
    const taskA = activeDraft()
    act(() => second.result.current())
    const taskB = activeDraft()
    expect(taskB.id).not.toBe(taskA.id)
    expect(useTabStore.getState().rawTabs).not.toContain(taskA)
    expect(
      useTabStore
        .getState()
        .archivedPaneDrafts.find((entry) => entry.tab.id === taskA.id)
    ).toMatchObject({
      tab: { todoOrigins: [personal] },
      content: { kind: "legacyMarkdown", markdown: "Task A body" },
    })
    resetTabStore()
    expect(useTabStore.getState().restorePaneDraft(taskA.id)).toBe(true)
    expect(activeDraft()).toMatchObject({
      id: taskA.id,
      todoOrigins: [personal],
    })
    expect(
      loadMessageInputDraftV2(buildNewConversationDraftStorageKey(taskA.id))
    ).toEqual({ kind: "legacyMarkdown", markdown: "Task A body" })
  })

  it("archives each independent todo document when its pane closes", () => {
    const first = renderHook(() =>
      useNewChatFromTodo(
        () => "Task A body",
        () => [personal]
      )
    )
    const second = renderHook(() =>
      useNewChatFromTodo(
        () => "Task B body",
        () => [team]
      )
    )
    act(() => first.result.current())
    const taskA = activeDraft()
    act(() => second.result.current())
    const taskB = activeDraft()
    useTabStore.getState().closePane(taskB.id)
    const closed = useTabStore.getState()
    expect(closed.archivedPaneDrafts.map((entry) => entry.tab.id)).toEqual([
      taskA.id,
      taskB.id,
    ])
    expect(activeDraft().todoOrigins).toBeUndefined()
    expect(useTabStore.getState().restorePaneDraft(taskA.id)).toBe(true)
    expect(activeDraft()).toMatchObject({
      id: taskA.id,
      todoOrigins: [personal],
    })
    expect(
      loadMessageInputDraftV2(buildNewConversationDraftStorageKey(taskA.id))
    ).toEqual({ kind: "legacyMarkdown", markdown: "Task A body" })
    expect(useTabStore.getState().restorePaneDraft(taskB.id)).toBe(true)
    expect(activeDraft()).toMatchObject({ id: taskB.id, todoOrigins: [team] })
    expect(
      loadMessageInputDraftV2(buildNewConversationDraftStorageKey(taskB.id))
    ).toEqual({ kind: "legacyMarkdown", markdown: "Task B body" })
  })

  it("does not carry old provenance into a new draft or reassign an existing row", () => {
    const target = useTabStore
      .getState()
      .openNewConversationTab(1, folder.path)!
    useTabStore.getState().addDraftTodoOrigins(target.tabId, [personal])
    useTabStore
      .getState()
      .bindConversationTab(target.tabId, 70, "codex", "Release review")
    useTabStore.getState().addDraftTodoOrigins(target.tabId, [team])
    expect(activeDraft().todoOrigins).toEqual([personal])
    useTabStore.getState().openNewConversationTab(1, folder.path)
    expect(activeDraft().todoOrigins).toBeUndefined()
  })

  it("passes captured origins to the local API for folder and chat creation", async () => {
    await createConversation(1, "codex", "Release review", [team, personal])
    expect(mocks.call).toHaveBeenLastCalledWith("create_conversation", {
      folderId: 1,
      agentType: "codex",
      title: "Release review",
      todoOrigins: [team, personal],
    })
    await createChatConversation("codex", "Chat review", "/scratch", [team])
    expect(mocks.call).toHaveBeenLastCalledWith("create_chat_conversation", {
      agentType: "codex",
      title: "Chat review",
      existingDir: "/scratch",
      todoOrigins: [team],
    })
  })

  it("keeps ordinary conversation creation free of todo metadata", async () => {
    await createConversation(1, "codex", "Ordinary conversation")
    expect(mocks.call).toHaveBeenLastCalledWith("create_conversation", {
      folderId: 1,
      agentType: "codex",
      title: "Ordinary conversation",
    })
    await createChatConversation("codex", "Ordinary chat", "/scratch", [])
    expect(mocks.call).toHaveBeenLastCalledWith("create_chat_conversation", {
      agentType: "codex",
      title: "Ordinary chat",
      existingDir: "/scratch",
    })
  })
})
