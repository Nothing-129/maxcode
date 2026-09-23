use std::collections::HashSet;

use sea_orm::DatabaseConnection;

use crate::acp::terminal_runtime::TerminalShellRuntimeConfig;
use crate::app_error::AppCommandError;
use crate::db::service::app_metadata_service;

use crate::models::{
    AvailableTerminalShells, SystemLanguageSettings, SystemProxySettings, SystemTerminalSettings,
    SystemTitleModelSettings, SystemTitleModelSettingsUpdate, SystemTitleModelTestResult,
    TerminalShellOption, TitleModelRequestParam,
};

use crate::network::proxy;

use crate::terminal::manager::resolve_shell;

pub(crate) const SYSTEM_PROXY_SETTINGS_KEY: &str = "system_proxy_settings";
pub(crate) const SYSTEM_LANGUAGE_SETTINGS_KEY: &str = "system_language_settings";
pub(crate) const SYSTEM_TERMINAL_SETTINGS_KEY: &str = "system_terminal_settings";
pub(crate) const SYSTEM_TITLE_MODEL_SETTINGS_KEY: &str = "system_title_model_settings";
pub(crate) const LANGUAGE_SETTINGS_UPDATED_EVENT: &str = "app://language-settings-updated";
pub(crate) const TERMINAL_SETTINGS_UPDATED_EVENT: &str = "app://terminal-settings-updated";

const DEFAULT_TITLE_MODEL_BASE_URL: &str = "https://api.groq.com/openai/v1";
const DEFAULT_TITLE_MODEL_NAME: &str = "qwen/qwen3.8-27b";
const DEFAULT_TITLE_MODEL_REASONING_EFFORT: &str = "none";

pub(crate) const TERMINAL_SHELL_OPTION_SYSTEM: &str = "system";
pub(crate) const TERMINAL_SHELL_OPTION_CUSTOM: &str = "custom";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
#[serde(default)]
struct StoredTitleModelSettings {
    enabled: bool,
    base_url: String,
    model: String,
    api_key: Option<String>,
    request_params: Vec<TitleModelRequestParam>,
}

/// Complete runtime settings, kept crate-private so the API key cannot become
/// part of a command/web response by accident.
#[derive(Debug, Clone)]
pub(crate) struct TitleModelRuntimeSettings {
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
    pub request_params: serde_json::Map<String, serde_json::Value>,
}

const TITLE_MODEL_REQUEST_PARAM_LIMIT: usize = 32;
const RESERVED_TITLE_MODEL_REQUEST_PARAMS: &[&str] = &["model", "messages", "stream"];

fn normalize_title_model_request_params(
    params: Vec<TitleModelRequestParam>,
) -> Result<Vec<TitleModelRequestParam>, AppCommandError> {
    if params.len() > TITLE_MODEL_REQUEST_PARAM_LIMIT {
        return Err(AppCommandError::invalid_input(format!(
            "Title model supports at most {TITLE_MODEL_REQUEST_PARAM_LIMIT} request parameters"
        )));
    }

    let mut normalized = Vec::with_capacity(params.len());
    let mut keys = HashSet::with_capacity(params.len());
    for param in params {
        let key = param.key.trim();
        if key.is_empty() {
            if param.value.trim().is_empty() {
                continue;
            }
            return Err(AppCommandError::invalid_input(
                "Title model request parameter key cannot be blank",
            ));
        }
        if RESERVED_TITLE_MODEL_REQUEST_PARAMS
            .iter()
            .any(|reserved| key.eq_ignore_ascii_case(reserved))
        {
            return Err(AppCommandError::invalid_input(format!(
                "Title model request parameter '{key}' is managed by the app"
            )));
        }
        if !keys.insert(key.to_string()) {
            return Err(AppCommandError::invalid_input(format!(
                "Duplicate title model request parameter '{key}'"
            )));
        }
        normalized.push(TitleModelRequestParam {
            key: key.to_string(),
            value: param.value,
        });
    }
    Ok(normalized)
}

fn parse_title_model_request_params(
    params: &[TitleModelRequestParam],
) -> serde_json::Map<String, serde_json::Value> {
    params
        .iter()
        .map(|param| {
            let value = serde_json::from_str(param.value.trim())
                .unwrap_or_else(|_| serde_json::Value::String(param.value.clone()));
            (param.key.clone(), value)
        })
        .collect()
}

fn normalize_title_model_base_url(raw: &str) -> Result<String, AppCommandError> {
    let trimmed = raw.trim().trim_end_matches('/');
    let parsed = reqwest::Url::parse(trimmed).map_err(|e| {
        AppCommandError::configuration_invalid("Invalid title model API URL")
            .with_detail(e.to_string())
    })?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(AppCommandError::configuration_invalid(
            "Title model API URL must be an http(s) URL with a host",
        ));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(AppCommandError::configuration_invalid(
            "Title model API URL must not contain credentials",
        ));
    }
    Ok(trimmed.to_string())
}

async fn load_stored_title_model_settings(
    conn: &DatabaseConnection,
) -> Result<Option<StoredTitleModelSettings>, AppCommandError> {
    let raw = app_metadata_service::get_value(conn, SYSTEM_TITLE_MODEL_SETTINGS_KEY)
        .await
        .map_err(AppCommandError::from)?;
    let Some(raw) = raw else {
        return Ok(None);
    };
    serde_json::from_str(&raw).map(Some).map_err(|e| {
        AppCommandError::configuration_invalid("Failed to parse stored title model settings")
            .with_detail(e.to_string())
    })
}

