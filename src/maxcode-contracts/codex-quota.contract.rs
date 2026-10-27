use super::*;

#[test]
fn rejects_third_party_provider_even_with_retained_official_credentials() {
    assert!(official_config(""));
    assert!(official_config("model_provider = 'openai'"));
    assert!(!official_config("model_provider = 'cpa'"));
    assert!(!official_config("forced_login_method = 'api'"));
    assert!(!official_config(
        "[model_providers.openai]\nbase_url = 'https://proxy.invalid'"
    ));
    assert!(!official_config("not valid toml"));
    assert!(!official_config(
        "profile = 'proxy'\n[profiles.proxy]\nmodel_provider = 'cpa'"
    ));
    assert!(!official_config(
        "[env]\nOPENAI_BASE_URL = 'https://proxy.invalid'"
    ));
}

#[test]
fn windows_follow_duration_and_use_account_pool_only() {
    let value = json!({"rateLimitsByLimitId": {
        "codex": {"primary":{"usedPercent":60,"windowDurationMins":10080,"resetsAt":123},
                  "secondary":{"usedPercent":10,"windowDurationMins":300,"resetsAt":456}},
        "spark": {"primary":{"usedPercent":99,"windowDurationMins":300}}
    }});
    let windows = parse_windows(&value);
    assert_eq!(windows.len(), 2);
    assert_eq!(windows[0].window_minutes, 300);
    assert_eq!(windows[0].used_percent, 10.0);
    assert_eq!(windows[1].window_minutes, 10080);
    assert!(parse_windows(&json!({"rateLimitsByLimitId":{"spark":value}})).is_empty());
}

#[test]
fn missing_or_invalid_windows_never_become_full_allowances() {
    assert!(parse_windows(&json!({"rateLimits":{"primary":null,"secondary":null}})).is_empty());
    assert!(parse_windows(
        &json!({"rateLimits":{"primary":{"usedPercent":-1,"windowDurationMins":300}}})
    )
    .is_empty());
    assert!(parse_windows(&json!({"rateLimits":{"primary":{"usedPercent":10}}})).is_empty());
    let weekly_only = parse_windows(
        &json!({"rateLimits":{"secondary":{"usedPercent":100,"windowDurationMins":10080}}}),
    );
    assert_eq!(weekly_only.len(), 1);
    assert_eq!(weekly_only[0].used_percent, 100.0);
    assert_eq!(weekly_only[0].resets_at, None);
}

#[test]
fn transport_does_not_serialize_credentials() {
    let serialized = serde_json::to_value(CodexQuota {
        official: true,
        ..Default::default()
    })
    .unwrap();
    assert_eq!(serialized.as_object().unwrap().len(), 5);
    assert!(serialized.get("tokens").is_none());
}

// Exercise the actual stdio handshake rather than only mirroring the parser.
#[cfg(unix)]
#[tokio::test]
async fn account_protocol_reads_limits_without_starting_a_thread_or_prompt() {
    let mut command = crate::process::tokio_command("/bin/sh");
    command.args(["-c", r#"
        read -r line
        case "$line" in *'"method":"initialize"'*) ;; *) exit 1;; esac
        echo '{"id":1,"result":{}}'
        read -r line
        case "$line" in *'"method":"initialized"'*) ;; *) exit 1;; esac
        read -r line
        case "$line" in *'"method":"account/read"'*) ;; *) exit 1;; esac
        echo '{"id":2,"result":{"account":{"type":"chatgpt","planType":"plus"},"requiresOpenaiAuth":true}}'
        read -r line
        case "$line" in *'"method":"account/rateLimits/read"'*) ;; *) exit 1;; esac
        echo '{"method":"account/updated","params":{}}'
        echo '{"id":3,"result":{"rateLimits":{"primary":{"usedPercent":25,"windowDurationMins":300,"resetsAt":1800000000}}}}'
    "#]);
    let quota = tokio::time::timeout(
        Duration::from_secs(3),
        query_command(command, &Default::default()),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(quota.official);
    assert_eq!(quota.plan_type.as_deref(), Some("plus"));
    assert_eq!(quota.windows.len(), 1);
    assert_eq!(quota.windows[0].used_percent, 25.0);
    assert!(quota.updated_at.is_some());
    assert!(quota.error.is_none());
}

#[cfg(unix)]
#[tokio::test]
async fn account_protocol_hides_api_key_logins_without_reading_limits() {
    let mut command = crate::process::tokio_command("/bin/sh");
    command.args([
        "-c",
        r#"
        read -r line
        echo '{"id":1,"result":{}}'
        read -r line
        read -r line
        echo '{"id":2,"result":{"account":{"type":"apiKey"},"requiresOpenaiAuth":true}}'
    "#,
    ]);
    let quota = tokio::time::timeout(
        Duration::from_secs(3),
        query_command(command, &Default::default()),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(!quota.official);
    assert!(quota.windows.is_empty());
}

#[test]
fn manual_refresh_bypasses_ttl_but_coalesces_requests_already_waiting() {
    let now = Instant::now();
    let cache = Cache {
        key: 1,
        checked: now - Duration::from_secs(1),
        quota: CodexQuota::default(),
    };
    assert!(can_reuse_cache(&cache, false, now));
    assert!(!can_reuse_cache(&cache, true, now));
    assert!(can_reuse_cache(&cache, true, now - Duration::from_secs(2)));
    let expired = Cache {
        checked: now - REFRESH_INTERVAL - Duration::from_secs(1),
        ..cache
    };
    assert!(!can_reuse_cache(&expired, false, now));
}
