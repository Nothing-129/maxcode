use super::*;
use crate::db::service::{conversation_service, folder_service};
use crate::db::test_helpers::fresh_in_memory_db;
use crate::models::ImageData;

fn text(value: &str) -> ContentBlock {
    ContentBlock::Text { text: value.into() }
}

fn turn(role: TurnRole, blocks: Vec<ContentBlock>) -> MessageTurn {
    MessageTurn {
        id: "internal-message-id".into(),
        role,
        blocks,
        timestamp: Utc::now(),
        usage: None,
        duration_ms: None,
        model: None,
        completed_at: None,
        agent_message_id: Some("private-agent-id".into()),
    }
}

fn select_share_turns(
    turns: Vec<MessageTurn>,
    options: &ConversationShareOptions,
) -> Result<Vec<MessageTurn>, AppCommandError> {
    sanitize_selected_turns(select_share_rounds(turns, options)?)
}

fn execution() -> Vec<MessageTurn> {
    vec![
        turn(TurnRole::System, vec![text("PRIVATE_SYSTEM")]),
        turn(TurnRole::User, vec![text("Question")]),
        turn(
            TurnRole::Assistant,
            vec![ContentBlock::Thinking {
                text: "PRIVATE_THINKING".into(),
            }],
        ),
        turn(
            TurnRole::Assistant,
            vec![ContentBlock::ToolUse {
                tool_use_id: Some("private-tool-id".into()),
                tool_name: "Shell".into(),
                input_preview: Some("PRIVATE_COMMAND /Users/private/project".into()),
                status: None,
                meta: Some(serde_json::json!({"cwd": "/private/workspace"})),
            }],
        ),
        turn(
            TurnRole::Assistant,
            vec![ContentBlock::ToolResult {
                tool_use_id: Some("private-tool-id".into()),
                output_preview: Some("PRIVATE_OUTPUT".into()),
                is_error: false,
                agent_stats: None,
                images: vec![ImageData {
                    data: "image-data".into(),
                    mime_type: "image/png".into(),
                    uri: Some("file:///private/image.png".into()),
                }],
            }],
        ),
        turn(TurnRole::Assistant, vec![text("Answer")]),
    ]
}

#[test]
fn default_snapshot_contains_readable_content_and_images_without_execution_or_local_metadata() {
    let selected = select_share_turns(execution(), &ConversationShareOptions::default()).unwrap();
    let json = serde_json::to_string(&selected).unwrap();
    assert_eq!(selected.len(), 3);
    assert!(json.contains("Question"));
    assert!(json.contains("Answer"));
    assert!(json.contains("image-data"));
    for private in [
        "PRIVATE_",
        "/private/",
        "/Users/",
        "internal-message-id",
        "private-agent-id",
        "private-tool-id",
    ] {
        assert!(!json.contains(private), "snapshot leaked {private}");
    }
}

#[test]
fn execution_is_excluded_even_with_explicit_opt_ins() {
    for (tools, thinking) in [(false, false), (true, false), (false, true), (true, true)] {
        let options = ConversationShareOptions {
            include_tools: tools,
            include_thinking: thinking,
            rounds: None,
        };
        let json =
            serde_json::to_string(&select_share_turns(execution(), &options).unwrap()).unwrap();
        assert!(!json.contains("PRIVATE_COMMAND"));
        assert!(!json.contains("PRIVATE_OUTPUT"));
        assert!(!json.contains("PRIVATE_THINKING"));
        assert!(!json.contains("PRIVATE_SYSTEM"));
        assert!(!json.contains("private-tool-id"));
        assert!(!json.contains("file:///private/"));
        assert!(!json.contains("/private/workspace"));
    }
}

