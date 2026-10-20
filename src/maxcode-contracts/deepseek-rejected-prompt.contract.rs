use super::*;

#[tokio::test]
async fn rejected_image_prompt_survives_reopen_before_later_native_turn() {
    let root = tempfile::tempdir().unwrap();
    let session = root.path().join("project/rejected-session");
    fs::create_dir_all(&session).unwrap();
    let parser = DeepSeekParser::with_base_dir(root.path().to_owned());
    let blocks = vec![
        UserMessageBlock::Text {
            text: "调整 PC 待办宽度".into(),
        },
        UserMessageBlock::Image {
            data: "aGVsbG8=".into(),
            mime_type: "image/png".into(),
        },
    ];
    record_rejected_prompt_in(
        &parser.rejected_root,
        "rejected-session",
        "first-prompt",
        &blocks,
        "model does not accept image input",
    )
    .await
    .unwrap();

    let later = Utc::now().timestamp_millis() + 10_000;
    let log = [
        serde_json::json!({"type":"session","createdAt":later-20_000,"cwd":"/workspace","delegationDepth":0}),
        serde_json::json!({"type":"turn/start","time":later,"data":{"turn":1}}),
        serde_json::json!({"type":"user/message","time":later+1,"data":{"source":{"kind":"user"},"content":[{"type":"text","text":"这是模型设置问题吗？"}]}}),
        serde_json::json!({"type":"assistant/message","time":later+2,"data":{"message":{"id":"answer","content":[{"type":"text","text":"可以切换模型"}]}}}),
        serde_json::json!({"type":"turn/end","time":later+3,"data":{"turn":1}}),
    ]
    .iter()
    .map(|line| format!("{line}\n"))
    .collect::<String>();
    fs::write(session.join("session.v3.jsonl"), log).unwrap();

    let summary = parser.list_conversations().unwrap();
    assert_eq!(summary.len(), 1);
    assert_eq!(summary[0].message_count, 4);
    let detail = parser.get_conversation("rejected-session").unwrap();
    assert_eq!(detail.turns.len(), 4);
    assert_eq!(detail.turns[0].id, "first-prompt");
    assert!(
        matches!(&detail.turns[0].blocks[0], ContentBlock::Text { text } if text == "调整 PC 待办宽度")
    );
    assert!(
        matches!(&detail.turns[0].blocks[1], ContentBlock::Image { data, mime_type, .. } if data == "aGVsbG8=" && mime_type == "image/png")
    );
    assert!(
        matches!(&detail.turns[1].blocks[0], ContentBlock::Text { text } if text.contains("does not accept image"))
    );
    assert!(
        matches!(&detail.turns[2].blocks[0], ContentBlock::Text { text } if text == "这是模型设置问题吗？")
    );
}

#[tokio::test]
async fn rejected_prompt_alone_still_lists_as_a_conversation() {
    let root = tempfile::tempdir().unwrap();
    let session = root.path().join("project/rejected-only");
    fs::create_dir_all(&session).unwrap();
    fs::write(
        session.join("session.v3.jsonl"),
        serde_json::json!({"type":"session","createdAt":Utc::now().timestamp_millis(),"cwd":"/workspace","delegationDepth":0}).to_string(),
    )
    .unwrap();
    let parser = DeepSeekParser::with_base_dir(root.path().to_owned());
    record_rejected_prompt_in(
        &parser.rejected_root,
        "rejected-only",
        "prompt",
        &[UserMessageBlock::Text { text: "hi".into() }],
        "authentication required",
    )
    .await
    .unwrap();

    assert_eq!(parser.list_conversations().unwrap().len(), 1);
    assert_eq!(
        parser
            .get_conversation("rejected-only")
            .unwrap()
            .turns
            .len(),
        2
    );
}
