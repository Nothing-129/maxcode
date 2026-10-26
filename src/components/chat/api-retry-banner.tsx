"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import type { ClaudeApiRetryState } from "@/contexts/acp-connections-context"
import { retrySecondsRemaining } from "@/lib/api-retry"

export function ApiRetryBanner({
  value,
}: {
  value: ClaudeApiRetryState | null
}) {
  return value ? (
    <ActiveRetryBanner key={value.retryAtMs} value={value} />
  ) : null
}

function ActiveRetryBanner({ value }: { value: ClaudeApiRetryState }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (value?.retryAtMs == null) return
    const tick = () => setNow(Date.now())
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [value?.retryAtMs])
  const tAcp = useTranslations("Folder.chat.acpConnections")
  const retryLineText = (() => {
    const retry = value
    if (!retry) return null

    const retryAttempt =
      retry.attempt !== null && retry.attempt !== undefined
        ? Math.trunc(retry.attempt)
        : null
    const retryMax =
      retry.maxRetries !== null && retry.maxRetries !== undefined
        ? Math.trunc(retry.maxRetries)
        : null
    const retryDelaySeconds = retrySecondsRemaining(retry.retryAtMs, now)
    // `null` only for a source that reports no cause at all (pi, #525) — see
    // `ClaudeApiRetryState.reportsError`. Claude and codex keep the fallback.
    const errorLabel =
      (retry.errorStatus === 429
        ? tAcp("claudeApiRetry.rateLimited")
        : retry.error) ??
      (retry.reportsError ? tAcp("claudeApiRetry.fallbackError") : null)
    const statusLabel =
      retry.errorStatus !== null && retry.errorStatus !== undefined
        ? tAcp("claudeApiRetry.httpStatus", {
            status: Math.trunc(retry.errorStatus),
          })
        : ""
    const retryLabel =
      retryAttempt !== null && retryMax !== null
        ? tAcp("claudeApiRetry.retryingWithMax", {
            attempt: retryAttempt,
            max: retryMax,
          })
        : retryAttempt !== null
          ? tAcp("claudeApiRetry.retryingAttempt", {
              attempt: retryAttempt,
            })
          : tAcp("claudeApiRetry.retrying")
    const delayLabel =
      retryDelaySeconds !== null && retryDelaySeconds > 0
        ? tAcp("claudeApiRetry.nextRetryIn", {
            seconds: retryDelaySeconds,
          })
        : null

    // With no cause AND no HTTP status there is nothing to put before the
    // separator, and the shared template would render a dangling "· 正在重试".
    // Take the prefix-less pair instead — the counters carry the whole message.
    if (errorLabel === null && statusLabel === "") {
      return delayLabel !== null
        ? tAcp("claudeApiRetry.lineNoErrorWithDelay", {
            retry: retryLabel,
            delay: delayLabel,
          })
        : tAcp("claudeApiRetry.lineNoError", { retry: retryLabel })
    }

    return delayLabel !== null
      ? tAcp("claudeApiRetry.lineWithDelay", {
          error: errorLabel ?? "",
          status: statusLabel,
          retry: retryLabel,
          delay: delayLabel,
        })
      : tAcp("claudeApiRetry.line", {
          error: errorLabel ?? "",
          status: statusLabel,
          retry: retryLabel,
        })
  })()

  if (!retryLineText) return null
  return (
    <div
      role="status"
      className="border-t border-amber-500/20 bg-amber-500/5 px-4 py-2 text-xs text-amber-700 dark:text-amber-400"
    >
      <div className="flex items-start gap-2 font-medium">
        <Loader2
          aria-hidden
          className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin"
        />
        <span className="min-w-0 break-words">{retryLineText}</span>
      </div>
    </div>
  )
}
