use super::*;

#[test]
fn chat_target_survives_companion_and_broker_serialization() {
    let spec =
        parse_automation_spec(&json!({"name":"Check", "prompt":"Check invoices", "target":"chat"}))
            .unwrap();
    assert_eq!(serde_json::to_value(spec).unwrap()["target"], "chat");
}

#[test]
fn invalid_chat_targets_are_rejected_before_dispatch() {
    for target in [json!("unknown"), json!(true), json!(7), json!(null)] {
        assert!(
            parse_automation_spec(&json!({"name":"Check", "prompt":"Check", "target":target}))
                .is_err()
        );
    }
}
