import { readFileSync } from "node:fs"
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import { ChatInput } from "@/components/chat/chat-input"
import { useMessageQueue, type QueuedMessage } from "@/hooks/use-message-queue"
import type { AgentType, PromptDraft } from "@/lib/types"
import enMessages from "@/i18n/messages/en.json"

vi.mock("@/components/chat/message-input", () => ({
  MessageInput: () => <textarea aria-label="Composer" />,
}))

const draft: PromptDraft = {
  displayText: "Use this image",
  blocks: [
    { type: "text", text: "Use this image" },
    { type: "image", data: "aGVsbG8=", mime_type: "image/png" },
  ],
}
const queue: QueuedMessage[] = [
  { id: "image", draft, modeId: "code" },
  {
    id: "next",
    draft: {
      displayText: "Test it",
      blocks: [{ type: "text", text: "Test it" }],
    },
    modeId: null,
  },
]

function setup(
  agentType: AgentType,
  channel: "native" | "pull",
  onQueueSteer = vi.fn(async () => {})
) {
  const onCancel = vi.fn()
  const onQueueReorder = vi.fn()
  const onQueueEdit = vi.fn()
  const onQueueDelete = vi.fn()
  const view = render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ChatInput
        status="prompting"
        agentType={agentType}
        steerChannel={channel}
        onQueueSteer={onQueueSteer}
        promptCapabilities={{
          image: true,
          audio: false,
          embedded_context: true,
        }}
        onSend={vi.fn()}
        onCancel={onCancel}
        queue={queue}
        onQueueReorder={onQueueReorder}
        onQueueEdit={onQueueEdit}
        onQueueDelete={onQueueDelete}
      />
    </NextIntlClientProvider>
  )
  return {
    ...view,
    onCancel,
    onQueueReorder,
    onQueueSteer,
    onQueueEdit,
    onQueueDelete,
  }
}

describe("MaxCode Claude-only native queue delivery", () => {
  it("appends Claude's queued attachment without cancellation and locks row actions until settled", async () => {
    let finish!: () => void
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    const steer = vi.fn(() => pending)
    const actions = setup("claude_code", "native", steer)
    expect(
      screen.queryByRole("button", { name: "Adjust direction" })
    ).toBeNull()
    const buttons = screen.getAllByRole("button", {
      name: "Append to current turn",
    })
    fireEvent.click(buttons[0])
    fireEvent.click(buttons[0])
    fireEvent.click(buttons[1])
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0])
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0])
    expect(steer).toHaveBeenCalledOnce()
    expect(steer).toHaveBeenCalledWith("image")
    expect(actions.onCancel).not.toHaveBeenCalled()
    expect(actions.onQueueReorder).not.toHaveBeenCalled()
    expect(actions.onQueueEdit).not.toHaveBeenCalled()
    expect(actions.onQueueDelete).not.toHaveBeenCalled()
    await act(async () => {
      finish()
      await pending
    })
    expect(buttons[0]).not.toBeDisabled()
  })

  it.each<AgentType>(["codex", "grok", "pi", "deepseek", "antigravity"])(
    "%s retains stop-and-prioritize even if a native callback is accidentally provided",
    (agent) => {
      const actions = setup(agent, "native")
      expect(
        screen.queryByRole("button", { name: "Append to current turn" })
      ).toBeNull()
      fireEvent.click(
        screen.getAllByRole("button", { name: "Adjust direction" })[1]
      )
      expect(actions.onQueueReorder).toHaveBeenCalledWith([queue[1], queue[0]])
      expect(actions.onCancel).toHaveBeenCalledOnce()
      expect(actions.onQueueSteer).not.toHaveBeenCalled()
    }
  )

  it("Claude without a confirmed native channel keeps the old action", () => {
    const actions = setup("claude_code", "pull")
    fireEvent.click(
      screen.getAllByRole("button", { name: "Adjust direction" })[0]
    )
    expect(actions.onCancel).toHaveBeenCalledOnce()
    expect(actions.onQueueSteer).not.toHaveBeenCalled()
  })

  it("claims atomically before a turn-end flush, keeps attachments and releases on failure", () => {
    const { result } = renderHook(() => useMessageQueue())
    act(() => result.current.enqueue(draft, "code"))
    const id = result.current.queue[0].id
    act(() => {
      expect(result.current.beginSteering(id)?.draft).toEqual(draft)
      expect(result.current.peekSendable()).toBeUndefined()
      expect(result.current.dequeue()).toBeUndefined()
      expect(result.current.beginSteering(id)).toBeUndefined()
      expect(result.current.remove(id)).toBeUndefined()
    })
    expect(result.current.queue).toHaveLength(1)
    expect(result.current.steeringItemId).toBe(id)
    act(() => result.current.finishSteering(id, false))
    expect(result.current.peekSendable()?.draft.blocks).toEqual(draft.blocks)
    expect(result.current.steeringItemId).toBeNull()
    act(() => {
      result.current.beginSteering(id)
      result.current.finishSteering(id, true)
    })
    expect(result.current.queue).toEqual([])
    expect(result.current.peekSendable()).toBeUndefined()
  })

  it("parks ambiguous delivery failures so a late accepted request is never auto-sent twice", () => {
    const { result } = renderHook(() => useMessageQueue())
    act(() => result.current.enqueue(draft, "code"))
    const id = result.current.queue[0].id
    act(() => {
      result.current.beginSteering(id)
      result.current.finishSteering(id, false, { flushBlocked: true })
    })
    expect(result.current.steeringItemId).toBeNull()
    expect(result.current.queue[0].draft).toEqual(draft)
    expect(result.current.peekSendable()).toBeUndefined()
    // Editing explicitly makes it sendable again; no attachment is dropped.
    act(() => result.current.updateItem(id, draft))
    expect(result.current.peekSendable()?.draft).toEqual(draft)
  })

  it("ignores stale queue entries and stale completion callbacks", () => {
    const { result } = renderHook(() => useMessageQueue())
    act(() => result.current.enqueue(draft, "code"))
    const id = result.current.queue[0].id
    act(() => {
      result.current.remove(id)
      expect(result.current.beginSteering(id)).toBeUndefined()
      result.current.enqueue(draft, "code")
    })
    const next = result.current.queue[0].id
    act(() => {
      result.current.beginSteering(next)
      result.current.finishSteering(id, true)
    })
    expect(result.current.steeringItemId).toBe(next)
    expect(result.current.queue[0].id).toBe(next)
  })

  it("production submits full blocks and settles the retained claim on every outcome", () => {
    const panel = readFileSync(
      "src/components/conversations/conversation-detail-panel.tsx",
      "utf8"
    )
    const handler = panel.slice(
      panel.indexOf("const handleQueueSteer"),
      panel.indexOf("return (\n    <ConversationShell")
    )
    expect(handler).toContain("mqBeginSteering(id)")
    expect(handler).toContain("feedbackSteer(payload.text, item.draft.blocks)")
    expect(handler).toContain("isNoActiveTurnRejection(error)")
    expect(handler).toContain("finally")
    expect(handler).toContain(
      "mqFinishSteering(id, delivered, { flushBlocked })"
    )
    expect(panel).toContain("mqSteeringItemId")
  })
})
