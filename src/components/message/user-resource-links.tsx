"use client"

import { FileText, FolderOpen } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  parseLocalFileTarget,
  useOpenLinkOrFile,
} from "@/components/ai-elements/link-safety"
import type {
  AdaptedContentPart,
  UserResourceDisplay,
} from "@/lib/adapters/ai-elements-adapter"
import { toErrorMessage } from "@/lib/app-error"
import { expandHomePath, isHomeRelativePath } from "@/lib/file-open-target"
import { isLocalDesktop, revealItemInDir } from "@/lib/platform"
import {
  tokenizeReferenceLinks,
  unwrapReferenceDestination,
} from "@/lib/reference-link"
import { useActiveFolder } from "@/contexts/active-folder-context"
import {
  FileReferenceActions,
  resolveFileReferenceTarget,
  systemFileManagerLabelKey,
} from "./file-reference-actions"

/** Hide only references represented by cards; preserve the original sent parts. */
export function withoutResourceLinks(
  parts: AdaptedContentPart[],
  resources: UserResourceDisplay[]
): AdaptedContentPart[] {
  if (resources.length === 0) return parts
  const uris = new Set(resources.map((resource) => resource.uri))
  return parts.map((part) => {
    if (part.type !== "text") return part
    const text = tokenizeReferenceLinks(part.text)
      .map((token) =>
        token.type === "link"
          ? uris.has(unwrapReferenceDestination(token.destination))
            ? ""
            : token.raw
          : token.value
      )
      .join("")
    return text === part.text ? part : { ...part, text: text.trim() }
  })
}

export function UserResourceLinks({
  resources,
  className,
}: {
  resources: UserResourceDisplay[]
  className?: string
}) {
  const open = useOpenLinkOrFile()
  const t = useTranslations("Folder.chat.fileActions")
  const { activeFolder } = useActiveFolder()
  if (resources.length === 0) return null

  const reveal = async (uri: string) => {
    const paths = resolveFileReferenceTarget(uri, activeFolder?.path)
    if (!paths) return
    try {
      await revealItemInDir(
        isHomeRelativePath(paths.absolute)
          ? await expandHomePath(paths.absolute)
          : paths.absolute
      )
    } catch (error) {
      toast.error(t("openFailed"), { description: toErrorMessage(error) })
    }
  }

  return (
    <div className={className} data-user-attachments="">
      <div className="flex flex-wrap gap-2">
        {resources.map((resource, index) => {
          const openable = parseLocalFileTarget(resource.uri) !== null
          const extension = resource.name
            .match(/\.([a-z0-9]{1,12})$/i)?.[1]
            ?.toUpperCase()
          return (
            <FileReferenceActions
              key={`${resource.uri}-${index}`}
              target={resource.uri}
            >
              <div className="flex min-w-0 max-w-full items-center rounded-xl border border-foreground/10 bg-background/70 text-foreground">
                <button
                  type="button"
                  disabled={!openable}
                  onClick={() => void open(resource.uri)}
                  title={resource.uri}
                  className="flex min-w-0 items-center gap-2.5 rounded-xl p-2.5 text-left transition-colors enabled:cursor-pointer enabled:hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                    <FileText aria-hidden="true" className="size-5" />
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="max-w-56 truncate text-xs font-medium">
                      {resource.name}
                    </span>
                    {extension && (
                      <span className="text-[10px] text-muted-foreground">
                        {extension}
                      </span>
                    )}
                  </span>
                </button>
                {openable &&
                  isLocalDesktop() &&
                  resolveFileReferenceTarget(
                    resource.uri,
                    activeFolder?.path
                  ) && (
                    <button
                      type="button"
                      title={t(systemFileManagerLabelKey())}
                      aria-label={t(systemFileManagerLabelKey())}
                      onClick={() => void reveal(resource.uri)}
                      className="mr-2 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <FolderOpen aria-hidden="true" className="size-3.5" />
                    </button>
                  )}
              </div>
            </FileReferenceActions>
          )
        })}
      </div>
    </div>
  )
}
