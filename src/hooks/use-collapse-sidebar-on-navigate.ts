"use client"

import { useCallback } from "react"

import { useSidebarContext } from "@/contexts/sidebar-context"
import { useIsCoarsePointer } from "@/hooks/use-is-coarse-pointer"
import { useIsMobile } from "@/hooks/use-mobile"

/**
 * The touch variant of "navigate away from the sidebar": on a phone the sidebar
 * is a Drawer, and a coarse-pointer device in the desktop shell (landscape
 * phone ≥768px, "request desktop site") renders it inline where its 320px still
 * crowds a phone-width viewport. Entry points OUTSIDE the sidebar that start
 * something new — the title bar's / tab strip's "new conversation" buttons —
 * must get it out of the way, exactly like the sidebar's own rows do
 * (`Sidebar` collapses itself on the same predicate).
 *
 * Returns a stable no-op on precise-pointer (desktop) layouts, so call sites
 * never need their own device branching.
 */
export function useCollapseSidebarOnNavigate() {
  const { close } = useSidebarContext()
  const isMobile = useIsMobile()
  const isCoarsePointer = useIsCoarsePointer()
  return useCallback(() => {
    if (isMobile || isCoarsePointer) close()
  }, [close, isCoarsePointer, isMobile])
}
