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

vi.mock("@/components/agent-icon", () => ({
  AgentIcon: ({ className }: { className?: string }) => (
    <svg data-testid="agent-icon" className={className} />
  ),
}))
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

function showCard(
  status: "pending" | "in_progress" = "pending",
  locale: "en" | "zh-CN" = "en"
) {
  const onSelect = vi.fn()
  const onTogglePin = vi.fn()
  const result = render(
    <NextIntlClientProvider locale={locale} messages={messages}>
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
    "shows topic and combined source/time with an agent icon and no date while preserving %s status",
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
      expect(within(meta).queryByText("1112")).toBeNull()
      expect(within(meta).getByTestId("agent-icon")).toHaveClass("size-3")
      expect(screen.getAllByTestId("agent-icon")).toHaveLength(1)
      expect(within(meta).getByText("maxcode")).toBeInTheDocument()
      expect(within(meta).getByText("3 minutes ago")).toBeInTheDocument()
      expect(meta).toHaveTextContent("maxcode·3 minutes ago")
      expect(meta).toHaveClass("flex")
      const selectButton = container.querySelector("[data-conversation-id]")!
      expect(selectButton).toHaveClass("pr-4")
      expect(selectButton.parentElement).toHaveClass(
        "hover:bg-black/[0.04]",
        "dark:hover:bg-white/[0.06]"
      )
      const status = container.querySelector("[data-conversation-status]")!
      expect(status.parentElement).toHaveClass(
        "absolute",
        "right-4",
        "top-1/2",
        "-translate-y-1/2"
      )
      expect(status).toHaveClass("justify-end")
      if (state === "unread" || state === "running") {
        expect(
          screen.queryByRole("button", { name: "More actions" })
        ).toBeNull()
      } else {
        expect(
          screen.getByRole("button", { name: "More actions" })
        ).toHaveClass("right-0", "ml-0", "justify-center", "p-0")
      }
      if (state === "running")
        expect(container.querySelector("[data-running-spinner]")).not.toBeNull()
      if (state === "unread")
        expect(container.querySelector("[data-unread-dot]")).not.toBeNull()
      fireEvent.click(title)
      expect(onSelect).toHaveBeenCalledWith(42, "codex", 1)
    }
  )

  it("localizes the relative time for the Chinese recent list", () => {
    showCard("pending", "zh-CN")
    expect(screen.getByText("3分钟前")).toBeInTheDocument()
  })

  it("keeps desktop menu actions without selecting the conversation", async () => {
    const { onSelect, onTogglePin } = showCard()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "More actions" }))
    await user.click(screen.getByRole("menuitem", { name: "Pin" }))
    expect(onTogglePin).toHaveBeenCalledWith(42, true)
    expect(onSelect).not.toHaveBeenCalled()
  })
})
