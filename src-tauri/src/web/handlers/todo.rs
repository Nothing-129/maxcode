use std::sync::Arc;

use axum::{
    extract::Extension,
    http::{header, HeaderValue},
    response::{IntoResponse, Response},
    Json,
};

use crate::todo::conversation_sources as sources;
use crate::web::event_bridge::emit_event;
use crate::{app_error::AppCommandError, app_state::AppState, todo};

fn no_store(value: impl serde::Serialize) -> Response {
    let mut response = Json(value).into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store, max-age=0"),
    );
    response
}

pub async fn todo_call(
    Extension(state): Extension<Arc<AppState>>,
    Json(request): Json<todo::TodoRequest>,
) -> Result<Response, AppCommandError> {
    let creating_team = request.action == "create_team";
    let mut result = todo::call(&state.db.conn, request).await?;
    // Electron's loopback service uses a random per-launch port. Team codes
    // must point to the configured, stable listener behind the public address.
    if result.mode == "team"
        && result.public_url.is_some()
        && result
            .teams
            .iter()
            .any(|team| team.is_local && Some(&team.id) == result.active_team_id.as_ref())
        && crate::update::runtime::is_electron()
    {
        if creating_team && crate::web::do_get_web_server_status(&state.web_server_state).is_none()
        {
            let static_dir = crate::web::find_static_dir_standalone(
                std::env::var("CODEG_STATIC_DIR").ok().as_deref(),
            );
            if let Err(error) = crate::web::do_start_web_server_with_state(
                state.clone(),
                static_dir,
                None,
                None,
                None,
            )
            .await
            {
                tracing::warn!(reason = %error.message, "Cannot start team sharing service");
            }
        }
        if crate::web::do_get_web_server_status(&state.web_server_state).is_none() {
            result.team_code = None;
        }
    }
    Ok(no_store(result))
}

/// Deliberately outside instance authentication. Token checks happen before
/// dispatch and grant access only to the member's team task scope.
pub async fn team_todo_call(
    Extension(state): Extension<Arc<AppState>>,
    Json(request): Json<todo::TeamMemberRequest>,
) -> Result<Response, AppCommandError> {
    Ok(no_store(todo::member_call(&state.db.conn, request).await?))
}

pub async fn team_todo_join(
    Extension(state): Extension<Arc<AppState>>,
    Json(request): Json<todo::TeamJoinRequest>,
) -> Result<Response, AppCommandError> {
    Ok(no_store(todo::join(&state.db.conn, request).await?))
}

pub async fn todo_conversation_groups(
    Extension(state): Extension<Arc<AppState>>,
) -> Result<Response, AppCommandError> {
    Ok(no_store(
        todo::conversation_groups::groups(&state.db.conn).await?,
    ))
}

pub async fn team_todo_lookup(
    Extension(state): Extension<Arc<AppState>>,
    Json(request): Json<todo::conversation_groups::TeamTodoLookupRequest>,
) -> Result<Response, AppCommandError> {
    Ok(no_store(
        todo::conversation_groups::member_lookup(&state.db.conn, request).await?,
    ))
}

pub async fn todo_search(
    Extension(state): Extension<Arc<AppState>>,
    Json(request): Json<sources::TodoSearchRequest>,
) -> Result<Response, AppCommandError> {
    Ok(no_store(sources::search(&state.db.conn, request).await?))
}

pub async fn todo_origin_call(
    Extension(state): Extension<Arc<AppState>>,
    Json(request): Json<sources::TodoOriginCallRequest>,
) -> Result<Response, AppCommandError> {
    Ok(no_store(
        sources::origin_call(&state.db.conn, request).await?,
    ))
}

pub async fn todo_conversation_link(
    Extension(state): Extension<Arc<AppState>>,
    Json(request): Json<sources::TodoConversationLinkRequest>,
) -> Result<Response, AppCommandError> {
    let conversation_id = request.conversation_id;
    sources::link(&state.db.conn, request).await?;
    emit_event(
        &state.emitter,
        "todo-conversation-links://changed",
        serde_json::json!({"conversation_id":conversation_id}),
    );
    Ok(no_store(serde_json::json!({})))
}

pub async fn todo_conversation_sources(
    Extension(state): Extension<Arc<AppState>>,
    Json(request): Json<sources::TodoConversationSourcesRequest>,
) -> Result<Response, AppCommandError> {
    Ok(no_store(
        sources::sources(&state.db.conn, request.conversation_id).await?,
    ))
}

pub async fn team_todo_search(
    Extension(state): Extension<Arc<AppState>>,
    Json(request): Json<sources::TeamTodoSearchRequest>,
) -> Result<Response, AppCommandError> {
    Ok(no_store(
        sources::member_search(&state.db.conn, request).await?,
    ))
}

pub async fn team_todo_origin_call(
    Extension(state): Extension<Arc<AppState>>,
    Json(request): Json<sources::TeamTodoOriginCallRequest>,
) -> Result<Response, AppCommandError> {
    Ok(no_store(
        sources::member_origin_call(&state.db.conn, request).await?,
    ))
}

pub async fn team_todo_details(
    Extension(state): Extension<Arc<AppState>>,
    Json(request): Json<sources::TeamTodoDetailsRequest>,
) -> Result<Response, AppCommandError> {
    Ok(no_store(
        sources::member_details(&state.db.conn, request).await?,
    ))
}

