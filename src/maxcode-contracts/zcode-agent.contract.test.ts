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
      "session/request_permission",
      "session/requestRuntimePreferences",
      "interaction/requestPermission",
    ]) {
      expect(adapter).toContain(method)
    }
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
})
