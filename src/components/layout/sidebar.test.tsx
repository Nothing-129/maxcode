import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Ref } from "react"

import { Sidebar } from "./sidebar"
import { resetConversationUnreadStore } from "@/stores/conversation-unread-store"
// Type-only (erased at runtime, so it does not defeat the mock below): pins the
// stub's imperative handle to the real component's contract.
import type { SidebarConversationListHandle } from "@/components/conversations/sidebar-conversation-list"
import enMessages from "@/i18n/messages/en.json"

// The conversation-status switches now persist through the backend
// UiPreferences store — capture the write instead of reading localStorage.
const uiPrefsSpies = vi.hoisted(() => ({
  updateUiPreferences: vi.fn((prefs: unknown) => Promise.resolve(prefs)),
}))

// Stable spies + mutable active-folder, referenced from the hoisted mock
// factories below (vi.mock is hoisted above imports).
const spies = vi.hoisted(() => ({
  openNewConversationTab: vi.fn(),
  openChatModeTab: vi.fn(),
  setRoute: vi.fn(),
  openConversations: vi.fn(),
  toggleSidebar: vi.fn(),
  // The list's imperative handle, driven by the header buttons.
  scrollToActive: vi.fn(),
  expandAll: vi.fn(),
  collapseAll: vi.fn(),
  // Latest props the (stubbed) conversation list was rendered with, so tests can
  // assert what the sidebar threads down (e.g. showWorktrees / showCompleted).
  listProps: null as {
    showWorktrees?: boolean
    showCompleted?: boolean
    showRecent?: boolean
    sectionOrder?: readonly string[]
    onNavigate?: () => void
  } | null,
}))
const mockState = vi.hoisted(() => ({
  activeFolder: { id: 7, path: "/x" } as { id: number; path: string } | null,
  isMobile: false,
}))

// The conversation list is irrelevant here, but the stub still fulfils the imperative
// handle (React 19 hands `ref` to a function component as a plain prop, which is
// how the real component takes it) and exposes the local navigation callback.
vi.mock("@/components/conversations/sidebar-conversation-list", async () => {
  const { useImperativeHandle } = await import("react")
  return {
    SidebarConversationList: ({
      ref,
      ...props
    }: {
      ref?: Ref<SidebarConversationListHandle>
      showWorktrees?: boolean
      showCompleted?: boolean
      showRecent?: boolean
      sectionOrder?: readonly string[]
      onNavigate?: () => void
    }) => {
      spies.listProps = props
      useImperativeHandle(ref, () => ({
        scrollToActive: spies.scrollToActive,
        expandAll: spies.expandAll,
        collapseAll: spies.collapseAll,
      }))
      return (
        <button onClick={props.onNavigate}>Open folder conversation</button>
      )
    },
  }
})
vi.mock("@/contexts/sidebar-context", () => ({
  useSidebarContext: () => ({ isOpen: true, toggle: spies.toggleSidebar }),
}))
vi.mock("@/contexts/active-folder-context", () => ({
  useActiveFolder: () => ({ activeFolder: mockState.activeFolder }),
}))
vi.mock("@/contexts/tab-context", () => ({
  useTabActions: () => ({
    openNewConversationTab: spies.openNewConversationTab,
    openChatModeTab: spies.openChatModeTab,
  }),
}))
vi.mock("@/contexts/automations-view-context", () => ({
  useAutomationsView: () => ({
    automations: [],
    unseenFailures: 0,
    refetch: async () => {},
  }),
}))
vi.mock("@/contexts/tasks-view-context", () => ({
  useTasksView: () => ({
    tasks: [],
    attentionCount: 0,
    refetch: async () => {},
  }),
}))
vi.mock("@/contexts/workbench-route-context", () => ({
  useWorkbenchRoute: () => ({
    routeId: "conversations",
    isConversations: true,
    setRoute: spies.setRoute,
    openConversations: spies.openConversations,
  }),
}))
vi.mock("@/hooks/use-is-mac", () => ({ useIsMac: () => false }))
vi.mock("@/hooks/use-shortcut-settings", () => ({
  useShortcutSettings: () => ({
    shortcuts: { toggle_search: "mod+k", new_conversation: "mod+t" },
  }),
}))
vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mockState.isMobile,
}))
vi.mock("@/hooks/use-appearance", () => ({
  useZoomLevel: () => ({ zoomLevel: 100, setZoomLevel: () => {} }),
}))
vi.mock("@/lib/api", () => ({
  getUiPreferences: vi.fn(async () => null),
  updateUiPreferences: uiPrefsSpies.updateUiPreferences,
}))
vi.mock("@/contexts/search-dialog-context", () => ({
  useSearchDialog: () => ({ setOpen: vi.fn() }),
}))
vi.mock("@/lib/platform", () => ({
  isDesktop: () => false,
  isNativeDesktop: () => false,
  subscribe: vi.fn(async () => () => {}),
  onTransportReconnect: vi.fn(() => null),
}))

