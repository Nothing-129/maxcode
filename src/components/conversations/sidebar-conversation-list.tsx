"use client"

import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react"
import { useTranslations } from "next-intl"
import { useTheme } from "next-themes"
import { toast } from "sonner"
import { Virtualizer, type VirtualizerHandle } from "virtua"
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUp,
  Download,
  ExternalLink,
  FolderClosed,
  FolderGit2,
  FolderOpen,
  FolderOpenDot,
  FolderRoot,
  GripVertical,
  Layers,
  LayersPlus,
  Link2,
  ListChecks,
  Loader2,
  MonitorCloud,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Palette,
  Rocket,
  Settings,
  SquarePen,
  Tag,
  XCircle,
} from "lucide-react"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { useConversationUnreadStore } from "@/stores/conversation-unread-store"
import { useTabActions, useTabStore } from "@/contexts/tab-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { useTerminalContext } from "@/contexts/terminal-context"
import { useThemeColor, useZoomLevel } from "@/hooks/use-appearance"
import { useSortedAvailableAgents } from "@/hooks/use-sorted-available-agents"
import { useImeGuard } from "@/hooks/use-ime-guard"
import { OpenInSubContent } from "@/components/layout/open-in-menu"
import {
  openImportSessionsWindow,
  openInCode,
  openProjectBootWindow,
  updateConversationTitle,
  updateConversationStatus,
  updateConversationPinned,
  updateFolderColor,
  updateFolderAlias,
  updateFolderDefaultAgent,
  deleteConversation,
  listChildConversations,
} from "@/lib/api"
import { isDesktop, revealItemInDir } from "@/lib/platform"
import type {
  AgentType,
  ConversationStatus,
  DbConversationSummary,
  FolderDetail,
  FolderGroupDetail,
} from "@/lib/types"
import { getAgentLabel } from "@/lib/custom-agents"
import {
  loadFolderExpanded,
  saveFolderExpanded,
  loadFolderGroupExpanded,
  saveFolderGroupExpanded,
  loadSectionCollapsed,
  saveSectionCollapsed,
  loadConversationExpanded,
  saveConversationExpanded,
  DEFAULT_SIDEBAR_SORT_MODE,
  DEFAULT_SECTION_ORDER,
  SIDEBAR_SECTION_KEYS,
  type SidebarSectionCollapsed,
  type SidebarSectionKey,
  type SidebarSortMode,
  type SidebarSectionOrder,
} from "@/lib/sidebar-view-mode-storage"
import {
  FOLDER_THEME_COLOR_INHERIT,
  THEME_COLOR_PREVIEW,
  THEME_COLORS,
  folderTitleTintVars,
  normalizeFolderThemeColor,
  type FolderThemeColor,
  type ThemeColor,
} from "@/lib/theme-presets"
import {
  SidebarConversationCard,
  SubsessionAncestorRails,
  CONV_RAIL_DEPTH_STEP,
} from "./sidebar-conversation-card"
import {
  applyLayoutMove,
  buildDragSlots,
  buildOwnerHeaderIndex,
  buildRows,
  buildSidebarLayout,
  EMPTY_SIDEBAR_LAYOUT,
  layoutFolderIds,
  layoutToEntries,
  locateEntry,
  reconcileLayout,
  computeStickyState,
  flatIndexOfConversation,
  folderHeaderFlatIndices,
  formatRelative,
  groupByFolderWithReuse,
  headerIndexForFolder,
  mergeChildrenById,
  nextHeaderAfter,
  pointerYToTargetIndex,
  RECENT_PAGE_SIZE,
  reuseSelected,
  reuseSet,
  selectChatConversationsWithReuse,
  selectPinnedWithReuse,
  selectRecentConversationsWithReuse,
  worktreeChildrenByParent,
  worktreeHeaderAlias,
  type DragSlot,
  type SidebarEntry,
  type SidebarLayout,
  type SidebarRow,
} from "./sidebar-conversation-grouping"
import { useRemoteWorkspaceConnections } from "@/hooks/use-remote-workspace-connections"
import { useSubsessionSync } from "@/hooks/use-subsession-sync"
import { SidebarSectionHeader } from "./sidebar-section-header"
import { SidebarFolderGroupHeader } from "./sidebar-folder-group-header"
import { ConversationManageDialog } from "./conversation-manage-dialog"
import { CloneDialog } from "@/components/layout/clone-dialog"
import { RemoteWorkspaceManageDialog } from "@/components/layout/remote-workspace-manage-dialog"
import { WorkspaceFolderDialog } from "@/components/layout/workspace-folder-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"
import { FolderAliasLabel } from "./folder-alias-label"
import { toErrorMessage } from "@/lib/app-error"

// Layout effect on the client (so the sticky overlay is positioned before
// paint) but a no-op-safe passive effect during the static-export prerender.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect

// Shared empty merge map used when "Show worktrees" is on: worktree children
// then keep their own conversation bucket / count / theme instead of being
// folded into the parent. A module constant so the reference is stable across
// renders (the `byFolder` / `folderTotalCounts` memos depend on it).
const EMPTY_CHILD_TO_PARENT: ReadonlyMap<number, number> = new Map()

// Shared empty container map used when "Show worktrees" is off: no repo is a
// worktree container, so every folder renders flat. Stable reference so the
// `containerChildren` memo (and buildRows through it) doesn't churn.
const EMPTY_CONTAINER_CHILDREN: ReadonlyMap<number, readonly number[]> =
  new Map()

// How many conversations a folder body shows before its "show more" row, and
// how many each click adds. Codex-style paging so a busy folder does not
// bury every sibling below it; per-folder so expanding one does not page
// the others.
const FOLDER_PAGE_SIZE = 10

// Chat-mode conversations are folderless in the UI but can grow just as large
// as a folder history, so use the same page size and incremental reveal.
const CHAT_PAGE_SIZE = FOLDER_PAGE_SIZE

// Trackpad taps on WebKit report as pointerType "mouse", fire pointerdown,
// then synthesize a delayed `click` after this header remounts (virtua
// recycle / overlay flip). A per-instance ref dies with that remount, so the
// leftover click would toggle the folder a second time. Module-level so it
// outlives the node.
let lastPointerToggleFolderId = Number.NaN
let lastPointerToggleAt = 0
const POINTER_TOGGLE_GUARD_MS = 400
const recentPointerNewConversations = new Map<number, number>()

function rememberPointerToggle(folderId: number) {
  lastPointerToggleFolderId = folderId
  lastPointerToggleAt = Date.now()
}

function wasRecentPointerToggle(folderId: number) {
  return (
    folderId === lastPointerToggleFolderId &&
    Date.now() - lastPointerToggleAt < POINTER_TOGGLE_GUARD_MS
  )
}

function rememberPointerNewConversation(folderId: number) {
  recentPointerNewConversations.set(folderId, Date.now())
}

function consumeRecentPointerNewConversation(folderId: number) {
  const activatedAt = recentPointerNewConversations.get(folderId)
  if (activatedAt === undefined) return false
  recentPointerNewConversations.delete(folderId)
  return Date.now() - activatedAt < POINTER_TOGGLE_GUARD_MS
}

/** Test-only: fake timers reuse one `Date.now()`, so a leftover guard would
 *  swallow the next test's `click`. */
