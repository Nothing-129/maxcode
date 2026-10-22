//! MCP operations on human-owned todos. Explicit scopes never change UI
//! preferences. Conversation-to-todo creation uses the existing share snapshot
//! pipeline; local association remains a separate operation.

use super::*;
use serde_json::{json, Value as JsonValue};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolRequest {
    pub tool: String,
    pub arguments: JsonValue,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateSpec {
    pub title: String,
    pub content: String,
    pub operation_id: String,
    pub assignee_id: Option<String>,
    pub due_date: Option<String>,
    pub priority: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MemberCreateRequest {
    pub token: String,
    pub spec: CreateSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<SharedConversationSnapshot>,
}

pub const TOOL_NAMES: &[&str] = &[
    "list_todo_scopes",
    "list_todos",
    "get_todo",
    "create_todo",
    "create_todo_from_conversation",
    "update_todo",
    "claim_todo",
    "release_todo",
    "complete_todo",
    "reopen_todo",
    "delete_todo",
    "link_todo_to_conversation",
];

/// Validate at both the companion and service boundaries. In particular, the
/// agent cannot supply a member token, conversation ID or transcript snapshot.
pub fn validate(request: &ToolRequest) -> Result<(), AppCommandError> {
    let args = request
        .arguments
        .as_object()
        .ok_or_else(|| AppCommandError::invalid_input("Expected an arguments object"))?;
    let extra: &[&str] = match request.tool.as_str() {
        "list_todo_scopes" => &[],
        "list_todos" => &["search", "only_mine", "page", "page_size"],
        "get_todo" => &["todo_id"],
        "create_todo" | "create_todo_from_conversation" => &[
            "title",
            "content",
            "operation_id",
            "assignee_id",
            "due_date",
            "priority",
        ],
        "update_todo" => &[
            "todo_id",
            "revision",
            "title",
            "content",
            "assignee_id",
            "due_date",
            "priority",
        ],
        "claim_todo" | "release_todo" | "complete_todo" | "reopen_todo" | "delete_todo" => {
            &["todo_id", "revision"]
        }
        "link_todo_to_conversation" => &["todo_id", "action"],
        _ => return Err(AppCommandError::invalid_input("Unknown todo tool")),
    };
    for key in args.keys() {
        if !extra.contains(&key.as_str())
            && !(key == "scope_id" && request.tool != "list_todo_scopes")
        {
            return Err(AppCommandError::invalid_input(format!(
                "Unexpected argument: {key}"
            )));
        }
    }
    if request.tool != "list_todo_scopes"
        && (!matches!(
            request.tool.as_str(),
            "create_todo" | "create_todo_from_conversation" | "list_todos"
        ) || args.contains_key("scope_id"))
    {
        required_arg(&request.arguments, "scope_id")?;
    }
    if extra.contains(&"todo_id") {
        normalized_id(required_arg(&request.arguments, "todo_id")?)?;
    }
    if extra.contains(&"revision")
        && args
            .get("revision")
            .and_then(JsonValue::as_i64)
            .filter(|r| *r > 0)
            .is_none()
    {
        return Err(AppCommandError::invalid_input(
            "Positive todo revision is required; call get_todo first",
        ));
    }
    if matches!(
        request.tool.as_str(),
        "create_todo" | "create_todo_from_conversation"
    ) {
        for key in ["title", "content", "operation_id"] {
            required_arg(&request.arguments, key)?;
        }
    }
    for key in ["title", "content", "search", "operation_id"] {
        if args.get(key).is_some_and(|v| !v.is_string()) {
            return Err(AppCommandError::invalid_input(format!(
                "{key} must be a string"
            )));
        }
    }
    for key in ["assignee_id", "due_date", "priority"] {
        if args
            .get(key)
            .is_some_and(|v| !v.is_null() && !v.is_string())
        {
            return Err(AppCommandError::invalid_input(format!(
                "{key} must be a string or null"
            )));
        }
    }
    if let Some(priority) = args.get("priority").and_then(JsonValue::as_str) {
        if !matches!(priority, "low" | "normal" | "high" | "urgent") {
            return Err(AppCommandError::invalid_input("Invalid todo priority"));
        }
    }
    if args.get("only_mine").is_some_and(|v| !v.is_boolean()) {
        return Err(AppCommandError::invalid_input("only_mine must be boolean"));
    }
    for key in ["page", "page_size"] {
        if args
            .get(key)
            .is_some_and(|v| v.as_u64().filter(|n| *n > 0).is_none())
        {
            return Err(AppCommandError::invalid_input(format!(
                "{key} must be positive"
            )));
        }
    }
    if request.tool == "link_todo_to_conversation"
        && !matches!(
            args.get("action").and_then(JsonValue::as_str),
            Some("link" | "unlink")
        )
    {
        return Err(AppCommandError::invalid_input(
            "action must be link or unlink",
        ));
    }
    Ok(())
}

fn required_arg<'a>(args: &'a JsonValue, key: &str) -> Result<&'a str, AppCommandError> {
    args.get(key)
        .and_then(JsonValue::as_str)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| AppCommandError::invalid_input(format!("{key} is required")))
}

