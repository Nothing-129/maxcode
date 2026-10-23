import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ConversationFolderBranchPicker } from "@/components/chat/conversation-context-bar"
import {
  resetAppWorkspaceStore,
  useAppWorkspaceStore,
} from "@/stores/app-workspace-store"
import type { FolderDetail } from "@/lib/types"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))
vi.mock("@/contexts/tab-context", () => ({
  useTabStore: (selector: (state: unknown) => unknown) =>
    selector({ tabs: [], activeTabId: null }),
  useTabActions: () => ({}),
}))
vi.mock("@/components/layout/branch-dropdown", () => ({
  BranchDropdown: () => null,
}))

afterEach(() => {
  cleanup()
  resetAppWorkspaceStore()
})

describe("composer folder chip prefers the folder remark", () => {
  it.each([
    ["  律总管  ", false, true, "律总管"],
    ["律总管", false, false, "律总管"],
    [null, false, true, "law-total-sys"],
    ["   ", false, true, "law-total-sys"],
    ["律总管", true, true, "律总管"],
    [null, true, true, "law-total-sys"],
  ])(
    "renders alias %s (worktree %s, editable %s)",
    (alias, worktree, editable, expected) => {
      const repo: FolderDetail = {
        id: 1,
        name: "law-total-sys",
        alias,
        path: "/repo/law-total-sys",
        parent_id: null,
        kind: "regular",
        git_branch: null,
        default_agent_type: null,
        last_opened_at: "2026-10-23T00:00:00Z",
        sort_order: 0,
        color: "blue",
        group_id: null,
      }
      const child = {
        ...repo,
        id: 2,
        name: "feature",
        alias: "分支备注",
        parent_id: 1,
        path: "/repo/feature",
      }
      useAppWorkspaceStore.setState({
        folders: [repo],
        allFolders: [repo, child],
      })
      const onSelectFolder = vi.fn()
      render(
        <ConversationFolderBranchPicker
          override={{
            folderId: worktree ? 2 : 1,
            editable,
            onSelectFolder,
            onSelectChatMode: vi.fn(),
          }}
        />
      )
      const chip = screen.getByRole("button", { name: expected })
      expect(chip).toHaveTextContent(expected)
      expect(chip).toHaveAttribute("title", `folderTitle: ${expected}`)
      expect(onSelectFolder).not.toHaveBeenCalled()
      expect(repo.path).toBe("/repo/law-total-sys")
    }
  )
})
