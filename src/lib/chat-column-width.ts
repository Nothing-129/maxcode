// src/lib/chat-column-width.ts

/**
 * 会话内容列（.maxcode-chat-column）的用户可拖宽度，单位 rem。
 *
 * 以 rem 而非 px 存储：列宽与聊天字号/窗口缩放同源于根字号，缩放时列随字体
 * 等比伸缩，与 48rem 默认值的行为一致。数值按 0.5rem 取整，避免 localStorage
 * 里出现 47.18332… 这类长尾。
 */

export const DEFAULT_CHAT_COLUMN_WIDTH_REM = 48
export const MIN_CHAT_COLUMN_WIDTH_REM = 40
export const MAX_CHAT_COLUMN_WIDTH_REM = 80

/** 拖动 / 恢复默认时统一走这里：先钳制到允许区间，再取 0.5rem 步进。 */
export function clampChatColumnWidth(rem: number): number {
  const lower = Math.max(MIN_CHAT_COLUMN_WIDTH_REM, rem)
  const upper = Math.min(MAX_CHAT_COLUMN_WIDTH_REM, lower)
  return Math.round(upper * 2) / 2
}

/** 存储值（可能被手改）回读用；越界 / NaN 一律判为无效，调用方落回默认。 */
export function isValidChatColumnWidth(rem: number): boolean {
  return (
    Number.isFinite(rem) &&
    rem >= MIN_CHAT_COLUMN_WIDTH_REM &&
    rem <= MAX_CHAT_COLUMN_WIDTH_REM
  )
}
