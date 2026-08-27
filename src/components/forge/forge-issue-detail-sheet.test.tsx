/**
 * The right-side detail panel the row's title now opens.
 *
 * What matters beyond plain rendering: the body goes through the Markdown
 * renderer rather than being printed as source, the panel shows EVERY label
 * (the row has to drop all but four), the discussion is fetched for the item
 * on show and paged through in place, and the footer offers the same
 * three-state action the row does — with the way out to the forge kept as a
 * real link.
 */
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import type {
  ForgeComment,
  ForgeCommentList,
  ForgeIssueRow,
  ForgeLabel,
  ForgeTaskLink,
  WorkTaskStatus,
} from "@/lib/types"

import { ForgeIssueDetailSheet } from "./forge-issue-detail-sheet"

const setRoute = vi.fn()
vi.mock("@/contexts/workbench-route-context", () => ({
  useWorkbenchRoute: () => ({
    routeId: "forge",
    isConversations: false,
    setRoute,
    openConversations: vi.fn(),
  }),
}))
// The real one reaches the workspace context (link safety routes file links
// into the file panel), which this panel is mounted outside of. The stub keeps
// the assertion honest where it counts: it reports WHAT it was handed, so a
// panel that stopped sending the body through the renderer would fail.
vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children?: string }) => (
    <div data-testid="markdown">{children}</div>
  ),
}))
const forgeListComments = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api", () => ({ forgeListComments }))

function comment(overrides: Partial<ForgeComment> = {}): ForgeComment {
  return {
    id: "1",
    author: "octocat",
    author_avatar: null,
    body: "Looks right to me",
    created_at: "2026-08-20T00:00:00Z",
    updated_at: null,
    html_url: "https://github.com/o/r/issues/42#issuecomment-1",
    ...overrides,
  }
}

function commentPage(
  comments: ForgeComment[],
  hasNext = false,
  page = 1
): ForgeCommentList {
  return { comments, page, per_page: 20, has_next: hasNext }
}

function label(name: string, color: string | null = null): ForgeLabel {
  return { name, color }
}

function row(overrides: Partial<ForgeIssueRow> = {}): ForgeIssueRow {
  return {
    number: 42,
    title: "Login times out",
    body: "## Steps\n\n1. Sign in",
    state: "open",
    draft: false,
    labels: [label("bug")],
    author: "octocat",
    updated_at: null,
    html_url: "https://github.com/o/r/issues/42",
    is_pr: false,
    comments: 0,
    ...overrides,
  }
}

function taskLink(status: WorkTaskStatus): ForgeTaskLink {
  return {
    source_key: "github:github.com/o/r/issue/42",
    task_id: 3,
    status,
    verdict: null,
    updated_at: "2026-08-19T00:00:00Z",
  }
}

function mount(
  item: ForgeIssueRow | null,
  link: ForgeTaskLink | null = null,
  handlers: {
    onOpenChange?: () => void
    onStart?: () => void
    folderId?: number | null
  } = {}
) {
  const onOpenChange = handlers.onOpenChange ?? vi.fn()
  const onStart = handlers.onStart ?? vi.fn()
  const view = render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ForgeIssueDetailSheet
        row={item}
        link={link}
        folderId={handlers.folderId === undefined ? 7 : handlers.folderId}
        onOpenChange={onOpenChange}
        onStart={onStart}
      />
    </NextIntlClientProvider>
  )
  return { onOpenChange, onStart, view }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Still in flight, by default: mounting the panel always asks for the
  // thread, and a request that RESOLVES would land its state update after a
  // test that never awaited it had finished — an `act(…)` warning on every
  // case that is about the header or the footer. The tests that are about the
  // discussion say what comes back for themselves.
  forgeListComments.mockReturnValue(new Promise(() => {}))
})

