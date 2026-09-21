import type { LiveMessage } from "@/contexts/acp-connections-context"

export type AgentActivity =
  | "waiting"
  | "thinking"
  | "streaming"
  | "running"
  | "awaitingUser"
  | "settled"

/** Describe observed work only; no fake progress or inferred model reasoning.
 * Pending user interaction wins over stale running tools. Parallel tools remain
 * active even when another tool finishes or emits text.
 */
export function getAgentActivity(
  message: LiveMessage,
  isStreaming: boolean,
  awaitingUser: boolean
): AgentActivity {
  if (!isStreaming) return "settled"
  if (awaitingUser) return "awaitingUser"
  if (
    message.content.some(
      (block) =>
        block.type === "tool_call" &&
        (block.info.status === "pending" || block.info.status === "in_progress")
    )
  )
    return "running"

  for (let i = message.content.length - 1; i >= 0; i -= 1) {
    const block = message.content[i]
    if (block.type === "thinking" && block.text.trim()) return "thinking"
    if (block.type === "text" && block.text.trim()) return "streaming"
    // A finished tool is not proof that fresh text is being generated.
    if (block.type === "tool_call") return "waiting"
  }
  return "waiting"
}
