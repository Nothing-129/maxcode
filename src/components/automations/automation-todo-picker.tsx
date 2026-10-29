"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import {
  todoCall,
  todoOriginCall,
  todoSearch,
  type TodoOrigin,
  type TodoSearchResult,
  type TodoTeam,
} from "@/lib/todos"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"

export function AutomationTodoPicker({
  value,
  onChange,
}: {
  value: TodoOrigin[]
  onChange: (value: TodoOrigin[]) => void
}) {
  const t = useTranslations("Automations")
  const tt = useTranslations("Todos")
  const [teams, setTeams] = useState<TodoTeam[]>([])
  const [scope, setScope] = useState("personal")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<TodoSearchResult | null>(null)
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const resultMatches =
    result?.scope_id === scope &&
    result.pagination.page === page &&
    result.pagination.search === search.trim()
  const visibleResult = resultMatches ? result : null
  const queryLoading = loading || (!resultMatches && !error)
  const key = (origin: TodoOrigin) => `${origin.scope_id}:${origin.todo_id}`

  useEffect(() => {
    let cancelled = false
    void todoCall({ action: "state" })
      .then((state) => {
        if (!cancelled) setTeams(state.teams)
      })
      .catch((e) => !cancelled && setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [revision])

  useEffect(() => {
    let cancelled = false
    for (const origin of value) {
      void todoOriginCall({ origin, action: "get" })
        .then((source) => {
          if (!cancelled && source.todo) {
            const title = source.todo.title
            setTitles((prev) => ({ ...prev, [key(origin)]: title }))
          }
        })
        .catch(() => {}) // Keep an unavailable attachment removable.
    }
    return () => {
      cancelled = true
    }
  }, [value])

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      setLoading(true)
      setResult(null)
      setError(null)
      void todoSearch({
        scope_id: scope,
        search: search.trim(),
        page,
        page_size: 20,
      })
        .then((next) => {
          if (!cancelled) setResult(next)
        })
        .catch((e) => !cancelled && setError(String(e)))
        .finally(() => !cancelled && setLoading(false))
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [scope, search, page, revision])

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">
        {t("attachedTodos")}
      </h3>
      <p className="text-xs text-muted-foreground">{t("attachedTodosHint")}</p>
      {value.map((origin) => (
        <div
          key={key(origin)}
          className="flex items-center justify-between gap-2 rounded border p-2 text-sm"
        >
          <span className="truncate">
            {titles[key(origin)] ?? origin.todo_id}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              onChange(value.filter((item) => key(item) !== key(origin)))
            }
          >
            {tt("unlinkTodo")}
          </Button>
        </div>
      ))}
      <div className="flex gap-2">
        <select
          aria-label={t("todoScope")}
          className="max-w-48 rounded-md border bg-background px-2 text-sm"
          value={scope}
          onChange={(event) => {
            setScope(event.target.value)
            setPage(1)
          }}
        >
          <option value="personal">{t("personalTodos")}</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
        <Input
          value={search}
          aria-label={tt("searchTodos")}
          placeholder={tt("searchTodos")}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
        />
      </div>
      <div
        className="max-h-48 overflow-y-auto space-y-1"
        aria-busy={queryLoading}
      >
        {queryLoading ? (
          <p className="text-xs text-muted-foreground">{tt("loading")}</p>
        ) : (
          visibleResult?.todos.map((todo) => {
            const origin = { scope_id: scope, todo_id: todo.id }
            const checked = value.some((item) => key(item) === key(origin))
            return (
              <label
                key={todo.id}
                className="flex items-center gap-2 rounded border p-2 text-sm"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(selected) => {
                    setTitles((prev) => ({
                      ...prev,
                      [key(origin)]: todo.title,
                    }))
                    onChange(
                      selected === true
                        ? [...value, origin]
                        : value.filter((item) => key(item) !== key(origin))
                    )
                  }}
                />
                <span className="truncate">{todo.title}</span>
              </label>
            )
          })
        )}
        {!queryLoading && visibleResult?.todos.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {tt("noMatchingTodos")}
          </p>
        )}
      </div>
      {visibleResult && visibleResult.pagination.total > 20 && (
        <div className="flex justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={queryLoading || page <= 1}
            onClick={() => setPage(page - 1)}
          >
            {tt("previousPage")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={
              queryLoading || page * 20 >= visibleResult.pagination.total
            }
            onClick={() => setPage(page + 1)}
          >
            {tt("nextPage")}
          </Button>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setRevision(revision + 1)}
          >
            {tt("retry")}
          </Button>
        </div>
      )}
    </section>
  )
}
