//! MaxCode-owned paths and one-time, copy-only migration from its old namespace.
//! Agent homes (Claude, Codex, etc.) deliberately remain outside this module.
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const APP_DIRECTORY: &str = "app.maxcode";
pub const HOME_DIRECTORY: &str = ".maxcode";
pub const KEYRING_SERVICE: &str = "maxcode";
pub const MIGRATION_MARKER: &str = ".maxcode-imported-from-codeg.json";
const COMPLETE_MARKER: &str = ".maxcode-layout-complete";

/// Prefer a MaxCode override; CODEG_* is retained as an explicit compatibility alias.
pub fn env_path(name: &str) -> Option<PathBuf> {
    let own = name.replacen("CODEG_", "MAXCODE_", 1);
    std::env::var_os(own)
        .filter(|v| !v.is_empty())
        .or_else(|| std::env::var_os(name).filter(|v| !v.is_empty()))
        .map(PathBuf::from)
}

/// Call only in the single-threaded executable bootstrap.
pub fn normalize_environment() {
    for alias in ["CODEG_DATA_DIR", "CODEG_HOME"] {
        if let Some(value) = env_path(alias) {
            std::env::set_var(alias, value);
        }
    }
}

pub fn desktop_data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|p| p.join(APP_DIRECTORY))
}

/// Electron supplies a legacy source only when using its default data directory.
/// Explicit operator directories and smoke tests are never implicitly imported.
pub fn migrate_desktop_layout(target: &Path, source: &Path) -> io::Result<()> {
    if target.join(COMPLETE_MARKER).exists() {
        return Ok(());
    }
    if !source.join("codeg.db").is_file() {
        return Ok(());
    }
    if target.exists() && !target.join(MIGRATION_MARKER).is_file() {
        return Ok(()); // Existing MaxCode data always wins, including an empty directory.
    }
    let mut pairs = vec![(source.to_path_buf(), target.to_path_buf())];
    if env_path("CODEG_HOME").is_none() {
        if let Some(home) = dirs::home_dir() {
            pairs.push((home.join(".codeg"), home.join(HOME_DIRECTORY)));
        }
    }
    if let Some(local) = dirs::data_local_dir() {
        pairs.push((local.join("app.codeg"), local.join(APP_DIRECTORY)));
    }
    if let Some(cache) = dirs::cache_dir() {
        pairs.push((cache.join("app.codeg"), cache.join(APP_DIRECTORY)));
    }
    pairs.dedup();
    migrate_pairs(target, &pairs)
}

fn migrate_pairs(target: &Path, pairs: &[(PathBuf, PathBuf)]) -> io::Result<()> {
    // Stage each root independently. A successful root has an import marker;
    // on a retry it is retained, never merged over newer destination data.
    for (old, new) in pairs {
        copy_legacy_root(old, new, pairs)?;
    }
    fs::write(target.join(COMPLETE_MARKER), b"1\n")
}

fn io_error(error: impl std::fmt::Display) -> io::Error {
    io::Error::other(error.to_string())
}

