/** Keep civil dates as YYYY-MM-DD. Convert to a local Date only for calendars. */
export function toLocalDayValue(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function fromLocalDayValue(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split("-").map(Number)
  if (year === 0) return null
  // setFullYear preserves years 0001–0099 and the round trip rejects rollover.
  const date = new Date(0)
  date.setFullYear(year, month - 1, day)
  date.setHours(0, 0, 0, 0)
  return toLocalDayValue(date) === value ? date : null
}

export function formatLocalDay(value: string, locale: string): string {
  return (
    fromLocalDayValue(value)?.toLocaleDateString(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }) ?? value
  )
}
