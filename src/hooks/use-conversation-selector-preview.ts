"use client"

import { useEffect, useMemo } from "react"
import type { SessionConfigOptionInfo } from "@/lib/types"
import {
  getCachedSelectors,
  isCachedSelectors,
} from "@/lib/selectors-cache-storage"

const STORAGE_KEY = "codeg:conversation-selector-previews:v2"
const MAX_ENTRIES = 32

function entryKey(key: string): string {
  return `${STORAGE_KEY}:${key}`
}

// These previews are inert until restoration completes. Keeping the entire
// model catalog here multiplies it by the number of chats for no UI benefit.
export function compactSelectorPreview(
  options: SessionConfigOptionInfo[]
): SessionConfigOptionInfo[] {
  return options.map((option) => {
    const kind = option.kind
    if (kind.type !== "select") return option
    const selected =
      kind.options.find((item) => item.value === kind.current_value) ??
      kind.groups
        ?.flatMap((group) => group.options)
        .find((item) => item.value === kind.current_value)
    return {
      ...option,
      kind: {
        ...kind,
        options: [
          {
            value: kind.current_value,
            name: selected?.name ?? kind.current_value,
          },
        ],
        groups: [],
      },
    }
  })
}

function readPreview(key: string): SessionConfigOptionInfo[] | null {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(entryKey(key)) ?? "null"
    )
    return Array.isArray(value) &&
      isCachedSelectors({ modes: null, configOptions: value })
      ? value
      : null
  } catch {
    return null
  }
}

function writePreview(key: string, options: SessionConfigOptionInfo[]): void {
  try {
    const payload = JSON.stringify(compactSelectorPreview(options))
    if (localStorage.getItem(entryKey(key)) === payload) return
    let index: unknown
    try {
      index = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")
    } catch {
      index = []
    }
    const keys = Array.isArray(index)
      ? index.filter(
          (item): item is string => typeof item === "string" && item !== key
        )
      : []
    keys.push(key)
    localStorage.setItem(entryKey(key), payload)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys.slice(-MAX_ENTRIES)))
    for (const evicted of keys.slice(0, -MAX_ENTRIES)) {
      localStorage.removeItem(entryKey(evicted))
    }
    // v1 duplicated full catalogs in one large blob. Do not parse it on the
    // opening path; existing SQLite values already cover cold-client display.
    localStorage.removeItem("codeg:conversation-selector-previews:v1")
  } catch {
    // Storage denial/quota must not prevent the live connection from opening.
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
    () => (key && !ready ? readPreview(key) : null),
    [key, ready]
  )
  useEffect(() => {
    if (!key || !ready || configOptions == null) return
    writePreview(key, configOptions)
  }, [key, ready, configOptions])
  return ready
    ? configOptions
    : (preview ??
        persistedSelectorPreview(
          persistedValues,
          getCachedSelectors(agentType)?.configOptions ?? null
        ))
}
