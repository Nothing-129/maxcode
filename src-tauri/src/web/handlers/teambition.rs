use axum::Json;
use serde::Deserialize;

use crate::app_error::AppCommandError;
use crate::commands::teambition::{self, TeambitionBoard, TeambitionTask};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatusParams {
    pub server_id: String,
    pub project_id: String,
    pub task_id: String,
    pub status_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardParams {
    pub server_id: String,
    pub project_id: String,
}

pub async fn teambition_board(
    Json(params): Json<BoardParams>,
) -> Result<Json<TeambitionBoard>, AppCommandError> {
    Ok(Json(
        teambition::teambition_board(params.server_id, params.project_id).await?,
    ))
}

pub async fn teambition_update_task_status(
    Json(params): Json<UpdateStatusParams>,
) -> Result<Json<TeambitionTask>, AppCommandError> {
    Ok(Json(
        teambition::teambition_update_task_status(
            params.server_id,
            params.project_id,
            params.task_id,
            params.status_id,
        )
        .await?,
    ))
}
