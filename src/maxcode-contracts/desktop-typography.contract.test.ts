import { describe, expect, it } from "vitest"
import { source } from "./contract-source"
import { DEFAULT_CHAT_FONT_SIZE, SANS_FALLBACK } from "@/lib/font-presets"

describe("MaxCode desktop typography", () => {
  it("keeps system UI deterministic without an unbundled preferred font", () => {
    expect(SANS_FALLBACK.startsWith("-apple-system")).toBe(true)
    expect(source("src/app/globals.css")).not.toContain('"OpenAI Sans"')
  })
  it("uses the saved chat size in both the message shell and its text", () => {
    expect(source("src/app/globals.css")).toContain(
      ".chat-message-shell,\n.chat-message-text {"
    )
    const message = source("src/components/ai-elements/message.tsx")
    expect(message).toContain("chat-message-shell")
    expect(message).not.toContain("group-[.is-assistant]:text-base")
    expect(message).not.toContain("group-[.is-user]:leading-6")
  })
  it("keeps chat compact without scaling the interface or retaining list padding", () => {
    expect(DEFAULT_CHAT_FONT_SIZE).toBe(14)
    const css = source("src/app/globals.css")
    const body = css.match(
      /\.chat-message-shell,\s*\.chat-message-text\s*\{([^}]+)\}/
    )?.[1]
    expect(body).toContain("line-height: 1.625")
    expect(body).toContain("font-weight: 430")
    expect(body).toContain("color: #1a1c1f")
    expect(body).toContain("var(--chat-font-size, 0.875rem)")
    const item = css.match(/\.chat-message-text li\s*\{([^}]+)\}/)?.[1]
    expect(item).toContain("padding-block: 0")
    expect(item).toContain("margin-block: 0")
  })
  it("aligns sidebar folder and conversation labels, with smaller section labels", () => {
    for (const file of [
      "sidebar-folder-group-header",
      "sidebar-conversation-card",
    ]) {
      expect(source(`src/components/conversations/${file}.tsx`)).toContain(
        "text-[0.875rem] leading-[1.375rem] font-[430]"
      )
    }
    expect(
      source("src/components/conversations/sidebar-section-header.tsx")
    ).toContain("text-xs leading-5 font-normal")
  })
  it("aligns wrapped list text and removes Streamdown's paragraph-to-list gap", () => {
    const css = source("src/app/globals.css")
    const list = css.match(
      /\.chat-message-text :is\(ul, ol\)\s*\{([^}]+)\}/
    )?.[1]
    expect(list).toContain("list-style-position: outside")
    expect(list).toContain("padding-inline-start: 1.625em")
    expect(list).toContain("margin-block: 0")
    const item = css.match(/\.chat-message-text li\s*\{([^}]+)\}/)?.[1]
    expect(item).toContain("padding-inline-start: 0.375em")
    const paragraph = css.match(
      /\.chat-message-text \.chat-markdown > p\s*\{([^}]+)\}/
    )?.[1]
    expect(paragraph).toContain("margin: 0 0 0.25em")
    expect(source("src/components/ai-elements/message.tsx")).toContain(
      "chat-markdown size-full"
    )
  })
  it("keeps loose list paragraphs distinct without detaching their markers", () => {
    const css = source("src/app/globals.css")
    const paragraph = css.match(/\.chat-message-text li > p\s*\{([^}]+)\}/)?.[1]
    expect(paragraph).toContain("display: block")
    expect(paragraph).toContain("margin-block: 0")
    const nextParagraph = css.match(
      /\.chat-message-text li > p \+ p\s*\{([^}]+)\}/
    )?.[1]
    expect(nextParagraph).toContain("margin-top: 1em")
  })
})
