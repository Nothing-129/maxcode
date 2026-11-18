import { useState } from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { expect, it, vi } from "vitest"
import { source } from "./contract-source"
import messages from "@/i18n/messages/zh-CN.json"
import { ConversationShareOptionsEditor } from "@/components/conversations/conversation-share-options"
import { TodoEditorDialog } from "@/components/todos/todo-editor-dialog"
import type { ConversationShareOptions } from "@/lib/types"

it("keeps long conversation previews selectable and confirms only the chosen share scope", async () => {
  const confirm = vi.fn()
  const preview = "润通1015.xlsx" + "VeryLongFilename".repeat(20)
  function Editor() {
    const [options, setOptions] = useState<ConversationShareOptions>({})
    return (
      <>
        <ConversationShareOptionsEditor
          rounds={[
            { number: 1, preview },
            { number: 2, preview: "看一下这个提示是什么意思" },
          ]}
          options={options}
          onChange={setOptions}
        />
        <button onClick={() => confirm(options)}>确认添加</button>
      </>
    )
  }
  const user = userEvent.setup()
  render(
    <NextIntlClientProvider locale="zh-CN" messages={messages}>
      <Editor />
    </NextIntlClientProvider>
  )
  await user.click(screen.getByRole("combobox"))
  await user.click(screen.getByRole("option", { name: "选择轮次" }))
  await user.click(screen.getByRole("checkbox", { name: /第 1 轮/ }))
  expect(screen.getByText(preview)).toBeInTheDocument()
  expect(screen.getByRole("checkbox", { name: /第 2 轮/ })).toBeChecked()
  expect(confirm).not.toHaveBeenCalled()
  await user.click(screen.getByRole("button", { name: "确认添加" }))
  expect(confirm).toHaveBeenCalledWith({ rounds: [2] })
})

it("saves the shared conversation without native Codex history by default", async () => {
  const submit = vi.fn().mockResolvedValue(undefined)
  render(
    <NextIntlClientProvider locale="zh-CN" messages={messages}>
      <TodoEditorDialog
        todo={null}
        draft={{
          text: "交付文件",
          conversationId: 7,
          canIncludeCodexSession: true,
        }}
        members={[]}
        onClose={vi.fn()}
        onSubmit={submit}
        disabled={false}
      />
    </NextIntlClientProvider>
  )
  expect(
    screen.getByRole("checkbox", { name: /允许导入完整 Codex 会话/ })
  ).not.toBeChecked()
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: messages.Todos.save }))
  expect(submit).toHaveBeenCalledOnce()
  expect(submit.mock.calls[0][0]).not.toHaveProperty("include_codex_session")
})

it("the conversation menu hands the full conversation directly to the todo draft", () => {
  const header = source(
    "src/components/conversations/conversation-detail-header.tsx"
  )
  const action = header
    .split("function handleTodoShareOpen()")[1]
    .split("function handleShareAndCreateTodo()")[0]
  expect(action).toContain(
    "openTodoDraft({ id: conversationId, title: displayTitle }, {})"
  )
  expect(action).not.toContain("handleShareOpen")
  expect(action).not.toContain("getConversationSharePreview")
})
