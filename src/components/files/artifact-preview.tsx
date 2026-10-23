"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { createWorkspaceMediaUrl, downloadWorkspaceFile } from "@/lib/api"
import { splitAbsPath } from "@/lib/file-open-target"
import { mediaPreviewKind } from "@/lib/language-detect"
import { toErrorMessage } from "@/lib/app-error"
import { Button } from "@/components/ui/button"

export function ArtifactPreview({ path }: { path: string }) {
  const t = useTranslations("Folder.artifactPreview")
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const kind = mediaPreviewKind(path)
  useEffect(() => {
    let disposed = false
    setUrl(null)
    setError(null)
    const io = splitAbsPath(path)
    if (kind && io) {
      void createWorkspaceMediaUrl(io.rootPath, io.ioPath).then(
        (value) => {
          if (!disposed) setUrl(value)
        },
        (reason) => {
          if (!disposed) setError(toErrorMessage(reason))
        }
      )
    }
    return () => {
      disposed = true
    }
  }, [path, kind])

  async function download() {
    const io = splitAbsPath(path)
    if (!io) return
    setDownloading(true)
    try {
      await downloadWorkspaceFile(
        io.rootPath,
        io.ioPath,
        path.split(/[\\/]/).pop() ?? "download"
      )
    } catch (reason) {
      setError(toErrorMessage(reason))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 overflow-auto p-4">
      {url && kind === "video" && (
        <video
          className="max-h-[70%] w-full"
          src={url}
          controls
          playsInline
          preload="metadata"
          onError={() => setError(t("playbackFailed"))}
        />
      )}
      {url && kind === "audio" && (
        <audio
          className="w-full"
          src={url}
          controls
          preload="metadata"
          onError={() => setError(t("playbackFailed"))}
        />
      )}
      <p className="break-all text-center text-sm">
        {path.split(/[\\/]/).pop()}
      </p>
      <p
        className="text-center text-sm text-muted-foreground"
        role={error ? "alert" : undefined}
      >
        {error ??
          (kind ? (url ? t("mediaHint") : t("loading")) : t("downloadHint"))}
      </p>
      <Button
        variant="outline"
        disabled={downloading}
        onClick={() => void download()}
      >
        {t("download")}
      </Button>
    </div>
  )
}
