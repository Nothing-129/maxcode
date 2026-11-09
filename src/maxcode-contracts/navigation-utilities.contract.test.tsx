import { act, fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import en from "@/i18n/messages/en.json"
import { WorkspaceNavigationRail } from "@/components/layout/workspace-navigation-rail"
import { SettingsAbout } from "@/components/settings/settings-about"
import { SidebarNavigationProvider } from "@/contexts/sidebar-navigation-context"
import {
  WorkbenchRouteProvider,
  useWorkbenchRoute,
} from "@/contexts/workbench-route-context"
import { source } from "./contract-source"

const actions = vi.hoisted(() => ({
  settings: vi.fn().mockResolvedValue(undefined),
  close: vi.fn(),
  update: vi.fn(),
  restart: vi.fn().mockResolvedValue(undefined),
  check: vi.fn().mockResolvedValue(undefined),
  status: "ready_to_restart",
  available: true,
}))
vi.mock("@/lib/api", () => ({ openSettingsWindow: actions.settings }))
vi.mock("@/contexts/sidebar-context", () => ({
  useSidebarContext: () => ({
    isOpen: true,
    toggle: vi.fn(),
    close: actions.close,
  }),
}))
vi.mock("@/contexts/automations-view-context", () => ({
  useAutomationsView: () => ({ unseenFailures: 0 }),
}))
vi.mock("@/components/layout/sidebar-codex-quota", () => ({
  SidebarCodexQuota: ({ compact }: { compact?: boolean }) => (
    <button>{compact ? "Quota icon" : "Quota summary"}</button>
  ),
}))
vi.mock("@/components/layout/status-bar-alerts", () => ({
  StatusBarAlerts: ({ compact }: { compact?: boolean }) => (
    <button data-alerts-compact={compact}>Alerts</button>
  ),
}))
vi.mock("@/components/providers/update-provider", () => ({
  useAppUpdate: () => ({
    restart: actions.restart,
    checkNow: actions.check,
    currentVersion: "0.30.55",
    available: actions.available ? { version: "1.0" } : null,
    state: { status: actions.status },
    isUpdating: actions.status === "downloading",
    isBusy: actions.status === "downloading",
  }),
}))
vi.mock("@/components/layout/status-bar-update", () => ({
  StatusBarUpdate: () => <button onClick={actions.update}>0.30.55</button>,
}))
function Route() {
  return <output data-testid="route">{useWorkbenchRoute().routeId}</output>
}

describe("navigation utilities", () => {
  it("restarts a prepared update directly from the version icon above Settings", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <WorkbenchRouteProvider>
          <SidebarNavigationProvider>
            <WorkspaceNavigationRail />
            <Route />
          </SidebarNavigationProvider>
        </WorkbenchRouteProvider>
      </NextIntlClientProvider>
    )
    const stats = screen.getByRole("button", { name: "Statistics" })
    expect(stats.closest("[data-navigation-utilities]")).toBeTruthy()
    fireEvent.click(stats)
    expect(screen.getByTestId("route")).toHaveTextContent("tokenUsage")
    expect(stats).toHaveAttribute("aria-current", "page")
    expect(stats).not.toHaveClass("bg-sidebar-accent")
    expect(stats).toHaveClass("bg-sidebar-foreground/[0.06]")
    expect(stats.querySelector("[data-navigation-active]")).toBeNull()
    const quota = screen.getByRole("button", { name: "Quota icon" })
    expect(
      quota.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.queryByText("0.30.55")).toBeNull()
    const about = screen.getByRole("button", { name: "Restart to update" })
    const settings = screen.getByRole("button", { name: "Settings" })
    expect(
      about.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(about).toHaveAttribute("title", "Restart to update · 0.30.55 · 1.0")
    expect(about.querySelector("[data-version-update]")).toBeTruthy()
    expect(settings.querySelector("[data-version-update]")).toBeNull()
    await act(async () => {
      fireEvent.click(about)
    })
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(actions.restart).toHaveBeenCalledOnce()
    expect(actions.check).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Settings" }))
    expect(actions.settings).toHaveBeenCalledOnce()
    expect(settings).toHaveAttribute("title", "Settings · 0.30.55")
    const alerts = screen.getByRole("button", { name: "Alerts" })
    expect(alerts).toHaveAttribute("data-alerts-compact", "true")
    expect(
      settings.compareDocumentPosition(alerts) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(actions.update).not.toHaveBeenCalled()
  })
  it("keeps mobile list navigation in the drawer and closes it for full-page destinations", () => {
    actions.close.mockClear()
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <WorkbenchRouteProvider>
          <SidebarNavigationProvider>
            <WorkspaceNavigationRail mobile />
            <Route />
          </SidebarNavigationProvider>
        </WorkbenchRouteProvider>
      </NextIntlClientProvider>
    )
    fireEvent.click(screen.getByRole("button", { name: "Chats" }))
    fireEvent.click(screen.getByRole("button", { name: "Projects" }))
    fireEvent.click(screen.getByRole("button", { name: "Tasks" }))
    expect(actions.close).not.toHaveBeenCalled()
    expect(screen.getByTestId("route")).toHaveTextContent("tasks")
    fireEvent.click(screen.getByRole("button", { name: "Auto" }))
    expect(actions.close).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId("route")).toHaveTextContent("automations")
    fireEvent.click(screen.getByRole("button", { name: "Statistics" }))
    expect(actions.close).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId("route")).toHaveTextContent("tokenUsage")
    expect(document.querySelector("[data-mobile-navigation]")).toBeTruthy()
  })

  it("mounts the function rail and a bounded list in the mobile drawer under the shared navigation provider", () => {
    const layout = source("src/app/workspace/layout.tsx")
    const mobile = layout
      .split("function MobileFolderWorkspaceShell")[1]
      .split("function FolderWorkspaceShell")[0]
    expect(mobile).toContain("data-mobile-function-drawer")
    expect(mobile).toContain("<WorkspaceNavigationRail mobile />")
    expect(mobile).toContain('className="min-w-0 flex-1 overflow-hidden"')
    expect(layout).toMatch(/<SidebarNavigationProvider>\s*\{isMobile \? \(/)
    expect(source("src/components/layout/sidebar.tsx")).toContain(
      "{isMobile && !navigation && <SidebarFooter />}"
    )
  })

  it("hides the version icon when up to date", () => {
    actions.status = "idle"
    actions.available = false
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SettingsAbout compact />
      </NextIntlClientProvider>
    )
    expect(container).toBeEmptyDOMElement()
    actions.available = true
    actions.status = "ready_to_restart"
  })

  it("checks again without restarting before the update package is ready", async () => {
    actions.status = "idle"
    actions.restart.mockClear()
    actions.check.mockClear()
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SettingsAbout compact />
      </NextIntlClientProvider>
    )
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check for updates" }))
    })
    expect(actions.check).toHaveBeenCalledWith({ silent: false })
    expect(actions.restart).not.toHaveBeenCalled()
    actions.status = "ready_to_restart"
  })

  it("disables the version action during background downloading", () => {
    actions.status = "downloading"
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SettingsAbout compact />
      </NextIntlClientProvider>
    )
    expect(
      screen.getByRole("button", { name: "Downloading..." })
    ).toBeDisabled()
    actions.status = "ready_to_restart"
  })

  it("exposes the existing version/update action inside About", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SettingsAbout />
      </NextIntlClientProvider>
    )
    expect(screen.queryByText("0.30.55")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "About MaxCode" }))
    fireEvent.click(screen.getByRole("button", { name: "0.30.55" }))
    expect(actions.update).toHaveBeenCalledOnce()
  })
  it("gives Statistics the whole content area without conversation chrome or rewriting sidebar preferences", () => {
    const layout = source("src/app/workspace/layout.tsx")
    expect(layout).toMatch(
      /sidebarOpenRequested\s*&&\s*routeId !== "automations"\s*&&\s*routeId !== "tokenUsage"/
    )
    expect(source("src/components/layout/left-edge-chrome.tsx")).toContain(
      'if (routeId === "automations" || routeId === "tokenUsage") return null'
    )
  })

  it("removes the desktop list footer, retains it on mobile and mounts About in settings", () => {
    expect(source("src/components/layout/sidebar.tsx")).toContain(
      "{isMobile && !navigation && <SidebarFooter />}"
    )
    expect(source("src/components/settings/settings-shell.tsx")).toContain(
      "<SettingsAbout />"
    )
  })
})
