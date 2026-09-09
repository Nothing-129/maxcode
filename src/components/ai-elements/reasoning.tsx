"use client"

import type { ComponentProps, ReactNode } from "react"

import { useControllableState } from "@radix-ui/react-use-controllable-state"
import { useTranslations } from "next-intl"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/instant-collapsible"
import { cn } from "@/lib/utils"
import { ChevronRightIcon } from "lucide-react"
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react"
import { Streamdown, defaultRemarkPlugins } from "streamdown"

import { Shimmer } from "./shimmer"
import {
  markdownLinkComponents,
  publicMarkdownLinkComponents,
} from "./markdown-link"
import { mermaidComponents } from "./mermaid-block"
import { normalizeMathDelimiters } from "./message"
import { remarkTrimCjkAutolinkTail } from "./remark-cjk-autolink-tail"
import { remarkAutolinkLocalPaths } from "./remark-autolink-local-paths"
import { remarkRewriteFileUriLinks } from "./remark-file-uri-links"
import { remarkRestoreWindowsPaths } from "./remark-windows-paths"
import { useStreamdownPlugins } from "./streamdown-plugins"

interface ReasoningContextValue {
  isStreaming: boolean
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  duration: number | undefined
  expandable: boolean
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null)

export const useReasoning = () => {
  const context = useContext(ReasoningContext)
  if (!context) {
    throw new Error("Reasoning components must be used within Reasoning")
  }
  return context
}

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  duration?: number
  expandable?: boolean
}

const MS_IN_S = 1000

export const Reasoning = memo(
  ({
    className,
    isStreaming = false,
    open,
    defaultOpen,
    onOpenChange,
    duration: durationProp,
    expandable = true,
    children,
    ...props
  }: ReasoningProps) => {
    // Keep live thinking compact; only the reader opts into the full text.
    const resolvedDefaultOpen = expandable && (defaultOpen ?? false)

    const [isOpen, setIsOpen] = useControllableState<boolean>({
      defaultProp: resolvedDefaultOpen,
      onChange: onOpenChange,
      prop: expandable ? open : false,
    })
    const [duration, setDuration] = useControllableState<number | undefined>({
      defaultProp: undefined,
      prop: durationProp,
    })

    const startTimeRef = useRef<number | null>(null)

    // Track when streaming starts and compute duration
    useEffect(() => {
      if (isStreaming) {
        if (startTimeRef.current === null) {
          startTimeRef.current = Date.now()
        }
      } else if (startTimeRef.current !== null) {
        setDuration(Math.ceil((Date.now() - startTimeRef.current) / MS_IN_S))
        startTimeRef.current = null
      }
    }, [isStreaming, setDuration])

    const handleOpenChange = useCallback(
      (newOpen: boolean) => {
        setIsOpen(newOpen)
      },
      [setIsOpen]
    )

    const contextValue = useMemo(
      () => ({ duration, isOpen, isStreaming, setIsOpen, expandable }),
      [duration, isOpen, isStreaming, setIsOpen, expandable]
    )

    return (
      <ReasoningContext.Provider value={contextValue}>
        <Collapsible
          className={cn("not-prose", className)}
          onOpenChange={handleOpenChange}
          open={isOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ReasoningContext.Provider>
    )
  }
)

export type ReasoningTriggerProps = ComponentProps<
  typeof CollapsibleTrigger
> & {
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode
}

export const ReasoningTrigger = memo(
  ({
    className,
    children,
    getThinkingMessage,
    ...props
  }: ReasoningTriggerProps) => {
    const t = useTranslations("Folder.chat.reasoning")
    const { isStreaming, isOpen, duration, expandable } = useReasoning()
    const defaultGetThinkingMessage = useCallback(
      (nextIsStreaming: boolean, nextDuration?: number) => {
        if (nextIsStreaming) {
          return (
            <Shimmer duration={1} shineColor="var(--primary)">
              {t("thinking")}
            </Shimmer>
          )
        }
        if (nextDuration === undefined || nextDuration === 0) {
          return <p>{t("thoughtForFewSeconds")}</p>
        }
        return <p>{t("thoughtForSeconds", { duration: nextDuration })}</p>
      },
      [t]
    )
    const thinkingMessageBuilder =
      getThinkingMessage ?? defaultGetThinkingMessage

    return (
      <CollapsibleTrigger
        className={cn(
          "flex max-w-full items-center gap-1 text-muted-foreground text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          expandable
            ? "hover:text-foreground"
            : "cursor-default hover:text-muted-foreground",
          className
        )}
        disabled={!expandable}
        {...props}
      >
        {children ?? (
          <>
            {thinkingMessageBuilder(isStreaming, duration)}
            {expandable && (
              <ChevronRightIcon
                className={cn(
                  "size-3.5 shrink-0 opacity-60 transition-transform",
                  isOpen ? "rotate-90" : "rotate-0"
                )}
              />
            )}
          </>
        )}
      </CollapsibleTrigger>
    )
  }
)

export type ReasoningContentProps = ComponentProps<
  typeof CollapsibleContent
> & {
  children: string
  linkMode?: "workspace" | "public"
}

const remarkPlugins = [
  ...Object.values(defaultRemarkPlugins),
  // Before remarkRewriteFileUriLinks, which reshapes a drive path's url.
  remarkRestoreWindowsPaths,
  remarkRewriteFileUriLinks,
  remarkAutolinkLocalPaths,
  remarkTrimCjkAutolinkTail,
]

const reasoningComponents = { ...markdownLinkComponents, ...mermaidComponents }
const publicReasoningComponents = {
  ...publicMarkdownLinkComponents,
  ...mermaidComponents,
}

export const ReasoningContent = memo(
  ({
    className,
    children,
    linkMode = "workspace",
    ...props
  }: ReasoningContentProps) => {
    // An explicitly expanded live panel still uses incremental Markdown parsing.
    const { isStreaming } = useReasoning()
    const normalized = useMemo(
      () => normalizeMathDelimiters(children),
      [children]
    )
    const plugins = useStreamdownPlugins(normalized)

    return (
      <CollapsibleContent
        className={cn(
          "mt-2 max-h-64 overflow-y-auto overscroll-contain border-l border-border/70 pl-3 pr-2 text-sm",
          "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-muted-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
          className
        )}
        {...props}
      >
        <Streamdown
          plugins={plugins}
          remarkPlugins={remarkPlugins}
          {...props}
          mode={isStreaming ? "streaming" : "static"}
          parseIncompleteMarkdown={isStreaming}
          // Enforce the link icon + safety override after spreading props.
          components={
            linkMode === "public"
              ? publicReasoningComponents
              : reasoningComponents
          }
        >
          {normalized}
        </Streamdown>
      </CollapsibleContent>
    )
  }
)

Reasoning.displayName = "Reasoning"
ReasoningTrigger.displayName = "ReasoningTrigger"
ReasoningContent.displayName = "ReasoningContent"
