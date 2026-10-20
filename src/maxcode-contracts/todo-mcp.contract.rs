use super::*;
use crate::db::test_helpers::{fresh_in_memory_db, seed_conversation, seed_folder};
use crate::models::AgentType;

fn request(tool: &str, arguments: JsonValue) -> ToolRequest {
    ToolRequest {
        tool: tool.into(),
        arguments,
    }
}

fn create_args() -> JsonValue {
    json!({
        "scope_id": "personal", "title": "Follow up", "content": "Check the fix",
        "operation_id": Uuid::new_v4().to_string(),
        "assignee_id": "personal", "due_date": "2026-11-01", "priority": "high",
    })
}

#[tokio::test]
async fn explicit_scope_create_is_idempotent_and_does_not_share_history() {
    let db = fresh_in_memory_db().await;
    // The UI may currently have no valid active team. MCP must not use or
    // mutate that selection when the request explicitly names personal.
    execute(
        &db.conn,
        "UPDATE maxcode_todo_preferences SET mode='team'",
        vec![],
    )
    .await
    .unwrap();
    let args = create_args();
    let first = call(&db.conn, None, request("create_todo", args.clone()))
        .await
        .unwrap();
    let second = call(&db.conn, None, request("create_todo", args))
        .await
        .unwrap();
    assert_eq!(first["todo"]["id"], second["todo"]["id"]);
    assert_eq!(first["origin"]["scope_id"], "personal");
    assert!(first["todo"]["source_url"].is_null());
    assert_eq!(first["todo"]["codex_import_available"], false);
    let listed = call(
        &db.conn,
        None,
        request("list_todos", json!({"scope_id":"personal"})),
    )
    .await
    .unwrap();
    assert_eq!(listed["pagination"]["total"], 1);
    assert_eq!(selected(&db.conn).await.unwrap().0, "team");
    let scopes = call(&db.conn, None, request("list_todo_scopes", json!({})))
        .await
        .unwrap();
    assert_eq!(scopes["scopes"][0]["scope_id"], "personal");
    assert!(!scopes.to_string().contains("token"));
}

#[tokio::test]
async fn patch_preserves_omitted_fields_and_conflicts_do_not_overwrite() {
    let db = fresh_in_memory_db().await;
    let created = call(&db.conn, None, request("create_todo", create_args()))
        .await
        .unwrap();
    let id = &created["todo"]["id"];
    let patched = call(
        &db.conn,
        None,
        request(
            "update_todo",
            json!({
                "scope_id":"personal", "todo_id":id, "revision":1, "title":"Changed",
                "due_date":null,
            }),
        ),
    )
    .await
    .unwrap();
    assert_eq!(patched["todo"]["content"], "Check the fix");
    assert_eq!(patched["todo"]["assignee_id"], "personal");
    assert_eq!(patched["todo"]["priority"], "high");
    assert!(patched["todo"]["due_date"].is_null());
    assert_eq!(patched["todo"]["revision"], 2);
    let stale = call(
        &db.conn,
        None,
        request(
            "update_todo",
            json!({
                "scope_id":"personal", "todo_id":id, "revision":1, "content":"Stale overwrite",
            }),
        ),
    )
    .await
    .unwrap_err();
    assert!(matches!(
        stale.code,
        crate::app_error::AppErrorCode::AlreadyExists
    ));
    let complete = call(
        &db.conn,
        None,
        request(
            "complete_todo",
            json!({
                "scope_id":"personal", "todo_id":id, "revision":2,
            }),
        ),
    )
    .await
    .unwrap();
    assert_eq!(complete["todo"]["status"], "completed");
    assert!(complete["todo"]["completed_at"].is_string());
    let reopened = call(
        &db.conn,
        None,
        request(
            "reopen_todo",
            json!({
                "scope_id":"personal", "todo_id":id, "revision":3,
            }),
        ),
    )
    .await
    .unwrap();
    assert_eq!(reopened["todo"]["status"], "unclaimed");
    assert!(reopened["todo"]["assignee_id"].is_null());
    let claimed = call(
        &db.conn,
        None,
        request(
            "claim_todo",
            json!({
                "scope_id":"personal", "todo_id":id, "revision":4,
            }),
        ),
    )
    .await
    .unwrap();
    assert_eq!(claimed["todo"]["assignee_id"], "personal");
    let released = call(
        &db.conn,
        None,
        request(
            "release_todo",
            json!({
                "scope_id":"personal", "todo_id":id, "revision":5,
            }),
        ),
    )
    .await
    .unwrap();
    assert_eq!(released["todo"]["status"], "unclaimed");
    call(
        &db.conn,
        None,
        request(
            "delete_todo",
            json!({
                "scope_id":"personal", "todo_id":id, "revision":6,
            }),
        ),
    )
    .await
    .unwrap();
    let gone = call(
        &db.conn,
        None,
        request(
            "get_todo",
            json!({
                "scope_id":"personal", "todo_id":id,
            }),
        ),
    )
    .await
    .unwrap();
    assert!(gone["todo"].is_null());
}

#[tokio::test]
async fn links_use_authenticated_conversation_without_publishing() {
    let db = fresh_in_memory_db().await;
    let folder = seed_folder(&db, "/tmp/todo-mcp").await;
    let conversation = seed_conversation(&db, folder, AgentType::Codex).await;
    let created = call(
        &db.conn,
        Some(conversation),
        request("create_todo", create_args()),
    )
    .await
    .unwrap();
    let args = json!({"scope_id":"personal", "todo_id":created["todo"]["id"], "action":"link"});
    assert!(call(
        &db.conn,
        None,
        request("link_todo_to_conversation", args.clone())
    )
    .await
    .is_err());
    call(
        &db.conn,
        Some(conversation),
        request("link_todo_to_conversation", args),
    )
    .await
    .unwrap();
    assert_eq!(
        sources(&db.conn, conversation).await.unwrap().sources.len(),
        1
    );
    assert!(rows(&db.conn, "SELECT * FROM maxcode_todo_share", vec![])
        .await
        .unwrap()
        .is_empty());
}

