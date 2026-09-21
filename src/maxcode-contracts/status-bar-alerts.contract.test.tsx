import { render, screen, fireEvent } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Alert } from "@/contexts/alert-context"
import { StatusBarAlerts } from "@/components/layout/status-bar-alerts"
import enMessages from "@/i18n/messages/en.json"

let alerts: Alert[] = []
vi.mock("@/contexts/alert-context", () => ({
  useAlertContext: () => ({
    alerts,
    hasAlerts: alerts.length > 0,
    dismissAlert: vi.fn(),
    clearAll: vi.fn(),
  }),
}))
vi.mock("@/contexts/acp-connections-context", () => ({
  useAcpActions: () => ({ connect: vi.fn() }),
}))
vi.mock("@/lib/platform", () => ({ openUrl: vi.fn() }))
vi.mock("@/lib/api", () => ({ openSettingsWindow: vi.fn() }))

function view() {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <StatusBarAlerts />
    </NextIntlClientProvider>
  )
}

describe("status bar alert visibility contract", () => {
  beforeEach(() => {
    alerts = []
  })

  it("renders no icon or button when there are no alerts", () => {
    const { container } = render(view())
    expect(container).toBeEmptyDOMElement()
  })

  it.each(["warning", "error"] as const)(
    "shows %s alerts and hides the entry when the list becomes empty",
    async (level) => {
      const { container, rerender } = render(view())
      alerts = [{ id: "a1", level, message: "Test alert", timestamp: 0 }]
      rerender(view())
      const trigger = screen.getByRole("button")
      expect(trigger.querySelector("svg")).not.toBeNull()
      expect(trigger).toHaveTextContent("1")
      fireEvent.click(trigger)
      expect(await screen.findByText("Test alert")).toBeVisible()

      alerts = []
      rerender(view())
      expect(container).toBeEmptyDOMElement()
      expect(screen.queryByText("Test alert")).not.toBeInTheDocument()
      expect(screen.queryByRole("button")).not.toBeInTheDocument()
    }
  )
})
