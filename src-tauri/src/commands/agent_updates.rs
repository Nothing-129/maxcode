//! Read-only online release checks, separate from reviewed install pins.
use std::time::Duration;

use serde::Serialize;

use crate::acp::{registry, remote_registry};
use crate::app_error::AppCommandError;
use crate::models::agent::AgentType;

/// Published versions must come from the authoritative registry, not a mirror.
pub(crate) const OFFICIAL_NPM_REGISTRY: &str = "https://registry.npmjs.org";

pub(crate) async fn official_npm_version(name: &str) -> Result<String, AppCommandError> {
    let mut url = reqwest::Url::parse(OFFICIAL_NPM_REGISTRY).expect("static npm URL");
    url.path_segments_mut()
        .expect("npm URL base")
        .push(name)
        .push("latest");
    let payload: serde_json::Value = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| AppCommandError::network(e.to_string()))?
        .get(url)
        .send()
        .await
        .map_err(|e| AppCommandError::network(format!("official npm check failed: {e}")))?
        .error_for_status()
        .map_err(|e| AppCommandError::network(format!("official npm check failed: {e}")))?
        .json()
        .await
        .map_err(|e| AppCommandError::network(format!("invalid official npm release: {e}")))?;
    payload
        .get("version")
        .and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty())
        .map(str::to_owned)
        .ok_or_else(|| AppCommandError::network("official npm release has no version"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUpdateRelease {
    pub latest_version: Option<String>,
    pub source: &'static str,
}

// Only package identities are accepted, never arbitrary URLs, git specs or
// commands from a custom definition. No shell/npm process is needed to check.
pub(crate) fn npm_package_name(spec: &str) -> Option<&str> {
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

/// Only simple PyPI package requirements have an unambiguous release source.
/// Return the package identity and preserve extras for installation.
pub(crate) fn python_package(spec: &str) -> Option<(&str, &str)> {
    let requirement = spec.split_once("==").map_or(spec, |(name, _)| name).trim();
    let name = requirement.split('[').next()?;
    let valid = |s: &str| {
        !s.is_empty()
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
    };
    if !valid(name) {
        return None;
    }
    if requirement != name {
        let extras = requirement
            .strip_prefix(name)?
            .strip_prefix('[')?
            .strip_suffix(']')?;
        if !extras.split(',').all(valid) {
            return None;
        }
    }
    Some((name, requirement))
}

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
        let version = official_npm_version(name).await?;
        return Ok(AgentUpdateRelease {
            latest_version: Some(version.to_owned()),
            source: "npm",
        });
    }

    if let registry::AgentDistribution::Uvx { package, .. } = meta.distribution {
        let Some((name, _)) = python_package(package) else {
            return Ok(AgentUpdateRelease {
                latest_version: None,
                source: "unsupported",
            });
        };
        let response = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| AppCommandError::network(e.to_string()))?
            .get(format!("https://pypi.org/pypi/{name}/json"))
            .send()
            .await
            .map_err(|e| AppCommandError::network(e.to_string()))?
            .error_for_status()
            .map_err(|e| AppCommandError::network(e.to_string()))?;
        let payload: serde_json::Value = response
            .json()
            .await
            .map_err(|e| AppCommandError::network(e.to_string()))?;
        return Ok(AgentUpdateRelease {
            latest_version: payload
                .pointer("/info/version")
                .and_then(|v| v.as_str())
                .filter(|v| !v.is_empty())
                .map(str::to_owned),
            source: "pypi",
        });
    }

    // Manual binary definitions have no verified relationship with a
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
    fn python_release_queries_preserve_extras_and_reject_ambiguous_sources() {
        assert_eq!(
            python_package("fast-agent[acp]==1.2.3"),
            Some(("fast-agent", "fast-agent[acp]"))
        );
        assert_eq!(
            python_package("fast-agent"),
            Some(("fast-agent", "fast-agent"))
        );
        for spec in [
            "git+https://host/repo",
            "./agent",
            "agent>=1",
            "agent @ https://host/pkg",
            "agent;python_version>3",
        ] {
            assert!(python_package(spec).is_none());
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