#[test]
fn round_selection_includes_every_reply_in_selected_non_adjacent_rounds() {
    let turns = vec![
        turn(TurnRole::System, vec![text("system")]),
        turn(TurnRole::User, vec![text("QUESTION_ONE")]),
        turn(TurnRole::Assistant, vec![text("REPLY_ONE_PROGRESS")]),
        turn(TurnRole::Assistant, vec![text("REPLY_ONE_FINAL")]),
        turn(TurnRole::User, vec![text("QUESTION_TWO")]),
        turn(TurnRole::Assistant, vec![text("REPLY_TWO")]),
        turn(TurnRole::User, vec![text("QUESTION_THREE")]),
        turn(TurnRole::Assistant, vec![text("REPLY_THREE")]),
    ];
    let options = ConversationShareOptions {
        rounds: Some(vec![1, 3]),
        ..Default::default()
    };
    let selected = select_share_turns(turns.clone(), &options).unwrap();
    let json = serde_json::to_string(&selected).unwrap();
    assert_eq!(selected.len(), 5);
    assert!(json.contains("REPLY_ONE_PROGRESS"));
    assert!(json.contains("REPLY_ONE_FINAL"));
    assert!(json.contains("REPLY_THREE"));
    assert!(!json.contains("TWO"));
    for rounds in [vec![], vec![0], vec![4], vec![1, 999]] {
        assert!(select_share_turns(
            turns.clone(),
            &ConversationShareOptions {
                rounds: Some(rounds),
                ..Default::default()
            }
        )
        .is_err());
    }
}

#[test]
fn an_empty_or_execution_only_selection_is_rejected() {
    assert!(select_share_turns(vec![], &ConversationShareOptions::default()).is_err());
    assert!(select_share_turns(
        vec![turn(
            TurnRole::Assistant,
            vec![ContentBlock::Thinking {
                text: "private".into()
            }]
        )],
        &ConversationShareOptions::default()
    )
    .is_err());
}

