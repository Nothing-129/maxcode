"use client"

import { memo } from "react"
import { Pencil } from "lucide-react"
import { useTranslations } from "next-intl"
import { MessageAction } from "@/components/ai-elements/message"
import type { AdaptedContentPart } from "@/lib/adapters/ai-elements-adapter"
import { unescapeComposerText } from "@/lib/composer-copy-text"

export const SentMessageEditButton = memo(function SentMessageEditButton({
  parts,
  onEdit,
}: {
  parts: AdaptedContentPart[]
  onEdit?: (text: string) => void
}) {
  const t = useTranslations("Folder.chat.messageList")
  const text = parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n\n")
  if (!onEdit || !text.trim()) return null
  return (
    <MessageAction
      tooltip={t("editMessage")}
      size="icon-xs"
      className="max-md:hidden self-end opacity-0 transition-opacity group-hover/user-msg:opacity-100 group-focus-within/user-msg:opacity-100 focus-visible:opacity-100"
      onClick={() => onEdit(unescapeComposerText(text))}
    >
      <Pencil size={12} />
    </MessageAction>
  )
})