fn default_system_title_model_settings() -> SystemTitleModelSettings {
    SystemTitleModelSettings {
        enabled: true,
        base_url: DEFAULT_TITLE_MODEL_BASE_URL.to_string(),
        model: DEFAULT_TITLE_MODEL_NAME.to_string(),
        api_key_configured: false,
        request_params: vec![TitleModelRequestParam {
            key: "reasoning_effort".to_string(),
            value: DEFAULT_TITLE_MODEL_REASONING_EFFORT.to_string(),
        }],
    }
}

pub(crate) async fn load_system_title_model_settings(
    conn: &DatabaseConnection,
) -> Result<SystemTitleModelSettings, AppCommandError> {
    let Some(stored) = load_stored_title_model_settings(conn).await? else {
        return Ok(default_system_title_model_settings());
    };
    let request_params = normalize_title_model_request_params(stored.request_params)?;
    Ok(SystemTitleModelSettings {
        enabled: stored.enabled,
        base_url: stored.base_url,
        model: stored.model,
        api_key_configured: stored.api_key.as_deref().is_some_and(|v| !v.is_empty()),
        request_params,
    })
}

pub(crate) async fn load_title_model_runtime_settings(
    conn: &DatabaseConnection,
) -> Result<Option<TitleModelRuntimeSettings>, AppCommandError> {
    let Some(stored) = load_stored_title_model_settings(conn).await? else {
        return Ok(None);
    };
    if !stored.enabled {
        return Ok(None);
    }
    let base_url = normalize_title_model_base_url(&stored.base_url)?;
    let model = stored.model.trim();
    if model.is_empty() {
        return Err(AppCommandError::configuration_missing(
            "Title model name is required when title generation is enabled",
        ));
    }
    let request_params = normalize_title_model_request_params(stored.request_params)?;
    Ok(Some(TitleModelRuntimeSettings {
        base_url,
        model: model.to_string(),
        api_key: stored.api_key.filter(|v| !v.is_empty()),
        request_params: parse_title_model_request_params(&request_params),
    }))
}

pub(crate) async fn set_system_title_model_settings_core(
    conn: &DatabaseConnection,
    settings: SystemTitleModelSettingsUpdate,
) -> Result<SystemTitleModelSettings, AppCommandError> {
    let existing = load_stored_title_model_settings(conn)
        .await?
        .unwrap_or_default();
    let base_url = settings.base_url.trim().trim_end_matches('/').to_string();
    let model = settings.model.trim().to_string();
    let request_params = normalize_title_model_request_params(settings.request_params)?;
    if settings.enabled {
        normalize_title_model_base_url(&base_url)?;
        if model.is_empty() {
            return Err(AppCommandError::configuration_missing(
                "Title model name is required when title generation is enabled",
            ));
        }
    } else if !base_url.is_empty() {
        normalize_title_model_base_url(&base_url)?;
    }

    let submitted_key = settings
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    let api_key = if settings.clear_api_key {
        None
    } else {
        submitted_key.or(existing.api_key)
    };
    let stored = StoredTitleModelSettings {
        enabled: settings.enabled,
        base_url: base_url.clone(),
        model: model.clone(),
        api_key,
        request_params: request_params.clone(),
    };
    let serialized = serde_json::to_string(&stored).map_err(|e| {
        AppCommandError::invalid_input("Failed to serialize title model settings")
            .with_detail(e.to_string())
    })?;
    app_metadata_service::upsert_value(conn, SYSTEM_TITLE_MODEL_SETTINGS_KEY, &serialized)
        .await
        .map_err(AppCommandError::from)?;

    Ok(SystemTitleModelSettings {
        enabled: stored.enabled,
        base_url,
        model,
        api_key_configured: stored.api_key.is_some(),
        request_params,
    })
}

/// Test the current form draft without persisting it. A blank key reuses the
/// one already stored by either the desktop or Web settings surface; explicit
/// clearing tests the endpoint with no Authorization header.
pub(crate) async fn test_system_title_model_settings_core(
    conn: &DatabaseConnection,
    settings: SystemTitleModelSettingsUpdate,
) -> Result<SystemTitleModelTestResult, AppCommandError> {
    let existing = load_stored_title_model_settings(conn)
        .await?
        .unwrap_or_default();
    let base_url = normalize_title_model_base_url(&settings.base_url)?;
    let model = settings.model.trim();
    if model.is_empty() {
        return Err(AppCommandError::configuration_missing(
            "Title model name is required to test the connection",
        ));
    }
    let submitted_key = settings
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    let api_key = if settings.clear_api_key {
        None
    } else {
        submitted_key.or(existing.api_key)
    };
    let request_params = normalize_title_model_request_params(settings.request_params)?;
    let runtime = TitleModelRuntimeSettings {
        base_url,
        model: model.to_string(),
        api_key,
        request_params: parse_title_model_request_params(&request_params),
    };
    let locale = load_system_language_settings(conn)
        .await
        .map(|value| crate::session_title::resolve_title_locale(&value))
        .unwrap_or(crate::session_title::TitleLocale::En);
    let started = std::time::Instant::now();
    let title = crate::session_title::test_title_model_connection(&runtime, locale).await?;
    let latency_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    Ok(SystemTitleModelTestResult { title, latency_ms })
}

