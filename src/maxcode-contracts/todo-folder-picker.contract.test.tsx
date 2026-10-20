import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import { TodoConversationFolderDialog } from "@/components/todos/todo-conversation-folder-dialog"
import messages from "@/i18n/messages/en.json"

vi.mock("@/stores/app-workspace-store", () => ({
  useAppWorkspaceStore: (select: (state: unknown) => unknown) =>
    select({
      allFolders: [
        {
          id: 1,
          name: "property-sys",
          alias: "物业系统",
          path: "/work/property-sys",
        },
        { id: 2, name: "maxcode", path: "/work/maxcode" },
        { id: 3, name: "Hidden chat", kind: "chat" },
      ],
    }),
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

describe("todo conversation folder picker", () => {
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
