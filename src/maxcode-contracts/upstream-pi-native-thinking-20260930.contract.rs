//! Native pi-acp selectors stay authoritative while older adapters retain MaxCode's custom map projection.
use super::*;

#[tokio::test]
async fn native_pi_selector_is_not_rewritten_from_a_local_models_file() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("models.json"),
        r#"{"providers":{"proxy":{"models":[{"id":"model","reasoning":false}]}}}"#,
    )
    .unwrap();
    let mut session = SessionState::new(
        "pi-contract".into(),
        AgentType::Pi,
        None,
        "test".into(),
        None,
    );
    session.pi_agent_dir = Some(dir.path().to_path_buf());
    session.pi_native_thinking_levels = true;
    let state = Arc::new(RwLock::new(session));
    let options: Vec<SessionConfigOption> = serde_json::from_value(serde_json::json!([
        {"id":"model","name":"Model","category":"model","type":"select",
         "currentValue":"proxy/model","options":[{"value":"proxy/model","name":"Model"}]},
        {"id":"thought_level","name":"Thinking","category":"thought_level","type":"select",
         "currentValue":"max","options":[{"value":"off","name":"Off"},{"value":"max","name":"Maximum"}]}
    ]))
    .unwrap();
    for (native, expected) in [(true, "max"), (false, "off")] {
        state.write().await.pi_native_thinking_levels = native;
        emit_session_config_options_values(
            &state,
            &EventEmitter::Noop,
            AgentType::Pi,
            options.clone(),
        )
        .await;
        let snapshot = state.read().await;
        let thinking = snapshot
            .config_options
            .as_ref()
            .unwrap()
            .iter()
            .find(|option| option.id == "thought_level")
            .unwrap();
        let SessionConfigKindInfo::Select(select) = &thinking.kind else {
            panic!("expected selector")
        };
        assert_eq!(select.current_value, expected);
        assert_eq!(
            select.options.iter().any(|option| option.value == "max"),
            native
        );
    }
}

#[test]
fn newer_pi_adapter_is_never_modified_by_the_legacy_max_patch() {
    let dir = tempfile::tempdir().unwrap();
    let package = dir.path().join("pi-acp");
    let dist = package.join("dist");
    std::fs::create_dir_all(&dist).unwrap();
    std::fs::write(package.join("package.json"), r#"{"version":"0.0.34"}"#).unwrap();
    let entry = dist.join("index.js");
    let original = "export const levels = 'native model capabilities';\n";
    std::fs::write(&entry, original).unwrap();
    ensure_pi_acp_max_support(&entry).unwrap();
    assert_eq!(std::fs::read_to_string(entry).unwrap(), original);
}
