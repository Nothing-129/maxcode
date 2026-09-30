import { describe, expect, it } from "vitest"

import { source, sourceExists } from "./contract-source"

const registry = source("src-tauri/src/acp/registry.rs")
const connection = source("src-tauri/src/acp/connection.rs")
const agentModel = source("src-tauri/src/models/agent.rs")
const parsers = source("src-tauri/src/parsers/mod.rs")
const parserFile = source("src-tauri/src/parsers/zcode.rs")
const maintained = source("src/lib/maintained-agents.ts")
const types = source("src/lib/types.ts")

/**
 * Downstream contract for ZCode's community ACP integration. MaxCode uses
 * william0wang/zcode-acp through its reviewed npm release, while retaining
 * its own agent identity, history parser, preflight and title behavior.
 *
 *  - the zcode-acp-server npm package and executable, requiring Node 22
 *  - the separately installed vendor runtime (`zcode app-server --stdio`)
 *  - history aggregation from ZCode's single SQLite session store
 *  - structured auto-titles and the theme-aware ZCode icon
 */

describe("MaxCode contract: ZCode agent (community npm ACP adapter)", () => {
  it("is a maintained built-in with the zcode wire name", () => {
    expect(agentModel).toContain("AgentType::Zcode,")
    expect(agentModel).toContain('AgentType::Zcode => Cow::Borrowed("zcode")')
    expect(agentModel).toContain('"zcode" => Some(AgentType::Zcode)')
    expect(registry).toContain("AgentType::Zcode")
    expect(registry).toMatch(/is_maintained_agent[\s\S]*AgentType::Zcode/)
    expect(maintained).toContain('"zcode"')
    expect(types).toMatch(/\|\s*"zcode"/)
  })

  it("uses the same structured auto-title refine as the other maintained agents", () => {
    const titles = source("src-tauri/src/session_title.rs")
    const support = titles
      .split("pub fn supports_dedicated_auto_title")[1]
      .split("pub async fn kickoff_auto_title")[0]
    expect(support).toContain("AgentType::Zcode")
    const tests = source("src-tauri/src/session_title_tests.rs")
    expect(tests).toContain("AgentType::Zcode")
  })

  it("installs the reviewed community npm adapter with its Node requirement", () => {
    const start = registry.indexOf("AgentType::Zcode => AcpAgentMeta {")
    const end = registry.indexOf("AgentType::Custom(_) => unreachable!", start)
    expect(start).toBeGreaterThan(-1)
    const entry = registry.slice(start, end)
    expect(entry).toContain("AgentDistribution::Npx")
    expect(entry).toContain('version: "0.53.2"')
    expect(entry).toContain('package: "zcode-acp-server@0.53.2"')
    expect(entry).toContain('cmd: "zcode-acp-server"')
    expect(entry).toContain('node_required: Some("22.0.0")')
    expect(entry).toContain('("ZCODE_ACP_MODE", "build")')
    expect(entry).toContain("supports_mcp: true")
    expect(entry).not.toContain("AgentDistribution::Bundled")
  })

  it("retires the embedded translator so installs use the community package", () => {
    expect(sourceExists("src-tauri/src/acp/adapters/zcode-acp.mjs")).toBe(false)
    expect(registry).not.toContain('include_str!("adapters/zcode-acp.mjs")')
  })

  it("preserves launch overrides, model selections and reasoning during migration", () => {
    for (const regression of [
      "zcode_legacy_launch_settings_preserve_model_and_reasoning",
      "zcode_legacy_model_reasoning_becomes_a_session_preference",
      "zcode_modern_settings_win_over_legacy_aliases",
      "zcode_invalid_legacy_overrides_keep_safe_defaults",
    ]) {
      expect(connection).toContain(`fn ${regression}()`)
    }
  })

  it("confirms the intended mode on new sessions despite lazy adapter defaults", () => {
    for (const regression of [
      "zcode_new_session_mode_uses_saved_choices_before_launch_defaults",
      "zcode_new_session_confirms_mode_even_when_lazy_advertisement_matches",
    ]) {
      expect(connection).toContain(`fn ${regression}()`)
    }
  })

  it("gates incompatible ZCode forks while preserving other agents' capabilities", () => {
    for (const regression of [
      "zcode_fork_is_disabled_for_the_incompatible_adapter_response",
      "session_fork_capability_remains_advertisement_gated_for_other_agents",
    ]) {
      expect(connection).toContain(`fn ${regression}()`)
    }
  })

  it("keeps runtime storage and bridge aliases under the selected data root", () => {
    expect(connection).toContain("prepare_zcode_storage_env(&mut env)")
    for (const regression of [
      "zcode_storage_env_aligns_native_storage_with_the_bridge_root",
      "zcode_storage_env_maps_legacy_root_and_treats_empty_home_as_automatic",
      "zcode_storage_env_preserves_explicit_storage_and_database_overrides",
      "zcode_storage_env_keeps_native_defaults_without_a_selected_root",
    ]) {
      expect(connection).toContain(`fn ${regression}()`)
    }
  })

  it("shows confirmed modes and reports rejected changes after connect and restore", () => {
    expect(connection).toContain(
      "fn zcode_mode_changes_and_restored_preferences_use_confirmed_config_values()"
    )
  })

  it("gates Plan until the adapter reports its separate native execution flag", () => {
    for (const regression of [
      "zcode_plan_requests_never_reach_the_adapter",
      "zcode_plan_filter_preserves_other_agents_modes",
      "zcode_mode_changes_and_restored_preferences_use_confirmed_config_values",
    ]) {
      expect(connection).toContain(`fn ${regression}()`)
    }
    expect(connection).toContain("planEnabled")
    expect(connection).toContain("ZCode Plan mode is unavailable")
  })

  it("shows ZCode configuration guidance in its own settings branch", () => {
    const settings = source("src/components/settings/acp-agent-settings.tsx")
    const start = settings.indexOf('selectedAgent.agent_type === "zcode" ? (')
    const end = settings.indexOf(") : isCustomAgentType(", start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const panel = settings.slice(start, end)
    expect(panel).toContain('title={t("zcode.configManagement")}')
    expect(panel).toContain('description={t("zcode.configDescription")}')
    expect(panel).not.toContain("<Textarea")
    expect(panel).not.toContain('t("configManagement")')
  })

  it("aggregates history from the ZCode SQLite session store", () => {
    expect(parsers).toContain("pub mod zcode;")
    expect(parsers).toContain(
      "AgentType::Zcode => Box::new(zcode::ZcodeParser::new())"
    )
    expect(parserFile).toMatch(
      /join\("cli"\)\s*\.join\("db"\)\s*\.join\("db.sqlite"\)/
    )
    expect(parserFile).toContain("ZCODE_DATA_BASE_DIR")
    // The store is read-only: the live CLI owns checkpointing.
    expect(parserFile).toContain("SQLITE_OPEN_READ_ONLY")
    // AI-SDK part vocabulary the decode is built around.
    for (const partType of [
      '"text"',
      '"reasoning"',
      '"tool"',
      '"step-finish"',
    ]) {
      expect(parserFile).toContain(partType)
    }
  })

  it("resolves community ACP aliases against the same configurable data root", () => {
    expect(parserFile).toContain('std::env::var_os("ZCODE_HOME")')
    expect(parserFile).toContain('join("v2").join("acp-lazy-sessions.json")')
    expect(parserFile).toContain('get("zcodeSid")')
    expect(parserFile).toContain("resolve_session_alias(conversation_id)")
    expect(parserFile).toContain(
      "lazy_acp_alias_loads_native_history_without_changing_list_ids"
    )
    expect(parserFile).toContain(
      "missing_corrupt_or_cyclic_aliases_are_not_found_without_hiding_native_history"
    )
  })

  it("preserves native assistant model metadata and failed tool results", () => {
    for (const regression of [
      "native_assistant_model_fields_survive_history_and_list_parsing",
      "native_tool_errors_retain_failure_status_and_error_text",
    ]) {
      expect(parserFile).toContain(`fn ${regression}()`)
    }
  })

  it("keeps native image history with bounded session-local artifact reads", () => {
    for (const regression of [
      "native_image_only_turn_keeps_data_urls_and_session_artifacts",
      "image_history_bounds_reads_and_keeps_unavailable_attachment_placeholders",
      "image_artifacts_do_not_follow_file_or_session_directory_symlinks",
    ]) {
      expect(parserFile).toContain(`fn ${regression}()`)
    }
    expect(parserFile).toContain(
      "ZCODE_MAX_INLINE_IMAGE_BYTES: usize = 8 * 1024 * 1024"
    )
  })

  it("declares the vendor-CLI adapter split for preflight", () => {
    expect(registry).toMatch(
      /AgentType::Zcode => Some\(AcpAdapterRelation \{[\s\S]*native_cmd: "zcode"/
    )
    expect(registry).toMatch(
      /AgentType::Zcode => Some\(AcpAdapterRelation \{[\s\S]*shared_config_dir: "~\/\.zcode"/
    )
  })

  it("paints the official Z mark with currentColor so it stays visible in both themes", () => {
    const icon = source("src/components/agent-icon.tsx")
    const start = icon.indexOf("const ZcodeMonoIcon")
    const end = icon.indexOf("const COLOR_ICONS")
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const mark = icon.slice(start, end)
    expect(mark).toContain('fill="currentColor"')
    expect(mark).toContain("ZCODE_Z_PATH")
    expect(mark).not.toContain("linearGradient")
    expect(icon).toContain("zcode: ZcodeMonoIcon")
    expect(icon).not.toContain("zcode: ZcodeColorIcon")
  })
})
