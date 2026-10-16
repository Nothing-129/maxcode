"use client"

import { TodoMarkdown } from "./todo-markdown"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Users,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { BrowserLink } from "@/components/ui/browser-link"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { WorkbenchPageTitle } from "@/components/workbench/workbench-page-title"
import { useTodosView } from "@/contexts/todos-view-context"
import { matchesTodoSchedule, todoToday } from "@/lib/todo-schedule"
import type { TodoScheduleFilter } from "@/lib/todos"
import { toErrorMessage } from "@/lib/app-error"
import {
  consumePendingOpenTodo,
  TODO_OPEN_EVENT,
  TODO_COMPOSE_EVENT,
  type TodoComposeDraft,
} from "@/lib/todo-compose-events"
import {
  todoScopeKey,
  type TodoOrigin,
  type TodoRequest,
  type TodoState,
} from "@/lib/todos"
import { cn } from "@/lib/utils"
import {
  groupTodos,
  TODO_COLUMN_LABELS,
  TODO_COLUMNS,
  todoColumn,
  type Todo,
  type TodoColumn,
} from "./board-columns"
import {
  TodoSchedule,
  TodoAssignee,
  TodoCard,
  TodoConversationButton,
  type TodoStatusAction,
} from "./todo-card"
import { TodoEditorDialog } from "./todo-editor-dialog"
import { TodoTeamsDialog } from "./todo-teams-dialog"
import { TodoSourceDetailDialog } from "./todo-source-detail-dialog"
import { OPEN_TODO_TEAMS_EVENT } from "./todos-chrome-actions"

export function TodosPageTitle() {
  const t = useTranslations("Todos")
  return <WorkbenchPageTitle title={t("title")} />
}

