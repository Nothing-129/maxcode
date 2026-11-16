"use client"

import { Plus } from "lucide-react"
import { useTranslations } from "next-intl"
import {
  AUTOMATION_TEMPLATES,
  type AutomationTemplate,
} from "./automation-templates"
import { ScheduleLabel } from "./schedule-label"
import { cn } from "@/lib/utils"

/**
 * Card-grid picker shown on the empty state and when starting a new automation.
 * The first card starts a blank automation; the rest seed the editor from a
 * template. `onPick(null)` = blank, `onPick(template)` = that template.
 */
export function TemplateGallery({
  onPick,
}: {
  onPick: (template: AutomationTemplate | null) => void
}) {
  const t = useTranslations("Automations")

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
      <button
        type="button"
        onClick={() => onPick(null)}
        className={cn(
          // ws-msg-card keeps the card legible over a workspace background
          // image (translucent tint; inert without one), matching the Tasks
          // board cards and the automation detail's stat cards; ws-chrome-border
          // lifts the outline so the edge survives over the image.
          "group flex flex-col items-start gap-2 rounded-xl border border-dashed border-border ws-chrome-border bg-card/40 ws-msg-card p-4 text-left transition-colors",
          "hover:border-primary/40 hover:bg-interaction-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        <span className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Plus className="size-5" aria-hidden="true" />
        </span>
        <span className="text-sm font-medium">{t("blankTitle")}</span>
        <span className="text-xs text-muted-foreground">{t("blankDesc")}</span>
      </button>

      {AUTOMATION_TEMPLATES.map((tpl) => {
        const Icon = tpl.icon
        return (
          <button
            key={tpl.id}
            type="button"
            onClick={() => onPick(tpl)}
            className={cn(
              "group flex flex-col items-start gap-2 rounded-xl border border-border ws-chrome-border bg-card ws-msg-card p-4 text-left transition-colors",
              "hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          >
            <span
              className={cn(
                "flex size-9 items-center justify-center rounded-md",
                tpl.accent
              )}
            >
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <span className="text-sm font-medium">{t(tpl.titleKey)}</span>
            <span className="line-clamp-2 text-xs text-muted-foreground">
              {t(tpl.descKey)}
            </span>
            <span className="mt-auto inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
              {tpl.trigger_kind === "schedule" ? (
                <ScheduleLabel cron={tpl.cron} />
              ) : (
                t("manual")
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
