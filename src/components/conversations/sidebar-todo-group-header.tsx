"use client"

import { memo, useState } from "react"
import {
  ChevronRight,
  Ellipsis,
  Info,
  ListTodo,
  Plus,
  Loader2,
  Check,
  RotateCcw,
  Clock,
} from "lucide-react"
import { useTranslations } from "next-intl"
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu"
import type { TodoStatus } from "@/lib/todos"
import {
  formatConversationTitle,
  parseStructuredConversationTitle,
} from "@/lib/conversation-title"
import { cn } from "@/lib/utils"

export const SidebarTodoGroupHeader = memo(function SidebarTodoGroupHeader({
  id,
  title,
  createdAt,
  expanded,
  onToggle,
  onOpen,
  onComplete,
  status = "claimed",
  completing = false,
  onNewConversation,
  creating = false,
  disabled = false,
}: {
  id: string
  title: string
  createdAt?: string
  expanded: boolean
  onToggle: (id: string) => void
  onOpen: (id: string) => void
  status?: TodoStatus
  onComplete?: (id: string, action?: "complete" | "finish" | "resume") => void
  completing?: boolean
  onNewConversation?: (id: string) => void
  creating?: boolean
  disabled?: boolean
}) {
  const t = useTranslations("Todos")
  const tCard = useTranslations("Folder.conversationCard")
  const [menuOpen, setMenuOpen] = useState(false)
  const createdDate = createdAt ? new Date(createdAt) : null
  const dateLabel =
    createdDate && !Number.isNaN(createdDate.getTime())
      ? `${String(createdDate.getMonth() + 1).padStart(2, "0")}/${String(createdDate.getDate()).padStart(2, "0")}`
      : null
  const awaitingVerification = status === "pending_verification"
  const formattedTitle = formatConversationTitle(title)
  const structuredTitle = parseStructuredConversationTitle(formattedTitle)
  const displayDate =
    dateLabel || structuredTitle?.date?.replace(/^(\d{2})(\d{2})$/, "$1/$2")
  const statusBadge = (
    <span className="min-w-0 truncate font-normal">
      {t(
        status === "completed"
          ? "colCompleted"
          : awaitingVerification
            ? "sidebarPendingVerification"
            : "sidebarProcessing"
      )}
    </span>
  )
  const header = (
    <div
      className="group/todo-header relative flex min-w-0 items-center gap-0.5 rounded-md transition-colors hover:bg-sidebar-foreground/5 has-[[data-state=open]]:bg-sidebar-foreground/5"
      data-todo-group-id={id}
    >
      <button
        type="button"
        aria-expanded={expanded}
        title={title}
        onClick={() => onToggle(id)}
        className="group flex min-w-0 flex-1 items-center gap-[0.4375rem] rounded-md py-1 pl-4 pr-4 text-left text-[0.875rem] leading-5 text-sidebar-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0 group-hover/todo-header:pr-14 group-has-[:focus-visible]/todo-header:pr-14 max-md:pr-14 [@media(hover:none)]:pr-14 [@media(pointer:coarse)]:pr-14 group-has-[[data-state=open]]/todo-header:pr-14">
          <span
            data-todo-title
            className="maxcode-sidebar-label min-w-0 truncate text-[0.875rem] leading-[1.25rem] font-[430]"
          >
            {structuredTitle?.topic || formattedTitle || title}
          </span>
          <span
            data-todo-meta
            className="flex min-w-0 items-center gap-1.5 text-[0.6875rem] leading-4 text-muted-foreground"
          >
            <ListTodo
              aria-hidden
              className="size-3 shrink-0 text-muted-foreground/70"
            />
            {displayDate && (
              <>
                <span className="shrink-0 tabular-nums">
                  {dateLabel ? (
                    <time
                      dateTime={createdAt}
                      title={`${t("createdAt")}: ${createdDate?.toLocaleDateString()}`}
                    >
                      {displayDate}
                    </time>
                  ) : (
                    displayDate
                  )}
                </span>
                <span aria-hidden="true" className="text-muted-foreground/50">
                  ·
                </span>
              </>
            )}
            {statusBadge}
          </span>
        </span>
        <ChevronRight
          aria-hidden
          className={cn(
            "maxcode-disclosure-chevron size-3 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90"
          )}
        />
      </button>
      <div className="absolute right-9 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
        <button
          type="button"
          title={tCard("moreActions")}
          aria-label={tCard("moreActions")}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-state={menuOpen ? "open" : "closed"}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
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
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-foreground/10 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/todo-header:opacity-100 group-has-[:focus-visible]/todo-header:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100 [@media(hover:none)]:opacity-100 [@media(pointer:coarse)]:opacity-100"
        >
          <Ellipsis className="size-3.5" />
        </button>
        {onNewConversation && (
          <button
            type="button"
            title={t("newConversationForTodo", { title })}
            aria-label={t("newConversationForTodo", { title })}
            disabled={disabled}
            onClick={() => onNewConversation(id)}
            className="maxcode-todo-new-conversation inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-foreground/10 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/todo-header:opacity-100 group-has-[:focus-visible]/todo-header:opacity-100 max-md:opacity-100 disabled:opacity-40"
          >
            {creating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
          </button>
        )}
      </div>
    </div>
  )
  return (
    <ContextMenu onOpenChange={setMenuOpen}>
      <ContextMenuTrigger asChild>{header}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onOpen(id)}>
          <Info className="size-4" />
          {t("viewDetails")}
        </ContextMenuItem>
        {onNewConversation && (
          <ContextMenuItem
            disabled={disabled || creating}
            onSelect={() => onNewConversation(id)}
          >
            {creating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            {tCard("newConversation")}
          </ContextMenuItem>
        )}
        {onComplete && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={completing}
              onSelect={() =>
                onComplete(id, awaitingVerification ? "resume" : "complete")
              }
            >
              {awaitingVerification ? (
                <RotateCcw className="size-4" />
              ) : (
                <Clock className="size-4" />
              )}
              {t(
                awaitingVerification
                  ? "markProcessing"
                  : "markPendingVerification"
              )}
            </ContextMenuItem>
            <ContextMenuItem
              disabled={completing}
              onSelect={() => onComplete(id, "finish")}
            >
              <Check className="size-4" />
              {t("complete")}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
})
