/** Issue rows retain browsing and metadata without work-task controls. */
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import type {
  ForgeIssueRow,
  ForgeLabel,
  ForgeTaskLink,
  WorkTaskStatus,
} from "@/lib/types"

import { ForgeIssueRowItem } from "./forge-issue-row"

/** Uncoloured unless a test cares — most of them are about something else. */
function label(name: string, color: string | null = null): ForgeLabel {
  return { name, color }
}

const setRoute = vi.fn()
vi.mock("@/contexts/workbench-route-context", () => ({
  useWorkbenchRoute: () => ({
    routeId: "forge",
    isConversations: false,
    setRoute,
    openConversations: vi.fn(),
  }),
}))

function row(overrides: Partial<ForgeIssueRow> = {}): ForgeIssueRow {
  return {
    number: 42,
    title: "Login times out",
    body: "steps to reproduce…",
    state: "open",
    draft: false,
    labels: [label("bug"), label("p1")],
    author: "octocat",
    author_avatar: "https://avatars.githubusercontent.com/u/583231",
    updated_at: null,
    html_url: "https://github.com/o/r/issues/42",
    is_pr: false,
    comments: 0,
    ...overrides,
  }
}

function link(status: WorkTaskStatus): ForgeTaskLink {
  return {
    source_key: "github:github.com/o/r/issue/42",
    task_id: 3,
    status,
    verdict: null,
    updated_at: "2026-08-19T00:00:00Z",
  }
}

const onOpenDetail = vi.fn()

