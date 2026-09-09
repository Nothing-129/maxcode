/**
 * Search tools (and shell `rg`/`grep`) report "found nothing" as a failed
 * tool call: rg/grep exit 1 when no line is selected, and most agents copy
 * that onto ACP `status: failed`. Presentation should treat that as an empty
 * result, not an error. Real failures (exit ≥ 2, stderr, parse traces) stay
 * red.
 *
 * Codex's `{formatted_output, exit_code}` envelope is one producer; Cursor
 * shell, Antigravity `run_command`, Grok `run_terminal_command`, and a bare
 * empty body with `is_error` are the others. The tool-name / command gate
 * lives here so `ls`/`find`/`pnpm test` exit 1 is never mistaken for a miss.
 */

import { isCodexGrepNoMatchEnvelope } from "@/lib/codex-command-action"
import { normalizeToolName } from "@/lib/tool-call-normalization"

const SEARCH_BINS = new Set([
  "rg",
  "ripgrep",
  "grep",
  "egrep",
  "fgrep",
  "ag",
  "ack",
  "ack-grep",
  "ggrep",
])

const NO_MATCH_MESSAGES = new Set([
  "no matches",
  "no matches found",
  "no files found",
  "no files with matches found",
  "no matching files",
  "0 matches",
  "0 files",
])

export interface SearchNoMatchProbe {
  toolName: string
  input?: string | null
  output?: string | null
  isError: boolean
}

export function isSearchNoMatchResult(probe: SearchNoMatchProbe): boolean {
  if (!probe.isError) return false
  if (!toolCanBeSearchMiss(probe.toolName, probe.input)) return false
  return resultLooksLikeNoMatch(probe.output)
}

function toolCanBeSearchMiss(
  toolName: string,
  input: string | null | undefined
): boolean {
  const name = normalizeToolName(toolName)
  if (name === "grep") return true
  if (name !== "bash" && name !== "exec_command") return false
  const command = commandFromToolInput(input)
  return command != null && commandLooksLikeSearch(command)
}

function resultLooksLikeNoMatch(raw: string | null | undefined): boolean {
  const text = raw ?? ""
  if (isCodexGrepNoMatchEnvelope(text)) return true

  const envelope = parseLooseCommandEnvelope(text)
  if (envelope) {
    if (envelope.exitCode != null && envelope.exitCode !== 1) {
      return false
    }
    return (
      isBlankOrNoMatchMessage(envelope.output) &&
      isBlankOrNoMatchMessage(envelope.stderr)
    )
  }

  return isBlankOrNoMatchMessage(text)
}

function isBlankOrNoMatchMessage(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) return true
  return NO_MATCH_MESSAGES.has(trimmed.toLowerCase())
}

interface LooseCommandEnvelope {
  output: string
  stderr: string
  exitCode: number | null
}

function parseLooseCommandEnvelope(raw: string): LooseCommandEnvelope | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith("{")) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null
  }
  const obj = parsed as Record<string, unknown>
  const exitCode =
    typeof obj.exit_code === "number"
      ? obj.exit_code
      : typeof obj.exitCode === "number"
        ? obj.exitCode
        : null
  const outputKeys = [
    "formatted_output",
    "combinedOutput",
    "stdout",
    "aggregated_output",
    "output",
  ]
  let output: string | null = null
  for (const key of outputKeys) {
    const value = obj[key]
    if (typeof value === "string") {
      output = value
      break
    }
  }
  const stderr = typeof obj.stderr === "string" ? obj.stderr : ""
  if (exitCode == null && output == null && stderr.length === 0) {
    return null
  }
  return { output: output ?? "", stderr, exitCode }
}

function commandFromToolInput(input: string | null | undefined): string | null {
  if (!input) return null
  const trimmed = input.trim()
  if (!trimmed) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    const fromJson = commandFromUnknown(parsed)
    if (fromJson) return fromJson
  } catch {
    // Non-JSON command text is handled below.
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return null
  return trimmed
}

