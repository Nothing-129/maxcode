//! Real tool results must carry the same guidance for structured-only hosts.
use super::*;

#[test]
fn feedback_streak_resets_after_work_and_notes() {
    let guard = FeedbackPollGuard::default();
    let start = Instant::now();
    for index in 0..3 {
        assert_eq!(
            guard.observe(0, start + Duration::from_secs(index * 50)),
            Some(index as u32 + 1)
        );
    }
    assert!(empty_feedback_instruction(3).contains("Stop polling"));
    assert_eq!(guard.observe(0, start + Duration::from_secs(161)), Some(1));
    assert_eq!(guard.observe(1, start + Duration::from_secs(162)), None);
    assert_eq!(guard.observe(0, start + Duration::from_secs(163)), Some(1));
}

#[test]
fn structured_feedback_and_answers_deliver_guidance_without_internal_ids() {
    let notes = render_feedback_result(
        &json!({"count":1,"feedback":[{"text":"Keep the saved model"}],"_commit_ids":["private"]}),
    );
    assert!(notes["structuredContent"]["hint"]
        .as_str()
        .unwrap()
        .contains("high-priority steering"));
    assert!(notes["structuredContent"].get("_commit_ids").is_none());
    for outcome in [
        json!({"answers":[],"declined":true}),
        json!({"answers":[{"question":"Model?","selected":["Keep"]}],"declined":false}),
    ] {
        let result = render_ask_result(&outcome);
        assert!(result["structuredContent"]["hint"]
            .as_str()
            .unwrap()
            .contains("Do not call ask_user_question again"));
        assert_eq!(result["isError"], false);
    }
}
