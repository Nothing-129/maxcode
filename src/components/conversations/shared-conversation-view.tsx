"use client"
/* eslint-disable @next/next/no-img-element -- shared snapshots carry data URLs that Next Image cannot optimize */

import { useEffect, useMemo, useState } from "react"
import { Bot, CalendarDays, Loader2, LockKeyhole } from "lucide-react"
import { useTranslations } from "next-intl"

import { MessageResponse } from "@/components/ai-elements/message"
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning"
import { getAgentLabel } from "@/lib/custom-agents"
import { readConversationShareToken } from "@/lib/conversation-share"
import {
  groupConversationShareRounds,
  mergeShareTextBlocks,
  splitShareUserText,
  type ConversationShareRound,
} from "@/lib/conversation-share-content"
import { Button } from "@/components/ui/button"
import type {
  ContentBlock,
  MessageTurn,
  SharedConversationSnapshot,
} from "@/lib/types"
import { cn } from "@/lib/utils"

function imageSource(data: string, mimeType: string) {
  const safeMime = /^image\/(png|jpeg|gif|webp)$/i.test(mimeType)
    ? mimeType
    : "image/png"
  return `data:${safeMime};base64,${data}`
}

function Block({
  block,
  role,
}: {
  block: ContentBlock
  role: MessageTurn["role"]
}) {
  const t = useTranslations("Folder.conversationCard")
  switch (block.type) {
    case "text":
      return role === "user" ? (
        <UserText text={block.text} />
      ) : (
        <div className="prose prose-sm max-w-none break-words dark:prose-invert">
          <MessageResponse linkMode="public">{block.text}</MessageResponse>
        </div>
      )
    case "thinking":
      return (
        <Reasoning defaultOpen={false}>
          <ReasoningTrigger />
          <ReasoningContent linkMode="public">{block.text}</ReasoningContent>
        </Reasoning>
      )
    case "tool_use":
      return (
        <details className="rounded-lg border border-border/60 px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">
            {block.tool_name}
          </summary>
          {block.input_preview ? (
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">
              {block.input_preview}
            </pre>
          ) : null}
        </details>
      )
    case "tool_result":
      return (
        <div className="space-y-2">
          {block.output_preview ? (
            <details className="rounded-lg border border-border/60 px-3 py-2 text-sm">
              <summary
                className={cn(
                  "cursor-pointer",
                  block.is_error ? "text-destructive" : "text-muted-foreground"
                )}
              >
                {block.is_error ? t("shareToolError") : t("shareToolResult")}
              </summary>
              <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">
                {block.output_preview}
              </pre>
            </details>
          ) : null}
          {block.images?.map((image, index) => (
            <img
              key={index}
              src={imageSource(image.data, image.mime_type)}
              alt=""
              className="max-h-[32rem] max-w-full rounded-lg border object-contain"
            />
          ))}
        </div>
      )
    case "image":
      return (
        <img
          src={imageSource(block.data, block.mime_type)}
          alt=""
          className="max-h-[32rem] max-w-full rounded-lg border object-contain"
        />
      )
    case "image_generation":
      return (
        <div className="space-y-2">
          {block.revised_prompt ? (
            <p className="text-sm text-muted-foreground">
              {block.revised_prompt}
            </p>
          ) : null}
          {block.image ? (
            <img
              src={imageSource(block.image.data, block.image.mime_type)}
              alt=""
              className="max-h-[32rem] max-w-full rounded-lg border object-contain"
            />
          ) : null}
        </div>
      )
    case "plan":
      return (
        <ul className="list-inside list-disc text-sm">
          {block.entries.map((entry, index) => (
            <li key={index}>{entry.content}</li>
          ))}
        </ul>
      )
  }
}

function UserText({ text }: { text: string }) {
  const t = useTranslations("Folder.conversationCard")
  const content = splitShareUserText(text)
  return (
    <div className="space-y-2 text-sm leading-7">
      <div className="whitespace-pre-wrap break-words">{content.text}</div>
      {content.metadata ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            {t("shareSessionDetails")}
          </summary>
          <pre className="mt-2 whitespace-pre-wrap break-all font-sans">
            {content.metadata}
          </pre>
        </details>
      ) : null}
    </div>
  )
}

