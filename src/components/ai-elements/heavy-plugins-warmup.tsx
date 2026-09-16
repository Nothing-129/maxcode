"use client"

import { useEffect } from "react"
import { prefetchHeavyPlugins } from "./streamdown-plugins"

/**
 * Warms the shiki (code) syntax-highlighting engine shortly after first paint,
 * so the first code block in a streamed response doesn't pay a multi-MB dynamic
 * import + parse on the streaming hot path (which is what made the UI hitch "when
 * code first appears"). Renders nothing.
 *
 * Warmed on whichever of two triggers fires first (prefetch is idempotent):
 *   1. First user input — a one-shot, capture-phase pointerdown/keydown listener.
 *      The first interaction reliably precedes navigating to and streaming a
 *      conversation, so this closes the race where a quick click after launch
 *      opens a code conversation before the idle timer fires. Warming before any
 *      code is on screen also avoids the re-highlight burst a mid-render engine
 *      resolution would cause.
 *   2. Idle fallback — for the rarer read-without-interacting case.
 *      requestIdleCallback is absent in some WebKit clients, so fall back to
 *      a short timeout there.
 *
 * Only `code` is prefetched: it's by far the most common heavy engine in
 * coding-agent output. katex (`math`) and mermaid stay purely on-demand — they're
 * rarer and mermaid pulls the heaviest dep graph, so warming them for every
 * session would just re-inflate what the lazy split was meant to save.
 *
 * The bundle split point is untouched, so shiki stays OUT of the first-paint
 * chunk — this only schedules the import a beat later, off the critical path.
 * Every listener/handle is torn down on unmount.
 */
export function HeavyPluginsWarmup() {
  useEffect(() => {
    let warmed = false

    // A named declaration (hoisted) so it can reference itself for self-removal.
    // Self-removing + the `warmed` guard means the engine loads at most once and
    // no listener lingers past the first trigger.
    function warm() {
      if (warmed) return
      warmed = true
      window.removeEventListener("pointerdown", warm, true)
      window.removeEventListener("keydown", warm, true)
      prefetchHeavyPlugins(["code"])
    }

    // (1) Race-closer: warm the instant the user first engages. Capture phase so
    // it fires even if a descendant stops propagation.
    window.addEventListener("pointerdown", warm, true)
    window.addEventListener("keydown", warm, true)

    // (2) Idle baseline.
    let cancelIdle: () => void
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(warm, { timeout: 3000 })
      cancelIdle = () => {
        // Guard cancelIdleCallback independently — defensive against a partial
        // polyfill that shims requestIdleCallback but not its canceller.
        if (typeof window.cancelIdleCallback === "function") {
          window.cancelIdleCallback(handle)
        }
      }
    } else {
      const timer = setTimeout(warm, 1500)
      cancelIdle = () => clearTimeout(timer)
    }

    return () => {
      window.removeEventListener("pointerdown", warm, true)
      window.removeEventListener("keydown", warm, true)
      cancelIdle()
    }
  }, [])

  return null
}
