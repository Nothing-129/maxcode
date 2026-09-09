import { type ComponentProps, type ReactElement } from "react"
import { cleanup, render, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

import enMessages from "@/i18n/messages/en.json"

const h = vi.hoisted(() => ({
  updateConversationTitle: vi.fn(async () => {}),
  deleteConversation: vi.fn(async () => {}),
  updateConversationStatus: vi.fn(async () => {}),
  updateConversationPinned: vi.fn(async () => {}),
  createConversationShare: vi.fn(async () => ({
    token: "0123456789abcdef0123456789abcdef",
    shared_at: "2026-08-31T00:00:00Z",
  })),
  revokeConversationShare: vi.fn(async () => {}),
  webServiceConfig: {
    token: "server-token",
    port: 3080,
    autoStart: false,
    publicShareUrl: null,
  } as {
    token: string | null
    port: number | null
    autoStart: boolean
    publicShareUrl: string | null
  },
  getWebServiceConfig: vi.fn(async () => h.webServiceConfig),
  updateWebServiceConfig: vi.fn(
    async (config: {
      token: string | null
      port: number | null
      autoStart: boolean
      publicShareUrl: string | null
    }) => {
      h.webServiceConfig = config
      return config
    }
  ),
  getWebServerStatus: vi.fn(async () => null),
  startWebServer: vi.fn(async () => ({
    port: 3080,
    token: "server-token",
    addresses: ["http://127.0.0.1:3080"],
  })),
  closeTab: vi.fn(),
  openNewConversationTab: vi.fn(),
  updateConversationLocal: vi.fn(),
  refreshConversations: vi.fn(),
}))

vi.mock("@/lib/api", () => ({
  updateConversationTitle: h.updateConversationTitle,
  deleteConversation: h.deleteConversation,
  updateConversationStatus: h.updateConversationStatus,
  updateConversationPinned: h.updateConversationPinned,
  createConversationShare: h.createConversationShare,
  revokeConversationShare: h.revokeConversationShare,
  getWebServiceConfig: h.getWebServiceConfig,
  updateWebServiceConfig: h.updateWebServiceConfig,
  getWebServerStatus: h.getWebServerStatus,
  startWebServer: h.startWebServer,
}))
vi.mock("@/lib/transport", () => ({
  getServerBaseUrl: () => "http://localhost:3000",
  isDesktop: () => false,
  isRemoteDesktopMode: () => false,
}))
vi.mock("@/contexts/tab-context", () => ({
  useTabActions: () => ({
    closeTab: h.closeTab,
    openNewConversationTab: h.openNewConversationTab,
  }),
}))
// The header collapses the touch sidebar on "new conversation"; these tests
// exercise rename/delete targeting, so a bare stub context is enough.
vi.mock("@/contexts/sidebar-context", () => ({
  useSidebarContext: () => ({ isOpen: true, toggle: vi.fn(), close: vi.fn() }),
}))
vi.mock("@/stores/app-workspace-store", () => {
  const state = {
    updateConversationLocal: h.updateConversationLocal,
    refreshConversations: h.refreshConversations,
    conversations: [] as unknown[],
  }
  const useStore = (selector: (s: typeof state) => unknown) => selector(state)
  useStore.getState = () => state
  return { useAppWorkspaceStore: useStore }
})
vi.mock("@/stores/conversation-runtime-store", () => ({
  getRuntimeSession: () => null,
}))
vi.mock("./session-details-dialog", () => ({
  SessionDetailsDialog: () => null,
}))
// The header now embeds the folder picker (self-contained, store-driven); stub
// it so these tests exercise only the header's own menu/dialog logic.
vi.mock("@/components/chat/conversation-context-bar", () => ({
  ConversationHeaderFolderPicker: () => null,
}))

import { ConversationFind } from "@/components/message/conversation-find"
import { ConversationDetailHeader } from "@/components/conversations/conversation-detail-header"

type Props = ComponentProps<typeof ConversationDetailHeader>

const A: Props = {
  tabId: "tab-a",
  conversationId: 1,
  runtimeConversationId: null,
  folderId: 1,
  folderPath: "/a",
  title: "conv-a",
  status: "in_progress",
}

function withIntl(ui: ReactElement) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>
  )
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe("MaxCode: title completion is the only status action", () => {
  it("opens conversation actions from the ellipsis immediately beside the title", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const { getByRole, getByText, queryByRole } = render(
      withIntl(<ConversationDetailHeader {...A} />)
    )
    const trigger = getByRole("button", { name: "More actions" })
    expect(getByText(A.title).nextElementSibling).toBe(trigger)
    expect(trigger.querySelector("svg")).not.toBeNull()
    expect(queryByRole("button", { name: "Rename" })).toBeNull()

    await user.click(trigger)
    for (const name of ["Rename", "Pin", "Delete"]) {
      expect(getByRole("menuitem", { name })).toBeVisible()
    }
    await user.click(getByRole("menuitem", { name: "Rename" }))
    expect(getByRole("textbox")).toHaveValue(A.title)
  })

  it("opens search from the title menu and focuses the active runtime conversation", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const view = render(
      withIntl(
        <>
          <ConversationDetailHeader {...A} runtimeConversationId={-42} />
          <ConversationFind
            conversationId={-42}
            items={[]}
            active
            scrollApiRef={{ current: null }}
            historyOffset={0}
            loadingHistory={false}
            onLoadHistory={vi.fn()}
          />
        </>
      )
    )
    expect(view.queryByRole("search")).toBeNull()
    await user.click(view.getByRole("button", { name: "More actions" }))
    await user.click(
      view.getByRole("menuitem", { name: "Find in conversation" })
    )
    await waitFor(() =>
      expect(
        view.getByRole("textbox", { name: "Find in conversation" })
      ).toHaveFocus()
    )
    expect(view.queryByRole("menu")).toBeNull()
    await user.keyboard("{Escape}")
    expect(view.queryByRole("search")).toBeNull()
  })

  it("marks the conversation completed without exposing status choices", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const view = render(withIntl(<ConversationDetailHeader {...A} />))
    await user.click(
      view.getByRole("button", {
        name: enMessages.Folder.conversation.moreActions,
      })
    )
    expect(view.queryByText("Status")).toBeNull()
    expect(view.queryByText("Review")).toBeNull()
    await user.click(view.getByRole("menuitem", { name: "Mark as completed" }))
    await waitFor(() => {
      expect(h.updateConversationStatus).toHaveBeenCalledWith(1, "completed")
      expect(h.updateConversationLocal).toHaveBeenCalledWith(1, {
        status: "completed",
      })
      expect(h.updateConversationTitle).not.toHaveBeenCalled()
    })
  })

  it("leaves the title unchanged and offers no reopen action", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const view = render(
      withIntl(<ConversationDetailHeader {...A} status="completed" />)
    )
    expect(view.getByText("conv-a")).toBeInTheDocument()
    expect(view.queryByText("Completed")).toBeNull()
    await user.click(
      view.getByRole("button", {
        name: enMessages.Folder.conversation.moreActions,
      })
    )
    expect(view.queryByText("Mark as completed")).toBeNull()
    expect(view.queryByText("Reopen")).toBeNull()
  })
})
