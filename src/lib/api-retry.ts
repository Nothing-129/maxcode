import type { ClaudeApiRetryState } from "@/contexts/acp-connections-context"
import type { AcpEvent } from "@/lib/types"

export function apiRetryFromEvent(
  event: Extract<AcpEvent, { type: "turn_retrying" }>,
  sessionId: string
): ClaudeApiRetryState {
  return {
    sessionId,
    attempt: event.attempt ?? null,
    maxRetries: event.max_retries ?? null,
    error: event.message || null,
    errorStatus: event.error_status ?? null,
    retryDelayMs: event.retry_delay_ms ?? null,
    retryAtMs: event.retry_at_ms ?? null,
    reportsError: event.message.trim().length > 0,
  }
}

export function retrySecondsRemaining(
  deadline: number | null | undefined,
  now: number
): number | null {
  if (deadline == null || !Number.isFinite(deadline)) return null
  // Expiry means a retry is due, NOT that the request recovered. Keep showing
  // "retrying" until real output/turn completion clears the retry state.
  return Math.max(0, Math.ceil((deadline - now) / 1000))
}
