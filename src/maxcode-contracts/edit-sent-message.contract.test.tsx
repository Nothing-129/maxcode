import { readFileSync } from "node:fs"
import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import enMessages from "@/i18n/messages/en.json"
import { SentMessageEditButton } from "@/components/message/sent-message-edit-button"

function localized(children: ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {children}
    </NextIntlClientProvider>
  )
}

describe("MaxCode: edit sent messages", () => {
  it("opens the original readable text, with no action on read-only surfaces", () => {
    const onEdit = vi.fn()
    const parts = [{ type: "text" as const, text: "Fix C:\\\\tmp &amp; logs" }]
    const view = render(localized(<SentMessageEditButton parts={parts} />))
    expect(screen.queryByRole("button")).toBeNull()
    view.rerender(
      localized(<SentMessageEditButton parts={parts} onEdit={onEdit} />)
    )
    fireEvent.click(screen.getByRole("button", { name: "Edit message" }))
    expect(onEdit).toHaveBeenCalledWith("Fix C:\\tmp & logs")
    view.rerender(
      localized(<SentMessageEditButton parts={[]} onEdit={onEdit} />)
    )
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("immediately stops and fills the normal composer without a dialog or automatic send", () => {
    const source = readFileSync(
      "src/components/conversations/conversation-detail-panel.tsx",
      "utf8"
    )
    const handler = source.slice(
      source.indexOf("const handleEditSentMessage"),
      source.indexOf("const messageListNode")
    )
    expect(handler).toContain("if (!canEditSentMessage || !text.trim()) return")
    expect(handler).toContain("mqCancelEditing()")
    expect(handler).toContain('setComposerInject({ text, mode: "replace" })')
    expect(handler).toContain('if (connStatus === "prompting")')
    expect(handler).toContain("acpActions.cancel(tabId)")
    expect(handler).not.toMatch(
      /mqRequeueFront|mqEnqueue|handleSend|lifecycleSend/
    )
    expect(source).not.toContain("SentMessageEditor")
    expect(source).toContain(
      "onEditMessage={canEditSentMessage ? handleEditSentMessage : undefined}"
    )
    expect(
      source.slice(
        source.indexOf("const canEditSentMessage"),
        source.indexOf("const tSentEdit")
      )
    ).toContain("!conn.isViewer")
    const list = readFileSync(
      "src/components/message/message-list-view.tsx",
      "utf8"
    )
    expect(list).toMatch(
      /<UserMessageCopyButton[^>]+\/>\s*<SentMessageEditButton/
    )
    expect(list).toContain("onEditMessage={onEditMessage}")
    const composer = readFileSync(
      "src/components/chat/message-input.tsx",
      "utf8"
    )
    const replace = composer.slice(
      composer.indexOf("handle.setText(payload.text)"),
      composer.indexOf(
        "setComposerEmpty(false)",
        composer.indexOf("handle.setText(payload.text)")
      )
    )
    expect(replace).toContain("handle.focus()")
  })
})
