"use client"

import { Kanban, List, Users } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import type { WorkbenchChromeActionsProps } from "@/components/workbench/workbench-content"
import { useTodosView } from "@/contexts/todos-view-context"

export const OPEN_TODO_TEAMS_EVENT = "maxcode:open-todo-teams"

export function TodosChromeActions({
  buttonClassName,
  iconClassName,
}: WorkbenchChromeActionsProps) {
  const t = useTranslations("Todos")
  const { state, viewMode, setViewMode } = useTodosView()
  const toList = viewMode === "board"
  const label = t(toList ? "viewSwitchToList" : "viewSwitchToBoard")
  return (
    <>
      {state && state.todos.length > 0 && (
        <Button
          variant="ghost"
          size="icon"
          className={buttonClassName}
          aria-label={label}
          title={label}
          onClick={() => setViewMode(toList ? "list" : "board")}
        >
          {toList ? (
            <List className={iconClassName} />
          ) : (
            <Kanban className={iconClassName} />
          )}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className={buttonClassName}
        aria-label={t("teams")}
        title={t("teams")}
        onClick={() => window.dispatchEvent(new Event(OPEN_TODO_TEAMS_EVENT))}
      >
        <Users className={iconClassName} />
      </Button>
    </>
  )
}
