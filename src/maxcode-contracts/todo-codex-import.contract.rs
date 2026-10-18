use super::*;
use crate::db::test_helpers::{fresh_in_memory_db, seed_conversation, seed_folder};
use crate::parsers::{AgentEnv, AgentParser};
use serde_json::json;

fn fixture(id: &str) -> CodexSessionTransfer {
    let records = [
        json!({"type":"session_meta","timestamp":"2026-10-18T01:00:00Z","payload":{"id":id,"cwd":"/sender/project","originator":"codex_cli_rs","cli_version":"0.157.0","source":"cli","model_provider":"openai"}}),
        json!({"type":"turn_context","timestamp":"2026-10-18T01:00:00Z","payload":{"cwd":"/sender/project","approval_policy":"never","sandbox_policy":{"type":"danger-full-access"},"model":"gpt-5.4"}}),
        json!({"type":"response_item","timestamp":"2026-10-18T01:00:00Z","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Continue work on /sender/project"}]}}),
        json!({"type":"response_item","timestamp":"2026-10-18T01:00:01Z","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Ready to continue"}]}}),
    ];
    CodexSessionTransfer {
        version: 1,
        rollout: records
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("\n")
            + "\n",
        title: Some("Shared task".into()),
    }
}

async fn set_home(conn: &DatabaseConnection, path: &Path) {
    execute(conn, "INSERT INTO agent_setting (agent_type,registry_id,enabled,sort_order,env_json,created_at,updated_at) VALUES (?, 'codex',1,0,?,?,?) ON CONFLICT(agent_type) DO UPDATE SET env_json=excluded.env_json", vec![serde_json::to_string(&AgentType::Codex).unwrap().into(),json!({"CODEX_HOME":path.to_str().unwrap()}).to_string().into(),Utc::now().into(),Utc::now().into()]).await.unwrap();
}

#[test]
fn imported_history_has_local_identity_and_permissions_without_rewriting_messages() {
    let source_id = Uuid::new_v4().to_string();
    let target_id = Uuid::new_v4().to_string();
    let mut transfer = fixture(&source_id);
    let mut records = transfer.validate().unwrap();
    records[0]["payload"]["history_base"] =
        json!({"thread_id":source_id,"end_ordinal_exclusive":8});
    records[0]["payload"]["forked_from_id"] = source_id.into();
    transfer.rollout = records
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join("\n");
    let result = prepare(&transfer, &target_id, Path::new("/receiver/project")).unwrap();
    let records: Vec<serde_json::Value> = result
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(records[0]["payload"]["id"], target_id);
    assert_eq!(records[0]["payload"]["cwd"], "/receiver/project");
    assert!(records[0]["payload"].get("history_base").is_none());
    assert!(records[0]["payload"].get("forked_from_id").is_none());
    assert_eq!(records[1]["payload"]["cwd"], "/receiver/project");
    assert_eq!(records[1]["payload"]["approval_policy"], "on-request");
    assert_eq!(records[1]["payload"]["sandbox_policy"]["type"], "read-only");
    assert_eq!(
        records[2]["payload"]["content"][0]["text"],
        "Continue work on /sender/project"
    );
    transfer.version = 2;
    assert!(transfer.validate().is_err());
    transfer.version = 1;
    transfer.rollout.push_str("\n{truncated");
    assert!(transfer.validate().is_err());
}

