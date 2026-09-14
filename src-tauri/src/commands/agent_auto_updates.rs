//! Background updates for every enabled, installed registered agent.
//! Every install has an immutable prefix. Only a validated prefix is published;
//! failed downloads and existing processes keep their previous files.
use crate::{
    acp::{manager::ConnectionManager, registry, AGENT_NPM_REGISTRY},
    db::{service::agent_setting_service, AppDatabase},
    models::agent::AgentType,
    web::event_bridge::EventEmitter,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        LazyLock, Mutex,
    },
    time::{Duration, Instant},
};

const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const RETRY_INTERVAL: Duration = Duration::from_secs(30 * 60);
pub(crate) static INSTALL_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
pub(crate) static INSTALL_REVISION: AtomicU64 = AtomicU64::new(0);
static STATUS: LazyLock<Mutex<HashMap<String, AutoUpdateStatus>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoUpdateStatus {
    pub phase: String,
    pub version: Option<String>,
    pub error: Option<String>,
}

pub fn status(agent: AgentType) -> AutoUpdateStatus {
    STATUS
        .lock()
        .unwrap()
        .get(&agent.to_string())
        .cloned()
        .unwrap_or(AutoUpdateStatus {
            phase: "idle".into(),
            ..Default::default()
        })
}
fn report(agent: AgentType, phase: &str, version: Option<&str>, error: Option<String>) {
    STATUS.lock().unwrap().insert(
        agent.to_string(),
        AutoUpdateStatus {
            phase: phase.into(),
            version: version.map(str::to_owned),
            error,
        },
    );
}
fn command(agent: AgentType) -> &'static str {
    match registry::get_agent_meta(agent).distribution {
        registry::AgentDistribution::Npx { cmd, .. }
        | registry::AgentDistribution::Binary { cmd, .. }
        | registry::AgentDistribution::Uvx { cmd, .. } => cmd,
    }
}
fn valid_version(version: &str) -> bool {
    !version.is_empty()
        && version.len() <= 128
        && version.starts_with(|c: char| c.is_ascii_digit())
        && version
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._+-".contains(&b))
}
fn root(agent: AgentType) -> Option<PathBuf> {
    Some(
        dirs::data_local_dir()?
            .join("app.codeg")
            .join("agent-updates")
            .join(
                agent
                    .custom_id()
                    .map(|id| format!("custom-{id}"))
                    .unwrap_or_else(|| agent.to_string()),
            ),
    )
}

#[derive(Clone, Serialize, Deserialize)]
struct Installed {
    directory: String,
    version: String,
    #[serde(default)]
    entry: Option<String>,
    #[serde(default)]
    identity: Option<String>,
}
fn install_identity(agent: AgentType) -> String {
    match registry::get_agent_meta(agent).distribution {
        registry::AgentDistribution::Npx { package, cmd, .. } => format!(
            "npm:{}:{cmd}",
            super::agent_updates::npm_package_name(package).unwrap_or(package)
        ),
        registry::AgentDistribution::Uvx {
            package,
            cmd,
            python,
            ..
        } => format!(
            "python:{}:{cmd}:{python:?}",
            super::agent_updates::python_package(package)
                .map_or(package, |(_, requirement)| requirement)
        ),
        registry::AgentDistribution::Binary { cmd, .. } => {
            format!("binary:{cmd}:{}", registry::current_platform())
        }
    }
}
fn read_active(agent: AgentType) -> Option<Installed> {
    let data = std::fs::read(root(agent)?.join("active.json")).ok()?;
    let installed: Installed = serde_json::from_slice(&data).ok()?;
    if installed
        .identity
        .as_deref()
        .is_some_and(|identity| identity != install_identity(agent))
    {
        return None;
    }
    // A marker must never address an arbitrary directory outside our cache.
    uuid::Uuid::parse_str(&installed.directory).ok()?;
    if !valid_version(&installed.version) {
        return None;
    }
    Some(installed)
}
fn executable(prefix: &Path, cmd: &str) -> PathBuf {
    if cfg!(windows) {
        prefix.join(format!("{cmd}.cmd"))
    } else {
        prefix.join("bin").join(cmd)
    }
}
fn staged_command(agent: AgentType, prefix: &Path, version: &str) -> PathBuf {
    if agent == AgentType::Grok {
        let suffix = if cfg!(windows) { ".exe" } else { "" };
        prefix
            .join("grok-runtime")
            .join("bin")
            .join(format!("grok-{version}{suffix}"))
    } else {
        executable(prefix, command(agent))
    }
}

