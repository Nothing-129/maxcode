import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { useEffect, useState, type ReactNode } from "react"
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
import type { ConnectionStatus, PromptDraft } from "@/lib/types"
import { useMessageQueue } from "@/hooks/use-message-queue"
import { isConnectionReady } from "@/lib/queue-flush"
import { prepareQueuedPrompt } from "@/lib/queued-prompt"
import { QueueConnectionStatus } from "@/components/chat/queue-connection-status"
import { source } from "./contract-source"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  uploadAttachment.mockReset()
})

const noCapabilities = { image: false, audio: false, embedded_context: false }
const imageCapabilities = { ...noCapabilities, image: true }

function QueuedComposer({
  status,
  selectorsReady,
  onSend,
  scope = "connection-queue",
}: {
  status: ConnectionStatus
  selectorsReady: boolean
  onSend: (draft: PromptDraft) => void
  scope?: string
}) {
  const queue = useMessageQueue()
  const [inject, setInject] = useState<{
    id: number
    text: string
    blocks: PromptDraft["blocks"]
  } | null>(null)
  const ready = isConnectionReady(
    status,
    "/work",
    "/work",
    "codex",
    "codex",
    selectorsReady
  )
  const capabilities = selectorsReady ? imageCapabilities : noCapabilities
  useEffect(() => {
    if (!ready) return
    const next = queue.peekSendable()
    if (!next) return
    queue.remove(next.id)
    onSend(prepareQueuedPrompt(next.draft, capabilities))
  }, [ready, queue, onSend, capabilities])
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ChatInput
        status={status}
        selectorsLoading={!selectorsReady}
        promptCapabilities={capabilities}
        onSend={onSend}
        onCancel={() => {}}
        attachmentTabId={scope}
        queue={queue.queue}
        onEnqueue={queue.enqueue}
        onQueueReorder={queue.reorder}
        onQueueEdit={(id) => {
          const item = queue.remove(id)
          if (item)
            setInject({
              id: Date.now(),
              text: item.draft.displayText,
              blocks: item.draft.blocks,
            })
        }}
        onQueueDelete={queue.remove}
        injectContent={inject}
        onInjectConsumed={() => setInject(null)}
      />
    </NextIntlClientProvider>
  )
}

function pasteText(editor: HTMLElement, text: string) {
  fireEvent.paste(editor, {
    clipboardData: {
      files: [],
      types: ["text/plain"],
      getData: (type: string) => (type === "text/plain" ? text : ""),
    },
  })
}

