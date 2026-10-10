import { expect, it } from "vitest"
import { source } from "./contract-source"

it("keeps settings installation probes concurrent and registers executable deadlines", () => {
  const acp = source("src-tauri/src/commands/acp.rs")
  expect(acp).toContain("mod maxcode_settings_agent_probe_deadline_contract;")
  const listing = acp.slice(
    acp.indexOf("async fn acp_list_agents_with_disabled("),
    acp.indexOf("pub(crate) async fn acp_list_agents_core(")
  )
  expect(acp).toContain("futures::future::join_all(probes)")
  expect(listing).toContain("probe_agent_installations(probes).await")
  expect(listing).toContain(
    "npx_resolver.resolve_for_list(agent_type, cmd).await"
  )
  expect(listing).toContain("registry::is_maintained_agent(*agent)")
  expect(source("electron/main.cjs")).toContain("Settings agent catalog failed")
})
