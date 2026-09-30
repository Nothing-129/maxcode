import { useEffect, type ReactNode } from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
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
const resetLabel = messages.resetRecentLimit.replace("{count}", "10")

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

function expectSessions(count: number) {
  expect(
    screen.queryAllByText(/^Session \d+$/).map((element) => element.textContent)
  ).toEqual(Array.from({ length: count }, (_, index) => sessionTitle(index)))
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

describe("MaxCode contract: sidebar reveals ten conversations per page", () => {
  describe.each(["Chat", "Recent", "Folder"] as const)("%s", (section) => {
    function setup(total = 22) {
      const folders = section === "Chat" ? [] : [folder(1)]
      useAppWorkspaceStore.setState({
        folders,
        allFolders: folders,
        conversations: Array.from({ length: total }, (_, index) =>
          conversation(index, {
            // Recent must page the combined folder and chat history.
            kind:
              section === "Chat" || (section === "Recent" && index % 2 === 0)
                ? "chat"
                : "regular",
          })
        ),
      })
      renderSidebar(section === "Recent")
      if (section === "Recent") {
        toggleSection(messages.sectionFolders)
        toggleSection(messages.sectionChats)
      }
    }

    function toggle() {
      if (section === "Folder") {
        fireEvent.click(screen.getByText("Repo 1"))
      } else {
        toggleSection(
          section === "Recent" ? messages.sectionRecent : messages.sectionChats
        )
      }
    }

    it("reveals 10, 20, then all 22 in order without duplicates", () => {
      setup()
      expectSessions(10)
      revealMore(12)
      expectSessions(20)
      revealMore(2)
      expectSessions(22)
      expect(screen.queryByRole("button", { name: /^Show more/ })).toBeNull()
    })

    it("returns to the first ten when collapsed and reopened", () => {
      setup()
      revealMore(12)
      expectSessions(20)
      toggle()
      expectSessions(0)
      toggle()
      expectSessions(10)
      expect(screen.getByRole("button", { name: moreLabel(12) })).toBeVisible()
    })

    it("does not offer another page when exactly ten conversations exist", () => {
      setup(10)
      expectSessions(10)
      expect(screen.queryByRole("button", { name: /^Show more/ })).toBeNull()
    })
  })

  it("pages folders independently and preserves a sibling's revealed rows", () => {
    const folders = [folder(1), folder(2)]
    useAppWorkspaceStore.setState({
      folders,
      allFolders: folders,
      conversations: Array.from({ length: 44 }, (_, index) =>
        conversation(index, { folder_id: index < 22 ? 1 : 2 })
      ),
    })
    renderSidebar()

    const visibleTitles = () =>
      screen
        .queryAllByText(/^Session \d+$/)
        .map((element) => element.textContent)
    const titles = (start: number, count: number) =>
      Array.from({ length: count }, (_, index) => sessionTitle(start + index))

    expect(visibleTitles()).toEqual([...titles(0, 10), ...titles(22, 10)])
    fireEvent.click(screen.getAllByRole("button", { name: moreLabel(12) })[0])
    expect(visibleTitles()).toEqual([...titles(0, 20), ...titles(22, 10)])
    revealMore(12)
    expect(visibleTitles()).toEqual([...titles(0, 20), ...titles(22, 20)])

    fireEvent.click(screen.getByText("Repo 1"))
    expect(visibleTitles()).toEqual(titles(22, 20))
    fireEvent.click(screen.getByText("Repo 1"))
    expect(visibleTitles()).toEqual([...titles(0, 10), ...titles(22, 20)])
  })

  it("resets Recent to ten and retains keyboard focus while pages remain", () => {
    useAppWorkspaceStore.setState({
      conversations: Array.from({ length: 22 }, (_, index) =>
        conversation(index, { kind: "chat" })
      ),
    })
    renderSidebar(true)
    toggleSection(messages.sectionChats)
    revealMore(12)
    expectSessions(20)

    const reset = screen.getByRole("button", { name: resetLabel })
    reset.focus()
    fireEvent.click(reset)

    expectSessions(10)
    expect(screen.getByRole("button", { name: moreLabel(12) })).toHaveFocus()
    expect(screen.queryByRole("button", { name: resetLabel })).toBeNull()
  })
})
