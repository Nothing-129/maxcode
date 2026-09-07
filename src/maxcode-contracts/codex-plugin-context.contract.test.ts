import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: injected Codex plugin context stays hidden", () => {
  it("filters transcript promotion and title selection with the same rule", () => {
    const parser = source("src-tauri/src/parsers/codex.rs")
    expect(parser).toContain('starts_with("<recommended_plugins>")')
    for (const name of [
      "is_promotable_user_text",
      "extract_codex_title_candidate",
    ]) {
      const body = parser.slice(parser.indexOf(`fn ${name}(`)).split("\nfn ")[0]
      expect(body).toContain("is_recommended_plugins_message(trimmed)")
    }
    expect(parser).toContain(
      "fn recommended_plugins_context_never_becomes_a_turn_or_title()"
    )
  })
})
