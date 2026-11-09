"use client"

import { createContext, useContext, useEffect, useState } from "react"
import {
  localDateKey,
  loadDateFilter,
  resolveDateFilter,
  DATE_FILTER_STORAGE_KEY,
  type ConversationDateFilter,
  type DatePreset,
  type SidebarView,
} from "@/lib/sidebar-navigation"

const SidebarNavigationContext = createContext<{
  view: SidebarView
  setView: (view: SidebarView) => void
  date: string
  setDate: (date: string | null) => void
  endDate: string
  setEndDate: (date: string) => void
  range: boolean
  setRange: (range: boolean) => void
  preset: ConversationDateFilter["preset"]
  setPreset: (preset: DatePreset) => void
  today: string
} | null>(null)

export function SidebarNavigationProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [view, setView] = useState<SidebarView>("home")
  // The initial Home view does not render date controls. Restore before the
  // user opens Conversations, without overwriting a saved filter on mount.
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
  const range = filter.preset === "custom" ? filter.range : date !== endDate
  const setPreset = (preset: DatePreset) => setFilter({ preset })
  const setDate = (value: string | null) => {
    if (value === null) {
      setPreset("today")
      return
    }
    setFilter({
      preset: "custom",
      start: value,
      end: range && endDate > value ? endDate : value,
      range,
    })
  }
  const setEndDate = (value: string) =>
    setFilter({
      preset: "custom",
      start: value < date ? value : date,
      end: value,
      range: true,
    })
  const setRange = (value: boolean) =>
    setFilter({ preset: "custom", start: date, end: endDate, range: value })

  return (
    <SidebarNavigationContext.Provider
      value={{
        view,
        setView,
        date,
        setDate,
        endDate,
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
