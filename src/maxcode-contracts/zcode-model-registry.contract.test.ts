import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const connection = readFileSync(
  resolve(process.cwd(), "src-tauri/src/acp/connection.rs"),
  "utf8"
)

describe("ZCode model registry compatibility", () => {
  it("projects the legacy BigModel choices onto the confirmed registry provider", () => {
    expect(connection).toContain("fn normalize_zcode_model_options(")
    expect(connection).toContain('strip_prefix("builtin:bigmodel\\\\")')
    expect(connection).toContain('format!("bigmodel-api\\\\{model}")')
    expect(connection).toContain("normalize_zcode_model_options(&mut mapped)")
    expect(connection).toContain(
      "zcode_model_selector_uses_registry_ids_for_legacy_bigmodel_choices"
    )
  })

  it("sends the normalized choice on explicit switches and saved preference replay", () => {
    expect(connection).toContain(
      "zcode_supported_model_value(&offered, &value_id)"
    )
    expect(connection).toContain(
      "zcode_supported_model_value(projected, requested_value)"
    )
    expect(connection).toContain("let zcode_model_offered =")
    expect(connection).toContain(
      "let confirmed_options = state.read().await.config_options.clone()"
    )
  })
})
