"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import {
  CirclePlay,
  ExternalLink,
  Link2,
  ListTodo,
  MessageSquare,
  RefreshCw,
  RotateCcw,
} from "lucide-react"
import { MessageResponse } from "@/components/ai-elements/message"
import { formatRelative } from "@/components/conversations/sidebar-conversation-grouping"
import {
  CHIP_FILL,
  ForgeLabelChip,
  ROW_ACTION,
  ROW_ACTION_GLYPH,
  stateGlyph,
} from "@/components/forge/forge-issue-row"
import { statusLabelKey } from "@/components/tasks/task-card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { BrowserLink } from "@/components/ui/browser-link"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  SIDE_PANEL_CONTENT_CLASS,
} from "@/components/ui/drawer"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { forgeListComments } from "@/lib/api"
import {
  type AppErrorTranslator,
  toLocalizedErrorMessage,
} from "@/lib/app-error"
import { chipStateForLink } from "@/lib/forge-task-chip"
import { cn } from "@/lib/utils"
import type { ForgeComment, ForgeIssueRow, ForgeTaskLink } from "@/lib/types"

/**
 * Typography for the item's Markdown body at the panel's scale.
 *
 * Streamdown sizes its own elements for the full-width chat column — `h1` at
 * `text-3xl`, 24px above every heading — which in a 32rem panel turns a
 * three-heading issue into a page of titles. A descendant selector outranks the
 * class Streamdown puts on the element itself, so these win without
 * `!important`. Lists and the first/last block's collapsed margin already come
 * from `MessageResponse`; `prose` is deliberately absent, as the repo has no
 * typography plugin and those classes would generate nothing.
 *
 * Deliberately NOT the task sheet's `RESULT_MARKDOWN`, which is tuned a notch
 * smaller: there the Markdown is a summary sitting among other sections, here it
 * is the whole reason the panel opened and has to stay comfortable to read at
 * length. Images are capped because an issue body is full of screenshots and
 * the forge writes them at their natural width.
 */
const BODY_MARKDOWN =
  "[&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-[0.8125rem] [&_h4]:text-[0.8125rem] " +
  "[&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h4]:font-semibold " +
  "[&_h1]:mt-4 [&_h2]:mt-4 [&_h3]:mt-3 [&_h4]:mt-3 " +
  "[&_h1]:mb-1.5 [&_h2]:mb-1.5 [&_h3]:mb-1 [&_h4]:mb-1 " +
  "[&_p]:mt-0 [&_p]:mb-2.5 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5 " +
  "[&_blockquote]:my-2.5 [&_hr]:my-4 [&_table]:my-2.5 " +
  "[&_img]:max-w-full [&_img]:rounded-lg"

/** Render-time "now", as on the row: the panel re-renders with its list. */
function relative(iso: string): string {
  return formatRelative(iso, Date.now())
}

/**
 * Append a page, skipping anything already held.
 *
 * Offset pagination over a live collection: someone commenting between two
 * page requests shifts every later comment down one, which serves the last of
 * page 1 again at the top of page 2. Without this the thread would show it
 * twice — and React would warn about the duplicate key on the way.
 */
function appendUnseen(
  held: ForgeComment[],
  incoming: ForgeComment[]
): ForgeComment[] {
  const seen = new Set(held.map((c) => c.id))
  return [...held, ...incoming.filter((c) => !seen.has(c.id))]
}

/**
 * The full date behind a relative one. The list says "3 days ago" because that
 * is what a triage scan wants; the panel is where someone asks "three days from
 * WHEN", and a title attribute answers it without spending a line.
 */
function absolute(iso: string): string | undefined {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? undefined : at.toLocaleString()
}

/**
 * The item's discussion, under its description.
 *
 * One request per item, fired when the panel opens on it. That is the whole
 * reason this is not part of the list payload: a list page holds thirty items
 * and its reader opens at most one, so thirty thread fetches would be
 * twenty-nine wasted. It is asked for unconditionally rather than gated on the
 * row's `comments` count — the row is a snapshot, and a count of zero taken
 * five minutes ago is not evidence that nobody has replied since.
 *
 * Everything here is scoped to ONE item by the caller's `key`, so the state
 * below needs no reset logic of its own.
 */
