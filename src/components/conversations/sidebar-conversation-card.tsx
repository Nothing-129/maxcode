"use client"

import {
  memo,
  useState,
  useCallback,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react"
import {
  AtSign,
  Pencil,
  Trash2,
  SquarePen,
  Pin,
  PinOff,
  CheckCircle2,
  Folder,
  FolderX,
  Info,
  MessageSquare,
  ChevronRight,
  Ellipsis,
  Link2,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { useImeGuard } from "@/hooks/use-ime-guard"
import { useTabStore } from "@/contexts/tab-context"
import { emitAttachSessionToSession } from "@/lib/session-attachment-events"
import type { DbConversationSummary, ConversationStatus } from "@/lib/types"
import { cn } from "@/lib/utils"
import {
  conversationTitleTopic,
  formatConversationTitle,
  parseStructuredConversationTitle,
} from "@/lib/conversation-title"
import { foldReferenceLinks } from "@/lib/reference-link"
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConversationTitleLabel } from "./conversation-title-label"
import { ConversationUnreadDot } from "./conversation-unread-dot"
import { useConversationUnreadStore } from "@/stores/conversation-unread-store"
import { SessionDetailsDialog } from "./session-details-dialog"
import { AgentIcon } from "@/components/agent-icon"

// WebKit can recycle a virtualized row between a Mac trackpad's pointerdown and
// its delayed click. Keep the fine-pointer activation outside the row instance
// so the remounted copy can discard that leftover click instead of selecting
// the conversation twice.
const POINTER_SELECT_GUARD_MS = 400
const recentPointerSelections = new Map<number, number>()

function rememberPointerSelection(conversationId: number) {
  recentPointerSelections.set(conversationId, Date.now())
}

function consumeRecentPointerSelection(conversationId: number) {
  const activatedAt = recentPointerSelections.get(conversationId)
  if (activatedAt === undefined) return false
  recentPointerSelections.delete(conversationId)
  return Date.now() - activatedAt < POINTER_SELECT_GUARD_MS
}

/** Test-only: clear module state between fake-time/remount scenarios. */
export function resetConversationPointerSelectionGuardForTests() {
  recentPointerSelections.clear()
}

/** Restore the established indentation and leave breathing room around icons.
 * Parent/child relationships and guide rails share this 20px depth step. */
export const CONV_RAIL_DEPTH_STEP = "1.25rem"

/**
 * Vertical guide rails for a delegation sub-session's ANCESTORS. A row at `depth`
 * draws one rail per ancestor level (axis 0 … depth−1), each a 2px line at
 * `axis(level) = 0.875rem + level·CONV_RAIL_DEPTH_STEP` from the row's left edge
 * — the same x as that ancestor row's own rail. Stacked across a contiguous
 * subtree they render each parent's rail as a single continuous vertical line
 * running down through all of its descendants, so a child's left rail lines up
 * exactly under its parent's instead of floating one indent step to the right.
 * The row's OWN rail — the one through its agent icon — is drawn separately at
 * `--conv-rail-axis` by the caller.
 *
 * Renders nothing for a root (depth 0). Shared with the list's sub-session
 * loading placeholder so the spine stays continuous while children are fetched.
 *
 * `from` is the root session's visual depth. Folder, worktree and todo
 * indentation must not produce rails; only delegation levels starting at
 * the root session axis connect its actual descendants.
 */
export function SubsessionAncestorRails({
  depth,
  from = 0,
}: {
  depth: number
  from?: number
}) {
  if (depth <= from) return null
  return (
    <>
      {Array.from({ length: depth - from }, (_, i) => {
        const level = from + i
        return (
          <span
            key={level}
            aria-hidden
            data-subsession-rail
            className="pointer-events-none absolute z-0 bg-sidebar-border"
            style={{
              top: "-0.0625rem",
              bottom: "-0.0625rem",
              left: `calc(0.875rem + ${level} * ${CONV_RAIL_DEPTH_STEP})`,
              width: "0.125rem",
              transform: "translateX(-50%)",
            }}
          />
        )
      })}
    </>
  )
}

/**
 * The conversation tab whose composer "add to session" writes into — the active
 * one — or null when no conversation tab is open. Reads the store imperatively so
 * it can serve both the menu's disabled state and the click itself.
 *
 * Deliberately no self-mention guard: the composer's own `@` panel lists every
 * session including the one being typed in, so the sidebar matches it.
 */
function resolveAttachTabId(): string | null {
  const { tabs, activeTabId } = useTabStore.getState()
  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  if (!activeTab || activeTab.kind !== "conversation") return null
  return activeTab.id
}

interface SidebarConversationCardProps {
  conversation: DbConversationSummary
  isSelected: boolean
  selectionId?: string
  isOpenInTab?: boolean
  timeLabel?: string
  showTitleDate?: boolean
  isMobile?: boolean
  compactMobile?: boolean
  stackMetadata?: boolean
  onConversationPointerDown?: (
    event: ReactPointerEvent<HTMLButtonElement>,
    conversation: DbConversationSummary
  ) => boolean
  onSelect: (id: number, agentType: string, folderId: number) => void
  onDoubleClick?: (id: number, agentType: string, folderId: number) => void
  onRename: (id: number, newTitle: string) => Promise<void>
  onDelete: (id: number, agentType: string, folderId: number) => Promise<void>
  onStatusChange: (id: number, status: ConversationStatus) => Promise<void>
  onNewConversation?: (folderId: number) => void
  onTogglePin?: (id: number, nextPinned: boolean) => void
  onLinkTodo?: (id: number, title: string) => void
  /** Delegation-tree nesting depth (0 = root). Drives the per-level indent. */
  depth?: number
  /**
   * Visual depth of the root session in this section. Skip container indent
   * so only delegation descendants draw rails, including in Todo and Recent.
   */
  railFrom?: number
  /** True when `child_count > 0`: the conversation has delegation children, so
   *  the expand chevron is shown. */
  hasChildren?: boolean
  /** Whether this conversation's sub-session subtree is currently expanded. */
  expanded?: boolean
  /** Toggle this conversation's sub-session subtree (lazily loads on expand). */
  onToggleExpand?: (id: number) => void
  /**
   * Folder (or Chat) display name for Recent and mobile ungrouped rows.
   * Stacked rows show it below the title; compact rows may show a muted chip.
   * Folder-section rows already sit under a header and omit it.
   */
  folderLabel?: string
  /** Folder glyph before the label. Chat rows use a message glyph instead. */
  showFolderIcon?: boolean
}

export const SidebarConversationCard = memo(function SidebarConversationCard({
  conversation,
  isSelected,
  isOpenInTab = false,
  timeLabel,
  showTitleDate = true,
  isMobile = false,
  compactMobile = false,
  stackMetadata = false,
  onSelect,
  onConversationPointerDown,
  onDoubleClick,
  onRename,
  onDelete,
  onNewConversation,
  onStatusChange,
  onTogglePin,
  onLinkTodo,
  depth = 0,
  railFrom = 0,
  hasChildren = false,
  expanded = false,
  onToggleExpand,
  folderLabel,
  showFolderIcon = false,
}: SidebarConversationCardProps) {
  const t = useTranslations("Folder.conversationCard")
  const ime = useImeGuard()
  const tSidebar = useTranslations("Folder.sidebar")
  const tDetails = useTranslations("Folder.sessionDetails")
  const tTodos = useTranslations("Todos")
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [renameValue, setRenameValue] = useState("")
  const [attachTabId, setAttachTabId] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const selectConversation = useCallback(() => {
    onSelect(conversation.id, conversation.agent_type, conversation.folder_id)
  }, [
    onSelect,
    conversation.id,
    conversation.agent_type,
    conversation.folder_id,
  ])
  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || event.pointerType !== "mouse") return
      if (onConversationPointerDown?.(event, conversation)) return
      rememberPointerSelection(conversation.id)
      selectConversation()
    },
    [conversation, onConversationPointerDown, selectConversation]
  )
  const handleClick = useCallback(() => {
    if (consumeRecentPointerSelection(conversation.id)) return
    selectConversation()
  }, [conversation.id, selectConversation])

  const handleDblClick = useCallback(() => {
    onDoubleClick?.(
      conversation.id,
      conversation.agent_type,
      conversation.folder_id
    )
  }, [
    onDoubleClick,
    conversation.id,
    conversation.agent_type,
    conversation.folder_id,
  ])

  // Snapshotted on open instead of subscribed: one card renders per visible
  // sidebar row, so a live `useTabStore` selector here would add a store
  // subscription — and a re-render on every tab switch — to each of them for a
  // value only the context menu reads. This snapshot drives the DISABLED STATE
  // only; the click re-resolves (see `handleAttachToSession`).
  const handleMenuOpenChange = useCallback((open: boolean) => {
    setMenuOpen(open)
    if (!open) return
    setAttachTabId(resolveAttachTabId())
  }, [])

  const handleAttachToSession = useCallback(() => {
    // Re-resolved at click time rather than reused from the open-time snapshot:
    // the workspace's `mod+w` / `mod+tab` handler sits on `document`, and Radix
    // lets modifier combos through to it while the menu is open, so the active
    // tab really can change under an open menu. Posting to the stale id would
    // drop the badge into a closed (or now-background) composer and read to the
    // user as "nothing happened".
    const tabId = resolveAttachTabId()
    if (!tabId) return
    emitAttachSessionToSession({ tabId, conversation })
  }, [conversation])

  const handleRenameOpen = useCallback(() => {
    setRenameValue(conversationTitleTopic(conversation.title))
    setRenameOpen(true)
  }, [conversation.title])

  const handleRenameConfirm = useCallback(async () => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== conversation.title) {
      await onRename(conversation.id, trimmed)
    }
    setRenameOpen(false)
  }, [renameValue, conversation.id, conversation.title, onRename])

  const handleDeleteConfirm = useCallback(async () => {
    await onDelete(
      conversation.id,
      conversation.agent_type,
      conversation.folder_id
    )
    setDeleteOpen(false)
  }, [
    conversation.id,
    conversation.agent_type,
    conversation.folder_id,
    onDelete,
  ])

  const isRunning = conversation.status === "in_progress"
  const hasUnread = useConversationUnreadStore((s) =>
    s.unreadIds.has(conversation.id)
  )
  const isPinned = conversation.pinned_at != null
  const isSubsession = conversation.parent_id != null
  const showDoneAction = !isSubsession && conversation.status !== "completed"
  const showHoverActions = !isSubsession
  const stackedLayout = (isMobile && !compactMobile) || stackMetadata
  const showFolderMeta = Boolean(folderLabel) && !(isMobile && compactMobile)
  const stackedTitle = stackedLayout
    ? formatConversationTitle(conversation.title)
    : ""
  const structuredStackedTitle = stackedLayout
    ? parseStructuredConversationTitle(foldReferenceLinks(conversation.title))
    : null

  return (
    <>
      <ContextMenu onOpenChange={handleMenuOpenChange}>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "relative py-px bg-sidebar ws-transparent-bg",
              !stackedLayout && "h-[1.9375rem]",
              // Lift the traveling decoration above opaque sibling rows.
              isSelected && "z-[1]"
            )}
            data-conv-key={`${conversation.agent_type}:${conversation.id}`}
            // Per-level indent: shift the shared rail axis right by one step per
            // depth. Root rows (depth 0) leave the var untouched so they inherit
            // the list's `--conv-rail-axis: 0.875rem` and render exactly as
            // before; the rail, agent icon, status dot, and button padding all
            // key off this var so the whole row indents cohesively.
            style={
              depth > 0
                ? ({
                    "--conv-rail-axis": `calc(0.875rem + ${depth} * ${CONV_RAIL_DEPTH_STEP})`,
                  } as CSSProperties)
                : undefined
            }
          >
            <div
              className={cn(
                // Compact history rows from the supplied desktop reference.
                "group relative flex h-full w-full items-center isolate",
                "text-sidebar-foreground",
                stackMetadata ? "rounded-md" : "rounded-[0.625rem]",
                "transition-colors duration-[120ms]",
                isSelected
                  ? "bg-[#eaeaea] dark:bg-white/[0.1]"
                  : "hover:bg-black/[0.02] dark:hover:bg-white/[0.04]"
              )}
            >
              <button
                data-conversation-id={conversation.id}
                onPointerDown={handlePointerDown}
                onClick={handleClick}
                onDoubleClick={handleDblClick}
                className={cn(
                  "relative flex h-full min-w-0 flex-1 items-center gap-[0.625rem] text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sidebar-foreground",
                  stackedLayout && "py-[0.375rem]",
                  onConversationPointerDown &&
                    "md:cursor-default md:active:cursor-grabbing",
                  "rounded-[0.625rem]",
                  stackedLayout ? "pr-4" : "pr-[0.25rem]"
                )}
                // Leave a 7px gap after the 14px icon at every depth.
                style={{
                  paddingLeft:
                    stackMetadata && !hasChildren
                      ? `calc(1rem + ${depth} * ${CONV_RAIL_DEPTH_STEP})`
                      : "calc(var(--conv-rail-axis, 0.875rem) + 0.875rem)",
                }}
              >
                {/* Ancestor guide rails (depth ≥ 1): keep each parent's vertical
                    line continuous down through this nested row, so the child's
                    left rail aligns under the parent's. */}
                <SubsessionAncestorRails depth={depth} from={railFrom} />
                {/* This row's OWN rail, through its agent icon. Omitted for
                    root sessions in every section: only delegation children
                    draw a rail, so independent siblings never share a spine. */}
                {depth > railFrom && (
                  <span
                    aria-hidden
                    data-conversation-rail
                    className={cn(
                      "pointer-events-none absolute z-0 bg-sidebar-border"
                    )}
                    style={{
                      top: "-0.0625rem",
                      bottom: "-0.0625rem",
                      left: "var(--conv-rail-axis, 0.875rem)",
                      width: "0.125rem",
                      transform: "translateX(-50%)",
                    }}
                  />
                )}
                {!stackMetadata && (
                  <div
                    className={cn(
                      "pointer-events-none absolute top-1/2 z-10 flex items-center justify-center overflow-visible",
                      // With children, the row hover (or focus) swaps this agent
                      // icon out for the expand chevron at the same spot — fade it
                      // so the two cross-fade in place. On touch (no hover) the
                      // chevron is always shown, so the icon is always hidden.
                      hasChildren &&
                        onToggleExpand &&
                        "transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0 [@media(hover:none)]:opacity-0"
                    )}
                    style={{
                      left: "var(--conv-rail-axis, 0.875rem)",
                      width: "0.875rem",
                      height: "0.875rem",
                      transform: "translate(-50%, -50%)",
                    }}
                    aria-hidden
                  >
                    <AgentIcon
                      agentType={conversation.agent_type}
                      className="h-[0.875rem] w-[0.875rem]"
                    />
                  </div>
                )}

                {stackedLayout ? (
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span
                      data-open-in-tab={isOpenInTab || undefined}
                      className={cn(
                        "maxcode-sidebar-label min-w-0 truncate text-[0.875rem] leading-[1.25rem] font-[430]",
                        stackMetadata ? "pr-6" : "pr-12"
                      )}
                    >
                      {stackedTitle || t("untitledConversation")}
                    </span>
                    {(structuredStackedTitle ||
                      showFolderMeta ||
                      timeLabel ||
                      conversation.origin_cwd) &&
                      (stackMetadata ? (
                        <span
                          data-mobile-conversation-meta
                          className="flex min-w-0 items-center gap-1 text-xs leading-[0.875rem] text-muted-foreground"
                        >
                          <AgentIcon
                            agentType={conversation.agent_type}
                            className="size-3 shrink-0"
                          />
                          {showFolderMeta && (
                            <span
                              title={folderLabel}
                              className="min-w-0 truncate"
                            >
                              {folderLabel}
                            </span>
                          )}
                          {showFolderMeta && timeLabel && (
                            <span aria-hidden>·</span>
                          )}
                          <span className="shrink-0">{timeLabel}</span>
                          {conversation.origin_cwd && (
                            <FolderX
                              className="size-3 shrink-0"
                              aria-label={tSidebar("worktreeRemovedBadge")}
                            />
                          )}
                        </span>
                      ) : (
                        <span
                          data-mobile-conversation-meta
                          className="grid min-w-0 grid-cols-[4ch_minmax(0,1fr)_auto] items-center gap-2 text-xs leading-[0.875rem] text-muted-foreground"
                        >
                          <span className="tabular-nums">
                            {structuredStackedTitle?.date}
                          </span>
                          <span className="flex min-w-0 items-center gap-1">
                            {showFolderMeta && (
                              <span
                                title={folderLabel}
                                className="min-w-0 truncate"
                              >
                                {folderLabel}
                              </span>
                            )}
                            {conversation.origin_cwd && (
                              <span title={tSidebar("worktreeRemovedBadge")}>
                                <FolderX
                                  className="size-3 shrink-0"
                                  aria-hidden
                                />
                                <span className="sr-only">
                                  {tSidebar("worktreeRemovedBadge")}
                                </span>
                              </span>
                            )}
                          </span>
                          <span className="text-right tabular-nums">
                            {timeLabel}
                          </span>
                        </span>
                      ))}
                  </span>
                ) : (
                  <span
                    className={cn(
                      // Clip the Recent chip instead of painting it over the time.
                      "flex min-w-0 flex-1 items-center overflow-hidden",
                      showFolderMeta && "gap-[0.375rem]"
                    )}
                  >
                    <ConversationTitleLabel
                      data-open-in-tab={isOpenInTab || undefined}
                      className={cn(
                        "maxcode-sidebar-label relative min-w-0 text-[0.875rem] leading-[1.375rem] font-[430]",
                        showFolderMeta
                          ? "shrink grow-0 overflow-hidden"
                          : "flex-1"
                      )}
                      title={conversation.title}
                      showDate={showTitleDate}
                      fallback={t("untitledConversation")}
                    />
                    {/* Re-parented out of a removed worktree: history loads fine,
                      but "continue" may need a fresh session (the agent's files
                      were keyed to the old path). */}
                    {conversation.origin_cwd ? (
                      <span
                        className="inline-flex shrink-0 items-center"
                        title={tSidebar("worktreeRemovedBadge")}
                      >
                        <FolderX
                          className="h-3 w-3 text-muted-foreground/60"
                          aria-hidden
                        />
                        <span className="sr-only">
                          {tSidebar("worktreeRemovedBadge")}
                        </span>
                      </span>
                    ) : null}
                    {showFolderMeta ? (
                      <span
                        data-recent-folder
                        title={folderLabel}
                        className="flex min-w-[0.625rem] max-w-[7.5rem] shrink-[999] items-center gap-[0.25rem] overflow-hidden text-xs leading-[0.875rem] text-muted-foreground"
                      >
                        {showFolderIcon ? (
                          <Folder
                            data-recent-source="folder"
                            className="h-[0.625rem] w-[0.625rem] shrink-0"
                            strokeWidth={1.5}
                            aria-hidden
                          />
                        ) : (
                          <MessageSquare
                            data-recent-source="chat"
                            className="h-[0.625rem] w-[0.625rem] shrink-0"
                            strokeWidth={1.5}
                            aria-hidden
                          />
                        )}
                        <span className="min-w-0 truncate">{folderLabel}</span>
                      </span>
                    ) : null}
                  </span>
                )}
              </button>

              {/* Expand/collapse affordance for delegation children. It overlays
                  the agent icon at the rail axis: idle shows the icon, and
                  hovering (or focusing) the row swaps in this chevron at the very
                  same spot while the icon fades. A sibling of the row button (HTML
                  forbids nested buttons) with `stopPropagation` so a toggle never
                  selects the row; pointer events stay off until revealed so a
                  click on the icon area still selects the row when not hovering. */}
              {hasChildren && onToggleExpand && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleExpand(conversation.id)
                  }}
                  aria-label={
                    expanded ? t("collapseSubsessions") : t("expandSubsessions")
                  }
                  aria-expanded={expanded}
                  title={
                    expanded ? t("collapseSubsessions") : t("expandSubsessions")
                  }
                  className={cn(
                    "absolute top-0 bottom-0 z-20 flex items-center justify-center",
                    "cursor-pointer outline-none",
                    "opacity-0 pointer-events-none transition-opacity duration-150",
                    "group-hover:opacity-100 group-hover:pointer-events-auto",
                    "group-focus-within:opacity-100 group-focus-within:pointer-events-auto",
                    "[@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto"
                  )}
                  style={{
                    left: "var(--conv-rail-axis, 0.875rem)",
                    width: "0.875rem",
                    transform: "translateX(-50%)",
                  }}
                >
                  <ChevronRight
                    aria-hidden
                    className={cn(
                      "h-3 w-3 shrink-0 text-muted-foreground/70",
                      "transition-transform duration-200 ease-out",
                      expanded && "rotate-90"
                    )}
                  />
                </button>
              )}

              {/* Status stays in its own slot while the adjacent actions menu opens. */}
              <div
                className={cn(
                  stackedLayout
                    ? "absolute right-4 top-1/2 -translate-y-1/2 flex items-center"
                    : "flex h-full shrink-0 items-center pr-[0.375rem]",
                  showFolderMeta && !stackedLayout && "ml-[0.375rem]"
                )}
              >
                <span
                  data-conversation-status=""
                  className={cn(
                    "flex items-center",
                    stackedLayout && "w-3 justify-end"
                  )}
                >
                  {isRunning ? (
                    <span
                      className="relative inline-flex shrink-0 items-center justify-center"
                      title={tSidebar("statusRunningBadge")}
                    >
                      <svg
                        data-running-spinner
                        className="size-3 animate-spin text-[#858585] dark:text-[#a3a3a3]"
                        viewBox="0 0 12 12"
                        fill="none"
                        aria-hidden="true"
                      >
                        <circle
                          cx="6"
                          cy="6"
                          r="4.5"
                          stroke="currentColor"
                          strokeOpacity="0.25"
                          strokeWidth="1.5"
                        />
                        <path
                          d="M6 1.5a4.5 4.5 0 0 1 4.5 4.5"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                      </svg>
                      <span className="sr-only">
                        {tSidebar("statusRunningBadge")}
                      </span>
                    </span>
                  ) : hasUnread ? (
                    <ConversationUnreadDot label={tSidebar("unreadBadge")} />
                  ) : timeLabel && !stackedLayout ? (
                    <span
                      className={cn(
                        "relative shrink-0 text-xs tabular-nums text-muted-foreground",
                        isSelected && "font-medium"
                      )}
                    >
                      {timeLabel}
                    </span>
                  ) : null}
                </span>
                {showHoverActions &&
                  !(stackedLayout && hasUnread) &&
                  !(stackMetadata && isRunning) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("moreActions")}
                      title={t("moreActions")}
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      data-state={menuOpen ? "open" : "closed"}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation()
                        // Open the row's actual context menu, just like the
                        // folder menu, so both entry points stay identical.
                        const rect = event.currentTarget.getBoundingClientRect()
                        event.currentTarget.dispatchEvent(
                          new MouseEvent("contextmenu", {
                            bubbles: true,
                            cancelable: true,
                            button: 2,
                            clientX: rect.left,
                            clientY: rect.bottom,
                          })
                        )
                      }}
                      className={cn(
                        "ml-1 size-6 rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100",
                        isMobile && "opacity-100",
                        stackedLayout &&
                          "absolute right-0 top-1/2 -translate-y-1/2 ml-0 justify-center p-0"
                      )}
                    >
                      <Ellipsis className="size-3.5" />
                    </Button>
                  )}
              </div>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {showDoneAction && (
            <ContextMenuItem
              onSelect={() => onStatusChange(conversation.id, "completed")}
            >
              <CheckCircle2 className="size-4" />
              {t("markCompleted")}
            </ContextMenuItem>
          )}
          {onLinkTodo && !isSubsession && (
            <ContextMenuItem
              onSelect={() =>
                onLinkTodo(
                  conversation.id,
                  formatConversationTitle(conversation.title) ||
                    t("untitledConversation")
                )
              }
            >
              <Link2 className="size-4" />
              {tTodos("linkConversation")}
            </ContextMenuItem>
          )}
          {onNewConversation && (
            <>
              <ContextMenuItem
                onSelect={() => onNewConversation(conversation.folder_id)}
              >
                <SquarePen className="h-4 w-4" />
                {t("newConversation")}
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem onSelect={handleRenameOpen}>
            <Pencil className="h-4 w-4" />
            {t("rename")}
          </ContextMenuItem>
          {onTogglePin && (
            <ContextMenuItem
              onSelect={() => onTogglePin(conversation.id, !isPinned)}
            >
              {isPinned ? (
                <PinOff className="h-4 w-4" />
              ) : (
                <Pin className="h-4 w-4" />
              )}
              {isPinned ? t("unpin") : t("pin")}
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={() => setDetailsOpen(true)}>
            <Info className="h-4 w-4" />
            {tDetails("menuLabel")}
          </ContextMenuItem>
          {/* Mirrors the file tree's "add to session": inserts an `@`-style
              mention of THIS conversation into the active session's composer.
              Disabled only when no conversation tab is open — there is no
              composer to write into then. */}
          <ContextMenuItem
            onSelect={handleAttachToSession}
            disabled={!attachTabId}
          >
            <AtSign className="h-4 w-4" />
            {t("attachToCurrentSession")}
          </ContextMenuItem>

          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onSelect={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
            {t("delete")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("renameConversation")}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            {...ime.props}
            onKeyDown={(e) => {
              if (ime.isComposing(e)) return
              if (e.key === "Enter") handleRenameConfirm()
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={handleRenameConfirm}>{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteConversationTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConversationDescription", {
                title:
                  formatConversationTitle(conversation.title) ||
                  t("untitledConversation"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {detailsOpen && (
        <SessionDetailsDialog
          open
          onOpenChange={setDetailsOpen}
          summary={conversation}
        />
      )}
    </>
  )
})