#[tokio::test]
async fn legacy_and_opted_in_public_links_are_filtered_on_read() {
    let db = fresh_in_memory_db().await;
    let folder = folder_service::add_folder(&db.conn, "/tmp/share-content-contract")
        .await
        .unwrap();
    let conversation = conversation_service::create(
        &db.conn,
        folder.id,
        AgentType::Codex,
        Some("Shared".into()),
        None,
    )
    .await
    .unwrap();
    let snapshot = SharedConversationSnapshot {
        version: 1,
        title: Some("Shared".into()),
        agent_type: AgentType::Codex,
        model: None,
        message_count: 6,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        shared_at: Utc::now(),
        files: Vec::new(),
        turns: execution(),
        share_options: ConversationShareOptions::default(),
        session_stats: None,
    };
    let mut legacy = serde_json::to_value(&snapshot).unwrap();
    legacy.as_object_mut().unwrap().remove("share_options");
    let first = conversation_share_service::publish(&db.conn, conversation.id, legacy.to_string())
        .await
        .unwrap();
    let public = get_shared_conversation_core(&db.conn, &first.token)
        .await
        .unwrap();
    assert_eq!(public.version, 2);
    assert_eq!(public.message_count, 3);
    assert!(!serde_json::to_string(&public).unwrap().contains("PRIVATE_"));

    let options = ConversationShareOptions {
        include_tools: true,
        include_thinking: true,
        rounds: Some(vec![1]),
    };
    let mut explicit = snapshot;
    explicit.version = 2;
    explicit.turns = execution();
    explicit.share_options = options;
    let second = conversation_share_service::publish(
        &db.conn,
        conversation.id,
        serde_json::to_string(&explicit).unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(second.token, first.token);
    let public = get_shared_conversation_core(&db.conn, &second.token)
        .await
        .unwrap();
    let json = serde_json::to_string(&public).unwrap();
    assert!(!public.share_options.include_tools);
    assert!(!public.share_options.include_thinking);
    assert!(!json.contains("PRIVATE_THINKING"));
    assert!(!json.contains("PRIVATE_COMMAND"));
    assert!(!json.contains("PRIVATE_SYSTEM"));
    assert!(!json.contains("private-agent-id"));
}

#[tokio::test]
async fn shares_referenced_files_once_without_reading_examples_or_external_paths() {
    let workspace = tempfile::tempdir().unwrap();
    std::fs::write(workspace.path().join("图 (1).png"), b"png").unwrap();
    std::fs::write(workspace.path().join("report.xlsx"), b"xlsx").unwrap();
    std::fs::write(workspace.path().join("private.txt"), b"private").unwrap();
    let mut turns = vec![turn(TurnRole::Assistant, vec![text(
        "![图](<图 (1).png>) [下载](report.xlsx) [again](report.xlsx) `[example](private.txt)` [web](https://example.com) [missing](lost.pdf)",
    )])];
    let files = share_files::collect(&mut turns, workspace.path()).await;
    assert_eq!(files.len(), 3);
    assert_eq!(files[0].data.as_deref(), Some("cG5n"));
    assert_eq!(files[1].data.as_deref(), Some("eGxzeA=="));
    assert!(files[2].data.is_none());
    let ContentBlock::Text { text } = &turns[0].blocks[0] else {
        panic!()
    };
    assert_eq!(text.matches("#maxcode-file-1").count(), 2);
    assert!(text.contains("`[example](private.txt)`"));
    assert!(text.contains("[web](https://example.com)"));
}

#[tokio::test]
async fn captured_files_survive_source_removal_and_stay_bound_to_the_shared_rounds() {
    let root = tempfile::tempdir().unwrap();
    let workspace = root.path().join("workspace");
    std::fs::create_dir(&workspace).unwrap();
    std::fs::write(workspace.join("thumb.png"), b"png").unwrap();
    std::fs::write(workspace.join("final.pdf"), b"pdf").unwrap();
    std::fs::write(root.path().join("outside.txt"), b"outside").unwrap();
    let uri = url::Url::from_file_path(workspace.join("thumb.png")).unwrap();
    let turns = vec![
        turn(TurnRole::User, vec![text("[unselected](other.zip)")]),
        turn(
            TurnRole::User,
            vec![ContentBlock::Image {
                data: String::new(),
                mime_type: "image/png".into(),
                uri: Some(uri.to_string()),
            }],
        ),
        turn(
            TurnRole::Assistant,
            vec![text(
                "[![图](thumb.png)](final.pdf) [outside](../outside.txt)",
            )],
        ),
    ];
    let options = ConversationShareOptions {
        rounds: Some(vec![2]),
        ..Default::default()
    };
    let mut turns = select_share_rounds(turns, &options).unwrap();
    let files = share_files::collect(&mut turns, &workspace).await;
    let db = fresh_in_memory_db().await;
    let folder = folder_service::add_folder(&db.conn, workspace.to_str().unwrap())
        .await
        .unwrap();
    let conversation =
        conversation_service::create(&db.conn, folder.id, AgentType::Codex, None, None)
            .await
            .unwrap();
    let snapshot = SharedConversationSnapshot {
        version: 2,
        title: None,
        agent_type: AgentType::Codex,
        model: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        shared_at: Utc::now(),
        message_count: 2,
        turns: sanitize_share_turns(turns),
        files,
        share_options: options,
        session_stats: None,
    };
    let row = conversation_share_service::publish(
        &db.conn,
        conversation.id,
        serde_json::to_string(&snapshot).unwrap(),
    )
    .await
    .unwrap();
    drop(root);
    let public = get_shared_conversation_core(&db.conn, &row.token)
        .await
        .unwrap();
    assert_eq!(public.files.len(), 3);
    assert_eq!(public.files[0].data.as_deref(), Some("cG5n"));
    assert_eq!(public.files[1].data.as_deref(), Some("cGRm"));
    assert!(public.files[2].data.is_none());
    let json = serde_json::to_string(&public.turns).unwrap();
    assert_eq!(json.matches("#maxcode-file-0").count(), 2);
    assert!(!json.contains("other.zip"));
    assert!(!json.contains("../outside"));
}
