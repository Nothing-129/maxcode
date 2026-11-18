"use client"

import { Plus, RefreshCw } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useTodosView } from "@/contexts/todos-view-context"
import { requestCreateTodo } from "@/lib/todo-compose-events"
import { cn } from "@/lib/utils"

export function TodoSearchActions({ canWrite }: { canWrite: boolean }) {
  const t = useTranslations("Todos")
  const { loading, busy, refetch } = useTodosView()
  const [refreshing, setRefreshing] = useState(false)
  const refreshLabel = t("refreshTodos")
  return (
    <div className="ms-auto flex shrink-0 items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        aria-label={refreshLabel}
        title={refreshLabel}
        aria-busy={refreshing}
        disabled={loading || busy || refreshing}
        onClick={async () => {
          setRefreshing(true)
          try {
            await refetch(true)
          } finally {
            setRefreshing(false)
          }
        }}
      >
        <RefreshCw
          className={cn("size-3.5", refreshing && "motion-safe:animate-spin")}
          aria-hidden="true"
        />
      </Button>
      <Button
        size="sm"
        className="h-8 gap-1 px-2.5 text-xs"
        disabled={!canWrite}
        onClick={() => requestCreateTodo({ text: "" })}
      >
        <Plus className="size-3.5" />
        {t("newTodo")}
      </Button>
    </div>
  )
}
