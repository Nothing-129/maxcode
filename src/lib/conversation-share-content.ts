import type { ContentBlock, MessageTurn } from "@/lib/types"

export interface ConversationShareRound {
  number: number
  user: MessageTurn | null
  replies: MessageTurn[]
}

/** A user message starts a round; assistant fragments stay in their original order. */
export function groupConversationShareRounds(turns: MessageTurn[]) {
  const rounds: ConversationShareRound[] = []
  for (const turn of turns) {
    if (turn.role === "system") continue
    if (turn.role === "user" || rounds.length === 0) {
      rounds.push({ number: rounds.length + 1, user: null, replies: [] })
    }
    const round = rounds[rounds.length - 1]
    if (turn.role === "user") round.user = turn
    else round.replies.push(turn)
  }
  return rounds
}

export function shareRoundPreview(round: ConversationShareRound) {
  const turns = round.user ? [round.user] : round.replies
  return turns
    .flatMap((turn) => turn.blocks)
    .filter(
      (block): block is Extract<ContentBlock, { type: "text" }> =>
        block.type === "text"
    )
    .map((block) => splitShareUserText(block.text).text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
}

/** Recognize the copied session-details preface without dropping user-authored text. */
export function splitShareUserText(text: string) {
  const normalized = text.trim().replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n")
  let remaining = normalized
  const context: string[] = []
  // Fold only complete, anchored harness envelopes, never an arbitrary mention
  // of AGENTS.md or an unmatched tag in the user's question.
  for (;;) {
    const envelope = remaining.match(
      /^(?:# AGENTS\.md instructions\b[^<\n]*\s*<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>|<environment_context>[\s\S]*?<\/environment_context>)\s*/i
    )
    if (!envelope) break
    context.push(envelope[0].trim())
    remaining = remaining.slice(envelope[0].length).trim()
  }
  if (context.length) return { text: remaining, metadata: context.join("\n\n") }
  const preface = normalized.match(
    /^会话 ID\s*\n\s*\d+\s*\n\s*模型\s*\n[^\n]+\n\s*Git 分支\s*\n[^\n]+\n\s*扩展 ID\s*\n[0-9a-f-]{36}\s*\n+/i
  )
  if (preface && normalized.slice(preface[0].length).trim()) {
    return {
      metadata: preface[0].trim(),
      text: normalized.slice(preface[0].length).trim(),
    }
  }
  return { text: normalized, metadata: null }
}

/** Legacy snapshots have no message phase. Keep the final reply prominent and
 * retain earlier fragments in an expandable section, without guessing from
 * their length or deleting any text. Explicit work preambles also fold when a
 * snapshot was taken before the final reply arrived. */
export function partitionShareReplies(replies: MessageTurn[]) {
  let lastText = -1
  replies.forEach((turn, index) => {
    if (turn.blocks.some((block) => block.type === "text" && block.text.trim()))
      lastText = index
  })
  const process: ContentBlock[] = []
  const answer: ContentBlock[] = []
  replies.forEach((turn, index) => {
    const text = turn.blocks
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim()
    const preamble =
      /^(?:我(?:先|会|正在|接下来)(?:核对|检查|查看|确认|查|读|把|按|整理|分析|用)|(?:I(?:’|')ll|I will|I'm going to) (?:check|inspect|review|read|look|verify)\b)/i.test(
        text
      )
    for (const block of turn.blocks) {
      if (
        ["tool_use", "tool_result", "thinking", "plan"].includes(block.type) ||
        (block.type === "text" && (index !== lastText || preamble))
      )
        process.push(block)
      else answer.push(block)
    }
  })
  return { answer: mergeShareTextBlocks(answer), process }
}

/** Adjacent text fragments read as one answer, preserving intervening images. */
export function mergeShareTextBlocks(blocks: ContentBlock[]) {
  const merged: ContentBlock[] = []
  for (const block of blocks) {
    const previous = merged[merged.length - 1]
    if (block.type === "text") {
      const text = block.text.trim()
      if (!text) continue
      if (previous?.type === "text") previous.text += `\n\n${text}`
      else merged.push({ type: "text", text })
    } else merged.push(block)
  }
  return merged
}
