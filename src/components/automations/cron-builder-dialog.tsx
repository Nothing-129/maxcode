"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
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
import { automationComputeNextRun } from "@/lib/api"
import { describeCron, type CronDescriptor } from "@/lib/cron-humanize"
import { ScheduleLabel } from "./schedule-label"

type Freq =
  | "everyMinutes"
  | "hourly"
  | "daily"
  | "weekdays"
  | "weekly"
  | "monthly"
  | "custom"

const FREQS: Freq[] = [
  "everyMinutes",
  "hourly",
  "daily",
  "weekdays",
  "weekly",
  "monthly",
  "custom",
]

// Indexed 0..6 = Sun..Sat (cron's day-of-week), matching describeCron's `dow`.
const DOW_KEYS = [
  "dow0",
  "dow1",
  "dow2",
  "dow3",
  "dow4",
  "dow5",
  "dow6",
] as const

const FREQ_LABEL_KEY = {
  everyMinutes: "cronFreqMinutes",
  hourly: "cronFreqHourly",
  daily: "cronFreqDaily",
  weekdays: "cronFreqWeekdays",
  weekly: "cronFreqWeekly",
  monthly: "cronFreqMonthly",
  custom: "cronFreqCustom",
} as const satisfies Record<Freq, string>

/** Parse a numeric input, clamping into range and falling back on garbage. */
function clampInt(raw: string, lo: number, hi: number): number {
  const v = parseInt(raw, 10)
  if (Number.isNaN(v)) return lo
  return Math.min(hi, Math.max(lo, v))
}

/** describeCron's `hourly` descriptor discards the minute, so recover it from
 *  the raw cron's first field when seeding — otherwise reopening `15 * * * *`
 *  would silently reset the schedule to :00. Other timed kinds carry it. */
function initialMinute(init: CronDescriptor, cron: string): number {
  if ("minute" in init) return init.minute
  if (init.kind === "hourly") {
    const m = parseInt(cron.trim().split(/\s+/)[0] ?? "", 10)
    if (!Number.isNaN(m) && m >= 0 && m <= 59) return m
  }
  return 0
}

function buildCron(
  freq: Freq,
  s: {
    n: number
    minute: number
    hour: number
    dow: number
    dom: number
    raw: string
  }
): string {
  switch (freq) {
    case "everyMinutes":
      return `*/${s.n} * * * *`
    case "hourly":
      return `${s.minute} * * * *`
    case "daily":
      return `${s.minute} ${s.hour} * * *`
    case "weekdays":
      return `${s.minute} ${s.hour} * * 1-5`
    case "weekly":
      return `${s.minute} ${s.hour} * * ${s.dow}`
    case "monthly":
      return `${s.minute} ${s.hour} ${s.dom} * *`
    case "custom":
      return s.raw.trim()
  }
}

interface CronBuilderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Current cron, used to seed the builder when it opens. */
  cron: string
  calendarFilter?: import("@/lib/types").AutomationCalendarFilter
  timezone: string
  onApply: (cron: string) => void
}

/**
 * A visual cron editor. Lets the user pick a frequency and the relevant
 * fields (interval / time / weekday / day-of-month) instead of hand-writing a
 * cron string, with a live humanized + next-run preview. Frequencies map 1:1 to
 * {@link describeCron}'s recognized kinds so the preview always resolves; any
 * unsupported expression is editable via the "Custom" raw field.
 */
