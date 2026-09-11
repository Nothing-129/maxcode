"use client"

import { createContext, useContext, type ComponentProps } from "react"

// A fragment survives the existing Markdown sanitizer without granting any new
// URL protocol. It is consumed locally and never used for navigation.
export const CODEX_FOLLOWUP_PREFIX = "#codex-followup="

export const CodexFollowupContext = createContext<
  ((prompt: string) => void) | undefined
>(undefined)

export function CodexFollowup({
  prompt,
  children,
  readOnly,
}: {
  prompt: string
  children: ComponentProps<"span">["children"]
  readOnly: boolean
}) {
  const onSelect = useContext(CodexFollowupContext)
  if (readOnly || !onSelect) return <span title={prompt}>{children}</span>
  return (
    <button
      type="button"
      className="my-1 rounded-lg border border-border px-3 py-1.5 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      title={prompt}
      onClick={() => onSelect(prompt)}
    >
      {children}
    </button>
  )
}

export function decodeCodexFollowup(href: string | undefined): string | null {
  if (!href?.startsWith(CODEX_FOLLOWUP_PREFIX)) return null
  try {
    return (
      decodeURIComponent(href.slice(CODEX_FOLLOWUP_PREFIX.length)).trim() ||
      null
    )
  } catch {
    return null
  }
}
