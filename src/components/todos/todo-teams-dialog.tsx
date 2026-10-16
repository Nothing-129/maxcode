"use client"

import { useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { ArrowLeft, Copy, Loader2, Plus, Upload, Users } from "lucide-react"
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
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { TodoTeam } from "@/lib/todos"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useTodosView } from "@/contexts/todos-view-context"
import { toErrorMessage } from "@/lib/app-error"
import { randomUUID } from "@/lib/utils"
import { TodoMinioSettings } from "./todo-minio-settings"

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
  const { state, mutate, busy, loading } = useTodosView()
  const [tab, setTab] = useState<"manage" | "create" | "join">("manage")
  const [teamName, setTeamName] = useState("")
  const [memberName, setMemberName] = useState("")
  const [code, setCode] = useState("")
  const [avatar, setAvatar] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [removingTeam, setRemovingTeam] = useState<TodoTeam | null>(null)
  const [confirmName, setConfirmName] = useState("")
  const [removalError, setRemovalError] = useState<string | null>(null)
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
    if (
      tab === "manage" ||
      !avatar ||
      !memberName.trim() ||
      saving ||
      busy ||
      uploading
    )
      return
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

  async function selectTeam(teamId: string) {
    setError(null)
    setSettingsOpen(false)
    try {
      await mutate({ action: "set_mode", mode: "team", team_id: teamId })
    } catch (cause) {
      setError(toErrorMessage(cause))
    }
  }

  async function removeTeam() {
    if (!removingTeam || saving || busy) return
    if (removingTeam.is_local && confirmName !== removingTeam.name) return
    setSaving(true)
    setRemovalError(null)
    try {
      await mutate(
        removingTeam.is_local
          ? {
              action: "dissolve_team",
              team_id: removingTeam.id,
              name: confirmName,
            }
          : { action: "remove_team", team_id: removingTeam.id }
      )
      setRemovingTeam(null)
      setSettingsOpen(false)
      toast.success(t("teamRemoved"))
    } catch (cause) {
      setRemovalError(toErrorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  const disabled = saving || busy || uploading
  return (
    <Dialog open onOpenChange={(open) => !open && !disabled && onClose()}>
      <DialogContent
        className="todo-theme min-w-0 max-w-xl grid-cols-1 overflow-x-hidden overflow-y-auto [&>*]:min-w-0"
        showCloseButton={!disabled}
      >
        <DialogHeader className="min-w-0">
          {tab !== "manage" && (
            <Button
              variant="ghost"
              size="sm"
              className="mb-2 w-fit"
              onClick={() => {
                setTab("manage")
                setError(null)
              }}
              disabled={disabled}
            >
              <ArrowLeft className="size-4" />
              {t("backToTeams")}
            </Button>
          )}
          <DialogTitle>
            {t(
              tab === "manage"
                ? "teams"
                : tab === "create"
                  ? "createTeam"
                  : "joinTeam"
            )}
          </DialogTitle>
          <DialogDescription>
            {t(
              tab === "manage"
                ? "teamManageDescription"
                : tab === "create"
                  ? "createTeamDescription"
                  : "joinTeamDescription"
            )}
          </DialogDescription>
        </DialogHeader>
        {tab === "manage" ? (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => setTab("create")}
                disabled={disabled}
              >
                <Plus className="size-4" />
                {t("createTeam")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setTab("join")}
                disabled={disabled}
              >
                {t("joinTeam")}
              </Button>
            </div>
            {loading || !state ? (
              <p
                role="status"
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <Loader2 className="size-4 animate-spin" />
                {t("loadingTeams")}
              </p>
            ) : state.teams.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-6 text-center">
                <Users className="mx-auto mb-3 size-7 text-muted-foreground" />
                <p className="text-sm font-medium">{t("noTeamTitle")}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("noTeamDescription")}
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="todo-manage-team">{t("selectTeam")}</Label>
                  <select
                    id="todo-manage-team"
                    className="h-10 w-full min-w-0 rounded-xl border bg-background px-3 text-sm"
                    value={state.mode === "team" ? (activeTeam?.id ?? "") : ""}
                    disabled={disabled}
                    onChange={(event) => void selectTeam(event.target.value)}
                  >
                    <option value="" disabled>
                      {t("selectTeam")}
                    </option>
                    {state.teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </div>
                {activeTeam && state.mode === "team" && (
                  <>
                    <section
                      className="overflow-hidden rounded-2xl border"
                      aria-labelledby="todo-team-members"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 p-4">
                        <div className="min-w-0">
                          <h3
                            id="todo-team-members"
                            className="text-sm font-semibold"
                          >
                            {t("teamMembers")}
                          </h3>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t("memberCount", { count: state.members.length })}
                          </p>
                        </div>
                        {state.team_code && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void copyCode()}
                            disabled={disabled || !!state.connection_error}
                          >
                            <Copy className="size-4" />
                            {t("inviteMembers")}
                          </Button>
                        )}
                      </div>
                      {state.connection_error && (
                        <p
                          role="status"
                          className="px-4 pt-4 text-xs leading-5 text-muted-foreground"
                        >
                          {t("membersOfflineHint")}
                        </p>
                      )}
                      {state.members.length > 0 ? (
                        <ul
                          className="divide-y px-4"
                          aria-label={t("teamMembers")}
                        >
                          {state.members.map((member) => (
                            <li
                              key={member.id}
                              className="flex min-w-0 items-center gap-3 py-3"
                            >
                              <Avatar>
                                <AvatarImage
                                  src={member.avatar}
                                  alt={member.name}
                                />
                                <AvatarFallback>
                                  {member.name.trim().slice(0, 1) || "?"}
                                </AvatarFallback>
                              </Avatar>
                              <span className="min-w-0 flex-1 wrap-anywhere text-sm font-medium">
                                {member.name}
                              </span>
                              {member.id === state.self_id && (
                                <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                                  {t("memberYou")}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="p-4 text-sm text-muted-foreground">
                          {t("membersUnavailable")}
                        </p>
                      )}
                    </section>
                    <div className="space-y-2 text-xs leading-5 text-muted-foreground">
                      <p>{t("inviteMembersHint")}</p>
                      {!state.team_code && activeTeam.is_local && (
                        <p>{t("publicUrlRequired")}</p>
                      )}
                      <p>{t("hostOnlineHint")}</p>
                    </div>
                    {activeTeam.is_local && (
                      <details
                        className="rounded-xl border p-4"
                        onToggle={(event) =>
                          setSettingsOpen(event.currentTarget.open)
                        }
                      >
                        <summary className="cursor-pointer text-sm font-medium">
                          {t("teamSettings")}
                        </summary>
                        <p className="mt-3 text-xs leading-5 text-muted-foreground">
                          {t("teamStorageHint")}
                        </p>
                        <div className="mt-3">
                          {settingsOpen && (
                            <TodoMinioSettings
                              key={activeTeam.id}
                              scopeId={activeTeam.id}
                            />
                          )}
                        </div>
                      </details>
                    )}
                    <div className="border-t pt-4">
                      <Button
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                        disabled={disabled}
                        onClick={() => {
                          setRemovingTeam(activeTeam)
                          setConfirmName("")
                          setRemovalError(null)
                        }}
                      >
                        {t(
                          activeTeam.is_local
                            ? "dissolveTeam"
                            : "removeTeamLocal"
                        )}
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
            {error && (
              <p
                role="alert"
                className="text-sm text-destructive wrap-anywhere"
              >
                {t("operationFailed", { reason: error })}
              </p>
            )}
          </div>
        ) : (
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
                  {avatar && (
                    <AvatarImage src={avatar} alt={t("avatarLabel")} />
                  )}
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
              <p
                role="alert"
                className="text-sm text-destructive wrap-anywhere"
              >
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
        )}
        <AlertDialog
          open={!!removingTeam}
          onOpenChange={(open) => {
            if (!open && !disabled) setRemovingTeam(null)
          }}
        >
          <AlertDialogContent className="todo-theme min-w-0">
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t(removingTeam?.is_local ? "dissolveTeam" : "removeTeamLocal")}
              </AlertDialogTitle>
              <AlertDialogDescription className="wrap-anywhere">
                {t(
                  removingTeam?.is_local
                    ? "dissolveTeamHint"
                    : "removeTeamLocalHint",
                  { name: removingTeam?.name ?? "" }
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {removingTeam?.is_local && (
              <div className="space-y-2">
                <Label htmlFor="todo-confirm-team-name">
                  {t("confirmTeamName")}
                </Label>
                <Input
                  id="todo-confirm-team-name"
                  value={confirmName}
                  onChange={(event) => setConfirmName(event.target.value)}
                  disabled={disabled}
                  autoComplete="off"
                />
              </div>
            )}
            {removalError && (
              <p
                role="alert"
                className="text-sm text-destructive wrap-anywhere"
              >
                {t("operationFailed", { reason: removalError })}
              </p>
            )}
            <AlertDialogFooter>
              <Button
                variant="outline"
                onClick={() => setRemovingTeam(null)}
                disabled={disabled}
              >
                {t("cancel")}
              </Button>
              <Button
                variant="destructive"
                onClick={() => void removeTeam()}
                disabled={
                  disabled ||
                  (!!removingTeam?.is_local &&
                    confirmName !== removingTeam.name)
                }
              >
                {saving && <Loader2 className="size-4 animate-spin" />}
                {t(removingTeam?.is_local ? "dissolveTeam" : "removeTeamLocal")}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}
