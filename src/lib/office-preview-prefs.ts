// Auto-preview is opt-in. The versioned key intentionally ignores legacy
// preferences so existing installations also start disabled after upgrading.

import { useEffect, useState } from "react"

const AUTO_PREVIEW_KEY = "workspace:office-auto-preview:v2"
const AUTO_PREVIEW_EVENT = "codeg:office-auto-preview-changed"

export function loadOfficeAutoPreview(): boolean {
  if (typeof window === "undefined") return false
  try {
    // Only a manual opt-in under the new policy enables previews.
    return localStorage.getItem(AUTO_PREVIEW_KEY) === "true"
  } catch {
    return false
  }
}

export function saveOfficeAutoPreview(value: boolean): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(AUTO_PREVIEW_KEY, String(value))
  } catch {
    /* ignore */
  }
  // Notify same-window listeners (settings + workspace may share a window);
  // cross-window/tab updates arrive via the native `storage` event.
  window.dispatchEvent(new CustomEvent(AUTO_PREVIEW_EVENT, { detail: value }))
}

/**
 * Reactive read of the auto-preview preference. Updates live when the toggle
 * changes — in this window (custom event) or another window/tab (storage
 * event) — so flipping it in the Settings window takes effect in the
 * workspace immediately, without a reload.
 */
export function useOfficeAutoPreview(): boolean {
  const [enabled, setEnabled] = useState<boolean>(loadOfficeAutoPreview)
  useEffect(() => {
    const sync = () => setEnabled(loadOfficeAutoPreview())
    window.addEventListener(AUTO_PREVIEW_EVENT, sync)
    window.addEventListener("storage", sync)
    return () => {
      window.removeEventListener(AUTO_PREVIEW_EVENT, sync)
      window.removeEventListener("storage", sync)
    }
  }, [])
  return enabled
}
