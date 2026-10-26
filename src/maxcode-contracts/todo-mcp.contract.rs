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
    assert_eq!(complete["todo"]["status"], "pending_verification");
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
        for tool in ["create_todo", "create_todo_from_conversation"] {
            assert!(
                validate(&request(tool, args.clone())).is_err(),
                "{tool}: {key}"
            );
        }
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
            snapshot: None,
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
    // The same selected remote scope must receive a real conversation share,
    // with the host's public URL and no caller-side conversation identifiers.
    crate::db::service::app_metadata_service::upsert_value(
        &host.conn,
        "web_service_public_share_url",
        "https://host.example.com",
    )
    .await
    .unwrap();
    execute(
        &db.conn,
        "UPDATE maxcode_todo_preferences SET mode='team',active_team_id=?",
        vec![team_id.clone().into()],
    )
    .await
    .unwrap();
    let (conversation, _home) = conversation_fixture(&db).await;
    let shared = call(
        &db.conn,
        Some(conversation),
        request("create_todo_from_conversation", default_create_args()),
    )
    .await
    .unwrap();
    assert_eq!(shared["origin"]["scope_id"], team_id);
    let url = shared["todo"]["source_url"].as_str().unwrap();
    assert!(url.starts_with("https://host.example.com/share#"));
    let public = conversation_share::get_shared_conversation_core(
        &host.conn,
        url.split('#').nth(1).unwrap(),
    )
    .await
    .unwrap();
    assert!(serde_json::to_string(&public)
        .unwrap()
        .contains("Configure SIP 8001"));
    let payloads = captured.lock().unwrap();
    let payload = payloads.last().unwrap();
    assert!(payload["snapshot"]["turns"].is_array());
    assert!(payload.get("conversation_id").is_none());
    assert!(!payload.to_string().contains("PRIVATE_THINKING"));
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

async fn select_test_team(conn: &DatabaseConnection) -> String {
    let id = new_id();
    let member = new_id();
    let token = new_id();
    execute(conn, "INSERT INTO maxcode_todo_team (id,name,is_local,self_id,member_token) VALUES (?,'Selected team',1,?,?)", vec![id.clone().into(),member.clone().into(),token.clone().into()]).await.unwrap();
    execute(
        conn,
        "INSERT INTO maxcode_todo_member (id,team_id,name,avatar,token) VALUES (?,?,'Owner','',?)",
        vec![member.into(), id.clone().into(), token.into()],
    )
    .await
    .unwrap();
    execute(
        conn,
        "UPDATE maxcode_todo_preferences SET mode='team', active_team_id=?",
        vec![id.clone().into()],
    )
    .await
    .unwrap();
    id
}

fn default_create_args() -> JsonValue {
    let mut args = create_args();
    args.as_object_mut().unwrap().remove("scope_id");
    args.as_object_mut().unwrap().remove("assignee_id");
    args
}

async fn conversation_fixture(db: &crate::db::AppDatabase) -> (i32, tempfile::TempDir) {
    let home = tempfile::tempdir().unwrap();
    let directory = home.path().join("sessions/2026/10/21");
    std::fs::create_dir_all(&directory).unwrap();
    let id = Uuid::new_v4().to_string();
    let records = [
        json!({"type":"session_meta","timestamp":"2026-10-21T01:00:00Z","payload":{"id":id,"cwd":"/tmp/todo-mcp-share","source":"cli"}}),
        json!({"type":"response_item","timestamp":"2026-10-21T01:00:00Z","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Configure SIP 8001"}]}}),
        json!({"type":"response_item","timestamp":"2026-10-21T01:00:01Z","payload":{"type":"reasoning","summary":[{"type":"summary_text","text":"PRIVATE_THINKING"}]}}),
        json!({"type":"response_item","timestamp":"2026-10-21T01:00:02Z","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"SIP configuration steps"}]}}),
    ];
    std::fs::write(
        directory.join(format!("rollout-2026-10-21T01-00-00-{id}.jsonl")),
        records
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("\n")
            + "\n",
    )
    .unwrap();
    execute(&db.conn, "INSERT INTO agent_setting (agent_type,registry_id,enabled,sort_order,env_json,created_at,updated_at) VALUES (?, 'codex',1,0,?,?,?) ON CONFLICT(agent_type) DO UPDATE SET env_json=excluded.env_json", vec![serde_json::to_string(&AgentType::Codex).unwrap().into(),json!({"CODEX_HOME":home.path()}).to_string().into(),Utc::now().into(),Utc::now().into()]).await.unwrap();
    let folder = seed_folder(db, "/tmp/todo-mcp-share").await;
    let conversation = seed_conversation(db, folder, AgentType::Codex).await;
    crate::db::service::conversation_service::bind_external_id(&db.conn, conversation, &id, &[])
        .await
        .unwrap();
    (conversation, home)
}

