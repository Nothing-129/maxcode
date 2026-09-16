import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextIntlClientProvider } from "next-intl"
import { readFileSync } from "node:fs"
import { AppearanceProvider } from "@/components/appearance-provider"
import { ChatColumnResizeHandle } from "@/components/chat/chat-column-resize-handle"
import { useChatColumnWidth } from "@/hooks/use-appearance"
import {
  APPEARANCE_INIT_SCRIPT,
  STORAGE_KEY_CHAT_COLUMN_WIDTH,
} from "@/lib/appearance-script"
import {
  DEFAULT_CHAT_COLUMN_WIDTH_REM,
  MAX_CHAT_COLUMN_WIDTH_REM,
  MIN_CHAT_COLUMN_WIDTH_REM,
} from "@/lib/chat-column-width"
import en from "@/i18n/messages/en.json"

/**
 * MaxCode 下游契约：会话内容列宽度可拖、可持久化、可恢复默认。
 * 参考端（印象青城）交互：抓手平时隐形，指针移到列缘热区才浮现；拖动实时
 * 重排列宽（居中列双缘对称伸缩）；双击恢复默认。
 */

function Probe() {
  const { chatColumnWidth, setChatColumnWidth } = useChatColumnWidth()
  return (
    <div>
      <output>{chatColumnWidth}</output>
      <button onClick={() => setChatColumnWidth(64)}>set-wide</button>
      <div className="relative h-96 w-[1200px]">
        <ChatColumnResizeHandle />
      </div>
    </div>
  )
}

function renderWorkspace() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AppearanceProvider>
        <Probe />
      </AppearanceProvider>
    </NextIntlClientProvider>
  )
}

function columnVar(): string {
  return document.documentElement.style.getPropertyValue("--chat-column-max")
}

