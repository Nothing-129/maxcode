"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Languages,
  Loader2,
  Plus,
  Power,
  Sparkles,
  Trash2,
  Wifi,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { useAppI18n } from "@/components/i18n-provider"
import { BackupSettings } from "@/components/settings/backup-settings"
import { SettingsSection } from "@/components/shared/settings-section"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  getSystemAutostartSettings,
  getSystemProxySettings,
  getSystemTitleModelSettings,
  testSystemTitleModelSettings,
  updateSystemAutostartSettings,
  updateSystemLanguageSettings,
  updateSystemProxySettings,
  updateSystemTitleModelSettings,
} from "@/lib/api"
import { isLocalDesktop, openUrl } from "@/lib/platform"
import type {
  AppLocale,
  SystemTitleModelTestResult,
  TitleModelRequestParam,
} from "@/lib/types"
import { APP_LOCALES } from "@/lib/i18n"
import { toErrorMessage } from "@/lib/app-error"

function GithubMarkIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      fillRule="evenodd"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 0c6.63 0 12 5.276 12 11.79-.001 5.067-3.29 9.567-8.175 11.187-.6.118-.825-.25-.825-.56 0-.398.015-1.665.015-3.242 0-1.105-.375-1.813-.81-2.181 2.67-.295 5.475-1.297 5.475-5.822 0-1.297-.465-2.344-1.23-3.169.12-.295.54-1.503-.12-3.125 0 0-1.005-.324-3.3 1.209a11.32 11.32 0 00-3-.398c-1.02 0-2.04.133-3 .398-2.295-1.518-3.3-1.209-3.3-1.209-.66 1.622-.24 2.83-.12 3.125-.765.825-1.23 1.887-1.23 3.169 0 4.51 2.79 5.527 5.46 5.822-.345.294-.66.81-.765 1.577-.69.31-2.415.81-3.495-.973-.225-.354-.9-1.223-1.845-1.209-1.005.015-.405.56.015.781.51.28 1.095 1.327 1.23 1.666.24.663 1.02 1.93 4.035 1.385 0 .988.015 1.916.015 2.196 0 .31-.225.664-.825.56C3.303 21.374-.003 16.867 0 11.791 0 5.276 5.37 0 12 0z" />
    </svg>
  )
}

const PROXY_EXAMPLE = "http://127.0.0.1:7890"
const APP_LANGUAGE_VALUES = APP_LOCALES

type LanguageSelectValue = "system" | AppLocale

type TitleModelRequestParamDraft = TitleModelRequestParam & { id: number }

let nextTitleModelRequestParamId = 0

function toTitleModelRequestParamDraft(
  param: TitleModelRequestParam = { key: "", value: "" }
): TitleModelRequestParamDraft {
  nextTitleModelRequestParamId += 1
  return { ...param, id: nextTitleModelRequestParamId }
}

function serializeTitleModelRequestParams(
  params: TitleModelRequestParamDraft[]
): TitleModelRequestParam[] {
  return params.map(({ key, value }) => ({ key: key.trim(), value }))
}

function isAppLocale(value: string): value is AppLocale {
  return APP_LANGUAGE_VALUES.includes(value as AppLocale)
}

