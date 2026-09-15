import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import type { FileWorkspaceTab } from "@/contexts/workspace-context"

const {
  mockOpenInCode,
  mockIsRemoteDesktopWindow,
  mockToastError,
  fileTabsState,
} = vi.hoisted(() => ({
  mockOpenInCode: vi.fn(async (..._args: unknown[]) => {}),
  mockIsRemoteDesktopWindow: vi.fn(() => false),
  mockToastError: vi.fn(),
  fileTabsState: {
    tabs: [] as FileWorkspaceTab[],
  },
}))

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}))

vi.mock("@/lib/api", () => ({
  openInCode: (...args: unknown[]) => mockOpenInCode(...args),
}))

vi.mock("@/lib/platform", () => ({
  isRemoteDesktopWindow: () => mockIsRemoteDesktopWindow(),
}))

vi.mock("@/hooks/use-is-coarse-pointer", () => ({
  useIsCoarsePointer: () => false,
}))

vi.mock("@/hooks/use-long-press-drag", () => ({
  useLongPressDrag: () => ({
    dragControls: undefined,
    gestureHandlers: {},
  }),
}))

vi.mock("motion/react", () => {
  function Passthrough({
    children,
    className,
    role,
    ...rest
  }: {
    children?: ReactNode
    className?: string
    role?: string
    [key: string]: unknown
  }) {
    const dataAttrs: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(rest)) {
      if (key.startsWith("data-") || key.startsWith("aria-")) {
        dataAttrs[key] = value
      }
    }
    return (
      <div className={className} role={role} {...dataAttrs}>
        {children}
      </div>
    )
  }
  return { Reorder: { Group: Passthrough, Item: Passthrough } }
})

vi.mock("@/contexts/workspace-context", () => ({
  useWorkspaceView: () => ({ mode: "fusion", filesMaximized: false }),
  useWorkspaceFileTabs: () => ({
    fileTabs: fileTabsState.tabs,
    activeFileTabId: fileTabsState.tabs[0]?.id ?? null,
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

import { FileWorkspaceTabBar } from "./file-workspace-tab-bar"

function fileTab(overrides: Partial<FileWorkspaceTab> = {}): FileWorkspaceTab {
  return {
    id: "file:/repo/AuthService.cs",
    kind: "file",
    folderId: null,
    title: "AuthService.cs",
    description: "/repo/AuthService.cs",
    path: "/repo/AuthService.cs",
    language: "csharp",
    content: "",
    loading: false,
    ...overrides,
  }
}

function openTabMenu() {
  render(<FileWorkspaceTabBar />)
  fireEvent.contextMenu(screen.getByRole("tab"))
}

function menuItem(name: string): HTMLElement {
  return screen.getByRole("menuitem", { name })
}

describe("FileWorkspaceTabBar open in VS Code", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsRemoteDesktopWindow.mockReturnValue(false)
    mockOpenInCode.mockResolvedValue(undefined)
    fileTabsState.tabs = [fileTab()]
  })

  it("opens the file in VS Code from the tab context menu", async () => {
    openTabMenu()
    fireEvent.click(menuItem("openInCode"))
    await waitFor(() => {
      expect(mockOpenInCode).toHaveBeenCalledWith("/repo/AuthService.cs")
    })
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it("toasts when the host cannot open the file", async () => {
    mockOpenInCode.mockRejectedValueOnce(new Error("code missing"))
    openTabMenu()
    fireEvent.click(menuItem("openInCode"))
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("openInCodeFailed", {
        description: "code missing",
      })
    })
  })

  it("disables the action in a remote-desktop window", () => {
    mockIsRemoteDesktopWindow.mockReturnValue(true)
    openTabMenu()
    expect(menuItem("openInCode").getAttribute("data-disabled")).not.toBeNull()
    fireEvent.click(menuItem("openInCode"))
    expect(mockOpenInCode).not.toHaveBeenCalled()
  })

  it("omits the action for tabs without a file path", () => {
    fileTabsState.tabs = [
      fileTab({
        id: "diff:session:/repo/AuthService.cs",
        kind: "diff",
        path: null,
        title: "AuthService.cs",
      }),
    ]
    openTabMenu()
    expect(screen.queryByRole("menuitem", { name: "openInCode" })).toBeNull()
    expect(menuItem("close")).toBeTruthy()
  })
})
