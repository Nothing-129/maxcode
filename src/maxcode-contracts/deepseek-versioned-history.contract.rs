use super::*;

fn transcript() -> String {
    [
        serde_json::json!({"type":"session","version":3,"id":"history","createdAt":1700000000000_i64,"cwd":"/workspace","delegationDepth":0}),
        serde_json::json!({"type":"turn/start","time":1700000000001_i64,"data":{"turn":1}}),
        serde_json::json!({"type":"user/message","time":1700000000002_i64,"data":{"role":"user","source":{"kind":"user"},"content":[{"type":"text","text":"Keep my conversation"}]},"surfaceOp":"append"}),
        serde_json::json!({"type":"assistant/message","time":1700000000003_i64,"data":{"turn":1,"step":1,"message":{"id":"answer","role":"assistant","content":[{"type":"text","text":"History is here"}]}}}),
        serde_json::json!({"type":"turn/end","time":1700000000004_i64,"data":{"turn":1,"reason":{"kind":"completed"}}}),
    ].iter().map(|row| format!("{row}\n")).collect()
}

#[test]
fn current_and_legacy_artifacts_preserve_visible_history() {
    for name in [
        "session.v3.jsonl.zstd",
        "session.v3.jsonl",
        "session.jsonl.zstd",
        "session.jsonl",
    ] {
        let root = tempfile::tempdir().unwrap();
        let session = root.path().join("project/history");
        fs::create_dir_all(&session).unwrap();
        let log = transcript();
        let bytes = if name.ends_with(".zstd") {
            let split = log.find('\n').unwrap() + 1;
            let mut bytes = zstd::stream::encode_all(&log.as_bytes()[..split], 0).unwrap();
            bytes.extend(zstd::stream::encode_all(&log.as_bytes()[split..], 0).unwrap());
            bytes
        } else {
            log.into_bytes()
        };
        fs::write(session.join(name), bytes).unwrap();
        if name.starts_with("session.v3") {
            // A retained old artifact must never shadow current history.
            fs::write(
                session.join("session.jsonl.zstd"),
                zstd::stream::encode_all(&b"{\"type\":\"session\"}\n"[..], 0).unwrap(),
            )
            .unwrap();
        }
        let parser = DeepSeekParser::with_base_dir(root.path().to_owned());
        assert_eq!(parser.list_conversations().unwrap().len(), 1, "{name}");
        let detail = parser.get_conversation("history").unwrap();
        assert_eq!(detail.turns.len(), 2, "{name}");
        assert!(
            matches!(&detail.turns[0].blocks[0], ContentBlock::Text { text } if text == "Keep my conversation")
        );
        assert!(
            matches!(&detail.turns[1].blocks[0], ContentBlock::Text { text } if text == "History is here")
        );
    }
}

#[test]
fn v3_history_survives_an_incomplete_appended_frame() {
    let root = tempfile::tempdir().unwrap();
    let mut bytes = zstd::stream::encode_all(transcript().as_bytes(), 0).unwrap();
    let next = zstd::stream::encode_all(&b"a later write"[..], 0).unwrap();
    bytes.extend_from_slice(&next[..next.len() / 2]);
    fs::write(root.path().join("session.v3.jsonl.zstd"), bytes).unwrap();
    let parsed = parse_session_log(root.path(), None).unwrap();
    assert_eq!(parsed.turns.len(), 2);
}

#[test]
fn newest_generation_preserves_downstream_encoding_migration() {
    let root = tempfile::tempdir().unwrap();
    fs::write(
        root.path().join("session.v3.jsonl.zstd"),
        zstd::stream::encode_all(&b"old compressed history"[..], 0).unwrap(),
    )
    .unwrap();
    fs::write(root.path().join("session.v12.jsonl"), transcript()).unwrap();
    fs::write(root.path().join("session.v099.jsonl"), "uncommitted naming").unwrap();
    let parsed = parse_session_log(root.path(), None).unwrap();
    assert_eq!(parsed.turns.len(), 2);
}
