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
