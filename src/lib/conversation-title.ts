import { foldReferenceLinks } from "@/lib/reference-link"

/**
 * A conversation's auto-title is parsed from the first user message, which since
 * the inline-file-badge work can carry Markdown reference links — a `@`-file
 * mention, a session/commit/agent reference — serialized as `[label](uri)` (see
 * `referenceToMarkdown`). Shown verbatim, a tab or the sidebar reads as raw
 * `[README.md](file:///…)` noise. {@link formatConversationTitle} folds each
 * such link back to just its bracket label (the human-readable badge text),
 * leaving all other title text untouched, so titles display the way the message
 * does. Display-only — the stored title (rename, search, export) is unchanged.
 *
 * The folding itself (a single-pass O(n) scan, ReDoS-safe) lives in the shared
 * {@link foldReferenceLinks} so the title, the transcript extractor and every
 * other reference-link consumer parse `[label](uri)` exactly one way.
 */
export function formatConversationTitle(
  title: string | null | undefined
): string {
  return foldReferenceLinks(title)
}

const STRUCTURED_TITLE_PIPES = new Set(["｜", "丨", "|"])

/**
 * Split a display title into `MMDD｜类型｜主题` columns when it matches that
 * stored auto-title shape. Pipes only — a slash in the topic (`CI/CD`) must
 * stay in the topic, and a renamed `2024/01/01` title must not be treated as
 * structured. Display-only; the stored title is unchanged.
 */
export function parseStructuredConversationTitle(title: string): {
  date: string
  kind: string
  topic: string
} | null {
  const parts: string[] = []
  let start = 0
  for (let i = 0; i < title.length; i++) {
    if (!STRUCTURED_TITLE_PIPES.has(title[i]!)) continue
    parts.push(title.slice(start, i))
    start = i + 1
    if (parts.length === 2) {
      parts.push(title.slice(start))
      break
    }
  }
  if (parts.length !== 3) return null
  const date = parts[0]!.trim()
  const kind = parts[1]!.trim()
  const topic = parts[2]!.trim()
  if (!/^\d{4}$/.test(date) || !kind || !topic) return null
  if (/[｜丨|]/.test(topic)) return null
  return { date, kind, topic }
}
