import type { JSONContent } from "@tiptap/core"
import type { TabItemInternal } from "@/stores/tab-store"
import {
  buildNewConversationDraftStorageKey,
  loadMessageInputDraftV2,
  saveMessageInputDraft,
  saveMessageInputDraftV2,
} from "@/lib/message-input-draft"

export interface ArchivedPaneDraft {
  tab: TabItemInternal
  content: NonNullable<ReturnType<typeof loadMessageInputDraftV2>>
}
const KEY = "workspace:closed-pane-drafts:v1"

function hasContent(node: JSONContent): boolean {
  return (
    !!node.text?.trim() ||
    node.type === "reference" ||
    !!node.content?.some(hasContent)
  )
}

export function capturePaneDraft(
  tab: TabItemInternal
): ArchivedPaneDraft | null {
  if (tab.conversationId != null) return null
  const content = loadMessageInputDraftV2(
    buildNewConversationDraftStorageKey(tab.id)
  )
  if (
    !content ||
    !(content.kind === "doc"
      ? hasContent(content.doc)
      : content.markdown.trim())
  )
    return null
  return { tab: { ...tab, runtimeConversationId: undefined }, content }
}

export function readPaneDraftArchive(): ArchivedPaneDraft[] {
  if (typeof localStorage === "undefined") return []
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]")
    if (!Array.isArray(value)) return []
    return value.filter(
      (entry): entry is ArchivedPaneDraft =>
        entry?.tab?.kind === "conversation" &&
        typeof entry.tab.id === "string" &&
        entry.tab.conversationId === null &&
        typeof entry.tab.folderId === "number" &&
        typeof entry.tab.agentType === "string" &&
        (entry.content?.kind === "legacyMarkdown"
          ? typeof entry.content.markdown === "string"
          : entry.content?.kind === "doc" && entry.content.doc?.type === "doc")
    )
  } catch {
    return []
  }
}

export function writePaneDraftArchive(drafts: ArchivedPaneDraft[]) {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(KEY, JSON.stringify(drafts))
  } catch {
    /* Keep the in-memory copy. */
  }
}

export function restorePaneDraftContent(draft: ArchivedPaneDraft) {
  const key = buildNewConversationDraftStorageKey(draft.tab.id)
  if (draft.content.kind === "doc")
    saveMessageInputDraftV2(key, draft.content.doc)
  else saveMessageInputDraft(key, draft.content.markdown)
}
