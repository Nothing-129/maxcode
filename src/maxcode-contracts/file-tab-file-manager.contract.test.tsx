import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { FileWorkspaceTab } from "@/contexts/workspace-context"
import messages from "@/i18n/messages/zh-CN.json"

const { state, reveal, toastError } = vi.hoisted(() => ({
  state: { desktop: true, tabs: [] as FileWorkspaceTab[] },
  reveal: vi.fn<(...args: unknown[]) => Promise<void>>(),
  toastError: vi.fn(),
}))

vi.mock("@/lib/platform", () => ({
  isLocalDesktop: () => state.desktop,
  revealItemInDir: (...args: unknown[]) => reveal(...args),
}))
vi.mock("@/lib/api", () => ({ openInCode: vi.fn() }))
vi.mock("sonner", () => ({ toast: { error: toastError } }))
vi.mock("@/hooks/use-is-coarse-pointer", () => ({
  useIsCoarsePointer: () => false,
}))
vi.mock("@/hooks/use-long-press-drag", () => ({
  useLongPressDrag: () => ({ dragControls: undefined, gestureHandlers: {} }),
}))
vi.mock("motion/react", () => {
  function Item({ children }: { children?: ReactNode }) {
    return <div>{children}</div>
  }
  return { Reorder: { Group: Item, Item } }
})
vi.mock("@/contexts/workspace-context", () => ({
  useWorkspaceView: () => ({ mode: "fusion", filesMaximized: false }),
  useWorkspaceFileTabs: () => ({
    fileTabs: state.tabs,
    activeFileTabId: state.tabs[0]?.id ?? null,
  }),
  useWorkspaceActions: () => ({
    switchFileTab: vi.fn(),
    closeFileTab: vi.fn(),
    closeOtherFileTabs: vi.fn(),
    closeAllFileTabs: vi.fn(),
    reorderFileTabs: vi.fn(),
    toggleFilesMaximized: vi.fn(),
  }),
}))

import { FileWorkspaceTabBar } from "@/components/files/file-workspace-tab-bar"

const documentPath = "/repo/操作指南/百度推广应用配置操作指南.docx"
const finderLabel = "在访达中打开"

function wordTab(path: string | null = documentPath): FileWorkspaceTab {
  return {
    id: `file:${path}`,
    kind: "file",
    folderId: null,
    title: path?.split("/").pop() ?? "No path",
    description: path,
    path,
    language: "plaintext",
    content: "",
    loading: false,
  }
}

function openMenu(index = 0) {
  render(
    <NextIntlClientProvider locale="zh-CN" messages={messages}>
      <FileWorkspaceTabBar />
    </NextIntlClientProvider>
  )
  fireEvent.contextMenu(screen.getAllByRole("tab")[index])
}

beforeEach(() => {
  vi.clearAllMocks()
  reveal.mockResolvedValue(undefined)
  state.desktop = true
  state.tabs = [wordTab()]
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel")
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("MaxCode")
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("MaxCode contract: file tab menu reveals the selected file", () => {
  it("reveals the Word file itself, preserving Chinese characters and spaces", async () => {
    state.tabs = [wordTab("/repo/操作 指南/百度推广应用配置操作指南.docx")]
    openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: finderLabel }))
    await waitFor(() => expect(reveal).toHaveBeenCalledOnce())
    expect(reveal).toHaveBeenCalledWith(state.tabs[0].path)
    expect(toastError).not.toHaveBeenCalled()
  })

  it("uses the tab whose menu was opened even when another tab is active", async () => {
    state.tabs = [wordTab("/repo/other.docx"), wordTab()]
    openMenu(1)
    fireEvent.click(screen.getByRole("menuitem", { name: finderLabel }))
    await waitFor(() => expect(reveal).toHaveBeenCalledOnce())
    expect(reveal).toHaveBeenCalledWith(documentPath)
  })

  it.each([
    ["Win32", "在资源管理器中打开"],
    ["Linux x86_64", "在文件管理器中打开"],
  ])("uses the file manager label for %s", (platform, label) => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue(platform)
    openMenu()
    expect(screen.getByRole("menuitem", { name: label })).toBeTruthy()
    expect(screen.queryByRole("menuitem", { name: finderLabel })).toBeNull()
  })

  it("hides the native operation in browser mode", () => {
    state.desktop = false
    openMenu()
    expect(screen.queryByRole("menuitem", { name: finderLabel })).toBeNull()
    expect(screen.getByRole("menuitem", { name: "关闭" })).toBeTruthy()
    expect(reveal).not.toHaveBeenCalled()
  })

  it("hides the action for a diff tab without a path", () => {
    state.tabs = [{ ...wordTab(null), kind: "diff" }]
    openMenu()
    expect(screen.queryByRole("menuitem", { name: finderLabel })).toBeNull()
    expect(reveal).not.toHaveBeenCalled()
  })

  it("reports native reveal failures", async () => {
    reveal.mockRejectedValueOnce(new Error("File missing"))
    openMenu()
    fireEvent.click(screen.getByRole("menuitem", { name: finderLabel }))
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("无法在文件管理器中打开", {
        description: "File missing",
      })
    )
  })
})
