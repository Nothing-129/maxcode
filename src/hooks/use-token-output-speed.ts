"use client"

import { useEffect, useRef, useState } from "react"

import type {
  LiveContentBlock,
  LiveMessage,
} from "@/contexts/acp-connections-context"
import { TokenCountAccumulator, TokenSpeedTracker } from "@/lib/token-speed"

/** Pi-web refreshes its cumulative rate every 300 ms. */
const SAMPLE_MS = 300

export interface TokenOutputSegment {
  /** Stable while one model response grows; changes after a tool round-trip. */
  key: string
  /** Model-generated strings counted by pi-web's heuristic. */
  texts: string[]
  /** False while the last generated tool call is executing or complete. */
  active: boolean
}

function isRootOutputBlock(
  block: LiveContentBlock
): block is Extract<LiveContentBlock, { type: "text" | "thinking" }> {
  return (
    (block.type === "text" || block.type === "thinking") &&
    block.parentToolUseId == null
  )
}

/**
 * Map Codeg's whole-turn live message onto pi-web's per-assistant-message
 * scope. A root output block after one or more tool calls begins a new model
 * generation. Consecutive tool calls remain in the response that generated
 * them, while sub-agent-attributed content is ignored.
 */
export function getTokenOutputSegment(
  message: LiveMessage
): TokenOutputSegment {
  let startIndex = 0
  let previousRelevantWasTool = false

  for (let i = 0; i < message.content.length; i++) {
    const block = message.content[i]
    if (isRootOutputBlock(block)) {
      if (previousRelevantWasTool) startIndex = i
      previousRelevantWasTool = false
    } else if (block.type === "tool_call") {
      previousRelevantWasTool = true
    }
  }

  const texts: string[] = []
  let lastRelevant: LiveContentBlock | null = null
  for (let i = startIndex; i < message.content.length; i++) {
    const block = message.content[i]
    if (isRootOutputBlock(block)) {
      texts.push(block.text)
      lastRelevant = block
    } else if (block.type === "tool_call") {
      texts.push(block.info.raw_input ?? "")
      lastRelevant = block
    }
  }

  const active =
    lastRelevant !== null &&
    (lastRelevant.type !== "tool_call" ||
      lastRelevant.info.status === "pending")

  return {
    key: `${message.id}:${startIndex}`,
    texts,
    active,
  }
}

/**
 * Live pi-web-compatible token output speed for the current root-agent model
 * generation. The estimate counts text, thinking and tool-call arguments, and
 * restarts after each tool round-trip so tool execution does not dilute TPS.
 */
export function useTokenOutputSpeed(message: LiveMessage): number | null {
  const [tps, setTps] = useState<number | null>(null)
  const messageRef = useRef(message)

  useEffect(() => {
    messageRef.current = message
  })

  useEffect(() => {
    const counts = new TokenCountAccumulator()
    const tracker = new TokenSpeedTracker()
    let segmentKey: string | null = null

    const timer = setInterval(() => {
      const segment = getTokenOutputSegment(messageRef.current)
      if (segment.key !== segmentKey) {
        segmentKey = segment.key
        counts.reset()
        tracker.reset()
        setTps(null)
      }

      counts.beginPass()
      for (const text of segment.texts) counts.push(text)
      const total = counts.endPass()

      // Pi-web ends the streaming assistant message before tool execution. In
      // Codeg one LiveMessage spans the whole turn, so reproduce that boundary
      // by hiding the rate once the trailing tool leaves `pending`.
      if (!segment.active || total <= 0) {
        setTps(null)
        return
      }

      const rate = tracker.observe(total, performance.now())
      if (rate !== null) setTps(Math.max(rate, 0))
    }, SAMPLE_MS)

    return () => clearInterval(timer)
  }, [])

  return tps
}
