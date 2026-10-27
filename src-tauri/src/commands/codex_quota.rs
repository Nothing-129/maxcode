//! Read-only subscription quotas via the installed Codex app-server. Credentials
//! remain owned by Codex, including keyring storage and normal token renewal.
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;

use crate::app_error::AppCommandError;
use crate::db::{service::agent_setting_service, AppDatabase};
use crate::models::agent::AgentType;

const REFRESH_INTERVAL: Duration = Duration::from_secs(300);

#[derive(Clone, Default, Serialize)]
pub struct CodexQuota {
    pub official: bool,
    pub plan_type: Option<String>,
    pub windows: Vec<QuotaWindow>,
    pub updated_at: Option<i64>,
    pub error: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct QuotaWindow {
    pub window_minutes: i64,
    pub used_percent: f64,
    pub resets_at: Option<i64>,
}

struct Cache {
    key: u64,
    checked: Instant,
    quota: CodexQuota,
}
static CACHE: OnceLock<Mutex<Option<Cache>>> = OnceLock::new();

fn can_reuse_cache(cache: &Cache, force: bool, requested_at: Instant) -> bool {
    // Share a result completed while this request waited for the mutex, even
    // for manual refreshes. A new manual action bypasses the automatic TTL.
    cache.checked >= requested_at || (!force && cache.checked.elapsed() < REFRESH_INTERVAL)
}

// Retained ChatGPT credentials must not make a third-party provider look like
// an official login. Fail closed on malformed native config.
fn official_config(config: &str) -> bool {
    let Ok(value) = config.parse::<toml::Value>() else {
        return false;
    };
    let profile = value
        .get("profile")
        .and_then(toml::Value::as_str)
        .and_then(|name| {
            value
                .get("profiles")
                .and_then(|profiles| profiles.get(name))
        });
    let provider = profile
        .and_then(|profile| profile.get("model_provider"))
        .or_else(|| value.get("model_provider"))
        .and_then(toml::Value::as_str)
        .unwrap_or("openai");
    if ["OPENAI_API_KEY", "OPENAI_BASE_URL"].iter().any(|key| {
        value
            .get("env")
            .and_then(|env| env.get(*key))
            .and_then(toml::Value::as_str)
            .is_some_and(|s| !s.trim().is_empty())
    }) {
        return false;
    }
    if provider != "openai" {
        return false;
    }
    if value
        .get("forced_login_method")
        .and_then(toml::Value::as_str)
        == Some("api")
    {
        return false;
    }
    // Custom overrides of the builtin provider are not the official route.
    value
        .get("model_providers")
        .and_then(|v| v.get(provider))
        .is_none()
}

pub async fn read_core(db: &AppDatabase, force: bool) -> Result<CodexQuota, AppCommandError> {
    let requested_at = Instant::now();
    let setting = agent_setting_service::get_by_agent_type(&db.conn, AgentType::Codex)
        .await
        .map_err(|_| AppCommandError::task_execution_failed("Could not read Codex settings"))?;
    if setting
        .as_ref()
        .is_some_and(|s| !s.enabled || s.model_provider_id.is_some())
    {
        return Ok(CodexQuota::default());
    }
    let mut env: std::collections::BTreeMap<String, String> = setting
        .as_ref()
        .and_then(|s| s.env_json.as_deref())
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    for key in ["OPENAI_API_KEY", "OPENAI_BASE_URL"] {
        if env
            .get(key)
            .cloned()
            .or_else(|| std::env::var(key).ok())
            .is_some_and(|s| !s.trim().is_empty())
        {
            return Ok(CodexQuota::default());
        }
    }
    let home = env
        .get("CODEX_HOME")
        .filter(|s| !s.trim().is_empty())
        .map(|s| {
            if let Some(rest) = s.strip_prefix("~/") {
                dirs::home_dir().unwrap_or_default().join(rest)
            } else {
                std::path::PathBuf::from(s)
            }
        })
        .unwrap_or_else(super::acp::codex_home_dir);
    env.insert("CODEX_HOME".into(), home.to_string_lossy().into_owned());
    let config = match std::fs::read_to_string(home.join("config.toml")) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(_) => return Ok(CodexQuota::default()),
    };
    if !official_config(&config) {
        return Ok(CodexQuota::default());
    }
    let mut hash = DefaultHasher::new();
    home.hash(&mut hash);
    config.hash(&mut hash);
    env.hash(&mut hash);
    // Credential/config changes invalidate cached numbers before exposing them.
    let auth_path = home.join("auth.json");
    std::fs::read(&auth_path).ok().hash(&mut hash);
    let key = hash.finish();
    let mut guard = CACHE.get_or_init(|| Mutex::new(None)).lock().await;
    if let Some(cached) = guard.as_ref().filter(|c| c.key == key) {
        if can_reuse_cache(cached, force, requested_at) {
            return Ok(cached.quota.clone());
        }
    }
    let previous = guard
        .as_ref()
        .filter(|c| c.key == key)
        .map(|c| c.quota.clone());
    let result = tokio::time::timeout(Duration::from_secs(25), query(&env)).await;
    let quota = match result {
        Ok(Ok(mut quota)) => {
            if quota.official && quota.error.is_some() {
                if let Some(previous) = previous.as_ref().filter(|p| p.official) {
                    quota.windows = previous.windows.clone();
                    quota.updated_at = previous.updated_at;
                }
            }
            quota
        }
        _ => {
            let mut quota = previous.unwrap_or_default();
            quota.error = Some("unavailable".into());
            quota
        }
    };
    *guard = Some(Cache {
        key,
        checked: Instant::now(),
        quota: quota.clone(),
    });
    Ok(quota)
}

