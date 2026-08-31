"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import type { LiveMessage } from "@/contexts/acp-connections-context"
import { useTabStore } from "@/contexts/tab-context"
import {
  addGenerationStats,
  generationStatsFromLiveMessage,
} from "@/lib/live-generation-stats"
import type { GenerationStats } from "@/lib/types"
import { useConversationRuntimeStore } from "@/stores/conversation-runtime-store"

/** DeepSeek Harness's compact whole-session duration formatter. */
export function formatGenerationDuration(ms: number): string {
  const seconds = Math.max(0, ms) / 1_000
  if (seconds < 60) return `${Math.round(seconds * 10) / 10}s`
  const wholeSeconds = Math.round(seconds)
  return `${Math.floor(wholeSeconds / 60)}m${wholeSeconds % 60}s`
}

/** DeepSeek Harness shows whole tok/s from ten up, one decimal below. */
export function formatGenerationThroughput(tokensPerSecond: number): string {
  const value = Math.max(0, tokensPerSecond)
  return String(value >= 10 ? Math.round(value) : Math.round(value * 10) / 10)
}

export function getGenerationFigures(stats: GenerationStats): {
  averageTtft: string | null
  throughput: string | null
} {
  return {
    averageTtft:
      stats.ttft_steps > 0
        ? formatGenerationDuration(stats.ttft_ms / stats.ttft_steps)
        : null,
    throughput:
      stats.decode_ms > 0
        ? formatGenerationThroughput(
            stats.decode_tokens / (stats.decode_ms / 1_000)
          )
        : null,
  }
}

/**
 * Include the current streaming turn before COMPLETE_TURN promotes it. Using
 * the latest observed token timestamp keeps render pure while making a new
 * conversation's figures appear as soon as output starts.
 */
export function getDisplayedGenerationStats(
  completed: GenerationStats | null,
  liveMessage: LiveMessage | null,
  providerOutputTokens?: number | null
): GenerationStats | null {
  const exactCompleted = capEstimatedTokensToProviderTotal(
    completed,
    providerOutputTokens
  )
  if (!liveMessage) return exactCompleted
  const latestObservedAt = liveMessage.generationTiming?.steps.reduce(
    (latest, step) =>
      Math.max(
        latest,
        step.lastTokenAt ?? step.firstTokenAt ?? step.startedAt ?? 0
      ),
    liveMessage.startedAt
  )
  return addGenerationStats(
    exactCompleted,
    generationStatsFromLiveMessage(
      liveMessage,
      latestObservedAt ?? liveMessage.startedAt
    )
  )
}

/**
 * ACP has no per-step usage, so live turns initially use a text estimate.
 * Once the native parser supplies the provider's cumulative output usage, it
 * is a hard upper bound for every completed turn observed in this session.
 */
export function capEstimatedTokensToProviderTotal(
  stats: GenerationStats | null,
  providerOutputTokens?: number | null
): GenerationStats | null {
  if (
    !stats ||
    providerOutputTokens == null ||
    !Number.isFinite(providerOutputTokens) ||
    providerOutputTokens <= 0 ||
    stats.decode_tokens <= providerOutputTokens
  ) {
    return stats
  }
  return {
    ...stats,
    decode_tokens: Math.floor(providerOutputTokens),
  }
}

interface GenerationStatsFitInput {
  rowWidth: number
  rowPadding: number
  leftWidth: number
  outerGap: number
  rightControlWidths: number[]
  rightGap: number
  statsWidth: number
}

export type GenerationStatsDisplayMode = "full" | "throughput" | "hidden"

export function chooseGenerationStatsDisplayMode(
  fullFits: boolean,
  throughputFits: boolean
): GenerationStatsDisplayMode {
  if (fullFits) return "full"
  if (throughputFits) return "throughput"
  return "hidden"
}

/** True when the complete label fits without shrinking or crossing the RHS. */
export function canShowGenerationStats({
  rowWidth,
  rowPadding,
  leftWidth,
  outerGap,
  rightControlWidths,
  rightGap,
  statsWidth,
}: GenerationStatsFitInput): boolean {
  const available = rowWidth - rowPadding
  const rightChildren = rightControlWidths.length + 1
  const required =
    leftWidth +
    outerGap +
    rightControlWidths.reduce((sum, width) => sum + width, 0) +
    statsWidth +
    rightGap * Math.max(0, rightChildren - 1)
  return required <= available
}

