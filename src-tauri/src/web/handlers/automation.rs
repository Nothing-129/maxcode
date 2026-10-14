use std::sync::Arc;

use axum::{extract::Extension, Json};
use chrono::{DateTime, Utc};
use serde::Deserialize;

use crate::app_error::AppCommandError;
use crate::app_state::AppState;
use crate::commands::automation as core;
use crate::models::{AutomationDraft, AutomationInfo, AutomationRunInfo};

fn default_run_limit() -> u64 {
    100
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetAutomationParams {
    pub id: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRunsParams {
    pub automation_id: i32,
    #[serde(default = "default_run_limit")]
    pub limit: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAutomationParams {
    pub draft: AutomationDraft,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAutomationParams {
    pub id: i32,
    pub draft: AutomationDraft,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetEnabledParams {
    pub id: i32,
    pub enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAutomationParams {
    pub id: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputeNextRunParams {
    pub cron: String,
    pub timezone: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunNowParams {
    pub automation_id: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelRunParams {
    pub run_id: i32,
}

pub async fn automation_list(
    Extension(state): Extension<Arc<AppState>>,
) -> Result<Json<Vec<AutomationInfo>>, AppCommandError> {
    let result = core::automation_list_core(&state.db)
        .await
        .map_err(AppCommandError::from)?;
    Ok(Json(result))
}

pub async fn automation_get(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<GetAutomationParams>,
) -> Result<Json<AutomationInfo>, AppCommandError> {
    let result = core::automation_get_core(&state.db, params.id)
        .await
        .map_err(AppCommandError::from)?;
    Ok(Json(result))
}

pub async fn automation_runs(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<ListRunsParams>,
) -> Result<Json<Vec<AutomationRunInfo>>, AppCommandError> {
    let result = core::automation_runs_core(&state.db, params.automation_id, params.limit)
        .await
        .map_err(AppCommandError::from)?;
    Ok(Json(result))
}

pub async fn automation_create(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<CreateAutomationParams>,
) -> Result<Json<AutomationInfo>, AppCommandError> {
    let result = core::automation_create_core(&state.emitter, &state.db, params.draft)
        .await
        .map_err(AppCommandError::from)?;
    Ok(Json(result))
}

pub async fn automation_update(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<UpdateAutomationParams>,
) -> Result<Json<AutomationInfo>, AppCommandError> {
    let result = core::automation_update_core(&state.emitter, &state.db, params.id, params.draft)
        .await
        .map_err(AppCommandError::from)?;
    Ok(Json(result))
}

pub async fn automation_set_enabled(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<SetEnabledParams>,
) -> Result<Json<AutomationInfo>, AppCommandError> {
    let result =
        core::automation_set_enabled_core(&state.emitter, &state.db, params.id, params.enabled)
            .await
            .map_err(AppCommandError::from)?;
    Ok(Json(result))
}

pub async fn automation_delete(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<DeleteAutomationParams>,
) -> Result<Json<()>, AppCommandError> {
    core::automation_delete_core(&state.emitter, &state.db, params.id)
        .await
        .map_err(AppCommandError::from)?;
    Ok(Json(()))
}

pub async fn automation_mark_seen(
    Extension(state): Extension<Arc<AppState>>,
) -> Result<Json<()>, AppCommandError> {
    core::automation_mark_seen_core(&state.db)
        .await
        .map_err(AppCommandError::from)?;
    Ok(Json(()))
}

pub async fn automation_compute_next_run(
    Json(params): Json<ComputeNextRunParams>,
) -> Result<Json<Option<DateTime<Utc>>>, AppCommandError> {
    let result = core::automation_compute_next_run_core(&params.cron, &params.timezone)
        .map_err(AppCommandError::from)?;
    Ok(Json(result))
}

pub async fn automation_run_now(
    Json(params): Json<RunNowParams>,
) -> Result<Json<i32>, AppCommandError> {
    let run_id = core::automation_run_now_core(params.automation_id)
        .await
        .map_err(AppCommandError::from)?;
    Ok(Json(run_id))
}

pub async fn automation_cancel_run(
    Json(params): Json<CancelRunParams>,
) -> Result<Json<()>, AppCommandError> {
    core::automation_cancel_run_core(params.run_id)
        .await
        .map_err(AppCommandError::from)?;
    Ok(Json(()))
}

pub async fn automation_listener_status(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<GetAutomationParams>,
) -> Result<Json<crate::models::AutomationListenerInfo>, AppCommandError> {
    Ok(Json(
        core::automation_listener_status_core(&state.db, params.id)
            .await
            .map_err(AppCommandError::from)?,
    ))
}
pub async fn automation_restart_listener(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<GetAutomationParams>,
) -> Result<Json<()>, AppCommandError> {
    core::automation_restart_listener_core(&state.db, &state.emitter, params.id)
        .await
        .map_err(AppCommandError::from)?;
    Ok(Json(()))
}
