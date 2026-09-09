import type {
  ConversationBillingUsage,
  OpenCodeCatalogModel,
  OpenCodeCatalogProvider,
} from "@/lib/types"

// Reference: CC Switch v3.20.2 proxy/usage/calculator.rs. Our parser counters
// already exclude cached input, so use them directly; never subtract it twice.
// Fixed-point arithmetic keeps all components exact until display rounding.
const RATE_SCALE = 1_000_000_000n
const USD_SCALE = RATE_SCALE * 1_000_000n

function rateUnits(price: number | null | undefined): bigint | null {
  if (
    price == null ||
    !Number.isFinite(price) ||
    price < 0 ||
    price > 1_000_000
  ) {
    return null
  }
  return BigInt(price.toFixed(9).replace(".", ""))
}

function modelCandidates(id: string): string[] {
  const normalized = id
    .trim()
    .toLowerCase()
    .replace(/^models\//, "")
  return [
    ...new Set([
      normalized,
      normalized.replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2}|latest)$/, ""),
    ]),
  ]
}

/** Explicit provider wins. Bare model names use their publisher's API rate. */
export function resolveCostModel(
  name: string,
  catalog: OpenCodeCatalogProvider[]
): OpenCodeCatalogModel | null {
  const normalized = name.trim().toLowerCase()
  const explicit = catalog.find((p) =>
    normalized.startsWith(`${p.id.toLowerCase()}/`)
  )
  const publisher = /^(?:gpt-|chatgpt-|o[1-9](?:-|$))/.test(normalized)
    ? "openai"
    : normalized.startsWith("claude-")
      ? "anthropic"
      : normalized.replace(/^models\//, "").startsWith("gemini-")
        ? "google"
        : normalized.startsWith("deepseek-")
          ? "deepseek"
          : normalized.startsWith("grok-")
            ? "xai"
            : null
  const provider = explicit ?? catalog.find((p) => p.id === publisher)
  const candidates = modelCandidates(
    explicit ? normalized.slice(explicit.id.length + 1) : normalized
  )
  if (provider) {
    for (const candidate of candidates) {
      const found = provider.models.find(
        (m) =>
          m.id.toLowerCase() === candidate ||
          m.id.toLowerCase() === `${provider.id}/${candidate}`
      )
      if (found) return found
    }
    return null
  }
  // Do not guess the price of an unknown router prefix or choose the first
  // reseller when several providers serve the same unqualified model.
  if (publisher || normalized.includes("/")) return null
  const matches = catalog.flatMap((p) =>
    p.models.filter((m) => m.id.toLowerCase() === normalized)
  )
  return matches.length === 1 ? matches[0] : null
}

export interface ConversationCostEstimate {
  usd: number | null
  complete: boolean
  missingModels: string[]
}

export function estimateConversationCost(
  buckets: ConversationBillingUsage[],
  catalog: OpenCodeCatalogProvider[]
): ConversationCostEstimate {
  let total = 0n
  let priced = false
  const missing = new Set<string>()
  for (const { model, usage } of buckets) {
    const price = model ? resolveCostModel(model, catalog) : null
    const components = [
      [usage.input_tokens, price?.cost_in],
      [usage.output_tokens, price?.cost_out],
      [usage.cache_read_input_tokens, price?.cost_cache_read],
      [usage.cache_creation_input_tokens, price?.cost_cache_write],
    ] as const
    let subtotal = 0n
    let valid = true
    let hasTokens = false
    for (const [tokens, rate] of components) {
      if (tokens === 0) continue
      hasTokens = true
      const units = rateUnits(rate)
      if (!Number.isSafeInteger(tokens) || tokens < 0 || units == null) {
        valid = false
        break
      }
      subtotal += BigInt(tokens) * units
    }
    if (!valid) missing.add(model ?? "unknown")
    else if (hasTokens) {
      total += subtotal
      priced = true
    }
  }
  return {
    usd: priced ? Number(total) / Number(USD_SCALE) : null,
    complete: missing.size === 0 && priced,
    missingModels: [...missing],
  }
}

export function formatConversationCost(usd: number): string {
  if (usd > 0 && usd < 0.0001) return "< $0.0001"
  return `$${usd.toFixed(usd < 1 ? 4 : 2)}`
}
