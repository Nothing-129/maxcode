"use client"

import { openSettingsWindow } from "@/lib/api"

import { subscribeWorkspacePreferences } from "@/lib/workspace-preferences-store"

import {
  DesktopChromeIcon,
  desktopChromeButtonClassName,
} from "./desktop-chrome-icon"
import { SidebarNavigationIcon } from "./sidebar-navigation-icon"
import { SidebarFooter } from "./sidebar-footer"
import { SidebarWordmark } from "./sidebar-wordmark"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import {
  CheckCheck,
  MessagesSquare,
  Menu,
  ListChevronsDownUp,
  ListChevronsUpDown,
  ListTodo,
  Zap,
} from "lucide-react"
import { toast } from "sonner"
import { useConversationUnreadStore } from "@/stores/conversation-unread-store"
import { useConversationStatusPrefs } from "@/lib/conversation-status-prefs"
import { toErrorMessage } from "@/lib/app-error"
import { SidebarSectionOrderControl } from "./sidebar-section-order-control"
import { useTranslations } from "next-intl"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { useSidebarContext } from "@/contexts/sidebar-context"
import { useTabActions } from "@/contexts/tab-context"
import { useAutomationsView } from "@/contexts/automations-view-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import {
  SidebarConversationList,
  type SidebarConversationListHandle,
} from "@/components/conversations/sidebar-conversation-list"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useIsMobile } from "@/hooks/use-mobile"
import { useIsCoarsePointer } from "@/hooks/use-is-coarse-pointer"
import { usePlatform } from "@/hooks/use-platform"
import { isNativeDesktop } from "@/lib/platform"
import { MAC_TRAFFIC_LIGHT_INSET } from "@/lib/window-chrome"
import {
  isNavItemVisible,
  loadNavItemVisibility,
  loadShowCompleted,
  loadShowRecent,
  loadShowTodos,
  loadShowWorktrees,
  loadSortMode,
  loadSectionOrder,
  moveSectionInOrder,
  saveNavItemVisibility,
  saveShowCompleted,
  saveShowRecent,
  saveShowTodos,
  saveShowWorktrees,
  saveSortMode,
  saveSectionOrder,
  type SidebarNavItemId,
  type SidebarSectionId,
  DEFAULT_SIDEBAR_SORT_MODE,
  DEFAULT_SECTION_ORDER,
  type SidebarNavItemVisibility,
  type SidebarSortMode,
  type SidebarSectionOrder,
} from "@/lib/sidebar-view-mode-storage"
import { cn } from "@/lib/utils"
import { useSidebarNavigation } from "@/contexts/sidebar-navigation-context"
import { RecentDateFilter } from "./recent-date-filter"
import { useSearchDialog } from "@/contexts/search-dialog-context"

/** Compact action button shared by the fixed sidebar navigation. */
function SidebarNavButton({
  icon,
  label,
  onClick,
  active,
  trailing,
  variant = "filled",
  conversationSurface = false,
}: {
  icon: "compose" | "clock" | "tasks"
  label: string
  onClick: () => void
  active?: boolean
  trailing?: ReactNode
  variant?: "filled" | "ghost"
  conversationSurface?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        // Equal-width buttons keep the three actions on a single compact row.
        "group relative flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg bg-sidebar-accent/35 px-0.5",
        "text-[0.875rem] leading-5 text-sidebar-foreground outline-none",
        "transition-colors duration-150 hover:bg-sidebar-accent",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        conversationSurface && "bg-black/[0.07] dark:bg-white/[0.1]",
        variant === "ghost" && "bg-transparent",
        active && "bg-sidebar-primary/10"
      )}
    >
      <SidebarNavigationIcon
        name={icon}
        className="size-3.5 shrink-0 text-sidebar-foreground/75"
      />
      <span className="truncate">{label}</span>
      {trailing}
    </button>
  )
}

