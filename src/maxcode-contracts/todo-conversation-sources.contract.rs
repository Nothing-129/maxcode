//! Manual associations and source details remain local and target their
//! captured todo scope, independent of the current board selection or page.

use super::*;
use crate::db::test_helpers::{fresh_in_memory_db, seed_conversation, seed_folder};
use crate::models::AgentType;

async fn item(conn: &DatabaseConnection, title: &str, assignee: Option<&str>) -> TodoItem {
    call(
        conn,
        TodoRequest {
            action: "create".to_string(),
            title: Some(title.to_string()),
            content: Some(format!("Task content: {title}")),
            assignee_id: assignee.map(str::to_string),
            ..Default::default()
        },
    )
    .await
    .unwrap()
    .todos
    .into_iter()
    .find(|item| item.title == title)
    .unwrap()
}

fn origin(scope: &str, item: &TodoItem) -> TodoOrigin {
    TodoOrigin {
        scope_id: scope.to_string(),
        todo_id: item.id.clone(),
    }
}

fn get(origin: TodoOrigin) -> TodoOriginCallRequest {
    TodoOriginCallRequest {
        origin,
        operation: OriginAction {
            action: "get".to_string(),
            ..Default::default()
        },
    }
}

async fn team(conn: &DatabaseConnection, name: &str) -> TodoState {
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

async fn member_token(conn: &DatabaseConnection, id: &str) -> String {
    field(
        &rows(
            conn,
            "SELECT member_token FROM maxcode_todo_team WHERE id=?",
            vec![id.into()],
        )
        .await
        .unwrap()[0],
        "member_token",
    )
    .unwrap()
}

#[tokio::test]
async fn picker_search_includes_all_statuses_and_completed_pages_in_captured_scope() {
    let db = fresh_in_memory_db().await;
    let literal = item(&db.conn, "Literal 50%_\\ target", None).await;
    for i in 0..25 {
        let todo = item(&db.conn, &format!("Done {i}"), Some(PERSONAL)).await;
        execute(
            &db.conn,
            "UPDATE maxcode_todo_item SET status='completed' WHERE id=?",
            vec![todo.id.into()],
        )
        .await
        .unwrap();
    }
    let claimed = item(&db.conn, "Claimed", Some(PERSONAL)).await;
    let current = team(&db.conn, "Currently selected").await;
    item(&db.conn, "Other scope task", current.self_id.as_deref()).await;
    let page = search(
        &db.conn,
        TodoSearchRequest {
            scope_id: PERSONAL.to_string(),
            query: SearchQuery {
                page: Some(2),
                ..Default::default()
            },
        },
    )
    .await
    .unwrap();
    assert_eq!(page.pagination.total, 27);
    assert_eq!(page.todos.len(), 7);
    let matches = search(
        &db.conn,
        TodoSearchRequest {
            scope_id: PERSONAL.to_string(),
            query: SearchQuery {
                search: Some("50%_\\".to_string()),
                ..Default::default()
            },
        },
    )
    .await
    .unwrap();
    assert_eq!(matches.todos[0].id, literal.id);
    let all = search(
        &db.conn,
        TodoSearchRequest {
            scope_id: PERSONAL.to_string(),
            query: SearchQuery {
                page_size: Some(100),
                ..Default::default()
            },
        },
    )
    .await
    .unwrap();
    assert!(all.todos.iter().any(|todo| todo.id == claimed.id));
    assert!(all.todos.iter().any(|todo| todo.status == "completed"));
    assert!(all.todos.iter().any(|todo| todo.status == "unclaimed"));
    assert_eq!(
        selected(&db.conn).await.unwrap(),
        ("team".to_string(), current.active_team_id)
    );
}

#[tokio::test]
async fn own_task_search_filters_before_pagination_and_uses_member_identity() {
    let db = fresh_in_memory_db().await;
    let personal = item(&db.conn, "Personal unassigned", None).await;
    let hosted = team(&db.conn, "Team").await;
    let scope_id = hosted.active_team_id.unwrap();
    let self_id = hosted.self_id.unwrap();
    let token = member_token(&db.conn, &scope_id).await;
    item(&db.conn, "Match unassigned", None).await;
    let other = item(&db.conn, "Match other", Some(&self_id)).await;
    execute(
        &db.conn,
        "UPDATE maxcode_todo_item SET assignee_id='another-member' WHERE id=?",
        vec![other.id.into()],
    )
    .await
    .unwrap();
    for i in 0..3 {
        let mine = item(&db.conn, &format!("Match mine {i}"), Some(&self_id)).await;
        if i == 0 {
            execute(
                &db.conn,
                "UPDATE maxcode_todo_item SET status='completed' WHERE id=?",
                vec![mine.id.into()],
            )
            .await
            .unwrap();
        }
    }
    let query = SearchQuery {
        only_mine: true,
        search: Some("Match".to_string()),
        page: Some(2),
        page_size: Some(2),
    };
    let local = search(
        &db.conn,
        TodoSearchRequest {
            scope_id: scope_id.clone(),
            query: query.clone(),
        },
    )
    .await
    .unwrap();
    let member = member_search(&db.conn, TeamTodoSearchRequest { token, query })
        .await
        .unwrap();
    for result in [local, member] {
        assert_eq!(result.pagination.total, 3);
        assert_eq!(result.pagination.page, 2);
        assert_eq!(result.todos.len(), 1);
        assert!(result
            .todos
            .iter()
            .all(|todo| todo.assignee_id.as_deref() == Some(self_id.as_str())));
    }
    let completed = search(
        &db.conn,
        TodoSearchRequest {
            scope_id,
            query: SearchQuery {
                only_mine: true,
                search: Some("mine 0".to_string()),
                ..Default::default()
            },
        },
    )
    .await
    .unwrap();
    assert_eq!(completed.todos[0].status, "completed");
    let personal_result = search(
        &db.conn,
        TodoSearchRequest {
            scope_id: PERSONAL.to_string(),
            query: SearchQuery {
                only_mine: true,
                ..Default::default()
            },
        },
    )
    .await
    .unwrap();
    assert_eq!(personal_result.todos[0].id, personal.id);
}

#[tokio::test]
async fn manual_links_are_idempotent_and_sources_include_unassigned_across_scopes() {
    let db = fresh_in_memory_db().await;
    let dir = tempfile::tempdir().unwrap();
    let folder = seed_folder(&db, dir.path().to_str().unwrap()).await;
    let conversation = seed_conversation(&db, folder, AgentType::Codex).await;
    let personal = item(&db.conn, "Personal source", None).await;
    let hosted = team(&db.conn, "Team source").await;
    let team_id = hosted.active_team_id.unwrap();
    let team_item = item(&db.conn, "Assigned team source", hosted.self_id.as_deref()).await;
    for source in [
        origin(PERSONAL, &personal),
        origin(PERSONAL, &personal),
        origin(&team_id, &team_item),
    ] {
        link(
            &db.conn,
            TodoConversationLinkRequest {
                conversation_id: conversation,
                origin: source,
                action: "link".to_string(),
            },
        )
        .await
        .unwrap();
    }
    let result = sources(&db.conn, conversation).await.unwrap();
    assert_eq!(result.sources.len(), 2);
    let unassigned = result
        .sources
        .iter()
        .find(|source| source.origin.scope_id == PERSONAL)
        .unwrap();
    assert_eq!(unassigned.todo.as_ref().unwrap().status, "unclaimed");
    assert!(unassigned.assignee.is_none());
    let assigned = result
        .sources
        .iter()
        .find(|source| source.origin.scope_id == team_id)
        .unwrap();
    assert_eq!(assigned.scope_name, "Team source");
    assert_eq!(assigned.assignee.as_ref().unwrap().name, "Host");
    for _ in 0..2 {
        link(
            &db.conn,
            TodoConversationLinkRequest {
                conversation_id: conversation,
                origin: origin(PERSONAL, &personal),
                action: "unlink".to_string(),
            },
        )
        .await
        .unwrap();
    }
    assert_eq!(
        sources(&db.conn, conversation).await.unwrap().sources.len(),
        1
    );
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
async fn exact_origin_edit_keeps_selection_and_requires_current_revision() {
    let db = fresh_in_memory_db().await;
    let todo = item(&db.conn, "Original", Some(PERSONAL)).await;
    let selected_team = team(&db.conn, "Selected team").await;
    let target = origin(PERSONAL, &todo);
    let updated = origin_call(
        &db.conn,
        TodoOriginCallRequest {
            origin: target.clone(),
            operation: OriginAction {
                action: "update".to_string(),
                title: Some(String::new()),
                content: Some("Fresh generated title\nDetails".to_string()),
                due_date: None,
                priority: None,
                assignee_id: Some(PERSONAL.to_string()),
                revision: Some(todo.revision),
            },
        },
    )
    .await
    .unwrap()
    .todo
    .unwrap();
    assert_eq!(updated.title, "Fresh generated title");
    assert_eq!(updated.revision, todo.revision + 1);
    assert!(origin_call(
        &db.conn,
        TodoOriginCallRequest {
            origin: target.clone(),
            operation: OriginAction {
                action: "complete".to_string(),
                revision: Some(todo.revision),
                ..Default::default()
            }
        }
    )
    .await
    .is_err());
    assert_eq!(
        origin_call(&db.conn, get(target))
            .await
            .unwrap()
            .todo
            .unwrap()
            .id,
        todo.id
    );
    assert_eq!(
        selected(&db.conn).await.unwrap(),
        ("team".to_string(), selected_team.active_team_id)
    );
}

#[tokio::test]
async fn deleted_sources_are_omitted_and_missing_todos_cannot_be_manually_linked() {
    let db = fresh_in_memory_db().await;
    let dir = tempfile::tempdir().unwrap();
    let folder = seed_folder(&db, dir.path().to_str().unwrap()).await;
    let conversation = seed_conversation(&db, folder, AgentType::Codex).await;
    let todo = item(&db.conn, "Deleted source", None).await;
    let target = origin(PERSONAL, &todo);
    link(
        &db.conn,
        TodoConversationLinkRequest {
            conversation_id: conversation,
            origin: target.clone(),
            action: "link".to_string(),
        },
    )
    .await
    .unwrap();
    let deleted = origin_call(
        &db.conn,
        TodoOriginCallRequest {
            origin: target.clone(),
            operation: OriginAction {
                action: "delete".to_string(),
                revision: Some(todo.revision),
                ..Default::default()
            },
        },
    )
    .await
    .unwrap();
    assert!(deleted.todo.is_none());
    assert!(origin_call(&db.conn, get(target.clone()))
        .await
        .unwrap()
        .todo
        .is_none());
    assert!(matches!(
        origin_call(
            &db.conn,
            TodoOriginCallRequest {
                origin: target.clone(),
                operation: OriginAction {
                    action: "complete".to_string(),
                    revision: Some(todo.revision),
                    ..Default::default()
                }
            }
        )
        .await
        .err()
        .unwrap()
        .code,
        crate::app_error::AppErrorCode::NotFound
    ));
    assert!(sources(&db.conn, conversation)
        .await
        .unwrap()
        .sources
        .is_empty());
    assert!(link(
        &db.conn,
        TodoConversationLinkRequest {
            conversation_id: conversation,
            origin: target.clone(),
            action: "link".to_string()
        }
    )
    .await
    .is_err());
    // Unlink does not need a live source, so a stale local association is removable.
    link(
        &db.conn,
        TodoConversationLinkRequest {
            conversation_id: conversation,
            origin: target,
            action: "unlink".to_string(),
        },
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn manual_links_reject_deleted_or_non_root_conversations() {
    let db = fresh_in_memory_db().await;
    let dir = tempfile::tempdir().unwrap();
    let folder = seed_folder(&db, dir.path().to_str().unwrap()).await;
    let deleted = seed_conversation(&db, folder, AgentType::Codex).await;
    let delegated = seed_conversation(&db, folder, AgentType::Codex).await;
    let todo = item(&db.conn, "Source", None).await;
    execute(
        &db.conn,
        "UPDATE conversation SET deleted_at='2026-10-14' WHERE id=?",
        vec![deleted.into()],
    )
    .await
    .unwrap();
    execute(
        &db.conn,
        "UPDATE conversation SET kind='delegate',parent_id=? WHERE id=?",
        vec![deleted.into(), delegated.into()],
    )
    .await
    .unwrap();
    for id in [deleted, delegated] {
        assert!(link(
            &db.conn,
            TodoConversationLinkRequest {
                conversation_id: id,
                origin: origin(PERSONAL, &todo),
                action: "link".to_string()
            }
        )
        .await
        .is_err());
        assert!(sources(&db.conn, id).await.is_err());
    }
}

#[tokio::test]
async fn member_capabilities_find_unassigned_but_do_not_cross_team_scope() {
    let db = fresh_in_memory_db().await;
    let first = team(&db.conn, "First").await;
    let first_id = first.active_team_id.unwrap();
    let token = member_token(&db.conn, &first_id).await;
    let unassigned = item(&db.conn, "Unassigned first", None).await;
    team(&db.conn, "Second").await;
    let other = item(&db.conn, "Unassigned second", None).await;
    let searched = member_search(
        &db.conn,
        TeamTodoSearchRequest {
            token: token.clone(),
            query: SearchQuery::default(),
        },
    )
    .await
    .unwrap();
    assert_eq!(searched.todos.len(), 1);
    assert_eq!(searched.todos[0].id, unassigned.id);
    let details = member_details(
        &db.conn,
        TeamTodoDetailsRequest {
            token: token.clone(),
            todo_ids: vec![unassigned.id.clone(), other.id.clone()],
        },
    )
    .await
    .unwrap();
    assert_eq!(details.todos.len(), 1);
    assert!(details.todos[0].assignee_id.is_none());
    assert!(member_origin_call(
        &db.conn,
        TeamTodoOriginCallRequest {
            token: token.clone(),
            todo_id: other.id,
            operation: OriginAction {
                action: "complete".to_string(),
                revision: Some(other.revision),
                ..Default::default()
            }
        }
    )
    .await
    .is_err());
    assert!(member_details(
        &db.conn,
        TeamTodoDetailsRequest {
            token: token.clone(),
            todo_ids: vec![unassigned.id; 101]
        }
    )
    .await
    .is_err());
    assert!(member_search(
        &db.conn,
        TeamTodoSearchRequest {
            token: new_id(),
            query: SearchQuery::default()
        }
    )
    .await
    .is_err());
    // The sidebar capability still omits unassigned tasks.
    assert!(super::super::conversation_groups::member_lookup(
        &db.conn,
        super::super::conversation_groups::TeamTodoLookupRequest {
            token,
            todo_ids: details.todos.into_iter().map(|todo| todo.id).collect()
        }
    )
    .await
    .unwrap()
    .is_empty());
}

#[tokio::test]
async fn remote_capabilities_use_member_token_and_never_upload_local_conversation() {
    use axum::{routing::post, Json, Router};
    use std::sync::{Arc, Mutex};
    let host_db = fresh_in_memory_db().await;
    let hosted = team(&host_db.conn, "Remote").await;
    let team_id = hosted.active_team_id.unwrap();
    let token = member_token(&host_db.conn, &team_id).await;
    let todo = item(&host_db.conn, "Remote unassigned", None).await;
    let captured = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
    let seen_search = captured.clone();
    let search_conn = host_db.conn.clone();
    let seen_details = captured.clone();
    let details_conn = host_db.conn.clone();
    let seen_origin = captured.clone();
    let origin_conn = host_db.conn.clone();
    let app = Router::new()
        .route(
            "/api/team_todo_search",
            post(move |Json(value): Json<serde_json::Value>| {
                seen_search.lock().unwrap().push(value.clone());
                let conn = search_conn.clone();
                async move {
                    Json(
                        member_search(&conn, serde_json::from_value(value).unwrap())
                            .await
                            .unwrap(),
                    )
                }
            }),
        )
        .route(
            "/api/team_todo_details",
            post(move |Json(value): Json<serde_json::Value>| {
                seen_details.lock().unwrap().push(value.clone());
                let conn = details_conn.clone();
                async move {
                    Json(
                        member_details(&conn, serde_json::from_value(value).unwrap())
                            .await
                            .unwrap(),
                    )
                }
            }),
        )
        .route(
            "/api/team_todo_origin_call",
            post(move |Json(value): Json<serde_json::Value>| {
                seen_origin.lock().unwrap().push(value.clone());
                let conn = origin_conn.clone();
                async move {
                    Json(
                        member_origin_call(&conn, serde_json::from_value(value).unwrap())
                            .await
                            .unwrap(),
                    )
                }
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let db = fresh_in_memory_db().await;
    let dir = tempfile::tempdir().unwrap();
    let folder = seed_folder(&db, dir.path().to_str().unwrap()).await;
    let conversation = seed_conversation(&db, folder, AgentType::Codex).await;
    execute(
        &db.conn,
        "UPDATE conversation SET title='Private local transcript title' WHERE id=?",
        vec![conversation.into()],
    )
    .await
    .unwrap();
    execute(&db.conn,"INSERT INTO maxcode_todo_team (id,name,url,is_local,self_id,member_token) VALUES (?,'Remote',?,0,?,?)",vec![team_id.clone().into(),format!("http://{address}").into(),hosted.self_id.clone().unwrap().into(),token.clone().into()]).await.unwrap();
    let mine = item(&host_db.conn, "Remote mine", hosted.self_id.as_deref()).await;
    let own = search(
        &db.conn,
        TodoSearchRequest {
            scope_id: team_id.clone(),
            query: SearchQuery {
                only_mine: true,
                ..Default::default()
            },
        },
    )
    .await
    .unwrap();
    assert_eq!(own.pagination.total, 1);
    assert_eq!(own.todos[0].id, mine.id);
    assert_eq!(captured.lock().unwrap()[0]["only_mine"], true);
    let source = origin(&team_id, &todo);
    let picked = search(
        &db.conn,
        TodoSearchRequest {
            scope_id: team_id.clone(),
            query: SearchQuery {
                search: Some("Remote unassigned".to_string()),
                ..Default::default()
            },
        },
    )
    .await
    .unwrap();
    assert_eq!(picked.todos[0].id, todo.id);
    link(
        &db.conn,
        TodoConversationLinkRequest {
            conversation_id: conversation,
            origin: source.clone(),
            action: "link".to_string(),
        },
    )
    .await
    .unwrap();
    assert_eq!(
        sources(&db.conn, conversation).await.unwrap().sources[0]
            .todo
            .as_ref()
            .unwrap()
            .id,
        todo.id
    );
    let edited = origin_call(
        &db.conn,
        TodoOriginCallRequest {
            origin: source.clone(),
            operation: OriginAction {
                action: "update".to_string(),
                title: Some("Edited remote title".to_string()),
                content: Some("Edited todo content".to_string()),
                revision: Some(todo.revision),
                ..Default::default()
            },
        },
    )
    .await
    .unwrap();
    assert_eq!(edited.todo.unwrap().title, "Edited remote title");
    for request in captured.lock().unwrap().iter() {
        assert_eq!(request["token"], token);
        assert!(request.get("conversation_id").is_none());
        assert!(request.get("origin").is_none());
        assert!(request.get("snapshot").is_none());
        assert!(!request.to_string().contains("Private local transcript"));
    }
    assert_eq!(selected(&db.conn).await.unwrap().0, "personal");
    server.abort();
    let _ = server.await;
    let offline = sources(&db.conn, conversation).await.unwrap();
    assert_eq!(offline.sources[0].origin, source);
    assert!(offline.sources[0].todo.is_none());
    assert!(offline.sources[0].connection_error.is_some());
    link(
        &db.conn,
        TodoConversationLinkRequest {
            conversation_id: conversation,
            origin: source,
            action: "unlink".to_string(),
        },
    )
    .await
    .unwrap();
    assert!(sources(&db.conn, conversation)
        .await
        .unwrap()
        .sources
        .is_empty());
}

#[tokio::test]
async fn local_manual_link_emits_conversation_event_after_success_only() {
    use axum::{extract::Extension, Json};
    let db = fresh_in_memory_db().await;
    let dir = tempfile::tempdir().unwrap();
    let folder = seed_folder(&db, dir.path().to_str().unwrap()).await;
    let conversation = seed_conversation(&db, folder, AgentType::Codex).await;
    let todo = item(&db.conn, "Source", None).await;
    let state = std::sync::Arc::new(crate::app_state::AppState::new_for_test(
        db,
        dir.path().to_path_buf(),
    ));
    let mut events = state.event_broadcaster.subscribe();
    crate::web::handlers::todo::todo_conversation_link(
        Extension(state.clone()),
        Json(TodoConversationLinkRequest {
            conversation_id: conversation,
            origin: origin(PERSONAL, &todo),
            action: "link".to_string(),
        }),
    )
    .await
    .unwrap();
    let event = events.recv().await.unwrap();
    assert_eq!(event.channel, "todo-conversation-links://changed");
    assert_eq!(
        *event.payload,
        serde_json::json!({"conversation_id":conversation})
    );
    assert!(crate::web::handlers::todo::todo_conversation_link(
        Extension(state.clone()),
        Json(TodoConversationLinkRequest {
            conversation_id: conversation,
            origin: TodoOrigin {
                scope_id: PERSONAL.to_string(),
                todo_id: new_id()
            },
            action: "link".to_string()
        })
    )
    .await
    .is_err());
    assert!(events.try_recv().is_err());
}
