"use client"

import { useState, type ComponentProps } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CalendarDays } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { dateFnsLocale } from "@/lib/date-fns-locale"
import {
  formatLocalDay,
  fromLocalDayValue,
  toLocalDayValue,
} from "@/lib/local-date"
import { cn } from "@/lib/utils"

export function CalendarPopoverContent({
  className,
  ...props
}: ComponentProps<typeof PopoverContent>) {
  return (
    <PopoverContent
      align="start"
      collisionPadding={8}
      className={cn(
        "max-h-(--radix-popover-content-available-height) w-auto max-w-(--radix-popover-content-available-width) gap-0 overflow-auto overscroll-contain p-0",
        className
      )}
      {...props}
    />
  )
}

type DatePickerProps = {
  id: string
  label: string
  value: string
  onValueChange: (value: string) => void
  min?: string
  compact?: boolean
  clearable?: boolean
  disabled?: boolean
  className?: string
}

export function DatePicker({
  id,
  label,
  value,
  onValueChange,
  min,
  compact,
  clearable,
  disabled,
  className,
}: DatePickerProps) {
  const locale = useLocale()
  const t = useTranslations("DatePicker")
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const selected = fromLocalDayValue(value) ?? undefined
  const displayDate =
    compact && selected
      ? selected.toLocaleDateString(locale, { month: "short", day: "numeric" })
      : formatLocalDay(value, locale)
  const earliest = min ? fromLocalDayValue(min) : null
  const typed = draft.trim()
  const canApply = !!fromLocalDayValue(typed) && (!min || typed >= min)

  function choose(next: string) {
    onValueChange(next)
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value)
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          title={compact && value ? formatLocalDay(value, locale) : undefined}
          aria-label={label}
          aria-describedby={value ? `${id}-value` : undefined}
          className={cn(
            "w-full min-w-0 justify-between rounded-4xl px-3 font-normal",
            !value && "text-muted-foreground",
            className
          )}
        >
          <span id={`${id}-value`} className="truncate">
            {value ? displayDate : t("selectDate")}
          </span>
          {!compact && (
            <CalendarDays aria-hidden="true" className="size-4 opacity-60" />
          )}
        </Button>
      </PopoverTrigger>
      <CalendarPopoverContent aria-label={label}>
        <Calendar
          mode="single"
          required
          autoFocus
          className="mx-auto"
          locale={dateFnsLocale(locale)}
          selected={selected}
          defaultMonth={selected}
          disabled={earliest ? { before: earliest } : undefined}
          onSelect={(day) => choose(toLocalDayValue(day))}
        />
        <div className="flex flex-col gap-2 border-t border-border p-2">
          <div className="flex items-center gap-1.5">
            <Input
              aria-label={t("enterDate")}
              aria-invalid={typed.length >= 10 && !canApply ? true : undefined}
              dir="ltr"
              value={draft}
              placeholder="YYYY-MM-DD"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing)
                  return
                event.preventDefault()
                if (canApply) choose(typed)
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={!canApply}
              onClick={() => choose(typed)}
            >
              {t("apply")}
            </Button>
          </div>
          {clearable && value && (
            <Button
              type="button"
              variant="ghost"
              className="self-start"
              onClick={() => choose("")}
            >
              {t("clearDate")}
            </Button>
          )}
        </div>
      </CalendarPopoverContent>
    </Popover>
  )
}
