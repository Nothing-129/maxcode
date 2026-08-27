"use client"

import { useEffect, useMemo, useState } from "react"
import { ExternalLink, LoaderCircle } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toErrorMessage } from "@/lib/app-error"
import { mcpScanLocal, mcpUpsertLocalServer } from "@/lib/api"
import { openUrl } from "@/lib/platform"
import {
  saveTeambitionSettings,
  type TeambitionSettings,
} from "@/lib/teambition-settings"
import type { LocalMcpServer } from "@/lib/types"

const USER_TOKEN_URL = "https://open.teambition.com/user-mcp"
const OFFICIAL_MCP_PACKAGE = "@tng/teambition-openapi-mcp@0.2.2"
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export function TeambitionSettingsDialog({
  open,
  onOpenChange,
  settings,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: TeambitionSettings
  onSaved: (settings: TeambitionSettings) => void
}) {
  const t = useTranslations("Teambition")
  const [servers, setServers] = useState<LocalMcpServer[]>([])
  const [serverId, setServerId] = useState(settings.serverId)
  const [projectId, setProjectId] = useState(settings.projectId)
  const [projectName, setProjectName] = useState(settings.projectName)
  const [userToken, setUserToken] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setServerId(settings.serverId)
    setProjectId(settings.projectId)
    setProjectName(settings.projectName)
    setUserToken("")
    setLoading(true)
    void mcpScanLocal()
      .then(setServers)
      .catch((cause) => toast.error(toErrorMessage(cause)))
      .finally(() => setLoading(false))
  }, [open, settings])

  const serverOptions = useMemo(() => {
    const ids = new Set(servers.map((server) => server.id))
    if (serverId) ids.add(serverId)
    return [...ids].sort((left, right) => left.localeCompare(right))
  }, [serverId, servers])

  const save = async () => {
    const normalizedServerId = serverId.trim()
    const normalizedProjectId = projectId.trim()
    if (
      !IDENTIFIER_PATTERN.test(normalizedServerId) ||
      !IDENTIFIER_PATTERN.test(normalizedProjectId) ||
      !projectName.trim()
    ) {
      toast.error(t("invalidSettings"))
      return
    }

    const existing = servers.find((server) => server.id === normalizedServerId)
    if (!existing && !userToken.trim()) {
      toast.error(t("tokenRequired"))
      return
    }

    setSaving(true)
    try {
      if (userToken.trim()) {
        await mcpUpsertLocalServer({
          serverId: normalizedServerId,
          apps: existing?.apps.length ? existing.apps : ["codex"],
          spec: {
            type: "stdio",
            command: "npx",
            args: ["-y", OFFICIAL_MCP_PACKAGE, "user-mcp"],
            env: {
              TB_MCP_USER_TOKEN: userToken.trim(),
              TB_MCP_TOOL_NAME_CASE: "camel",
              TB_MCP_TOOLS: "task,project",
            },
          },
        })
      }
      const saved = saveTeambitionSettings({
        serverId: normalizedServerId,
        projectId: normalizedProjectId,
        projectName,
      })
      onSaved(saved)
      onOpenChange(false)
      toast.success(t("settingsSaved"))
    } catch (cause) {
      toast.error(toErrorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("settingsTitle")}</DialogTitle>
          <DialogDescription>{t("settingsDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <Label htmlFor="teambition-server">{t("serverId")}</Label>
            <div className="flex gap-2">
              <Select value={serverId} onValueChange={setServerId}>
                <SelectTrigger
                  id="teambition-server"
                  className="min-w-0 flex-1"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {serverOptions.map((id) => (
                    <SelectItem key={id} value={id}>
                      {id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {loading ? (
                <LoaderCircle className="mt-2 size-4 animate-spin text-muted-foreground" />
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">{t("serverHint")}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="teambition-project-name">
                {t("projectName")}
              </Label>
              <Input
                id="teambition-project-name"
                value={projectName}
                maxLength={120}
                onChange={(event) => setProjectName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="teambition-project-id">{t("projectId")}</Label>
              <Input
                id="teambition-project-id"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="teambition-user-token">{t("userToken")}</Label>
            <Input
              id="teambition-user-token"
              type="password"
              value={userToken}
              autoComplete="off"
              placeholder={t("userTokenPlaceholder")}
              onChange={(event) => setUserToken(event.target.value)}
            />
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {t("userTokenHint")}
              </p>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto shrink-0 gap-1 p-0 text-xs"
                onClick={() => void openUrl(USER_TOKEN_URL)}
              >
                {t("createUserToken")}
                <ExternalLink className="size-3" />
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </Button>
          <Button type="button" disabled={saving} onClick={() => void save()}>
            {saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {t("saveSettings")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
