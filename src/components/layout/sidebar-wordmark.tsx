"use client"

import { useId } from "react"
import { isRunningConversationStatus } from "@/lib/conversation-unread"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import styles from "./sidebar-wordmark.module.css"

/** A compact, theme-aware wordmark; decorative shapes stay out of navigation. */
export function SidebarWordmark() {
  const gradientId = useId()
  // Subscribe to one boolean, so streaming updates do not rerender the wordmark.
  const isWorking = useAppWorkspaceStore((state) =>
    state.conversations.some((conversation) =>
      isRunningConversationStatus(conversation.status)
    )
  )

  return (
    <span
      role="img"
      aria-label="MaxCode"
      className="inline-flex shrink-0 items-center gap-3 select-none"
    >
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 12 24"
        className={`h-7 w-3.5 text-[#285ee1] dark:text-[#82a4ff] ${styles.slash}`}
        data-working={isWorking}
        fill="none"
      >
        <defs>
          <linearGradient
            id={gradientId}
            x1="9"
            y1="4"
            x2="3"
            y2="20"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" className={styles.blue} />
            <stop offset="50%" className={styles.cyan} />
            <stop offset="100%" className={styles.purple} />
          </linearGradient>
        </defs>
        <path
          d="M9 4 3 20"
          stroke="currentColor"
          strokeWidth="4.2"
          strokeLinecap="round"
        />
        <g className={styles.glow}>
          <path
            d="M9 4 3 20"
            stroke={`url(#${gradientId})`}
            strokeWidth="4.2"
            strokeLinecap="round"
          />
        </g>
      </svg>
      <span aria-hidden="true" className="flex items-baseline leading-none">
        <span className="text-[24px] font-bold tracking-[-0.065em] text-sidebar-foreground">
          Max
        </span>
        <span className="font-mono text-[22px] font-medium tracking-[-0.075em] text-sidebar-foreground/70">
          Code
        </span>
      </span>
    </span>
  )
}
