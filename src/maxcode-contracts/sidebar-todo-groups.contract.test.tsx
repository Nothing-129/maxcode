import { useEffect, type ReactNode } from "react"
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SidebarConversationList } from "@/components/conversations/sidebar-conversation-list"
import {
  buildRows,
  buildOwnerHeaderIndex,
  flatIndexOfConversation,
} from "@/components/conversations/sidebar-conversation-grouping"
import { WorkbenchRouteProvider } from "@/contexts/workbench-route-context"
import { useTodoConversationGroups } from "@/hooks/use-todo-conversation-groups"
import {
  resetAppWorkspaceStore,
  useAppWorkspaceStore,
} from "@/stores/app-workspace-store"
import { resetTabStore, useTabStore } from "@/stores/tab-store"
import { resetConversationUnreadStore } from "@/stores/conversation-unread-store"
import type {
  TodoConversationGroup,
  TodoConversationGroupsState,
  TodoState,
} from "@/lib/todos"
import type { DbConversationSummary, FolderDetail } from "@/lib/types"
import enMessages from "@/i18n/messages/en.json"

const host = vi.hoisted(() => ({
  state: null as TodoState | null,
  enabled: true,
  groups: vi.fn<() => Promise<TodoConversationGroupsState>>(),
  origin: vi.fn(),
}))
vi.mock("@/contexts/todos-view-context", () => ({
  useOptionalTodosView: () => (host.enabled ? { state: host.state } : null),
}))
vi.mock("@/lib/todos", async (original) => ({
  ...(await original<typeof import("@/lib/todos")>()),
  todoConversationGroups: host.groups,
  todoOriginCall: host.origin,
}))
vi.mock("virtua", () => ({
  Virtualizer: ({
    data,
    children,
  }: {
    data: unknown[]
    children: (row: unknown, index: number) => ReactNode
  }) => <>{data.map((row, index) => children(row, index))}</>,
}))
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({
    children,
    onViewportRef,
  }: {
    children: ReactNode
    onViewportRef?: (element: HTMLElement | null) => void
  }) => {
    useEffect(() => {
      onViewportRef?.(document.createElement("div"))
      return () => onViewportRef?.(null)
    }, [onViewportRef])
    return <>{children}</>
  },
}))
vi.mock("@/hooks/use-appearance", () => ({
  useThemeColor: () => ({ themeColor: "blue" }),
  useZoomLevel: () => ({ zoomLevel: 100 }),
}))
vi.mock("@/contexts/terminal-context", () => ({
  useTerminalContext: () => ({ createTerminalInDirectory: vi.fn() }),
}))
vi.mock("@/hooks/use-sorted-available-agents", () => ({
  useSortedAvailableAgents: () => ({ sortedTypes: [], fresh: true }),
}))
vi.mock("@/hooks/use-subsession-sync", () => ({ useSubsessionSync: () => {} }))
vi.mock("@/components/layout/clone-dialog", () => ({ CloneDialog: () => null }))

function state(scope = "personal"): TodoState {
  return {
    mode: scope === "personal" ? "personal" : "team",
    active_team_id: scope === "personal" ? null : scope,
    teams: [],
    self_id: "me",
    members: [],
    todos: [],
    team_code: null,
    public_url: null,
    completed_pagination: { page: 7, page_size: 20, total: 200 },
  }
}

function group(
  id: string,
  ids: number[],
  overrides: Partial<TodoConversationGroup["todo"]> = {}
): TodoConversationGroup {
  return {
    todo: {
      id,
      title: id,
      status: "claimed",
      assignee_id: "someone",
      ...overrides,
    },
    conversation_ids: ids,
  }
}

function conversation(id: number, status = "pending"): DbConversationSummary {
  return {
    id,
    folder_id: 1,
    title: `Conversation ${id}`,
    title_locked: false,
    agent_type: "codex",
    status,
    kind: "regular",
    model: null,
    git_branch: null,
    external_id: null,
    message_count: 2,
    child_count: 0,
    created_at: "2026-10-14T00:00:00Z",
    updated_at: "2026-10-14T00:00:00Z",
    pinned_at: null,
  }
}

function sidebar(showCompleted = true) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <WorkbenchRouteProvider>
        <SidebarConversationList
          showTodos
          showRecent
          showCompleted={showCompleted}
          sectionOrder={["todos", "recent", "folders", "chats"]}
        />
      </WorkbenchRouteProvider>
    </NextIntlClientProvider>
  )
}

