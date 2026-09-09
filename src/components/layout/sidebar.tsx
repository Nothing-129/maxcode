"use client"

import { SidebarNavigationIcon } from "./sidebar-navigation-icon"
import { SidebarFooter } from "./sidebar-footer"
import { SidebarWordmark } from "./sidebar-wordmark"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import {
  CheckCheck,
  Crosshair,
  Ellipsis,
  MessagesSquare,
  Menu,
  ListChevronsDownUp,
  ListChevronsUpDown,
  Search,
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
import { useIsMac } from "@/hooks/use-is-mac"
import { usePlatform } from "@/hooks/use-platform"
import { useZoomLevel } from "@/hooks/use-appearance"
import { useShortcutSettings } from "@/hooks/use-shortcut-settings"
import { formatShortcutLabel } from "@/lib/keyboard-shortcuts"
import { isNativeDesktop } from "@/lib/platform"
import { leftChromeReserve } from "@/lib/window-chrome"
import {
  isNavItemVisible,
  loadNavItemVisibility,
  loadShowCompleted,
  loadShowRecent,
  loadShowWorktrees,
  loadSortMode,
  loadSectionOrder,
  moveSectionInOrder,
  saveNavItemVisibility,
  saveShowCompleted,
  saveShowRecent,
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
import { useSearchDialog } from "@/contexts/search-dialog-context"

const NO_HIDDEN_SECTIONS: ReadonlySet<SidebarSectionId> = new Set()
const RECENT_HIDDEN: ReadonlySet<SidebarSectionId> = new Set(["recent"])

// Keyboard-shortcut hint at the trailing edge of the New chat row.
// Mirrors the folder count badge exactly — same chip (0.9375rem height,
// 0.3125rem radius, bg-primary/10, text-primary, 0.625rem text) per the request
// to match it. That pairing is also solidly legible (text-primary on
// primary/10 ≈ 14:1 light / 11:1 dark), unlike the muted-on-muted kbd it
// replaces (4.34:1). Revealed only on hover / keyboard focus of its row (each
// row is a `group`); font-mono renders the shortcut glyphs cleanly.
const SHORTCUT_BADGE_CLASS = cn(
  "ml-auto inline-flex h-[0.9375rem] shrink-0 items-center justify-center",
  "rounded-[0.3125rem] bg-primary/10 px-[0.25rem]",
  "font-mono text-[0.625rem] font-medium leading-none text-primary",
  "opacity-0 transition-opacity duration-150",
  "group-hover:opacity-100 group-focus-visible:opacity-100"
)

/**
 * A fixed top-of-sidebar action / route row. `active` marks the row as the
 * current workbench route (selected styling); `trailing` carries a shortcut hint
 * or a count badge. Extracting this keeps every fixed nav item — and any future
 * route — on one geometry instead of copy-pasting the className. Each row is a
 * `group` so a `group-hover`-revealed trailing element works.
 */
function SidebarNavButton({
  icon,
  label,
  onClick,
  active,
  trailing,
}: {
  icon: "compose" | "clock"
  label: string
  onClick: () => void
  active?: boolean
  trailing?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        // Match navigation and history rows with a quiet, rounded rectangle.
        "group flex h-7 w-full items-center gap-2.5 rounded-lg pl-2.5 pr-2.5",
        "text-[0.875rem] leading-5 text-sidebar-foreground outline-none",
        "transition-colors duration-150 hover:bg-sidebar-accent",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        active && "bg-sidebar-primary/8"
      )}
    >
      <SidebarNavigationIcon
        name={icon}
        className="size-4 shrink-0 text-sidebar-foreground/75"
      />
      <span className="truncate">{label}</span>
      {trailing}
    </button>
  )
}

