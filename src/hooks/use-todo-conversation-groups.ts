"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useOptionalTodosView } from "@/contexts/todos-view-context"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { subscribeTodoConversationLinksChanged } from "@/lib/todo-conversation-events"
import {
  todoConversationGroups,
  todoScopeKey,
  type TodoConversationGroupsState,
  type TodoConversationGroup,
} from "@/lib/todos"

const EMPTY_GROUPS: TodoConversationGroup[] = []

/** Local conversation links are queried separately from completed-todo pages. */
export function useTodoConversationGroups() {
  const todos = useOptionalTodosView()
  const state = todos?.state
  const scope = state ? todoScopeKey(state) : null
  const conversations = useAppWorkspaceStore((store) => store.conversations)
  const conversationIds = useMemo(
    () =>
      conversations
        .map((conversation) => conversation.id)
        .sort((a, b) => a - b)
        .join(","),
    [conversations]
  )
  const [snapshot, setSnapshot] = useState<TodoConversationGroupsState | null>(
    null
  )
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const requestSeq = useRef(0)
  const pending = useRef(false)
  const queued = useRef(false)
  const refreshRef = useRef<() => Promise<void>>(async () => {})

  const refresh = useCallback(async () => {
    if (!scope) return
    if (pending.current) {
      queued.current = true
      return
    }
    pending.current = true
    const seq = ++requestSeq.current
    try {
      const next = await todoConversationGroups()
      if (
        seq === requestSeq.current &&
        scopeRef.current === scope &&
        next.scope_key === scope
      ) {
        setSnapshot((previous) =>
          next.connection_error && previous?.scope_key === scope
            ? { ...next, groups: previous.groups }
            : next
        )
      }
    } catch {
      // Keep the same scope's last confirmed groups while its host is offline.
    } finally {
      if (seq === requestSeq.current) {
        pending.current = false
        if (queued.current) {
          queued.current = false
          void refreshRef.current()
        }
      }
    }
  }, [scope])
  refreshRef.current = refresh

  const invalidateReads = useCallback(() => {
    ++requestSeq.current
    pending.current = false
    queued.current = false
  }, [])

  useEffect(() => invalidateReads, [scope, invalidateReads])

  useEffect(() => {
    void refresh()
  }, [refresh, state, conversationIds])

  useEffect(() => {
    if (!scope) return
    return subscribeTodoConversationLinksChanged(() => {
      void refreshRef.current()
    })
  }, [scope])

  return snapshot?.scope_key === scope ? snapshot.groups : EMPTY_GROUPS
}
