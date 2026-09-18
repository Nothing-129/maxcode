import { act, fireEvent, render, waitFor } from "@testing-library/react"
import type { ComponentProps } from "react"
import type { Editor } from "@tiptap/core"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { RichComposerHandle } from "@/components/chat/composer/rich-composer"
import { MessageInput } from "@/components/chat/message-input"
import enMessages from "@/i18n/messages/en.json"
import {
  clearMessageInputDraftV2,
  loadMessageInputDraftV2,
} from "@/lib/message-input-draft"
import type { PromptInputBlock } from "@/lib/types"

// Keep the editor and attachment engine real: the contract protects their
// interaction with history, including the downstream byte-bearing file path.
const composer = vi.hoisted(() => ({
  current: null as RichComposerHandle | null,
}))
vi.mock("@/components/chat/composer/rich-composer", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/chat/composer/rich-composer")
    >()
  const React = await import("react")
  const Captured = React.forwardRef<
    RichComposerHandle,
    ComponentProps<typeof actual.RichComposer>
  >((props, ref) =>
    React.createElement(actual.RichComposer, {
      ...props,
      ref: (handle: RichComposerHandle | null) => {
        composer.current = handle
        if (typeof ref === "function") ref(handle)
        else if (ref) ref.current = handle
      },
    })
  )
  Captured.displayName = "ContractComposer"
  return { ...actual, RichComposer: Captured }
})
vi.mock("@/hooks/use-shortcut-settings", () => ({
  useShortcutSettings: () => ({
    shortcuts: { send_message: "enter", newline_in_message: "shift+enter" },
  }),
}))
vi.mock("@/hooks/use-agent-skills", () => ({ useAgentSkills: () => [] }))
vi.mock("@/hooks/use-built-in-experts", () => ({ useBuiltInExperts: () => [] }))
vi.mock("@/hooks/use-built-in-science", () => ({ useBuiltInScience: () => [] }))
vi.mock("@/hooks/use-enabled-skill-ids", () => ({
  useEnabledSkillIds: () => ({
    enabledIds: new Set(),
    ready: false,
    supported: true,
  }),
}))
vi.mock("@/components/chat/composer/use-reference-search", () => ({
  useReferenceSearch: () => async () => [],
}))
vi.mock("@/components/chat/conversation-context-bar", () => ({
  ConversationContextBar: () => null,
  ConversationFolderBranchPicker: () => null,
  useConversationFolderBranchPickerVisible: () => false,
}))
vi.mock("@/lib/platform", () => ({
  isDesktop: () => false,
  openFileDialog: vi.fn(),
}))
vi.mock("@/lib/transport", () => ({
  getActiveRemoteConnectionId: () => null,
}))

const draftKey = "maxcode-contract:composer-history"
const attachmentBlocks: PromptInputBlock[] = [
  { type: "text", text: "Unsent draft" },
  { type: "resource_link", name: "spec.md", uri: "file:///workspace/spec.md" },
  {
    type: "resource",
    uri: "file:///clipboard/brief.pdf",
    mime_type: "application/pdf",
    blob: "cGRmLWJ5dGVz",
  },
  { type: "image", mime_type: "image/png", data: "aW1hZ2UtYnl0ZXM=" },
]

async function mount(props: Partial<ComponentProps<typeof MessageInput>> = {}) {
  const onSend = vi.fn()
  const view = render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <MessageInput
        onSend={onSend}
        promptCapabilities={{
          image: true,
          audio: false,
          embedded_context: true,
        }}
        getSentHistory={() => ["Earlier sent prompt", "Latest sent prompt"]}
        {...props}
      />
    </NextIntlClientProvider>
  )
  await waitFor(() => expect(composer.current?.getEditor()).toBeTruthy())
  return { ...view, onSend, handle: composer.current! }
}

function press(editor: Editor, key: string) {
  act(() => {
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
    )
  })
}

afterEach(() => {
  clearMessageInputDraftV2(draftKey)
  composer.current = null
})

describe("MaxCode: sent prompt history preserves the local composer", () => {
  it("restores reference badges and attachment bytes without sending during recall", async () => {
    const { handle, onSend, container } = await mount({
      draftStorageKey: draftKey,
      injectContent: { text: "Unsent draft", blocks: attachmentBlocks },
    })
    await waitFor(() => expect(handle.getText()).toContain("Unsent draft"))
    const editor = handle.getEditor()!
    const draftDoc = handle.getJSON()

    act(() => editor.commands.focus("start"))
    press(editor, "ArrowUp")
    expect(handle.getText()).toBe("Latest sent prompt")
    expect(onSend).not.toHaveBeenCalled()
    // The pending 300ms persistence timer must land before history writes.
    expect(JSON.stringify(loadMessageInputDraftV2(draftKey))).toContain(
      "Unsent draft"
    )
    expect(JSON.stringify(loadMessageInputDraftV2(draftKey))).toContain(
      "file:///workspace/spec.md"
    )

    act(() => editor.commands.focus("end"))
    press(editor, "ArrowDown")
    expect(handle.getJSON()).toEqual(draftDoc)
    fireEvent.click(
      container.querySelector<HTMLButtonElement>(
        `button[title="${enMessages.Folder.chat.messageInput.send}"]`
      )!
    )
    expect(onSend).toHaveBeenCalledOnce()
    const [sent] = onSend.mock.calls[0]
    expect(sent.blocks).toEqual(
      expect.arrayContaining(
        attachmentBlocks.slice(2).map((block) => expect.objectContaining(block))
      )
    )
    expect(JSON.stringify(sent)).toContain("file:///workspace/spec.md")
    expect(JSON.stringify(sent)).toContain("Unsent draft")
    expect(JSON.stringify(sent)).not.toContain("Latest sent prompt")
  })

  it("keeps a queued edit and all its attachments under the existing Save action", async () => {
    const onSaveQueueEdit = vi.fn()
    const { handle, onSend } = await mount({
      isEditingQueueItem: true,
      editingItemId: "queued-with-files",
      editingDraftBlocks: attachmentBlocks,
      onSaveQueueEdit,
    })
    await waitFor(() => expect(handle.getText()).toContain("Unsent draft"))
    const editor = handle.getEditor()!
    const draftDoc = handle.getJSON()
    act(() => editor.commands.focus("start"))
    press(editor, "ArrowUp")
    expect(handle.getJSON()).toEqual(draftDoc)
    press(editor, "Enter")
    expect(onSend).not.toHaveBeenCalled()
    expect(onSaveQueueEdit).toHaveBeenCalledOnce()
    expect(onSaveQueueEdit.mock.calls[0][0].blocks).toEqual(
      expect.arrayContaining(
        attachmentBlocks.slice(2).map((block) => expect.objectContaining(block))
      )
    )
  })

  it("leaves paragraph navigation inside a pasted multi-paragraph draft intact", async () => {
    const { handle, onSend } = await mount()
    const editor = handle.getEditor()!
    act(() => {
      editor.commands.setContent({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "one" }] },
          { type: "paragraph", content: [{ type: "text", text: "two" }] },
        ],
      })
      editor.commands.setTextSelection(6)
    })
    const draftDoc = handle.getJSON()
    press(editor, "ArrowUp")
    expect(handle.getJSON()).toEqual(draftDoc)
    act(() => editor.commands.setTextSelection(4))
    press(editor, "ArrowDown")
    expect(handle.getJSON()).toEqual(draftDoc)
    expect(onSend).not.toHaveBeenCalled()
  })
})
