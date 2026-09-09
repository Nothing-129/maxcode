import type { SVGProps } from "react"

import { cn } from "@/lib/utils"

export type DesktopChromeIconName =
  | "sidebar"
  | "share"
  | "more"
  | "terminal"
  | "panel"
  | "settings"

/** Small optical-size drawings for the desktop title bar. */
export function DesktopChromeIcon({
  name,
  className,
  ...props
}: SVGProps<SVGSVGElement> & { name: DesktopChromeIconName }) {
  return (
    <svg
      {...props}
      aria-hidden="true"
      focusable="false"
      data-desktop-chrome-icon={name}
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4 shrink-0", className)}
    >
      {name === "sidebar" && (
        <>
          <rect x="3" y="4" width="14" height="12" rx="2.5" />
          <path d="M7.5 4v12" />
          <path d="M5.25 6.5v7" opacity=".25" strokeWidth="1.5" />
        </>
      )}
      {name === "share" && (
        <>
          <path d="M10 12V2.75m-3 3 3-3 3 3" />
          <path d="M6.25 8H5a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 5 17h10a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 15 8h-1.25" />
        </>
      )}
      {name === "more" && (
        <g fill="currentColor" stroke="none">
          <circle cx="5" cy="10" r="1" />
          <circle cx="10" cy="10" r="1" />
          <circle cx="15" cy="10" r="1" />
        </g>
      )}
      {name === "terminal" && (
        <>
          <rect x="3" y="4" width="14" height="12" rx="2.5" />
          <path d="m6 7.5 2.5 2.25L6 12m4.5 0H14" />
        </>
      )}
      {name === "panel" && (
        <>
          <rect x="3" y="4" width="14" height="12" rx="2.5" />
          <path d="M12.5 4v12" />
          <path d="M14.75 6.5v7" opacity=".25" strokeWidth="1.5" />
        </>
      )}
      {name === "settings" && (
        <>
          <path d="m8.4 2.75-.45 1.8-1.4.8-1.8-.5-1.6 2.8 1.35 1.3v1.6l-1.35 1.3 1.6 2.8 1.8-.5 1.4.8.45 1.8h3.2l.45-1.8 1.4-.8 1.8.5 1.6-2.8-1.35-1.3v-1.6l1.35-1.3-1.6-2.8-1.8.5-1.4-.8-.45-1.8Z" />
          <circle cx="10" cy="9.75" r="2.4" />
        </>
      )}
    </svg>
  )
}

export const desktopChromeButtonClassName =
  "h-6 w-6 rounded-md text-foreground/45 transition-colors hover:bg-foreground/5 hover:text-foreground/75 dark:hover:bg-foreground/10"
