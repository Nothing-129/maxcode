"use client"

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"

function createActionsStore() {
  let actions: ReactNode = null
  const listeners = new Set<() => void>()
  const update = (value: ReactNode) => {
    actions = value
    listeners.forEach((listener) => listener())
  }
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => actions,
    register: (value: ReactNode) => {
      update(value)
      return () => {
        if (actions === value) update(null)
      }
    },
  }
}

const emptySubscribe = () => () => {}
const emptySnapshot = () => null

const MobileHeaderContext = createContext<{
  target: HTMLDivElement | null
  setTarget: (target: HTMLDivElement | null) => void
  actionsStore: ReturnType<typeof createActionsStore>
} | null>(null)

export function MobileHeaderProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  const [actionsStore] = useState(createActionsStore)
  const value = useMemo(
    () => ({ target, setTarget, actionsStore }),
    [target, actionsStore]
  )
  return (
    <MobileHeaderContext.Provider value={value}>
      {children}
    </MobileHeaderContext.Provider>
  )
}

/** Render these nodes inside the mobile dropdown so Radix uses its menu context. */
export function useMobileHeaderActions() {
  const store = useContext(MobileHeaderContext)?.actionsStore
  return useSyncExternalStore(
    store?.subscribe ?? emptySubscribe,
    store?.getSnapshot ?? emptySnapshot,
    emptySnapshot
  )
}

/** Only the active pane supplies actions; dialogs stay owned by that pane. */
export function MobileHeaderActionsSlot({
  children,
  active,
}: {
  children: ReactNode
  active: boolean
}) {
  const store = useContext(MobileHeaderContext)?.actionsStore
  useEffect(() => {
    if (active && store) return store.register(children)
  }, [active, children, store])
  return null
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
