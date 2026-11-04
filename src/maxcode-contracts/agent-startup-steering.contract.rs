use super::*;
use serde_json::json;

#[test]
fn startup_refusals_preserve_sessions_and_authentication() {
    for (reason, code, classified, refuses) in [
        (
            "session_held_by_background",
            -32603,
            Some("session_busy"),
            false,
        ),
        (
            "worktree_resume_refused",
            -32603,
            Some("session_unavailable"),
            false,
        ),
        (
            "worktree_unverified",
            -32603,
            Some("session_unavailable"),
            false,
        ),
        ("proxy_invalid", -32603, None, true),
        ("cli_version_too_old", -32603, None, true),
        ("cwd_unavailable", -32602, None, true),
        ("gateway_signin_required", -32000, None, false),
    ] {
        let error = serde_json::from_value(json!({
            "code": code, "message": "Fix the runtime and reopen this session.",
            "data": {"startupFailureReason": reason}
        }))
        .unwrap();
        assert_eq!(classify_session_load_error(&error), classified, "{reason}");
        assert_eq!(claude_refused_to_start(&error), refuses, "{reason}");
        assert_eq!(
            agent_error_text(&error),
            "Fix the runtime and reopen this session."
        );
    }
}

#[test]
fn native_codex_steering_requires_reviewed_runtime_and_keeps_legacy_copy() {
    let plain = json!({"steering":{"supported":true}});
    for (version, expected) in [
        ("2.2.2", false),
        ("2.3.0", false),
        ("2.4.0-preview.1", false),
        ("2.4.0", true),
        ("2.5.0", true),
    ] {
        let info = agent_client_protocol::schema::v1::Implementation::new("codex-acp", version);
        assert_eq!(
            synthesize_native_steering(AgentType::Codex, plain.as_object(), Some(&info)),
            expected,
            "{version}"
        );
    }
    let patched = json!({"steering":{"supported":true,"maxcodePromptRequired":1}});
    let legacy = agent_client_protocol::schema::v1::Implementation::new("codex-acp", "2.2.2");
    assert!(synthesize_native_steering(
        AgentType::Codex,
        patched.as_object(),
        Some(&legacy)
    ));
    assert!(registry::steering_waits_out_open_permission(
        AgentType::Codex
    ));
    assert!(!registry::steering_waits_out_open_permission(
        AgentType::ClaudeCode
    ));
    assert_eq!(
        registry::steering_prompt_required_min_version(AgentType::Zcode),
        None
    );
}

#[test]
fn codex_predictions_use_shared_events_and_disable_unattended_calls() {
    let meta = json!({"promptSuggestions":{"suggestions":[{"text":"Run checks"}]}});
    assert_eq!(
        prompt_suggestion_update(AgentType::Codex, meta.as_object()),
        Some(Some("Run checks".into()))
    );
    let clear = json!({"promptSuggestions":{"suggestions":[]}});
    assert_eq!(
        prompt_suggestion_update(AgentType::Codex, clear.as_object()),
        Some(None)
    );
    let mut env = vec![("CODEX_ACP_PROMPT_SUGGESTIONS".into(), "true".into())];
    apply_codex_prompt_suggestion_policy(AgentType::Codex, &mut env, false);
    assert_eq!(
        env,
        vec![("CODEX_ACP_PROMPT_SUGGESTIONS".into(), "false".into())]
    );
    apply_codex_prompt_suggestion_policy(AgentType::Codex, &mut env, true);
    assert_eq!(
        env[0].1, "false",
        "interactive launches preserve user opt-out"
    );
}
