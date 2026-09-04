"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { ArrowLeft, Code, Eye, ExternalLink } from "lucide-react"
import type { BundledLanguage } from "shiki"

import { CodeBlockContent } from "@/components/ai-elements/code-block"
import { HtmlPreview } from "@/components/files/html-preview"
import { ImagePreview } from "@/components/files/image-preview"
import { MarkdownDocumentPreview } from "@/components/files/markdown-document-preview"
import { OfficePreview } from "@/components/files/office-preview"
import { UnifiedDiffPreview } from "@/components/diff/unified-diff-preview"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  SIDE_PANEL_CONTENT_CLASS,
} from "@/components/ui/drawer"
import type { FileViewerRequest } from "@/components/message/session-viewer-host-context"
import { useOptionalWorkbenchRoute } from "@/contexts/workbench-route-context"
import {
  useWorkspaceActions,
  useWorkspaceFileTabs,
  type FileWorkspaceTab,
} from "@/contexts/workspace-context"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { buildFileTabId } from "@/lib/file-tab-id"
import {
  findOwningFolder,
  normalizeAbsPath,
  splitAbsPath,
} from "@/lib/file-open-target"
import { isHtmlPreviewable } from "@/lib/language-detect"
import { cn } from "@/lib/utils"

/** One entry of the drawer's own history: the request as issued, plus the
 *  absolute path `openFilePreview` resolved it to (null until it settles, or
 *  when the path could not be resolved at all). A diff request resolves
 *  nothing — it arrives with its content in hand. */
interface ViewerEntry {
  request: FileViewerRequest
  absPath: string | null
  resolved: boolean
}

function newEntry(request: FileViewerRequest): ViewerEntry {
  return { request, absPath: null, resolved: request.diff != null }
}

function baseName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "")
  const index = Math.max(
    normalized.lastIndexOf("/"),
    normalized.lastIndexOf("\\")
  )
  return (index >= 0 ? normalized.slice(index + 1) : normalized) || path
}

/**
 * Ceilings for the read-only source view.
 *
 * `CodeBlockContent` builds one DOM node per line and hands the whole text to
 * shiki, with no virtualization anywhere — a multi-MB generated file would lock
 * the page up for seconds and keep the tokens cached afterwards. The file
 * column can afford such a file because Monaco virtualizes; this panel cannot,
 * so past these bounds it says so and points at the column instead. Markdown
 * and HTML previews are deliberately not capped here: they run the same
 * renderer the file column runs, with the same exposure.
 */
const SOURCE_VIEW_MAX_BYTES = 512 * 1024
const SOURCE_VIEW_MAX_LINES = 5_000

/**
 * Monaco language ids (what `languageFromPath` speaks, and therefore what a
 * file tab carries) that shiki does not know under that name. Anything absent
 * is passed through — shiki either knows it or falls back to unhighlighted
 * text on its own, which is the same outcome, just noisier in the console.
 */
const SHIKI_LANGUAGE_ALIASES: Record<string, string> = {
  plaintext: "text",
  restructuredtext: "text",
  "objective-c": "objc",
  bat: "batch",
  shell: "bash",
  mdx: "markdown",
}

function toShikiLanguage(language: string): BundledLanguage {
  return (SHIKI_LANGUAGE_ALIASES[language] ?? language) as BundledLanguage
}

/**
 * Read-only view of a file referenced in a transcript, as a side panel.
 *
 * It exists because the workspace file column is not always on screen: a
 * full-page workbench route (the task board, the canvas) covers it entirely,
 * so a file badge clicked in a transcript there used to open a tab nobody
 * could see. Rather than teach those pages to host a file column, the
 * transcript opens the file where the transcript already is. See
 * `use-open-file-target.ts` for which of the two a click routes to.
 *
 * It is a VIEW of the ordinary workspace file tab, not a second file system:
 * opening still goes through `openFilePreview`, so the tab, its cache, its
 * watcher subscription and its markdown/source toggle are the same ones the
 * file column uses — "Open in workspace" is then just a route switch away from
 * the very tab on show here. Editing deliberately stays a file-column
 * affordance; this panel is for reading what the agent wrote.
 *
 * Rendered by `SessionViewerHost`, which puts it inside the transcript's React
 * tree — that is what lets Base UI STACK it over the drawer the transcript
 * itself may be in (a sibling would just cover it at the same width).
 */
