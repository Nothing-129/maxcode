import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { RecentDateFilter } from "@/components/layout/recent-date-filter"
import { SidebarNavigationProvider } from "@/contexts/sidebar-navigation-context"
import {
  DATE_FILTER_STORAGE_KEY,
  loadDateFilter,
} from "@/lib/sidebar-navigation"
import zh from "@/i18n/messages/zh-CN.json"
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
  const popover = screen.getByRole("dialog", { name: "Filter by date" })
  expect(popover).toHaveClass("w-56")
  expect(screen.queryByLabelText("Start date")).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Custom" }))
  expect(popover).toHaveClass("w-56")
  expect(screen.getByText("Start")).toBeVisible()
  expect(screen.getByText("End")).toBeVisible()
  for (const side of ["Start", "End"]) {
    const row = screen.getByRole("group", { name: side })
    expect(row).toContainElement(screen.getByLabelText(`${side} date`))
    expect(row).toContainElement(screen.getByLabelText(`${side} time`))
  }
  expect(screen.queryByText("Start time")).toBeNull()
  expect(screen.queryByText("End time")).toBeNull()
  expect(screen.getByRole("button", { name: "Custom" })).toHaveAttribute(
    "aria-pressed",
    "true"
  )
  expect(
    screen
      .getByRole("button", { name: "Custom" })
      .querySelector(".lucide-check")
  ).toBeTruthy()
  expect(screen.getByLabelText("Start date")).toHaveTextContent(/^Nov 1$/)
  expect(screen.getByLabelText("End date")).toHaveTextContent(/^Nov 30$/)
  fireEvent.click(screen.getByLabelText("Start date"))
  fireEvent.change(screen.getByRole("textbox", { name: /Enter date/ }), {
    target: { value: "2026-01-01" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Apply" }))
  expect(screen.getByLabelText("End date")).toHaveTextContent(/^Nov 30$/)
  fireEvent.click(screen.getByLabelText("End date"))
  const field = screen.getByRole("textbox", { name: /Enter date/ })
  fireEvent.change(field, { target: { value: "2026-02-30" } })
  expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled()
  fireEvent.change(field, { target: { value: "2025-12-31" } })
  expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled()
  fireEvent.change(field, {
    target: { value: "2026-01-10" },
  })
  fireEvent.keyDown(field, { key: "Enter" })
  expect(screen.getByLabelText("Start date")).toHaveTextContent(/^Jan 1$/)
  expect(screen.getByLabelText("End date")).toHaveTextContent(/^Jan 10$/)
  fireEvent.click(screen.getByRole("button", { name: "Yesterday" }))
  expect(screen.queryByLabelText("Start date")).toBeNull()
  expect(screen.queryByLabelText("End date")).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Custom" }))
  expect(screen.getByLabelText("Start date")).toHaveTextContent(/^Nov 1$/)
  expect(screen.getByLabelText("End date")).toHaveTextContent(/^Nov 30$/)
})

it("restores date-only ranges as full days and saves edits as inclusive whole minutes", () => {
  localStorage.setItem(
    DATE_FILTER_STORAGE_KEY,
    JSON.stringify({
      preset: "custom",
      start: "2026-11-01",
      end: "2026-11-10",
      range: true,
    })
  )
  const mount = () => {
    const view = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SidebarNavigationProvider>
          <RecentDateFilter />
        </SidebarNavigationProvider>
      </NextIntlClientProvider>
    )
    fireEvent.click(screen.getByRole("button", { name: "Filter by date" }))
    return view
  }
  const time = (label: string) => screen.getByRole("button", { name: label })
  const setPart = (unit: string, digits: string) => {
    const group = screen.getByRole("radiogroup", { name: unit })
    fireEvent.click(within(group).getByRole("radio", { name: digits }))
  }
  const first = mount()
  expect(time("Start time")).toHaveTextContent(/^00:00$/)
  expect(time("End time")).toHaveTextContent(/^23:59$/)
  fireEvent.click(time("Start time"))
  expect(time("Start time")).toHaveTextContent(/^00:00$/)
  setPart("hour", "21")
  setPart("minute", "15")
  expect(screen.queryByRole("radiogroup", { name: "second" })).toBeNull()
  expect(time("Start time")).toHaveTextContent(/^21:15$/)
  fireEvent.keyDown(screen.getByRole("dialog", { name: "Start time" }), {
    key: "Escape",
  })
  fireEvent.click(time("End time"))
  expect(time("End time")).toHaveTextContent(/^23:59$/)
  setPart("hour", "08")
  setPart("minute", "00")
  expect(
    JSON.parse(localStorage.getItem(DATE_FILTER_STORAGE_KEY)!)
  ).toMatchObject({ startTime: "21:15:00", endTime: "08:00:59" })
  first.unmount()
  mount()
  expect(time("Start time")).toHaveTextContent(/^21:15$/)
  expect(time("End time")).toHaveTextContent(/^08:00$/)
  fireEvent.click(time("End time"))
  expect(time("End time")).toHaveTextContent(/^08:00$/)
  expect(
    within(screen.getByRole("radiogroup", { name: "minute" })).getByRole(
      "radio",
      { name: "00" }
    )
  ).toBeChecked()
  fireEvent.keyDown(screen.getByRole("dialog", { name: "End time" }), {
    key: "Escape",
  })
  fireEvent.click(screen.getByRole("button", { name: "Today" }))
  expect(screen.queryByLabelText("Start time")).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Custom" }))
  expect(time("Start time")).toHaveTextContent(/^00:00$/)
  expect(time("End time")).toHaveTextContent(/^23:59$/)
})

