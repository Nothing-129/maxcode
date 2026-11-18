"use client"

import { usePersistedNavigation } from "@/hooks/use-persisted-navigation"
import { createContext, useContext, useEffect, useState } from "react"
import {
  localDateKey,
  START_OF_DAY,
  END_OF_DAY,
  minuteBoundary,
  loadDateFilter,
  resolveDateFilter,
  DATE_FILTER_STORAGE_KEY,
  type ConversationDateFilter,
  type DatePreset,
  type SidebarView,
} from "@/lib/sidebar-navigation"

export const NAVIGATION_IDS = [
  "home",
  "conversations",
  "projects",
  "tasks",
  "automations",
] as const
export type NavigationId = (typeof NAVIGATION_IDS)[number]
const GROUP_MODES = ["recent", "folder"] as const
const ORDER_STORAGE_KEY = "workspace:navigation-order"

function normalizeOrder(value: unknown): NavigationId[] {
  const saved = Array.isArray(value) ? value : []
  return [
    ...new Set<NavigationId>([
      ...saved.filter((id): id is NavigationId => NAVIGATION_IDS.includes(id)),
      ...NAVIGATION_IDS,
    ]),
  ]
}

const SIDEBAR_VIEWS: readonly SidebarView[] = [
  "home",
  "conversations",
  "projects",
  "tasks",
]

const SidebarNavigationContext = createContext<{
  order: readonly NavigationId[]
  moveNavigation: (id: NavigationId, delta: number) => void
  groupByFolder: boolean
  toggleFolderGrouping: () => void
  view: SidebarView
  setView: (view: SidebarView) => void
  date: string
  setDate: (date: string | null) => void
  endDate: string
  setEndDate: (date: string) => void
  startTime: string
  endTime: string
  setStartTime: (value: string) => void
  setEndTime: (value: string) => void
  range: boolean
  setRange: (range: boolean) => void
  preset: ConversationDateFilter["preset"]
  setPreset: (preset: DatePreset | "custom") => void
  today: string
} | null>(null)

export function SidebarNavigationProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [order, setOrder] = useState<readonly NavigationId[]>(NAVIGATION_IDS)
  useEffect(() => {
    try {
      // Restore after hydration so static export and the first client render agree.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOrder(
        normalizeOrder(
          JSON.parse(localStorage.getItem(ORDER_STORAGE_KEY) ?? "null")
        )
      )
    } catch {
      /* Storage is optional. */
    }
  }, [])
  const moveNavigation = (id: NavigationId, delta: number) => {
    setOrder((previous) => {
      const index = previous.indexOf(id)
      const target = index + delta
      if (index < 0 || target < 0 || target >= previous.length) return previous
      const next = [...previous]
      next.splice(index, 1)
      next.splice(target, 0, id)
      try {
        localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(next))
      } catch {
        /* Storage is optional. */
      }
      return next
    })
  }
  const [groupMode, setGroupMode] = usePersistedNavigation(
    "workspace:conversation-grouping",
    "recent",
    GROUP_MODES
  )
  const [view, setView] = usePersistedNavigation(
    "workspace:sidebar-view",
    "home",
    SIDEBAR_VIEWS
  )
  // Restore the date filter without overwriting it on mount.
  const [filter, setFilter] = useState<ConversationDateFilter>(loadDateFilter)
  useEffect(() => {
    try {
      localStorage.setItem(DATE_FILTER_STORAGE_KEY, JSON.stringify(filter))
    } catch {
      /* Storage is optional. */
    }
  }, [filter])
  const [today, setToday] = useState(() => localDateKey(new Date()))

  useEffect(() => {
    const refresh = () => setToday(localDateKey(new Date()))
    const timer = setInterval(refresh, 30_000)
    window.addEventListener("focus", refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener("focus", refresh)
    }
  }, [])

  const { start: date, end: endDate } = resolveDateFilter(filter, today)
  const startTime = filter.preset === "custom" ? filter.startTime : START_OF_DAY
  const endTime = filter.preset === "custom" ? filter.endTime : END_OF_DAY
  const range = filter.preset === "custom" ? filter.range : date !== endDate
  const setPreset = (preset: DatePreset | "custom") => {
    if (preset === "custom") {
      if (filter.preset === "custom") return
      const [year, month] = today.split("-").map(Number)
      setFilter({
        preset: "custom",
        start: localDateKey(new Date(year, month - 1, 1)),
        end: localDateKey(new Date(year, month, 0)),
        startTime: START_OF_DAY,
        endTime: END_OF_DAY,
        range: true,
      })
      return
    }
    setFilter({ preset })
  }
  function updateEndpoint(side: "start" | "end", day: string, time: string) {
    const start = side === "start" || day < date ? day : date
    const end = side === "end" || day > endDate ? day : endDate
    let nextStartTime =
      side === "start" ? minuteBoundary(time, side) : startTime
    let nextEndTime = side === "end" ? minuteBoundary(time, side) : endTime
    if (start === end && nextStartTime > nextEndTime) {
      if (side === "start") nextEndTime = minuteBoundary(nextStartTime, "end")
      else nextStartTime = minuteBoundary(nextEndTime, "start")
    }
    setFilter({
      preset: "custom",
      start,
      end,
      startTime: nextStartTime,
      endTime: nextEndTime,
      range: true,
    })
  }
  const setDate = (value: string | null) => {
    if (value === null) setPreset("today")
    else updateEndpoint("start", value, startTime)
  }
  const setEndDate = (value: string) => updateEndpoint("end", value, endTime)
  const setStartTime = (value: string) => updateEndpoint("start", date, value)
  const setEndTime = (value: string) => updateEndpoint("end", endDate, value)
  const setRange = (value: boolean) =>
    setFilter({
      preset: "custom",
      start: date,
      end: endDate,
      startTime,
      endTime:
        !value && startTime > endTime
          ? minuteBoundary(startTime, "end")
          : endTime,
      range: value,
    })

  return (
    <SidebarNavigationContext.Provider
      value={{
        order,
        moveNavigation,
        groupByFolder: groupMode === "folder",
        toggleFolderGrouping: () =>
          setGroupMode((mode) => (mode === "folder" ? "recent" : "folder")),
        view,
        setView,
        date,
        setDate,
        endDate,
        startTime,
        endTime,
        setStartTime,
        setEndTime,
        setEndDate,
        range,
        setRange,
        today,
        preset: filter.preset,
        setPreset,
      }}
    >
      {children}
    </SidebarNavigationContext.Provider>
  )
}

// Standalone/mobile sidebars retain the complete home view.
export function useSidebarNavigation() {
  return useContext(SidebarNavigationContext)
}
