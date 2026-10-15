"use client"

import { todoContentSummary } from "@/lib/todo-attachments"

import {
  Check,
  ExternalLink,
  MessageSquarePlus,
  MoreHorizontal,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { BrowserLink } from "@/components/ui/browser-link"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useNewChatFromTodo } from "./use-new-chat-from-todo"
import { useOptionalTodosView } from "@/contexts/todos-view-context"
import { todoOverdue } from "@/lib/todo-schedule"
import { cn } from "@/lib/utils"
import {
  TODO_COLUMN_LABELS,
  todoColumn,
  todoConversationText,
  type Todo,
  type TodoMember,
} from "./board-columns"

export type TodoStatusAction = "claim" | "release" | "complete" | "reopen"

export function TodoAssignee({ member }: { member?: TodoMember }) {
  const t = useTranslations("Todos")
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      {member && (
        <Avatar size="sm" className="size-5">
          <AvatarImage src={member.avatar} alt="" />
          <AvatarFallback>{member.name.slice(0, 1)}</AvatarFallback>
        </Avatar>
      )}
      <span className="truncate">{member?.name ?? t("unassigned")}</span>
    </span>
  )
}

export function TodoSchedule({ todo }: { todo: Todo }) {
  const t = useTranslations("Todos")
  if (!todo.due_date && !todo.priority) return null
  const overdue = todoOverdue(todo)
  return (
    <div
      className="flex flex-wrap items-center gap-2 text-xs"
      data-testid="todo-schedule"
    >
      {todo.priority && (
        <span
          className={cn(
            "rounded-md bg-muted px-2 py-1 text-muted-foreground",
            todo.priority === "urgent" &&
              "bg-red-500/10 text-red-600 dark:text-red-400",
            todo.priority === "high" &&
              "bg-amber-500/10 text-amber-700 dark:text-amber-400"
          )}
        >
          {t(`priority_${todo.priority}`)}
        </span>
      )}
      {todo.due_date && (
        <span
          className={cn(
            "text-muted-foreground",
            overdue && "text-red-600 dark:text-red-400"
          )}
        >
          {t(overdue ? "overdueDate" : "dueDateValue", { date: todo.due_date })}
        </span>
      )}
    </div>
  )
}

export function TodoConversationButton({ todo }: { todo: Todo }) {
  const t = useTranslations("Todos")
  const state = useOptionalTodosView()?.state
  const newChat = useNewChatFromTodo(
    () => todoConversationText(todo),
    () => {
      const scope =
        state?.mode === "personal" ? "personal" : state?.active_team_id
      return scope ? [{ scope_id: scope, todo_id: todo.id }] : []
    }
  )
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title={t("insertIntoConversation")}
      aria-label={t("insertIntoConversation")}
      onClick={newChat}
    >
      <MessageSquarePlus className="size-3.5" />
    </Button>
  )
}

export function TodoCard({
  todo,
  member,
  selfId,
  disabled,
  list = false,
  onOpen,
  onEdit,
  onDelete,
  onAction,
}: {
  todo: Todo
  member?: TodoMember
  selfId: string | null
  disabled: boolean
  list?: boolean
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
  onAction: (action: TodoStatusAction) => void
}) {
  const t = useTranslations("Todos")
  const column = todoColumn(todo, selfId)
  const action =
    todo.status === "completed"
      ? "reopen"
      : column === "unclaimed"
        ? "claim"
        : "complete"

  return (
    <article
      className={cn(
        "group rounded-2xl border border-border/70 bg-background p-4 shadow-xs transition-colors hover:border-border",
        list && "flex flex-wrap items-center gap-x-5 gap-y-2"
      )}
      data-testid={`todo-${todo.id}`}
    >
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "block w-full min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md",
          list && "flex-1 basis-60"
        )}
      >
        <h3 className="line-clamp-2 text-sm font-medium leading-5 wrap-anywhere">
          {todo.title}
        </h3>
        <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-muted-foreground wrap-anywhere">
          {todoContentSummary(todo.content)}
        </p>
      </button>
      <div className="mt-2">
        <TodoSchedule todo={todo} />
      </div>
      <div
        className={cn(
          "mt-3 flex min-w-0 items-center justify-between gap-2",
          list && "mt-0 w-48 shrink-0"
        )}
      >
        <TodoAssignee member={member} />
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-1 text-[0.625rem] text-muted-foreground",
            column === "mine" &&
              "bg-amber-500/10 text-amber-600 dark:text-amber-400",
            column === "completed" &&
              "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          )}
        >
          {column === "completed" && <Check className="size-2.5" />}
          {t(TODO_COLUMN_LABELS[column])}
        </span>
      </div>
      <div
        className={cn(
          "mt-3 flex items-center gap-1 border-t border-border/40 pt-2",
          list && "mt-0 shrink-0 border-0 pt-0"
        )}
      >
        <Button
          size="sm"
          variant={action === "reopen" ? "ghost" : "secondary"}
          className="h-7 text-xs"
          disabled={disabled}
          onClick={() => onAction(action)}
        >
          {t(action)}
        </Button>
        <span className="flex-1" />
        {todo.source_url && (
          <BrowserLink
            href={todo.source_url}
            title={t("sourceConversation")}
            aria-label={t("sourceConversation")}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
          </BrowserLink>
        )}
        <TodoConversationButton todo={todo} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("more")}>
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="todo-theme">
            <DropdownMenuItem onSelect={onEdit} disabled={disabled}>
              {t("edit")}
            </DropdownMenuItem>
            {todo.status === "claimed" && (
              <DropdownMenuItem
                onSelect={() => onAction("release")}
                disabled={disabled}
              >
                {t("release")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={onDelete}
              disabled={disabled}
            >
              {t("delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  )
}
