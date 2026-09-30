//! Runtime source for codex's official model catalog.
//!
//! Because `model_catalog_json` is a whole-table replace, codeg must reproduce
//! codex's own catalog inside the generated file — so it has to match the codex
//! codeg **actually launches**. That codex is the one **nested** under the
//! pinned `codex-acp` npm package (`.../codex-acp/node_modules/@openai/codex`),
//! NOT the `codex` on PATH (often an unrelated standalone install of a different
//! version, and the version that gets hoisted to the top-level `node_modules`).
//!
//! We resolve it with node's own nearest-`node_modules`-first resolution
//! (`require.resolve('@openai/codex/bin/codex.js', {paths:[<codex-acp dir>]})`),
//! run `codex debug models --bundled`, and cache the JSON on disk with a
//! live → cache → bundled-snapshot fallback chain, mirroring
//! [`crate::acp::opencode_catalog`]. Infallible by construction: the compiled-in
//! snapshot ([`crate::acp::codex_model_catalog::bundled_snapshot_models`])
//! guarantees a result offline.
//!
//! The cache lives under [`crate::paths::codeg_home_dir`] (not the app data dir)
//! so both the async editor path and the **synchronous** config-write paths can
//! reach it with zero `data_dir` threading.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde_json::Value;

/// On-disk cache freshness window — matches the OpenCode catalog cache.
const CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60);
/// Upper bound on each codex subprocess (node resolve + `debug models`).
const CODEX_TIMEOUT: Duration = Duration::from_secs(15);

fn cache_path() -> PathBuf {
    crate::paths::codeg_home_dir()
        .join("cache")
        .join("codex")
        .join("bundled-catalog.json")
}

/// Extract the `models` array from a `{"models":[...]}` document, in codex's
/// picker order: `debug models --bundled` prints FILE order, which is not
/// priority order since 0.159.1 (see
/// [`crate::acp::codex_model_catalog::sort_by_priority`]).
fn parse_models(text: &str) -> Option<Vec<Value>> {
    let mut models = serde_json::from_str::<Value>(text)
        .ok()?
        .get("models")?
        .as_array()
        .cloned()?;
    crate::acp::codex_model_catalog::sort_by_priority(&mut models);
    Some(models)
}

fn read_cache(require_fresh: bool) -> Option<Vec<Value>> {
    let path = cache_path();
    let metadata = std::fs::metadata(&path).ok()?;
    if require_fresh {
        let age = metadata
            .modified()
            .ok()
            .and_then(|m| SystemTime::now().duration_since(m).ok())?;
        if age > CACHE_TTL {
            return None;
        }
    }
    let text = std::fs::read_to_string(&path).ok()?;
    parse_models(&text).filter(|m| !m.is_empty())
}

fn write_cache(models: &[Value]) {
    let path = cache_path();
    if let Some(parent) = path.parent() {
        if std::fs::create_dir_all(parent).is_err() {
            return;
        }
    }
    if let Ok(text) = serde_json::to_string(&serde_json::json!({ "models": models })) {
        let _ = std::fs::write(&path, text);
    }
}

/// The codex-acp package directory under an npm prefix, where the nested
/// `@openai/codex` codex-acp actually drives lives.
fn codex_acp_dir(prefix: &Path) -> PathBuf {
    let base = if cfg!(windows) {
        prefix.join("node_modules")
    } else {
        prefix.join("lib").join("node_modules")
    };
    base.join("@agentclientprotocol").join("codex-acp")
}

#[derive(Debug, PartialEq, Eq)]
enum CatalogSource {
    Runtime(PathBuf),
    Adapter(PathBuf),
}

