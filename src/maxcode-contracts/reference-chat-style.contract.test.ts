import { describe, expect, it } from "vitest"
import { source } from "./contract-source"
import { DEFAULT_CHAT_FONT_SIZE, SANS_FALLBACK } from "@/lib/font-presets"
import { formatElapsedLabel } from "@/lib/format-elapsed"
import zh from "@/i18n/messages/zh-CN.json"

describe("reference chat presentation", () => {
  it("uses readable system body text and blue padded user bubbles", () => {
    expect(DEFAULT_CHAT_FONT_SIZE).toBe(14)
    expect(SANS_FALLBACK).toContain("PingFang SC")
    const message = source("src/components/ai-elements/message.tsx")
    expect(message).toContain("group-[.is-user]:bg-[#e7f2ff]")
    expect(message).toContain("group-[.is-user]:py-2.5")
    expect(message).toContain("group-[.is-user]:rounded-2xl")
    expect(source("src/app/globals.css")).toContain(".chat-message-text li > p")
    expect(
      source("src/components/message/virtualized-message-thread.tsx")
    ).toContain("gap = 32")
  })
  it("places historical reply actions in the existing gap, but reserves the final row", () => {
    const thread = source(
      "src/components/message/virtualized-message-thread.tsx"
    )
    expect(thread).toContain("data-thread-tail={index === items.length - 1}")
    const css = source("src/app/globals.css")
    const historicalActions = css.match(
      /\.maxcode-chat-column\[data-thread-tail="false"\] \.maxcode-turn-actions\s*\{([^}]+)\}/
    )?.[1]
    expect(historicalActions).toContain("margin-bottom: -2rem")
    expect(historicalActions).toContain("margin-top: 0")
    expect(historicalActions).toContain("padding-top: 0.5rem")
    expect(css).not.toContain('[data-thread-tail="true"] .maxcode-turn-actions')
    const stats = source("src/components/message/turn-stats.tsx")
    expect(stats).toContain("maxcode-turn-actions mt-2")
    expect(stats).toContain(
      "group-hover/turn:opacity-100 focus-within:opacity-100"
    )
  })
  it("keeps the neutral theme from restoring the stronger composer shadow", () => {
    const css = source("src/app/globals.css")
    const chrome = css.slice(
      css.indexOf("/* Neutral light desktop surfaces"),
      css.indexOf("/* Active-session composer")
    )
    expect(chrome).toContain("border-color: rgb(0 0 0 / 6%)")
    expect(chrome).toContain("0 4px 32px rgb(0 0 0 / 1.5%)")
    expect(chrome).not.toContain("0 0 0 1px")
  })
  it.each([
    [18000, "18 秒"],
    [60000, "1 分 0 秒"],
    [228000, "3 分 48 秒"],
    [3661000, "1 小时 1 分 1 秒"],
  ])("formats Chinese elapsed time for %i ms", (ms, expected) => {
    const units = zh.Folder.chat.liveTurnStats
    const duration = formatElapsedLabel(ms, (key, { value }) =>
      units[key].replace("{value}", String(value))
    )
    expect(duration).toBe(expected)
    expect(
      zh.Folder.chat.messageList.workedFor.replace("{duration}", duration)
    ).toBe(`用时 ${expected}`)
  })
  it("retains every setting and external status component with all selectors aligned left", () => {
    const input = source("src/components/chat/message-input.tsx")
    expect(input).toContain("availableConfigOptions.map((option)")
    const selectors = input.slice(
      input.indexOf("const inlineSelectorItems ="),
      input.indexOf("const collapsedSettings =")
    )
    expect(selectors).not.toMatch(/ms-auto|ml-auto|justify-between|flex-1/)
    expect(selectors).toContain('className="flex min-w-0 items-end"')
    for (const control of [
      "InlineSessionConfigToggle",
      "InlineSessionConfigSelector",
      "ModelOptionPicker",
      "InlineModeSelector",
      "ComposerAddMenu",
      "ConversationFolderBranchPicker",
      "ComposerGenerationStats",
      "ComposerContextUsage",
      "ComposerConnectionStatus",
    ]) {
      expect(input).toContain(`<${control}`)
    }
    expect(input).toContain("settings={collapsedSettings}")
    expect(input.indexOf('data-composer-status-row=""')).toBeGreaterThan(
      input.indexOf("</ContextMenu>")
    )
  })
  it("increases conversation density dimensions without changing folder drag geometry", () => {
    const card = source(
      "src/components/conversations/sidebar-conversation-card.tsx"
    )
    expect(card).toContain("group relative flex h-full")
    expect(card).toContain("text-[0.875rem] leading-[1.375rem] font-[430]")
    expect(
      source("src/components/conversations/sidebar-conversation-list.tsx")
    ).toContain("const FOLDER_ROW_HEIGHT = 2 * ((16 * zoomLevel) / 100)")
  })
})
