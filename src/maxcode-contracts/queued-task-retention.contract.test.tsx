import { readFileSync } from "node:fs"
import { act, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useMessageQueue } from "@/hooks/use-message-queue"
import { getConversationTabRetention } from "@/lib/conversation-tab-retention"

// Exercise the lightweight owner across the same busy -> idle -> virtualized
// transitions as LazyConversationTabView, without booting the ACP provider.
function Tab({
  status,
  visible = false,
}: {
  status: string
  visible?: boolean
}) {
  const queue = useMessageQueue()
  const retention = getConversationTabRetention({
    visible,
    status,
    isViewer: false,
    backgroundOutstanding: 0,
    hasPendingInteraction: false,
    hasQueuedMessages: queue.queue.length > 0,
  })
  return (
    <>
      <button
        onClick={() =>
          queue.enqueue(
            {
              blocks: [{ type: "text", text: "Install OCR" }],
              displayText: "Install OCR",
            },
            "code"
          )
        }
      >
        Queue
      </button>
      <button onClick={() => queue.dequeue()}>Send</button>
      <button
        onClick={() =>
          queue.requeueFront(
            {
              blocks: [{ type: "text", text: "Install OCR" }],
              displayText: "Install OCR",
            },
            "code",
            { flushBlocked: true }
          )
        }
      >
        Fail
      </button>
      {retention.mounted && (
        <div data-testid="conversation">
          {queue.queue.map((item) => (
            <p key={item.id}>{item.draft.displayText}</p>
          ))}
        </div>
      )}
    </>
  )
}

describe("queued tasks survive turn completion", () => {
  it("keeps the hidden conversation mounted until the pending task is sent", () => {
    const view = render(<Tab status="prompting" />)
    act(() => screen.getByText("Queue").click())
    view.rerender(<Tab status="connected" />)
    expect(screen.getByText("Install OCR")).toBeTruthy()
    act(() => screen.getByText("Send").click())
    expect(screen.queryByTestId("conversation")).toBeNull()

    // A send can fail after the heavy view has already been unmounted.
    act(() => screen.getByText("Fail").click())
    expect(screen.getByText("Install OCR")).toBeTruthy()
    view.rerender(<Tab status="connected" visible />)
    expect(screen.getAllByText("Install OCR")).toHaveLength(1)
  })

  it("owns the production queue outside the virtualized conversation", () => {
    const source = readFileSync(
      "src/components/conversations/conversation-detail-panel.tsx",
      "utf8"
    )
    const [heavy, lazy] = source.split("const LazyConversationTabView = memo")
    expect(heavy).not.toContain("const messageQueue = useMessageQueue()")
    expect(lazy).toContain("const messageQueue = useMessageQueue()")
    expect(lazy).toContain("hasQueuedMessages: messageQueue.queue.length > 0")
    expect(lazy).toContain("messageQueue={messageQueue}")
  })
})
