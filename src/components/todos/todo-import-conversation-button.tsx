"use client"

import { useRef, useState } from "react"
import { Download } from "lucide-react"
import { useTranslations } from "next-intl"
import { useOptionalTodosView } from "@/contexts/todos-view-context"
import { useOptionalWorkbenchRoute } from "@/contexts/workbench-route-context"
import { Button } from "@/components/ui/button"
import { todoImportCodexSession, type Todo, type TodoOrigin } from "@/lib/todos"
import { toErrorMessage } from "@/lib/app-error"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { useTabStore } from "@/stores/tab-store"
import { TodoConversationFolderDialog } from "./todo-conversation-folder-dialog"

export function TodoImportConversationButton({
  todo,
  origin,
}: {
  todo: Todo
  origin?: TodoOrigin
}) {
  const t = useTranslations("Todos")
  const view = useOptionalTodosView()
  const route = useOptionalWorkbenchRoute()
  const [target, setTarget] = useState<TodoOrigin | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const importing = useRef(false)
  if (!todo.codex_import_available) return null

  const startImport = async (folderId: number) => {
    if (!target || importing.current) return
    importing.current = true
    setBusy(true)
    setError(null)
    try {
      const conversation = await todoImportCodexSession({
        origin: target,
        folder_id: folderId,
      })
      await useAppWorkspaceStore.getState().refreshConversations()
      useTabStore
        .getState()
        .openTab(
          conversation.folder_id,
          conversation.id,
          conversation.agent_type,
          true,
          conversation.title ?? undefined
        )
      setTarget(null)
      route?.setRoute("conversations")
    } catch (cause) {
      setError(toErrorMessage(cause))
    } finally {
      importing.current = false
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        title={t("importCodexConversation")}
        aria-label={t("importCodexConversation")}
        disabled={busy || (!origin && !!view?.state?.connection_error)}
        onClick={() => {
          const scope =
            view?.state?.mode === "personal"
              ? "personal"
              : view?.state?.active_team_id
          const captured =
            origin ?? (scope ? { scope_id: scope, todo_id: todo.id } : null)
          if (captured) {
            setError(null)
            setTarget({ ...captured })
          }
        }}
      >
        <Download className="size-3.5" />
      </Button>
      {target && (
        <TodoConversationFolderDialog
          title={t("importCodexConversation")}
          description={t("importCodexConversationHint")}
          confirmLabel={t(
            busy
              ? "importingCodexConversation"
              : "confirmImportCodexConversation"
          )}
          busy={busy}
          error={error}
          onClose={() => !importing.current && setTarget(null)}
          onConfirm={(folderId) => void startImport(folderId)}
        />
      )}
    </>
  )
}
