//! Read-only online release checks, separate from reviewed install pins.
use std::time::Duration;

use serde::Serialize;

use crate::acp::{registry, remote_registry};
use crate::app_error::AppCommandError;
use crate::models::agent::AgentType;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUpdateRelease {
    pub latest_version: Option<String>,
    pub source: &'static str,
}

// Only package identities are accepted, never arbitrary URLs, git specs or
// commands from a custom definition. No shell/npm process is needed to check.
fn npm_package_name(spec: &str) -> Option<&str> {
    let name = match spec.rfind('@') {
        Some(index) if index > 0 => &spec[..index],
        _ => spec,
    };
    let valid_part = |part: &str| {
        !part.is_empty()
            && part
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
    };
    let valid = if let Some(scoped) = name.strip_prefix('@') {
        scoped
            .split_once('/')
            .is_some_and(|(scope, package)| valid_part(scope) && valid_part(package))
    } else {
        valid_part(name)
    };
    valid.then_some(name)
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_check_agent_update(
    agent_type: AgentType,
) -> Result<AgentUpdateRelease, AppCommandError> {
    let meta = registry::get_agent_meta(agent_type);
    if let registry::AgentDistribution::Npx { package, .. } = meta.distribution {
        let Some(name) = npm_package_name(package) else {
            return Ok(AgentUpdateRelease {
                latest_version: None,
                source: "unsupported",
            });
        };
        let mut url = reqwest::Url::parse("https://registry.npmjs.org/").expect("static npm URL");
        url.path_segments_mut()
            .expect("npm URL base")
            .push(name)
            .push("latest");
        let response = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| AppCommandError::network(e.to_string()))?
            .get(url)
            .send()
            .await
            .map_err(|e| AppCommandError::network(format!("npm update check failed: {e}")))?
            .error_for_status()
            .map_err(|e| AppCommandError::network(format!("npm update check failed: {e}")))?;
        let payload: serde_json::Value = response
            .json()
            .await
            .map_err(|e| AppCommandError::network(format!("invalid npm release: {e}")))?;
        let version = payload
            .get("version")
            .and_then(|v| v.as_str())
            .filter(|v| !v.trim().is_empty())
            .ok_or_else(|| AppCommandError::network("npm release has no version"))?;
        return Ok(AgentUpdateRelease {
            latest_version: Some(version.to_owned()),
            source: "npm",
        });
    }

    // Manual binary/Python definitions have no verified relationship with a
    // public registry id. Do not compare unrelated products sharing a name.
    if agent_type
        .custom_id()
        .and_then(crate::acp::custom_registry::source_of)
        .is_some_and(|source| source.as_str() == "manual")
    {
        return Ok(AgentUpdateRelease {
            latest_version: None,
            source: "unsupported",
        });
    }
    let agents = tokio::time::timeout(
        Duration::from_secs(15),
        remote_registry::fetch_supported_agents(),
    )
    .await
    .map_err(|_| AppCommandError::network("ACP registry update check timed out"))??;
    Ok(AgentUpdateRelease {
        latest_version: agents
            .into_iter()
            .find(|agent| agent.agent_type == agent_type)
            .and_then(|agent| agent.version)
            .filter(|v| !v.trim().is_empty()),
        source: "acp",
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_package_identity_not_pin_or_arbitrary_custom_url() {
        assert_eq!(
            npm_package_name("@zed-industries/codex-acp@1.7.0"),
            Some("@zed-industries/codex-acp")
        );
        assert_eq!(npm_package_name("@scope/agent"), Some("@scope/agent"));
        assert_eq!(npm_package_name("agent@latest"), Some("agent"));
        for spec in [
            "https://example.com/agent.tgz",
            "git+https://host/repo",
            "./agent",
            "agent; touch /tmp/x",
            "@scope/agent/extra",
        ] {
            assert_eq!(npm_package_name(spec), None, "{spec}");
        }
    }

    #[test]
    fn adapter_checks_use_the_acp_package_not_the_vendor_cli() {
        for agent in [AgentType::ClaudeCode, AgentType::Codex] {
            let registry::AgentDistribution::Npx { package, .. } =
                registry::get_agent_meta(agent).distribution
            else {
                panic!("expected npm adapter")
            };
            assert!(npm_package_name(package).unwrap().contains("acp"));
        }
    }
}
