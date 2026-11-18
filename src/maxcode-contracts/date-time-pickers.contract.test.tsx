import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import { CronBuilderDialog } from "@/components/automations/cron-builder-dialog"
import en from "@/i18n/messages/en.json"
import { source } from "./contract-source"

vi.mock("@/lib/api", () => ({
  automationComputeNextRun: vi.fn().mockResolvedValue(null),
}))

describe("MaxCode date and time pickers", () => {
  it("shares the calendar popover across date fields and the statistics range", () => {
    for (const path of [
      "layout/recent-date-filter",
      "tasks/task-schedule-dialog",
      "todos/todo-editor-dialog",
    ]) {
      expect(source(`src/components/${path}.tsx`)).toContain("<DatePicker")
    }
    expect(
      source("src/components/token-usage/token-usage-filters.tsx")
    ).toContain("<CalendarPopoverContent")
  })

  it("shares the clock field across recurring and one-off schedules", () => {
    for (const path of [
      "automations/cron-builder-dialog",
      "settings/add-chat-channel-dialog",
      "settings/edit-chat-channel-dialog",
      "tasks/task-schedule-dialog",
    ]) {
      expect(source(`src/components/${path}.tsx`)).toContain("<TimePicker")
    }
  })

  it("keeps the minute and hour of an automation in its cron expression", async () => {
    const onApply = vi.fn()
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <CronBuilderDialog
          open
          onOpenChange={vi.fn()}
          cron="5 9 * * *"
          timezone="Asia/Shanghai"
          onApply={onApply}
        />
      </NextIntlClientProvider>
    )
    const clock = screen.getByLabelText(en.Automations.cronTimeLabel)
    expect(clock).toHaveValue("09:05")
    fireEvent.change(clock, { target: { value: "21:47" } })
    fireEvent.click(
      screen.getByRole("button", { name: en.Automations.cronApply })
    )
    await waitFor(() => expect(onApply).toHaveBeenCalledWith("47 21 * * *"))
  })
})
