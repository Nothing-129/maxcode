import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TurnStats } from "@/components/message/turn-stats"
import { consumePendingTodoDraft } from "@/lib/todo-compose-events"
import {
  consumeAskSelectionPrompts,
  resetAskSelectionPromptsForTests,
} from "@/lib/ask-selection-handoff"
import enMessages from "@/i18n/messages/en.json"

const actions = vi.hoisted(() => ({
  setRoute: vi.fn(),
  openNewConversationTab: vi.fn(),
}))

vi.mock("@/contexts/workbench-route-context", () => ({
  useOptionalWorkbenchRoute: () => ({ setRoute: actions.setRoute }),
  useWorkbenchRoute: () => ({ setRoute: actions.setRoute }),
}))
vi.mock("@/stores/app-workspace-store", () => ({
  useAppWorkspaceStore: {
    getState: () => ({
      allFolders: [{ id: 7, path: "/project", kind: "regular" }],
    }),
  },
}))
vi.mock("@/stores/tab-store", () => ({
  groupOfTab: () => "main",
  useTabStore: {
    getState: () => ({
      rawTabs: [{ id: "source", folderId: 7, agentType: "codex" }],
      activeTabId: "source",
      openNewConversationTab: actions.openNewConversationTab,
    }),
  },
}))

const text = "## 接下来处理\n\n修复登录，并保留 [设计](https://example.com)"
const identity = { folderId: 7, agentType: "codex" } as const

function renderReply(complete = true) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ ...enMessages, Todos: { addMessage: "Add message to todo" } }}
    >
      <TurnStats copyText={text} isResponseComplete={complete} />
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  consumePendingTodoDraft()
  resetAskSelectionPromptsForTests()
  actions.openNewConversationTab.mockReturnValue({
    tabId: "draft",
    ...identity,
  })
})

describe("MaxCode: independent todo message handoff", () => {
  it("buffers finalized reply text for the workspace dialog without navigation", async () => {
    renderReply()
    await userEvent.click(screen.getByLabelText("Add message to todo"))
    expect(actions.setRoute).not.toHaveBeenCalled()
    expect(consumePendingTodoDraft()).toEqual({ text })
    expect(consumePendingTodoDraft()).toBeNull()
    expect(actions.openNewConversationTab).not.toHaveBeenCalled()
    expect(consumeAskSelectionPrompts("draft", identity, "draft")).toEqual([])
  })

  it("keeps the adjacent new-chat action as an unsent composer draft", async () => {
    renderReply()
    await userEvent.click(
      screen.getByLabelText(enMessages.Tasks.newChatFromMessage)
    )
    expect(actions.setRoute).toHaveBeenCalledWith("conversations")
    expect(consumePendingTodoDraft()).toBeNull()
    expect(consumeAskSelectionPrompts("draft", identity)).toEqual([])
    expect(consumeAskSelectionPrompts("draft", identity, "draft")).toEqual([
      text,
    ])
  })

  it("does not expose todo creation while a reply is still streaming", () => {
    renderReply(false)
    expect(
      screen.queryByLabelText("Add message to todo")
    ).not.toBeInTheDocument()
    expect(consumePendingTodoDraft()).toBeNull()
  })
})
