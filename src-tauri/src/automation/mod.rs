//! Automation execution engine (distinct from `commands::automation`, which is
//! the CRUD surface). One engine per process, built at boot in both desktop and
//! server mode; see [`engine`].

pub mod engine;
pub mod messages;

pub use engine::{build_engine, engine, run_automation_engine, AutomationEngine};
