import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

const registry = source("src-tauri/src/acp/registry.rs")
const agentModel = source("src-tauri/src/models/agent.rs")
const parsers = source("src-tauri/src/parsers/mod.rs")
const parserFile = source("src-tauri/src/parsers/zcode.rs")
const adapter = source("src-tauri/src/acp/adapters/zcode-acp.mjs")
const maintained = source("src/lib/maintained-agents.ts")
const types = source("src/lib/types.ts")

/**
 * Downstream contract for the ZCode agent (MaxCode's seventh maintained
 * agent). ZCode speaks the private "ZCode Protocol" — NOT ACP, and Z.ai
 * retired its own non-CLI ACP path — so the entire integration shape below
 * is MaxCode-specific and must survive upstream merges unchanged:
 *
 *  - a bundled translator adapter (AgentDistribution::Bundled) that is
 *    embedded in the binary and materialized at launch, launched with node
 *  - the vendor runtime (`zcode app-server --stdio`) located by the adapter
 *    itself (PATH / desktop app bundle / ~/.local/bin), never downloaded
 *  - history aggregation from ZCode's single SQLite session store
 *  - permission bridging interaction/requestPermission ⇄
 *    session/request_permission
 */

describe("MaxCode contract: ZCode agent (bundled ACP adapter)", () => {
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

  it("ships as a Bundled adapter pinned inside the registry", () => {
    const start = registry.indexOf("AgentType::Zcode => AcpAgentMeta {")
    const end = registry.indexOf("AgentType::Custom(_) => unreachable!", start)
    expect(start).toBeGreaterThan(-1)
    const entry = registry.slice(start, end)
    expect(entry).toContain("AgentDistribution::Bundled")
    expect(entry).toContain('file: "zcode-acp.mjs"')
    expect(entry).toContain('include_str!("adapters/zcode-acp.mjs")')
    // supports_custom_version must answer false for Bundled: there is no
    // other version to fetch — the adapter advances only with MaxCode.
    expect(registry).toMatch(
      /AgentDistribution::Bundled { \.\. } => false,\s*AgentDistribution::Uvx/
    )
  })

  it("bridges ACP onto the ZCode Protocol methods", () => {
    for (const method of [
      '"session/create"',
      '"session/resume"',
      '"session/send"',
      '"session/subscribe"',
      '"session/stop"',
      '"session/events"',
      '"session/setModel"',
      '"session/setThoughtLevel"',
      '"session/setMode"',
      "session/request_permission",
      "session/requestRuntimePreferences",
      "interaction/requestPermission",
    ]) {
      expect(adapter).toContain(method)
    }
    // The composer's Model/Reasoning pickers ride configOptions in the
    // session/new response (pushes sent before session/new finishes are
    // dropped), sourced deterministically from the create snapshot's
    // `settings` block — not from push timing.
    // Pasted images ride ACP image blocks and are translated to zcode's
    // inline attachment payload (kind/dataBase64), no temp file.
    expect(adapter).toContain("promptCapabilities: {")
    expect(adapter).toContain("image: true")
    expect(adapter).toContain('kind: "image"')
    expect(adapter).toContain("dataBase64: block.data")
    expect(adapter).toContain("applySnapshotSettings")
    expect(adapter).toContain("config_option_update")
    expect(adapter).toContain("configOptions: catalog")
    expect(adapter).toContain(
      "applySnapshotSettings(session, created?.settings, { emit: false })"
    )
    expect(adapter).toContain("modes: sessionModesState(session.currentMode)")
    expect(adapter).toContain('sessionUpdate: "current_mode_update"')
    expect(adapter).toContain('id: "mode"')
    expect(adapter).toContain('id: "yolo"')
    expect(adapter).toContain('id: "plan"')
    expect(adapter).toContain('category: "mode"')
    // Initialize must not pay for a synchronous `zcode --version` spawn —
    // that reloads the 14MB desktop bundle and holds the composer on
    // selectorsLoading (send disabled, empty model list) until session/new.
    const initialize = adapter
      .split('acpIncomingHandlers.set("initialize"')[1]
      ?.split("acpIncomingHandlers.set(")[0]
    expect(initialize).toBeTruthy()
    expect(initialize).toContain("ensureZcodeSpawned")
    expect(initialize).not.toContain("queryZcodeVersion")
    // The permission bridge must translate zcode option kinds onto the ACP
    // enum (allow_once / allow_always / reject_once / reject_always).
    expect(adapter).toContain('"allow_once"')
    expect(adapter).toContain('"allow_always"')
    expect(adapter).toContain('"reject_once"')
    // Session ids pass through unmodified so live sessions, the parser and
    // resume line up.
    expect(adapter).toContain("acpSessionId === zcode sessionId")
  })

  it("aggregates history from the ZCode SQLite session store", () => {
    expect(parsers).toContain("pub mod zcode;")
    expect(parsers).toContain(
      "AgentType::Zcode => Box::new(zcode::ZcodeParser::new())"
    )
    expect(parserFile).toContain('join("cli").join("db").join("db.sqlite")')
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
