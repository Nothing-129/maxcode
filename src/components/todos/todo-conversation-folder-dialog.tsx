"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { WorkspaceFolderDialog } from "@/components/layout/workspace-folder-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"

export function TodoConversationFolderDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void
  onConfirm: (folderId: number) => void
}) {
  const t = useTranslations("Todos")
  const tSidebar = useTranslations("Folder.sidebar")
  const folders = useAppWorkspaceStore((state) => state.allFolders).filter(
    (folder) => folder.kind !== "chat"
  )
  const [selected, setSelected] = useState("")
  const [browse, setBrowse] = useState(false)
  if (browse)
    return (
      <WorkspaceFolderDialog
        open
        onOpenChange={setBrowse}
        onFolderOpened={(folder) => {
          setSelected(String(folder.id))
          setBrowse(false)
        }}
      />
    )
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="todo-theme min-w-0 grid-cols-1 overflow-x-hidden [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>{t("chooseConversationFolder")}</DialogTitle>
          <DialogDescription>
            {t("chooseConversationFolderHint")}
          </DialogDescription>
        </DialogHeader>
        <select
          aria-label={t("chooseConversationFolder")}
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          className="outline-none focus-visible:border-[#216ae4] focus-visible:ring-0 min-w-0 w-full max-w-full rounded-xl border bg-background p-3 text-sm"
        >
          <option value="">{t("chooseConversationFolder")}</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.alias || folder.name} · {folder.path}
            </option>
          ))}
        </select>
        <Button variant="outline" onClick={() => setBrowse(true)}>
          {tSidebar("openFolder")}
        </Button>
        <DialogFooter className="sm:flex-wrap">
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={!folders.some((folder) => String(folder.id) === selected)}
            onClick={() => onConfirm(Number(selected))}
          >
            {t("confirmConversationFolder")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
