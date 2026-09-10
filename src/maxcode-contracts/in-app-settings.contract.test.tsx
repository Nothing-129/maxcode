import { source } from "./contract-source"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { InAppSettings } from "@/components/settings/in-app-settings"
import { requestInAppSettings } from "@/lib/in-app-settings"

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("@/app/settings/agents/page", () => ({
  default: () => (
    <input aria-label="Agent setting draft" defaultValue="Original" />
  ),
}))
vi.mock("@/app/settings/appearance/page", () => ({
  default: () => <div>Appearance loaded</div>,
}))
vi.mock("@/components/settings/settings-shell", () => ({
  SettingsShell: ({
    children,
    onBack,
    onNavigate,
    activePath,
  }: {
    children: React.ReactNode
    onBack: () => void
    onNavigate: (href: string) => void
    activePath: string
  }) => (
    <div>
      <span>{activePath}</span>
      <button onClick={onBack}>Back to app</button>
      <button onClick={() => onNavigate("/settings/appearance")}>
        Appearance
      </button>
      <button onClick={() => onNavigate("/settings/agents")}>Agents</button>
      {children}
    </div>
  ),
}))

describe("in-window settings", () => {
  it("scopes grouped desktop settings styling away from workspace controls", () => {
    const shell = source("src/components/settings/settings-shell.tsx")
    const css = source("src/app/globals.css")
    expect(shell).toContain('data-settings-surface=""')
    expect(shell).toContain("setQuery(event.target.value)")
    expect(source("src/components/settings/general-settings.tsx")).toContain(
      'data-settings-option-group=""'
    )
    expect(css).toContain(
      '[data-settings-surface] [data-slot="switch"][data-state="checked"]'
    )
    expect(css).toContain("[data-settings-surface] [data-setting-card]")
  })

  it("exposes skill packs while keeping the other advanced categories hidden", () => {
    const shell = source("src/components/settings/settings-shell.tsx")
    for (const path of ["mcp", "skills", "model-providers"]) {
      expect(shell).not.toContain(`href: "/settings/${path}"`)
    }
    for (const path of [
      "general",
      "appearance",
      "agents",
      "skill-packs",
      "shortcuts",
    ]) {
      expect(shell).toContain(`href: "/settings/${path}"`)
    }
  })

  it("keeps the workspace and draft mounted while opening, navigating and returning", async () => {
    window.history.replaceState(null, "", "/workspace?conversation=7")
    render(
      <InAppSettings>
        <textarea aria-label="Draft" defaultValue="Unsent text" />
      </InAppSettings>
    )
    const draft = screen.getByLabelText("Draft")
    act(() => {
      expect(
        requestInAppSettings({ section: "agents", agentType: "codex" })
      ).toBe(true)
    })
    expect(screen.getByText("/settings/agents")).toBeInTheDocument()
    expect(draft).toBeInTheDocument()
    expect(draft).not.toBeVisible()
    expect(window.location.pathname).toBe("/workspace")
    expect(new URLSearchParams(window.location.search).get("agent")).toBe(
      "codex"
    )
    const settingDraft = await screen.findByLabelText("Agent setting draft")
    fireEvent.change(settingDraft, { target: { value: "Unsaved change" } })
    fireEvent.click(screen.getByText("Appearance"))
    expect(screen.getByText("/settings/appearance")).toBeInTheDocument()
    expect(screen.getByText("Back to app")).toBeVisible()
    await screen.findByText("Appearance loaded")
    expect(settingDraft).not.toBeVisible()
    fireEvent.click(screen.getByText("Agents"))
    expect(screen.getByLabelText("Agent setting draft")).toBe(settingDraft)
    expect(settingDraft).toBeVisible()
    expect(settingDraft).toHaveValue("Unsaved change")
    fireEvent.click(screen.getByText("Back to app"))
    expect(
      screen.queryByLabelText("Agent setting draft")
    ).not.toBeInTheDocument()
    expect(draft).toBeVisible()
    expect(draft).toHaveValue("Unsent text")
    expect(window.location.search).toBe("?conversation=7")
  })
})
