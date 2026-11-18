import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { FolderPicker } from "@/components/chat/conversation-context-bar"

import { NextIntlClientProvider } from "next-intl"
import messages from "@/i18n/messages/en.json"
import { FolderSelect } from "@/components/shared/folder-select"

const folders = [
  { id: 1, name: "repo", alias: "同名项目", path: "/one/repo" },
  { id: 2, name: "repo", alias: "同名项目", path: "/two/repo" },
  { id: 3, name: "maxcode", path: "/work/maxcode" },
]
function setup() {
  const onSelect = vi.fn()
  const onSelectChatMode = vi.fn()
  render(
    <FolderPicker
      folders={folders}
      currentFolderId={3}
      currentFolderName="maxcode"
      title="工作文件夹"
      editable
      onSelect={onSelect}
      labelEmpty="没有匹配的文件夹"
      labelSearch="搜索文件夹..."
      labelChatMode="聊天模式"
      labelChatModeDescription="不关联任何工作区"
      isChatMode={false}
      onSelectChatMode={onSelectChatMode}
    />
  )
  return { user: userEvent.setup(), onSelect, onSelectChatMode }
}
describe("folder selector structure", () => {
  it("pins chat mode outside the folder scroller and distinguishes duplicate names by path", async () => {
    const { user } = setup()
    await user.click(screen.getByRole("button"))
    expect(
      screen.getByTitle("不关联任何工作区").closest("[data-folder-scroll]")
    ).toBeNull()
    expect(screen.getByText("/one/repo")).toBeVisible()
    expect(screen.getByText("/two/repo")).toBeVisible()
    expect(screen.getByPlaceholderText("搜索文件夹...")).toHaveFocus()
  })
  it("shows an explicit empty state without switching folders and keeps chat mode reachable", async () => {
    const { user, onSelect, onSelectChatMode } = setup()
    await user.click(screen.getByRole("button"))
    await user.type(screen.getByPlaceholderText("搜索文件夹..."), "zzzzz")
    expect(screen.getByRole("status")).toHaveTextContent("没有匹配的文件夹")
    expect(onSelect).not.toHaveBeenCalled()
    await user.click(screen.getByText("聊天模式"))
    expect(onSelectChatMode).toHaveBeenCalledOnce()
  })
  it("searches paths and commits only after Enter", async () => {
    const { user, onSelect } = setup()
    await user.click(screen.getByRole("button"))
    await user.type(screen.getByPlaceholderText("搜索文件夹..."), "/two/repo")
    expect(onSelect).not.toHaveBeenCalled()
    await user.keyboard("{ArrowDown}{ArrowUp}{Enter}")
    expect(onSelect).toHaveBeenCalledWith(2)
  })
})

it("uses the compact menu in shared folder fields and filters", async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FolderSelect
        folders={folders}
        value={3}
        onChange={onChange}
        allLabel="All folders"
        onSelectAll={vi.fn()}
      />
    </NextIntlClientProvider>
  )
  await user.click(screen.getByRole("button"))
  expect(screen.getByRole("combobox")).toHaveFocus()
  expect(screen.queryByText("/work/maxcode")).toBeNull()
  expect(screen.getByText("/one/repo")).toBeVisible()
  const options = screen.getAllByRole("option")
  expect(options[options.length - 1]).toHaveTextContent("All folders")
  await user.type(screen.getByRole("combobox"), "/two/repo")
  expect(onChange).not.toHaveBeenCalled()
  await user.keyboard("{Enter}")
  expect(onChange).toHaveBeenCalledWith(2)
  await user.click(screen.getByRole("button"))
  expect(screen.getByRole("combobox")).toHaveValue("")
})
