use crate::{
    app_error::AppCommandError,
    app_state::AppState,
    commands::conversation_read::{self, ReadReceipt},
};
use axum::{extract::Extension, Json};
use serde::Deserialize;
use std::sync::Arc;

pub async fn get_conversation_reads(
    Extension(state): Extension<Arc<AppState>>,
) -> Result<Json<Vec<ReadReceipt>>, AppCommandError> {
    Ok(Json(conversation_read::load(&state.db.conn).await?))
}
#[derive(Deserialize)]
pub struct Params {
    pub ids: Vec<i64>,
}
pub async fn mark_conversations_read(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<Params>,
) -> Result<Json<Vec<ReadReceipt>>, AppCommandError> {
    Ok(Json(
        conversation_read::save(&state.db.conn, &state.emitter, params.ids).await?,
    ))
}
