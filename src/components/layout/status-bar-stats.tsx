"use client"

import { ChartNoAxesColumn } from "lucide-react"
import { useTranslations } from "next-intl"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { cn } from "@/lib/utils"

/**
 * The workspace-stats cluster at the left end of the status bar.
 *
 * The conversation count doubles as the entry point to the Token Usage
 * dashboard — clicking it swaps the workbench route instead of opening a
 * popover, so the number is a door, not a dead end. The per-agent breakdown
 * the old popover held lives on that page in far richer form.
 *
 * Both hover hints are native `title` attributes, not Radix tooltips: this is a
 * two-element status-bar cluster whose hints are one short line each, so the
 * floating-layer machinery bought nothing. Keeping both on the same mechanism
 * also avoids two different hover delays side by side.
 */
export function StatusBarStats() {
  const t = useTranslations("Folder.statusBar.stats")
  const stats = useAppWorkspaceStore((s) => s.stats)
  const { routeId, setRoute } = useWorkbenchRoute()

  if (!stats) return null

  return (
    <div className="flex items-center gap-3">
      {stats && (
        <button
          type="button"
          onClick={() => setRoute("tokenUsage")}
          title={t("openUsage")}
          className={cn(
            "flex items-center gap-1.5 transition-colors hover:text-foreground",
            routeId === "tokenUsage" && "text-foreground"
          )}
        >
          <ChartNoAxesColumn className="h-3 w-3" />
          <span>
            {t("conversations", { count: stats.total_conversations })}
          </span>
        </button>
      )}
    </div>
  )
}
