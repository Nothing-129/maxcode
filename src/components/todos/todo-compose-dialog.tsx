"use client"

import { useEffect, useRef, useState } from "react"
import { useTodosView } from "@/contexts/todos-view-context"
import {
  consumePendingTodoDraft,
  TODO_COMPOSE_EVENT,
  TODO_OPEN_EVENT,
  type TodoComposeDraft,
} from "@/lib/todo-compose-events"
import { TodoEditorDialog } from "./todo-editor-dialog"
import { TodoTeamsDialog } from "./todo-teams-dialog"

/** Always mounted: message actions open an editor without leaving the chat. */
export function TodoComposeDialog() {
  const { state, busy, error, mutate } = useTodosView()
  const sequence = useRef(0)
  const [request, setRequest] = useState<{
    id: number
    draft: TodoComposeDraft
  } | null>(null)
  const [teamsOpen, setTeamsOpen] = useState(false)

  useEffect(() => {
    const consume = () => {
      const draft = consumePendingTodoDraft()
      if (!draft) return
      setTeamsOpen(false)
      setRequest({ id: ++sequence.current, draft })
    }
    const dismiss = () => {
      setRequest(null)
      setTeamsOpen(false)
    }
    consume()
    window.addEventListener(TODO_COMPOSE_EVENT, consume)
    window.addEventListener(TODO_OPEN_EVENT, dismiss)
    return () => {
      window.removeEventListener(TODO_COMPOSE_EVENT, consume)
      window.removeEventListener(TODO_OPEN_EVENT, dismiss)
    }
  }, [])

  if (!request) return null
  const needsTeam = state?.mode === "team" && !state.active_team_id
  if (needsTeam || teamsOpen) {
    return (
      <TodoTeamsDialog
        onClose={() => {
          setTeamsOpen(false)
          setRequest(null)
        }}
        onStart={() => setTeamsOpen(true)}
        onJoined={() => setTeamsOpen(false)}
      />
    )
  }
  return (
    <TodoEditorDialog
      key={request.id}
      todo={null}
      draft={request.draft}
      members={state?.members ?? []}
      disabled={!state?.self_id || busy || !!error}
      onClose={() => setRequest(null)}
      onSubmit={mutate}
    />
  )
}
