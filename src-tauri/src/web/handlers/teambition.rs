use axum::Json;
use serde::Deserialize;

use crate::app_error::AppCommandError;
use crate::commands::teambition::{self, TeambitionBoard, TeambitionTask};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatusParams {
    pub task_id: String,
    pub status_id: String,
}

pub async fn teambition_board() -> Result<Json<TeambitionBoard>, AppCommandError> {
    Ok(Json(teambition::teambition_board().await?))
}

pub async fn teambition_update_task_status(
    Json(params): Json<UpdateStatusParams>,
) -> Result<Json<TeambitionTask>, AppCommandError> {
    Ok(Json(
        teambition::teambition_update_task_status(params.task_id, params.status_id).await?,
    ))
}
