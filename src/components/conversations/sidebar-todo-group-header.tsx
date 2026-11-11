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
  Circle,
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
      ? `${String(createdDate.getMonth() + 1).padStart(2, "0")}${String(createdDate.getDate()).padStart(2, "0")}`
      : null
  const awaitingVerification = status === "pending_verification"
  const StatusIcon =
    status === "completed" ? Check : awaitingVerification ? Clock : Circle
  const formattedTitle = formatConversationTitle(title)
  const structuredTitle = parseStructuredConversationTitle(formattedTitle)
  const statusBadge = (
    <span className="inline-flex min-w-0 shrink-0 items-center gap-1 text-xs font-normal text-muted-foreground/60">
      <StatusIcon
        aria-hidden="true"
        className="size-3 shrink-0"
        strokeWidth={1.5}
      />
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
      className="group/todo-header flex min-w-0 items-center py-px"
      data-todo-group-id={id}
    >
      <button
        type="button"
        aria-expanded={expanded}
        title={title}
        onClick={() => onToggle(id)}
        className="group flex min-w-0 flex-1 items-center gap-[0.4375rem] rounded-lg py-[0.375rem] pl-[0.4375rem] pr-[0.375rem] text-left text-[0.875rem] leading-5 text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <ListTodo className="size-[0.875rem] shrink-0 text-sidebar-foreground/75" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            data-todo-title
            className="maxcode-sidebar-label min-w-0 truncate text-[0.875rem] leading-[1.25rem] font-[430]"
          >
            {structuredTitle?.topic || formattedTitle || title}
          </span>
          <span
            data-todo-meta
            className="grid min-w-0 grid-cols-[4ch_minmax(0,1fr)] items-center gap-2 text-[0.6875rem] leading-[0.875rem] text-muted-foreground/75"
          >
            <span className="tabular-nums">
              {dateLabel ? (
                <time
                  dateTime={createdAt}
                  title={`${t("createdAt")}: ${createdDate?.toLocaleDateString()}`}
                >
                  {dateLabel}
                </time>
              ) : (
                structuredTitle?.date
              )}
            </span>
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
        className="mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/todo-header:opacity-100 group-focus-within/todo-header:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100 [@media(hover:none)]:opacity-100 [@media(pointer:coarse)]:opacity-100"
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
          className="maxcode-todo-new-conversation mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/todo-header:opacity-100 group-focus-within/todo-header:opacity-100 max-md:opacity-100 disabled:opacity-40"
        >
          {creating ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Plus className="size-3.5" />
          )}
        </button>
      )}
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
