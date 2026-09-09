"use client"

import { StatusBarStats } from "./status-bar-stats"
import { StatusBarAlerts } from "./status-bar-alerts"
import { StatusBarUpdate } from "./status-bar-update"

/** Keep workspace utilities reachable independently of the scrolling history. */
export function SidebarFooter() {
  return (
    <div
      data-sidebar-footer=""
      className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-sidebar-border/60 bg-sidebar px-2 py-2 text-xs text-muted-foreground"
    >
      <div className="flex min-w-0 items-center gap-2">
        <StatusBarStats />
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <StatusBarUpdate />
        <StatusBarAlerts />
      </div>
    </div>
  )
}
