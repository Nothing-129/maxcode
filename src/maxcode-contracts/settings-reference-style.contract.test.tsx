import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ThemeProvider } from "next-themes"
import { NextIntlClientProvider } from "next-intl"
import { AppearanceProvider } from "@/components/appearance-provider"
import { AppearanceSettings } from "@/components/settings/appearance-settings"
import en from "@/i18n/messages/en.json"
import { SettingsGroup } from "@/components/shared/settings-group"
import { SettingRow } from "@/components/shared/setting-card"
import { SettingsSection } from "@/components/shared/settings-section"
import { Switch } from "@/components/ui/switch"
import { source } from "./contract-source"

describe("reference settings layout", () => {
  it("keeps group headings outside the card and row labels connected to controls", () => {
    render(
      <div data-settings-surface="">
        <SettingsGroup heading={<h2>Display</h2>}>
          <SettingRow
            title="Notifications"
            description="Show desktop notifications"
            htmlFor="notifications"
            control={<Switch id="notifications" />}
          />
        </SettingsGroup>
      </div>
    )
    expect(
      screen.getByRole("heading").closest("[data-settings-group-body]")
    ).toBeNull()
    const control = screen.getByRole("switch", { name: "Notifications" })
    expect(control.closest("[data-settings-group-body]")).not.toBeNull()
    fireEvent.click(screen.getByText("Notifications"))
    expect(control).toHaveAttribute("aria-checked", "true")
  })

  it("targets description typography without muting warning and error paragraphs", () => {
    render(
      <SettingsSection title="Terminal" description="Choose a shell">
        <p className="text-amber-500">Shell not found</p>
        <p className="text-destructive">Save failed</p>
      </SettingsSection>
    )
    expect(screen.getByText("Choose a shell")).toHaveAttribute(
      "data-settings-description"
    )
    expect(screen.getByText("Shell not found")).not.toHaveAttribute(
      "data-settings-description"
    )
    expect(screen.getByText("Save failed")).not.toHaveAttribute(
      "data-settings-description"
    )
    const css = source("src/app/globals.css")
    expect(css).not.toContain(
      "[data-settings-surface] [data-settings-section] p,"
    )
    expect(css).not.toContain(
      "[data-settings-surface] [data-setting-row] .text-xs"
    )
    expect(css).toContain("[data-settings-surface] [data-settings-description]")
    // The folding affordance must remain visible after removing decorative icons.
    expect(css).not.toContain(
      "[data-settings-surface] [data-settings-section] h2 svg,"
    )
  })

  it("preserves warning and error colors with the real settings stylesheet applied", () => {
    const css = source("src/app/globals.css")
    const start = css.indexOf("/* Desktop settings use quiet grouped rows;")
    const end = css.indexOf("/* Screenshot-measured sidebar ink.", start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const style = document.createElement("style")
    // Supply palette values directly: jsdom does not resolve theme variables.
    style.textContent = `
      .text-amber-500 { color: rgb(245, 158, 11); }
      .text-destructive { color: rgb(185, 28, 28); }
      ${css.slice(start, end).split("var(--muted-foreground)").join("rgb(120,120,120)")}
    `
    document.head.appendChild(style)
    try {
      render(
        <div data-settings-surface="">
          <div data-settings-page="" data-testid="page">
            <div data-overlayscrollbars-viewport="">
              <div data-testid="nested-list">Log entries</div>
            </div>
          </div>
          <SettingsSection title="Terminal" description="Shell path">
            <p className="text-amber-500">Missing executable</p>
            <p className="text-destructive">Could not save</p>
          </SettingsSection>
        </div>
      )
      expect(
        getComputedStyle(screen.getByText("Missing executable")).color
      ).toBe("rgb(245, 158, 11)")
      expect(getComputedStyle(screen.getByText("Could not save")).color).toBe(
        "rgb(185, 28, 28)"
      )
      expect(getComputedStyle(screen.getByText("Shell path")).color).toBe(
        "rgb(120, 120, 120)"
      )
      const pageStyle = getComputedStyle(screen.getByTestId("page"))
      expect(pageStyle.paddingTop).toBe("2.25rem")
      expect(pageStyle.paddingInlineStart || pageStyle.paddingLeft).toBe(
        "2.5rem"
      )
      expect(pageStyle.paddingBottom).toBe("3.5rem")
      expect(getComputedStyle(screen.getByTestId("nested-list")).padding).toBe(
        ""
      )
    } finally {
      style.remove()
    }
  })

  it("exposes all three theme previews as one native keyboard-selectable group", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ThemeProvider defaultTheme="system">
          <AppearanceProvider>
            <AppearanceSettings />
          </AppearanceProvider>
        </ThemeProvider>
      </NextIntlClientProvider>
    )
    const choices = within(
      screen.getByRole("group", { name: en.AppearanceSettings.themeMode })
    )
    expect(choices.getAllByRole("radio")).toHaveLength(3)
    for (const mode of ["system", "light", "dark"] as const) {
      const radio = choices.getByRole("radio", {
        name: en.AppearanceSettings[mode],
      })
      expect(radio).toHaveAttribute("name", "appearance-theme-mode")
      expect(
        radio.closest("label")?.querySelector(`[data-theme-preview="${mode}"]`)
      ).not.toBeNull()
      fireEvent.click(radio)
      expect(radio).toBeChecked()
      expect(choices.getAllByRole("radio", { checked: true })).toHaveLength(1)
    }
  })

  it("gives every reachable settings page a page title without restyling nested headings", () => {
    for (const name of [
      "general-settings",
      "appearance-settings",
      "acp-agent-settings",
      "mcp-settings",
      "skill-packs-settings",
      "skills-settings",
      "shortcut-settings",
      "quick-messages-settings",
      "version-control-settings",
      "chat-channel-settings",
      "model-provider-settings",
      "system-network-settings",
      "web-service-settings",
      "logs-settings",
    ]) {
      expect(source(`src/components/settings/${name}.tsx`)).toMatch(
        /<h1\s+data-settings-page-title=""/
      )
    }
    expect(source("src/app/globals.css")).not.toContain(".settings-content h1")
  })

  it("uses the shared input and grouped surfaces across the migrated pages", () => {
    for (const name of [
      "appearance-settings",
      "system-network-settings",
      "logs-settings",
      "backup-settings",
    ]) {
      expect(source(`src/components/settings/${name}.tsx`)).toContain(
        "<SettingsGroup"
      )
    }
    expect(source("src/components/settings/web-service-settings.tsx")).toMatch(
      /<Input\s+type="number"/
    )
    const css = source("src/app/globals.css")
    expect(css).toContain("var(--settings-hairline)")
    expect(css).toContain('[data-settings-surface] [data-slot="input"]')
  })
})

it("shares responsive groups across preferences and keeps dense viewers full width", () => {
  const css = source("src/app/globals.css")
  expect(css).toContain(
    '[data-settings-page] [data-settings-group]:not([data-settings-group="full"])'
  )
  expect(css).toMatch(
    /\[data-settings-surface\] \[data-settings-page\] \{[^}]*--primary: var\(--foreground\)/
  )
  expect(
    source("src/components/settings/version-control-settings.tsx")
  ).toContain('data-settings-group=""')
  expect(source("src/components/settings/logs-settings.tsx")).toMatch(
    /<SettingsGroup\s+fullWidth/
  )
  expect(source("src/components/settings/shortcut-settings.tsx")).toContain(
    'data-settings-list=""'
  )
})
