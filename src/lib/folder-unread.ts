import type { DbConversationSummary } from "@/lib/types"

/** Include pinned and filtered-out completed sessions even when folders collapse. */
export function collectUnreadFolders(
  conversations: readonly Pick<
    DbConversationSummary,
    "id" | "folder_id" | "status" | "kind"
  >[],
  unreadIds: ReadonlySet<number>,
  displayChildToParent: ReadonlyMap<number, number>
): ReadonlySet<number> {
  const folders = new Set<number>()
  for (const conversation of conversations) {
    if (
      !unreadIds.has(conversation.id) ||
      conversation.status === "in_progress" ||
      conversation.kind === "chat"
    )
      continue
    folders.add(
      displayChildToParent.get(conversation.folder_id) ?? conversation.folder_id
    )
  }
  return folders
}
