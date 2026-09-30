import { readFileSync } from "node:fs"
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useComposerCostEstimate } from "@/components/chat/composer-cost-estimate"
import { opencodeProviderCatalog } from "@/lib/api"
import type { ConversationBillingUsage } from "@/lib/types"

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("@/lib/api", () => ({ opencodeProviderCatalog: vi.fn() }))

const fetchCatalog = vi.mocked(opencodeProviderCatalog)
const SIX_HOURS = 6 * 60 * 60 * 1000
const buckets: ConversationBillingUsage[] = [
  {
    model: "gpt-6.1-sol",
    usage: {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  },
]
const catalog = (price: number) => [
  {
    id: "openai",
    name: "OpenAI",
    npm: null,
    doc: null,
    auth_kind: "oauth" as const,
    env: [],
    models: [
      {
        id: "gpt-6.1-sol",
        name: "GPT-6.1 Sol",
        reasoning: true,
        tool_call: true,
        context: null,
        cost_in: price,
        cost_out: null,
      },
    ],
  },
]

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(document, "hidden", "get").mockReturnValue(false)
  fetchCatalog.mockReset().mockResolvedValue(catalog(2))
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it("refreshes the mounted estimate every six hours without bypassing the shared cache", async () => {
  const { result, unmount } = renderHook(() => useComposerCostEstimate(buckets))
  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(result.current.inlineValue).toBe("$2.00")
  fetchCatalog.mockResolvedValue(catalog(3))
  await act(() => vi.advanceTimersByTimeAsync(SIX_HOURS - 1))
  expect(fetchCatalog).toHaveBeenCalledTimes(1)
  await act(() => vi.advanceTimersByTimeAsync(1))
  expect(result.current.inlineValue).toBe("$3.00")
  expect(fetchCatalog.mock.calls).toEqual([[], []])
  unmount()
  await act(() => vi.advanceTimersByTimeAsync(SIX_HOURS))
  document.dispatchEvent(new Event("visibilitychange"))
  expect(fetchCatalog).toHaveBeenCalledTimes(2)
})

it("defers background refresh until visible and avoids repeated checks on tab switches", async () => {
  const { unmount } = renderHook(() => useComposerCostEstimate(buckets))
  await act(() => vi.advanceTimersByTimeAsync(0))
  vi.spyOn(document, "hidden", "get").mockReturnValue(true)
  await act(() => vi.advanceTimersByTimeAsync(SIX_HOURS))
  expect(fetchCatalog).toHaveBeenCalledTimes(1)
  vi.spyOn(document, "hidden", "get").mockReturnValue(false)
  await act(async () => document.dispatchEvent(new Event("visibilitychange")))
  expect(fetchCatalog).toHaveBeenCalledTimes(2)
  await act(async () => document.dispatchEvent(new Event("visibilitychange")))
  expect(fetchCatalog).toHaveBeenCalledTimes(2)
  unmount()
})

it("retains existing prices on failure and recovers at the next check", async () => {
  const { result, unmount } = renderHook(() => useComposerCostEstimate(buckets))
  await act(() => vi.advanceTimersByTimeAsync(0))
  fetchCatalog.mockRejectedValueOnce(new Error("offline"))
  await act(() => vi.advanceTimersByTimeAsync(SIX_HOURS))
  expect(result.current.inlineValue).toBe("$2.00")
  fetchCatalog.mockResolvedValue(catalog(4))
  await act(() => vi.advanceTimersByTimeAsync(SIX_HOURS))
  expect(result.current.inlineValue).toBe("$4.00")
  unmount()
})

it("starts showing a new model's cost when pricing arrives without reopening the chat", async () => {
  fetchCatalog.mockResolvedValueOnce([])
  const { result, unmount } = renderHook(() => useComposerCostEstimate(buckets))
  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(result.current.inlineValue).toBeNull()
  await act(() => vi.advanceTimersByTimeAsync(SIX_HOURS))
  expect(result.current.inlineValue).toBe("$2.00")
  unmount()
})

it("keeps the backend cache lifetime aligned with the six-hour UI checks", () => {
  const source = readFileSync("src-tauri/src/acp/opencode_catalog.rs", "utf8")
  expect(source).toMatch(
    /const CACHE_TTL: Duration = Duration::from_secs\(6 \* 60 \* 60\)/
  )
})
