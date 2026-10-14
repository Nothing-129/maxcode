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
