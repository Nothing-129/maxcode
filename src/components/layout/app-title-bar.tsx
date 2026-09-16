"use client"

import type { ReactNode } from "react"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

interface AppTitleBarProps {
  left?: ReactNode
  center?: ReactNode
  right?: ReactNode
  className?: string
  rowClassName?: string
}

export function AppTitleBar({
  left,
  center,
  right,
  className,
  rowClassName,
}: AppTitleBarProps) {
  const isMobile = useIsMobile()
  return (
    <div
      className={cn(
        "relative shrink-0 border-b bg-muted/70 select-none",
        isMobile ? "h-11" : "h-8",
        className
      )}
    >
      <div data-drag-region className="absolute inset-0" />

      <div
        data-drag-region
        className={cn(
          "relative z-10 flex h-full items-center",
          "px-3",
          rowClassName
        )}
      >
        <div className="min-w-0 flex-1">{left}</div>
        {right ? <div className="ml-auto shrink-0">{right}</div> : null}
      </div>

      {center ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div>{center}</div>
        </div>
      ) : null}
    </div>
  )
}