function cssPixels(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Whole-session first-token latency and decode speed in the trailing metrics.
 * DeepSeek history supplies provider-exact figures; active ACP conversations
 * add browser-observed step boundaries and the same output-token estimator as
 * the live speed chip. The label is rendered only when its measured row fits.
 */
export function ComposerGenerationStats({ tabId }: { tabId: string | null }) {
  const t = useTranslations("Folder.chat.generationStats")
  const labelRef = useRef<HTMLSpanElement>(null)
  const fullMeasureRef = useRef<HTMLSpanElement>(null)
  const throughputMeasureRef = useRef<HTMLSpanElement>(null)
  const [displayMode, setDisplayMode] =
    useState<GenerationStatsDisplayMode>("hidden")
  const runtimeConversationId = useTabStore((state) => {
    const tab = state.tabs.find((item) => item.id === tabId)
    if (!tab || tab.kind !== "conversation") return null
    return tab.runtimeConversationId ?? tab.conversationId ?? null
  })
  const completedStats = useConversationRuntimeStore((state) =>
    runtimeConversationId != null
      ? (state.byConversationId.get(runtimeConversationId)?.sessionStats
          ?.generation_stats ?? null)
      : null
  )
  const providerOutputTokens = useConversationRuntimeStore((state) =>
    runtimeConversationId != null
      ? (state.byConversationId.get(runtimeConversationId)?.sessionStats
          ?.total_usage?.output_tokens ?? null)
      : null
  )
  const liveMessage = useConversationRuntimeStore((state) =>
    runtimeConversationId != null
      ? (state.byConversationId.get(runtimeConversationId)?.liveMessage ?? null)
      : null
  )
  const stats = getDisplayedGenerationStats(
    completedStats,
    liveMessage,
    providerOutputTokens
  )

  const figures = stats
    ? getGenerationFigures(stats)
    : { averageTtft: null, throughput: null }
  const parts = [
    figures.averageTtft
      ? t("ttftAverage", { duration: figures.averageTtft })
      : null,
    figures.throughput
      ? t("tokensPerSecond", { throughput: figures.throughput })
      : null,
  ].filter((part): part is string => part !== null)
  const fullLabel = parts.join(" · ")
  const throughputLabel = figures.throughput
    ? t("tokensPerSecond", { throughput: figures.throughput })
    : ""

  useLayoutEffect(() => {
    const labelElement = labelRef.current
    const fullMeasure = fullMeasureRef.current
    const throughputMeasure = throughputMeasureRef.current
    const right = labelElement?.parentElement
    const row = right?.parentElement
    const left = row?.children.item(0)
    if (
      !labelElement ||
      !fullMeasure ||
      !throughputMeasure ||
      !right ||
      !row ||
      !(left instanceof HTMLElement)
    ) {
      return
    }

    const measure = () => {
      const rowStyle = getComputedStyle(row)
      const rightStyle = getComputedStyle(right)
      const controls = Array.from(right.children).filter(
        (child): child is HTMLElement =>
          child instanceof HTMLElement && child.dataset.generationStats == null
      )
      const fit = (statsWidth: number) =>
        canShowGenerationStats({
          rowWidth: row.clientWidth,
          rowPadding:
            cssPixels(rowStyle.paddingLeft) + cssPixels(rowStyle.paddingRight),
          leftWidth: Math.max(
            left.getBoundingClientRect().width,
            left.scrollWidth
          ),
          outerGap: cssPixels(rowStyle.columnGap),
          rightControlWidths: controls.map((control) =>
            Math.max(control.getBoundingClientRect().width, control.scrollWidth)
          ),
          rightGap: cssPixels(rightStyle.columnGap),
          statsWidth,
        })
      setDisplayMode(
        chooseGenerationStatsDisplayMode(
          fit(fullMeasure.getBoundingClientRect().width),
          throughputLabel.length > 0 &&
            fit(throughputMeasure.getBoundingClientRect().width)
        )
      )
    }

    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    observer.observe(left)
    for (const control of Array.from(right.children)) {
      if (
        control instanceof HTMLElement &&
        control.dataset.generationStats == null
      ) {
        observer.observe(control)
      }
    }
    return () => observer.disconnect()
  }, [fullLabel, throughputLabel])

  if (!fullLabel) return null

  const displayedLabel =
    displayMode === "full"
      ? fullLabel
      : displayMode === "throughput"
        ? throughputLabel
        : fullLabel
  const isVisible = displayMode !== "hidden"

  return (
    <>
      <span
        ref={labelRef}
        data-generation-stats="visible"
        className={
          isVisible
            ? "inline-flex shrink-0 items-center whitespace-nowrap tabular-nums text-muted-foreground/80"
            : "pointer-events-none fixed start-[-9999px] top-0 invisible whitespace-nowrap"
        }
        title={fullLabel}
        aria-hidden={!isVisible}
      >
        {displayedLabel}
      </span>
      <span
        ref={fullMeasureRef}
        data-generation-stats="measure-full"
        className="pointer-events-none fixed start-[-9999px] top-0 invisible whitespace-nowrap"
        aria-hidden="true"
      >
        {fullLabel}
      </span>
      <span
        ref={throughputMeasureRef}
        data-generation-stats="measure-throughput"
        className="pointer-events-none fixed start-[-9999px] top-0 invisible whitespace-nowrap"
        aria-hidden="true"
      >
        {throughputLabel}
      </span>
    </>
  )
}
