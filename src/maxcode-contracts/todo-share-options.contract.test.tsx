import { useState } from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { expect, it, vi } from "vitest"
import messages from "@/i18n/messages/zh-CN.json"
import { ConversationShareOptionsEditor } from "@/components/conversations/conversation-share-options"
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
  await user.selectOptions(screen.getByRole("combobox"), "selected")
  await user.click(screen.getByRole("checkbox", { name: /第 1 轮/ }))
  expect(screen.getByText(preview)).toBeInTheDocument()
  expect(screen.getByRole("checkbox", { name: /第 2 轮/ })).toBeChecked()
  expect(confirm).not.toHaveBeenCalled()
  await user.click(screen.getByRole("button", { name: "确认添加" }))
  expect(confirm).toHaveBeenCalledWith({ rounds: [2] })
})
