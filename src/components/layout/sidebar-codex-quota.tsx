"use client"

import { statusBarActionClassName } from "./status-bar-action"

import { Gauge, RefreshCw } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useCodexQuota } from "@/hooks/use-codex-quota"
import { codexQuotaWindows } from "@/lib/codex-quota"
import { cn } from "@/lib/utils"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

/** Inline between the conversation count and version; details cost no height. */
export function SidebarCodexQuota() {
  const { quota, loading, refresh } = useCodexQuota()
  const t = useTranslations("CodexQuota")
  const locale = useLocale()
  if (!quota?.official) return null
  const windows = codexQuotaWindows(quota)
  const plan = quota.plan_type?.trim().toLowerCase()
  const planLabel = plan === "plus" ? "Plus" : plan === "pro" ? "Pro" : null
  const formatTime = (seconds: number) =>
    new Date(seconds * 1000).toLocaleString(locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  const windowLabel = (minutes: number, short = false) => {
    if (minutes === 300) return t(short ? "fiveHourShort" : "fiveHour")
    if (minutes === 10080) return t(short ? "weeklyShort" : "weekly")
    if (minutes % 1440 === 0) return t("days", { count: minutes / 1440 })
    if (minutes % 60 === 0) return t("hours", { count: minutes / 60 })
    return t("minutes", { count: minutes })
  }
  const remaining = (used: number) =>
    Math.floor(Math.max(0, Math.min(100, 100 - used)))
  const summary = windows
    .map(
      (window) =>
        `${windowLabel(window.window_minutes, true)} ${t("percent", { value: remaining(window.used_percent) })}`
    )
    .join(" · ")
  const details = [
    [t("title"), planLabel, t("remaining")].filter(Boolean).join(" · "),
    ...windows.map(
      (window) =>
        `${windowLabel(window.window_minutes)} ${t("percent", { value: remaining(window.used_percent) })} — ${window.resets_at ? t("resetsAt", { time: formatTime(window.resets_at) }) : t("resetUnknown")}`
    ),
    quota.updated_at && t("updatedAt", { time: formatTime(quota.updated_at) }),
    quota.error && t("failed"),
    windows.length === 0 && t("unavailable"),
  ]
    .filter(Boolean)
    .join("\n")

  return (
    <>
      <span
        data-sidebar-quota-separator=""
        aria-hidden="true"
        className="pointer-events-none inline-flex min-w-0 flex-1 justify-center text-muted-foreground/50"
      >
        ｜
      </span>
      <Popover
        onOpenChange={(open) => {
          if (open) void refresh()
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            data-sidebar-codex-quota=""
            aria-label={`${t("title")} · ${t("remaining")} · ${summary || t("unavailable")}${quota.error ? ` · ${t("stale")}` : ""}`}
            aria-busy={loading}
            title={details}
            className={cn(
              statusBarActionClassName,
              "flex min-w-0 items-center gap-1.5 whitespace-nowrap font-mono text-xs font-normal"
            )}
          >
            <Gauge aria-hidden="true" className="size-3 shrink-0" />
            <span className="truncate">{summary || "—"}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="center"
          sideOffset={8}
          className="gap-3 p-3 text-xs"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">
              {t("title")}
              {planLabel && ` · ${planLabel}`}
            </span>
            <button
              type="button"
              aria-label={t("refresh")}
              title={t("refresh")}
              disabled={loading}
              onClick={() => void refresh()}
              className="inline-flex size-6 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3", loading && "animate-spin")} />
            </button>
          </div>
          {windows.map((window) => (
            <div key={window.window_minutes} className="space-y-1.5">
              <div className="flex justify-between gap-2">
                <span>{windowLabel(window.window_minutes)}</span>
                <span className="tabular-nums">
                  {t("remaining")}{" "}
                  {t("percent", { value: remaining(window.used_percent) })}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={`${windowLabel(window.window_minutes)} · ${t("remaining")}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={remaining(window.used_percent)}
                className="h-1.5 overflow-hidden rounded-full bg-foreground/10"
              >
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none",
                    remaining(window.used_percent) <= 10
                      ? "bg-destructive"
                      : remaining(window.used_percent) <= 20
                        ? "bg-amber-500"
                        : "bg-primary/70",
                    quota.error && "opacity-50"
                  )}
                  style={{ width: `${remaining(window.used_percent)}%` }}
                />
              </div>
              <p className="text-muted-foreground">
                {window.resets_at
                  ? t("resetsAt", { time: formatTime(window.resets_at) })
                  : t("resetUnknown")}
              </p>
            </div>
          ))}
          {windows.length === 0 && (
            <p className="text-muted-foreground">{t("unavailable")}</p>
          )}
          {quota.updated_at && (
            <p className="text-muted-foreground">
              {t("updatedAt", { time: formatTime(quota.updated_at) })}
            </p>
          )}
          {quota.error && (
            <p className="text-muted-foreground">{t("failed")}</p>
          )}
        </PopoverContent>
      </Popover>
      <span
        data-sidebar-quota-separator=""
        aria-hidden="true"
        className="pointer-events-none inline-flex min-w-0 flex-1 justify-center pl-1 text-muted-foreground/50"
      >
        ｜
      </span>
    </>
  )
}