fn encode(value: impl Serialize) -> Result<JsonValue, AppCommandError> {
    serde_json::to_value(value).map_err(|_| AppCommandError::invalid_input("Invalid todo result"))
}

async fn create_local(
    conn: &DatabaseConnection,
    scope: &Scope,
    spec: CreateSpec,
    snapshot: Option<SharedConversationSnapshot>,
) -> Result<TodoOriginResult, AppCommandError> {
    let operation = Uuid::parse_str(&spec.operation_id)
        .map_err(|_| AppCommandError::invalid_input("operation_id must be a UUID"))?
        .simple()
        .to_string();
    mutate(
        conn,
        &scope.id,
        &scope.self_id,
        &TodoRequest {
            action: "create".into(),
            title: Some(spec.title),
            content: Some(spec.content),
            operation_id: Some(operation.clone()),
            assignee_id: spec.assignee_id,
            due_date: spec.due_date,
            priority: spec.priority,
            snapshot,
            ..Default::default()
        },
        &public_url(conn).await?,
    )
    .await?;
    let found = rows(
        conn,
        "SELECT id FROM maxcode_todo_item WHERE scope_id=? AND creator_id=? AND operation_id=?",
        vec![
            scope.id.clone().into(),
            scope.self_id.clone().into(),
            operation.into(),
        ],
    )
    .await?;
    let row = found
        .first()
        .ok_or_else(|| AppCommandError::not_found("Created todo not found"))?;
    scoped_origin_call(
        conn,
        scope,
        field(row, "id")?,
        OriginAction {
            action: "get".into(),
            ..Default::default()
        },
    )
    .await
}

/// Remote credentials resolve exactly one hosted team, never a caller-supplied
/// scope. This endpoint returns only the created item and public member details.
pub async fn member_create(
    conn: &DatabaseConnection,
    request: MemberCreateRequest,
) -> Result<TodoOriginResult, AppCommandError> {
    let scope = member_scope(conn, request.token).await?;
    create_local(conn, &scope, request.spec, request.snapshot).await
}

/// Resolve the persisted board selection once, without changing it or silently
/// falling back to personal when a selected team is missing/offline.
async fn default_scope(conn: &DatabaseConnection) -> Result<String, AppCommandError> {
    let (mode, team) = selected(conn).await?;
    if mode == "personal" {
        return Ok(PERSONAL.to_string());
    }
    let id = team.ok_or_else(|| AppCommandError::not_found("Select a todo team first"))?;
    local_scope(conn, &id).await?;
    Ok(id)
}

