"use client"
/* eslint-disable @next/next/no-img-element -- shared snapshots carry data URLs that Next Image cannot optimize */

import { useEffect, useState } from "react"
import { Bot, CalendarDays, Loader2, LockKeyhole } from "lucide-react"
import { useTranslations } from "next-intl"

import { MessageResponse } from "@/components/ai-elements/message"
import { getAgentLabel } from "@/lib/custom-agents"
import { readConversationShareToken } from "@/lib/conversation-share"
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
  switch (block.type) {
    case "text":
      return role === "user" ? (
        <div className="whitespace-pre-wrap break-words text-sm">
          {block.text}
        </div>
      ) : (
        <div className="prose prose-sm max-w-none break-words dark:prose-invert">
          <MessageResponse>{block.text}</MessageResponse>
        </div>
      )
    case "thinking":
      return (
        <details className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Thinking
          </summary>
          <div className="mt-2 whitespace-pre-wrap break-words">
            {block.text}
          </div>
        </details>
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
                {block.is_error ? "Tool error" : "Tool result"}
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

function Turn({ turn }: { turn: MessageTurn }) {
  const t = useTranslations("Folder.conversationCard")
  const roleLabel =
    turn.role === "user"
      ? t("shareRoleUser")
      : turn.role === "assistant"
        ? t("shareRoleAssistant")
        : t("shareRoleSystem")
  return (
    <article
      className={cn(
        "space-y-2",
        turn.role === "user" &&
          "ml-auto max-w-[85%] rounded-2xl bg-secondary px-4 py-3"
      )}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{roleLabel}</span>
        <time dateTime={turn.timestamp}>
          {new Date(turn.timestamp).toLocaleString()}
        </time>
      </div>
      <div className="space-y-3">
        {turn.blocks.map((block, index) => (
          <Block key={index} block={block} role={turn.role} />
        ))}
      </div>
    </article>
  )
}

export function SharedConversationView() {
  const t = useTranslations("Folder.conversationCard")
  const [snapshot, setSnapshot] = useState<SharedConversationSnapshot | null>(
    null
  )
  const [error, setError] = useState(false)

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
        <div className="mx-auto flex max-w-4xl items-start justify-between gap-4 px-5 py-4">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">
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
      <div className="mx-auto max-w-4xl space-y-8 px-5 py-8">
        {snapshot.turns.map((turn) => (
          <Turn key={`${turn.role}-${turn.id}`} turn={turn} />
        ))}
      </div>
    </main>
  )
}
