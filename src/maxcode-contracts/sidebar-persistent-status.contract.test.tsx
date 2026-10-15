import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SidebarConversationCard } from "@/components/conversations/sidebar-conversation-card"
import {
  useConversationUnreadStore,
  resetConversationUnreadStore,
} from "@/stores/conversation-unread-store"
import type { DbConversationSummary } from "@/lib/types"
import messages from "@/i18n/messages/en.json"

vi.mock(
  "@/components/conversations/sidebar-conversation-hover-details",
  () => ({ SidebarConversationHoverDetails: () => null })
)
vi.mock("@/components/agent-icon", () => ({ AgentIcon: () => null }))

afterEach(() => {
  cleanup()
  resetConversationUnreadStore()
})

const conversation: DbConversationSummary = {
  id: 91,
  folder_id: 1,
  title: "Preserve status",
  title_locked: false,
  agent_type: "codex",
  status: "pending",
  kind: "regular",
  model: null,
  git_branch: null,
  external_id: null,
  message_count: 0,
  child_count: 0,
  created_at: "2026-10-11T00:00:00Z",
  updated_at: "2026-10-11T00:00:00Z",
  pinned_at: null,
}

describe("MaxCode: sidebar status persists beside actions", () => {
  it.each(["running", "unread", "time"] as const)(
    "retains %s while using the menu without selecting the conversation",
    async (state) => {
      if (state === "unread")
        useConversationUnreadStore.setState({ unreadIds: new Set([91]) })
      const onSelect = vi.fn()
      const onTogglePin = vi.fn()
      const user = userEvent.setup()
      const { container } = render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <SidebarConversationCard
            conversation={{
              ...conversation,
              status: state === "running" ? "in_progress" : "pending",
            }}
            isSelected={false}
            timeLabel="5m"
            onSelect={onSelect}
            onRename={vi.fn()}
            onDelete={vi.fn()}
            onStatusChange={vi.fn()}
            onTogglePin={onTogglePin}
          />
        </NextIntlClientProvider>
      )
      const status = container.querySelector<HTMLElement>(
        "[data-conversation-status]"
      )!
      if (state === "running")
        expect(status.querySelector("[data-running-spinner]")).not.toBeNull()
      else if (state === "unread")
        expect(status.querySelector("[data-unread-dot]")).toHaveAttribute(
          "aria-label",
          messages.Folder.sidebar.unreadBadge
        )
      else expect(status).toHaveTextContent("5m")
      // jsdom does not evaluate Tailwind hover variants. Assert that no ancestor
      // hides the indicator on hover/focus as well as exercising the real menu.
      for (
        let node: HTMLElement | null = status;
        node && node !== container;
        node = node.parentElement
      ) {
        expect(node.className).not.toMatch(
          /(?:hover|focus)[^ ]*:(?:hidden|opacity-0|invisible)/
        )
      }
      const more = screen.getByRole("button", { name: "More actions" })
      expect(more).not.toHaveAttribute("tabindex", "-1")
      await user.hover(more)
      await user.click(more)
      expect(status).toBeVisible()
      await user.click(screen.getByRole("menuitem", { name: "Pin" }))
      expect(onTogglePin).toHaveBeenCalledWith(91, true)
      expect(onSelect).not.toHaveBeenCalled()
      expect(status).toBeVisible()
    }
  )
})
