import { act, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Ref } from "react"

import { Sidebar } from "./sidebar"
import { __resetUiPreferencesStoreForTests } from "@/lib/ui-preferences-store"
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
vi.mock("@/lib/platform", () => ({
  isDesktop: () => false,
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

/**
 * Walk into one of the view-options menu's two visibility inventories, which
 * live behind submenus. Clicking a sub-trigger opens it synchronously; opening
 * it by HOVER runs on a 100ms Radix timer and is asserted separately below.
 *
 * This — and every click on a row inside the submenu — deliberately uses the
 * module-level `userEvent` instead of a `setup()` instance, matching the
 * quick-actions submenu tests. A shared instance remembers where the pointer
 * was, so the next click drags it off the sub-trigger first; Radix answers a
 * trigger-leave with its grace-area check, which needs real element geometry,
 * and jsdom reports every rect as 0×0. The check fails, the root menu takes
 * focus back, and the submenu closes out from under the click. A fresh
 * instance has no previous position, so nothing ever leaves the trigger.
 */
async function openViewOptionsGroup(
  group: "Conversation list" | "Navigation items"
) {
  await userEvent.click(screen.getByRole("button", { name: "View options" }))
  await userEvent.click(screen.getByRole("menuitem", { name: group }))
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

  it("renders the app name above New chat", () => {
    const { getByText } = renderSidebar()
    const brand = getByText("MaxCode")
    const newChat = getByText("New chat")
    expect(brand.compareDocumentPosition(newChat)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
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

  it("always shows the header action and marks every conversation as read", async () => {
    useConversationUnreadStore.getState().noteActivity(7)
    useConversationUnreadStore.getState().noteActivity(8)
    const user = userEvent.setup()
    renderSidebar()

    const markAllRead = screen.getByRole("button", {
      name: "Mark all as read",
    })
    await user.click(markAllRead)

    expect(useConversationUnreadStore.getState().unreadIds.size).toBe(0)
    expect(markAllRead).toBeVisible()
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

describe("Sidebar — View options grouping", () => {
  beforeEach(() => {
    localStorage.clear()
    mockState.activeFolder = { id: 7, path: "/x" }
  })

  it("keeps both visibility inventories out of the root menu", async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByRole("button", { name: "View options" }))

    // Eight checkboxes inline turned the root into a wall; they now sit one hop
    // in, behind their group. Sort by / Section order stay inline — the
    // control on the right is the proof this is about the two inventories and
    // not the menu failing to render.
    expect(
      screen.queryByRole("menuitemcheckbox", { name: "Show worktree folders" })
    ).toBeNull()
    expect(
      screen.queryByRole("menuitemcheckbox", { name: "Automations" })
    ).toBeNull()
    expect(
      screen.getByRole("menuitemradio", { name: "Created time" })
    ).toBeTruthy()

    expect(
      screen.getByRole("menuitem", { name: "Conversation list" })
    ).toBeTruthy()
    expect(
      screen.getByRole("menuitem", { name: "Navigation items" })
    ).toBeTruthy()
    await user.keyboard("{Escape}")
  })

  it("opens a group on hover alone, with no click", async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByRole("button", { name: "View options" }))

    // Load-bearing: without this the assertion below would also pass on a menu
    // that never nested the toggles in the first place.
    expect(
      screen.queryByRole("menuitemcheckbox", { name: "Automations" })
    ).toBeNull()

    // Pointing at the row is the whole interaction — Radix opens the submenu on
    // a short pointer-move timer, so this resolves without a second click.
    await user.hover(screen.getByRole("menuitem", { name: "Navigation items" }))

    expect(
      await screen.findByRole("menuitemcheckbox", { name: "Automations" })
    ).toBeTruthy()
    // Escape inside a submenu closes the whole stack, root included.
    await user.keyboard("{Escape}")
  })
})

describe("Sidebar — Show worktree folders toggle", () => {
  beforeEach(() => {
    localStorage.clear()
    spies.listProps = null
    mockState.activeFolder = { id: 7, path: "/x" }
  })

  it("defaults Show worktree folders on and threads it to the conversation list", () => {
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

  it("toggling the view-options item off persists the choice and threads it down", async () => {
    renderSidebar()
    // Default on with a cleared store.
    expect(spies.listProps?.showWorktrees).toBe(true)

    await openViewOptionsGroup("Conversation list")
    await userEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Show worktree folders" })
    )

    expect(localStorage.getItem("workspace:sidebar-show-worktrees")).toBe(
      "false"
    )
    expect(spies.listProps?.showWorktrees).toBe(false)
  })
})

describe("Sidebar — conversation status view options", () => {
  beforeEach(() => {
    localStorage.clear()
    __resetUiPreferencesStoreForTests()
    uiPrefsSpies.updateUiPreferences.mockClear()
  })

  it("defaults status colors off and actions on, and persists toggling them", async () => {
    const user = userEvent.setup()
    renderSidebar()

    await openViewOptionsGroup("Conversation list")
    const showStatus = screen.getByRole("menuitemcheckbox", {
      name: "Show status colors",
    })
    const allowActions = screen.getByRole("menuitemcheckbox", {
      name: "Allow changing conversation status",
    })
    expect(showStatus).toHaveAttribute("data-state", "unchecked")
    expect(allowActions).toHaveAttribute("data-state", "checked")

    await user.click(showStatus)
    await user.click(allowActions)

    expect(showStatus).toHaveAttribute("data-state", "checked")
    expect(allowActions).toHaveAttribute("data-state", "unchecked")
    // Persisted to the backend as the full UiPreferences blob (not localStorage).
    expect(uiPrefsSpies.updateUiPreferences).toHaveBeenLastCalledWith({
      show_conversation_status: true,
      allow_conversation_status_actions: false,
      show_welcome_quick_actions: true,
    })
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

describe("Sidebar — Show Recent group toggle", () => {
  beforeEach(() => {
    localStorage.clear()
    spies.listProps = null
    mockState.activeFolder = { id: 7, path: "/x" }
  })

  it("defaults Show Recent on and threads it to the conversation list", () => {
    renderSidebar()
    expect(spies.listProps?.showRecent).toBe(true)
  })

  it("respects an explicitly-stored 'false' from localStorage", () => {
    localStorage.setItem("workspace:sidebar-show-recent", "false")
    renderSidebar()
    expect(spies.listProps?.showRecent).toBe(false)
  })

  it("toggling the view-options item off persists the choice and keeps the menu open", async () => {
    renderSidebar()

    await openViewOptionsGroup("Conversation list")
    await userEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Show Recent group" })
    )

    expect(localStorage.getItem("workspace:sidebar-show-recent")).toBe("false")
    expect(spies.listProps?.showRecent).toBe(false)
    // The view-options menu is a settings panel: flipping one option must not
    // dismiss it — nor the submenu it lives in — or changing two costs two
    // trips back through the trigger.
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Show Recent group" })
    ).toBeTruthy()
  })
})

describe("Sidebar — Navigation item visibility", () => {
  beforeEach(() => {
    localStorage.clear()
    mockState.activeFolder = { id: 7, path: "/x" }
  })

  // The nav rows are `button`s; the menu's toggles are `menuitemcheckbox`es, so
  // the two never collide even while the menu is open. The Forge row's name
  // carries its Beta badge (deliberately not aria-hidden), unlike its toggle.
  const navRow = (name: string | RegExp) =>
    screen.queryByRole("button", { name })
  const FORGE_ROW = /^Repository panel/

  it("shows every route row by default", () => {
    renderSidebar()
    expect(navRow("Automations")).toBeTruthy()
    expect(navRow("To-dos")).toBeTruthy()
    expect(navRow(FORGE_ROW)).toBeTruthy()
  })

  it("hides a row when its menu toggle is switched off, and persists it", async () => {
    renderSidebar()

    await openViewOptionsGroup("Navigation items")
    await userEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Automations" })
    )
    // Like every other option here, flipping one must not dismiss the menu —
    // and the submenu it lives in has to survive too.
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Automations" })
    ).toBeTruthy()
    // Close it before looking at the rows: an open Radix menu is modal and
    // aria-hides the sidebar behind it, which would make "the row is gone" true
    // for the wrong reason. Escape inside a submenu closes the whole stack.
    await userEvent.keyboard("{Escape}")

    expect(navRow("Automations")).toBeNull()
    // Control: the other rows are still there, so the assertion above is about
    // this one row rather than a hidden subtree.
    expect(navRow("To-dos")).toBeTruthy()
    expect(
      JSON.parse(localStorage.getItem("workspace:sidebar-nav-items") ?? "{}")
    ).toEqual({ automations: false })
  })

  it("respects an explicitly-stored hidden row from localStorage", () => {
    localStorage.setItem(
      "workspace:sidebar-nav-items",
      JSON.stringify({ forge: false })
    )
    renderSidebar()
    expect(navRow(FORGE_ROW)).toBeNull()
    expect(navRow("Automations")).toBeTruthy()
  })

  it("ignores a stored entry for a route that no longer exists", () => {
    localStorage.setItem(
      "workspace:sidebar-nav-items",
      JSON.stringify({ retired: false, tasks: false })
    )
    renderSidebar()
    expect(navRow("To-dos")).toBeNull()
    expect(navRow("Automations")).toBeTruthy()
  })
})

describe("Sidebar — Expand / collapse all groups", () => {
  beforeEach(() => {
    localStorage.clear()
    spies.collapseAll.mockClear()
    spies.expandAll.mockClear()
    mockState.activeFolder = { id: 7, path: "/x" }
    mockState.isMobile = false
  })

  it("stays in the view-options menu on desktop", async () => {
    const user = userEvent.setup()
    renderSidebar()

    expect(
      screen.queryByRole("button", { name: "Collapse All Groups" })
    ).toBeNull()

    await user.click(screen.getByRole("button", { name: "View options" }))
    expect(
      screen.getByRole("menuitem", { name: "Collapse All Groups" })
    ).toBeTruthy()
    await user.keyboard("{Escape}")
  })

  it("drives the list from the desktop menu and flips direction", async () => {
    const user = userEvent.setup()
    renderSidebar()

    await user.click(screen.getByRole("button", { name: "View options" }))
    await user.click(
      screen.getByRole("menuitem", { name: "Collapse All Groups" })
    )
    expect(spies.collapseAll).toHaveBeenCalledTimes(1)
    expect(spies.expandAll).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "View options" }))
    await user.click(
      screen.getByRole("menuitem", { name: "Expand All Groups" })
    )
    expect(spies.expandAll).toHaveBeenCalledTimes(1)
  })

  it("keeps the icon-only header button on mobile", async () => {
    const user = userEvent.setup()
    mockState.isMobile = true
    renderSidebar()

    const toggle = screen.getByRole("button", { name: "Collapse All Groups" })
    expect(toggle.textContent).toBe("")
    await user.click(toggle)

    expect(spies.collapseAll).toHaveBeenCalledTimes(1)
    expect(
      screen.queryByRole("button", { name: "Collapse All Groups" })
    ).toBeNull()
    expect(
      screen.getByRole("button", { name: "Expand All Groups" })
    ).toBeTruthy()
  })
})

describe("Sidebar — Section order control", () => {
  beforeEach(() => {
    localStorage.clear()
    spies.listProps = null
    mockState.activeFolder = { id: 7, path: "/x" }
  })

  // The order rows are `menuitem`s labelled "<name> — position N of 3"; the
  // move buttons inside them are labelled "<name> — Move up/down".
  const orderRowNames = () =>
    screen
      .getAllByRole("menuitem")
      .map((el) => el.getAttribute("aria-label") ?? "")
      .filter((label) => label.includes("position"))

  it("defaults to Folders → Chat → Recent", async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByRole("button", { name: "View options" }))

    expect(orderRowNames()).toEqual([
      "Folders — position 1 of 3",
      "Chat — position 2 of 3",
      "Recent — position 3 of 3",
    ])
    expect(spies.listProps?.sectionOrder).toEqual([
      "folders",
      "chats",
      "recent",
    ])
  })

  it("moves a section up, persists the new order and threads it down", async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByRole("button", { name: "View options" }))
    await user.click(screen.getByRole("button", { name: "Recent — Move up" }))

    expect(orderRowNames()).toEqual([
      "Folders — position 1 of 3",
      "Recent — position 2 of 3",
      "Chat — position 3 of 3",
    ])
    expect(spies.listProps?.sectionOrder).toEqual([
      "folders",
      "recent",
      "chats",
    ])
    expect(
      JSON.parse(localStorage.getItem("workspace:sidebar-section-order") ?? "")
    ).toEqual(["folders", "recent", "chats"])
  })

  it("disables the move buttons that would fall off an end", async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByRole("button", { name: "View options" }))

    expect(
      screen.getByRole("button", { name: "Folders — Move up" })
    ).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "Recent — Move down" })
    ).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "Folders — Move down" })
    ).not.toBeDisabled()
  })

  it("reorders from the keyboard with Alt+Arrow on the focused row", async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByRole("button", { name: "View options" }))

    // The nested move buttons are unreachable by Tab (Radix's menu swallows it)
    // and by the roving focus, so Alt+Arrow on the row is the ONLY keyboard
    // path — if this regresses, the control becomes mouse-only.
    const foldersRow = screen.getByRole("menuitem", {
      name: "Folders — position 1 of 3",
    })
    // Focusing a menu item updates Radix's roving-focus state, so it has to run
    // inside act().
    act(() => foldersRow.focus())
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}")

    expect(orderRowNames()).toEqual([
      "Chat — position 1 of 3",
      "Folders — position 2 of 3",
      "Recent — position 3 of 3",
    ])
    // Focus follows the row it moved, so a second press keeps going.
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Folders — position 2 of 3"
    )
  })

  it("restores a legacy 'chats-first' preference from an older build", async () => {
    const user = userEvent.setup()
    localStorage.setItem("workspace:sidebar-section-order", "chats-first")
    renderSidebar()
    await user.click(screen.getByRole("button", { name: "View options" }))

    expect(orderRowNames()).toEqual([
      "Chat — position 1 of 3",
      "Folders — position 2 of 3",
      "Recent — position 3 of 3",
    ])
  })

  it("keeps a hidden Recent section listed and reorderable", async () => {
    const user = userEvent.setup()
    localStorage.setItem("workspace:sidebar-show-recent", "false")
    renderSidebar()
    await user.click(screen.getByRole("button", { name: "View options" }))

    // Hiding is a separate preference from position: the row stays so the user
    // can park it where it will reappear.
    await user.click(screen.getByRole("button", { name: "Recent — Move up" }))
    expect(spies.listProps?.sectionOrder).toEqual([
      "folders",
      "recent",
      "chats",
    ])
    expect(spies.listProps?.showRecent).toBe(false)
  })
})
