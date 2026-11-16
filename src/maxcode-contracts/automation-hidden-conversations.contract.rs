use super::*;
use crate::db::{
    service::conversation_service,
    test_helpers::{seed_conversation, seed_folder},
};

#[tokio::test]
async fn visibility_tracks_current_config_without_removing_history_or_detail() {
    let db = fresh_in_memory_db().await;
    let folder = seed_folder(&db, "/tmp/hidden-automation").await;
    let id = seed_conversation(&db, folder, crate::models::AgentType::ClaudeCode).await;
    let a = create(&db.conn, draft("hidden", Some("0 0 * * *")))
        .await
        .unwrap();
    let run = start_run(&db.conn, a.id, "manual", None).await.unwrap();
    attach_run_runtime(&db.conn, run.id, Some(id), None, None)
        .await
        .unwrap();
    assert!(
        !conversation_service::get_by_id(&db.conn, id)
            .await
            .unwrap()
            .hide_from_conversation_list
    );
    let mut change = draft("hidden", Some("0 0 * * *"));
    change.config["hide_from_conversation_list"] = serde_json::json!(true);
    update(&db.conn, a.id, change.clone()).await.unwrap();
    assert!(
        conversation_service::get_by_id(&db.conn, id)
            .await
            .unwrap()
            .hide_from_conversation_list
    );
    let list = conversation_service::list_all(&db.conn, None, None, None, None, None, false)
        .await
        .unwrap();
    assert!(
        list.iter()
            .find(|s| s.id == id)
            .unwrap()
            .hide_from_conversation_list
    );
    assert_eq!(
        list_runs(&db.conn, a.id, 50).await.unwrap()[0].conversation_id,
        Some(id)
    );
    let mut old_run = automation_run::Entity::find_by_id(run.id)
        .one(&db.conn)
        .await
        .unwrap()
        .unwrap()
        .into_active_model();
    old_run.created_at = Set(Utc::now() - chrono::Duration::days(60));
    old_run.status = Set(AutomationRunStatus::Succeeded);
    old_run.update(&db.conn).await.unwrap();
    assert_eq!(prune_old_runs(&db.conn, 30).await.unwrap(), 0);
    assert!(
        conversation_service::get_by_id(&db.conn, id)
            .await
            .unwrap()
            .hide_from_conversation_list
    );
    change.config["hide_from_conversation_list"] = serde_json::json!(false);
    update(&db.conn, a.id, change).await.unwrap();
    assert!(
        !conversation_service::get_by_id(&db.conn, id)
            .await
            .unwrap()
            .hide_from_conversation_list
    );
}
