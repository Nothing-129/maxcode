import type {
  AdaptedContentPart,
  AdaptedToolCallPart,
} from "@/lib/adapters/ai-elements-adapter"
import { normalizeToolName } from "@/lib/tool-call-normalization"
import { isUnsettledToolCall } from "@/lib/tool-call-lifecycle"

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)])
    )
  return value
}

// Only compare read tools and simple read-only shell commands. Do not infer
// recovery from prose, tool names alone, a finished turn, or arbitrary scripts.
function retryKey(part: AdaptedToolCallPart): string | null {
  const name = normalizeToolName(part.toolName)
  if (!part.input?.trim()) return null
  let input: Record<string, unknown>
  try {
    input = JSON.parse(part.input)
  } catch {
    return null
  }
  if (!input || Array.isArray(input) || typeof input !== "object") return null
  if (name === "bash" || name === "exec_command") {
    const command = input.command ?? input.cmd
    if (
      typeof command !== "string" ||
      !/^(?:cat|head|tail|ls|pwd|rg|grep)\s/.test(command) ||
      /[\n;|&<>`$]/.test(command)
    )
      return null
  } else if (!["read", "read_file", "grep", "glob"].includes(name)) {
    return null
  }
  if (Object.keys(input).length === 0) return null
  // Keep cwd and every other argument: the same relative path in another
  // workspace, or another query, is not evidence that this operation succeeded.
  return `${name}:${JSON.stringify(canonical(input))}`
}

/** Presentation-only annotation; original state, output and errors are retained. */
export function annotateToolRecovery(
  parts: AdaptedContentPart[]
): AdaptedContentPart[] {
  const calls = parts.flatMap((part) =>
    part.type === "tool-call"
      ? [part]
      : part.type === "tool-group"
        ? part.items
        : []
  )
  const successful = new Map<string, string>()
  const replacements = new Map<AdaptedToolCallPart, AdaptedToolCallPart>()
  for (let i = calls.length - 1; i >= 0; i--) {
    const call = calls[i]
    const key = retryKey(call)
    if (!key || isUnsettledToolCall(call)) continue
    const failed = call.state === "output-error" || !!call.errorText?.trim()
    if (failed) {
      const recoveredBy = successful.get(key)
      if (recoveredBy && recoveredBy !== call.toolCallId)
        replacements.set(call, { ...call, recoveredBy })
    } else if (
      call.state === "output-available" &&
      call.toolStatus !== "failed" &&
      call.output != null &&
      call.toolCallId
    ) {
      successful.set(key, call.toolCallId)
    }
  }
  if (!replacements.size) return parts
  return parts.map((part) => {
    if (part.type === "tool-call") return replacements.get(part) ?? part
    if (part.type === "tool-group")
      return {
        ...part,
        items: part.items.map((call) => replacements.get(call) ?? call),
      }
    return part
  })
}
