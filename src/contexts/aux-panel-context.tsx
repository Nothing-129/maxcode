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
import { useActiveFolder } from "@/contexts/active-folder-context"

export type AuxPanelTab =
  | "session_details"
  | "file_tree"
  | "changes"
  | "git_log"

const STORAGE_KEY = "workspace:right-sidebar"

const DEFAULT_WIDTH = 320
const MIN_WIDTH = 200
const MAX_WIDTH = 900
const DEFAULT_IS_OPEN = false

interface AuxPanelContextValue {
  isOpen: boolean
  restored: boolean
  width: number
  minWidth: number
  maxWidth: number
  activeTab: AuxPanelTab
  toggle: () => void
  /** Imperatively set the panel open/closed (used by the chat-mode auto-hide). */
  setOpen: (open: boolean) => void
  setWidth: (w: number) => void
  setActiveTab: (tab: AuxPanelTab) => void
  openTab: (tab: AuxPanelTab) => void
  pendingRevealPath: string | null
  revealInFileTree: (path: string) => void
  consumePendingRevealPath: () => void
}

const AuxPanelContext = createContext<AuxPanelContextValue | null>(null)

export function useAuxPanelContext() {
  const ctx = useContext(AuxPanelContext)
  if (!ctx) {
    throw new Error("useAuxPanelContext must be used within AuxPanelProvider")
  }
  return ctx
}

function clampWidth(width: number, minWidth: number) {
  return Math.max(minWidth, Math.min(MAX_WIDTH, width))
}

interface AuxPanelProviderProps {
  children: ReactNode
}

export function AuxPanelProvider({ children }: AuxPanelProviderProps) {
  const storageKey = STORAGE_KEY
  const { activeFolderId } = useActiveFolder()
  const [isOpen, setIsOpen] = useState(DEFAULT_IS_OPEN)
  const [width, setWidthState] = useState(DEFAULT_WIDTH)
  const [restored, setRestored] = useState(false)
  const [activeTab, setActiveTab] = useState<AuxPanelTab>("session_details")
  const [pendingRevealPath, setPendingRevealPath] = useState<string | null>(
    null
  )
  const minWidth = MIN_WIDTH

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

  const setOpen = useCallback(
    (open: boolean) => {
      setIsOpen(open)
      persistPanel({ isOpen: open })
    },
    [persistPanel]
  )

  const setWidth = useCallback(
    (w: number) => {
      setWidthState(clampWidth(w, minWidth))
      persistPanel({ width: clampWidth(w, minWidth) })
    },
    [minWidth, persistPanel]
  )

  const openTab = useCallback(
    (tab: AuxPanelTab) => {
      setActiveTab(tab)
      setIsOpen(true)
      persistPanel({ isOpen: true })
    },
    [persistPanel]
  )

  const revealInFileTree = useCallback(
    (path: string) => {
      setPendingRevealPath(path)
      setActiveTab("file_tree")
      setIsOpen(true)
      persistPanel({ isOpen: true })
    },
    [persistPanel]
  )

  const consumePendingRevealPath = useCallback(() => {
    setPendingRevealPath(null)
  }, [])

  useEffect(() => {
    const stored = loadPersistedPanelState(storageKey)
    const isMobileViewport = window.innerWidth < 768
    // Panel geometry and automatic visibility changes belong to this client.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsOpen(isMobileViewport ? false : (stored?.isOpen ?? DEFAULT_IS_OPEN))
    setWidthState(clampWidth(stored?.width ?? DEFAULT_WIDTH, minWidth))
    setRestored(true)
  }, [storageKey, minWidth])

  // Reset pending reveal path when the active folder changes; file tree
  // state is content-driven by the workspace contexts and will refetch
  // naturally via its folder-path dependency.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPendingRevealPath(null)
  }, [activeFolderId])

  const value = useMemo(
    () => ({
      isOpen,
      restored,
      width,
      minWidth,
      maxWidth: MAX_WIDTH,
      activeTab,
      toggle,
      setOpen,
      setWidth,
      setActiveTab,
      openTab,
      pendingRevealPath,
      revealInFileTree,
      consumePendingRevealPath,
    }),
    [
      isOpen,
      restored,
      width,
      minWidth,
      activeTab,
      toggle,
      setOpen,
      setWidth,
      openTab,
      pendingRevealPath,
      revealInFileTree,
      consumePendingRevealPath,
    ]
  )

  return (
    <AuxPanelContext.Provider value={value}>
      {children}
    </AuxPanelContext.Provider>
  )
}
