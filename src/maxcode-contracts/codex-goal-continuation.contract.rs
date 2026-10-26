use super::*;
use serde_json::json;

fn status(kind: &str) -> SessionUpdate {
    serde_json::from_value(json!({
        "sessionUpdate": "session_info_update",
        "_meta": {"codex": {"threadStatus": {"type": kind}}}
    }))
    .unwrap()
}

fn state() -> Arc<RwLock<SessionState>> {
    let mut s = SessionState::new(
        "goal-test".into(),
        AgentType::Codex,
        None,
        "win".into(),
        None,
    );
    s.status = ConnectionStatus::Connected;
    s.external_id = Some("thread-goal".into());
    Arc::new(RwLock::new(s))
}

#[tokio::test]
async fn goal_continuation_announces_streaming_before_content_and_settles_on_native_idle() {
    let state = state();
    let mut cb = CodeBuddyLiveState::default();
    cb.codex_open_goal = Some("Analyze calls".into());
    let mut events = state.read().await.event_stream().subscribe();
    sync_codex_goal_turn(
        &state,
        &EventEmitter::Noop,
        AgentType::Codex,
        &status("active"),
        &mut cb,
        None,
    )
    .await;
    assert!(cb.codex_goal_turn);
    assert_eq!(state.read().await.status, ConnectionStatus::Prompting);
    assert!(matches!(
        events.recv().await.unwrap().payload,
        AcpEvent::StatusChanged {
            status: ConnectionStatus::Prompting
        }
    ));
    let chunk = SessionUpdate::AgentMessageChunk(ContentChunk::new("Still analyzing".into()));
    sync_codex_goal_turn(
        &state,
        &EventEmitter::Noop,
        AgentType::Codex,
        &chunk,
        &mut cb,
        None,
    )
    .await;
    emit_conversation_update(
        &state,
        &EventEmitter::Noop,
        AgentType::Codex,
        chunk,
        None,
        &mut ToolCallOutputCache::default(),
        &mut cb,
    )
    .await;
    assert!(matches!(
        events.recv().await.unwrap().payload,
        AcpEvent::ContentDelta { .. }
    ));
    sync_codex_goal_turn(
        &state,
        &EventEmitter::Noop,
        AgentType::Codex,
        &status("idle"),
        &mut cb,
        None,
    )
    .await;
    assert!(!cb.codex_goal_turn);
    assert!(matches!(
        events.recv().await.unwrap().payload,
        AcpEvent::TurnComplete { .. }
    ));
    assert_eq!(state.read().await.status, ConnectionStatus::Connected);
    assert!(
        cb.codex_open_goal.is_some(),
        "idle ends a turn, not the goal"
    );
    sync_codex_goal_turn(
        &state,
        &EventEmitter::Noop,
        AgentType::Codex,
        &status("active"),
        &mut cb,
        None,
    )
    .await;
    assert!(cb.codex_goal_turn, "the next automatic turn is live again");
}

#[tokio::test]
async fn history_non_goal_other_agents_and_admitted_prompts_do_not_open_goal_turns() {
    let state = state();
    let mut cb = CodeBuddyLiveState::default();
    sync_codex_goal_turn(
        &state,
        &EventEmitter::Noop,
        AgentType::Codex,
        &status("active"),
        &mut cb,
        None,
    )
    .await;
    assert!(!cb.codex_goal_turn, "a non-goal thread is unchanged");
    cb.codex_open_goal = Some("Analyze calls".into());
    cb.codex_thread_active = false;
    let chunk = SessionUpdate::AgentThoughtChunk(ContentChunk::new("late tail".into()));
    sync_codex_goal_turn(
        &state,
        &EventEmitter::Noop,
        AgentType::Codex,
        &chunk,
        &mut cb,
        None,
    )
    .await;
    assert!(
        !cb.codex_goal_turn,
        "an active history goal is not proof of execution"
    );
    sync_codex_goal_turn(
        &state,
        &EventEmitter::Noop,
        AgentType::ClaudeCode,
        &status("active"),
        &mut cb,
        None,
    )
    .await;
    assert!(!cb.codex_goal_turn);
    state.write().await.turn_in_flight = true;
    sync_codex_goal_turn(
        &state,
        &EventEmitter::Noop,
        AgentType::Codex,
        &status("active"),
        &mut cb,
        None,
    )
    .await;
    assert!(!cb.codex_goal_turn, "the admitted prompt owns the turn");
}

#[tokio::test]
async fn cancellation_closes_once_and_late_chunks_do_not_reopen() {
    let state = state();
    let mut cb = CodeBuddyLiveState::default();
    cb.codex_open_goal = Some("Analyze calls".into());
    sync_codex_goal_turn(
        &state,
        &EventEmitter::Noop,
        AgentType::Codex,
        &status("active"),
        &mut cb,
        None,
    )
    .await;
    cb.codex_thread_active = false;
    close_codex_goal_turn(
        &state,
        &EventEmitter::Noop,
        AgentType::Codex,
        "thread-goal",
        "cancelled",
        &mut cb,
        None,
    )
    .await;
    let completed = state.read().await.turns_completed;
    close_codex_goal_turn(
        &state,
        &EventEmitter::Noop,
        AgentType::Codex,
        "thread-goal",
        "end_turn",
        &mut cb,
        None,
    )
    .await;
    assert_eq!(state.read().await.turns_completed, completed);
    let chunk = SessionUpdate::AgentMessageChunk(ContentChunk::new("late tail".into()));
    sync_codex_goal_turn(
        &state,
        &EventEmitter::Noop,
        AgentType::Codex,
        &chunk,
        &mut cb,
        None,
    )
    .await;
    assert!(!cb.codex_goal_turn);
}
