import { readFileSync } from "node:fs"
import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import { ChatInput } from "@/components/chat/chat-input"
import type { QueuedMessage } from "@/hooks/use-message-queue"
import enMessages from "@/i18n/messages/en.json"

vi.mock("@/components/chat/message-input", () => ({
  MessageInput: () => <textarea aria-label="Composer" />,
}))

const queue: QueuedMessage[] = ["First message", "Second message"].map(
  (text, index) => ({
    id: String(index),
    modeId: null,
    draft: { displayText: text, blocks: [{ type: "text", text }] },
  })
)

function setup(editingItemId: string | null = null, prompting = true) {
  const onCancel = vi.fn()
  const onQueueReorder = vi.fn()
  const onQueueEdit = vi.fn()
  const onQueueDelete = vi.fn()
  const view = render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ChatInput
        status={prompting ? "prompting" : "connected"}
        promptCapabilities={{
          image: false,
          audio: false,
          embedded_context: false,
        }}
        onSend={vi.fn()}
        onCancel={onCancel}
        queue={queue}
        onQueueReorder={onQueueReorder}
        onQueueEdit={onQueueEdit}
        onQueueDelete={onQueueDelete}
        editingItemId={editingItemId}
      />
    </NextIntlClientProvider>
  )
  return { ...view, onCancel, onQueueReorder, onQueueEdit, onQueueDelete }
}

describe("MaxCode: queued messages above the composer", () => {
  it("shows the message before the composer and exposes edit then delete", () => {
    const { onQueueEdit, onQueueDelete, onCancel } = setup()
    const edit = screen.getAllByRole("button", { name: "Edit" })[0]
    const remove = screen.getAllByRole("button", { name: "Remove" })[0]
    expect(
      edit.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      screen
        .getByText("First message")
        .compareDocumentPosition(screen.getByRole("textbox")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    fireEvent.click(edit)
    expect(onQueueEdit).toHaveBeenCalledWith("0")
    fireEvent.click(remove)
    expect(onQueueDelete).toHaveBeenCalledWith("0")
    expect(onCancel).not.toHaveBeenCalled()
  })

  it("promotes the chosen message before stopping so the normal flush sends it next", () => {
    const { onCancel, onQueueReorder } = setup()
    fireEvent.click(
      screen.getAllByRole("button", { name: "Adjust direction" })[1]
    )
    expect(onQueueReorder).toHaveBeenCalledWith([queue[1], queue[0]])
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onQueueReorder.mock.invocationCallOrder[0]).toBeLessThan(
      onCancel.mock.invocationCallOrder[0]
    )
  })

  it("does not offer interruption while editing or when already idle", () => {
    const view = setup("0")
    expect(
      screen.queryByRole("button", { name: "Adjust direction" })
    ).toBeNull()
    expect(
      screen
        .getAllByRole("button", { name: "Edit" })[0]
        .getAttribute("aria-pressed")
    ).toBe("true")
    view.unmount()
    setup(null, false)
    expect(
      screen.queryByRole("button", { name: "Adjust direction" })
    ).toBeNull()
  })

  it("holds automatic delivery during editing and restores the full draft with focus", () => {
    const panel = readFileSync(
      "src/components/conversations/conversation-detail-panel.tsx",
      "utf8"
    )
    expect(panel).toContain(
      "if (msgQueue.length === 0 || mqEditingItemId) return"
    )
    expect(panel).toContain(
      "[connectionReady, runtimeSyncState, msgQueue.length, mqEditingItemId]"
    )
    const composer = readFileSync(
      "src/components/chat/message-input.tsx",
      "utf8"
    )
    const hydration = composer.slice(
      composer.indexOf("// Re-hydrate when"),
      composer.indexOf("if (!injectContent")
    )
    expect(hydration).toContain("hydrateFromBlocks(editor, editingDraftBlocks)")
    expect(hydration).toContain("editorRef.current?.focus()")
  })
})
