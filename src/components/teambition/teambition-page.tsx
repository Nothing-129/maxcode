"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  ArrowRightLeft,
  CalendarClock,
  ExternalLink,
  FolderInput,
  GripVertical,
  LoaderCircle,
  RefreshCw,
  Settings2,
  SquareKanban,
} from "lucide-react"
import { toast } from "sonner"

import { WorkbenchPageTitle } from "@/components/workbench/workbench-page-title"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTabActions, useTabStore } from "@/contexts/tab-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { toErrorMessage } from "@/lib/app-error"
import {
  openSettingsWindow,
  teambitionBoard,
  teambitionUpdateTaskStatus,
} from "@/lib/api"
import { emitAppendTextToSession } from "@/lib/session-attachment-events"
import { openUrl } from "@/lib/platform"
import type {
  TeambitionBoard,
  TeambitionStatus,
  TeambitionTask,
} from "@/lib/types"
import { cn } from "@/lib/utils"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"

const PROJECT_NAME = "技术部敏捷项目"

export function TeambitionPageTitle() {
  const t = useTranslations("Teambition")
  return <WorkbenchPageTitle title={t("title")} />
}

export function TeambitionPage() {
  const t = useTranslations("Teambition")
  const locale = useLocale()
  const folders = useAppWorkspaceStore((state) => state.folders)
  const projectFolders = useMemo(
    () =>
      folders.filter(
        (folder) => folder.parent_id == null && folder.kind === "regular"
      ),
    [folders]
  )
  const { openNewConversationTab } = useTabActions()
  const { routeId, openConversations } = useWorkbenchRoute()
  const [board, setBoard] = useState<TeambitionBoard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [dropStatusId, setDropStatusId] = useState<string | null>(null)
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    setError(null)
    try {
      setBoard(await teambitionBoard())
    } catch (cause) {
      setError(toErrorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (routeId === "teambition") {
      void refresh()
    }
  }, [refresh, routeId])

  const statusesById = useMemo(
    () => new Map(board?.statuses.map((status) => [status.id, status]) ?? []),
    [board]
  )
  const tasksById = useMemo(
    () => new Map(board?.tasks.map((task) => [task.taskId, task]) ?? []),
    [board]
  )
  const taskflowNames = useMemo(
    () => new Map(board?.taskflows.map((flow) => [flow.id, flow.name]) ?? []),
    [board]
  )

  const columns = useMemo(() => {
    if (!board) return []
    const representedFlows = new Set(
      board.tasks
        .map((task) => statusesById.get(task.tfsId)?.taskflowId)
        .filter((value): value is string => value != null)
    )
    const flowOrder = new Map(
      board.taskflows.map((taskflow, index) => [taskflow.id, index])
    )
    return board.statuses
      .filter((status) => representedFlows.has(status.taskflowId))
      .sort(
        (left, right) =>
          (flowOrder.get(left.taskflowId) ?? Number.MAX_SAFE_INTEGER) -
            (flowOrder.get(right.taskflowId) ?? Number.MAX_SAFE_INTEGER) ||
          left.pos - right.pos
      )
      .map((status) => ({
        status,
        tasks: board.tasks.filter((task) => task.tfsId === status.id),
      }))
  }, [board, statusesById])

  const moveTask = useCallback(
    async (task: TeambitionTask, target: TeambitionStatus) => {
      if (!board || task.tfsId === target.id || updatingIds.has(task.taskId)) {
        return
      }
      const current = statusesById.get(task.tfsId)
      if (!current || current.taskflowId !== target.taskflowId) {
        toast.error(t("differentWorkflow"))
        return
      }

      const previousStatusId = task.tfsId
      setUpdatingIds((currentIds) => new Set(currentIds).add(task.taskId))
      setBoard((currentBoard) =>
        currentBoard
          ? {
              ...currentBoard,
              tasks: currentBoard.tasks.map((item) =>
                item.taskId === task.taskId
                  ? { ...item, tfsId: target.id }
                  : item
              ),
            }
          : currentBoard
      )
      try {
        const updated = await teambitionUpdateTaskStatus(task.taskId, target.id)
        setBoard((currentBoard) =>
          currentBoard
            ? {
                ...currentBoard,
                tasks: currentBoard.tasks.map((item) =>
                  item.taskId === updated.taskId ? updated : item
                ),
              }
            : currentBoard
        )
        toast.success(t("statusUpdated", { status: target.name }))
      } catch (cause) {
        setBoard((currentBoard) =>
          currentBoard
            ? {
                ...currentBoard,
                tasks: currentBoard.tasks.map((item) =>
                  item.taskId === task.taskId
                    ? { ...item, tfsId: previousStatusId }
                    : item
                ),
              }
            : currentBoard
        )
        toast.error(toErrorMessage(cause))
      } finally {
        setUpdatingIds((currentIds) => {
          const next = new Set(currentIds)
          next.delete(task.taskId)
          return next
        })
      }
    },
    [board, statusesById, t, updatingIds]
  )

  const insertIntoFolder = useCallback(
    (task: TeambitionTask, folderId: number, folderPath: string) => {
      openNewConversationTab(folderId, folderPath)
      const tabId = useTabStore.getState().activeTabId
      openConversations()
      if (!tabId) return
      window.requestAnimationFrame(() => {
        emitAppendTextToSession({ tabId, text: `KKNL-${task.uniqueId}` })
      })
      toast.success(t("inserted", { id: `KKNL-${task.uniqueId}` }))
    },
    [openConversations, openNewConversationTab, t]
  )

  const draggedTask = draggedTaskId ? tasksById.get(draggedTaskId) : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{PROJECT_NAME}</p>
          <p className="text-xs text-muted-foreground">
            {t("taskCount", { count: board?.tasks.length ?? 0 })}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="gap-1.5"
          disabled={loading}
          onClick={() => {
            setLoading(true)
            void refresh()
          }}
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          {t("refresh")}
        </Button>
      </div>

      {loading && !board ? (
        <TeambitionLoading />
      ) : error && !board ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <SquareKanban className="size-9 text-muted-foreground" />
          <div className="max-w-lg space-y-1.5">
            <p className="text-sm font-medium">{t("preflightFailed")}</p>
            <p className="text-sm text-destructive">{error}</p>
            <p className="text-xs text-muted-foreground">
              {t("preflightHint")}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                setLoading(true)
                void refresh()
              }}
            >
              {t("retry")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                void openSettingsWindow("mcp").catch((cause) => {
                  toast.error(toErrorMessage(cause))
                })
              }}
            >
              <Settings2 className="size-3.5" />
              {t("openMcpSettings")}
            </Button>
          </div>
        </div>
      ) : board?.tasks.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <SquareKanban className="size-9 text-muted-foreground" />
          <p className="text-sm font-medium">{t("empty")}</p>
          <p className="text-xs text-muted-foreground">{t("emptyHint")}</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto p-4">
          {columns.map(({ status, tasks }) => {
            const acceptsDrag =
              draggedTask != null &&
              statusesById.get(draggedTask.tfsId)?.taskflowId ===
                status.taskflowId &&
              draggedTask.tfsId !== status.id
            return (
              <section
                key={status.id}
                data-teambition-status-id={status.id}
                className={cn(
                  "flex h-full min-h-0 w-72 shrink-0 flex-col overflow-hidden rounded-xl border bg-muted/25 transition-colors duration-200",
                  dropStatusId === status.id &&
                    "border-primary bg-primary/5 ring-1 ring-primary/30",
                  draggedTaskId && !acceptsDrag && "opacity-70"
                )}
                onDragOver={(event) => {
                  if (!acceptsDrag) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = "move"
                  setDropStatusId(status.id)
                }}
                onDragLeave={(event) => {
                  if (
                    !event.currentTarget.contains(event.relatedTarget as Node)
                  ) {
                    setDropStatusId((current) =>
                      current === status.id ? null : current
                    )
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  setDropStatusId(null)
                  if (draggedTask && acceptsDrag) {
                    void moveTask(draggedTask, status)
                  }
                }}
              >
                <header className="flex shrink-0 items-start gap-2 border-b border-border px-3 py-2.5">
                  <span className="mt-1 size-2 shrink-0 rounded-full bg-primary/70" />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-medium">
                      {status.name}
                    </h2>
                    <p className="truncate text-[0.6875rem] text-muted-foreground">
                      {taskflowNames.get(status.taskflowId)}
                    </p>
                  </div>
                  <span className="rounded-full bg-background px-1.5 py-0.5 font-mono text-[0.625rem] text-muted-foreground">
                    {tasks.length}
                  </span>
                </header>
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
                  {tasks.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                      {t("emptyStatus")}
                    </p>
                  ) : (
                    tasks.map((task) => (
                      <TeambitionCard
                        key={task.taskId}
                        task={task}
                        currentStatus={status}
                        allStatuses={board!.statuses}
                        folders={projectFolders}
                        locale={locale}
                        updating={updatingIds.has(task.taskId)}
                        onMove={moveTask}
                        onInsert={insertIntoFolder}
                        onDragStart={() => setDraggedTaskId(task.taskId)}
                        onDragEnd={() => {
                          setDraggedTaskId(null)
                          setDropStatusId(null)
                        }}
                      />
                    ))
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TeambitionCard({
  task,
  currentStatus,
  allStatuses,
  folders,
  locale,
  updating,
  onMove,
  onInsert,
  onDragStart,
  onDragEnd,
}: {
  task: TeambitionTask
  currentStatus: TeambitionStatus
  allStatuses: TeambitionStatus[]
  folders: Array<{
    id: number
    name: string
    alias?: string | null
    path: string
  }>
  locale: string
  updating: boolean
  onMove: (task: TeambitionTask, status: TeambitionStatus) => Promise<void>
  onInsert: (task: TeambitionTask, folderId: number, folderPath: string) => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const t = useTranslations("Teambition")
  const statuses = allStatuses.filter(
    (status) =>
      status.taskflowId === currentStatus.taskflowId &&
      status.id !== currentStatus.id
  )
  const id = `KKNL-${task.uniqueId}`
  const dueDate = task.dueDate
    ? new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        year:
          new Date(task.dueDate).getFullYear() === new Date().getFullYear()
            ? undefined
            : "numeric",
      }).format(new Date(task.dueDate))
    : null

  return (
    <article
      draggable={!updating}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move"
        event.dataTransfer.setData("text/plain", task.taskId)
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "group rounded-lg border border-border bg-background p-3 shadow-sm transition-colors duration-200 hover:border-primary/40",
        !updating && "cursor-grab active:cursor-grabbing",
        updating && "opacity-65"
      )}
    >
      <div className="flex items-start gap-2">
        {updating ? (
          <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary" />
        ) : (
          <GripVertical className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" />
        )}
        <div className="min-w-0 flex-1">
          <button
            type="button"
            className="line-clamp-3 cursor-pointer text-left text-sm font-medium leading-5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() =>
              void openUrl(`https://www.teambition.com/task/${task.taskId}`)
            }
          >
            {task.content}
          </button>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[0.6875rem] text-muted-foreground">
            <button
              type="button"
              className="cursor-pointer font-mono text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() =>
                void openUrl(`https://www.teambition.com/task/${task.taskId}`)
              }
            >
              {id}
            </button>
            {dueDate ? (
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="size-3" />
                {dueDate}
              </span>
            ) : null}
          </div>
        </div>
        <ExternalLink className="size-3.5 shrink-0 text-muted-foreground/50" />
      </div>

      <div className="mt-3 flex items-center justify-end gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={updating}
              aria-label={t("changeStatus")}
              title={t("changeStatus")}
            >
              <ArrowRightLeft className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
            <DropdownMenuLabel>{t("changeStatus")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {statuses.map((status) => (
              <DropdownMenuItem
                key={status.id}
                onSelect={() => void onMove(task, status)}
              >
                {status.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={t("insertToFolder")}
              title={t("insertToFolder")}
            >
              <FolderInput className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="max-h-72 w-64 overflow-y-auto"
          >
            <DropdownMenuLabel>{t("chooseFolder")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {folders.length === 0 ? (
              <DropdownMenuItem disabled>{t("noFolders")}</DropdownMenuItem>
            ) : (
              folders.map((folder) => (
                <DropdownMenuItem
                  key={folder.id}
                  onSelect={() => onInsert(task, folder.id, folder.path)}
                >
                  <span className="truncate">
                    {folder.alias ?? folder.name}
                  </span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  )
}

function TeambitionLoading() {
  return (
    <div
      className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4"
      aria-hidden="true"
    >
      {[0, 1, 2, 3].map((column) => (
        <div
          key={column}
          className="h-full w-72 shrink-0 animate-pulse rounded-xl border bg-muted/25 p-3"
        >
          <div className="h-4 w-28 rounded bg-muted" />
          <div className="mt-5 space-y-2">
            {[0, 1, 2].map((card) => (
              <div key={card} className="h-24 rounded-lg bg-muted" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
