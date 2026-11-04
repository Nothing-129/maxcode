use super::*;

#[test]
fn filename_fallback_does_not_rebind_acp_identity_or_override_a_header() {
    let dir = tempfile::tempdir().unwrap();
    let id = "01a18bd6-0000-7000-8000-000000000001";
    let other = "01a18bd6-0000-7000-8000-000000000002";
    let decoy = dir.path().join(format!("2026-11-04_{id}.jsonl"));
    std::fs::write(&decoy, format!(r#"{{"type":"session","id":"{other}","cwd":"/workspace","timestamp":"2026-11-04T00:00:00Z"}}
{{"type":"message","message":{{"role":"user","content":[{{"type":"text","text":"kept prompt"}}]}},"timestamp":"2026-11-04T00:00:01Z"}}
"#)).unwrap();
    let parser = PiParser::with_base_dir(dir.path().to_path_buf());
    let detail = parser.get_conversation(id).unwrap();
    assert_eq!(detail.summary.id, id);
    assert!(!detail.turns.is_empty());
    assert!(parser.get_conversation(other).is_ok());
    std::fs::write(
        dir.path().join("header.jsonl"),
        format!(
            r#"{{"type":"session","id":"{id}","cwd":"/winner","timestamp":"2026-11-04T00:00:00Z"}}
"#
        ),
    )
    .unwrap();
    let winner = parser.get_conversation(id).unwrap();
    assert_eq!(winner.summary.folder_path.as_deref(), Some("/winner"));
}