/// Trim, validate, and canonicalize proxy settings. Shared by the save path,
/// the load path, and the web handler so all three agree on what gets stored.
///
/// Enabling the proxy rewrites the address into one that carries an explicit
/// scheme (see [`proxy::normalize_proxy_url`]) — the stored value, the value
/// echoed back to the settings page, and the value exported to child processes
/// are then the same string. Because the load path normalizes too, a row saved
/// by an older build with a bare `host:port` heals on read; no migration.
pub(crate) fn normalize_proxy_settings(
    settings: SystemProxySettings,
) -> Result<SystemProxySettings, AppCommandError> {
    if !settings.enabled {
        let proxy_url = settings
            .proxy_url
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        return Ok(SystemProxySettings {
            enabled: false,
            proxy_url,
        });
    }

    let proxy_url = settings
        .proxy_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppCommandError::configuration_missing("Proxy URL is required when proxy is enabled")
        })?;

    Ok(SystemProxySettings {
        enabled: true,
        proxy_url: Some(proxy::normalize_proxy_url(proxy_url)?),
    })
}

pub(crate) async fn load_system_proxy_settings(
    conn: &DatabaseConnection,
) -> Result<SystemProxySettings, AppCommandError> {
    let raw = app_metadata_service::get_value(conn, SYSTEM_PROXY_SETTINGS_KEY)
        .await
        .map_err(AppCommandError::from)?;

    let Some(raw) = raw else {
        return Ok(SystemProxySettings::default());
    };

    let parsed = serde_json::from_str::<SystemProxySettings>(&raw).map_err(|e| {
        AppCommandError::configuration_invalid("Failed to parse stored proxy settings")
            .with_detail(e.to_string())
    })?;
    normalize_proxy_settings(parsed)
}

pub(crate) async fn load_system_language_settings(
    conn: &DatabaseConnection,
) -> Result<SystemLanguageSettings, AppCommandError> {
    let raw = app_metadata_service::get_value(conn, SYSTEM_LANGUAGE_SETTINGS_KEY)
        .await
        .map_err(AppCommandError::from)?;

    let Some(raw) = raw else {
        return Ok(SystemLanguageSettings::default());
    };

    serde_json::from_str::<SystemLanguageSettings>(&raw).map_err(|e| {
        AppCommandError::configuration_invalid("Failed to parse stored language settings")
            .with_detail(e.to_string())
    })
}

/// Resolve a shell choice to the path the host can currently find.
/// This probe drives both the install badge and the path reported in settings.
fn resolve_shell_path(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    let path = std::path::Path::new(trimmed);
    let looks_like_path = path.is_absolute()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || path.components().count() > 1;

    if looks_like_path {
        if path.is_file() {
            return Some(trimmed.to_string());
        }
        // Windows launches extension-less paths that resolve to .exe files.
        #[cfg(windows)]
        if path.extension().is_none() {
            let with_exe = path.with_extension("exe");
            if with_exe.is_file() {
                return Some(with_exe.display().to_string());
            }
        }
        return None;
    }

    which::which(trimmed)
        .ok()
        .map(|resolved| resolved.display().to_string())
}

fn shell_exists(value: &str) -> bool {
    resolve_shell_path(value).is_some()
}

/// The shell a new built-in terminal tab would try to launch. A configured
/// choice remains visible even if it is not currently installed.
pub(crate) fn resolve_effective_shell(default_shell: Option<&str>) -> String {
    match default_shell
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        None => resolve_shell(),
        Some(selected) => resolve_shell_path(selected).unwrap_or_else(|| selected.to_string()),
    }
}

/// Trim and drop empty-only. We deliberately do **not** filter by host
/// platform: the Settings UI's custom-path field lets users type any shell
/// they want, and silently rewriting their input is more confusing than
/// letting `terminal_spawn` surface the failure if the path is wrong.
pub(crate) fn normalize_terminal_settings(
    settings: SystemTerminalSettings,
) -> SystemTerminalSettings {
    SystemTerminalSettings {
        default_shell: settings
            .default_shell
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        // Nothing to canonicalize on a bool; carried explicitly so adding a
        // field here can never silently drop it back to the default.
        colorize_command_output: settings.colorize_command_output,
    }
}

/// Build the per-platform option list shown in the "default shell" picker.
/// The frontend renders these verbatim, looking each `label_key` up under its
/// `GeneralSettings` namespace — so adding a new shell here requires zero
/// frontend code changes (only a new translation key).
pub(crate) fn build_available_terminal_shells(
    default_shell: Option<&str>,
) -> AvailableTerminalShells {
    let mut options: Vec<TerminalShellOption> = Vec::new();

    options.push(TerminalShellOption {
        id: TERMINAL_SHELL_OPTION_SYSTEM.to_string(),
        label_key: "terminalSystemDefault".to_string(),
        value: None,
        // System default always "exists" — resolve_shell() has its own fallback chain.
        exists: true,
        accepts_custom_path: false,
    });

    if cfg!(target_os = "windows") {
        for (id, label_key) in [
            ("pwsh.exe", "terminalPowerShell7"),
            ("powershell.exe", "terminalWindowsPowerShell"),
            ("cmd.exe", "terminalCmd"),
        ] {
            options.push(TerminalShellOption {
                id: id.to_string(),
                label_key: label_key.to_string(),
                value: Some(id.to_string()),
                exists: shell_exists(id),
                accepts_custom_path: false,
            });
        }
    }

    options.push(TerminalShellOption {
        id: TERMINAL_SHELL_OPTION_CUSTOM.to_string(),
        label_key: "terminalShellCustom".to_string(),
        value: None,
        // The "custom" row itself is always available; the path the user
        // types is validated via probe_terminal_shell_path.
        exists: true,
        accepts_custom_path: true,
    });

    AvailableTerminalShells {
        options,
        resolved_shell: resolve_effective_shell(default_shell),
    }
}