pub async fn todo_storage_config(
    Extension(state): Extension<Arc<AppState>>,
    Json(request): Json<todo::storage::ConfigRequest>,
) -> Result<Response, AppCommandError> {
    Ok(no_store(
        todo::storage::configure(&state.db.conn, request).await?,
    ))
}

async fn read_attachment(
    mut multipart: axum::extract::Multipart,
) -> Result<(String, String, Vec<u8>, String, String), AppCommandError> {
    let mut scope = String::new();
    let mut content = String::new();
    let mut file = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| AppCommandError::invalid_input("Invalid attachment upload"))?
    {
        match field.name() {
            Some("scope_id") => {
                scope = field
                    .text()
                    .await
                    .map_err(|_| AppCommandError::invalid_input("Invalid scope"))?
            }
            Some("content") => {
                content = field
                    .text()
                    .await
                    .map_err(|_| AppCommandError::invalid_input("Invalid content"))?
            }
            Some("file") => {
                if file.is_some() {
                    return Err(AppCommandError::invalid_input("Upload one file at a time"));
                }
                let name = field.file_name().unwrap_or("file").to_string();
                let mime = field
                    .content_type()
                    .unwrap_or("application/octet-stream")
                    .to_string();
                let bytes = field.bytes().await.map_err(|_| {
                    AppCommandError::invalid_input("Attachment exceeds the upload limit")
                })?;
                file = Some((name, mime, bytes.to_vec()));
            }
            _ => return Err(AppCommandError::invalid_input("Unknown attachment field")),
        }
        if scope.len() > 80 || content.len() > 1024 * 1024 {
            return Err(AppCommandError::invalid_input(
                "Attachment metadata is too large",
            ));
        }
    }
    let (name, mime, bytes) =
        file.ok_or_else(|| AppCommandError::invalid_input("Choose a file"))?;
    Ok((name, mime, bytes, scope, content))
}
pub async fn todo_attachment_upload(
    Extension(state): Extension<Arc<AppState>>,
    multipart: axum::extract::Multipart,
) -> Result<Response, AppCommandError> {
    let (name, mime, bytes, scope, content) = read_attachment(multipart).await?;
    Ok(no_store(
        todo::storage::upload_local(&state.db.conn, &scope, name, mime, bytes, &content).await?,
    ))
}
pub async fn team_todo_attachment_upload(
    Extension(state): Extension<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    multipart: axum::extract::Multipart,
) -> Result<Response, AppCommandError> {
    // Authenticate before reading the upload body. The token determines scope.
    let token = headers
        .get("X-MaxCode-Team-Token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    let scope = todo::storage::member_scope(&state.db.conn, token).await?;
    let (name, mime, bytes, _, content) = read_attachment(multipart).await?;
    Ok(no_store(
        todo::storage::upload_host(&state.db.conn, &scope, name, mime, bytes, &content).await?,
    ))
}
pub async fn todo_attachment_read(
    Extension(state): Extension<Arc<AppState>>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Response, AppCommandError> {
    use sea_orm::ConnectionTrait;
    if id.len() != 32 || !id.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppCommandError::not_found("Attachment not found"));
    }
    let row = state
        .db
        .conn
        .query_one(sea_orm::Statement::from_sql_and_values(
            sea_orm::DbBackend::Sqlite,
            "SELECT name,mime FROM maxcode_todo_attachment WHERE id=? AND scope_id='personal'",
            [id.clone().into()],
        ))
        .await
        .map_err(|_| AppCommandError::database_error("Cannot read attachment metadata"))?
        .ok_or_else(|| AppCommandError::not_found("Attachment not found"))?;
    let name: String = row
        .try_get("", "name")
        .map_err(|_| AppCommandError::not_found("Attachment not found"))?;
    let mime: String = row
        .try_get("", "mime")
        .map_err(|_| AppCommandError::not_found("Attachment not found"))?;
    let file = tokio::fs::File::open(todo::storage::local_root().join(id))
        .await
        .map_err(|_| AppCommandError::not_found("Attachment not found"))?;
    let mut res = Response::new(axum::body::Body::from_stream(
        tokio_util::io::ReaderStream::new(file),
    ));
    res.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&mime)
            .map_err(|_| AppCommandError::invalid_input("Invalid content type"))?,
    );
    let disposition = if mime.starts_with("image/") {
        "inline"
    } else {
        "attachment"
    };
    res.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!(
            "{disposition}; filename*=UTF-8''{}",
            urlencoding::encode(&name)
        ))
        .map_err(|_| AppCommandError::invalid_input("Invalid filename"))?,
    );
    res.headers_mut().insert(
        "X-Content-Type-Options",
        HeaderValue::from_static("nosniff"),
    );
    res.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    Ok(res)
}

pub async fn todo_import_codex_session(
    Extension(state): Extension<Arc<AppState>>,
    Json(request): Json<todo::codex_session::ImportRequest>,
) -> Result<Response, AppCommandError> {
    let summary = todo::codex_session::import(&state.db.conn, request).await?;
    emit_event(
        &state.emitter,
        "todo-conversation-links://changed",
        serde_json::json!({"conversation_id":summary.id}),
    );
    crate::commands::conversations::emit_conversation_upsert(
        &state.emitter,
        &state.db.conn,
        summary.id,
    )
    .await;
    Ok(no_store(summary))
}

pub async fn team_todo_codex_session(
    Extension(state): Extension<Arc<AppState>>,
    Json(request): Json<sources::TeamCodexSessionRequest>,
) -> Result<Response, AppCommandError> {
    Ok(no_store(
        sources::member_codex_session(&state.db.conn, request).await?,
    ))
}