pub(crate) fn active_for_agent(agent: AgentType) -> Option<(PathBuf, String)> {
    let installed = read_active(agent)?;
    let prefix = root(agent)?.join(&installed.directory);
    let path = match installed.entry {
        Some(entry) => {
            let entry = Path::new(&entry);
            if entry.is_absolute()
                || entry.components().any(|c| {
                    !matches!(
                        c,
                        std::path::Component::Normal(_) | std::path::Component::CurDir
                    )
                })
            {
                return None;
            }
            prefix.join(entry)
        }
        None => staged_command(agent, &prefix, &installed.version),
    };
    path.is_file().then_some((path, installed.version))
}

// Command-only callers must not accidentally use another custom agent with the
// same executable name. Agent-aware launch/status paths use active_for_agent.
pub(crate) fn active_command(cmd: &str) -> Option<PathBuf> {
    let mut matches = registry::all_acp_agents().into_iter().filter(|agent| {
        matches!(registry::get_agent_meta(*agent).distribution, registry::AgentDistribution::Npx { cmd: registered, .. } if registered == cmd)
    });
    let agent = matches.next()?;
    if matches.next().is_some() {
        return None;
    }
    active_for_agent(agent).map(|(path, _)| path)
}
pub(crate) fn active_version(package: &str) -> Option<String> {
    let mut matches = registry::all_acp_agents().into_iter().filter(|agent| {
        matches!(registry::get_agent_meta(*agent).distribution, registry::AgentDistribution::Npx { package: registered, .. } if super::agent_updates::npm_package_name(registered) == Some(package))
    });
    let agent = matches.next()?;
    if matches.next().is_some() {
        return None;
    }
    active_for_agent(agent).map(|(_, version)| version)
}
pub(crate) fn clear_active(agent: AgentType) -> Result<(), String> {
    let Some(root) = root(agent) else {
        return Ok(());
    };
    match std::fs::remove_file(root.join("active.json")) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
fn publish(root: &Path, installed: &Installed) -> Result<(), String> {
    use std::io::Write;
    let mut file = tempfile::NamedTempFile::new_in(root).map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec(installed).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(root.join("active.json"))
        .map_err(|e| e.to_string())?;
    Ok(())
}
fn newer(local: &str, remote: &str) -> bool {
    match (
        semver::Version::parse(local.trim_start_matches('v')),
        semver::Version::parse(remote),
    ) {
        (Ok(local), Ok(remote)) => remote.pre.is_empty() && remote > local,
        _ => false,
    }
}
fn release_is_newer(agent: AgentType, local: &str, remote: &str) -> Option<bool> {
    if !valid_version(local.trim_start_matches('v')) || !valid_version(remote) {
        return None;
    }
    let numeric = |raw: &str, correction: bool| -> Option<Vec<u64>> {
        let core = raw.trim_start_matches('v').split('+').next()?;
        let (core, suffix) = core
            .split_once('-')
            .map_or((core, None), |(core, suffix)| (core, Some(suffix)));
        let mut parts = core
            .split('.')
            .map(str::parse::<u64>)
            .collect::<Result<Vec<_>, _>>()
            .ok()?;
        if correction {
            parts.push(suffix.unwrap_or("0").parse().ok()?);
        }
        Some(parts)
    };
    if agent == AgentType::OpenClaw {
        return Some(numeric(remote, true)? > numeric(local, true)?);
    }
    if matches!(
        registry::get_agent_meta(agent).distribution,
        registry::AgentDistribution::Binary { .. }
    ) {
        let left = numeric(local, false)?;
        let right = numeric(remote, false)?;
        return Some(right > left);
    }
    // Stable npm/PyPI releases. Two-component Python versions are padded.
    let normalize = |value: &str| {
        let mut value = value.trim_start_matches('v').to_owned();
        if value.bytes().all(|b| b.is_ascii_digit() || b == b'.') {
            while value.matches('.').count() < 2 {
                value.push_str(".0");
            }
        }
        value
    };
    let local = normalize(local);
    let remote = normalize(remote);
    semver::Version::parse(&local).ok()?;
    semver::Version::parse(&remote).ok()?;
    Some(newer(&local, &remote))
}

async fn enabled(db: &AppDatabase, agent: AgentType) -> bool {
    let Ok(Some(setting)) = agent_setting_service::get_by_agent_type(&db.conn, agent).await else {
        return false;
    };
    // Automatic updates are mandatory for enabled, installed supported agents.
    // Old environment opt-outs are deliberately ignored.
    setting.enabled && setting.installed_version.is_some()
}

async fn prepare(agent: AgentType, version: &str) -> Result<Installed, String> {
    if !valid_version(version) {
        return Err("Invalid release version".into());
    }
    let root = root(agent).ok_or("Missing local data directory")?;
    let identity = install_identity(agent);
    let result = match registry::get_agent_meta(agent).distribution {
        registry::AgentDistribution::Npx { .. } => {
            prepare_at(agent, version, &root, Path::new("npm")).await
        }
        registry::AgentDistribution::Binary { .. } => prepare_binary(agent, version, &root).await,
        registry::AgentDistribution::Uvx { .. } => prepare_python(agent, version, &root).await,
    };
    if install_identity(agent) != identity {
        if let Ok(installed) = &result {
            let _ = std::fs::remove_dir_all(root.join(&installed.directory));
        }
        return Err("Agent definition changed during update; will check again".into());
    }
    result.map(|mut installed| {
        installed.identity = Some(identity);
        installed
    })
}

async fn verify_staged(
    agent: AgentType,
    prefix: &Path,
    bin: &Path,
    version: &str,
) -> Result<(), String> {
    let mut probe = crate::process::tokio_command(bin);
    let declared = agent
        .custom_id()
        .and_then(crate::acp::custom_registry::version_probe_of);
    let args: Vec<&str> = declared
        .map(|probe| probe.split_whitespace().skip(1).collect())
        .filter(|args: &Vec<&str>| !args.is_empty())
        .unwrap_or_else(|| vec!["--version"]);
    probe.args(args).kill_on_drop(true);
    if agent == AgentType::Grok {
        probe.env("GROK_HOME", prefix.join("grok-runtime"));
    }
    let output = tokio::time::timeout(Duration::from_secs(30), probe.output())
        .await
        .map_err(|_| "Version verification timed out")?
        .map_err(|e| e.to_string())?;
    let text = format!(
        "{} {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let reported = text.split_whitespace().any(|s| {
        s.trim_matches(|c| matches!(c, '(' | ')' | ',' | ';'))
            .trim_start_matches('v')
            == version
    });
    if !output.status.success() || !reported {
        return Err("Staged agent did not report the expected version".into());
    }
    Ok(())
}

