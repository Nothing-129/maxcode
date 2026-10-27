"use client"

import { memo } from "react"
import {
  ChevronRight,
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
} from "@/components/ui/context-menu"
import type { TodoStatus } from "@/lib/todos"
import { cn } from "@/lib/utils"

export const SidebarTodoGroupHeader = memo(function SidebarTodoGroupHeader({
  id,
  title,
  expanded,
  onToggle,
  onComplete,
  status = "claimed",
  completing = false,
  onNewConversation,
  creating = false,
  disabled = false,
}: {
  id: string
  title: string
  expanded: boolean
  onToggle: (id: string) => void
  status?: TodoStatus
  onComplete?: (id: string, action?: "complete" | "finish" | "resume") => void
  completing?: boolean
  onNewConversation?: (id: string) => void
  creating?: boolean
  disabled?: boolean
}) {
  const t = useTranslations("Todos")
  const awaitingVerification = status === "pending_verification"
  const StatusIcon =
    status === "completed" ? Check : awaitingVerification ? Clock : Circle
  const header = (
    <div
      className="group/todo-header flex h-[2rem] min-w-0 items-center"
      data-todo-group-id={id}
    >
      <button
        type="button"
        aria-expanded={expanded}
        title={title}
        onClick={() => onToggle(id)}
        className="group flex h-[1.9375rem] min-w-0 flex-1 items-center gap-[0.4375rem] rounded-lg pl-[0.4375rem] pr-[0.375rem] text-left text-[0.875rem] leading-5 text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <ListTodo className="size-[0.875rem] shrink-0 text-sidebar-foreground/75" />
        <span className="min-w-0 truncate">{title}</span>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-normal text-muted-foreground/60">
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
        <span className="flex-1" />
        <ChevronRight
          aria-hidden
          className={cn(
            "maxcode-disclosure-chevron size-3 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90"
          )}
        />
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
  if (!onComplete) return header
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{header}</ContextMenuTrigger>
      <ContextMenuContent>
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
            awaitingVerification ? "markProcessing" : "markPendingVerification"
          )}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={completing}
          onSelect={() => onComplete(id, "finish")}
        >
          <Check className="size-4" />
          {t("complete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
})