describe("MaxCode connection-time local submission", () => {
  it.each(["connecting", "connected"] as const)(
    "accepts Enter during %s, suppresses repeat Enter and waits for session readiness",
    async (status) => {
      userEvent.setup()
      const onSend = vi.fn()
      const { rerender } = render(
        <QueuedComposer
          status={status}
          selectorsReady={false}
          onSend={onSend}
        />
      )
      const editor = await screen.findByRole("textbox")
      pasteText(editor, "first")
      await waitFor(() => expect(editor.textContent).toBe("first"))
      fireEvent.keyDown(editor, { key: "Enter", code: "Enter" })
      fireEvent.keyDown(editor, { key: "Enter", code: "Enter" })
      fireEvent.keyDown(editor, { key: "Enter", code: "Enter" })
      await waitFor(() => expect(editor.textContent).toBe(""))
      expect(screen.getAllByText("first")).toHaveLength(1)
      expect(screen.getByRole("status")).toHaveTextContent(
        "Waiting for connection"
      )
      expect(onSend).not.toHaveBeenCalled()
      pasteText(editor, "second")
      await waitFor(() => expect(editor.textContent).toBe("second"))
      fireEvent.click(screen.getByTitle("Queue message"))
      expect(screen.getByText("second")).toBeTruthy()
      rerender(
        <QueuedComposer
          status="connected"
          selectorsReady={false}
          onSend={onSend}
        />
      )
      expect(onSend).not.toHaveBeenCalled()
      rerender(
        <QueuedComposer
          status="connected"
          selectorsReady={true}
          onSend={onSend}
        />
      )
      await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2))
      expect(onSend.mock.calls.map(([draft]) => draft.displayText)).toEqual([
        "first",
        "second",
      ])
      expect(screen.queryByRole("status")).toBeNull()
      rerender(
        <QueuedComposer
          status="connected"
          selectorsReady={true}
          onSend={onSend}
        />
      )
      expect(onSend).toHaveBeenCalledTimes(2)
    }
  )

  it("keeps failed-connection messages editable and removable", async () => {
    userEvent.setup()
    const onSend = vi.fn()
    const { rerender } = render(
      <QueuedComposer
        status="connecting"
        selectorsReady={false}
        onSend={onSend}
      />
    )
    const editor = await screen.findByRole("textbox")
    pasteText(editor, "revise me")
    fireEvent.keyDown(editor, { key: "Enter", code: "Enter" })
    rerender(
      <QueuedComposer status="error" selectorsReady={false} onSend={onSend} />
    )
    expect(screen.getByRole("status")).toHaveTextContent("Connection failed")
    expect(screen.getByText("revise me")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    await waitFor(() => expect(editor.textContent).toBe("revise me"))
    fireEvent.click(screen.getByTitle("Queue message"))
    fireEvent.click(screen.getByRole("button", { name: "Remove" }))
    expect(screen.queryByRole("status")).toBeNull()
    rerender(
      <QueuedComposer
        status="connected"
        selectorsReady={true}
        onSend={onSend}
      />
    )
    expect(onSend).not.toHaveBeenCalled()
  })

  it("queues an image-only draft once across same-tick clicks and negotiates its encoding later", async () => {
    userEvent.setup()
    uploadAttachment.mockResolvedValue({ path: "/uploads/queue.png" })
    const onSend = vi.fn()
    const { rerender } = render(
      <QueuedComposer
        status="connecting"
        selectorsReady={false}
        onSend={onSend}
      />
    )
    const editor = await screen.findByRole("textbox")
    fireEvent.paste(editor, {
      clipboardData: {
        files: [new File(["image"], "queue.png", { type: "image/png" })],
        getData: () => "",
      },
    })
    await screen.findByAltText("queue.png")
    await waitFor(() =>
      expect(screen.getByTitle("Queue message")).toBeEnabled()
    )
    const button = screen.getByTitle("Queue message")
    act(() => {
      button.click()
      button.click()
      fireEvent.keyDown(editor, { key: "Enter", code: "Enter" })
    })
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1)
    rerender(
      <QueuedComposer
        status="connected"
        selectorsReady={true}
        onSend={onSend}
      />
    )
    await waitFor(() => expect(onSend).toHaveBeenCalledOnce())
    expect(onSend.mock.calls[0][0].blocks).toEqual([
      expect.objectContaining({
        type: "image",
        uri: "file:///uploads/queue.png",
      }),
    ])
  })

  it("keeps pending messages scoped to the originating tab", async () => {
    userEvent.setup()
    const onSendA = vi.fn()
    const onSendB = vi.fn()
    const { rerender } = render(
      <>
        <QueuedComposer
          scope="tab-a"
          status="connecting"
          selectorsReady={false}
          onSend={onSendA}
        />
        <QueuedComposer
          scope="tab-b"
          status="connected"
          selectorsReady={true}
          onSend={onSendB}
        />
      </>
    )
    const editorA = (await screen.findAllByRole("textbox"))[0]
    pasteText(editorA, "only for A")
    fireEvent.keyDown(editorA, { key: "Enter", code: "Enter" })
    expect(onSendB).not.toHaveBeenCalled()
    rerender(
      <>
        <QueuedComposer
          scope="tab-a"
          status="connected"
          selectorsReady={true}
          onSend={onSendA}
        />
        <QueuedComposer
          scope="tab-b"
          status="connected"
          selectorsReady={true}
          onSend={onSendB}
        />
      </>
    )
    await waitFor(() => expect(onSendA).toHaveBeenCalledOnce())
    expect(onSendB).not.toHaveBeenCalled()
  })

  it("offers reconnect after a long wait without dropping the queue", async () => {
    vi.useFakeTimers()
    const onReconnect = vi.fn().mockResolvedValue(undefined)
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <QueueConnectionStatus
          waiting
          failed={false}
          onReconnect={onReconnect}
        />
      </NextIntlClientProvider>
    )
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull()
    act(() => vi.advanceTimersByTime(15_000))
    expect(screen.getByRole("status")).toHaveTextContent("have not been sent")
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reconnect" }))
    })
    expect(onReconnect).toHaveBeenCalledOnce()
  })

  it("preserves queued image bytes, references and display text for embedded-context agents", () => {
    const draft: PromptDraft = {
      displayText: "look at this",
      blocks: [
        { type: "text", text: "look at this" },
        {
          type: "image",
          data: "image-bytes",
          mime_type: "image/png",
          uri: "file:///uploads/example.png",
        },
        { type: "resource_link", name: "code.ts", uri: "file:///work/code.ts" },
      ],
    }
    const prepared = prepareQueuedPrompt(draft, {
      ...noCapabilities,
      embedded_context: true,
    })
    expect(prepared.displayText).toBe(draft.displayText)
    expect(prepared.blocks).toEqual([
      draft.blocks[0],
      {
        type: "resource",
        blob: "image-bytes",
        mime_type: "image/png",
        uri: "file:///uploads/example.png",
        text: null,
      },
      draft.blocks[2],
    ])
    expect(draft.blocks[1].type).toBe("image")
  })

  it("wires the production queue into both composers and gates flushing on initialization", () => {
    const panel = source(
      "src/components/conversations/conversation-detail-panel.tsx"
    )
    expect(
      panel.match(/onEnqueue=\{[\s\S]*?handleEnqueue[\s\S]*?\}/g)
    ).toHaveLength(2)
    expect(panel.match(/queue=\{msgQueue\}/g)).toHaveLength(2)
    expect(panel).toMatch(
      /isConnectionReady\([\s\S]*?conn\.selectorsReady\s*\)/
    )
    expect(panel).toContain(
      "draft = prepareQueuedPrompt(draft, conn.promptCapabilities)"
    )
    expect(panel).toContain("if (ownTab && !ownTab.isPinned) pinTab(tabId)")
    const lazy = panel.slice(panel.indexOf("const LazyConversationTabView"))
    expect(lazy).toContain("hasQueuedMessages: messageQueue.queue.length > 0")
    expect(
      isConnectionReady("connected", "/work", "/work", "codex", "codex", false)
    ).toBe(false)
    expect(
      isConnectionReady("connected", "/other", "/work", "codex", "codex", true)
    ).toBe(false)
    expect(
      isConnectionReady("connected", "/work", "/work", "grok", "codex", true)
    ).toBe(false)
  })
})
