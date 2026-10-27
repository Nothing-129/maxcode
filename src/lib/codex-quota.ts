import { getTransport } from "@/lib/transport"

export const CODEX_QUOTA_REFRESH_MS = 5 * 60 * 1000

export interface CodexQuotaWindow {
  window_minutes: number
  used_percent: number
  resets_at: number | null
}

export interface CodexQuota {
  official: boolean
  plan_type: string | null
  windows: CodexQuotaWindow[]
  updated_at: number | null
  error: string | null
}

export function readCodexQuota(force = false): Promise<CodexQuota> {
  return getTransport().call("codex_subscription_quota", { force })
}

/** Display only the subscription windows appropriate for the signed-in plan.
 * Missing windows remain missing; never invent a full allowance. */
export function codexQuotaWindows(quota: CodexQuota): CodexQuotaWindow[] {
  const plan = quota.plan_type?.trim().toLowerCase()
  if (plan === "pro") {
    return quota.windows.filter((window) => window.window_minutes === 10080)
  }
  if (plan === "plus") {
    return quota.windows.filter((window) =>
      [300, 10080].includes(window.window_minutes)
    )
  }
  return quota.windows
}