describe("ForgeIssueDetailSheet", () => {
  /** `null` is the closed state — the page clears the row to close. */
  it("renders nothing without an item", () => {
    mount(null)
    expect(screen.queryByText("Login times out")).not.toBeInTheDocument()
  })

  it("renders the item's body as Markdown, not as source", () => {
    mount(row())
    expect(screen.getByTestId("markdown")).toHaveTextContent("## Steps")
    expect(screen.queryByText("No description")).not.toBeInTheDocument()
  })

  /** An empty body must not leave the panel looking like it failed to load.
   *  Whitespace counts as empty — GitLab hands back "" for a description that
   *  was never written, GitHub `null`. */
  it.each([
    ["null", null],
    ["empty", ""],
    ["blank", "   \n  "],
  ])("says so when the body is %s", (_case, body) => {
    mount(row({ body }))
    expect(screen.getByText("No description")).toBeInTheDocument()
    expect(screen.queryByTestId("markdown")).not.toBeInTheDocument()
  })

  /** The row caps labels at four so the action stays on screen; the panel is
   *  where the dropped ones are finally readable. */
  it("shows every label, not the row's first four", () => {
    mount(row({ labels: ["a", "b", "c", "d", "e"].map((n) => label(n)) }))
    for (const name of ["a", "b", "c", "d", "e"]) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
  })

  /** The state is a glyph on the row, where a column of them reads at a
   *  glance. A single item has no column to compare against, so the panel
   *  spells the state out — and the glyph beside it becomes decoration, or a
   *  screen reader would say the word twice. */
  it("spells the state out beside the title", () => {
    mount(row({ is_pr: true, state: "merged" }))
    expect(screen.getByText("Merged")).toBeInTheDocument()
    expect(
      screen.queryByRole("img", { name: "Merged" })
    ).not.toBeInTheDocument()
  })

  it("keeps the forge one click away as a real link", () => {
    mount(row())
    const link = screen.getByRole("link", { name: "Open in browser" })
    expect(link).toHaveAttribute("href", "https://github.com/o/r/issues/42")
    expect(link).toHaveAttribute("target", "_blank")
  })

  it("offers Start when no task has ever handled the item", async () => {
    const user = userEvent.setup()
    const { onStart } = mount(row())
    await user.click(screen.getByRole("button", { name: "Start" }))
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(setRoute).not.toHaveBeenCalled()
  })

  it("shows a live task's status chip, which goes to the board", async () => {
    const user = userEvent.setup()
    const { onStart } = mount(row(), taskLink("running"))
    expect(
      screen.queryByRole("button", { name: "Start" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "re-trigger" })
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Running" }))
    expect(setRoute).toHaveBeenCalledWith("tasks")
    expect(onStart).not.toHaveBeenCalled()
  })

  /** Same rule as the row: siblings, never nested — a control inside a button
   *  folds its text into that button's accessible name. */
  it("keeps the chip and the re-trigger as separate controls once settled", async () => {
    const user = userEvent.setup()
    const { onStart } = mount(row(), taskLink("done"))
    const chip = screen.getByRole("button", { name: "Done" })
    const retrigger = screen.getByRole("button", { name: "re-trigger" })
    expect(chip).not.toContainElement(retrigger)

    await user.click(retrigger)
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(setRoute).not.toHaveBeenCalled()
  })

  /** The count sits in the identity line, where it is one more fact about the
   *  item — absent, not zero, when there is no discussion. The thread below
   *  carries its own heading and does not repeat the number: two counts that
   *  can disagree (the row is a snapshot, the thread is live) is worse than
   *  one. */
  it("reports the comment count only when there is a discussion", () => {
    mount(row({ comments: 7 }))
    const header = screen
      .getByText("Login times out")
      .closest("[data-slot='drawer-header']") as HTMLElement
    expect(within(header).getByText("7 comments")).toBeInTheDocument()

    cleanup()
    mount(row({ comments: 0 }))
    const bare = screen
      .getByText("Login times out")
      .closest("[data-slot='drawer-header']") as HTMLElement
    expect(within(bare).queryByText(/comments/i)).not.toBeInTheDocument()
  })

  describe("the discussion", () => {
    /** The item's coordinates, and only those: the repository comes from the
     *  folder's own remote, server-side. */
    it("fetches the thread for the item on show and renders it", async () => {
      forgeListComments.mockResolvedValue(
        commentPage([comment({ body: "Cannot reproduce" })])
      )
      mount(row())

      await waitFor(() =>
        expect(forgeListComments).toHaveBeenCalledWith(7, {
          kind: "issue",
          number: 42,
          page: 1,
        })
      )
      expect(await screen.findByText("octocat")).toBeInTheDocument()
      // Through the Markdown renderer, like the body — a comment is the same
      // kind of forge Markdown.
      const rendered = screen
        .getAllByTestId("markdown")
        .map((el) => el.textContent)
      expect(rendered).toContain("Cannot reproduce")
      expect(
        screen.getByRole("link", { name: "Open this comment in the browser" })
      ).toHaveAttribute(
        "href",
        "https://github.com/o/r/issues/42#issuecomment-1"
      )
    })

    /** GitLab keeps issue notes and merge-request notes on different
     *  endpoints, so the kind travels with the request. */
    it("asks about a pull request as a pull request", async () => {
      mount(row({ is_pr: true, number: 9 }))
      await waitFor(() =>
        expect(forgeListComments).toHaveBeenCalledWith(7, {
          kind: "pr",
          number: 9,
          page: 1,
        })
      )
    })

    it("says so when nobody has replied", async () => {
      forgeListComments.mockResolvedValue(commentPage([]))
      mount(row())
      expect(await screen.findByText("No comments yet")).toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: "Load more" })
      ).not.toBeInTheDocument()
    })

    /** Offset pagination over a live collection: a comment posted between the
     *  two requests shifts everything down one and serves the last of page 1
     *  again at the top of page 2. It must appear once. */
    it("appends the next page without repeating what is already on screen", async () => {
      const user = userEvent.setup()
      const first = comment({ id: "1", body: "first" })
      const second = comment({ id: "2", body: "second" })
      forgeListComments
        .mockResolvedValueOnce(commentPage([first, second], true, 1))
        .mockResolvedValueOnce(
          commentPage([second, comment({ id: "3", body: "third" })], false, 2)
        )
      mount(row())

      await screen.findByText("first")
      await user.click(screen.getByRole("button", { name: "Load more" }))

      await screen.findByText("third")
      expect(forgeListComments).toHaveBeenLastCalledWith(7, {
        kind: "issue",
        number: 42,
        page: 2,
      })
      // The one that arrived twice is on screen once, and the page already
      // read is still there.
      expect(screen.getAllByText("second")).toHaveLength(1)
      expect(screen.getByText("first")).toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: "Load more" })
      ).not.toBeInTheDocument()
    })

    /** GitLab filters its system events ("changed the milestone") AFTER
     *  paginating, so a page can come back holding nothing a human wrote while
     *  the discussion continues on the next one. "Load more" follows the
     *  forge's own `has_next`, never the row count. */
    it("still offers more when a page held only system events", async () => {
      forgeListComments.mockResolvedValue(commentPage([], true, 1))
      mount(row())

      expect(
        await screen.findByRole("button", { name: "Load more" })
      ).toBeInTheDocument()
      expect(screen.queryByText("No comments yet")).not.toBeInTheDocument()
    })

    /** A failed "load more" costs the rest of the thread, not the part being
     *  read — and the retry re-asks for the page that FAILED. */
    it("keeps the loaded pages when the next one fails, and retries that page", async () => {
      const user = userEvent.setup()
      forgeListComments
        .mockResolvedValueOnce(
          commentPage([comment({ id: "1", body: "first" })], true, 1)
        )
        .mockRejectedValueOnce(new Error("network is down"))
        .mockResolvedValueOnce(
          commentPage([comment({ id: "2", body: "later" })], false, 2)
        )
      mount(row())

      await screen.findByText("first")
      await user.click(screen.getByRole("button", { name: "Load more" }))
      expect(await screen.findByText(/network is down/)).toBeInTheDocument()
      expect(screen.getByText("first")).toBeInTheDocument()

      await user.click(screen.getByRole("button", { name: "Try again" }))
      await screen.findByText("later")
      // Page 2 again — not 3 (which would skip it) and not 1 (which would
      // throw away what is on screen).
      expect(forgeListComments).toHaveBeenLastCalledWith(7, {
        kind: "issue",
        number: 42,
        page: 2,
      })
    })

    /** The retry re-asks for the page that FAILED, and a refresh is page 1 no
     *  matter how far the thread had been paged. Deriving the retry from the
     *  "load more" cursor instead would ask for the page AFTER the one on
     *  screen and append it to the very data the refresh was there to replace. */
    it("retries a failed refresh as a refresh, not as another page", async () => {
      const user = userEvent.setup()
      forgeListComments
        .mockResolvedValueOnce(
          commentPage([comment({ id: "1", body: "stale" })], true, 1)
        )
        .mockRejectedValueOnce(new Error("refresh fell over"))
        .mockResolvedValueOnce(
          commentPage([comment({ id: "2", body: "fresh" })], false, 1)
        )
      mount(row())

      await screen.findByText("stale")
      await user.click(
        screen.getByRole("button", { name: "Refresh the comments" })
      )
      expect(await screen.findByText(/refresh fell over/)).toBeInTheDocument()

      await user.click(screen.getByRole("button", { name: "Try again" }))
      await screen.findByText("fresh")
      expect(forgeListComments).toHaveBeenLastCalledWith(7, {
        kind: "issue",
        number: 42,
        page: 1,
      })
      // Page 1 REPLACES — the stale copy the refresh was sent for is gone,
      // rather than sitting above an appended page 2.
      expect(screen.queryByText("stale")).not.toBeInTheDocument()
    })

    /** Both forges stamp an `updated_at` on creation, so the backend sends one
     *  only when it differs. The panel must not invent the mark for itself. */
    it("marks an edited comment, and only an edited one", async () => {
      forgeListComments.mockResolvedValue(
        commentPage([
          comment({ id: "1", body: "untouched" }),
          comment({
            id: "2",
            body: "revised",
            updated_at: "2026-08-21T00:00:00Z",
          }),
        ])
      )
      mount(row())
      expect(await screen.findByText(/edited/)).toBeInTheDocument()
      expect(screen.getAllByText(/edited/)).toHaveLength(1)
    })

    /** Back to page 1 wholesale: an edited or deleted comment is a change no
     *  append could show, so a refresh REPLACES rather than doubling. */
    it("refreshes the thread from the top", async () => {
      const user = userEvent.setup()
      forgeListComments
        .mockResolvedValueOnce(commentPage([comment({ id: "1", body: "old" })]))
        .mockResolvedValueOnce(commentPage([comment({ id: "9", body: "new" })]))
      mount(row())

      await screen.findByText("old")
      await user.click(
        screen.getByRole("button", { name: "Refresh the comments" })
      )

      await screen.findByText("new")
      expect(screen.queryByText("old")).not.toBeInTheDocument()
      expect(forgeListComments).toHaveBeenLastCalledWith(7, {
        kind: "issue",
        number: 42,
        page: 1,
      })
    })

    /** The panel is non-modal, so clicking another row swaps the item under it
     *  without ever closing — the thread has to follow. */
    it("follows the panel to another item", async () => {
      const { view } = mount(row())
      await waitFor(() =>
        expect(forgeListComments).toHaveBeenCalledWith(
          7,
          expect.objectContaining({ number: 42 })
        )
      )
      view.rerender(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <ForgeIssueDetailSheet
            row={row({ number: 43, title: "Another one" })}
            link={null}
            folderId={7}
            onOpenChange={vi.fn()}
            onStart={vi.fn()}
          />
        </NextIntlClientProvider>
      )
      await waitFor(() =>
        expect(forgeListComments).toHaveBeenLastCalledWith(
          7,
          expect.objectContaining({ number: 43, page: 1 })
        )
      )
    })

    /** A re-render that changes nothing about the item — the page re-reads the
     *  row from the list on every one — must not re-fetch, or a refresh behind
     *  the panel would reset the thread and scroll the reader to the top. */
    it("does not re-fetch when the row object is merely replaced", async () => {
      const { view } = mount(row())
      await waitFor(() => expect(forgeListComments).toHaveBeenCalledTimes(1))
      view.rerender(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <ForgeIssueDetailSheet
            row={row({ title: "Login times out (edited)" })}
            link={null}
            folderId={7}
            onOpenChange={vi.fn()}
            onStart={vi.fn()}
          />
        </NextIntlClientProvider>
      )
      await screen.findByText("Login times out (edited)")
      expect(forgeListComments).toHaveBeenCalledTimes(1)
    })

    /** No folder, no repository to ask about — the panel keeps everything the
     *  row already carries rather than showing a thread it cannot fetch. */
    it("skips the thread when no folder is resolved", async () => {
      mount(row(), null, { folderId: null })
      await screen.findByText("Login times out")
      expect(forgeListComments).not.toHaveBeenCalled()
      expect(screen.queryByText("Comments")).not.toBeInTheDocument()
    })
  })

  /** The page owns the open state (it holds the row), so every exit has to
   *  travel back out through `onOpenChange` — a panel that only closed itself
   *  internally would leave the page thinking it was still open. `close-press`
   *  rather than `anything()`: the drawer wrapper cancels ambient dismissals,
   *  so only that reason proves the button is really wired. */
  it("asks the page to close from the close button and from Escape", async () => {
    const user = userEvent.setup()
    const { onOpenChange } = mount(row())
    await user.click(screen.getByRole("button", { name: "Close" }))
    expect(onOpenChange).toHaveBeenCalledWith(
      false,
      expect.objectContaining({ reason: "close-press" })
    )

    cleanup()
    const second = mount(row())
    await user.keyboard("{Escape}")
    expect(second.onOpenChange).toHaveBeenCalledWith(
      false,
      expect.objectContaining({ reason: "escape-key" })
    )
  })

  /** The identity line under the title: the number, who opened it, nothing the
   *  reader has to go looking for elsewhere. */
  it("identifies the item under its title", () => {
    mount(row({ updated_at: "2026-08-20T00:00:00Z" }))
    const title = screen.getByText("Login times out")
    const header = title.closest("[data-slot='drawer-header']")
    expect(header).not.toBeNull()
    expect(within(header as HTMLElement).getByText("· #42")).toBeInTheDocument()
    expect(
      within(header as HTMLElement).getByText("· octocat")
    ).toBeInTheDocument()
    expect(
      within(header as HTMLElement).getByText(/updated/)
    ).toBeInTheDocument()
  })
})
