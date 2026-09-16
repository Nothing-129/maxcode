use super::*;

#[test]
fn maintained_codex_questions_keep_full_text_and_generic_peers_stay_generic() {
    let question =
        "Which migration strategy should be used to retain every existing user conversation?";
    let raw = serde_json::json!({
        "mode": "form", "sessionId": "contract", "message": "Choose",
        "requestedSchema": {"type": "object", "required": ["q"], "properties": {
            "q": {"type": "string", "title": question, "description": "Migration",
                "_meta": {"codex": {"isOther": false, "isSecret": false}},
                "oneOf": [{"const": "keep", "title": "Keep history"}]}
        }}
    });
    let ElicitationPlan::Questions(new) = classify_elicitation(
        &raw,
        ElicitationPeer::Codex(Some(CodexUserInputShape::QuestionInTitle)),
    )
    .unwrap() else {
        panic!("expected a question")
    };
    assert_eq!(new.specs[0].question, question);
    assert_eq!(new.specs[0].header, "Migration");
    let ElicitationPlan::Questions(old) = classify_elicitation(
        &raw,
        ElicitationPeer::Codex(Some(CodexUserInputShape::QuestionInDescription)),
    )
    .unwrap() else {
        panic!("expected a question")
    };
    assert_eq!(old.specs[0].question, "Migration");
    let ElicitationPlan::Questions(generic) =
        classify_elicitation(&raw, ElicitationPeer::Other).unwrap()
    else {
        panic!("expected a question")
    };
    assert_eq!(generic.specs[0].question, "Migration");
}
