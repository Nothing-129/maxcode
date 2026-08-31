"use client"

import { memo, useCallback, useState } from "react"
import {
  Check,
  ChevronRight,
  Circle,
  Copy,
  EllipsisVertical,
  Info,
  Link2Off,
  Loader2,
  Pencil,
  Pin,
  PinOff,
  Share2,
  SquarePen,
  Trash2,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { useCollapseSidebarOnNavigate } from "@/hooks/use-collapse-sidebar-on-navigate"
import { useImeGuard } from "@/hooks/use-ime-guard"
import {
  createConversationShare,
  deleteConversation,
  getWebServerStatus,
  revokeConversationShare,
  startWebServer,
  updateConversationPinned,
  updateConversationStatus,
  updateConversationTitle,
} from "@/lib/api"
import {
  buildConversationShareUrl,
  selectConversationShareAddress,
} from "@/lib/conversation-share"
import { formatConversationTitle } from "@/lib/conversation-title"
import { ConversationHeaderFolderPicker } from "@/components/chat/conversation-context-bar"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { useConversationUnreadStore } from "@/stores/conversation-unread-store"
import { useTabActions } from "@/contexts/tab-context"
import { getRuntimeSession } from "@/stores/conversation-runtime-store"
import type { ConversationStatus } from "@/lib/types"
import { STATUS_ORDER } from "@/lib/types"
import { ConversationStatusDot } from "@/components/conversations/conversation-status-dot"
import { useConversationStatusActions } from "@/lib/conversation-status-prefs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { copyTextToClipboard } from "@/lib/utils"
import {
  getServerBaseUrl,
  isDesktop,
  isRemoteDesktopMode,
} from "@/lib/transport"
import {
  resolveActiveSessionDetails,
  type ActiveSessionDetails,
} from "./active-session-details"
import { SessionDetailsDialog } from "./session-details-dialog"

interface ConversationDetailHeaderProps {
  tabId: string
  /** Persisted DB id — null for an unsaved draft (rename / pin / status /
   *  details / delete disabled until the first send persists the row). */
  conversationId: number | null
  /** Virtual runtime key a new conversation streams under before it reconciles
   *  to `conversationId`; used to resolve live session details. */
  runtimeConversationId: number | null
  folderId: number
  folderPath: string | undefined
  title: string
  status: ConversationStatus | undefined
}

/**
 * Conversation detail header (desktop only): the owning folder name + the
 * conversation title on the left; an overflow (⋯) menu on the right. A single
 * instance renders fixed above the tile scroll area, scoped to the ACTIVE
 * conversation, so it never scrolls horizontally when many conversations are
 * tiled.
 *
 * The ⋯ menu mirrors the sidebar conversation card's right-click menu (new /
 * rename / pin / details / status / delete) so the two entry points stay
 * consistent, wired to the same APIs. Subscriptions are kept narrow — a
 * primitive `pinned_at != null` boolean — so the header never re-renders on
 * streaming tokens; details data is read on demand at click time via
 * `getRuntimeSession` / store `getState`.
 */
export const ConversationDetailHeader = memo(function ConversationDetailHeader({
  tabId,
  conversationId,
  runtimeConversationId,
  folderId,
  folderPath,
  title,
  status,
}: ConversationDetailHeaderProps) {
  const t = useTranslations("Folder.conversationCard")
  const ime = useImeGuard()
  const tConv = useTranslations("Folder.conversation")
  const tStatus = useTranslations("Folder.statusLabels")
  const tDetails = useTranslations("Folder.sessionDetails")
  const allowStatusActions = useConversationStatusActions()
  const { closeTab, openNewConversationTab } = useTabActions()
  const collapseSidebarOnNavigate = useCollapseSidebarOnNavigate()
  const updateConversationLocal = useAppWorkspaceStore(
    (s) => s.updateConversationLocal
  )
  const refreshConversations = useAppWorkspaceStore(
    (s) => s.refreshConversations
  )
  // A brand-new (draft-origin) conversation keeps streaming under its virtual
  // runtime key even after it persists — its DB row exists, but the live
  // session (detail/turns) stays keyed by `runtimeConversationId`. So details
  // must target that key; the runtime store resolves the fetchable DB id from
  // it. Rename/pin/status/delete act on `conversationId` (the DB row).
  const runtimeId = runtimeConversationId ?? conversationId
  // Narrow reactive read: a primitive-derived boolean that doesn't change on
  // streaming tokens, so the header stays inert mid-turn.
  const isPinned = useAppWorkspaceStore(
    (s) =>
      conversationId != null &&
      (s.conversations.find((c) => c.id === conversationId)?.pinned_at ??
        null) != null
  )

  const [details, setDetails] = useState<ActiveSessionDetails | null>(null)
  // Snapshot the action target when a dialog OPENS. The header is a SINGLE
  // instance reused across active tabs (see conversation-detail-panel), and the
  // global tab-switch / close-tab shortcuts still fire while a dialog is open —
  // so a rename/delete confirm must act on the conversation the dialog was
  // opened for, not whatever happens to be active at confirm time.
  const [renameTarget, setRenameTarget] = useState<{
    id: number
    title: string
  } | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<{
    id: number
    tabId: string
    title: string
  } | null>(null)
  const [shareTarget, setShareTarget] = useState<{
    id: number
    title: string
  } | null>(null)
  const [shareUrl, setShareUrl] = useState("")
  const [shareError, setShareError] = useState(false)
  const [shareLoading, setShareLoading] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)

  const persisted = conversationId != null
  const displayTitle =
    formatConversationTitle(title) || t("untitledConversation")

  const handleTogglePin = useCallback(() => {
    if (conversationId == null) return
    const next = !isPinned
    // Optimistic: instantly reorder the sidebar row; the upsert echo reconciles
    // the server `pinned_at` (mirrors sidebar card handleTogglePin).
    updateConversationLocal(conversationId, {
      pinned_at: next ? new Date().toISOString() : null,
    })
    updateConversationPinned(conversationId, next).catch((err) => {
      console.error("[ConversationDetailHeader] toggle pin:", err)
    })
  }, [conversationId, isPinned, updateConversationLocal])

  const handleNewConversation = useCallback(() => {
    if (!folderPath) return
    // On touch, get the sidebar out of the way so the fresh draft is visible —
    // same predicate the sidebar's own "new chat" rows collapse under.
    collapseSidebarOnNavigate()
    // Keep the active agent when the folder has no pinned default (matches the
    // panel's right-click "new conversation").
    openNewConversationTab(folderId, folderPath, { inheritFromActive: true })
  }, [collapseSidebarOnNavigate, folderId, folderPath, openNewConversationTab])

  const handleRenameOpen = useCallback(() => {
    if (conversationId == null) return
    setRenameValue(title || "")
    setRenameTarget({ id: conversationId, title })
  }, [conversationId, title])

  const handleRenameConfirm = useCallback(async () => {
    if (renameTarget == null) return
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== renameTarget.title) {
      try {
        await updateConversationTitle(renameTarget.id, trimmed)
        refreshConversations()
      } catch (err) {
        console.error("[ConversationDetailHeader] rename:", err)
      }
    }
    setRenameTarget(null)
  }, [renameTarget, renameValue, refreshConversations])

  const handleStatusChange = useCallback(
    (next: ConversationStatus) => {
      if (conversationId == null) return
      // Optimistic local patch, then persist (mirrors sidebar handleStatusChange).
      updateConversationLocal(conversationId, { status: next })
      if (next === "completed") {
        useConversationUnreadStore.getState().markRead(conversationId)
      }
      updateConversationStatus(conversationId, next).catch((err) => {
        console.error("[ConversationDetailHeader] status change:", err)
      })
    },
    [conversationId, updateConversationLocal]
  )

  const handleDeleteOpen = useCallback(() => {
    if (conversationId == null) return
    setDeleteTarget({ id: conversationId, tabId, title: displayTitle })
  }, [conversationId, tabId, displayTitle])

  const handleDeleteConfirm = useCallback(async () => {
    if (deleteTarget == null) return
    try {
      await deleteConversation(deleteTarget.id)
      // The deleted conversation is gone — close its tab and refresh the list.
      // Not recorded for reopen: there is no longer a conversation to reopen.
      closeTab(deleteTarget.tabId, { recordForReopen: false })
      refreshConversations()
    } catch (err) {
      console.error("[ConversationDetailHeader] delete:", err)
    }
    setDeleteTarget(null)
  }, [deleteTarget, closeTab, refreshConversations])

  const handleOpenDetails = useCallback(() => {
    // Resolve on demand (no reactive whole-session subscription) via the same
    // helper the panel uses; `runtimeId` covers the virtual-key case.
    if (runtimeId == null) return
    const session = getRuntimeSession(runtimeId)
    const conversations = useAppWorkspaceStore.getState().conversations
    const resolved = resolveActiveSessionDetails(
      {
        conversationId,
        runtimeConversationId: runtimeConversationId ?? undefined,
      },
      (id) => (id === runtimeId ? session : null),
      conversations
    )
    if (!resolved.summary) return
    setDetails(resolved)
  }, [conversationId, runtimeConversationId, runtimeId])

  const handleShareOpen = useCallback(() => {
    if (conversationId == null) return
    const target = { id: conversationId, title: displayTitle }
    setShareTarget(target)
    setShareUrl("")
    setShareError(false)
    setShareCopied(false)
    setShareLoading(true)
    void (async () => {
      try {
        const share = await createConversationShare(target.id)
        let baseUrl: string
        if (isRemoteDesktopMode() || !isDesktop()) {
          baseUrl = getServerBaseUrl()
        } else {
          const status =
            (await getWebServerStatus()) ?? (await startWebServer())
          baseUrl = selectConversationShareAddress(status.addresses) ?? ""
        }
        if (!baseUrl) throw new Error("Share server address is unavailable")
        setShareUrl(buildConversationShareUrl(baseUrl, share.token))
      } catch (err) {
        console.error("[ConversationDetailHeader] create share:", err)
        setShareError(true)
      } finally {
        setShareLoading(false)
      }
    })()
  }, [conversationId, displayTitle])

  const handleCopyShare = useCallback(async () => {
    if (!shareUrl) return
    const copied = await copyTextToClipboard(shareUrl)
    setShareCopied(copied)
  }, [shareUrl])

  const handleRevokeShare = useCallback(async () => {
    if (shareTarget == null) return
    setShareLoading(true)
    setShareError(false)
    try {
      await revokeConversationShare(shareTarget.id)
      setShareTarget(null)
      setShareUrl("")
    } catch (err) {
      console.error("[ConversationDetailHeader] revoke share:", err)
      setShareError(true)
    } finally {
      setShareLoading(false)
    }
  }, [shareTarget])

  return (
    // Transparent (no surface class): the title header reads as part of the
    // message canvas below it rather than as a frosted chrome band. With a
    // workspace background image on, the tab strip above it is transparent too,
    // so the whole top of the column reveals the canvas.
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/50 px-3">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {/* Folder selector — replaces the old folder-name breadcrumb. Switches
            folders for a draft; a static chip for a bound conversation. */}
        <ConversationHeaderFolderPicker tabId={tabId} />
        <ChevronRight
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50"
          aria-hidden
        />
        {/* min-w-0 flex-1: the title absorbs the remaining width and takes the
            ellipsis, so the folder crumb on the left stays fully visible. */}
        <span
          className="min-w-0 flex-1 truncate text-sm text-foreground/90"
          title={title}
        >
          {displayTitle}
        </span>
      </div>
      <div className="flex shrink-0 items-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:text-foreground"
              aria-label={tConv("moreActions")}
              title={tConv("moreActions")}
            >
              <EllipsisVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={!folderPath}
              onSelect={handleNewConversation}
            >
              <SquarePen className="h-4 w-4" />
              {t("newConversation")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!persisted} onSelect={handleRenameOpen}>
              <Pencil className="h-4 w-4" />
              {t("rename")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!persisted} onSelect={handleTogglePin}>
              {isPinned ? (
                <PinOff className="h-4 w-4" />
              ) : (
                <Pin className="h-4 w-4" />
              )}
              {isPinned ? t("unpin") : t("pin")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!persisted}
              onSelect={handleOpenDetails}
            >
              <Info className="h-4 w-4" />
              {tDetails("menuLabel")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!persisted} onSelect={handleShareOpen}>
              <Share2 className="h-4 w-4" />
              {t("shareConversation")}
            </DropdownMenuItem>
            {allowStatusActions ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger disabled={!persisted}>
                    <Circle className="h-4 w-4" />
                    {t("status")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {STATUS_ORDER.filter((s) => s !== status).map((s) => (
                      <DropdownMenuItem
                        key={s}
                        onSelect={() => handleStatusChange(s)}
                      >
                        <ConversationStatusDot status={s} />
                        {tStatus(s)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={!persisted}
              onSelect={handleDeleteOpen}
            >
              <Trash2 className="h-4 w-4" />
              {t("delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog
        open={renameTarget != null}
        onOpenChange={(o) => {
          if (!o) setRenameTarget(null)
        }}
      >
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
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              {t("cancel")}
            </Button>
            <Button onClick={handleRenameConfirm}>{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={shareTarget != null}
        onOpenChange={(open) => {
          if (!open) setShareTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("shareDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("shareDialogDescription", {
                title: shareTarget?.title ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          {shareLoading && !shareUrl ? (
            <div className="flex items-center justify-center gap-2 py-5 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("shareCreating")}
            </div>
          ) : null}
          {shareUrl ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input value={shareUrl} readOnly aria-label={t("shareLink")} />
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={handleCopyShare}
                  aria-label={t("shareCopy")}
                >
                  {shareCopied ? (
                    <Check className="size-4" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("shareSnapshotHint")}
              </p>
            </div>
          ) : null}
          {shareError ? (
            <p className="text-sm text-destructive">{t("shareFailed")}</p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={shareLoading || !shareUrl}
              onClick={handleRevokeShare}
            >
              <Link2Off className="size-4" />
              {t("shareRevoke")}
            </Button>
            <Button type="button" onClick={() => setShareTarget(null)}>
              {t("shareDone")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteConversationTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConversationDescription", {
                title: deleteTarget?.title ?? "",
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

      {details?.summary && (
        <SessionDetailsDialog
          open
          onOpenChange={(o) => {
            if (!o) setDetails(null)
          }}
          summary={details.summary}
          stats={details.stats}
          model={details.model}
        />
      )}
    </div>
  )
})
