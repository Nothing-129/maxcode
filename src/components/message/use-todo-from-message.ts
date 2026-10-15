"use client"

import { useCallback } from "react"
import { useOptionalWorkbenchRoute } from "@/contexts/workbench-route-context"
import { requestCreateTodo } from "@/lib/todo-compose-events"

/** Hand a message to the independent todo editor as an unsaved draft. */
export function useTodoFromMessage(getText: () => string) {
  const route = useOptionalWorkbenchRoute()
  const available = !!route

  const addTodo = useCallback(() => {
    const text = getText()
    if (!text.trim() || !available) return
    requestCreateTodo({ text })
  }, [getText, available])

  return available ? addTodo : null
}
