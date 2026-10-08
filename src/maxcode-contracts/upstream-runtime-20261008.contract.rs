//! Independent contracts for the eight selected upstream repairs.
use super::*;
use serde_json::json;

#[test]
fn codex_upgrade_keeps_native_steering_gated() {
    let meta = json!({"steering":{"supported":true}});
    let peer = agent_client_protocol::schema::v1::Implementation::new("codex-acp", "2.1.1");
    assert!(!synthesize_native_steering(
        AgentType::Codex,
        meta.as_object(),
        Some(&peer)
    ));
    let claude =
        agent_client_protocol::schema::v1::Implementation::new("claude-agent-acp", "0.86.0");
    assert!(synthesize_native_steering(
        AgentType::ClaudeCode,
        meta.as_object(),
        Some(&claude)
    ));
    assert!(!synthesize_native_steering(
        AgentType::ClaudeCode,
        None,
        Some(&claude)
    ));
}

#[test]
fn writer_lock_uses_typed_reason_and_other_failures_keep_their_classification() {
    let error = |reason| {
        serde_json::from_value::<agent_client_protocol::Error>(json!({
            "code":-32600,"message":"renamed provider message","data":{"reason":reason}
        }))
        .unwrap()
    };
    assert_eq!(
        classify_session_load_error(&error("thread_active_writer")),
        Some("session_busy")
    );
    assert_eq!(classify_session_load_error(&error("something_else")), None);
}

#[test]
fn saved_claude_alias_never_moves_to_a_different_or_ambiguous_model() {
    let option = |rows| {
        serde_json::from_value::<SessionConfigOption>(json!({
            "id":"model","name":"Model","category":"model","type":"select",
            "currentValue":"opus","options":rows
        }))
        .unwrap()
    };
    let rows = json!([{"value":"fable","name":"Fable 5.1"},{"value":"opus","name":"Opus"}]);
    assert_eq!(
        heal_retired_model_pick(&option(rows), "claude-fable-5-1").as_deref(),
        Some("fable")
    );
    assert!(heal_retired_model_pick(
        &option(json!([{"value":"fable","name":"Fable 5.2"}])),
        "claude-fable-5-1"
    )
    .is_none());
    assert!(heal_retired_model_pick(
        &option(json!([{"value":"a","name":"Fable 5.1"},{"value":"b","name":"Fable 5.1"}])),
        "claude-fable-5-1"
    )
    .is_none());
}

#[tokio::test]
async fn grok_refresh_keeps_selection_effort_and_ignores_empty_catalogs() {
    let mut session = SessionState::new(
        "contract".into(),
        AgentType::Grok,
        None,
        "window".into(),
        None,
    );
    session.config_options = Some(vec![
        SessionConfigOptionInfo {
            id: GROK_MODEL_OPTION_ID.into(),
            name: "Model".into(),
            description: None,
            category: Some("model".into()),
            recommended_value: None,
            kind: SessionConfigKindInfo::Select(SessionConfigSelectInfo {
                current_value: "grok-old".into(),
                options: vec![SessionConfigSelectOptionInfo {
                    value: "grok-old".into(),
                    name: "Old model".into(),
                    description: None,
                }],
                groups: Vec::new(),
            }),
        },
        SessionConfigOptionInfo {
            id: GROK_EFFORT_OPTION_ID.into(),
            name: "Effort".into(),
            description: None,
            category: None,
            recommended_value: None,
            kind: SessionConfigKindInfo::Select(SessionConfigSelectInfo {
                current_value: "medium".into(),
                options: vec![SessionConfigSelectOptionInfo {
                    value: "medium".into(),
                    name: "Medium".into(),
                    description: None,
                }],
                groups: Vec::new(),
            }),
        },
    ]);
    let state = Arc::new(RwLock::new(session));
    let payload = json!({"currentModelId":"grok-new","availableModels":[{"modelId":"grok-new","name":"New model"}]});
    apply_grok_model_catalog(&state, &EventEmitter::Noop, &payload).await;
    let (seq, options) = {
        let s = state.read().await;
        (s.event_seq, s.config_options.clone().unwrap())
    };
    let SessionConfigKindInfo::Select(model) = &options[0].kind else {
        panic!("model selector")
    };
    assert_eq!(model.current_value, "grok-old");
    assert_eq!(
        model
            .options
            .iter()
            .map(|r| r.value.as_str())
            .collect::<Vec<_>>(),
        vec!["grok-old", "grok-new"]
    );
    let SessionConfigKindInfo::Select(effort) = &options[1].kind else {
        panic!("effort selector")
    };
    assert_eq!(effort.current_value, "medium");
    apply_grok_model_catalog(&state, &EventEmitter::Noop, &payload).await;
    apply_grok_model_catalog(&state, &EventEmitter::Noop, &json!({"availableModels":[]})).await;
    let s = state.read().await;
    assert_eq!(s.event_seq, seq);
    assert_eq!(s.config_options.as_ref().unwrap(), &options);
}

#[test]
fn service_error_cards_keep_readable_provider_messages() {
    assert_eq!(crate::acp::service_error::readable_service_error_message(r#"{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"Choose a supported model"}}"#).as_deref(),Some("Choose a supported model"));
}
