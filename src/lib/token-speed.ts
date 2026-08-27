/**
 * Pure helpers behind the live token-output-speed reading. The estimate and
 * cumulative-rate calculation intentionally mirror pi-web's implementation.
 *
 * CJK-family code points count as one token; every four other code points count
 * as one token. "Other" includes whitespace. This is still only a fallback
 * estimate: provider-reported live output usage is preferable when available.
 */

const CJK_CHARS_PER_TOKEN = 1
const OTHER_CHARS_PER_TOKEN = 4

/** The same ranges as pi-web's `CJK_PATTERN`. */
function isCjk(codePoint: number): boolean {
  return (
    (codePoint >= 0x3000 && codePoint <= 0x30ff) ||
    (codePoint >= 0x3400 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0x20000 && codePoint <= 0x2fa1f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af)
  )
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff
}

export interface CharCounts {
  dense: number
  other: number
}

/**
 * Count Unicode code points from the UTF-16 offset `from`, bucketed by
 * pi-web's CJK heuristic. A low surrogate at `from` is skipped; the running
 * accumulator backs up over that boundary before measuring an appended suffix.
 */
export function countChars(text: string, from = 0): CharCounts {
  let dense = 0
  let other = 0
  for (let i = from; i < text.length; i++) {
    const codeUnit = text.charCodeAt(i)
    if (isLowSurrogate(codeUnit)) continue
    const codePoint = text.codePointAt(i) ?? codeUnit
    if (codePoint > 0xffff) i++
    if (isCjk(codePoint)) dense++
    else other++
  }
  return { dense, other }
}

/** Pi-web-compatible rough token count for `text`, from `from` onward. */
export function estimateTokens(text: string, from = 0): number {
  const { dense, other } = countChars(text, from)
  return dense / CJK_CHARS_PER_TOKEN + other / OTHER_CHARS_PER_TOKEN
}

/**
 * Running token total across append-mostly blocks. Each block retains its last
 * text and token count so unchanged samples are O(1), appended suffixes alone
 * are scanned, and snapshot/tool-call replacements are remeasured correctly.
 */
export class TokenCountAccumulator {
  private slots: { text: string; tokens: number }[] = []
  private cursor = 0
  private totalTokens = 0

  reset(): void {
    this.slots = []
    this.cursor = 0
    this.totalTokens = 0
  }

  beginPass(): void {
    this.cursor = 0
  }

  push(text: string): void {
    const slot = this.slots[this.cursor++]
    if (slot === undefined) {
      const tokens = estimateTokens(text)
      this.slots.push({ text, tokens })
      this.totalTokens += tokens
      return
    }
    if (text === slot.text) return

    let tokens: number
    if (text.startsWith(slot.text)) {
      let suffixStart = slot.text.length
      tokens = slot.tokens
      // A streamed append can complete a surrogate pair. The isolated high
      // surrogate was previously one "other" code point; replace that estimate
      // with the completed code point's classification.
      if (
        suffixStart > 0 &&
        suffixStart < text.length &&
        isHighSurrogate(slot.text.charCodeAt(suffixStart - 1)) &&
        isLowSurrogate(text.charCodeAt(suffixStart))
      ) {
        tokens -= 1 / OTHER_CHARS_PER_TOKEN
        suffixStart--
      }
      tokens += estimateTokens(text, suffixStart)
    } else {
      // Hydration and completed tool-call normalization can replace rather than
      // append to a block, including with a same-length value.
      tokens = estimateTokens(text)
    }

    this.totalTokens += tokens - slot.tokens
    slot.text = text
    slot.tokens = tokens
  }

  endPass(): number {
    for (let i = this.cursor; i < this.slots.length; i++) {
      this.totalTokens -= this.slots[i].tokens
    }
    if (this.cursor < this.slots.length) this.slots.length = this.cursor
    return this.total
  }

  get total(): number {
    return this.totalTokens
  }
}

/**
 * Pi-web-style cumulative output rate. The clock starts when a sample first
 * observes non-zero output, so time-to-first-token is excluded. Tokens already
 * present in that first sample remain in the numerator, matching pi-web.
 */
export class TokenSpeedTracker {
  private static readonly WARMUP_MS = 500
  private startTime: number | null = null

  reset(): void {
    this.startTime = null
  }

  observe(totalTokens: number, nowMs: number): number | null {
    if (totalTokens <= 0) return null
    if (this.startTime == null) {
      this.startTime = nowMs
      return null
    }
    const elapsed = nowMs - this.startTime
    if (elapsed <= TokenSpeedTracker.WARMUP_MS) return null
    return totalTokens / (elapsed / 1000)
  }
}
