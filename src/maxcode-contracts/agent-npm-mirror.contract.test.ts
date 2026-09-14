import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8")

describe("MaxCode agent npm registry", () => {
  it("keeps install and metadata traffic on the same mirror", () => {
    expect(source("src-tauri/src/acp/mod.rs")).toContain(
      'pub const AGENT_NPM_REGISTRY: &str = "https://npm.aifalao.net"'
    )
    const install = source("src-tauri/src/commands/acp.rs")
    expect(install).toContain('format!("--registry={AGENT_NPM_REGISTRY}")')
    expect(install).toContain("args.push(&registry_arg)")
    expect(install).toContain("retry_args.push(&registry_arg)")
    expect(install).toContain(
      "install_npm_to_user_prefix_streaming(package, &registry_arg, task_id, emitter)"
    )
    expect(install).toContain(
      "$ npm install -g {NPM_INCLUDE_OPTIONAL} {registry_arg} {package}"
    )
    const updates = source("src-tauri/src/commands/agent_updates.rs")
    expect(updates).toContain("reqwest::Url::parse(AGENT_NPM_REGISTRY)")
    const custom = source("src-tauri/src/commands/custom_agents.rs")
    expect(custom).toContain("let registry = crate::acp::AGENT_NPM_REGISTRY")
    expect(custom).toContain("{registry}/{name}/{v}")
    expect(custom).toContain("{registry}/{name}/latest")
    for (const code of [install, updates, custom]) {
      expect(code).not.toContain("registry.npmjs.org")
    }
  })
})
