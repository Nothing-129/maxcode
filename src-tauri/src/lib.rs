// The ACP connection driver (`acp::connection`) wraps the enormous
// `run_connection` future in a `block_on(async move { … })` frame whose type
// layout nests deep enough to blow rustc's default query depth of 128 (it
// overflowed by ~130 when computing the async block's layout). This is a
// compile-time type-recursion knob, unrelated to any runtime limit — bump it
// so the giant future's layout resolves. See the big-stack thread in
// `acp/connection.rs` for the sibling *runtime* mitigation of the same frame.
#![recursion_limit = "256"]

pub mod acp;
pub mod acp_transcript;
pub use acp::{
    idle_sweep_task, idle_timeout_from_env, lifecycle_subscriber_task, SWEEP_INTERVAL_SECS,
};
pub use network::proxy::init_proxy_from_db;
mod app_error;
pub mod app_state;
pub mod automation;
pub mod backgrounds;
pub mod chat_channel;
pub mod commands;
pub mod db;
pub mod folder_links;
pub mod forge;
pub mod git_credential;
pub mod git_repo;
pub mod intern;
pub mod keyring_store;
pub mod logging;
pub mod models;
mod network;
pub mod office_watch;
pub mod parsers;
pub mod paths;
pub mod pet_state_mapper;
pub mod pets;

pub mod process;
mod session_title;
pub mod supervise;
mod terminal;
pub mod turn_timings;
pub mod update;
pub mod web;
pub mod work_task;
pub mod workspace_state;
pub mod workspace_transfer;

/// Sweep stale ACP binary cache trash created by the rename-aside fallback in
/// `acp::binary_cache::clear_agent_cache`. Safe to call any time; intended to
/// be invoked once at startup from a detached OS thread. Does not block, does
/// not panic, errors are silently dropped.
pub fn sweep_acp_binary_trash() {
    crate::acp::binary_cache::sweep_trash();
}
