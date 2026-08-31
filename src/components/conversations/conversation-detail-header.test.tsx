import { type ComponentProps, type ReactElement } from "react"
import { render, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi, beforeEach } from "vitest"

import enMessages from "@/i18n/messages/en.json"

// The header is a SINGLE instance reused across active tabs, and the global
// tab-switch / close-tab shortcuts still fire while a rename/delete dialog is
// open. These tests pin the regression Codex flagged: a confirm must act on the
// conversation the dialog was OPENED for, not whatever is active at confirm
// time. We open the dialog for A, rerender the same instance as B (simulating a
// mid-dialog tab switch), then confirm — and assert A is mutated, never B.
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

import { ConversationDetailHeader } from "./conversation-detail-header"

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
const B: Props = {
  ...A,
  tabId: "tab-b",
  conversationId: 2,
  title: "conv-b",
}

function withIntl(ui: ReactElement) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>
  )
}

describe("ConversationDetailHeader dialog target snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.webServiceConfig = {
      token: "server-token",
      port: 3080,
      autoStart: false,
      publicShareUrl: null,
    }
  })

  it("deletes the conversation the dialog was opened for, even after the active tab switches", async () => {
    // pointerEventsCheck off: Radix toggles body pointer-events while a menu is
    // open, which user-event's default guard would trip on in jsdom.
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const { rerender, getByLabelText, getByRole } = render(
      withIntl(<ConversationDetailHeader {...A} />)
    )

    await user.click(getByLabelText("More actions"))
    await user.click(getByRole("menuitem", { name: "Delete" }))

    // Simulate a mid-dialog tab switch: same header instance, now scoped to B.
    rerender(withIntl(<ConversationDetailHeader {...B} />))

    await user.click(getByRole("button", { name: "Delete" }))

    await waitFor(() => {
      expect(h.deleteConversation).toHaveBeenCalledWith(1)
      // `recordForReopen: false`: the row is deleted, so "reopen closed tab"
      // must not be able to mint a tab pointing back at it.
      expect(h.closeTab).toHaveBeenCalledWith("tab-a", {
        recordForReopen: false,
      })
    })
    expect(h.deleteConversation).not.toHaveBeenCalledWith(2)
    expect(h.closeTab).not.toHaveBeenCalledWith("tab-b", expect.anything())
  })

  it("renames the conversation the dialog was opened for, even after the active tab switches", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const { rerender, getByLabelText, getByRole } = render(
      withIntl(<ConversationDetailHeader {...A} />)
    )

    await user.click(getByLabelText("More actions"))
    await user.click(getByRole("menuitem", { name: "Rename" }))

    rerender(withIntl(<ConversationDetailHeader {...B} />))

    const input = getByRole("textbox")
    await user.clear(input)
    await user.type(input, "renamed")
    await user.click(getByRole("button", { name: "Save" }))

    await waitFor(() => {
      expect(h.updateConversationTitle).toHaveBeenCalledWith(1, "renamed")
    })
    expect(h.updateConversationTitle).not.toHaveBeenCalledWith(2, "renamed")
  })

  it("asks for a public address once, saves it, and reuses it next time", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const { findByLabelText, getByLabelText, getByRole } = render(
      withIntl(<ConversationDetailHeader {...A} />)
    )

    await user.click(getByLabelText("More actions"))
    await user.click(getByRole("menuitem", { name: "Share conversation" }))

    const publicUrlInput = await findByLabelText("Public share address")
    expect(h.createConversationShare).not.toHaveBeenCalled()
    await user.type(publicUrlInput, "https://maxcode.example.com")
    await user.click(getByRole("button", { name: "Save and share" }))

    await waitFor(() => {
      expect(h.updateWebServiceConfig).toHaveBeenCalledWith({
        token: "server-token",
        port: 3080,
        autoStart: false,
        publicShareUrl: "https://maxcode.example.com",
      })
      expect(getByLabelText("Share link")).toHaveValue(
        "https://maxcode.example.com/share#0123456789abcdef0123456789abcdef"
      )
    })

    await user.click(getByRole("button", { name: "Done" }))
    await user.click(getByLabelText("More actions"))
    await user.click(getByRole("menuitem", { name: "Share conversation" }))

    await waitFor(() => {
      expect(h.createConversationShare).toHaveBeenCalledTimes(2)
      expect(getByLabelText("Share link")).toHaveValue(
        "https://maxcode.example.com/share#0123456789abcdef0123456789abcdef"
      )
    })
    expect(h.updateWebServiceConfig).toHaveBeenCalledTimes(1)
  })

  it("can use the local address once without saving it", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const { findByLabelText, getByLabelText, getByRole } = render(
      withIntl(<ConversationDetailHeader {...A} />)
    )

    await user.click(getByLabelText("More actions"))
    await user.click(getByRole("menuitem", { name: "Share conversation" }))
    await findByLabelText("Public share address")
    await user.click(
      getByRole("button", { name: "Use local address this time" })
    )

    await waitFor(() => {
      expect(getByLabelText("Share link")).toHaveValue(
        "http://localhost:3000/share#0123456789abcdef0123456789abcdef"
      )
    })
    expect(h.updateWebServiceConfig).not.toHaveBeenCalled()
    expect(h.webServiceConfig.publicShareUrl).toBeNull()
  })
})
