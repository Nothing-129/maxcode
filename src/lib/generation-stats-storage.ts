"use client"

import { getActiveRemoteConnectionId } from "@/lib/transport"
import type { GenerationStats } from "@/lib/types"

const KEY_PREFIX = "codeg.generationStats"

function storageKey(conversationId: number): string {
  const remoteId = getActiveRemoteConnectionId()
  const scope = remoteId ? `remote-${remoteId}` : "local"
  return `${KEY_PREFIX}:${scope}:${conversationId}`
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

export function loadGenerationStats(
  conversationId: number
): GenerationStats | null {
  if (typeof window === "undefined" || conversationId <= 0) return null
  try {
    const raw = window.localStorage.getItem(storageKey(conversationId))
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<GenerationStats>
    if (
      !isNonNegativeFinite(value.ttft_ms) ||
      !isNonNegativeFinite(value.ttft_steps) ||
      !isNonNegativeFinite(value.decode_ms) ||
      !isNonNegativeFinite(value.decode_tokens)
    ) {
      return null
    }
    return {
      ttft_ms: value.ttft_ms,
      ttft_steps: value.ttft_steps,
      decode_ms: value.decode_ms,
      decode_tokens: value.decode_tokens,
    }
  } catch {
    return null
  }
}

export function saveGenerationStats(
  conversationId: number,
  stats: GenerationStats | null | undefined
): void {
  if (typeof window === "undefined" || conversationId <= 0 || !stats) return
  try {
    window.localStorage.setItem(
      storageKey(conversationId),
      JSON.stringify(stats)
    )
  } catch {
    // Private mode/quota failure: the runtime-store copy still works.
  }
}
