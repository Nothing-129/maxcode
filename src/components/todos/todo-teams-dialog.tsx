"use client"

import { useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { Copy, Loader2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useTodosView } from "@/contexts/todos-view-context"
import { toErrorMessage } from "@/lib/app-error"
import { randomUUID } from "@/lib/utils"
import { emptyMinioConfig } from "@/lib/todo-storage"
import { TodoMinioFields, TodoMinioSettings } from "./todo-minio-settings"

async function avatarFromFile(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext("2d")
    if (!context) throw new Error("Canvas is unavailable")
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL("image/webp", 0.85)
  } finally {
    bitmap.close()
  }
}

export function TodoTeamsDialog({
  onClose,
  onJoined,
  onStart,
}: {
  onClose: () => void
  onJoined?: () => void
  onStart?: () => void
}) {
  const t = useTranslations("Todos")
  const { state, mutate, busy } = useTodosView()
  const [tab, setTab] = useState<"create" | "join">("create")
  const [minio, setMinio] = useState(emptyMinioConfig)
  const [teamName, setTeamName] = useState("")
  const [memberName, setMemberName] = useState("")
  const [code, setCode] = useState("")
  const [avatar, setAvatar] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [operationId] = useState(randomUUID)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const activeTeam = state?.teams.find(
    (team) => team.id === state.active_team_id
  )

  async function upload(file?: File) {
    if (!file) return
    setError(null)
    if (
      !/^(image\/png|image\/jpeg|image\/webp)$/.test(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setError(t("avatarInvalid"))
      return
    }
    setUploading(true)
    try {
      setAvatar(await avatarFromFile(file))
    } catch {
      setError(t("avatarInvalid"))
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ""
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!avatar || !memberName.trim() || saving || busy || uploading) return
    setSaving(true)
    setError(null)
    try {
      onStart?.()
      await mutate(
        tab === "create"
          ? {
              action: "create_team",
              operation_id: operationId,
              name: teamName.trim(),
              member_name: memberName.trim(),
              avatar,
              minio_config: minio,
            }
          : {
              action: "join_team",
              code: code.trim(),
              member_name: memberName.trim(),
              avatar,
            }
      )
      const finish = onJoined ?? onClose
      finish()
    } catch (cause) {
      setError(toErrorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  async function copyCode() {
    if (!state?.team_code) return
    try {
      await navigator.clipboard.writeText(state.team_code)
      toast.success(t("codeCopied"))
    } catch (cause) {
      toast.error(t("operationFailed", { reason: toErrorMessage(cause) }))
    }
  }

  const disabled = saving || busy || uploading
  return (
    <Dialog open onOpenChange={(open) => !open && !disabled && onClose()}>
      <DialogContent
        className="todo-theme min-w-0 max-w-lg grid-cols-1 overflow-x-hidden overflow-y-auto [&>*]:min-w-0"
        showCloseButton={!disabled}
      >
        <DialogHeader className="min-w-0">
          <DialogTitle>{t("teams")}</DialogTitle>
          <DialogDescription>{t("teamDescription")}</DialogDescription>
        </DialogHeader>
        {activeTeam && state?.mode === "team" && (
          <div className="min-w-0 space-y-3 rounded-2xl border border-border p-4">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {activeTeam.name}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {t("memberCount", { count: state.members.length })}
              </span>
            </div>
            {state.team_code ? (
              <div className="flex min-w-0 w-full gap-2">
                <Textarea
                  className="min-h-16 min-w-0 w-full flex-1 field-sizing-fixed text-xs"
                  value={state.team_code}
                  readOnly
                  aria-label={t("teamCode")}
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={() => void copyCode()}
                  aria-label={t("copyTeamCode")}
                  title={t("copyTeamCode")}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            ) : activeTeam.is_local ? (
              <p className="text-xs leading-5 text-muted-foreground">
                {t("publicUrlRequired")}
              </p>
            ) : null}
            <p className="text-xs leading-5 text-muted-foreground">
              {t("hostOnlineHint")}
            </p>
          </div>
        )}
        <div className="flex min-w-0 rounded-xl bg-muted p-1">
          <Button
            className="h-auto min-h-8 min-w-0 flex-1 whitespace-normal py-2"
            variant={tab === "create" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => {
              setTab("create")
              setError(null)
            }}
            disabled={disabled}
          >
            {t("createTeam")}
          </Button>
          <Button
            className="h-auto min-h-8 min-w-0 flex-1 whitespace-normal py-2"
            variant={tab === "join" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => {
              setTab("join")
              setError(null)
            }}
            disabled={disabled}
          >
            {t("joinTeam")}
          </Button>
        </div>
        {activeTeam?.is_local && (
          <details className="min-w-0 rounded-xl border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              {t("minioTitle")} · {activeTeam.name}
            </summary>
            <div className="mt-3">
              <TodoMinioSettings key={activeTeam.id} scopeId={activeTeam.id} />
            </div>
          </details>
        )}
        <form
          onSubmit={(event) => void submit(event)}
          className="min-w-0 space-y-4 [&>*]:min-w-0"
        >
          {tab === "create" ? (
            <div className="space-y-2">
              <Label htmlFor="todo-team-name">{t("teamName")}</Label>
              <Input
                id="todo-team-name"
                value={teamName}
                onChange={(event) => setTeamName(event.target.value)}
                required
                disabled={disabled}
              />
              {!state?.public_url && (
                <p className="text-xs leading-5 text-muted-foreground">
                  {t("publicUrlRequired")}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="todo-team-code">{t("teamCode")}</Label>
              <Textarea
                id="todo-team-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder={t("teamCodePlaceholder")}
                required
                disabled={disabled}
                className="min-h-20 min-w-0 w-full field-sizing-fixed text-xs"
              />
            </div>
          )}
          {tab === "create" && (
            <TodoMinioFields
              value={minio}
              onChange={setMinio}
              disabled={disabled}
              prefix="create-minio"
            />
          )}
          <div className="space-y-2">
            <Label htmlFor="todo-member-name">{t("memberName")}</Label>
            <Input
              id="todo-member-name"
              value={memberName}
              onChange={(event) => setMemberName(event.target.value)}
              required
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("avatarLabel")}</Label>
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <Avatar size="lg">
                {avatar && <AvatarImage src={avatar} alt={t("avatarLabel")} />}
                <AvatarFallback>
                  {memberName.trim().slice(0, 1) || "?"}
                </AvatarFallback>
              </Avatar>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => void upload(event.target.files?.[0])}
                aria-label={t("uploadAvatar")}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => fileInput.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                {t("uploadAvatar")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("avatarHint")}</p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive wrap-anywhere">
              {t("operationFailed", { reason: error })}
            </p>
          )}
          <DialogFooter className="min-w-0 sm:flex-wrap">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={disabled}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                disabled ||
                !avatar ||
                !memberName.trim() ||
                !(tab === "create" ? teamName.trim() : code.trim())
              }
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {t(tab === "create" ? "createTeam" : "joinTeam")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
