"use client"

import { isElectron, onTransportReconnect, subscribe } from "@/lib/platform"
import { getTransport } from "@/lib/transport"
import { toast } from "sonner"

export const WORKSPACE_PREFERENCE_KEYS = [
  "workspace:sidebar-folder-expanded",
  "workspace:sidebar-folder-group-expanded",
  "workspace:sidebar-todo-group-expanded",
  "workspace:sidebar-show-completed",
  "workspace:sidebar-show-worktrees",
  "workspace:sidebar-show-recent",
  "workspace:sidebar-show-todos",
  "workspace:sidebar-recent-filter",
  "workspace:sidebar-nav-items",
  "workspace:sidebar-sort-mode",
  "workspace:sidebar-section-order",
  "workspace:sidebar-section-collapsed",
  "workspace:sidebar-conversation-expanded",
  "workspace:left-sidebar",
  "workspace:right-sidebar",
] as const

const EVENT = "workspace-preferences://changed"
let cache: Record<string, string> = {}
const confirmed: Record<string, string> = {}
let loading: Promise<void> | null = null
let loaded = false
let wired = false
const listeners = new Set<() => void>()
const generations = new Map<string, number>()
const versions = new Map<string, number>()
const pending = new Set<string>()
let writes = Promise.resolve()
const panelTimers = new Map<string, ReturnType<typeof setTimeout>>()

function notify() {
  for (const listener of listeners) listener()
}

function apply(key: string, value: string) {
  if (!WORKSPACE_PREFERENCE_KEYS.includes(key as never)) return
  generations.set(key, (generations.get(key) ?? 0) + 1)
  versions.set(key, (versions.get(key) ?? 0) + 1)
  cache = { ...cache, [key]: value }
}

export function loadWorkspacePreferences(): Promise<void> {
  if (loading) return loading
  const started = new Map(versions)
  loading = (async () => {
    const fetched = await getTransport().call<Record<string, string>>(
      "get_workspace_preferences"
    )
    // Only Electron may seed old view state. Web localStorage is never truth.
    if (isElectron()) {
      for (const key of WORKSPACE_PREFERENCE_KEYS) {
        let legacy: string | null = null
        try {
          legacy = localStorage.getItem(key)
        } catch {
          // Storage can be disabled even though the backend is available.
        }
        if (fetched[key] === undefined && legacy !== null) {
          fetched[key] = await getTransport().call<string>(
            "set_workspace_preference",
            { key, value: legacy, initialize_only: true }
          )
        }
        if (fetched[key] !== undefined) {
          try {
            localStorage.removeItem(key)
          } catch {
            // Backend data already exists; stale local keys are ignored.
          }
        }
      }
    }
    for (const key of WORKSPACE_PREFERENCE_KEYS) {
      if (versions.get(key) !== started.get(key)) continue
      if (fetched[key] === undefined) delete confirmed[key]
      else confirmed[key] = fetched[key]
      if (pending.has(key)) continue
      if (fetched[key] === undefined) delete cache[key]
      else cache[key] = fetched[key]
    }
    loaded = true
    notify()
  })().finally(() => {
    loading = null
  })
  return loading
}

function ensureSync() {
  if (wired) return
  wired = true
  try {
    void subscribe<{ key: string; value: string }>(EVENT, ({ key, value }) => {
      if (pending.has(key)) return
      confirmed[key] = value
      apply(key, value)
      notify()
    })
      .then(() => loadWorkspacePreferences())
      .catch(() => {
        wired = false
      })
    onTransportReconnect(() => {
      void loadWorkspacePreferences().catch(() => {})
    })
  } catch {
    wired = false
  }
}

/** Re-read existing synchronous loaders after initial fetch or a remote edit. */
export function subscribeWorkspacePreferences(
  listener: () => void,
  keys: readonly string[] = WORKSPACE_PREFERENCE_KEYS
): () => void {
  let previous: string | undefined
  const onChange = () => {
    const next = JSON.stringify(keys.map((key) => cache[key]))
    if (previous === next) return
    previous = next
    listener()
  }
  listeners.add(onChange)
  ensureSync()
  if (loaded) onChange()
  else void loadWorkspacePreferences().catch(() => {})
  return () => {
    listeners.delete(onChange)
  }
}

/** Storage-shaped adapter lets existing validated parsers retain their defaults. */
export const workspacePreferenceStorage = {
  getItem(key: string): string | null {
    return cache[key] ?? null
  },
  setItem(key: string, value: string): void {
    if (!WORKSPACE_PREFERENCE_KEYS.includes(key as never)) return
    const previous = cache[key]
    if (previous === value) return
    apply(key, value)
    const generation = generations.get(key)
    pending.add(key)
    queueMicrotask(notify)
    // Serialize this client's writes; different keys are patched independently
    // on the host, so another client's unrelated edits cannot be overwritten.
    const persist = () => {
      writes = writes.then(async () => {
        if (generations.get(key) !== generation) return
        try {
          const saved = await getTransport().call<string>(
            "set_workspace_preference",
            {
              key,
              value,
            }
          )
          confirmed[key] = saved
          versions.set(key, (versions.get(key) ?? 0) + 1)
        } catch (error) {
          versions.set(key, (versions.get(key) ?? 0) + 1)
          if (generations.get(key) === generation) {
            if (confirmed[key] === undefined) delete cache[key]
            else cache[key] = confirmed[key]
            notify()
          }
          toast.error(String(error))
        } finally {
          if (generations.get(key) === generation) {
            pending.delete(key)
            void loadWorkspacePreferences().catch(() => {})
          }
        }
      })
    }
    // Resizing emits pointer-move updates; save the final geometry in a burst.
    if (key === "workspace:left-sidebar" || key === "workspace:right-sidebar") {
      clearTimeout(panelTimers.get(key))
      panelTimers.set(
        key,
        setTimeout(() => {
          panelTimers.delete(key)
          persist()
        }, 120)
      )
    } else {
      persist()
    }
  },
}
