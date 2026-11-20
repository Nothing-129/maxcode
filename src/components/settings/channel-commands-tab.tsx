"use client"

import { SettingsHelp } from "@/components/shared/settings-help"
import { useCallback, useEffect, useState } from "react"
import { Loader2, Save } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getChatCommandPrefix, setChatCommandPrefix } from "@/lib/api"

const BUILT_IN_COMMANDS = [
  { name: "folder [n|path]", descKey: "folderDesc" },
  { name: "agent [n|name]", descKey: "agentDesc" },
  { name: "task <description>", descKey: "taskDesc" },
  { name: "sessions", descKey: "sessionsDesc" },
  { name: "resume [id]", descKey: "resumeDesc" },
  { name: "cancel", descKey: "cancelDesc" },
  { name: "approve [always]", descKey: "approveDesc" },
  { name: "deny", descKey: "denyDesc" },
  { name: "search <keyword>", descKey: "searchDesc" },
  { name: "today", descKey: "todayDesc" },
  { name: "status", descKey: "statusDesc" },
  { name: "help", descKey: "helpDesc" },
] as const

export function ChannelCommandsTab() {
  const t = useTranslations("ChatChannelSettings.commands")
  const [prefix, setPrefix] = useState("/")
  const [inputPrefix, setInputPrefix] = useState("/")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getChatCommandPrefix()
      .then((p) => {
        setPrefix(p)
        setInputPrefix(p)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleSavePrefix = useCallback(async () => {
    const trimmed = inputPrefix.trim()
    if (
      trimmed.length === 0 ||
      trimmed.length > 3 ||
      /[a-zA-Z0-9]/.test(trimmed)
    ) {
      toast.error(t("prefixInvalid"))
      return
    }
    setSaving(true)
    try {
      await setChatCommandPrefix(trimmed)
      setPrefix(trimmed)
      toast.success(t("prefixSaved"))
    } catch {
      toast.error(t("prefixSaveFailed"))
    } finally {
      setSaving(false)
    }
  }, [inputPrefix, t])

  const dirty = inputPrefix !== prefix

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section data-settings-group="">
        <div className="settings-help-heading flex items-center gap-1">
          <h3 className="text-sm font-medium">{t("prefixLabel")}</h3>
          <SettingsHelp label={t("prefixLabel")}>
            {t("prefixDescription")}
          </SettingsHelp>
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={inputPrefix}
            onChange={(e) => setInputPrefix(e.target.value)}
            className="w-20 text-center font-mono"
            maxLength={3}
          />
          <Button
            size="sm"
            disabled={!dirty || saving}
            onClick={handleSavePrefix}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5 mr-1" />
            )}
            {t("save")}
          </Button>
        </div>
      </section>

      <section data-settings-group="">
        <div className="settings-help-heading flex items-center gap-1">
          <h3 className="text-sm font-medium">{t("title")}</h3>
          <SettingsHelp label={t("title")}>{t("description")}</SettingsHelp>
        </div>

        <div data-settings-list="">
          {BUILT_IN_COMMANDS.map((cmd) => (
            <div key={cmd.name} className="flex items-center gap-1 py-2">
              <code className="text-sm font-mono">
                {prefix}
                {cmd.name}
              </code>
              <SettingsHelp label={prefix + cmd.name}>
                {t(cmd.descKey)}
              </SettingsHelp>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
