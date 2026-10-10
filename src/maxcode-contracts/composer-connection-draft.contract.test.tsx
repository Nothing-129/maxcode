import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const uploadAttachment = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  uploadAttachment,
}))
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
  ConversationContextBar: ({ extraContent }: { extraContent?: ReactNode }) => (
    <div>{extraContent}</div>
  ),
  ConversationFolderBranchPicker: () => null,
  useConversationFolderBranchPickerVisible: () => false,
}))
vi.mock("@/hooks/use-appearance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-appearance")>()),
  useZoomLevel: () => ({ zoomLevel: 100, setZoomLevel: () => {} }),
}))

import { ChatInput } from "@/components/chat/chat-input"
import enMessages from "@/i18n/messages/en.json"
import type { ConnectionStatus } from "@/lib/types"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  uploadAttachment.mockReset()
})

describe("MaxCode contract: connection readiness only gates sending", () => {
  it.each([
    ["connecting", false],
    ["connected", true],
  ] as const)(
    "keeps text and image drafts editable during %s (selectors loading: %s)",
    async (status, selectorsLoading) => {
      userEvent.setup()
      // jsdom lacks ClipboardEvent, which ProseMirror creates for pasteText.
      vi.stubGlobal(
        "ClipboardEvent",
        class extends Event {
          clipboardData = null
        }
      )
      const onSend = vi.fn()
      uploadAttachment.mockResolvedValue({ path: "/uploads/screen.png" })
      const composer = (state: ConnectionStatus, loading: boolean) => (
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <ChatInput
            status={state}
            selectorsLoading={loading}
            promptCapabilities={{
              image: state === "connected" && !loading,
              audio: false,
              embedded_context: false,
            }}
            onSend={onSend}
            onCancel={() => {}}
            attachmentTabId="connection-draft-contract"
          />
        </NextIntlClientProvider>
      )
      const { rerender } = render(composer(status, selectorsLoading))
      const editor = await screen.findByRole("textbox")
      expect(editor).toHaveAttribute("contenteditable", "true")
      const copy = enMessages.Folder.chat.messageInput
      expect(
        screen.getByRole("button", { name: copy.addActions })
      ).toBeEnabled()

      // Paste text through the real editor, then a screenshot before the agent
      // has advertised any image capabilities.
      fireEvent.paste(editor, {
        clipboardData: {
          files: [],
          types: ["text/plain"],
          getData: (type: string) => (type === "text/plain" ? "draft" : ""),
        },
      })
      await waitFor(() => expect(editor.textContent).toBe("draft"))
      await navigator.clipboard.writeText(" paste")
      fireEvent.keyDown(editor, {
        key: "v",
        code: "KeyV",
        ctrlKey: true,
        shiftKey: true,
      })
      await waitFor(() => expect(editor.textContent).toBe("draft paste"))
      const image = new File(["image bytes"], "screen.png", {
        type: "image/png",
      })
      fireEvent.paste(editor, {
        clipboardData: { files: [image], getData: () => "" },
      })
      await waitFor(() =>
        expect(uploadAttachment).toHaveBeenCalledWith(
          image,
          "connection-draft-contract"
        )
      )
      await waitFor(() =>
        expect(screen.getByAltText("screen.png")).toBeTruthy()
      )
      const send = screen.getByTitle(copy.send)
      expect(send).toBeDisabled()
      fireEvent.click(send)
      fireEvent.keyDown(editor, { key: "Enter", code: "Enter" })
      expect(onSend).not.toHaveBeenCalled()
      expect(editor.textContent).toBe("draft paste")

      // The same draft becomes sendable when initialization finishes.
      rerender(composer("connected", false))
      await waitFor(() => expect(screen.getByTitle(copy.send)).toBeEnabled())
      fireEvent.click(screen.getByTitle(copy.send))
      expect(onSend).toHaveBeenCalledOnce()
      expect(onSend.mock.calls[0][0].blocks).toEqual(
        expect.arrayContaining([
          { type: "text", text: "draft paste" },
          expect.objectContaining({
            type: "image",
            uri: "file:///uploads/screen.png",
          }),
        ])
      )
    }
  )
})
