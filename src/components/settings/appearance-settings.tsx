"use client"

import { SettingsHelp } from "@/components/shared/settings-help"
import { SettingsGroup } from "@/components/shared/settings-group"

import { APPEARANCE_CUSTOMIZATION_ENABLED } from "@/lib/appearance-policy"
import { Check, LayoutGrid, Type } from "lucide-react"
import { useTranslations } from "next-intl"
import { useTheme } from "next-themes"
import { toast } from "sonner"
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
  useThemeColor,
  useZoomLevel,
  useWelcomeQuickActions,
} from "@/hooks/use-appearance"
import { cn } from "@/lib/utils"
import {
  DEFAULT_ZOOM_LEVEL,
  THEME_COLOR_PREVIEW,
  THEME_COLORS,
  SELECTABLE_THEME_COLORS,
  ZOOM_LEVELS,
  type ThemeColor,
  type ZoomLevel,
} from "@/lib/theme-presets"
import { toErrorMessage } from "@/lib/app-error"
import { FontSettingsSection } from "./font-settings-section"
import { WorkspaceBackgroundSection } from "./workspace-background-section"
import { CustomStyleSection } from "./custom-style-section"

const themeModes = ["system", "light", "dark"] as const

export function AppearanceSettings() {
  const t = useTranslations("AppearanceSettings")
  const { theme, resolvedTheme, setTheme } = useTheme()
  const { themeColor, setThemeColor } = useThemeColor()
  const { zoomLevel, setZoomLevel } = useZoomLevel()
  const { showWelcomeQuickActions, setShowWelcomeQuickActions } =
    useWelcomeQuickActions()

  // 这些开关现在异步持久化到后端；失败时乐观值已回滚，这里再报个 toast。
  const announceSaveFailure = (err: unknown) => {
    toast.error(t("saveFailed", { message: toErrorMessage(err) }))
  }

  const resolvedThemeLabel =
    resolvedTheme === "dark"
      ? t("resolvedTheme.dark")
      : resolvedTheme === "light"
        ? t("resolvedTheme.light")
        : t("resolvedTheme.unknown")

  return (
    <ScrollArea className="h-full">
      <div data-settings-page="" className="w-full space-y-4 p-3 md:p-4">
        <h1 data-settings-page-title="">{t("sectionTitle")}</h1>
        {/* ===== Theme Mode ===== */}
        <section data-settings-group="" className="space-y-3">
          <div
            data-settings-group-heading=""
            className="flex flex-col items-start gap-1"
          >
            <h2 id="appearance-theme-heading">{t("themeMode")}</h2>
            <span
              className="text-xs text-muted-foreground"
              suppressHydrationWarning
            >
              {t("currentTheme", { theme: resolvedThemeLabel })}
            </span>
          </div>
          <fieldset
            aria-labelledby="appearance-theme-heading"
            className="grid min-w-0 grid-cols-3 gap-2"
          >
            {themeModes.map((mode) => (
              <label key={mode} className="settings-theme-choice">
                <input
                  type="radio"
                  name="appearance-theme-mode"
                  value={mode}
                  checked={(theme ?? "system") === mode}
                  onChange={() => setTheme(mode)}
                  className="absolute inset-0 z-10 size-full cursor-pointer opacity-0"
                />
                <span data-theme-preview={mode} aria-hidden="true">
                  <span />
                  <span />
                </span>
                <span className="flex items-center justify-between gap-1 text-xs font-medium">
                  {t(mode)}
                  <Check
                    aria-hidden="true"
                    className="settings-theme-check size-3.5 shrink-0"
                  />
                </span>
              </label>
            ))}
          </fieldset>
        </section>

        {/* ===== Theme Color ===== */}
        <SettingsGroup
          heading={
            <div className="settings-help-heading flex items-center gap-1">
              <h2>{t("themeColor.sectionTitle")}</h2>
              <SettingsHelp label={t("themeColor.sectionTitle")}>
                {t("themeColor.sectionDescription")}
              </SettingsHelp>
            </div>
          }
        >
          <div
            className={cn(
              "grid grid-cols-2 gap-2",
              APPEARANCE_CUSTOMIZATION_ENABLED && "sm:grid-cols-3"
            )}
          >
            {(APPEARANCE_CUSTOMIZATION_ENABLED
              ? THEME_COLORS
              : SELECTABLE_THEME_COLORS
            ).map((color) => {
              const isActive = themeColor === color
              return (
                <button
                  key={color}
                  type="button"
                  onClick={() => setThemeColor(color as ThemeColor)}
                  aria-pressed={isActive}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors",
                    "hover:bg-interaction-hover hover:text-foreground",
                    isActive && "border-foreground/50 bg-foreground/5"
                  )}
                >
                  <span
                    className="size-4 shrink-0 rounded-full border"
                    style={{ backgroundColor: THEME_COLOR_PREVIEW[color] }}
                    aria-hidden
                  />
                  <span className="truncate">
                    {t(`themeColor.options.${color}`)}
                  </span>
                  {isActive && (
                    <Check
                      aria-hidden="true"
                      className="ms-auto size-3.5 shrink-0"
                    />
                  )}
                </button>
              )
            })}
          </div>
        </SettingsGroup>

        {APPEARANCE_CUSTOMIZATION_ENABLED && (
          <>
            {/* ===== Custom style (token overrides + free-form CSS) ===== */}
            <CustomStyleSection />

            {/* ===== Zoom Level ===== */}
            <SettingsGroup
              heading={
                <div className="flex items-center gap-2">
                  <Type className="h-4 w-4 text-muted-foreground" />
                  <div className="settings-help-heading flex items-center gap-1">
                    <h2 className="text-sm font-semibold">
                      {t("zoomLevel.sectionTitle")}
                    </h2>
                    <SettingsHelp label={t("zoomLevel.sectionTitle")}>
                      {t("zoomLevel.sectionDescription")}
                    </SettingsHelp>
                  </div>
                </div>
              }
            >
              <div className="space-y-2">
                <Select
                  value={String(zoomLevel)}
                  onValueChange={(value) =>
                    setZoomLevel(parseInt(value, 10) as ZoomLevel)
                  }
                >
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder={t("zoomLevel.placeholder")} />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {ZOOM_LEVELS.map((z) => (
                      <SelectItem key={z} value={String(z)}>
                        {z}%
                        {z === DEFAULT_ZOOM_LEVEL
                          ? ` (${t("zoomLevel.default")})`
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-2xs text-muted-foreground">
                  {t("zoomLevel.current", { zoom: zoomLevel })}
                </p>
              </div>
            </SettingsGroup>

            {/* ===== Fonts ===== */}
            <FontSettingsSection />
          </>
        )}

        {APPEARANCE_CUSTOMIZATION_ENABLED && (
          <>
            {/* ===== Workspace background ===== */}
            <WorkspaceBackgroundSection />

            {/* ===== New conversation — mode selection area ===== */}
            <SettingsGroup
              heading={
                <div className="flex items-center gap-2">
                  <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                  <div className="settings-help-heading flex items-center gap-1">
                    <h2 className="text-sm font-semibold">
                      {t("welcomePanel.sectionTitle")}
                    </h2>
                    <SettingsHelp label={t("welcomePanel.sectionTitle")}>
                      {t("welcomePanel.sectionDescription")}
                    </SettingsHelp>
                  </div>
                </div>
              }
            >
              <label className="flex items-center gap-2">
                <Switch
                  checked={showWelcomeQuickActions}
                  onCheckedChange={(v) => {
                    setShowWelcomeQuickActions(v).catch(announceSaveFailure)
                  }}
                />
                <span className="text-xs text-muted-foreground">
                  {t("welcomePanel.showQuickActions")}
                </span>
              </label>
            </SettingsGroup>
          </>
        )}
      </div>
    </ScrollArea>
  )
}
