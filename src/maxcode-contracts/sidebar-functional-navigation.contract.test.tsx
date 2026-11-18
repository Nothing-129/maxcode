import { act, fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { SidebarSectionHeader } from "@/components/conversations/sidebar-section-header"
import { RecentDateFilter } from "@/components/layout/recent-date-filter"
import { source } from "./contract-source"
import en from "@/i18n/messages/en.json"
import { WorkspaceNavigationRail } from "@/components/layout/workspace-navigation-rail"
import {
  SidebarNavigationProvider,
  useSidebarNavigation,
} from "@/contexts/sidebar-navigation-context"
import {
  WorkbenchRouteProvider,
  useWorkbenchRoute,
} from "@/contexts/workbench-route-context"
import {
  DATE_FILTER_STORAGE_KEY,
  resolveDateFilter,
  loadDateFilter,
  conversationsOnDate,
  localDateKey,
  sidebarViewSections,
  sidebarPageSize,
} from "@/lib/sidebar-navigation"
import {
  selectPinnedWithReuse,
  buildRows,
} from "@/components/conversations/sidebar-conversation-grouping"
import type { DbConversationSummary } from "@/lib/types"

const mocks = vi.hoisted(() => ({
  toggle: vi.fn(),
  close: vi.fn(),
  settings: vi.fn(),
  native: false,
  isMac: false,
}))
vi.mock("@/lib/platform", () => ({
  isNativeDesktop: () => mocks.native,
}))
vi.mock("@/hooks/use-platform", () => ({
  usePlatform: () => ({ isMac: mocks.isMac }),
}))
vi.mock("@/contexts/sidebar-context", () => ({
  useSidebarContext: () => ({
    isOpen: false,
    toggle: mocks.toggle,
    close: mocks.close,
  }),
}))
vi.mock("@/contexts/automations-view-context", () => ({
  useAutomationsView: () => ({ unseenFailures: 2 }),
}))
vi.mock("@/components/layout/sidebar-codex-quota", () => ({
  SidebarCodexQuota: () => null,
}))
vi.mock("@/components/layout/status-bar-alerts", () => ({
  StatusBarAlerts: () => null,
}))
vi.mock("@/lib/api", () => ({
  openSettingsWindow: mocks.settings,
}))

function CurrentView() {
  const navigation = useSidebarNavigation()!
  const route = useWorkbenchRoute()
  return (
    <>
      <output data-testid="current">
        {route.routeId}:{navigation.view}:{navigation.date}
      </output>
      <button onClick={route.openConversations}>
        Open linked task conversation
      </button>
      <button onClick={() => navigation.setDate("2026-10-15")}>
        Pick date
      </button>
    </>
  )
}

function conversation(
  id: number,
  updated: Date,
  extra: Partial<DbConversationSummary> = {}
): DbConversationSummary {
  return {
    id,
    folder_id: 7,
    title: `Conversation ${id}`,
    title_locked: false,
    agent_type: "codex",
    status: "in_progress",
    kind: "regular",
    model: null,
    git_branch: null,
    external_id: null,
    message_count: 2,
    child_count: 0,
    created_at: new Date(2026, 8, 1).toISOString(),
    updated_at: updated.toISOString(),
    pinned_at: null,
    ...extra,
  }
}

beforeEach(() => {
  localStorage.clear()
  mocks.native = false
  mocks.isMac = false
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("functional sidebar navigation", () => {
  it.each([false, true])(
    "moves the solid icon and gray highlight with the current destination (mobile: %s)",
    (mobile) => {
      render(
        <NextIntlClientProvider locale="en" messages={en}>
          <WorkbenchRouteProvider>
            <SidebarNavigationProvider>
              <WorkspaceNavigationRail mobile={mobile} />
            </SidebarNavigationProvider>
          </WorkbenchRouteProvider>
        </NextIntlClientProvider>
      )
      const chats = screen.getByRole("button", { name: "Chats" })
      const automations = screen.getByRole("button", { name: "Auto" })
      const home = screen.getByRole("button", { name: "Home" })
      const projects = screen.getByRole("button", { name: "Projects" })
      const tasks = screen.getByRole("button", { name: "Tasks" })

      for (const [selected, inactive] of [
        [home, automations],
        [projects, home],
        [tasks, projects],
        [chats, tasks],
        [automations, chats],
      ]) {
        fireEvent.click(selected)
        expect(selected).toHaveAttribute("aria-current", "page")
        expect(selected).toHaveClass(
          "size-10",
          "bg-clip-content",
          "bg-[#eaeaea]"
        )
        expect(selected).not.toHaveClass("hover:bg-sidebar-foreground/5")
        expect(selected.querySelector("svg")).toHaveAttribute(
          "fill",
          "currentColor"
        )
        expect(selected.querySelector("svg")).toHaveAttribute(
          "aria-hidden",
          "true"
        )
        expect(inactive).not.toHaveAttribute("aria-current")
        expect(inactive).not.toHaveClass("bg-[#eaeaea]")
        expect(inactive).toHaveClass("hover:bg-sidebar-foreground/5")
        expect(inactive.querySelector("svg")).toHaveAttribute("fill", "none")
      }
    }
  )

  it("renders rail buttons in the saved navigation order", () => {
    localStorage.setItem(
      "workspace:navigation-order",
      JSON.stringify([
        "automations",
        "projects",
        "home",
        "tasks",
        "conversations",
      ])
    )
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <WorkbenchRouteProvider>
          <SidebarNavigationProvider>
            <WorkspaceNavigationRail />
          </SidebarNavigationProvider>
        </WorkbenchRouteProvider>
      </NextIntlClientProvider>
    )
    const rail = screen.getByRole("navigation")
    expect(
      Array.from(rail.querySelectorAll("button"))
        .slice(0, 5)
        .map((button) => button.getAttribute("aria-label"))
    ).toEqual([
      en.Folder.sidebar.navigation.automations,
      en.Folder.sidebar.navigation.projects,
      en.Folder.sidebar.navigation.home,
      en.Folder.sidebar.navigation.tasks,
      en.Folder.sidebar.navigation.conversations,
    ])
  })

  it.each([
    ["Windows desktop", true, false, false, "h-2"],
    ["macOS desktop", true, true, false, "h-14"],
    ["macOS browser", false, true, false, "h-2"],
    ["macOS mobile drawer", true, true, true, "h-2"],
  ])(
    "keeps the rail top spacing appropriate for %s",
    (_, native, isMac, mobile, height) => {
      mocks.native = native
      mocks.isMac = isMac
      render(
        <NextIntlClientProvider locale="en" messages={en}>
          <WorkbenchRouteProvider>
            <SidebarNavigationProvider>
              <WorkspaceNavigationRail mobile={mobile} />
            </SidebarNavigationProvider>
          </WorkbenchRouteProvider>
        </NextIntlClientProvider>
      )
      const spacer = screen.getByRole("navigation").firstElementChild
      expect(spacer).toHaveClass(height)
      expect(spacer?.hasAttribute("data-drag-region")).toBe(height === "h-14")
    }
  )

  it("keeps pinned conversations above history outside the chosen dates without duplicate rows", () => {
    const pin = conversation(11, new Date(2026, 6, 1), {
      pinned_at: "2026-10-01T12:00:00Z",
      status: "completed",
    })
    const recentPin = conversation(12, new Date(2026, 10, 9, 12), {
      pinned_at: "2026-11-09T12:00:00Z",
    })
    const normal = conversation(13, new Date(2026, 10, 9, 13))
    const input = [pin, recentPin, normal]
    for (const date of ["2026-11-09", "2026-11-08"]) {
      const rows = buildRows({
        pinned: selectPinnedWithReuse(input, []),
        pinnedExpanded: true,
        recentConversations: conversationsOnDate(input, date),
        showRecent: true,
        visibleSections: sidebarViewSections("conversations"),
        orderedFolderIds: [],
        byFolder: new Map(),
        folderExpanded: {},
        folderTotalCounts: new Map(),
        foldersExpanded: true,
        chatConversations: [],
        chatsExpanded: true,
      })
      const ids = rows
        .filter((row) => row.kind === "conversation")
        .map((row) => row.conversation.id)
      expect(ids).toEqual(date === "2026-11-09" ? [12, 11, 13] : [12, 11])
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it("reserves duplicate Home automation/task shortcuts for mobile without a function rail", () => {
    const sidebar = source("src/components/layout/sidebar.tsx")
    expect(sidebar).toMatch(
      /isMobile &&\s*!navigation &&\s*view === "home" &&\s*isNavItemVisible\(navItems, "automations"\)/
    )
    expect(sidebar).toMatch(
      /isMobile &&\s*!navigation &&\s*view === "home" &&\s*isNavItemVisible\(navItems, "tasks"\)/
    )
  })

  it("places the grouping toggle last on Recent and keeps disclosure independent", () => {
    const onToggle = vi.fn()
    const changeGrouping = vi.fn()
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SidebarSectionHeader
          section="recent"
          expanded={false}
          onToggle={onToggle}
          onNewChat={() => {}}
          groupByFolder
          onToggleFolderGrouping={changeGrouping}
        />
      </NextIntlClientProvider>
    )
    const grouping = screen.getByRole("button", {
      name: en.Folder.sidebar.navigation.groupByFolder,
      pressed: true,
    })
    expect(screen.getAllByRole("button").pop()).toBe(grouping)
    fireEvent.click(grouping)
    expect(changeGrouping).toHaveBeenCalledOnce()
    expect(onToggle).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole("button", { name: en.Folder.sidebar.sectionRecent })
    )
    expect(onToggle).toHaveBeenCalledWith("recent")
    expect(changeGrouping).toHaveBeenCalledOnce()
  })

  it("uses the shared MaxCode wordmark for every sidebar view and retains date filter controls", () => {
    const sidebar = source("src/components/layout/sidebar.tsx")
    expect(sidebar).toContain("<SidebarWordmark />")
    expect(sidebar).toContain("<RecentDateFilter />")
    expect(sidebar).not.toContain("FolderTree")
    expect(sidebar).not.toContain("ConversationDateHeading")
    expect(sidebar).not.toContain("t(`navigation.${view}`)")
    expect(sidebar).toMatch(
      /<SidebarWordmark \/>\s*<\/span>\s*\{headerDateFilter\}/
    )
    expect(sidebar).not.toContain('className="shrink-0 px-3 pt-2"')
    expect(sidebar).not.toContain("<RecentDateFilterSummary />")
  })

  it("opens the automation list in the sidebar locally and derives task sidebar sections from the active task route", () => {
    const layout = source("src/app/workspace/layout.tsx")
    expect(layout).toMatch(
      /routeId === "automations"\s*\|\|\s*\(sidebarOpenRequested && routeId !== "tokenUsage"\)/
    )

    expect(source("src/components/layout/left-edge-chrome.tsx")).toContain(
      'if (routeId === "automations" || routeId === "tokenUsage") return null'
    )
    const sidebar = source("src/components/layout/sidebar.tsx")
    expect(sidebar).toContain('routeId === "taskConversation"')
    expect(sidebar).toContain('t("navigation.todoBoard")')
    expect(sidebar).toContain(
      'view === "tasks" || (view === "home" && showTodos)'
    )
  })

  it("gives the task board action the same lightweight desktop style as new chat", () => {
    const sidebar = source("src/components/layout/sidebar.tsx")
    const action =
      sidebar.match(
        /<SidebarNavButton\s+icon="tasks"\s+variant=[\s\S]*?\/>/
      )?.[0] ?? ""
    expect(action).toContain("<SidebarNavButton")
    expect(action).toContain('icon="tasks"')
    expect(action).toContain('variant={isMobile ? "filled" : "ghost"}')
    expect(action).toContain('label={t("navigation.todoBoard")}')
    expect(action).toContain('setRoute("tasks")')
    expect(action).toContain("if (collapseOnNavigate) toggle()")
    expect(action).not.toContain("active=")
    expect(action).not.toContain("routeId")
  })

  it("uses the same responsive new-chat action for conversations and projects", () => {
    const sidebar = source("src/components/layout/sidebar.tsx")
    const button = sidebar.slice(
      sidebar.indexOf("function SidebarNavButton("),
      sidebar.indexOf("export function Sidebar(")
    )
    expect(button).toContain("items-center justify-center gap-1.5")
    expect(button).toContain("rounded-lg bg-sidebar-accent/35")
    expect(button).toContain(
      'variant === "ghost" && "justify-start gap-2.5 bg-transparent px-2.5"'
    )
    expect(sidebar).not.toContain("subtle={")
  })

  it("pages the conversation view in batches of 50 and resets to its own page size", () => {
    expect(sidebarPageSize("conversations")).toBe(50)
    expect(sidebarPageSize("home")).toBe(10)
    const convs = Array.from({ length: 126 }, (_, i) =>
      conversation(i + 1, new Date(2026, 10, 9))
    )
    const args = {
      pinned: [],
      pinnedExpanded: true,
      orderedFolderIds: [],
      byFolder: new Map(),
      folderExpanded: {},
      folderTotalCounts: new Map(),
      foldersExpanded: true,
      chatConversations: [],
      chatsExpanded: true,
      visibleSections: sidebarViewSections("conversations"),
      recentConversations: convs,
      showRecent: true,
      recentPageSize: sidebarPageSize("conversations"),
    }
    for (const [limit, remaining, reset] of [
      [50, 76, false],
      [100, 26, true],
      [150, 0, true],
    ] as const) {
      const rows = buildRows({ ...args, recentLimit: limit })
      expect(rows.filter((row) => row.kind === "conversation")).toHaveLength(
        Math.min(limit, 126)
      )
      const more = rows.find((row) => row.kind === "recent-more")
      expect(more).toMatchObject({ remaining })
      expect(more?.kind === "recent-more" && !!more.canReset).toBe(reset)
    }
  })

  it("groups the filtered recent page by project and chat without duplicating pinned rows", () => {
    const day = new Date(2026, 10, 18, 12)
    const items = [
      conversation(9, day, { pinned_at: day.toISOString() }),
      conversation(7, day),
      conversation(6, day, { kind: "chat" }),
      conversation(5, day, { folder_id: 8 }),
      conversation(4, day, { folder_id: 10 }),
    ]
    const args = {
      pinned: [items[0]],
      pinnedExpanded: true,
      orderedFolderIds: [],
      byFolder: new Map(),
      folderExpanded: {},
      folderTotalCounts: new Map(),
      foldersExpanded: true,
      chatConversations: [],
      chatsExpanded: true,
      showRecent: true,
      visibleSections: sidebarViewSections("conversations"),
      recentConversations: conversationsOnDate(items, "2026-11-18"),
      recentFolders: new Map<
        number,
        { kind: "regular"; parent_id: number | null }
      >([
        [7, { kind: "regular", parent_id: null }],
        [8, { kind: "regular", parent_id: 7 }],
      ]),
      recentLimit: 3,
    }
    const rows = buildRows(args)
    expect(
      rows.filter((r) => r.kind === "recent-group").map((r) => r.id)
    ).toEqual([7, "chat"])
    expect(
      rows
        .filter((r) => r.kind === "conversation")
        .map((r) => r.conversation.id)
    ).toEqual([9, 7, 5, 6])
    expect(rows[rows.length - 1]).toMatchObject({
      kind: "recent-more",
      remaining: 1,
    })
    const folded = buildRows({ ...args, collapsedRecentGroups: new Set([7]) })
    expect(
      folded
        .filter((r) => r.kind === "conversation")
        .map((r) => r.conversation.id)
    ).toEqual([9, 6])
  })

  it("resolves rolling presets by local calendar days with Monday as week start", () => {
    const expected = {
      today: ["2026-11-09", "2026-11-09"],
      yesterday: ["2026-11-08", "2026-11-08"],
      last3: ["2026-11-07", "2026-11-09"],
      last7: ["2026-11-03", "2026-11-09"],
      week: ["2026-11-09", "2026-11-09"],
      month: ["2026-11-01", "2026-11-09"],
    } as const
    for (const preset of Object.keys(expected) as (keyof typeof expected)[]) {
      const result = resolveDateFilter({ preset }, "2026-11-09")
      expect([result.start, result.end]).toEqual(expected[preset])
    }
    expect(resolveDateFilter({ preset: "week" }, "2026-11-08").start).toBe(
      "2026-11-02"
    )
    expect(resolveDateFilter({ preset: "last3" }, "2026-03-01").start).toBe(
      "2026-02-27"
    )
  })

  it("restores the last filter after remount and advances saved relative presets", () => {
    localStorage.setItem(
      DATE_FILTER_STORAGE_KEY,
      JSON.stringify({ preset: "last7" })
    )
    const first = render(
      <SidebarNavigationProvider>
        <CurrentViewForPersistence />
      </SidebarNavigationProvider>
    )
    expect(screen.getByTestId("saved")).toHaveTextContent("last7")
    fireEvent.click(screen.getByRole("button", { name: "Choose yesterday" }))
    first.unmount()
    render(
      <SidebarNavigationProvider>
        <CurrentViewForPersistence />
      </SidebarNavigationProvider>
    )
    expect(screen.getByTestId("saved")).toHaveTextContent("yesterday")
    expect(loadDateFilter()).toEqual({ preset: "yesterday" })
  })

  it("offers custom range endpoints in the header popover and clears back to today", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SidebarNavigationProvider>
          <RecentDateFilter />
        </SidebarNavigationProvider>
      </NextIntlClientProvider>
    )
    expect(
      screen.getByRole("button", { name: "Filter by date" })
    ).toHaveTextContent("Today")
    expect(screen.queryByLabelText("Start date")).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Clear date filter" })
    ).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Filter by date" }))
    expect(screen.queryByLabelText("Start date")).toBeNull()
    expect(screen.queryByText("By last conversation update")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Custom" }))
    const now = new Date()
    const monthDay = new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
    })
    expect(screen.getByLabelText("Start date")).toHaveTextContent(
      monthDay.format(new Date(now.getFullYear(), now.getMonth(), 1))
    )
    expect(screen.getByLabelText("End date")).toHaveTextContent(
      monthDay.format(new Date(now.getFullYear(), now.getMonth() + 1, 0))
    )
    fireEvent.click(screen.getByLabelText("Start date"))
    fireEvent.change(screen.getByRole("textbox", { name: /Enter date/ }), {
      target: { value: "2026-10-01" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Apply" }))
    expect(
      screen.getByRole("button", { name: "Clear date filter" })
    ).toHaveTextContent(/^Clear$/)
    fireEvent.click(screen.getByLabelText("End date"))
    fireEvent.change(screen.getByRole("textbox", { name: /Enter date/ }), {
      target: { value: "2026-10-09" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Apply" }))
    expect(
      screen.getByRole("button", { name: "Filter by date" })
    ).toHaveTextContent(/Oct 1\s*–\s*9/)
    expect(screen.getByLabelText("Start date")).toHaveTextContent("Oct 1")
    expect(screen.getByLabelText("End date")).toHaveTextContent("Oct 9")
    fireEvent.click(screen.getByRole("button", { name: "Clear date filter" }))
    expect(
      screen.queryByRole("button", { name: "Clear date filter" })
    ).toBeNull()
    expect(screen.queryByLabelText("Start date")).toBeNull()
  })

  it("includes both selected boundary minutes through the final millisecond", () => {
    const input = [
      conversation(1, new Date(2026, 10, 1, 8, 59, 59, 999)),
      conversation(2, new Date(2026, 10, 1, 9, 0, 0)),
      conversation(3, new Date(2026, 10, 5, 0, 0, 0)),
      conversation(4, new Date(2026, 10, 10, 7, 0, 59, 999)),
      conversation(5, new Date(2026, 10, 10, 7, 1, 0)),
      conversation(6, new Date(2026, 10, 10, 23, 59, 59, 999)),
      conversation(7, new Date(2026, 10, 11)),
    ]
    expect(
      conversationsOnDate(
        input,
        "2026-11-01",
        "2026-11-10",
        "09:00:00",
        "07:00:59"
      ).map((c) => c.id)
    ).toEqual([4, 3, 2])
    expect(
      conversationsOnDate(input, "2026-11-01", "2026-11-10").map((c) => c.id)
    ).toEqual([6, 5, 4, 3, 2, 1])
  })

  it("includes both ends of a date range and retains descending activity order", () => {
    const input = [
      conversation(1, new Date(2026, 10, 8, 23, 59)),
      conversation(2, new Date(2026, 10, 9)),
      conversation(3, new Date(2026, 10, 10, 23, 59)),
      conversation(4, new Date(2026, 10, 11)),
    ]
    expect(
      conversationsOnDate(input, "2026-11-09", "2026-11-10").map((c) => c.id)
    ).toEqual([3, 2])
    expect(
      conversationsOnDate(input, "2026-11-10", "2026-11-10").map((c) => c.id)
    ).toEqual([3])
  })

  it("starts at Home and connects all five entries while preserving the chosen list view", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <WorkbenchRouteProvider>
          <SidebarNavigationProvider>
            <WorkspaceNavigationRail />
            <CurrentView />
          </SidebarNavigationProvider>
        </WorkbenchRouteProvider>
      </NextIntlClientProvider>
    )
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    const home = screen.getByRole("button", { name: "Home" })
    expect(home).not.toHaveClass("bg-sidebar-accent")
    expect(home).toHaveClass("bg-[#eaeaea]", "size-10")
    expect(home.textContent).toBe("")
    expect(home).toHaveAttribute("title", "Home")
    expect(home.querySelector("[data-navigation-active]")).toBeNull()
    for (const [name, view] of [
      ["Chats", "conversations"],
      ["Projects", "projects"],
    ]) {
      fireEvent.click(screen.getByRole("button", { name }))
      expect(screen.getByTestId("current")).toHaveTextContent(
        `conversations:${view}:`
      )
      expect(screen.getByRole("button", { name })).toHaveAttribute(
        "aria-current",
        "page"
      )
    }
    expect(screen.queryByRole("button", { name: "Recent" })).toBeNull()
    const railLabels = screen.getByRole("navigation").querySelectorAll("button")
    const names = Array.from(railLabels, (button) =>
      button.getAttribute("aria-label")
    )
    expect(names.indexOf("Tasks")).toBeLessThan(names.indexOf("Auto"))
    expect(mocks.toggle).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole("button", { name: "Auto" }))
    expect(screen.getByTestId("current")).toHaveTextContent("automations:")
    fireEvent.click(screen.getByRole("button", { name: "Tasks" }))
    expect(screen.getByTestId("current")).toHaveTextContent("tasks:")
    fireEvent.click(
      screen.getByRole("button", { name: "Open linked task conversation" })
    )
    expect(screen.getByTestId("current")).toHaveTextContent("taskConversation:")
    expect(screen.getByRole("button", { name: "Tasks" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    fireEvent.click(screen.getByRole("button", { name: "Tasks" }))
    expect(screen.getByTestId("current")).toHaveTextContent("tasks:")
    fireEvent.click(
      screen.getByRole("button", { name: "Open linked task conversation" })
    )
    fireEvent.click(screen.getByRole("button", { name: "Projects" }))
    expect(screen.getByTestId("current")).toHaveTextContent(
      "conversations:projects:"
    )
  })

  it("defaults to the local current date, permits a chosen date and follows midnight only in Today mode", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 9, 23, 59, 50))
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <WorkbenchRouteProvider>
          <SidebarNavigationProvider>
            <WorkspaceNavigationRail />
            <CurrentView />
          </SidebarNavigationProvider>
        </WorkbenchRouteProvider>
      </NextIntlClientProvider>
    )
    fireEvent.click(screen.getByRole("button", { name: "Chats" }))
    expect(screen.getByTestId("current")).toHaveTextContent(
      "conversations:2026-11-09"
    )
    act(() => vi.advanceTimersByTime(30_000))
    expect(screen.getByTestId("current")).toHaveTextContent(
      "conversations:2026-11-10"
    )
    fireEvent.click(screen.getByRole("button", { name: "Pick date" }))
    act(() => vi.advanceTimersByTime(86_400_000))
    expect(screen.getByTestId("current")).toHaveTextContent(
      "conversations:2026-10-15"
    )
    fireEvent.click(screen.getByRole("button", { name: "Chats" }))
    expect(screen.getByTestId("current")).toHaveTextContent(
      "conversations:2026-10-15"
    )
  })

  it("uses last update and local day boundaries, including old, completed and folderless history while separating pinned conversations", () => {
    const start = new Date(2026, 10, 9)
    const end = new Date(2026, 10, 10)
    const noon = new Date(2026, 10, 9, 12)
    const input = [
      conversation(1, start),
      conversation(2, noon, { status: "completed" }),
      conversation(3, new Date(end.getTime() - 1), {
        kind: "chat",
        pinned_at: noon.toISOString(),
      }),
      conversation(4, new Date(start.getTime() - 1)),
      conversation(5, end),
      // Native/imported history often has a lazy zero counter.
      conversation(6, noon, { message_count: 0 }),
      conversation(7, noon, { kind: "delegate", parent_id: 1 }),
      conversation(8, end, { created_at: noon.toISOString() }),
    ]
    expect(
      conversationsOnDate(input, localDateKey(start)).map((c) => c.id)
    ).toEqual([6, 2, 1])
    expect(input.map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it("keeps every home section and isolates date/conversation lists from project and todo trees", () => {
    const conv = conversation(1, new Date(2026, 10, 9, 12))
    const args = {
      pinned: [
        conversation(2, new Date(2026, 8, 1), {
          pinned_at: "2026-10-01T12:00:00Z",
        }),
      ],
      pinnedExpanded: true,
      orderedFolderIds: [7],
      byFolder: new Map([[7, [conv]]]),
      folderExpanded: {},
      folderTotalCounts: new Map([[7, 1]]),
      foldersExpanded: true,
      chatConversations: [],
      chatsExpanded: true,
      recentConversations: [conv],
      showRecent: true,
      showTodos: true,
    }
    const home = buildRows(args)
    expect(
      buildRows({ ...args, visibleSections: sidebarViewSections("home") })
    ).toEqual(home)
    for (const view of ["conversations"] as const) {
      const rows = buildRows({
        ...args,
        visibleSections: sidebarViewSections(view),
      })
      expect(
        rows.filter((row) => row.kind === "section").map((r) => r.section)
      ).toEqual(["pinned", "recent"])
      expect(rows.filter((row) => row.kind === "conversation")).toHaveLength(2)
    }
    const tasks = buildRows({
      ...args,
      visibleSections: sidebarViewSections("tasks"),
    })
    expect(
      tasks.filter((row) => row.kind === "section").map((row) => row.section)
    ).toEqual(["todos"])
    expect(
      tasks.some((row) => row.kind === "folder" || row.kind === "conversation")
    ).toBe(false)
    const projects = buildRows({
      ...args,
      visibleSections: sidebarViewSections("projects"),
    })
    expect(projects.some((row) => row.kind === "folder")).toBe(true)
    expect(
      projects.some((row) => row.kind === "section" && row.section === "todos")
    ).toBe(false)
  })
})

function CurrentViewForPersistence() {
  const navigation = useSidebarNavigation()!
  return (
    <>
      <output data-testid="saved">{navigation.preset}</output>
      <button onClick={() => navigation.setPreset("yesterday")}>
        Choose yesterday
      </button>
    </>
  )
}
