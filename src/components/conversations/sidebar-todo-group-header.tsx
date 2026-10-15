"use client"

import { memo } from "react"
import { ChevronRight, ListTodo, Plus, Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"

export const SidebarTodoGroupHeader = memo(function SidebarTodoGroupHeader({
  id,
  title,
  count,
  expanded,
  onToggle,
  onNewConversation,
  creating = false,
  disabled = false,
}: {
  id: string
  title: string
  count: number
  expanded: boolean
  onToggle: (id: string) => void
  onNewConversation?: (id: string) => void
  creating?: boolean
  disabled?: boolean
}) {
  const t = useTranslations("Todos")
  return (
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
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="inline-flex h-[0.9375rem] shrink-0 items-center rounded-[0.3125rem] bg-primary/10 px-1 font-mono text-[0.625rem] text-primary">
          {count}
        </span>
        <ChevronRight
          aria-hidden
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform",
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
})
