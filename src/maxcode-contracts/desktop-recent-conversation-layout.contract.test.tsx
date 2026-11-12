import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SidebarConversationCard } from "@/components/conversations/sidebar-conversation-card"
import {
  resetConversationUnreadStore,
  useConversationUnreadStore,
} from "@/stores/conversation-unread-store"
import type { DbConversationSummary } from "@/lib/types"
import messages from "@/i18n/messages/en.json"

vi.mock("@/components/agent-icon", () => ({ AgentIcon: () => null }))
vi.mock(
  "@/components/conversations/sidebar-conversation-hover-details",
  () => ({
    SidebarConversationHoverDetails: () => null,
  })
)

afterEach(() => {
  cleanup()
  resetConversationUnreadStore()
})

const conversation: DbConversationSummary = {
  id: 42,
  folder_id: 1,
  title: "1112｜开发｜检查最近会话的显示",
  title_locked: false,
  agent_type: "codex",
  status: "pending",
  kind: "regular",
  model: null,
  git_branch: null,
  external_id: null,
  message_count: 0,
  child_count: 0,
  created_at: "2026-11-12T00:00:00Z",
  updated_at: "2026-11-12T00:00:00Z",
  pinned_at: null,
}

function showCard(status: "pending" | "in_progress" = "pending") {
  const onSelect = vi.fn()
  const onTogglePin = vi.fn()
  const result = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SidebarConversationCard
        conversation={{ ...conversation, status }}
        isMobile={false}
        stackMetadata
        isSelected={false}
        timeLabel="3m"
        folderLabel="maxcode"
        showFolderIcon
        onSelect={onSelect}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onStatusChange={vi.fn()}
        onTogglePin={onTogglePin}
      />
    </NextIntlClientProvider>
  )
  return { ...result, onSelect, onTogglePin }
}

describe("desktop Recent conversation layout", () => {
  it.each(["pending", "running", "unread"] as const)(
    "shows title and aligned date, folder and time while preserving %s status",
    (state) => {
      if (state === "unread")
        useConversationUnreadStore.setState({ unreadIds: new Set([42]) })
      const { container, onSelect } = showCard(
        state === "running" ? "in_progress" : "pending"
      )
      const title = screen.getByText("检查最近会话的显示")
      expect(title).toHaveClass("truncate")
      const meta = container.querySelector<HTMLElement>(
        "[data-mobile-conversation-meta]"
      )!
      expect(within(meta).getByText("1112")).toBeInTheDocument()
      expect(within(meta).getByText("maxcode")).toBeInTheDocument()
      expect(within(meta).getByText("3m")).toBeInTheDocument()
      expect(meta).toHaveClass("grid", "grid-cols-[4ch_minmax(0,1fr)_auto]")
      if (state === "running")
        expect(container.querySelector("[data-running-spinner]")).not.toBeNull()
      if (state === "unread")
        expect(container.querySelector("[data-unread-dot]")).not.toBeNull()
      fireEvent.click(title)
      expect(onSelect).toHaveBeenCalledWith(42, "codex", 1)
    }
  )

  it("keeps desktop menu actions without selecting the conversation", async () => {
    const { onSelect, onTogglePin } = showCard()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "More actions" }))
    await user.click(screen.getByRole("menuitem", { name: "Pin" }))
    expect(onTogglePin).toHaveBeenCalledWith(42, true)
    expect(onSelect).not.toHaveBeenCalled()
  })
})
