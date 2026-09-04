import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: Grok custom endpoint precedence", () => {
  it("keeps a native custom default ahead of a stale saved model", () => {
    const connection = source("src-tauri/src/acp/connection.rs")
    const grokParser = source("src-tauri/src/parsers/grok.rs")

    expect(grokParser).toContain(
      "grok_custom_default_model_from_config_toml"
    )
    expect(grokParser).toContain(
      '.get("model")?\n        .as_table()?\n        .get(id)?'
    )
    expect(connection).toContain("grok_model_preference_for_connect(")
    expect(connection).toContain(
      "configured_custom_default\n        .or(saved_preference)"
    )
    expect(connection).toContain(
      "Grok custom default '{configured}' overrides stale saved model"
    )
  })
})