export function Sidebar({
  keepVisible = false,
}: { keepVisible?: boolean } = {}) {
  const t = useTranslations("Folder.sidebar")
  const navigation = useSidebarNavigation()
  const navigationView = navigation?.view ?? "home"
  const tTitleBar = useTranslations("Folder.folderTitleBar")
  const { setOpen: setSearchOpen } = useSearchDialog()
  const { isOpen, toggle } = useSidebarContext()
  const { activeFolder } = useActiveFolder()
  const { openNewConversationTab, openChatModeTab } = useTabActions()
  const { unseenFailures } = useAutomationsView()
  const { routeId, setRoute, openConversations } = useWorkbenchRoute()
  const view =
    (routeId === "tasks" || routeId === "taskConversation") && navigation
      ? "tasks"
      : navigationView
  const { isMac: platformIsMac } = usePlatform()
  const isMobile = useIsMobile()
  const compactHeader = isMobile || !isNativeDesktop()
  // Touch devices must also collapse the sidebar after navigating AWAY from it
  // when they land in the desktop shell — a phone in landscape, a foldable, or
  // "request desktop site" reports ≥768px so the sidebar renders inline instead
  // of as a Sheet, and its 320px still crowds a phone-width viewport.
  const isCoarsePointer = useIsCoarsePointer()
  const collapseOnNavigate = isMobile || isCoarsePointer
  const listRef = useRef<SidebarConversationListHandle>(null)
  // Only native macOS traffic lights need clearance inside the sidebar.
  const leftReserve =
    platformIsMac && isNativeDesktop() ? MAC_TRAFFIC_LIGHT_INSET : 0

  // `showCompleted` defaults OFF; `showWorktrees` and `showRecent` default ON
  // (the mount effect below reconciles a persisted override). Each initial
  // value matches its own default so the pre-hydration render doesn't flash as
  // the stored preference is applied.
  const { allowActions, setAllowActions } = useConversationStatusPrefs()
  // 会话状态开关异步持久化到后端；失败时乐观值已回滚，这里补一个 toast。
  const announcePrefsSaveFailure = useCallback(
    (err: unknown) => {
      toast.error(t("prefsSaveFailed", { message: toErrorMessage(err) }))
    },
    [t]
  )
  const [showCompleted, setShowCompleted] = useState(false)
  const [showWorktrees, setShowWorktrees] = useState(true)
  const [showRecent, setShowRecent] = useState(true)
  const [showTodos, setShowTodos] = useState(true)
  // Empty = every nav row shown, which is also the hydrated default — so the
  // pre-hydration render matches for a user who never hid one.
  const [navItems, setNavItems] = useState<SidebarNavItemVisibility>({})
  const [sortMode, setSortMode] = useState<SidebarSortMode>(
    DEFAULT_SIDEBAR_SORT_MODE
  )
  const [sectionOrder, setSectionOrder] = useState<SidebarSectionOrder>(
    DEFAULT_SECTION_ORDER
  )
  const [allExpanded, setAllExpanded] = useState(true)
  const toggleExpandLabel = allExpanded
    ? t("collapseAllGroups")
    : t("expandAllGroups")

  const viewOptionsLabel = t("viewOptions")
  const hiddenSections = new Set<SidebarSectionId>([
    ...(!showRecent ? (["recent"] as const) : []),
    ...(!showTodos ? (["todos"] as const) : []),
  ])

  useEffect(() => {
    const restore = () => {
      // Host preferences hydrate asynchronously and update across clients.
      setShowCompleted(loadShowCompleted())
      setShowWorktrees(loadShowWorktrees())
      setShowRecent(loadShowRecent())
      setShowTodos(loadShowTodos())
      setNavItems(loadNavItemVisibility())
      setSortMode(loadSortMode())
      setSectionOrder(loadSectionOrder())
    }
    return subscribeWorkspacePreferences(restore)
  }, [])

  const handleSetShowCompleted = useCallback((value: boolean) => {
    setShowCompleted(value)
    saveShowCompleted(value)
  }, [])

  const handleSetShowTodos = useCallback((value: boolean) => {
    setShowTodos(value)
    saveShowTodos(value)
  }, [])

  const handleSetShowWorktrees = useCallback((value: boolean) => {
    setShowWorktrees(value)
    saveShowWorktrees(value)
  }, [])

  const handleSetShowRecent = useCallback((value: boolean) => {
    setShowRecent(value)
    saveShowRecent(value)
  }, [])

  const handleSetNavItem = useCallback(
    (id: SidebarNavItemId, visible: boolean) => {
      setNavItems((prev) => {
        const next = { ...prev, [id]: visible }
        saveNavItemVisibility(next)
        return next
      })
    },
    []
  )

  const handleSetSortMode = useCallback((value: string) => {
    const mode: SidebarSortMode = value === "updated" ? "updated" : "created"
    setSortMode(mode)
    saveSortMode(mode)
  }, [])

  // Nudge one section up/down a slot. `moveSectionInOrder` returns the SAME
  // array when the move would fall off an end, so a clamped nudge neither
  // re-renders the list nor rewrites localStorage.
  const handleMoveSection = useCallback(
    (id: SidebarSectionId, delta: number) => {
      setSectionOrder((prev) => {
        const next = moveSectionInOrder(prev, id, delta)
        if (next !== prev) saveSectionOrder(next)
        return next
      })
    },
    []
  )

  const handleToggleExpandAll = useCallback(() => {
    if (allExpanded) {
      listRef.current?.collapseAll()
      setAllExpanded(false)
    } else {
      listRef.current?.expandAll()
      setAllExpanded(true)
    }
  }, [allExpanded])

  const handleNewConversation = useCallback(() => {
    // On mobile the sidebar is a Drawer overlay — close it so the new
    // conversation is visible (mirrors tapping a conversation card, which the
    // list wrapper already closes on). Touch devices in the desktop shell
    // (landscape phone ≥768px) need the same, per `collapseOnNavigate`.
    if (collapseOnNavigate) toggle()
    // Starting a conversation always returns to the conversation workspace (in
    // case a route like Automations was taking over the content region).
    openConversations()
    // Defense-in-depth: with no active folder (e.g. a cold start that recovered
    // to nothing, or all folders closed) fall back to folderless chat mode
    // rather than no-op, so this entry point is never a dead end.
    if (!activeFolder) {
      openChatModeTab()
      return
    }
    openNewConversationTab(activeFolder.id, activeFolder.path)
  }, [
    activeFolder,
    openChatModeTab,
    openNewConversationTab,
    openConversations,
    collapseOnNavigate,
    toggle,
  ])

  if (!isOpen && !keepVisible) return null

  const sidebarTools = (
    <div className="flex items-center gap-0.5" data-sidebar-tools>
      {!isMobile && (
        <Button
          variant="ghost"
          size="icon"
          className={desktopChromeButtonClassName}
          aria-label={tTitleBar("hideSidebar")}
          title={tTitleBar("hideSidebar")}
          onClick={toggle}
        >
          <DesktopChromeIcon name="sidebar" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className={cn(desktopChromeButtonClassName, isMobile && "size-11")}
        title={tTitleBar("search")}
        aria-label={tTitleBar("search")}
        onClick={() => {
          if (isMobile) toggle()
          setSearchOpen(true)
        }}
      >
        <DesktopChromeIcon name="search" />
      </Button>
      {isMobile && !navigation && (
        <Button
          variant="ghost"
          size="icon"
          className={cn(desktopChromeButtonClassName, isMobile && "size-11")}
          title={tTitleBar("openSettings")}
          aria-label={tTitleBar("openSettings")}
          onClick={() => {
            void openSettingsWindow().catch(console.error)
          }}
        >
          <DesktopChromeIcon name="settings" />
        </Button>
      )}
      {/* Keep sidebar controls clickable while the view options are open. */}
      {view === "home" && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                desktopChromeButtonClassName,
                isMobile && "size-11"
              )}
              title={viewOptionsLabel}
              aria-label={viewOptionsLabel}
            >
              <DesktopChromeIcon name="more" />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuItem
              onSelect={() => listRef.current?.scrollToActive()}
            >
              <DesktopChromeIcon name="locate" className="size-4" />
              {t("locateActiveConversation")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                useConversationUnreadStore.getState().markAllRead()
              }
            >
              <CheckCheck className="size-4" />
              {t("markAllRead")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{viewOptionsLabel}</DropdownMenuLabel>

            <>
              <DropdownMenuItem onSelect={handleToggleExpandAll}>
                {allExpanded ? (
                  <ListChevronsDownUp className="h-4 w-4" />
                ) : (
                  <ListChevronsUpDown className="h-4 w-4" />
                )}
                {toggleExpandLabel}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <MessagesSquare className="text-muted-foreground" />
                {t("listOptions")}
              </DropdownMenuSubTrigger>

              <DropdownMenuSubContent>
                <DropdownMenuCheckboxItem
                  checked={allowActions}
                  onCheckedChange={(value) => {
                    setAllowActions(value).catch(announcePrefsSaveFailure)
                  }}
                  onSelect={(event) => event.preventDefault()}
                >
                  {t("allowStatusActions")}
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={showCompleted}
                  onCheckedChange={handleSetShowCompleted}
                  onSelect={(event) => event.preventDefault()}
                >
                  {t("showCompleted")}
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={showWorktrees}
                  onCheckedChange={handleSetShowWorktrees}
                  onSelect={(event) => event.preventDefault()}
                >
                  {t("showWorktrees")}
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={showRecent}
                  onCheckedChange={handleSetShowRecent}
                  onSelect={(event) => event.preventDefault()}
                >
                  {t("showRecent")}
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={showTodos}
                  onCheckedChange={handleSetShowTodos}
                  onSelect={(event) => event.preventDefault()}
                >
                  {t("showTodos")}
                </DropdownMenuCheckboxItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {isMobile && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Menu className="text-muted-foreground" />
                  {t("navigationItems")}
                </DropdownMenuSubTrigger>

                <DropdownMenuSubContent>
                  <DropdownMenuCheckboxItem
                    checked={isNavItemVisible(navItems, "automations")}
                    onCheckedChange={(value) =>
                      handleSetNavItem("automations", value)
                    }
                    onSelect={(event) => event.preventDefault()}
                  >
                    <Zap className="text-muted-foreground" />
                    {t("automations")}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={isNavItemVisible(navItems, "tasks")}
                    onCheckedChange={(value) =>
                      handleSetNavItem("tasks", value)
                    }
                    onSelect={(event) => event.preventDefault()}
                  >
                    <ListTodo className="text-muted-foreground" />
                    {t("tasks")}
                  </DropdownMenuCheckboxItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("sortBy")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={sortMode}
              onValueChange={handleSetSortMode}
            >
              <DropdownMenuRadioItem
                value="created"
                onSelect={(event) => event.preventDefault()}
              >
                {t("sortByCreatedAt")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="updated"
                onSelect={(event) => event.preventDefault()}
              >
                {t("sortByUpdatedAt")}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("sectionOrder")}</DropdownMenuLabel>
            <SidebarSectionOrderControl
              order={sectionOrder}
              onMove={handleMoveSection}
              hiddenSections={hiddenSections}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )

  return (
    <aside className="@container/sidebar flex h-full min-h-0 flex-col overflow-hidden text-sidebar-foreground select-none">
      <div
        className={cn(
          "flex shrink-0 items-center gap-2 pr-2",
          // Keep desktop tools aligned with the conversation header.
          compactHeader ? "h-14 pl-4" : "h-12 pl-0"
        )}
      >
        {!compactHeader && (
          // Leave native traffic lights clear and keep this area draggable.
          <div
            data-drag-region
            className="h-full shrink-0"
            style={{ width: leftReserve }}
          />
        )}
        {compactHeader ? (
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            <SidebarWordmark compact />
            {view === "conversations" && <RecentDateFilter />}
          </div>
        ) : (
          // Push desktop tools right and keep empty space draggable.
          <div data-drag-region className="h-full min-w-0 flex-1" />
        )}
        {sidebarTools}
      </div>

      {/* Fixed action buttons stay above the scrollable conversation list. */}
      <div className="flex shrink-0 flex-col gap-0.5 px-1.5 pt-1.5">
        {!compactHeader && (
          <div className="mb-3 flex h-8 items-center justify-between gap-2 px-2 text-base font-semibold text-sidebar-foreground">
            <span className="min-w-0 truncate">
              <SidebarWordmark />
            </span>
            {view === "conversations" && <RecentDateFilter />}
          </div>
        )}
        {view === "tasks" && (
          <SidebarNavButton
            icon="tasks"
            variant="ghost"
            label={t("navigation.todoBoard")}
            onClick={() => setRoute("tasks")}
          />
        )}
        {view !== "tasks" && (
          <div data-sidebar-actions className="flex items-center gap-1">
            <SidebarNavButton
              icon="compose"
              conversationSurface={!isMobile}
              label={t("newChat")}
              onClick={handleNewConversation}
            />
            {/* Search shares the sidebar tools on both desktop and mobile; ⌘K works globally. */}
            {/* Route navigation respects the saved visibility preference and closes the
              sidebar after navigation on touch layouts. */}
            {isMobile &&
              !navigation &&
              view === "home" &&
              isNavItemVisible(navItems, "automations") && (
                <SidebarNavButton
                  icon="clock"
                  label={t("automations")}
                  active={routeId === "automations"}
                  onClick={() => {
                    if (collapseOnNavigate) toggle()
                    setRoute("automations")
                  }}
                  trailing={
                    unseenFailures > 0 ? (
                      <span className="absolute -right-1 -top-1 inline-flex h-[0.9375rem] min-w-[0.9375rem] shrink-0 items-center justify-center rounded-full bg-destructive/15 px-1 font-mono text-[0.625rem] font-medium leading-none text-destructive">
                        {unseenFailures}
                      </span>
                    ) : null
                  }
                />
              )}
            {isMobile &&
              !navigation &&
              view === "home" &&
              isNavItemVisible(navItems, "tasks") && (
                <SidebarNavButton
                  icon="tasks"
                  label={t("tasks")}
                  active={routeId === "tasks"}
                  onClick={() => {
                    if (collapseOnNavigate) toggle()
                    setRoute("tasks")
                  }}
                />
              )}
          </div>
        )}
      </div>

      {/* On touch layouts, clicking a conversation card auto-closes the sidebar
          (mobile Drawer, or a coarse-pointer device in the desktop shell). */}
      <div
        className="flex flex-col flex-1 min-h-0 overflow-hidden pt-1.5"
        onClick={
          collapseOnNavigate
            ? (e) => {
                const target = e.target as HTMLElement
                if (target.closest("[data-conversation-id]")) {
                  toggle()
                }
              }
            : undefined
        }
      >
        <SidebarConversationList
          key={`${view}:${view === "conversations" ? `${navigation?.date}:${navigation?.endDate}` : ""}`}
          view={view}
          activityDate={view === "conversations" ? navigation?.date : undefined}
          activityEndDate={
            view === "conversations" ? navigation?.endDate : undefined
          }
          ref={listRef}
          showCompleted={showCompleted}
          showWorktrees={showWorktrees}
          showRecent={view === "home" ? showRecent : view !== "projects"}
          showTodos={view === "tasks" || (view === "home" && showTodos)}
          sortMode={view === "conversations" ? "updated" : sortMode}
          sectionOrder={sectionOrder}
          onNavigate={collapseOnNavigate ? toggle : undefined}
        />
      </div>
      {isMobile && !navigation && <SidebarFooter />}
    </aside>
  )
}
