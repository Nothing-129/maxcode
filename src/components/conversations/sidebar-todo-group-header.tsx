"use client"

import { memo } from "react"
import { ChevronRight, ListTodo } from "lucide-react"
import { cn } from "@/lib/utils"

export const SidebarTodoGroupHeader = memo(function SidebarTodoGroupHeader({
  id,
  title,
  count,
  expanded,
  onToggle,
}: {
  id: string
  title: string
  count: number
  expanded: boolean
  onToggle: (id: string) => void
}) {
  return (
    <div className="h-[2rem]" data-todo-group-id={id}>
      <button
        type="button"
        aria-expanded={expanded}
        title={title}
        onClick={() => onToggle(id)}
        className="group flex h-[1.9375rem] w-full min-w-0 items-center gap-[0.4375rem] rounded-lg pl-[0.4375rem] pr-[0.375rem] text-left text-[0.875rem] leading-5 text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
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
    </div>
  )
})