function renderSidebar() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <Sidebar />
    </NextIntlClientProvider>
  )
}

describe("Sidebar — fixed nav region", () => {
  beforeEach(() => {
    resetConversationUnreadStore()
    spies.openNewConversationTab.mockClear()
    spies.openChatModeTab.mockClear()
    spies.setRoute.mockClear()
    spies.openConversations.mockClear()
    spies.toggleSidebar.mockClear()
    mockState.activeFolder = { id: 7, path: "/x" }
    mockState.isMobile = false
  })

  it("renders the desktop product heading above New chat", () => {
    const { getByText, getByRole } = renderSidebar()
    expect(getByRole("img", { name: "MaxCode" })).toBeTruthy()
    // Navigation remains below the product heading.
    expect(getByText("New chat")).toBeTruthy()
  })

  it("omits Tasks and Repository dashboard from sidebar navigation", () => {
    const { queryByRole } = renderSidebar()
    expect(
      queryByRole("button", { name: enMessages.Folder.sidebar.tasks })
    ).toBeNull()
    expect(
      queryByRole("button", { name: enMessages.Folder.sidebar.forge })
    ).toBeNull()
  })

  it("Automations navigates to the automations route", () => {
    const { getByText } = renderSidebar()
    fireEvent.click(getByText("Automations"))
    expect(spies.setRoute).toHaveBeenCalledWith("automations")
  })

  it("New chat returns to the conversation workspace", () => {
    const { getByText } = renderSidebar()
    fireEvent.click(getByText("New chat"))
    expect(spies.openConversations).toHaveBeenCalled()
  })

  it("New chat opens a conversation tab in the active folder", () => {
    const { getByText } = renderSidebar()
    fireEvent.click(getByText("New chat"))
    expect(spies.openNewConversationTab).toHaveBeenCalledWith(7, "/x")
  })

  it("renders the New chat shortcut hint", () => {
    const { getByText } = renderSidebar()
    // isMac=false → "mod" formats as "Ctrl". The badge is opacity-0 until the
    // row is hovered/focused but stays in the DOM, so getByText resolves it.
    expect(getByText("Ctrl+T")).toBeTruthy()
  })

  it("no longer carries a Search row — it moved to the window chrome", () => {
    const { queryByText } = renderSidebar()
    // The sidebar unmounts when collapsed, which left ⌘K as the only path to
    // search; the button now lives in LeftEdgeChrome / FolderTitleBar instead.
    expect(queryByText("Search")).toBeNull()
    expect(queryByText("Ctrl+K")).toBeNull()
  })

  it("falls back to chat mode (never disabled) when no folder is active", () => {
    mockState.activeFolder = null
    const { getByText } = renderSidebar()
    const btn = getByText("New chat").closest("button") as HTMLButtonElement
    // Defense-in-depth: the button stays clickable so a workspace that recovered
    // to no active folder is never a dead end — it opens folderless chat mode.
    expect(btn.disabled).toBe(false)
    fireEvent.click(btn)
    expect(spies.openChatModeTab).toHaveBeenCalled()
    expect(spies.openNewConversationTab).not.toHaveBeenCalled()
  })

  it("closes the mobile sidebar when the conversation list navigates", () => {
    mockState.isMobile = true
    renderSidebar()

    fireEvent.click(screen.getByText("Open folder conversation"))

    expect(spies.toggleSidebar).toHaveBeenCalledOnce()
  })
})

describe("Sidebar — Show worktree branches toggle", () => {
  beforeEach(() => {
    localStorage.clear()
    spies.listProps = null
    mockState.activeFolder = { id: 7, path: "/x" }
  })

  it("defaults Show worktree branches on and threads it to the conversation list", () => {
    renderSidebar()
    expect(spies.listProps?.showWorktrees).toBe(true)
  })

  it("respects an explicitly-stored 'false' from localStorage", () => {
    localStorage.setItem("workspace:sidebar-show-worktrees", "false")
    renderSidebar()
    // Hydration runs in a mount effect (flushed by render's act): a user who
    // unchecked it keeps it off despite the default-on.
    expect(spies.listProps?.showWorktrees).toBe(false)
  })
})

describe("Sidebar — Show completed default", () => {
  beforeEach(() => {
    localStorage.clear()
    spies.listProps = null
    mockState.activeFolder = { id: 7, path: "/x" }
  })

  it("defaults Show completed off and threads it to the conversation list", () => {
    renderSidebar()
    expect(spies.listProps?.showCompleted).toBe(false)
  })

  it("respects an explicitly-stored 'true' from localStorage", () => {
    localStorage.setItem("workspace:sidebar-show-completed", "true")
    renderSidebar()
    expect(spies.listProps?.showCompleted).toBe(true)
  })
})

vi.mock("./sidebar-footer", () => ({
  SidebarFooter: () => <div data-testid="sidebar-footer" />,
}))
