import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import { StatusBarAlerts } from "@/components/layout/status-bar-alerts"
import en from "@/i18n/messages/en.json"

const alerts = vi.hoisted(() => ({
  items: [
    { id: "error", level: "error", message: "Connection failed", timestamp: 0 },
  ],
  clear: vi.fn(),
}))
vi.mock("@/contexts/alert-context", () => ({
  useAlertContext: () => ({
    alerts: alerts.items,
    hasAlerts: alerts.items.length > 0,
    dismissAlert: vi.fn(),
    clearAll: alerts.clear,
  }),
}))
vi.mock("@/contexts/acp-connections-context", () => ({
  useAcpActions: () => ({ connect: vi.fn() }),
}))
vi.mock("@/lib/platform", () => ({ openUrl: vi.fn() }))
vi.mock("@/lib/api", () => ({ openSettingsWindow: vi.fn() }))

describe("rail alert entry", () => {
  it("uses the shared rail dimensions, neutral icon and corner error count while retaining details", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <StatusBarAlerts compact />
      </NextIntlClientProvider>
    )
    const trigger = screen.getByRole("button", { name: "Alerts · 1" })
    expect(trigger).toHaveClass("size-10", "hover:bg-sidebar-foreground/5")
    expect(trigger.querySelector("svg")).toHaveClass("size-[1.125rem]")
    expect(trigger.querySelector("svg")).not.toHaveClass("text-red-500")
    expect(trigger.querySelector("span")).toHaveClass(
      "absolute",
      "text-red-500"
    )
    fireEvent.click(trigger)
    expect(screen.getByRole("dialog")).toHaveTextContent("Connection failed")
  })
  it("hides the entry when there are no errors", () => {
    alerts.items = []
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <StatusBarAlerts compact />
      </NextIntlClientProvider>
    )
    expect(container).toBeEmptyDOMElement()
  })
})
