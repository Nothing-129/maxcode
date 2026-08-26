"use client"

import type { AgentType } from "@/lib/types"

const STORAGE_PREFIX = "codeg:last-selected-agent:v2"

/** Scope key for chat-mode drafts. Chat keeps a single memory of its own,
 *  fully separate from every project's per-folder memory. */
export const CHAT_AGENT_MEMORY_SCOPE = "chat"

function storageKey(scope: string): string {
  return `${STORAGE_PREFIX}:${scope}`
}

/** Returns the agent most recently picked by the user for a new conversation
 *  in the given scope (a project folder path, or `CHAT_AGENT_MEMORY_SCOPE`). */
export function getLastSelectedAgent(scope: string): AgentType | null {
  if (typeof window === "undefined") return null
  try {
    const agentType = localStorage.getItem(storageKey(scope))
    return agentType ? (agentType as AgentType) : null
  } catch {
    return null
  }
}

/** Saves only explicit user choices; automatic availability fallbacks do not count. */
export function saveLastSelectedAgent(scope: string, agentType: AgentType) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(storageKey(scope), agentType)
  } catch {
    /* ignore */
  }
}
