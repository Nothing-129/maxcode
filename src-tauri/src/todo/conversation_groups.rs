//! Local conversation provenance. Team capabilities see todo IDs only; local
//! conversation IDs and transcript data never leave the originating instance.

use std::collections::{HashMap, HashSet};

use super::*;

const LOOKUP_BATCH_SIZE: usize = 100;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
pub struct TodoOrigin {
    pub scope_id: String,
    pub todo_id: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct TodoGroupSummary {
    pub id: String,
    pub title: String,
    pub status: String,
    pub assignee_id: String,
}

#[derive(Serialize)]
pub struct TodoConversationGroup {
    pub todo: TodoGroupSummary,
    pub conversation_ids: Vec<i32>,
}

#[derive(Serialize)]
pub struct TodoConversationGroups {
    pub scope_key: String,
    pub groups: Vec<TodoConversationGroup>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_error: Option<String>,
}

#[derive(Deserialize, Serialize)]
pub struct TeamTodoLookupRequest {
    pub token: String,
    pub todo_ids: Vec<String>,
}

pub(super) fn normalized_id(id: &str) -> Result<String, AppCommandError> {
    Uuid::parse_str(id)
        .map(|id| id.simple().to_string())
        .map_err(|_| AppCommandError::invalid_input("Invalid todo origin"))
}

/// The origin is captured when the draft was opened. A later scope switch must
/// not move the eventual conversation into a different team's group.
pub async fn validate_origins(
    conn: &DatabaseConnection,
    origins: &[TodoOrigin],
) -> Result<Vec<TodoOrigin>, AppCommandError> {
    if origins.len() > LOOKUP_BATCH_SIZE {
        return Err(AppCommandError::invalid_input("Too many todo origins"));
    }
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for origin in origins {
        let scope = if origin.scope_id == PERSONAL {
            PERSONAL.to_string()
        } else {
            normalized_id(&origin.scope_id)?
        };
        let origin = TodoOrigin {
            scope_id: scope,
            todo_id: normalized_id(&origin.todo_id)?,
        };
        if !seen.insert(origin.clone()) {
            continue;
        }
        if origin.scope_id != PERSONAL
            && rows(
                conn,
                "SELECT id FROM maxcode_todo_team WHERE id=?",
                vec![origin.scope_id.clone().into()],
            )
            .await?
            .is_empty()
        {
            return Err(AppCommandError::not_found("Team not found"));
        }
        // Remote todos may be offline. Recording local provenance must not
        // require a request to the host or send it a local conversation ID.
        // The source may also have been deleted since opening the draft; that
        // must not block the conversation's first send.
        result.push(origin);
    }
    Ok(result)
}

/// The caller has just created this local conversation. All origins are saved
/// in one transaction, so the newly-created row never receives a partial set.
pub async fn link_origins(
    conn: &DatabaseConnection,
    conversation_id: i32,
    origins: &[TodoOrigin],
) -> Result<(), AppCommandError> {
    if origins.is_empty() {
        return Ok(());
    }
    let origins = validate_origins(conn, origins).await?;
    let txn = conn.begin().await.map_err(error_db)?;
    let live = rows(
        &txn,
        "SELECT id FROM conversation WHERE id=? AND deleted_at IS NULL AND parent_id IS NULL AND kind IN ('regular','chat')",
        vec![conversation_id.into()],
    )
    .await?;
    if live.is_empty() {
        return Err(AppCommandError::not_found("Conversation not found"));
    }
    let now = Utc::now().to_rfc3339();
    for origin in origins {
        execute(
            &txn,
            "INSERT INTO maxcode_todo_conversation_link (scope_id,todo_id,conversation_id,created_at) VALUES (?,?,?,?) ON CONFLICT(scope_id,todo_id,conversation_id) DO NOTHING",
            vec![origin.scope_id.into(), origin.todo_id.into(), conversation_id.into(), now.clone().into()],
        )
        .await?;
    }
    txn.commit().await.map_err(error_db)?;
    Ok(())
}

async fn assigned_lookup(
    conn: &DatabaseConnection,
    scope: &str,
    todo_ids: &[String],
) -> Result<Vec<TodoGroupSummary>, AppCommandError> {
    if todo_ids.is_empty() {
        return Ok(Vec::new());
    }
    if todo_ids.len() > LOOKUP_BATCH_SIZE {
        return Err(AppCommandError::invalid_input("Too many todo IDs"));
    }
    let mut values = vec![scope.into()];
    values.extend(
        todo_ids
            .iter()
            .map(|id| normalized_id(id).map(Value::from))
            .collect::<Result<Vec<_>, _>>()?,
    );
    let placeholders = vec!["?"; todo_ids.len()].join(",");
    rows(
        conn,
        &format!("SELECT id,title,status,assignee_id FROM maxcode_todo_item WHERE scope_id=? AND assignee_id IS NOT NULL AND status!='unclaimed' AND id IN ({placeholders}) ORDER BY updated_at DESC,id DESC"),
        values,
    )
    .await?
    .iter()
    .map(|row| {
        Ok(TodoGroupSummary {
            id: field(row, "id")?,
            title: field(row, "title")?,
            status: field(row, "status")?,
            assignee_id: field(row, "assignee_id")?,
        })
    })
    .collect()
}

/// Public lookup capability: the member token chooses the scope. Its response
/// contains assigned todo headings only, independent of board pagination.
pub async fn member_lookup(
    conn: &DatabaseConnection,
    request: TeamTodoLookupRequest,
) -> Result<Vec<TodoGroupSummary>, AppCommandError> {
    if request.token.len() != 32 {
        return Err(AppCommandError::permission_denied(
            "Invalid team membership",
        ));
    }
    let membership = rows(
        conn,
        "SELECT m.team_id FROM maxcode_todo_member m JOIN maxcode_todo_team t ON t.id=m.team_id WHERE m.token=? AND t.is_local=1",
        vec![request.token.into()],
    )
    .await?;
    let membership = membership
        .first()
        .ok_or_else(|| AppCommandError::permission_denied("Invalid team membership"))?;
    assigned_lookup(
        conn,
        &field::<String>(membership, "team_id")?,
        &request.todo_ids,
    )
    .await
}

/// Protected instance endpoint. Local links are joined locally after the team
/// host has returned headings; they are never included in host requests.
pub async fn groups(conn: &DatabaseConnection) -> Result<TodoConversationGroups, AppCommandError> {
    let (mode, active) = selected(conn).await?;
    let scope = if mode == "personal" {
        Some(PERSONAL.to_string())
    } else {
        active
    };
    let scope_key = match scope.as_deref() {
        Some(PERSONAL) => PERSONAL.to_string(),
        Some(id) => format!("team:{id}"),
        None => "team:none".to_string(),
    };
    let mut result = TodoConversationGroups {
        scope_key,
        groups: Vec::new(),
        connection_error: None,
    };
    let Some(scope) = scope else {
        return Ok(result);
    };
    let links = rows(
        conn,
        "SELECT l.todo_id,l.conversation_id FROM maxcode_todo_conversation_link l JOIN conversation c ON c.id=l.conversation_id JOIN folder f ON f.id=c.folder_id WHERE l.scope_id=? AND c.deleted_at IS NULL AND f.deleted_at IS NULL AND c.parent_id IS NULL AND c.kind IN ('regular','chat') ORDER BY c.updated_at DESC,c.id DESC,l.todo_id",
        vec![scope.clone().into()],
    )
    .await?;
    let mut conversations: HashMap<String, Vec<i32>> = HashMap::new();
    let mut todo_ids = Vec::new();
    for row in links {
        let id: String = field(&row, "todo_id")?;
        if !conversations.contains_key(&id) {
            todo_ids.push(id.clone());
        }
        conversations
            .entry(id)
            .or_default()
            .push(field(&row, "conversation_id")?);
    }
    if todo_ids.is_empty() {
        return Ok(result);
    }
    let team = if scope == PERSONAL {
        None
    } else {
        rows(
            conn,
            "SELECT * FROM maxcode_todo_team WHERE id=?",
            vec![scope.clone().into()],
        )
        .await?
        .first()
        .map(team_record)
        .transpose()?
    };
    if scope != PERSONAL && team.is_none() {
        return Ok(result);
    }
    let mut summaries = HashMap::new();
    for batch in todo_ids.chunks(LOOKUP_BATCH_SIZE) {
        let looked_up = match team.as_ref().filter(|team| !team.team.is_local) {
            Some(team) => {
                let url = team.team.url.as_deref().ok_or_else(|| {
                    AppCommandError::configuration_missing("Team address missing")
                })?;
                match remote_json::<Vec<TodoGroupSummary>>(
                    url,
                    "team_todo_lookup",
                    &TeamTodoLookupRequest {
                        token: team.member_token.clone(),
                        todo_ids: batch.to_vec(),
                    },
                )
                .await
                {
                    Ok(todos) => todos,
                    Err(error) => {
                        result.connection_error = Some(error.message);
                        return Ok(result);
                    }
                }
            }
            None => assigned_lookup(conn, &scope, batch).await?,
        };
        for summary in looked_up {
            // An untrusted host cannot invent associations to local rows.
            if matches!(
                summary.status.as_str(),
                "claimed" | "pending_verification" | "completed"
            )
                && !summary.assignee_id.is_empty()
                && conversations.contains_key(&summary.id)
            {
                summaries.insert(summary.id.clone(), summary);
            }
        }
    }
    for id in todo_ids {
        if let Some(todo) = summaries.remove(&id) {
            result.groups.push(TodoConversationGroup {
                todo,
                conversation_ids: conversations.remove(&id).unwrap_or_default(),
            });
        }
    }
    Ok(result)
}

#[cfg(test)]
#[path = "../../../src/maxcode-contracts/todo-conversation-groups.contract.rs"]
mod contract;
