import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

const parser = source("src-tauri/src/parsers/codex.rs")
const production = parser.slice(0, parser.indexOf("#[cfg(test)]"))

function between(start: string, end: string): string {
  const from = production.indexOf(start)
  const to = production.indexOf(end, from)
  expect(from).toBeGreaterThan(-1)
  expect(to).toBeGreaterThan(from)
  return production.slice(from, to)
}

describe("MaxCode contract: backend Codex MCP history recovery", () => {
  it("uses existing tool blocks with their own ids, arguments and outcomes", () => {
    const recovery = between(
      "fn unwrap_completed_mcp_calls(",
      "/// What the renderer needs to know"
    )
    expect(recovery).toContain("script.tool_names.len() != completed.len()")
    expect(recovery).toContain("if !names_match")
    expect(recovery).toContain("tool_use_id: Some(item.id.clone())")
    expect(recovery).toContain("input_preview: item.input_preview")
    expect(recovery).toContain(
      'if item.is_error { "failed" } else { "completed" }'
    )
    expect(recovery).toContain("is_error: item.is_error")
    expect(recovery).toContain("agent_stats: None")
    expect(recovery).toContain("meta: None")
    expect(
      production.match(/parsed.status == ScriptStatus::Completed/g)
    ).toHaveLength(2)
  })

  it("bounds binary previews without truncating the evidence of failure", () => {
    const completed = between(
      "fn completed_mcp_call(",
      "fn unwrap_completed_mcp_calls("
    )
    expect(production).toContain("MCP_RESULT_FALLBACK_CAP: usize = 4000")
    expect(completed).toContain("stated_is_error == Some(true)")
    expect(completed).toContain("!claimed_ok")
    expect(completed).toContain("blocks_report_failure(blocks)")
    expect(completed).toContain(".filter(|block| block.is_object())")
    expect(completed).toContain("infer_output_value_is_error(block, 4)")
    expect(completed).toContain(
      "serialize_preview(content, MCP_RESULT_FALLBACK_CAP)"
    )
  })

  it("retains MaxCode billing, elapsed time and injected-context filtering", () => {
    expect(production).toContain("model: model.clone()")
    expect(production).toContain(
      "backfill_turn_durations(&mut turns, turn_starts)"
    )
    expect(production).toContain("is_recommended_plugins_message(trimmed)")
    expect(parser).toContain(
      "fn maxcode_semantic_mcp_preserves_billing_timing_and_context_filtering()"
    )
    expect(parser).toContain(
      "fn maxcode_semantic_mcp_keeps_existing_native_spawn_identity()"
    )
    expect(parser).toContain(
      "fn billing_preserves_models_across_codex_turn_context_changes()"
    )
    expect(parser).toContain(
      "fn recommended_plugins_context_never_becomes_a_turn_or_title()"
    )
  })
})
