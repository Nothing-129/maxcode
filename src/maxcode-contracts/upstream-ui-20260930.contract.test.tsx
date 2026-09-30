import { useEffect, type ReactNode } from "react"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  SidebarConversationList,
  resetFolderPointerToggleGuardForTests,
} from "@/components/conversations/sidebar-conversation-list"
import { WorkbenchRouteProvider } from "@/contexts/workbench-route-context"
import enMessages from "@/i18n/messages/en.json"
import type { DbConversationSummary, FolderDetail } from "@/lib/types"
import {
  resetAppWorkspaceStore,
  useAppWorkspaceStore,
} from "@/stores/app-workspace-store"
import { resetConversationUnreadStore } from "@/stores/conversation-unread-store"
import { resetTabStore } from "@/stores/tab-store"

// jsdom has no viewport geometry. Render every row supplied by the real list
// so these contracts exercise pagination, not virtual scrolling/window size.
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

// The host's appearance, terminal and agent catalog are unrelated to paging.
// List state, workspace/tab stores, row builders and cards all remain real.
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
vi.mock("@/hooks/use-subsession-sync", () => ({
  useSubsessionSync: () => {},
}))
// This closed dialog requires a Git credential host even before it is opened.
vi.mock("@/components/layout/clone-dialog", () => ({ CloneDialog: () => null }))

const messages = enMessages.Folder.sidebar
const sessionTitle = (index: number) =>
  `Session ${String(index + 1).padStart(2, "0")}`
const moreLabel = (remaining: number) =>
  messages.showMoreConversations.replace("{count}", String(remaining))

function folder(id: number): FolderDetail {
  return {
    id,
    name: `Repo ${id}`,
    path: `/projects/repo-${id}`,
    git_branch: null,
    default_agent_type: null,
    last_opened_at: "2026-09-01T00:00:00Z",
    sort_order: id,
    color: "blue",
    parent_id: null,
    kind: "regular",
    alias: null,
    group_id: null,
  }
}

function conversation(
  index: number,
  overrides: Partial<DbConversationSummary> = {}
): DbConversationSummary {
  const timestamp = new Date(
    Date.UTC(2026, 8, 1) - index * 60_000
  ).toISOString()
  return {
    id: index + 1,
    folder_id: 1,
    title: sessionTitle(index),
    title_locked: false,
    agent_type: "codex",
    status: "completed",
    kind: "regular",
    model: null,
    git_branch: null,
    external_id: null,
    message_count: 2,
    child_count: 0,
    created_at: timestamp,
    updated_at: timestamp,
    pinned_at: null,
    ...overrides,
  }
}

function renderSidebar(showRecent = false) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <WorkbenchRouteProvider>
        <SidebarConversationList showRecent={showRecent} sortMode="created" />
      </WorkbenchRouteProvider>
    </NextIntlClientProvider>
  )
}

function toggleSection(label: string) {
  fireEvent.click(screen.getByRole("button", { name: label }))
}

function revealMore(remaining: number) {
  fireEvent.click(screen.getByRole("button", { name: moreLabel(remaining) }))
}

beforeEach(() => {
  localStorage.clear()
  resetFolderPointerToggleGuardForTests()
  resetConversationUnreadStore()
  resetAppWorkspaceStore()
  resetTabStore()
  useAppWorkspaceStore.setState({
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

describe("MaxCode contract: Recent filtering retains ten-item pagination", () => {
  function setup() {
    const folders = [folder(1)]
    useAppWorkspaceStore.setState({
      folders,
      allFolders: folders,
      conversations: Array.from({ length: 44 }, (_, index) =>
        conversation(index, { kind: index % 2 === 0 ? "chat" : "regular" })
      ),
    })
    const result = renderSidebar(true)
    toggleSection(messages.sectionFolders)
    toggleSection(messages.sectionChats)
    return result
  }

  const shownTitles = () =>
    screen.queryAllByText(/^Session \d+$/).map((element) => element.textContent)

  async function chooseFilter(label: string) {
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: /^Show in Recent:/ }))
    await user.click(screen.getByRole("menuitemradio", { name: label }))
  }

  it("starts each newly selected kind on ten, with remaining counts from that kind", async () => {
    setup()
    expect(shownTitles()).toHaveLength(10)
    revealMore(34)
    expect(shownTitles()).toHaveLength(20)

    await chooseFilter(messages.sectionChats)
    expect(shownTitles()).toEqual(
      Array.from({ length: 10 }, (_, index) => sessionTitle(index * 2))
    )
    expect(screen.getByRole("button", { name: moreLabel(12) })).toBeVisible()
    revealMore(12)
    expect(shownTitles()).toHaveLength(20)
    expect(screen.getByRole("button", { name: moreLabel(2) })).toBeVisible()

    await chooseFilter(messages.sectionFolders)
    expect(shownTitles()).toEqual(
      Array.from({ length: 10 }, (_, index) => sessionTitle(index * 2 + 1))
    )
    expect(screen.getByRole("button", { name: moreLabel(12) })).toBeVisible()
    expect(localStorage.getItem("workspace:sidebar-recent-filter")).toBe(
      "folders"
    )

    await chooseFilter(messages.recentFilterAll)
    expect(shownTitles()).toEqual(
      Array.from({ length: 10 }, (_, index) => sessionTitle(index))
    )
    expect(screen.getByRole("button", { name: moreLabel(34) })).toBeVisible()
  })

  it("remembers only the kind across remount, and keeps New chat on the Recent header", async () => {
    const view = setup()
    await chooseFilter(messages.sectionChats)
    revealMore(12)
    expect(shownTitles()).toHaveLength(20)
    view.unmount()
    renderSidebar(true)
    expect(shownTitles()).toHaveLength(10)
    expect(localStorage.getItem("workspace:sidebar-recent-filter")).toBe(
      "chats"
    )
    const recentHeader = screen.getByRole("button", {
      name: messages.sectionRecent,
    }).parentElement!
    expect(
      within(recentHeader).getByRole("button", {
        name: messages.newChatAction,
      })
    ).toBeVisible()
    toggleSection(messages.sectionRecent)
    toggleSection(messages.sectionRecent)
    expect(shownTitles()).toHaveLength(10)
  })
})