#[tokio::test]
async fn omitted_scope_follows_selected_team_and_explicit_personal_still_overrides() {
    let db = fresh_in_memory_db().await;
    let team = select_test_team(&db.conn).await;
    let scopes = call(&db.conn, None, request("list_todo_scopes", json!({})))
        .await
        .unwrap();
    assert_eq!(scopes["mode"], "team");
    assert_eq!(scopes["default_scope_id"], team);
    let created = call(
        &db.conn,
        None,
        request("create_todo", default_create_args()),
    )
    .await
    .unwrap();
    assert_eq!(created["origin"]["scope_id"], team);
    assert_eq!(
        call(&db.conn, None, request("list_todos", json!({})))
            .await
            .unwrap()["pagination"]["total"],
        1
    );
    let personal = call(&db.conn, None, request("create_todo", create_args()))
        .await
        .unwrap();
    assert_eq!(personal["origin"]["scope_id"], PERSONAL);
    assert_eq!(
        selected(&db.conn).await.unwrap(),
        ("team".into(), Some(team))
    );
}

#[tokio::test]
async fn unavailable_selected_team_never_falls_back_to_personal() {
    let db = fresh_in_memory_db().await;
    execute(
        &db.conn,
        "UPDATE maxcode_todo_preferences SET mode='team',active_team_id=NULL",
        vec![],
    )
    .await
    .unwrap();
    for tool in ["create_todo", "create_todo_from_conversation"] {
        assert!(call(&db.conn, None, request(tool, default_create_args()))
            .await
            .is_err());
    }
    assert!(rows(&db.conn, "SELECT * FROM maxcode_todo_item", vec![])
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn current_conversation_creates_team_share_link_not_local_association() {
    let db = fresh_in_memory_db().await;
    let team = select_test_team(&db.conn).await;
    let (conversation, _home) = conversation_fixture(&db).await;
    let args = default_create_args();
    // A team without a public sharing address must fail without a plain todo.
    assert!(call(
        &db.conn,
        Some(conversation),
        request("create_todo_from_conversation", args.clone())
    )
    .await
    .is_err());
    assert!(rows(&db.conn, "SELECT * FROM maxcode_todo_item", vec![])
        .await
        .unwrap()
        .is_empty());
    crate::db::service::app_metadata_service::upsert_value(
        &db.conn,
        "web_service_public_share_url",
        "https://team.example.com",
    )
    .await
    .unwrap();
    assert!(call(
        &db.conn,
        None,
        request("create_todo_from_conversation", args.clone())
    )
    .await
    .is_err());
    let created = call(
        &db.conn,
        Some(conversation),
        request("create_todo_from_conversation", args.clone()),
    )
    .await
    .unwrap();
    let replay = call(
        &db.conn,
        Some(conversation),
        request("create_todo_from_conversation", args),
    )
    .await
    .unwrap();
    assert_eq!(created["origin"]["scope_id"], team);
    assert_eq!(created["todo"]["id"], replay["todo"]["id"]);
    assert_eq!(created["todo"]["source_url"], replay["todo"]["source_url"]);
    let url = created["todo"]["source_url"].as_str().unwrap();
    assert!(url.starts_with("https://team.example.com/share#"));
    let public =
        conversation_share::get_shared_conversation_core(&db.conn, url.split('#').nth(1).unwrap())
            .await
            .unwrap();
    let text = serde_json::to_string(&public).unwrap();
    assert!(text.contains("Configure SIP 8001"));
    assert!(text.contains("SIP configuration steps"));
    assert!(!text.contains("PRIVATE_THINKING"));
    assert_eq!(created["todo"]["codex_import_available"], false);
    assert_eq!(
        rows(&db.conn, "SELECT * FROM maxcode_todo_share", vec![])
            .await
            .unwrap()
            .len(),
        1
    );
    assert!(rows(
        &db.conn,
        "SELECT * FROM maxcode_todo_conversation_link",
        vec![]
    )
    .await
    .unwrap()
    .is_empty());
}
