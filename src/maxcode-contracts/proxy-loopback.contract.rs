use super::*;

#[test]
fn electron_and_server_agent_launches_keep_local_services_direct() {
    let inherited = vec![("no_proxy".to_string(), "git.internal".to_string())];
    let mut launch = BTreeMap::from([
        (
            "HTTPS_PROXY".to_string(),
            "http://10.0.0.2:8080".to_string(),
        ),
        (
            "NO_PROXY".to_string(),
            "models.internal；.corp.example".to_string(),
        ),
    ]);
    add_no_proxy_to_launch_env(&mut launch, &inherited);
    let expected = "localhost,127.0.0.1,::1,[::1],git.internal,models.internal,.corp.example";
    assert_eq!(launch["NO_PROXY"], expected);
    assert_eq!(launch["no_proxy"], expected);
    assert_eq!(launch["HTTPS_PROXY"], "http://10.0.0.2:8080");
}

#[test]
fn old_saved_settings_gain_loopback_exceptions_without_a_migration() {
    let old: SystemProxySettings = serde_json::from_value(serde_json::json!({
        "enabled": true,
        "proxy_url": "10.0.0.2:8080"
    }))
    .unwrap();
    let writes = proxy_env_writes(&old).unwrap();
    for key in ["NO_PROXY", "no_proxy"] {
        assert_eq!(
            writes
                .iter()
                .find(|(name, _)| *name == key)
                .unwrap()
                .1
                .as_deref(),
            Some("localhost,127.0.0.1,::1,[::1]")
        );
    }
    let disabled = SystemProxySettings {
        enabled: false,
        ..old
    };
    assert!(proxy_env_writes(&disabled)
        .unwrap()
        .iter()
        .all(|(_, value)| value.is_none()));
}