function deferred() {
  let resolve!: (value: TodoConversationGroupsState) => void
  const promise = new Promise<TodoConversationGroupsState>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  localStorage.clear()
  resetTabStore()
  resetAppWorkspaceStore()
  resetConversationUnreadStore()
  host.enabled = true
  host.state = state()
  host.origin.mockReset()
  host.groups.mockReset()
  host.groups.mockResolvedValue({ scope_key: "personal", groups: [] })
  const folder: FolderDetail = {
    id: 1,
    name: "Repo",
    path: "/projects/repo",
    git_branch: null,
    default_agent_type: null,
    last_opened_at: "2026-10-14T00:00:00Z",
    sort_order: 1,
    color: "blue",
    parent_id: null,
    kind: "regular",
    alias: null,
    group_id: null,
  }
  useAppWorkspaceStore.setState({
    folders: [folder],
    allFolders: [folder],
    conversations: [conversation(1), conversation(2), conversation(3)],
    conversationsLoading: false,
    conversationsError: null,
  })
})
afterEach(() => {
  cleanup()
  resetTabStore()
  resetAppWorkspaceStore()
  resetConversationUnreadStore()
  localStorage.clear()
})

describe("sidebar conversations grouped by their originating assigned todos", () => {
  it("starts an unsent linked conversation from the group header using its latest folder", async () => {
    const id = "20da561085a74c658a43a162b1e2d69c"
    const current = useAppWorkspaceStore.getState()
    const other = {
      ...current.allFolders[0],
      id: 2,
      path: "/projects/other",
      name: "Other",
    }
    useAppWorkspaceStore.setState({
      allFolders: [...current.allFolders, other],
      folders: [...current.folders, other],
      conversations: [
        conversation(1),
        {
          ...conversation(2),
          folder_id: 2,
          updated_at: "2026-10-15T12:00:00Z",
        },
      ],
    })
    host.state!.todos = [
      {
        id,
        title: "Todo",
        content: "Review package",
        status: "claimed",
        assignee_id: "me",
        creator_id: "me",
        revision: 1,
        source_url: null,
        created_at: "2026-10-15T00:00:00Z",
        updated_at: "2026-10-15T00:00:00Z",
      },
    ]
    host.groups.mockResolvedValue({
      scope_key: "personal",
      groups: [group(id, [1, 2], { title: "Release review" })],
    })
    const navigate = vi.fn()
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <WorkbenchRouteProvider>
          <SidebarConversationList showTodos onNavigate={navigate} />
        </WorkbenchRouteProvider>
      </NextIntlClientProvider>
    )
    const button = await screen.findByRole("button", {
      name: "New conversation from Release review",
    })
    const toggle = document.querySelector(
      `[data-todo-group-id="${id}"] button`
    )!
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    fireEvent.click(button)
    const store = useTabStore.getState()
    const draft = store.rawTabs.find((tab) => tab.id === store.activeTabId)!
    expect(draft).toMatchObject({
      folderId: 2,
      workingDir: other.path,
      conversationId: null,
      todoOrigins: [{ scope_id: "personal", todo_id: id }],
    })
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it("requires folder confirmation without a valid sibling folder and creates nothing on cancel", async () => {
    const id = "20da561085a74c658a43a162b1e2d69c"
    const current = useAppWorkspaceStore.getState()
    useAppWorkspaceStore.setState({
      conversations: [{ ...conversation(1), folder_id: 999 }],
    })
    host.groups.mockResolvedValue({
      scope_key: "personal",
      groups: [group(id, [1], { title: "Choose a folder" })],
    })
    host.origin.mockResolvedValue({
      todo: { id, content: "Task body", source_url: null },
    })
    render(sidebar())
    const button = await screen.findByRole("button", {
      name: "New conversation from Choose a folder",
    })
    fireEvent.click(button)
    await screen.findByRole("dialog", {
      name: enMessages.Todos.chooseConversationFolder,
    })
    expect(useTabStore.getState().rawTabs).toHaveLength(0)
    expect(
      screen.getByRole("button", {
        name: enMessages.Todos.confirmConversationFolder,
      })
    ).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(useTabStore.getState().rawTabs).toHaveLength(0)
    fireEvent.click(button)
    await screen.findByRole("dialog", {
      name: enMessages.Todos.chooseConversationFolder,
    })
    fireEvent.change(
      screen.getByRole("combobox", {
        name: enMessages.Todos.chooseConversationFolder,
      }),
      { target: { value: String(current.allFolders[0].id) } }
    )
    fireEvent.click(
      screen.getByRole("button", {
        name: enMessages.Todos.confirmConversationFolder,
      })
    )
    const store = useTabStore.getState()
    expect(
      store.rawTabs.find((tab) => tab.id === store.activeTabId)
    ).toMatchObject({
      folderId: 1,
      conversationId: null,
      todoOrigins: [{ scope_id: "personal", todo_id: id }],
    })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("loads a completed todo beyond the board page before opening its linked draft", async () => {
    const id = "20da561085a74c658a43a162b1e2d69c"
    host.groups.mockResolvedValue({
      scope_key: "personal",
      groups: [
        group(id, [1], { title: "Old completed task", status: "completed" }),
      ],
    })
    host.origin.mockResolvedValue({
      todo: {
        id,
        content: "Complete the final review",
        source_url: "https://example.test/share#source",
      },
    })
    render(sidebar())
    fireEvent.click(
      await screen.findByRole("button", {
        name: "New conversation from Old completed task",
      })
    )
    await waitFor(() => {
      const store = useTabStore.getState()
      expect(
        store.rawTabs.find((tab) => tab.id === store.activeTabId)?.todoOrigins
      ).toEqual([{ scope_id: "personal", todo_id: id }])
    })
    expect(host.origin).toHaveBeenCalledWith({
      origin: { scope_id: "personal", todo_id: id },
      action: "get",
    })
  })

  it("keeps canonical folder navigation and sticky ownership when a todo copy comes first", () => {
    const parent = { ...conversation(1), child_count: 1 }
    const child = { ...conversation(5), parent_id: 1 }
    const rows = buildRows({
      pinned: [],
      pinnedExpanded: true,
      orderedFolderIds: [1],
      byFolder: new Map([[1, [parent]]]),
      folderExpanded: {},
      folderTotalCounts: new Map([[1, 1]]),
      foldersExpanded: true,
      chatConversations: [],
      chatsExpanded: true,
      showTodos: true,
      todoGroups: [{ id: "task", title: "Task", conversations: [parent] }],
      sectionOrder: ["todos", "folders", "chats", "recent"],
      conversationExpanded: new Set([1]),
      childrenByParent: new Map([[1, [child]]]),
    })
    const canonical = flatIndexOfConversation(rows, 1, "codex")
    expect(rows[canonical]).toMatchObject({
      kind: "conversation",
      conversation: { id: 1 },
    })
    expect(rows[canonical]).not.toHaveProperty("todoId")
    const taskCopies = rows.flatMap((row, index) =>
      row.kind === "conversation" && row.todoId ? [{ row, index }] : []
    )
    expect(taskCopies.map(({ row }) => row.conversation.id)).toEqual([1, 5])
    expect(taskCopies.every(({ row }) => row.todoId === "task")).toBe(true)
    const owners = buildOwnerHeaderIndex(rows)
    expect(taskCopies.map(({ index }) => owners[index])).toEqual([-1, -1])
    expect(owners[canonical]).toBeGreaterThan(-1)
  })

  it("includes assigned completed todos independently of the board page", async () => {
    host.groups.mockResolvedValue({
      scope_key: "personal",
      groups: [
        group("Assigned", [1]),
        group("Completed elsewhere", [2], { status: "completed" }),
        group("Unassigned", [3], { assignee_id: null }),
        group("Unclaimed", [3], { status: "unclaimed" }),
        group("Missing conversation", [900]),
      ],
    })
    render(sidebar())
    expect(await screen.findByText("Assigned")).toBeTruthy()
    expect(screen.getByText("Completed elsewhere")).toBeTruthy()
    expect(screen.queryByText("Unassigned")).toBeNull()
    expect(screen.queryByText("Unclaimed")).toBeNull()
    expect(screen.queryByText("Missing conversation")).toBeNull()
    // The unrelated source conversation remains in the ordinary sections only.
    expect(document.querySelectorAll('[data-conversation-id="3"]').length).toBe(
      2
    )
    expect(document.querySelectorAll('[data-conversation-id="1"]').length).toBe(
      3
    )
  })

  it("supports the same conversation in multiple todo groups and independent collapse", async () => {
    host.groups.mockResolvedValue({
      scope_key: "personal",
      groups: [group("First task", [1, 1]), group("Second task", [1])],
    })
    render(sidebar())
    await screen.findByText("First task")
    expect(document.querySelectorAll('[data-conversation-id="1"]').length).toBe(
      4
    )
    fireEvent.click(
      document.querySelector('[data-todo-group-id="First task"] button')!
    )
    expect(document.querySelectorAll('[data-conversation-id="1"]').length).toBe(
      3
    )
    expect(screen.getByText("Second task")).toBeTruthy()
    expect(
      JSON.parse(localStorage.getItem("workspace:sidebar-todo-group-expanded")!)
    ).toEqual({ "First task": false })
    fireEvent.click(
      screen.getByRole("button", {
        name: enMessages.Folder.sidebar.sectionTodos,
      })
    )
    expect(document.querySelectorAll('[data-conversation-id="1"]').length).toBe(
      2
    )
  })

  it("uses live conversation summaries without extra lookups on title/status updates", async () => {
    host.groups.mockResolvedValue({
      scope_key: "personal",
      groups: [group("Assigned", [1])],
    })
    const view = render(sidebar())
    await screen.findByText("Assigned")
    const requests = host.groups.mock.calls.length
    act(() => {
      useAppWorkspaceStore.setState({
        conversations: [
          conversation(1, "completed"),
          conversation(2),
          conversation(3),
        ],
      })
    })
    expect(host.groups.mock.calls.length).toBe(requests)
    view.rerender(sidebar(false))
    expect(screen.queryByText("Assigned")).toBeNull()
    act(() => {
      useAppWorkspaceStore.setState({
        conversations: [
          { ...conversation(1), title: "Renamed conversation" },
          conversation(2),
          conversation(3),
        ],
      })
    })
    expect(screen.getByText("Assigned")).toBeTruthy()
    expect(screen.getAllByText("Renamed conversation")).toHaveLength(3)
    expect(host.groups.mock.calls.length).toBe(requests)
  })

  it("refreshes assignment metadata and removes groups when their local conversations are deleted", async () => {
    host.groups.mockResolvedValue({
      scope_key: "personal",
      groups: [group("Assigned", [1])],
    })
    const view = render(sidebar())
    await screen.findByText("Assigned")
    act(() =>
      useAppWorkspaceStore.setState({
        conversations: [conversation(2), conversation(3)],
      })
    )
    expect(screen.queryByText("Assigned")).toBeNull()
    await waitFor(() => expect(host.groups).toHaveBeenCalledTimes(2))
    host.groups.mockResolvedValue({
      scope_key: "personal",
      groups: [
        group("Released", [2], { assignee_id: null, status: "unclaimed" }),
      ],
    })
    host.state = { ...host.state! }
    view.rerender(sidebar())
    await waitFor(() => expect(host.groups).toHaveBeenCalledTimes(3))
    expect(screen.queryByText("Released")).toBeNull()
  })
})

describe("todo sidebar query scope and concurrency", () => {
  it("does not query outside the todo provider", () => {
    host.enabled = false
    const { result } = renderHook(() => useTodoConversationGroups())
    expect(result.current).toEqual([])
    expect(host.groups).not.toHaveBeenCalled()
  })

  it("accepts slow reads and queues one refresh rather than invalidating their result", async () => {
    const first = deferred()
    const second = deferred()
    host.groups
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const view = renderHook(() => useTodoConversationGroups())
    host.state = { ...host.state! }
    view.rerender()
    expect(host.groups).toHaveBeenCalledTimes(1)
    await act(async () =>
      first.resolve({
        scope_key: "personal",
        groups: [group("Slow result", [1])],
      })
    )
    expect(view.result.current[0].todo.title).toBe("Slow result")
    expect(host.groups).toHaveBeenCalledTimes(2)
    await act(async () => second.resolve({ scope_key: "personal", groups: [] }))
    expect(view.result.current).toEqual([])
  })

  it("discards stale scope responses and never borrows another team's cache", async () => {
    const old = deferred()
    const current = deferred()
    host.groups
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise)
    const view = renderHook(() => useTodoConversationGroups())
    host.state = state("new-team")
    view.rerender()
    await act(async () =>
      old.resolve({
        scope_key: "personal",
        groups: [group("Private task", [1])],
      })
    )
    expect(view.result.current).toEqual([])
    await act(async () =>
      current.resolve({
        scope_key: "team:new-team",
        groups: [group("Team task", [2])],
      })
    )
    expect(view.result.current[0].todo.title).toBe("Team task")
    host.groups.mockResolvedValue({
      scope_key: "team:new-team",
      groups: [],
      connection_error: "offline",
    })
    host.state = { ...host.state! }
    view.rerender()
    await waitFor(() => expect(host.groups).toHaveBeenCalledTimes(3))
    expect(view.result.current[0].todo.title).toBe("Team task")
    host.state = state("another-team")
    view.rerender()
    expect(view.result.current).toEqual([])
  })
})
