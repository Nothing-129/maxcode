/**
 * Planned starts for board tasks: the conversions between the wire's UTC
 * instant and the local date and time fields, plus the schedule presets.
 *
 * All of it is pure and local-time aware on purpose. The user picks a wall
 * clock time in their own zone; the backend stores and compares instants, so
 * the boundary between the two lives here rather than being re-derived (and
 * re-broken) in each component.
 */

import { toLocalDayValue } from "@/lib/local-date"

export { formatLocalDay as formatScheduleDay } from "@/lib/local-date"

/** Minute precision — the granularity `datetime-local` itself offers. */
const INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

/**
 * `Date` → the `YYYY-MM-DDTHH:mm` an input expects, in LOCAL time.
 *
 * Not `toISOString().slice(0, 16)`: that is UTC, so every user outside UTC
 * would see (and then save) a time shifted by their offset.
 */
export function toDateTimeLocalValue(date: Date): string {
  return `${toLocalDayValue(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * The input's value → a `Date`, or `null` when it is empty/half-typed.
 *
 * A `YYYY-MM-DDTHH:mm` string with no offset is parsed as local time by the
 * language spec (unlike a date-only string, which is UTC) — which is exactly
 * what the picker means.
 */
export function parseDateTimeLocalValue(value: string): Date | null {
  if (!INPUT_PATTERN.test(value)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** ISO instant (the wire form) → input value; null for an unparsable one. */
export function isoToDateTimeLocalValue(iso: string): string | null {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : toDateTimeLocalValue(date)
}

/**
 * The picker is two controls — a calendar and a time input — while everything
 * downstream (presets, parsing, the wire) speaks one `YYYY-MM-DDTHH:mm` value.
 * These two are that seam; keeping it here rather than in the dialog is what
 * lets the preset buttons keep emitting a single combined value.
 */
export function splitDateTimeLocalValue(value: string): {
  date: string
  time: string
} {
  if (!INPUT_PATTERN.test(value)) return { date: "", time: "" }
  const [date, time] = value.split("T")
  return { date, time }
}

/** The two halves → one value. Empty when either half is missing: a date with
 *  no time is not a plan, and `parseDateTimeLocalValue` rejects it as such. */
export function joinDateAndTime(date: string, time: string): string {
  if (!date || !time) return ""
  return `${date}T${time}`
}

/**
 * The time to fill in once a date is chosen and the time is still blank.
 *
 * The dialog opens EMPTY — an unplanned task must not look scheduled — but
 * leaving the user to fill both halves before anything can be saved turns one
 * decision into two. Picking the date is the decision; this supplies the rest:
 * the next full hour when the date is today (the plan is "soon"), and 09:00
 * otherwise (a day away, "the morning of" is what people mean).
 */
export function defaultTimeForDate(date: string, now: Date): string {
  if (date !== toDateTimeLocalValue(now).slice(0, 10)) return "09:00"
  const next = new Date(now)
  next.setMinutes(0, 0, 0)
  next.setHours(next.getHours() + 1)
  // Rolled past midnight — the hour after 23:xx belongs to tomorrow, and the
  // date is already fixed, so end the day instead of jumping back to 00:00.
  if (next.getDate() !== now.getDate()) return "23:59"
  return toDateTimeLocalValue(next).slice(11)
}

/** Compact "when": no year — a plan more than a year out is not a use case. */
export function formatScheduleShort(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** Full "when", year included — the detail drawer and the dialog preview. */
export function formatScheduleFull(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/**
 * A time already past. Not an error — the engine simply starts the task at its
 * next sweep — but the dialog says so rather than letting it look scheduled.
 */
export function isScheduleInPast(date: Date, now: number): boolean {
  return date.getTime() <= now
}

export interface SchedulePreset {
  /** i18n key under `Tasks`. */
  labelKey: "scheduleInAnHour" | "scheduleInThreeHours" | "scheduleTomorrow"
  value: string
}

/** The one-tap options: two nudges forward and tomorrow morning. */
export function schedulePresets(now: Date): SchedulePreset[] {
  const inHours = (hours: number) => {
    const date = new Date(now.getTime() + hours * 60 * 60 * 1000)
    date.setSeconds(0, 0)
    return toDateTimeLocalValue(date)
  }
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(9, 0, 0, 0)
  return [
    { labelKey: "scheduleInAnHour", value: inHours(1) },
    { labelKey: "scheduleInThreeHours", value: inHours(3) },
    { labelKey: "scheduleTomorrow", value: toDateTimeLocalValue(tomorrow) },
  ]
}
