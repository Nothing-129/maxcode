import {
  primeUiPreferences,
  getCachedUiPreferences,
  setUiPreferences,
  DEFAULT_UI_PREFERENCES,
} from "@/lib/ui-preferences-store"
import {
  loadConversationStatusActions,
  loadConversationStatusDisplay,
} from "@/lib/conversation-status-prefs"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { AppearanceProvider } from "@/components/appearance-provider"
import { useAppearance } from "@/hooks/use-appearance"
import { APPEARANCE_INIT_SCRIPT } from "@/lib/appearance-script"
import { CUSTOM_CSS_ELEMENT_ID } from "@/lib/custom-style"
import { source } from "./contract-source"

function Probe() {
  const appearance = useAppearance()
  return (
    <button
      onClick={() => {
        appearance.setWorkspaceBgEnabled(true)
        appearance.setThemeColor("rose")
        appearance.setZoomLevel(150)
        appearance.setUiFont("inter")
        appearance.setChatFontSize(20)
        appearance.setCustomCss("body { color: red; }")
        appearance.setCustomCssEnabled(true)
      }}
    >
      {JSON.stringify({
        color: appearance.themeColor,
        zoom: appearance.zoomLevel,
        font: appearance.uiFont.id,
        size: appearance.chatFontSize,
        css: appearance.customCss,
        background: appearance.workspaceBgEnabled,
      })}
    </button>
  )
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute("style")
  document.getElementById(CUSTOM_CSS_ELEMENT_ID)?.remove()
})

describe("fixed desktop appearance", () => {
  it("ignores old overrides before first paint and through runtime changes", () => {
    localStorage.setItem("codeg-workspace-bg-enabled", "1")
    localStorage.setItem("codeg-theme-color", "rose")
    localStorage.setItem("codeg-zoom-level", "150")
    localStorage.setItem("codeg-ui-font", "inter")
    localStorage.setItem("codeg-ui-font-stack", "Inter Variable")
    localStorage.setItem("codeg-chat-font-size", "20")
    localStorage.setItem("codeg-custom-css-enabled", "1")
    localStorage.setItem("codeg-custom-css", "body { color:red; }")
    ;(0, eval)(APPEARANCE_INIT_SCRIPT)
    expect(document.documentElement.dataset.workspaceBg).not.toBe("on")
    expect(document.documentElement.dataset.theme).toBe("neutral")
    expect(document.documentElement.style.fontSize).toBe("16px")
    expect(
      document.documentElement.style.getPropertyValue("--chat-font-size")
    ).toBe("0.875rem")
    expect(document.getElementById(CUSTOM_CSS_ELEMENT_ID)).toBeNull()
    render(
      <AppearanceProvider>
        <Probe />
      </AppearanceProvider>
    )
    const button = screen.getByRole("button")
    const initial = button.textContent
    expect(initial).toContain('"color":"neutral"')
    expect(initial).toContain('"zoom":100')
    expect(initial).toContain('"font":"system-ui"')
    expect(initial).toContain('"size":14')
    fireEvent.click(button)
    act(() =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "codeg-zoom-level",
          newValue: "150",
        })
      )
    )
    expect(button.textContent).toBe(initial)
    expect(document.documentElement.style.fontSize).toBe("16px")
    expect(localStorage.getItem("codeg-chat-font-size")).toBe("20")
  })

  it("shows preset choice while gating advanced appearance sections", () => {
    const settings = source("src/components/settings/appearance-settings.tsx")
    const start = settings.indexOf("{APPEARANCE_CUSTOMIZATION_ENABLED &&")
    const end = settings.indexOf("{/* ===== Workspace background")
    const gated = settings.slice(start, end)
    expect(settings.slice(0, start)).toContain("themeColor.sectionTitle")
    expect(settings.slice(0, start)).toContain("SELECTABLE_THEME_COLORS")
    expect(gated).toContain("zoomLevel.sectionTitle")
    expect(gated).toContain("<FontSettingsSection />")
    expect(gated).toContain("<CustomStyleSection />")
  })
  it("keeps status actions on and status colors/mode cards off despite old preferences", async () => {
    primeUiPreferences({
      show_conversation_status: true,
      allow_conversation_status_actions: false,
      show_welcome_quick_actions: true,
    })
    expect(getCachedUiPreferences()).toEqual(DEFAULT_UI_PREFERENCES)
    expect(loadConversationStatusActions()).toBe(true)
    expect(loadConversationStatusDisplay()).toBe(false)
    expect(
      await setUiPreferences({ allow_conversation_status_actions: false })
    ).toEqual(DEFAULT_UI_PREFERENCES)
  })

  it("also hides background, status, welcome cards and pet controls", () => {
    const settings = source("src/components/settings/appearance-settings.tsx")
    expect(settings).not.toContain("conversationStatus.sectionTitle")
    const gate = settings.lastIndexOf("{APPEARANCE_CUSTOMIZATION_ENABLED &&")
    const optional = settings.slice(gate)
    for (const control of [
      "<WorkspaceBackgroundSection />",
      "welcomePanel.sectionTitle",
    ]) {
      expect(optional).toContain(control)
    }
    expect(settings).not.toContain("PetManagerSection")
    const actions = source("src/components/layout/quick-actions-dropdown.tsx")
    expect(actions).not.toContain("openPetWindow")
    expect(actions).not.toContain("RemoteWorkspaceManageDialog")
  })
})