export function Sidebar() {
  const t = useTranslations("Folder.sidebar")
  const tTitleBar = useTranslations("Folder.folderTitleBar")
  const { setOpen: setSearchOpen } = useSearchDialog()
  const { isOpen, toggle } = useSidebarContext()
  const { activeFolder } = useActiveFolder()
  const { openNewConversationTab, openChatModeTab } = useTabActions()
  const { unseenFailures } = useAutomationsView()
  const { routeId, setRoute, openConversations } = useWorkbenchRoute()
  const isMac = useIsMac()
  const { isMac: platformIsMac } = usePlatform()
  const { zoomLevel } = useZoomLevel()
  const { shortcuts } = useShortcutSettings()
  const isMobile = useIsMobile()
  // Touch devices must also collapse the sidebar after navigating AWAY from it
  // when they land in the desktop shell — a phone in landscape, a foldable, or
  // "request desktop site" reports ≥768px so the sidebar renders inline instead
  // of as a Sheet, and its 320px still crowds a phone-width viewport.
  const isCoarsePointer = useIsCoarsePointer()
  const collapseOnNavigate = isMobile || isCoarsePointer
  const listRef = useRef<SidebarConversationListHandle>(null)
  // On desktop the header's top-left is owned by the fixed window-chrome overlay
  // (sidebar toggle + remote); reserve exactly its width so the view controls
  // and drag region clear it. The reserve scales with the app zoom to track the
  // rem-sized overlay buttons. Mobile has no overlay (the sidebar is a Drawer).
  const leftReserve = leftChromeReserve(
    platformIsMac && isNativeDesktop(),
    zoomLevel
  )

  // `showCompleted` defaults OFF; `showWorktrees` and `showRecent` default ON
  // (the mount effect below reconciles a persisted override). Each initial
  // value matches its own default so the pre-hydration render doesn't flash as
  // the stored preference is applied.
  const { showStatus, allowActions, setShowStatus, setAllowActions } =
    useConversationStatusPrefs()
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
  const newConversationShortcutLabel = formatShortcutLabel(
    shortcuts.new_conversation,
    isMac
  )
  const toggleExpandLabel = allExpanded
    ? t("collapseAllGroups")
    : t("expandAllGroups")

  const viewOptionsLabel = t("viewOptions")
  const hiddenSections = showRecent ? NO_HIDDEN_SECTIONS : RECENT_HIDDEN

  useEffect(() => {
    // Hydrate from localStorage after mount to keep SSR/CSR markup consistent.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowCompleted(loadShowCompleted())
    setShowWorktrees(loadShowWorktrees())
    setShowRecent(loadShowRecent())
    setNavItems(loadNavItemVisibility())
    setSortMode(loadSortMode())
    setSectionOrder(loadSectionOrder())
  }, [])

  const handleSetShowCompleted = useCallback((value: boolean) => {
    setShowCompleted(value)
    saveShowCompleted(value)
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

  if (!isOpen) return null

  const sidebarTools = (
    <div className="flex items-center gap-0.5" data-sidebar-tools>
      <Button
        variant="ghost"
        size="icon"
        className={cn("text-muted-foreground", isMobile ? "size-11" : "size-7")}
        title={tTitleBar("search")}
        aria-label={tTitleBar("search")}
        onClick={() => {
          if (isMobile) toggle()
          setSearchOpen(true)
        }}
      >
        <Search className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn("text-muted-foreground", isMobile ? "size-11" : "size-7")}
        onClick={() => listRef.current?.scrollToActive()}
        title={t("locateActiveConversation")}
        aria-label={t("locateActiveConversation")}
      >
        <Crosshair aria-hidden="true" className="size-4" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "text-muted-foreground",
              isMobile ? "size-11" : "size-7"
            )}
            title={viewOptionsLabel}
            aria-label={viewOptionsLabel}
          >
            <Ellipsis aria-hidden="true" className="size-4" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuItem
            onSelect={() => useConversationUnreadStore.getState().markAllRead()}
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
                checked={showStatus}
                onCheckedChange={(value) => {
                  setShowStatus(value).catch(announcePrefsSaveFailure)
                }}
                onSelect={(event) => event.preventDefault()}
              >
                {t("showStatus")}
              </DropdownMenuCheckboxItem>
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
            </DropdownMenuSubContent>
          </DropdownMenuSub>
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
            </DropdownMenuSubContent>
          </DropdownMenuSub>
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
    </div>
  )

  return (
    <aside className="@container/sidebar flex h-full min-h-0 flex-col overflow-hidden text-sidebar-foreground select-none">
      <div
        className={cn(
          "flex shrink-0 items-center gap-2 pr-2",
          // Desktop: the fixed left window-chrome overlay (reserved below) owns
          // the top-left, so drop the header's own left padding. ChatGPT 桌面端
          // 侧栏头部没有任何分隔线（内容直接从窗口交通灯下方开始），故 desktop
          // 分支不再挂边框。Mobile keeps title and tools in one compact row.
          isMobile ? "h-14 pl-4" : "h-10 pl-0"
        )}
      >
        {isMobile ? (
          <div className="flex min-w-0 items-center gap-4">
            <h2 className="truncate text-[0.875rem] font-bold tracking-[-0.00625rem] text-sidebar-foreground">
              {t("title")}
            </h2>
          </div>
        ) : (
          // Reserve exactly the fixed left overlay's width so the view controls
          // clear it; the empty reserved space is a window-drag region.
          <div
            data-tauri-drag-region
            className="h-full shrink-0"
            style={{ width: leftReserve }}
          />
        )}
        {/* Draggable filler between the two clusters — the header is the
            window's top edge, so its empty space must move the window. */}
        <div data-tauri-drag-region className="h-full min-w-0 flex-1" />
        {isMobile && sidebarTools}
      </div>

      {/* Fixed actions above the scrollable list. `shrink-0` keeps them pinned —
          they never scroll with the conversation list. Rows are `rounded-full`
          like the conversation pills, and the icon/text geometry matches the
          folder header: a 0.875rem icon + 0.875rem label at a 0.4375rem gap, with
          the row's pl-[0.4375rem] (atop the container's px-1.5) placing the icon
          center on the same 0.875rem rail axis as the folder/conversation icons in
          the list below. Each row is a `group` so its shortcut hint reveals on
          hover / keyboard focus. */}
      <div className="flex shrink-0 flex-col gap-0.5 px-1.5 pt-1.5">
        {!isMobile && (
          <div className="mb-3 flex h-8 items-center justify-between px-2 text-base font-semibold text-sidebar-foreground">
            <SidebarWordmark />
            {sidebarTools}
          </div>
        )}
        <SidebarNavButton
          icon="compose"
          label={t("newChat")}
          onClick={handleNewConversation}
          trailing={
            newConversationShortcutLabel ? (
              <kbd className={SHORTCUT_BADGE_CLASS}>
                {newConversationShortcutLabel}
              </kbd>
            ) : null
          }
        />
        {/* Search shares the sidebar tools on both desktop and mobile; ⌘K works globally. */}
        {/* Automations respects the saved visibility preference and closes the
            sidebar after navigation on touch layouts. */}
        {isNavItemVisible(navItems, "automations") && (
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
                <span className="ml-auto inline-flex h-[0.9375rem] min-w-[0.9375rem] shrink-0 items-center justify-center rounded-full bg-destructive/15 px-1 font-mono text-[0.625rem] font-medium leading-none text-destructive">
                  {unseenFailures}
                </span>
              ) : null
            }
          />
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
          ref={listRef}
          showCompleted={showCompleted}
          showWorktrees={showWorktrees}
          showRecent={showRecent}
          sortMode={sortMode}
          sectionOrder={sectionOrder}
          onNavigate={collapseOnNavigate ? toggle : undefined}
        />
      </div>
      <SidebarFooter />
    </aside>
  )
}