/// Probe whether a user-supplied shell path or command exists on the host.
/// Returns `false` for empty / whitespace-only input.
pub(crate) fn probe_terminal_shell_path_core(path: &str) -> bool {
    shell_exists(path)
}

pub(crate) async fn load_system_terminal_settings(
    conn: &DatabaseConnection,
) -> Result<SystemTerminalSettings, AppCommandError> {
    let raw = app_metadata_service::get_value(conn, SYSTEM_TERMINAL_SETTINGS_KEY)
        .await
        .map_err(AppCommandError::from)?;

    let Some(raw) = raw else {
        return Ok(SystemTerminalSettings::default());
    };

    let parsed = serde_json::from_str::<SystemTerminalSettings>(&raw).map_err(|e| {
        AppCommandError::configuration_invalid("Failed to parse stored terminal settings")
            .with_detail(e.to_string())
    })?;

    Ok(normalize_terminal_settings(parsed))
}

/// Load the persisted terminal settings into the live runtimes: the shell
/// selection into the ACP terminal runtime, and the command-color opt-in into
/// the launch env (`crate::acp::connection::set_force_command_color`).
///
/// This runs during app startup; a failure leaves the runtime on its system
/// fallback so a malformed old preference cannot prevent agents from running.
/// Both live values are applied from ONE load — they share a stored row, and
/// reading it twice would let a save land between the two reads.
pub async fn apply_persisted_terminal_settings(
    conn: &DatabaseConnection,
    config: &TerminalShellRuntimeConfig,
) {
    match load_system_terminal_settings(conn).await {
        Ok(settings) => {
            crate::acp::connection::set_force_command_color(settings.colorize_command_output);
            config.set(settings.default_shell).await;
        }
        // Both live values stay on their process defaults — system shell, and
        // color off. Naming only the shell here would send whoever reads this
        // log looking for a second, non-existent failure when the colored
        // transcript they opted into also fails to show up.
        Err(err) => tracing::warn!(
            "[settings] failed to load terminal settings (default shell, command color) for ACP runtime: {err}"
        ),
    }
}

