import { render } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import { SidebarConversationCard } from "@/components/conversations/sidebar-conversation-card"
import type { DbConversationSummary } from "@/lib/types"
import en from "@/i18n/messages/en.json"
import { source } from "./contract-source"

vi.mock("@/lib/api", () => ({
  getUiPreferences: vi.fn(async () => null),
  updateUiPreferences: vi.fn(async (p: unknown) => p),
}))
vi.mock("@/lib/platform", () => ({
  subscribe: vi.fn(async () => () => {}),
  onTransportReconnect: vi.fn(() => null),
}))

const conversation: DbConversationSummary = {
  id: 1,
  folder_id: 1,
  title: "检查文字粗细差异",
  title_locked: false,
  agent_type: "codex",
  status: "pending",
  kind: "regular",
  model: null,
  git_branch: null,
  external_id: null,
  message_count: 0,
  child_count: 0,
  created_at: "2026-09-09T00:00:00Z",
  updated_at: "2026-09-09T00:00:00Z",
  pinned_at: null,
}

describe("sidebar title ink", () => {
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    "keeps the reference desktop weight and gray labels when selected=%s and open=%s",
    (isSelected, isOpenInTab) => {
      const { getByText } = render(
        <NextIntlClientProvider locale="en" messages={en}>
          <SidebarConversationCard
            conversation={conversation}
            isSelected={isSelected}
            isOpenInTab={isOpenInTab}
            timeLabel="1h"
            onSelect={vi.fn()}
            onDoubleClick={vi.fn()}
            onRename={vi.fn(async () => {})}
            onDelete={vi.fn(async () => {})}
            onStatusChange={vi.fn(async () => {})}
          />
        </NextIntlClientProvider>
      )
      const title = getByText(conversation.title!)
      expect(title).toHaveClass("maxcode-sidebar-label", "font-[430]")
      expect(title).not.toHaveClass(
        "text-primary",
        "font-medium",
        "font-normal"
      )
    }
  )
  it("uses the measured reference color and retains a dark-mode override", () => {
    const css = source("src/app/globals.css")
    expect(css).toContain(".maxcode-sidebar-label {\n  color: #434447;")
    expect(css).toContain(".dark .maxcode-sidebar-label")
  })
})