fn adapter_dir_for_command(command: &Path) -> Option<PathBuf> {
    if let Ok(real) = std::fs::canonicalize(command) {
        for parent in real.ancestors().skip(1) {
            if std::fs::read_to_string(parent.join("package.json"))
                .ok()
                .and_then(|text| serde_json::from_str::<Value>(&text).ok())
                .is_some_and(|value| value["name"] == "@agentclientprotocol/codex-acp")
            {
                return Some(parent.to_path_buf());
            }
        }
    }
    let bin_dir = command.parent()?;
    let prefix = if cfg!(windows) {
        bin_dir
    } else {
        bin_dir.parent()?
    };
    let dir = codex_acp_dir(prefix);
    dir.is_dir().then_some(dir)
}

fn select_catalog_sources(
    override_path: Option<&str>,
    managed: Option<PathBuf>,
    adapter: Option<PathBuf>,
    fallbacks: Vec<PathBuf>,
) -> Vec<CatalogSource> {
    if let Some(value) = override_path.filter(|value| !value.trim().is_empty()) {
        let path = Path::new(value);
        let resolved = if path.is_absolute() {
            path.is_file().then(|| path.to_path_buf())
        } else if path.components().count() == 1 {
            which::which(value).ok()
        } else {
            None
        };
        return resolved.map(CatalogSource::Runtime).into_iter().collect();
    }
    if let Some(runtime) = managed {
        return vec![CatalogSource::Runtime(runtime)];
    }
    if let Some(command) = adapter {
        return adapter_dir_for_command(&command)
            .map(CatalogSource::Adapter)
            .into_iter()
            .collect();
    }
    fallbacks.into_iter().map(CatalogSource::Adapter).collect()
}

/// Query the installation launch actually owns. A failed known source must not
/// substitute an older global installation and rewrite our generated catalog.
async fn catalog_sources() -> Vec<CatalogSource> {
    use crate::models::agent::AgentType;
    let override_path = std::env::var("CODEX_PATH").ok();
    if override_path
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        return select_catalog_sources(override_path.as_deref(), None, None, Vec::new());
    }
    let managed = crate::commands::agent_auto_updates::managed_runtime(AgentType::Codex)
        .map(|(_, path)| path);
    if managed.is_some() {
        return select_catalog_sources(None, managed, None, Vec::new());
    }
    let adapter =
        crate::commands::acp::resolve_agent_npx_command(AgentType::Codex, "codex-acp").await;
    let mut fallbacks = Vec::new();
    if adapter.is_none() {
        if let Some(prefix) = crate::process::user_npm_prefix() {
            fallbacks.push(codex_acp_dir(&prefix));
        }
        if let Some(prefix) = crate::commands::acp::cached_npm_global_prefix().await {
            fallbacks.push(codex_acp_dir(&prefix));
        }
    }
    select_catalog_sources(None, None, adapter, fallbacks)
}

fn catalog_node() -> Option<PathBuf> {
    which::which("node").ok().or_else(|| {
        let home = dirs::home_dir();
        let name = if cfg!(windows) { "node.exe" } else { "node" };
        crate::process::node_bin_dir_candidates(home.as_deref())
            .into_iter()
            .map(|dir| dir.join(name))
            .find(|path| path.is_file())
    })
}