it("uses the entire selected minute for saved ranges with legacy seconds", () => {
  localStorage.setItem(
    DATE_FILTER_STORAGE_KEY,
    JSON.stringify({
      preset: "custom",
      start: "2026-11-10",
      end: "2026-11-10",
      range: false,
      startTime: "12:34:17",
      endTime: "12:34:23",
    })
  )
  expect(loadDateFilter()).toMatchObject({
    startTime: "12:34:00",
    endTime: "12:34:59",
  })
})

it.each([
  [{ preset: "today" }, "今日", false],
  [{ preset: "week" }, "本周", true],
  [{ preset: "month" }, "本月", true],
  [{ preset: "last7" }, "最近7天", true],
  [
    {
      preset: "custom",
      start: "2026-11-12",
      end: "2026-11-18",
      range: true,
      startTime: "09:30:00",
      endTime: "14:30:00",
    },
    "11月12日–18日",
    true,
  ],
  [
    { preset: "custom", start: "2026-11-10", end: "2026-11-10", range: false },
    "11月10日",
    true,
  ],
] as const)(
  "shows the compact Chinese header for %j",
  (filter, label, active) => {
    localStorage.setItem(DATE_FILTER_STORAGE_KEY, JSON.stringify(filter))
    render(
      <NextIntlClientProvider locale="zh-CN" messages={zh}>
        <SidebarNavigationProvider>
          <RecentDateFilter />
        </SidebarNavigationProvider>
      </NextIntlClientProvider>
    )
    const trigger = screen.getByRole("button", { name: "按日期筛选" })
    expect(trigger.textContent).toBe(label)
    expect(trigger).toHaveAttribute("data-filter-active", String(active))
  }
)

it("pairs each shortcut with its resolved range and moves the checkmark on selection", () => {
  render(
    <NextIntlClientProvider locale="zh-CN" messages={zh}>
      <SidebarNavigationProvider>
        <RecentDateFilter />
      </SidebarNavigationProvider>
    </NextIntlClientProvider>
  )
  fireEvent.click(screen.getByRole("button", { name: "按日期筛选" }))
  const today = screen.getByRole("button", { name: "今日" })
  const week = screen.getByRole("button", { name: "本周" })
  expect(today).toHaveAccessibleDescription("11月10日")
  expect(week).toHaveAccessibleDescription("11月9日–10日")
  expect(today.querySelector(".lucide-check")).toBeTruthy()
  fireEvent.click(week)
  expect(today.querySelector(".lucide-check")).toBeNull()
  expect(week.querySelector(".lucide-check")).toBeTruthy()
})
