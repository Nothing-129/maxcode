"use client"

import { CalendarDays, ChevronDown, X } from "lucide-react"
import { DATE_PRESETS } from "@/lib/sidebar-navigation"
import { useLocale, useTranslations } from "next-intl"
import { useSidebarNavigation } from "@/contexts/sidebar-navigation-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export function RecentDateFilter() {
  const t = useTranslations("Folder.sidebar")
  const navigation = useSidebarNavigation()
  const locale = useLocale()
  if (!navigation) return null
  const format = (value: string) => {
    const [year, month, day] = value.split("-").map(Number)
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      ...(value.slice(0, 4) !== navigation.today.slice(0, 4)
        ? { year: "numeric" as const }
        : {}),
    }).format(new Date(year, month - 1, day))
  }
  const label =
    navigation.date === navigation.today &&
    navigation.endDate === navigation.today
      ? t("navigation.presets.today")
      : navigation.date === navigation.endDate
        ? navigation.preset === "yesterday"
          ? t("navigation.presets.yesterday")
          : format(navigation.date)
        : `${format(navigation.date)} — ${format(navigation.endDate)}`
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 min-w-20 max-w-40 items-center gap-1 rounded-full border border-sidebar-foreground/[0.06] bg-sidebar-foreground/[0.04] px-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-foreground/[0.08] hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-sidebar-foreground/[0.08] data-[state=open]:text-sidebar-foreground"
          aria-label={t("navigation.filterDate")}
          title={`${navigation.date} — ${navigation.endDate}`}
        >
          <CalendarDays aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">{label}</span>
          <ChevronDown
            aria-hidden="true"
            className="size-2.5 shrink-0 opacity-50"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-64"
        aria-label={t("navigation.filterDate")}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-1">
            {DATE_PRESETS.map((preset) => (
              <Button
                key={preset}
                variant={navigation.preset === preset ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={navigation.preset === preset}
                className="h-8 justify-start text-xs"
                onClick={() => navigation.setPreset(preset)}
              >
                {t(`navigation.presets.${preset}`)}
              </Button>
            ))}
            <Button
              variant={navigation.preset === "custom" ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={navigation.preset === "custom"}
              className="h-8 justify-start text-xs"
              onClick={() => navigation.setPreset("custom")}
            >
              {t("navigation.presets.custom")}
            </Button>
          </div>
          {navigation.preset === "custom" && (
            <div className="space-y-2">
              <label className="block space-y-1.5">
                <span className="text-xs text-muted-foreground">
                  {t("navigation.startDate")}
                </span>
                <Input
                  type="date"
                  aria-label={t("navigation.startDate")}
                  value={navigation.date}
                  onChange={(event) => {
                    if (event.target.value)
                      navigation.setDate(event.target.value)
                  }}
                  className="h-8 w-full min-w-0 bg-transparent text-xs"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs text-muted-foreground">
                  {t("navigation.endDate")}
                </span>
                <Input
                  type="date"
                  aria-label={t("navigation.endDate")}
                  value={navigation.endDate}
                  min={navigation.date}
                  onChange={(event) => {
                    if (event.target.value)
                      navigation.setEndDate(event.target.value)
                  }}
                  className="h-8 w-full min-w-0 bg-transparent text-xs"
                />
              </label>
            </div>
          )}
          <RecentDateFilterSummary />
          <p className="text-[0.6875rem] leading-4 text-muted-foreground">
            {t("navigation.activityHint")}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function RecentDateFilterSummary() {
  const t = useTranslations("Folder.sidebar.navigation")
  const navigation = useSidebarNavigation()
  if (
    !navigation ||
    (navigation.date === navigation.today &&
      navigation.endDate === navigation.today)
  )
    return null
  return (
    <button
      type="button"
      aria-label={t("clearDate")}
      title={t("clearDate")}
      onClick={() => navigation.setDate(null)}
      className="inline-flex h-7 items-center gap-1.5 rounded-md px-1 text-xs font-normal text-muted-foreground hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <X className="size-3" />
      <span>{t("clearDate")}</span>
    </button>
  )
}