/// Resolve the nested `@openai/codex/bin/codex.js` from a codex-acp package dir
/// using node's own resolver (nearest `node_modules` first) so we get the
/// version codex-acp uses, not a hoisted/PATH one.
async fn resolve_codex_js(acp_dir: &Path, node: &Path) -> Option<PathBuf> {
    let mut cmd = crate::process::tokio_command(node);
    cmd.arg("-e")
        .arg("process.stdout.write(require.resolve('@openai/codex/bin/codex.js',{paths:[process.argv[1]]}))")
        .arg(acp_dir)
        .kill_on_drop(true);
    let output = tokio::time::timeout(CODEX_TIMEOUT, cmd.output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let resolved = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if resolved.is_empty() {
        return None;
    }
    let path = PathBuf::from(resolved);
    path.exists().then_some(path)
}

async fn fetch_sources(sources: Vec<CatalogSource>, node: Option<PathBuf>) -> Option<Vec<Value>> {
    for source in sources {
        let mut cmd = match source {
            CatalogSource::Runtime(runtime) => crate::process::tokio_command(&runtime),
            CatalogSource::Adapter(dir) => {
                if !dir.is_dir() {
                    continue;
                }
                let Some(node) = node.as_deref() else {
                    continue;
                };
                let Some(js) = resolve_codex_js(&dir, node).await else {
                    continue;
                };
                let mut cmd = crate::process::tokio_command(node);
                cmd.arg(js);
                cmd
            }
        };
        cmd.args(["debug", "models", "--bundled"])
            .kill_on_drop(true);
        let Ok(Ok(output)) = tokio::time::timeout(CODEX_TIMEOUT, cmd.output()).await else {
            continue;
        };
        if output.status.success() {
            if let Some(models) = parse_models(&String::from_utf8_lossy(&output.stdout)) {
                if !models.is_empty() {
                    return Some(models);
                }
            }
        }
    }
    None
}

async fn fetch_live() -> Option<Vec<Value>> {
    fetch_sources(catalog_sources().await, catalog_node()).await
}

/// Resolve the official codex catalog with the live → cache → bundled-snapshot
/// fallback chain. Infallible. Used by the editor (may spawn codex + refresh the
/// cache); the write paths use the sync [`cached_or_bundled_snapshot`] instead.
pub async fn runtime_catalog(force_refresh: bool) -> Vec<Value> {
    if !force_refresh {
        if let Some(fresh) = read_cache(true) {
            return fresh;
        }
    }
    if let Some(models) = refresh_live_catalog().await {
        return models;
    }
    read_cache(false).unwrap_or_else(crate::acp::codex_model_catalog::bundled_snapshot_models)
}

/// Re-read the catalog from the installed codex and store it in the cache.
/// `None` when no live catalog could be produced — unlike [`runtime_catalog`]
/// this never falls back, so a caller about to rewrite files from the result
/// can tell a real refresh from a stale cache or the compiled-in snapshot.
pub async fn refresh_live_catalog() -> Option<Vec<Value>> {
    let models = fetch_live().await?;
    write_cache(&models);
    Some(models)
}

/// Synchronous catalog for the config-write paths: the on-disk cache (kept warm
/// by the editor's [`runtime_catalog`] fetch), else the bundled snapshot. Never
/// spawns a subprocess, so saving stays fast and works from sync contexts.
pub fn cached_or_bundled_snapshot() -> Vec<Value> {
    read_cache(false).unwrap_or_else(crate::acp::codex_model_catalog::bundled_snapshot_models)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_models_extracts_array() {
        assert_eq!(
            parse_models(r#"{"models":[{"slug":"a"}]}"#).unwrap().len(),
            1
        );
        assert!(parse_models("not json").is_none());
        assert!(parse_models(r#"{"nope":1}"#).is_none());
    }

    /// `debug models --bundled` prints file order; the editor, the cache and
    /// the catalog writers all read position as codex's rank.
    #[test]
    fn parse_models_returns_codex_priority_order() {
        let models = parse_models(
            r#"{"models":[{"slug":"astra","priority":2},{"slug":"sol","priority":1},{"slug":"x"},{"slug":"luna","priority":2}]}"#,
        )
        .unwrap();
        let slugs: Vec<&str> = models.iter().map(|m| m["slug"].as_str().unwrap()).collect();
        // Ascending, ties in file order, no priority last.
        assert_eq!(slugs, ["sol", "astra", "luna", "x"]);
    }

    #[test]
    fn cached_or_bundled_falls_back_to_snapshot() {
        // Whatever the cache state, the fallback guarantees a non-empty catalog
        // (the compiled-in snapshot), so callers never get an empty list.
        assert!(!cached_or_bundled_snapshot().is_empty());
    }
}

#[cfg(test)]
#[path = "../../../src/maxcode-contracts/codex-managed-catalog-source.contract.rs"]
mod maxcode_codex_managed_catalog_source_contract;
