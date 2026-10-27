"use client"

import type { ReactNode } from "react"

/** The empty tray stays mounted so the final thumbnail can finish its exit. */
export function AttachmentTray({
  present,
  children,
  className,
}: {
  present: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <div
      data-attachment-tray=""
      data-open={present}
      className="maxcode-attachment-tray shrink-0"
      inert={!present}
      aria-hidden={!present}
    >
      <div className="min-h-0 overflow-hidden">
        <div className={className}>{children}</div>
      </div>
    </div>
  )
}
