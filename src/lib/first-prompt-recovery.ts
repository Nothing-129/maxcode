import type { PromptDraft } from "./types"

const prefix = "codeg:first-prompt-recovery:"
const drafts = new Map<string, PromptDraft>()
const listeners = new Set<() => void>()

export function subscribeFirstPromptRecovery(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getFirstPromptRecovery(key: string): PromptDraft | null {
  const cached = drafts.get(key)
  if (cached) return cached
  try {
    const text = localStorage.getItem(prefix + key)
    if (!text) return null
    const draft: PromptDraft = {
      displayText: text,
      blocks: [{ type: "text", text }],
    }
    drafts.set(key, draft)
    return draft
  } catch {
    return null
  }
}

export function recoverFirstPrompt(key: string, draft: PromptDraft) {
  drafts.set(key, draft)
  // Keep full blocks, including attachments, in memory. The text fallback
  // survives a reload without writing attachment bytes to browser storage.
  const text = draft.blocks
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n\n")
  try {
    if (text) localStorage.setItem(prefix + key, text)
  } catch {
    // Storage can be unavailable. The in-memory draft is still recoverable.
  }
  for (const listener of listeners) listener()
}

export function consumeFirstPromptRecovery(key: string, draft: PromptDraft) {
  if (drafts.get(key) !== draft) return
  drafts.delete(key)
  try {
    localStorage.removeItem(prefix + key)
  } catch {
    // The in-memory recovery was consumed.
  }
  for (const listener of listeners) listener()
}