export function resetFolderPointerToggleGuardForTests() {
  lastPointerToggleFolderId = Number.NaN
  lastPointerToggleAt = 0
  recentPointerNewConversations.clear()
}
const FolderHeader = memo(function FolderHeader({
  folderId,
  folderName,
  folderAlias,
  folderPath,
  runningCount,
  expanded,
  themeColor,
  appThemeColor,
  currentDefaultAgent,
  availableAgents,
  availableAgentsFresh,
  onToggle,
  onRemoveFromWorkspace,
  onNewConversation,
  onOpenInSplit,
  onImport,
  onManageConversations,
  onManageLinks,
  onChangeColor,
  onSetAlias,
  onSetDefaultAgent,
  onOpenInSystemExplorer,
  onOpenInTerminal,
  onOpenInCode,
  folderGroups,
  currentGroupId,
  onMoveToGroup,
  onNewGroupWithFolder,
  isDragging = false,
  onGripPointerDown,
  suppressed = false,
  depth = 0,
  variant = "repo",
  worktreeBranch = null,
  rootBranch = null,
}: {
  folderId: number
  folderName: string
  /** User-set alias, or null. When present the header shows `alias [name]`. */
  folderAlias: string | null
  folderPath: string
  /**
   * How many of this group's sessions are currently RUNNING (`in_progress`) —
   * not how many it holds. Zero renders no badge at all: the header's job is to
   * flag live activity you'd otherwise have to expand the folder to notice, and
   * a total-count chip on every row was noise (expanding shows the rows).
   */
  runningCount: number
  expanded: boolean
  themeColor: FolderThemeColor
  appThemeColor: ThemeColor
  currentDefaultAgent: AgentType | null
  availableAgents: AgentType[]
  /**
   * False while `useSortedAvailableAgents` is still serving the
   * localStorage seed (i.e. `acpListAgents()` has not yet succeeded this
   * session). The "Set default agent" submenu disables agent selection
   * while not fresh — otherwise the user could persist a folder default
   * pointing at a stale/uninstalled agent. The "No default" option stays
   * usable since clearing a default doesn't depend on the live list.
   */
  availableAgentsFresh: boolean
  onToggle: (folderId: number) => void
  onRemoveFromWorkspace: (folderId: number) => void
  onNewConversation: (folderId: number) => void
  onOpenInSplit: (folderId: number, side: "left" | "right") => void
  onImport: (folderId: number) => void
  onManageConversations: (folderId: number) => void
  onManageLinks: (folderId: number) => void
  onChangeColor: (folderId: number, color: FolderThemeColor) => void
  onSetAlias: (folderId: number, alias: string | null) => void
  onSetDefaultAgent: (folderId: number, agentType: AgentType | null) => void
  onOpenInSystemExplorer: (folderId: number) => void
  onOpenInTerminal: (folderId: number) => void
  onOpenInCode: (folderId: number) => void
  /**
   * Every folder group, for the "Move to group" submenu. Omitted on the header
   * variants that can't move on their own (worktree sub-groups and the "root"
   * sub-group follow their repo), which is also what hides the submenu there.
   * Must be referentially stable to preserve the memo.
   */
  folderGroups?: readonly FolderGroupDetail[]
  /** Which group this folder is currently in (null = top level), for the check
   *  mark in that submenu. */
  currentGroupId?: number | null
  onMoveToGroup?: (folderId: number, groupId: number | null) => void
  /** Create a group and move this folder into it in one step — the path a user
   *  takes when the group they want doesn't exist yet. */
  onNewGroupWithFolder?: (folderId: number) => void
  isDragging?: boolean
  onGripPointerDown?: (folderId: number, event: React.PointerEvent) => void
  /**
   * True for the in-list copy of the folder whose floating sticky overlay is
   * currently showing. The overlay is the accessible control (`aria-hidden` +
   * `tabIndex={-1}` on this copy) so AT does not announce the folder twice
   * while virtua still keeps the in-list row mounted in its buffer.
   *
   * Do NOT use `inert` here: a header that is only a few pixels into the
   * viewport is still visible and clickable, and `inert` makes that press a
   * no-op — the "first click does nothing, second click works" gesture.
   */
  suppressed?: boolean
  /**
   * Nesting depth of the header row. 0 for a top-level repo / plain folder / repo
   * container; 1 for a worktree or "root" sub-group shown under its container
   * when "Show worktrees" is on. Drives the left indent and the connector-spine
   * ancestor rails (a pure function of this number), mirroring the conversation
   * card's per-level rail step.
   */
  depth?: number
  /**
   * Which glyph + label this header renders:
   * - `repo` (default): a top-level repo / plain folder / repo container — the
   *   FolderOpen/FolderClosed glyph and the repo-name alias label.
   * - `worktree`: a git worktree sub-group — the FolderGit2 glyph and the same
   *   `alias [ name ]` label as a repo, with the branch standing in for the
   *   alias (see {@link worktreeHeaderAlias}).
   * - `root`: a repo container's own-sessions sub-group — the FolderRoot glyph
   *   and the same `alias [ name ]` label as the two above, with the container's
   *   live branch standing in for the alias and a fixed, non-localized "root"
   *   for the name (see {@link rootBranch}).
   */
  variant?: "repo" | "worktree" | "root"
  /** The worktree's branch name (its own `git_branch`), used as the alias when
   *  none is set. Leaves the bare folder name when absent. */
  worktreeBranch?: string | null
  /**
   * The container repo's live HEAD branch, for the `root` variant only. Absent
   * (unknown HEAD, detached, or not yet resolved) degrades the label to the
   * bare "root" this row carried before there was a branch to show.
   */
  rootBranch?: string | null
}) {
  // Own the translations here rather than receiving `t` as a prop: next-intl
  // returns a fresh `t` on every parent render, so passing it down would defeat
  // this component's memo and re-render every header on each status event.
  const t = useTranslations("Folder.sidebar")
  const ime = useImeGuard()
  // Only flag a stale default once the live list is known; before fresh,
  // `availableAgents` is the localStorage seed and may legitimately omit a
  // newly-enabled agent.
  const showStaleDefault =
    availableAgentsFresh &&
    currentDefaultAgent !== null &&
    !availableAgents.includes(currentDefaultAgent)
  const tFileTree = useTranslations("Folder.fileTreeTab")
  const systemExplorerLabel =
    typeof navigator === "undefined"
      ? tFileTree("openInFileManager")
      : (() => {
          const platform =
            `${navigator.platform} ${navigator.userAgent}`.toLowerCase()
          if (platform.includes("mac")) return tFileTree("openInFinder")
          if (platform.includes("win")) return tFileTree("openInExplorer")
          return tFileTree("openInFileManager")
        })()
  // `revealItemInDir` only works inside Tauri; in web mode it is a no-op,
  // so disable the entry there to avoid silent failures.
  const isDesktopMode = isDesktop()

  // Alias dialog: controlled Dialog rendered as a sibling of the ContextMenu so
  // it survives the menu closing on select (mirrors the conversation card's
  // rename dialog). Seeded from the current alias on open.
  const [aliasDialogOpen, setAliasDialogOpen] = useState(false)
  const [aliasValue, setAliasValue] = useState("")
  const openAliasDialog = useCallback(() => {
    setAliasValue(folderAlias ?? "")
    setAliasDialogOpen(true)
  }, [folderAlias])
  const confirmAlias = useCallback(() => {
    // Empty / whitespace clears the alias (null); the backend re-normalizes too.
    const trimmed = aliasValue.trim()
    onSetAlias(folderId, trimmed ? trimmed : null)
    setAliasDialogOpen(false)
  }, [aliasValue, folderId, onSetAlias])

  const handleTogglePointerDown = (event: React.PointerEvent) => {
    // This eager path exists only for WebKit trackpad taps, which arrive as a
    // fine `mouse` pointer and can recycle the virtual row before `click`.
    // A finger beginning the Drawer's close swipe also starts with
    // `pointerdown`; toggling here would therefore open/close the folder before
    // the browser has enough movement to recognize and consume the swipe.
    // Touch and pen wait for the normal click path, which the browser cancels
    // when that press turns into a drag/swipe.
    if (event.button !== 0 || event.pointerType !== "mouse") return
    // Toggle on press — a trackpad tap on WebKit often remounts this button
    // (virtua / sticky overlay) before `click`, so waiting for `click` drops
    // the first tap. Mouse `click` is sync and would be fine either way.
    rememberPointerToggle(folderId)
    event.preventDefault()
    event.stopPropagation()
    onToggle(folderId)
  }
  const handleToggleClick = () => {
    // Trackpad still synthesizes a delayed `click` after pointerdown, and
    // preventDefault does not cancel it in WebKit. The guard is module-level
    // so it survives the remount that wipes a per-instance ref — without it
    // the leftover click flips the folder back (first tap looks like a no-op).
    if (wasRecentPointerToggle(folderId)) return
    onToggle(folderId)
  }
  const handleNewConversationPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 || event.pointerType !== "mouse") return
    rememberPointerNewConversation(folderId)
    event.stopPropagation()
    onNewConversation(folderId)
  }
  const handleNewConversationClick = (event: React.MouseEvent) => {
    event.stopPropagation()
    if (consumeRecentPointerNewConversation(folderId)) return
    onNewConversation(folderId)
  }

  const titleTint = folderTitleTintVars(themeColor)
  // The `[ name ]` half of an aliased label is normally a DEEPER shade than the
  // alias beside it. A tinted title has no deeper shade to reach for (the tint
  // is already pinned to the one lightness that clears AA on this surface), so
  // it just inherits — the brackets alone carry the alias/name split there.
  const bracketClassName = titleTint
    ? "text-current"
    : "text-sidebar-foreground"

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            aria-hidden={suppressed || undefined}
            className={cn(
              "relative h-[2rem] rounded-full",
              isDragging && "opacity-50"
            )}
          >
            <div
              className={cn(
                "group flex h-[1.9375rem] w-full items-center",
                "rounded-full",
                "transition-colors duration-150",
                "hover:bg-[color-mix(in_oklab,var(--sidebar-accent),var(--sidebar-foreground)_2%)]"
              )}
            >
              <button
                type="button"
                data-folder-id={folderId}
                tabIndex={suppressed ? -1 : undefined}
                onPointerDown={handleTogglePointerDown}
                onClick={handleToggleClick}
                title={folderPath}
                aria-expanded={expanded}
                className={cn(
                  "relative flex h-full min-w-0 flex-1 items-center pr-[0.5rem] outline-none",
                  "rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  "text-sidebar-foreground cursor-pointer"
                )}
                style={{
                  paddingLeft: `calc(var(--conv-rail-axis) + 0.875rem + ${depth} * ${CONV_RAIL_DEPTH_STEP})`,
                }}
              >
                {/* Connector spine (Show worktrees): a depth-1 sub-group header
                    draws its container's vertical rail at the depth-0 axis, so
                    stacked across the container's children (root + worktree
                    headers and their session cards) it forms one continuous line
                    down from the container. Renders nothing at depth 0. */}
                <SubsessionAncestorRails depth={depth} />
                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute flex items-center justify-center text-muted-foreground/75"
                  )}
                  style={{
                    top: "50%",
                    left: `calc(var(--conv-rail-axis) + ${depth} * ${CONV_RAIL_DEPTH_STEP})`,
                    width: "0.875rem",
                    height: "0.875rem",
                    transform: "translate(-50%, -50%)",
                  }}
                >
                  {variant === "worktree" ? (
                    <FolderGit2 className="h-[0.875rem] w-[0.875rem]" />
                  ) : variant === "root" ? (
                    <FolderRoot className="h-[0.875rem] w-[0.875rem]" />
                  ) : expanded ? (
                    <FolderOpen className="h-[0.875rem] w-[0.875rem]" />
                  ) : (
                    <FolderClosed className="h-[0.875rem] w-[0.875rem]" />
                  )}
                </span>
                <div className="flex min-w-0 flex-1 items-center gap-[0.5rem]">
                  {/* The folder's chosen colour lands HERE and nowhere else: the
                      row's hover pill, its badges and every conversation card
                      under it stay on the app theme. `folderTitleTintVars`
                      writes both themes' values as inline custom properties and
                      `.folder-title-tint` (globals.css) picks one; `inherit`
                      returns undefined and the default class carries the day. */}
                  <span
                    style={titleTint}
                    className={cn(
                      "min-w-0 flex-shrink truncate text-left text-[0.875rem] font-normal",
                      titleTint
                        ? "folder-title-tint"
                        : "text-sidebar-foreground/75"
                    )}
                  >
                    {variant === "worktree" ? (
                      // Branch as the alias, directory as the name — the same
                      // two-part label a repo header renders.
                      <FolderAliasLabel
                        name={folderName}
                        alias={worktreeHeaderAlias(folderAlias, worktreeBranch)}
                        bracketClassName={bracketClassName}
                      />
                    ) : variant === "root" ? (
                      // The container repo's own-sessions sub-group: its live
                      // branch as the alias, a fixed "root" as the name — the
                      // same two-part label its worktree siblings render, so the
                      // whole subtree reads as one column of branches. "root"
                      // stays non-localized: it stands for the repo root
                      // regardless of UI language. With no known branch this
                      // collapses back to the bare "root" it has always shown.
                      <FolderAliasLabel
                        name="root"
                        alias={rootBranch ?? null}
                        bracketClassName={bracketClassName}
                      />
                    ) : (
                      <FolderAliasLabel
                        name={folderName}
                        alias={folderAlias}
                        bracketClassName={bracketClassName}
                      />
                    )}
                  </span>
                  {/* Live-activity badge: the number of RUNNING sessions in this
                      group, and nothing at all when none are. Amber (not the
                      primary tint the old total-count chip used) is the same
                      "running" semantic the conversation cards spin in amber, so
                      the two read as one signal. amber-700 (not the card's
                      amber-600) carries the light-mode fill: at 0.625rem this is
                      small text, and amber-600 on the tinted surface lands near
                      3:1 — under the AA floor amber-700 (~4.7:1) clears. */}
                  {runningCount > 0 && (
                    <span
                      title={t("runningCountBadge", { count: runningCount })}
                      className={cn(
                        "inline-flex shrink-0 items-center justify-center",
                        "h-[0.9375rem] min-w-[1rem] rounded-[0.3125rem] px-[0.25rem]",
                        "text-[0.625rem] font-semibold leading-none tabular-nums",
                        "bg-amber-500/12 text-amber-700",
                        "dark:bg-amber-400/15 dark:text-amber-300"
                      )}
                    >
                      <span aria-hidden>{runningCount}</span>
                      <span className="sr-only">
                        {t("runningCountBadge", { count: runningCount })}
                      </span>
                    </span>
                  )}
                  {/* Disclosure chevron mirrors the section headers: hover-revealed,
                    rotates on expand. The persistent open/closed state still reads
                    from the folder icon on the left, which is why the chevron can
                    stay hidden at rest in BOTH states (collapsed included) — it is
                    a redundant affordance, not the only one. Touch keeps it pinned
                    on, since there is no hover to reveal it there.
                    NOTE: `group-focus-within` (not `group-focus-visible` like the
                    section header) is intentional — here the `group` is the outer
                    row wrapper and focus lands on a child (the toggle button or the
                    sibling ⋯ menu button), so the reveal must react to focus
                    anywhere inside the row. The section header's `group` IS its
                    button, so it uses `group-focus-visible`. Don't "normalize". */}
                  <ChevronRight
                    aria-hidden
                    className={cn(
                      "h-3 w-3 shrink-0 text-muted-foreground/60",
                      "transition-[transform,opacity] duration-200 ease-out",
                      "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
                      "[@media(hover:none)]:opacity-100",
                      expanded && "rotate-90"
                    )}
                  />
                </div>
              </button>
              {onGripPointerDown && (
                <button
                  type="button"
                  data-folder-grip={folderId}
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    onGripPointerDown(folderId, event)
                  }}
                  onClick={(event) => event.stopPropagation()}
                  title={t("reorderHandle")}
                  aria-label={t("reorderHandle")}
                  tabIndex={suppressed ? -1 : undefined}
                  className={cn(
                    "flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded-[0.375rem] outline-none",
                    "text-muted-foreground/80 opacity-0 transition-[opacity,color] duration-150",
                    "group-hover:opacity-100 focus-visible:opacity-100 hover:text-sidebar-foreground",
                    "[@media(hover:none)]:opacity-100",
                    isDragging ? "cursor-grabbing" : "cursor-grab"
                  )}
                >
                  <GripVertical className="h-[0.875rem] w-[0.875rem]" />
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  // Re-open the SAME context menu as right-click (single source of
                  // truth — the menu has 3 submenus, duplicating it would drift).
                  // Dispatch a synthetic contextmenu event from this button; it
                  // bubbles to the enclosing <ContextMenuTrigger>, which Radix opens
                  // at the given coords — anchored just under the button.
                  const rect = e.currentTarget.getBoundingClientRect()
                  e.currentTarget.dispatchEvent(
                    new MouseEvent("contextmenu", {
                      bubbles: true,
                      cancelable: true,
                      button: 2,
                      clientX: rect.left,
                      clientY: rect.bottom,
                    })
                  )
                }}
                title={t("moreOptions")}
                aria-label={t("moreOptions")}
                aria-haspopup="menu"
                tabIndex={suppressed ? -1 : undefined}
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-end",
                  // Shares the card action-icon palette: default /90 is the lightest
                  // muted shade clearing 3:1 non-text contrast (incl. on touch, where
                  // this stays visible); hover deepens to full foreground.
                  "rounded-[0.375rem] cursor-pointer outline-none text-muted-foreground/90",
                  "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
                  "transition-[opacity,color] duration-150 hover:text-sidebar-foreground"
                )}
              >
                <MoreHorizontal className="h-[0.875rem] w-[0.875rem]" />
              </button>
              <button
                type="button"
                onPointerDown={handleNewConversationPointerDown}
                onClick={handleNewConversationClick}
                title={t("newConversation")}
                aria-label={t("newConversation")}
                tabIndex={suppressed ? -1 : undefined}
                className={cn(
                  // Mirrors the ⋯ button's action-icon palette and hover-reveal so
                  // the two read as one trailing control cluster. As the rightmost
                  // control it carries the right-edge margin that lines this cluster
                  // up with the other sidebar affordances: 0.375rem + the list's
                  // px-1.5 (0.375rem) = a uniform 0.75rem inset from the border,
                  // matching the section-header actions and conversation-card badges.
                  // h-6 (not h-7) keeps every action-icon centre on the same axis, and
                  // justify-end flushes the glyph to that 0.75rem edge so the visible
                  // icon — not the transparent button box — lines up with the badges.
                  "mr-[0.375rem] flex h-6 w-6 shrink-0 items-center justify-end",
                  "rounded-[0.375rem] cursor-pointer outline-none text-muted-foreground/90",
                  "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
                  "transition-[opacity,color] duration-150 hover:text-sidebar-foreground"
                )}
              >
                <SquarePen className="h-[0.875rem] w-[0.875rem]" />
              </button>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => onNewConversation(folderId)}>
            <SquarePen className="h-4 w-4" />
            {t("newConversation")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onOpenInSplit(folderId, "left")}>
            <PanelLeft className="h-4 w-4" />
            {t("folderHeaderMenu.openInLeftSplit")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onOpenInSplit(folderId, "right")}>
            <PanelRight className="h-4 w-4" />
            {t("folderHeaderMenu.openInRightSplit")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onImport(folderId)}>
            <Download className="h-4 w-4" />
            {t("importLocalSessions")}
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <ExternalLink className="h-4 w-4" />
              {tFileTree("openIn")}
            </ContextMenuSubTrigger>
            <OpenInSubContent
              explorerLabel={systemExplorerLabel}
              terminalLabel={tFileTree("openInTerminal")}
              codeLabel={tFileTree("openInCode")}
              explorerDisabled={!isDesktopMode}
              onOpenExplorer={() => onOpenInSystemExplorer(folderId)}
              onOpenTerminal={() => onOpenInTerminal(folderId)}
              onOpenCode={() => onOpenInCode(folderId)}
            />
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => onManageConversations(folderId)}>
            <ListChecks className="h-4 w-4" />
            {t("folderHeaderMenu.manageConversations")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onManageLinks(folderId)}>
            <Link2 className="h-4 w-4" />
            {t("folderHeaderMenu.manageLinks")}
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Bot className="h-4 w-4" />
              {t("folderHeaderMenu.setDefaultAgent")}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-[12rem]">
              <ContextMenuItem
                onSelect={() => onSetDefaultAgent(folderId, null)}
                className="gap-2"
              >
                <span className="min-w-0 flex-1 truncate">
                  {t("folderHeaderMenu.defaultAgentNone")}
                </span>
                {currentDefaultAgent === null ? (
                  <Check className="h-3.5 w-3.5 shrink-0" />
                ) : null}
              </ContextMenuItem>
              <ContextMenuSeparator />
              {availableAgentsFresh ? (
                <>
                  {availableAgents.map((agent) => {
                    const active = currentDefaultAgent === agent
                    return (
                      <ContextMenuItem
                        key={agent}
                        onSelect={() => onSetDefaultAgent(folderId, agent)}
                        className="gap-2"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {getAgentLabel(agent)}
                        </span>
                        {active ? (
                          <Check className="h-3.5 w-3.5 shrink-0" />
                        ) : null}
                      </ContextMenuItem>
                    )
                  })}
                  {showStaleDefault && currentDefaultAgent !== null ? (
                    <ContextMenuItem
                      key={currentDefaultAgent}
                      disabled
                      className="gap-2 opacity-60"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {`${getAgentLabel(currentDefaultAgent)} ${t("folderHeaderMenu.agentUnavailableSuffix")}`}
                      </span>
                      <Check className="h-3.5 w-3.5 shrink-0" />
                    </ContextMenuItem>
                  ) : null}
                </>
              ) : (
                <ContextMenuItem disabled className="gap-2 opacity-60">
                  <span className="min-w-0 flex-1 truncate">
                    {t("folderHeaderMenu.loadingAgents")}
                  </span>
                </ContextMenuItem>
              )}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Palette className="h-4 w-4" />
              {t("folderHeaderMenu.changeColor")}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-[12rem] p-2">
              <ContextMenuItem
                onSelect={() =>
                  onChangeColor(folderId, FOLDER_THEME_COLOR_INHERIT)
                }
                className="gap-2"
              >
                <span
                  aria-hidden
                  className="h-[1.125rem] w-[1.125rem] shrink-0 rounded-[0.25rem] border border-border"
                  style={{
                    backgroundColor: THEME_COLOR_PREVIEW[appThemeColor],
                  }}
                />
                <span className="min-w-0 flex-1 truncate">
                  {t("folderHeaderMenu.useThemeColor")}
                </span>
                {themeColor === FOLDER_THEME_COLOR_INHERIT ? (
                  <Check className="h-3.5 w-3.5 shrink-0" />
                ) : null}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <div className="grid grid-cols-6 gap-1">
                {THEME_COLORS.map((color) => {
                  const active = color === themeColor
                  return (
                    <button
                      key={color}
                      type="button"
                      title={color}
                      aria-label={color}
                      onClick={() => onChangeColor(folderId, color)}
                      className={cn(
                        "h-[1.125rem] w-[1.125rem] cursor-pointer rounded-[0.25rem]",
                        "outline-none ring-offset-1 ring-offset-popover",
                        "transition-[box-shadow,transform] duration-100 hover:scale-110",
                        active && "ring-2 ring-foreground/60"
                      )}
                      style={{ backgroundColor: THEME_COLOR_PREVIEW[color] }}
                    />
                  )
                })}
              </div>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem onSelect={openAliasDialog}>
            <Tag className="h-4 w-4" />
            {t("folderHeaderMenu.setAlias")}
          </ContextMenuItem>
          {/* The keyboard/menu path into and out of a folder group — the drag
              gesture is the fast one, but it is pointer-only, and a folder
              inside a collapsed group has no drag target at all until you open
              it. Hidden on worktree / root sub-groups (no handlers passed):
              those follow their repo and can't be grouped on their own. */}
          {folderGroups != null && onMoveToGroup != null && (
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Layers className="h-4 w-4" />
                {t("folderGroup.moveToGroup")}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="min-w-[12rem]">
                <ContextMenuItem
                  onSelect={() => onMoveToGroup(folderId, null)}
                  className="gap-2"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {t("folderGroup.removeFromGroup")}
                  </span>
                  {currentGroupId == null ? (
                    <Check className="h-3.5 w-3.5 shrink-0" />
                  ) : null}
                </ContextMenuItem>
                {folderGroups.length > 0 && <ContextMenuSeparator />}
                {folderGroups.map((group) => (
                  <ContextMenuItem
                    key={group.id}
                    onSelect={() => onMoveToGroup(folderId, group.id)}
                    className="gap-2"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {group.name}
                    </span>
                    {currentGroupId === group.id ? (
                      <Check className="h-3.5 w-3.5 shrink-0" />
                    ) : null}
                  </ContextMenuItem>
                ))}
                {onNewGroupWithFolder != null && (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onSelect={() => onNewGroupWithFolder(folderId)}
                    >
                      <LayersPlus className="h-4 w-4" />
                      {t("folderGroup.newGroupAndMove")}
                    </ContextMenuItem>
                  </>
                )}
              </ContextMenuSubContent>
            </ContextMenuSub>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onSelect={() => onRemoveFromWorkspace(folderId)}
          >
            <XCircle className="h-4 w-4" />
            {t("folderHeaderMenu.removeFromWorkspace")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={aliasDialogOpen} onOpenChange={setAliasDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("folderHeaderMenu.setAliasTitle")}</DialogTitle>
          </DialogHeader>
          <Input
            value={aliasValue}
            onChange={(e) => setAliasValue(e.target.value)}
            {...ime.props}
            onKeyDown={(e) => {
              if (ime.isComposing(e)) return
              if (e.key === "Enter") confirmAlias()
            }}
            placeholder={t("folderHeaderMenu.setAliasPlaceholder")}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAliasDialogOpen(false)}>
              {t("folderHeaderMenu.setAliasCancel")}
            </Button>
            <Button onClick={confirmAlias}>
              {t("folderHeaderMenu.setAliasSave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
})

export interface SidebarConversationListHandle {
  scrollToActive: () => void
  /**
   * Open / close every collapsible group in the list at once, driven by the
   * sidebar header's toggle. "Every" is literal: the folder groups (plus each
   * container's worktree children and its root sub-group) AND all four
   * top-level section headers — Pinned, Folders, Chat, Recent. Any header left
   * standing open is what makes the button read as broken, and the flat
   * sections in particular own conversation rows directly, with no folder in
   * between, so nothing else would have closed them.
   *
   * Collapsed therefore bottoms out at four header rows and nothing else. That
   * is the intent, not an overshoot — `expandAll` restores the folder groups
   * underneath, since section collapse and per-folder collapse are stored
   * separately and neither erases the other.
   */
  expandAll: () => void
  collapseAll: () => void
}

export interface SidebarConversationListProps {
  showCompleted?: boolean
  sortMode?: SidebarSortMode
  sectionOrder?: SidebarSectionOrder
  onNavigate?: () => void
  /** When on, each repo's worktree child folders render as indented sub-groups
   *  instead of being merged flat into the parent group. Defaults to off. */
  showWorktrees?: boolean
  /** When on, the flat "Recent" section is rendered at its slot in
   *  `sectionOrder`. Defaults to off here; the Sidebar passes the user's
   *  preference, whose product default is ON. */
  showRecent?: boolean
}

export function SidebarConversationList({
  ref,
  showCompleted = true,
  sortMode = DEFAULT_SIDEBAR_SORT_MODE,
  sectionOrder = DEFAULT_SECTION_ORDER,
  showWorktrees = false,
  showRecent = false,
  onNavigate,
}: SidebarConversationListProps & {
  ref?: Ref<SidebarConversationListHandle>
}) {
  const t = useTranslations("Folder.sidebar")
  const tCommon = useTranslations("Folder.common")
  const tFolderDropdown = useTranslations("Folder.folderNameDropdown")
  const tFileTree = useTranslations("Folder.fileTreeTab")
  const tRemote = useTranslations("RemoteWorkspace")
  const { resolvedTheme } = useTheme()
  const { themeColor: appThemeColor } = useThemeColor()
  const { createTerminalInDirectory } = useTerminalContext()
  const { zoomLevel } = useZoomLevel()
  const folders = useAppWorkspaceStore((s) => s.folders)
  const allFolders = useAppWorkspaceStore((s) => s.allFolders)
  const conversations = useAppWorkspaceStore((s) => s.conversations)
  // Live HEAD branch per folder, for the container repos' "root" sub-group
  // labels. Safe to subscribe to from a list this hot: `applyGitHead` is
  // equality-guarded, so the Map reference only changes when a branch actually
  // changes — not on every poll tick.
  const branches = useAppWorkspaceStore((s) => s.branches)
  const ensureGitHead = useAppWorkspaceStore((s) => s.ensureGitHead)
  const loading = useAppWorkspaceStore((s) => s.conversationsLoading)
  const error = useAppWorkspaceStore((s) => s.conversationsError)
  const refreshConversations = useAppWorkspaceStore(
    (s) => s.refreshConversations
  )
  const updateConversationLocal = useAppWorkspaceStore(
    (s) => s.updateConversationLocal
  )
  const removeFolderFromWorkspace = useAppWorkspaceStore(
    (s) => s.removeFolderFromWorkspace
  )
  const folderGroups = useAppWorkspaceStore((s) => s.folderGroups)
  const applySidebarLayout = useAppWorkspaceStore((s) => s.applySidebarLayout)
  const createFolderGroup = useAppWorkspaceStore((s) => s.createFolderGroup)
  const updateFolderGroup = useAppWorkspaceStore((s) => s.updateFolderGroup)
  const deleteFolderGroupAction = useAppWorkspaceStore(
    (s) => s.deleteFolderGroup
  )
  const setFolderGroupAction = useAppWorkspaceStore((s) => s.setFolderGroup)
  const refreshFolder = useAppWorkspaceStore((s) => s.refreshFolder)
  const refreshing = loading
  const { activeFolder } = useActiveFolder()

  const activeTabId = useTabStore((s) => s.activeTabId)
  const tabs = useTabStore((s) => s.tabs)
  const {
    openTab,
    closeConversationTab,
    closeTabsByFolder,
    openNewConversationTab,
    openChatModeTab,
    openFolderInSplit,
  } = useTabActions()
  const { openConversations } = useWorkbenchRoute()

  const folderIndex = useMemo(() => {
    const map = new Map<
      number,
      {
        name: string
        alias: string | null
        path: string
        color: string
        defaultAgentType: AgentType | null
        gitBranch: string | null
      }
    >()
    for (const f of allFolders)
      map.set(f.id, {
        name: f.name,
        alias: f.alias,
        path: f.path,
        color: f.color,
        defaultAgentType: f.default_agent_type,
        gitBranch: f.git_branch,
      })
    return map
  }, [allFolders])

  // `tabs` gets a fresh array reference on every `conversations` change (the tab
  // context re-derives titles/status), so these two derivations would otherwise
  // hand a new object / Set to every FolderGroupItem on each status event and
  // defeat its memo. Reuse the previous reference when the content is unchanged
  // (render-phase ref cache; idempotent under StrictMode's double invoke).
  const selectedConvRef = useRef<{ id: number; agentType: string } | null>(null)
  const selectedConversation = useMemo(() => {
    const activeTab = tabs.find((tab) => tab.id === activeTabId)
    const next =
      !activeTab || activeTab.conversationId == null
        ? null
        : { id: activeTab.conversationId, agentType: activeTab.agentType }
    const reused = reuseSelected(selectedConvRef.current, next)
    selectedConvRef.current = reused
    return reused
  }, [tabs, activeTabId])

  const openTabKeysRef = useRef<Set<string>>(new Set())
  const openTabKeys = useMemo(() => {
    const next = new Set<string>()
    for (const tab of tabs) {
      if (tab.conversationId != null) {
        next.add(`${tab.agentType}:${tab.conversationId}`)
      }
    }
    const reused = reuseSet(openTabKeysRef.current, next)
    openTabKeysRef.current = reused
    return reused
  }, [tabs])

  const { sortedTypes: availableAgents, fresh: availableAgentsFresh } =
    useSortedAvailableAgents()
  const [folderExpanded, setFolderExpanded] = useState<Record<number, boolean>>(
    {}
  )
  // Mirror used by the stable `toggleFolder` callback. It is refreshed from
  // rendered state here and advanced synchronously by the callback so a second
  // click can see the first click's pending intent.
  const folderExpandedRef = useRef(folderExpanded)
  folderExpandedRef.current = folderExpanded
  // Collapsed state of each folder GROUP, keyed by group id. Absent key =
  // expanded, mirroring `folderExpanded`. Hydrated from localStorage on mount.
  const [folderGroupExpanded, setFolderGroupExpanded] = useState<
    Record<number, boolean>
  >({})
  // Repo ids whose "root" sub-group (a container repo's own sessions, shown only
  // under "Show worktrees") is collapsed. Session-only, not persisted: the
  // container's own collapse — which hides the whole subtree — IS persisted via
  // `folderExpanded`, so this indented sub-toggle is kept deliberately
  // lightweight. Default (absent) = expanded.
  const [rootGroupCollapsed, setRootGroupCollapsed] = useState<Set<number>>(
    () => new Set()
  )
  // Collapsed state of the two top-level sections ("Pinned", "Folders"). Absent
  // key = expanded (default). Hydrated from localStorage after mount.
  const [sectionCollapsed, setSectionCollapsed] =
    useState<SidebarSectionCollapsed>({})
  const pinnedExpanded = !sectionCollapsed.pinned
  const foldersExpanded = !sectionCollapsed.folders
  const chatsExpanded = !sectionCollapsed.chats
  const recentExpanded = !sectionCollapsed.recent
  // Session-only, like folder paging: collapsing/reopening Chat starts from a
  // compact first page instead of preserving a long, previously-expanded list.
  const [chatLimit, setChatLimit] = useState(CHAT_PAGE_SIZE)
  const revealMoreChats = useCallback(
    () => setChatLimit((n) => n + CHAT_PAGE_SIZE),
    []
  )
  // How many Recent rows are currently revealed. Session-only (not persisted):
  // "show me more of this list right now" is a reading gesture, not a setting —
  // and a fresh sidebar should open short again.
  const [recentLimit, setRecentLimit] = useState(RECENT_PAGE_SIZE)
  const revealMoreRecent = useCallback(
    () => setRecentLimit((n) => n + RECENT_PAGE_SIZE),
    []
  )
  // Per-folder revealed count. Session-only, same reason as `recentLimit`:
  // "show me more of this folder right now" is a reading gesture. Absent key
  // = the default page size.
  const [folderLimitById, setFolderLimitById] = useState<
    Record<number, number>
  >({})
  const revealMoreFolder = useCallback((folderId: number) => {
    setFolderLimitById((prev) => ({
      ...prev,
      [folderId]: (prev[folderId] ?? FOLDER_PAGE_SIZE) + FOLDER_PAGE_SIZE,
    }))
  }, [])
  // The Recent footer's own button, so the reset can hand focus to it.
  const recentMoreButtonRef = useRef<HTMLButtonElement>(null)
  // The way back out. `recentLimit` only ever grew before, so a list expanded a
  // few pages deep stayed that way for the rest of the session, pushing the
  // sections under Recent off the screen.
  const resetRecentLimit = useCallback(() => {
    // Move focus FIRST, while the right-edge icon variant is still mounted:
    // dropping the limit unmounts it (its `canReset` goes false) and would
    // otherwise leave keyboard focus on <body>, i.e. back at the top of the
    // document. The footer button always survives a reset — the reset only
    // exists when more than a page is on screen, so a remainder is guaranteed —
    // and in the reset-only variant it IS the clicked button, making this a
    // no-op. Programmatic focus after a mouse click does not raise
    // `:focus-visible`, so pointer users see no ring.
    recentMoreButtonRef.current?.focus()
    setRecentLimit(RECENT_PAGE_SIZE)
  }, [])
  // ── Per-conversation delegation sub-session expansion ───────────────────
  // Default COLLAPSED (unlike folders): only ids the user opened are tracked
  // and persisted. Hydrated from localStorage after mount. `childrenByParent`
  // is the lazily-fetched child cache (key absent = not fetched → renders a
  // loading row; empty array = no live children → renders nothing, self-heals
  // on the next refresh). The ref mirror lets the lazy-fetch dedupe read the
  // latest cache without re-creating its callback.
  const [conversationExpanded, setConversationExpanded] = useState<Set<number>>(
    () => new Set()
  )
  const [childrenByParent, setChildrenByParent] = useState<
    Map<number, DbConversationSummary[]>
  >(() => new Map())
  const childrenByParentRef = useRef(childrenByParent)
  childrenByParentRef.current = childrenByParent
  const childrenInFlightRef = useRef<Set<number>>(new Set())
  // In-flight parent fetches → drives the loading spinner. A placeholder empty
  // array is written into `childrenByParent` before the fetch so concurrent child
  // upserts buffer into it (closing the lost-update race); `childrenLoading` then
  // distinguishes "still fetching" from a settled-empty (stale-count) subtree.
  const [childrenLoading, setChildrenLoading] = useState<Set<number>>(
    () => new Set()
  )
  // Tombstones for soft-deleted child ids (FIFO-bounded in the sync hook) so a
  // stale fetch snapshot or out-of-order upsert can't resurrect a deleted child —
  // the child-cache analog of the context's root deletion guard.
  const deletedChildIdsRef = useRef<Set<number>>(new Set())

  // Keep the lazily-loaded sub-session cache live in real time: route child
  // upsert/status/deleted events into `childrenByParent` (roots stay with the
  // AppWorkspace context). child_count converges via backend parent re-emits.
  useSubsessionSync({ setChildrenByParent, deletedChildIdsRef })
  const [removeConfirm, setRemoveConfirm] = useState<{
    folderId: number
    folderName: string
  } | null>(null)
  // Folder the "manage conversations" dialog opens on — its initial scope; the
  // dialog itself can then widen to the workspace or point at another folder.
  const [manageFolderId, setManageFolderId] = useState<number | null>(null)
  const [cloneOpen, setCloneOpen] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)
  const [remoteManageOpen, setRemoteManageOpen] = useState(false)
  // Backs the list context menu's "Open remote workspace" submenu. Shared with
  // the status bar's quick-actions menu, which renders the same list from the
  // same loader; connections are fetched when that submenu opens, not on mount.
  const {
    desktop: remoteAvailable,
    connections: remoteConnections,
    refresh: refreshRemote,
    open: openRemote,
  } = useRemoteWorkspaceConnections()
  // Folder whose links are being managed (context menu -> Linked folders).
  const [linksFolder, setLinksFolder] = useState<FolderDetail | null>(null)
  // What is being dragged: a folder or a whole group. `null` = no drag. Widened
  // from a bare folder id when groups arrived, since a group reorders as one
  // unit (its members travel with it and never appear on the drag surface).
  const [dragging, setDragging] = useState<SidebarEntry | null>(null)
  const [reordering, setReordering] = useState(false)
  // Optimistic layout while a drag is in flight; `null` = use the store's.
  const [dragLayout, setDragLayout] = useState<SidebarLayout | null>(null)
  const pendingLayoutRef = useRef<SidebarLayout | null>(null)

  // Floating sticky folder header. `stickyFolderId` is the ONLY new render
  // state and changes solely when the scroll crosses into a different folder —
  // never on a status event or the per-minute `now` tick — so the card/header
  // memo budget is untouched. The per-frame handoff translateY is written
  // straight to the overlay node (no re-render); see `recomputeSticky`.
  const [stickyFolderId, setStickyFolderId] = useState<number | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const stickyRafRef = useRef<number | null>(null)
  // Read by the imperative scroll path without re-subscribing virtua's listener.
  const draggingRef = useRef<SidebarEntry | null>(dragging)
  draggingRef.current = dragging

  // Custom pointer-based folder reorder (replaces motion `Reorder`, which can't
  // coexist with virtualization — see the perf plan). Refs are read by the
  // window pointer listeners so the public callbacks stay referentially stable
  // (the `FolderHeader` memo depends on a stable `onGripPointerDown`).
  const dragSurfaceRef = useRef<HTMLDivElement>(null)
  const listSurfaceRef = useRef<HTMLDivElement>(null)
  const dragPointerRef = useRef<{
    entry: SidebarEntry
    pointerId: number
    startX: number
    startY: number
    lastY: number
    started: boolean
  } | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const dragCaptureRef = useRef<{
    target: Element
    pointerId: number
  } | null>(null)
  const autoscrollRef = useRef<number | null>(null)
  // Snapshots read by the imperative drag listeners without re-subscribing them.
  const layoutRef = useRef<SidebarLayout>(EMPTY_SIDEBAR_LAYOUT)
  // The authoritative (drag-free) layout, kept separately from `layoutRef` so
  // the drop can reconcile against server truth rather than against its own
  // optimistic view. See `handleDragEnd`.
  const storeLayoutRef = useRef<SidebarLayout>(EMPTY_SIDEBAR_LAYOUT)
  const dragSlotsRef = useRef<DragSlot[]>([])
  const reorderingRef = useRef(false)

  useEffect(() => {
    // Hydrate from localStorage after mount to keep SSR/CSR markup consistent.

    setFolderExpanded(loadFolderExpanded())
    setFolderGroupExpanded(loadFolderGroupExpanded())
    setSectionCollapsed(loadSectionCollapsed())
    setConversationExpanded(new Set(loadConversationExpanded()))
  }, [])

  const toggleSection = useCallback((section: SidebarSectionKey) => {
    if (section === "chats") setChatLimit(CHAT_PAGE_SIZE)
    setSectionCollapsed((prev) => {
      const next = { ...prev, [section]: !prev[section] }
      saveSectionCollapsed(next)
      return next
    })
  }, [])

  const toggleFolderGroup = useCallback((groupId: number) => {
    setFolderGroupExpanded((prev) => {
      // Absent key = expanded, so the first click has to write `false`.
      const next = { ...prev, [groupId]: !(prev[groupId] ?? true) }
      saveFolderGroupExpanded(next)
      return next
    })
  }, [])

  /** Drive every folder group at once, for expand/collapse-all. Reads the group
   *  list imperatively so the callback stays stable across group changes. */
  const setAllGroupsCollapsed = useCallback((collapsed: boolean) => {
    setFolderGroupExpanded(() => {
      const next: Record<number, boolean> = {}
      for (const group of useAppWorkspaceStore.getState().folderGroups) {
        next[group.id] = !collapsed
      }
      saveFolderGroupExpanded(next)
      return next
    })
  }, [])

  /** Drive every top-level section header at once, for expand/collapse-all.
   *  Bails out (same object → no re-render, no write) when they already all
   *  agree, so the header button is idempotent. */
  const setAllSectionsCollapsed = useCallback((collapsed: boolean) => {
    setSectionCollapsed((prev) => {
      if (SIDEBAR_SECTION_KEYS.every((key) => Boolean(prev[key]) === collapsed))
        return prev
      const next: SidebarSectionCollapsed = { ...prev }
      for (const key of SIDEBAR_SECTION_KEYS) next[key] = collapsed
      saveSectionCollapsed(next)
      return next
    })
  }, [])

  const handleChangeFolderColor = useCallback(
    async (folderId: number, color: FolderThemeColor) => {
      try {
        await updateFolderColor(folderId, color)
        await refreshFolder(folderId)
      } catch (err) {
        const msg = toErrorMessage(err)
        toast.error(t("toasts.changeFolderColorFailed", { message: msg }))
      }
    },
    [refreshFolder, t]
  )

  const handleSetFolderAlias = useCallback(
    async (folderId: number, alias: string | null) => {
      try {
        await updateFolderAlias(folderId, alias)
        await refreshFolder(folderId)
      } catch (err) {
        const msg = toErrorMessage(err)
        toast.error(t("toasts.setFolderAliasFailed", { message: msg }))
      }
    },
    [refreshFolder, t]
  )

  const handleChangeFolderDefaultAgent = useCallback(
    async (folderId: number, agentType: AgentType | null) => {
      try {
        await updateFolderDefaultAgent(folderId, agentType)
        await refreshFolder(folderId)
      } catch (err) {
        const msg = toErrorMessage(err)
        toast.error(
          t("toasts.changeFolderDefaultAgentFailed", { message: msg })
        )
      }
    },
    [refreshFolder, t]
  )

  const handleOpenFolderInSystemExplorer = useCallback(
    (folderId: number) => {
      const folder = folderIndex.get(folderId)
      if (!folder) return
      void revealItemInDir(folder.path).catch(() => {
        toast.error(tFileTree("toasts.openDirectoryFailed"))
      })
    },
    [folderIndex, tFileTree]
  )

  const handleOpenFolderInTerminal = useCallback(
    async (folderId: number) => {
      const folder = folderIndex.get(folderId)
      if (!folder) return
      const title = tFileTree("terminalTitle", { name: folder.name })
      const id = await createTerminalInDirectory(folder.path, title)
      if (!id) {
        toast.error(tFileTree("toasts.openBuiltinTerminalFailed"))
      }
    },
    [folderIndex, createTerminalInDirectory, tFileTree]
  )

  const handleOpenFolderInCode = useCallback(
    (folderId: number) => {
      const folder = folderIndex.get(folderId)
      if (!folder) return
      void openInCode(folder.path).catch((error) => {
        toast.error(tFileTree("toasts.openInCodeFailed"), {
          description: toErrorMessage(error),
        })
      })
    },
    [folderIndex, tFileTree]
  )

  // virtua binds to the real OverlayScrollbars viewport element (surfaced via
  // the ScrollArea `onViewportRef` bridge once OS has initialized). We keep both
  // a ref (for the Virtualizer `scrollRef` prop) and a state flag so the
  // Virtualizer only mounts after the viewport exists.
  const viewportRef = useRef<HTMLElement | null>(null)
  const [viewportEl, setViewportEl] = useState<HTMLElement | null>(null)
  const handleViewportRef = useCallback((element: HTMLElement | null) => {
    viewportRef.current = element
    setViewportEl(element)
  }, [])
  const virtualizerRef = useRef<VirtualizerHandle>(null)
  const scrollToActiveRef = useRef<() => void>(() => {})
  const pendingScrollRef = useRef(false)

  // Single "now" shared by every relative time label, refreshed once a minute.
  // Threading one value through all rows (instead of each row calling
  // `Date.now()` during render) keeps `timeLabel` referentially stable within a
  // render tick, so a single status event re-renders only the affected card.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(interval)
  }, [])

  // Folder grouping source: pinned conversations are surfaced in the dedicated
  // Pinned section, and folderless chat conversations in the dedicated Chat
  // section, so exclude both here; then apply the completed filter as before.
  const folderConversations = useMemo(() => {
    const base = conversations.filter(
      (c) => c.pinned_at == null && c.kind !== "chat"
    )
    if (showCompleted) return base
    return base.filter((c) => c.status !== "completed")
  }, [conversations, showCompleted])

  // Flat "Chat" bucket: folderless chat-mode conversations, most-recently-updated
  // first, with reference reuse (so an unrelated status event doesn't rebuild it
  // and defeat the section's memo). Pinned chats live in the Pinned section.
  const chatConvsRef = useRef<DbConversationSummary[]>([])
  const chatConversations = useMemo(() => {
    const next = selectChatConversationsWithReuse(
      conversations,
      showCompleted,
      chatConvsRef.current
    )
    chatConvsRef.current = next
    return next
  }, [conversations, showCompleted])

  // Pinned bucket: the FULL conversation list (ignores "Show completed" — a
  // pinned conversation stays visible regardless), sorted most-recently-pinned
  // first, with reference reuse so an unrelated status event doesn't rebuild it.
  const pinnedRef = useRef<DbConversationSummary[]>([])
  const pinned = useMemo(() => {
    const next = selectPinnedWithReuse(conversations, pinnedRef.current)
    pinnedRef.current = next
    return next
  }, [conversations])

  // Every folder currently open in the workspace (repos and their worktree
  // children alike). Depends only on `folders`, so status events never rebuild
  // it — the Recent bucket below leans on that.
  const openFolderIds = useMemo(
    () => new Set(folders.map((f) => f.id)),
    [folders]
  )

  // Flat "Recent" bucket: every reachable conversation — folder-bound and chat
  // alike — newest first, gated on the folder still being open so closing a
  // folder also removes its sessions here. Reference reuse keeps an unrelated
  // status event from rebuilding it and defeating the section's card memos.
  const recentConvsRef = useRef<DbConversationSummary[]>([])
  const recentConversations = useMemo(() => {
    const next = selectRecentConversationsWithReuse(
      conversations,
      showCompleted,
      sortMode,
      openFolderIds,
      recentConvsRef.current
    )
    recentConvsRef.current = next
    return next
  }, [conversations, showCompleted, sortMode, openFolderIds])

  // Maps each open worktree child folder → its (open) root folder. A child is
  // only redirected when its parent is also open, so a worktree whose root was
  // closed/removed falls back to standing on its own (its conversations stay
  // reachable). The merge is display-only: it never rewrites `conversation.folder_id`.
  const childToParent = useMemo(() => {
    const map = new Map<number, number>()
    for (const f of folders) {
      if (f.parent_id != null && openFolderIds.has(f.parent_id)) {
        map.set(f.id, f.parent_id)
      }
    }
    return map
  }, [folders, openFolderIds])

  // The merge map used for DISPLAY (grouping, counts, theming). When "Show
  // worktrees" is on it is empty, so each worktree child keeps its own bucket /
  // count / theme and renders under its own header. The raw `childToParent`
  // above is still used to know which folders ARE worktree children (nesting
  // order, indent). Off → identical to the historical behavior.
  const displayChildToParent = useMemo(
    () => (showWorktrees ? EMPTY_CHILD_TO_PARENT : childToParent),
    [showWorktrees, childToParent]
  )

  // Hold the previous grouping so unchanged folders keep their bucket array
  // reference across renders (lets memoized FolderGroupItems bail out). Updating
  // the ref inside the memo factory is a deliberate cache, idempotent under
  // StrictMode's double invoke.
  const byFolderRef = useRef<Map<number, DbConversationSummary[]>>(new Map())
  const byFolder = useMemo(() => {
    const grouped = groupByFolderWithReuse(
      folderConversations,
      sortMode,
      byFolderRef.current,
      displayChildToParent
    )
    byFolderRef.current = grouped
    return grouped
  }, [folderConversations, sortMode, displayChildToParent])

  // Counts the unfiltered-but-non-pinned conversations per display group, so the
  // empty-hint renderer distinguishes a truly empty folder from one whose rows
  // are merely hidden by the completed filter. Pinned conversations are excluded
  // (they're not in this folder's bucket), matching `byFolder`.
  const folderTotalCounts = useMemo(() => {
    const map = new Map<number, number>()
    for (const conv of conversations) {
      if (conv.pinned_at != null) continue
      const groupId = displayChildToParent.get(conv.folder_id) ?? conv.folder_id
      map.set(groupId, (map.get(groupId) ?? 0) + 1)
    }
    return map
  }, [conversations, displayChildToParent])

  // Running (`in_progress`) sessions per display group — what the folder header
  // badge shows. Counted off the FULL conversation list rather than `byFolder`
  // on purpose: the badge answers "is there work running in here", so neither
  // the "Show completed" filter nor a session being pinned into the Pinned
  // section should be able to hide it. Deliberately NOT a `buildRows` input, so
  // a status event never rebuilds the row model — it only changes one number on
  // one memoized header.
  const folderRunningCounts = useMemo(() => {
    const map = new Map<number, number>()
    for (const conv of conversations) {
      if (conv.status !== "in_progress") continue
      const groupId = displayChildToParent.get(conv.folder_id) ?? conv.folder_id
      map.set(groupId, (map.get(groupId) ?? 0) + 1)
    }
    return map
  }, [conversations, displayChildToParent])

  // The REORDERABLE folders: worktree child folders are excluded (they follow
  // their parent, never reorder on their own). Hidden chat folders never reach
  // here — the backend already excludes them from the open-folder set
  // (`folder_service::list_open_folder_details`).
  const reorderableFolders = useMemo(
    () => folders.filter((f) => !childToParent.has(f.id)),
    [folders, childToParent]
  )

  // The mixed top-level shape of the Folders section: groups interleaved with
  // ungrouped folders, plus each group's members. Source of truth for both the
  // row model and the drag gesture.
  //
  // While a drag is in flight the optimistic `dragLayout` wins so siblings shift
  // live as the pointer moves — but it is still reconciled against the real
  // folder/group lists on every render, so a folder opened or closed mid-drag
  // (an automation minting a worktree, say) neither disappears nor sticks
  // around. Reconciling means re-deriving from the store and then re-applying
  // the drag's single move, rather than trusting a stale snapshot.
  const storeLayout = useMemo(
    () =>
      buildSidebarLayout({ folders: reorderableFolders, groups: folderGroups }),
    [reorderableFolders, folderGroups]
  )
  const layout = useMemo(
    () => (dragLayout ? reconcileLayout(dragLayout, storeLayout) : storeLayout),
    [storeLayout, dragLayout]
  )

  // Flat id list in render order — what `worktreeChildrenByParent` and
  // `buildRows`' folder count consume.
  const reorderableFolderIds = useMemo(() => layoutFolderIds(layout), [layout])

  // "Show worktrees" container map: repo id → its open worktree child folder ids
  // (sorted). A repo present here renders as a CONTAINER — buildRows nests its
  // own sessions (a "root" sub-group) plus each worktree beneath it, and the
  // whole subtree is gated on the container's own `folderExpanded` entry. Empty
  // when the toggle is off (every folder then renders flat). Depends only on
  // `folders` (+ the toggle), never on `conversations`, so status events don't
  // rebuild it — preserving the single-status-event re-render budget.
  const containerChildren = useMemo(
    () =>
      showWorktrees
        ? worktreeChildrenByParent(reorderableFolderIds, folders)
        : EMPTY_CONTAINER_CHILDREN,
    [showWorktrees, reorderableFolderIds, folders]
  )
  // The repo ids that are containers (have ≥1 open worktree child). Drives the
  // header render's container/plain distinction (total count, subtree toggle).
  const containerRepoIds = useMemo(
    () => new Set(containerChildren.keys()),
    [containerChildren]
  )

  // Resolve each container's HEAD so its "root" sub-group can be labeled with
  // the branch its main worktree is on. Needed because the app-wide branch poll
  // only covers the ACTIVE folder, and working inside a worktree makes the
  // worktree active, not its container — the label would otherwise read a bare
  // "root" forever. `ensureGitHead` is idempotent and de-dupes in-flight reads,
  // so this costs one request per container per session.
  //
  // One-shot, deliberately: the container is refreshed by the regular poll
  // whenever it IS the active folder, and an in-app checkout on it writes the
  // store directly (`use-switch-to-branch`). Only a branch switched from OUTSIDE
  // the app, on a container that is not active, reads stale — the same bargain
  // the tab-bar branch chips already make, and not worth a second poll loop.
  useEffect(() => {
    for (const repoId of containerRepoIds) {
      const path = folderIndex.get(repoId)?.path
      if (path) ensureGitHead(repoId, path)
    }
  }, [containerRepoIds, folderIndex, ensureGitHead])

  // Flat row model for windowing — the pinned section, the folders section, and
  // every conversation live in this ONE array fed to the single Virtualizer (no
  // separate, un-virtualized pinned list). Deliberately excludes `now` (see
  // buildRows): the per-minute label tick must not rebuild rows and break the
  // card memo.
  const rows = useMemo(
    () =>
      buildRows({
        pinned,
        pinnedExpanded,
        // Top-level folders drive the outer order; buildRows nests
        // each container's root sub-group + worktrees via `containerChildren`.
        orderedFolderIds: reorderableFolderIds,
        byFolder,
        folderExpanded,
        folderTotalCounts,
        foldersExpanded,
        chatConversations,
        chatsExpanded,
        chatLimit,
        recentConversations,
        recentExpanded,
        showRecent,
        recentLimit,
        folderPageSize: FOLDER_PAGE_SIZE,
        folderLimitById,
        sectionOrder,
        conversationExpanded,
        childrenByParent,
        childrenLoading,
        containerChildren,
        rootGroupCollapsed,
        layout,
        groupExpanded: folderGroupExpanded,
      }),
    [
      pinned,
      pinnedExpanded,
      reorderableFolderIds,
      byFolder,
      folderExpanded,
      folderTotalCounts,
      foldersExpanded,
      chatConversations,
      chatsExpanded,
      chatLimit,
      recentConversations,
      recentExpanded,
      showRecent,
      recentLimit,
      folderLimitById,
      sectionOrder,
      conversationExpanded,
      childrenByParent,
      childrenLoading,
      containerChildren,
      rootGroupCollapsed,
      layout,
      folderGroupExpanded,
    ]
  )

  // Latest snapshots for the imperative scroll path, refreshed every render so
  // scrollToActive reads current values without being torn down and re-subscribed.
  const rowsRef = useRef<SidebarRow[]>(rows)
  rowsRef.current = rows
  layoutRef.current = layout
  storeLayoutRef.current = storeLayout
  reorderingRef.current = reordering

  const visibleConversationIds = useMemo(
    () =>
      rows
        .filter((row) => row.kind === "conversation")
        .map((row) => row.conversation.id),
    [rows]
  )

  useEffect(() => {
    useConversationUnreadStore.getState().setVisible(visibleConversationIds)
  }, [visibleConversationIds])

  // Drop-target rows for the in-flight drag, and the surface that renders them.
  // Rebuilt from the (reconciled) layout on every render so a folder that
  // appeared or vanished mid-drag is immediately a valid / invalid target — the
  // slot array and what the user sees can never disagree, because they are the
  // same array.
  const dragSlots = useMemo<DragSlot[]>(
    () => (dragging ? buildDragSlots(layout, dragging) : []),
    [dragging, layout]
  )
  dragSlotsRef.current = dragSlots

  // Sticky-overlay lookup tables, rebuilt only when the flat rows change
  // (folder add/remove/expand, not status events). Consumed exclusively by the
  // imperative scroll handler via refs — never passed to a memoized child — so
  // they have zero effect on the card/header memo path.
  const ownerHeaderIndex = useMemo(() => buildOwnerHeaderIndex(rows), [rows])
  const headerFlatIndices = useMemo(() => folderHeaderFlatIndices(rows), [rows])
  const ownerHeaderIndexRef = useRef(ownerHeaderIndex)
  ownerHeaderIndexRef.current = ownerHeaderIndex
  const headerFlatIndicesRef = useRef(headerFlatIndices)
  headerFlatIndicesRef.current = headerFlatIndices

  useImperativeHandle(ref, () => ({
    scrollToActive() {
      scrollToActiveRef.current()
    },
    expandAll() {
      setFolderExpanded((prev) => {
        const next: Record<number, boolean> = { ...prev }
        for (const id of reorderableFolderIds) next[id] = true
        // Worktree children (containers only) are separate folder ids.
        for (const kids of containerChildren.values())
          for (const id of kids) next[id] = true
        saveFolderExpanded(next)
        return next
      })
      // Folder GROUPS are collapsible headers too — leaving one closed is
      // exactly the "the button did nothing" case this control exists to avoid.
      setAllGroupsCollapsed(false)
      // Expand every container's root sub-group too (session-only state).
      setRootGroupCollapsed((prev) => (prev.size === 0 ? prev : new Set()))
      setAllSectionsCollapsed(false)
    },
    collapseAll() {
      setFolderExpanded((prev) => {
        const next: Record<number, boolean> = { ...prev }
        for (const id of reorderableFolderIds) next[id] = false
        for (const kids of containerChildren.values())
          for (const id of kids) next[id] = false
        saveFolderExpanded(next)
        return next
      })
      // Collapse is a fresh look: next expand shows the first page again.
      setFolderLimitById((prev) => (Object.keys(prev).length === 0 ? prev : {}))
      setChatLimit(CHAT_PAGE_SIZE)
      setAllGroupsCollapsed(true)
      setAllSectionsCollapsed(true)
    },
  }))

  useEffect(() => {
    scrollToActiveRef.current = () => {
      if (!selectedConversation) return
      const targetId = selectedConversation.id
      const targetAgent = selectedConversation.agentType
      const conv = conversations.find(
        (c) => c.id === targetId && c.agent_type === targetAgent
      )
      if (!conv) return
      // Each expansion step below defers the actual scroll to the next render
      // (the row only exists in the flat model once visible); this effect re-runs
      // on the expansion-state change with the rebuilt rows available via
      // rowsRef, and chains through multiple steps via pendingScrollRef.
      if (conv.pinned_at != null) {
        // Pinned conversations live in the Pinned section — gated only by that
        // section's collapse, never by any folder.
        if (!pinnedExpanded) {
          setSectionCollapsed((prev) => {
            const next = { ...prev, pinned: false }
            saveSectionCollapsed(next)
            return next
          })
          pendingScrollRef.current = true
          return
        }
      } else if (conv.kind === "chat") {
        // Chat conversations live in the flat Chat section — gated only by that
        // section's collapse, never by any folder.
        if (!chatsExpanded) {
          setSectionCollapsed((prev) => {
            const next = { ...prev, chats: false }
            saveSectionCollapsed(next)
            return next
          })
          pendingScrollRef.current = true
          return
        }
        // The active chat may live beyond the currently revealed page. Grow
        // the limit to the smallest page that contains it, then scroll after
        // the rebuilt row model includes the target.
        const chatIndex = chatConversations.findIndex(
          (candidate) =>
            candidate.id === targetId && candidate.agent_type === targetAgent
        )
        if (chatIndex >= chatLimit) {
          setChatLimit(
            Math.ceil((chatIndex + 1) / CHAT_PAGE_SIZE) * CHAT_PAGE_SIZE
          )
          pendingScrollRef.current = true
          return
        }
      } else {
        // A folder conversation appears only when the Folders section AND its
        // (display) folder are expanded.
        if (!foldersExpanded) {
          setSectionCollapsed((prev) => {
            const next = { ...prev, folders: false }
            saveSectionCollapsed(next)
            return next
          })
          pendingScrollRef.current = true
          return
        }
        // Under "Show worktrees" the conversation may sit inside a container's
        // subtree, which is gated top-down: the container (repo root) must be
        // expanded first, then — for the repo's OWN sessions — its root
        // sub-group. Each step defers the scroll one render (pendingScrollRef).
        if (showWorktrees) {
          const containerRepoId = childToParent.get(conv.folder_id) ?? null
          if (
            containerRepoId != null &&
            !(folderExpanded[containerRepoId] ?? true)
          ) {
            setFolderExpanded((prev) => {
              const next = { ...prev, [containerRepoId]: true }
              saveFolderExpanded(next)
              return next
            })
            pendingScrollRef.current = true
            return
          }
          // The repo's own conversation lives in the indented root sub-group.
          if (containerRepoIds.has(conv.folder_id)) {
            if (!(folderExpanded[conv.folder_id] ?? true)) {
              setFolderExpanded((prev) => {
                const next = { ...prev, [conv.folder_id]: true }
                saveFolderExpanded(next)
                return next
              })
              pendingScrollRef.current = true
              return
            }
            if (rootGroupCollapsed.has(conv.folder_id)) {
              setRootGroupCollapsed((prev) => {
                const next = new Set(prev)
                next.delete(conv.folder_id)
                return next
              })
              pendingScrollRef.current = true
              return
            }
          }
        }
        // A worktree conversation is rendered under its display group's header,
        // so the row's visibility is gated by that group's expansion. With
        // "Show worktrees" off the display group is the parent repo; on, the
        // worktree folder renders its own header, so expand the folder itself.
        const displayFolderId =
          displayChildToParent.get(conv.folder_id) ?? conv.folder_id
        if (!(folderExpanded[displayFolderId] ?? true)) {
          setFolderExpanded((prev) => {
            const next = { ...prev, [displayFolderId]: true }
            saveFolderExpanded(next)
            return next
          })
          pendingScrollRef.current = true
          return
        }
      }
      // Off-screen virtualized rows are not in the DOM, so resolve the flat row
      // index and let virtua scroll to it.
      const index = flatIndexOfConversation(
        rowsRef.current,
        targetId,
        targetAgent
      )
      if (index < 0) return
      virtualizerRef.current?.scrollToIndex(index, {
        align: "center",
        smooth: true,
      })
    }

    if (pendingScrollRef.current) {
      pendingScrollRef.current = false
      scrollToActiveRef.current()
    }
  }, [
    selectedConversation,
    conversations,
    folderExpanded,
    displayChildToParent,
    showWorktrees,
    childToParent,
    containerRepoIds,
    rootGroupCollapsed,
    pinnedExpanded,
    foldersExpanded,
    chatsExpanded,
    chatConversations,
    chatLimit,
  ])

  const toggleFolder = useCallback((folderId: number) => {
    const currentlyExpanded = folderExpandedRef.current[folderId] ?? true
    const nextExpanded = !currentlyExpanded
    // Update the intent ref before scheduling React state so two clicks that
    // arrive before the next render still toggle from the result of the first
    // click instead of both reading the same committed snapshot.
    folderExpandedRef.current = {
      ...folderExpandedRef.current,
      [folderId]: nextExpanded,
    }
    if (currentlyExpanded) {
      // Collapse can shrink the list under the current scroll offset: virtua
      // then reports "scrolled past this header", the sticky overlay stays
      // up, and the in-list copy is `inert` — the folder looks stuck, clicks
      // do nothing. Pin the header to the top whenever we fold while scrolled
      // through it. CRITICAL: scroll FIRST, shrink SECOND. Scrolling the
      // already-shrunken list (single-rAF after the state flip, in either
      // virtua-`scrollToIndex` or direct `scrollTop` form) desynced virtua's
      // layout from the viewport: an invisible stale wrapper then swallowed
      // clicks anywhere in the list until the next real scroll — the "expand
      // needs two clicks" bug. Scrolling the still-UNCHANGED list keeps the
      // scroll event coherent with the row model; the header's flat index
      // (and therefore its target offset) is identical before and after the
      // collapse, so the pre-collapse pin lands exactly where the post-
      // collapse one meant to. scrollToIndex on unchanged content is the
      // same path scrollToActive uses safely.
      const handle = virtualizerRef.current
      const idx = headerIndexForFolder(rowsRef.current, folderId)
      if (
        handle &&
        idx >= 0 &&
        handle.scrollOffset > handle.getItemOffset(idx)
      ) {
        handle.scrollToIndex(idx, { align: "start", smooth: false })
      }
      // "Show more" is a reading gesture for this open: collapse drops the
      // extra pages so the next expand starts at the first 10 again.
      setFolderLimitById((prev) => {
        if (prev[folderId] == null) return prev
        const next = { ...prev }
        delete next[folderId]
        return next
      })
    }
    setFolderExpanded((prev) => {
      const next = { ...prev, [folderId]: nextExpanded }
      saveFolderExpanded(next)
      return next
    })
  }, [])

  // Toggle a container repo's "root" sub-group (its own sessions). Session-only,
  // so unlike `toggleFolder` there is no persistence write.
  const toggleRootGroup = useCallback((repoId: number) => {
    setRootGroupCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(repoId)) {
        next.delete(repoId)
        return next
      }
      next.add(repoId)
      // Same reset as a folder collapse: the root sub-group shares the repo
      // folder id, so reopening it should start at the first page again.
      setFolderLimitById((limits) => {
        if (limits[repoId] == null) return limits
        const cleared = { ...limits }
        delete cleared[repoId]
        return cleared
      })
      return next
    })
  }, [])

  // Lazily fetch a conversation's direct delegation children into the cache.
  // Deduped against both the cache and in-flight requests so a re-toggle or the
  // restore-time guard below can call it freely (idempotent, StrictMode-safe).
  const ensureChildrenLoaded = useCallback(async (id: number) => {
    if (childrenByParentRef.current.has(id)) return
    if (childrenInFlightRef.current.has(id)) return
    childrenInFlightRef.current.add(id)
    // Placeholder BEFORE the fetch: `childrenByParent` is the only routing
    // surface for live child upserts, so a concurrent upsert buffers into this
    // entry instead of being dropped, and the fetch merges them — closing the
    // lost-update race. `childrenLoading` keeps the spinner up while empty.
    setChildrenByParent((prev) => {
      if (prev.has(id)) return prev
      const next = new Map(prev)
      next.set(id, [])
      return next
    })
    setChildrenLoading((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
    try {
      const fetched = await listChildConversations(id)
      setChildrenByParent((prev) => {
        // Drop any child tombstoned while the fetch was in flight — a stale
        // snapshot can still contain a since-deleted child (list_children
        // queried before the soft-delete committed) — then merge the snapshot
        // with live events buffered mid-flight (events win by id) so a child
        // created after the query isn't lost.
        const tomb = deletedChildIdsRef.current
        const liveFetched =
          tomb.size > 0 ? fetched.filter((c) => !tomb.has(c.id)) : fetched
        const buffered = prev.get(id)
        const merged =
          buffered && buffered.length > 0
            ? mergeChildrenById(liveFetched, buffered)
            : liveFetched
        const next = new Map(prev)
        next.set(id, merged)
        return next
      })
    } catch {
      // Roll back the placeholder so a later toggle retries — unless live events
      // already populated it, in which case keep them.
      setChildrenByParent((prev) => {
        const cur = prev.get(id)
        if (cur && cur.length > 0) return prev
        const next = new Map(prev)
        next.delete(id)
        return next
      })
    } finally {
      childrenInFlightRef.current.delete(id)
      setChildrenLoading((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }, [])

  // Toggle a conversation's sub-session subtree. Expanding kicks off a lazy
  // fetch; the Set identity changes so `rows` rebuilds, but the per-card
  // `expanded` boolean is computed per row at render (never the Set passed in),
  // so only the toggled card's prop flips and every other card memo holds.
  const toggleConversation = useCallback(
    (id: number) => {
      setConversationExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(id)) {
          next.delete(id)
        } else {
          next.add(id)
          void ensureChildrenLoaded(id)
        }
        saveConversationExpanded([...next])
        return next
      })
    },
    [ensureChildrenLoaded]
  )

  // Restore-time lazy load, driven by the RENDERED rows (not the raw persisted
  // set): fetch children for every expanded parent actually visible in `rows`
  // but not yet cached. Iterating `rows` keeps this to the reachable next level —
  // a deep restored expansion re-materializes one level per pass as each level's
  // children arrive and `rows` rebuilds — instead of flooding startup with
  // requests for every persisted (possibly stale/deleted/deep) id. An effect (not
  // a render-time microtask) keeps the side effect out of render; the
  // cache/in-flight dedupe makes the repeated passes cheap and StrictMode-safe.
  useEffect(() => {
    if (loading) return
    for (const row of rows) {
      if (row.kind !== "conversation") continue
      const c = row.conversation
      if (
        c.child_count > 0 &&
        conversationExpanded.has(c.id) &&
        !childrenByParentRef.current.has(c.id) &&
        !childrenInFlightRef.current.has(c.id)
      ) {
        void ensureChildrenLoaded(c.id)
      }
    }
  }, [rows, conversationExpanded, loading, ensureChildrenLoaded])

  // ── Sticky folder header overlay ──────────────────────────────────────────
  // Resolve the folder currently scrolled through and the iOS handoff offset
  // from the live virtua geometry. Imperative + ref-only so its identity stays
  // stable (passing it to `<Virtualizer onScroll>` must not re-subscribe the
  // listener) and so it never participates in the memoized render path.
  const recomputeSticky = useCallback(() => {
    const handle = virtualizerRef.current
    const currentRows = rowsRef.current
    const headers = headerFlatIndicesRef.current
    if (!handle || currentRows.length === 0 || headers.length === 0) {
      setStickyFolderId((prev) => (prev === null ? prev : null))
      return
    }
    const scrollOffset = handle.scrollOffset
    const topIndex = Math.max(
      0,
      Math.min(currentRows.length - 1, handle.findItemIndex(scrollOffset))
    )
    const activeHeaderIndex = ownerHeaderIndexRef.current[topIndex]
    if (activeHeaderIndex < 0) {
      setStickyFolderId((prev) => (prev === null ? prev : null))
      return
    }
    const nextHeaderIndex = nextHeaderAfter(headers, activeHeaderIndex)
    const { visible, translateY } = computeStickyState({
      scrollOffset,
      activeHeaderOffset: handle.getItemOffset(activeHeaderIndex),
      nextHeaderOffset:
        nextHeaderIndex == null ? null : handle.getItemOffset(nextHeaderIndex),
      headerHeight: handle.getItemSize(activeHeaderIndex) || 32,
    })
    if (overlayRef.current) {
      overlayRef.current.style.transform = `translateY(${translateY}px)`
    }
    const activeRow = currentRows[activeHeaderIndex]
    const nextFolderId =
      visible && activeRow.kind === "folder" ? activeRow.folderId : null
    setStickyFolderId((prev) => (prev === nextFolderId ? prev : nextFolderId))
  }, [])

  // virtua fires onScroll synchronously per scroll event; coalesce to one
  // recompute per frame and keep the DOM write frame-aligned.
  const handleVirtuaScroll = useCallback(() => {
    if (stickyRafRef.current != null) return
    stickyRafRef.current = requestAnimationFrame(() => {
      stickyRafRef.current = null
      recomputeSticky()
    })
  }, [recomputeSticky])

  // Overlay and in-list headers share `toggleFolder`. Collapse already pins
  // the header when the list was scrolled through it; expand is a no-scroll.

  // Recompute on anything that shifts geometry without firing a scroll event:
  // expand/collapse, data refresh, viewport ready, and the overlay flip itself
  // (so the freshly-mounted overlay node gets its initial transform).
  // `useLayoutEffect` avoids a one-frame stale overlay.
  useIsomorphicLayoutEffect(() => {
    recomputeSticky()
  }, [rows, folderExpanded, viewportEl, stickyFolderId, recomputeSticky])

  useEffect(
    () => () => {
      if (stickyRafRef.current != null) {
        cancelAnimationFrame(stickyRafRef.current)
      }
    },
    []
  )

  const handleRemoveFolder = useCallback(
    (folderId: number) => {
      const name = folderIndex.get(folderId)?.name ?? String(folderId)
      setRemoveConfirm({ folderId, folderName: name })
    },
    [folderIndex]
  )

  const handleManageConversations = useCallback((folderId: number) => {
    setManageFolderId(folderId)
  }, [])

  const handleManageFolderLinks = useCallback(
    (folderId: number) => {
      const folder = allFolders.find((f) => f.id === folderId)
      if (folder) setLinksFolder(folder)
    },
    [allFolders]
  )

  const handleRemoveFolderConfirm = useCallback(async () => {
    if (!removeConfirm) return
    const { folderId, folderName } = removeConfirm
    try {
      closeTabsByFolder(folderId)
      await removeFolderFromWorkspace(folderId)
      toast.success(t("toasts.folderRemoved", { name: folderName }))
    } catch (e) {
      const msg = toErrorMessage(e)
      toast.error(t("toasts.removeFolderFailed", { message: msg }))
    } finally {
      setRemoveConfirm(null)
    }
  }, [removeConfirm, closeTabsByFolder, removeFolderFromWorkspace, t])

  // The card already holds the full summary, so it passes `folderId` back to
  // these callbacks. That removes the `conversations` closure dependency, which
  // is what keeps these references stable across status events — the linchpin
  // for the card `memo` actually bailing out (see Phase 1 of the perf plan).
  const handleSelect = useCallback(
    (id: number, agentType: string, folderId: number) => {
      // Selecting a conversation returns to the conversation workspace if a
      // workbench route (e.g. Automations) was taking over the content region.
      openConversations()
      const opened = openTab(
        folderId,
        id,
        agentType as Parameters<typeof openTab>[2],
        false
      )
      if (!opened) toast.info(t("folderHeaderMenu.splitLimitReached"))
    },
    [openTab, openConversations, t]
  )

  const handleDoubleClick = useCallback(
    (id: number, agentType: string, folderId: number) => {
      openConversations()
      const opened = openTab(
        folderId,
        id,
        agentType as Parameters<typeof openTab>[2],
        true
      )
      if (!opened) toast.info(t("folderHeaderMenu.splitLimitReached"))
    },
    [openTab, openConversations, t]
  )

  const handleRename = useCallback(
    async (id: number, newTitle: string) => {
      await updateConversationTitle(id, newTitle)
      refreshConversations()
    },
    [refreshConversations]
  )

  const handleDelete = useCallback(
    async (id: number, agentType: string, folderId: number) => {
      await deleteConversation(id)
      // No-op if no matching tab is open (the context guards on its tab ref).
      closeConversationTab(
        folderId,
        id,
        agentType as Parameters<typeof openTab>[2]
      )
      refreshConversations()
    },
    [closeConversationTab, refreshConversations]
  )

  const handleStatusChange = useCallback(
    async (id: number, status: ConversationStatus) => {
      updateConversationLocal(id, { status })
      if (status === "completed") {
        useConversationUnreadStore.getState().markRead(id)
      }
      await updateConversationStatus(id, status)
    },
    [updateConversationLocal]
  )

  const handleTogglePin = useCallback(
    async (id: number, nextPinned: boolean) => {
      // Optimistic: instantly move the row into / out of the Pinned section. The
      // upsert echo (emit_conversation_upsert) reconciles the exact server
      // `pinned_at`; on failure the next refresh / WS reconnect corrects it
      // (mirrors handleStatusChange's lenient pattern). Stable callback — only
      // `updateConversationLocal` as a dep — so the card memo keeps bailing out.
      updateConversationLocal(id, {
        pinned_at: nextPinned ? new Date().toISOString() : null,
      })
      await updateConversationPinned(id, nextPinned)
    },
    [updateConversationLocal]
  )

  const handleNewConversation = useCallback(() => {
    // Starting a conversation returns to the conversation workspace if a
    // workbench route (e.g. Automations) was taking over the content region.
    openConversations()
    // With no active folder (all folders closed, or a cold start that recovered
    // to nothing) fall back to folderless chat mode rather than no-op — the
    // same defense the sidebar's own "New chat" row takes, so neither entry
    // point is ever a dead end.
    if (!activeFolder) {
      if (!openChatModeTab()) {
        toast.info(t("folderHeaderMenu.splitLimitReached"))
      }
      return
    }
    if (!openNewConversationTab(activeFolder.id, activeFolder.path)) {
      toast.info(t("folderHeaderMenu.splitLimitReached"))
    }
  }, [
    activeFolder,
    openChatModeTab,
    openNewConversationTab,
    openConversations,
    t,
  ])

  const handleNewConversationForFolder = useCallback(
    (folderId: number) => {
      const folder = folderIndex.get(folderId)
      if (!folder) return
      onNavigate?.()
      // Starting a conversation returns to the conversation workspace if a
      // workbench route (e.g. Automations) was taking over the content region.
      openConversations()
      if (!openNewConversationTab(folderId, folder.path)) {
        toast.info(t("folderHeaderMenu.splitLimitReached"))
      }
    },
    [folderIndex, onNavigate, openNewConversationTab, openConversations, t]
  )

  const handleOpenFolderInSplit = useCallback(
    (folderId: number, side: "left" | "right") => {
      const folder = folderIndex.get(folderId)
      if (!folder) return
      onNavigate?.()
      openConversations()
      const opened = openFolderInSplit(folderId, folder.path, side)
      if (!opened) {
        toast.info(t("folderHeaderMenu.splitLimitReached"))
      }
    },
    [folderIndex, onNavigate, openConversations, openFolderInSplit, t]
  )

  // "Import local sessions" now lives in a dedicated picker window (scan →
  // folder-grouped multi-select → batch import). The folder context-menu entry
  // anchors the picker to its own folder; sidebar refresh arrives via the
  // backend's `conversations://bulk-changed` / `folder://changed` broadcasts,
  // so no local busy state or task tracking remains here.
  const handleImportForFolder = useCallback(
    (folderId: number) => {
      const folder = folderIndex.get(folderId)
      void openImportSessionsWindow({ focusPath: folder?.path ?? null })
    },
    [folderIndex]
  )

  const handleOpenImportWindow = useCallback(() => {
    void openImportSessionsWindow()
  }, [])

  // ── Folder groups ─────────────────────────────────────────────────────────
  // Creating a group opens a small naming dialog rather than dropping an
  // "Untitled" band into the list: a group's whole job is to be labelled, and an
  // inline-rename-after-the-fact flow leaves a meaningless row behind whenever
  // the user is interrupted. `pendingGroupFolderId` carries the folder to move
  // in once created — that is the "New group…" entry inside a folder's "Move to
  // group" submenu, where creating and moving are one intent.
  const [newGroupOpen, setNewGroupOpen] = useState(false)
  const [newGroupName, setNewGroupName] = useState("")
  const [pendingGroupFolderId, setPendingGroupFolderId] = useState<
    number | null
  >(null)
  const [deleteGroupConfirm, setDeleteGroupConfirm] = useState<{
    groupId: number
    name: string
    count: number
  } | null>(null)
  const newGroupIme = useImeGuard()

  const openNewGroupDialog = useCallback(() => {
    setPendingGroupFolderId(null)
    setNewGroupName("")
    setNewGroupOpen(true)
  }, [])

  const handleNewGroupWithFolder = useCallback((folderId: number) => {
    setPendingGroupFolderId(folderId)
    setNewGroupName("")
    setNewGroupOpen(true)
  }, [])

  const handleMoveToGroup = useCallback(
    async (folderId: number, groupId: number | null) => {
      try {
        await setFolderGroupAction(folderId, groupId)
      } catch (e) {
        toast.error(
          t("toasts.moveToGroupFailed", { message: toErrorMessage(e) })
        )
      }
    },
    [setFolderGroupAction, t]
  )

  const confirmNewGroup = useCallback(async () => {
    const name = newGroupName.trim() || t("folderGroup.defaultName")
    const folderId = pendingGroupFolderId
    setNewGroupOpen(false)
    setPendingGroupFolderId(null)
    try {
      const group = await createFolderGroup(name)
      // Created-and-move is two calls, but only the second can fail on its own;
      // an empty group left behind is visible and removable, so there is nothing
      // to unwind.
      if (folderId != null) await setFolderGroupAction(folderId, group.id)
    } catch (e) {
      toast.error(t("toasts.createGroupFailed", { message: toErrorMessage(e) }))
    }
  }, [
    newGroupName,
    pendingGroupFolderId,
    createFolderGroup,
    setFolderGroupAction,
    t,
  ])

  const handleRenameGroup = useCallback(
    async (groupId: number, name: string) => {
      try {
        await updateFolderGroup(groupId, { name })
      } catch (e) {
        toast.error(
          t("toasts.updateGroupFailed", { message: toErrorMessage(e) })
        )
      }
    },
    [updateFolderGroup, t]
  )

  const handleChangeGroupColor = useCallback(
    async (groupId: number, color: FolderThemeColor) => {
      try {
        await updateFolderGroup(groupId, { color })
      } catch (e) {
        toast.error(
          t("toasts.updateGroupFailed", { message: toErrorMessage(e) })
        )
      }
    },
    [updateFolderGroup, t]
  )

  // Deleting an EMPTY group is unambiguous and instantly redoable, so it skips
  // the dialog. A group holding folders gets one, because "delete" reads as
  // "delete the folders too" — the copy is there to say it doesn't.
  const handleDeleteGroup = useCallback(
    (groupId: number) => {
      const group = useAppWorkspaceStore
        .getState()
        .folderGroups.find((g) => g.id === groupId)
      if (!group) return
      const count = layoutRef.current.membersByGroup.get(groupId)?.length ?? 0
      if (count === 0) {
        void deleteFolderGroupAction(groupId).catch((e) => {
          toast.error(
            t("toasts.deleteGroupFailed", { message: toErrorMessage(e) })
          )
        })
        return
      }
      setDeleteGroupConfirm({ groupId, name: group.name, count })
    },
    [deleteFolderGroupAction, t]
  )

  const confirmDeleteGroup = useCallback(async () => {
    const pending = deleteGroupConfirm
    setDeleteGroupConfirm(null)
    if (!pending) return
    try {
      await deleteFolderGroupAction(pending.groupId)
    } catch (e) {
      toast.error(t("toasts.deleteGroupFailed", { message: toErrorMessage(e) }))
    }
  }, [deleteGroupConfirm, deleteFolderGroupAction, t])

  const persistLayout = useCallback(
    async (next: SidebarLayout) => {
      const entries = layoutToEntries(next)
      if (entries.length === 0) return
      setReordering(true)
      try {
        await applySidebarLayout(entries)
      } catch (e) {
        const msg = toErrorMessage(e)
        toast.error(t("toasts.applyLayoutFailed", { message: msg }))
      } finally {
        setReordering(false)
      }
    },
    [applySidebarLayout, t]
  )

  const handleReorder = useCallback((next: SidebarLayout) => {
    pendingLayoutRef.current = next
    setDragLayout(next)
  }, [])

  const handleDragEnd = useCallback(async () => {
    setDragging(null)
    const next = pendingLayoutRef.current
    pendingLayoutRef.current = null
    if (!next) {
      setDragLayout(null)
      return
    }
    try {
      // Reconcile ONE more time against the authoritative layout before
      // writing. The rendered layout is reconciled every render, but this
      // snapshot was taken at the last pointermove — and the workspace can move
      // between that move and the release (another window regrouping a folder,
      // a task closing one, an automation opening a worktree). Persisting the
      // pre-mutation view would let a drop silently overwrite a change the user
      // never saw, because `apply_sidebar_layout` is authoritative for every row
      // it names. Reconciling here keeps "what is written" equal to "what was on
      // screen" — while still carrying the user's last move, which a plain read
      // of the rendered layout could lose if no render flushed after it.
      await persistLayout(reconcileLayout(next, storeLayoutRef.current))
    } finally {
      // Clear the optimistic override once the store has absorbed the new
      // layout (or, on failure, once its rollback has restored the old one).
      setDragLayout(null)
    }
  }, [persistLayout])

  // ── Custom folder-drag gesture ────────────────────────────────────────────
  // Height of one folder header row (Tailwind `h-[2rem]`); the drag surface
  // collapses every folder to just its header so the target slot is a simple
  // `floor(pointerY / FOLDER_ROW_HEIGHT)`.
  //
  // Read off the zoom level rather than pinned at 32: the row is 2 *rem*, so it
  // is 48px at 150%, and a fixed 32 would map the pointer to a slot a third too
  // far down — a drop the gesture then persists as the new folder order.
  const FOLDER_ROW_HEIGHT = 2 * ((16 * zoomLevel) / 100)
  // A trackpad tap commonly settles by a few pixels. Keep the local 16px
  // threshold so a click never mounts the drag surface or toggles unexpectedly.
  const DRAG_THRESHOLD_PX = 16
  const AUTOSCROLL_EDGE_PX = 28
  const AUTOSCROLL_STEP_PX = 12

  const stopAutoscroll = useCallback(() => {
    if (autoscrollRef.current != null) {
      cancelAnimationFrame(autoscrollRef.current)
      autoscrollRef.current = null
    }
  }, [])

  const suppressNextClick = useCallback(() => {
    const onClick = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener("click", onClick, { capture: true, once: true })
    requestAnimationFrame(() => {
      window.removeEventListener("click", onClick, true)
    })
  }, [])

  const updateDragTarget = useCallback(
    (clientY: number) => {
      const state = dragPointerRef.current
      const surface = dragSurfaceRef.current
      if (!state || !surface) return
      const slots = dragSlotsRef.current
      // The surface's live rect already reflects scroll, so no scrollTop term.
      const slotIndex = pointerYToTargetIndex(
        clientY,
        surface.getBoundingClientRect().top,
        0,
        FOLDER_ROW_HEIGHT,
        slots.length
      )
      const slot = slots[slotIndex]
      if (!slot) return
      const current = layoutRef.current
      // Skip the no-op: without this every pointermove would allocate a fresh
      // layout object and re-render the whole surface at pointer frequency.
      const at = locateEntry(current, state.entry)
      if (
        at &&
        at.groupId === slot.target.groupId &&
        at.index === slot.target.index
      ) {
        return
      }
      handleReorder(
        applyLayoutMove(
          current,
          state.entry,
          slot.target.groupId,
          slot.target.index
        )
      )
    },
    [handleReorder, FOLDER_ROW_HEIGHT]
  )

  const maybeAutoscroll = useCallback(
    (clientY: number) => {
      const viewport = viewportRef.current
      if (!viewport) return
      const rect = viewport.getBoundingClientRect()
      const atTop = clientY < rect.top + AUTOSCROLL_EDGE_PX
      const atBottom = clientY > rect.bottom - AUTOSCROLL_EDGE_PX
      if (!atTop && !atBottom) {
        stopAutoscroll()
        return
      }
      if (autoscrollRef.current != null) return
      const step = () => {
        const currentViewport = viewportRef.current
        const state = dragPointerRef.current
        if (!currentViewport || !state) {
          stopAutoscroll()
          return
        }
        const currentRect = currentViewport.getBoundingClientRect()
        const direction =
          state.lastY < currentRect.top + AUTOSCROLL_EDGE_PX ? -1 : 1
        currentViewport.scrollTop += direction * AUTOSCROLL_STEP_PX
        updateDragTarget(state.lastY)
        autoscrollRef.current = requestAnimationFrame(step)
      }
      autoscrollRef.current = requestAnimationFrame(step)
    },
    [stopAutoscroll, updateDragTarget]
  )

  const releaseDragCapture = useCallback(() => {
    const capture = dragCaptureRef.current
    dragCaptureRef.current = null
    if (!capture) return
    try {
      if (capture.target.hasPointerCapture(capture.pointerId)) {
        capture.target.releasePointerCapture(capture.pointerId)
      }
    } catch {
      // The pointer or list surface was already released by WebKit.
    }
  }, [])

  const teardownDragListeners = useCallback(() => {
    dragCleanupRef.current?.()
    dragCleanupRef.current = null
    stopAutoscroll()
    releaseDragCapture()
  }, [releaseDragCapture, stopAutoscroll])

  const cancelDrag = useCallback(() => {
    teardownDragListeners()
    dragPointerRef.current = null
    pendingLayoutRef.current = null
    setDragging(null)
    setDragLayout(null)
  }, [teardownDragListeners])

  const finishDrag = useCallback(() => {
    teardownDragListeners()
    const state = dragPointerRef.current
    dragPointerRef.current = null
    if (state?.started) {
      suppressNextClick()
      void handleDragEnd()
    }
  }, [handleDragEnd, suppressNextClick, teardownDragListeners])

  const captureDragPointer = useCallback((pointerId: number) => {
    if (dragCaptureRef.current) return
    const target = listSurfaceRef.current
    if (!target) return
    try {
      target.setPointerCapture(pointerId)
      dragCaptureRef.current = { target, pointerId }
    } catch {
      // Window listeners remain the fallback when capture is unavailable.
    }
  }, [])

  const onDragPointerMove = useCallback(
    (event: PointerEvent) => {
      const state = dragPointerRef.current
      if (!state || event.pointerId !== state.pointerId) return
      state.lastY = event.clientY
      if (!state.started) {
        const moved = Math.hypot(
          event.clientX - state.startX,
          event.clientY - state.startY
        )
        if (moved < DRAG_THRESHOLD_PX) return
        state.started = true
        captureDragPointer(event.pointerId)
        setDragging(state.entry)
        // Seed the optimistic layout from the current one so the drag surface
        // has something to render before the first target update lands.
        setDragLayout(layoutRef.current)
      }
      updateDragTarget(event.clientY)
      maybeAutoscroll(event.clientY)
    },
    [captureDragPointer, maybeAutoscroll, updateDragTarget]
  )

  const onDragPointerUp = useCallback(
    (event: PointerEvent) => {
      const state = dragPointerRef.current
      if (state && event.pointerId !== state.pointerId) return
      finishDrag()
    },
    [finishDrag]
  )

  const onDragPointerCancel = useCallback(
    (event: PointerEvent) => {
      const state = dragPointerRef.current
      if (state && event.pointerId !== state.pointerId) return
      cancelDrag()
    },
    [cancelDrag]
  )

  const onDragKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelDrag()
    },
    [cancelDrag]
  )

  const onLostPointerCapture = useCallback(
    (event: Event) => {
      const state = dragPointerRef.current
      if (!state) return
      if (
        "pointerId" in event &&
        (event as PointerEvent).pointerId !== state.pointerId
      ) {
        return
      }
      cancelDrag()
    },
    [cancelDrag]
  )

  const onDragWindowBlur = useCallback(() => {
    if (dragPointerRef.current) cancelDrag()
  }, [cancelDrag])

  const onDragVisibilityChange = useCallback(() => {
    if (document.visibilityState !== "visible" && dragPointerRef.current) {
      cancelDrag()
    }
  }, [cancelDrag])

  const beginEntryDrag = useCallback(
    (entry: SidebarEntry, event: React.PointerEvent) => {
      if (event.button !== 0) return
      if (reorderingRef.current) return
      if (dragPointerRef.current) return
      dragPointerRef.current = {
        entry,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastY: event.clientY,
        started: false,
      }
      window.addEventListener("pointermove", onDragPointerMove)
      window.addEventListener("pointerup", onDragPointerUp)
      window.addEventListener("pointercancel", onDragPointerCancel)
      window.addEventListener("keydown", onDragKeyDown)
      window.addEventListener("lostpointercapture", onLostPointerCapture)
      window.addEventListener("blur", onDragWindowBlur)
      document.addEventListener("visibilitychange", onDragVisibilityChange)
      dragCleanupRef.current = () => {
        window.removeEventListener("pointermove", onDragPointerMove)
        window.removeEventListener("pointerup", onDragPointerUp)
        window.removeEventListener("pointercancel", onDragPointerCancel)
        window.removeEventListener("keydown", onDragKeyDown)
        window.removeEventListener("lostpointercapture", onLostPointerCapture)
        window.removeEventListener("blur", onDragWindowBlur)
        document.removeEventListener("visibilitychange", onDragVisibilityChange)
      }
    },
    [
      onDragKeyDown,
      onDragPointerCancel,
      onDragPointerMove,
      onDragPointerUp,
      onDragVisibilityChange,
      onDragWindowBlur,
      onLostPointerCapture,
    ]
  )

  // Per-kind adapters so the memoized headers get an `(id, event)` callback with
  // a stable identity — building `{ kind, id }` inline in the JSX would allocate
  // a fresh function per render and defeat every header's memo.
  const beginFolderDrag = useCallback(
    (folderId: number, event: React.PointerEvent) => {
      beginEntryDrag({ kind: "folder", id: folderId }, event)
    },
    [beginEntryDrag]
  )
  const beginGroupDrag = useCallback(
    (groupId: number, event: React.PointerEvent) => {
      beginEntryDrag({ kind: "group", id: groupId }, event)
    },
    [beginEntryDrag]
  )

  // Safety net: drop listeners / stop autoscroll if the list unmounts mid-drag.
  useEffect(() => () => teardownDragListeners(), [teardownDragListeners])

  // One dialog everywhere: it owns directory selection *and* the follow-up
  // step that links other folders in, so the native picker can't be a separate
  // path that skips half the flow (it is still offered inside the dialog on
  // local desktop). Empty deps — `setBrowserOpen` is a stable setter — so the
  // memoized section header doesn't re-render on every parent render.
  const handleOpenFolderAction = useCallback(() => setBrowserOpen(true), [])

  // Stable trigger for the Clone Repository dialog, passed to the memoized
  // Folders section header. Empty deps (setCloneOpen is a stable setter) so the
  // header doesn't re-render on every parent render.
  const handleOpenCloneDialog = useCallback(() => setCloneOpen(true), [])

  const handleProjectBoot = useCallback(() => {
    openProjectBootWindow().catch((err) => {
      console.error(
        "[SidebarConversationList] failed to open project boot:",
        err
      )
    })
  }, [])

  const showEmptyWorkspaceActions =
    folders.length === 0 && conversations.length === 0

  // A folder's chosen colour drives both its title tint and MaxCode's scoped
  // row theme. The wrapper stays per-row (rather than around the virtualized
  // folder subtree), so the colour remains stable without leaking into sibling
  // folders or breaking virtualization boundaries.
  const folderThemeColor = (folderId: number): FolderThemeColor =>
    normalizeFolderThemeColor(folderIndex.get(folderId)?.color)
  const darkMode = resolvedTheme === "dark"

  // Folder-section sessions indent one step under the header (`depth >= 1`)
  // but must not grow a spine from the folder icon. Skip that first rail
  // unless this row is pinned / chat / Recent (flat) or a worktree / root
  // sub-group (those keep the container connector).
  const folderRailFrom = (
    conv: DbConversationSummary | undefined,
    recent?: true
  ): number => {
    if (!conv || recent) return 0
    if (conv.kind === "chat" || conv.pinned_at != null) return 0
    if (
      showWorktrees &&
      (childToParent.has(conv.folder_id) ||
        containerRepoIds.has(conv.folder_id))
    ) {
      return 0
    }
    return 1
  }

  // A per-row theme wrapper replaces the old per-folder-group wrapper: it scopes
  // the folder's accent color (and dark-mode flip) to that single virtual row.
  const themeWrap = (folderId: number, child: React.ReactNode) => {
    const themeColor = folderThemeColor(folderId)
    return (
      <div
        className={cn(
          darkMode && themeColor !== FOLDER_THEME_COLOR_INHERIT && "dark"
        )}
        data-theme={
          themeColor === FOLDER_THEME_COLOR_INHERIT ? undefined : themeColor
        }
      >
        {child}
      </div>
    )
  }

  // Which group each folder belongs to, straight off the resolved layout, so it
  // agrees with what is actually rendered (including mid-drag) rather than with
  // a possibly-stale `folder.group_id`.
  const groupIdByFolder = useMemo(() => {
    const map = new Map<number, number>()
    for (const [groupId, members] of layout.membersByGroup) {
      for (const memberId of members) map.set(memberId, groupId)
    }
    return map
  }, [layout])

  // A folder inside a group is indented one level, exactly like a worktree
  // sub-group — the same `depth` machinery drives its glyph inset, connector
  // rails and its conversations' indent, so the whole subtree shifts together. A
  // worktree child inherits its repo's group, since the repo is what carries the
  // family into the group.
  const groupDepth = (folderId: number): number => {
    const familyRoot = childToParent.get(folderId) ?? folderId
    return groupIdByFolder.has(familyRoot) ? 1 : 0
  }

  // Running sessions across a container repo and all its worktrees — the count
  // shown on the container header (its own sessions live in the root sub-group,
  // so the bare per-folder number would understate the repo family).
  const containerRunningCount = (repoId: number): number => {
    let total = folderRunningCounts.get(repoId) ?? 0
    const kids = containerChildren.get(repoId)
    if (kids) {
      for (const kid of kids) total += folderRunningCounts.get(kid) ?? 0
    }
    return total
  }

  // The same number one level up: a GROUP's badge is the running sessions across
  // every folder in it. Members are always reorderable top-level folders, so
  // `containerRunningCount` is the right per-member term in both worktree modes
  // — with "Show worktrees" on it adds the worktree children (their own display
  // groups), with it off `folderRunningCounts` has already folded them in.
  //
  // Computed here at render, deliberately NOT in `buildRows`: like the folder
  // badge, a status event must move one number on one memoized header, never
  // rebuild the row model.
  const groupRunningCount = (groupId: number): number => {
    let total = 0
    for (const memberId of layout.membersByGroup.get(groupId) ?? []) {
      total += containerRunningCount(memberId)
    }
    return total
  }

  const folderHeaderElement = (
    folderId: number,
    opts: {
      onToggle?: (folderId: number) => void
      suppressed?: boolean
      dragging?: boolean
      collapsed?: boolean
      grip?: boolean
      /** Render as the container repo's own-sessions "root" sub-group (FolderRoot
       *  glyph, indented, session-only collapse) rather than the repo header. */
      rootGroup?: boolean
      /** Force depth 0. Used by the drag surface, where every row must be the
       *  same fixed height AND the same indent for `pointerYToTargetIndex`; the
       *  surface conveys nesting with its own explicit indent instead. */
      flat?: boolean
    }
  ) => {
    const folderEntry = folderIndex.get(folderId)
    const isRootGroup = opts.rootGroup ?? false
    // A worktree child header (only under "Show worktrees"): indented, FolderGit2
    // glyph, branch label. Keyed off `childToParent` so it matches exactly which
    // folders buildRows nests — an orphan worktree (parent closed) is neither a
    // worktree child nor a container here, so it renders as a plain top-level
    // folder, consistent with its slot.
    const isWorktree =
      !isRootGroup && showWorktrees && childToParent.has(folderId)
    // A container repo (has ≥1 open worktree): plain repo glyph but a count
    // spanning the whole family. Its own sessions render in the root sub-group.
    const isContainer =
      !isRootGroup && showWorktrees && containerRepoIds.has(folderId)
    const variant = isRootGroup ? "root" : isWorktree ? "worktree" : "repo"
    // Sub-group indent (worktree / root) stacks ON TOP of the group indent, so a
    // worktree of a grouped repo sits at depth 2. `opts.flat` zeroes both on the
    // drag surface, whose fixed-height row math needs every row at one indent.
    const depth = opts.flat
      ? 0
      : (isRootGroup || isWorktree ? 1 : 0) + groupDepth(folderId)
    const runningCount = isContainer
      ? containerRunningCount(folderId)
      : (folderRunningCounts.get(folderId) ?? 0)
    const expanded = isRootGroup
      ? !rootGroupCollapsed.has(folderId)
      : opts.collapsed
        ? false
        : (folderExpanded[folderId] ?? true)
    return (
      <FolderHeader
        folderId={folderId}
        folderName={folderEntry?.name ?? String(folderId)}
        folderAlias={folderEntry?.alias ?? null}
        folderPath={folderEntry?.path ?? ""}
        runningCount={runningCount}
        expanded={expanded}
        themeColor={folderThemeColor(folderId)}
        appThemeColor={appThemeColor}
        currentDefaultAgent={folderEntry?.defaultAgentType ?? null}
        availableAgents={availableAgents}
        availableAgentsFresh={availableAgentsFresh}
        onToggle={
          opts.onToggle ?? (isRootGroup ? toggleRootGroup : toggleFolder)
        }
        onRemoveFromWorkspace={handleRemoveFolder}
        onNewConversation={handleNewConversationForFolder}
        onOpenInSplit={handleOpenFolderInSplit}
        onImport={handleImportForFolder}
        onManageConversations={handleManageConversations}
        onManageLinks={handleManageFolderLinks}
        onChangeColor={handleChangeFolderColor}
        onSetAlias={handleSetFolderAlias}
        onSetDefaultAgent={handleChangeFolderDefaultAgent}
        onOpenInSystemExplorer={handleOpenFolderInSystemExplorer}
        onOpenInTerminal={handleOpenFolderInTerminal}
        onOpenInCode={handleOpenFolderInCode}
        // "Move to group" only on real, reorderable folder headers. A worktree
        // sub-group and a container's "root" sub-group follow their repo and
        // can't be grouped on their own, so they get no submenu at all rather
        // than one that silently moves something else.
        folderGroups={isRootGroup || isWorktree ? undefined : folderGroups}
        currentGroupId={groupIdByFolder.get(folderId) ?? null}
        onMoveToGroup={
          isRootGroup || isWorktree ? undefined : handleMoveToGroup
        }
        onNewGroupWithFolder={
          isRootGroup || isWorktree ? undefined : handleNewGroupWithFolder
        }
        isDragging={opts.dragging}
        onGripPointerDown={
          opts.grip !== false && !isRootGroup && !isWorktree
            ? beginFolderDrag
            : undefined
        }
        suppressed={opts.suppressed ?? false}
        depth={depth}
        variant={variant}
        worktreeBranch={folderEntry?.gitBranch ?? null}
        // The container's live HEAD (the root sub-group shares its repo's id).
        // `gitBranch` is only a fallback for shape's sake — the folder row's
        // `git_branch` column is never written by the folder flow.
        rootBranch={
          isRootGroup
            ? (branches.get(folderId) ?? folderEntry?.gitBranch ?? null)
            : null
        }
      />
    )
  }

  const renderRow = (row: SidebarRow) => {
    if (row.kind === "section") {
      // Section headers are not folder-scoped, so they skip themeWrap.
      return (
        <SidebarSectionHeader
          section={row.section}
          expanded={row.expanded}
          onToggle={toggleSection}
          // The chats section gets an always-visible New-chat button (its primary
          // entry point, reachable even when empty). `openChatModeTab` is a stable
          // context callback, so the memo holds. Recent gets the same
          // affordance, but starting a conversation in the ACTIVE FOLDER — the
          // section spans folders and chats alike, and the folder is where a
          // "continue where I left off" list lands you.
          onNewChat={
            row.section === "chats"
              ? openChatModeTab
              : row.section === "recent"
                ? handleNewConversation
                : undefined
          }
          // The folders section gets two right-edge hover actions mirroring the
          // top-of-page NewFolderDropdown: Open Folder and Clone Repository.
          // Both handlers are stable, so the memo holds.
          onOpenFolder={
            row.section === "folders" ? handleOpenFolderAction : undefined
          }
          onCloneRepository={
            row.section === "folders" ? handleOpenCloneDialog : undefined
          }
          // Global "Import local sessions" entry (no folder anchor) — opens
          // the same picker window as the folder context-menu item. Stable
          // callback, so the memo holds.
          onImportSessions={
            row.section === "folders" ? handleOpenImportWindow : undefined
          }
          // "New group" — the one action in this cluster that organises the
          // list rather than adding to it. Stable callback, so the memo holds.
          onNewFolderGroup={
            row.section === "folders" ? openNewGroupDialog : undefined
          }
          // Every section header carries a top gap: it separates "Folders" from
          // the "Pinned" section above it, and — now that a fixed New chat /
          // Search region sits above the scrolled list — gives the first section
          // (Pinned, or Folders when nothing is pinned) the same breathing room
          // below that region instead of butting right up against it.
          topGap
        />
      )
    }
    if (row.kind === "folder-group") {
      const group = folderGroups.find((g) => g.id === row.groupId)
      if (!group) return null
      return (
        <SidebarFolderGroupHeader
          groupId={row.groupId}
          name={group.name}
          runningCount={groupRunningCount(row.groupId)}
          expanded={row.expanded}
          onToggle={toggleFolderGroup}
          onRename={handleRenameGroup}
          onChangeColor={handleChangeGroupColor}
          onDelete={handleDeleteGroup}
          themeColor={normalizeFolderThemeColor(group.color)}
          appThemeColor={appThemeColor}
          isDragging={dragging?.kind === "group" && dragging.id === row.groupId}
          onGripPointerDown={beginGroupDrag}
        />
      )
    }
    if (row.kind === "group-empty") {
      // Folderless hint at the member indent (depth 1), so it reads as being
      // INSIDE the group rather than as another top-level row.
      return (
        <div
          className="flex h-[2rem] items-center text-[0.75rem] text-muted-foreground/70"
          style={{
            paddingLeft: `calc(var(--conv-rail-axis) + 0.875rem + ${CONV_RAIL_DEPTH_STEP})`,
          }}
        >
          <span className="truncate">{t("folderGroup.empty")}</span>
        </div>
      )
    }
    if (row.kind === "folder") {
      return themeWrap(
        row.folderId,
        folderHeaderElement(row.folderId, {
          dragging: dragging?.kind === "folder" && dragging.id === row.folderId,
          // Worktree child headers follow their parent and never reorder on
          // their own, so they are not drag initiators (no grip). Only
          // reorderable top-level repos keep the grip.
          grip: !(showWorktrees && childToParent.has(row.folderId)),
          // While this folder's sticky overlay is showing, the overlay is the
          // accessible control; make the (occluded) in-list copy inert so it is
          // not a duplicate tab stop / announcement.
          suppressed: stickyFolderId === row.folderId,
        })
      )
    }
    if (row.kind === "root-group") {
      // A container repo's own-sessions sub-group. Shares the repo id (for its
      // bucket / count / theme) but is its own row kind with its own toggle, and
      // is never draggable (it follows the container).
      return themeWrap(
        row.folderId,
        folderHeaderElement(row.folderId, {
          dragging: false,
          grip: false,
          rootGroup: true,
        })
      )
    }
    if (row.kind === "empty") {
      // A worktree / root sub-group's empty hint is indented one level so its
      // text lines up under the (depth-1) sub-group's sessions, matching the
      // header. A plain folder's hint stays at depth 0. Group membership adds
      // another level on top, exactly as it does for the header.
      const nested =
        showWorktrees &&
        (childToParent.has(row.folderId) || containerRepoIds.has(row.folderId))
      const depth = (nested ? 1 : 0) + groupDepth(row.folderId)
      return themeWrap(
        row.folderId,
        // Full row height (h-[2rem], the fixed virtua item size) so the container
        // connector spine stays continuous THROUGH an empty sub-group ("no
        // conversations") instead of breaking at a shorter box. The ancestor rail
        // spans this row; it renders nothing at depth 0 (a plain folder has no
        // spine).
        <div
          className="relative flex h-[2rem] items-center text-[0.75rem] text-muted-foreground/70"
          style={{
            paddingLeft: `calc(var(--conv-rail-axis) + 0.875rem + ${depth} * ${CONV_RAIL_DEPTH_STEP})`,
          }}
        >
          <SubsessionAncestorRails depth={nested ? depth : 0} />
          <span className="relative truncate">
            {row.totalConversationCount === 0
              ? t("emptyFolderHint")
              : t("noUnfinishedConversations")}
          </span>
        </div>
      )
    }
    if (row.kind === "chats-empty") {
      // Folderless flat hint — no themeWrap, no conversation rail; align with the
      // section header's text inset (px-[0.5rem]) rather than the folder rail.
      return (
        <div className="px-[0.5rem] py-[0.375rem] text-[0.75rem] text-muted-foreground/70">
          {t("noChats")}
        </div>
      )
    }
    if (row.kind === "chats-more") {
      // Flat, folderless counterpart of the folder paging footer. It follows
      // the same card geometry without a folder theme or ancestor rail.
      return (
        <div className="relative h-[2rem]">
          <button
            type="button"
            onClick={revealMoreChats}
            className="relative flex h-[1.9375rem] w-full items-center rounded-full pr-[0.25rem] text-left text-[0.75rem] text-muted-foreground/80 outline-none transition-colors duration-[120ms] hover:bg-[color-mix(in_oklab,var(--sidebar-accent),var(--sidebar-foreground)_2%)] hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            style={{
              paddingLeft: "calc(var(--conv-rail-axis, 0.875rem) + 0.875rem)",
            }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 flex items-center justify-center"
              style={{
                left: "var(--conv-rail-axis, 0.875rem)",
                width: "0.875rem",
                height: "0.875rem",
                transform: "translate(-50%, -50%)",
              }}
            >
              <ChevronDown className="h-[0.75rem] w-[0.75rem]" />
            </span>
            <span className="truncate">{t("showMoreFolder")}</span>
          </button>
        </div>
      )
    }
    if (row.kind === "folders-empty") {
      // Empty "Folders" section hint — mirrors chats-empty (folderless, no rail,
      // aligned with the section header's text inset). The header's own hover
      // actions (Open Folder / Clone / Import) are how you add the first folder.
      return (
        <div className="px-[0.5rem] py-[0.375rem] text-[0.75rem] text-muted-foreground/70">
          {t("noFolders")}
        </div>
      )
    }
    if (row.kind === "recent-empty") {
      // Empty "Recent" section hint — same folderless, rail-less treatment as
      // the other two. Only reachable in a workspace with no conversations at
      // all, since Recent spans every section.
      return (
        <div className="px-[0.5rem] py-[0.375rem] text-[0.75rem] text-muted-foreground/70">
          {t("noRecent")}
        </div>
      )
    }
    if (row.kind === "recent-more") {
      // Footer of the paged Recent section — a row, not a hint: each click
      // reveals another page. Its geometry is the conversation card's, so the
      // section reads as one column — the chevron sits ON the rail axis exactly
      // where a card's agent icon does (same 0.75rem glyph in the same 0.875rem
      // box, centred on the var), and the label starts at the card's title
      // inset (`axis + 0.875rem`). Same row height and full rounding too, so
      // its hover pill is the one the rows above it use.
      //
      // Two directions live here. While pages remain, the row is "show more"
      // and the reset hides at the right edge as an icon, on the same
      // reveal-on-hover terms as the section headers' actions. Once the last
      // page is out (`remaining === 0`) buildRows keeps the row alive for the
      // reset alone, and it takes over the row: nothing is left to expand, so a
      // hover-only affordance would be the section's only exit hiding itself.
      const showMore = row.remaining > 0
      const resetLabel = t("resetRecentLimit", { count: RECENT_PAGE_SIZE })
      return (
        <div className="group/recent-more relative h-[2rem]">
          <button
            ref={recentMoreButtonRef}
            type="button"
            onClick={showMore ? revealMoreRecent : resetRecentLimit}
            className={cn(
              // Lit from the ROW (`group-hover`), not from this button's own
              // `:hover`. The reset icon is a sibling stacked on top, so with a
              // plain `hover:` the pill went out the moment the pointer crossed
              // onto it — the row read as un-hovered while the cursor was still
              // inside it. Same reason the section headers put their group on
              // the row container rather than the toggle button.
              "relative flex h-[1.9375rem] w-full items-center rounded-full text-left text-[0.75rem] text-muted-foreground/80 outline-none transition-colors duration-[120ms] group-hover/recent-more:bg-[color-mix(in_oklab,var(--sidebar-accent),var(--sidebar-foreground)_2%)] group-hover/recent-more:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              // Reserved unconditionally (not just while hovered) so revealing
              // the reset icon never reflows the label under the cursor.
              showMore && row.canReset ? "pr-[1.75rem]" : "pr-[0.25rem]"
            )}
            style={{
              paddingLeft: "calc(var(--conv-rail-axis, 0.875rem) + 0.875rem)",
            }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 flex items-center justify-center"
              style={{
                left: "var(--conv-rail-axis, 0.875rem)",
                width: "0.875rem",
                height: "0.875rem",
                transform: "translate(-50%, -50%)",
              }}
            >
              {showMore ? (
                <ChevronDown className="h-[0.75rem] w-[0.75rem]" />
              ) : (
                <ChevronsUp className="h-[0.75rem] w-[0.75rem]" />
              )}
            </span>
            <span className="truncate">
              {showMore
                ? t("showMoreRecent", { count: row.remaining })
                : resetLabel}
            </span>
          </button>
          {showMore && row.canReset && (
            // A SIBLING of the row button, never a child: buttons cannot nest.
            // Being a sibling is also why the row's pill has to be driven from
            // the group above — `:hover` only walks ancestors, and this button
            // is not one, so the pill would blink off under the cursor.
            // Geometry copied from the section headers' right-edge actions
            // (`sidebar-section-header.tsx`) so every right-edge affordance in
            // the sidebar lands on the same axis and reads as one family.
            <button
              type="button"
              onClick={resetRecentLimit}
              title={resetLabel}
              aria-label={resetLabel}
              className="absolute top-1/2 right-[0.375rem] flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-end rounded-[0.375rem] text-muted-foreground/90 opacity-0 outline-none transition-[color,opacity] duration-150 group-hover/recent-more:opacity-100 hover:text-sidebar-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [@media(hover:none)]:opacity-100"
            >
              <ChevronsUp className="h-[0.875rem] w-[0.875rem]" />
            </button>
          )}
        </div>
      )
    }
    if (row.kind === "folder-more") {
      // Same row as Recent's "show more", but indented with the folder's
      // conversation cards and themed as that folder. Nested worktree /
      // root-group bodies keep the container spine through this footer.
      const nested =
        showWorktrees &&
        (childToParent.has(row.folderId) || containerRepoIds.has(row.folderId))
      return themeWrap(
        row.folderId,
        <div className="relative h-[2rem]">
          {nested ? <SubsessionAncestorRails depth={row.depth} /> : null}
          <button
            type="button"
            onClick={() => revealMoreFolder(row.folderId)}
            className="relative flex h-[1.9375rem] w-full items-center rounded-full pr-[0.25rem] text-left text-[0.75rem] text-muted-foreground/80 outline-none transition-colors duration-[120ms] hover:bg-[color-mix(in_oklab,var(--sidebar-accent),var(--sidebar-foreground)_2%)] hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            style={{
              paddingLeft: `calc(var(--conv-rail-axis, 0.875rem) + 0.875rem + ${row.depth} * ${CONV_RAIL_DEPTH_STEP})`,
            }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 flex items-center justify-center"
              style={{
                left: `calc(var(--conv-rail-axis, 0.875rem) + ${row.depth} * ${CONV_RAIL_DEPTH_STEP})`,
                width: "0.875rem",
                height: "0.875rem",
                transform: "translate(-50%, -50%)",
              }}
            >
              <ChevronDown className="h-[0.75rem] w-[0.75rem]" />
            </span>
            <span className="relative truncate">{t("showMoreFolder")}</span>
          </button>
        </div>
      )
    }
    if (row.kind === "subsession-loading") {
      // Transient spinner at the child indent while children are fetched. The
      // left inset matches a depth-`row.depth` card's text start: rail axis
      // (0.875rem + depth·CONV_RAIL_DEPTH_STEP) plus the button's extra 0.875rem.
      // Ancestor guide rails keep each parent's vertical line continuous through
      // this placeholder; the content is lifted (relative) above the z-0 rails.
      const parent = conversations.find((c) => c.id === row.parentId)
      return (
        <div
          className="relative py-[0.375rem] text-[0.75rem] text-muted-foreground/70"
          style={{
            paddingLeft: `calc(0.875rem + ${row.depth} * ${CONV_RAIL_DEPTH_STEP} + 0.875rem)`,
          }}
        >
          <SubsessionAncestorRails
            depth={row.depth}
            from={folderRailFrom(parent, row.recent)}
          />
          <span className="relative flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
            {t("loadingSubsessions")}
          </span>
        </div>
      )
    }
    const conv = row.conversation
    // No folder tint reaches this row: a card always renders in the app theme,
    // whichever colour its folder carries. The colour is a label for the FOLDER,
    // not a skin for the sessions inside it.
    return (
      <SidebarConversationCard
        conversation={conv}
        isSelected={
          selectedConversation?.agentType === conv.agent_type &&
          selectedConversation?.id === conv.id
        }
        isOpenInTab={openTabKeys.has(`${conv.agent_type}:${conv.id}`)}
        timeLabel={formatRelative(
          sortMode === "updated" ? conv.updated_at : conv.created_at,
          now
        )}
        onSelect={handleSelect}
        onDoubleClick={handleDoubleClick}
        onRename={handleRename}
        onDelete={handleDelete}
        onStatusChange={handleStatusChange}
        onNewConversation={handleNewConversationForFolder}
        onTogglePin={handleTogglePin}
        depth={row.depth}
        railFrom={folderRailFrom(conv, row.recent)}
        hasChildren={conv.child_count > 0}
        expanded={conversationExpanded.has(conv.id)}
        onToggleExpand={toggleConversation}
      />
    )
  }

  // Keys must be unique across the WHOLE flat array, and the Recent section
  // deliberately re-lists conversations that also appear under their folder or
  // in Chat — so every row a Recent parent can produce carries a `recent-`
  // prefix to stay distinct from its canonical twin.
  const rowKey = (row: SidebarRow): string => {
    if (row.kind === "section") return `section-${row.section}`
    if (row.kind === "folder-group") return `foldergroup-${row.groupId}`
    if (row.kind === "group-empty") return `groupempty-${row.groupId}`
    if (row.kind === "folder") return `folder-${row.folderId}`
    if (row.kind === "root-group") return `rootgroup-${row.folderId}`
    if (row.kind === "empty") return `empty-${row.folderId}`
    if (row.kind === "chats-empty") return "chats-empty"
    if (row.kind === "chats-more") return "chats-more"
    if (row.kind === "folders-empty") return "folders-empty"
    if (row.kind === "recent-empty") return "recent-empty"
    if (row.kind === "recent-more") return "recent-more"
    if (row.kind === "folder-more") return `folder-more-${row.folderId}`
    const prefix = row.recent ? "recent-" : ""
    if (row.kind === "subsession-loading") {
      return `${prefix}subloading-${row.parentId}`
    }
    return `${prefix}conv-${row.conversation.agent_type}-${row.conversation.id}`
  }

  return (
    <div className="relative flex flex-col flex-1 min-h-0">
      {(loading || refreshing) && (
        // z-20 keeps the refresh spinner above the sticky header overlay (z-10),
        // which lives in a later sibling and would otherwise paint over it.
        <div className="absolute top-0 left-0 right-0 flex items-center justify-center py-1 z-20 pointer-events-none">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        </div>
      )}

      {loading && !refreshing ? (
        <div className="px-3 space-y-1.5 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-md" />
          ))}
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center px-3">
          <p className="text-destructive text-xs">
            {t("error", { message: error })}
          </p>
        </div>
      ) : showEmptyWorkspaceActions ? (
        <div className="flex-1 flex flex-col items-center justify-center px-3 gap-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full max-w-[14rem] justify-start"
            onClick={handleOpenFolderAction}
          >
            <FolderOpenDot className="h-3.5 w-3.5 mr-1.5" />
            {tFolderDropdown("openFolder")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full max-w-[14rem] justify-start"
            onClick={() => setCloneOpen(true)}
          >
            <FolderGit2 className="h-3.5 w-3.5 mr-1.5" />
            {tFolderDropdown("cloneRepository")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full max-w-[14rem] justify-start"
            onClick={handleProjectBoot}
          >
            <Rocket className="h-3.5 w-3.5 mr-1.5" />
            {tFolderDropdown("projectBoot")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full max-w-[14rem] justify-start"
            onClick={handleOpenImportWindow}
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            {t("importLocalSessions")}
          </Button>
        </div>
      ) : (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div ref={listSurfaceRef} className="flex-1 min-h-0 relative">
              <ScrollArea
                onViewportRef={handleViewportRef}
                className={cn(
                  "h-full min-h-0 px-1.5 pb-1.5",
                  "[overflow-anchor:none]",
                  "[--conv-rail-axis:0.875rem]"
                )}
              >
                {viewportEl ? (
                  <>
                    {/* Keep the pointerdown node mounted while the collapsed
                        drag surface is shown; WebKit otherwise loses pointerup. */}
                    <div
                      className={cn(
                        dragging !== null &&
                          "pointer-events-none invisible absolute inset-0 overflow-hidden"
                      )}
                      aria-hidden={dragging !== null || undefined}
                    >
                      <Virtualizer
                        ref={virtualizerRef}
                        scrollRef={viewportRef}
                        data={rows}
                        itemSize={32}
                        bufferSize={400}
                        onScroll={handleVirtuaScroll}
                      >
                        {(row: SidebarRow) => (
                          <div key={rowKey(row)}>{renderRow(row)}</div>
                        )}
                      </Virtualizer>
                    </div>
                    {dragging !== null ? (
                      <div
                        ref={dragSurfaceRef}
                        data-folder-drag-surface
                        className="flex flex-col"
                      >
                        {dragSlots.map((slot, index) => {
                          if (slot.render.kind === "ungroup") {
                            return (
                              <div
                                key="ungroup"
                                className={cn(
                                  "flex h-[2rem] items-center rounded-full",
                                  "border border-dashed border-sidebar-border",
                                  "px-[0.75rem] text-[0.75rem] text-muted-foreground/80"
                                )}
                              >
                                <span className="truncate">
                                  {t("folderGroup.dropToUngroup")}
                                </span>
                              </div>
                            )
                          }
                          if (slot.render.kind === "group") {
                            const groupId = slot.render.id
                            const group = folderGroups.find(
                              (g) => g.id === groupId
                            )
                            // Keep the drag slots and rendered rows aligned even
                            // if another window removes a group mid-gesture.
                            if (!group) {
                              return (
                                <div
                                  key={`g-${groupId}`}
                                  className="h-[2rem]"
                                />
                              )
                            }
                            return (
                              <div key={`g-${groupId}`}>
                                <SidebarFolderGroupHeader
                                  presentation
                                  groupId={groupId}
                                  name={group.name}
                                  runningCount={groupRunningCount(groupId)}
                                  expanded={false}
                                  themeColor={normalizeFolderThemeColor(
                                    group.color
                                  )}
                                  appThemeColor={appThemeColor}
                                  isDragging={
                                    dragging.kind === "group" &&
                                    dragging.id === groupId
                                  }
                                />
                              </div>
                            )
                          }
                          const { id: folderId, depth } = slot.render
                          return (
                            <div
                              key={`f-${folderId}-${index}`}
                              style={
                                depth > 0
                                  ? { paddingLeft: CONV_RAIL_DEPTH_STEP }
                                  : undefined
                              }
                            >
                              {themeWrap(
                                folderId,
                                folderHeaderElement(folderId, {
                                  dragging:
                                    dragging.kind === "folder" &&
                                    dragging.id === folderId,
                                  collapsed: true,
                                  grip: false,
                                  flat: true,
                                })
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="flex flex-col gap-1.5 pt-1">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <Skeleton
                        key={i}
                        className="h-[2rem] w-full rounded-md"
                      />
                    ))}
                  </div>
                )}
              </ScrollArea>
              {/*
                Floating sticky folder header. Rendered AFTER ScrollArea so any
                `[data-folder-id]` lookup still resolves the real in-list header
                first (the real one stays mounted within virtua's buffer while
                this overlay also shows). It is a real, accessible control: once
                scrolled past, the in-list header is unmounted by virtua, so the
                overlay is the keyboard/AT path to toggle/act on that folder.
                `bg-sidebar` lives inside themeWrap so it picks up the folder's
                themed background and occludes the rows scrolling beneath it.
              */}
              {stickyFolderId !== null && (
                <div
                  ref={overlayRef}
                  className={cn(
                    "absolute left-0 right-0 top-0 z-10",
                    "px-1.5 [--conv-rail-axis:0.875rem]"
                  )}
                  style={{ willChange: "transform" }}
                >
                  {themeWrap(
                    stickyFolderId,
                    <div className="pointer-events-auto bg-sidebar">
                      {folderHeaderElement(stickyFolderId, {
                        dragging: false,
                        grip: false,
                        onToggle: toggleFolder,
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              onSelect={handleNewConversation}
              disabled={!activeFolder}
            >
              <SquarePen className="h-4 w-4" />
              {t("newConversation")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={handleOpenFolderAction}>
              <FolderOpenDot className="h-4 w-4" />
              {tFolderDropdown("openFolder")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => setCloneOpen(true)}>
              <FolderGit2 className="h-4 w-4" />
              {tFolderDropdown("cloneRepository")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={handleProjectBoot}>
              <Rocket className="h-4 w-4" />
              {tFolderDropdown("projectBoot")}
            </ContextMenuItem>
            {/* The trigger wraps the whole scroll area, so this is also the menu
                a right-click on the "Folders" heading (or on empty space below
                the list) opens — the same entry point as the heading's
                hover-revealed button, reachable without aiming at a 24px
                target. */}
            <ContextMenuItem onSelect={openNewGroupDialog}>
              <LayersPlus className="h-4 w-4" />
              {t("folderGroup.newGroup")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={handleOpenImportWindow}>
              <Download className="h-4 w-4" />
              {t("importLocalSessions")}
            </ContextMenuItem>
            {/* Trailing entry, desktop-only: opening a remote workspace spawns
                another window bound to a different server, which a web client
                can't do. This is where the picker moved to when the fixed
                top-left chrome handed its slot to Search — the status bar's
                quick-actions menu carries the same submenu. Its own group: the
                rows above all act on THIS machine's workspace, while this one
                leaves for another host. The rule lives inside the guard so web
                builds don't render a divider with nothing under it. */}
            {remoteAvailable && (
              <>
                <ContextMenuSeparator />
                <ContextMenuSub
                  onOpenChange={(open) => open && void refreshRemote()}
                >
                  <ContextMenuSubTrigger>
                    <MonitorCloud className="h-4 w-4" />
                    {tRemote("openRemoteWorkspace")}
                  </ContextMenuSubTrigger>
                  {/* The shared sub-content is `overflow-hidden` with no height
                      cap, so a long connection list would strand its tail — the
                      manage row included — offscreen. Bound and scroll it. */}
                  <ContextMenuSubContent className="max-h-(--radix-context-menu-content-available-height) w-72 overflow-x-hidden overflow-y-auto">
                    {remoteConnections.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        {tRemote("empty")}
                      </div>
                    ) : (
                      remoteConnections.map((connection) => (
                        <ContextMenuItem
                          key={connection.id}
                          onSelect={() => openRemote(connection.id)}
                        >
                          <MonitorCloud className="h-4 w-4" />
                          <span className="min-w-0">
                            <span className="block truncate">
                              {connection.name}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {connection.base_url}
                            </span>
                          </span>
                        </ContextMenuItem>
                      ))
                    )}
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => setRemoteManageOpen(true)}>
                      <Settings className="h-4 w-4" />
                      {tRemote("manage")}
                    </ContextMenuItem>
                  </ContextMenuSubContent>
                </ContextMenuSub>
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>
      )}

      <AlertDialog
        open={removeConfirm !== null}
        onOpenChange={(open) => !open && setRemoveConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("removeFolderConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("removeFolderConfirmDescription", {
                name: removeConfirm?.folderName ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveFolderConfirm}>
              {tCommon("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Naming a group up front, rather than dropping an "Untitled" band into
          the list and relying on a follow-up rename that an interrupted user
          never performs. Doubles as the "New group…" step inside a folder's
          "Move to group" submenu — `pendingGroupFolderId` is what makes the two
          one gesture. */}
      <Dialog open={newGroupOpen} onOpenChange={setNewGroupOpen}>
        <DialogContent className="sm:max-w-[24rem]">
          <DialogHeader>
            <DialogTitle>{t("folderGroup.newGroupTitle")}</DialogTitle>
          </DialogHeader>
          <Input
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            {...newGroupIme.props}
            onKeyDown={(e) => {
              // Never commit mid-composition: an IME's candidate-selection
              // Enter would otherwise create a group named half a word.
              if (newGroupIme.isComposing(e)) return
              if (e.key === "Enter") void confirmNewGroup()
            }}
            placeholder={t("folderGroup.namePlaceholder")}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewGroupOpen(false)}>
              {tCommon("cancel")}
            </Button>
            <Button onClick={() => void confirmNewGroup()}>
              {tCommon("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Shown only for a NON-empty group (see `handleDeleteGroup`). The copy's
          job is to say the folders survive — "delete group" otherwise reads as
          "delete the folders in it". */}
      <AlertDialog
        open={deleteGroupConfirm !== null}
        onOpenChange={(open) => !open && setDeleteGroupConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("folderGroup.deleteConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("folderGroup.deleteConfirmDescription", {
                name: deleteGroupConfirm?.name ?? "",
                count: deleteGroupConfirm?.count ?? 0,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDeleteGroup()}>
              {tCommon("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {manageFolderId != null && (
        <ConversationManageDialog
          open
          onOpenChange={(o) => !o && setManageFolderId(null)}
          folderId={manageFolderId}
        />
      )}

      <CloneDialog open={cloneOpen} onOpenChange={setCloneOpen} />
      <WorkspaceFolderDialog open={browserOpen} onOpenChange={setBrowserOpen} />
      {/* Sibling of the context menu, never a child of it: the menu unmounts
          its content on close, which would take a nested dialog with it. Mounted
          only where its submenu exists, so web builds don't carry a dialog
          nothing can open. */}
      {remoteAvailable && (
        <RemoteWorkspaceManageDialog
          open={remoteManageOpen}
          onOpenChange={setRemoteManageOpen}
          onChanged={refreshRemote}
        />
      )}
      {linksFolder && (
        <WorkspaceFolderDialog
          open
          onOpenChange={(o) => !o && setLinksFolder(null)}
          folder={linksFolder}
        />
      )}
    </div>
  )
}
