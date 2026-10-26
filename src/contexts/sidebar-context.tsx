"use client"

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

// Touch navigation closes the sidebar even on landscape phones / desktop-site
// mode. These temporary drawer actions must never change the saved PC layout.
function isTouchSidebarLayout() {
  return (
    window.innerWidth < 768 || window.matchMedia("(pointer: coarse)").matches
  )
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
      if (!isTouchSidebarLayout()) persistPanel({ isOpen: !prev })
      return !prev
    })
  }, [persistPanel])
  const close = useCallback(() => {
    setIsOpen(false)
    if (!isTouchSidebarLayout()) persistPanel({ isOpen: false })
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
    let lastLocal: boolean | undefined
    const restore = () => {
      const stored = loadPersistedPanelState(storageKey)
      const local = isTouchSidebarLayout()
      const savedOpen = stored?.isOpen ?? DEFAULT_IS_OPEN
      if (
        initial ||
        lastLocal !== local ||
        (!local && lastOpen !== savedOpen)
      ) {
        setIsOpen(local ? false : savedOpen)
      }
      lastOpen = savedOpen
      lastLocal = local
      initial = false
      setWidthState(clampWidth(stored?.width ?? DEFAULT_WIDTH))
      setRestored(true)
    }
    restore()
    const pointer = window.matchMedia("(pointer: coarse)")
    const onLayoutChange = () => {
      if (!initial) restore()
    }
    window.addEventListener("resize", onLayoutChange)
    pointer.addEventListener("change", onLayoutChange)
    return () => {
      window.removeEventListener("resize", onLayoutChange)
      pointer.removeEventListener("change", onLayoutChange)
    }
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
