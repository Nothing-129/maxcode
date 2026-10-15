import type { ComponentProps, ReactNode } from "react"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ConversationDetailHeader } from "@/components/conversations/conversation-detail-header"
import { SidebarConversationCard } from "@/components/conversations/sidebar-conversation-card"
import { TodoConversationLinkDialog } from "@/components/todos/todo-conversation-link-dialog"
import { ConversationTodoSourceBadges } from "@/components/todos/conversation-todo-source-badges"
import type {
  TodoConversationSource,
  TodoOrigin,
  TodoSearchRequest,
  TodoSearchResult,
  TodoState,
} from "@/lib/todos"
import type { DbConversationSummary } from "@/lib/types"
import enMessages from "@/i18n/messages/en.json"

const h = vi.hoisted(() => ({
  state: null as TodoState | null,
  enabled: true,
  sources: [] as TodoConversationSource[],
  rawTabs: [] as { id: string; todoOrigins?: TodoOrigin[] }[],
  sourcesRead: vi.fn(),
  search: vi.fn(),
  link: vi.fn(),
  openTodo: vi.fn(),
  route: vi.fn(),
}))
vi.mock("@/contexts/todos-view-context", () => ({
  useOptionalTodosView: () => (h.enabled ? { state: h.state } : null),
}))
vi.mock("@/contexts/workbench-route-context", () => ({
  useOptionalWorkbenchRoute: () => ({ setRoute: h.route }),
}))
vi.mock("@/lib/todo-compose-events", () => ({
  requestOpenTodo: h.openTodo,
  requestCreateTodo: vi.fn(),
}))
vi.mock("@/lib/todos", async (original) => ({
  ...(await original<typeof import("@/lib/todos")>()),
  todoConversationSources: h.sourcesRead,
  todoSearch: h.search,
  todoConversationLink: h.link,
}))
vi.mock("@/lib/platform", async (original) => ({
  ...(await original<typeof import("@/lib/platform")>()),
  subscribe: vi.fn(async () => () => {}),
}))
vi.mock("@/components/layout/mobile-header-slot", () => ({
  MobileHeaderSlot: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock("@/hooks/use-conversation-drag", () => ({
  useConversationDrag: () => vi.fn(),
}))
vi.mock("@/hooks/use-collapse-sidebar-on-navigate", () => ({
  useCollapseSidebarOnNavigate: () => vi.fn(),
}))
vi.mock("@/contexts/tab-context", () => ({
  useTabStore: Object.assign(
    (selector: (state: unknown) => unknown) =>
      selector({
        rawTabs: h.rawTabs,
        archivedPaneDrafts: [],
        tabs: [],
        activeTabId: null,
      }),
    { getState: () => ({ tabs: [], activeTabId: null }) }
  ),
  useTabActions: () => ({
    closeTab: vi.fn(),
    closePane: vi.fn(),
    restorePaneDraft: vi.fn(),
    openNewConversationTab: vi.fn(),
  }),
}))

const origin = { scope_id: "team-a", todo_id: "old-completed" }
function source(): TodoConversationSource {
  return {
    origin,
    scope_key: "team:team-a",
    scope_name: "Team A",
    mode: "team",
    todo: {
      id: origin.todo_id,
      title: "Completed task outside current page",
      status: "completed",
      assignee_id: "someone",
    },
    assignee: null,
  }
}
function state(team = "team-a"): TodoState {
  return {
    mode: "team",
    active_team_id: team,
    teams: [
      {
        id: team,
        name: team === "team-a" ? "Team A" : "Team B",
        url: null,
        is_local: false,
      },
    ],
    self_id: "me",
    members: [],
    todos: [],
    team_code: null,
    public_url: null,
  }
}
function searchResult(request: TodoSearchRequest): TodoSearchResult {
  return {
    scope_id: request.scope_id,
    scope_key: `team:${request.scope_id}`,
    todos: [source().todo!],
    members: [],
    self_id: "me",
    pagination: {
      page: request.page ?? 1,
      page_size: 20,
      total: 21,
      search: request.search ?? "",
    },
  }
}
function intl(children: ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {children}
    </NextIntlClientProvider>
  )
}
const header: ComponentProps<typeof ConversationDetailHeader> = {
  tabId: "tab-a",
  conversationId: 1,
  runtimeConversationId: null,
  folderId: 1,
  folderPath: "/project",
  title: "Conversation A",
  status: "in_progress",
}

beforeEach(() => {
  h.state = state()
  h.enabled = true
  h.sources = []
  h.rawTabs = []
  h.openTodo.mockReset()
  h.route.mockReset()
  h.link.mockReset()
  h.sourcesRead
    .mockReset()
    .mockImplementation(async (conversationId: number) => ({
      conversation_id: conversationId,
      sources: h.sources,
    }))
  h.search
    .mockReset()
    .mockImplementation(async (request: TodoSearchRequest) =>
      searchResult(request)
    )
  h.link.mockImplementation(async ({ action }: { action: string }) => {
    h.sources = action === "link" ? [source()] : []
    return {}
  })
})
afterEach(() => cleanup())

describe("existing conversation links remain local and target the captured todo scope", () => {
  it("keeps the conversation and team captured by More after switching tabs/team", async () => {
    const user = userEvent.setup()
    const view = render(intl(<ConversationDetailHeader {...header} />))
    await user.click(
      screen.getByRole("button", {
        name: enMessages.Folder.conversation.moreActions,
      })
    )
    await user.click(
      screen.getByRole("menuitem", { name: enMessages.Todos.linkConversation })
    )
    await screen.findByText("Completed task outside current page")
    h.state = state("team-b")
    view.rerender(
      intl(
        <ConversationDetailHeader
          {...header}
          tabId="tab-b"
          conversationId={2}
          title="Conversation B"
        />
      )
    )
    await user.click(
      screen.getByRole("button", { name: enMessages.Todos.linkTodo })
    )
    expect(h.link).toHaveBeenCalledWith({
      conversation_id: 1,
      origin,
      action: "link",
    })
    await screen.findByRole("button", { name: enMessages.Todos.unlinkTodo })
    await user.click(
      screen.getByRole("button", { name: enMessages.Todos.unlinkTodo })
    )
    expect(h.link).toHaveBeenLastCalledWith({
      conversation_id: 1,
      origin,
      action: "unlink",
    })
    expect(
      h.search.mock.calls.every(([request]) => request.scope_id === "team-a")
    ).toBe(true)
  })

  it("searches and pages all task states independently of board pagination", async () => {
    render(
      intl(
        <TodoConversationLinkDialog
          target={{
            conversationId: 8,
            title: "Stored conversation",
            scopeId: "team-a",
            scopeName: "Team A",
          }}
          onClose={vi.fn()}
        />
      )
    )
    await screen.findByText("Completed task outside current page")
    fireEvent.click(
      screen.getByRole("button", { name: enMessages.Todos.nextPage })
    )
    await waitFor(() =>
      expect(h.search).toHaveBeenCalledWith({
        scope_id: "team-a",
        page: 2,
        page_size: 20,
        search: "",
      })
    )
    fireEvent.change(
      screen.getByRole("textbox", { name: enMessages.Todos.searchTodos }),
      { target: { value: "completed" } }
    )
    await waitFor(() =>
      expect(h.search).toHaveBeenCalledWith({
        scope_id: "team-a",
        page: 1,
        page_size: 20,
        search: "completed",
      })
    )
  })

  it("keeps successful writes when the dialog's initial sources read finishes late", async () => {
    let finishInitialRead!: (value: unknown) => void
    h.sourcesRead.mockReturnValueOnce(
      new Promise((resolve) => {
        finishInitialRead = resolve
      })
    )
    render(
      intl(
        <TodoConversationLinkDialog
          target={{
            conversationId: 8,
            title: "Conversation",
            scopeId: "team-a",
            scopeName: "Team A",
          }}
          onClose={vi.fn()}
        />
      )
    )
    await screen.findByText("Completed task outside current page")
    fireEvent.click(
      screen.getByRole("button", { name: enMessages.Todos.linkTodo })
    )
    await screen.findByRole("button", { name: enMessages.Todos.unlinkTodo })
    await act(async () =>
      finishInitialRead({ conversation_id: 8, sources: [] })
    )
    expect(
      screen.getByRole("button", { name: enMessages.Todos.unlinkTodo })
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: enMessages.Todos.alreadyLinked })
    ).toBeDisabled()
  })

  it("retries a failed search with the same target, scope, and search text", async () => {
    render(
      intl(
        <TodoConversationLinkDialog
          target={{
            conversationId: 8,
            title: "Conversation",
            scopeId: "team-a",
            scopeName: "Team A",
          }}
          onClose={vi.fn()}
        />
      )
    )
    await screen.findByText("Completed task outside current page")
    h.search.mockRejectedValueOnce(new Error("host unavailable"))
    fireEvent.change(
      screen.getByRole("textbox", { name: enMessages.Todos.searchTodos }),
      { target: { value: "match" } }
    )
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "host unavailable"
    )
    fireEvent.click(
      screen.getByRole("button", { name: enMessages.Todos.retry })
    )
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
    expect(h.search).toHaveBeenLastCalledWith({
      scope_id: "team-a",
      search: "match",
      page: 1,
      page_size: 20,
    })
    expect(
      screen.getByRole("textbox", { name: enMessages.Todos.searchTodos })
    ).toHaveValue("match")
  })

  it("opens the link action from sidebar More and right-click, including completed conversations", async () => {
    const user = userEvent.setup()
    const callback = vi.fn()
    const conversation: DbConversationSummary = {
      id: 9,
      folder_id: 1,
      title: "Completed conversation",
      title_locked: false,
      agent_type: "codex",
      status: "completed",
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
    render(
      intl(
        <SidebarConversationCard
          conversation={conversation}
          isSelected={false}
          onSelect={vi.fn()}
          onRename={vi.fn()}
          onDelete={vi.fn()}
          onStatusChange={vi.fn()}
          onLinkTodo={callback}
        />
      )
    )
    await user.click(
      screen.getByRole("button", {
        name: enMessages.Folder.conversationCard.moreActions,
      })
    )
    await user.click(
      screen.getByRole("menuitem", { name: enMessages.Todos.linkConversation })
    )
    expect(callback).toHaveBeenCalledWith(9, "Completed conversation")
    fireEvent.contextMenu(document.querySelector('[data-conversation-id="9"]')!)
    await user.click(
      screen.getByRole("menuitem", { name: enMessages.Todos.linkConversation })
    )
    expect(callback).toHaveBeenCalledTimes(2)
  })
})

