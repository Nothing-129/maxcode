"use client"

import { Button } from "@/components/ui/button"
import { useId } from "react"
import { CalendarDays, Check, ChevronDown, ChevronRight, X } from "lucide-react"
import {
  DATE_PRESETS,
  resolveDateFilter,
  type DatePreset,
  START_OF_DAY,
  END_OF_DAY,
} from "@/lib/sidebar-navigation"
import { useLocale, useTranslations } from "next-intl"
import { useSidebarNavigation } from "@/contexts/sidebar-navigation-context"
import { cn } from "@/lib/utils"
import { DatePicker } from "@/components/ui/date-picker"
import { RangeTimePicker } from "./range-time-picker"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { fromLocalDayValue } from "@/lib/local-date"

function formatCustomRange(
  start: string,
  end: string,
  today: string,
  locale: string
) {
  const first = fromLocalDayValue(start)
  const last = fromLocalDayValue(end)
  if (!first || !last) return start === end ? start : `${start} – ${end}`
  const otherYear = [start, end].some(
    (day) => day.slice(0, 4) !== today.slice(0, 4)
  )
  const format = new Intl.DateTimeFormat(locale, {
    year: otherYear ? "numeric" : undefined,
    month: "short",
    day: "numeric",
  })
  if (start === end) return format.format(first)
  if (locale.startsWith("zh") && start.slice(0, 7) === end.slice(0, 7))
    return `${format.format(first)}–${last.getDate()}日`
  return format.formatRange(first, last)
}

const dateOptionClassName =
  "grid min-h-8 w-full grid-cols-[minmax(0,1fr)_auto_0.875rem] items-center gap-x-2 rounded-md px-2.5 py-1.5 text-start text-[0.8125rem] leading-5 hover:bg-interaction-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-foreground/[0.045] aria-pressed:font-medium dark:aria-pressed:bg-foreground/[0.07]"

function DatePresetRow({
  preset,
  today,
  selected,
  onSelect,
}: {
  preset: DatePreset
  today: string
  selected: boolean
  onSelect: (preset: DatePreset) => void
}) {
  const t = useTranslations("Folder.sidebar.navigation.presets")
  const locale = useLocale()
  const rangeId = useId()
  const { start, end } = resolveDateFilter({ preset }, today)
  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      aria-label={t(preset)}
      aria-describedby={rangeId}
      aria-pressed={selected}
      onClick={() => onSelect(preset)}
      className={dateOptionClassName}
    >
      <span>{t(preset)}</span>
      <span
        id={rangeId}
        className="text-end text-[0.6875rem] font-normal tabular-nums text-muted-foreground"
      >
        {formatCustomRange(start, end, today, locale)}
      </span>
      {selected && <Check aria-hidden="true" className="size-3.5" />}
    </Button>
  )
}

