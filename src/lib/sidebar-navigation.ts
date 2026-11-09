import type { DbConversationSummary } from "@/lib/types"
import type { SidebarSectionKey } from "@/lib/sidebar-view-mode-storage"

export type SidebarView = "home" | "conversations" | "projects" | "tasks"

const VIEW_SECTIONS: Record<SidebarView, readonly SidebarSectionKey[]> = {
  home: ["pinned", "folders", "chats", "recent", "todos"],
  conversations: ["pinned", "recent"],
  projects: ["folders"],
  tasks: ["todos"],
}

export function sidebarViewSections(view: SidebarView) {
  return VIEW_SECTIONS[view]
}

/** Local calendar dates, including offset changes at daylight-saving boundaries. */
export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function conversationsOnDate(
  conversations: readonly DbConversationSummary[],
  date: string,
  endDate: string = date
): DbConversationSummary[] {
  // Imported/native sessions can retain a lazy zero message_count even after
  // many turns. Recency must not depend on that counter.
  return conversations
    .filter(
      (conversation) =>
        conversation.pinned_at == null &&
        conversation.parent_id == null &&
        (conversation.kind === "regular" || conversation.kind === "chat") &&
        localDateKey(new Date(conversation.updated_at)) >= date &&
        localDateKey(new Date(conversation.updated_at)) <= endDate
    )
    .sort(
      (a, b) =>
        Date.parse(b.updated_at) - Date.parse(a.updated_at) || b.id - a.id
    )
}

export const DATE_PRESETS = [
  "today",
  "yesterday",
  "last3",
  "last7",
  "week",
  "month",
] as const
export type DatePreset = (typeof DATE_PRESETS)[number]
export type ConversationDateFilter =
  | { preset: DatePreset }
  | { preset: "custom"; start: string; end: string; range: boolean }
export const DATE_FILTER_STORAGE_KEY = "workspace:conversation-date-filter"

export function resolveDateFilter(
  filter: ConversationDateFilter,
  today: string
) {
  if (filter.preset === "custom")
    return {
      start: filter.start,
      end: filter.range ? filter.end : filter.start,
    }
  const [year, month, day] = today.split("-").map(Number)
  const start = new Date(year, month - 1, day)
  let end = today
  if (filter.preset === "yesterday") {
    start.setDate(start.getDate() - 1)
    end = localDateKey(start)
  }
  if (filter.preset === "last3") start.setDate(start.getDate() - 2)
  if (filter.preset === "last7") start.setDate(start.getDate() - 6)
  if (filter.preset === "week")
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  if (filter.preset === "month") start.setDate(1)
  return { start: localDateKey(start), end }
}

export function loadDateFilter(): ConversationDateFilter {
  try {
    const value = JSON.parse(
      localStorage.getItem(DATE_FILTER_STORAGE_KEY) ?? "null"
    )
    if (value && DATE_PRESETS.includes(value.preset))
      return { preset: value.preset }
    const valid = (date: unknown): date is string =>
      typeof date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      localDateKey(new Date(`${date}T12:00:00`)) === date
    if (
      value?.preset === "custom" &&
      valid(value.start) &&
      valid(value.end) &&
      value.start <= value.end &&
      typeof value.range === "boolean"
    )
      return value
  } catch {
    /* Unavailable or invalid browser storage uses today's default. */
  }
  return { preset: "today" }
}

/** Dedicated conversation browsing can use longer batches than the Home overview. */
export function sidebarPageSize(view: SidebarView): number {
  return view === "conversations" ? 50 : 10
}