function pointerEvent(type: string, clientX: number) {
  // jsdom 没有 PointerEvent；React 只认事件类型，MouseEvent 携带的 clientX 足够。
  return new MouseEvent(type, { bubbles: true, clientX })
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.style.fontSize = "16px"
  // jsdom 没有指针捕获 API；抓手 pointerdown 时调用，补一个无操作实现。
  if (!("setPointerCapture" in Element.prototype)) {
    Object.defineProperty(Element.prototype, "setPointerCapture", {
      value: () => {},
      configurable: true,
      writable: true,
    })
    Object.defineProperty(Element.prototype, "releasePointerCapture", {
      value: () => {},
      configurable: true,
      writable: true,
    })
  }
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({ matches: false }) as unknown as typeof matchMedia
  )
})
afterEach(() => {
  document.documentElement.removeAttribute("style")
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("MaxCode chat column width", () => {
  it("drags the centered column edge live, clamps to bounds and persists", () => {
    vi.useFakeTimers()
    renderWorkspace()
    const handle = screen.getByRole("separator")

    // 列居中、双缘对称：列宽增量 = 指针位移 × 2。+56px → +7rem（48 → 55）。
    fireEvent(handle, pointerEvent("pointerdown", 600))
    fireEvent(handle, pointerEvent("pointermove", 656))
    expect(columnVar()).toBe("55rem")

    // 拖动中仍未过防抖窗口时不落盘，放手提交。
    expect(localStorage.getItem(STORAGE_KEY_CHAT_COLUMN_WIDTH)).toBeNull()
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(localStorage.getItem(STORAGE_KEY_CHAT_COLUMN_WIDTH)).toBe("55")

    // 越界拖动钳制到 [MIN, MAX]。
    fireEvent(handle, pointerEvent("pointerdown", 600))
    fireEvent(handle, pointerEvent("pointermove", 5000))
    expect(columnVar()).toBe(`${MAX_CHAT_COLUMN_WIDTH_REM}rem`)
    fireEvent(handle, pointerEvent("pointerup", 5000))
    fireEvent(handle, pointerEvent("pointerdown", 600))
    fireEvent(handle, pointerEvent("pointermove", 0))
    expect(columnVar()).toBe(`${MIN_CHAT_COLUMN_WIDTH_REM}rem`)
    fireEvent(handle, pointerEvent("pointerup", 0))
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(localStorage.getItem(STORAGE_KEY_CHAT_COLUMN_WIDTH)).toBe(
      String(MIN_CHAT_COLUMN_WIDTH_REM)
    )
  })

  it("double-click resets to the default width and keyboard steps it", () => {
    renderWorkspace()
    const handle = screen.getByRole("separator")

    fireEvent.click(screen.getByRole("button", { name: "set-wide" }))
    expect(columnVar()).toBe("64rem")

    fireEvent.dblClick(handle)
    expect(columnVar()).toBe(`${DEFAULT_CHAT_COLUMN_WIDTH_REM}rem`)

    fireEvent.keyDown(handle, { key: "ArrowRight" })
    expect(columnVar()).toBe("49rem")
    fireEvent.keyDown(handle, { key: "Home" })
    expect(columnVar()).toBe(`${MIN_CHAT_COLUMN_WIDTH_REM}rem`)
    fireEvent.keyDown(handle, { key: "End" })
    expect(columnVar()).toBe(`${MAX_CHAT_COLUMN_WIDTH_REM}rem`)
    fireEvent.keyDown(handle, { key: "Enter" })
    expect(columnVar()).toBe(`${DEFAULT_CHAT_COLUMN_WIDTH_REM}rem`)
  })

  it("restores a saved width on mount and falls back on invalid storage", () => {
    localStorage.setItem(STORAGE_KEY_CHAT_COLUMN_WIDTH, "56.5")
    renderWorkspace()
    expect(columnVar()).toBe("56.5rem")
    expect(screen.getByText("56.5")).toBeInTheDocument()
  })

  it("pre-applies the stored width before hydration with a safe fallback", () => {
    const cases: Array<[string | null, string]> = [
      ["56.5", "56.5rem"],
      ["999", "48rem"],
      ["junk", "48rem"],
      [null, "48rem"],
    ]
    for (const [stored, expected] of cases) {
      document.documentElement.style.removeProperty("--chat-column-max")
      localStorage.clear()
      if (stored !== null) {
        localStorage.setItem(STORAGE_KEY_CHAT_COLUMN_WIDTH, stored)
      }
      ;(0, eval)(APPEARANCE_INIT_SCRIPT)
      expect(columnVar()).toBe(expected)
    }
  })

  it("keeps the centered column css on the user variable with a 48rem fallback", () => {
    const css = readFileSync("src/app/globals.css", "utf8")
    expect(css).toMatch(
      /\.maxcode-chat-column\s*\{[^}]*max-width:\s*var\(--chat-column-max,\s*48rem\)/
    )
    // 手机端不参与列宽偏好：断点与 use-mobile.ts 的 MOBILE_BREAKPOINT 一致，
    // 桌面端拖窄（最低 40rem）后 640–767px 宽的手机仍满宽。
    expect(css).toMatch(
      /@media \(max-width: 767px\)\s*\{\s*\.maxcode-chat-column\s*\{\s*max-width: 100%;\s*\}/
    )
    // 抓手由会话 shell 按 columnResize 渲染；新增对话的欢迎页必须关闭
    // （没有可拖的转写列），workspace 布局层不再挂载。
    const shell = readFileSync(
      "src/components/chat/conversation-shell.tsx",
      "utf8"
    )
    expect(shell).toContain(
      "{columnResize ? <ChatColumnResizeHandle /> : null}"
    )
    const panel = readFileSync(
      "src/components/conversations/conversation-detail-panel.tsx",
      "utf8"
    )
    expect(panel).toContain("columnResize={!isWelcomeMode}")
    const layout = readFileSync("src/app/workspace/layout.tsx", "utf8")
    expect(layout).not.toContain("ChatColumnResizeHandle")
    // 抓手热区定位公式必须与列取宽逻辑一致（50% + min(半宽, 50%)）。
    const handleSource = readFileSync(
      "src/components/chat/chat-column-resize-handle.tsx",
      "utf8"
    )
    expect(handleSource).toContain(
      "calc(50% + min(var(--chat-column-max, 48rem) / 2, 50%))"
    )
  })

  it("reveals the edge line only at the column edge and labels it", () => {
    renderWorkspace()
    const handle = screen.getByRole("separator", {
      name: "Drag to resize conversation width",
    })
    expect(handle.className).toContain("cursor-col-resize")

    // 休息态唯一视觉是渐隐细线（2×120px，峰值前景 30%，渐变由
    // .chat-column-edge-line 提供），opacity-0；hover / 拖动 / 键盘聚焦才
    // 浮现，且竖线跟随指针垂直位置。
    const visuals = handle.querySelectorAll(":scope > span")
    expect(visuals.length).toBe(1)
    const line = visuals[0]
    expect(line.className).toContain("chat-column-edge-line")
    expect(line.className).toContain("h-[120px]")
    expect(line.className).toContain("w-[2px]")
    expect(line.className).toContain("opacity-0")
    expect(handle.querySelector(".inset-y-0")).toBeNull()

    const handleSource = readFileSync(
      "src/components/chat/chat-column-resize-handle.tsx",
      "utf8"
    )
    expect(handleSource).toContain("onPointerEnter")
    expect(handleSource).toContain("trackPointerY")
    // 离开热区后线必须原地淡出，top 不得回中（否则顶部/底部挪开时会在中间
    // 闪出一段淡出中的线）：位置状态与显隐状态分离。
    expect(handleSource).toContain("setLineVisible(false)")
    expect(handleSource).toContain("top: lineY ??")
    const css = readFileSync("src/app/globals.css", "utf8")
    expect(css).toMatch(/\.chat-column-edge-line\s*\{[^}]*var\(--foreground\)/)
  })

  it("synchronizes width changed from another window", () => {
    renderWorkspace()
    act(() => {
      localStorage.setItem(STORAGE_KEY_CHAT_COLUMN_WIDTH, "60")
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: STORAGE_KEY_CHAT_COLUMN_WIDTH,
          newValue: "60",
        })
      )
    })
    expect(columnVar()).toBe("60rem")
    act(() => {
      localStorage.removeItem(STORAGE_KEY_CHAT_COLUMN_WIDTH)
      window.dispatchEvent(
        new StorageEvent("storage", { key: STORAGE_KEY_CHAT_COLUMN_WIDTH })
      )
    })
    expect(columnVar()).toBe("48rem")
  })
})

// 刻意不 mock appearance-policy：APPEARANCE_CUSTOMIZATION_ENABLED 在生产为 false，
// 列宽拖动必须在这种模式下照样生效（曾有回归：setter 照搬字号门控导致拖动
// 静默无效，实机才暴露）。存储 key 不匹配 FIXED_APPEARANCE_KEY_PATTERN，
// 读写路径在两种模式下都应工作。
