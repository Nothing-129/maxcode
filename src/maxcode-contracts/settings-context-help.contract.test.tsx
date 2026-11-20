import { source } from "./contract-source"
import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { expect, it, vi } from "vitest"
import { SettingsHelpContext } from "@/components/shared/settings-help"
import { SettingRow } from "@/components/shared/setting-card"
import { SettingsSection } from "@/components/shared/settings-section"
import en from "@/i18n/messages/en.json"

it("gives settings descriptions their own help buttons beside the controls", () => {
  const change = vi.fn()
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SettingsHelpContext value={true}>
        <SettingsSection
          title="Delivery"
          description="Notification delivery"
          collapsible
          open={false}
          onOpenChange={change}
        >
          <span>Details</span>
        </SettingsSection>
        <SettingRow
          title="Sound"
          description="Play a notification sound"
          htmlFor="sound"
          control={<input type="checkbox" id="sound" />}
        />
      </SettingsHelpContext>
    </NextIntlClientProvider>
  )
  for (const text of ["Notification delivery", "Play a notification sound"]) {
    const hint = screen.getByText(text)
    expect(hint).toHaveAttribute("popover", "hint")
    const trigger = document.querySelector<HTMLButtonElement>(
      `[popovertarget="${hint.id}"]`
    )!
    expect(trigger).toHaveAttribute("interestfor", hint.id)
    expect(trigger).toHaveAccessibleName()
    expect(trigger.parentElement?.closest("label,button")).toBeNull()
    fireEvent.click(trigger)
  }
  expect(change).not.toHaveBeenCalled()
  expect(screen.getByRole("checkbox", { name: "Sound" })).not.toBeChecked()
})

it("retains inline instructions for shared rows outside settings", () => {
  render(<SettingRow title="Task" description="Choose an owner" />)
  expect(screen.getByText("Choose an owner")).toBeVisible()
  expect(document.querySelector("[popovertarget]")).toBeNull()
})

it("scopes desktop hover help to General settings and keeps touch and keyboard access", () => {
  const css = source("src/app/globals.css")
  const general = source("src/components/settings/general-settings.tsx")
  expect(general).toContain('data-settings-page="general"')
  expect(general).toContain('title={t("environmentGroup")}')
  expect(general).toContain('title={t("notificationGroup")}')
  expect(css).toMatch(
    /@media \(hover: hover\) and \(pointer: fine\) and \(not \(any-pointer: coarse\)\)/
  )
  expect(css).toContain(":not(:hover, :focus-within)")
  expect(css).toContain('[data-settings-help]:not([aria-expanded="true"])')
})
