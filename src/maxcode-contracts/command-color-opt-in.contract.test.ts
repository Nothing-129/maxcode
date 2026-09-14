import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: agent command coloring is an explicit opt-in", () => {
  it("starts without forcing ANSI and injects the complete environment only when enabled", () => {
    const connection = source("src-tauri/src/acp/connection.rs")

    expect(connection).toContain(
      "static FORCE_COMMAND_COLOR: AtomicBool = AtomicBool::new(false)"
    )
    expect(connection).toContain("if force_color {")
    for (const [key, value] of [
      ["CLICOLOR", "1"],
      ["CLICOLOR_FORCE", "1"],
      ["FORCE_COLOR", "1"],
      ["TERM", "xterm-256color"],
    ]) {
      expect(connection).toContain(`("${key}", "${value}")`)
    }
    expect(connection).toContain(
      "fn merge_agent_env_omits_the_color_env_by_default()"
    )
    expect(connection).toContain(
      "fn runtime_env_still_outranks_the_color_default()"
    )
  })

  it("persists the flag without losing the selected terminal shell", () => {
    const commands = source("src-tauri/src/commands/system_settings.rs")
    const settings = source("src/components/settings/general-settings.tsx")

    expect(commands).toContain(
      "set_force_command_color(settings.colorize_command_output)"
    )
    expect(commands).toContain(
      "set_force_command_color(normalized.colorize_command_output)"
    )
    expect(settings).toContain("storedDefaultShell")
    expect(settings).toContain("default_shell: storedDefaultShell")
    expect(settings).toContain(
      "disabled={savingTerminal || storedDefaultShell === undefined}"
    )
    expect(settings).toContain('id="colorize-command-output"')
  })
})
