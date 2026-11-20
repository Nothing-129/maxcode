"use client"

import { SettingsHelp } from "@/components/shared/settings-help"
import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getChatMessageLanguage, setChatMessageLanguage } from "@/lib/api"

const SUPPORTED_LANGUAGES = [
  "en",
  "zh-cn",
  "zh-tw",
  "ja",
  "ko",
  "es",
  "de",
  "fr",
  "pt",
  "ar",
] as const

export function ChannelOtherTab() {
  const t = useTranslations("ChatChannelSettings.language")
  const [language, setLanguage] = useState("en")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getChatMessageLanguage()
      .then((lang) => setLanguage(lang))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleLanguageChange = useCallback(
    async (value: string) => {
      setSaving(true)
      try {
        await setChatMessageLanguage(value)
        setLanguage(value)
        toast.success(t("saved"))
      } catch {
        toast.error(t("saveFailed"))
      } finally {
        setSaving(false)
      }
    },
    [t]
  )

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
          <h3 className="text-sm font-medium">{t("title")}</h3>
          <SettingsHelp label={t("title")}>{t("description")}</SettingsHelp>
        </div>

        <Select
          value={language}
          onValueChange={handleLanguageChange}
          disabled={saving}
        >
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPPORTED_LANGUAGES.map((lang) => (
              <SelectItem key={lang} value={lang}>
                {t(lang)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>
    </div>
  )
}
