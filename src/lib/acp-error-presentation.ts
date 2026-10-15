/**
 * The verdicts that mean the turn FAILED — nothing came back, or the agent
 * would not run it — as opposed to one that ended early WITH output
 * (`turn_failed_refusal`, `turn_failed_max_tokens`,
 * `turn_failed_max_turn_requests`). A failed turn closes with a failure line in
 * the transcript, as it does on reload from the agent's own record.
 */
const FAILED_TURN_VERDICTS: ReadonlySet<string> = new Set([
  "turn_failed_auth_required",
  "turn_failed_empty",
  "turn_failed_empty_protocol",
  "turn_failed_empty_metadata",
  "turn_failed_unknown",
])

export function isFailedTurnVerdict(code: string | null | undefined): boolean {
  return typeof code === "string" && FAILED_TURN_VERDICTS.has(code)
}

/**
 * The agent's own words in a prompt it rejected. The backend reports such a
 * rejection with no code and its message through `AcpError::protocol`, whose
 * Display prefixes it (`ACP protocol error: …`).
 */
export function rejectedPromptText(message: string): string {
  return message.replace(/^ACP protocol error:\s*/, "")
}
