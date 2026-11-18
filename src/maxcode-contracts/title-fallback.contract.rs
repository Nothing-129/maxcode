use super::*;

#[tokio::test]
async fn stale_recovery_does_not_replace_an_agent_title_with_unnamed() {
    let db = fresh_in_memory_db().await;
    let folder = seed_folder(&db, "/tmp/title-fallback-race").await;
    let id = seed_conversation(&db, folder, AgentType::Codex).await;
    let untitled = conversation_service::get_by_id(&db.conn, id).await.unwrap();
    let broadcaster = Arc::new(WebEventBroadcaster::new());
    let events = broadcaster.subscribe();
    let emitter = EventEmitter::test_web_only(broadcaster);

    let native_title = "官方会话标题";
    assert!(
        conversation_service::refresh_auto_title(&db.conn, id, native_title.into())
            .await
            .unwrap()
    );

    recover_auto_title(&db.conn, &emitter, &untitled, &[image_only_turn()]).await;

    let saved = conversation_service::get_by_id(&db.conn, id).await.unwrap();
    assert_eq!(saved.title.as_deref(), Some(native_title));
    assert!(
        events.is_empty(),
        "recovery must not broadcast an unnamed title"
    );
}
