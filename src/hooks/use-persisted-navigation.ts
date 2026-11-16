"use client"

import { useCallback, useEffect, useState, type SetStateAction } from "react"

/** Restore after hydration; save selections without waiting for page unload. */
export function usePersistedNavigation<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[]
) {
  const [value, setValue] = useState<T>(fallback)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key)
      if (saved && allowed.includes(saved as T)) {
        // Browser storage is unavailable during static export. This one-time
        // hydration keeps the server and first client render identical.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setValue(saved as T)
      }
    } catch {
      /* Storage is optional. */
    }
  }, [key, allowed])
  const select = useCallback(
    (next: SetStateAction<T>) => {
      setValue((previous) => {
        const selected = typeof next === "function" ? next(previous) : next
        try {
          localStorage.setItem(key, selected)
        } catch {
          /* Storage is optional. */
        }
        return selected
      })
    },
    [key]
  )
  return [value, select] as const
}
