import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { source } from "./contract-source"

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  reload: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock("@/lib/api", () => ({ refreshConversationTitle: mocks.refresh }))
vi.mock("@/stores/app-workspace-store", () => ({
  useAppWorkspaceStore: (selector: (s: unknown) => unknown) =>
    selector({ refreshConversations: mocks.reload }),
}))
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error },
}))

import { useRefreshConversationTitle } from "@/hooks/use-refresh-conversation-title"

function Action({ id }: { id: number | null }) {
  const { refreshing, refreshTitle, refreshTitleLabel } =
    useRefreshConversationTitle(id)
  return (
    <button
      disabled={id == null || refreshing}
      onClick={() => void refreshTitle()}
    >
      {refreshTitleLabel}
    </button>
  )
}

beforeEach(() => vi.clearAllMocks())

describe("MaxCode contract: manual title refresh", () => {
  it("deduplicates the same conversation across menus and reports success", async () => {
    let finish!: (value: string) => void
    mocks.refresh.mockReturnValue(
      new Promise<string>((resolve) => {
        finish = resolve
      })
    )
    render(
      <>
        <Action id={456} />
        <Action id={456} />
      </>
    )
    fireEvent.click(screen.getAllByRole("button")[0])
    expect(mocks.refresh).toHaveBeenCalledWith(456)
    expect(
      screen
        .getAllByRole("button")
        .every((button) => button.hasAttribute("disabled"))
    ).toBe(true)
    fireEvent.click(screen.getAllByRole("button")[1])
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    await act(async () => finish("0907｜修复｜顶部栏闪烁"))
    expect(mocks.reload).toHaveBeenCalledTimes(1)
    expect(mocks.success).toHaveBeenCalledWith("refreshTitleSuccess")
    expect(
      screen
        .getAllByRole("button")
        .every((button) => !button.hasAttribute("disabled"))
    ).toBe(true)
  })

  it("shows failure without claiming a title changed, then allows retry", async () => {
    mocks.refresh.mockRejectedValueOnce(new Error("model unavailable"))
    render(<Action id={457} />)
    fireEvent.click(screen.getByRole("button"))
    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith("refreshTitleFailed")
    )
    expect(mocks.reload).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
    expect(screen.getByRole("button")).not.toBeDisabled()
    mocks.refresh.mockResolvedValueOnce("0907｜修复｜恢复")
    fireEvent.click(screen.getByRole("button"))
    await waitFor(() => expect(mocks.success).toHaveBeenCalled())
    expect(mocks.refresh).toHaveBeenCalledTimes(2)
  })

  it("does not send a request for an unsaved draft", () => {
    render(<Action id={null} />)
    fireEvent.click(screen.getByRole("button"))
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it("wires saved-model refresh through desktop and web title menus", () => {
    for (const path of [
      "src/components/conversations/sidebar-conversation-card.tsx",
      "src/components/conversations/conversation-detail-header.tsx",
      "src/components/tabs/tab-item.tsx",
    ]) {
      expect(source(path)).toContain("useRefreshConversationTitle(")
      expect(source(path)).toContain("void refreshTitle()")
    }
    expect(source("src/lib/api.ts")).toContain(
      'call("refresh_conversation_title", { conversationId })'
    )
    expect(source("src-tauri/src/lib.rs")).toContain(
      "conversations::refresh_conversation_title,"
    )
    expect(source("src-tauri/src/web/router.rs")).toContain(
      '"/refresh_conversation_title"'
    )
    const backend = source("src-tauri/src/commands/conversations.rs")
    expect(backend).toContain("generate_manual_title")
    expect(backend).toContain("commit_manual_refreshed_title")
    expect(source("src-tauri/src/session_title_tests.rs")).toContain(
      "manual_refresh_replaces_locked_title_without_unlocking_or_changing_settings"
    )
    for (const locale of [
      "en",
      "zh-CN",
      "zh-TW",
      "ja",
      "ko",
      "es",
      "de",
      "fr",
      "pt",
      "ar",
    ]) {
      const card = JSON.parse(source(`src/i18n/messages/${locale}.json`)).Folder
        .conversationCard
      for (const key of [
        "refreshTitle",
        "refreshingTitle",
        "refreshTitleSuccess",
        "refreshTitleFailed",
      ])
        expect(card[key]).toBeTruthy()
    }
  })
})