fn create_private_dir(path: &Path) -> io::Result<()> {
    fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

/// Publish a complete copy only. Never rename, delete, open for writing or
/// repair the source; never follow its external symlinks or copy pending restores.
fn copy_legacy_root(
    source: &Path,
    target: &Path,
    mappings: &[(PathBuf, PathBuf)],
) -> io::Result<bool> {
    if target.exists() || !source.exists() {
        return Ok(false);
    }
    if fs::symlink_metadata(source)?.file_type().is_symlink() {
        return Err(io_error(
            "Legacy data root is a symlink; use an explicit isolated data directory",
        ));
    }
    let parent = target
        .parent()
        .ok_or_else(|| io_error("Missing destination parent"))?;
    fs::create_dir_all(parent)?;
    let lock_path = parent.join(format!(
        ".{}-import.lock",
        target.file_name().unwrap().to_string_lossy()
    ));
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(lock_path)?;
    lock.try_lock().map_err(io_error)?;
    if target.exists() {
        return Ok(false);
    }
    let staged = parent.join(format!(".maxcode-import-{}", uuid::Uuid::new_v4()));
    create_private_dir(&staged)?;
    let result = (|| {
        copy_tree(source, &staged, source, target, mappings)?;
        let database = staged.join("codeg.db");
        if database.is_file() {
            relocate_database(&database, mappings)?;
        }
        fs::write(
            staged.join(MIGRATION_MARKER),
            serde_json::to_vec(&serde_json::json!({
                "source": source, "destination": target, "version": 1
            }))
            .map_err(io_error)?,
        )?;
        // rename cannot replace a populated destination. The per-root lock also
        // prevents another MaxCode migration from publishing an empty root first.
        fs::rename(&staged, target)?;
        Ok(true)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(staged);
    }
    result
}

fn copy_tree(
    source: &Path,
    target: &Path,
    root: &Path,
    final_root: &Path,
    mappings: &[(PathBuf, PathBuf)],
) -> io::Result<()> {
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let name = entry.file_name();
        let name_text = name.to_string_lossy();
        if name_text.starts_with(".codeg-restore")
            || name_text.starts_with(".codeg-swap")
            || name_text.starts_with(".codeg-backup-tmp")
            || name_text.starts_with(".maxcode-import")
            || (source == root
                && matches!(
                    name_text.as_ref(),
                    "codeg.db-wal" | "codeg.db-shm" | "codeg.db-journal"
                ))
        {
            continue;
        }
        let src = entry.path();
        let dest = target.join(&name);
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            let resolved = match fs::canonicalize(&src) {
                Ok(resolved) => resolved,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error),
            };
            let resolved_root = fs::canonicalize(root)?;
            if !resolved.starts_with(&resolved_root) {
                continue; // A central store must not write through into another product.
            }
            // Rebase relative links too: ../../app.codeg/file can resolve
            // inside the old root yet escape the copy back into Codeg.
            let link = final_root.join(resolved.strip_prefix(&resolved_root).map_err(io_error)?);
            #[cfg(unix)]
            std::os::unix::fs::symlink(link, &dest)?;
            #[cfg(windows)]
            if resolved.is_dir() {
                std::os::windows::fs::symlink_dir(link, &dest)?;
            } else {
                std::os::windows::fs::symlink_file(link, &dest)?;
            }
        } else if kind.is_dir() {
            create_private_dir(&dest)?;
            copy_tree(&src, &dest, root, final_root, mappings)?;
        } else if kind.is_file() {
            if source == root && name_text == "codeg.db" {
                let db = rusqlite::Connection::open_with_flags(
                    &src,
                    rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
                )
                .map_err(io_error)?;
                db.busy_timeout(Duration::from_secs(5)).map_err(io_error)?;
                db.backup(rusqlite::DatabaseName::Main, &dest, None)
                    .map_err(io_error)?;
            } else {
                fs::copy(&src, &dest)?;
                let relative = src.strip_prefix(root).map_err(io_error)?;
                let owned_json = source == root
                    && (name_text.ends_with(".json")
                        || name_text.starts_with("git-credential-codeg.")
                        || name_text.starts_with("git-askpass."));
                let transcript =
                    relative.starts_with("acp-transcripts") && name_text.ends_with(".jsonl");
                if (owned_json || transcript) && fs::metadata(&dest)?.len() <= 16 * 1024 * 1024 {
                    if let Ok(text) = fs::read_to_string(&dest) {
                        let relocated = relocate_text(&text, mappings);
                        if relocated != text {
                            fs::write(&dest, relocated)?;
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

/// Only complete path components are replaced, including JSON and file-URI forms.
fn relocate_text(text: &str, mappings: &[(PathBuf, PathBuf)]) -> String {
    let mut result = text.to_owned();
    for (old, new) in mappings {
        let mut forms = vec![(
            old.to_string_lossy().into_owned(),
            new.to_string_lossy().into_owned(),
        )];
        if let (Ok(old), Ok(new)) = (
            url::Url::from_directory_path(old),
            url::Url::from_directory_path(new),
        ) {
            forms.push((
                old.as_str().trim_end_matches('/').into(),
                new.as_str().trim_end_matches('/').into(),
            ));
        }
        let raw = forms[0].clone();
        forms.push((
            serde_json::to_string(&raw.0)
                .unwrap()
                .trim_matches('"')
                .into(),
            serde_json::to_string(&raw.1)
                .unwrap()
                .trim_matches('"')
                .into(),
        ));
        for (old, new) in forms {
            if result == old {
                result = new;
                continue;
            }
            for suffix in ["/", "\\", "\"", "'"] {
                result = result.replace(&format!("{old}{suffix}"), &format!("{new}{suffix}"));
            }
        }
    }
    result
}

fn relocate_database(path: &Path, mappings: &[(PathBuf, PathBuf)]) -> io::Result<()> {
    let mut db = rusqlite::Connection::open(path).map_err(io_error)?;
    let transaction = db.transaction().map_err(io_error)?;
    let tables = {
        let mut stmt = transaction.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'seaql_migrations'").map_err(io_error)?;
        let values = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(io_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(io_error)?;
        values
    };
    for table in tables {
        let quote = |s: &str| format!("\"{}\"", s.replace('"', "\"\""));
        let table = quote(&table);
        let columns = {
            let mut stmt = transaction
                .prepare(&format!("PRAGMA table_info({table})"))
                .map_err(io_error)?;
            let values = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(1)?, row.get::<_, String>(2)?))
                })
                .map_err(io_error)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(io_error)?;
            values
        };
        for (column, kind) in columns {
            if !(kind.to_ascii_uppercase().contains("TEXT")
                || kind.to_ascii_uppercase().contains("CHAR"))
            {
                continue;
            }
            // Preserve arbitrary schemas, primary keys and ROWIDs; update only text cells.
            let column = quote(&column);
            let values = {
                let mut stmt = transaction
                    .prepare(&format!(
                        "SELECT DISTINCT {column} FROM {table} WHERE typeof({column})='text'"
                    ))
                    .map_err(io_error)?;
                let values = stmt
                    .query_map([], |row| row.get::<_, String>(0))
                    .map_err(io_error)?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(io_error)?;
                values
            };
            for old in values {
                let new = relocate_text(&old, mappings);
                if old != new {
                    transaction
                        .execute(
                            &format!("UPDATE {table} SET {column}=?1 WHERE {column}=?2"),
                            [&new, &old],
                        )
                        .map_err(io_error)?;
                }
            }
        }
    }
    // Imported desktop web services must not automatically contend with the
    // other application's listener. Custom ports remain available for manual use.
    if transaction
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='app_metadata'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(io_error)?
        > 0
    {
        transaction
            .execute(
                "UPDATE app_metadata SET value='false' WHERE key='web_service_auto_start'",
                [],
            )
            .map_err(io_error)?;
        transaction.execute("UPDATE app_metadata SET value='3081' WHERE key='web_service_port' AND value='3080'", []).map_err(io_error)?;
        transaction.execute("DELETE FROM app_metadata WHERE key IN ('web_service_token','web_service_public_share_url')", []).map_err(io_error)?;
    }
    transaction.commit().map_err(io_error)
}

#[cfg(test)]
#[path = "../../src/maxcode-contracts/product-namespace.contract.rs"]
mod contract;
