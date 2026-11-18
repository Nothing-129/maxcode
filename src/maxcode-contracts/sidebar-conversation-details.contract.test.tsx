import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SidebarConversationCard } from "@/components/conversations/sidebar-conversation-card"
import enMessages from "@/i18n/messages/en.json"
import type { DbConversationSummary, FolderDetail } from "@/lib/types"
import {
  resetAppWorkspaceStore,
  useAppWorkspaceStore,
} from "@/stores/app-workspace-store"

vi.mock("@/lib/api", () => ({
  getFolderConversation: vi.fn(async () => ({
    summary: conversation,
    turns: [],
  })),
  getUiPreferences: vi.fn(async () => null),
}))
vi.mock("@/components/agent-icon", () => ({ AgentIcon: () => null }))

const conversation: DbConversationSummary = {
  id: 42,
  folder_id: 7,
  title: "Review the sidebar",
  title_locked: false,
  agent_type: "codex",
  status: "pending",
  kind: "regular",
  model: "gpt-6.2-astra",
  git_branch: "review/sidebar",
  external_id: null,
  message_count: 0,
  child_count: 0,
  created_at: "2026-11-18T00:00:00Z",
  updated_at: "2026-11-18T00:00:00Z",
  pinned_at: null,
}

const folder: FolderDetail = {
  id: 7,
  name: "MaxCode",
  path: "/Users/dev/projects/maxcode",
  git_branch: null,
  default_agent_type: null,
  last_opened_at: conversation.updated_at,
  sort_order: 0,
  color: "inherit",
  parent_id: null,
  kind: "regular",
  alias: null,
  group_id: null,
}

function renderCard() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SidebarConversationCard
        conversation={conversation}
        isSelected={false}
        stackMetadata
        folderLabel={folder.name}
        onSelect={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onStatusChange={vi.fn()}
      />
    </NextIntlClientProvider>
  )
  return screen.getByRole("button", { name: /Review the sidebar/ })
}

beforeEach(() => {
  useAppWorkspaceStore.setState({
    allFolders: [folder],
    branches: new Map([[folder.id, "main"]]),
  })
})

afterEach(() => {
  cleanup()
  resetAppWorkspaceStore()
  vi.useRealTimers()
})

describe("sidebar conversation details", () => {
  it.each(["pointer hover", "keyboard focus"])(
    "keeps metadata closed on %s",
    (trigger) => {
      vi.useFakeTimers()
      const row = renderCard()
      if (trigger === "pointer hover") {
        fireEvent.pointerEnter(row, { pointerType: "mouse" })
      } else {
        act(() => row.focus())
        expect(row).toHaveFocus()
      }

      act(() => vi.advanceTimersByTime(1000))

      expect(screen.queryByText(folder.path)).toBeNull()
      expect(screen.queryByText("review/sidebar")).toBeNull()
    }
  )

  it("shows the folder, path and recorded branch in Session Details", async () => {
    fireEvent.contextMenu(renderCard())
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Session Details" })
    )

    const details = within(
      screen.getByRole("dialog", { name: "Session Details" })
    )
    expect(details.getByText("MaxCode")).toBeInTheDocument()
    expect(details.getByText("/Users/dev/projects/maxcode")).toBeInTheDocument()
    expect(details.getByText("review/sidebar")).toBeInTheDocument()
  })
})