function CommentThread({
  folderId,
  kind,
  number,
}: {
  folderId: number
  kind: "issue" | "pr"
  number: number
}) {
  const t = useTranslations("Forge")
  // Root-scoped, like the page's: a forge failure carries a FULL dotted i18n
  // key (`Forge.errors.noAccount`) that the namespaced translator above cannot
  // resolve.
  const tRoot = useTranslations()
  const [comments, setComments] = useState<ForgeComment[]>([])
  /** The page "load more" asks for — one past the last one that landed. */
  const [nextPage, setNextPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [loading, setLoading] = useState(true)
  /** The rejection, with the PAGE that produced it. The page is what "Try
   *  again" re-asks for, and it has to be remembered rather than derived: a
   *  failed refresh and a failed "load more" are both failures, and `nextPage`
   *  describes only the second of them — retrying a refresh through it would
   *  ask for the page AFTER the one on screen and append it to the stale data
   *  the refresh was there to replace.
   *
   *  Boxed so "no failure" stays distinguishable from a falsy one, and the
   *  error kept RAW to be localized at render: a translator is not a stable
   *  value to hang a fetch on — as an effect dependency it would re-fire this
   *  request on every render that produced a new one. */
  const [failure, setFailure] = useState<{
    error: unknown
    page: number
  } | null>(null)
  /** Generation guard. Three things fire a load — the mount, "load more" and
   *  the refresh button — and a refresh sent while a "load more" is still in
   *  the air must not have its wholesale replacement undone by the append that
   *  lands after it. */
  const reqRef = useRef(0)

  const load = useCallback(
    async (page: number) => {
      const id = ++reqRef.current
      setLoading(true)
      setFailure(null)
      try {
        const list = await forgeListComments(folderId, { kind, number, page })
        if (id !== reqRef.current) return
        // Page 1 REPLACES: it is both the first load and what the refresh
        // button asks for, and a refresh that appended would double the thread.
        setComments((held) =>
          page === 1 ? list.comments : appendUnseen(held, list.comments)
        )
        setHasNext(list.has_next)
        setNextPage(list.page + 1)
      } catch (error) {
        if (id !== reqRef.current) return
        // The pages already on screen stay: a failed "load more" costs the rest
        // of the thread, not the part that was being read.
        setFailure({ error, page })
      } finally {
        if (id === reqRef.current) setLoading(false)
      }
    },
    // Primitives only, so this identity — and the effect below that depends on
    // it — changes exactly when the ITEM does.
    [folderId, kind, number]
  )

  useEffect(() => {
    void load(1)
  }, [load])

  // First load: a skeleton stands in for the thread rather than an empty
  // section that would read as "no comments" for as long as the request takes.
  const firstLoad = loading && comments.length === 0 && failure == null
  const empty = !loading && failure == null && !hasNext && comments.length === 0

  return (
    <section className="flex flex-col gap-3 border-t border-border px-5 py-4">
      <div className="flex items-center gap-2">
        <h3 className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
          {t("comments")}
        </h3>
        {/* Back to page 1 wholesale, not "fetch what is new": the thread is
            offset-paginated, so there is no cursor to resume from — and an
            edited or deleted comment is a change no append could show. */}
        <button
          type="button"
          onClick={() => void load(1)}
          disabled={loading}
          title={t("commentsRefresh")}
          aria-label={t("commentsRefresh")}
          className="ms-auto inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {firstLoad ? (
        <CommentSkeleton />
      ) : comments.length > 0 ? (
        <ol className="flex flex-col gap-3">
          {comments.map((comment) => (
            <li key={comment.id}>
              <CommentCard comment={comment} />
            </li>
          ))}
        </ol>
      ) : null}

      {empty ? (
        <p className="py-2 text-center text-xs text-muted-foreground">
          {t("commentsEmpty")}
        </p>
      ) : null}

      {failure != null ? (
        <div className="flex flex-col items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2">
          {/* A rejected `invoke()` hands back the SERIALIZED AppCommandError —
              a plain object whose `toString` is "[object Object]". app-error
              unwraps it and prefers the backend's own i18n key. */}
          <p className="text-xs text-destructive">
            {toLocalizedErrorMessage(
              failure.error,
              tRoot as unknown as AppErrorTranslator
            )}
          </p>
          {/* The page that FAILED, whichever kind of load asked for it. */}
          <button
            type="button"
            onClick={() => void load(failure.page)}
            className="text-[0.6875rem] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {t("commentsRetry")}
          </button>
        </div>
      ) : null}

      {/* Offered whenever the FORGE says there is more, even with nothing on
          screen: GitLab drops its system events after paginating, so a page of
          nothing but "changed the milestone" arrives empty with the real
          discussion still behind it. */}
      {hasNext && failure == null ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={loading}
          onClick={() => void load(nextPage)}
          className="h-7 self-center rounded-full px-3 text-[0.6875rem] font-medium text-muted-foreground"
        >
          {loading ? t("commentsLoading") : t("commentsMore")}
        </Button>
      ) : null}
    </section>
  )
}