export function FileViewerDrawer({
  request,
  open,
  onOpenChange,
}: {
  request: FileViewerRequest
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslations("Folder.fileViewer")

  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="right">
      <DrawerContent
        closeButtonClassName="top-2.5 right-3"
        className={SIDE_PANEL_CONTENT_CLASS}
      >
        <DrawerTitle className="sr-only">{t("title")}</DrawerTitle>
        <DrawerDescription className="sr-only">
          {t("description")}
        </DrawerDescription>
        {/* Body mounts only while open: it subscribes to the (high-churn)
            file-tab slice, and the host keeps this component mounted after a
            close so the exit transition still has something to draw. Keyed by
            the request so opening a SECOND file while the panel is up starts
            that file's history fresh instead of appending to the last one's. */}
        {open ? (
          <FileViewerBody
            key={fileViewerRequestKey(request)}
            request={request}
          />
        ) : null}
      </DrawerContent>
    </Drawer>
  )
}

function FileViewerBody({ request }: { request: FileViewerRequest }) {
  const t = useTranslations("Folder.fileViewer")
  const {
    openFilePreview,
    openSessionFileDiff,
    switchFileTab,
    toggleFileTabPreview,
  } = useWorkspaceActions()
  const { fileTabs, previewFileTabIds } = useWorkspaceFileTabs()
  // Null only outside the workspace layout, where there is no file column to
  // hand the tab over to — the action hides itself rather than throwing.
  const route = useOptionalWorkbenchRoute()
  const allFolders = useAppWorkspaceStore((s) => s.allFolders)

  // Following a link inside a rendered markdown document navigates HERE rather
  // than into the (covered) file column, so the drawer keeps its own history.
  const [history, setHistory] = useState<ViewerEntry[]>(() => [
    newEntry(request),
  ])
  const entry = history[history.length - 1]

  const navigate = useCallback((next: FileViewerRequest) => {
    setHistory((prev) => [...prev, newEntry(next)])
  }, [])

  const goBack = useCallback(() => {
    setHistory((prev) => {
      if (prev.length <= 1) return prev
      const next = prev.slice(0, -1)
      const target = next[next.length - 1]
      // Re-arm the entry we are returning to (a diff carries its own content
      // and has nothing to re-arm). Its tab may have been closed while we were
      // deeper in, and `openFilePreview` is what would bring it back —
      // re-running it costs nothing when the tab is still there, since it
      // dedups on the cache.
      next[next.length - 1] = {
        ...target,
        resolved: target.request.diff != null,
      }
      return next
    })
  }, [])

  const tabId = entry.absPath
    ? buildFileTabId({ kind: "file", path: entry.absPath })
    : null
  const tab = useMemo(
    () => (tabId ? (fileTabs.find((it) => it.id === tabId) ?? null) : null),
    [fileTabs, tabId]
  )

  // Load whichever entry is on top. `openFilePreview` both creates/refreshes
  // the shared tab and hands back the absolute path it resolved to — which is
  // the tab's identity, and the only way to find it again from a raw path.
  const depth = history.length - 1
  const {
    path: entryPath,
    line: entryLine,
    folderId: entryFolderId,
  } = entry.request
  const hasTab = tab !== null
  useEffect(() => {
    // Stay armed until the tab is actually IN HAND rather than merely
    // resolved. The panel activates the files pane on open, which is exactly
    // what arms ⌘W / "close all file tabs" in `workspace-chrome-controller` —
    // so the user can close the tab this panel is showing without ever seeing
    // the column, and the panel would otherwise sit on a spinner forever.
    //
    // A null `absPath` on a resolved entry is the settled answer "this path
    // names no file" (or a diff, which resolves to no tab at all) — not a
    // missing tab, so it does not re-arm. And this cannot spin: `settle` is a
    // no-op once an entry holds that answer, so an entry whose tab never
    // materializes costs exactly one extra call and then stops.
    if (entry.resolved && (entry.absPath === null || hasTab)) return
    let cancelled = false
    const settle = (absPath: string | null) => {
      if (cancelled) return
      setHistory((prev) => {
        const current = prev[depth]
        if (!current) return prev
        if (current.resolved && current.absPath === absPath) return prev
        return prev.map((candidate, index) =>
          index === depth
            ? { ...candidate, absPath, resolved: true }
            : candidate
        )
      })
    }
    // A load FAILURE is reported through the tab (`saveState: "error"`), so the
    // only way this rejects is an unexpected one. Settle as unresolvable rather
    // than leaving the panel spinning on a promise nobody is watching.
    void openFilePreview(entryPath, {
      line: entryLine ?? undefined,
      folderId: entryFolderId,
    }).then(settle, () => settle(null))
    return () => {
      cancelled = true
    }
  }, [
    depth,
    entry.absPath,
    entry.resolved,
    entryFolderId,
    entryLine,
    entryPath,
    hasTab,
    openFilePreview,
  ])

  const io = useMemo(
    () => (entry.absPath ? splitAbsPath(entry.absPath) : null),
    [entry.absPath]
  )
  // Root for markdown/HTML sub-resource resolution — the owning registered
  // folder when the file sits in one, else its own directory. Same rule the
  // file column applies.
  const previewRoot = useMemo(() => {
    if (!entry.absPath) return null
    return (
      findOwningFolder(entry.absPath, allFolders)?.rootPath ??
      io?.rootPath ??
      null
    )
  }, [allFolders, entry.absPath, io])

  const isPreview = tabId ? previewFileTabIds.has(tabId) : false
  const canTogglePreview =
    tab?.kind === "file" &&
    (tab.language === "markdown" || isHtmlPreviewable(tab.path))

  const diff = entry.request.diff
  const canOpenInWorkspace = route != null && (tabId != null || diff != null)
  const handleOpenInWorkspace = useCallback(() => {
    if (!route) return
    route.openConversations()
    // A diff has no tab to activate — it is minted from the patch text we are
    // already showing, exactly as the reply's action would have on the
    // conversations route.
    if (diff) {
      openSessionFileDiff(entryPath, diff.content, diff.groupLabel, {
        folderId: entryFolderId,
      })
      return
    }
    if (tabId) switchFileTab(tabId)
  }, [
    diff,
    entryFolderId,
    entryPath,
    openSessionFileDiff,
    route,
    switchFileTab,
    tabId,
  ])

  // A markdown link resolves to an absolute filesystem path (the preview
  // pre-resolves them), so it carries no folder and no line.
  const handleMarkdownLink = useCallback(
    (path: string) => {
      navigate({ path, line: null })
    },
    [navigate]
  )

  const fileName = io?.ioPath ?? baseName(entry.request.path)

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* `pr-12` clears the drawer's close button so the action cluster and it
          read as one row — same header shape as the session viewers. */}
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2 pr-12">
        {history.length > 1 && (
          <HeaderButton label={t("back")} onClick={goBack}>
            <ArrowLeft className="size-4" />
          </HeaderButton>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <span
            className="truncate text-sm font-medium"
            title={entry.absPath ?? entry.request.path}
          >
            {fileName}
            {entry.request.line ? `:${entry.request.line}` : ""}
          </span>
          {io?.rootPath && (
            <span className="truncate text-2xs text-muted-foreground">
              {io.rootPath}
            </span>
          )}
        </div>
        {canTogglePreview && tabId && (
          <HeaderButton
            label={isPreview ? t("source") : t("preview")}
            onClick={() => toggleFileTabPreview(tabId)}
            className={isPreview ? "text-primary" : undefined}
          >
            {isPreview ? (
              <Code className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </HeaderButton>
        )}
        {route && (
          <HeaderButton
            label={t("openInWorkspace")}
            onClick={handleOpenInWorkspace}
            disabled={!canOpenInWorkspace}
          >
            <ExternalLink className="size-4" />
          </HeaderButton>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <FileViewerContent
          entry={entry}
          tab={tab}
          io={io}
          previewRoot={previewRoot}
          isPreview={isPreview}
          onOpenMarkdownLink={handleMarkdownLink}
        />
      </div>
    </div>
  )
}

function HeaderButton({
  label,
  onClick,
  disabled,
  className,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
        className
      )}
    >
      {children}
    </button>
  )
}

function FileViewerContent({
  entry,
  tab,
  io,
  previewRoot,
  isPreview,
  onOpenMarkdownLink,
}: {
  entry: ViewerEntry
  tab: FileWorkspaceTab | null
  io: { rootPath: string; ioPath: string } | null
  previewRoot: string | null
  isPreview: boolean
  onOpenMarkdownLink: (path: string) => void
}) {
  const t = useTranslations("Folder.fileViewer")

  // A diff arrives with its content in hand — no tab, no disk read. Same
  // renderer the file column gives a `diff:session:` tab.
  const diff = entry.request.diff
  if (diff) {
    return <UnifiedDiffPreview diffText={diff.content} className="h-full p-3" />
  }

  if (entry.resolved && !entry.absPath) {
    return <CenteredNotice>{t("cannotResolve")}</CenteredNotice>
  }
  // Cold load — no bytes yet. A refresh of an already-loaded tab keeps the
  // previous content on screen (the file column's "non-destructive refresh").
  if (!tab || (tab.loading && tab.content === "")) {
    return <CenteredNotice>{t("loading")}</CenteredNotice>
  }
  // Deliberately NO `saveState === "error"` branch. A LOAD failure and a SAVE
  // failure share that one flag, and nothing on the tab tells them apart:
  // `rejectTab` puts the localized "unable to load <message>" sentence in
  // `content` on a clean tab, while a failed save leaves `content` as the
  // user's buffer — and that buffer is clean too whenever they happened to
  // revert it while the save was in flight (`updateFileTabContent` recomputes
  // `isDirty` against `savedContent`). Guessing wrong prints the whole document
  // as an error notice. So this panel does what the file column does: render
  // whatever the tab holds. A load failure surfaces as its own message in the
  // document body, which is exactly where the column shows it.
  //
  // `openFilePreview` stamps the synthetic "image" / "office" languages onto
  // the tab it seeds — branch on those, exactly as the file column does, so
  // the two surfaces can never disagree about what a tab holds.
  if (tab.language === "image") {
    return <ImagePreview key={tab.id} tab={tab} />
  }
  if (tab.language === "office") {
    return (
      <OfficePreview
        key={tab.id}
        rootPath={io?.rootPath ?? null}
        relPath={io?.ioPath ?? null}
      />
    )
  }
  if (isPreview && isHtmlPreviewable(tab.path)) {
    return <HtmlPreview key={tab.id} tab={tab} rootPath={previewRoot} />
  }
  if (isPreview && tab.language === "markdown") {
    return (
      <MarkdownDocumentPreview
        content={tab.content}
        fileDir={io?.rootPath ?? null}
        previewRoot={previewRoot}
        openFilePreview={onOpenMarkdownLink}
      />
    )
  }

  return (
    <SourceView
      // A different file (or a re-open at a different line) must re-run the
      // scroll effect, and the DOM it measures belongs to this file's render.
      key={`${tab.id}:${entry.request.line ?? ""}`}
      code={tab.content}
      language={tab.language}
      line={entry.request.line}
    />
  )
}

function CenteredNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
      {children}
    </div>
  )
}

