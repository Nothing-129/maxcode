//! Assigned todo headings group only local conversations created from that
//! todo. Their provenance survives paging, scope switches and process restarts.

use super::*;
use crate::db::test_helpers::{fresh_disk_db, fresh_in_memory_db, seed_conversation, seed_folder};
use crate::models::AgentType;

async fn todo(conn: &DatabaseConnection, title: &str, assignee: Option<&str>) -> TodoItem {
    let state = call(
        conn,
        TodoRequest {
            action: "create".to_string(),
            title: Some(title.to_string()),
            content: Some(format!("Content of {title}")),
            assignee_id: assignee.map(str::to_string),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    state
        .todos
        .into_iter()
        .find(|todo| todo.title == title)
        .unwrap()
}

fn origin(scope: &str, todo: &TodoItem) -> TodoOrigin {
    TodoOrigin {
        scope_id: scope.to_string(),
        todo_id: todo.id.clone(),
    }
}

async fn host(conn: &DatabaseConnection, name: &str) -> TodoState {
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(1, 1)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    call(
        conn,
        TodoRequest {
            action: "create_team".to_string(),
            name: Some(name.to_string()),
            member_name: Some("Host".to_string()),
            avatar: Some(format!(
                "data:image/png;base64,{}",
                STANDARD.encode(bytes.into_inner())
            )),
            ..Default::default()
        },
    )
    .await
    .unwrap()
}

async fn select(conn: &DatabaseConnection, mode: &str, id: Option<&str>) {
    call(
        conn,
        TodoRequest {
            action: "set_mode".to_string(),
            mode: Some(mode.to_string()),
            team_id: id.map(str::to_string),
            ..Default::default()
        },
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn assigned_only_and_multiple_origins_do_not_confuse_source_conversations() {
    let db = fresh_in_memory_db().await;
    let dir = tempfile::tempdir().unwrap();
    let folder = seed_folder(&db, dir.path().to_str().unwrap()).await;
    let made = seed_conversation(&db, folder, AgentType::Codex).await;
    let source = seed_conversation(&db, folder, AgentType::Codex).await;
    let first = todo(&db.conn, "First", Some(PERSONAL)).await;
    let second = todo(&db.conn, "Second", Some(PERSONAL)).await;
    let unclaimed = todo(&db.conn, "Free", None).await;
    execute(
        &db.conn,
        "UPDATE maxcode_todo_item SET source_url=? WHERE id=?",
        vec![
            format!("https://source.example/{source}").into(),
            first.id.clone().into(),
        ],
    )
    .await
    .unwrap();
    let first_origin = origin(PERSONAL, &first);
    link_origins(
        &db.conn,
        made,
        &[
            first_origin.clone(),
            origin(PERSONAL, &second),
            origin(PERSONAL, &unclaimed),
            first_origin,
        ],
    )
    .await
    .unwrap();
    let grouped = groups(&db.conn).await.unwrap();
    assert_eq!(grouped.scope_key, PERSONAL);
    assert_eq!(grouped.groups.len(), 2);
    for group in grouped.groups {
        assert_ne!(group.todo.id, unclaimed.id);
        assert_eq!(group.conversation_ids, vec![made]);
        assert!(!group.conversation_ids.contains(&source));
    }
    assert_eq!(
        rows(
            &db.conn,
            "SELECT * FROM maxcode_todo_conversation_link",
            vec![]
        )
        .await
        .unwrap()
        .len(),
        3
    );
}

#[tokio::test]
async fn original_team_scope_is_saved_after_switching_to_personal() {
    let db = fresh_in_memory_db().await;
    let dir = tempfile::tempdir().unwrap();
    let folder = seed_folder(&db, dir.path().to_str().unwrap()).await;
    let conversation = seed_conversation(&db, folder, AgentType::Codex).await;
    let state = host(&db.conn, "Team").await;
    let id = state.active_team_id.unwrap();
    let other = new_id();
    execute(
        &db.conn,
        "INSERT INTO maxcode_todo_member (id,team_id,name,avatar,token) VALUES (?,?,'Other','',?)",
        vec![other.clone().into(), id.clone().into(), new_id().into()],
    )
    .await
    .unwrap();
    let assigned_to_other = todo(&db.conn, "Assigned to another member", Some(&other)).await;
    select(&db.conn, "personal", None).await;
    link_origins(&db.conn, conversation, &[origin(&id, &assigned_to_other)])
        .await
        .unwrap();
    assert!(groups(&db.conn).await.unwrap().groups.is_empty());
    select(&db.conn, "team", Some(&id)).await;
    let grouped = groups(&db.conn).await.unwrap();
    assert_eq!(grouped.scope_key, format!("team:{id}"));
    assert_eq!(grouped.groups[0].todo.assignee_id, other);
    assert_eq!(grouped.groups[0].conversation_ids, vec![conversation]);
}

#[tokio::test]
async fn completed_group_lookup_is_independent_of_board_page() {
    let db = fresh_in_memory_db().await;
    let dir = tempfile::tempdir().unwrap();
    let folder = seed_folder(&db, dir.path().to_str().unwrap()).await;
    let conversation = seed_conversation(&db, folder, AgentType::Codex).await;
    let oldest = todo(&db.conn, "Oldest completed", Some(PERSONAL)).await;
    execute(
        &db.conn,
        "UPDATE maxcode_todo_item SET status='completed',updated_at='2000-01-01' WHERE id=?",
        vec![oldest.id.clone().into()],
    )
    .await
    .unwrap();
    for i in 0..25 {
        let item = todo(&db.conn, &format!("Completed {i}"), Some(PERSONAL)).await;
        execute(
            &db.conn,
            "UPDATE maxcode_todo_item SET status='completed' WHERE id=?",
            vec![item.id.into()],
        )
        .await
        .unwrap();
    }
    let board = call(
        &db.conn,
        TodoRequest {
            action: "state".to_string(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(board.completed_pagination.total, 26);
    assert!(!board.todos.iter().any(|todo| todo.id == oldest.id));
    link_origins(&db.conn, conversation, &[origin(PERSONAL, &oldest)])
        .await
        .unwrap();
    let grouped = groups(&db.conn).await.unwrap();
    assert_eq!(grouped.groups[0].todo.id, oldest.id);
    assert_eq!(grouped.groups[0].todo.status, "completed");
}

#[tokio::test]
async fn releasing_or_deleting_source_hides_group_but_keeps_conversation() {
    let db = fresh_in_memory_db().await;
    let dir = tempfile::tempdir().unwrap();
    let folder = seed_folder(&db, dir.path().to_str().unwrap()).await;
    let conversation = seed_conversation(&db, folder, AgentType::Codex).await;
    let item = todo(&db.conn, "Assigned", Some(PERSONAL)).await;
    link_origins(&db.conn, conversation, &[origin(PERSONAL, &item)])
        .await
        .unwrap();
    call(
        &db.conn,
        TodoRequest {
            action: "release".to_string(),
            id: Some(item.id.clone()),
            revision: Some(item.revision),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(groups(&db.conn).await.unwrap().groups.is_empty());
    execute(
        &db.conn,
        "DELETE FROM maxcode_todo_item WHERE id=?",
        vec![item.id.clone().into()],
    )
    .await
    .unwrap();
    // A draft opened before task deletion still records its valid provenance.
    link_origins(&db.conn, conversation, &[origin(PERSONAL, &item)])
        .await
        .unwrap();
    assert!(groups(&db.conn).await.unwrap().groups.is_empty());
    assert_eq!(
        rows(
            &db.conn,
            "SELECT id FROM conversation WHERE id=? AND deleted_at IS NULL",
            vec![conversation.into()]
        )
        .await
        .unwrap()
        .len(),
        1
    );
}

#[tokio::test]
async fn deleted_conversation_and_deleted_folder_do_not_reappear_in_groups() {
    let db = fresh_in_memory_db().await;
    let first_dir = tempfile::tempdir().unwrap();
    let second_dir = tempfile::tempdir().unwrap();
    let first_folder = seed_folder(&db, first_dir.path().to_str().unwrap()).await;
    let second_folder = seed_folder(&db, second_dir.path().to_str().unwrap()).await;
    let first = seed_conversation(&db, first_folder, AgentType::Codex).await;
    let second = seed_conversation(&db, second_folder, AgentType::Codex).await;
    let item = todo(&db.conn, "Assigned", Some(PERSONAL)).await;
    link_origins(&db.conn, first, &[origin(PERSONAL, &item)])
        .await
        .unwrap();
    link_origins(&db.conn, second, &[origin(PERSONAL, &item)])
        .await
        .unwrap();
    execute(
        &db.conn,
        "UPDATE conversation SET deleted_at='2026-10-14' WHERE id=?",
        vec![first.into()],
    )
    .await
    .unwrap();
    execute(
        &db.conn,
        "UPDATE folder SET deleted_at='2026-10-14' WHERE id=?",
        vec![second_folder.into()],
    )
    .await
    .unwrap();
    assert!(groups(&db.conn).await.unwrap().groups.is_empty());
}

#[tokio::test]
async fn member_lookup_scopes_and_bounds_response_without_local_conversation_data() {
    let db = fresh_in_memory_db().await;
    let first = host(&db.conn, "First").await;
    let first_id = first.active_team_id.unwrap();
    let token: String = field(
        &rows(
            &db.conn,
            "SELECT member_token FROM maxcode_todo_team WHERE id=?",
            vec![first_id.into()],
        )
        .await
        .unwrap()[0],
        "member_token",
    )
    .unwrap();
    let a = todo(&db.conn, "Assigned A", first.self_id.as_deref()).await;
    let free = todo(&db.conn, "Free", None).await;
    let second = host(&db.conn, "Second").await;
    let b = todo(&db.conn, "Assigned B", second.self_id.as_deref()).await;
    let result = member_lookup(
        &db.conn,
        TeamTodoLookupRequest {
            token: token.clone(),
            todo_ids: vec![a.id.clone(), free.id, b.id],
        },
    )
    .await
    .unwrap();
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].id, a.id);
    let serialized = serde_json::to_value(&result).unwrap();
    assert_eq!(serialized[0].as_object().unwrap().len(), 4);
    assert!(serialized[0].get("content").is_none());
    assert!(serialized[0].get("conversation_ids").is_none());
    assert!(member_lookup(
        &db.conn,
        TeamTodoLookupRequest {
            token,
            todo_ids: vec![a.id; 101]
        }
    )
    .await
    .is_err());
    assert!(member_lookup(
        &db.conn,
        TeamTodoLookupRequest {
            token: new_id(),
            todo_ids: vec![]
        }
    )
    .await
    .is_err());
}

#[tokio::test]
async fn remote_lookup_uploads_only_todo_ids_and_keeps_offline_origin_local() {
    use axum::{routing::post, Json, Router};
    use std::sync::{Arc, Mutex};
    let db = fresh_in_memory_db().await;
    let dir = tempfile::tempdir().unwrap();
    let folder = seed_folder(&db, dir.path().to_str().unwrap()).await;
    let conversation = seed_conversation(&db, folder, AgentType::Codex).await;
    let team_id = new_id();
    let todo_id = new_id();
    let member_token = new_id();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let observed = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
    let captured = observed.clone();
    let heading = TodoGroupSummary {
        id: todo_id.clone(),
        title: "Remote assigned".to_string(),
        status: "claimed".to_string(),
        assignee_id: new_id(),
    };
    let app = Router::new().route(
        "/api/team_todo_lookup",
        post(move |Json(body): Json<serde_json::Value>| {
            captured.lock().unwrap().push(body);
            let heading = heading.clone();
            async move { Json(vec![heading]) }
        }),
    );
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    execute(&db.conn, "INSERT INTO maxcode_todo_team (id,name,url,is_local,self_id,member_token) VALUES (?,'Remote',?,0,?,?)", vec![team_id.clone().into(), format!("http://{address}").into(), new_id().into(), member_token.clone().into()]).await.unwrap();
    let provenance = TodoOrigin {
        scope_id: team_id.clone(),
        todo_id: todo_id.clone(),
    };
    link_origins(&db.conn, conversation, std::slice::from_ref(&provenance))
        .await
        .unwrap();
    select(&db.conn, "team", Some(&team_id)).await;
    let grouped = groups(&db.conn).await.unwrap();
    assert_eq!(grouped.groups[0].conversation_ids, vec![conversation]);
    {
        let requests = observed.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(
            requests[0],
            serde_json::json!({"token":member_token,"todo_ids":[todo_id]})
        );
    }
    server.abort();
    let _ = server.await;
    // Host loss cannot prevent saving another local conversation's origin.
    let another = seed_conversation(&db, folder, AgentType::Codex).await;
    link_origins(&db.conn, another, &[provenance])
        .await
        .unwrap();
    let offline = groups(&db.conn).await.unwrap();
    assert!(offline.groups.is_empty());
    assert!(offline.connection_error.is_some());
}

#[tokio::test]
async fn provenance_survives_reopening_database() {
    let dir = tempfile::tempdir().unwrap();
    let db = fresh_disk_db(dir.path()).await;
    let folder = seed_folder(&db, dir.path().to_str().unwrap()).await;
    let conversation = seed_conversation(&db, folder, AgentType::Codex).await;
    let item = todo(&db.conn, "Persisted", Some(PERSONAL)).await;
    link_origins(&db.conn, conversation, &[origin(PERSONAL, &item)])
        .await
        .unwrap();
    db.conn.close().await.unwrap();
    let reopened = sea_orm::Database::connect(format!(
        "sqlite:{}?mode=rw",
        dir.path().join("source.db").to_string_lossy()
    ))
    .await
    .unwrap();
    assert_eq!(
        groups(&reopened).await.unwrap().groups[0].conversation_ids,
        vec![conversation]
    );
}

#[tokio::test]
async fn create_handlers_compensate_when_origin_write_fails() {
    use crate::web::handlers::conversations::{
        create_chat_conversation, create_conversation, CreateChatConversationParams,
        CreateConversationParams,
    };
    use axum::{extract::Extension, Json};
    let db = fresh_in_memory_db().await;
    let dir = tempfile::tempdir().unwrap();
    let folder = seed_folder(&db, dir.path().to_str().unwrap()).await;
    let state = std::sync::Arc::new(crate::app_state::AppState::new_for_test(
        db,
        dir.path().to_path_buf(),
    ));
    execute(&state.db.conn, "CREATE TRIGGER fail_todo_link BEFORE INSERT ON maxcode_todo_conversation_link BEGIN SELECT RAISE(ABORT,'link failure'); END", vec![]).await.unwrap();
    let provenance = TodoOrigin {
        scope_id: PERSONAL.to_string(),
        todo_id: new_id(),
    };
    assert!(create_conversation(
        Extension(state.clone()),
        Json(CreateConversationParams {
            folder_id: folder,
            agent_type: AgentType::Codex,
            title: Some("Failed regular".to_string()),
            todo_origins: vec![provenance.clone()]
        })
    )
    .await
    .is_err());
    assert!(create_chat_conversation(
        Extension(state.clone()),
        Json(CreateChatConversationParams {
            agent_type: AgentType::Codex,
            title: Some("Failed chat".to_string()),
            existing_dir: None,
            todo_origins: vec![provenance]
        })
    )
    .await
    .is_err());
    assert!(rows(
        &state.db.conn,
        "SELECT id FROM conversation WHERE deleted_at IS NULL",
        vec![]
    )
    .await
    .unwrap()
    .is_empty());
    assert!(rows(
        &state.db.conn,
        "SELECT id FROM folder WHERE kind='chat' AND deleted_at IS NULL",
        vec![]
    )
    .await
    .unwrap()
    .is_empty());
    assert!(groups(&state.db.conn).await.unwrap().groups.is_empty());
}
