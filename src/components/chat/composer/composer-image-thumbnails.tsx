"use client"

import { useState, type ReactNode } from "react"
import { AnimatePresence, motion, useIsPresent } from "motion/react"
import { useMediaQuery } from "@/hooks/use-media-query"
import { ScreenshotMarkupDialog } from "./image-markup-dialog"
import type { MarkupMark } from "@/lib/image-markup"
import { toast } from "sonner"
import Image from "next/image"
import { useTranslations } from "next-intl"
import { Loader2, Pencil, X } from "lucide-react"

import { ImagePreviewDialog } from "@/components/ui/image-preview-dialog"
import {
  ImageActions,
  useImageActions,
} from "@/components/message/image-actions"
import type { UserImageDisplay } from "@/lib/adapters/ai-elements-adapter"
import type { ImageInputAttachment } from "@/components/chat/message-input-attachments"

/** The staged attachment reshaped for the shared transcript image actions. */
function toDisplay(attachment: ImageInputAttachment): UserImageDisplay {
  return {
    name: attachment.name,
    data: attachment.data,
    mime_type: attachment.mimeType,
    uri: attachment.uri,
  }
}

/** Removed tiles may paint briefly, but their controls stop responding at once. */
function AttachmentInteraction({ children }: { children: ReactNode }) {
  const present = useIsPresent()
  return (
    <div inert={!present} aria-hidden={!present}>
      {children}
    </div>
  )
}

/**
 * The composer's image attachment strip: one thumbnail per pasted / dropped /
 * picked image, each clickable for a full preview and removable in place.
 *
 * Renders as a bare list of tiles for the shared composer scrollport. The
 * host wraps tiles in normal flow above file cards and text. The preview dialog
 * is owned here because no host needs its state.
 *
 * Tiles and the blown-up preview carry the same right-click Copy / Download
 * menu as transcript images (`ImageActions`); without it a right-click on a
 * staged image fell through to the composer's own text context menu, whose
 * Copy row copies nothing for an image.
 */
export function ComposerImageThumbnails({
  attachments,
  onRemove,
  onMarkup,
}: {
  attachments: ImageInputAttachment[]
  onRemove: (id: string) => void
  onMarkup?: (
    id: string,
    image: Blob,
    text: string,
    marks: MarkupMark[]
  ) => Promise<void>
}) {
  const [markupId, setMarkupId] = useState<string | null>(null)
  const markup = attachments.find((a) => a.id === markupId)
  const tMarkup = useTranslations("ImageMarkup")
  const t = useTranslations("Folder.chat.messageInput")
  // The shared image actions live in the transcript's namespace; reusing the
  // exact keys keeps the two menus identical in every locale.
  const tImage = useTranslations("Folder.chat.messageList")
  const [previewId, setPreviewId] = useState<string | null>(null)
  const { canCopy, copy, download } = useImageActions()
  const preview = previewId
    ? (attachments.find((a) => a.id === previewId) ?? null)
    : null
  const previewDisplay = preview ? toDisplay(preview) : null
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)")

  return (
    <>
      <AnimatePresence initial={false} mode="sync">
        {attachments.map((attachment) => (
          <motion.div
            key={attachment.id}
            layout={reduced ? false : "position"}
            initial={{
              opacity: 0,
              y: reduced ? 0 : 5,
              scale: reduced ? 1 : 0.96,
            }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{
              opacity: 0,
              y: reduced ? 0 : -3,
              scale: reduced ? 1 : 0.96,
            }}
            transition={{
              duration: reduced ? 0.1 : 0.18,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="relative shrink-0"
            data-attachment-tile={attachment.id}
          >
            <AttachmentInteraction>
              <ImageActions
                image={toDisplay(attachment)}
                className="relative shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted/30"
              >
                <button
                  type="button"
                  onClick={() => setPreviewId(attachment.id)}
                  className="cursor-pointer transition-opacity hover:opacity-80"
                >
                  <Image
                    src={`data:${attachment.mimeType};base64,${attachment.data}`}
                    alt={attachment.name}
                    width={56}
                    height={56}
                    unoptimized
                    className="h-14 w-14 object-cover"
                  />
                </button>
                <AnimatePresence initial={false}>
                  {attachment.uploading ? (
                    // Web/remote upload still in flight — sends are gated on this
                    // settling (see the host's send handler).
                    <motion.div
                      key="upload"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: reduced ? 0 : 0.14 }}
                      className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/50"
                    >
                      <Loader2 className="h-4 w-4 animate-spin text-foreground/80 motion-reduce:animate-none" />
                    </motion.div>
                  ) : null}
                </AnimatePresence>
                {onMarkup && !attachment.uploading && (
                  <button
                    type="button"
                    className="absolute bottom-1 left-1 rounded-sm bg-background/80 p-0.5 hover:bg-background"
                    aria-label={tMarkup("markupTitle")}
                    onClick={() => setMarkupId(attachment.id)}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onRemove(attachment.id)}
                  className="absolute right-1 top-1 rounded-sm bg-background/70 p-0.5 hover:bg-background"
                  aria-label={t("removeAttachmentAria", {
                    name: attachment.name,
                  })}
                >
                  <X className="h-3 w-3" />
                </button>
              </ImageActions>
            </AttachmentInteraction>
          </motion.div>
        ))}
      </AnimatePresence>
      {markup && onMarkup && (
        <ScreenshotMarkupDialog
          key={markup.id}
          capture={
            markup.markupSource ?? { mime: markup.mimeType, data: markup.data }
          }
          initialMarks={markup.markupSource?.marks}
          text=""
          onCancel={() => setMarkupId(null)}
          onFailed={(error) => {
            setMarkupId(null)
            toast.error(tMarkup("failed"), { description: String(error) })
          }}
          onSend={async (result) => {
            if (result.image)
              await onMarkup(markup.id, result.image, result.text, result.marks)
            setMarkupId(null)
          }}
        />
      )}
      <ImagePreviewDialog
        src={preview ? `data:${preview.mimeType};base64,${preview.data}` : ""}
        alt={preview?.name ?? ""}
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewId(null)
        }}
        onDownload={
          previewDisplay ? () => void download(previewDisplay) : undefined
        }
        downloadLabel={tImage("downloadImage")}
        onCopy={
          previewDisplay && canCopy
            ? () => void copy(previewDisplay)
            : undefined
        }
        copyLabel={tImage("copyImage")}
        renderImage={
          previewDisplay
            ? (image) => (
                <ImageActions image={previewDisplay}>{image}</ImageActions>
              )
            : undefined
        }
      />
    </>
  )
}