/** One comment: who, when, and what they wrote, in the forge's own Markdown. */
function CommentCard({ comment }: { comment: ForgeComment }) {
  const t = useTranslations("Forge")
  const body = comment.body.trim()
  const author = comment.author
  return (
    <article className="flex gap-2.5">
      {/* Fallback in its own right, not a stand-in for a missing URL: GitLab
          hands out gravatar.com URLs for accounts that never uploaded a
          picture, and those can take a long time to fail on a network that
          cannot reach them. Radix swaps the image in only once it has loaded,
          so the initial is what shows until (and unless) it does. */}
      <Avatar size="sm" className="mt-0.5">
        {comment.author_avatar != null ? (
          <AvatarImage src={comment.author_avatar} alt="" />
        ) : null}
        <AvatarFallback className="text-[0.625rem] font-medium uppercase">
          {author?.slice(0, 1) ?? "?"}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-border">
        <header className="flex items-center gap-1.5 border-b border-border bg-muted/40 px-3 py-1.5 text-[0.6875rem]">
          <span className="min-w-0 truncate font-medium">
            {author ?? t("commentUnknownAuthor")}
          </span>
          {comment.created_at != null ? (
            <span
              className="shrink-0 text-muted-foreground"
              title={absolute(comment.created_at)}
            >
              {relative(comment.created_at)}
            </span>
          ) : null}
          {/* The backend only sends `updated_at` when it differs from
              `created_at` — both forges stamp one on creation, so its mere
              presence would mark every comment as edited. */}
          {comment.updated_at != null ? (
            <span
              className="shrink-0 text-muted-foreground"
              title={absolute(comment.updated_at)}
            >
              · {t("commentEdited")}
            </span>
          ) : null}
          {comment.html_url != null ? (
            <BrowserLink
              href={comment.html_url}
              title={t("commentPermalink")}
              aria-label={t("commentPermalink")}
              className="ms-auto inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Link2 className="size-3" aria-hidden />
            </BrowserLink>
          ) : null}
        </header>
        {body ? (
          <div
            className={cn(
              "break-words px-3 py-2 text-[0.8125rem] leading-relaxed",
              BODY_MARKDOWN
            )}
          >
            <MessageResponse>{body}</MessageResponse>
          </div>
        ) : (
          <p className="px-3 py-2 text-xs italic text-muted-foreground">
            {t("commentEmptyBody")}
          </p>
        )}
      </div>
    </article>
  )
}

/** Placeholder for the first load — the shape of two comments, so the section
 *  does not jump when they arrive. */
function CommentSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3">
      {[0, 1].map((i) => (
        <div key={i} className="flex gap-2.5">
          <Skeleton className="size-6 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Right-side detail panel for one issue / pull request.
 *
 * It replaces what the row's title used to do — leave the app for the forge's
 * own web page — because everything a triage pass needs is already in the list
 * payload: the body rides along with every row (see `ForgeIssueRow::body`), so
 * the panel draws instantly, and the list underneath keeps its filters, its
 * page and its scroll position. The panel is the same drawer the task board
 * uses, at the same width, for the same reason those all share
 * `SIDE_PANEL_CONTENT_CLASS`: they stack on one another.
 *
 * The discussion is the one thing that does cost a request (see
 * [`CommentThread`]) — it is not in the list payload and could not be, because
 * a list page holds thirty items whose reader opens at most one.
 */
export function ForgeIssueDetailSheet({
  row,
  link,
  folderId,
  onOpenChange,
  onStart,
}: {
  /** The item on show, or `null` when the panel is closed. Held by the page so
   *  a list refresh re-renders the panel with the item's fresh copy. */
  row: ForgeIssueRow | null
  /** Latest task for this item, if any — the footer's action depends on it. */
  link: ForgeTaskLink | null
  /** Which folder's repository the item belongs to — the only coordinate the
   *  comment fetch needs that the row does not carry (the backend derives the
   *  repository from this folder's own remote). `null` while no folder is
   *  resolved, which costs the thread and nothing else. */
  folderId: number | null
  onOpenChange: (open: boolean) => void
  /** Opens the page's trigger dialog on this item. */
  onStart: () => void
}) {
  const t = useTranslations("Forge")
  const tTasks = useTranslations("Tasks")
  const { setRoute } = useWorkbenchRoute()

  if (row == null) return null

  const chip = chipStateForLink(link)
  const active = chip === "active"
  const terminal = chip === "terminal"
  const { Icon, className: glyphClass, labelKey } = stateGlyph(row)
  const stateLabel = t(labelKey)
  const body = row.body?.trim()

  return (
    <Drawer open onOpenChange={onOpenChange} swipeDirection="right">
      <DrawerContent className={SIDE_PANEL_CONTENT_CLASS}>
        <DrawerHeader className="shrink-0 gap-0 border-b border-border px-5 py-4">
          {/* `pr-8` clears the close button in the corner. */}
          <div className="flex items-start gap-3 pr-8">
            {/* The list's own state glyph, given the framed tile the task
                sheet's agent icon has — at panel scale a bare 14px mark beside
                a two-line title reads as a stray bullet. */}
            <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/40">
              {/* Decoration here, unlike on the row: the state is spelled out
                  in the meta line below, and labelling both would read the
                  word twice to a screen reader. */}
              <Icon className={cn("size-[1.125rem]", glyphClass)} aria-hidden />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <DrawerTitle className="min-w-0 break-words text-[0.9375rem] font-semibold leading-5">
                {row.title}
              </DrawerTitle>
              {/* The row's own meta line, with the state spelled out: the list
                  can lean on a column of glyphs to carry the state, a single
                  item on its own cannot. */}
              <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[0.6875rem] text-muted-foreground">
                <span className={cn("font-medium", glyphClass)}>
                  {stateLabel}
                </span>
                <span className="font-mono">· #{row.number}</span>
                {row.author ? <span>· {row.author}</span> : null}
                {row.updated_at ? (
                  <span title={absolute(row.updated_at)}>
                    · {t("detailUpdated", { time: relative(row.updated_at) })}
                  </span>
                ) : null}
                {row.comments > 0 ? (
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <span aria-hidden>·</span>
                    <MessageSquare className="size-3" aria-hidden />
                    {t("commentCount", { count: row.comments })}
                  </span>
                ) : null}
              </div>
              {/* EVERY label, unlike the row — the panel is where the ones the
                  row had to drop finally show. */}
              {row.labels.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1">
                  {row.labels.map((label) => (
                    <ForgeLabelChip
                      key={label.name}
                      label={label}
                      className="h-5 px-2 text-[0.6875rem]"
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <DrawerDescription className="sr-only">
            {t("detailDescription")}
          </DrawerDescription>
        </DrawerHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="px-5 py-4">
            {body ? (
              // The forge's own Markdown, through the same renderer the chat
              // uses — headings, task lists, tables, fenced code and images all
              // come out as the author wrote them, and link clicks go through
              // the app's link-safety routing rather than the webview.
              <div
                className={cn(
                  "break-words text-[0.8125rem] leading-relaxed",
                  BODY_MARKDOWN
                )}
              >
                <MessageResponse>{body}</MessageResponse>
              </div>
            ) : (
              <p className="py-6 text-center text-xs text-muted-foreground">
                {t("detailNoBody")}
              </p>
            )}
          </div>

          {/* Keyed by the ITEM, not by the row object: the page re-reads the
              row from the list on every render, so identity changes whenever
              anything behind the panel refreshes — and a thread that remounted
              on each of those would re-fetch, lose its loaded pages and scroll
              the reader back to the top. The panel is non-modal, though, so
              clicking a different row swaps the item underneath without ever
              closing; this key is what resets the thread when that happens. */}
          {folderId != null ? (
            <CommentThread
              key={`${row.is_pr ? "pr" : "issue"}-${row.number}`}
              folderId={folderId}
              kind={row.is_pr ? "pr" : "issue"}
              number={row.number}
            />
          ) : null}
        </ScrollArea>

        {/* The way out to the forge on one side, what to DO about the item on
            the other. Same pills as the row, so an item's action does not
            change shape on the way into the panel — only the fill does: here
            "Start" is the one thing the panel is asking for, and gets the
            filled treatment a column of rows could not afford. */}
        <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
          {/* A real anchor wearing the pill, not a button that calls `openUrl`:
              `href` is what gives it "copy link address", the status-bar
              preview and a screen reader that says "link". `BrowserLink` is
              what keeps the click working in the desktop webview. */}
          <BrowserLink
            href={row.html_url}
            className={cn(
              ROW_ACTION,
              "inline-flex items-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            )}
          >
            <ExternalLink className={ROW_ACTION_GLYPH} aria-hidden />
            {t("openItem")}
          </BrowserLink>

          <div className="ms-auto flex items-center gap-1.5">
            {link == null ? (
              <Button
                type="button"
                size="sm"
                className={ROW_ACTION}
                onClick={onStart}
              >
                <CirclePlay className={ROW_ACTION_GLYPH} aria-hidden />
                {t("start")}
              </Button>
            ) : (
              // Siblings, never nested — same reason as on the row: a button
              // inside a button folds its text into the outer one's accessible
              // name and leaves keyboard activation to the browser.
              <>
                {terminal ? (
                  <button
                    type="button"
                    onClick={onStart}
                    className="inline-flex items-center gap-1 text-[0.6875rem] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    <RotateCcw className="size-3" aria-hidden />
                    {t("retrigger")}
                  </button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setRoute("tasks")}
                  title={t("viewTask")}
                  className={cn(
                    ROW_ACTION,
                    active ? CHIP_FILL.active : CHIP_FILL.settled
                  )}
                >
                  <ListTodo className={ROW_ACTION_GLYPH} aria-hidden />
                  {tTasks(statusLabelKey(link.status))}
                </Button>
              </>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
