"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { onTransportReconnect, subscribe } from "@/lib/platform"
import { toErrorMessage } from "@/lib/app-error"
import {
  todoCall,
  todoScopeKey,
  type TodoRequest,
  type TodoScheduleFilter,
  type TodoState,
} from "@/lib/todos"

import { todoToday } from "@/lib/todo-schedule"
import { subscribeRemoteTodoChanges } from "@/lib/todo-team-events"

interface TodosViewContextValue {
  state: TodoState | null
  loading: boolean
  error: string | null
  busy: boolean
  attentionCount: number
  refetch: (queueIfPending?: boolean) => Promise<void>
  mutate: (request: TodoRequest) => Promise<TodoState>
  viewMode: "board" | "list"
  setViewMode: (mode: "board" | "list") => void
  completedPageLoading: boolean
  setCompletedPage: (page: number) => Promise<void>
  setCompletedSearch: (search: string) => Promise<void>
  scheduleFilter: TodoScheduleFilter
  setScheduleFilter: (filter: TodoScheduleFilter) => Promise<void>
}

const TodosViewContext = createContext<TodosViewContextValue | null>(null)

export function useOptionalTodosView() {
  return useContext(TodosViewContext)
}

export function useTodosView() {
  const context = useOptionalTodosView()
  if (!context) throw new Error("useTodosView requires TodosViewProvider")
  return context
}

/** Prevent a disconnected team from borrowing another scope's cached tasks. */
export function reconcileTodoState(
  previous: TodoState | null,
  next: TodoState
) {
  if (
    next.connection_error &&
    previous &&
    todoScopeKey(previous) === todoScopeKey(next)
  ) {
    const previousPage = previous.completed_pagination
    const nextPage = next.completed_pagination
    const samePage =
      (previousPage?.page ?? 1) === (nextPage?.page ?? 1) &&
      (previousPage?.page_size ?? 20) === (nextPage?.page_size ?? 20) &&
      (previousPage?.search ?? "") === (nextPage?.search ?? "") &&
      (previousPage?.filter ?? "all") === (nextPage?.filter ?? "all") &&
      (previousPage?.today ?? "") === (nextPage?.today ?? "")
    return {
      ...next,
      todos: samePage
        ? previous.todos
        : previous.todos.filter((todo) => todo.status !== "completed"),
      members: previous.members,
      ...(samePage && previousPage
        ? { completed_pagination: previousPage }
        : {}),
    }
  }
  return next
}

