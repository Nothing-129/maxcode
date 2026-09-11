import type { ElementType, ReactNode } from "react"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { source } from "./contract-source"

const { measureItem } = vi.hoisted(() => ({ measureItem: vi.fn() }))

vi.mock("use-stick-to-bottom", () => ({
  useStickToBottomContext: () => ({ scrollRef: { current: null } }),
}))
vi.mock("@/components/ai-elements/message-thread", () => ({
  MessageThreadContent: ({ children }: { children: ReactNode }) => children,
}))
vi.mock("virtua", async () => {
  const { Children } = await import("react")
  return {
    Virtualizer: ({
      children,
      item: Item = "div",
    }: {
      children: ReactNode
      item?: ElementType
    }) => (
      <div data-testid="virtualizer">
        {Children.toArray(children).map((child, index) => (
          // Model the extra wrapper Virtua owns, including its stacking context
          // and measurement ref. Raising a descendant does NOT raise this box.
          <Item
            key={index}
            ref={measureItem}
            style={{
              contain: "layout style",
              position: "absolute",
              top: index * 80,
              width: "100%",
            }}
          >
            {child}
          </Item>
        ))}
      </div>
    ),
  }
})

import { VirtualizedMessageThread } from "@/components/message/virtualized-message-thread"

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
    expect(row).toMatch(/position:\s*relative;/)
    expect(row).toMatch(/z-index:\s*1;/)
    expect(source("src/components/message/turn-stats.tsx")).toContain(
      "group-hover/turn:opacity-100 focus-within:opacity-100"
    )
  })

  it("puts the interaction layer on Virtua's actual measured item, not a descendant", () => {
    render(
      <VirtualizedMessageThread
        items={["reply", "next-reply"]}
        getItemKey={(item) => item}
        renderItem={(item) => (
          <div>
            <p>{item}</p>
            <div className="maxcode-turn-actions">
              <button>{item} action</button>
            </div>
          </div>
        )}
      />
    )

    const rows = Array.from(screen.getByTestId("virtualizer").children)
    expect(rows).toHaveLength(2)
    rows.forEach((row, index) => {
      expect(row).toHaveClass("maxcode-thread-item")
      expect(row).toHaveStyle({
        contain: "layout style",
        position: "absolute",
        top: `${index * 80}px`,
        width: "100%",
      })
      expect(measureItem).toHaveBeenCalledWith(row)
      const column = row.querySelector(".maxcode-chat-column")
      expect(column).toHaveClass("group/turn")
      expect(column).toHaveAttribute("data-thread-tail", String(index === 1))
      expect(column).toContainElement(row.querySelector("button"))
    })
  })

  it("keeps portalled tooltips from hiding or lowering their owning actions", () => {
    const css = source("src/app/globals.css")
    const openActions = css.match(
      /\.maxcode-turn-actions:has\(\[data-slot="tooltip-trigger"\]\[data-state\$="-open"\]\)\s*\{([^}]+)\}/
    )?.[1]
    expect(openActions).toMatch(/opacity:\s*1;/)
    const openItem = css.match(
      /\.maxcode-thread-item:has\(\s*\.maxcode-turn-actions \[data-slot="tooltip-trigger"\]\[data-state\$="-open"\]\s*\),\s*\.maxcode-thread-item:has\(\.maxcode-chat-column:hover\)\s*\{([^}]+)\}/
    )?.[1]
    expect(openItem).toMatch(/z-index:\s*2;/)
    // Both delayed pointer entry and immediate/focus entry use this marker.
    for (const state of ["delayed-open", "instant-open"]) {
      const trigger = document.createElement("button")
      trigger.dataset.slot = "tooltip-trigger"
      trigger.dataset.state = state
      expect(
        trigger.matches('[data-slot="tooltip-trigger"][data-state$="-open"]')
      ).toBe(true)
      trigger.dataset.state = "closed"
      expect(trigger.matches('[data-state$="-open"]')).toBe(false)
    }
  })

  it("raises hovered items above later focused items without making the padding a hover trigger", () => {
    const css = source("src/app/globals.css")
    const focus = css.match(
      /\.maxcode-thread-item:focus-within\s*\{([^}]+)\}/
    )?.[1]
    const hover = css.match(
      /\.maxcode-thread-item:has\(\.maxcode-chat-column:hover\)\s*\{([^}]+)\}/
    )?.[1]
    expect(focus).toMatch(/z-index:\s*1;/)
    expect(hover).toMatch(/z-index:\s*2;/)
    // Hovering the next item's transparent top padding must not raise it over
    // the preceding reply's buttons (which extend into that same gutter).
    expect(css).not.toMatch(/\.maxcode-thread-item:hover/)
  })
})