/// Persist, apply, and broadcast the default shell in one path shared by the
/// desktop command and web handler.
pub(crate) async fn set_system_terminal_settings_core(
    conn: &DatabaseConnection,
    config: &TerminalShellRuntimeConfig,
    emitter: &crate::web::event_bridge::EventEmitter,
    settings: SystemTerminalSettings,
) -> Result<SystemTerminalSettings, AppCommandError> {
    let normalized = normalize_terminal_settings(settings);
    let serialized = serde_json::to_string(&normalized).map_err(|e| {
        AppCommandError::invalid_input("Failed to serialize terminal settings")
            .with_detail(e.to_string())
    })?;

    app_metadata_service::upsert_value(conn, SYSTEM_TERMINAL_SETTINGS_KEY, &serialized)
        .await
        .map_err(AppCommandError::from)?;

    // Update the shared handles before notifying the frontend, so an already
    // connected model can issue its next terminal request with the new shell.
    // The color flag only reaches a launch's env, so it lands on the NEXT
    // connection rather than the running one.
    crate::acp::connection::set_force_command_color(normalized.colorize_command_output);
    config.set(normalized.default_shell.clone()).await;
    crate::web::event_bridge::emit_event(
        emitter,
        TERMINAL_SETTINGS_UPDATED_EVENT,
        normalized.clone(),
    );

    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::fresh_in_memory_db;
    use crate::web::event_bridge::EventEmitter;
    use std::collections::BTreeMap;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn one_shot_title_server() -> (String, tokio::sync::oneshot::Receiver<String>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind title test server");
        let addr = listener.local_addr().expect("title test address");
        let (tx, rx) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept title request");
            let mut request = Vec::new();
            let mut buf = [0_u8; 2048];
            loop {
                let read = stream.read(&mut buf).await.expect("read title request");
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buf[..read]);
                let Some(header_end) = request.windows(4).position(|w| w == b"\r\n\r\n") else {
                    continue;
                };
                let headers = String::from_utf8_lossy(&request[..header_end]);
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().ok())
                            .flatten()
                    })
                    .unwrap_or(0);
                if request.len() >= header_end + 4 + content_length {
                    break;
                }
            }
            let _ = tx.send(String::from_utf8_lossy(&request).into_owned());
            let body = r#"{"choices":[{"message":{"content":"0101/探索/Test title model"}}]}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .await
                .expect("write title response");
        });
        (format!("http://{addr}/v1"), rx)
    }

    /// Every terminal-settings save writes `FORCE_COMMAND_COLOR`, a PROCESS
    /// global — so two of these tests running concurrently (the default) would
    /// have one clobber the flag the other is about to assert on. The clobber
    /// is not hypothetical: `set_system_terminal_settings_core` awaits between
    /// storing the flag and returning, which is exactly where the other test's
    /// store lands. Anything that saves or applies terminal settings holds this
    /// first.
    static TERMINAL_SETTINGS_SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    /// Restores `FORCE_COMMAND_COLOR` on the way out, including on a panic —
    /// a test that left it set would make the *next* run of the "off by
    /// default" assertion fail for reasons that have nothing to do with the
    /// code under test.
    struct RestoreCommandColor(bool);

    impl RestoreCommandColor {
        fn capture() -> Self {
            Self(crate::acp::connection::force_command_color_enabled())
        }
    }

    impl Drop for RestoreCommandColor {
        fn drop(&mut self) {
            crate::acp::connection::set_force_command_color(self.0);
        }
    }

    /// The command-color variables a REAL launch env carries right now.
    ///
    /// The setting only matters if it survives the trip from the stored row
    /// through the process global into the env a spawn actually gets, and the
    /// step joining those — `merge_agent_env` reading the global — is the one
    /// place the pure-function tests in `acp::connection` cannot reach. Any
    /// launch would do; Antigravity's is the one exposed as a `pub fn`, and it
    /// merges through the same helper as every other agent.
    ///
    /// Returns the whole set rather than a yes/no so both directions are exact:
    /// "on" has to produce every variable (they cover disjoint decisions —
    /// `CLICOLOR` enables the BSD family, `CLICOLOR_FORCE` waives its `isatty`
    /// check, `FORCE_COLOR` covers the npm one, `TERM` feeds the terminfo lookup
    /// — so a launch carrying only some of them is a failure, not a partial
    /// success), and "off" has to produce none. A boolean over `all()` would let
    /// the off case pass while leaking one of them.
    fn launch_env_color_vars() -> BTreeMap<String, String> {
        crate::acp::connection::antigravity_launch_env(&BTreeMap::new(), None)
            .into_iter()
            .filter(|(key, _)| {
                matches!(
                    key.as_str(),
                    "CLICOLOR" | "CLICOLOR_FORCE" | "FORCE_COLOR" | "TERM"
                )
            })
            .collect()
    }

    fn expected_color_vars() -> BTreeMap<String, String> {
        [
            ("CLICOLOR", "1"),
            ("CLICOLOR_FORCE", "1"),
            ("FORCE_COLOR", "1"),
            ("TERM", "xterm-256color"),
        ]
        .into_iter()
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect()
    }

    fn enabled_proxy(url: &str) -> SystemProxySettings {
        SystemProxySettings {
            enabled: true,
            proxy_url: Some(url.to_string()),
        }
    }

    fn normalized_url(url: &str) -> String {
        normalize_proxy_settings(enabled_proxy(url))
            .expect("proxy url should be accepted")
            .proxy_url
            .expect("enabled proxy keeps its url")
    }

    /// A scheme-less address is what a user actually types, and what used to
    /// reach `HTTP_PROXY` verbatim — killing every npm-based agent install with
    /// `ERR_INVALID_URL` while codeg's own reqwest calls kept working.
    #[test]
    fn scheme_less_proxy_addresses_gain_an_http_scheme() {
        assert_eq!(normalized_url("127.0.0.1:7890"), "http://127.0.0.1:7890");
        // Parses as a URL whose *scheme* is `localhost` — so "did it parse" is
        // not a usable test; only the missing host gives it away.
        assert_eq!(normalized_url("localhost:7890"), "http://localhost:7890");
        assert_eq!(
            normalized_url("proxy.corp.com:8080"),
            "http://proxy.corp.com:8080"
        );
        assert_eq!(
            normalized_url("user:pass@127.0.0.1:7890"),
            "http://user:pass@127.0.0.1:7890"
        );
        // An IPv6 literal keeps its brackets — without them the address is
        // indistinguishable from a host and a port.
        assert_eq!(normalized_url("[::1]:7890"), "http://[::1]:7890");
        assert_eq!(
            normalized_url("  127.0.0.1:7890  "),
            "http://127.0.0.1:7890"
        );
    }

    /// The repaired value is the user's own string with a prefix, never the
    /// `url` crate's re-serialization — which would append a trailing slash and
    /// churn what the settings field shows back.
    #[test]
    fn normalizing_does_not_reserialize_the_address() {
        assert_eq!(normalized_url("127.0.0.1:7890/"), "http://127.0.0.1:7890/");
        assert_eq!(
            normalized_url("proxy.corp.com:8080/gateway"),
            "http://proxy.corp.com:8080/gateway"
        );
        assert_eq!(
            normalized_url("http://127.0.0.1:7890"),
            "http://127.0.0.1:7890"
        );
    }

    /// Re-running normalization over its own output must be a no-op: the value
    /// is normalized once on save and again on env export.
    #[test]
    fn normalizing_is_idempotent() {
        for url in ["127.0.0.1:7890", "[::1]:7890", "socks5://127.0.0.1:1080"] {
            let once = normalized_url(url);
            assert_eq!(normalized_url(&once), once, "{url} re-normalized");
        }
    }

    /// An address that already names a scheme must survive untouched — most of
    /// all a socks proxy, which would stop working if rewritten to `http://`.
    #[test]
    fn proxy_addresses_with_a_scheme_are_left_alone() {
        for url in [
            "http://127.0.0.1:7890",
            "https://proxy.corp.com:8443",
            "socks5://127.0.0.1:1080",
            "socks5h://127.0.0.1:1080",
        ] {
            assert_eq!(normalized_url(url), url);
        }
    }

    /// The repair must not launder a malformed address into a parseable one:
    /// `http://` has a scheme separator but no host, so prefixing it would
    /// produce `http://http://` and quietly accept it.
    #[test]
    fn malformed_addresses_are_still_rejected() {
        for url in ["http://", "socks5://", "http://:7890"] {
            assert!(
                normalize_proxy_settings(enabled_proxy(url)).is_err(),
                "{url} should not be accepted"
            );
        }
    }

    #[test]
    fn enabling_the_proxy_still_requires_an_address() {
        for settings in [
            SystemProxySettings {
                enabled: true,
                proxy_url: None,
            },
            enabled_proxy("   "),
        ] {
            assert!(normalize_proxy_settings(settings).is_err());
        }
    }

    /// Disabling keeps the stored address as typed: it is only a remembered
    /// value at that point, not something exported to a child process.
    #[test]
    fn disabled_proxy_keeps_its_address_unchanged() {
        let normalized = normalize_proxy_settings(SystemProxySettings {
            enabled: false,
            proxy_url: Some("  127.0.0.1:7890  ".to_string()),
        })
        .expect("disabled settings never validate the url");

        assert!(!normalized.enabled);
        assert_eq!(normalized.proxy_url.as_deref(), Some("127.0.0.1:7890"));
    }

    /// What actually reaches `HTTP_PROXY` and every spawned agent.
    #[test]
    fn exported_env_value_carries_the_scheme() {
        assert_eq!(
            proxy::proxy_env_value(&enabled_proxy("127.0.0.1:7890")).expect("normalizes"),
            Some("http://127.0.0.1:7890".to_string())
        );
        assert_eq!(
            proxy::proxy_env_value(&SystemProxySettings {
                enabled: false,
                proxy_url: Some("127.0.0.1:7890".to_string()),
            })
            .expect("disabled is not an error"),
            None
        );
    }

    /// Rows written by a build that stored the address verbatim must heal on
    /// read, so startup exports a usable value without a migration.
    #[tokio::test]
    async fn stored_scheme_less_proxy_heals_on_load() {
        let db = fresh_in_memory_db().await;
        app_metadata_service::upsert_value(
            &db.conn,
            SYSTEM_PROXY_SETTINGS_KEY,
            r#"{"enabled":true,"proxy_url":"127.0.0.1:7890"}"#,
        )
        .await
        .expect("seed legacy proxy row");

        let loaded = load_system_proxy_settings(&db.conn)
            .await
            .expect("load proxy settings");

        assert!(loaded.enabled);
        assert_eq!(
            loaded.proxy_url.as_deref(),
            Some("http://127.0.0.1:7890"),
            "a legacy bare host:port must be repaired on read"
        );
    }

    #[test]
    fn reported_shell_follows_the_stored_selection() {
        assert_eq!(resolve_effective_shell(None), resolve_shell());
        assert_eq!(resolve_effective_shell(Some("  ")), resolve_shell());

        let installed = if cfg!(windows) { "cmd.exe" } else { "sh" };
        let selected = resolve_effective_shell(Some(installed));
        assert!(selected.ends_with(installed), "{selected}");
        assert!(std::path::Path::new(&selected).is_absolute());

        let missing = "definitely-not-a-shell";
        assert_eq!(
            resolve_effective_shell(Some("  definitely-not-a-shell  ")),
            missing
        );
        let options = build_available_terminal_shells(Some(missing));
        assert_eq!(options.resolved_shell, missing);
        for option in options.options {
            if let Some(value) = option.value {
                assert_eq!(option.exists, resolve_shell_path(&value).is_some());
            }
        }
    }

    #[cfg(windows)]
    #[test]
    fn extensionless_windows_path_resolves_to_exe() {
        let dir = tempfile::tempdir().expect("temp dir");
        let exe = dir.path().join("pwsh.exe");
        std::fs::write(&exe, b"").expect("fake shell");
        let selected = dir.path().join("pwsh");
        assert_eq!(
            resolve_effective_shell(Some(&selected.display().to_string())),
            exe.display().to_string()
        );
    }

    #[tokio::test]
    async fn terminal_shell_setting_persists_and_updates_live_runtime() {
        let _serial = TERMINAL_SETTINGS_SERIAL.lock().await;
        let _restore = RestoreCommandColor::capture();
        let db = fresh_in_memory_db().await;
        let config = TerminalShellRuntimeConfig::new();

        let saved = set_system_terminal_settings_core(
            &db.conn,
            &config,
            &EventEmitter::Noop,
            SystemTerminalSettings {
                default_shell: Some("  pwsh.exe  ".to_string()),
                colorize_command_output: false,
            },
        )
        .await
        .expect("save terminal setting");

        assert_eq!(saved.default_shell.as_deref(), Some("pwsh.exe"));
        assert_eq!(config.snapshot().await.as_deref(), Some("pwsh.exe"));

        let restarted_config = TerminalShellRuntimeConfig::new();
        apply_persisted_terminal_settings(&db.conn, &restarted_config).await;
        assert_eq!(
            restarted_config.snapshot().await.as_deref(),
            Some("pwsh.exe")
        );
    }

    #[tokio::test]
    async fn unconfigured_title_model_prefills_the_free_groq_setup_without_running_it() {
        let db = fresh_in_memory_db().await;

        let defaults = load_system_title_model_settings(&db.conn)
            .await
            .expect("load title model defaults");
        assert!(defaults.enabled);
        assert_eq!(defaults.base_url, DEFAULT_TITLE_MODEL_BASE_URL);
        assert_eq!(defaults.model, DEFAULT_TITLE_MODEL_NAME);
        assert!(!defaults.api_key_configured);
        assert_eq!(
            defaults.request_params,
            vec![TitleModelRequestParam {
                key: "reasoning_effort".to_string(),
                value: DEFAULT_TITLE_MODEL_REASONING_EFFORT.to_string(),
            }]
        );
        assert!(
            load_title_model_runtime_settings(&db.conn)
                .await
                .expect("load absent title model runtime")
                .is_none(),
            "the suggested configuration must stay inactive until the user saves a key"
        );

        let saved = set_system_title_model_settings_core(
            &db.conn,
            SystemTitleModelSettingsUpdate {
                enabled: defaults.enabled,
                base_url: defaults.base_url,
                model: defaults.model,
                api_key: Some("user-groq-key".to_string()),
                clear_api_key: false,
                request_params: defaults.request_params,
            },
        )
        .await
        .expect("save default title model with only a key added");
        assert!(saved.api_key_configured);

        let runtime = load_title_model_runtime_settings(&db.conn)
            .await
            .expect("load saved title model runtime")
            .expect("saved default is enabled");
        assert_eq!(runtime.base_url, DEFAULT_TITLE_MODEL_BASE_URL);
        assert_eq!(runtime.model, DEFAULT_TITLE_MODEL_NAME);
        assert_eq!(runtime.api_key.as_deref(), Some("user-groq-key"));
        assert_eq!(
            runtime.request_params.get("reasoning_effort"),
            Some(&serde_json::json!(DEFAULT_TITLE_MODEL_REASONING_EFFORT))
        );
    }

    #[tokio::test]
    async fn title_model_view_hides_and_blank_updates_preserve_the_api_key() {
        let db = fresh_in_memory_db().await;
        let saved = set_system_title_model_settings_core(
            &db.conn,
            SystemTitleModelSettingsUpdate {
                enabled: true,
                base_url: " https://api.groq.com/openai/v1/ ".to_string(),
                model: " qwen/qwen3.6-27b ".to_string(),
                api_key: Some(" secret-key ".to_string()),
                clear_api_key: false,
                request_params: vec![TitleModelRequestParam {
                    key: "enable_thinking".to_string(),
                    value: "false".to_string(),
                }],
            },
        )
        .await
        .expect("save title model");
        assert_eq!(saved.base_url, "https://api.groq.com/openai/v1");
        assert!(saved.api_key_configured);

        let updated = set_system_title_model_settings_core(
            &db.conn,
            SystemTitleModelSettingsUpdate {
                enabled: true,
                base_url: saved.base_url.clone(),
                model: "new-model".to_string(),
                api_key: None,
                clear_api_key: false,
                request_params: saved.request_params.clone(),
            },
        )
        .await
        .expect("update without replacing key");
        assert!(updated.api_key_configured);

        let runtime = load_title_model_runtime_settings(&db.conn)
            .await
            .expect("load runtime")
            .expect("enabled runtime");
        assert_eq!(runtime.api_key.as_deref(), Some("secret-key"));
        assert_eq!(runtime.model, "new-model");
        assert_eq!(
            runtime.request_params.get("enable_thinking"),
            Some(&serde_json::Value::Bool(false))
        );

        let raw = serde_json::to_string(&updated).expect("serialize public view");
        assert!(!raw.contains("secret-key"));
        assert!(!raw.contains("api_key\""));
    }

    #[tokio::test]
    async fn title_model_key_can_be_cleared_explicitly() {
        let db = fresh_in_memory_db().await;
        set_system_title_model_settings_core(
            &db.conn,
            SystemTitleModelSettingsUpdate {
                enabled: true,
                base_url: "http://localhost:11434/v1".to_string(),
                model: "qwen3.5:2b".to_string(),
                api_key: Some("old-key".to_string()),
                clear_api_key: false,
                request_params: Vec::new(),
            },
        )
        .await
        .expect("seed key");

        let cleared = set_system_title_model_settings_core(
            &db.conn,
            SystemTitleModelSettingsUpdate {
                enabled: true,
                base_url: "http://localhost:11434/v1".to_string(),
                model: "qwen3.5:2b".to_string(),
                api_key: None,
                clear_api_key: true,
                request_params: Vec::new(),
            },
        )
        .await
        .expect("clear key");
        assert!(!cleared.api_key_configured);
        assert!(load_title_model_runtime_settings(&db.conn)
            .await
            .expect("load runtime")
            .expect("enabled runtime")
            .api_key
            .is_none());
    }

    #[test]
    fn title_model_url_rejects_non_http_and_embedded_credentials() {
        for url in ["file:///tmp/model", "https://user:pass@example.com/v1"] {
            assert!(normalize_title_model_base_url(url).is_err(), "{url}");
        }
        assert_eq!(
            normalize_title_model_base_url("http://localhost:11434/v1/").expect("local Ollama URL"),
            "http://localhost:11434/v1"
        );
    }

    #[test]
    fn title_model_request_params_parse_json_and_protect_core_fields() {
        let params = normalize_title_model_request_params(vec![
            TitleModelRequestParam {
                key: " enable_thinking ".to_string(),
                value: "false".to_string(),
            },
            TitleModelRequestParam {
                key: "reasoning_effort".to_string(),
                value: "none".to_string(),
            },
            TitleModelRequestParam {
                key: "thinking".to_string(),
                value: r#"{"type":"disabled"}"#.to_string(),
            },
            TitleModelRequestParam::default(),
        ])
        .expect("valid request parameters");
        let parsed = parse_title_model_request_params(&params);

        assert_eq!(
            parsed.get("enable_thinking"),
            Some(&serde_json::json!(false))
        );
        assert_eq!(
            parsed.get("reasoning_effort"),
            Some(&serde_json::json!("none"))
        );
        assert_eq!(
            parsed.get("thinking"),
            Some(&serde_json::json!({ "type": "disabled" }))
        );
        assert_eq!(params.len(), 3, "blank rows are ignored");

        for key in ["model", "messages", "stream"] {
            assert!(
                normalize_title_model_request_params(vec![TitleModelRequestParam {
                    key: key.to_string(),
                    value: "false".to_string(),
                }])
                .is_err()
            );
        }
        assert!(normalize_title_model_request_params(vec![
            TitleModelRequestParam {
                key: "reasoning_effort".to_string(),
                value: "none".to_string(),
            },
            TitleModelRequestParam {
                key: "reasoning_effort".to_string(),
                value: "low".to_string(),
            },
        ])
        .is_err());
    }

    #[tokio::test]
    async fn title_model_test_uses_the_shared_saved_key_without_saving_the_draft() {
        let db = fresh_in_memory_db().await;
        set_system_title_model_settings_core(
            &db.conn,
            SystemTitleModelSettingsUpdate {
                enabled: true,
                base_url: "https://saved.example/v1".to_string(),
                model: "saved-model".to_string(),
                api_key: Some("shared-secret".to_string()),
                clear_api_key: false,
                request_params: Vec::new(),
            },
        )
        .await
        .expect("seed shared title settings");
        let (base_url, request_rx) = one_shot_title_server().await;

        let result = test_system_title_model_settings_core(
            &db.conn,
            SystemTitleModelSettingsUpdate {
                enabled: false,
                base_url,
                model: "draft-model".to_string(),
                api_key: None,
                clear_api_key: false,
                request_params: vec![
                    TitleModelRequestParam {
                        key: "enable_thinking".to_string(),
                        value: "false".to_string(),
                    },
                    TitleModelRequestParam {
                        key: "reasoning_effort".to_string(),
                        value: "none".to_string(),
                    },
                ],
            },
        )
        .await
        .expect("test title model");

        assert!(result.title.ends_with("｜探索｜Test title model"));
        let request = request_rx.await.expect("captured title request");
        assert!(request.contains("POST /v1/chat/completions HTTP/1.1"));
        assert!(request
            .to_ascii_lowercase()
            .contains("authorization: bearer shared-secret"));
        assert!(request.contains(r#""model":"draft-model""#));
        assert!(request.contains(r#""temperature":0"#));
        assert!(request.contains(r#""enable_thinking":false"#));
        assert!(request.contains(r#""reasoning_effort":"none""#));

        let persisted = load_system_title_model_settings(&db.conn)
            .await
            .expect("reload saved title settings");
        assert_eq!(persisted.base_url, "https://saved.example/v1");
        assert_eq!(persisted.model, "saved-model");
    }

    /// The command-color opt-in survives a save AND a restart, and reaches the
    /// launch env both times — a value that only persisted would leave every
    /// connection made before the next restart on the wrong setting.
    #[tokio::test]
    async fn colorize_command_output_persists_and_reaches_the_launch_env() {
        let _serial = TERMINAL_SETTINGS_SERIAL.lock().await;
        let _restore = RestoreCommandColor::capture();
        let db = fresh_in_memory_db().await;
        let config = TerminalShellRuntimeConfig::new();

        // Off is the default, and the whole point of the change — assert it
        // before anything writes, so a regression to "forced on" fails here.
        assert!(!crate::acp::connection::force_command_color_enabled());
        assert!(
            launch_env_color_vars().is_empty(),
            "a default launch must not force color"
        );

        let saved = set_system_terminal_settings_core(
            &db.conn,
            &config,
            &EventEmitter::Noop,
            SystemTerminalSettings {
                default_shell: None,
                colorize_command_output: true,
            },
        )
        .await
        .expect("save terminal setting");

        assert!(saved.colorize_command_output);
        assert!(crate::acp::connection::force_command_color_enabled());
        assert_eq!(
            launch_env_color_vars(),
            expected_color_vars(),
            "the save must reach a launch"
        );

        // A fresh process would start with the global at its `false` default;
        // the startup load is what has to put it back.
        crate::acp::connection::set_force_command_color(false);
        apply_persisted_terminal_settings(&db.conn, &config).await;
        assert!(crate::acp::connection::force_command_color_enabled());
        assert_eq!(
            launch_env_color_vars(),
            expected_color_vars(),
            "the restart must reach a launch"
        );

        let reloaded = load_system_terminal_settings(&db.conn)
            .await
            .expect("load terminal settings");
        assert!(reloaded.colorize_command_output);

        // `_restore` puts the process global back on the way out — it is
        // shared by every test in this binary, and a bare store at the end
        // would be skipped by any assertion above it that fails.
    }

    /// A row stored before the field existed must load as "off" rather than
    /// failing to parse (which would strand the user's shell choice too).
    #[tokio::test]
    async fn terminal_settings_row_without_the_color_field_loads_as_off() {
        let db = fresh_in_memory_db().await;
        app_metadata_service::upsert_value(
            &db.conn,
            SYSTEM_TERMINAL_SETTINGS_KEY,
            r#"{"default_shell":"pwsh.exe"}"#,
        )
        .await
        .expect("seed legacy terminal row");

        let loaded = load_system_terminal_settings(&db.conn)
            .await
            .expect("load terminal settings");

        assert_eq!(loaded.default_shell.as_deref(), Some("pwsh.exe"));
        assert!(!loaded.colorize_command_output);
    }
}
