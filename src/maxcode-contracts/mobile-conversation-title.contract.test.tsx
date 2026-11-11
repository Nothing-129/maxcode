import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SidebarConversationCard } from "@/components/conversations/sidebar-conversation-card"
import type { DbConversationSummary } from "@/lib/types"
import messages from "@/i18n/messages/en.json"

vi.mock("@/components/agent-icon", () => ({ AgentIcon: () => null }))
vi.mock(
  "@/components/conversations/sidebar-conversation-hover-details",
  () => ({
    SidebarConversationHoverDetails: () => null,
  })
)

afterEach(cleanup)

const conversation: DbConversationSummary = {
  id: 42,
  folder_id: 1,
  title: "1110｜开发｜手机端底部菜单栏布局优化与调整方案",
  title_locked: false,
  agent_type: "codex",
  status: "in_progress",
  kind: "regular",
  model: null,
  git_branch: null,
  external_id: null,
  message_count: 0,
  child_count: 0,
  created_at: "2026-11-10T00:00:00Z",
  updated_at: "2026-11-10T00:00:00Z",
  pinned_at: null,
}

function showCard(
  mobile: boolean,
  title = conversation.title,
  folderLabel: string | undefined = "maxcode"
) {
  const select = vi.fn()
  const result = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SidebarConversationCard
        conversation={{ ...conversation, title }}
        isMobile={mobile}
        isSelected={false}
        timeLabel="3h"
        folderLabel={folderLabel}
        showFolderIcon
        onSelect={select}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onStatusChange={vi.fn()}
      />
    </NextIntlClientProvider>
  )
  return { ...result, select }
}

describe("mobile conversation list layout", () => {
  it("places date, folder and time below a single-line title while retaining status and selection", () => {
    const { container, select } = showCard(true)
    const title = screen.getByText("手机端底部菜单栏布局优化与调整方案")
    expect(title).toHaveClass("truncate")
    const metadata = container.querySelector<HTMLElement>(
      "[data-mobile-conversation-meta]"
    )!
    expect(within(metadata).getByText("1110")).toBeInTheDocument()
    expect(within(metadata).getByText("maxcode")).toBeInTheDocument()
    expect(within(metadata).getByText("3h")).toBeInTheDocument()
    expect(metadata).toHaveClass("grid", "grid-cols-[4ch_minmax(0,1fr)_auto]")
    expect(metadata.children).toHaveLength(3)
    expect(metadata.children[0]).toHaveTextContent("1110")
    expect(metadata.children[1]).toHaveTextContent("maxcode")
    expect(metadata.children[2]).toHaveTextContent("3h")
    expect(metadata.children[2]).toHaveClass("text-right")
    expect(metadata.querySelector("svg")).toBeNull()
    expect(within(metadata).getByText("maxcode")).toHaveAttribute(
      "title",
      "maxcode"
    )
    expect(
      container.querySelector("[data-running-spinner]")
    ).toBeInTheDocument()
    fireEvent.click(title)
    expect(select).toHaveBeenCalledWith(42, "codex", 1)
    expect(
      screen.getByRole("button", { name: "More actions" })
    ).toBeInTheDocument()
  })

  it("keeps unstructured titles and metadata readable without a date", () => {
    const { container } = showCard(true, "普通会话标题")
    expect(screen.getByText("普通会话标题")).toHaveClass("truncate")
    const metadata = container.querySelector("[data-mobile-conversation-meta]")!
    expect(metadata).toHaveTextContent("maxcode")
    expect(metadata).toHaveTextContent("3h")
    expect(metadata).not.toHaveTextContent("1110")
    expect(metadata.children).toHaveLength(3)
    expect(metadata.children[0]).toBeEmptyDOMElement()
    expect(metadata.children[1]).toHaveTextContent("maxcode")
    expect(metadata.children[2]).toHaveTextContent("3h")
  })

  it("keeps the folder column empty when a folder is unavailable", () => {
    const { container } = showCard(true, conversation.title, "")
    const metadata = container.querySelector("[data-mobile-conversation-meta]")!
    expect(metadata.children).toHaveLength(3)
    expect(metadata.children[0]).toHaveTextContent("1110")
    expect(metadata.children[1]).toBeEmptyDOMElement()
    expect(metadata.children[2]).toHaveTextContent("3h")
  })

  it("retains the compact single-line desktop layout", () => {
    const { container } = showCard(false)
    expect(
      container.querySelector("[data-mobile-conversation-meta]")
    ).toBeNull()
    expect(screen.getByText("1110")).toHaveClass("w-[4ch]")
    expect(screen.getByText("手机端底部菜单栏布局优化与调整方案")).toHaveClass(
      "truncate"
    )
    expect(container.querySelector("[data-conv-key]")).toHaveClass(
      "h-[1.9375rem]"
    )
  })
})
