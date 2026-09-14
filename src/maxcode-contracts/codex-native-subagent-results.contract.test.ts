import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: Codex native subagents keep outcomes, reports and sessions", () => {
  it("normalizes live terminal activity back onto the launch capsule", () => {
    const connection = source("src-tauri/src/acp/connection.rs")
    expect(connection).toContain("async fn settle_codex_subagent_launch(")
    expect(connection).toContain("codex_subagent_launches")
    expect(connection).toContain("CodexSubagentActivity::Terminal")
    expect(connection).toContain("CODEX_SUBAGENT_STATE_KEY")
    expect(connection).toContain('"completed"')
    expect(connection).toContain('"interrupted"')
  })

  it("restores the final report and trims only explicitly marked child replay", () => {
    const parser = source("src-tauri/src/parsers/codex.rs")
    expect(parser).toContain(
      'pub const CODEX_SUBAGENT_STATE_KEY: &str = "__codegCodexSubagentState"'
    )
    expect(parser).toContain("fn trim_subagent_replay_prefix(")
    expect(parser).toContain("subagent_history_start_ordinal")
    expect(parser).toContain("agent_fallback_results")
    expect(parser).toContain("build_collab_list_input")
    expect(parser).toContain(
      "fn native_team_0153_reads_the_nested_subagent_activity()"
    )
    expect(parser).toContain(
      "fn subagent_rollout_drops_the_replayed_parent_history()"
    )
  })

  it("reuses MaxCode agent capsules and the existing child-session viewer", () => {
    const card = source("src/components/message/agent-tool-call.tsx")
    expect(card).toContain("<AgentCapsule")
    expect(card).toContain("CodexSubagentStateBadge")
    expect(card).toContain("SubagentSessionButton")
    expect(card).toContain("<SubagentSessionDialog")
    expect(card).toContain('agentType: "codex"')
    expect(source("src/components/message/collab-agent-card.tsx")).toContain(
      "SubagentSessionButton"
    )
  })
})