#[tokio::test]
async fn todo_handoff_keeps_native_history_private_and_imports_once_per_project() {
    let db = fresh_in_memory_db().await;
    let source_home = tempfile::tempdir().unwrap();
    let target_home = tempfile::tempdir().unwrap();
    let source_project = tempfile::tempdir().unwrap();
    let target_project = tempfile::tempdir().unwrap();
    let source_folder = seed_folder(&db, source_project.path().to_str().unwrap()).await;
    let target_folder = seed_folder(&db, target_project.path().to_str().unwrap()).await;
    let source = seed_conversation(&db, source_folder, AgentType::Codex).await;
    let id = Uuid::new_v4().to_string();
    write_rollout(source_home.path(), &id, &fixture(&id).rollout).unwrap();
    set_home(&db.conn, source_home.path()).await;
    conversation_service::bind_external_id(&db.conn, source, &id, &[])
        .await
        .unwrap();
    let state = call(
        &db.conn,
        TodoRequest {
            action: "create".into(),
            title: Some("Handoff".into()),
            content: Some("Continue this task".into()),
            conversation_id: Some(source),
            include_codex_session: true,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let todo = &state.todos[0];
    assert!(todo.codex_import_available);
    let token = todo.source_url.as_ref().unwrap().split('#').nth(1).unwrap();
    let public = conversation_share::get_shared_conversation_core(&db.conn, token)
        .await
        .unwrap();
    let public_json = serde_json::to_string(&public).unwrap();
    assert!(!public_json.contains("rollout"));
    assert!(!public_json.contains("approval_policy"));
    assert!(public_json.contains("Ready to continue"));
    set_home(&db.conn, target_home.path()).await;
    let origin = TodoOrigin {
        scope_id: PERSONAL.into(),
        todo_id: todo.id.clone(),
    };
    let imported = import(
        &db.conn,
        ImportRequest {
            origin: origin.clone(),
            folder_id: target_folder,
        },
    )
    .await
    .unwrap();
    assert_ne!(imported.external_id.as_deref(), Some(id.as_str()));
    assert_eq!(imported.agent_type, AgentType::Codex);
    assert_eq!(imported.folder_id, target_folder);
    let env = AgentEnv::from_env_json(Some(&json!({"CODEX_HOME":target_home.path()}).to_string()));
    let detail = CodexParser::for_env(&env)
        .get_conversation(imported.external_id.as_ref().unwrap())
        .unwrap();
    assert!(detail.turns.len() >= 2);
    assert_eq!(
        detail.summary.folder_path.as_deref(),
        Some(
            std::fs::canonicalize(target_project.path())
                .unwrap()
                .to_str()
                .unwrap()
        )
    );
    let again = import(
        &db.conn,
        ImportRequest {
            origin: origin.clone(),
            folder_id: target_folder,
        },
    )
    .await
    .unwrap();
    assert_eq!(again.id, imported.id);
    let links = rows(
        &db.conn,
        "SELECT conversation_id FROM maxcode_todo_conversation_link WHERE todo_id=?",
        vec![todo.id.clone().into()],
    )
    .await
    .unwrap();
    assert_eq!(links.len(), 1);
    execute(
        &db.conn,
        "DELETE FROM maxcode_todo_item WHERE id=?",
        vec![todo.id.clone().into()],
    )
    .await
    .unwrap();
    assert!(import(
        &db.conn,
        ImportRequest {
            origin,
            folder_id: target_folder
        }
    )
    .await
    .is_err());
}

#[test]
fn native_export_flattens_fork_history_and_rejects_missing_bases() {
    let home = tempfile::tempdir().unwrap();
    let parent = Uuid::new_v4().to_string();
    let child = Uuid::new_v4().to_string();
    let base = fixture(&parent);
    let parent_path = write_rollout(home.path(), &parent, &base.rollout).unwrap();
    let mut header: serde_json::Value =
        serde_json::from_str(base.rollout.lines().next().unwrap()).unwrap();
    header["payload"]["id"] = child.clone().into();
    header["payload"]["history_base"] = json!({"thread_id":parent,"end_ordinal_exclusive":10});
    write_rollout(home.path(), &child, &(header.to_string() + "\n")).unwrap();
    let parser = CodexParser::with_base_dir(home.path().join("sessions"));
    let exported = parser.export_rollout(&child).unwrap();
    assert!(exported.contains("Ready to continue"));
    assert_eq!(
        exported
            .lines()
            .filter(|line| line.contains("session_meta"))
            .count(),
        1
    );
    std::fs::remove_file(parent_path).unwrap();
    assert!(parser.export_rollout(&child).is_err());
}

#[tokio::test]
async fn team_recovery_data_requires_membership_and_can_be_imported_on_another_backend() {
    use crate::todo::conversation_sources::{member_codex_session, TeamCodexSessionRequest};
    use axum::{routing::post, Json, Router};
    let host = fresh_in_memory_db().await;
    let receiver = fresh_in_memory_db().await;
    let home = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    set_home(&receiver.conn, home.path()).await;
    let folder_id = seed_folder(&receiver, project.path().to_str().unwrap()).await;
    let team_id = new_id();
    let member_id = new_id();
    let member_token = new_id();
    let todo_id = new_id();
    execute(&host.conn, "INSERT INTO maxcode_todo_team (id,name,is_local,self_id,member_token) VALUES (?,'Host',1,?,?)", vec![team_id.clone().into(),member_id.clone().into(),member_token.clone().into()]).await.unwrap();
    execute(
        &host.conn,
        "INSERT INTO maxcode_todo_member (id,team_id,name,avatar,token) VALUES (?,?,'Member','',?)",
        vec![
            member_id.clone().into(),
            team_id.clone().into(),
            member_token.clone().into(),
        ],
    )
    .await
    .unwrap();
    execute(&host.conn, "INSERT INTO maxcode_todo_item (id,scope_id,title,content,status,creator_id,created_at,updated_at,codex_import_available) VALUES (?,?,'Handoff','Continue','unclaimed',?,?,?,1)", vec![todo_id.clone().into(),team_id.clone().into(),member_id.clone().into(),Utc::now().to_rfc3339().into(),Utc::now().to_rfc3339().into()]).await.unwrap();
    execute(&host.conn, "INSERT INTO maxcode_todo_share (token,todo_id,scope_id,snapshot_json,codex_session_json) VALUES (?,?,?,'{}',?)", vec![new_id().into(),todo_id.clone().into(),team_id.clone().into(),serde_json::to_string(&fixture(&Uuid::new_v4().to_string())).unwrap().into()]).await.unwrap();
    assert!(member_codex_session(
        &host.conn,
        TeamCodexSessionRequest {
            token: new_id(),
            todo_id: todo_id.clone()
        }
    )
    .await
    .is_err());
    assert!(member_codex_session(
        &host.conn,
        TeamCodexSessionRequest {
            token: member_token.clone(),
            todo_id: new_id()
        }
    )
    .await
    .is_err());
    let conn = host.conn.clone();
    let app = Router::new().route(
        "/api/team_todo_codex_session",
        post(move |Json(request): Json<TeamCodexSessionRequest>| {
            let conn = conn.clone();
            async move { member_codex_session(&conn, request).await.map(Json) }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    execute(&receiver.conn, "INSERT INTO maxcode_todo_team (id,name,url,is_local,self_id,member_token) VALUES (?,'Remote',?,0,?,?)", vec![team_id.clone().into(),address.into(),member_id.into(),member_token.into()]).await.unwrap();
    let origin = TodoOrigin {
        scope_id: team_id,
        todo_id,
    };
    let summary = import(&receiver.conn, ImportRequest { origin, folder_id })
        .await
        .unwrap();
    assert_eq!(summary.agent_type, AgentType::Codex);
    assert_eq!(summary.folder_id, folder_id);
    assert_eq!(
        rows(
            &receiver.conn,
            "SELECT conversation_id FROM maxcode_todo_conversation_link",
            vec![]
        )
        .await
        .unwrap()
        .len(),
        1
    );
    assert!(rows(&host.conn, "SELECT id FROM conversation", vec![])
        .await
        .unwrap()
        .is_empty());
    server.abort();
}

#[tokio::test]
async fn local_call_ignores_injected_recovery_data_and_rejects_partial_handoffs() {
    let db = fresh_in_memory_db().await;
    let state = call(
        &db.conn,
        TodoRequest {
            action: "create".into(),
            title: Some("Plain task".into()),
            content: Some("Task".into()),
            codex_session: Some(fixture(&Uuid::new_v4().to_string())),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(!state.todos[0].codex_import_available);
    assert!(rows(&db.conn, "SELECT * FROM maxcode_todo_share", vec![])
        .await
        .unwrap()
        .is_empty());
    assert!(call(
        &db.conn,
        TodoRequest {
            action: "create".into(),
            title: Some("Partial task".into()),
            content: Some("Task".into()),
            include_codex_session: true,
            share_options: ConversationShareOptions {
                rounds: Some(vec![1]),
                ..Default::default()
            },
            ..Default::default()
        }
    )
    .await
    .is_err());
}

/// Optional protocol smoke: runs a real local Codex binary with an isolated
/// home and an unreachable fixture provider. It never starts inference.
#[tokio::test]
#[ignore = "set MAXCODE_TEST_CODEX_BIN to a local Codex binary"]
async fn native_app_server_reads_imported_history() {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let binary = std::env::var("MAXCODE_TEST_CODEX_BIN").expect("MAXCODE_TEST_CODEX_BIN");
    let home = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let cwd = std::fs::canonicalize(project.path()).unwrap();
    let id = Uuid::new_v4().to_string();
    let transfer = CodexSessionTransfer {
        version: 1,
        rollout: include_str!("fixtures/codex-todo-native-session.jsonl").into(),
        title: None,
    };
    let data = prepare(&transfer, &id, &cwd).unwrap();
    write_rollout(home.path(), &id, &data).unwrap();
    let mut child = tokio::process::Command::new(binary)
        .args([
            "app-server",
            "--listen",
            "stdio://",
            "-c",
            "model_provider=\"fixture\"",
            "-c",
            "model_providers.fixture.name=\"Fixture\"",
            "-c",
            "model_providers.fixture.base_url=\"http://127.0.0.1:9\"",
            "-c",
            "model_providers.fixture.wire_api=\"responses\"",
        ])
        .env("CODEX_HOME", home.path())
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap()).lines();
    let requests = [
        json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"maxcode-native-import-test","version":"1"},"capabilities":{"experimentalApi":true}}}),
        json!({"id":2,"method":"thread/resume","params":{"threadId":id,"cwd":cwd,"modelProvider":"fixture","model":"fixture-model","approvalPolicy":"on-request","sandbox":"workspace-write"}}),
        json!({"id":3,"method":"thread/items/list","params":{"threadId":id,"turnId":null,"cursor":null,"limit":100,"sortDirection":"asc"}}),
    ];
    for (index, request) in requests.iter().enumerate() {
        input
            .write_all(format!("{request}\n").as_bytes())
            .await
            .unwrap();
        let response = tokio::time::timeout(std::time::Duration::from_secs(25), async {
            loop {
                let line = output
                    .next_line()
                    .await
                    .unwrap()
                    .expect("app-server output");
                let response: serde_json::Value = serde_json::from_str(&line).unwrap();
                if response["id"] == request["id"] {
                    break response;
                }
            }
        })
        .await
        .unwrap();
        assert!(response.get("error").is_none(), "{response}");
        if index == 0 {
            input
                .write_all(b"{\"method\":\"initialized\"}\n")
                .await
                .unwrap();
        } else if index == 1 {
            assert_eq!(response["result"]["thread"]["id"], id);
            assert_eq!(response["result"]["thread"]["cwd"], cwd.to_str().unwrap());
        } else {
            let history = response["result"].to_string();
            assert!(
                history.contains("Remember mango for the next computer."),
                "{history}"
            );
            assert!(
                history.contains("Mango is the remembered word."),
                "{history}"
            );
        }
    }
    child.kill().await.unwrap();
}
