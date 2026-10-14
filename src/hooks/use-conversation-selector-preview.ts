"use client"

import { useEffect, useMemo } from "react"
import type { SessionConfigOptionInfo } from "@/lib/types"
import {
  getCachedSelectors,
  isCachedSelectors,
} from "@/lib/selectors-cache-storage"

const STORAGE_KEY = "codeg:conversation-selector-previews:v1"
const MAX_ENTRIES = 32

function readPreviews(): Map<string, SessionConfigOptionInfo[]> {
  try {
    const entries: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "[]"
    )
    if (!Array.isArray(entries)) return new Map()
    return new Map(
      entries
        .filter(
          (entry): entry is [string, SessionConfigOptionInfo[]] =>
            Array.isArray(entry) &&
            typeof entry[0] === "string" &&
            Array.isArray(entry[1]) &&
            isCachedSelectors({ modes: null, configOptions: entry[1] })
        )
        .slice(-MAX_ENTRIES)
    )
  } catch {
    return new Map()
  }
}

/** Build read-only labels from persisted values, never another chat's current values. */
export function persistedSelectorPreview(
  values: Record<string, string> | null | undefined,
  catalog: SessionConfigOptionInfo[] | null
): SessionConfigOptionInfo[] | null {
  if (!values || Object.keys(values).length === 0) return null
  return Object.entries(values).map(([id, value]) => {
    const option = catalog?.find((item) => item.id === id)
    const kind = option?.kind
    const label =
      kind?.type === "select"
        ? ([
            ...kind.options,
            ...(kind.groups ?? []).flatMap((group) => group.options),
          ].find((item) => item.value === value)?.name ?? value)
        : value
    return {
      id,
      name: option?.name ?? id,
      category:
        option?.category ?? (id === "model" ? "model" : "thought_level"),
      kind: {
        type: "select",
        current_value: value,
        options: [{ value, name: label }],
        groups: [],
      },
    }
  })
}

/** Display only: SQLite/native session restoration remains authoritative. */
export function useConversationSelectorPreview({
  agentType,
  workingDir,
  conversationId,
  ready,
  configOptions,
  persistedValues,
}: {
  agentType: string
  workingDir: string | undefined
  conversationId: number | null
  ready: boolean
  persistedValues?: Record<string, string> | null
  configOptions: SessionConfigOptionInfo[] | null
}): SessionConfigOptionInfo[] | null {
  // Origin-scoped storage + workspace + agent prevent unrelated histories
  // from borrowing each other's model, effort or model-dependent choices.
  const key =
    conversationId == null
      ? null
      : JSON.stringify([workingDir ?? "", agentType, conversationId])
  const preview = useMemo(
    () => (key && !ready ? (readPreviews().get(key) ?? null) : null),
    [key, ready]
  )
  useEffect(() => {
    if (!key || !ready || configOptions == null) return
    const entries = readPreviews()
    if (JSON.stringify(entries.get(key)) === JSON.stringify(configOptions))
      return
    entries.delete(key)
    entries.set(key, configOptions)
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([...entries].slice(-MAX_ENTRIES))
      )
    } catch {
      // Private mode / full storage must never block opening the conversation.
    }
  }, [key, ready, configOptions])
  return ready
    ? configOptions
    : (preview ??
        persistedSelectorPreview(
          persistedValues,
          getCachedSelectors(agentType)?.configOptions ?? null
        ))
}
