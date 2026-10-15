//! Internal image/recovery notes must never split a visible reply in two.
use super::*;

#[test]
fn companion_records_continue_the_turn_but_cron_prompts_still_start_one() {
    for content in [
        "[Image: original 2880x1800, displayed at 2000x1250.]",
        "Your response was cut off mid-stream. Resume directly.",
    ] {
        let mut record = serde_json::json!({"type":"user","isMeta":true,"turnCompanion":true,"message":{"role":"user","content":content}});
        assert!(turn_initiator_text(&record).is_none());
        record["turnCompanion"] = false.into();
        assert!(turn_initiator_text(&record).is_some());
    }
}
