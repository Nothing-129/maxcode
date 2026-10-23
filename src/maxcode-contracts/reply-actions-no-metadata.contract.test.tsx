import { render, screen, fireEvent } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import { TurnStats } from "@/components/message/turn-stats"
import { MessageScrollProvider } from "@/components/message/message-scroll-context"
import messages from "@/i18n/messages/en.json"

vi.mock("@/components/message/use-new-chat-from-message", () => ({
  useNewChatFromMessage: () => vi.fn(),
}))
vi.mock("@/components/message/use-todo-from-message", () => ({
  useTodoFromMessage: () => vi.fn(),
}))

const usage = {
  input_tokens: 100,
  output_tokens: 20,
  cache_read_input_tokens: 50,
  cache_creation_input_tokens: 10,
}

describe("reply actions omit model and token metadata", () => {
  it("keeps message actions and usage-based navigation without metadata buttons", () => {
    const scrollToIndex = vi.fn()
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <MessageScrollProvider value={{ scrollToIndex }}>
          <TurnStats
            model="gpt-5"
            models={["gpt-5", "gpt-4.1"]}
            usage={usage}
            copyText="Completed reply"
            previousUserIndex={2}
            completedAt="2026-10-23T09:25:00Z"
            onForkFromHere={vi.fn()}
          />
        </MessageScrollProvider>
      </NextIntlClientProvider>
    )
    const labels = messages.Folder.chat.messageList
    expect(screen.queryByRole("button", { name: labels.model })).toBeNull()
    expect(screen.queryByRole("button", { name: labels.tokenStats })).toBeNull()
    expect(
      screen.getByRole("button", { name: labels.copyMessage })
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: labels.forkFromHere })
    ).toBeVisible()
    fireEvent.click(
      screen.getByRole("button", { name: labels.jumpToPreviousUserMessage })
    )
    expect(scrollToIndex).toHaveBeenCalledWith(2, {
      align: "start",
      smooth: true,
    })
  })

  it("does not reserve an empty action row for metadata alone", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <TurnStats model="gpt-5" usage={usage} />
      </NextIntlClientProvider>
    )
    expect(container).toBeEmptyDOMElement()
  })
})
