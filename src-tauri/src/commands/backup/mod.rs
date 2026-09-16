//! Data backup and restore engine.
//!
//! Runtime-independent operations accept a database connection, event emitter,
//! and cancellation token. Electron and server HTTP handlers use the same code.

pub mod archive;
pub mod core;
pub mod crypto;
pub mod external;
pub mod manifest;
pub mod restore;
pub mod sections;
pub mod source;

use std::collections::BTreeMap;

use crate::app_error::{
    AppCommandError, BACKUP_I18N_KEY_CANCELLED, BACKUP_I18N_KEY_CORRUPTED,
    BACKUP_I18N_KEY_DISK_SPACE, BACKUP_I18N_KEY_NEWER_VERSION, BACKUP_I18N_KEY_UNKNOWN_FORMAT,
};

/// Map an I/O error to a friendlier "out of disk space" error when it is an
/// `ENOSPC` (Unix 28) / `ERROR_DISK_FULL` (Windows 112) / `ERROR_HANDLE_DISK_FULL`
/// (39); otherwise fall through to the generic I/O mapping. Used at the bulk
/// write boundaries (archive assembly, archive delivery) where running out of
/// space is the most likely failure on large backups.
pub(crate) fn map_disk_full(e: std::io::Error) -> AppCommandError {
    if matches!(e.raw_os_error(), Some(28) | Some(39) | Some(112)) {
        return AppCommandError::io_error("Not enough disk space")
            .with_i18n(BACKUP_I18N_KEY_DISK_SPACE, BTreeMap::new());
    }
    AppCommandError::io(e)
}

/// User cancelled the operation mid-flight.
pub(crate) fn cancelled_error() -> AppCommandError {
    AppCommandError::task_execution_failed("Backup operation cancelled")
        .with_i18n(BACKUP_I18N_KEY_CANCELLED, BTreeMap::new())
}

/// The file is not a codeg backup, or its layout version is too new.
pub(crate) fn unknown_format_error() -> AppCommandError {
    AppCommandError::invalid_input("Not a recognized MaxCode backup archive")
        .with_i18n(BACKUP_I18N_KEY_UNKNOWN_FORMAT, BTreeMap::new())
}

/// An entry's bytes did not match the manifest checksum.
pub(crate) fn corrupted_error() -> AppCommandError {
    AppCommandError::invalid_input("Backup archive is corrupted (checksum mismatch)")
        .with_i18n(BACKUP_I18N_KEY_CORRUPTED, BTreeMap::new())
}

/// The backup was taken by a newer app version whose schema we can't represent.
pub(crate) fn newer_version_error(backup_version: &str, app_version: &str) -> AppCommandError {
    let mut params = BTreeMap::new();
    params.insert("backupVersion".to_string(), backup_version.to_string());
    params.insert("appVersion".to_string(), app_version.to_string());
    AppCommandError::invalid_input("Backup was created by a newer version of MaxCode")
        .with_i18n(BACKUP_I18N_KEY_NEWER_VERSION, params)
}
