"use client"

import { useMemo } from "react"
import { Code, Download, ExternalLink, Eye } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { openPath } from "@/lib/platform"
import {
  downloadWorkspaceFile,
  isWorkspaceFileApiAvailable,
  WORKSPACE_DOWNLOAD_CANCELLED,
} from "@/lib/api"
import { toErrorMessage } from "@/lib/app-error"
import { findOwningFolder, splitAbsPath } from "@/lib/file-open-target"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { isHtmlPreviewable } from "@/lib/language-detect"
import {
  useWorkspaceActions,
  useWorkspaceFileTabs,
} from "@/contexts/workspace-context"
import { FilePathBreadcrumb } from "@/components/files/file-path-breadcrumb"
import { cn } from "@/lib/utils"

/**
 * Desktop file-detail header: the active file's name on the left, its file-type
 * actions on the right — the markdown/html preview⇄source toggle and
 * open-in-browser (html). Maximize/restore lives in the file tab strip
 * (`FileWorkspaceTabBar`, embedded) instead, flush right of the tabs. Rendered
 * only on desktop (`WorkspaceContent`); the mobile panel row keeps these
 * buttons in its own tab bar. Sits above every `FileWorkspacePanel` render
 * branch (editor / preview / diff / image / office), so it wraps them all
 * uniformly.
 */
export function FileWorkspaceHeader() {
  const t = useTranslations("Folder.fileWorkspace")
  const tFileTree = useTranslations("Folder.fileTreeTab")
  const { activeFileTab, activeFileTabId, previewFileTabIds } =
    useWorkspaceFileTabs()
  const { toggleFileTabPreview } = useWorkspaceActions()
  const allFolders = useAppWorkspaceStore((s) => s.allFolders)
  const activeAbsPath = activeFileTab?.path ?? null
  const downloadTarget = useMemo(() => {
    if (!activeAbsPath) return null
    const owning = findOwningFolder(activeAbsPath, allFolders)
    if (owning) return { rootPath: owning.rootPath, path: owning.relPath }
    // Agent outputs outside registered folders are still readable through
    // their own directory, just as when opening the preview.
    const io = splitAbsPath(activeAbsPath)
    return io ? { rootPath: io.rootPath, path: io.ioPath } : null
  }, [activeAbsPath, allFolders])

  if (!activeFileTab) return null

  const isDiff =
    activeFileTab.kind === "diff" || activeFileTab.kind === "rich-diff"
  const isDirty =
    activeFileTab.kind === "file" && Boolean(activeFileTab.isDirty)
  // Mirror the gating the file tab strip used (file-workspace-tab-bar.tsx):
  // preview toggle for markdown/html, browser-open for html.
  const canPreview =
    activeFileTab.kind === "file" &&
    (activeFileTab.language === "markdown" ||
      isHtmlPreviewable(activeFileTab.path))
  const canOpenInBrowser =
    activeFileTab.kind === "file" && isHtmlPreviewable(activeFileTab.path)
  const isPreviewActive =
    canPreview && activeFileTabId
      ? previewFileTabIds.has(activeFileTabId)
      : false
  const canDownload =
    activeFileTab.kind === "file" &&
    downloadTarget !== null &&
    isWorkspaceFileApiAvailable()

  const handleDownload = () => {
    if (!downloadTarget) return
    const name = activeFileTab.title
    void (async () => {
      try {
        const result = await downloadWorkspaceFile(
          downloadTarget.rootPath,
          downloadTarget.path,
          name
        )
        // The shared HTTP path hands progress to the browser/Electron
        // download manager. Only a completed native save needs a toast.
        if (result.status === "started") return
        if (result.status === WORKSPACE_DOWNLOAD_CANCELLED) return
        if (result.savedPath) {
          toast.success(tFileTree("toasts.downloadSaved", { name }), {
            description: result.savedPath,
          })
        }
      } catch (error) {
        toast.error(tFileTree("toasts.downloadFailed", { name }), {
          description: toErrorMessage(error),
        })
      }
    })()
  }

  const actionBtn =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-primary/8 transition-colors"

  return (
    // Transparent like the conversation detail header
    // (conversation-detail-header.tsx): the title header merges with the canvas
    // below it (editor / preview) instead of being a frosted band. With a
    // workspace background image on, the tab strip above it is transparent too,
    // so the whole top of the column reveals the canvas.
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/50 px-3">
      {/* No leading file-type icon — the folder name leads the breadcrumb, and
          the text matches the conversation detail header's `text-sm` title. */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
        {/* Diff tabs have no single navigable path — keep them as a plain
            title. Plain files render a clickable path breadcrumb. */}
        {isDiff || !activeFileTab.path ? (
          <span
            className="truncate text-foreground/90"
            title={activeFileTab.description ?? activeFileTab.title}
          >
            {activeFileTab.title}
            {isDirty ? " *" : ""}
          </span>
        ) : (
          <FilePathBreadcrumb
            path={activeFileTab.path}
            fileName={activeFileTab.title}
            isDirty={isDirty}
          />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {canDownload && (
          <button
            type="button"
            onClick={handleDownload}
            className={actionBtn}
            aria-label={tFileTree("download")}
            title={tFileTree("download")}
          >
            <Download className="h-4 w-4" />
          </button>
        )}
        {canPreview && activeFileTabId && (
          <button
            type="button"
            onClick={() => toggleFileTabPreview(activeFileTabId)}
            className={cn(actionBtn, isPreviewActive && "text-primary")}
            aria-label={isPreviewActive ? t("editSource") : t("preview")}
            title={isPreviewActive ? t("editSource") : t("preview")}
          >
            {isPreviewActive ? (
              <Code className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        )}
        {canOpenInBrowser && activeFileTab.path && (
          <button
            type="button"
            onClick={() => {
              // File tab paths are absolute — hand the path straight to the OS.
              openPath(activeFileTab.path as string).catch(() => {})
            }}
            className={actionBtn}
            aria-label={t("preview")}
            title={t("preview")}
          >
            <ExternalLink className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}
