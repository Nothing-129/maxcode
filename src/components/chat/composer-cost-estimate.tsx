"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { opencodeProviderCatalog } from "@/lib/api"
import {
  estimateConversationCost,
  formatConversationCost,
} from "@/lib/conversation-cost"
import type {
  ConversationBillingUsage,
  OpenCodeCatalogProvider,
} from "@/lib/types"

const PRICING_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/** Shared by the inline amount and expanded cost details. */
export function useComposerCostEstimate(
  buckets: ConversationBillingUsage[] | null
) {
  const t = useTranslations("Folder.statusBar.tokens")
  const [catalog, setCatalog] = useState<OpenCodeCatalogProvider[] | null>(null)
  const [failed, setFailed] = useState(false)
  const hasBuckets = Boolean(buckets?.length)
  useEffect(() => {
    if (!hasBuckets) return
    let active = true
    let pending = false
    let lastAttempt: number | null = null
    const maybeRefresh = () => {
      if (!active || pending || document.hidden) return
      if (
        lastAttempt != null &&
        Date.now() - lastAttempt < PRICING_CHECK_INTERVAL_MS
      ) {
        return
      }
      lastAttempt = Date.now()
      pending = true
      // The backend shares a six-hour disk cache across windows. Keep the
      // current estimate while refreshing or when the network is unavailable.
      void opencodeProviderCatalog()
        .then(
          (value) => {
            if (active) {
              setCatalog(value)
              setFailed(false)
            }
          },
          () => {
            if (active) setFailed(true)
          }
        )
        .finally(() => {
          pending = false
        })
    }
    maybeRefresh()
    const interval = setInterval(maybeRefresh, PRICING_CHECK_INTERVAL_MS)
    document.addEventListener("visibilitychange", maybeRefresh)
    return () => {
      active = false
      clearInterval(interval)
      document.removeEventListener("visibilitychange", maybeRefresh)
    }
  }, [hasBuckets])
  const estimate =
    catalog && buckets ? estimateConversationCost(buckets, catalog) : null
  const value =
    estimate?.usd != null
      ? formatConversationCost(estimate.usd)
      : buckets?.length && !catalog && !failed
        ? t("costLoading")
        : "--"
  const label = t(
    estimate && !estimate.complete && estimate.usd != null
      ? "estimatedPartialCost"
      : "estimatedCost"
  )
  const note = estimate?.missingModels.length
    ? t("costIncomplete")
    : t("costBasis")
  const inlineValue =
    estimate?.usd != null
      ? `$${estimate.usd.toFixed(2)}${estimate.complete ? "" : "*"}`
      : null
  return { value, label, note, inlineValue }
}

export function ComposerCostEstimate({
  buckets,
}: {
  buckets: ConversationBillingUsage[] | null
}) {
  const cost = useComposerCostEstimate(buckets)
  return <ComposerCostDetails cost={cost} />
}

export function ComposerCostDetails({
  cost,
}: {
  cost: ReturnType<typeof useComposerCostEstimate>
}) {
  const t = useTranslations("Folder.statusBar.tokens")
  return (
    <section
      className="space-y-2 border-t border-foreground/[0.06] pt-3"
      aria-label={t("estimatedCost")}
    >
      <div className="flex items-center justify-between gap-4 leading-5 font-medium">
        <span>{cost.label}</span>
        <span className="shrink-0 tabular-nums">{cost.value}</span>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {cost.note}
      </p>
    </section>
  )
}
