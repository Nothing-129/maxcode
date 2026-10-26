"use client"

import { TodoImportConversationButton } from "./todo-import-conversation-button"

import { TodoMarkdown } from "./todo-markdown"

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { BrowserLink } from "@/components/ui/browser-link"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useTodosView } from "@/contexts/todos-view-context"
import { toErrorMessage } from "@/lib/app-error"
import {
  todoOriginCall,
  type Todo,
  type TodoOrigin,
  type TodoOriginRequest,
  type TodoOriginResult,
  type TodoRequest,
} from "@/lib/todos"
import { TODO_COLUMN_LABELS, todoColumn } from "./board-columns"
import {
  TodoAssignee,
  TodoConversationButton,
  TodoCreationInfo,
  TodoSchedule,
} from "./todo-card"
import { TodoEditorDialog } from "./todo-editor-dialog"

/** Exact task details are independent of the board's current completed page. */
export function TodoSourceDetailDialog({
  origin,
  onClose,
}: {
  origin: TodoOrigin
  onClose: () => void
}) {
  const t = useTranslations("Todos")
  const { refetch } = useTodosView()
  const [detail, setDetail] = useState<TodoOriginResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<Todo | null>(null)
  const alive = useRef(true)
  const sequence = useRef(0)
  const reading = useRef<number | null>(null)
  const writing = useRef(false)

  const read = useCallback(async () => {
    if (reading.current !== null || writing.current) return
    const seq = ++sequence.current
    reading.current = seq
    try {
      const next = await todoOriginCall({ origin, action: "get" })
      if (alive.current && seq === sequence.current) {
        setDetail(next)
        setError(null)
      }
    } catch (cause) {
      if (alive.current && seq === sequence.current)
        setError(toErrorMessage(cause))
    } finally {
      if (reading.current === seq) reading.current = null
      if (alive.current && seq === sequence.current) setLoading(false)
    }
  }, [origin])

  const invalidateReads = useCallback(() => {
    alive.current = false
    ++sequence.current
    reading.current = null
  }, [])

  useEffect(() => {
    alive.current = true
    void read()
    const refresh = () => {
      if (document.visibilityState !== "hidden") void read()
    }
    const interval = window.setInterval(refresh, 5_000)
    window.addEventListener("online", refresh)
    return () => {
      invalidateReads()
      window.clearInterval(interval)
      window.removeEventListener("online", refresh)
    }
  }, [read, invalidateReads])

  const change = useCallback(
    async (request: Omit<TodoOriginRequest, "origin">) => {
      if (writing.current) throw new Error("A todo change is already pending")
      writing.current = true
      reading.current = null
      const seq = ++sequence.current
      setBusy(true)
      try {
        const next = await todoOriginCall({ ...request, origin })
        if (alive.current && seq === sequence.current) {
          setDetail(next)
          setError(null)
        }
        void refetch()
        return next
      } finally {
        writing.current = false
        if (alive.current) {
          setBusy(false)
          // Refresh the revision after a conflict without replacing editor input.
          void read()
        }
      }
    },
    [origin, read, refetch]
  )

  const todo = detail?.todo
  const status = todo
    ? t(TODO_COLUMN_LABELS[todoColumn(todo, detail.self_id)])
    : ""
  const scope = detail
    ? detail.mode === "personal"
      ? t("personalMode")
      : detail.scope_name
    : ""
  const canWrite = !!todo && !busy && !error

  async function save(request: TodoRequest) {
    if (request.action !== "update") return
    await change({
      action: "update",
      due_date: request.due_date,
      priority: request.priority,
      title: request.title,
      content: request.content,
      assignee_id: request.assignee_id,
      revision: request.revision,
    })
  }

  function statusAction() {
    if (!todo) return
    const action =
      todo.status === "completed"
        ? "reopen"
        : todo.status === "pending_verification"
          ? "verify"
          : todo.status === "unclaimed"
            ? "claim"
            : "complete"
    void change({ action, revision: todo.revision })
      .then(() => {
        if ((action === "complete" || action === "verify") && alive.current)
          onClose()
      })
      .catch((cause) => {
        toast.error(t("operationFailed", { reason: toErrorMessage(cause) }))
      })
  }

  if (editing && detail) {
    return (
      <TodoEditorDialog
        key={`${editing.id}:${editing.revision}`}
        scopeId={origin.scope_id}
        todo={editing}
        latestTodo={todo ?? undefined}
        draft={null}
        members={detail.members}
        disabled={!canWrite}
        onReload={() => todo && setEditing(todo)}
        onClose={() => setEditing(null)}
        onSubmit={save}
      />
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        className="todo-theme min-w-0 max-w-xl grid-cols-1 overflow-x-hidden overflow-y-auto [&>*]:min-w-0"
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle className="wrap-anywhere">
            {todo?.title ?? t("title")}
          </DialogTitle>
          <DialogDescription>
            {todo ? t("sourceTodoScope", { scope, status }) : t("title")}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2
              className="size-5 animate-spin text-muted-foreground"
              aria-label={t("loading")}
            />
          </div>
        ) : (
          <>
            {error && (
              <div role="alert" className="space-y-2">
                <p className="text-sm text-destructive wrap-anywhere">
                  {t("operationFailed", { reason: error })}
                </p>
                <Button variant="outline" onClick={() => void read()}>
                  {t("retry")}
                </Button>
              </div>
            )}
            {todo && detail ? (
              <>
                <TodoAssignee
                  member={detail.members.find(
                    (member) => member.id === todo.assignee_id
                  )}
                />
                <TodoCreationInfo
                  todo={todo}
                  creator={detail.members.find(
                    (member) => member.id === todo.creator_id
                  )}
                />
                <TodoSchedule todo={todo} />
                <div className="max-h-80 overflow-auto whitespace-pre-wrap text-sm leading-6 wrap-anywhere">
                  <TodoMarkdown content={todo.content} />
                </div>
                {todo.source_url && (
                  <BrowserLink
                    href={todo.source_url}
                    className="w-fit text-xs text-primary underline underline-offset-4"
                  >
                    {t("sourceConversation")}
                  </BrowserLink>
                )}
                <DialogFooter className="min-w-0 sm:flex-wrap">
                  <TodoImportConversationButton todo={todo} origin={origin} />
                  <TodoConversationButton todo={todo} />
                  <Button
                    variant="outline"
                    disabled={!canWrite}
                    onClick={() => setEditing(todo)}
                  >
                    {t("edit")}
                  </Button>
                  <Button disabled={!canWrite} onClick={statusAction}>
                    {busy && <Loader2 className="size-4 animate-spin" />}
                    {t(
                      todo.status === "completed"
                        ? "reopen"
                        : todo.status === "pending_verification"
                          ? "verify"
                          : todo.status === "unclaimed"
                            ? "claim"
                            : "complete"
                    )}
                  </Button>
                </DialogFooter>
              </>
            ) : (
              !error && <p className="text-sm">{t("todoUnavailable")}</p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
