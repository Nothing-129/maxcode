import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WelcomeHero } from "@/components/chat/welcome-hero"
import type { FolderDetail } from "@/lib/types"
import {
  resetAppWorkspaceStore,
  useAppWorkspaceStore,
} from "@/stores/app-workspace-store"

// ---------------------------------------------------------------------------
// Mocks. The header folder picker reads the tab store + tab actions and renders
// the shared FolderPicker (cmdk); the folder-display helpers run for real.
// ---------------------------------------------------------------------------

const openNewConversationTab = vi.fn()

vi.mock("next-intl", () => ({
  useTranslations: () =>
    Object.assign((key: string) => key, {
      rich: (key: string, values: { folder?: () => React.ReactNode }) =>
        values.folder ? <>Build in {values.folder()}</> : key,
    }),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

// Tab state, mutated per test before render. Workspace state (folders /
// branches) is seeded into the real zustand store in beforeEach.
let tabs: Array<{
  id: string
  folderId: number
  conversationId: number | null
  isChat?: boolean
}> = []
let activeTabId: string | null = null

vi.mock("@/contexts/tab-context", () => ({
  useTabStore: (
    selector: (s: {
      tabs: typeof tabs
      activeTabId: typeof activeTabId
    }) => unknown
  ) => selector({ tabs, activeTabId }),
  useTabActions: () => ({
    openNewConversationTab,
    openChatModeTab: vi.fn(),
  }),
}))

function mkFolder(p: Partial<FolderDetail> & { id: number }): FolderDetail {
  return {
    name: `folder-${p.id}`,
    path: `/repo/folder-${p.id}`,
    git_branch: null,
    default_agent_type: null,
    last_opened_at: "2026-01-01T00:00:00Z",
    sort_order: p.id,
    color: "blue",
    parent_id: null,
    kind: "regular",
    alias: null,
    group_id: null,
    ...p,
  }
}

const repo = mkFolder({
  id: 1,
  name: "repo",
  path: "/repo",
  git_branch: "main",
})

beforeEach(() => {
  openNewConversationTab.mockClear()
  resetAppWorkspaceStore()
  useAppWorkspaceStore.setState({
    folders: [repo],
    allFolders: [repo],
    branches: new Map([[1, "main"]]),
  })
})

afterEach(() => cleanup())

vi.mock("@/hooks/use-shortcut-settings", () => ({
  useShortcutSettings: vi.fn(),
}))
vi.mock("@/hooks/use-is-mac", () => ({ useIsMac: vi.fn() }))

describe("welcome folder contract", () => {
  it("shows its own folder and switches an unsent draft from the greeting", async () => {
    const other = mkFolder({ id: 2, name: "other-repo", path: "/repo/other" })
    useAppWorkspaceStore.setState({
      folders: [repo, other],
      allFolders: [repo, other],
    })
    tabs = [
      { id: "draft", folderId: 1, conversationId: null },
      { id: "active", folderId: 2, conversationId: 42 },
    ]
    activeTabId = "active"
    const user = userEvent.setup()
    render(<WelcomeHero tabId="draft" />)
    await user.click(screen.getByRole("button", { name: "repo" }))
    await user.click(screen.getByText("other-repo"))
    expect(openNewConversationTab).toHaveBeenCalledWith(2, "/repo/other", {
      inheritFromActive: true,
    })
  })

  it.each([false, true])(
    "hides the folder in chat mode (bound: %s)",
    (bound) => {
      const chat = mkFolder({ id: 3, name: "hidden-chat", kind: "chat" })
      useAppWorkspaceStore.setState({ allFolders: [repo, chat] })
      tabs = [
        {
          id: "chat",
          folderId: bound ? 3 : 0,
          conversationId: bound ? 42 : null,
          isChat: !bound,
        },
      ]
      activeTabId = "chat"
      render(<WelcomeHero tabId="chat" />)
      expect(screen.getByRole("heading").textContent).toBe("greeting")
      expect(screen.queryByRole("button")).toBeNull()
    }
  )
})
