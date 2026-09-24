import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { AppearanceProvider } from "@/components/appearance-provider"
import { useThemeColor } from "@/hooks/use-appearance"
import { APPEARANCE_INIT_SCRIPT } from "@/lib/appearance-script"
import { EDITOR_CANVAS_BG, EDITOR_LINE_HIGHLIGHT } from "@/lib/monaco-themes"
import { source } from "./contract-source"

function ThemePickerProbe() {
  const { themeColor, setThemeColor } = useThemeColor()
  return (
    <button onClick={() => setThemeColor("hbuilderx")}>{themeColor}</button>
  )
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute("data-theme")
})

describe("selectable HBuilderX warm theme", () => {
  it("applies a saved choice before first paint and lets the user switch to it", () => {
    localStorage.setItem("codeg-theme-color", "hbuilderx")
    ;(0, eval)(APPEARANCE_INIT_SCRIPT)
    expect(document.documentElement.dataset.theme).toBe("hbuilderx")

    localStorage.setItem("codeg-theme-color", "neutral")
    document.documentElement.dataset.theme = "neutral"
    render(
      <AppearanceProvider>
        <ThemePickerProbe />
      </AppearanceProvider>
    )
    fireEvent.click(screen.getByRole("button", { name: "neutral" }))
    expect(screen.getByRole("button", { name: "hbuilderx" })).toBeTruthy()
    expect(document.documentElement.dataset.theme).toBe("hbuilderx")
    expect(localStorage.getItem("codeg-theme-color")).toBe("hbuilderx")
  })

  it("keeps the warm palette visible and applies it to the editor", () => {
    const settings = source("src/components/settings/appearance-settings.tsx")
    const css = source("src/app/globals.css")
    expect(settings).toContain("SELECTABLE_THEME_COLORS")
    expect(css).toMatch(
      /\[data-theme="hbuilderx"\] \{[^}]*--background: #fffbea;/
    )
    expect(css).toMatch(
      /\[data-theme="hbuilderx"\] \{[^}]*--foreground: #3a5268;/
    )
    expect(css).toMatch(/\[data-theme="hbuilderx"\] \{[^}]*--primary: #237a53;/)
    expect(css).toMatch(/\[data-theme="hbuilderx"\] \{[^}]*--sidebar: #fffbea;/)
    expect(css).toMatch(/\[data-theme="hbuilderx"\] \{[^}]*--accent: #ece3ca;/)
    expect(EDITOR_CANVAS_BG.hbuilderx.light).toBe("#fffbea")
    expect(EDITOR_LINE_HIGHLIGHT.hbuilderx.light).toBe("#ece3ca")
  })
})