function mount(
  item: ForgeIssueRow,
  taskLink: ForgeTaskLink | null,
  onStart = vi.fn(),
  compact = false
) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ForgeIssueRowItem
        row={item}
        link={taskLink}
        compact={compact}
        onOpenDetail={onOpenDetail}
        onStart={onStart}
      />
    </NextIntlClientProvider>
  )
  return onStart
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("ForgeIssueRowItem", () => {
  it.each([null, "running", "done", "canceled"] as const)(
    "has no task actions for %s",
    (status) => {
      const onStart = mount(row(), status == null ? null : link(status))
      expect(screen.queryByRole("button", { name: "Start" })).toBeNull()
      expect(screen.queryByRole("button", { name: "re-trigger" })).toBeNull()
      expect(screen.queryByTitle("View task")).toBeNull()
      expect(onStart).not.toHaveBeenCalled()
      expect(setRoute).not.toHaveBeenCalled()
    }
  )

  it("shows the first labels and the identity line", () => {
    mount(row({ labels: ["a", "b", "c", "d", "e"].map((n) => label(n)) }), null)
    // Four labels fit the row; the fifth would push the action off the edge.
    expect(screen.getByText("d")).toBeInTheDocument()
    expect(screen.queryByText("e")).not.toBeInTheDocument()
    expect(screen.getByText("#42")).toBeInTheDocument()
    expect(screen.getByText("· octocat")).toBeInTheDocument()
  })

  /** The title used to be a link OUT of the app; reading an issue meant losing
   *  the list, its filters and its scroll position to a browser tab. It now
   *  opens the detail panel instead — and stays a real `<button>`, so Enter and
   *  Space work without hand-written key handling. */
  it("opens the detail panel from the title, by click and from the keyboard", async () => {
    const user = userEvent.setup()
    const onStart = mount(row(), null)
    const title = screen.getByRole("button", { name: "Login times out" })
    expect(title).not.toHaveAttribute("href")

    await user.click(title)
    title.focus()
    await user.keyboard("{Enter}")
    await user.keyboard(" ")
    expect(onOpenDetail).toHaveBeenCalledTimes(3)
    // Opening the panel is not triggering the item.
    expect(onStart).not.toHaveBeenCalled()
    expect(setRoute).not.toHaveBeenCalled()
  })

  /** The way out to the forge did not disappear with the title's link — it
   *  moved to the number, which is what both forges use as the item's own link.
   *  `target="_blank"` is what `BrowserLink` needs to stay a real link; the
   *  click itself is routed through `openUrl`. */
  it("keeps a link to the forge on the item's number", () => {
    mount(row(), null)
    const number = screen.getByRole("link", { name: "#42" })
    expect(number).toHaveAttribute("href", "https://github.com/o/r/issues/42")
    expect(number).toHaveAttribute("target", "_blank")
  })

  /** A phone-width row cannot fit four label chips AND a readable title. */
  it("keeps a single label at phone width", () => {
    mount(
      row({ labels: ["a", "b", "c"].map((n) => label(n)) }),
      null,
      vi.fn(),
      true
    )
    expect(screen.getByText("a")).toBeInTheDocument()
    expect(screen.queryByText("b")).not.toBeInTheDocument()
  })

  /** The count means "there is a discussion here", so a zero says nothing —
   *  and a column of zeroes down the list is pure noise. Both forges' own
   *  lists hide it the same way. */
  it("shows the comment count only when there are comments", () => {
    mount(row({ comments: 7 }), null)
    expect(screen.getByText("7")).toBeInTheDocument()
    expect(screen.getByTitle("7 comments")).toBeInTheDocument()

    cleanup()
    mount(row({ comments: 0 }), null)
    expect(screen.queryByText("0")).not.toBeInTheDocument()
  })

  /** A triage list is scanned by label colour before it is read, so the chip
   *  wears the project's own. Both themes' values ride along together (the
   *  theme is a class on the root, which an inline style cannot see) — see
   *  `forge-label-color.test.ts` for the maths. */
  it("paints a label in the colour its project gave it", () => {
    mount(row({ labels: [label("bug", "#d73a4a")] }), null)
    const chip = screen.getByText("bug")
    expect(chip).toHaveClass("forge-label")
    expect(chip.style.getPropertyValue("--fl-bg")).toBe("#d73a4a")
    expect(chip.style.getPropertyValue("--fl-bg-dark")).toBe(
      "rgb(215 58 74 / 0.18)"
    )
  })

  /** A colour the forge could not give (GitLab accepts CSS colour names, which
   *  the backend refuses to forward) leaves the label neutral rather than
   *  painted something invented. */
  it("leaves an uncoloured label on the neutral chip", () => {
    mount(row({ labels: [label("chore")] }), null)
    const chip = screen.getByText("chore")
    expect(chip).not.toHaveClass("forge-label")
    expect(chip).toHaveClass("text-muted-foreground")
    expect(chip.getAttribute("style")).toBeNull()
  })

  /**
   * A pull request has four outcomes and an issue two, and the row has to tell
   * them apart by SHAPE and by an accessible name — colour alone reaches
   * neither a colour-blind reader nor a screen reader. Each case asserts the
   * rendered `<svg>`'s own class, because that is what carries both.
   */
  describe("state glyph", () => {
    function glyph(item: ForgeIssueRow, name: string) {
      mount(item, null)
      return screen.getByRole("img", { name })
    }

    it.each([
      [
        "issue, open",
        { is_pr: false, state: "open" },
        "Open",
        "lucide-circle-dot",
      ],
      [
        "issue, closed",
        { is_pr: false, state: "closed" },
        "Closed",
        "lucide-circle-check",
      ],
      [
        "pull request, open",
        { is_pr: true, state: "open" },
        "Open",
        "lucide-git-pull-request-arrow",
      ],
      [
        "pull request, merged",
        { is_pr: true, state: "merged" },
        "Merged",
        "lucide-git-merge",
      ],
      [
        "pull request, closed",
        { is_pr: true, state: "closed" },
        "Closed",
        "lucide-git-pull-request-closed",
      ],
      [
        "pull request, draft",
        { is_pr: true, state: "open", draft: true },
        "Draft",
        "lucide-git-pull-request-draft",
      ],
    ])("%s", (_case, overrides, label, icon) => {
      expect(glyph(row(overrides), label)).toHaveClass(icon)
    })

    /** Draft outranks open: a draft IS open, and "not ready for review" is the
     *  thing a triage list is scanning for. */
    it("prefers draft over the underlying open state", () => {
      expect(
        glyph(row({ is_pr: true, state: "open", draft: true }), "Draft")
      ).toBeInTheDocument()
      expect(
        screen.queryByRole("img", { name: "Open" })
      ).not.toBeInTheDocument()
    })

    /** `draft` is meaningless on an issue and must not change its glyph. */
    it("ignores draft on an issue", () => {
      expect(
        glyph(row({ is_pr: false, state: "open", draft: true }), "Open")
      ).toHaveClass("lucide-circle-dot")
    })
  })
})
