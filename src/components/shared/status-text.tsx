"use client"

import { useState, type ReactNode } from "react"

export function StatusText({
  value,
  children,
}: {
  value: string
  children: ReactNode
}) {
  const [seen, setSeen] = useState({ value, revision: 0 })
  if (seen.value !== value) setSeen({ value, revision: seen.revision + 1 })
  return (
    <span
      key={seen.revision}
      className={seen.revision ? "maxcode-status-text" : undefined}
    >
      {children}
    </span>
  )
}
