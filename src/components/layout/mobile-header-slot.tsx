"use client"

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"

const MobileHeaderContext = createContext<{
  target: HTMLDivElement | null
  setTarget: (target: HTMLDivElement | null) => void
} | null>(null)

export function MobileHeaderProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  const value = useMemo(() => ({ target, setTarget }), [target])
  return (
    <MobileHeaderContext.Provider value={value}>
      {children}
    </MobileHeaderContext.Provider>
  )
}

export function MobileHeaderTarget({ hidden }: { hidden: boolean }) {
  const header = useContext(MobileHeaderContext)
  return (
    <div
      ref={header?.setTarget}
      data-mobile-workspace-title=""
      className="min-w-0 flex-1"
      hidden={hidden}
    />
  )
}

/** Keep the active conversation's title and actions in the mobile nav row. */
export function MobileHeaderSlot({ children }: { children: ReactNode }) {
  const header = useContext(MobileHeaderContext)
  if (!header) return children
  return header.target ? createPortal(children, header.target) : null
}
