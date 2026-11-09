import { act, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  loadSortMode,
  loadShowRecent,
  loadNavItemVisibility,
} from "@/lib/sidebar-view-mode-storage"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Ref } from "react"

import { LeftEdgeChrome } from "@/components/layout/left-edge-chrome"
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
  nativeDesktop: false,
  activeFolder: { id: 7, path: "/x" } as { id: number; path: string } | null,
  isMobile: false,
  sidebarOpen: true,
  isCoarsePointer: false,
  attentionCount: 0,
  sidebarView: "home",
  routeId: "conversations",
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
  useSidebarContext: () => ({
    isOpen: mockState.sidebarOpen,
    toggle: spies.toggleSidebar,
  }),
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
vi.mock("@/contexts/todos-view-context", () => ({
  useTodosView: () => ({
    tasks: [],
    attentionCount: mockState.attentionCount,
    refetch: async () => {},
  }),
}))
vi.mock("@/contexts/sidebar-navigation-context", () => ({
  useSidebarNavigation: () =>
    mockState.isMobile
      ? null
      : {
          view: mockState.sidebarView,
          date: "2026-11-09",
          endDate: "2026-11-09",
          today: "2026-11-09",
          preset: "today",
        },
}))
vi.mock("@/contexts/workbench-route-context", () => ({
  useWorkbenchRoute: () => ({
    routeId: mockState.routeId,
    isConversations: true,
    setRoute: spies.setRoute,
    openConversations: spies.openConversations,
  }),
}))
vi.mock("@/hooks/use-is-mac", () => ({ useIsMac: () => false }))
vi.mock("@/hooks/use-shortcut-settings", () => ({
  useShortcutSettings: () => ({
    shortcuts: {
      toggle_search: "mod+k",
      new_conversation: "mod+t",
      toggle_sidebar: "mod+b",
    },
  }),
}))
vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mockState.isMobile,
}))
vi.mock("@/hooks/use-is-coarse-pointer", () => ({
  useIsCoarsePointer: () => mockState.isCoarsePointer,
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
  isNativeDesktop: () => mockState.nativeDesktop,
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
  it.each(["conversations", "projects", "tasks"])(
    "omits the entire overflow menu outside Home (%s)",
    (view) => {
      mockState.sidebarView = view
      if (view === "tasks") mockState.routeId = "tasks"
      renderSidebar()
      expect(screen.queryByRole("button", { name: "View options" })).toBeNull()
      expect(screen.queryByRole("button", { name: "Open Settings" })).toBeNull()
      expect(screen.getByRole("button", { name: "Search" })).toBeVisible()
    }
  )

  beforeEach(() => {
    localStorage.clear()
    resetConversationUnreadStore()
    spies.scrollToActive.mockClear()
    mockState.sidebarView = "home"
    mockState.nativeDesktop = false
    mockState.isMobile = false
    mockState.isCoarsePointer = false
    mockState.attentionCount = 0
    mockState.routeId = "conversations"
    spies.setRoute.mockClear()
    spies.toggleSidebar.mockClear()
  })

  it("allows the sidebar toggle to close the sidebar while overflow is open", async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByRole("button", { name: "View options" }))
    expect(screen.getByRole("menu")).toBeVisible()

    await user.click(screen.getByRole("button", { name: "Hide Sidebar" }))

    expect(spies.toggleSidebar).toHaveBeenCalledOnce()
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
  })

  it.each(["outside", "trigger", "escape"])(
    "dismisses overflow via %s without closing the sidebar",
    async (action) => {
      const user = userEvent.setup()
      const { container } = renderSidebar()
      const trigger = screen.getByRole("button", { name: "View options" })
      await user.click(trigger)
      expect(screen.getByRole("menu")).toBeVisible()

      if (action === "outside") {
        await user.click(container.querySelector("aside")!)
      } else if (action === "trigger") {
        await user.click(trigger)
      } else {
        await user.keyboard("{Escape}")
      }

      expect(screen.queryByRole("menu")).not.toBeInTheDocument()
      expect(spies.toggleSidebar).not.toHaveBeenCalled()
    }
  )

  it("groups sidebar toggle, search and Home overflow without duplicate Settings", () => {
    renderSidebar()
    const search = screen.getByRole("button", { name: "Search" })
    const group = search.closest("[data-sidebar-tools]") as HTMLElement
    expect(
      within(group)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label"))
    ).toEqual(["Hide Sidebar", "Search", "View options"])
    expect(
      screen.queryByRole("button", { name: "Mark all as read" })
    ).toBeNull()
  })

  it.each([
    [true, false, true],
    [true, true, true],
  ])(
    "opens tasks without a count badge and collapses touch navigation (mobile %s, coarse %s)",
    (mobile, coarse, shouldCollapse) => {
      mockState.isMobile = mobile
      mockState.isCoarsePointer = coarse
      mockState.attentionCount = 2
      mockState.routeId = "tasks"
      renderSidebar()
      const tasks = screen.getByTitle(enMessages.Folder.sidebar.tasks)
      expect(tasks).toHaveAttribute("aria-current", "page")
      expect(tasks.textContent).toBe(enMessages.Folder.sidebar.tasks)
      expect(within(tasks).queryByText("2")).not.toBeInTheDocument()
      fireEvent.click(tasks)
      expect(spies.setRoute).toHaveBeenCalledWith("tasks")
      expect(spies.toggleSidebar).toHaveBeenCalledTimes(shouldCollapse ? 1 : 0)
    }
  )

  it("omits the status color switch from conversation list options", async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByRole("button", { name: "View options" }))
    await user.hover(
      screen.getByRole("menuitem", {
        name: enMessages.Folder.sidebar.listOptions,
      })
    )
    expect(
      await screen.findByRole("menuitemcheckbox", {
        name: enMessages.Folder.sidebar.allowStatusActions,
      })
    ).toBeVisible()
    expect(
      screen.queryByRole("menuitemcheckbox", {
        name: enMessages.Folder.sidebar.showStatus,
      })
    ).not.toBeInTheDocument()
  })

  it("lets mobile users hide and restore tasks through navigation preferences", async () => {
    mockState.isMobile = true
    const user = userEvent.setup()
    renderSidebar()
    expect(screen.getByTitle(enMessages.Folder.sidebar.tasks)).toBeVisible()
    await user.click(screen.getByRole("button", { name: "View options" }))
    await user.hover(
      screen.getByRole("menuitem", {
        name: enMessages.Folder.sidebar.navigationItems,
      })
    )
    const toggle = await screen.findByRole("menuitemcheckbox", {
      name: enMessages.Folder.sidebar.tasks,
    })
    act(() => toggle.focus())
    await user.keyboard("{Enter}")
    expect(screen.queryByTitle(enMessages.Folder.sidebar.tasks)).toBeNull()
    expect(loadNavItemVisibility()).toEqual({ tasks: false })
    await user.keyboard("{Enter}")
    expect(screen.getByTitle(enMessages.Folder.sidebar.tasks)).toBeVisible()
    expect(loadNavItemVisibility()).toEqual({ tasks: true })
  })

  it("right-aligns desktop tools in the top row after a draggable flexible spacer", () => {
    mockState.nativeDesktop = true
    const { container } = renderSidebar()
    const header = container.querySelector("aside")!.firstElementChild!
    const tools = screen
      .getByRole("button", { name: "Search" })
      .closest("[data-sidebar-tools]")!
    expect(tools.parentElement).toBe(header)
    expect(tools.previousElementSibling).toHaveAttribute("data-drag-region")
    expect(tools.previousElementSibling).toHaveClass("flex-1")
    expect(header.firstElementChild).toHaveStyle({ width: "0px" })
    expect(tools.nextElementSibling).toBeNull()
    expect(document.querySelectorAll("[data-sidebar-tools]")).toHaveLength(1)
  })

  it("keeps all three tools touchable on mobile and closes the drawer for search", () => {
    mockState.isMobile = true
    spies.setSearchOpen.mockClear()
    spies.toggleSidebar.mockClear()
    const { container } = renderSidebar()
    expect(
      screen.queryByRole("heading", {
        name: enMessages.Folder.sidebar.title,
      })
    ).not.toBeInTheDocument()
    const titleRow = container.querySelector("aside")!
      .firstElementChild as HTMLElement
    expect(within(titleRow).getByRole("img", { name: "MaxCode" })).toBeVisible()
    expect(screen.getAllByRole("img", { name: "MaxCode" })).toHaveLength(1)
    expect(
      within(titleRow).getByRole("button", { name: "Search" })
    ).toBeVisible()
    expect(
      within(titleRow).getByRole("button", { name: "View options" })
    ).toBeVisible()
    expect(document.querySelectorAll("[data-sidebar-tools]")).toHaveLength(1)
    for (const name of ["Search", "View options"]) {
      expect(screen.getByRole("button", { name })).toHaveClass("size-11")
    }
    expect(spies.toggleSidebar).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Search" }))
    expect(spies.toggleSidebar).toHaveBeenCalledOnce()
    expect(spies.setSearchOpen).toHaveBeenCalledWith(true)
  })

  it.each([false, true])(
    "locates from the overflow menu without closing the sidebar (mobile %s)",
    async (mobile) => {
      mockState.isMobile = mobile
      const user = userEvent.setup()
      renderSidebar()
      expect(
        screen.queryByRole("button", { name: "Locate Active Conversation" })
      ).toBeNull()
      await user.click(screen.getByRole("button", { name: "View options" }))
      await user.click(
        screen.getByRole("menuitem", { name: "Locate Active Conversation" })
      )
      expect(spies.scrollToActive).toHaveBeenCalledOnce()
      expect(spies.toggleSidebar).not.toHaveBeenCalled()
    }
  )

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
      expect(screen.getAllByRole("menuitem")[1]).toBe(action)
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

