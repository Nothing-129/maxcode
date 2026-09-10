import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("historical message action hover continuity", () => {
  it("covers the gap and buttons without consuming extra message spacing", () => {
    const css = source("src/app/globals.css")
    const row = css.match(
      /\.maxcode-chat-column\[data-thread-tail="false"\] \.maxcode-turn-actions\s*\{([^}]+)\}/
    )?.[1]
    expect(row).toBeDefined()
    // 8px of hoverable padding + 24px buttons, offset in layout only.
    expect(row).toMatch(/height:\s*2rem;/)
    expect(row).toMatch(/padding-top:\s*0\.5rem;/)
    expect(row).toMatch(/margin-top:\s*0;/)
    expect(row).toMatch(/margin-bottom:\s*-2rem;/)
    expect(row).not.toMatch(/(?:^|[;\n])\s*top:/)
    // The next virtual row starts within the gutter: its padding must not
    // intercept clicks on the bottom half of these buttons.
    expect(row).toMatch(/position:\s*relative;/)
    expect(row).toMatch(/z-index:\s*1;/)
    const thread = source(
      "src/components/message/virtualized-message-thread.tsx"
    )
    expect(thread).toContain("mx-auto maxcode-chat-column px-4 group/turn")
    expect(source("src/components/message/turn-stats.tsx")).toContain(
      "group-hover/turn:opacity-100 focus-within:opacity-100"
    )
  })
})