export function RecentDateFilter() {
  const t = useTranslations("Folder.sidebar")
  const navigation = useSidebarNavigation()
  const locale = useLocale()
  const id = useId()
  if (!navigation) return null
  const label =
    navigation.preset === "custom"
      ? formatCustomRange(
          navigation.date,
          navigation.endDate,
          navigation.today,
          locale
        )
      : t(`navigation.presets.${navigation.preset}`)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          data-filter-active={navigation.preset !== "today"}
          aria-describedby={`${id}-label`}
          className="inline-flex h-7 shrink max-w-40 min-w-0 items-center gap-1 rounded-md bg-transparent px-1.5 data-[filter-active=true]:bg-sidebar-foreground/[0.04] text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-foreground/[0.08] hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-sidebar-foreground/[0.08] data-[state=open]:text-sidebar-foreground"
          aria-label={t("navigation.filterDate")}
          title={
            navigation.preset === "custom"
              ? `${navigation.date} ${navigation.startTime.slice(0, 5)} — ${navigation.endDate} ${navigation.endTime.slice(0, 5)}`
              : `${navigation.date} — ${navigation.endDate}`
          }
        >
          <CalendarDays aria-hidden="true" className="size-3.5 shrink-0" />
          <span id={`${id}-label`} className="truncate">
            {label}
          </span>
          <ChevronDown
            aria-hidden="true"
            className="size-2.5 shrink-0 opacity-50"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={8}
        className="w-56 max-w-(--radix-popover-content-available-width) max-h-(--radix-popover-content-available-height) gap-0 overflow-auto rounded-xl p-1.5 shadow-lg"
        aria-label={t("navigation.filterDate")}
      >
        <div className="@container">
          {DATE_PRESETS.map((preset) => (
            <DatePresetRow
              key={preset}
              preset={preset}
              today={navigation.today}
              selected={navigation.preset === preset}
              onSelect={navigation.setPreset}
            />
          ))}
          <div className="mx-2 my-1 h-px bg-border" />
          <Button
            variant="ghost"
            size="sm"
            type="button"
            aria-pressed={navigation.preset === "custom"}
            aria-expanded={navigation.preset === "custom"}
            className={cn(
              dateOptionClassName,
              "aria-expanded:bg-foreground/[0.045] dark:aria-expanded:bg-foreground/[0.07]"
            )}
            onClick={() => navigation.setPreset("custom")}
          >
            <span className="col-span-2">{t("navigation.presets.custom")}</span>
            {navigation.preset === "custom" ? (
              <Check aria-hidden="true" className="size-3.5" />
            ) : (
              <ChevronRight
                aria-hidden="true"
                className="size-3.5 text-muted-foreground rtl:rotate-180"
              />
            )}
          </Button>
          {navigation.preset === "custom" && (
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-1 px-2.5 py-1 @min-[12rem]:grid-cols-[minmax(0,1fr)_auto_auto]">
              {(["start", "end"] as const).map((side) => {
                const start = side === "start"
                const dateId = `${id}-${side}-date`
                const dateLabel = t(`navigation.${side}Date`)
                return (
                  <div
                    key={side}
                    role="group"
                    aria-labelledby={`${dateId}-label`}
                    className="col-span-full grid grid-cols-subgrid items-center gap-y-1"
                  >
                    <Label
                      id={`${dateId}-label`}
                      htmlFor={dateId}
                      className="text-xs font-normal text-muted-foreground"
                    >
                      {t(`navigation.${side}`)}
                    </Label>
                    <DatePicker
                      id={dateId}
                      label={dateLabel}
                      compact
                      value={start ? navigation.date : navigation.endDate}
                      min={start ? undefined : navigation.date}
                      onValueChange={
                        start ? navigation.setDate : navigation.setEndDate
                      }
                      className="h-7 w-auto justify-self-start rounded-sm border-transparent bg-transparent px-1 text-xs font-normal tabular-nums text-muted-foreground hover:bg-interaction-hover hover:text-foreground focus-visible:text-foreground pointer-coarse:min-h-11"
                    />
                    <RangeTimePicker
                      label={t(`navigation.${side}Time`)}
                      value={start ? navigation.startTime : navigation.endTime}
                      onValueChange={
                        start ? navigation.setStartTime : navigation.setEndTime
                      }
                    />
                  </div>
                )
              })}
            </div>
          )}
          <div className="flex justify-end px-2.5">
            <RecentDateFilterSummary />
          </div>
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
      navigation.endDate === navigation.today &&
      navigation.startTime === START_OF_DAY &&
      navigation.endTime === END_OF_DAY)
  )
    return null
  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      aria-label={t("clearDate")}
      title={t("clearDate")}
      onClick={() => navigation.setDate(null)}
      className="inline-flex h-7 items-center gap-1.5 rounded-md px-1 text-xs font-normal text-muted-foreground hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <X className="size-3" />
      <span>{t("clear")}</span>
    </Button>
  )
}