// Menu behavior uses a synchronous adapter; host persistence and live sync are
// exercised independently by workspace-preferences.contract.test.tsx.
vi.mock("@/lib/workspace-preferences-store", () => ({
  workspacePreferenceStorage: {
    getItem: (key: string) => localStorage.getItem(key),
    setItem: (key: string, value: string) => localStorage.setItem(key, value),
  },
  subscribeWorkspacePreferences: (listener: () => void) => {
    listener()
    return () => {}
  },
}))

it("moves the desktop sidebar toggle inside when open and outside when collapsed", () => {
  mockState.isMobile = false
  mockState.sidebarOpen = true
  spies.toggleSidebar.mockClear()
  const view = () => (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <Sidebar />
      <div data-testid="main-navigation">
        <LeftEdgeChrome />
      </div>
    </NextIntlClientProvider>
  )
  const { container, rerender } = render(view())
  const hide = screen.getByRole("button", { name: "Hide Sidebar" })
  expect(container.querySelector("aside")).toContainElement(hide)
  expect(
    within(screen.getByTestId("main-navigation")).queryByRole("button", {
      name: "Hide Sidebar",
    })
  ).toBeNull()
  fireEvent.click(hide)
  expect(spies.toggleSidebar).toHaveBeenCalledOnce()
  mockState.sidebarOpen = false
  rerender(view())
  expect(container.querySelector("aside")).toBeNull()
  const show = within(screen.getByTestId("main-navigation")).getByRole(
    "button",
    { name: "Show Sidebar" }
  )
  fireEvent.click(show)
  expect(spies.toggleSidebar).toHaveBeenCalledTimes(2)
  mockState.sidebarOpen = true
  rerender(view())
  expect(screen.queryByRole("button", { name: "Show Sidebar" })).toBeNull()
  expect(container.querySelector("aside")).toContainElement(
    screen.getByRole("button", { name: "Hide Sidebar" })
  )
})