describe("conversation source badges identify exact persisted or draft origins", () => {
  it("opens an inactive team's completed source directly", async () => {
    h.state = state("team-b")
    h.sources = [source()]
    render(
      intl(
        <ConversationTodoSourceBadges conversationId={1} draftOrigins={[]} />
      )
    )
    const badge = await screen.findByRole("button", {
      name: "Source todo: Completed task outside current page",
    })
    fireEvent.click(badge)
    expect(h.openTodo).toHaveBeenCalledWith(origin)
    expect(h.route).toHaveBeenCalledWith("tasks")
  })

  it("does not display the previous conversation's late source response after tab switch", async () => {
    let resolve!: (value: unknown) => void
    h.sourcesRead
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done
        })
      )
      .mockResolvedValue({ conversation_id: 2, sources: [] })
    const view = render(
      intl(
        <ConversationTodoSourceBadges conversationId={1} draftOrigins={[]} />
      )
    )
    view.rerender(
      intl(
        <ConversationTodoSourceBadges conversationId={2} draftOrigins={[]} />
      )
    )
    await act(async () => resolve({ conversation_id: 1, sources: [source()] }))
    expect(
      screen.queryByRole("button", {
        name: /Completed task outside current page/,
      })
    ).toBeNull()
  })

  it("offers exact draft sources without uploading or querying an unsaved conversation", () => {
    render(
      intl(
        <ConversationTodoSourceBadges
          conversationId={null}
          draftOrigins={[{ scope_id: "personal", todo_id: "draft-origin" }]}
        />
      )
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Source todo: Personal" })
    )
    expect(h.openTodo).toHaveBeenCalledWith({
      scope_id: "personal",
      todo_id: "draft-origin",
    })
    expect(h.sourcesRead).not.toHaveBeenCalled()
    expect(h.link).not.toHaveBeenCalled()
  })

  it("shows loaded draft source metadata only when its todo scope matches", () => {
    h.state = {
      ...state(),
      todos: [
        {
          ...source().todo!,
          content: "Task content",
          creator_id: "me",
          revision: 1,
          source_url: null,
          created_at: "2026-10-14T00:00:00Z",
          updated_at: "2026-10-14T00:00:00Z",
        },
      ],
      members: [{ id: "someone", name: "Alice", avatar: "" }],
    }
    const view = render(
      intl(
        <ConversationTodoSourceBadges
          conversationId={null}
          draftOrigins={[origin]}
        />
      )
    )
    expect(
      screen.getByRole("button", {
        name: "Source todo: Completed task outside current page",
      })
    ).toHaveAttribute("title", expect.stringContaining("Alice"))
    h.state = { ...h.state, active_team_id: "team-b" }
    view.rerender(
      intl(
        <ConversationTodoSourceBadges
          conversationId={null}
          draftOrigins={[origin]}
        />
      )
    )
    expect(
      screen.queryByRole("button", {
        name: "Source todo: Completed task outside current page",
      })
    ).toBeNull()
    expect(
      screen.getByRole("button", { name: "Source todo: Team A" })
    ).toBeTruthy()
    expect(h.sourcesRead).not.toHaveBeenCalled()
  })

  it("refreshes a source badge after a manual unlink on the same client", async () => {
    h.sources = [source()]
    render(
      intl(
        <>
          <ConversationTodoSourceBadges conversationId={8} draftOrigins={[]} />
          <TodoConversationLinkDialog
            target={{
              conversationId: 8,
              title: "Conversation",
              scopeId: "team-a",
              scopeName: "Team A",
            }}
            onClose={vi.fn()}
          />
        </>
      )
    )
    await screen.findByRole("button", {
      name: "Source todo: Completed task outside current page",
      hidden: true,
    })
    fireEvent.click(
      await screen.findByRole("button", { name: enMessages.Todos.unlinkTodo })
    )
    await waitFor(() =>
      expect(
        screen.queryByRole("button", {
          name: /Source todo: Completed/,
          hidden: true,
        })
      ).toBeNull()
    )
  })
})
