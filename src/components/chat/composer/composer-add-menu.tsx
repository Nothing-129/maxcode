"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import {
  Command,
  FolderSearch,
  MessageSquareText,
  Plus,
  Search,
  Upload,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DropdownRadioItemContent } from "@/components/chat/dropdown-radio-item-content"
import { rankByTextMatch } from "@/lib/fuzzy-text-match"
import { isImeCompositionKey } from "@/lib/ime-composition"
import { cn } from "@/lib/utils"
import type { AvailableCommandInfo } from "@/lib/types"

import { commandInvocationToken } from "@/components/chat/composer/invocation-reference"
import type { ComposerAttachments } from "@/components/chat/composer/use-composer-attachments"
import type { ComposerShortcuts } from "@/components/chat/composer/use-composer-shortcuts"

/** The submenu geometry every list in this menu shares. */
const SUBMENU_STYLE = {
  maxWidth: "min(20rem, calc(100vw - 1rem))",
  maxHeight: "min(32rem, var(--radix-dropdown-menu-content-available-height))",
} as const

export interface ComposerAddMenuProps {
  disabled?: boolean
  /** File/image attachment entries. Omit to drop the attach section entirely
   *  (a surface whose target can't receive files). */
  attachments?: Pick<
    ComposerAttachments,
    "handleUploadLocalFiles" | "setServerFilePickerOpen"
  > | null
  shortcuts: ComposerShortcuts
  /** The agent's own `/` commands (from a live session or a transient probe). */
  slashCommands: AvailableCommandInfo[]
  triggerClassName?: string
}

/**
 * The composer's "+" menu — attach files, insert a saved quick message, pick a
 * slash command.
 *
 * One component for every composer in the app (conversation, and the to-do task
 * new/edit + follow-up + restart boxes) so the shortcuts a user learns in chat
 * are the same ones on the board, down to the wording: every label here reads
 * from the conversation composer's own message namespace.
 */
export function ComposerAddMenu({
  disabled = false,
  attachments = null,
  shortcuts,
  slashCommands,
  triggerClassName,
}: ComposerAddMenuProps) {
  const t = useTranslations("Folder.chat.messageInput")
  const [open, setOpen] = useState(false)
  const refocusAfterInsert = useRef(false)
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashSearch, setSlashSearch] = useState("")
  const slashInputRef = useRef<HTMLInputElement>(null)

  const filteredSlashCommands = useMemo(
    () =>
      rankByTextMatch(
        slashSearch,
        slashCommands,
        (cmd) => cmd.name,
        (cmd) => cmd.description
      ),
    [slashCommands, slashSearch]
  )

  const handleSlashOpenChange = useCallback((open: boolean) => {
    setSlashOpen(open)
    if (!open) setSlashSearch("")
  }, [])

  useEffect(() => {
    if (!slashOpen) return
    const raf = requestAnimationFrame(() => {
      slashInputRef.current?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [slashOpen])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setOpen(open)
      if (!open) return
      refocusAfterInsert.current = false
      // The editor keeps its selection while the menu is open, so a quick
      // message inserts back at the same caret without tracking an offset.
      shortcuts.refreshQuickMessages()
    },
    [shortcuts]
  )

  const insertSlashCommand = (cmd: AvailableCommandInfo) => {
    refocusAfterInsert.current = true
    shortcuts.insertSlashCommand(cmd)
    setOpen(false)
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          variant="ghost"
          size="icon-xs"
          className={cn(
            "shrink-0 text-muted-foreground focus-visible:ring-0",
            triggerClassName
          )}
          title={t("addActions")}
          aria-label={t("addActions")}
        >
          <Plus className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="min-w-56 w-auto"
        onCloseAutoFocus={(event) => {
          if (!refocusAfterInsert.current) return
          event.preventDefault()
          refocusAfterInsert.current = false
          shortcuts.focusEditor()
        }}
      >
        {attachments ? (
          <>
            <DropdownMenuItem
              onClick={() => {
                attachments.handleUploadLocalFiles().catch((error) => {
                  console.error(
                    "[ComposerAddMenu] upload local files failed:",
                    error
                  )
                })
              }}
            >
              <Upload className="size-4" />
              {t("attachLocalUpload")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => attachments.setServerFilePickerOpen(true)}
            >
              <FolderSearch className="size-4" />
              {t("attachServerFile")}
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <MessageSquareText className="size-4" />
            {t("quickMessages")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            className="min-w-40 overflow-y-auto"
            style={SUBMENU_STYLE}
          >
            {shortcuts.quickMessagesLoading &&
            shortcuts.quickMessages.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                {t("quickMessagesLoading")}
              </div>
            ) : shortcuts.quickMessages.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                {t("quickMessagesEmpty")}
              </div>
            ) : (
              shortcuts.quickMessages.map((message) => (
                <DropdownMenuItem
                  key={message.id}
                  onSelect={() => {
                    refocusAfterInsert.current = true
                    shortcuts.insertQuickMessage(message)
                  }}
                >
                  <span className="truncate">
                    {message.title || (
                      <span className="italic text-muted-foreground">
                        {t("quickMessageUntitled")}
                      </span>
                    )}
                  </span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub open={slashOpen} onOpenChange={handleSlashOpenChange}>
          <DropdownMenuSubTrigger disabled={slashCommands.length === 0}>
            <Command className="size-4" />
            {t("slashCommands")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            className="flex min-w-72 flex-col overflow-hidden p-0"
            style={SUBMENU_STYLE}
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={slashInputRef}
                type="text"
                role="searchbox"
                aria-label={t("slashSearchPlaceholder")}
                value={slashSearch}
                onChange={(e) => setSlashSearch(e.target.value)}
                onKeyDown={(e) => {
                  // Arrow/Enter belong to the IME while a CJK candidate is up,
                  // not to this command list.
                  if (isImeCompositionKey(e)) return
                  if (e.key === "ArrowDown") {
                    e.preventDefault()
                    const container = e.currentTarget.closest(
                      '[data-slot="dropdown-menu-sub-content"]'
                    )
                    const firstItem =
                      container?.querySelector<HTMLElement>('[role="menuitem"]')
                    firstItem?.focus()
                    return
                  }
                  if (e.key === "Enter") {
                    e.preventDefault()
                    const first = filteredSlashCommands[0]
                    if (first) {
                      insertSlashCommand(first)
                    }
                    return
                  }
                  if (e.key === "Escape" || e.key === "Tab") return
                  // Prevent radix DropdownMenu's built-in typeahead from
                  // hijacking letter keys while the user is typing.
                  e.stopPropagation()
                }}
                placeholder={t("slashSearchPlaceholder")}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="flex-1 overflow-y-auto p-1">
              {filteredSlashCommands.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  {t("slashSearchEmpty")}
                </div>
              ) : (
                filteredSlashCommands.map((cmd) => (
                  <DropdownMenuItem
                    key={cmd.name}
                    onSelect={() => insertSlashCommand(cmd)}
                    // Radix focuses the item on pointermove, which fires while
                    // scrolling (items slide under the cursor) and steals focus
                    // from the search input. Short-circuit that default with
                    // preventDefault so the search keeps focus until the user
                    // explicitly clicks.
                    onPointerMove={(e) => e.preventDefault()}
                    onPointerLeave={(e) => e.preventDefault()}
                    className="hover:bg-accent hover:text-accent-foreground"
                  >
                    <DropdownRadioItemContent
                      label={commandInvocationToken(cmd.name)}
                      description={cmd.description}
                    />
                  </DropdownMenuItem>
                ))
              )}
            </div>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
