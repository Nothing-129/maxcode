"use client"

import * as React from "react"

import { openUrl } from "@/lib/platform"

/**
 * A link to somewhere outside the app — the ONLY way to write one.
 *
 * Route clicks through `openUrl`: Electron opens the system browser through
 * its preload bridge, and browsers use `window.open`. The retired Tauri shell
 * required this wrapper because it had no native new-window handler. The
 * shared wrapper still gives external links consistent handling across clients.
 *
 * `href`/`target`/`rel` remain on the element for "copy link address", status-bar
 * previews, assistive technology, and browser-native auxiliary clicks.
 *
 * `preventDefault` avoids opening a second tab through the anchor's default
 * action. Modified clicks (⌘/ctrl/shift) also use `openUrl` so the destination
 * stays under the platform wrapper's control.
 *
 * An `onClick` of your own runs FIRST — pass one to `stopPropagation` inside a
 * clickable card. Call `preventDefault` in it to keep the link from opening at
 * all (the conventional "I handled this myself").
 */
export function BrowserLink({
  href,
  onClick,
  children,
  ...props
}: Omit<React.ComponentProps<"a">, "href" | "target"> & { href: string }) {
  return (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented) return
        e.preventDefault()
        void openUrl(href)
      }}
    >
      {children}
    </a>
  )
}
