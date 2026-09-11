import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ReplyArtifacts } from "@/components/message/reply-artifacts"
import messages from "@/i18n/messages/zh-CN.json"
import type { MessageTurn } from "@/lib/types"

const { extract, open } = vi.hoisted(() => ({
  extract: vi.fn(),
  open: vi.fn(),
}))
vi.mock("@/lib/session-files", () => ({ extractReplyFileChanges: extract }))
vi.mock("@/hooks/use-open-file-target", () => ({
  useOpenFileTarget: () => open,
}))
vi.mock("@/contexts/active-folder-context", () => ({
  useActiveFolder: () => ({ activeFolder: { path: "/repo" } }),
}))
vi.mock("@/lib/platform", () => ({ isLocalDesktop: () => false }))
const turns = [{ id: "reply-1" }] as MessageTurn[]
const files = [
  {
    id: "1",
    path: "/repo/src/new.ts",
    additions: 16,
    deletions: 0,
    diff: "*** Add File: src/new.ts\n+new",
  },
  {
    id: "2",
    path: "/repo/src/edit.ts",
    additions: 51,
    deletions: 7,
    diff: "*** Update File: src/edit.ts\n-old\n+new",
  },
  {
    id: "3",
    path: "/repo/config/settings.json",
    additions: 1,
    deletions: 1,
    diff: "settings diff",
  },
  {
    id: "4",
    path: "/repo/src/gone.ts",
    additions: 0,
    deletions: 2,
    diff: "*** Delete File: src/gone.ts\n-old",
  },
]
function card(complete = true) {
  return (
    <NextIntlClientProvider locale="zh-CN" messages={messages}>
      <ReplyArtifacts sourceTurns={turns} isResponseComplete={complete} />
    </NextIntlClientProvider>
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  extract.mockReturnValue(files)
})
describe("MaxCode compact reply change summary", () => {
  it("combines new, modified and removed files with totals and three initial rows", () => {
    render(card())
    expect(screen.getAllByRole("region")).toHaveLength(1)
    expect(screen.getByText("已编辑 4 个文件")).toBeVisible()
    expect(screen.getByText("+68")).toBeVisible()
    expect(screen.getByText("-10")).toBeVisible()
    expect(screen.getAllByRole("listitem")).toHaveLength(3)
    expect(
      screen.getByRole("button", { name: "打开 src/new.ts" })
    ).toHaveTextContent("src/new.ts")
    fireEvent.click(screen.getByRole("button", { name: "再显示 1 个文件" }))
    expect(screen.getAllByRole("listitem")).toHaveLength(4)
    expect(screen.getByText("gone.ts")).toHaveClass("line-through")
    fireEvent.click(screen.getByRole("button", { name: "收起" }))
    expect(screen.getAllByRole("listitem")).toHaveLength(3)
  })
  it("reviews every file including collapsed entries and opens files normally", () => {
    render(card())
    fireEvent.click(screen.getByRole("button", { name: "审核" }))
    expect(open).toHaveBeenCalledWith(files[0].path, {
      diff: {
        content: files.map((file) => file.diff).join("\n\n"),
        groupLabel: "reply-1:review",
      },
    })
    fireEvent.click(screen.getByRole("button", { name: "打开 src/new.ts" }))
    expect(open).toHaveBeenLastCalledWith(files[0].path)
  })
  it("does not parse or display incomplete replies, and hides empty summaries", () => {
    const { rerender } = render(card(false))
    expect(extract).not.toHaveBeenCalled()
    expect(screen.queryByRole("region")).toBeNull()
    extract.mockReturnValue([])
    rerender(card())
    expect(screen.queryByRole("region")).toBeNull()
  })
})
