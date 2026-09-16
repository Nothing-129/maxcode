//! HTTP business logic for workspace background images.
//!
//! All filesystem operations live in `crate::backgrounds`; this module owns the
//! async operations that offload the blocking I/O and surface it as
//! `AppCommandError`. The disk-backed commands are **stateless** (no DB /
//! `AppState`);
//! the `background_market_*` trio additionally proxies wallhaven.cc through
//! `crate::backgrounds::marketplace`.

use crate::app_error::AppCommandError;
use crate::backgrounds;
use crate::backgrounds::marketplace::{
    self as background_marketplace, MarketSearchPage, MarketSearchParams,
};
use crate::models::background::BackgroundAsset;

// ─── core ops (filesystem) ──────────────────────────────────────────────

pub async fn background_read_core() -> Result<Option<BackgroundAsset>, AppCommandError> {
    tokio::task::spawn_blocking(backgrounds::read_background)
        .await
        .map_err(|e| AppCommandError::task_execution_failed(e.to_string()))?
}

pub async fn background_set_core(image_base64: String) -> Result<(), AppCommandError> {
    tokio::task::spawn_blocking(move || backgrounds::set_background(&image_base64))
        .await
        .map_err(|e| AppCommandError::task_execution_failed(e.to_string()))?
}

pub async fn background_clear_core() -> Result<(), AppCommandError> {
    tokio::task::spawn_blocking(backgrounds::clear_background)
        .await
        .map_err(|e| AppCommandError::task_execution_failed(e.to_string()))?
}

// ─── web-handler param struct ───────────────────────────────────────────

/// JSON body for `background_set`, preserving the frontend camelCase payload.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundSetParams {
    pub image_base64: String,
}

// ─── marketplace (wallhaven) ────────────────────────────────────────────

pub async fn background_market_search_core(
    params: MarketSearchParams,
) -> Result<MarketSearchPage, AppCommandError> {
    background_marketplace::search(params).await
}

pub async fn background_market_asset_core(url: String) -> Result<BackgroundAsset, AppCommandError> {
    background_marketplace::fetch_asset(&url).await
}

pub async fn background_market_download_core(
    url: String,
    source_url: String,
) -> Result<(), AppCommandError> {
    background_marketplace::download(&url, &source_url).await
}

// ─── web-handler param structs ──────────────────────────────────────────

/// JSON bodies for the `background_market_*` HTTP handlers.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundMarketSearchParams {
    pub query: Option<String>,
    pub category: Option<String>,
    pub page: Option<u32>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundMarketAssetParams {
    pub url: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundMarketDownloadParams {
    pub url: String,
    pub source_url: String,
}
