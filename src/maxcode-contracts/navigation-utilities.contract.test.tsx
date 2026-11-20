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
  restart: vi.fn().mockResolvedValue(undefined),
  check: vi.fn().mockResolvedValue(undefined),
  status: "ready_to_restart",
  available: true,
  withoutProvider: false,
  checked: false,
  checkError: null as string | null,
  checking: false,
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
vi.mock("@/components/providers/update-provider", async () => {
  const { createContext, useContext } = await import("react")
  const Context = createContext(false)
  return {
    UpdateProvider: ({ children }: { children: import("react").ReactNode }) => (
      <Context.Provider value={true}>{children}</Context.Provider>
    ),
    useAppUpdate: () => {
      const provided = useContext(Context)
      if (actions.withoutProvider && !provided) return null
      return {
        restart: actions.restart,
        checkNow: actions.check,
        currentVersion: "0.30.55",
        restartCountdown: null,
        lastCheckedAt: actions.checked ? new Date() : null,
        checkError: actions.checkError,
        checking: actions.checking,
        available: actions.available ? { version: "1.0" } : null,
        state: { status: actions.status },
        isUpdating: actions.status === "downloading",
        isBusy: actions.status === "downloading",
      }
    },
  }
})
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
    expect(stats).toHaveClass("bg-[#eaeaea]")
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

  it("shows a static version and offers restart directly in settings", async () => {
    actions.restart.mockClear()
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SettingsAbout />
      </NextIntlClientProvider>
    )
    const version = screen.getByText("v1.0 is ready. Restart to apply.")
    expect(version).toBeVisible()
    expect(version.closest("button, a, [tabindex]")).toBeNull()
    fireEvent.click(version)
    expect(screen.queryByRole("dialog")).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restart to update" }))
    })
    expect(actions.restart).toHaveBeenCalledOnce()
  })
  it("shows the current version and check action in a single plain row", () => {
    actions.status = "idle"
    actions.available = false
    try {
      render(
        <NextIntlClientProvider locale="en" messages={en}>
          <SettingsAbout />
        </NextIntlClientProvider>
      )
      const version = screen.getByText("Current version v0.30.55")
      const check = screen.getByRole("button", { name: "Check for updates" })
      expect(version.parentElement).toBe(check.parentElement)
      expect(check.querySelector("svg")).toBeNull()
      expect(screen.queryByRole("img", { name: "MaxCode" })).toBeNull()
    } finally {
      actions.status = "ready_to_restart"
      actions.available = true
    }
  })

  it("checks for updates directly from the footer", async () => {
    actions.check.mockClear()
    actions.status = "idle"
    actions.available = false
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SettingsAbout />
      </NextIntlClientProvider>
    )
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check for updates" }))
    })
    expect(actions.check).toHaveBeenCalledWith({ silent: false })
    expect(screen.queryByRole("dialog")).toBeNull()
    actions.status = "ready_to_restart"
    actions.available = true
  })

  it("initializes updates on a standalone settings page", () => {
    actions.withoutProvider = true
    try {
      render(
        <NextIntlClientProvider locale="en" messages={en}>
          <SettingsAbout />
        </NextIntlClientProvider>
      )
      expect(screen.getByText("v1.0 is ready. Restart to apply.")).toBeVisible()
      expect(
        screen.getByRole("button", { name: "Restart to update" })
      ).toBeEnabled()
    } finally {
      actions.withoutProvider = false
    }
  })

  it.each([
    {
      checked: false,
      error: null,
      checking: false,
      expected: "Current version",
    },
    {
      checked: true,
      error: null,
      checking: false,
      expected: "You're on the latest version",
    },
    {
      checked: true,
      error: "Offline",
      checking: false,
      expected: "Failed to check for updates: Offline",
    },
    { checked: true, error: null, checking: true, expected: "Checking..." },
  ])(
    "shows honest update status: $expected",
    ({ checked, error, checking, expected }) => {
      actions.status = "idle"
      actions.available = false
      actions.checked = checked
      actions.checkError = error
      actions.checking = checking
      try {
        render(
          <NextIntlClientProvider locale="en" messages={en}>
            <SettingsAbout />
          </NextIntlClientProvider>
        )
        if (!checking && !error) {
          expect(screen.getByText("Current version v0.30.55")).toBeVisible()
          expect(screen.queryByText("You're on the latest version")).toBeNull()
          expect(screen.queryByRole("dialog")).toBeNull()
        } else if (checking) {
          expect(screen.getByRole("button", { name: expected })).toBeDisabled()
        } else {
          expect(screen.getByRole("status")).toHaveTextContent(expected)
        }
      } finally {
        actions.status = "ready_to_restart"
        actions.available = true
        actions.checked = false
        actions.checkError = null
        actions.checking = false
      }
    }
  )

  it.each([
    ["idle", "New version v1.0 found"],
    ["downloading", "New version v1.0 found"],
    ["installing", "New version v1.0 found"],
    ["ready_to_restart", "v1.0 is ready. Restart to apply."],
    ["error", "Update failed"],
  ])("keeps actionable %s feedback visible in the footer", (status, text) => {
    actions.status = status
    try {
      render(
        <NextIntlClientProvider locale="en" messages={en}>
          <SettingsAbout />
        </NextIntlClientProvider>
      )
      const notice = screen.getByRole("status")
      expect(notice).toHaveTextContent(text)
      if (status === "downloading") {
        expect(notice.parentElement).toContainElement(
          screen.getByText("Downloading")
        )
        expect(screen.queryByRole("button")).toBeNull()
      }
    } finally {
      actions.status = "ready_to_restart"
    }
  })

  it("gives Statistics the whole content area without conversation chrome or rewriting sidebar preferences", () => {
    const layout = source("src/app/workspace/layout.tsx")
    expect(layout).toMatch(
      /routeId === "automations"\s*\|\|\s*\(sidebarOpenRequested && routeId !== "tokenUsage"\)/
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
  it("uses neutral settings selection surfaces instead of the blue secondary palette", () => {
    expect(source("src/components/settings/settings-shell.tsx")).toContain(
      '"bg-foreground/[0.075] font-medium text-foreground hover:bg-foreground/10"'
    )
  })
})