function commandFromUnknown(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (Array.isArray(value)) {
    const parts = value.filter(
      (item): item is string => typeof item === "string" && item.length > 0
    )
    return parts.length > 0 ? parts.join(" ") : null
  }
  if (!value || typeof value !== "object") return null
  const obj = value as Record<string, unknown>
  const directKeys = [
    "command",
    "cmd",
    "script",
    "command_line",
    "CommandLine",
    "args",
    "argv",
    "command_args",
  ]
  for (const key of directKeys) {
    const found = commandFromUnknown(obj[key])
    if (found) return found
  }
  const nestedKeys = ["input", "arguments", "params", "payload"]
  for (const key of nestedKeys) {
    const found = commandFromUnknown(obj[key])
    if (found) return found
  }
  return null
}

function unwrapQuotedCommand(command: string): string {
  const trimmed = command.trim()
  if (trimmed.length < 2) return trimmed
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1)
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\\\/g, "\\")
  }
  return trimmed
}

function simplifyShellCommand(command: string): string {
  let current = command.trim()
  const wrapperRe =
    /^(?:\/usr\/bin\/env\s+)?(?:(?:\/[^\s]+\/)?(?:bash|zsh|sh))\s+-(?:l?c)\s+(.+)$/i
  for (let i = 0; i < 6; i += 1) {
    const wrapped = current.match(wrapperRe)
    if (!wrapped) break
    const next = unwrapQuotedCommand(wrapped[1] ?? "").trim()
    if (!next || next === current) break
    current = next
  }
  return current
}

function splitTopLevel(source: string, sep: "|" | "&&" | ";"): string[] {
  const parts: string[] = []
  let buf = ""
  let quote: "'" | '"' | null = null
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (quote) {
      buf += char
      if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      buf += char
      continue
    }
    if (sep === "|" && char === "|" && source[i + 1] === "|") {
      buf += "||"
      i += 1
      continue
    }
    if (sep === "|" && char === "|") {
      parts.push(buf)
      buf = ""
      continue
    }
    if (sep === "&&" && char === "&" && source[i + 1] === "&") {
      parts.push(buf)
      buf = ""
      i += 1
      continue
    }
    if (sep === ";" && char === ";") {
      parts.push(buf)
      buf = ""
      continue
    }
    buf += char
  }
  parts.push(buf)
  return parts
}

function tokenize(command: string): string[] {
  const tokens: string[] = []
  let buf = ""
  let quote: "'" | '"' | null = null
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]
    if (quote) {
      buf += char
      if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      buf += char
      continue
    }
    if (/\s/.test(char)) {
      if (buf.length > 0) {
        tokens.push(buf)
        buf = ""
      }
      continue
    }
    buf += char
  }
  if (buf.length > 0) tokens.push(buf)
  return tokens
}

function binaryName(token: string): string {
  const base = token.split(/[\\/]/).pop() ?? token
  return base.replace(/\.exe$/i, "").toLowerCase()
}

function stripEnvAssignments(command: string): string {
  let current = command.trim()
  while (true) {
    const match = current.match(
      /^[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S+)\s+/
    )
    if (!match) break
    current = current.slice(match[0].length)
  }
  const wrapper = current.match(/^(?:command|exec|builtin|time|nice)\s+/)
  if (wrapper) current = current.slice(wrapper[0].length)
  return current
}

export function commandLooksLikeSearch(command: string): boolean {
  const simplified = simplifyShellCommand(command)
  const pipelineHead = splitTopLevel(simplified, "|")[0] ?? simplified
  const andTail = splitTopLevel(pipelineHead, "&&").pop() ?? pipelineHead
  const candidate = (splitTopLevel(andTail, ";").pop() ?? andTail).trim()
  const tokens = tokenize(stripEnvAssignments(candidate))
  if (tokens.length === 0) return false
  const bin = binaryName(tokens[0] ?? "")
  if (SEARCH_BINS.has(bin)) return true
  if (bin !== "git") return false
  return tokens.slice(1).some((token) => token === "grep")
}
