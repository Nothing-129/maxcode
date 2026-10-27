import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import { ComposerAddMenu } from "@/components/chat/composer/composer-add-menu"
import type { ComposerShortcuts } from "@/components/chat/composer/use-composer-shortcuts"
import messages from "@/i18n/messages/en.json"

const labels = messages.Folder.chat.messageInput

describe("composer essential actions", () => {
  it("skips the add button when tabbing from the editor but still opens on click", async () => {
    const user = userEvent.setup()
    const refreshQuickMessages = vi.fn()
    const shortcuts = {
      quickMessages: [],
      quickMessagesLoading: false,
      refreshQuickMessages,
    } as unknown as ComposerShortcuts
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <textarea aria-label="Message" />
        <ComposerAddMenu shortcuts={shortcuts} slashCommands={[]} />
        <button type="button">Next action</button>
      </NextIntlClientProvider>
    )

    screen.getByRole("textbox", { name: "Message" }).focus()
    await user.tab()
    expect(screen.getByRole("button", { name: "Next action" })).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveFocus()

    await user.click(screen.getByRole("button", { name: labels.addActions }))
    expect(await screen.findByRole("menu")).toBeVisible()
    expect(refreshQuickMessages).toHaveBeenCalledOnce()

    // Closing a menu can restore focus to its trigger, even with tabIndex=-1.
    // Keep that restored focus from drawing a ring on the pointer-only action.
    await user.keyboard("{Escape}")
    const addButton = screen.getByRole("button", { name: labels.addActions })
    addButton.focus()
    expect(addButton).toHaveFocus()
    expect(addButton).toHaveClass("focus-visible:ring-0")
    expect(addButton).not.toHaveClass("focus-visible:ring-1")
    await user.click(screen.getByRole("button", { name: "Next action" }))
    expect(screen.getByRole("button", { name: "Next action" })).toHaveFocus()
  })

  it.each([true, false])(
    "keeps only attachment, quick message and slash entries (attachments: %s)",
    (withAttachments) => {
      const refreshQuickMessages = vi.fn()
      const upload = vi.fn().mockResolvedValue(undefined)
      const shortcuts = {
        quickMessages: [],
        quickMessagesLoading: false,
        refreshQuickMessages,
        skillManagementSupported: true,
        experts: [{ metadata: { id: "expert" } }],
        science: [{ metadata: { id: "science" } }],
      } as unknown as ComposerShortcuts
      render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <ComposerAddMenu
            attachments={
              withAttachments
                ? {
                    handleUploadLocalFiles: upload,
                    setServerFilePickerOpen: vi.fn(),
                  }
                : null
            }
            shortcuts={shortcuts}
            slashCommands={[{ name: "help", description: "Help" }]}
          />
        </NextIntlClientProvider>
      )
      fireEvent.keyDown(
        screen.getByRole("button", { name: labels.addActions }),
        { key: "Enter" }
      )
      expect(refreshQuickMessages).toHaveBeenCalledOnce()
      expect(
        screen.getAllByRole("menuitem").map((item) => item.textContent)
      ).toEqual(
        withAttachments
          ? [
              labels.attachLocalUpload,
              labels.attachServerFile,
              labels.quickMessages,
              labels.slashCommands,
            ]
          : [labels.quickMessages, labels.slashCommands]
      )
      for (const label of [
        labels.liveFeedback,
        labels.experts,
        labels.office,
        labels.research,
      ]) {
        expect(screen.queryByText(label)).toBeNull()
      }
      if (withAttachments) {
        fireEvent.click(
          screen.getByRole("menuitem", { name: labels.attachLocalUpload })
        )
        expect(upload).toHaveBeenCalledOnce()
      }
    }
  )
})