fn staged_record(
    agent: AgentType,
    prefix: &Path,
    directory: String,
    version: &str,
    bin: &Path,
) -> Result<Installed, String> {
    Ok(Installed {
        directory,
        identity: Some(install_identity(agent)),
        version: version.into(),
        entry: Some(
            bin.strip_prefix(prefix)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .into_owned(),
        ),
    })
}

async fn prepare_binary(agent: AgentType, version: &str, root: &Path) -> Result<Installed, String> {
    let release = tokio::time::timeout(
        Duration::from_secs(20),
        crate::acp::remote_registry::fetch_binary_release(agent, registry::current_platform()),
    )
    .await
    .map_err(|_| "Release lookup timed out")?
    .map_err(|e| e.to_string())?
    .ok_or("No binary release for this platform")?;
    if release.version != version {
        return Err("Release changed during update; will check again".into());
    }
    prepare_binary_release(agent, version, root, &release).await
}

async fn prepare_binary_release(
    agent: AgentType,
    version: &str,
    root: &Path,
    release: &crate::acp::remote_registry::RegistryBinaryRelease,
) -> Result<Installed, String> {
    let directory = uuid::Uuid::new_v4().to_string();
    let prefix = root.join(&directory);
    let result = async {
        let bin = tokio::time::timeout(
            Duration::from_secs(600),
            crate::acp::binary_cache::stage_binary_for_agent(
                agent,
                &prefix,
                &release.archive_url,
                command(agent),
                release.sha256.as_deref(),
            ),
        )
        .await
        .map_err(|_| "Binary download timed out")?
        .map_err(|e| e.to_string())?;
        verify_staged(agent, &prefix, &bin, version).await?;
        staged_record(agent, &prefix, directory, version, &bin)
    }
    .await;
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&prefix);
    }
    result
}

