import { expect, it } from "vitest"
import { source } from "./contract-source"

it("registers executable Codex AGENTS context compatibility contracts", () => {
  expect(source("src-tauri/src/parsers/codex.rs")).toContain(
    "mod maxcode_codex_agents_context_contract;"
  )
  const contract = source(
    "src/maxcode-contracts/codex-agents-context.contract.rs"
  )
  expect(contract).toContain(
    "fn agents_context_without_workspace_suffix_stays_hidden()"
  )
  expect(contract).toContain("fn ordinary_agents_questions_are_preserved()")
})
