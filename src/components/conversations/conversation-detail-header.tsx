"use client"

import { openConversationFind } from "@/lib/conversation-find-events"
import { DesktopChromeIcon } from "@/components/layout/desktop-chrome-icon"
import { MobileHeaderSlot } from "@/components/layout/mobile-header-slot"

import { memo, useCallback, useState } from "react"
import {
  Check,
  Copy,
  Info,
  Link2Off,
  Loader2,
  Pencil,
  Pin,
  PinOff,
  Search,
  SquarePen,
  Trash2,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { useCollapseSidebarOnNavigate } from "@/hooks/use-collapse-sidebar-on-navigate"
import { useImeGuard } from "@/hooks/use-ime-guard"
import {
  createConversationShare,
  deleteConversation,
  getWebServiceConfig,
  getWebServerStatus,
  revokeConversationShare,
  startWebServer,
  updateWebServiceConfig,
  updateConversationPinned,
  updateConversationStatus,
  updateConversationTitle,
  type WebServiceConfig,
} from "@/lib/api"
import {
  buildConversationShareUrl,
  normalizeConversationPublicShareUrl,
  resolveConversationShareAddress,
  type ConversationShareAddressSource,
} from "@/lib/conversation-share"
import { formatConversationTitle } from "@/lib/conversation-title"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { useConversationUnreadStore } from "@/stores/conversation-unread-store"
import { useTabActions } from "@/contexts/tab-context"
import { getRuntimeSession } from "@/stores/conversation-runtime-store"
import type { ConversationStatus } from "@/lib/types"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
 * Conversation detail header (inline on desktop, in the nav row on mobile): the owning folder name + the
 * conversation title on the left with a desktop overflow menu, and a new-chat
 * button on the right. A single
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
  const tFind = useTranslations("Folder.chat.conversationFind")
  const ime = useImeGuard()
  const tConv = useTranslations("Folder.conversation")
  const tDetails = useTranslations("Folder.sessionDetails")
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
  const [shareAddressSource, setShareAddressSource] =
    useState<ConversationShareAddressSource | null>(null)
  const [shareNeedsPublicUrl, setShareNeedsPublicUrl] = useState(false)
  const [sharePublicUrlInput, setSharePublicUrlInput] = useState("")
  const [sharePublicUrlInvalid, setSharePublicUrlInvalid] = useState(false)
  const [shareConfig, setShareConfig] = useState<WebServiceConfig | null>(null)

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

  const createShareLink = useCallback(
    async (
      target: { id: number; title: string },
      publicShareUrl: string | null
    ) => {
      setShareNeedsPublicUrl(false)
      setShareError(false)
      setShareLoading(true)
      try {
        const share = await createConversationShare(target.id)
        let runtimeUrl: string | null = null
        let addresses: string[] = []
        if (isRemoteDesktopMode() || !isDesktop()) {
          runtimeUrl = getServerBaseUrl()
        } else {
          const status =
            (await getWebServerStatus()) ?? (await startWebServer())
          addresses = status.addresses
        }
        const resolved = resolveConversationShareAddress({
          publicShareUrl,
          runtimeUrl,
          addresses,
        })
        if (!resolved) throw new Error("Share server address is unavailable")
        setShareAddressSource(resolved.source)
        setShareUrl(buildConversationShareUrl(resolved.baseUrl, share.token))
      } catch (err) {
        console.error("[ConversationDetailHeader] create share:", err)
        setShareError(true)
      } finally {
        setShareLoading(false)
      }
    },
    []
  )

  const handleShareOpen = useCallback(() => {
    if (conversationId == null) return
    const target = { id: conversationId, title: displayTitle }
    setShareTarget(target)
    setShareUrl("")
    setShareError(false)
    setShareCopied(false)
    setShareAddressSource(null)
    setShareNeedsPublicUrl(false)
    setSharePublicUrlInput("")
    setSharePublicUrlInvalid(false)
    setShareConfig(null)
    setShareLoading(true)
    void (async () => {
      try {
        const config = await getWebServiceConfig()
        setShareConfig(config)
        const runtimeUrl =
          isRemoteDesktopMode() || !isDesktop() ? getServerBaseUrl() : null
        const resolved = resolveConversationShareAddress({
          publicShareUrl: config.publicShareUrl,
          runtimeUrl,
        })
        if (
          resolved?.source === "configured_public" ||
          resolved?.source === "runtime_public"
        ) {
          await createShareLink(target, config.publicShareUrl)
          return
        }
        setShareNeedsPublicUrl(true)
      } catch (err) {
        console.error("[ConversationDetailHeader] prepare share:", err)
        setShareError(true)
      } finally {
        setShareLoading(false)
      }
    })()
  }, [conversationId, createShareLink, displayTitle])

  const handleSavePublicUrlAndShare = useCallback(async () => {
    if (shareTarget == null || shareConfig == null) return
    const publicShareUrl =
      normalizeConversationPublicShareUrl(sharePublicUrlInput)
    if (!publicShareUrl) {
      setSharePublicUrlInvalid(true)
      return
    }
    setShareLoading(true)
    setShareError(false)
    try {
      const savedConfig = await updateWebServiceConfig({
        ...shareConfig,
        publicShareUrl,
      })
      setShareConfig(savedConfig)
      await createShareLink(
        shareTarget,
        savedConfig.publicShareUrl ?? publicShareUrl
      )
    } catch (err) {
      console.error("[ConversationDetailHeader] save public share URL:", err)
      setShareError(true)
    } finally {
      setShareLoading(false)
    }
  }, [createShareLink, shareConfig, sharePublicUrlInput, shareTarget])

  const handleUseLocalShareAddress = useCallback(() => {
    if (shareTarget == null) return
    void createShareLink(shareTarget, null)
  }, [createShareLink, shareTarget])

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

  const header = (
    // Transparent (no surface class): the title header reads as part of the
    // message canvas below it rather than as a frosted chrome band. The supplied
    // desktop reference uses a compact title and quiet sharing action, sharing
    // one row with window controls. With a workspace background image on, the whole top
    // of the column reveals the canvas.
    <div
      data-tauri-drag-region
      className="flex h-14 min-w-0 shrink-0 items-center gap-1 md:h-10 md:gap-2 md:pl-[var(--conversation-header-left,0.75rem)] md:pr-[var(--conversation-header-right,0.75rem)]"
    >
      {/* 标题文字占据剩余宽度，超出时截断。 */}
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <span
          className="min-w-0 truncate text-sm leading-5 font-semibold text-foreground"
          title={title}
        >
          {displayTitle}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="hidden size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring md:flex [&_svg]:size-4"
              aria-label={tConv("moreActions")}
              title={tConv("moreActions")}
            >
              <DesktopChromeIcon name="more" />
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
            <DropdownMenuItem
              className="max-md:hidden"
              disabled={runtimeConversationId == null && conversationId == null}
              onSelect={() => {
                const id = runtimeConversationId ?? conversationId
                if (id != null) openConversationFind(id)
              }}
            >
              <Search className="h-4 w-4" />
              {tFind("title")}
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
              <DesktopChromeIcon name="share" />
              {t("shareConversation")}
            </DropdownMenuItem>
            {status !== "completed" && (
              <DropdownMenuItem
                disabled={!persisted}
                onSelect={() => handleStatusChange("completed")}
              >
                <Check className="h-4 w-4" />
                {t("markCompleted")}
              </DropdownMenuItem>
            )}
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

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-11 w-8 shrink-0 rounded-xl md:size-6 md:rounded-md md:text-muted-foreground md:hover:bg-accent md:hover:text-foreground"
        aria-label={t("newConversation")}
        title={t("newConversation")}
        disabled={!folderPath}
        onClick={handleNewConversation}
      >
        <SquarePen aria-hidden="true" className="size-[18px] md:size-4" />
      </Button>

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
          {shareLoading && !shareUrl && !shareNeedsPublicUrl ? (
            <div className="flex items-center justify-center gap-2 py-5 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("shareCreating")}
            </div>
          ) : null}
          {shareNeedsPublicUrl && !shareUrl ? (
            <div className="space-y-2">
              <label
                htmlFor="conversation-share-public-url"
                className="text-sm font-medium"
              >
                {t("sharePublicUrlLabel")}
              </label>
              <Input
                id="conversation-share-public-url"
                value={sharePublicUrlInput}
                onChange={(event) => {
                  setSharePublicUrlInput(event.target.value)
                  setSharePublicUrlInvalid(false)
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void handleSavePublicUrlAndShare()
                  }
                }}
                placeholder={t("sharePublicUrlPlaceholder")}
                aria-invalid={sharePublicUrlInvalid}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                {t("sharePublicUrlHint")}
              </p>
              {sharePublicUrlInvalid ? (
                <p className="text-xs text-destructive">
                  {t("sharePublicUrlInvalid")}
                </p>
              ) : null}
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
              {shareAddressSource === "lan" ||
              shareAddressSource === "loopback" ||
              shareAddressSource === "runtime_private" ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {t("sharePrivateAddressHint")}
                </p>
              ) : null}
            </div>
          ) : null}
          {shareError ? (
            <p className="text-sm text-destructive">{t("shareFailed")}</p>
          ) : null}
          {shareNeedsPublicUrl && !shareUrl ? (
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={shareLoading}
                onClick={handleUseLocalShareAddress}
              >
                {t("shareUseLocalAddress")}
              </Button>
              <Button
                type="button"
                disabled={shareLoading}
                onClick={() => void handleSavePublicUrlAndShare()}
              >
                {shareLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                {t("shareSavePublicUrl")}
              </Button>
            </DialogFooter>
          ) : (
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
          )}
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

  return <MobileHeaderSlot>{header}</MobileHeaderSlot>
})
