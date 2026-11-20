import { act, cleanup, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import type { ReactNode } from "react"
import { afterEach, expect, it, vi } from "vitest"
import { MessageListView } from "@/components/message/message-list-view"
import { WorkbenchRouteProvider } from "@/contexts/workbench-route-context"
import messages from "@/i18n/messages/en.json"
import { getFolderConversation } from "@/lib/api"
import type { DbConversationDetail } from "@/lib/types"
import {
  resetConversationRuntimeStore,
  useConversationRuntimeStore,
} from "@/stores/conversation-runtime-store"

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  getFolderConversation: vi.fn(),
}))

// JSDOM does not measure a viewport for the virtualizer.
vi.mock("virtua", () => ({
  Virtualizer: ({ children }: { children: ReactNode }) => children,
}))

vi.mock("@/hooks/use-open-file-target", () => ({
  useOpenFileTarget: () => async () => {},
}))

const detail: DbConversationDetail = {
  summary: {
    id: 42,
    folder_id: 1,
    title: "Conversation",
    title_locked: false,
    agent_type: "codex",
    status: "completed",
    kind: "regular",
    model: null,
    git_branch: null,
    external_id: "codex-session",
    message_count: 2,
    child_count: 0,
    created_at: "2026-11-18T10:00:00Z",
    updated_at: "2026-11-18T10:00:15Z",
    pinned_at: null,
  },
  turns: [
    {
      id: "turn-0",
      role: "user",
      blocks: [{ type: "text", text: "Where is the config?" }],
      timestamp: "2026-11-18T10:00:00Z",
    },
    {
      id: "turn-1",
      role: "assistant",
      blocks: [{ type: "text", text: "The config is in the project folder." }],
      timestamp: "2026-11-18T10:00:15Z",
      completed_at: "2026-11-18T10:00:15Z",
      duration_ms: 15_000,
    },
  ],
}

afterEach(() => {
  cleanup()
  resetConversationRuntimeStore()
})

it("omits new chat, todo and fork from message action rows", async () => {
  vi.mocked(getFolderConversation).mockResolvedValueOnce(detail)
  await act(async () =>
    useConversationRuntimeStore.getState().actions.refetchDetail(42)
  )
  await act(async () =>
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <WorkbenchRouteProvider>
          <MessageListView
            conversationId={42}
            agentType="codex"
            connStatus="connected"
            showMessageNav={false}
          />
        </WorkbenchRouteProvider>
      </NextIntlClientProvider>
    )
  )

  const labels = messages.Folder.chat.messageList
  expect(
    screen.getByRole("button", { name: labels.jumpToPreviousUserMessage })
  ).toBeInTheDocument()
  expect(
    screen.getAllByRole("button", { name: labels.copyMessage })
  ).toHaveLength(2)
  expect(
    screen.getByRole("button", { name: new RegExp(`^${labels.completedAt}:`) })
  ).toBeInTheDocument()
  const hiddenActions = [
    messages.Tasks.newChatFromMessage,
    messages.Todos.addMessage,
    labels.forkFromHere,
  ]
  expect(
    hiddenActions.filter(
      (name) => screen.queryAllByRole("button", { name }).length > 0
    )
  ).toEqual([])
})
