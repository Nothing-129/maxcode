"use client"

import { createContext, useContext } from "react"
import type { ScrollToIndexOpts } from "virtua"

export interface MessageScrollContextValue {
  /** Release automatic following before manually expanding historical work. */
  stopFollowing?: () => void
  scrollToIndex: (index: number, opts?: ScrollToIndexOpts) => void
}

const MessageScrollContext = createContext<MessageScrollContextValue | null>(
  null
)

export const MessageScrollProvider = MessageScrollContext.Provider

export function useMessageScroll(): MessageScrollContextValue | null {
  return useContext(MessageScrollContext)
}
