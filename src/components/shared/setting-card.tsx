"use client"

import type { LucideIcon } from "lucide-react"

import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

/**
 * Bordered surface that groups related settings rows. Rows stacked inside one
 * card get a hairline between them, which is what makes options that belong
 * together (merge strategy + what happens to the worktree afterwards) read as
 * one decision instead of two unrelated lines.
 *
 * `bg-muted/40` rather than `bg-card`: in the light theme `--card` is the same
 * white as `--background`, so a card would only be an outline; muted gives a
 * faint fill in light mode and a slight lift over the dialog in dark mode.
 *
 * Lives in `shared/` because it is the house style for a settings surface, not
 * a task-board component: the task settings dialog was simply the first to use
 * it, and the custom-agent panel in Settings now shares it.
 */
export function SettingCard({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-setting-card=""
      className={cn(
        "divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-muted/40",
        className
      )}
      {...props}
    />
  )
}

/**
 * An explanatory block on the same surface as the cards around it — for the
 * context a row's own description can't carry (what a whole tab is for, how
 * the values there are used). Kept card-shaped so a tab never drops back to
 * bare paragraphs floating between cards.
 */
export function SettingNote({
  icon: Icon,
  children,
  className,
}: {
  icon?: LucideIcon
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex gap-2.5 rounded-xl border border-border/70 bg-muted/40 p-3",
        className
      )}
    >
      {/* The wrapper is one text line tall (`leading-5`), so the glyph centers
          on the first line whatever its own size — a margin nudge would drift
          the moment either the icon or the type scale changes. */}
      {Icon ? (
        <span className="flex h-5 shrink-0 items-center">
          <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        </span>
      ) : null}
      <p className="text-xs leading-5 text-muted-foreground">{children}</p>
    </div>
  )
}

interface SettingRowProps {
  /** Small glyph in front of the title; purely decorative. */
  icon?: LucideIcon
  title: React.ReactNode
  /** One line explaining the setting, under the title. */
  description?: React.ReactNode
  /** Ties the title to the control it labels (`Switch`, `Input`, …). */
  htmlFor?: string
  /** Compact control pinned to the right of the title — switch, select, stepper. */
  control?: React.ReactNode
  /** Full-width control (input, textarea, agent picker) placed under the text. */
  children?: React.ReactNode
  className?: string
}

/**
 * One setting inside a {@link SettingCard}: label and explanation on the left,
 * a compact control on the right, and optionally a full-width control below.
 * Every option in the task settings dialog is rendered through this so the
 * rhythm (type sizes, paddings, where the control sits) can't drift row to row.
 */
export function SettingRow({
  icon: Icon,
  title,
  description,
  htmlFor,
  control,
  children,
  className,
}: SettingRowProps) {
  return (
    <div
      data-setting-row=""
      className={cn("flex flex-col gap-2 p-3", className)}
    >
      {/* With an explanation under the title the control aligns to the title
          line; without one there is only that line, so the two center on each
          other instead of hanging off a taller control's top edge. */}
      <div
        className={cn(
          "flex justify-between gap-3",
          description ? "items-start" : "items-center"
        )}
      >
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={htmlFor} className="gap-1.5 text-sm">
            {Icon ? (
              <Icon
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            ) : null}
            {title}
          </Label>
          {description ? (
            <span className="text-xs leading-5 text-muted-foreground">
              {description}
            </span>
          ) : null}
        </div>
        {control ? <div className="shrink-0">{control}</div> : null}
      </div>
      {children}
    </div>
  )
}
