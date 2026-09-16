/**
 * Platform layer for OS notifications: deliver one, and report what the
 * platform will actually let us do.
 *
 * This module knows nothing about agent events, preferences or throttling —
 * that is `desktop-notification.ts`, which is what feature code should call.
 * Everything here is the thin, honest wrapper over two very different
 * substrates:
 *
 *   - Electron: its native notification bridge reports delivery failures.
 *   - Browser: the `Notification` API, whose permission is real, three-valued,
 *     and only requestable from inside a user gesture.
 */

import { getElectronBridge, isElectron } from "./electron"

/**
 * What the platform can tell us about permission to post notifications.
 *
 * `managed_by_os` means notification access is controlled by the operating
 * system. The desktop bridge cannot query that permission, so settings offer
 * a test notification instead of claiming delivery is granted.
 *
 * `unsupported` covers the browser case that bites real deployments: a
 * `codeg-server` reached over plain `http://` on a LAN address is not a secure
 * context, so `Notification` is simply absent.
 */
export type NotificationPermissionState =
  | "granted"
  | "denied"
  | "default"
  | "unsupported"
  | "managed_by_os"

/** The browser `Notification` constructor, or null when it isn't available. */
function browserNotification(): typeof Notification | null {
  if (typeof window === "undefined") return null
  const ctor = (window as { Notification?: typeof Notification }).Notification
  return typeof ctor === "function" ? ctor : null
}

/**
 * Current permission, without asking for it.
 *
 * Safe to call on every render: it reads a synchronous property and never
 * prompts.
 */
export function getNotificationPermission(): NotificationPermissionState {
  if (isElectron()) return "managed_by_os"
  const ctor = browserNotification()
  if (!ctor) return "unsupported"
  const permission = ctor.permission
  return permission === "granted" || permission === "denied"
    ? permission
    : "default"
}

/**
 * Ask the browser for permission and report where that landed.
 *
 * MUST be called from inside a user gesture. That is not a style preference:
 * Safari rejects a request made outside one, and Chrome ignores requests from a
 * page that isn't visible. The previous implementation requested permission
 * lazily from the event path, gated on `document.hidden` — i.e. only ever from
 * a background page with no gesture in scope, which is precisely the state in
 * which the request cannot succeed. The prompt now originates from the button
 * in Settings, and nowhere else.
 *
 * A no-op on desktop, where there is nothing to request.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (isElectron()) return "managed_by_os"
  const ctor = browserNotification()
  if (!ctor) return "unsupported"
  try {
    const result = await ctor.requestPermission()
    return result === "granted" || result === "denied" ? result : "default"
  } catch {
    // Older Safari hands back a callback-style API that rejects the promise
    // form; treat that as "still undecided" rather than a hard denial.
    return getNotificationPermission()
  }
}

/**
 * Post one notification, now. Throws if the platform reported a failure.
 *
 * Callers that are on an event path should go through `notifyDesktop` instead —
 * this bypasses every preference and gate.
 */
export async function deliverSystemNotification(
  title: string,
  body: string
): Promise<void> {
  const electron = getElectronBridge()
  if (electron) {
    if (!(await electron.notify(title, body))) {
      throw new Error("System notifications are unavailable on this desktop")
    }
    return
  }

  const ctor = browserNotification()
  if (!ctor) throw new Error("Notifications are not available in this context")
  // Never request permission from here: this runs on the event path, where a
  // request cannot succeed (see `requestNotificationPermission`). An
  // un-granted browser is simply a platform that won't deliver.
  if (ctor.permission !== "granted") {
    throw new Error("Notification permission has not been granted")
  }
  new ctor(title, { body })
}

/**
 * Open the OS pane that owns notification permission for this app.
 *
 * Desktop only — a browser's per-site permission lives in the browser's own UI,
 * which no page may open on its own. Throws when the desktop environment has no
 * such pane (some Linux setups), so the caller can say so rather than leave the
 * user staring at a button that did nothing.
 *
 * The Electron preload bridge opens the OS settings on the local machine.
 */
export async function openSystemNotificationSettings(): Promise<void> {
  const electron = getElectronBridge()
  if (electron) return electron.openNotificationSettings()
  throw new Error("System notification settings are only reachable on desktop")
}
