use super::*;

#[tokio::test]
async fn native_queue_text_cannot_silently_downgrade_to_pull_feedback() {
    let mgr = ConnectionManager::new();
    mgr.insert_test_connection("queue", AgentType::ClaudeCode, None, EventEmitter::Noop)
        .await;
    let state = mgr.get_state("queue").await.unwrap();
    {
        let mut s = state.write().await;
        s.turn_in_flight = true;
        s.feedback_tool_available = true;
        s.native_steering_available = false;
    }
    let err = mgr
        .submit_feedback(
            "queue",
            "keep the original files".into(),
            Some(vec![PromptInputBlock::Text {
                text: "keep the original files".into(),
            }]),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, AcpError::NoActiveTurn));
    assert!(state.read().await.feedback.is_empty());
    assert!(mgr.read_pending_feedback("queue").await.is_empty());
}
