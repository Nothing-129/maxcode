import { foldReferenceLinks } from "@/lib/reference-link"

/**
 * A conversation's auto-title is parsed from the first user message, which since
 * the inline-file-badge work can carry Markdown reference links — a `@`-file
 * mention, a session/commit/agent reference — serialized as `[label](uri)` (see
 * `referenceToMarkdown`). Shown verbatim, a tab or the sidebar reads as raw
 * `[README.md](file:///…)` noise. {@link formatConversationTitle} folds each
 * such link back to just its bracket label (the human-readable badge text),
 * normalizing legacy date/type/topic titles to date/topic. Rename dialogs use
 * the same text; stored titles change only when saved.
 *
 * The folding itself (a single-pass O(n) scan, ReDoS-safe) lives in the shared
 * {@link foldReferenceLinks} so the title, the transcript extractor and every
 * other reference-link consumer parse `[label](uri)` exactly one way.
 */
export function formatConversationTitle(
  title: string | null | undefined
): string {
  const folded = foldReferenceLinks(title)
  const structured = parseStructuredConversationTitle(folded)
  return structured ? `${structured.date}｜${structured.topic}` : folded
}

/** Accept date/topic titles and legacy date/type/topic titles. */
export function parseStructuredConversationTitle(title: string): {
  date: string
  kind: string
  topic: string
} | null {
  const parts = title.split(/[｜丨|]/).map((part) => part.trim())
  if (parts.length !== 2 && parts.length !== 3) return null
  const date = parts[0]!
  const kind = parts.length === 3 ? parts[1]! : ""
  const topic = parts[parts.length - 1]!
  if (!/^\d{4}$/.test(date) || !topic) return null
  if (parts.length === 3 && !kind) return null
  return { date, kind, topic }
}