#[test]
fn tool_boundary_rejects_credentials_snapshots_and_missing_revision() {
    for key in [
        "token",
        "conversation_id",
        "snapshot",
        "include_codex_session",
        "mode",
    ] {
        let mut args = create_args();
        args[key] = json!("forged");
        assert!(validate(&request("create_todo", args)).is_err(), "{key}");
    }
    assert!(validate(&request(
        "delete_todo",
        json!({
            "scope_id":"personal", "todo_id":Uuid::new_v4().simple().to_string(),
        })
    ))
    .is_err());
    assert!(validate(&request("create_team", json!({}))).is_err());
}

#[tokio::test]
async fn invalid_remote_membership_cannot_create_any_todo() {
    let db = fresh_in_memory_db().await;
    let spec: CreateSpec = serde_json::from_value({
        let mut args = create_args();
        args.as_object_mut().unwrap().remove("scope_id");
        args
    })
    .unwrap();
    assert!(member_create(
        &db.conn,
        MemberCreateRequest {
            token: "a".repeat(32),
            spec,
        }
    )
    .await
    .is_err());
    assert!(rows(&db.conn, "SELECT * FROM maxcode_todo_item", vec![])
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn remote_create_retries_and_edits_use_only_member_capability() {
    use axum::{routing::post, Json, Router};
    use std::sync::{Arc, Mutex};
    let host = fresh_in_memory_db().await;
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(1, 1)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    let team = crate::todo::call(
        &host.conn,
        TodoRequest {
            action: "create_team".into(),
            name: Some("Team".into()),
            member_name: Some("Owner".into()),
            avatar: Some(format!(
                "data:image/png;base64,{}",
                STANDARD.encode(bytes.into_inner())
            )),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let team_id = team.active_team_id.unwrap();
    let record = local_scope(&host.conn, &team_id).await.unwrap();
    let token = record.team.unwrap().member_token;
    let captured = Arc::new(Mutex::new(Vec::<JsonValue>::new()));
    let seen = captured.clone();
    let create_conn = host.conn.clone();
    let origin_conn = host.conn.clone();
    let app = Router::new()
        .route(
            "/api/team_todo_create",
            post(move |Json(value): Json<JsonValue>| {
                seen.lock().unwrap().push(value.clone());
                let conn = create_conn.clone();
                async move {
                    Json(
                        member_create(&conn, serde_json::from_value(value).unwrap())
                            .await
                            .unwrap(),
                    )
                }
            }),
        )
        .route(
            "/api/team_todo_origin_call",
            post(move |Json(value): Json<JsonValue>| {
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
    execute(&db.conn,
        "INSERT INTO maxcode_todo_team (id,name,url,is_local,self_id,member_token) VALUES (?,'Remote',?,0,?,?)",
        vec![team_id.clone().into(), format!("http://{address}").into(), team.self_id.unwrap().into(), token.clone().into()],
    ).await.unwrap();
    let mut args = create_args();
    args["scope_id"] = json!(team_id);
    args["assignee_id"] = JsonValue::Null;
    let created = call(&db.conn, Some(123), request("create_todo", args.clone()))
        .await
        .unwrap();
    let replay = call(&db.conn, Some(123), request("create_todo", args))
        .await
        .unwrap();
    assert_eq!(created["todo"]["id"], replay["todo"]["id"]);
    assert_eq!(created["origin"]["scope_id"], team_id);
    let updated = call(&db.conn, None, request("update_todo", json!({
        "scope_id":team_id, "todo_id":created["todo"]["id"], "revision":1, "priority":"urgent",
    }))).await.unwrap();
    assert_eq!(updated["todo"]["priority"], "urgent");
    assert_eq!(updated["todo"]["content"], "Check the fix");
    assert!(!created.to_string().contains(&token));
    for payload in captured.lock().unwrap().iter() {
        assert_eq!(payload["token"], token);
        assert!(payload.get("scope_id").is_none());
        assert!(payload["spec"].get("conversation_id").is_none());
        assert!(payload["spec"].get("snapshot").is_none());
        assert!(payload["spec"].get("codex_session").is_none());
    }
    assert!(rows(&db.conn, "SELECT * FROM maxcode_todo_item", vec![])
        .await
        .unwrap()
        .is_empty());
    assert_eq!(
        rows(&host.conn, "SELECT * FROM maxcode_todo_item", vec![])
            .await
            .unwrap()
            .len(),
        1
    );
    server.abort();
}

#[test]
fn todo_group_is_independent_and_schema_cannot_confuse_execution_tasks() {
    use crate::acp::delegation::companion::{CompanionFeatures, TOOL_SCHEMA_JSON};
    let enabled = CompanionFeatures::parse(Some("todos"));
    let disabled = CompanionFeatures::parse(Some("taskboard"));
    let schema: JsonValue = serde_json::from_str(TOOL_SCHEMA_JSON).unwrap();
    for name in TOOL_NAMES {
        assert!(enabled.allows_tool(name), "{name}");
        assert!(!disabled.allows_tool(name), "{name}");
        let tool = schema
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["name"] == *name)
            .unwrap();
        assert_eq!(tool["inputSchema"]["additionalProperties"], false);
    }
    assert!(!enabled.allows_tool("create_work_task"));
    assert!(!enabled.allows_tool("delegate_to_agent"));
    let create = schema
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "create_work_task")
        .unwrap();
    assert!(create["description"]
        .as_str()
        .unwrap()
        .contains("create_todo instead"));
}
