import { AnimatePresence, motion, useIsPresent } from "motion/react"
import type { ReactNode } from "react"

import { useMediaQuery } from "@/hooks/use-media-query"

function TitleLayer({ children }: { children: ReactNode }) {
  const isPresent = useIsPresent()

  return (
    <motion.span
      className="col-start-1 row-start-1 grid min-w-0 max-w-full justify-self-center"
      inert={!isPresent || undefined}
      aria-hidden={!isPresent || undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: "easeInOut" }}
    >
      {children}
    </motion.span>
  )
}

export function ConversationTitleTransition({
  tabId,
  title,
  titleLocked,
  children,
}: {
  tabId: string
  title: string
  titleLocked?: boolean
  children: ReactNode
}) {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)")
  if (reducedMotion || titleLocked) return children

  return (
    <AnimatePresence key={tabId} initial={false}>
      <TitleLayer key={title}>{children}</TitleLayer>
    </AnimatePresence>
  )
}
