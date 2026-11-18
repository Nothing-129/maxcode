"use client"
/* eslint-disable @next/next/no-img-element -- snapshot images are self-contained data URLs */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useTranslations } from "next-intl"
import { Download } from "lucide-react"
import { ImagePreviewDialog } from "@/components/ui/image-preview-dialog"
import type { SharedFile } from "@/lib/types"

export const SharedFilesContext = createContext<SharedFile[]>([])

export function useSharedFile(href?: string) {
  const files = useContext(SharedFilesContext)
  const match = href?.match(/^#maxcode-file-(\d+)$/)
  return match ? files[Number(match[1])] : undefined
}

export function SharedImage({
  src,
  name,
  alt,
}: {
  src: string
  name: string
  alt: string
}) {
  const [open, setOpen] = useState(false)
  const download = useRef<HTMLAnchorElement>(null)
  const t = useTranslations("Folder.chat.messageList")
  return (
    <span className="inline-flex max-w-full flex-col items-start gap-1 align-middle">
      <button
        type="button"
        className="max-w-full cursor-zoom-in"
        onClick={() => setOpen(true)}
      >
        <img
          src={src}
          alt={alt || name}
          className="max-h-[32rem] max-w-full rounded-lg border object-contain"
        />
      </button>
      <a
        ref={download}
        download={name}
        href={src}
        className="inline-flex items-center gap-1 text-xs text-primary underline"
      >
        <Download aria-hidden className="size-3" />
        {t("downloadImage")}
      </a>
      {open && (
        <ImagePreviewDialog
          src={src}
          alt={alt || name}
          open={open}
          onOpenChange={setOpen}
          onDownload={() => download.current?.click()}
          downloadLabel={t("downloadImage")}
        />
      )}
    </span>
  )
}

// Open only passive formats in a browser tab. HTML and SVG documents can
// contain scripts, so HTML is shown as source and SVG stays in an image tag.
const previewTypes = new Map([
  ["pdf", "application/pdf"],
  ...[
    "txt",
    "log",
    "md",
    "csv",
    "tsv",
    "json",
    "yaml",
    "yml",
    "xml",
    "html",
    "mmd",
  ].map((ext): [string, string] => [ext, "text/plain;charset=utf-8"]),
  ["mp4", "video/mp4"],
  ["webm", "video/webm"],
  ["mp3", "audio/mpeg"],
  ["wav", "audio/wav"],
] as [string, string][])

function PreviewFile({ data, type }: { data: string; type: string }) {
  const t = useTranslations("Folder.fileWorkspace")
  const url = useRef<string | null>(null)
  useEffect(
    () => () => {
      if (url.current) URL.revokeObjectURL(url.current)
      url.current = null
    },
    [data, type]
  )
  return (
    <button
      type="button"
      className="ml-2 text-xs text-primary underline"
      onClick={() => {
        if (!url.current) {
          const bytes = Uint8Array.from(atob(data), (char) =>
            char.charCodeAt(0)
          )
          url.current = URL.createObjectURL(new Blob([bytes], { type }))
        }
        window.open(url.current, "_blank", "noopener,noreferrer")
      }}
    >
      {t("preview")}
    </button>
  )
}

export function SharedFileLink({
  file,
  children,
  label,
}: {
  file: SharedFile
  children: ReactNode
  label: string
}) {
  const t = useTranslations("Folder.conversationCard")
  if (file.data == null)
    return (
      <span className="text-muted-foreground">
        {children} ({t("shareFileUnavailable")})
      </span>
    )
  const ext = file.name.split(".").pop()?.toLowerCase()
  const imageType = ext === "svg" ? "svg+xml" : ext === "jpg" ? "jpeg" : ext
  if (
    imageType &&
    ["png", "jpeg", "webp", "gif", "avif", "bmp", "svg+xml"].includes(imageType)
  ) {
    return (
      <SharedImage
        name={file.name}
        alt={label}
        src={`data:image/${imageType};base64,${file.data}`}
      />
    )
  }
  const previewType = previewTypes.get(ext ?? "")
  return (
    <>
      <a
        href={`data:application/octet-stream;base64,${file.data}`}
        download={file.name}
        title={file.name}
        className="wrap-anywhere text-primary underline"
      >
        <Download aria-hidden className="mr-1 inline size-3" />
        {children || file.name}
      </a>
      {previewType && <PreviewFile data={file.data} type={previewType} />}
    </>
  )
}