async fn run_tool_install(mut cmd: tokio::process::Command, prefix: &Path) -> Result<(), String> {
    let log = std::fs::File::create(prefix.join("install.log")).map_err(|e| e.to_string())?;
    cmd.stdout(log.try_clone().map_err(|e| e.to_string())?)
        .stderr(log)
        .kill_on_drop(true);
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    match tokio::time::timeout(Duration::from_secs(600), child.wait()).await {
        Ok(result) => {
            if result.map_err(|e| e.to_string())?.success() {
                Ok(())
            } else {
                Err("Tool installation failed".into())
            }
        }
        Err(_) => {
            if let Some(pid) = pid {
                let _ = kill_tree::tokio::kill_tree(pid).await;
            }
            let _ = child.kill().await;
            Err("Tool installation timed out".into())
        }
    }
}

async fn prepare_python(agent: AgentType, version: &str, root: &Path) -> Result<Installed, String> {
    let uv = match super::acp::resolve_command_on_path("uv")
        .or_else(|| crate::acp::binary_cache::find_cached_uv_tool("uv"))
    {
        Some(uv) => uv,
        None => {
            crate::acp::binary_cache::ensure_uv_tool(|_| {})
                .await
                .map_err(|e| e.to_string())?;
            crate::acp::binary_cache::find_cached_uv_tool("uv").ok_or("uv is unavailable")?
        }
    };
    prepare_python_with_uv(agent, version, root, &uv).await
}

async fn prepare_python_with_uv(
    agent: AgentType,
    version: &str,
    root: &Path,
    uv: &Path,
) -> Result<Installed, String> {
    let registry::AgentDistribution::Uvx {
        package,
        python,
        cmd: entry,
        ..
    } = registry::get_agent_meta(agent).distribution
    else {
        return Err("Not a Python agent".into());
    };
    let (_, requirement) =
        super::agent_updates::python_package(package).ok_or("No PyPI package release source")?;
    let directory = uuid::Uuid::new_v4().to_string();
    let prefix = root.join(&directory);
    std::fs::create_dir_all(&prefix).map_err(|e| e.to_string())?;
    let result = async {
        let mut install = crate::process::tokio_command(uv);
        install
            .args(["tool", "install"])
            .arg(format!("{requirement}=={version}"))
            .env("UV_TOOL_DIR", prefix.join("tools"))
            .env("UV_TOOL_BIN_DIR", prefix.join("bin"));
        if let Some(python) = python {
            install.args(["--python", python]);
        }
        run_tool_install(install, &prefix).await?;
        let name = if cfg!(windows) {
            format!("{entry}.exe")
        } else {
            entry.to_owned()
        };
        let bin = prefix.join("bin").join(name);
        verify_staged(agent, &prefix, &bin, version).await?;
        staged_record(agent, &prefix, directory, version, &bin)
    }
    .await;
    if result.is_err() {
        let _ = std::fs::copy(prefix.join("install.log"), root.join("last-failure.log"));
        let _ = std::fs::remove_dir_all(&prefix);
    }
    result
}