export function CronBuilderDialog({
  open,
  onOpenChange,
  cron,
  timezone,
  calendarFilter = "all",
  onApply,
}: CronBuilderDialogProps) {
  const t = useTranslations("Automations")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("cronBuilderTitle")}</DialogTitle>
        </DialogHeader>
        {/* Remounts per open (Radix unmounts content when closed) so the body's
            useState always seeds fresh from the current cron. */}
        {open ? (
          <CronBuilderBody
            cron={cron}
            timezone={timezone}
            calendarFilter={calendarFilter}
            onApply={(c) => {
              onApply(c)
              onOpenChange(false)
            }}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function CronBuilderBody({
  cron,
  timezone,
  calendarFilter = "all",
  onApply,
  onCancel,
}: {
  cron: string
  calendarFilter?: import("@/lib/types").AutomationCalendarFilter
  timezone: string
  onApply: (cron: string) => void
  onCancel: () => void
}) {
  const t = useTranslations("Automations")
  const init = useMemo(() => describeCron(cron), [cron])

  const [freq, setFreq] = useState<Freq>(
    init.kind === "raw" ? "custom" : init.kind
  )
  const [n, setN] = useState(init.kind === "everyMinutes" ? init.n : 30)
  const [minute, setMinute] = useState(initialMinute(init, cron))
  const [hour, setHour] = useState("hour" in init ? init.hour : 9)
  const [dow, setDow] = useState(init.kind === "weekly" ? init.dow : 1)
  const [dom, setDom] = useState(init.kind === "monthly" ? init.dom : 1)
  const [raw, setRaw] = useState(init.kind === "raw" ? init.cron : cron)

  const built = useMemo(
    () => buildCron(freq, { n, minute, hour, dow, dom, raw }),
    [freq, n, minute, hour, dow, dom, raw]
  )

  // Authoritative preview — same backend evaluator the scheduler uses. Only the
  // async callbacks set state (an empty expression is handled by gating the
  // render below, never a synchronous setState in the effect body).
  const [nextRun, setNextRun] = useState<string | null>(null)
  useEffect(() => {
    if (!built.trim()) return
    let cancelled = false
    const handle = setTimeout(() => {
      automationComputeNextRun(built.trim(), timezone, calendarFilter)
        .then((r) => {
          if (!cancelled) setNextRun(r)
        })
        .catch(() => {
          if (!cancelled) setNextRun(null)
        })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [built, timezone, calendarFilter])

  const showTime =
    freq === "daily" ||
    freq === "weekdays" ||
    freq === "weekly" ||
    freq === "monthly"

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cron-freq">{t("cronFreqLabel")}</Label>
        <Select value={freq} onValueChange={(v) => setFreq(v as Freq)}>
          <SelectTrigger id="cron-freq">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FREQS.map((f) => (
              <SelectItem key={f} value={f}>
                {t(FREQ_LABEL_KEY[f])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {freq === "everyMinutes" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cron-n">{t("cronEveryLabel")}</Label>
          <Input
            id="cron-n"
            type="number"
            min={1}
            max={59}
            value={String(n)}
            onChange={(e) => setN(clampInt(e.target.value, 1, 59))}
            className="w-24"
          />
        </div>
      ) : null}

      {freq === "hourly" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cron-hourly-min">{t("cronMinuteLabel")}</Label>
          <Input
            id="cron-hourly-min"
            type="number"
            min={0}
            max={59}
            value={String(minute)}
            onChange={(e) => setMinute(clampInt(e.target.value, 0, 59))}
            className="w-24"
          />
        </div>
      ) : null}

      {freq === "weekly" ? (
        <div className="flex flex-col gap-1.5">
          <Label>{t("cronDowLabel")}</Label>
          <div
            role="group"
            aria-label={t("cronDowLabel")}
            className="flex flex-wrap gap-1"
          >
            {DOW_KEYS.map((key, d) => (
              <Button
                key={key}
                type="button"
                size="sm"
                variant={dow === d ? "default" : "outline"}
                onClick={() => setDow(d)}
              >
                {t(key)}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {freq === "monthly" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cron-dom">{t("cronDomLabel")}</Label>
          <Input
            id="cron-dom"
            type="number"
            min={1}
            max={31}
            value={String(dom)}
            onChange={(e) => setDom(clampInt(e.target.value, 1, 31))}
            className="w-24"
          />
        </div>
      ) : null}

      {showTime ? (
        <div className="flex flex-col gap-1.5">
          <Label>{t("cronTimeLabel")}</Label>
          <div
            role="group"
            aria-label={t("cronTimeLabel")}
            className="flex items-center gap-1.5"
          >
            <Input
              type="number"
              min={0}
              max={23}
              aria-label={t("cronHourLabel")}
              value={String(hour)}
              onChange={(e) => setHour(clampInt(e.target.value, 0, 23))}
              className="w-20"
            />
            <span className="text-muted-foreground">:</span>
            <Input
              type="number"
              min={0}
              max={59}
              aria-label={t("cronMinuteLabel")}
              value={String(minute)}
              onChange={(e) => setMinute(clampInt(e.target.value, 0, 59))}
              className="w-20"
            />
          </div>
        </div>
      ) : null}

      {freq === "custom" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cron-raw">{t("cron")}</Label>
          <Input
            id="cron-raw"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={t("cronPlaceholder")}
            className="font-mono"
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-1 rounded-lg border border-border bg-card/40 p-3 text-sm">
        <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
          {t("cronPreviewLabel")}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <ScheduleLabel cron={built} calendarFilter={calendarFilter} />
          <span className="font-mono text-xs text-muted-foreground">
            {built}
          </span>
        </span>
        <span className="text-xs text-muted-foreground">
          {t("nextRun")}:{" "}
          {built.trim() && nextRun ? new Date(nextRun).toLocaleString() : "—"}
        </span>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button
          type="button"
          onClick={() => onApply(built)}
          disabled={!built.trim()}
        >
          {t("cronApply")}
        </Button>
      </DialogFooter>
    </div>
  )
}
