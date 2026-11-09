#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn missing_provider_keeps_original_session_without_starting_a_new_one() {
    let error = serde_json::json!({
        "code": -32603,
        "message": "Internal error",
        "data": {"details": "This chat uses model provider “custom”, which is no longer configured. Restore this provider’s configuration to continue."}
    });
    for resume in [false, true] {
        let (ended, emitted, requests) = if resume {
            reopen_resume_and_load_failing_with(error.clone()).await
        } else {
            reopen_failing_with(error.clone()).await
        };
        let expected = if resume {
            vec!["initialize", "session/resume", "session/load"]
        } else {
            vec!["initialize", "session/load"]
        };
        assert_eq!(requests, expected);
        assert!(ended.is_ok(), "{ended:?}");
        assert!(
            emitted.iter().any(|event| matches!(event,
                AcpEvent::SessionLoadFailed { session_id, code, message }
                    if session_id == "s-old" && code == "session_provider_missing"
                        && message.contains("custom")
            )),
            "{emitted:#?}"
        );
        assert!(
            !emitted.iter().any(|event| matches!(
                event,
                AcpEvent::SessionStarted { .. } | AcpEvent::Error { .. }
            )),
            "{emitted:#?}"
        );
    }
    for agent in [AgentType::Codex, AgentType::custom("example-acp").unwrap()] {
        assert!(!recovers_load_failure_locally(
            agent,
            Some("session_provider_missing")
        ));
    }
}
