import { getTransport } from "./transport"
import type { EventStream, UnsubscribeFn } from "./transport/types"
import { getElectronBridge, isElectron } from "./electron"
import type { ElectronOpenDialogOptions } from "./electron"

export { isElectron }

/** Native operations are available through the Electron preload bridge. */
export const isNativeDesktop = isElectron
export const isLocalDesktop = isElectron

/**
 * Subscribe to backend events.
 * Uses the shared WebSocket event transport.
 */
export async function subscribe<T>(
  event: string,
  handler: (payload: T) => void
): Promise<UnsubscribeFn> {
  return getTransport().subscribe(event, handler)
}

/** Re-sync state after the shared WebSocket transport reconnects. */
export function onTransportReconnect(
  callback: () => void
): UnsubscribeFn | null {
  return getTransport().onReconnect?.(callback) ?? null
}

/** Per-connection snapshot stream, with automatic re-attachment on reconnect. */
export function getEventStream(): EventStream | null {
  const transport = getTransport()
  const factory = transport.eventStream
  if (!factory) return null
  return factory.call(transport)
}

/** Open a URL in the desktop browser or a new browser tab. */
export async function openUrl(url: string): Promise<void> {
  const electron = getElectronBridge()
  if (electron) return electron.openExternal(url)
  window.open(url, "_blank", "noreferrer")
}

/**
 * Open a path in the system file manager (desktop only).
 * No-op in web mode.
 */
export async function openPath(path: string): Promise<void> {
  if (!isLocalDesktop()) return
  const electron = getElectronBridge()
  if (electron) return electron.openPath(path)
}

/**
 * Reveal a file/directory in the system file manager (desktop only).
 * No-op in web mode.
 */
export async function revealItemInDir(path: string): Promise<void> {
  if (!isLocalDesktop()) return
  const electron = getElectronBridge()
  if (electron) return electron.revealItemInDir(path)
}

/**
 * Open a native file/directory dialog (desktop) or fallback (web).
 */
export async function openFileDialog(
  options?: ElectronOpenDialogOptions
): Promise<string | string[] | null> {
  const electron = getElectronBridge()
  if (electron && isLocalDesktop()) {
    const paths = await electron.openFileDialog(options ?? {})
    return options?.multiple ? paths : (paths?.[0] ?? null)
  }

  // Web fallback: for directory selection, prompt for server-side path.
  // For file selection, use a hidden file input.
  if (options?.directory) {
    const path = window.prompt(
      options?.title ?? "输入服务端目录路径 (Enter server directory path)"
    )
    return path || null
  }
  return new Promise((resolve) => {
    const input = document.createElement("input")
    input.type = "file"
    if (options?.multiple) input.multiple = true
    input.onchange = () => {
      if (!input.files?.length) {
        resolve(null)
        return
      }
      const paths = Array.from(input.files).map((f) => f.name)
      resolve(options?.multiple ? paths : paths[0])
    }
    input.click()
  })
}

/** Close the desktop window or return to the previous browser page. */
export async function closeCurrentWindow(): Promise<void> {
  const electron = getElectronBridge()
  if (electron) return electron.closeWindow()
  window.history.back()
}
