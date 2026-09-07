use super::*;
use std::sync::Arc;

use axum::{extract::State, http::StatusCode, routing::post, Json, Router};
use serde_json::{json, Value};

use crate::commands::system_settings::{
    set_system_title_model_settings_core, TitleModelRuntimeSettings,
};
use crate::db::test_helpers::{fresh_in_memory_db, seed_conversation, seed_folder};
use crate::models::{ContentBlock, MessageTurn, SystemTitleModelSettingsUpdate, TurnRole};
use crate::web::event_bridge::WebEventBroadcaster;

fn created_at() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2026-09-02T16:30:00Z")
        .unwrap()
        .with_timezone(&Utc)
}

#[test]
fn structured_title_normalizes_separators_and_created_date() {
    for title in [
        "0907/修复/顶部栏闪烁",
        "0907 | 修复 | 顶部栏闪烁",
        "0907｜修复｜顶部栏闪烁",
    ] {
        assert_eq!(
            normalize_structured_title(title, created_at()).as_deref(),
            Some("0903｜修复｜顶部栏闪烁")
        );
    }
    assert_eq!(
        normalize_structured_title("0907/优化/CI/CD", created_at()).as_deref(),
        Some("0903｜优化｜CI/CD")
    );
    for invalid in [
        "顶部栏闪烁",
        "0907｜其他｜顶部栏闪烁",
        "0907｜修复｜",
        "abcd｜修复｜闪烁",
        "0907｜修复｜闪烁｜多余字段",
    ] {
        assert!(
            normalize_structured_title(invalid, created_at()).is_none(),
            "{invalid}"
        );
    }
}

struct MockServer {
    url: String,
    requests: Arc<Mutex<Vec<Value>>>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for MockServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}
