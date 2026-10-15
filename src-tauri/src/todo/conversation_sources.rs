//! Explicit-scope todo selection and local conversation source links. Remote
//! capabilities receive todo IDs and todo edits, never local conversations.

use std::collections::HashMap;

use super::conversation_groups::{link_origins, normalized_id, validate_origins, TodoOrigin};
use super::*;

const MAX_DETAILS: usize = 100;

#[derive(Clone, Deserialize, Serialize)]
pub struct TodoSummary {
    pub id: String,
    pub title: String,
    pub status: String,
    pub assignee_id: Option<String>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
pub struct SearchQuery {
    pub search: Option<String>,
    pub page: Option<u64>,
    pub page_size: Option<u64>,
}

#[derive(Deserialize)]
pub struct TodoSearchRequest {
    pub scope_id: String,
    #[serde(flatten)]
    pub query: SearchQuery,
}

#[derive(Deserialize, Serialize)]
pub struct TeamTodoSearchRequest {
    pub token: String,
    #[serde(flatten)]
    pub query: SearchQuery,
}

#[derive(Deserialize, Serialize)]
pub struct TodoSearchPagination {
    pub page: u64,
    pub page_size: u64,
    pub total: u64,
    pub search: String,
}

#[derive(Deserialize, Serialize)]
pub struct TodoSearchResult {
    pub scope_id: String,
    pub scope_key: String,
    pub self_id: String,
    pub members: Vec<TodoMember>,
    pub todos: Vec<TodoSummary>,
    pub pagination: TodoSearchPagination,
}

#[derive(Clone, Default, Deserialize, Serialize)]
pub struct OriginAction {
    pub due_date: Option<String>,
    pub priority: Option<String>,
    pub action: String,
    pub title: Option<String>,
    pub content: Option<String>,
    pub assignee_id: Option<String>,
    pub revision: Option<i64>,
}

#[derive(Deserialize)]
pub struct TodoOriginCallRequest {
    pub origin: TodoOrigin,
    #[serde(flatten)]
    pub operation: OriginAction,
}

#[derive(Deserialize, Serialize)]
pub struct TeamTodoOriginCallRequest {
    pub token: String,
    pub todo_id: String,
    #[serde(flatten)]
    pub operation: OriginAction,
}

#[derive(Deserialize, Serialize)]
pub struct TodoOriginResult {
    pub origin: TodoOrigin,
    pub scope_key: String,
    pub scope_name: String,
    pub mode: String,
    pub self_id: String,
    pub members: Vec<TodoMember>,
    pub todo: Option<TodoItem>,
}

#[derive(Deserialize)]
pub struct TodoConversationLinkRequest {
    pub conversation_id: i32,
    pub origin: TodoOrigin,
    pub action: String,
}

#[derive(Deserialize)]
pub struct TodoConversationSourcesRequest {
    pub conversation_id: i32,
}

#[derive(Serialize)]
pub struct TodoConversationSource {
    pub origin: TodoOrigin,
    pub scope_key: String,
    pub scope_name: String,
    pub mode: String,
    pub todo: Option<TodoSummary>,
    pub assignee: Option<TodoMember>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_error: Option<String>,
}

#[derive(Serialize)]
pub struct TodoConversationSources {
    pub conversation_id: i32,
    pub sources: Vec<TodoConversationSource>,
}

#[derive(Deserialize, Serialize)]
pub struct TeamTodoDetailsRequest {
    pub token: String,
    pub todo_ids: Vec<String>,
}

#[derive(Deserialize, Serialize)]
pub struct TodoDetailsResult {
    pub todos: Vec<TodoSummary>,
    pub members: Vec<TodoMember>,
}

struct Scope {
    id: String,
    key: String,
    name: String,
    mode: String,
    self_id: String,
    team: Option<TeamRecord>,
}

impl Scope {
    fn personal() -> Self {
        Self {
            id: PERSONAL.to_string(),
            key: PERSONAL.to_string(),
            name: "个人待办".to_string(),
            mode: "personal".to_string(),
            self_id: PERSONAL.to_string(),
            team: None,
        }
    }
    fn team(record: TeamRecord, self_id: String) -> Self {
        Self {
            id: record.team.id.clone(),
            key: format!("team:{}", record.team.id),
            name: record.team.name.clone(),
            mode: "team".to_string(),
            self_id,
            team: Some(record),
        }
    }
    fn remote(&self) -> Option<&TeamRecord> {
        self.team.as_ref().filter(|team| !team.team.is_local)
    }
}

async fn local_scope(conn: &DatabaseConnection, scope: &str) -> Result<Scope, AppCommandError> {
    if scope == PERSONAL {
        return Ok(Scope::personal());
    }
    let id = normalized_id(scope)?;
    let found = rows(
        conn,
        "SELECT * FROM maxcode_todo_team WHERE id=?",
        vec![id.into()],
    )
    .await?;
    let team = team_record(
        found
            .first()
            .ok_or_else(|| AppCommandError::not_found("Team not found"))?,
    )?;
    let self_id = team.self_id.clone();
    Ok(Scope::team(team, self_id))
}

async fn member_scope(conn: &DatabaseConnection, token: String) -> Result<Scope, AppCommandError> {
    if token.len() != 32 {
        return Err(AppCommandError::permission_denied(
            "Invalid team membership",
        ));
    }
    let found = rows(conn, "SELECT m.id AS member_id,t.* FROM maxcode_todo_member m JOIN maxcode_todo_team t ON t.id=m.team_id WHERE m.token=? AND t.is_local=1", vec![token.into()]).await?;
    let row = found
        .first()
        .ok_or_else(|| AppCommandError::permission_denied("Invalid team membership"))?;
    Ok(Scope::team(team_record(row)?, field(row, "member_id")?))
}

async fn members<C: ConnectionTrait>(
    conn: &C,
    scope: &str,
) -> Result<Vec<TodoMember>, AppCommandError> {
    if scope == PERSONAL {
        return Ok(vec![TodoMember {
            id: PERSONAL.to_string(),
            name: "我".to_string(),
            avatar: String::new(),
        }]);
    }
    rows(
        conn,
        "SELECT id,name,avatar FROM maxcode_todo_member WHERE team_id=? ORDER BY rowid",
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
    .collect()
}

fn summary(row: &QueryResult) -> Result<TodoSummary, AppCommandError> {
    Ok(TodoSummary {
        id: field(row, "id")?,
        title: field(row, "title")?,
        status: field(row, "status")?,
        assignee_id: field(row, "assignee_id")?,
    })
}

fn remote_url(team: &TeamRecord) -> Result<&str, AppCommandError> {
    team.team
        .url
        .as_deref()
        .ok_or_else(|| AppCommandError::configuration_missing("Team address missing"))
}

async fn scoped_search(
    conn: &DatabaseConnection,
    scope: &Scope,
    query: SearchQuery,
) -> Result<TodoSearchResult, AppCommandError> {
    let mut pagination = TodoSearchPagination {
        page: query.page.unwrap_or(1).max(1),
        page_size: query.page_size.unwrap_or(20).clamp(1, 100),
        total: 0,
        search: query.search.unwrap_or_default().trim().to_string(),
    };
    let txn = conn.begin().await.map_err(error_db)?;
    let mut values = vec![scope.id.clone().into()];
    let filter = if pagination.search.is_empty() {
        "FROM maxcode_todo_item t WHERE t.scope_id=?"
    } else {
        values.push(completed_search_pattern(&pagination.search).into());
        "FROM maxcode_todo_item t LEFT JOIN maxcode_todo_member m ON m.id=t.assignee_id AND m.team_id=t.scope_id WHERE t.scope_id=? AND (t.title || char(10) || t.content || char(10) || COALESCE(m.name,CASE WHEN t.scope_id='personal' AND t.assignee_id='personal' THEN '我' ELSE '' END)) LIKE ? ESCAPE '\\'"
    };
    let counted = rows(
        &txn,
        &format!("SELECT COUNT(*) AS total {filter}"),
        values.clone(),
    )
    .await?;
    pagination.total = field::<i64>(&counted[0], "total")? as u64;
    pagination.page = pagination
        .page
        .min(pagination.total.saturating_sub(1) / pagination.page_size + 1);
    values.extend([
        (pagination.page_size as i64).into(),
        (((pagination.page - 1) * pagination.page_size) as i64).into(),
    ]);
    let todos = rows(&txn, &format!("SELECT t.id,t.title,t.status,t.assignee_id {filter} ORDER BY t.updated_at DESC,t.id DESC LIMIT ? OFFSET ?"), values).await?.iter().map(summary).collect::<Result<Vec<_>,_>>()?;
    let members = members(&txn, &scope.id).await?;
    txn.commit().await.map_err(error_db)?;
    Ok(TodoSearchResult {
        scope_id: scope.id.clone(),
        scope_key: scope.key.clone(),
        self_id: scope.self_id.clone(),
        members,
        todos,
        pagination,
    })
}

pub async fn search(
    conn: &DatabaseConnection,
    request: TodoSearchRequest,
) -> Result<TodoSearchResult, AppCommandError> {
    let scope = local_scope(conn, &request.scope_id).await?;
    let mut result = match scope.remote() {
        Some(team) => {
            remote_json(
                remote_url(team)?,
                "team_todo_search",
                &TeamTodoSearchRequest {
                    token: team.member_token.clone(),
                    query: request.query,
                },
            )
            .await?
        }
        None => scoped_search(conn, &scope, request.query).await?,
    };
    result.scope_id = scope.id;
    result.scope_key = scope.key;
    result.self_id = scope.self_id;
    Ok(result)
}

pub async fn member_search(
    conn: &DatabaseConnection,
    request: TeamTodoSearchRequest,
) -> Result<TodoSearchResult, AppCommandError> {
    let scope = member_scope(conn, request.token).await?;
    scoped_search(conn, &scope, request.query).await
}

async fn scoped_details(
    conn: &DatabaseConnection,
    scope: &str,
    ids: &[String],
) -> Result<TodoDetailsResult, AppCommandError> {
    if ids.len() > MAX_DETAILS {
        return Err(AppCommandError::invalid_input("Too many todo IDs"));
    }
    let todos = if ids.is_empty() {
        Vec::new()
    } else {
        let mut values = vec![scope.into()];
        values.extend(
            ids.iter()
                .map(|id| normalized_id(id).map(Value::from))
                .collect::<Result<Vec<_>, _>>()?,
        );
        let placeholders = vec!["?"; ids.len()].join(",");
        rows(conn,&format!("SELECT id,title,status,assignee_id FROM maxcode_todo_item WHERE scope_id=? AND id IN ({placeholders}) ORDER BY updated_at DESC,id DESC"),values).await?.iter().map(summary).collect::<Result<Vec<_>,_>>()?
    };
    Ok(TodoDetailsResult {
        todos,
        members: members(conn, scope).await?,
    })
}

pub async fn member_details(
    conn: &DatabaseConnection,
    request: TeamTodoDetailsRequest,
) -> Result<TodoDetailsResult, AppCommandError> {
    let scope = member_scope(conn, request.token).await?;
    scoped_details(conn, &scope.id, &request.todo_ids).await
}

async fn scoped_origin_call(
    conn: &DatabaseConnection,
    scope: &Scope,
    id: String,
    operation: OriginAction,
) -> Result<TodoOriginResult, AppCommandError> {
    if !matches!(
        operation.action.as_str(),
        "get" | "update" | "claim" | "release" | "complete" | "reopen" | "delete"
    ) {
        return Err(AppCommandError::invalid_input("Unsupported todo action"));
    }
    if operation.action != "get" {
        if rows(
            conn,
            "SELECT id FROM maxcode_todo_item WHERE id=? AND scope_id=?",
            vec![id.clone().into(), scope.id.clone().into()],
        )
        .await?
        .is_empty()
        {
            return Err(AppCommandError::not_found("Todo not found"));
        }
        mutate(
            conn,
            &scope.id,
            &scope.self_id,
            &TodoRequest {
                action: operation.action.clone(),
                id: Some(id.clone()),
                due_date: operation.due_date,
                priority: operation.priority,
                title: operation.title,
                content: operation.content,
                assignee_id: operation.assignee_id,
                revision: operation.revision,
                ..Default::default()
            },
            &public_url(conn).await?,
        )
        .await?;
    }
    let found = rows(
        conn,
        "SELECT * FROM maxcode_todo_item WHERE id=? AND scope_id=?",
        vec![id.clone().into(), scope.id.clone().into()],
    )
    .await?;
    let todo = found.first().map(todo_item).transpose()?;
    if todo.is_none() && !matches!(operation.action.as_str(), "get" | "delete") {
        return Err(AppCommandError::not_found("Todo not found"));
    }
    Ok(TodoOriginResult {
        origin: TodoOrigin {
            scope_id: scope.id.clone(),
            todo_id: id,
        },
        scope_key: scope.key.clone(),
        scope_name: scope.name.clone(),
        mode: scope.mode.clone(),
        self_id: scope.self_id.clone(),
        members: members(conn, &scope.id).await?,
        todo,
    })
}

pub async fn origin_call(
    conn: &DatabaseConnection,
    mut request: TodoOriginCallRequest,
) -> Result<TodoOriginResult, AppCommandError> {
    let scope = local_scope(conn, &request.origin.scope_id).await?;
    let id = normalized_id(&request.origin.todo_id)?;
    let nullable_result = matches!(request.operation.action.as_str(), "get" | "delete");
    if request.operation.action == "update"
        && request
            .operation
            .title
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
    {
        let content = required_todo_content(request.operation.content.as_deref())?;
        request.operation.title =
            Some(crate::session_title::generate_todo_title(conn, &content).await);
    }
    let mut result = match scope.remote() {
        Some(team) => {
            remote_json(
                remote_url(team)?,
                "team_todo_origin_call",
                &TeamTodoOriginCallRequest {
                    token: team.member_token.clone(),
                    todo_id: id.clone(),
                    operation: request.operation,
                },
            )
            .await?
        }
        None => scoped_origin_call(conn, &scope, id.clone(), request.operation).await?,
    };
    if result.todo.as_ref().is_some_and(|todo| todo.id != id) {
        return Err(AppCommandError::network("Invalid team response"));
    }
    if result.todo.is_none() && !nullable_result {
        return Err(AppCommandError::not_found("Todo not found"));
    }
    result.origin = TodoOrigin {
        scope_id: scope.id,
        todo_id: id,
    };
    result.scope_key = scope.key;
    result.scope_name = scope.name;
    result.mode = scope.mode;
    result.self_id = scope.self_id;
    Ok(result)
}

pub async fn member_origin_call(
    conn: &DatabaseConnection,
    request: TeamTodoOriginCallRequest,
) -> Result<TodoOriginResult, AppCommandError> {
    let scope = member_scope(conn, request.token).await?;
    scoped_origin_call(
        conn,
        &scope,
        normalized_id(&request.todo_id)?,
        request.operation,
    )
    .await
}

async fn require_conversation(conn: &DatabaseConnection, id: i32) -> Result<(), AppCommandError> {
    if rows(conn,"SELECT c.id FROM conversation c JOIN folder f ON f.id=c.folder_id WHERE c.id=? AND c.deleted_at IS NULL AND f.deleted_at IS NULL AND c.parent_id IS NULL AND c.kind IN ('regular','chat')",vec![id.into()]).await?.is_empty() {
        return Err(AppCommandError::not_found("Conversation not found"));
    }
    Ok(())
}

pub async fn link(
    conn: &DatabaseConnection,
    request: TodoConversationLinkRequest,
) -> Result<(), AppCommandError> {
    require_conversation(conn, request.conversation_id).await?;
    let origins = validate_origins(conn, &[request.origin]).await?;
    let origin = &origins[0];
    match request.action.as_str() {
        "link" => {
            let target = origin_call(
                conn,
                TodoOriginCallRequest {
                    origin: origin.clone(),
                    operation: OriginAction {
                        action: "get".to_string(),
                        ..Default::default()
                    },
                },
            )
            .await?;
            if target.todo.is_none() {
                return Err(AppCommandError::not_found("Todo not found"));
            }
            link_origins(conn, request.conversation_id, &origins).await?;
        }
        "unlink" => {
            execute(conn,"DELETE FROM maxcode_todo_conversation_link WHERE conversation_id=? AND scope_id=? AND todo_id=?",vec![request.conversation_id.into(),origin.scope_id.clone().into(),origin.todo_id.clone().into()]).await?;
        }
        _ => return Err(AppCommandError::invalid_input("Unsupported link action")),
    }
    Ok(())
}

pub async fn sources(
    conn: &DatabaseConnection,
    conversation_id: i32,
) -> Result<TodoConversationSources, AppCommandError> {
    require_conversation(conn, conversation_id).await?;
    let links = rows(conn,"SELECT scope_id,todo_id FROM maxcode_todo_conversation_link WHERE conversation_id=? ORDER BY created_at,scope_id,todo_id",vec![conversation_id.into()]).await?;
    let mut ids_by_scope: HashMap<String, Vec<String>> = HashMap::new();
    let mut order = Vec::new();
    for row in links {
        let scope: String = field(&row, "scope_id")?;
        if !ids_by_scope.contains_key(&scope) {
            order.push(scope.clone());
        }
        ids_by_scope
            .entry(scope)
            .or_default()
            .push(field(&row, "todo_id")?);
    }
    let mut result = TodoConversationSources {
        conversation_id,
        sources: Vec::new(),
    };
    for id in order {
        // Removed memberships cannot send credentials to an old host.
        let scope = match local_scope(conn, &id).await {
            Ok(scope) => scope,
            Err(error) if matches!(error.code, crate::app_error::AppErrorCode::NotFound) => {
                continue
            }
            Err(error) => return Err(error),
        };
        let ids = ids_by_scope.remove(&id).unwrap_or_default();
        let mut found = HashMap::new();
        let mut member_map = HashMap::new();
        let mut connection_error = None;
        for batch in ids.chunks(MAX_DETAILS) {
            let details = match scope.remote() {
                Some(team) => {
                    remote_json(
                        remote_url(team)?,
                        "team_todo_details",
                        &TeamTodoDetailsRequest {
                            token: team.member_token.clone(),
                            todo_ids: batch.to_vec(),
                        },
                    )
                    .await
                }
                None => scoped_details(conn, &scope.id, batch).await,
            };
            match details {
                Ok(details) => {
                    found.extend(
                        details
                            .todos
                            .into_iter()
                            .filter(|todo| ids.contains(&todo.id))
                            .map(|todo| (todo.id.clone(), todo)),
                    );
                    member_map.extend(
                        details
                            .members
                            .into_iter()
                            .map(|member| (member.id.clone(), member)),
                    );
                }
                Err(error) if scope.remote().is_some() => {
                    connection_error = Some(error.message);
                    break;
                }
                Err(error) => return Err(error),
            }
        }
        for todo_id in ids {
            let todo = found.remove(&todo_id);
            if todo.is_none() && connection_error.is_none() {
                continue;
            }
            let assignee = todo
                .as_ref()
                .and_then(|todo| todo.assignee_id.as_ref())
                .and_then(|id| member_map.get(id))
                .cloned();
            result.sources.push(TodoConversationSource {
                origin: TodoOrigin {
                    scope_id: scope.id.clone(),
                    todo_id,
                },
                scope_key: scope.key.clone(),
                scope_name: scope.name.clone(),
                mode: scope.mode.clone(),
                todo,
                assignee,
                connection_error: connection_error.clone(),
            });
        }
    }
    Ok(result)
}

#[cfg(test)]
#[path = "../../../src/maxcode-contracts/todo-conversation-sources.contract.rs"]
mod contract;
