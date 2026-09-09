import { act, fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { CustomStyleSection } from "./custom-style-section"
import { AppearanceProvider } from "@/components/appearance-provider"
import enMessages from "@/i18n/messages/en.json"
import {
  STORAGE_KEY_CUSTOM_THEME,
  STORAGE_KEY_CUSTOM_STYLE_SUSPENDED,
} from "@/lib/appearance-script"

function seedTheme(light: Record<string, string>) {
  localStorage.setItem(
    STORAGE_KEY_CUSTOM_THEME,
    JSON.stringify({ light, dark: {} })
  )
}

function renderSection() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AppearanceProvider>
        <CustomStyleSection />
      </AppearanceProvider>
    </NextIntlClientProvider>
  )
}

/** 整块默认折叠，控件在展开之后才挂载。 */
function expandSection() {
  fireEvent.click(screen.getByRole("button", { name: /Custom Style/ }))
}

function primary() {
  return document.documentElement.style.getPropertyValue("--primary")
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute("style")
  document.documentElement.classList.remove("dark")
})

afterEach(() => {
  document.documentElement.removeAttribute("style")
})

describe("CustomStyleSection", () => {
  it("applies stored overrides as inline custom properties", () => {
    seedTheme({ primary: "#112233" })
    renderSection()
    expect(primary()).toBe("#112233")
  })

  it("stays collapsed until the header is clicked", () => {
    seedTheme({ primary: "#112233" })
    renderSection()

    // 折叠状态下覆盖照样生效，只是编辑器没挂载。
    expect(primary()).toBe("#112233")
    expect(screen.queryByLabelText("Enable custom colors")).toBeNull()
    expect(screen.getByText("1 override")).toBeInTheDocument()

    const header = screen.getByRole("button", { name: /Custom Style/ })
    expect(header).toHaveAttribute("aria-expanded", "false")
    // 标题必须仍然是标题：把 h2 塞进 role=button 会压平后代语义，这一节就从设置页
    // 的标题列表里消失了。
    expect(
      screen.getByRole("heading", { name: /Custom Style/ })
    ).toBeInTheDocument()

    expandSection()

    expect(header).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByLabelText("Enable custom colors")).toBeInTheDocument()
  })

  it("removes the overrides when custom colors are switched off", () => {
    seedTheme({ primary: "#112233" })
    renderSection()
    expandSection()
    expect(primary()).toBe("#112233")

    fireEvent.click(screen.getByLabelText("Enable custom colors"))

    expect(primary()).toBe("")
  })

  it("edits the token for the mode currently in effect", () => {
    document.documentElement.classList.add("dark")
    seedTheme({ primary: "#112233" })
    renderSection()
    expandSection()

    // 暗色模式下不该套用浅色那一组 —— 两套取值必须各走各的。
    expect(primary()).toBe("")
    expect(screen.getByText(/Editing dark mode values/)).toBeInTheDocument()
  })

  it("clears every override from the clear button", () => {
    seedTheme({ primary: "#112233", border: "#445566" })
    renderSection()
    expandSection()
    expect(primary()).toBe("#112233")

    fireEvent.click(screen.getByRole("button", { name: "Clear overrides" }))

    expect(primary()).toBe("")
    expect(document.documentElement.style.getPropertyValue("--border")).toBe("")
  })

  it("suspends everything from the escape-hatch shortcut, and says so", () => {
    seedTheme({ primary: "#112233" })
    renderSection()
    expect(primary()).toBe("#112233")

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "s",
          metaKey: true,
          altKey: true,
          shiftKey: true,
          bubbles: true,
        })
      )
    })

    expect(primary()).toBe("")
    expect(localStorage.getItem(STORAGE_KEY_CUSTOM_STYLE_SUSPENDED)).toBe("1")
    // 不展开就该能看到「恢复」—— 逃生舱藏进折叠区就等于没有逃生舱。
    expect(
      screen.getByRole("button", { name: "Resume custom style" })
    ).toBeInTheDocument()
  })

  it("restores the overrides when resumed", () => {
    seedTheme({ primary: "#112233" })
    localStorage.setItem(STORAGE_KEY_CUSTOM_STYLE_SUSPENDED, "1")
    renderSection()
    expect(primary()).toBe("")

    fireEvent.click(screen.getByRole("button", { name: "Resume custom style" }))

    expect(primary()).toBe("#112233")
  })
})

// Exercise the retained customization implementation in its future enabled mode.
vi.mock("@/lib/appearance-policy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/appearance-policy")>()),
  APPEARANCE_CUSTOMIZATION_ENABLED: true,
  isFixedAppearanceKey: () => false,
}))
