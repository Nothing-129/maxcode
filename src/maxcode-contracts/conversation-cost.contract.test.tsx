import { render, renderHook, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { source } from "./contract-source"
import {
  estimateConversationCost,
  formatConversationCost,
  resolveCostModel,
} from "@/lib/conversation-cost"
import {
  ComposerCostEstimate,
  useComposerCostEstimate,
} from "@/components/chat/composer-cost-estimate"
import type {
  ConversationBillingUsage,
  OpenCodeCatalogModel,
  OpenCodeCatalogProvider,
} from "@/lib/types"

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
const fetchCatalog = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api", () => ({ opencodeProviderCatalog: fetchCatalog }))
const model: OpenCodeCatalogModel = {
  id: "claude-test",
  name: "Test",
  reasoning: false,
  tool_call: true,
  context: 200000,
  cost_in: 3,
  cost_out: 15,
  cost_cache_read: 0.3,
  cost_cache_write: 3.75,
}
const provider: OpenCodeCatalogProvider = {
  id: "anthropic",
  name: "Anthropic",
  auth_kind: "api",
  npm: null,
  env: [],
  doc: null,
  models: [model],
}
const bucket: ConversationBillingUsage = {
  model: "claude-test",
  usage: {
    input_tokens: 1000,
    output_tokens: 500,
    cache_read_input_tokens: 200,
    cache_creation_input_tokens: 100,
  },
}

describe("MaxCode: conversation cost, CC Switch accounting reference", () => {
  it.each([null, []])(
    "hides the inline cost without billing data: %s",
    (buckets) => {
      const { result } = renderHook(() => useComposerCostEstimate(buckets))
      expect(result.current.inlineValue).toBeNull()
    }
  )

  it("hides the inline cost while loading and when prices are missing", async () => {
    fetchCatalog.mockResolvedValueOnce([])
    const { result } = renderHook(() => useComposerCostEstimate([bucket]))
    expect(result.current.inlineValue).toBeNull()
    await waitFor(() => expect(result.current.value).toBe("--"))
    expect(result.current.inlineValue).toBeNull()
  })

  it("hides the inline cost after a catalog failure", async () => {
    fetchCatalog.mockRejectedValueOnce(new Error("offline"))
    const { result } = renderHook(() => useComposerCostEstimate([bucket]))
    await waitFor(() => expect(result.current.value).toBe("--"))
    expect(result.current.inlineValue).toBeNull()
  })

  it("gates the entire inline cost group including its separator", () => {
    const usage = source("src/components/chat/composer-context-usage.tsx")
    expect(usage).toMatch(
      /cost\.inlineValue != null && \(\s*<span\s*data-composer-cost-group/
    )
  })

  it.each([
    [0.2867, "$0.29"],
    [1.2, "$1.20"],
    [0, "$0.00"],
    [0.00001, "$0.00"],
  ])("shows two decimal places inline for %s USD", async (usd, expected) => {
    fetchCatalog.mockResolvedValueOnce([
      { ...provider, models: [{ ...model, cost_in: usd }] },
    ])
    const { result } = renderHook(() =>
      useComposerCostEstimate([
        {
          model: model.id,
          usage: {
            input_tokens: 1000000,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      ])
    )
    await waitFor(() => expect(result.current.inlineValue).toBe(expected))
  })

  it("matches the reference's fresh-input example without subtracting cache twice", () => {
    expect(estimateConversationCost([bucket], [provider])).toEqual({
      usd: 0.010935,
      complete: true,
      missingModels: [],
    })
    expect(
      estimateConversationCost(
        Array.from({ length: 1000 }, () => bucket),
        [provider]
      ).usd
    ).toBe(10.935)
  })

  it("sums mixed models and uses an explicit reseller before the publisher", () => {
    const reseller = {
      ...provider,
      id: "reseller",
      models: [{ ...model, cost_in: 6 }],
    }
    const result = estimateConversationCost(
      [bucket, { ...bucket, model: "reseller/claude-test" }],
      [provider, reseller]
    )
    expect(result.usd).toBe(0.02487)
    expect(resolveCostModel("claude-test-20260909", [provider])).toEqual(model)
    expect(resolveCostModel("unknown/claude-test", [provider])).toBeNull()
    expect(resolveCostModel("claude-test", [reseller])).toBeNull()
  })

  it("distinguishes missing prices, partial estimates, real zero prices and zero-token buckets", () => {
    const partial = estimateConversationCost(
      [bucket, { ...bucket, model: "missing" }],
      [provider]
    )
    expect(partial).toEqual({
      usd: 0.010935,
      complete: false,
      missingModels: ["missing"],
    })
    expect(
      estimateConversationCost(
        [bucket],
        [{ ...provider, models: [{ ...model, cost_cache_read: null }] }]
      ).usd
    ).toBeNull()
    expect(
      estimateConversationCost(
        [bucket],
        [
          {
            ...provider,
            models: [
              {
                ...model,
                cost_in: 0,
                cost_out: 0,
                cost_cache_read: 0,
                cost_cache_write: 0,
              },
            ],
          },
        ]
      ).usd
    ).toBe(0)
    expect(estimateConversationCost([], [provider]).usd).toBeNull()
    expect(
      estimateConversationCost(
        [
          {
            ...bucket,
            usage: { ...bucket.usage, cache_creation_input_tokens: 0 },
          },
        ],
        [{ ...provider, models: [{ ...model, cost_cache_write: undefined }] }]
      ).complete
    ).toBe(true)
  })

  it("does not render tiny positive charges as free", () => {
    expect(formatConversationCost(0.0000002)).toBe("< $0.0001")
    expect(formatConversationCost(0)).toBe("$0.0000")
    expect(formatConversationCost(0.010935)).toBe("$0.0109")
  })

  it("shows the USD estimate and the basis in the popover", async () => {
    fetchCatalog.mockResolvedValueOnce([provider])
    render(<ComposerCostEstimate buckets={[bucket]} />)
    expect(await screen.findByText("$0.0109")).toBeTruthy()
    expect(screen.getByText("costBasis")).toBeTruthy()
  })

  it("reports partial pricing rather than silently claiming a complete total", async () => {
    fetchCatalog.mockResolvedValueOnce([provider])
    render(
      <ComposerCostEstimate buckets={[bucket, { ...bucket, model: null }]} />
    )
    expect(await screen.findByText("$0.0109")).toBeTruthy()
    expect(screen.getByText("estimatedPartialCost")).toBeTruthy()
    expect(screen.getByText("costIncomplete")).toBeTruthy()
  })

  it("handles a failed catalog fetch without breaking usage details", async () => {
    fetchCatalog.mockRejectedValueOnce(new Error("offline"))
    render(<ComposerCostEstimate buckets={[bucket]} />)
    expect(await screen.findByText("--")).toBeTruthy()
  })

  it("computes full-transcript buckets before pagination and carries cache rates", () => {
    const backend = source("src-tauri/src/commands/conversations.rs")
    expect(/billing_usage_from_detail\(\s*&detail,?\s*\)/.test(backend)).toBe(
      true
    )
    const catalog = source("src-tauri/src/acp/opencode_catalog.rs")
    expect(catalog).toContain('v.get("cache_read")')
    expect(catalog).toContain('v.get("cache_write")')
    expect(catalog).toContain("models-dev-pricing-v2.json")
    expect(source("src/components/chat/composer-context-usage.tsx")).toContain(
      "<ComposerCostDetails"
    )
  })
})