#[derive(Clone)]
struct MockState {
    replies: Arc<Mutex<Vec<(StatusCode, Value)>>>,
    requests: Arc<Mutex<Vec<Value>>>,
    delay: Duration,
}
async fn serve(
    State(state): State<MockState>,
    Json(body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    state.requests.lock().unwrap().push(body);
    tokio::time::sleep(state.delay).await;
    let mut replies = state.replies.lock().unwrap();
    let (status, body) = if replies.len() > 1 {
        replies.remove(0)
    } else {
        replies[0].clone()
    };
    (status, Json(body))
}
async fn mock(replies: Vec<(StatusCode, Value)>, delay: Duration) -> MockServer {
    let requests = Arc::new(Mutex::new(Vec::new()));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let app = Router::new()
        .route("/chat/completions", post(serve))
        .with_state(MockState {
            replies: Arc::new(Mutex::new(replies)),
            requests: requests.clone(),
            delay,
        });
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    MockServer {
        url,
        requests,
        task,
    }
}
fn reply(title: &str) -> (StatusCode, Value) {
    (
        StatusCode::OK,
        json!({"choices":[{"message":{"content":title},"finish_reason":"stop"}]}),
    )
}
fn runtime(server: &MockServer) -> TitleModelRuntimeSettings {
    TitleModelRuntimeSettings {
        base_url: server.url.clone(),
        model: "saved-model".into(),
        api_key: None,
        request_params: Default::default(),
    }
}

#[tokio::test]
async fn invalid_responses_retry_but_authentication_does_not() {
    let server = mock(
        vec![
            (
                StatusCode::BAD_GATEWAY,
                json!({"error":{"message":"temporary"}}),
            ),
            reply("0903｜非法类型｜闪烁"),
            reply("0907/修复/顶部栏闪烁"),
        ],
        Duration::ZERO,
    )
    .await;
    let result = llm_title_via_api(
        &runtime(&server),
        "顶部栏闪烁",
        "原始标题",
        created_at(),
        TitleLocale::Zh,
    )
    .await
    .unwrap();
    assert_eq!(result, "0903｜修复｜顶部栏闪烁");
    assert_eq!(server.requests.lock().unwrap().len(), 3);

    let server = mock(
        vec![(
            StatusCode::UNAUTHORIZED,
            json!({"error":{"message":"bad key"}}),
        )],
        Duration::ZERO,
    )
    .await;
    assert!(llm_title_via_api(
        &runtime(&server),
        "顶部栏闪烁",
        "原始标题",
        created_at(),
        TitleLocale::Zh
    )
    .await
    .is_err());
    assert_eq!(server.requests.lock().unwrap().len(), 1);

    let server = mock(vec![
        (StatusCode::OK, json!({"choices":[{"message":{"content":"0903｜修复｜顶部"},"finish_reason":"length"}]})),
        reply("0903｜修复｜顶部栏闪烁"),
    ], Duration::ZERO).await;
    assert!(llm_title_via_api(
        &runtime(&server),
        "顶部栏闪烁",
        "原始标题",
        created_at(),
        TitleLocale::Zh
    )
    .await
    .is_ok());
    assert_eq!(server.requests.lock().unwrap().len(), 2);
}

fn turn(role: TurnRole, text: &str) -> MessageTurn {
    MessageTurn {
        id: "turn".into(),
        role,
        blocks: vec![ContentBlock::Text { text: text.into() }],
        timestamp: created_at(),
        usage: None,
        duration_ms: None,
        model: None,
        completed_at: None,
        agent_message_id: None,
    }
}
async fn settings(conn: &DatabaseConnection, url: &str) {
    set_system_title_model_settings_core(
        conn,
        SystemTitleModelSettingsUpdate {
            enabled: true,
            base_url: url.into(),
            model: "saved-model".into(),
            api_key: None,
            clear_api_key: false,
            request_params: vec![],
        },
    )
    .await
    .unwrap();
}
async fn wait_for_requests(server: &MockServer, count: usize) {
    tokio::time::timeout(Duration::from_secs(5), async {
        while server.requests.lock().unwrap().len() < count {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
}
async fn wait_until_idle(id: i32) {
    tokio::time::timeout(Duration::from_secs(5), async {
        while refining_ids().lock().unwrap().contains(&id) {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
}

// One sequential DB-backed scenario avoids process-global IDs overlapping
// across independent in-memory databases.
#[tokio::test]
async fn recovery_uses_original_context_and_preserves_locked_titles() {
    let db = fresh_in_memory_db().await;
    let folder = seed_folder(&db, "/tmp/title-recovery-test").await;
    let id = seed_conversation(&db, folder, AgentType::Codex).await;
    let emitter = EventEmitter::test_web_only(Arc::new(WebEventBroadcaster::new()));
    let server = mock(
        vec![reply("0903/修复/顶部栏闪烁")],
        Duration::from_millis(60),
    )
    .await;
    settings(&db.conn, &server.url).await;
    conversation_service::refresh_auto_title(&db.conn, id, "麦克顶部栏更新后闪烁".into())
        .await
        .unwrap();
    let summary = conversation_service::get_by_id(&db.conn, id).await.unwrap();
    let turns = vec![
        turn(TurnRole::User, "FIRST 顶部栏闪烁 password: top-secret"),
        turn(TurnRole::User, "LATER 改变主题"),
    ];
    recover_auto_title(&db.conn, &emitter, &summary, &turns).await;
    recover_auto_title(&db.conn, &emitter, &summary, &turns).await;
    wait_until_idle(id).await;
    let saved = conversation_service::get_by_id(&db.conn, id).await.unwrap();
    assert!(saved.title_locked);
    assert_eq!(
        saved.title.unwrap(),
        format!(
            "{}｜修复｜顶部栏闪烁",
            created_date_mmdd(summary.created_at)
        )
    );
    assert_eq!(saved.updated_at, summary.updated_at);
    let requests = server.requests.lock().unwrap().clone();
    assert_eq!(requests.len(), 1);
    let prompt = requests[0]["messages"][0]["content"].as_str().unwrap();
    assert!(prompt.contains("FIRST"));
    assert!(!prompt.contains("LATER"));
    assert!(!prompt.contains("top-secret"));

    let id = seed_conversation(&db, folder, AgentType::Codex).await;
    let summary = conversation_service::get_by_id(&db.conn, id).await.unwrap();
    recover_auto_title(&db.conn, &emitter, &summary, &turns).await;
    wait_for_requests(&server, 2).await;
    conversation_service::update_title(&db.conn, id, "我的手动名称".into())
        .await
        .unwrap();
    wait_until_idle(id).await;
    let saved = conversation_service::get_by_id(&db.conn, id).await.unwrap();
    assert_eq!(saved.title.as_deref(), Some("我的手动名称"));
    recover_auto_title(&db.conn, &emitter, &saved, &turns).await;
    assert_eq!(server.requests.lock().unwrap().len(), 2);

    fallback_stays_unlocked_and_cooldown_prevents_request_storms(&db, folder, &emitter).await;
}

async fn fallback_stays_unlocked_and_cooldown_prevents_request_storms(
    db: &crate::db::AppDatabase,
    folder: i32,
    emitter: &EventEmitter,
) {
    let server = mock(vec![reply("数字一")], Duration::ZERO).await;
    settings(&db.conn, &server.url).await;
    let id = seed_conversation(db, folder, AgentType::Codex).await;
    conversation_service::refresh_auto_title(&db.conn, id, "数字一".into())
        .await
        .unwrap();
    let summary = conversation_service::get_by_id(&db.conn, id).await.unwrap();
    let turns = [turn(TurnRole::User, "1")];
    recover_auto_title(&db.conn, emitter, &summary, &turns).await;
    wait_until_idle(id).await;
    let saved = conversation_service::get_by_id(&db.conn, id).await.unwrap();
    assert!(!saved.title_locked);
    assert_eq!(saved.title.as_deref(), Some("数字一"));
    recover_auto_title(&db.conn, emitter, &saved, &turns).await;
    assert_eq!(server.requests.lock().unwrap().len(), 1);
    refine_attempts()
        .lock()
        .unwrap()
        .insert(id, Instant::now() - TITLE_RECOVERY_COOLDOWN);
    recover_auto_title(&db.conn, emitter, &saved, &turns).await;
    wait_until_idle(id).await;
    assert_eq!(server.requests.lock().unwrap().len(), 2);

    let mut no_text = turn(TurnRole::User, "");
    no_text.blocks.clear();
    assert!(original_title_seed(&[no_text, turn(TurnRole::User, "later")]).is_none());
}

#[tokio::test]
async fn manual_refresh_replaces_locked_title_without_unlocking_or_changing_settings() {
    use crate::commands::system_settings::SYSTEM_TITLE_MODEL_SETTINGS_KEY;
    use crate::db::service::app_metadata_service;
    let db = fresh_in_memory_db().await;
    let folder = seed_folder(&db, "/tmp/manual-title-test").await;
    let id = seed_conversation(&db, folder, AgentType::Codex).await;
    conversation_service::update_title(&db.conn, id, "已锁定的旧标题".into())
        .await
        .unwrap();
    let expected = conversation_service::get_by_id(&db.conn, id).await.unwrap();
    let server = mock(vec![reply("0907/修复/顶部栏闪烁")], Duration::ZERO).await;
    settings(&db.conn, &server.url).await;
    let before = app_metadata_service::get_value(&db.conn, SYSTEM_TITLE_MODEL_SETTINGS_KEY)
        .await
        .unwrap();
    let turns = [turn(TurnRole::User, "顶部栏闪烁")];
    let title = generate_manual_title(&db.conn, &expected, &turns)
        .await
        .unwrap();
    assert!(
        conversation_service::get_by_id(&db.conn, id)
            .await
            .unwrap()
            .title_locked
    );
    assert!(conversation_service::commit_manual_refreshed_title(
        &db.conn,
        &expected,
        title.clone()
    )
    .await
    .unwrap());
    let saved = conversation_service::get_by_id(&db.conn, id).await.unwrap();
    assert_eq!(saved.title.as_deref(), Some(title.as_str()));
    assert!(saved.title_locked);
    assert_eq!(saved.updated_at, expected.updated_at);
    assert_eq!(
        app_metadata_service::get_value(&db.conn, SYSTEM_TITLE_MODEL_SETTINGS_KEY)
            .await
            .unwrap(),
        before
    );

    conversation_service::update_title(&db.conn, id, "请求期间重新命名".into())
        .await
        .unwrap();
    assert!(
        !conversation_service::commit_manual_refreshed_title(&db.conn, &saved, title)
            .await
            .unwrap()
    );
    assert_eq!(
        conversation_service::get_by_id(&db.conn, id)
            .await
            .unwrap()
            .title
            .as_deref(),
        Some("请求期间重新命名")
    );

    let current = conversation_service::get_by_id(&db.conn, id).await.unwrap();
    assert!(generate_manual_title(&db.conn, &current, &[])
        .await
        .is_err());
    let failed = mock(
        vec![(
            StatusCode::UNAUTHORIZED,
            json!({"error":{"message":"bad key"}}),
        )],
        Duration::ZERO,
    )
    .await;
    settings(&db.conn, &failed.url).await;
    assert!(generate_manual_title(&db.conn, &current, &turns)
        .await
        .is_err());
    let after = conversation_service::get_by_id(&db.conn, id).await.unwrap();
    assert_eq!(after.title, current.title);
    assert!(after.title_locked);
}