pub async fn call(
    conn: &DatabaseConnection,
    conversation_id: Option<i32>,
    request: ToolRequest,
) -> Result<JsonValue, AppCommandError> {
    validate(&request)?;
    let args = &request.arguments;
    if request.tool == "list_todo_scopes" {
        let mut scopes = vec![
            json!({"scope_id": PERSONAL, "name": "个人待办", "mode": "personal", "self_id": PERSONAL}),
        ];
        for record in teams(conn, &None).await? {
            scopes.push(json!({
                "scope_id": record.team.id, "name": record.team.name,
                "mode": "team", "self_id": record.self_id,
            }));
        }
        let (mode, active_team_id) = selected(conn).await?;
        let default_scope_id = if mode == "personal" {
            Some(PERSONAL.to_string())
        } else {
            active_team_id
                .clone()
                .filter(|id| scopes.iter().any(|s| s["scope_id"] == *id))
        };
        return Ok(
            json!({"scopes": scopes, "mode": mode, "active_team_id": active_team_id,
            "default_scope_id": default_scope_id}),
        );
    }
    let scope_id = match args.get("scope_id") {
        Some(_) => required_arg(args, "scope_id")?.to_string(),
        None => default_scope(conn).await?,
    };
    if request.tool == "list_todos" {
        let query: SearchQuery = serde_json::from_value(args.clone())
            .map_err(|_| AppCommandError::invalid_input("Invalid search arguments"))?;
        return encode(search(conn, TodoSearchRequest { scope_id, query }).await?);
    }
    if matches!(
        request.tool.as_str(),
        "create_todo" | "create_todo_from_conversation"
    ) {
        let scope = local_scope(conn, &scope_id).await?;
        let mut fields = args.clone();
        fields.as_object_mut().unwrap().remove("scope_id");
        let spec: CreateSpec = serde_json::from_value(fields)
            .map_err(|_| AppCommandError::invalid_input("Invalid create arguments"))?;
        let snapshot = if request.tool == "create_todo_from_conversation" {
            let id = conversation_id
                .ok_or_else(|| AppCommandError::not_found("Current conversation not available"))?;
            Some(
                conversation_share::build_conversation_share_snapshot(
                    conn,
                    id,
                    ConversationShareOptions::default(),
                )
                .await?,
            )
        } else {
            None
        };
        let mut result = match scope.remote() {
            Some(team) => {
                remote_json(
                    remote_url(team)?,
                    "team_todo_create",
                    &MemberCreateRequest {
                        token: team.member_token.clone(),
                        spec,
                        snapshot,
                    },
                )
                .await?
            }
            None => create_local(conn, &scope, spec, snapshot).await?,
        };
        let todo = result
            .todo
            .as_ref()
            .ok_or_else(|| AppCommandError::network("Missing created todo"))?;
        normalized_id(&todo.id)?;
        result.origin = TodoOrigin {
            scope_id: scope.id,
            todo_id: todo.id.clone(),
        };
        result.scope_key = scope.key;
        result.scope_name = scope.name;
        result.mode = scope.mode;
        result.self_id = scope.self_id;
        return encode(result);
    }
    let origin = TodoOrigin {
        scope_id,
        todo_id: required_arg(args, "todo_id")?.to_string(),
    };
    if request.tool == "link_todo_to_conversation" {
        let conversation_id = conversation_id
            .ok_or_else(|| AppCommandError::not_found("Current conversation not available"))?;
        link(
            conn,
            TodoConversationLinkRequest {
                conversation_id,
                origin: origin.clone(),
                action: required_arg(args, "action")?.to_string(),
            },
        )
        .await?;
        return Ok(
            json!({"origin": origin, "conversation_id": conversation_id, "action": args["action"]}),
        );
    }
    let action = request.tool.strip_suffix("_todo").unwrap();
    let mut operation = OriginAction {
        action: action.to_string(),
        revision: args.get("revision").and_then(JsonValue::as_i64),
        ..Default::default()
    };
    if action == "update" {
        // Patch semantics: omitted fields keep their current values, while
        // explicit null clears nullable fields. The supplied revision still
        // guards both this read and the final write against concurrent edits.
        let current = origin_call(
            conn,
            TodoOriginCallRequest {
                origin: origin.clone(),
                operation: OriginAction {
                    action: "get".into(),
                    ..Default::default()
                },
            },
        )
        .await?
        .todo
        .ok_or_else(|| AppCommandError::not_found("Todo not found"))?;
        if Some(current.revision) != operation.revision {
            return Err(AppCommandError::already_exists(
                "Todo changed; call get_todo before retrying",
            ));
        }
        let mut fields = encode(&current)?;
        for key in ["title", "content", "assignee_id", "due_date", "priority"] {
            if let Some(value) = args.get(key) {
                fields[key] = value.clone();
            }
        }
        operation.title = fields["title"].as_str().map(str::to_string);
        operation.content = fields["content"].as_str().map(str::to_string);
        operation.assignee_id = fields["assignee_id"].as_str().map(str::to_string);
        operation.due_date = fields["due_date"].as_str().map(str::to_string);
        operation.priority = fields["priority"].as_str().map(str::to_string);
    }
    encode(origin_call(conn, TodoOriginCallRequest { origin, operation }).await?)
}

#[cfg(test)]
#[path = "../../../src/maxcode-contracts/todo-mcp.contract.rs"]
mod contract;
