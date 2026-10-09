"use client"

import type { ReactNode } from "react"
import { X } from "lucide-react"
import { useTranslations } from "next-intl"
import { formatContextWindowPercent } from "@/lib/context-window"
import { formatTokenCount } from "@/lib/token-format"
import type { TurnUsage } from "@/lib/types"

const TOKEN_COLORS = {
  input: "bg-indigo-500",
  output: "bg-emerald-500",
  cacheRead: "bg-amber-500",
  cacheWrite: "bg-violet-500",
  cacheHitRate: "bg-pink-500",
}

export function ComposerUsageDetails({
  contextPercent,
  contextUsed,
  contextMax,
  usage,
  total,
  onClose,
  children,
}: {
  contextPercent: number | null
  contextUsed: number | null
  contextMax: number | null
  usage: TurnUsage | null
  total: number | null
  onClose: () => void
  children?: ReactNode
}) {
  const t = useTranslations("Folder.statusBar.tokens")
  const hasContext = contextPercent != null
  const buckets = usage
    ? [
        { key: "input" as const, value: usage.input_tokens },
        { key: "output" as const, value: usage.output_tokens },
        { key: "cacheRead" as const, value: usage.cache_read_input_tokens },
        {
          key: "cacheWrite" as const,
          value: usage.cache_creation_input_tokens,
        },
      ]
    : []
  const bucketTotal = buckets.reduce((sum, row) => sum + row.value, 0)
  const inputTotal = usage
    ? usage.input_tokens +
      usage.cache_read_input_tokens +
      usage.cache_creation_input_tokens
    : 0
  const rows = [
    ...buckets,
    ...(usage
      ? [
          {
            key: "cacheHitRate" as const,
            value:
              inputTotal > 0
                ? (usage.cache_read_input_tokens / inputTotal) * 100
                : null,
          },
        ]
      : []),
    ...(total != null ? [{ key: "total" as const, value: total }] : []),
  ]

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="font-medium">
          {t(hasContext ? "contextUsage" : "sessionTokenUsage")}
        </h2>
        <button
          type="button"
          aria-label={t("closeDetails")}
          onClick={onClose}
          className="-me-1 -mt-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      {hasContext && (
        <section className="space-y-3" aria-label={t("contextWindow")}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[32px] leading-none font-semibold tracking-tight tabular-nums">
              {formatContextWindowPercent(contextPercent)}
            </span>
            <span className="text-xs leading-5 text-muted-foreground tabular-nums">
              {t("used")}{" "}
              {contextUsed == null ? "--" : formatTokenCount(contextUsed)}
              {" / "}
              {contextMax == null ? "--" : formatTokenCount(contextMax)}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label={t("contextWindowUsageAria")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={contextPercent}
            className="h-2.5 overflow-hidden rounded-full bg-foreground/[0.06]"
          >
            <div
              className="h-full rounded-full bg-indigo-500 transition-[width]"
              style={{ width: `${contextPercent}%` }}
            />
          </div>
        </section>
      )}
      {rows.length > 0 && (
        <section
          aria-label={t("tokenUsage")}
          className={
            hasContext ? "mt-5 border-t border-foreground/[0.06] pt-4" : ""
          }
        >
          {hasContext && (
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">
              {t("sessionTokenUsage")}
            </h3>
          )}
          <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
            {t("sessionUsageNote")}
          </p>
          {bucketTotal > 0 && (
            <div
              role="img"
              aria-label={t("sessionTokenUsage")}
              className="mb-4 flex h-1.5 overflow-hidden rounded-full bg-foreground/[0.06]"
            >
              {buckets.map((row) =>
                row.value > 0 ? (
                  <span
                    key={row.key}
                    data-token-segment={row.key}
                    className={`h-full ${TOKEN_COLORS[row.key]}`}
                    style={{ width: `${(row.value / bucketTotal) * 100}%` }}
                  />
                ) : null
              )}
            </div>
          )}
          <dl className="space-y-3">
            {rows.map((row) => (
              <div
                key={row.key}
                className={`flex items-center justify-between gap-4 leading-5 ${
                  row.key === "total"
                    ? "border-t border-foreground/[0.06] pt-3 font-medium"
                    : ""
                }`}
              >
                <dt className="flex min-w-0 items-center gap-2.5">
                  {row.key !== "total" && (
                    <span
                      aria-hidden="true"
                      data-token-dot={row.key}
                      className={`size-2.5 shrink-0 rounded-full ${TOKEN_COLORS[row.key]}`}
                    />
                  )}
                  {t(row.key)}
                </dt>
                <dd className="shrink-0 text-muted-foreground tabular-nums">
                  {row.value == null
                    ? "--"
                    : row.key === "cacheHitRate"
                      ? `${row.value.toFixed(1)}%`
                      : formatTokenCount(row.value)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {children && <div className="mt-4 text-xs">{children}</div>}
    </>
  )
}
