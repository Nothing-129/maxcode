import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { SearchCommandDialog } from "@/components/conversations/search-command-dialog"
import { listAllConversations } from "@/lib/api"
import enMessages from "@/i18n/messages/en.json"

// The active folder and its conversations, per test: the agent filter chips
// only render once the folder holds more than one agent type.
const workspace = vi.hoisted(() => ({
  resetFileTree: vi.fn(),
  activeFolderId: null as number | null,
  conversations: [] as { folder_id: number; agent_type: string }[],
}))

vi.mock("@/components/agent-icon", () => ({ AgentIcon: () => null }))

vi.mock("@/lib/api", () => ({
  listAllConversations: vi.fn(async () => []),
}))

vi.mock("@/contexts/tab-context", () => ({
  useTabActions: () => ({ openTab: vi.fn() }),
}))

vi.mock("@/contexts/workbench-route-context", () => ({
  useWorkbenchRoute: () => ({ openConversations: vi.fn() }),
}))

vi.mock("@/contexts/workspace-context", () => ({
  useWorkspaceActions: () => ({ openFilePreview: vi.fn() }),
}))

vi.mock("@/contexts/aux-panel-context", () => ({
  useAuxPanelContext: () => ({ revealInFileTree: vi.fn() }),
}))

vi.mock("@/contexts/active-folder-context", () => ({
  useActiveFolder: () => ({
    activeFolder: null,
    activeFolderId: workspace.activeFolderId,
  }),
}))

vi.mock("@/stores/app-workspace-store", () => ({
  useAppWorkspaceStore: (selector: (s: unknown) => unknown) =>
    selector({
      conversations: workspace.conversations,
      allFolders: [
        { id: 1, name: "backend", path: "/backend", kind: "project" },
        {
          id: 2,
          name: "frontend",
          alias: "Website",
          path: "/frontend",
          kind: "project",
        },
        { id: 3, name: "Hidden chat", path: "/chat", kind: "chat" },
      ],
    }),
}))

vi.mock("@/hooks/use-file-tree", () => ({
  useFileTree: () => ({
    allFiles: [],
    loading: false,
    reset: workspace.resetFileTree,
  }),
}))

function renderDialog() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SearchCommandDialog open onOpenChange={() => {}} />
    </NextIntlClientProvider>
  )
}

describe("conversation search scope contract", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workspace.activeFolderId = 1
    workspace.conversations = [
      { folder_id: 1, agent_type: "codex" },
      { folder_id: 2, agent_type: "grok" },
    ]
  })

  it("searches globally despite an active folder and supports explicit folders", async () => {
    const user = userEvent.setup()
    renderDialog()
    const scope = screen.getByRole("button", { name: "Search" })
    expect(scope).toHaveTextContent("All folders")
    expect(screen.getByRole("button", { name: "Grok" })).toBeVisible()
    await user.type(
      screen.getByPlaceholderText(enMessages.Folder.search.placeholder),
      "auth"
    )
    await waitFor(() =>
      expect(listAllConversations).toHaveBeenLastCalledWith({
        folder_ids: null,
        search: "auth",
        agent_type: null,
      })
    )
    await user.click(scope)
    await user.click(screen.getByText("Website"))
    await waitFor(() =>
      expect(listAllConversations).toHaveBeenLastCalledWith({
        folder_ids: [2],
        search: "auth",
        agent_type: null,
      })
    )
    await user.click(scope)
    await user.click(screen.getByText("All folders"))
    await waitFor(() =>
      expect(listAllConversations).toHaveBeenLastCalledWith({
        folder_ids: null,
        search: "auth",
        agent_type: null,
      })
    )
  })

  it("reserves space beside the folder selector for the dialog close button", () => {
    renderDialog()
    const scope = screen.getByRole("button", { name: "Search" })
    const close = screen.getByRole("button", { name: "Close" })

    expect(scope.parentElement).toHaveClass("min-w-0", "pr-16")
    expect(scope.parentElement).not.toContainElement(close)
    expect(close).toBeVisible()
  })

  it("shows and searches folder remarks in the app menu and supports keyboard selection", async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole("button", { name: "Search" }))
    expect(screen.getByText("Website")).toBeVisible()
    expect(screen.getByText("/frontend")).toBeVisible()
    expect(screen.queryByText("Hidden chat")).not.toBeInTheDocument()
    const search = screen.getByPlaceholderText(
      enMessages.Folder.conversationContextBar.searchFolder
    )
    await user.type(search, "Website")
    expect(screen.queryByText("backend")).not.toBeInTheDocument()
    await user.keyboard("{ArrowDown}{Enter}")
    expect(screen.getByRole("button", { name: "Search" })).toHaveTextContent(
      "Website"
    )
    expect(
      screen.queryByPlaceholderText(
        enMessages.Folder.conversationContextBar.searchFolder
      )
    ).not.toBeInTheDocument()
    expect(screen.getByRole("dialog")).toBeVisible()
  })

  it("restores all folders after closing and reopening", async () => {
    const user = userEvent.setup()
    const view = renderDialog()
    await user.click(screen.getByRole("button", { name: "Search" }))
    await user.click(screen.getByText("Website"))
    const dialog = (open: boolean) => (
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <SearchCommandDialog open={open} onOpenChange={() => {}} />
      </NextIntlClientProvider>
    )
    view.rerender(dialog(false))
    view.rerender(dialog(true))
    expect(screen.getByRole("button", { name: "Search" })).toHaveTextContent(
      "All folders"
    )
  })
})