export function TodosPage() {
  const t = useTranslations("Todos")
  const { state, loading, error, refetch, mutate, busy } = useTodosView()
  const [teamsOpen, setTeamsOpen] = useState(false)
  const [sourceOrigin, setSourceOrigin] = useState<TodoOrigin | null>(null)
  const attemptedSourceScope = useRef<string | null>(null)
  const sourceRef = useRef(sourceOrigin)
  const invalidateSource = useCallback(() => {
    sourceRef.current = null
  }, [])
  useEffect(() => invalidateSource, [invalidateSource])
  useEffect(() => {
    sourceRef.current = sourceOrigin
  }, [sourceOrigin])
  useEffect(() => {
    const open = () => setTeamsOpen(true)
    window.addEventListener(OPEN_TODO_TEAMS_EVENT, open)
    return () => window.removeEventListener(OPEN_TODO_TEAMS_EVENT, open)
  }, [])

  useEffect(() => {
    const consume = () => {
      const origin = consumePendingOpenTodo()
      if (!origin) return
      attemptedSourceScope.current = null
      sourceRef.current = origin
      setSourceOrigin(origin)
    }
    consume()
    window.addEventListener(TODO_OPEN_EVENT, consume)
    return () => window.removeEventListener(TODO_OPEN_EVENT, consume)
  }, [])

  useEffect(() => {
    const dismissSource = () => {
      invalidateSource()
      setSourceOrigin(null)
    }
    window.addEventListener(TODO_COMPOSE_EVENT, dismissSource)
    return () => window.removeEventListener(TODO_COMPOSE_EVENT, dismissSource)
  }, [invalidateSource])

  const scope = state
    ? state.mode === "personal"
      ? "personal"
      : state.active_team_id
    : null
  useEffect(() => {
    if (
      !sourceOrigin ||
      !state ||
      busy ||
      scope === sourceOrigin.scope_id ||
      attemptedSourceScope.current === sourceOrigin.scope_id
    ) {
      return
    }
    attemptedSourceScope.current = sourceOrigin.scope_id
    const origin = sourceOrigin
    void mutate(
      origin.scope_id === "personal"
        ? { action: "set_mode", mode: "personal" }
        : { action: "set_mode", mode: "team", team_id: origin.scope_id }
    ).catch((cause) => {
      if (sourceRef.current !== origin) return
      invalidateSource()
      setSourceOrigin(null)
      toast.error(t("operationFailed", { reason: toErrorMessage(cause) }))
    })
  }, [sourceOrigin, state, scope, busy, mutate, t, invalidateSource])

  return (
    <div className="todo-theme flex h-full min-h-0 flex-col">
      {state ? (
        <TodosWorkspace
          key={todoScopeKey(state)}
          state={state}
          onTeams={() => setTeamsOpen(true)}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          {loading ? (
            <Loader2
              className="size-5 animate-spin text-muted-foreground"
              aria-label={t("loading")}
            />
          ) : (
            <>
              <p className="text-sm text-muted-foreground" role="alert">
                {t("loadFailed")}
              </p>
              {error && (
                <p className="max-w-lg text-xs text-muted-foreground wrap-anywhere">
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => void refetch()}>
                  {t("retry")}
                </Button>
                <Button variant="outline" onClick={() => setTeamsOpen(true)}>
                  {t("teams")}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      {teamsOpen && (
        <TodoTeamsDialog
          onClose={() => setTeamsOpen(false)}
          onStart={() => setTeamsOpen(true)}
          onJoined={() => setTeamsOpen(false)}
        />
      )}
      {sourceOrigin && scope === sourceOrigin.scope_id && (
        <TodoSourceDetailDialog
          key={`${sourceOrigin.scope_id}:${sourceOrigin.todo_id}`}
          origin={sourceOrigin}
          onClose={() => {
            invalidateSource()
            setSourceOrigin(null)
          }}
        />
      )}
    </div>
  )
}

function TodosWorkspace({
  state,
  onTeams,
}: {
  state: TodoState
  onTeams: () => void
}) {
  const t = useTranslations("Todos")
  const {
    mutate,
    busy,
    error,
    refetch,
    viewMode,
    setCompletedPage,
    completedPageLoading,
    setCompletedSearch,
    scheduleFilter,
    setScheduleFilter,
  } = useTodosView()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<TodoColumn | "all">("all")
  const [editor, setEditor] = useState<{
    todo: Todo | null
    draft: TodoComposeDraft | null
  } | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const hasScope = state.mode === "personal" || state.active_team_id !== null
  const canWrite = hasScope && state.self_id !== null && !error && !busy
  const activeTeam = state.teams.find(
    (team) => team.id === state.active_team_id
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void setCompletedSearch(search)
    }, 200)
    return () => window.clearTimeout(timer)
  }, [search, setCompletedSearch])

  const completedPagination = state.completed_pagination
  const completedLoading =
    completedPageLoading ||
    (completedPagination?.search !== undefined &&
      completedPagination.search !== search.trim()) ||
    (completedPagination?.filter ?? "all") !== (scheduleFilter ?? "all") ||
    (!!completedPagination?.today && completedPagination.today !== todoToday())

  const members = useMemo(
    () => new Map(state.members.map((member) => [member.id, member])),
    [state.members]
  )
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return state.todos.filter((todo) => {
      const matchStatus =
        statusFilter === "all" ||
        todoColumn(todo, state.self_id) === statusFilter
      return (
        matchStatus &&
        matchesTodoSchedule(todo, scheduleFilter ?? "all") &&
        (todo.status === "completed" && completedPagination
          ? true
          : !query ||
            `${todo.title}\n${todo.content}\n${members.get(todo.assignee_id ?? "")?.name ?? ""}`
              .toLocaleLowerCase()
              .includes(query))
      )
    })
  }, [
    state.todos,
    state.self_id,
    search,
    statusFilter,
    scheduleFilter,
    members,
    completedPagination,
  ])
  const columns = useMemo(
    () => groupTodos(visible, state.self_id),
    [visible, state.self_id]
  )
  const detail = state.todos.find((todo) => todo.id === detailId)
  const deleting = state.todos.find((todo) => todo.id === deleteId)
  const unfinished = visible.filter((todo) => todo.status !== "completed")
  const completedTotal = completedPagination?.total ?? columns.completed.length
  const completedPage = completedPagination?.page ?? 1
  const completedPageSize = completedPagination?.page_size ?? 20
  const completedPageCount = Math.max(
    1,
    Math.ceil(completedTotal / completedPageSize)
  )
  const showCompletedGroup =
    statusFilter === "completed" ||
    (statusFilter === "all" && (completedTotal > 0 || completedLoading))

  const act = useCallback(
    async (request: TodoRequest) => {
      try {
        await mutate(request)
        return true
      } catch (cause) {
        toast.error(t("operationFailed", { reason: toErrorMessage(cause) }))
        return false
      }
    },
    [mutate, t]
  )

  function todoAction(todo: Todo, action: TodoStatusAction) {
    void act({ action, id: todo.id, revision: todo.revision })
  }

  function card(todo: Todo, list = false) {
    return (
      <TodoCard
        key={todo.id}
        todo={todo}
        member={members.get(todo.assignee_id ?? "")}
        selfId={state.self_id}
        disabled={!canWrite}
        list={list}
        onOpen={() => setDetailId(todo.id)}
        onEdit={() => setEditor({ todo, draft: null })}
        onDelete={() => setDeleteId(todo.id)}
        onAction={(action) => todoAction(todo, action)}
      />
    )
  }

  function completedPager() {
    if (completedTotal <= completedPageSize) return null
    return (
      <nav
        aria-label={t("completedPagination")}
        className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border/50 px-4 py-3 text-xs text-muted-foreground"
      >
        <div className="flex flex-col gap-1 tabular-nums">
          <span>{t("completedTotal", { count: completedTotal })}</span>
          <span>
            {t("pageOf", { page: completedPage, pages: completedPageCount })}
          </span>
        </div>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t("previousPage")}
            title={t("previousPage")}
            disabled={completedPage <= 1 || completedLoading || busy || !!error}
            onClick={() => void setCompletedPage(completedPage - 1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t("nextPage")}
            title={t("nextPage")}
            disabled={
              completedPage >= completedPageCount ||
              completedLoading ||
              busy ||
              !!error
            }
            onClick={() => void setCompletedPage(completedPage + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </nav>
    )
  }

  function completedSpinner() {
    return (
      <div className="flex justify-center py-8" role="status">
        <Loader2
          className="size-4 animate-spin text-muted-foreground"
          aria-label={t("loadingCompleted")}
        />
      </div>
    )
  }

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/50 px-4 py-3">
        <div className="flex gap-1 rounded-full border border-primary/15 bg-primary/5 p-1">
          <Button
            size="sm"
            variant={state.mode === "personal" ? "default" : "ghost"}
            aria-pressed={state.mode === "personal"}
            className={cn(
              "h-7 text-xs",
              state.mode === "personal"
                ? "shadow-sm hover:bg-primary/90"
                : "text-muted-foreground hover:bg-primary/10 hover:text-primary"
            )}
            disabled={busy}
            onClick={() => void act({ action: "set_mode", mode: "personal" })}
          >
            {t("personalMode")}
          </Button>
          <Button
            size="sm"
            variant={state.mode === "team" ? "default" : "ghost"}
            aria-pressed={state.mode === "team"}
            className={cn(
              "h-7 text-xs",
              state.mode === "team"
                ? "shadow-sm hover:bg-primary/90"
                : "text-muted-foreground hover:bg-primary/10 hover:text-primary"
            )}
            disabled={busy}
            onClick={() => void act({ action: "set_mode", mode: "team" })}
          >
            {t("teamMode")}
          </Button>
        </div>
        {state.mode === "team" && state.teams.length > 0 && (
          <Select
            value={state.active_team_id ?? undefined}
            disabled={busy}
            onValueChange={(team_id) =>
              void act({ action: "set_mode", mode: "team", team_id })
            }
          >
            <SelectTrigger
              className="h-8 w-40 text-xs"
              aria-label={t("selectTeam")}
            >
              <SelectValue placeholder={t("selectTeam")} />
            </SelectTrigger>
            <SelectContent className="todo-theme">
              {state.teams.map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {state.mode === "team" && hasScope && (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-xs text-muted-foreground",
              error && "text-amber-600 dark:text-amber-400"
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full bg-emerald-500",
                error && "bg-amber-500"
              )}
            />
            {t(error ? "offline" : "online")}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onTeams}
          title={t("teams")}
          aria-label={t("teams")}
        >
          <Users className="size-4" />
        </Button>
        <div className="relative min-w-32 flex-1 sm:max-w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-8 text-xs"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
          />
        </div>
        <Select
          value={scheduleFilter ?? "all"}
          onValueChange={(value) =>
            void setScheduleFilter(value as TodoScheduleFilter)
          }
        >
          <SelectTrigger
            className="h-8 w-36 text-xs"
            aria-label={t("scheduleFilter")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="todo-theme">
            {(["all", "today", "overdue", "urgent"] as const).map((value) => (
              <SelectItem key={value} value={value}>
                {t(`filter_${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {viewMode === "list" && (
          <Select
            value={statusFilter}
            onValueChange={(value) =>
              setStatusFilter(value as TodoColumn | "all")
            }
          >
            <SelectTrigger
              className="h-8 w-32 text-xs"
              aria-label={t("filterStatus")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="todo-theme">
              <SelectItem value="all">{t("allStatuses")}</SelectItem>
              {TODO_COLUMNS.map((column) => (
                <SelectItem key={column} value={column}>
                  {t(TODO_COLUMN_LABELS[column])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <span className="flex-1" />
        <Button
          size="sm"
          className="h-8 text-xs"
          disabled={!canWrite}
          onClick={() => setEditor({ todo: null, draft: null })}
        >
          <Plus className="size-3.5" />
          {t("newTodo")}
        </Button>
      </div>
      {error && (
        <div
          role="alert"
          className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-500/20 bg-amber-500/5 px-4 py-2"
        >
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {t(state.mode === "team" ? "offlineHint" : "loadFailed")}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => void refetch()}
            disabled={busy}
          >
            <RefreshCw className="size-3" />
            {t("retry")}
          </Button>
        </div>
      )}
      {!hasScope ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <Users className="size-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">{t("noTeamTitle")}</p>
          <p className="max-w-sm text-xs leading-5 text-muted-foreground">
            {t("noTeamDescription")}
          </p>
          <Button variant="outline" size="sm" onClick={onTeams}>
            {t("createOrJoinTeam")}
          </Button>
        </div>
      ) : viewMode === "board" ? (
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto p-4">
          {TODO_COLUMNS.map((column) => (
            <section
              key={column}
              className="flex min-h-0 min-w-60 flex-1 flex-col rounded-2xl bg-muted/35"
              aria-label={t(TODO_COLUMN_LABELS[column])}
              aria-busy={column === "completed" && completedLoading}
            >
              <div className="flex shrink-0 items-center gap-2 px-4 py-3">
                <span
                  className={cn(
                    "h-3.5 w-0.5 rounded-full bg-muted-foreground/40",
                    column === "claimed" && "bg-primary",
                    column === "mine" && "bg-amber-500",
                    column === "completed" && "bg-emerald-500"
                  )}
                />
                <h2 className="text-xs font-semibold">
                  {t(TODO_COLUMN_LABELS[column])}
                </h2>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {column === "completed"
                    ? completedTotal
                    : columns[column].length}
                </span>
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <div className="flex flex-col gap-4 px-4 pb-4">
                  {column === "completed" && completedLoading ? (
                    completedSpinner()
                  ) : columns[column].length > 0 ? (
                    columns[column].map((todo) => card(todo))
                  ) : (
                    <p className="py-8 text-center text-xs text-muted-foreground/70">
                      {t("emptyColumn")}
                    </p>
                  )}
                </div>
              </ScrollArea>
              {column === "completed" && completedPager()}
            </section>
          ))}
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 p-4">
            {unfinished.map((todo) => card(todo, true))}
            {showCompletedGroup && (
              <section
                aria-label={t("colCompleted")}
                aria-busy={completedLoading}
                className={cn(
                  "flex flex-col gap-3",
                  unfinished.length > 0 && "mt-2 border-t border-border/50 pt-4"
                )}
              >
                <h2 className="flex items-center gap-2 text-xs font-semibold">
                  {t("colCompleted")}
                  <span className="font-normal tabular-nums text-muted-foreground">
                    {completedTotal}
                  </span>
                </h2>
                {completedLoading ? (
                  completedSpinner()
                ) : columns.completed.length > 0 ? (
                  columns.completed.map((todo) => card(todo, true))
                ) : (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    {t("noResults")}
                  </p>
                )}
                {completedPager()}
              </section>
            )}
            {unfinished.length === 0 && !showCompletedGroup && (
              <p className="py-16 text-center text-sm text-muted-foreground">
                {t("noResults")}
              </p>
            )}
          </div>
        </ScrollArea>
      )}
      {editor && (
        <TodoEditorDialog
          scopeId={
            state?.mode === "team"
              ? (state.active_team_id ?? undefined)
              : "personal"
          }
          key={
            editor.todo ? `${editor.todo.id}:${editor.todo.revision}` : "new"
          }
          todo={editor.todo}
          draft={editor.draft}
          members={state.members}
          disabled={!canWrite}
          latestTodo={state.todos.find((todo) => todo.id === editor.todo?.id)}
          onReload={() => {
            const latest = state.todos.find(
              (todo) => todo.id === editor.todo?.id
            )
            if (latest) setEditor({ todo: latest, draft: null })
          }}
          onClose={() => setEditor(null)}
          onSubmit={mutate}
        />
      )}
      {detail && (
        <Dialog open onOpenChange={(open) => !open && setDetailId(null)}>
          <DialogContent className="todo-theme min-w-0 max-w-xl grid-cols-1 overflow-x-hidden overflow-y-auto [&>*]:min-w-0">
            <DialogHeader>
              <DialogTitle className="wrap-anywhere">
                {detail.title}
              </DialogTitle>
              <DialogDescription>
                {t(TODO_COLUMN_LABELS[todoColumn(detail, state.self_id)])}
              </DialogDescription>
            </DialogHeader>
            <TodoAssignee member={members.get(detail.assignee_id ?? "")} />
            <TodoSchedule todo={detail} />
            <div className="max-h-80 overflow-auto whitespace-pre-wrap text-sm leading-6 wrap-anywhere">
              <TodoMarkdown content={detail.content} />
            </div>
            {detail.source_url && (
              <BrowserLink
                href={detail.source_url}
                className="w-fit text-xs text-primary underline underline-offset-4"
              >
                {t("sourceConversation")}
              </BrowserLink>
            )}
            <DialogFooter className="min-w-0 sm:flex-wrap">
              <TodoConversationButton todo={detail} />
              <Button
                variant="outline"
                disabled={!canWrite}
                onClick={() => {
                  setEditor({ todo: detail, draft: null })
                  setDetailId(null)
                }}
              >
                {t("edit")}
              </Button>
              <Button
                disabled={!canWrite}
                onClick={() =>
                  todoAction(
                    detail,
                    detail.status === "completed"
                      ? "reopen"
                      : detail.status === "unclaimed"
                        ? "claim"
                        : "complete"
                  )
                }
              >
                {t(
                  detail.status === "completed"
                    ? "reopen"
                    : detail.status === "unclaimed"
                      ? "claim"
                      : "complete"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {deleting && (
        <Dialog
          open
          onOpenChange={(open) => !open && !busy && setDeleteId(null)}
        >
          <DialogContent
            className="todo-theme min-w-0 grid-cols-1 overflow-x-hidden overflow-y-auto [&>*]:min-w-0"
            showCloseButton={!busy}
          >
            <DialogHeader>
              <DialogTitle>{t("deleteTodo")}</DialogTitle>
              <DialogDescription className="wrap-anywhere">
                {t("deleteHint", { title: deleting.title })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setDeleteId(null)}
              >
                {t("cancel")}
              </Button>
              <Button
                variant="destructive"
                disabled={!canWrite}
                onClick={async () => {
                  if (
                    await act({
                      action: "delete",
                      id: deleting.id,
                      revision: deleting.revision,
                    })
                  )
                    setDeleteId(null)
                }}
              >
                {busy && <Loader2 className="size-4 animate-spin" />}
                {t("delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {activeTeam?.is_local && state.mode === "team" && (
        <span className="sr-only">{t("hostOnlineHint")}</span>
      )}
    </>
  )
}