async fn prepare_at(
    agent: AgentType,
    version: &str,
    root: &Path,
    npm: &Path,
) -> Result<Installed, String> {
    let registry::AgentDistribution::Npx { package, .. } =
        registry::get_agent_meta(agent).distribution
    else {
        return Err("Not an npm agent".into());
    };
    let package =
        super::agent_updates::npm_package_name(package).ok_or("No npm package release source")?;
    let installed = Installed {
        directory: uuid::Uuid::new_v4().to_string(),
        version: version.into(),
        entry: None,
        identity: Some(install_identity(agent)),
    };
    let prefix = root.join(&installed.directory);
    std::fs::create_dir_all(&prefix).map_err(|e| e.to_string())?;
    let result = async {
        // Output goes to a file rather than an unbounded in-memory buffer.
        let log = std::fs::File::create(prefix.join("install.log")).map_err(|e| e.to_string())?;
        let mut cmd = crate::process::tokio_command(npm);
        cmd.args([
            "install",
            "-g",
            "--include=optional",
            "--ignore-scripts=false",
            "--no-audit",
            "--no-fund",
            "--fetch-timeout=60000",
            "--fetch-retries=1",
        ])
        .arg(format!("--registry={AGENT_NPM_REGISTRY}"))
        .arg(format!("--prefix={}", prefix.display()))
        .arg(format!("{package}@{version}"))
        .stdout(log.try_clone().map_err(|e| e.to_string())?)
        .stderr(log)
        .kill_on_drop(true);
        // Grok's postinstall writes into GROK_HOME/bin. Keep this private too;
        // activation launches that exact native file with the user's normal home.
        if agent == AgentType::Grok {
            cmd.env("GROK_HOME", prefix.join("grok-runtime"));
        }
        if std::env::var_os("NODE_USE_ENV_PROXY").is_none() {
            cmd.env("NODE_USE_ENV_PROXY", "1");
        }
        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        let pid = child.id();
        let exit = match tokio::time::timeout(Duration::from_secs(600), child.wait()).await {
            Ok(result) => result.map_err(|e| e.to_string())?,
            Err(_) => {
                if let Some(pid) = pid {
                    let _ = kill_tree::tokio::kill_tree(pid).await;
                }
                let _ = child.kill().await;
                return Err("npm auto update timed out after 10 minutes".into());
            }
        };
        if !exit.success() {
            return Err("npm install failed".into());
        }
        let bin = staged_command(agent, &prefix, version);
        // Verify this prefix, never a global/PATH fallback.
        verify_staged(agent, &prefix, &bin, version).await?;
        if agent == AgentType::Codex {
            // The adapter's own --version does not prove its native CLI exists.
            let mut cli = crate::process::tokio_command(&bin);
            cli.args(["cli", "--version"]).kill_on_drop(true);
            let output = tokio::time::timeout(Duration::from_secs(30), cli.output())
                .await
                .map_err(|_| "Codex CLI verification timed out")?
                .map_err(|e| e.to_string())?;
            let text = format!(
                "{} {}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            if !output.status.success()
                || !text
                    .split_whitespace()
                    .any(|s| semver::Version::parse(s.trim_start_matches('v')).is_ok())
            {
                return Err("Staged Codex CLI dependency failed verification".into());
            }
        }
        Ok(installed)
    }
    .await;
    // A failed retry must not accumulate another full copy every 30 minutes.
    // The uniquely staged prefix has never been published, so it is safe to discard.
    if result.is_err() {
        let log = root.join("last-failure.log");
        let _ = std::fs::copy(prefix.join("install.log"), &log);
        let _ = std::fs::remove_dir_all(&prefix);
        return result.map_err(|error| format!("{error}; diagnostic log: {}", log.display()));
    }
    result
}

pub async fn run(db: AppDatabase, manager: ConnectionManager, emitter: EventEmitter) {
    tokio::time::sleep(Duration::from_secs(30)).await;
    let mut due: HashMap<String, Instant> = HashMap::new();
    let mut pending: HashMap<String, (Installed, u64)> = HashMap::new();
    loop {
        for agent in registry::all_acp_agents() {
            let key = agent.to_string();
            if !enabled(&db, agent).await {
                pending.remove(&key);
                report(agent, "idle", None, None);
                continue;
            }
            if !pending.contains_key(&key)
                && due.get(&key).is_none_or(|when| Instant::now() >= *when)
            {
                due.insert(key.clone(), Instant::now() + RETRY_INTERVAL);
                report(agent, "checking", None, None);
                let release = match super::agent_updates::acp_check_agent_update(agent).await {
                    Ok(release) => release,
                    Err(e) => {
                        report(agent, "error", None, Some(e.to_string()));
                        continue;
                    }
                };
                let Some(version) = release.latest_version else {
                    report(
                        agent,
                        "unavailable",
                        None,
                        Some("No published update source for this agent".into()),
                    );
                    due.insert(key.clone(), Instant::now() + CHECK_INTERVAL);
                    continue;
                };
                let local = super::acp::acp_get_agent_status_core(agent, &db)
                    .await
                    .ok()
                    .and_then(|s| s.installed_version);
                let Some(needs_update) = local
                    .as_deref()
                    .and_then(|local| release_is_newer(agent, local, &version))
                else {
                    report(
                        agent,
                        "unavailable",
                        Some(&version),
                        Some("Cannot compare the installed and published versions".into()),
                    );
                    continue;
                };
                if !needs_update {
                    due.insert(key.clone(), Instant::now() + CHECK_INTERVAL);
                    report(agent, "current", local.as_deref(), None);
                    continue;
                }
                let Ok(_install) = INSTALL_LOCK.try_lock() else {
                    continue;
                };
                report(agent, "downloading", Some(&version), None);
                match prepare(agent, &version).await {
                    Ok(installed) => {
                        pending.insert(
                            key.clone(),
                            (installed, INSTALL_REVISION.load(Ordering::SeqCst)),
                        );
                    }
                    Err(error) => {
                        tracing::warn!("Auto update {agent}: {error}");
                        report(agent, "error", Some(&version), Some(error));
                        continue;
                    }
                }
            }
            let Some((installed, revision)) = pending.get(&key).cloned() else {
                continue;
            };
            report(agent, "waiting", Some(&installed.version), None);
            let Ok(_install) = INSTALL_LOCK.try_lock() else {
                continue;
            };
            if INSTALL_REVISION.load(Ordering::SeqCst) != revision
                || installed.identity.as_deref() != Some(install_identity(agent).as_str())
            {
                pending.remove(&key);
                due.insert(key.clone(), Instant::now() + CHECK_INTERVAL);
                report(agent, "idle", None, None);
                continue;
            }
            let local = super::acp::acp_get_agent_status_core(agent, &db)
                .await
                .ok()
                .and_then(|s| s.installed_version);
            // Exclude session creation only for the fast marker swap, not download.
            let _connections = manager.lock_out_new_connections().await;
            if manager.live_or_draining_agent_names().await.contains(&key) {
                continue;
            }
            if !enabled(&db, agent).await {
                pending.remove(&key);
                continue;
            }
            // A manual install may have advanced the version while downloading.
            if !local
                .as_deref()
                .is_some_and(|v| release_is_newer(agent, v, &installed.version) == Some(true))
            {
                pending.remove(&key);
                continue;
            }
            let result = root(agent)
                .ok_or("Missing local data directory".to_owned())
                .and_then(|root| publish(&root, &installed));
            if let Err(error) = result {
                report(agent, "error", Some(&installed.version), Some(error));
                pending.remove(&key);
                continue;
            }
            if let Err(error) = agent_setting_service::set_installed_version(
                &db.conn,
                agent,
                Some(installed.version.clone()),
            )
            .await
            {
                tracing::warn!("Auto update metadata {agent}: {error}");
            }
            super::acp::emit_acp_agents_updated(&emitter, "auto_updated", Some(agent));
            report(agent, "updated", Some(&installed.version), None);
            pending.remove(&key);
            due.insert(key, Instant::now() + CHECK_INTERVAL);
        }
        tokio::time::sleep(Duration::from_secs(60)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn updates_only_newer_stable_versions() {
        assert!(newer("1.0.13", "1.0.30"));
        for (local, remote) in [
            ("1.0.30", "1.0.13"),
            ("1.0.30", "1.0.30"),
            ("unknown", "1.1.0"),
            ("1.0.0", "1.1.0-beta.1"),
        ] {
            assert!(!newer(local, remote));
        }
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn failed_install_keeps_active_version_and_removes_partial_download() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let npm = root.path().join("fake-npm");
        std::fs::write(
            &npm,
            "#!/bin/sh\necho simulated-network-failure >&2\nexit 1\n",
        )
        .unwrap();
        std::fs::set_permissions(&npm, std::fs::Permissions::from_mode(0o755)).unwrap();
        let active = Installed {
            directory: uuid::Uuid::new_v4().to_string(),
            version: "1.0.0".into(),
            entry: None,
            identity: None,
        };
        publish(root.path(), &active).unwrap();
        let before = std::fs::read(root.path().join("active.json")).unwrap();
        assert!(prepare_at(AgentType::Grok, "1.0.30", root.path(), &npm)
            .await
            .is_err());
        assert_eq!(
            std::fs::read(root.path().join("active.json")).unwrap(),
            before
        );
        assert!(
            std::fs::read_to_string(root.path().join("last-failure.log"))
                .unwrap()
                .contains("simulated-network-failure")
        );
        assert!(!std::fs::read_dir(root.path())
            .unwrap()
            .any(|entry| entry.unwrap().path().is_dir()));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn grok_preparation_isolates_native_runtime_and_does_not_activate() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let npm = root.path().join("fake-npm");
        std::fs::write(
            &npm,
            r#"#!/bin/sh
set -eu
mkdir -p "$GROK_HOME/bin"
cat > "$GROK_HOME/bin/grok-1.0.30" <<'BIN'
#!/bin/sh
printf 'grok 1.0.30\n'
BIN
chmod +x "$GROK_HOME/bin/grok-1.0.30"
"#,
        )
        .unwrap();
        std::fs::set_permissions(&npm, std::fs::Permissions::from_mode(0o755)).unwrap();
        let installed = prepare_at(AgentType::Grok, "1.0.30", root.path(), &npm)
            .await
            .unwrap();
        assert!(staged_command(
            AgentType::Grok,
            &root.path().join(&installed.directory),
            &installed.version
        )
        .is_file());
        assert!(!root.path().join("active.json").exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn codex_adapter_without_working_cli_is_not_published() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let npm = root.path().join("fake-npm");
        std::fs::write(
            &npm,
            r#"#!/bin/sh
set -eu
for arg in "$@"; do
  case "$arg" in --prefix=*) prefix="${arg#--prefix=}" ;; esac
done
mkdir -p "$prefix/bin"
cat > "$prefix/bin/codex-acp" <<'BIN'
#!/bin/sh
if [ "$1" = cli ]; then exit 1; fi
printf '@agentclientprotocol/codex-acp 1.10.1\n'
BIN
chmod +x "$prefix/bin/codex-acp"
"#,
        )
        .unwrap();
        std::fs::set_permissions(&npm, std::fs::Permissions::from_mode(0o755)).unwrap();
        let result = prepare_at(AgentType::Codex, "1.10.1", root.path(), &npm).await;
        assert!(result
            .err()
            .unwrap()
            .contains("CLI dependency failed verification"));
        assert!(!root.path().join("active.json").exists());
    }

    #[test]
    fn compares_non_semver_binary_dates_and_calendar_corrections() {
        assert_eq!(
            release_is_newer(AgentType::Cursor, "2026.09.02-abc", "2026.09.03-def"),
            Some(true)
        );
        assert_eq!(
            release_is_newer(AgentType::OpenClaw, "2026.7.1", "2026.7.1-2"),
            Some(true)
        );
        assert_eq!(
            release_is_newer(AgentType::OpenClaw, "2026.7.1-2", "2026.7.1-1"),
            Some(false)
        );
        assert_eq!(
            release_is_newer(AgentType::Gemini, "0.43.0", "0.44.1"),
            Some(true)
        );
    }

    #[cfg(unix)]
    fn fake_program(path: &Path, body: &str) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::write(path, body).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stages_another_builtin_npm_agent_without_publishing() {
        let root = tempfile::tempdir().unwrap();
        let npm = root.path().join("fake-npm");
        fake_program(
            &npm,
            r#"#!/bin/sh
set -eu
for arg in "$@"; do
  case "$arg" in --prefix=*) prefix="${arg#--prefix=}" ;; esac
done
mkdir -p "$prefix/bin"
printf '#!/bin/sh\nprintf "1.2.3\\n"\n' > "$prefix/bin/claude-agent-acp"
chmod +x "$prefix/bin/claude-agent-acp"
"#,
        );
        let installed = prepare_at(AgentType::ClaudeCode, "1.2.3", root.path(), &npm)
            .await
            .unwrap();
        assert!(root
            .path()
            .join(installed.directory)
            .join("bin/claude-agent-acp")
            .is_file());
        assert!(!root.path().join("active.json").exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stages_custom_python_agent_in_private_tool_directories() {
        let _guard = crate::acp::custom_registry::hydrate_test_guard();
        let def: crate::acp::custom_registry::CustomAgentDef = serde_json::from_value(serde_json::json!({
            "registry_id": "auto-update-python-test", "name": "Python test", "description": "", "version": "1.0.0",
            "distribution_kind": "uvx", "spec": { "uvx": { "package": "python-agent[extra]==1.0.0", "cmd": "python-agent", "python": "3.12" } }
        })).unwrap();
        assert!(crate::acp::custom_registry::hydrate(&[def]).is_empty());
        let agent = AgentType::custom("auto-update-python-test").unwrap();
        let root = tempfile::tempdir().unwrap();
        let uv = root.path().join("fake-uv");
        fake_program(
            &uv,
            r#"#!/bin/sh
set -eu
mkdir -p "$UV_TOOL_DIR" "$UV_TOOL_BIN_DIR"
printf '%s\n' "$@" > "$UV_TOOL_DIR/arguments"
printf '#!/bin/sh\nprintf "1.1.0\\n"\n' > "$UV_TOOL_BIN_DIR/python-agent"
chmod +x "$UV_TOOL_BIN_DIR/python-agent"
"#,
        );
        let result = prepare_python_with_uv(agent, "1.1.0", root.path(), &uv).await;
        crate::acp::custom_registry::hydrate(&[]);
        let installed = result.unwrap();
        let prefix = root.path().join(installed.directory);
        let args = std::fs::read_to_string(prefix.join("tools/arguments")).unwrap();
        assert!(args.contains("python-agent[extra]==1.1.0"));
        assert!(args.contains("--python\n3.12"));
        assert!(prefix.join(installed.entry.unwrap()).is_file());
        assert!(!root.path().join("active.json").exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stages_binary_tree_and_rejects_checksum_mismatch_without_activation() {
        use std::io::{Read, Write};
        let bytes = b"#!/bin/sh\nprintf '2026.09.03-test\n'\n";
        let encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        let mut tar = tar::Builder::new(encoder);
        let mut header = tar::Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_mode(0o755);
        header.set_cksum();
        tar.append_data(&mut header, "dist-package/cursor-agent", bytes.as_slice())
            .unwrap();
        let archive = tar.into_inner().unwrap().finish().unwrap();
        for checksum in [None, Some("0".repeat(64))] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}/agent.tar.gz", listener.local_addr().unwrap());
            let body = archive.clone();
            let server = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                let mut request = [0; 4096];
                let _ = socket.read(&mut request);
                write!(
                    socket,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                )
                .unwrap();
                socket.write_all(&body).unwrap();
            });
            let root = tempfile::tempdir().unwrap();
            let release = crate::acp::remote_registry::RegistryBinaryRelease {
                version: "2026.09.03-test".into(),
                archive_url: url,
                sha256: checksum.clone(),
            };
            let result =
                prepare_binary_release(AgentType::Cursor, &release.version, root.path(), &release)
                    .await;
            server.join().unwrap();
            if checksum.is_some() {
                assert!(result.err().unwrap().contains("checksum mismatch"));
            } else {
                let installed = result.unwrap();
                assert!(root
                    .path()
                    .join(installed.directory)
                    .join(installed.entry.unwrap())
                    .is_file());
            }
            assert!(!root.path().join("active.json").exists());
        }
    }

    #[test]
    fn publication_replaces_marker_without_touching_previous_install() {
        let root = tempfile::tempdir().unwrap();
        let old = root.path().join("previous");
        std::fs::create_dir(&old).unwrap();
        for version in ["1.0.0", "1.0.1"] {
            publish(
                root.path(),
                &Installed {
                    directory: uuid::Uuid::new_v4().to_string(),
                    version: version.into(),
                    entry: None,
                    identity: None,
                },
            )
            .unwrap();
        }
        let marker: Installed =
            serde_json::from_slice(&std::fs::read(root.path().join("active.json")).unwrap())
                .unwrap();
        assert_eq!(marker.version, "1.0.1");
        assert!(old.is_dir());
    }
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub fn acp_agent_auto_update_status(agent_type: AgentType) -> AutoUpdateStatus {
    status(agent_type)
}
