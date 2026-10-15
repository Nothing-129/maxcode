"use client"

import { useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2, Link2, Unlink } from "lucide-react"
import {
  todoConversationLink,
  todoConversationSources,
  todoSearch,
  type TodoConversationSource,
  type TodoOrigin,
  type TodoSearchResult,
} from "@/lib/todos"
import { notifyTodoConversationLinksChanged } from "@/lib/todo-conversation-events"
import { toErrorMessage } from "@/lib/app-error"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/** Captured at menu activation so tab/scope switches cannot retarget a write. */
export interface TodoConversationLinkTarget {
  conversationId: number
  title: string
  scopeId: string
  scopeName: string
}

export function TodoConversationLinkDialog({
  target,
  onClose,
}: {
  target: TodoConversationLinkTarget
  onClose: () => void
}) {
  const t = useTranslations("Todos")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<TodoSearchResult | null>(null)
  const [sources, setSources] = useState<TodoConversationSource[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [sourcesError, setSourcesError] = useState<string | null>(null)
  const [readRevision, setReadRevision] = useState(0)
  const sourcesRequest = useRef(0)
  const mutationPending = useRef(false)
  const resultMatches =
    result?.scope_id === target.scopeId &&
    result.pagination.search === search.trim() &&
    result.pagination.page === page

  useEffect(() => {
    let disposed = false
    const timer = setTimeout(
      () => {
        setLoading(true)
        setSearchError(null)
        void todoSearch({
          scope_id: target.scopeId,
          search: search.trim(),
          page,
          page_size: 20,
        })
          .then((next) => {
            if (!disposed && next.scope_id === target.scopeId) {
              setResult(next)
              setPage(next.pagination.page)
            }
          })
          .catch((cause) => !disposed && setSearchError(toErrorMessage(cause)))
          .finally(() => !disposed && setLoading(false))
      },
      search ? 200 : 0
    )
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [target.scopeId, search, page, readRevision])

  useEffect(() => {
    let disposed = false
    const request = ++sourcesRequest.current
    void todoConversationSources(target.conversationId)
      .then((next) => {
        if (
          !disposed &&
          request === sourcesRequest.current &&
          next.conversation_id === target.conversationId
        ) {
          setSources(next.sources)
          setSourcesError(null)
        }
      })
      .catch(
        (cause) =>
          !disposed &&
          request === sourcesRequest.current &&
          setSourcesError(toErrorMessage(cause))
      )
    return () => {
      disposed = true
    }
  }, [target.conversationId, readRevision])

  async function change(origin: TodoOrigin, action: "link" | "unlink") {
    if (mutationPending.current) return
    mutationPending.current = true
    setBusy(true)
    setError(null)
    setSourcesError(null)
    const request = ++sourcesRequest.current
    try {
      await todoConversationLink({
        conversation_id: target.conversationId,
        origin,
        action,
      })
      notifyTodoConversationLinksChanged(target.conversationId)
      const next = await todoConversationSources(target.conversationId)
      if (
        request === sourcesRequest.current &&
        next.conversation_id === target.conversationId
      )
        setSources(next.sources)
    } catch (cause) {
      setError(toErrorMessage(cause))
    } finally {
      mutationPending.current = false
      setBusy(false)
    }
  }

  const totalPages = Math.max(
    1,
    Math.ceil((result?.pagination.total ?? 0) / 20)
  )
  const queryLoading = (loading || !resultMatches) && !searchError
  const displayedError = error ?? searchError ?? sourcesError

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        className="min-w-0 max-w-xl grid-cols-1 overflow-x-hidden overflow-y-auto [&>*]:min-w-0"
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle>{t("linkConversation")}</DialogTitle>
          <DialogDescription>
            {t("linkConversationDescription", { title: target.title })}
          </DialogDescription>
        </DialogHeader>
        {sources.length > 0 && (
          <div className="min-w-0 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              {t("linkedTodos")}
            </p>
            {sources.map((source) => (
              <div
                key={`${source.origin.scope_id}:${source.origin.todo_id}`}
                className="flex min-w-0 items-center gap-2 rounded-md border p-2"
              >
                <span
                  className="min-w-0 flex-1 truncate text-sm"
                  title={source.todo?.title ?? source.scope_name}
                >
                  {source.todo?.title ?? t("sourceTodo")}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {source.scope_name}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void change(source.origin, "unlink")}
                >
                  <Unlink className="size-3.5" />
                  {t("unlinkTodo")}
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="min-w-0 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            {target.scopeName}
          </p>
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
            aria-label={t("searchTodos")}
            placeholder={t("searchTodos")}
            disabled={busy}
          />
          <div
            className="max-h-[min(40vh,22rem)] min-h-24 space-y-1 overflow-y-auto"
            aria-busy={queryLoading}
          >
            {queryLoading ? (
              <div className="flex justify-center py-6">
                <Loader2
                  className="size-4 animate-spin"
                  aria-label={t("loading")}
                />
              </div>
            ) : resultMatches && result?.todos.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t("noMatchingTodos")}
              </p>
            ) : (
              resultMatches &&
              result?.todos.map((todo) => {
                const linked = sources.some(
                  (source) =>
                    source.origin.scope_id === target.scopeId &&
                    source.origin.todo_id === todo.id
                )
                const member = result.members.find(
                  (person) => person.id === todo.assignee_id
                )
                const status =
                  todo.status === "completed"
                    ? "colCompleted"
                    : todo.status === "unclaimed"
                      ? "colUnclaimed"
                      : "colClaimed"
                return (
                  <div
                    key={todo.id}
                    className="flex min-w-0 items-center gap-2 rounded-md border p-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm" title={todo.title}>
                        {todo.title}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {t(status)}
                        {member ? ` · ${member.name}` : ""}
                      </p>
                    </div>
                    <Button
                      variant={linked ? "ghost" : "outline"}
                      size="sm"
                      disabled={busy || linked}
                      onClick={() =>
                        void change(
                          { scope_id: target.scopeId, todo_id: todo.id },
                          "link"
                        )
                      }
                    >
                      <Link2 className="size-3.5" />
                      {t(linked ? "alreadyLinked" : "linkTodo")}
                    </Button>
                  </div>
                )
              })
            )}
          </div>
          {result && totalPages > 1 && (
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy || queryLoading || page <= 1}
                onClick={() => setPage(page - 1)}
              >
                {t("previousPage")}
              </Button>
              <span className="text-xs text-muted-foreground">
                {t("pageOf", { page, pages: totalPages })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || queryLoading || page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                {t("nextPage")}
              </Button>
            </div>
          )}
        </div>
        {displayedError && (
          <div className="flex min-w-0 items-center gap-2">
            <p role="alert" className="min-w-0 flex-1 text-sm text-destructive">
              {displayedError}
            </p>
            {(searchError || sourcesError) && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy || loading}
                onClick={() => setReadRevision((revision) => revision + 1)}
              >
                {t("retry")}
              </Button>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
