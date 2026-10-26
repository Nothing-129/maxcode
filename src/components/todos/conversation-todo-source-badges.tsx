"use client"

import { ListTodo } from "lucide-react"
import { useTranslations } from "next-intl"
import { useOptionalTodosView } from "@/contexts/todos-view-context"
import { useOptionalWorkbenchRoute } from "@/contexts/workbench-route-context"
import { useConversationTodoSources } from "@/hooks/use-conversation-todo-sources"
import { requestOpenTodo } from "@/lib/todo-compose-events"
import type { TodoConversationSource, TodoOrigin } from "@/lib/todos"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function ConversationTodoSourceBadges({
  conversationId,
  draftOrigins,
}: {
  conversationId: number | null
  draftOrigins: readonly TodoOrigin[]
}) {
  const t = useTranslations("Todos")
  const todos = useOptionalTodosView()
  const route = useOptionalWorkbenchRoute()
  const { sources: savedSources } = useConversationTodoSources(conversationId)
  if (!todos || !route) return null
  const sources: TodoConversationSource[] =
    conversationId != null
      ? savedSources
      : draftOrigins.map((origin) => {
          const state = todos.state
          const sameScope =
            state &&
            (state.mode === "personal" ? "personal" : state.active_team_id) ===
              origin.scope_id
          const todo = sameScope
            ? (state.todos.find((item) => item.id === origin.todo_id) ?? null)
            : null
          return {
            origin,
            mode: origin.scope_id === "personal" ? "personal" : "team",
            scope_key:
              origin.scope_id === "personal"
                ? "personal"
                : `team:${origin.scope_id}`,
            scope_name:
              origin.scope_id === "personal"
                ? t("personalMode")
                : (todos.state?.teams.find(
                    (team) => team.id === origin.scope_id
                  )?.name ?? t("teamMode")),
            todo,
            assignee: todo
              ? (state?.members.find(
                  (member) => member.id === todo.assignee_id
                ) ?? null)
              : null,
          }
        })
  if (sources.length === 0) return null
  const open = (source: TodoConversationSource) => {
    requestOpenTodo(source.origin)
    route.setRoute("tasks")
  }
  const label = (source: TodoConversationSource) =>
    t("sourceTodoLabel", {
      title: source.todo?.title ?? source.scope_name,
    })
  const tooltip = (source: TodoConversationSource) => {
    if (!source.todo) return label(source)
    const status =
      source.todo.status === "pending_verification"
        ? "colPendingVerification"
        : source.todo.status === "completed"
          ? "colCompleted"
          : source.todo.status === "unclaimed"
            ? "colUnclaimed"
            : "colClaimed"
    return `${label(source)} · ${t("sourceTodoScope", { scope: source.scope_name, status: t(status) })}${source.assignee ? ` · ${source.assignee.name}` : ""}`
  }
  const first = sources[0]
  return (
    <span
      className="hidden min-w-0 items-center gap-1 md:flex"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <button
        type="button"
        onClick={() => open(first)}
        title={tooltip(first)}
        aria-label={label(first)}
        className="todo-theme flex h-6 min-w-0 items-center gap-1 rounded-md bg-primary/10 px-1.5 text-xs text-primary outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ListTodo className="size-3 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">
          {first.todo?.title ?? t("sourceTodo")}
        </span>
      </button>
      {sources.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="todo-theme h-6 shrink-0 rounded-md bg-primary/10 px-1.5 text-xs text-primary"
              aria-label={t("moreSourceTodos", { count: sources.length - 1 })}
            >
              +{sources.length - 1}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="todo-theme max-w-72">
            {sources.slice(1).map((source) => (
              <DropdownMenuItem
                key={`${source.origin.scope_id}:${source.origin.todo_id}`}
                onSelect={() => open(source)}
              >
                <ListTodo className="size-4 shrink-0" />
                <span className="min-w-0 truncate">
                  {source.todo?.title ?? t("sourceTodo")} · {source.scope_name}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </span>
  )
}