async fn rpc(
    input: &mut tokio::process::ChildStdin,
    output: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    id: u64,
    method: &str,
    params: Value,
) -> Result<Value, ()> {
    let request = format!("{}\n", json!({"id":id,"method":method,"params":params}));
    input.write_all(request.as_bytes()).await.map_err(|_| ())?;
    // Ignore notifications, but cap unsolicited output so a broken runtime
    // cannot keep this read-only request alive indefinitely.
    for _ in 0..128 {
        let line = output.next_line().await.map_err(|_| ())?.ok_or(())?;
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if message.get("id").and_then(Value::as_u64) == Some(id) {
            return message.get("result").cloned().ok_or(());
        }
    }
    Err(())
}

async fn query(env: &std::collections::BTreeMap<String, String>) -> Result<CodexQuota, ()> {
    let command = crate::acp::codex_catalog_source::account_command()
        .await
        .ok_or(())?;
    query_command(command, env).await
}

async fn query_command(
    mut command: tokio::process::Command,
    env: &std::collections::BTreeMap<String, String>,
) -> Result<CodexQuota, ()> {
    // Account quotas belong to the global login, not the repository the
    // server happened to be launched from (which may override providers).
    if let Some(home) = env.get("CODEX_HOME") {
        command.current_dir(home);
    }
    command
        .arg("app-server")
        .envs(env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(|_| ())?;
    let result = async {
        let mut input = child.stdin.take().ok_or(())?;
        let mut output = BufReader::new(child.stdout.take().ok_or(())?).lines();
        rpc(
            &mut input,
            &mut output,
            1,
            "initialize",
            json!({
                "clientInfo":{"name":"maxcode-quota","version":env!("CARGO_PKG_VERSION")}
            }),
        )
        .await?;
        input
            .write_all(b"{\"method\":\"initialized\"}\n")
            .await
            .map_err(|_| ())?;
        let account = rpc(
            &mut input,
            &mut output,
            2,
            "account/read",
            json!({"refreshToken":false}),
        )
        .await?;
        if account.pointer("/account/type").and_then(Value::as_str) != Some("chatgpt")
            || account.get("requiresOpenaiAuth").and_then(Value::as_bool) == Some(false)
        {
            return Ok(CodexQuota::default());
        }
        let mut quota = CodexQuota {
            official: true,
            plan_type: account
                .pointer("/account/planType")
                .and_then(Value::as_str)
                .map(str::to_owned),
            ..Default::default()
        };
        match tokio::time::timeout(
            Duration::from_secs(15),
            rpc(
                &mut input,
                &mut output,
                3,
                "account/rateLimits/read",
                json!({}),
            ),
        )
        .await
        {
            Ok(Ok(result)) => {
                quota.windows = parse_windows(&result);
                if quota.windows.is_empty() {
                    quota.error = Some("unavailable".into());
                } else {
                    quota.updated_at = Some(chrono::Utc::now().timestamp());
                }
            }
            _ => quota.error = Some("unavailable".into()),
        }
        Ok(quota)
    }
    .await;
    let _ = child.kill().await;
    let _ = child.wait().await;
    result
}

fn parse_windows(result: &Value) -> Vec<QuotaWindow> {
    // Never accidentally label a model-specific pool as the account quota.
    let bucket = if let Some(buckets) = result.get("rateLimitsByLimitId").filter(|v| v.is_object())
    {
        buckets.get("codex")
    } else {
        result.get("rateLimits").filter(|v| {
            v.get("limitId")
                .and_then(Value::as_str)
                .is_none_or(|id| id == "codex")
        })
    };
    let mut windows = Vec::new();
    if let Some(bucket) = bucket {
        for name in ["primary", "secondary"] {
            let Some(window) = bucket.get(name) else {
                continue;
            };
            let Some(minutes) = window
                .get("windowDurationMins")
                .and_then(Value::as_i64)
                .filter(|n| *n > 0)
            else {
                continue;
            };
            let Some(used) = window
                .get("usedPercent")
                .and_then(Value::as_f64)
                .filter(|n| (0.0..=100.0).contains(n))
            else {
                continue;
            };
            windows.push(QuotaWindow {
                window_minutes: minutes,
                used_percent: used,
                resets_at: window
                    .get("resetsAt")
                    .and_then(Value::as_i64)
                    .filter(|n| *n > 0),
            });
        }
    }
    windows.sort_by_key(|w| w.window_minutes);
    windows.dedup_by_key(|w| w.window_minutes);
    windows
}

#[cfg(test)]
#[path = "../../../src/maxcode-contracts/codex-quota.contract.rs"]
mod contract;