function SharedRound({ round }: { round: ConversationShareRound }) {
  const t = useTranslations("Folder.conversationCard")
  const [processOpen, setProcessOpen] = useState(false)
  const replyBlocks = round.replies.flatMap((turn) => turn.blocks)
  const isExecution = (block: ContentBlock) =>
    ["tool_use", "tool_result", "thinking", "plan"].includes(block.type)
  const process = replyBlocks.filter(isExecution)
  const answer = mergeShareTextBlocks(
    replyBlocks.filter((block) => !isExecution(block))
  )
  return (
    <article className="min-w-0 space-y-6" data-share-round={round.number}>
      {round.user ? (
        <div className="ml-auto space-y-2 rounded-2xl bg-secondary px-4 py-3 md:max-w-[85%]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-medium">{t("shareRoleUser")}</span>
            <time dateTime={round.user.timestamp}>
              {new Date(round.user.timestamp).toLocaleString()}
            </time>
          </div>
          {round.user.blocks.map((block, index) => (
            <Block key={index} block={block} role="user" />
          ))}
        </div>
      ) : null}
      {answer.length || process.length ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Bot className="size-3.5" />
            {t("shareRoleAssistant")}
          </div>
          {answer.map((block, index) => (
            <Block key={index} block={block} role="assistant" />
          ))}
          {process.length ? (
            <details
              className="rounded-xl border border-border/60 px-3 py-2 text-sm"
              onToggle={(event) => setProcessOpen(event.currentTarget.open)}
            >
              <summary className="cursor-pointer text-muted-foreground">
                {t("shareExecution", { count: process.length })}
              </summary>
              {processOpen ? (
                <div className="mt-3 space-y-3">
                  {process.map((block, index) => (
                    <Block key={index} block={block} role="assistant" />
                  ))}
                </div>
              ) : null}
            </details>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

export function SharedConversationView() {
  const t = useTranslations("Folder.conversationCard")
  const [snapshot, setSnapshot] = useState<SharedConversationSnapshot | null>(
    null
  )
  const [error, setError] = useState(false)
  const [visibleRounds, setVisibleRounds] = useState(10)
  const rounds = useMemo(() => {
    if (!snapshot) return []
    const options = snapshot.version >= 2 ? snapshot.share_options : undefined
    const turns = snapshot.turns
      .map((turn) => ({
        ...turn,
        blocks: turn.blocks.flatMap((block): ContentBlock[] => {
          if (block.type === "tool_result" && options?.includeTools !== true) {
            return (block.images ?? []).map((image) => ({
              type: "image",
              data: image.data,
              mime_type: image.mime_type,
            }))
          }
          if (
            block.type === "tool_use" ||
            block.type === "tool_result" ||
            block.type === "plan"
          )
            return options?.includeTools === true ? [block] : []
          if (block.type === "thinking")
            return options?.includeThinking === true ? [block] : []
          if (
            block.type === "image_generation" &&
            options?.includeTools !== true
          )
            return [{ ...block, revised_prompt: null }]
          return [block]
        }),
      }))
      .filter((turn) => turn.blocks.length > 0)
    return groupConversationShareRounds(turns)
  }, [snapshot])

  useEffect(() => {
    const token = readConversationShareToken(window.location.hash)
    if (!token) {
      const timeout = window.setTimeout(() => setError(true), 0)
      return () => window.clearTimeout(timeout)
    }
    const controller = new AbortController()
    fetch("/api/shared_conversation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        return (await response.json()) as SharedConversationSnapshot
      })
      .then(setSnapshot)
      .catch((fetchError) => {
        if (
          fetchError instanceof DOMException &&
          fetchError.name === "AbortError"
        )
          return
        setError(true)
      })
    return () => controller.abort()
  }, [])

  if (error) {
    return (
      <main className="grid min-h-dvh place-items-center bg-background p-6">
        <div className="max-w-md text-center">
          <LockKeyhole className="mx-auto mb-4 size-10 text-muted-foreground" />
          <h1 className="text-xl font-semibold">
            {t("shareUnavailableTitle")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("shareUnavailableDescription")}
          </p>
        </div>
      </main>
    )
  }

  if (!snapshot) {
    return (
      <main className="grid min-h-dvh place-items-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    )
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-start justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground">
              MaxCode · {t("shareRoundCount", { count: rounds.length })}
            </p>
            <h1 className="line-clamp-2 text-base font-semibold sm:text-lg">
              {snapshot.title || t("untitledConversation")}
            </h1>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Bot className="size-3.5" />
                {getAgentLabel(snapshot.agent_type)}
                {snapshot.model ? ` · ${snapshot.model}` : ""}
              </span>
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="size-3.5" />
                {new Date(snapshot.shared_at).toLocaleString()}
              </span>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
            <LockKeyhole className="size-3" />
            {t("shareReadOnly")}
          </span>
        </div>
      </header>
      <div className="mx-auto max-w-3xl space-y-10 px-4 py-6 sm:px-6 sm:py-10">
        {rounds.slice(0, visibleRounds).map((round) => (
          <SharedRound key={round.number} round={round} />
        ))}
        {rounds.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">
            {t("shareEmpty")}
          </p>
        ) : null}
        {visibleRounds < rounds.length ? (
          <div className="flex justify-center border-t pt-6">
            <Button
              variant="outline"
              onClick={() => setVisibleRounds((count) => count + 10)}
            >
              {t("shareLoadMore", {
                count: Math.min(10, rounds.length - visibleRounds),
              })}
            </Button>
          </div>
        ) : null}
        <p className="border-t pt-6 text-center text-xs leading-5 text-muted-foreground">
          {t("shareSnapshotHint")}
        </p>
      </div>
    </main>
  )
}
