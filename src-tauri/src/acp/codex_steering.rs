//! Compatibility for the reviewed codex-acp 2.2.2 steering lifecycle.
//! Run a private copy; never modify the user's installed npm package.
use std::path::{Path, PathBuf};

const PATCHES: &[(&str, &str)] = &[
    (
        "steering: {\n          supported: true\n        }",
        "steering: {\n          supported: true,\n          maxcodePromptRequired: 1\n        }",
    ),
    (
        "async executeOrQueueSteeringRequest(params) {\n    const queue =",
        "async executeOrQueueSteeringRequest(params) {\n    params.maxcodeOwningPrompt = this.activePrompts.get(params.sessionId);\n    const queue =",
    ),
    (
        "const turnId = await this.getSteerableTurnId(sessionState);\n    if (turnId) {",
        "const turnId = await this.getSteerableTurnId(sessionState);\n    if (params._meta?.steering?.idleBehavior === 'promptRequired' && (!params.maxcodeOwningPrompt || this.activePrompts.get(params.sessionId) !== params.maxcodeOwningPrompt)) {\n      return { outcome: 'promptRequired' };\n    }\n    if (turnId) {",
    ),
    (
        "return await this.startNewTurnFromSteering(params);",
        "if (params._meta?.steering?.idleBehavior === 'promptRequired') {\n      return { outcome: 'promptRequired' };\n    }\n    return await this.startNewTurnFromSteering(params);",
    ),
    (
        "sessionId,\n      prompt\n    };\n  }\n  createSessionConfigOptions",
        "sessionId,\n      prompt,\n      _meta: params._meta\n    };\n  }\n  createSessionConfigOptions",
    ),
];

fn patch_source(source: &str) -> Option<String> {
    // Git and Windows package tools may preserve CRLF in the reviewed source.
    let source = source.replace("\r\n", "\n");
    // Require every reviewed anchor exactly once, before changing anything.
    if PATCHES
        .iter()
        .any(|(old, _)| source.matches(old).count() != 1)
    {
        return None;
    }
    let mut patched = source.to_owned();
    for (old, new) in PATCHES {
        patched = patched.replacen(old, new, 1);
    }
    Some(patched)
}

pub(super) fn prepare(command: &Path, scratch: Option<&Path>) -> Option<(PathBuf, PathBuf)> {
    let scratch = scratch?;
    let dir = super::codex_catalog_source::adapter_dir_for_command(command)?;
    let package: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("package.json")).ok()?).ok()?;
    if package["name"] != "@agentclientprotocol/codex-acp" || package["version"] != "2.2.2" {
        return None;
    }
    let entry = dir.join("dist/index.js");
    let source = std::fs::read_to_string(&entry).ok()?;
    let patched = patch_source(&source)?;
    // Bundled JS uses import.meta.url for createRequire and Codex resolution.
    // Keep those rooted in the original installation, including paths with spaces.
    let original_url = url::Url::from_file_path(&entry).ok()?;
    let original_url = serde_json::to_string(original_url.as_str()).ok()?;
    let patched = patched.replace("import.meta.url", &original_url);
    let node = crate::commands::acp::resolve_command_on_path(if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    })?;
    let script = scratch.join("maxcode-codex-acp.mjs");
    std::fs::write(&script, patched).ok()?;
    Some((node, script))
}

pub(super) fn advertises_safe_steering(
    meta: Option<&serde_json::Map<String, serde_json::Value>>,
    info: Option<&agent_client_protocol::schema::v1::Implementation>,
) -> bool {
    info.is_some_and(|info| info.version == "2.2.2")
        && meta
            .and_then(|meta| meta.get("steering"))
            .and_then(|steering| steering.get("maxcodePromptRequired"))
            .and_then(serde_json::Value::as_u64)
            == Some(1)
}

#[cfg(test)]
#[path = "../../../src/maxcode-contracts/codex-native-steering.contract.rs"]
mod contract;
