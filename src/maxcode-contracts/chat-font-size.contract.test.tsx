import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextIntlClientProvider } from "next-intl"
import { AppearanceProvider } from "@/components/appearance-provider"
import { useChatFontSize } from "@/hooks/use-appearance"
import {
  APPEARANCE_INIT_SCRIPT,
  STORAGE_KEY_CHAT_FONT_SIZE,
} from "@/lib/appearance-script"
import { ContentPartsRenderer } from "@/components/message/content-parts-renderer"
import en from "@/i18n/messages/en.json"

function Probe() {
  const { chatFontSize, setChatFontSize } = useChatFontSize()
  return <button onClick={() => setChatFontSize(18)}>{chatFontSize}</button>
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.style.fontSize = "16px"
})
afterEach(() => {
  document.documentElement.removeAttribute("style")
})

describe("MaxCode chat font size", () => {
  it("changes and persists message size without changing window zoom, then restores it", () => {
    const view = render(
      <AppearanceProvider>
        <Probe />
      </AppearanceProvider>
    )
    fireEvent.click(screen.getByRole("button", { name: "14" }))
    expect(
      document.documentElement.style.getPropertyValue("--chat-font-size")
    ).toBe("1.125rem")
    expect(document.documentElement.style.fontSize).toBe("16px")
    expect(localStorage.getItem(STORAGE_KEY_CHAT_FONT_SIZE)).toBe("18")
    view.unmount()
    render(
      <AppearanceProvider>
        <Probe />
      </AppearanceProvider>
    )
    expect(screen.getByRole("button", { name: "18" })).toBeInTheDocument()
  })

  it("synchronizes changes from a separate settings window and resets deleted preferences", () => {
    render(
      <AppearanceProvider>
        <Probe />
      </AppearanceProvider>
    )
    act(() => {
      localStorage.setItem(STORAGE_KEY_CHAT_FONT_SIZE, "20")
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: STORAGE_KEY_CHAT_FONT_SIZE,
          newValue: "20",
        })
      )
    })
    expect(screen.getByRole("button", { name: "20" })).toBeInTheDocument()
    expect(
      document.documentElement.style.getPropertyValue("--chat-font-size")
    ).toBe("1.25rem")
    act(() => {
      localStorage.removeItem(STORAGE_KEY_CHAT_FONT_SIZE)
      window.dispatchEvent(
        new StorageEvent("storage", { key: STORAGE_KEY_CHAT_FONT_SIZE })
      )
    })
    expect(screen.getByRole("button", { name: "14" })).toBeInTheDocument()
  })

  it.each([
    ["18", "1.125rem"],
    ["999", "0.875rem"],
    ["invalid", "0.875rem"],
  ])(
    "initializes saved size %s before hydration with a safe fallback",
    (stored, expected) => {
      localStorage.setItem(STORAGE_KEY_CHAT_FONT_SIZE, stored)
      ;(0, eval)(APPEARANCE_INIT_SCRIPT)
      expect(
        document.documentElement.style.getPropertyValue("--chat-font-size")
      ).toBe(expected)
      expect(document.documentElement.style.fontSize).toBe("16px")
    }
  )

  it.each(["user", "assistant"] as const)(
    "applies the chat text scope to %s messages",
    (role) => {
      const { container } = render(
        <NextIntlClientProvider locale="en" messages={en}>
          <ContentPartsRenderer
            role={role}
            parts={[{ type: "text", text: "Readable conversation" }]}
          />
        </NextIntlClientProvider>
      )
      expect(container.querySelector(".chat-message-text")).toHaveTextContent(
        "Readable conversation"
      )
    }
  )
})

// Exercise the retained customization implementation in its future enabled mode.
vi.mock("@/lib/appearance-policy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/appearance-policy")>()),
  APPEARANCE_CUSTOMIZATION_ENABLED: true,
  isFixedAppearanceKey: () => false,
}))
