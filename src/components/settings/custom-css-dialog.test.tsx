import { act, render, screen, fireEvent } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Stand-in for `@monaco-editor/react`'s Editor: a plain textarea wired to the
// same value/onChange contract, so the draft → preview path can be driven
// without loading the real AMD-based editor in jsdom.
vi.mock("@monaco-editor/react", async () => {
  const { createElement } = await import("react")
  return {
    default: ({
      value,
      onChange,
    }: {
      value?: string
      onChange?: (v: string | undefined) => void
    }) =>
      createElement("textarea", {
        "data-testid": "monaco",
        value: value ?? "",
        onChange: (e: { target: { value: string } }) =>
          onChange?.(e.target.value),
      }),
  }
})

// The real module only calls `loader.config` on the (now mocked) library.
vi.mock("@/lib/monaco-local", () => ({}))

import { CustomCssDialog } from "./custom-css-dialog"
import { AppearanceProvider } from "@/components/appearance-provider"
import enMessages from "@/i18n/messages/en.json"
import {
  STORAGE_KEY_CUSTOM_CSS,
  STORAGE_KEY_CUSTOM_CSS_ENABLED,
} from "@/lib/appearance-script"
import { CUSTOM_CSS_ELEMENT_ID } from "@/lib/custom-style"

const COMMITTED = ".committed{color:red}"
const PREVIEW = ".preview{color:blue}"

function injected(): string {
  return document.getElementById(CUSTOM_CSS_ELEMENT_ID)?.textContent ?? ""
}

function renderDialog(open = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AppearanceProvider>
        <CustomCssDialog open={open} onOpenChange={() => {}} />
      </AppearanceProvider>
    </NextIntlClientProvider>
  )
}

async function typePreview() {
  const editor = await screen.findByTestId("monaco")
  fireEvent.change(editor, { target: { value: PREVIEW } })
  await act(async () => {
    vi.advanceTimersByTime(400)
  })
}

beforeEach(() => {
  localStorage.clear()
  document.getElementById(CUSTOM_CSS_ELEMENT_ID)?.remove()
  document.documentElement.removeAttribute("style")
  localStorage.setItem(STORAGE_KEY_CUSTOM_CSS_ENABLED, "1")
  localStorage.setItem(STORAGE_KEY_CUSTOM_CSS, COMMITTED)
  // `shouldAdvanceTime` 是必需的：RTL 的 findBy*/waitFor 靠真实时间轮询，纯假定时器
  // 会让它们永远卡住（next/dynamic 加载编辑器需要一次异步解析）。
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
  document.getElementById(CUSTOM_CSS_ELEMENT_ID)?.remove()
})

describe("CustomCssDialog preview lifecycle", () => {
  it("previews the draft live without persisting it", async () => {
    renderDialog()
    await typePreview()

    expect(injected()).toBe(PREVIEW)
    // 预览绝不落盘 —— 持久化只在「应用」时发生。
    expect(localStorage.getItem(STORAGE_KEY_CUSTOM_CSS)).toBe(COMMITTED)
  })

  it("restores the committed CSS when unmounted while still open", async () => {
    // 真实路径：别的窗口调 openSettingsWindow(section) 会让现有设置窗口换路由，
    // 本组件于是在 open 仍为 true 的情况下被卸载，压根不经过 open→false 那一跳。
    // 没有卸载清理的话，没应用过的预览会滞留在 DOM 里继续生效。
    const { unmount } = renderDialog()
    await typePreview()
    expect(injected()).toBe(PREVIEW)

    unmount()

    expect(injected()).toBe(COMMITTED)
  })

  it("drops the preview instead of applying it when custom CSS is off", async () => {
    localStorage.setItem(STORAGE_KEY_CUSTOM_CSS_ENABLED, "0")
    const { unmount } = renderDialog()
    await typePreview()
    expect(injected()).toBe(PREVIEW)

    unmount()

    expect(injected()).toBe("")
  })
})

// Exercise the retained customization implementation in its future enabled mode.
vi.mock("@/lib/appearance-policy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/appearance-policy")>()),
  APPEARANCE_CUSTOMIZATION_ENABLED: true,
  isFixedAppearanceKey: () => false,
}))
