# Conversation cost estimates

The composer status row shows the USD estimate beside the token/context
indicator without opening a popover. Expanded usage details share the same
calculation and catalog request. Both use recorded, full-transcript usage. History pagination never limits its accounting scope. Input, output,
cache reads and cache writes are priced separately, then summed by model.
The parsers already expose fresh input excluding cache, so no cache subtraction
is performed again by the estimator. Codex turn contexts preserve each turn's
model across switches.

The accounting approach was reviewed against CC Switch v3.20.2, commit
`f3b18df12007d0fd79fd8ad8d310880664015197`:

- https://github.com/farion1231/cc-switch/blob/v3.20.2/src-tauri/src/proxy/usage/calculator.rs
- https://github.com/farion1231/cc-switch/blob/v3.20.2/src-tauri/src/services/usage_stats.rs

This implementation uses fixed-point BigInt arithmetic until display rounding,
independently implemented for the frontend's normalized usage model. The bundled
models.dev snapshot was supplemented with cache prices on 2026-09-09. Online
catalog refresh and offline fallback reuse the existing provider catalog. The
cache filename is versioned so pre-pricing caches cannot hide missing fields.

## Price basis and limits

- models.dev standard input/output/cache prices, USD per million tokens.
- Explicit provider/model names select that provider. Unqualified OpenAI,
  Anthropic, Google, DeepSeek and xAI names select publisher rates. Ambiguous
  reseller matches and unknown router prefixes are not guessed.
- Exact IDs are preferred; a trailing date or `latest` is removed only for an
  otherwise-unmatched version. No fuzzy prefix matching across model families.
- Like the reference's flat model-pricing calculation, this is a **standard-rate
  estimate**, not a tier-aware invoice. Tiered/long-context pricing, subscriptions,
  service tiers, provider multipliers and negotiated discounts are excluded and
  disclosed in the UI. Publisher-rate estimates can differ from reseller bills.
- Unknown model/cache prices remain unknown. Partial estimates show a known
  subtotal, not a complete total. Missing session-total usage is kept in an
  unknown-model bucket. Zero usage does not require a price; zero price is distinct
  from missing price. Tiny positive amounts never display as free.
- Where a parser has no per-turn model, its session model remains the fallback.
  Historical pricing changes are not replayed: catalog prices are current, not
  necessarily those in effect when the transcript was recorded.
- Only recorded tokens are priced; no cost is invented from live text length.

Contract: `src/maxcode-contracts/conversation-cost.contract.test.tsx`.
