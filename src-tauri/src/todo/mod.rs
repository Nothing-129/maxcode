//! Human-owned personal and team todos. Independent from AI work_task.
//! A remote membership can access only its host team through two capability
//! endpoints. Instance tokens and remote membership tokens never reach the UI.

use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use chrono::Utc;
use sea_orm::{
    ConnectionTrait, DatabaseConnection, DbBackend, QueryResult, Statement, TransactionTrait, Value,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::app_error::AppCommandError;
use crate::commands::conversation_share::{
    self, ConversationShareOptions, SharedConversationSnapshot,
};

const PERSONAL: &str = "personal";
const MAX_SHARE_BYTES: usize = 24 * 1024 * 1024;
const TODO_ATTACHMENT_MAX_BYTES: usize = 100 * 1024 * 1024;
pub(crate) const TODO_REQUEST_MAX_BYTES: usize = 200 * 1024 * 1024;
// Team responses contain multiple todos, independently of conversation snapshots.
const TODO_RESPONSE_MAX_BYTES: usize = 512 * 1024 * 1024;

pub mod conversation_groups;
pub mod conversation_sources;
pub mod storage;

#[derive(Clone, Serialize, Deserialize)]
pub struct TodoMember {
    pub id: String,
    pub name: String,
    pub avatar: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct TodoTeam {
    pub id: String,
    pub name: String,
    pub url: Option<String>,
    pub is_local: bool,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct TodoItem {
    pub id: String,
    pub title: String,
    pub content: String,
    pub status: String,
    pub assignee_id: Option<String>,
    pub creator_id: String,
    pub revision: i64,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    pub source_url: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct TodoCompletedPagination {
    pub page: u64,
    pub page_size: u64,
    pub total: u64,
    pub search: String,
    #[serde(default)]
    pub filter: String,
    #[serde(default)]
    pub today: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct TodoState {
    pub mode: String,
    pub active_team_id: Option<String>,
    pub teams: Vec<TodoTeam>,
    pub self_id: Option<String>,
    pub members: Vec<TodoMember>,
    pub todos: Vec<TodoItem>,
    pub completed_pagination: TodoCompletedPagination,
    pub team_code: Option<String>,
    pub public_url: Option<String>,
    #[serde(default)]
    pub connection_error: Option<String>,
}
#[derive(Clone, Default, Deserialize, Serialize)]
pub struct TodoRequest {
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minio_config: Option<storage::MinioConfig>,
    #[serde(default)]
    pub completed_page: Option<u64>,
    #[serde(default)]
    pub completed_page_size: Option<u64>,
    #[serde(default)]
    pub completed_search: Option<String>,
    #[serde(default)]
    pub completed_filter: Option<String>,
    #[serde(default)]
    pub today: Option<String>,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub operation_id: Option<String>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub team_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub member_name: Option<String>,
    #[serde(default)]
    pub avatar: Option<String>,
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub assignee_id: Option<String>,
    #[serde(default)]
    pub revision: Option<i64>,
    #[serde(default)]
    pub conversation_id: Option<i32>,
    #[serde(default)]
    pub share_options: ConversationShareOptions,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<SharedConversationSnapshot>,
}
#[derive(Deserialize, Serialize)]
pub struct TeamMemberRequest {
    pub token: String,
    #[serde(flatten)]
    pub request: TodoRequest,
}
#[derive(Deserialize, Serialize)]
pub struct TeamJoinRequest {
    pub team_id: String,
    pub invite: String,
    pub member_name: String,
    pub avatar: String,
    pub join_key: String,
}
#[derive(Deserialize, Serialize)]
pub struct TeamJoinResult {
    pub team_id: String,
    pub name: String,
    pub member_id: String,
    pub member_token: String,
}
#[derive(Deserialize, Serialize)]
struct InviteCode {
    url: String,
    team_id: String,
    invite: String,
}
struct TeamRecord {
    team: TodoTeam,
    self_id: String,
    member_token: String,
    invite: Option<String>,
}

fn error_db(err: sea_orm::DbErr) -> AppCommandError {
    AppCommandError::database_error("Todo database operation failed").with_detail(err.to_string())
}
fn sql(text: &str, values: Vec<Value>) -> Statement {
    Statement::from_sql_and_values(DbBackend::Sqlite, text, values)
}
async fn rows<C: ConnectionTrait>(
    conn: &C,
    text: &str,
    values: Vec<Value>,
) -> Result<Vec<QueryResult>, AppCommandError> {
    conn.query_all(sql(text, values)).await.map_err(error_db)
}
async fn execute<C: ConnectionTrait>(
    conn: &C,
    text: &str,
    values: Vec<Value>,
) -> Result<u64, AppCommandError> {
    conn.execute(sql(text, values))
        .await
        .map(|r| r.rows_affected())
        .map_err(error_db)
}
fn field<T: sea_orm::TryGetable>(row: &QueryResult, name: &str) -> Result<T, AppCommandError> {
    row.try_get("", name).map_err(error_db)
}
fn todo_item(row: &QueryResult) -> Result<TodoItem, AppCommandError> {
    Ok(TodoItem {
        id: field(row, "id")?,
        title: field(row, "title")?,
        content: field(row, "content")?,
        status: field(row, "status")?,
        assignee_id: field(row, "assignee_id")?,
        creator_id: field(row, "creator_id")?,
        revision: field(row, "revision")?,
        due_date: field(row, "due_date")?,
        priority: field(row, "priority")?,
        source_url: field(row, "source_url")?,
        created_at: field(row, "created_at")?,
        updated_at: field(row, "updated_at")?,
    })
}
fn valid_due_date(value: &str) -> bool {
    value.len() == 10
        && chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
            .is_ok_and(|date| date.format("%Y-%m-%d").to_string() == value)
}
fn validate_schedule(request: &TodoRequest) -> Result<(), AppCommandError> {
    if request
        .due_date
        .as_deref()
        .is_some_and(|value| !valid_due_date(value))
    {
        return Err(AppCommandError::invalid_input("Invalid due date"));
    }
    if request
        .priority
        .as_deref()
        .is_some_and(|value| !matches!(value, "low" | "normal" | "high" | "urgent"))
    {
        return Err(AppCommandError::invalid_input("Invalid priority"));
    }
    Ok(())
}
fn new_id() -> String {
    Uuid::new_v4().simple().to_string()
}
fn operation_id(request: &TodoRequest) -> Result<Option<String>, AppCommandError> {
    request
        .operation_id
        .as_deref()
        .map(|id| {
            Uuid::parse_str(id)
                .map(|id| id.simple().to_string())
                .map_err(|_| AppCommandError::invalid_input("Invalid operation id"))
        })
        .transpose()
}
fn requested_completed_pagination(request: &TodoRequest) -> TodoCompletedPagination {
    TodoCompletedPagination {
        page: request.completed_page.unwrap_or(1).max(1),
        page_size: request.completed_page_size.unwrap_or(20).clamp(1, 100),
        total: 0,
        filter: request
            .completed_filter
            .clone()
            .unwrap_or_else(|| "all".into()),
        today: request
            .today
            .as_deref()
            .filter(|date| valid_due_date(date))
            .map(str::to_owned)
            .unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string()),
        search: request
            .completed_search
            .as_deref()
            .unwrap_or_default()
            .trim()
            .to_string(),
    }
}
fn completed_search_pattern(search: &str) -> String {
    // Match the existing title/content/assignee substring search. User text
    // containing SQL LIKE wildcards must retain its literal meaning.
    format!(
        "%{}%",
        search
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    )
}
fn required(value: Option<&str>, label: &str, max: usize) -> Result<String, AppCommandError> {
    let value = value.unwrap_or_default().trim();
    if value.is_empty() || value.chars().count() > max {
        return Err(AppCommandError::invalid_input(format!(
            "Enter valid {label}"
        )));
    }
    Ok(value.to_string())
}
fn required_todo_content(value: Option<&str>) -> Result<String, AppCommandError> {
    let value = value.unwrap_or_default();
    // Old clients must not reintroduce the removed database attachment format.
    if value.contains("<!-- maxcode-todo-attachments:v1 -->") {
        return Err(AppCommandError::invalid_input(
            "Embedded todo attachments are no longer supported",
        ));
    }
    required(Some(value), "todo content", 250_000)
}

fn todo_title(request: &TodoRequest, content: &str) -> Result<String, AppCommandError> {
    if !request
        .title
        .as_deref()
        .unwrap_or_default()
        .trim()
        .is_empty()
    {
        return required(request.title.as_deref(), "todo title", 200);
    }
    let redacted = crate::session_title::redact_title_input(content);
    Ok(redacted
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("Todo")
        .chars()
        .take(28)
        .collect())
}
fn validate_profile(name: &str, avatar: &str) -> Result<(), AppCommandError> {
    required(Some(name), "member name", 80)?;
    if avatar.len() > 512 * 1024 {
        return Err(AppCommandError::invalid_input(
            "Avatar must be smaller than 512 KB",
        ));
    }
    let (prefix, data) = avatar
        .split_once(',')
        .ok_or_else(|| AppCommandError::invalid_input("Upload an avatar image"))?;
    let format = match prefix {
        "data:image/png;base64" => image::ImageFormat::Png,
        "data:image/jpeg;base64" => image::ImageFormat::Jpeg,
        "data:image/webp;base64" => image::ImageFormat::WebP,
        "data:image/gif;base64" => image::ImageFormat::Gif,
        _ => {
            return Err(AppCommandError::invalid_input(
                "Use a PNG, JPEG, WebP or GIF avatar",
            ))
        }
    };
    let bytes = STANDARD
        .decode(data)
        .map_err(|_| AppCommandError::invalid_input("Invalid avatar image"))?;
    if image::guess_format(&bytes).ok() != Some(format) {
        return Err(AppCommandError::invalid_input("Invalid avatar image"));
    }
    let (width, height) = image::ImageReader::with_format(std::io::Cursor::new(&bytes), format)
        .into_dimensions()
        .map_err(|_| AppCommandError::invalid_input("Invalid avatar image"))?;
    if width == 0 || height == 0 || width > 2048 || height > 2048 {
        return Err(AppCommandError::invalid_input(
            "Avatar dimensions must be at most 2048 pixels",
        ));
    }
    image::load_from_memory_with_format(&bytes, format)
        .map_err(|_| AppCommandError::invalid_input("Invalid avatar image"))?;
    Ok(())
}
fn parse_code(raw: &str) -> Result<InviteCode, AppCommandError> {
    let invalid = || AppCommandError::invalid_input("Invalid team code");
    if raw.len() > 8192 {
        return Err(invalid());
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(
            raw.trim()
                .strip_prefix("maxcode-team:")
                .ok_or_else(invalid)?,
        )
        .map_err(|_| invalid())?;
    let code: InviteCode = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    let url = reqwest::Url::parse(&code.url).map_err(|_| invalid())?;
    if !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
        || code.team_id.len() != 32
        || code.invite.len() != 32
        || !code
            .team_id
            .bytes()
            .chain(code.invite.bytes())
            .all(|b| b.is_ascii_hexdigit())
    {
        return Err(invalid());
    }
    Ok(InviteCode {
        url: code.url.trim_end_matches('/').to_string(),
        ..code
    })
}
fn team_record(row: &QueryResult) -> Result<TeamRecord, AppCommandError> {
    Ok(TeamRecord {
        team: TodoTeam {
            id: field(row, "id")?,
            name: field(row, "name")?,
            url: field(row, "url")?,
            is_local: field::<i64>(row, "is_local")? != 0,
        },
        self_id: field(row, "self_id")?,
        member_token: field(row, "member_token")?,
        invite: field(row, "invite_token")?,
    })
}
async fn teams(
    conn: &DatabaseConnection,
    public_url: &Option<String>,
) -> Result<Vec<TeamRecord>, AppCommandError> {
    rows(
        conn,
        "SELECT * FROM maxcode_todo_team ORDER BY rowid",
        vec![],
    )
    .await?
    .iter()
    .map(|row| {
        let mut result = team_record(row)?;
        if result.team.is_local {
            result.team.url = public_url.clone();
        }
        Ok(result)
    })
    .collect()
}
async fn public_url(conn: &DatabaseConnection) -> Result<Option<String>, AppCommandError> {
    Ok(crate::web::load_web_service_config(conn)
        .await?
        .public_share_url)
}

/// A hosted team stays available while the app runs, including when the last
/// selected todo scope was personal or another team's remote workspace.
/// Used only at startup; periodic todo polling must respect a manual Stop.
pub async fn hosted_team_service_required(
    conn: &DatabaseConnection,
    public_url: Option<&str>,
) -> Result<bool, AppCommandError> {
    if public_url.is_none_or(|url| url.trim().is_empty()) {
        return Ok(false);
    }
    Ok(!rows(
        conn,
        "SELECT id FROM maxcode_todo_team WHERE is_local=1 LIMIT 1",
        vec![],
    )
    .await?
    .is_empty())
}
async fn selected(conn: &DatabaseConnection) -> Result<(String, Option<String>), AppCommandError> {
    let result = rows(
        conn,
        "SELECT mode, active_team_id FROM maxcode_todo_preferences WHERE id = 1",
        vec![],
    )
    .await?;
    Ok((
        field(&result[0], "mode")?,
        field(&result[0], "active_team_id")?,
    ))
}
async fn select_team(conn: &DatabaseConnection, id: &str) -> Result<(), AppCommandError> {
    execute(
        conn,
        "UPDATE maxcode_todo_preferences SET mode = 'team', active_team_id = ? WHERE id = 1",
        vec![id.into()],
    )
    .await?;
    Ok(())
}
async fn scope_state(
    conn: &DatabaseConnection,
    scope: &str,
    self_id: &str,
    team: Option<&TeamRecord>,
    url: Option<String>,
    mut completed_pagination: TodoCompletedPagination,
) -> Result<TodoState, AppCommandError> {
    // Keep the count and the selected completed page in one database snapshot.
    // Each caller chooses its own page; it is never saved as a scope preference.
    let txn = conn.begin().await.map_err(error_db)?;
    let members = if scope == PERSONAL {
        vec![TodoMember {
            id: PERSONAL.to_string(),
            name: "我".to_string(),
            avatar: String::new(),
        }]
    } else {
        rows(
            &txn,
            "SELECT id, name, avatar FROM maxcode_todo_member WHERE team_id = ? ORDER BY rowid",
            vec![scope.into()],
        )
        .await?
        .iter()
        .map(|row| {
            Ok(TodoMember {
                id: field(row, "id")?,
                name: field(row, "name")?,
                avatar: field(row, "avatar")?,
            })
        })
        .collect::<Result<Vec<_>, AppCommandError>>()?
    };
    let (completed_filter, mut completed_values) = if completed_pagination.search.is_empty() {
        (
            "FROM maxcode_todo_item t WHERE t.scope_id=? AND t.status='completed'",
            vec![scope.into()],
        )
    } else {
        (
            "FROM maxcode_todo_item t LEFT JOIN maxcode_todo_member m ON m.id=t.assignee_id AND m.team_id=t.scope_id WHERE t.scope_id=? AND t.status='completed' AND (t.title || char(10) || t.content || char(10) || COALESCE(m.name, CASE WHEN t.scope_id='personal' AND t.assignee_id='personal' THEN '我' ELSE '' END)) LIKE ? ESCAPE '\\'",
            vec![scope.into(), completed_search_pattern(&completed_pagination.search).into()],
        )
    };
    let mut completed_filter = completed_filter.to_string();
    match completed_pagination.filter.as_str() {
        "today" => {
            completed_filter.push_str(" AND t.due_date=?");
            completed_values.push(completed_pagination.today.clone().into());
        }
        "overdue" => completed_filter.push_str(" AND 0=1"),
        "urgent" => completed_filter.push_str(" AND t.priority='urgent'"),
        _ => completed_pagination.filter = "all".into(),
    }
    let count = rows(
        &txn,
        &format!("SELECT COUNT(*) AS total {completed_filter}"),
        completed_values.clone(),
    )
    .await?;
    completed_pagination.total = field::<i64>(&count[0], "total")? as u64;
    let last_page =
        completed_pagination.total.saturating_sub(1) / completed_pagination.page_size + 1;
    completed_pagination.page = completed_pagination.page.min(last_page);
    let mut todo_rows = rows(
        &txn,
        "SELECT * FROM maxcode_todo_item WHERE scope_id = ? AND status != 'completed' ORDER BY created_at DESC, id",
        vec![scope.into()],
    )
    .await?;
    let offset = (completed_pagination.page - 1) * completed_pagination.page_size;
    completed_values.extend([
        (completed_pagination.page_size as i64).into(),
        (offset as i64).into(),
    ]);
    todo_rows.extend(
        rows(
            &txn,
            &format!("SELECT t.* {completed_filter} ORDER BY t.updated_at DESC, t.id DESC LIMIT ? OFFSET ?"),
            completed_values,
        )
        .await?,
    );
    let todos = todo_rows
        .iter()
        .map(todo_item)
        .collect::<Result<Vec<_>, AppCommandError>>()?;
    txn.commit().await.map_err(error_db)?;
    let team_code = team.and_then(|team| {
        team.invite.as_ref().and_then(|invite| {
            url.as_ref().map(|url| {
                let code = InviteCode {
                    url: url.clone(),
                    team_id: team.team.id.clone(),
                    invite: invite.clone(),
                };
                format!(
                    "maxcode-team:{}",
                    URL_SAFE_NO_PAD.encode(serde_json::to_vec(&code).expect("serialize invite"))
                )
            })
        })
    });
    Ok(TodoState {
        mode: if scope == PERSONAL {
            "personal"
        } else {
            "team"
        }
        .to_string(),
        active_team_id: if scope == PERSONAL {
            None
        } else {
            Some(scope.to_string())
        },
        teams: team
            .map(|t| {
                vec![TodoTeam {
                    url: url.clone(),
                    ..t.team.clone()
                }]
            })
            .unwrap_or_default(),
        self_id: Some(self_id.to_string()),
        members,
        todos,
        completed_pagination,
        team_code,
        public_url: url,
        connection_error: None,
    })
}
fn empty_state(
    mode: String,
    active: Option<String>,
    teams: Vec<TodoTeam>,
    url: Option<String>,
    completed_pagination: TodoCompletedPagination,
) -> TodoState {
    TodoState {
        mode,
        active_team_id: active,
        teams,
        self_id: None,
        members: vec![],
        todos: vec![],
        completed_pagination,
        team_code: None,
        public_url: url,
        connection_error: None,
    }
}
async fn remote_json<T: serde::de::DeserializeOwned>(
    url: &str,
    endpoint: &str,
    request: &impl Serialize,
) -> Result<T, AppCommandError> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|_| AppCommandError::network("Cannot connect to team"))?;
    let mut response = client
        .post(format!("{url}/api/{endpoint}"))
        .json(request)
        .send()
        .await
        .map_err(|_| {
            AppCommandError::network(
                "Team is offline or unreachable; its creator must keep MaxCode running",
            )
        })?;
    let status = response.status();
    let mut data = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| AppCommandError::network("Team response was interrupted"))?
    {
        if data.len() + chunk.len() > TODO_RESPONSE_MAX_BYTES {
            return Err(AppCommandError::network("Team response is too large"));
        }
        data.extend_from_slice(&chunk);
    }
    if !status.is_success() {
        return Err(serde_json::from_slice::<AppCommandError>(&data)
            .unwrap_or_else(|_| AppCommandError::network("Team request failed")));
    }
    serde_json::from_slice(&data).map_err(|_| AppCommandError::network("Invalid team response"))
}

/// Authenticated local entry point. All remote calls use credentials read here.
pub async fn call(
    conn: &DatabaseConnection,
    mut request: TodoRequest,
) -> Result<TodoState, AppCommandError> {
    let completed_pagination = requested_completed_pagination(&request);
    let url = public_url(conn).await?;
    if request.action == "set_mode" {
        let mode = required(request.mode.as_deref(), "todo mode", 16)?;
        if !matches!(mode.as_str(), "personal" | "team") {
            return Err(AppCommandError::invalid_input("Invalid todo mode"));
        }
        if let Some(id) = request.team_id.as_deref() {
            if !teams(conn, &url).await?.iter().any(|t| t.team.id == id) {
                return Err(AppCommandError::not_found("Team not found"));
            }
        }
        execute(conn,"UPDATE maxcode_todo_preferences SET mode = ?, active_team_id = COALESCE(?, active_team_id) WHERE id = 1",vec![mode.into(),request.team_id.clone().into()]).await?;
        request.action = "state".to_string();
    } else if request.action == "create_team" {
        create_team(conn, &request).await?;
        request.action = "state".to_string();
    } else if request.action == "join_team" {
        join_team(conn, &request, &url).await?;
        request.action = "state".to_string();
    }
    request.minio_config = None;
    let (mode, active) = selected(conn).await?;
    let all_teams = teams(conn, &url).await?;
    let displayed = all_teams.iter().map(|team| team.team.clone()).collect();
    let active_team = all_teams
        .iter()
        .find(|team| Some(&team.team.id) == active.as_ref());
    if mode == "team" && active_team.is_none() {
        return Ok(empty_state(
            mode,
            active,
            displayed,
            url,
            completed_pagination,
        ));
    }
    if matches!(request.action.as_str(), "create" | "update") {
        let content = required_todo_content(request.content.as_deref())?;
        if request
            .title
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
        {
            request.title = Some(crate::session_title::generate_todo_title(conn, &content).await);
        }
    }
    if request.action == "create" {
        // Ignore externally supplied snapshots at this boundary. Only a locally
        // authorized conversation lookup may produce the uploaded transcript.
        request.snapshot = match request.conversation_id.take() {
            Some(id) => Some(
                conversation_share::build_conversation_share_snapshot(
                    conn,
                    id,
                    request.share_options.clone(),
                )
                .await?,
            ),
            None => None,
        };
    } else {
        request.snapshot = None;
        request.conversation_id = None;
    }
    let read = request.action == "state";
    let mut result = if mode == "personal" {
        mutate(conn, PERSONAL, PERSONAL, &request, &url).await?;
        scope_state(
            conn,
            PERSONAL,
            PERSONAL,
            None,
            url.clone(),
            completed_pagination,
        )
        .await?
    } else {
        let team = active_team.expect("checked active team");
        if team.team.is_local {
            mutate(conn, &team.team.id, &team.self_id, &request, &url).await?;
            scope_state(
                conn,
                &team.team.id,
                &team.self_id,
                Some(team),
                url.clone(),
                completed_pagination,
            )
            .await?
        } else {
            let remote_url =
                team.team.url.as_deref().ok_or_else(|| {
                    AppCommandError::configuration_missing("Team address missing")
                })?;
            match remote_json::<TodoState>(
                remote_url,
                "team_todo_call",
                &TeamMemberRequest {
                    token: team.member_token.clone(),
                    request,
                },
            )
            .await
            {
                Ok(state) => state,
                Err(error) if read => {
                    let mut state = empty_state(
                        mode.clone(),
                        active.clone(),
                        vec![],
                        Some(remote_url.to_string()),
                        completed_pagination,
                    );
                    state.self_id = Some(team.self_id.clone());
                    state.connection_error = Some(error.message);
                    state
                }
                Err(error) => return Err(error),
            }
        }
    };
    // Remote responses never decide the local selection or expose host teams.
    result.mode = mode;
    result.active_team_id = active;
    result.teams = displayed;
    if result.mode == "personal" {
        result.active_team_id = None;
    }
    Ok(result)
}
async fn create_team(
    conn: &DatabaseConnection,
    request: &TodoRequest,
) -> Result<(), AppCommandError> {
    if let Some(config) = &request.minio_config {
        storage::validate_config(config)?;
        if config.secret_key.is_empty() {
            return Err(AppCommandError::invalid_input("Enter the MinIO secret key"));
        }
    }
    let name = required(request.name.as_deref(), "team name", 80)?;
    let member_name = required(request.member_name.as_deref(), "member name", 80)?;
    let avatar = request.avatar.as_deref().unwrap_or_default();
    validate_profile(&member_name, avatar)?;
    let id = new_id();
    let self_id = new_id();
    let token = new_id();
    let invite = new_id();
    let txn = conn.begin().await.map_err(error_db)?;
    let op = operation_id(request)?;
    let inserted = execute(&txn,"INSERT INTO maxcode_todo_team (id,name,is_local,self_id,member_token,invite_token,creation_operation_id) VALUES (?,?,1,?,?,?,?) ON CONFLICT(creation_operation_id) DO NOTHING",vec![id.clone().into(),name.into(),self_id.clone().into(),token.clone().into(),invite.into(),op.clone().into()]).await?;
    if inserted == 0 {
        txn.rollback().await.map_err(error_db)?;
        let row = rows(
            conn,
            "SELECT id FROM maxcode_todo_team WHERE creation_operation_id=?",
            vec![op.into()],
        )
        .await?;
        let existing_id = field::<String>(&row[0], "id")?;
        if let Some(config) = &request.minio_config {
            storage::save_config(&existing_id, config.clone())?;
        }
        select_team(conn, &existing_id).await?;
        return Ok(());
    }
    execute(
        &txn,
        "INSERT INTO maxcode_todo_member (id,team_id,name,avatar,token) VALUES (?,?,?,?,?)",
        vec![
            self_id.into(),
            id.clone().into(),
            member_name.into(),
            avatar.into(),
            token.into(),
        ],
    )
    .await?;
    execute(
        &txn,
        "UPDATE maxcode_todo_preferences SET mode='team', active_team_id=? WHERE id=1",
        vec![id.clone().into()],
    )
    .await?;
    txn.commit().await.map_err(error_db)?;
    if let Some(config) = &request.minio_config {
        storage::save_config(&id, config.clone())?;
    }
    Ok(())
}
async fn join_team(
    conn: &DatabaseConnection,
    request: &TodoRequest,
    local_url: &Option<String>,
) -> Result<(), AppCommandError> {
    let code = parse_code(request.code.as_deref().unwrap_or_default())?;
    let name = required(request.member_name.as_deref(), "member name", 80)?;
    let avatar = request.avatar.as_deref().unwrap_or_default();
    validate_profile(&name, avatar)?;
    // Joining an already-known team keeps that member's stable identity.
    if let Some(existing) = teams(conn, local_url)
        .await?
        .into_iter()
        .find(|team| team.team.id == code.team_id)
    {
        // Pasted invites cannot redirect a saved membership credential to a
        // different host that merely advertises the same team id.
        if !existing.team.is_local && existing.team.url.as_deref() != Some(code.url.as_str()) {
            return Err(AppCommandError::invalid_input(
                "Team address differs from the saved connection",
            ));
        }
        let profile = TodoRequest {
            action: "profile".to_string(),
            member_name: Some(name),
            avatar: Some(avatar.to_string()),
            ..Default::default()
        };
        if existing.team.is_local {
            mutate(
                conn,
                &existing.team.id,
                &existing.self_id,
                &profile,
                local_url,
            )
            .await?;
        } else {
            let _: TodoState = remote_json(
                &code.url,
                "team_todo_call",
                &TeamMemberRequest {
                    token: existing.member_token,
                    request: profile,
                },
            )
            .await?;
        }
        select_team(conn, &code.team_id).await?;
        return Ok(());
    }
    // Persist before contacting the host. The key survives response loss,
    // restarts, and reopening the join dialog.
    execute(conn,"INSERT INTO maxcode_todo_join_attempt (team_id,url,join_key) VALUES (?,?,?) ON CONFLICT(team_id,url) DO NOTHING",vec![code.team_id.clone().into(),code.url.clone().into(),new_id().into()]).await?;
    let attempts = rows(
        conn,
        "SELECT join_key FROM maxcode_todo_join_attempt WHERE team_id=? AND url=?",
        vec![code.team_id.clone().into(), code.url.clone().into()],
    )
    .await?;
    let join_key = field(&attempts[0], "join_key")?;
    let joined: TeamJoinResult = remote_json(
        &code.url,
        "team_todo_join",
        &TeamJoinRequest {
            team_id: code.team_id.clone(),
            invite: code.invite,
            member_name: name,
            avatar: avatar.to_string(),
            join_key,
        },
    )
    .await?;
    if joined.team_id != code.team_id
        || joined.member_id.len() != 32
        || joined.member_token.len() != 32
        || joined.name.trim().is_empty()
    {
        return Err(AppCommandError::network("Invalid team response"));
    }
    let txn = conn.begin().await.map_err(error_db)?;
    execute(&txn,"INSERT INTO maxcode_todo_team (id,name,url,is_local,self_id,member_token) VALUES (?,?,?,0,?,?)",vec![joined.team_id.clone().into(),joined.name.into(),code.url.into(),joined.member_id.into(),joined.member_token.into()]).await?;
    execute(
        &txn,
        "UPDATE maxcode_todo_preferences SET mode='team', active_team_id=? WHERE id=1",
        vec![joined.team_id.into()],
    )
    .await?;
    txn.commit().await.map_err(error_db)?;
    Ok(())
}

/// Public join capability: only team name and newly issued scoped credentials.
pub async fn join(
    conn: &DatabaseConnection,
    request: TeamJoinRequest,
) -> Result<TeamJoinResult, AppCommandError> {
    validate_profile(&request.member_name, &request.avatar)?;
    let join_key = Uuid::parse_str(&request.join_key)
        .map_err(|_| AppCommandError::invalid_input("Invalid join request"))?
        .simple()
        .to_string();
    let row = rows(
        conn,
        "SELECT name FROM maxcode_todo_team WHERE id=? AND invite_token=? AND is_local=1",
        vec![request.team_id.clone().into(), request.invite.into()],
    )
    .await?;
    let team = row
        .first()
        .ok_or_else(|| AppCommandError::permission_denied("Invalid team invitation"))?;
    let name = field(team, "name")?;
    let id = new_id();
    let token = new_id();
    execute(
        conn,
        "INSERT INTO maxcode_todo_member (id,team_id,name,avatar,token,join_key) VALUES (?,?,?,?,?,?) ON CONFLICT(team_id,join_key) DO UPDATE SET name=excluded.name,avatar=excluded.avatar",
        vec![
            id.clone().into(),
            request.team_id.clone().into(),
            request.member_name.trim().into(),
            request.avatar.into(),
            token.clone().into(),
            join_key.clone().into(),
        ],
    )
    .await?;
    let member = rows(
        conn,
        "SELECT id,token FROM maxcode_todo_member WHERE team_id=? AND join_key=?",
        vec![request.team_id.clone().into(), join_key.into()],
    )
    .await?;
    Ok(TeamJoinResult {
        team_id: request.team_id,
        name,
        member_id: field(&member[0], "id")?,
        member_token: field(&member[0], "token")?,
    })
}
/// Public member capability: scope is derived from token, never caller data.
pub async fn member_call(
    conn: &DatabaseConnection,
    request: TeamMemberRequest,
) -> Result<TodoState, AppCommandError> {
    if request.token.len() != 32 {
        return Err(AppCommandError::permission_denied(
            "Invalid team membership",
        ));
    }
    let row=rows(conn,"SELECT m.id AS member_id, t.* FROM maxcode_todo_member m JOIN maxcode_todo_team t ON t.id=m.team_id WHERE m.token=? AND t.is_local=1",vec![request.token.into()]).await?;
    let row = row
        .first()
        .ok_or_else(|| AppCommandError::permission_denied("Invalid team membership"))?;
    let self_id: String = field(row, "member_id")?;
    let mut team = team_record(row)?;
    let url = public_url(conn).await?;
    if request.request.conversation_id.is_some() {
        return Err(AppCommandError::invalid_input(
            "Upload a share snapshot from your local instance",
        ));
    }
    mutate(conn, &team.team.id, &self_id, &request.request, &url).await?;
    team.team.url = url.clone();
    scope_state(
        conn,
        &team.team.id,
        &self_id,
        Some(&team),
        url,
        requested_completed_pagination(&request.request),
    )
    .await
}
async fn validate_assignee<C: ConnectionTrait>(
    conn: &C,
    scope: &str,
    assignee: &Option<String>,
) -> Result<(), AppCommandError> {
    if let Some(id) = assignee {
        if scope == PERSONAL {
            if id == PERSONAL {
                return Ok(());
            }
        } else if !rows(
            conn,
            "SELECT id FROM maxcode_todo_member WHERE id=? AND team_id=?",
            vec![id.clone().into(), scope.into()],
        )
        .await?
        .is_empty()
        {
            return Ok(());
        }
        return Err(AppCommandError::invalid_input(
            "Assignee is not a member of this team",
        ));
    }
    Ok(())
}
async fn mutate(
    conn: &DatabaseConnection,
    scope: &str,
    self_id: &str,
    request: &TodoRequest,
    url: &Option<String>,
) -> Result<(), AppCommandError> {
    if request.action == "state" {
        return Ok(());
    }
    if request.action == "profile" {
        if scope == PERSONAL {
            return Err(AppCommandError::invalid_input(
                "Personal profile does not require registration",
            ));
        }
        let name = required(request.member_name.as_deref(), "member name", 80)?;
        let avatar = request.avatar.as_deref().unwrap_or_default();
        validate_profile(&name, avatar)?;
        execute(
            conn,
            "UPDATE maxcode_todo_member SET name=?, avatar=? WHERE id=? AND team_id=?",
            vec![name.into(), avatar.into(), self_id.into(), scope.into()],
        )
        .await?;
        return Ok(());
    }
    if !matches!(
        request.action.as_str(),
        "create" | "update" | "delete" | "claim" | "release" | "complete" | "reopen"
    ) {
        return Err(AppCommandError::invalid_input("Unsupported todo action"));
    }
    if matches!(request.action.as_str(), "create" | "update") {
        validate_schedule(request)?;
    }
    if matches!(request.action.as_str(), "create" | "update") {
        storage::validate_content_size(
            conn,
            scope,
            request.content.as_deref().unwrap_or_default(),
            0,
        )
        .await?;
    }
    let txn = conn.begin().await.map_err(error_db)?;
    let now = Utc::now().to_rfc3339();
    if request.action == "create" {
        let content = required_todo_content(request.content.as_deref())?;
        let title = todo_title(request, &content)?;
        validate_assignee(&txn, scope, &request.assignee_id).await?;
        let id = new_id();
        let mut source_url = None;
        if let Some(snapshot) = request.snapshot.clone() {
            let origin = match url.as_deref() {
                Some(url) => url,
                None if scope == PERSONAL => "",
                None => {
                    return Err(AppCommandError::configuration_missing(
                        "Bind a public sharing address before adding this conversation",
                    ))
                }
            };
            let snapshot = conversation_share::sanitize_shared_snapshot(snapshot);
            if snapshot.turns.is_empty() {
                return Err(AppCommandError::invalid_input(
                    "No shareable conversation content",
                ));
            }
            let data = serde_json::to_string(&snapshot)
                .map_err(|_| AppCommandError::invalid_input("Invalid conversation snapshot"))?;
            if data.len() > MAX_SHARE_BYTES {
                return Err(AppCommandError::invalid_input(
                    "Conversation snapshot is too large",
                ));
            }
            let token = new_id();
            source_url = Some(format!("{origin}/share#{token}"));
            execute(&txn,"INSERT INTO maxcode_todo_share (token,todo_id,scope_id,snapshot_json) VALUES (?,?,?,?)",vec![token.into(),id.clone().into(),scope.into(),data.into()]).await?;
        }
        let status = if request.assignee_id.is_some() {
            "claimed"
        } else {
            "unclaimed"
        };
        let inserted = execute(&txn,"INSERT INTO maxcode_todo_item (id,scope_id,title,content,status,assignee_id,creator_id,source_url,created_at,updated_at,operation_id,due_date,priority) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(scope_id,creator_id,operation_id) DO NOTHING",vec![id.into(),scope.into(),title.into(),content.into(),status.into(),request.assignee_id.clone().into(),self_id.into(),source_url.into(),now.clone().into(),now.into(),operation_id(request)?.into(),request.due_date.clone().into(),request.priority.clone().into()]).await?;
        if inserted == 0 {
            // Includes any newly prepared snapshot: replays never publish an
            // orphan share or create another task.
            txn.rollback().await.map_err(error_db)?;
            return Ok(());
        }
    } else {
        let id = required(request.id.as_deref(), "todo id", 64)?;
        let revision = request
            .revision
            .filter(|r| *r > 0)
            .ok_or_else(|| AppCommandError::invalid_input("Todo revision is required"))?;
        let updated=match request.action.as_str() {
            "update"=>{
                let content=required_todo_content(request.content.as_deref())?;
                let title=todo_title(request,&content)?;
                validate_assignee(&txn,scope,&request.assignee_id).await?;
                execute(&txn,"UPDATE maxcode_todo_item SET due_date=?,priority=?,title=?,content=?,assignee_id=?,status=CASE WHEN status='completed' THEN status WHEN ? IS NULL THEN 'unclaimed' ELSE 'claimed' END,revision=revision+1,updated_at=? WHERE id=? AND scope_id=? AND revision=?",vec![request.due_date.clone().into(),request.priority.clone().into(),title.into(),content.into(),request.assignee_id.clone().into(),request.assignee_id.clone().into(),now.into(),id.clone().into(),scope.into(),revision.into()]).await?
            },
            "delete"=>{
                let n=execute(&txn,"DELETE FROM maxcode_todo_item WHERE id=? AND scope_id=? AND revision=?",vec![id.clone().into(),scope.into(),revision.into()]).await?;
                if n==1 {execute(&txn,"DELETE FROM maxcode_todo_share WHERE todo_id=? AND scope_id=?",vec![id.clone().into(),scope.into()]).await?;}n
            },
            "claim"=>execute(&txn,"UPDATE maxcode_todo_item SET status='claimed',assignee_id=?,revision=revision+1,updated_at=? WHERE id=? AND scope_id=? AND revision=? AND status='unclaimed' AND assignee_id IS NULL",vec![self_id.into(),now.into(),id.clone().into(),scope.into(),revision.into()]).await?,
            "complete"=>execute(&txn,"UPDATE maxcode_todo_item SET status='completed',revision=revision+1,updated_at=? WHERE id=? AND scope_id=? AND revision=? AND status!='completed'",vec![now.into(),id.clone().into(),scope.into(),revision.into()]).await?,
            "release"|"reopen"=>execute(&txn,"UPDATE maxcode_todo_item SET status='unclaimed',assignee_id=NULL,revision=revision+1,updated_at=? WHERE id=? AND scope_id=? AND revision=?",vec![now.into(),id.clone().into(),scope.into(),revision.into()]).await?,
            _=>unreachable!(),
        };
        if updated != 1 {
            return Err(AppCommandError::already_exists(
                "Todo changed or was already claimed; refresh and try again",
            ));
        }
    }
    txn.commit().await.map_err(error_db)?;
    Ok(())
}
pub(crate) async fn shared_snapshot_json(
    conn: &DatabaseConnection,
    token: &str,
) -> Result<Option<String>, AppCommandError> {
    let result = rows(
        conn,
        "SELECT snapshot_json FROM maxcode_todo_share WHERE token=?",
        vec![token.into()],
    )
    .await?;
    result
        .first()
        .map(|r| field(r, "snapshot_json"))
        .transpose()
}

#[cfg(test)]
#[path = "../../../src/maxcode-contracts/team-todo.contract.rs"]
mod contract;

#[cfg(test)]
#[path = "../../../src/maxcode-contracts/todo-schedule.contract.rs"]
mod schedule_contract;

#[cfg(test)]
#[path = "../../../src/maxcode-contracts/todo-attachments.contract.rs"]
mod attachment_contract;
