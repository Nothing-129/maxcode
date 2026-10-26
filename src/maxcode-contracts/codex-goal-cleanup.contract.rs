#[tokio::test]
async fn codex_goal_end_reclaims_asks_once_without_touching_other_turns() {
    for reason in ["cancelled", "end_turn"] {
        let asks = Arc::new(RecordingAsks::default());
        let injection = DelegationInjection {
            questions: asks.clone(),
            plan_approvals: asks.clone(),
            ..test_delegation_injection(Arc::new(TestAllAgentsAvailable))
        };
        let mut initial = SessionState::new(
            "codex-goal-parent".into(),
            AgentType::Codex,
            None,
            "win".into(),
            None,
        );
        initial.status = ConnectionStatus::Connected;
        let state = Arc::new(RwLock::new(initial));
        let mut cb = CodeBuddyLiveState {
            codex_open_goal: Some("goal".into()),
            ..Default::default()
        };
        let active = serde_json::from_value(serde_json::json!({
            "sessionUpdate": "session_info_update",
            "_meta": { "codex": { "threadStatus": { "type": "active" } } }
        }))
        .unwrap();
        sync_codex_goal_turn(
            &state,
            &EventEmitter::Noop,
            AgentType::Codex,
            &active,
            &mut cb,
            Some(&injection),
        )
        .await;
        assert!(cb.codex_goal_turn);
        if reason == "end_turn" {
            let idle = serde_json::from_value(serde_json::json!({
                "sessionUpdate": "session_info_update",
                "_meta": { "codex": { "threadStatus": { "type": "idle" } } }
            }))
            .unwrap();
            sync_codex_goal_turn(
                &state,
                &EventEmitter::Noop,
                AgentType::Codex,
                &idle,
                &mut cb,
                Some(&injection),
            )
            .await;
        } else {
            close_codex_goal_turn(
                &state,
                &EventEmitter::Noop,
                AgentType::Codex,
                "thread",
                reason,
                &mut cb,
                Some(&injection),
            )
            .await;
        }
        assert_eq!(state.read().await.status, ConnectionStatus::Connected);
        assert!(!cb.codex_goal_turn);
        assert_eq!(*asks.questions.lock().unwrap(), vec!["codex-goal-parent"]);
        assert_eq!(
            *asks.plan_approvals.lock().unwrap(),
            vec!["codex-goal-parent"]
        );
        // A repeated idle/close cannot cancel questions belonging to the next turn.
        close_codex_goal_turn(
            &state,
            &EventEmitter::Noop,
            AgentType::Codex,
            "thread",
            reason,
            &mut cb,
            Some(&injection),
        )
        .await;
        assert_eq!(asks.questions.lock().unwrap().len(), 1);
        assert_eq!(asks.plan_approvals.lock().unwrap().len(), 1);
    }
}
