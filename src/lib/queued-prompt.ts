import type { PromptCapabilitiesInfo, PromptDraft } from "@/lib/types"

/** Re-encode staged images using the capabilities negotiated AFTER enqueue. */
export function prepareQueuedPrompt(
  draft: PromptDraft,
  capabilities: PromptCapabilitiesInfo
): PromptDraft {
  return {
    ...draft,
    blocks: draft.blocks.map((block) => {
      if (block.type === "image" && !capabilities.image) {
        return {
          type: "resource" as const,
          uri: block.uri ?? "clipboard://queued-image",
          mime_type: block.mime_type,
          text: null,
          blob: block.data,
        }
      }
      if (
        capabilities.image &&
        block.type === "resource" &&
        block.mime_type?.startsWith("image/") &&
        block.blob
      ) {
        return {
          type: "image" as const,
          uri: block.uri.startsWith("clipboard://") ? null : block.uri,
          mime_type: block.mime_type,
          data: block.blob,
        }
      }
      return block
    }),
  }
}
