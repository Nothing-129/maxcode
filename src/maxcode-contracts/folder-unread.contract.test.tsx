import { cleanup, render } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it } from "vitest"
import { collectUnreadFolders } from "@/lib/folder-unread"
import { SidebarFolderGroupHeader } from "@/components/conversations/sidebar-folder-group-header"
import enMessages from "@/i18n/messages/en.json"

afterEach(cleanup)

describe("MaxCode folder unread contract", () => {
  const conversations = [
    { id: 1, folder_id: 10, status: "completed", kind: "regular" },
    { id: 2, folder_id: 20, status: "done", kind: "regular" },
    { id: 3, folder_id: 30, status: "in_progress", kind: "regular" },
    { id: 4, folder_id: 40, status: "completed", kind: "chat" },
  ] as const

  it("aggregates settled unread sessions and folds worktrees when hidden", () => {
    expect(
      collectUnreadFolders(conversations, new Set([1, 2, 3, 4, 99]), new Map())
    ).toEqual(new Set([10, 20]))
    expect(
      collectUnreadFolders(conversations, new Set([2]), new Map([[20, 10]]))
    ).toEqual(new Set([10]))
    expect(collectUnreadFolders(conversations, new Set(), new Map())).toEqual(
      new Set()
    )
  })

  it.each([true, false])(
    "does not propagate unread to folder groups with expanded=%s",
    (expanded) => {
      const tree = (
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <SidebarFolderGroupHeader
            groupId={7}
            name="Work"
            runningCount={1}
            expanded={expanded}
            themeColor="inherit"
            appThemeColor="neutral"
          />
        </NextIntlClientProvider>
      )
      const { container } = render(tree)
      expect(container.querySelector("[data-unread-dot]")).toBeNull()
      expect(
        container.querySelector('[title="1 session running"]') !== null
      ).toBe(!expanded)
    }
  )
})
