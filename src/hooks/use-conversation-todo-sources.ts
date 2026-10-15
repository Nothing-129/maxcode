"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useOptionalTodosView } from "@/contexts/todos-view-context"
import {
  todoConversationSources,
  type TodoConversationSourcesState,
  type TodoConversationSource,
} from "@/lib/todos"
import { subscribeTodoConversationLinksChanged } from "@/lib/todo-conversation-events"

const EMPTY_SOURCES: TodoConversationSource[] = []

export function useConversationTodoSources(conversationId: number | null) {
  const todos = useOptionalTodosView()
  const enabled = todos != null
  const [snapshot, setSnapshot] = useState<TodoConversationSourcesState | null>(
    null
  )
  const identity = enabled ? conversationId : null
  const identityRef = useRef(identity)
  identityRef.current = identity
  const seq = useRef(0)
  const pending = useRef(false)
  const queued = useRef(false)
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  const refresh = useCallback(async () => {
    if (identity == null) return
    if (pending.current) {
      queued.current = true
      return
    }
    pending.current = true
    const request = ++seq.current
    try {
      const next = await todoConversationSources(identity)
      if (
        request === seq.current &&
        identityRef.current === identity &&
        next.conversation_id === identity
      ) {
        setSnapshot(next)
      }
    } catch {
      // Retain this conversation's last confirmed sources until reconnecting.
    } finally {
      if (request === seq.current) {
        pending.current = false
        if (queued.current) {
          queued.current = false
          void refreshRef.current()
        }
      }
    }
  }, [identity])
  refreshRef.current = refresh
  const invalidate = useCallback(() => {
    ++seq.current
    pending.current = false
    queued.current = false
  }, [])
  useEffect(() => invalidate, [identity, invalidate])
  useEffect(() => {
    void refresh()
  }, [refresh, todos?.state])
  useEffect(() => {
    if (identity == null) return
    return subscribeTodoConversationLinksChanged((id) => {
      if (id === identity) void refresh()
    })
  }, [identity, refresh])
  return {
    sources:
      snapshot?.conversation_id === identity ? snapshot.sources : EMPTY_SOURCES,
    refresh,
  }
}
