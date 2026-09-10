import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  consumeAskSelectionPrompts,
  resetAskSelectionPromptsForTests,
} from "@/lib/ask-selection-handoff"
import { useNewChatFromMessage } from "@/components/message/use-new-chat-from-message"
import { source } from "./contract-source"

const mocks = vi.hoisted(() => ({
  setRoute: vi.fn(),
  openNewConversationTab: vi.fn(),
  openChatModeTab: vi.fn(),
  folders: [{ id: 7, path: "/project", kind: "regular" }],
}))
vi.mock("@/contexts/workbench-route-context", () => ({
  useWorkbenchRoute: () => ({ setRoute: mocks.setRoute }),
}))
vi.mock("@/stores/app-workspace-store", () => ({
  useAppWorkspaceStore: { getState: () => ({ allFolders: mocks.folders }) },
}))
vi.mock("@/stores/tab-store", () => ({
  groupOfTab: () => "main",
  useTabStore: {
    getState: () => ({
      rawTabs: [
        {
          id: "source",
          folderId: 7,
          agentType: "codex",
          workingDir: "/project/subdir",
        },
      ],
      activeTabId: "source",
      openNewConversationTab: mocks.openNewConversationTab,
      openChatModeTab: mocks.openChatModeTab,
    }),
  },
}))
const identity = { folderId: 7, agentType: "codex" } as const

beforeEach(() => {
  vi.clearAllMocks()
  resetAskSelectionPromptsForTests()
  mocks.folders = [{ id: 7, path: "/project", kind: "regular" }]
  mocks.openNewConversationTab.mockReturnValue({ tabId: "draft", ...identity })
  mocks.openChatModeTab.mockReturnValue({
    tabId: "chat",
    folderId: 0,
    agentType: "codex",
  })
})

describe("MaxCode: message opens an unsent new chat", () => {
  it("carries original multiline text and source context without sending", () => {
    const text = "  有哪些入口？\n<example> **原文**\n"
    const { result } = renderHook(() => useNewChatFromMessage(() => text))
    act(() => result.current())
    expect(mocks.openNewConversationTab).toHaveBeenCalledWith(
      7,
      "/project/subdir",
      { forceAgent: "codex", targetGroup: "main" }
    )
    expect(mocks.setRoute).toHaveBeenCalledWith("conversations")
    expect(consumeAskSelectionPrompts("draft", identity)).toEqual([])
    expect(consumeAskSelectionPrompts("other", identity, "draft")).toEqual([])
    expect(
      consumeAskSelectionPrompts("draft", { ...identity, folderId: 8 }, "draft")
    ).toEqual([])
    expect(consumeAskSelectionPrompts("draft", identity, "draft")).toEqual([
      text,
    ])
    expect(consumeAskSelectionPrompts("draft", identity, "draft")).toEqual([])
  })

  it("opens a folderless chat for chat sources or an unavailable folder", () => {
    mocks.folders = [{ id: 7, path: "/chat", kind: "chat" }]
    const { result } = renderHook(() => useNewChatFromMessage(() => "hello"))
    act(() => result.current())
    expect(mocks.openChatModeTab).toHaveBeenCalledWith({
      forceAgent: "codex",
      targetGroup: "main",
    })
    expect(mocks.openNewConversationTab).not.toHaveBeenCalled()
    expect(
      consumeAskSelectionPrompts("chat", { ...identity, folderId: 0 }, "draft")
    ).toEqual(["hello"])
    mocks.folders = []
    act(() => result.current())
    expect(mocks.openChatModeTab).toHaveBeenCalledTimes(2)
  })

  it("ignores empty messages and an unsuccessful tab open", () => {
    const empty = renderHook(() => useNewChatFromMessage(() => " \n "))
    act(() => empty.result.current())
    expect(mocks.openNewConversationTab).not.toHaveBeenCalled()
    mocks.openNewConversationTab.mockReturnValue(null)
    const failed = renderHook(() => useNewChatFromMessage(() => "hello"))
    act(() => failed.result.current())
    expect(mocks.setRoute).not.toHaveBeenCalled()
    expect(consumeAskSelectionPrompts("draft", identity, "draft")).toEqual([])
  })

  it("both message actions use the new chat entry and append drafts to the composer", () => {
    for (const path of ["message-list-view.tsx", "turn-stats.tsx"]) {
      const content = source(`src/components/message/${path}`)
      expect(content).toContain("useNewChatFromMessage")
      expect(content).toContain('("newChatFromMessage")')
      expect(content).not.toContain("useCreateTaskFromMessage")
    }
    const panel = source(
      "src/components/conversations/conversation-detail-panel.tsx"
    )
    const draftDrain = panel.slice(
      panel.indexOf("      const drafts = consumeAskSelectionPrompts("),
      panel.indexOf("      const prompts = consumeAskSelectionPrompts(")
    )
    expect(draftDrain).toContain('"draft"')
    expect(draftDrain).toContain("setComposerInject")
    expect(draftDrain).toContain('mode: "append"')
    expect(draftDrain).not.toContain("mqEnqueue")
  })
})
