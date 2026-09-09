import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { SidebarFooter } from "@/components/layout/sidebar-footer"
import { source } from "./contract-source"

const actions = vi.hoisted(() => ({
  stats: vi.fn(),
  alerts: vi.fn(),
  update: vi.fn(),
}))
vi.mock("@/components/layout/quick-actions-dropdown", () => ({
  QuickActionsDropdown: () => <button>Quick actions</button>,
}))
vi.mock("@/components/layout/status-bar-stats", () => ({
  StatusBarStats: () => (
    <button onClick={actions.stats}>490 conversations</button>
  ),
}))
vi.mock("@/components/layout/status-bar-alerts", () => ({
  StatusBarAlerts: () => <button onClick={actions.alerts}>Alerts</button>,
}))
vi.mock("@/components/layout/status-bar-update", () => ({
  StatusBarUpdate: () => <button onClick={actions.update}>v0.30.6</button>,
}))

describe("sidebar utility footer", () => {
  it("retains usage, alerts and updates without the obsolete quick launcher", () => {
    render(<SidebarFooter />)
    expect(
      screen.queryByRole("button", { name: "Quick actions" })
    ).not.toBeInTheDocument()
    expect(
      screen.getAllByRole("button").map((button) => button.textContent)
    ).toEqual(["490 conversations", "v0.30.6", "Alerts"])
    for (const label of ["490 conversations", "Alerts", "v0.30.6"])
      fireEvent.click(screen.getByRole("button", { name: label }))
    for (const action of Object.values(actions))
      expect(action).toHaveBeenCalledOnce()
  })
  it("blends the mobile footer into the drawer without a divider", () => {
    expect(source("src/app/globals.css")).toMatch(
      /\.mobile-sidebar-drawer \[data-sidebar-footer\]\s*\{\s*background-color: transparent;\s*border-top-width: 0;\s*\}/
    )
  })
  it("sits after the scrolling conversation list and cannot shrink away", () => {
    const sidebar = source("src/components/layout/sidebar.tsx")
    expect(sidebar.indexOf("<SidebarFooter />")).toBeGreaterThan(
      sidebar.indexOf("<SidebarConversationList")
    )
    const { container } = render(<SidebarFooter />)
    expect(container.firstChild).toHaveClass(
      "shrink-0",
      "border-t",
      "bg-sidebar"
    )
  })
})