export function TodosViewProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TodoState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [viewMode, setViewModeState] = useState<"board" | "list">("board")
  const [completedPageLoading, setCompletedPageLoading] = useState(false)
  const requestSeq = useRef(0)
  const mutationPending = useRef(false)
  const readPending = useRef<number | null>(null)
  const readQueued = useRef(false)
  const selectedScope = useRef<string | null>(null)
  selectedScope.current = state
    ? state.mode === "personal"
      ? "personal"
      : state.active_team_id
    : null
  const [scheduleFilter, setScheduleFilterState] =
    useState<TodoScheduleFilter>("all")
  const completedQuery = useRef({
    page: 1,
    search: "",
    filter: "all" as TodoScheduleFilter,
  })

  const accept = useCallback((next: TodoState) => {
    setState((previous) => reconcileTodoState(previous, next))
    setError(next.connection_error ?? null)
    setLoading(false)
    setCompletedPageLoading(false)
    if (next.completed_pagination && !next.connection_error) {
      completedQuery.current.page = next.completed_pagination.page
    }
  }, [])

  const refetch = useCallback(
    async function readState(queueIfPending = false) {
      if (mutationPending.current) return
      if (readPending.current !== null) {
        if (queueIfPending) readQueued.current = true
        return
      }
      readQueued.current = false
      const seq = ++requestSeq.current
      readPending.current = seq
      const query = { ...completedQuery.current }
      try {
        const next = await todoCall({
          action: "state",
          completed_page: query.page,
          completed_page_size: 20,
          completed_search: query.search,
          completed_filter: query.filter,
          today: todoToday(),
        })
        if (seq === requestSeq.current) accept(next)
      } catch (failure) {
        if (seq === requestSeq.current) {
          const message = toErrorMessage(failure)
          setError(message)
          setState((previous) =>
            previous
              ? reconcileTodoState(previous, {
                  ...previous,
                  todos: [],
                  connection_error: message,
                  completed_pagination: {
                    page: query.page,
                    page_size: 20,
                    total:
                      (previous.completed_pagination?.search ?? "") ===
                        query.search &&
                      (previous.completed_pagination?.filter ?? "all") ===
                        query.filter &&
                      (!previous.completed_pagination?.today ||
                        previous.completed_pagination.today === todoToday())
                        ? (previous.completed_pagination?.total ?? 0)
                        : 0,
                    search: query.search,
                    filter: query.filter,
                    today: todoToday(),
                  },
                })
              : null
          )
          setLoading(false)
          setCompletedPageLoading(false)
        }
      } finally {
        if (readPending.current === seq) {
          readPending.current = null
          if (readQueued.current) void readState()
        }
      }
    },
    [accept]
  )

  const mutate = useCallback(
    async (request: TodoRequest) => {
      if (mutationPending.current)
        throw new Error("A todo change is already pending")
      mutationPending.current = true
      setBusy(true)
      const seq = ++requestSeq.current
      readPending.current = null
      // Clear immediately when changing scope, including on failed switches.
      // Never paint the previous scope's tasks under the newly selected label.
      if (
        request.action === "set_mode" ||
        request.action === "create_team" ||
        request.action === "join_team" ||
        request.action === "remove_team" ||
        request.action === "dissolve_team"
      ) {
        completedQuery.current = { page: 1, search: "", filter: "all" }
        setScheduleFilterState("all")
        setLoading(true)
        setState(null)
      }
      const query = { ...completedQuery.current }
      try {
        const next = await todoCall({
          ...request,
          completed_page: query.page,
          completed_page_size: 20,
          completed_search: query.search,
          completed_filter: query.filter,
          today: todoToday(),
        })
        if (
          seq === requestSeq.current &&
          query.page === completedQuery.current.page &&
          query.search === completedQuery.current.search &&
          query.filter === completedQuery.current.filter
        ) {
          accept(next)
        }
        return next
      } catch (failure) {
        if (seq === requestSeq.current) setError(toErrorMessage(failure))
        throw failure
      } finally {
        mutationPending.current = false
        setBusy(false)
        setLoading(false)
        // Recover server-confirmed state after conflicts and interrupted writes.
        void refetch()
      }
    },
    [accept, refetch]
  )

  const setCompletedPage = useCallback(
    async (page: number) => {
      const normalized = Number.isFinite(page)
        ? Math.max(1, Math.floor(page))
        : 1
      if (normalized === completedQuery.current.page) return
      completedQuery.current.page = normalized
      setCompletedPageLoading(true)
      if (mutationPending.current) return
      ++requestSeq.current
      readPending.current = null
      await refetch()
    },
    [refetch]
  )

  const setCompletedSearch = useCallback(
    async (search: string) => {
      const normalized = search.trim()
      if (normalized === completedQuery.current.search) return
      completedQuery.current = {
        ...completedQuery.current,
        page: 1,
        search: normalized,
      }
      setCompletedPageLoading(true)
      if (mutationPending.current) return
      ++requestSeq.current
      readPending.current = null
      await refetch()
    },
    [refetch]
  )

  const setScheduleFilter = useCallback(
    async (filter: TodoScheduleFilter) => {
      if (filter === completedQuery.current.filter) return
      completedQuery.current = { ...completedQuery.current, page: 1, filter }
      setScheduleFilterState(filter)
      setCompletedPageLoading(true)
      if (mutationPending.current) return
      ++requestSeq.current
      readPending.current = null
      await refetch()
    },
    [refetch]
  )

  const invalidateReads = useCallback(() => {
    ++requestSeq.current
    readPending.current = null
    readQueued.current = false
  }, [])

  const refreshVisible = useCallback(() => {
    if (document.visibilityState !== "hidden") void refetch(true)
  }, [refetch])

  useEffect(() => {
    void refetch()
    let disposed = false
    let unlisten: (() => void) | undefined
    let stopReconnect: (() => void) | null = null
    void Promise.resolve()
      .then(() =>
        subscribe<{ scope_id?: string; selection_changed?: boolean }>(
          "todos://changed",
          ({ scope_id, selection_changed }) => {
            if (
              !disposed &&
              (selection_changed ||
                !scope_id ||
                !selectedScope.current ||
                scope_id === selectedScope.current)
            ) {
              refreshVisible()
            }
          }
        )
      )
      .then((dispose) => {
        if (disposed) dispose?.()
        else {
          unlisten = dispose
          stopReconnect = onTransportReconnect(refreshVisible)
        }
      })
      .catch(() => {})
    document.addEventListener("visibilitychange", refreshVisible)
    window.addEventListener("online", refreshVisible)
    return () => {
      disposed = true
      unlisten?.()
      stopReconnect?.()
      invalidateReads()
      document.removeEventListener("visibilitychange", refreshVisible)
      window.removeEventListener("online", refreshVisible)
    }
  }, [refetch, refreshVisible, invalidateReads])

  const remoteTeamId =
    state?.mode === "team"
      ? state.teams.find(
          (team) => team.id === state.active_team_id && !team.is_local
        )?.id
      : undefined
  useEffect(() => {
    if (remoteTeamId)
      return subscribeRemoteTodoChanges(remoteTeamId, refreshVisible)
  }, [remoteTeamId, refreshVisible])

  const scope = state ? todoScopeKey(state) : null
  useEffect(() => {
    if (!scope) return
    try {
      const saved = localStorage.getItem(`maxcode:todos:view:${scope}`)
      // A scope change restores its own layout preference.
      setViewModeState(saved === "list" ? "list" : "board")
    } catch {
      setViewModeState("board")
    }
  }, [scope])

  const setViewMode = useCallback(
    (mode: "board" | "list") => {
      setViewModeState(mode)
      try {
        if (scope) localStorage.setItem(`maxcode:todos:view:${scope}`, mode)
      } catch {
        // Storage may be disabled; the live layout switch still works.
      }
    },
    [scope]
  )

  const attentionCount =
    state?.todos.filter(
      (todo) => todo.status === "claimed" && todo.assignee_id === state.self_id
    ).length ?? 0
  const value = useMemo(
    () => ({
      state,
      loading,
      error,
      busy,
      attentionCount,
      refetch,
      mutate,
      viewMode,
      setViewMode,
      completedPageLoading,
      setCompletedPage,
      setCompletedSearch,
      scheduleFilter,
      setScheduleFilter,
    }),
    [
      state,
      loading,
      error,
      busy,
      attentionCount,
      refetch,
      mutate,
      viewMode,
      setViewMode,
      completedPageLoading,
      setCompletedPage,
      setCompletedSearch,
      scheduleFilter,
      setScheduleFilter,
    ]
  )
  return (
    <TodosViewContext.Provider value={value}>
      {children}
    </TodosViewContext.Provider>
  )
}