export function SystemNetworkSettings() {
  const t = useTranslations("SystemSettings")
  const tLanguage = useTranslations("Language")
  const { languageSettings, languageSettingsLoaded, setLanguageSettings } =
    useAppI18n()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingLanguage, setSavingLanguage] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [proxyUrl, setProxyUrl] = useState("")
  const [proxyUrlError, setProxyUrlError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [titleModelEnabled, setTitleModelEnabled] = useState(false)
  const [titleModelBaseUrl, setTitleModelBaseUrl] = useState("")
  const [titleModelName, setTitleModelName] = useState("")
  const [titleModelApiKey, setTitleModelApiKey] = useState("")
  const [titleModelApiKeyConfigured, setTitleModelApiKeyConfigured] =
    useState(false)
  const [clearTitleModelApiKey, setClearTitleModelApiKey] = useState(false)
  const [titleModelRequestParams, setTitleModelRequestParams] = useState<
    TitleModelRequestParamDraft[]
  >([])
  const [savingTitleModel, setSavingTitleModel] = useState(false)
  const [testingTitleModel, setTestingTitleModel] = useState(false)
  const [titleModelTestResult, setTitleModelTestResult] =
    useState<SystemTitleModelTestResult | null>(null)
  const [titleModelError, setTitleModelError] = useState<string | null>(null)

  // Launch at login registers *this* machine's executable with the OS, so it
  // only means something for a local Tauri shell — a remote workspace window
  // routes every call to a server that has no login items to speak of.
  const autostartVisible = isLocalDesktop()
  const [autostartEnabled, setAutostartEnabled] = useState(false)
  const [savingAutostart, setSavingAutostart] = useState(false)
  // Non-null when the OS refused to report the registration (no home dir, a
  // locked-down registry, …). The row stays on screen but inert, which beats
  // hiding a setting the user came looking for.
  const [autostartError, setAutostartError] = useState<string | null>(null)
  const [appLanguage, setAppLanguage] = useState<LanguageSelectValue>(
    languageSettings.mode === "system" ? "system" : languageSettings.language
  )

  useEffect(() => {
    setAppLanguage(
      languageSettings.mode === "system" ? "system" : languageSettings.language
    )
  }, [languageSettings])

  const languageLabels = useMemo(
    () => ({
      en: tLanguage("english"),
      zh_cn: tLanguage("simplifiedChinese"),
      zh_tw: tLanguage("traditionalChinese"),
      ja: tLanguage("japanese"),
      ko: tLanguage("korean"),
      es: tLanguage("spanish"),
      de: tLanguage("german"),
      fr: tLanguage("french"),
      pt: tLanguage("portuguese"),
      ar: tLanguage("arabic"),
    }),
    [tLanguage]
  )

  const loadSettings = useCallback(async () => {
    setLoading(true)
    setLoadError(null)

    try {
      const [proxySettings, titleSettings, autostart] = await Promise.all([
        getSystemProxySettings(),
        getSystemTitleModelSettings(),
        // Kept out of the shared rejection path: a machine that cannot report
        // its login items must not blank out the proxy and language cards.
        autostartVisible
          ? getSystemAutostartSettings().then(
              (settings) => ({ settings, error: null }),
              (err) => {
                console.error("[Settings] load autostart settings failed:", err)
                return { settings: null, error: toErrorMessage(err) }
              }
            )
          : Promise.resolve(null),
      ])

      setEnabled(proxySettings.enabled)
      setProxyUrl(proxySettings.proxy_url ?? "")
      setTitleModelEnabled(titleSettings.enabled)
      setTitleModelBaseUrl(titleSettings.base_url)
      setTitleModelName(titleSettings.model)
      setTitleModelApiKeyConfigured(titleSettings.api_key_configured)
      setTitleModelRequestParams(
        titleSettings.request_params.map((param) =>
          toTitleModelRequestParamDraft(param)
        )
      )
      setTitleModelApiKey("")
      setClearTitleModelApiKey(false)
      setTitleModelTestResult(null)

      if (autostart) {
        setAutostartEnabled(autostart.settings?.enabled ?? false)
        setAutostartError(autostart.error)
      }
    } catch (err) {
      const message = toErrorMessage(err)
      setLoadError(message)
      console.error("[Settings] load system settings failed:", err)
    } finally {
      setLoading(false)
    }
  }, [autostartVisible])

  useEffect(() => {
    loadSettings().catch((err) => {
      console.error("[Settings] load system settings failed:", err)
    })
  }, [loadSettings])

  const saveProxySettings = useCallback(
    async (nextEnabled: boolean, nextProxyUrl: string) => {
      if (nextEnabled && !nextProxyUrl.trim()) return

      setSaving(true)
      try {
        const next = await updateSystemProxySettings({
          enabled: nextEnabled,
          proxy_url: nextProxyUrl.trim() || null,
        })
        setEnabled(next.enabled)
        setProxyUrl(next.proxy_url ?? "")
      } catch (err) {
        const message = toErrorMessage(err)
        toast.error(t("saveFailed", { message }))
      } finally {
        setSaving(false)
      }
    },
    [t]
  )

  const saveAutostartSettings = useCallback(
    async (next: boolean, prev: boolean) => {
      setSavingAutostart(true)
      try {
        // The backend answers with what the OS settled on, not with the
        // request — Windows can veto a Run entry through Task Manager, so the
        // switch has to follow the reply rather than the optimistic value.
        const result = await updateSystemAutostartSettings({ enabled: next })
        setAutostartEnabled(result.enabled)
        setAutostartError(null)
      } catch (err) {
        setAutostartEnabled(prev)
        const message = toErrorMessage(err)
        toast.error(t("autostartSaveFailed", { message }))
      } finally {
        setSavingAutostart(false)
      }
    },
    [t]
  )

  const saveLanguage = useCallback(
    async (lang: LanguageSelectValue) => {
      setSavingLanguage(true)

      try {
        const next = await updateSystemLanguageSettings({
          mode: lang === "system" ? "system" : "manual",
          language: lang === "system" ? languageSettings.language : lang,
        })

        setLanguageSettings(next)
      } catch (err) {
        const message = toErrorMessage(err)
        toast.error(t("languageSaveFailed", { message }))
      } finally {
        setSavingLanguage(false)
      }
    },
    [languageSettings.language, setLanguageSettings, t]
  )

  const saveTitleModel = useCallback(async () => {
    const baseUrl = titleModelBaseUrl.trim()
    const model = titleModelName.trim()
    if (titleModelEnabled && (!baseUrl || !model)) {
      setTitleModelError(t("titleModelRequired"))
      return
    }

    setSavingTitleModel(true)
    setTitleModelError(null)
    try {
      const next = await updateSystemTitleModelSettings({
        enabled: titleModelEnabled,
        base_url: baseUrl,
        model,
        api_key: titleModelApiKey.trim() || null,
        clear_api_key: clearTitleModelApiKey,
        request_params: serializeTitleModelRequestParams(
          titleModelRequestParams
        ),
      })
      setTitleModelEnabled(next.enabled)
      setTitleModelBaseUrl(next.base_url)
      setTitleModelName(next.model)
      setTitleModelApiKey("")
      setTitleModelApiKeyConfigured(next.api_key_configured)
      setTitleModelRequestParams(
        next.request_params.map((param) => toTitleModelRequestParamDraft(param))
      )
      setClearTitleModelApiKey(false)
      toast.success(t("titleModelSaveSuccess"))
    } catch (err) {
      const message = toErrorMessage(err)
      setTitleModelError(message)
      toast.error(t("titleModelSaveFailed", { message }))
    } finally {
      setSavingTitleModel(false)
    }
  }, [
    clearTitleModelApiKey,
    t,
    titleModelApiKey,
    titleModelBaseUrl,
    titleModelEnabled,
    titleModelName,
    titleModelRequestParams,
  ])

  const testTitleModel = useCallback(async () => {
    const baseUrl = titleModelBaseUrl.trim()
    const model = titleModelName.trim()
    if (!baseUrl || !model) {
      setTitleModelError(t("titleModelRequired"))
      return
    }

    setTestingTitleModel(true)
    setTitleModelError(null)
    setTitleModelTestResult(null)
    try {
      const result = await testSystemTitleModelSettings({
        enabled: titleModelEnabled,
        base_url: baseUrl,
        model,
        api_key: titleModelApiKey.trim() || null,
        clear_api_key: clearTitleModelApiKey,
        request_params: serializeTitleModelRequestParams(
          titleModelRequestParams
        ),
      })
      setTitleModelTestResult(result)
      toast.success(t("titleModelTestSuccess"))
    } catch (err) {
      const message = toErrorMessage(err)
      setTitleModelError(message)
      toast.error(t("titleModelTestFailed", { message }))
    } finally {
      setTestingTitleModel(false)
    }
  }, [
    clearTitleModelApiKey,
    t,
    titleModelApiKey,
    titleModelBaseUrl,
    titleModelEnabled,
    titleModelName,
    titleModelRequestParams,
  ])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("loading")}
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="w-full space-y-4 p-3 md:p-4">
        <section className="space-y-1">
          <div className="flex items-center justify-between">
            <h1 className="text-sm font-semibold">{t("sectionTitle")}</h1>
            <Button
              variant="ghost"
              className="size-5 rounded-full"
              onClick={() => openUrl("https://github.com/Nothing-129/maxcode")}
            >
              <GithubMarkIcon className="size-5" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("sectionDescription")}
          </p>
        </section>

        {/* Titled by the option itself: the section *is* the one switch, so a
            card holding a single row would only say the heading back one line
            lower. */}
        {autostartVisible && (
          <SettingsSection
            icon={Power}
            title={t("autostartTitle")}
            description={t("autostartDescription")}
            htmlFor="launch-at-login"
            control={
              <Switch
                id="launch-at-login"
                checked={autostartEnabled}
                disabled={savingAutostart || autostartError !== null}
                onCheckedChange={(next) => {
                  const prev = autostartEnabled
                  setAutostartEnabled(next)
                  void saveAutostartSettings(next, prev)
                }}
              />
            }
          >
            {autostartError !== null && (
              <p className="text-2xs text-amber-500">
                {t("autostartUnavailable", { message: autostartError })}
              </p>
            )}
          </SettingsSection>
        )}

        <section className="rounded-xl border bg-card p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Wifi className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">{t("proxyTitle")}</h2>
          </div>

          <p className="text-xs text-muted-foreground leading-5">
            {t("proxyDescription")}
          </p>

          {loadError && (
            <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
              {t("loadFailed", { message: loadError })}
            </div>
          )}

          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              disabled={saving}
              onChange={(event) => {
                const next = event.target.checked
                if (next && !proxyUrl.trim()) {
                  setProxyUrlError(t("proxyRequired"))
                  return
                }
                setProxyUrlError(null)
                setEnabled(next)
                saveProxySettings(next, proxyUrl)
              }}
            />
            {t("enableProxy")}
          </label>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              {t("proxyAddress")}
            </label>
            <Input
              value={proxyUrl}
              onChange={(event) => {
                setProxyUrl(event.target.value)
                if (event.target.value.trim()) setProxyUrlError(null)
              }}
              onBlur={() => {
                if (enabled && !proxyUrl.trim()) {
                  setProxyUrlError(t("proxyRequired"))
                  return
                }
                setProxyUrlError(null)
                saveProxySettings(enabled, proxyUrl)
              }}
              placeholder={PROXY_EXAMPLE}
              disabled={saving}
              aria-invalid={proxyUrlError ? true : undefined}
            />
            {proxyUrlError && (
              <p className="text-2xs text-destructive">{proxyUrlError}</p>
            )}
            <p className="text-2xs text-muted-foreground">
              {t("proxyHint", { example: PROXY_EXAMPLE })}
            </p>
          </div>
        </section>

        <section className="rounded-xl border bg-card p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">{t("titleModelTitle")}</h2>
          </div>

          <p className="text-xs text-muted-foreground leading-5">
            {t("titleModelDescription")}
          </p>
          <p className="text-2xs text-muted-foreground leading-5">
            {t("titleModelPrivacyHint")}
          </p>

          <div className="flex items-center justify-between gap-4">
            <label htmlFor="title-model-enabled" className="text-sm">
              {t("titleModelEnable")}
            </label>
            <Switch
              id="title-model-enabled"
              checked={titleModelEnabled}
              disabled={savingTitleModel || testingTitleModel}
              onCheckedChange={(next) => {
                setTitleModelEnabled(next)
                setTitleModelError(null)
                setTitleModelTestResult(null)
              }}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <label
                htmlFor="title-model-base-url"
                className="text-xs font-medium text-muted-foreground"
              >
                {t("titleModelBaseUrl")}
              </label>
              <Input
                id="title-model-base-url"
                value={titleModelBaseUrl}
                onChange={(event) => {
                  setTitleModelBaseUrl(event.target.value)
                  setTitleModelError(null)
                  setTitleModelTestResult(null)
                }}
                placeholder="https://api.groq.com/openai/v1"
                disabled={savingTitleModel || testingTitleModel}
              />
              <p className="text-2xs text-muted-foreground">
                {t("titleModelBaseUrlHint")}
              </p>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="title-model-name"
                className="text-xs font-medium text-muted-foreground"
              >
                {t("titleModelName")}
              </label>
              <Input
                id="title-model-name"
                value={titleModelName}
                onChange={(event) => {
                  setTitleModelName(event.target.value)
                  setTitleModelError(null)
                  setTitleModelTestResult(null)
                }}
                placeholder="qwen/qwen3.6-27b"
                disabled={savingTitleModel || testingTitleModel}
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="title-model-api-key"
                className="text-xs font-medium text-muted-foreground"
              >
                {t("titleModelApiKey")}
              </label>
              <Input
                id="title-model-api-key"
                type="password"
                autoComplete="off"
                value={titleModelApiKey}
                onChange={(event) => {
                  setTitleModelApiKey(event.target.value)
                  if (event.target.value) setClearTitleModelApiKey(false)
                  setTitleModelError(null)
                  setTitleModelTestResult(null)
                }}
                placeholder={
                  titleModelApiKeyConfigured && !clearTitleModelApiKey
                    ? t("titleModelApiKeySaved")
                    : t("titleModelApiKeyOptional")
                }
                disabled={savingTitleModel || testingTitleModel}
              />
              {titleModelApiKeyConfigured && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-0 text-2xs"
                  disabled={savingTitleModel || testingTitleModel}
                  onClick={() => {
                    setTitleModelApiKey("")
                    setClearTitleModelApiKey((value) => !value)
                    setTitleModelError(null)
                    setTitleModelTestResult(null)
                  }}
                >
                  {clearTitleModelApiKey
                    ? t("titleModelKeepApiKey")
                    : t("titleModelClearApiKey")}
                </Button>
              )}
            </div>

            <div className="space-y-2 sm:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs font-medium text-muted-foreground">
                  {t("titleModelRequestParams")}
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-2xs"
                  disabled={savingTitleModel || testingTitleModel}
                  onClick={() => {
                    setTitleModelRequestParams((params) => [
                      ...params,
                      toTitleModelRequestParamDraft(),
                    ])
                    setTitleModelError(null)
                    setTitleModelTestResult(null)
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("titleModelAddRequestParam")}
                </Button>
              </div>
              <p className="text-2xs text-muted-foreground leading-5">
                {t("titleModelRequestParamsHint")}
              </p>

              {titleModelRequestParams.map((param, index) => (
                <div
                  key={param.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                >
                  <Input
                    className="col-span-2 sm:col-span-1"
                    value={param.key}
                    aria-label={t("titleModelRequestParamKeyLabel", {
                      index: index + 1,
                    })}
                    placeholder={t("titleModelRequestParamKey")}
                    disabled={savingTitleModel || testingTitleModel}
                    onChange={(event) => {
                      const value = event.target.value
                      setTitleModelRequestParams((params) =>
                        params.map((item) =>
                          item.id === param.id ? { ...item, key: value } : item
                        )
                      )
                      setTitleModelError(null)
                      setTitleModelTestResult(null)
                    }}
                  />
                  <Input
                    value={param.value}
                    aria-label={t("titleModelRequestParamValueLabel", {
                      index: index + 1,
                    })}
                    placeholder={t("titleModelRequestParamValue")}
                    disabled={savingTitleModel || testingTitleModel}
                    onChange={(event) => {
                      const value = event.target.value
                      setTitleModelRequestParams((params) =>
                        params.map((item) =>
                          item.id === param.id ? { ...item, value } : item
                        )
                      )
                      setTitleModelError(null)
                      setTitleModelTestResult(null)
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("titleModelRemoveRequestParam", {
                      index: index + 1,
                    })}
                    disabled={savingTitleModel || testingTitleModel}
                    onClick={() => {
                      setTitleModelRequestParams((params) =>
                        params.filter((item) => item.id !== param.id)
                      )
                      setTitleModelError(null)
                      setTitleModelTestResult(null)
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {titleModelError && (
            <p className="text-2xs text-destructive">{titleModelError}</p>
          )}

          {titleModelTestResult && (
            <p className="text-2xs text-emerald-500">
              {t("titleModelTestResult", {
                title: titleModelTestResult.title,
                latency: titleModelTestResult.latency_ms,
              })}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={savingTitleModel || testingTitleModel}
              onClick={() => void testTitleModel()}
            >
              {testingTitleModel ? t("titleModelTesting") : t("titleModelTest")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={savingTitleModel || testingTitleModel}
              onClick={() => void saveTitleModel()}
            >
              {savingTitleModel ? t("saving") : t("save")}
            </Button>
          </div>
        </section>

        <section className="rounded-xl border bg-card p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Languages className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">{t("languageTitle")}</h2>
          </div>

          <p className="text-xs text-muted-foreground leading-5">
            {t("languageDescription")}
          </p>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              {t("appLanguage")}
            </label>
            <Select
              value={appLanguage}
              onValueChange={(value) => {
                let nextLang: LanguageSelectValue
                if (value === "system") {
                  nextLang = "system"
                } else if (isAppLocale(value)) {
                  nextLang = value
                } else {
                  return
                }
                setAppLanguage(nextLang)
                saveLanguage(nextLang)
              }}
              disabled={savingLanguage || !languageSettingsLoaded}
            >
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="system">
                  {tLanguage("followSystem")}
                </SelectItem>
                <SelectItem value="en">{languageLabels.en}</SelectItem>
                <SelectItem value="zh_cn">{languageLabels.zh_cn}</SelectItem>
                <SelectItem value="zh_tw">{languageLabels.zh_tw}</SelectItem>
                <SelectItem value="ja">{languageLabels.ja}</SelectItem>
                <SelectItem value="ko">{languageLabels.ko}</SelectItem>
                <SelectItem value="es">{languageLabels.es}</SelectItem>
                <SelectItem value="de">{languageLabels.de}</SelectItem>
                <SelectItem value="fr">{languageLabels.fr}</SelectItem>
                <SelectItem value="pt">{languageLabels.pt}</SelectItem>
                <SelectItem value="ar">{languageLabels.ar}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>

        <BackupSettings />
      </div>
    </ScrollArea>
  )
}
