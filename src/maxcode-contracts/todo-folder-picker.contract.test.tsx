import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TodoConversationFolderDialog } from "@/components/todos/todo-conversation-folder-dialog"
import messages from "@/i18n/messages/en.json"
import type { FolderDetail, FolderGroupDetail } from "@/lib/types"

const workspace = vi.hoisted(() => ({
  folders: [] as FolderDetail[],
  allFolders: [] as FolderDetail[],
  folderGroups: [] as FolderGroupDetail[],
}))

vi.mock("@/stores/app-workspace-store", () => ({
  useAppWorkspaceStore: (select: (state: unknown) => unknown) =>
    select(workspace),
}))
vi.mock("@/components/layout/workspace-folder-dialog", () => ({
  WorkspaceFolderDialog: ({
    onFolderOpened,
  }: {
    onFolderOpened: (folder: { id: number }) => void
  }) => (
    <button onClick={() => onFolderOpened({ id: 2 })}>Browse result</button>
  ),
}))

function setup(busy = false) {
  const onConfirm = vi.fn()
  const onClose = vi.fn()
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TodoConversationFolderDialog
        onClose={onClose}
        onConfirm={onConfirm}
        busy={busy}
      />
    </NextIntlClientProvider>
  )
  return { user: userEvent.setup(), onConfirm, onClose }
}

function folder(id: number, name: string, sortOrder: number): FolderDetail {
  return {
    id,
    name,
    path: `/work/${name}`,
    alias: null,
    sort_order: sortOrder,
    parent_id: null,
    group_id: null,
    kind: "regular",
    git_branch: null,
    default_agent_type: null,
    last_opened_at: "2026-11-03T00:00:00Z",
    color: "default",
  }
}

beforeEach(() => {
  const property = { ...folder(1, "property-sys", 1), alias: "物业系统" }
  const maxcode = folder(2, "maxcode", 2)
  const chat = { ...folder(3, "Hidden chat", 0), kind: "chat" as const }
  const worktree = { ...folder(4, "automation/3/run-11", 0), parent_id: 1 }
  const closed = folder(5, "Closed project", 0)
  const internal = folder(6, "Delegated checkout", 0)
  // Raw store order need not change after a drag; sort_order is authoritative.
  workspace.folders = [worktree, maxcode, chat, property]
  workspace.allFolders = [internal, closed, ...workspace.folders]
  workspace.folderGroups = []
})

describe("todo conversation folder picker", () => {
  it("lists only open root projects in the user's sidebar order", async () => {
    const { user } = setup()
    await user.click(
      screen.getByRole("button", {
        name: messages.Todos.chooseConversationFolder,
      })
    )
    expect(screen.getAllByRole("option").map((row) => row.textContent)).toEqual(
      [expect.stringContaining("物业系统"), expect.stringContaining("maxcode")]
    )
    for (const name of [
      "Hidden chat",
      "automation/3/run-11",
      "Closed project",
      "Delegated checkout",
    ]) {
      expect(screen.queryByText(name)).not.toBeInTheDocument()
    }
  })

  it("follows the sidebar's group position and member order", async () => {
    workspace.folderGroups = [
      { id: 10, name: "Projects", sort_order: 3, color: "default" },
    ]
    workspace.folders = workspace.folders.map((f) =>
      f.id === 1 ? { ...f, group_id: 10, sort_order: 1 } : f
    )
    workspace.folders.push({
      ...folder(7, "Another project", 0),
      group_id: 10,
    })
    const { user } = setup()
    await user.click(
      screen.getByRole("button", {
        name: messages.Todos.chooseConversationFolder,
      })
    )
    expect(screen.getAllByRole("option").map((row) => row.textContent)).toEqual(
      [
        expect.stringContaining("maxcode"),
        expect.stringContaining("Another project"),
        expect.stringContaining("物业系统"),
      ]
    )
  })

  it("searches by directory name, displays remarks and paths, and confirms only the chosen id", async () => {
    const { user, onConfirm } = setup()
    const confirm = screen.getByRole("button", {
      name: messages.Todos.confirmConversationFolder,
    })
    expect(confirm).toBeDisabled()
    const picker = screen.getByRole("button", {
      name: messages.Todos.chooseConversationFolder,
    })
    expect(picker).toHaveClass("w-full", "max-w-none")
    await user.click(picker)
    expect(screen.getByText("物业系统")).toBeVisible()
    expect(screen.getByText("/work/property-sys")).toHaveClass("truncate")
    expect(screen.queryByText("Hidden chat")).not.toBeInTheDocument()
    await user.type(
      screen.getByPlaceholderText(
        messages.Folder.conversationContextBar.searchFolder
      ),
      "property-sys"
    )
    expect(screen.queryByText("maxcode")).not.toBeInTheDocument()
    await user.click(screen.getByText("物业系统"))
    expect(picker).toHaveTextContent("物业系统")
    expect(screen.getByRole("dialog")).toBeVisible()
    await user.click(confirm)
    expect(onConfirm).toHaveBeenCalledWith(1)
  })

  it("supports browsing for a folder before confirming", async () => {
    const { user, onConfirm } = setup()
    await user.click(
      screen.getByRole("button", { name: messages.Folder.sidebar.openFolder })
    )
    await user.click(screen.getByRole("button", { name: "Browse result" }))
    expect(screen.getByRole("button", { name: "maxcode" })).toBeVisible()
    await user.click(
      screen.getByRole("button", {
        name: messages.Todos.confirmConversationFolder,
      })
    )
    expect(onConfirm).toHaveBeenCalledWith(2)
  })

  it("cancels without confirming", async () => {
    const { user, onClose, onConfirm } = setup()
    await user.click(
      screen.getByRole("button", { name: messages.Todos.cancel })
    )
    expect(onClose).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it("disables the folder picker and actions while busy", () => {
    setup(true)
    expect(
      screen.getByRole("button", {
        name: messages.Todos.chooseConversationFolder,
      })
    ).toBeDisabled()
    expect(
      screen.getByRole("button", { name: messages.Folder.sidebar.openFolder })
    ).toBeDisabled()
    expect(
      screen.getByRole("button", {
        name: messages.Todos.confirmConversationFolder,
      })
    ).toBeDisabled()
  })
})
