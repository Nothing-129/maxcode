import { type ReactNode } from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WorkbenchRouteProvider } from "@/contexts/workbench-route-context"
import { consumePendingTodoDraft } from "@/lib/todo-compose-events"
import enMessages from "@/i18n/messages/en.json"
import {
  HistoricalMessageGroup,
  type ResolvedMessageGroup,
} from "./message-list-view"

vi.mock("./use-new-chat-from-message", () => ({
  useNewChatFromMessage: () => () => {},
}))
vi.mock("./collapsible-user-message", () => ({
  CollapsibleUserMessage: () => <div>User message</div>,
}))

const userMessage: ResolvedMessageGroup = {
  id: "user-1",
  role: "user",
  parts: [
    {
      type: "text",
      text: "Fix C:\\\\tools\\\\login.ts &amp; keep [reference](https://example.com)",
    },
  ],
  images: [],
  resources: [],
}

function withIntl(children: ReactNode) {
  return (
    <NextIntlClientProvider
      locale="en"
      messages={{ ...enMessages, Todos: { addMessage: "Add message to todo" } }}
    >
      {children}
    </NextIntlClientProvider>
  )
}

afterEach(() => consumePendingTodoDraft())

describe("User message todo action", () => {
  it("prefills literal user text while preserving authored reference links", async () => {
    render(
      withIntl(
        <WorkbenchRouteProvider>
          <HistoricalMessageGroup group={userMessage} />
        </WorkbenchRouteProvider>
      )
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Add message to todo" })
    )
    expect(consumePendingTodoDraft()).toEqual({
      text: "Fix C:\\tools\\login.ts & keep [reference](https://example.com)",
    })
  })

  it("omits the todo action on transcript surfaces without the workbench", () => {
    render(withIntl(<HistoricalMessageGroup group={userMessage} />))
    expect(
      screen.queryByRole("button", { name: "Add message to todo" })
    ).not.toBeInTheDocument()
    expect(consumePendingTodoDraft()).toBeNull()
  })
})
