import type {
  LiveContentBlock,
  LiveMessage,
} from "@/contexts/acp-connections-context"
import type { GenerationStats } from "@/lib/types"
import { estimateTokens } from "@/lib/token-speed"

export interface LiveGenerationStep {
  /** Prompt/tool-result boundary. Null when a reconnect missed that boundary. */
  startedAt: number | null
  firstTokenAt: number | null
  lastTokenAt: number | null
  startContentIndex: number
}

export interface LiveGenerationTiming {
  steps: LiveGenerationStep[]
  /** Latest settled tool boundary from which the next model step starts. */
  nextStepStartedAt: number | null
}

export function createLiveGenerationTiming(
  startedAt: number
): LiveGenerationTiming {
  return {
    steps: [
      {
        startedAt,
        firstTokenAt: null,
        lastTokenAt: null,
        startContentIndex: 0,
      },
    ],
    nextStepStartedAt: null,
  }
}

/** Record one non-empty root-agent output delta. */
export function markLiveGenerationOutput(
  timing: LiveGenerationTiming | undefined,
  messageStartedAt: number,
  contentIndex: number,
  startsAfterTool: boolean,
  now: number
): LiveGenerationTiming {
  const current = timing ?? createLiveGenerationTiming(messageStartedAt)
  const steps = current.steps.slice()

  if (startsAfterTool) {
    steps.push({
      startedAt: current.nextStepStartedAt,
      firstTokenAt: now,
      lastTokenAt: now,
      startContentIndex: contentIndex,
    })
  } else {
    const index = Math.max(0, steps.length - 1)
    const step = steps[index] ?? {
      startedAt: messageStartedAt,
      firstTokenAt: null,
      lastTokenAt: null,
      startContentIndex: contentIndex,
    }
    steps[index] = {
      ...step,
      firstTokenAt: step.firstTokenAt ?? now,
      lastTokenAt: now,
    }
  }

  return { steps, nextStepStartedAt: null }
}

/** A completed/failed tool is the start boundary for the next model request. */
export function markLiveToolSettled(
  timing: LiveGenerationTiming | undefined,
  messageStartedAt: number,
  now: number
): LiveGenerationTiming {
  const current = timing ?? createLiveGenerationTiming(messageStartedAt)
  return {
    ...current,
    nextStepStartedAt: Math.max(current.nextStepStartedAt ?? 0, now),
  }
}

function rootGeneratedText(block: LiveContentBlock): string | null {
  if (
    (block.type === "text" || block.type === "thinking") &&
    block.parentToolUseId == null
  ) {
    return block.text
  }
  if (block.type === "tool_call") {
    return `${block.info.title}\n${block.info.raw_input ?? ""}`
  }
  return null
}

/**
 * Fold live ACP observations into the same additive shape used by DeepSeek.
 * TTFT uses exact browser-observed boundaries. Output tokens are the existing
 * pi-web-compatible estimate because ACP does not expose per-step output usage.
 */
export function generationStatsFromLiveMessage(
  message: LiveMessage,
  completedAt: number
): GenerationStats | null {
  const timing = message.generationTiming
  if (!timing || timing.steps.length === 0) return null

  const stats: GenerationStats = {
    ttft_ms: 0,
    ttft_steps: 0,
    decode_ms: 0,
    decode_tokens: 0,
  }

  for (let index = 0; index < timing.steps.length; index++) {
    const step = timing.steps[index]
    if (step.startedAt != null && step.firstTokenAt != null) {
      stats.ttft_ms += Math.max(0, step.firstTokenAt - step.startedAt)
      stats.ttft_steps += 1
    }
    if (step.firstTokenAt == null || step.lastTokenAt == null) continue

    const isOpenFinalStep =
      index === timing.steps.length - 1 && timing.nextStepStartedAt == null
    const decodeEnd = isOpenFinalStep
      ? Math.max(step.lastTokenAt, completedAt)
      : step.lastTokenAt
    const decodeMs = Math.max(0, decodeEnd - step.firstTokenAt)
    if (decodeMs <= 0) continue

    const end =
      timing.steps[index + 1]?.startContentIndex ?? message.content.length
    let estimatedTokens = 0
    for (const block of message.content.slice(step.startContentIndex, end)) {
      const text = rootGeneratedText(block)
      if (text) estimatedTokens += estimateTokens(text)
    }
    if (estimatedTokens <= 0) continue

    stats.decode_ms += decodeMs
    stats.decode_tokens += Math.max(1, Math.round(estimatedTokens))
  }

  return stats.ttft_steps > 0 || stats.decode_ms > 0 ? stats : null
}

export function addGenerationStats(
  base: GenerationStats | null | undefined,
  extra: GenerationStats | null | undefined
): GenerationStats | null {
  if (!base) return extra ?? null
  if (!extra) return base
  return {
    ttft_ms: base.ttft_ms + extra.ttft_ms,
    ttft_steps: base.ttft_steps + extra.ttft_steps,
    decode_ms: base.decode_ms + extra.decode_ms,
    decode_tokens: base.decode_tokens + extra.decode_tokens,
  }
}
