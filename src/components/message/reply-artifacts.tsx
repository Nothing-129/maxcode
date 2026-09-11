"use client"

import { memo, useMemo, useState } from "react"
import { ChevronDown, ExternalLink, FileDiff } from "lucide-react"
import { useTranslations } from "next-intl"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { useOpenFileTarget } from "@/hooks/use-open-file-target"
import {
  fileNameOf,
  isRemovedFileDiff,
  normalizeSlashPath,
  toAbsoluteFilePath,
  toFolderRelativePath,
} from "@/lib/file-path-display"
import {
  extractReplyFileChanges,
  type FileChangeStat,
} from "@/lib/session-files"
import { isLocalDesktop, revealItemInDir } from "@/lib/platform"
import type { MessageTurn } from "@/lib/types"
import { cn } from "@/lib/utils"

/** Completed reply changes share one compact summary, with three rows initially. */
export const ReplyArtifacts = memo(function ReplyArtifacts({
  sourceTurns,
  isResponseComplete,
}: {
  sourceTurns: MessageTurn[]
  isResponseComplete: boolean
}) {
  const t = useTranslations("Folder.chat.replyArtifacts")
  const tCommon = useTranslations("Folder.common")
  const { activeFolder: folder } = useActiveFolder()
  const openFileTarget = useOpenFileTarget()
  const [expanded, setExpanded] = useState(false)
  // Keep diff parsing off the streaming hot path.
  const files = useMemo(
    () => (isResponseComplete ? extractReplyFileChanges(sourceTurns) : []),
    [isResponseComplete, sourceTurns]
  )

  if (!isResponseComplete || files.length === 0) return null

  const replyDiffKey = sourceTurns[0]?.id ?? "reply"
  const diffContent = (file: FileChangeStat) =>
    file.diff ?? t("noDiffDataAvailable", { filePath: file.path })
  const viewDiff = (file: FileChangeStat) => {
    void openFileTarget(file.path, {
      diff: { content: diffContent(file), groupLabel: replyDiffKey },
    })
  }
  const review = () => {
    void openFileTarget(files[0].path, {
      diff: {
        content: files.map(diffContent).join("\n\n"),
        groupLabel: `${replyDiffKey}:review`,
      },
    })
  }
  const totalAdditions = files.reduce((sum, file) => sum + file.additions, 0)
  const totalDeletions = files.reduce((sum, file) => sum + file.deletions, 0)
  const visibleFiles = expanded ? files : files.slice(0, 3)

  return (
    <section
      aria-label={t("editedFiles", { count: files.length })}
      className="mt-2 overflow-hidden rounded-xl border border-border/60 bg-background text-sm text-foreground"
    >
      <div className="flex min-h-16 items-center gap-2.5 border-b border-border/60 px-3 py-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground">
          <FileDiff className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            {t("editedFiles", { count: files.length })}
          </div>
          <ChangeCounts additions={totalAdditions} deletions={totalDeletions} />
        </div>
        <button
          type="button"
          onClick={review}
          className="shrink-0 rounded-lg border border-border/60 px-2.5 py-1 text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("review")}
        </button>
      </div>
      <ul className="max-h-80 overflow-y-auto py-0.5">
        {visibleFiles.map((file) => {
          const displayPath = toFolderRelativePath(file.path, folder?.path)
          const name = fileNameOf(displayPath)
          const directory = displayPath.slice(
            0,
            displayPath.length - name.length
          )
          const removed = isRemovedFileDiff(file.diff)
          return (
            <li
              key={file.id}
              className="group flex min-h-9 items-center gap-2 px-3 hover:bg-accent/40"
            >
              <button
                type="button"
                title={displayPath}
                aria-label={
                  removed
                    ? `${tCommon("viewDiff")}: ${displayPath}`
                    : t("openFile", { filePath: displayPath })
                }
                onClick={() =>
                  removed
                    ? viewDiff(file)
                    : void openFileTarget(normalizeSlashPath(file.path))
                }
                className="min-w-0 flex-1 truncate py-2 text-start leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="text-muted-foreground">{directory}</span>
                <span
                  className={cn(
                    removed && "text-muted-foreground line-through"
                  )}
                >
                  {name}
                </span>
              </button>
              <div className="hidden shrink-0 items-center gap-1 group-hover:flex group-focus-within:flex [@media(hover:none)]:flex">
                <button
                  type="button"
                  aria-label={tCommon("viewDiff")}
                  title={tCommon("viewDiff")}
                  onClick={() => viewDiff(file)}
                  className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <FileDiff className="size-3.5" />
                </button>
                {!removed && isLocalDesktop() && (
                  <button
                    type="button"
                    aria-label={t("revealInFolder")}
                    title={t("revealInFolder")}
                    onClick={() => {
                      const absolute = toAbsoluteFilePath(
                        file.path,
                        folder?.path
                      )
                      if (absolute) void revealItemInDir(absolute)
                    }}
                    className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ExternalLink className="size-3.5" />
                  </button>
                )}
              </div>
              <ChangeCounts
                additions={file.additions}
                deletions={file.deletions}
              />
            </li>
          )
        })}
      </ul>
      {files.length > 3 && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="flex min-h-9 items-center gap-2 px-3 pb-2 pt-1 text-sm hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {expanded
            ? t("showLess")
            : t("showMore", { count: files.length - 3 })}
          <ChevronDown className={cn("size-3.5", expanded && "rotate-180")} />
        </button>
      )}
    </section>
  )
})

function ChangeCounts({
  additions,
  deletions,
}: {
  additions: number
  deletions: number
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs tabular-nums">
      <span className="text-green-600 dark:text-green-400">+{additions}</span>
      <span className="text-red-600 dark:text-red-400">-{deletions}</span>
    </span>
  )
}
