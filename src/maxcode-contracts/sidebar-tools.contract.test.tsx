import { act, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { loadSortMode, loadShowRecent } from "@/lib/sidebar-view-mode-storage"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Ref } from "react"

import { Sidebar } from "@/components/layout/sidebar"
import {
  resetConversationUnreadStore,
  useConversationUnreadStore,
} from "@/stores/conversation-unread-store"
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
  setSearchOpen: vi.fn(),
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
  useSearchDialog: () => ({ setOpen: spies.setSearchOpen }),
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

describe("sidebar tools beside search", () => {
  beforeEach(() => {
    localStorage.clear()
    resetConversationUnreadStore()
    spies.scrollToActive.mockClear()
    mockState.isMobile = false
  })

  it("groups search, locate and overflow in that order and locates the active conversation", () => {
    renderSidebar()
    const search = screen.getByRole("button", { name: "Search" })
    const group = search.closest("[data-sidebar-tools]") as HTMLElement
    expect(
      within(group)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label"))
    ).toEqual(["Search", "Locate Active Conversation", "View options"])
    fireEvent.click(
      within(group).getByRole("button", { name: "Locate Active Conversation" })
    )
    expect(spies.scrollToActive).toHaveBeenCalledOnce()
    expect(
      screen.queryByRole("button", { name: "Mark all as read" })
    ).toBeNull()
  })

  it("right-aligns desktop tools in the top row after a draggable flexible spacer", () => {
    const { container } = renderSidebar()
    const header = container.querySelector("aside")!.firstElementChild!
    const tools = screen
      .getByRole("button", { name: "Search" })
      .closest("[data-sidebar-tools]")!
    expect(tools.parentElement).toBe(header)
    expect(tools.previousElementSibling).toHaveAttribute(
      "data-tauri-drag-region"
    )
    expect(tools.previousElementSibling).toHaveClass("flex-1")
    expect(header.firstElementChild).toHaveStyle({ width: "80px" })
    expect(tools.nextElementSibling).toBeNull()
    expect(document.querySelectorAll("[data-sidebar-tools]")).toHaveLength(1)
  })

  it("keeps all three tools touchable on mobile and closes the drawer for search", () => {
    mockState.isMobile = true
    spies.setSearchOpen.mockClear()
    spies.toggleSidebar.mockClear()
    renderSidebar()
    const titleRow = screen.getByRole("heading", {
      name: enMessages.Folder.sidebar.title,
    }).parentElement!.parentElement!
    expect(
      within(titleRow).getByRole("button", { name: "Search" })
    ).toBeVisible()
    expect(
      within(titleRow).getByRole("button", {
        name: "Locate Active Conversation",
      })
    ).toBeVisible()
    expect(
      within(titleRow).getByRole("button", { name: "View options" })
    ).toBeVisible()
    expect(document.querySelectorAll("[data-sidebar-tools]")).toHaveLength(1)
    for (const name of [
      "Search",
      "Locate Active Conversation",
      "View options",
    ]) {
      expect(screen.getByRole("button", { name })).toHaveClass("size-11")
    }
    fireEvent.click(
      screen.getByRole("button", { name: "Locate Active Conversation" })
    )
    expect(spies.scrollToActive).toHaveBeenCalledOnce()
    expect(spies.toggleSidebar).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Search" }))
    expect(spies.toggleSidebar).toHaveBeenCalledOnce()
    expect(spies.setSearchOpen).toHaveBeenCalledWith(true)
  })

  it("keeps mobile expand/collapse available inside the overflow menu", async () => {
    mockState.isMobile = true
    spies.collapseAll.mockClear()
    spies.expandAll.mockClear()
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByRole("button", { name: "View options" }))
    const action = screen.getByRole("menuitem", {
      name: /expand all|collapse all/i,
    })
    await user.click(action)
    expect(
      spies.collapseAll.mock.calls.length + spies.expandAll.mock.calls.length
    ).toBe(1)
  })

  it.each([false, true])(
    "marks all read from the menu (mobile: %s)",
    async (isMobile) => {
      mockState.isMobile = isMobile
      const user = userEvent.setup()
      useConversationUnreadStore.getState().noteActivity(12)
      useConversationUnreadStore.getState().noteActivity(13)
      renderSidebar()
      await user.click(screen.getByRole("button", { name: "View options" }))
      const action = screen.getByRole("menuitem", { name: "Mark all as read" })
      expect(screen.getAllByRole("menuitem")[0]).toBe(action)
      await user.click(action)
      expect(useConversationUnreadStore.getState().unreadIds.size).toBe(0)
    }
  )

  it("persists sorting and list visibility through the restored menu", async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByRole("button", { name: "View options" }))
    await user.click(
      screen.getByRole("menuitemradio", {
        name: enMessages.Folder.sidebar.sortByUpdatedAt,
      })
    )
    expect(loadSortMode()).toBe("updated")
    await user.hover(
      screen.getByRole("menuitem", {
        name: enMessages.Folder.sidebar.listOptions,
      })
    )
    const recent = await screen.findByRole("menuitemcheckbox", {
      name: enMessages.Folder.sidebar.showRecent,
    })
    act(() => recent.focus())
    await user.keyboard("{Enter}")
    expect(loadShowRecent()).toBe(false)
    expect(spies.listProps?.showRecent).toBe(false)
  })
})

vi.mock("@/components/layout/sidebar-footer", () => ({
  SidebarFooter: () => <div data-testid="sidebar-footer" />,
}))
