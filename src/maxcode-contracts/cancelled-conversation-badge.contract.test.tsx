import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SidebarConversationCard } from "@/components/conversations/sidebar-conversation-card"
import {
  resetConversationUnreadStore,
  useConversationUnreadStore,
} from "@/stores/conversation-unread-store"
import { __resetUiPreferencesStoreForTests } from "@/lib/ui-preferences-store"
import type { DbConversationSummary } from "@/lib/types"
import enMessages from "@/i18n/messages/en.json"

vi.mock("@/lib/api", () => ({
  getUiPreferences: vi.fn(async () => null),
  updateUiPreferences: vi.fn((prefs: unknown) => Promise.resolve(prefs)),
}))
vi.mock("@/lib/platform", () => ({
  subscribe: vi.fn(async () => () => {}),
  onTransportReconnect: vi.fn(() => null),
}))

beforeEach(() => {
  localStorage.clear()
  __resetUiPreferencesStoreForTests()
  resetConversationUnreadStore()
})
afterEach(cleanup)

const completeConversation = vi.fn()

function mount(status = "cancelled", parentId?: number) {
  const conversation: DbConversationSummary = {
    id: 1,
    folder_id: 1,
    title: "Stopped task",
    title_locked: false,
    agent_type: "claude_code",
    status,
    kind: "regular",
    model: null,
    git_branch: null,
    external_id: null,
    message_count: 1,
    child_count: 0,
    created_at: "2026-09-08T00:00:00Z",
    updated_at: "2026-09-08T00:00:00Z",
    pinned_at: null,
    parent_id: parentId,
  }
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SidebarConversationCard
        conversation={conversation}
        isSelected={false}
        isOpenInTab={false}
        timeLabel="5m"
        onSelect={vi.fn()}
        onDoubleClick={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onStatusChange={completeConversation}
      />
    </NextIntlClientProvider>
  )
}

describe("MaxCode: cancelled tasks have no error badge", () => {
  it.each([undefined, 42])(
    "shows the timestamp for cancelled tasks (parent %s)",
    (parentId) => {
      const { container } = mount("cancelled", parentId)
      expect(screen.getByText("5m")).toBeInTheDocument()
      expect(
        screen.queryByTitle(enMessages.Folder.sidebar.statusCancelledBadge)
      ).not.toBeInTheDocument()
      expect(container.querySelector(".lucide-circle-x")).toBeNull()
    }
  )

  it.each([undefined, 42])(
    "retains the running indicator (parent %s)",
    (parentId) => {
      const { container } = mount("in_progress", parentId)
      expect(
        screen.getByTitle(enMessages.Folder.sidebar.statusRunningBadge)
      ).toBeInTheDocument()
      expect(container.querySelector(".animate-spin")).toBeInTheDocument()
      expect(screen.queryByText("5m")).not.toBeInTheDocument()
    }
  )

  it("retains unread indication on cancelled tasks", () => {
    useConversationUnreadStore.setState({ unreadIds: new Set([1]) })
    mount()
    expect(
      screen.getByLabelText(enMessages.Folder.sidebar.unreadBadge)
    ).toBeInTheDocument()
    expect(screen.queryByText("5m")).not.toBeInTheDocument()
  })
})

it("retains title hover completion without adding a title label", () => {
  const { container } = mount("pending_review")
  const button = screen.getByRole("button", { name: "Mark as completed" })
  expect(button.parentElement).toHaveClass("hidden", "group-hover:flex")
  fireEvent.click(button)
  expect(completeConversation).toHaveBeenCalledWith(1, "completed")
  expect(screen.getByText("Stopped task")).toBeInTheDocument()
  expect(screen.queryByText("Completed")).toBeNull()
  expect(container.querySelector(".text-amber-600")).toBeNull()
})
