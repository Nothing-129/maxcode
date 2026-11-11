import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { RecentDateFilter } from "@/components/layout/recent-date-filter"
import { SidebarNavigationProvider } from "@/contexts/sidebar-navigation-context"
import en from "@/i18n/messages/en.json"

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 10, 12))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it("shows endpoints only for Custom and keeps the other endpoint when editing a valid range", () => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SidebarNavigationProvider>
        <RecentDateFilter />
      </SidebarNavigationProvider>
    </NextIntlClientProvider>
  )
  fireEvent.click(screen.getByRole("button", { name: "Filter by date" }))
  expect(screen.queryByLabelText("Start date")).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Custom" }))
  expect(screen.getByRole("button", { name: "Custom" })).toHaveAttribute(
    "aria-pressed",
    "true"
  )
  expect(screen.getByLabelText("Start date")).toHaveValue("2026-11-01")
  expect(screen.getByLabelText("End date")).toHaveValue("2026-11-30")
  const originalEnd = (screen.getByLabelText("End date") as HTMLInputElement)
    .value
  fireEvent.change(screen.getByLabelText("Start date"), {
    target: { value: "2026-01-01" },
  })
  expect(screen.getByLabelText("End date")).toHaveValue(originalEnd)
  fireEvent.change(screen.getByLabelText("End date"), {
    target: { value: "2026-01-10" },
  })
  expect(screen.getByLabelText("Start date")).toHaveValue("2026-01-01")
  fireEvent.click(screen.getByRole("button", { name: "Yesterday" }))
  expect(screen.queryByLabelText("Start date")).toBeNull()
  expect(screen.queryByLabelText("End date")).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Custom" }))
  expect(screen.getByLabelText("Start date")).toHaveValue("2026-11-01")
  expect(screen.getByLabelText("End date")).toHaveValue("2026-11-30")
})
