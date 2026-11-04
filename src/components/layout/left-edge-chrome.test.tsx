import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { LeftEdgeChrome } from "./left-edge-chrome"
import enMessages from "@/i18n/messages/en.json"

const spies = vi.hoisted(() => ({
  isSidebarOpen: true,
  activeFolder: null as { id: number; path: string } | null,
  toggleSidebar: vi.fn(),
  openConversations: vi.fn(),
  openNewConversationTab: vi.fn(),
  openChatModeTab: vi.fn(),
}))
vi.mock("@/contexts/sidebar-context", () => ({
  useSidebarContext: () => ({
    isOpen: spies.isSidebarOpen,
    toggle: spies.toggleSidebar,
  }),
}))
vi.mock("@/contexts/active-folder-context", () => ({
  useActiveFolder: () => ({ activeFolder: spies.activeFolder }),
}))
vi.mock("@/contexts/tab-context", () => ({ useTabActions: () => spies }))
vi.mock("@/contexts/workbench-route-context", () => ({
  useWorkbenchRoute: () => spies,
}))
vi.mock("@/hooks/use-appearance", () => ({
  useZoomLevel: () => ({ zoomLevel: 100 }),
}))
vi.mock("@/hooks/use-is-mac", () => ({ useIsMac: () => false }))
vi.mock("@/hooks/use-platform", () => ({
  usePlatform: () => ({ isMac: false }),
}))
vi.mock("@/hooks/use-shortcut-settings", () => ({
  useShortcutSettings: () => ({ shortcuts: { toggle_sidebar: "mod+b" } }),
}))
vi.mock("@/lib/platform", () => ({ isNativeDesktop: () => true }))

function renderChrome() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <LeftEdgeChrome />
    </NextIntlClientProvider>
  )
}

describe("LeftEdgeChrome", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    spies.isSidebarOpen = true
    spies.activeFolder = null
  })
  it("opens a chat from the persistent compose button without an active project", () => {
    renderChrome()
    fireEvent.click(screen.getByRole("button", { name: "New Conversation" }))
    expect(spies.openConversations).toHaveBeenCalledOnce()
    expect(spies.openChatModeTab).toHaveBeenCalledOnce()
    expect(spies.openNewConversationTab).not.toHaveBeenCalled()
  })
  it("opens a new conversation in the active project", () => {
    spies.activeFolder = { id: 7, path: "/project" }
    renderChrome()
    fireEvent.click(screen.getByRole("button", { name: "New Conversation" }))
    expect(spies.openConversations).toHaveBeenCalledOnce()
    expect(spies.openNewConversationTab).toHaveBeenCalledWith(7, "/project")
    expect(spies.openChatModeTab).not.toHaveBeenCalled()
  })
  it("keeps only compose when the sidebar is open", () => {
    renderChrome()
    expect(screen.getAllByRole("button")).toHaveLength(1)
    expect(screen.queryByRole("button", { name: "Search" })).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Open remote workspace" })
    ).toBeNull()
  })
  it("shows a sidebar toggle and its shortcut when the sidebar is collapsed", () => {
    spies.isSidebarOpen = false
    renderChrome()
    const toggle = screen.getByRole("button", { name: "Show Sidebar" })
    expect(toggle).toHaveAttribute("title", "Show Sidebar (Ctrl+B)")
    fireEvent.click(toggle)
    expect(spies.toggleSidebar).toHaveBeenCalledOnce()
    expect(screen.getAllByRole("button")).toHaveLength(2)
  })
})
