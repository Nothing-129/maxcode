"use client"

import { subscribeWorkspacePreferences } from "@/lib/workspace-preferences-store"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import {
  loadPersistedPanelState,
  savePersistedPanelState,
} from "@/lib/panel-state-storage"

const STORAGE_KEY = "workspace:left-sidebar"

const DEFAULT_WIDTH = 268
// Compact desktop rail; saved user widths remain respected.
const MIN_WIDTH = 240
const MAX_WIDTH = 900
const DEFAULT_IS_OPEN = true

interface SidebarContextValue {
  isOpen: boolean
  restored: boolean
  width: number
  minWidth: number
  maxWidth: number
  toggle: () => void
  // Idempotent close — the right primitive when several layers may react to the
  // same navigation (a handler collapsing for touch plus the entry point that
  // started it), where a second `toggle()` would flip the sidebar back open.
  close: () => void
  setWidth: (w: number) => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

export function useSidebarContext() {
  const ctx = useContext(SidebarContext)
  if (!ctx) {
    throw new Error("useSidebarContext must be used within SidebarProvider")
  }
  return ctx
}

function clampWidth(width: number) {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width))
}

interface SidebarProviderProps {
  children: ReactNode
}

export function SidebarProvider({ children }: SidebarProviderProps) {
  const storageKey = STORAGE_KEY
  const [isOpen, setIsOpen] = useState(DEFAULT_IS_OPEN)
  const [width, setWidthState] = useState(DEFAULT_WIDTH)
  const [restored, setRestored] = useState(false)

  const persistPanel = useCallback(
    (patch: Partial<{ isOpen: boolean; width: number }>) => {
      const stored = loadPersistedPanelState(storageKey)
      savePersistedPanelState(storageKey, {
        isOpen: stored?.isOpen ?? DEFAULT_IS_OPEN,
        width: stored?.width ?? DEFAULT_WIDTH,
        ...patch,
      })
    },
    [storageKey]
  )

  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      persistPanel({ isOpen: !prev })
      return !prev
    })
  }, [persistPanel])
  const close = useCallback(() => {
    setIsOpen(false)
    persistPanel({ isOpen: false })
  }, [persistPanel])

  const setWidth = useCallback(
    (w: number) => {
      setWidthState(clampWidth(w))
      persistPanel({ width: clampWidth(w) })
    },
    [persistPanel]
  )

  useEffect(() => {
    let initial = true
    let lastOpen: boolean | undefined
    return subscribeWorkspacePreferences(() => {
      const stored = loadPersistedPanelState(storageKey)
      const isMobileViewport = window.innerWidth < 768
      const hostOpen = stored?.isOpen ?? DEFAULT_IS_OPEN
      if (initial || lastOpen !== hostOpen) {
        setIsOpen(initial && isMobileViewport ? false : hostOpen)
      }
      lastOpen = hostOpen
      initial = false
      setWidthState(clampWidth(stored?.width ?? DEFAULT_WIDTH))
      setRestored(true)
    }, [storageKey])
  }, [storageKey])

  const value = useMemo(
    () => ({
      isOpen,
      restored,
      width,
      minWidth: MIN_WIDTH,
      maxWidth: MAX_WIDTH,
      toggle,
      close,
      setWidth,
    }),
    [isOpen, restored, width, toggle, close, setWidth]
  )

  return (
    <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
  )
}
