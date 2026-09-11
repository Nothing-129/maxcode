import {
  Bot,
  Command,
  FileText,
  Folder,
  GitCommit,
  Hash,
  MessageSquare,
} from "lucide-react"
import type { ReactNode } from "react"

import { AgentIcon } from "@/components/agent-icon"
import { type AgentType } from "@/lib/types"
import { cn } from "@/lib/utils"

import { FileTypeIcon } from "./file-type-icon"

import type { ReferenceAttrs } from "../types"

const ICON_CLASS = "size-3.5 shrink-0"

export function ReferenceIcon({
  data,
  variant = "badge",
}: {
  data: ReferenceAttrs
  /**
   * Where the icon is shown. `"badge"` (default) is the inline reference chip in
   * the composer and the message transcript; `"option"` is a row in the `@`
   * panel. They differ only for sessions (see the `session` case).
   */
  variant?: "badge" | "option"
}) {
  const meta = data.meta
  let icon: ReactNode = null
  switch (data.refType) {
    case "file":
      icon =
        meta?.fileKind === "dir" ? (
          <Folder className={ICON_CLASS} />
        ) : (
          <FileText className={ICON_CLASS} />
        )
      break
    case "agent": {
      const agentType = meta?.agentType ?? (data.id as AgentType)
      icon = agentType ? (
        <AgentIcon agentType={agentType} className={ICON_CLASS} />
      ) : (
        <Bot className={ICON_CLASS} />
      )
      break
    }
    case "session":
      // The inline badge (composer + transcript) shows a neutral conversation
      // glyph: a session reference reads as "a conversation", not as the agent
      // that owns it, and it carries no live status. The `@`-panel option row
      // (`variant="option"`) instead shows the owning agent's icon so sessions
      // stay distinguishable while picking one (falling back to `Hash` for a
      // legacy id with no recoverable agent type).
      icon =
        variant === "option" ? (
          meta?.agentType ? (
            <AgentIcon agentType={meta.agentType} className={ICON_CLASS} />
          ) : (
            <Hash className={ICON_CLASS} />
          )
        ) : (
          <MessageSquare className={ICON_CLASS} />
        )
      break
    case "commit":
      icon = <GitCommit className={ICON_CLASS} />
      break
    case "skill":
      // Commands, skills and experts all use the command glyph — they aren't
      // visually distinguished (the `meta.scope` distinction is kept only for
      // the editor's expert-replace logic, not the icon).
      icon = <Command className={ICON_CLASS} />
      break
    default:
      return null
  }
  // Decorative wherever it appears (popup option, badge): the accessible name
  // comes from the adjacent label (or the badge's own role="img" name), so hide
  // it — otherwise AgentIcon's titled <svg> leaks into the option name (e.g.
  // "Codex Codex Helper").
  return (
    <span aria-hidden="true" className="inline-flex shrink-0">
      {icon}
    </span>
  )
}

/**
 * Per-kind text color (light + dark) — no background or border, so the badge
 * reads as a colored inline token that sits cleanly on the user-message bubble
 * (`bg-secondary`). `text-*` colors the label and, since the icon strokes with
 * `currentColor`, the icon too. Commands/skills/experts share one color (they
 * aren't distinguished). Light shades are `-700` so they clear WCAG AA contrast
 * on the near-white bubble; dark shades are `-400` for the near-black one.
 */
function badgeColorClass(data: ReferenceAttrs): string {
  switch (data.refType) {
    case "file":
      return "text-blue-700 dark:text-blue-400"
    case "agent":
      return "text-violet-700 dark:text-violet-400"
    case "session":
      return "text-emerald-700 dark:text-emerald-400"
    case "commit":
      return "text-amber-700 dark:text-amber-400"
    case "skill":
      return "text-rose-700 dark:text-rose-400"
  }
}

export interface ReferenceBadgeProps {
  appearance?: "badge" | "file-link"
  data: ReferenceAttrs
  className?: string
}

/**
 * Presentational inline chip for a reference. Shared by the editor node view and
 * the message-transcript rendering (markdown-link → here). Purely visual — no
 * editor coupling.
 */
export function ReferenceBadge({
  data,
  className,
  appearance = "badge",
}: ReferenceBadgeProps) {
  const isFileLink = appearance === "file-link" && data.refType === "file"
  return (
    <span
      data-reference-badge=""
      data-ref-type={data.refType}
      title={data.uri ?? data.label}
      // The badge is an inline contentEditable=false atom. `role="img"` makes it
      // a single named unit so `aria-label` is a reliable accessible name (a
      // bare span's aria-label is not), and collapses the decorative icon —
      // including AgentIcon's titled <svg> — into that one name.
      role="img"
      aria-label={`${data.refType}: ${data.label || data.id}`}
      className={cn(
        "inline-flex align-middle",
        isFileLink
          ? "min-w-0 max-w-full items-start gap-1.5 text-left text-[1em] font-[inherit] leading-[inherit] text-[#2456a6] dark:text-blue-400"
          : cn(
              "max-w-[18rem] items-center gap-0.5 leading-snug text-[0.85em] font-medium",
              badgeColorClass(data)
            ),
        className
      )}
    >
      {isFileLink ? (
        <FileTypeIcon
          path={data.id}
          isDirectory={data.meta?.fileKind === "dir"}
        />
      ) : (
        <ReferenceIcon data={data} />
      )}
      <span
        className={
          isFileLink
            ? "min-w-0 whitespace-normal [overflow-wrap:anywhere]"
            : "truncate"
        }
      >
        {data.label || data.id}
      </span>
    </span>
  )
}
