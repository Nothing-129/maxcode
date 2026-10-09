import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ComposerContextUsage } from "@/components/chat/composer-context-usage"
import type { SessionStats, SessionUsageUpdateInfo } from "@/lib/types"

const state = vi.hoisted(() => ({
  stats: {
    total_usage: {
      input_tokens: 3500,
      output_tokens: 715,
      cache_read_input_tokens: 318000,
      cache_creation_input_tokens: 0,
    },
    total_tokens: 322215,
    context_window_used_tokens: 55000,
    context_window_max_tokens: 258400,
    context_window_usage_percent: 21.3,
    total_duration_ms: 0,
  } as SessionStats,
  connection: undefined as { usage: SessionUsageUpdateInfo } | undefined,
}))
const originalStats = structuredClone(state.stats)
const fetchCatalog = vi.hoisted(() => vi.fn(() => new Promise(() => {})))
vi.mock("@/lib/api", () => ({ opencodeProviderCatalog: fetchCatalog }))
beforeEach(() => {
  fetchCatalog.mockClear()
  state.stats = structuredClone(originalStats)
  state.connection = undefined
})

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("@/contexts/acp-connections-context", () => ({
  useConnectionStore: () => ({
    subscribeKey: () => () => {},
    getConnection: () => state.connection,
  }),
}))
vi.mock("@/contexts/tab-context", () => ({ useTabStore: () => 1 }))
vi.mock("@/stores/conversation-runtime-store", () => ({
  useConversationRuntimeStore: (select: (value: unknown) => unknown) =>
    select({
      byConversationId: new Map([
        [
          1,
          {
            sessionStats: state.stats,
            detail: {
              billing_usage: [
                { model: "claude-test", usage: state.stats.total_usage },
              ],
            },
          },
        ],
      ]),
    }),
}))

describe("MaxCode: composer usage popover", () => {
  it("separates context capacity from aligned session totals and fits phone widths", () => {
    render(<ComposerContextUsage tabId="tab-1" />)
    fireEvent.click(screen.getByRole("button"))
    expect(screen.getByRole("dialog")).toHaveClass(
      "w-90",
      "max-w-[calc(100vw-2rem)]",
      "max-h-[var(--radix-popover-content-available-height)]",
      "overflow-y-auto"
    )
    const context = screen.getByRole("region", { name: "contextWindow" })
    expect(context).toHaveTextContent("21.3%")
    expect(context).toHaveTextContent("55K / 258.4K")
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "21.3"
    )
    const tokens = screen.getByRole("region", { name: "tokenUsage" })
    expect(tokens.querySelectorAll("dt")).toHaveLength(6)
    expect(
      Array.from(tokens.querySelectorAll("dd"), (el) => el.textContent)
    ).toEqual(["3.5K", "715", "318K", "0", "98.9%", "322.2K"])
    expect(tokens).toHaveTextContent("sessionUsageNote")
    expect(tokens.querySelector("dl")).toHaveClass("space-y-3")
    expect(tokens.querySelector("dl > div:last-child")).toHaveClass("border-t")
    expect(tokens.querySelectorAll("[data-token-dot]")).toHaveLength(5)
    const segments = tokens.querySelectorAll<HTMLElement>(
      "[data-token-segment]"
    )
    expect(Array.from(segments, (el) => el.dataset.tokenSegment)).toEqual([
      "input",
      "output",
      "cacheRead",
    ])
    expect(parseFloat(segments[2].style.width)).toBeCloseTo(
      (318000 / 322215) * 100
    )
    expect(context.querySelector("[data-token-segment]")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "closeDetails" }))
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("prefers this tab's live context while keeping session totals separate", () => {
    state.connection = { usage: { used: 107400, size: 300000 } }
    render(<ComposerContextUsage tabId="tab-1" />)
    fireEvent.click(screen.getByRole("button"))
    const context = screen.getByRole("region", { name: "contextWindow" })
    expect(context).toHaveTextContent("35.8%")
    expect(context).toHaveTextContent("107.4K / 300K")
    expect(
      screen.getByRole("region", { name: "tokenUsage" })
    ).toHaveTextContent("322.2K")
  })

  it("falls back to recorded context when a synthetic update reports zero used", () => {
    state.connection = { usage: { used: 0, size: 258400 } }
    render(<ComposerContextUsage tabId="tab-1" />)
    fireEvent.click(screen.getByRole("button"))
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "21.3"
    )
  })

  it("shows capacity without inventing category details when tokens are unknown", () => {
    state.stats.total_usage = null
    state.stats.total_tokens = null
    render(<ComposerContextUsage tabId="tab-1" />)
    fireEvent.click(screen.getByRole("button"))
    expect(screen.getByRole("progressbar")).toBeTruthy()
    expect(screen.queryByRole("region", { name: "tokenUsage" })).toBeNull()
    expect(screen.queryByRole("img")).toBeNull()
  })

  it("keeps cumulative statistics available without context capacity", () => {
    state.stats.context_window_used_tokens = null
    state.stats.context_window_max_tokens = null
    state.stats.context_window_usage_percent = null
    render(<ComposerContextUsage tabId="tab-1" />)
    fireEvent.click(screen.getByRole("button"))
    expect(screen.queryByRole("progressbar")).toBeNull()
    expect(screen.getByRole("dialog")).toHaveAccessibleName("sessionTokenUsage")
    expect(
      screen.getByRole("region", { name: "tokenUsage" })
    ).toHaveTextContent("322.2K")
  })
  it("shows cost without opening the popover and shares the same calculation with details", async () => {
    fetchCatalog.mockResolvedValueOnce([
      {
        id: "anthropic",
        models: [
          {
            id: "claude-test",
            cost_in: 3,
            cost_out: 15,
            cost_cache_read: 0.3,
            cost_cache_write: 3.75,
          },
        ],
      },
    ])
    render(<ComposerContextUsage tabId="tab-1" />)
    expect(await screen.findByText("$0.12")).toBeTruthy()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.getByLabelText("estimatedCost: $0.1166")).toHaveAttribute(
      "data-composer-cost"
    )
    fireEvent.click(screen.getByRole("button"))
    expect(screen.getByText("$0.1166")).toBeTruthy()
    expect(screen.getByText("$0.12")).toBeTruthy()
    expect(fetchCatalog).toHaveBeenCalledTimes(1)
  })

  it.each([
    [100, 0, 0, "0.0%"],
    [0, 100, 0, "100.0%"],
    [100, 200, 100, "50.0%"],
    [0, 0, 0, "--"],
  ])(
    "calculates cache rate for input=%s, read=%s, write=%s",
    (input, read, write, expected) => {
      const original = state.stats.total_usage
      state.stats.total_usage = {
        input_tokens: input as number,
        cache_read_input_tokens: read as number,
        cache_creation_input_tokens: write as number,
        output_tokens: 999999,
      }
      try {
        render(<ComposerContextUsage tabId="tab-1" />)
        fireEvent.click(screen.getByRole("button"))
        expect(
          screen.getByText("cacheHitRate").nextElementSibling
        ).toHaveTextContent(expected as string)
      } finally {
        state.stats.total_usage = original
      }
    }
  )
})
