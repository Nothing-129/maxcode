use std::sync::Arc;

use axum::{
    extract::Extension,
    http::{header, HeaderValue},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;

use crate::app_error::AppCommandError;
use crate::app_state::AppState;
use crate::commands::conversation_share as share_commands;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationIdParams {
    pub conversation_id: i32,
}

#[derive(Deserialize)]
pub struct SharedConversationParams {
    pub token: String,
}

pub async fn create_conversation_share(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<ConversationIdParams>,
) -> Result<Json<share_commands::ConversationShareInfo>, AppCommandError> {
    Ok(Json(
        share_commands::create_conversation_share_core(&state.db.conn, params.conversation_id)
            .await?,
    ))
}

pub async fn revoke_conversation_share(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<ConversationIdParams>,
) -> Result<Json<serde_json::Value>, AppCommandError> {
    share_commands::revoke_conversation_share_core(&state.db.conn, params.conversation_id).await?;
    Ok(Json(serde_json::json!(null)))
}

/// Public capability endpoint. POST is intentional: the share token lives in
/// the URL fragment on the client and in the request body here, so neither the
/// page request nor the HTTP span's path records the credential.
pub async fn get_shared_conversation(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<SharedConversationParams>,
) -> Result<Response, AppCommandError> {
    let snapshot =
        share_commands::get_shared_conversation_core(&state.db.conn, &params.token).await?;
    let mut response = Json(snapshot).into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store, max-age=0"),
    );
    response.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    Ok(response)
}