/**
 * Read-only source view. Shiki-highlighted like every other code block in a
 * transcript rather than a second Monaco: this panel never edits, and Monaco's
 * models/undo stacks are the file column's business.
 */
function SourceView({
  code,
  language,
  line,
}: {
  code: string
  language: string
  line: number | null
}) {
  const t = useTranslations("Folder.fileViewer")
  const containerRef = useRef<HTMLDivElement | null>(null)
  const tooLarge =
    code.length > SOURCE_VIEW_MAX_BYTES ||
    countLines(code) > SOURCE_VIEW_MAX_LINES

  // Reveal the requested line once the tokens have rendered. `CodeBlockBody`
  // emits exactly one element per source line, so the line number indexes
  // straight into `<code>`'s children. Re-run on `code` because the first
  // paint uses raw tokens and shiki swaps in highlighted ones a tick later.
  useEffect(() => {
    if (!line || tooLarge) return
    const target = containerRef.current
      ?.querySelector("code")
      ?.children.item(line - 1)
    target?.scrollIntoView({ block: "center" })
  }, [code, line, tooLarge])

  if (tooLarge) {
    return <CenteredNotice>{t("tooLargeToPreview")}</CenteredNotice>
  }

  return (
    <div ref={containerRef} className="h-full overflow-auto">
      <CodeBlockContent
        code={code}
        language={toShikiLanguage(language)}
        showLineNumbers
      />
    </div>
  )
}

/** Line count without allocating an array of every line. */
function countLines(text: string): number {
  let lines = 1
  for (
    let index = text.indexOf("\n");
    index >= 0;
    index = text.indexOf("\n", index + 1)
  ) {
    lines += 1
    if (lines > SOURCE_VIEW_MAX_LINES) return lines
  }
  return lines
}

/**
 * Identity of a request — what the drawer's body is keyed on, so a second
 * request opened over the first starts its own history instead of inheriting
 * the previous one's.
 *
 * The diff discriminator is load-bearing, not decoration: a file and a diff of
 * that file sit in the SAME action row, so they arrive with the same path, no
 * line and no folder. Keying on those alone made "view diff" and "open file"
 * for one path indistinguishable, and the panel went on showing whichever came
 * first. The reply turn id (`groupLabel`) separates two replies' diffs of the
 * same file, which is the same thing it does for their tab ids.
 */
function fileViewerRequestKey(request: FileViewerRequest): string {
  const view = request.diff ? `diff:${request.diff.groupLabel}` : "file"
  return `${normalizeAbsPath(request.path)}:${request.line ?? ""}:${
    request.folderId ?? ""
  }:${view}`
}
