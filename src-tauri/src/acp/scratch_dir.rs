//! Per-launch scratch directories for ACP agent processes.
//!
//! # Why
//!
//! Some agent binaries are self-extracting archives that unpack into the system
//! temp directory on every launch and only clean up on a GRACEFUL exit. codeg
//! ends agent processes with `kill_tree`, which on Windows terminates
//! unconditionally, so that cleanup never runs. The Antigravity ACP server is
//! the acute case: its Windows build is a PyInstaller *onefile* whose archive
//! unpacks to **1.17 GB** per launch (verified against the shipped binary: 8261
//! TOC entries, 1192.3 MB of `b` entries plus an 8.7 MB PYZ). One user
//! accumulated 113 orphaned `%TEMP%\_MEI*` directories totalling 107.70 GB in
//! seven days and ran their system drive out of space.
//!
//! The lever is entirely host-side. The PyInstaller bootloader resolves its
//! extraction root through `GetTempPathW` (confirmed: the shipped bootloader
//! imports `GetTempPathW` and not `GetTempPath2W`, and the archive carries no
//! `pyi-runtime-tmpdir` option), and `GetTempPathW` reads `TMP`, then `TEMP`,
//! then `USERPROFILE`. Pointing those at a directory codeg owns turns an
//! unbounded leak into a directory codeg can delete.
//!
//! macOS is the same bug two orders of magnitude smaller: that build is not
//! PyInstaller, but it still drops ~172 KB of read-only resource files into
//! `TMPDIR` per launch and still leaks them when killed. So the isolation is
//! applied to every agent launch on every platform rather than special-cased.
//!
//! # Invariants
//!
//! Three ordering rules make the sweeps sound without holding a lock across a
//! multi-gigabyte delete:
//!
//! 1. **Register before `mkdir`.** There is no instant at which a scratch
//!    directory exists on disk without already being in [`REGISTRY`].
//! 2. **Unregister only after the directory is gone** (or after the retry
//!    ladder gives up, at which point it is by definition no longer live).
//! 3. **Diff under the lock, delete outside it.** A sweep enumerates, diffs and
//!    claims under the mutex, then releases it before deleting.
//!
//! Together those mean a directory created after a sweep's snapshot was
//! registered *before* it appeared on disk, so it cannot have been in the diff;
//! and a creation landing between the unlock and the delete cannot collide,
//! because names carry a fresh random suffix and are created with `create_dir`
//! (which fails on an existing name).

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

/// Directory under the temp root that codeg owns outright. Every sweep is
/// confined to this subtree, which is what makes it safe to delete without
/// asking: `%TEMP%` itself is a namespace shared with every other application,
/// but nothing except codeg writes here.
const SCRATCH_NAMESPACE: &str = "codeg-acp";

/// Opt out of isolation entirely and let the child inherit the ambient
/// `TMP`/`TEMP`/`TMPDIR` the way it did before this module existed. Escape
/// hatch for an agent that turns out to depend on a shared temp directory.
const ISOLATION_ENV: &str = "CODEG_ACP_TMP_ISOLATION";

/// Override for the scratch root. Set it to place the (potentially very large)
/// extraction churn on a different volume.
const ROOT_ENV: &str = "CODEG_ACP_TMP_ROOT";

/// The three names a child consults for its temp directory. All are set
/// together: `GetTempPathW` reads `TMP` before `TEMP`, so setting only one
/// leaves the other able to win.
pub(crate) const TEMP_ENV_KEYS: [&str; 3] = ["TMP", "TEMP", "TMPDIR"];

/// How many times removal is retried before the directory is left to the
/// sweeps. `kill_tree` signals a process tree without waiting for it, so the
/// first attempt can land while a descendant still holds an extracted file
/// open — on Windows that is a sharing violation, not a transient blip, and it
/// clears only once the descendant actually dies.
const REMOVE_ATTEMPTS: u32 = 5;

/// Delay before the first retry. Doubles each attempt, so the ladder spans
/// roughly a minute in total — comfortably longer than a process tree takes to
/// finish dying, and bounded so a directory can never pin a task forever.
const REMOVE_RETRY_BASE: Duration = Duration::from_millis(2_000);

/// How often the in-session sweep reclaims directories this process owns but
/// has lost track of. Independent of the ACP idle sweep on purpose: that task
/// is not spawned at all when `CODEG_ACP_IDLE_TIMEOUT_SECS=0`, and disabling
/// idle disconnects must not also disable disk reclamation.
pub const SWEEP_INTERVAL: Duration = Duration::from_secs(300);

/// Names of the scratch directories THIS process currently owns.
///
/// Authoritative for our own pid, which is the only thing that can distinguish
/// a live launch from an orphan left by a previous process that happened to
/// hold the same pid number. A pid probe cannot: it reports both as alive.
static REGISTRY: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn registry() -> &'static Mutex<HashSet<String>> {
    REGISTRY.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Whether launches get an isolated temp directory. On unless explicitly
/// disabled with `CODEG_ACP_TMP_ISOLATION=0`.
pub fn isolation_enabled() -> bool {
    !matches!(
        std::env::var(ISOLATION_ENV).as_deref(),
        Ok("0") | Ok("false") | Ok("FALSE") | Ok("off")
    )
}

/// The single directory under which every per-launch scratch dir is created.
///
/// Deliberately ONE root, not one per agent configuration. An earlier design
/// derived the root from a per-agent `env_json` `TMP` so a user could choose
/// the volume; that made the set of roots unbounded and not discoverable by a
/// crash sweep (change the setting, crash, and the old root keeps its
/// gigabytes forever). A per-agent `TMP` is therefore IGNORED while isolation
/// is on — see [`apply_to_env`].
pub fn scratch_root() -> PathBuf {
    let base = std::env::var_os(ROOT_ENV)
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    base.join(SCRATCH_NAMESPACE)
}

/// A scratch directory owned by one agent launch.
///
/// Cleanup lives in `Drop`, and that is load-bearing rather than idiomatic
/// tidiness. The handle travels inside an `on_exit` callback and across `.await`
/// points in the sign-in path, so there are real ways for it to be destroyed
/// without anyone calling [`LaunchScratch::release`]: the callback is dropped
/// because the connection never produced a reap, or an HTTP handler's future is
/// cancelled when the client disconnects. Without `Drop` those paths leak twice
/// over — the directory stays on disk AND its name stays in [`REGISTRY`], which
/// makes [`sweep_own_orphans`] skip it for the life of the process. `release`
/// exists to say "the process is reaped, now is the right time", and is the
/// only path that does not warn.
///
/// Deliberately NOT `Clone`: `Drop` running twice for one directory could
/// unregister a name a later launch had since been given, which is the one way
/// the sweep's set arithmetic could be made to delete a directory in use.
#[derive(Debug)]
pub struct LaunchScratch {
    name: String,
    path: PathBuf,
    /// Set by [`LaunchScratch::release`] so `Drop` can tell a deliberate
    /// handback from an unwind. Does not change WHAT is done, only whether it
    /// is reported as a bug.
    released: bool,
}

impl LaunchScratch {
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Give the directory back. Returns immediately: the bounded retry ladder
    /// goes onto the current runtime, so teardown never waits on a filesystem
    /// that may be holding a sharing violation.
    ///
    /// The work itself is in `Drop` — see the type docs for why that is not
    /// merely a refactor.
    pub fn release(mut self) {
        self.released = true;
    }
}

impl Drop for LaunchScratch {
    fn drop(&mut self) {
        if !self.released {
            tracing::warn!(
                "[ACP][scratch] {} was dropped without release (a cancelled \
                 request, or a connection that never reported a reap); \
                 cleaning up anyway",
                self.path.display()
            );
        }
        let name = std::mem::take(&mut self.name);
        let path = std::mem::take(&mut self.path);
        match tokio::runtime::Handle::try_current() {
            Ok(handle) => {
                handle.spawn(async move { remove_with_retries(name, path).await });
            }
            Err(_) => {
                // No runtime to retry on — one attempt, then hand the name back
                // REGARDLESS. Keeping it would make this directory invisible to
                // every in-session sweep, which is the one outcome worse than a
                // failed delete: the sweep is now its only remaining chance.
                if let Err(e) = remove_dir_robust(&path) {
                    tracing::warn!(
                        "[ACP][scratch] could not remove {} off-runtime: {e}; \
                         left for the sweep",
                        path.display()
                    );
                }
                unregister(&name);
            }
        }
    }
}

/// The bounded removal ladder. A free function rather than a method because
/// `Drop` cannot move `self`, and because every exit unregisters — see
/// [`LaunchScratch`].
async fn remove_with_retries(name: String, path: PathBuf) {
    let mut delay = REMOVE_RETRY_BASE;
    for attempt in 1..=REMOVE_ATTEMPTS {
        match remove_dir_robust(&path) {
            Ok(()) => {
                unregister(&name);
                return;
            }
            Err(e) if attempt == REMOVE_ATTEMPTS => {
                // Give the name up even though the directory survives: the
                // launch is over, so holding it in the registry would only
                // hide it from the sweep that is now its best chance.
                tracing::warn!(
                    "[ACP][scratch] giving up on {} after {attempt} attempts: {e}; \
                     left for the sweep",
                    path.display()
                );
                unregister(&name);
                return;
            }
            Err(_) => {
                tokio::time::sleep(delay).await;
                delay *= 2;
            }
        }
    }
}

/// Create a scratch directory for one launch, or `None` when isolation is off
/// or the directory cannot be created.
///
/// `None` is a normal outcome, not an error: the caller leaves
/// `TMP`/`TEMP`/`TMPDIR` alone and the child uses the system temp directory
/// exactly as it did before. A launch must never fail because codeg could not
/// make a scratch directory — and it WOULD fail if the variables were set to a
/// path that does not exist, because the PyInstaller bootloader only creates
/// its own `_MEIxxxxxx` leaf, not the parents above it.
pub fn create() -> Option<LaunchScratch> {
    if !isolation_enabled() {
        return None;
    }
    let root = scratch_root();
    if let Err(e) = std::fs::create_dir_all(&root) {
        tracing::warn!(
            "[ACP][scratch] cannot create {}: {e}; launching on the system temp dir",
            root.display()
        );
        return None;
    }

    for _ in 0..8 {
        let name = new_dir_name(std::process::id());
        // INVARIANT 1: registered before it can exist on disk.
        if !register(&name) {
            continue;
        }
        let path = root.join(&name);
        match std::fs::create_dir(&path) {
            Ok(()) => {
                return Some(LaunchScratch {
                    name,
                    path,
                    released: false,
                })
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                unregister(&name);
                continue;
            }
            Err(e) => {
                unregister(&name);
                tracing::warn!(
                    "[ACP][scratch] cannot create {}: {e}; launching on the system temp dir",
                    path.display()
                );
                return None;
            }
        }
    }
    None
}

/// Point a merged agent environment at `scratch`.
///
/// MUST be applied after every other contributor, `runtime_env` included.
/// Precedence is the whole fix: `GetTempPathW` reads `TMP` first, so a
/// per-agent `env_json` `TMP` left in place would send the extraction wherever
/// it points while codeg deleted an empty scratch directory and reported
/// success. Users who want the churn elsewhere set [`ROOT_ENV`]; users who want
/// the old behavior wholesale set [`ISOLATION_ENV`] to `0`.
pub(crate) fn apply_to_env(env: &mut std::collections::BTreeMap<String, String>, scratch: &Path) {
    let value = scratch.to_string_lossy().into_owned();
    if cfg!(windows) {
        // Windows environment names are case-INSENSITIVE, but this map is not.
        // A per-agent `env_json` spelling it `tmp` would survive alongside the
        // `TMP` inserted below, and the child would then see two spellings of
        // one variable with only one of them pointing at the scratch dir —
        // silently reopening the very leak this module closes. Drop every
        // case variant first so the canonical name is the only one left.
        //
        // Unix is the opposite: `tmp` and `TMP` really are different variables
        // there, so removing one would be destroying an unrelated setting.
        env.retain(|key, _| {
            !TEMP_ENV_KEYS
                .iter()
                .any(|canonical| key.eq_ignore_ascii_case(canonical))
        });
    }
    for key in TEMP_ENV_KEYS {
        env.insert(key.to_string(), value.clone());
    }
}

/// Reclaim scratch directories belonging to THIS process that are no longer
/// live — a launch whose removal ladder was exhausted, or one left by a
/// previous process that held the same pid number.
///
/// Exact set arithmetic, no heuristic: a live launch is in the registry by
/// construction (invariant 1), so it can never appear in the diff.
pub fn sweep_own_orphans() {
    let root = scratch_root();
    let our_pid = std::process::id();

    // INVARIANT 3: enumerate + diff under the lock...
    let claimed: Vec<PathBuf> = {
        let Ok(guard) = registry().lock() else {
            return;
        };
        let Ok(entries) = std::fs::read_dir(&root) else {
            return;
        };
        entries
            .flatten()
            .filter_map(|entry| {
                let name = entry.file_name().to_string_lossy().into_owned();
                (pid_from_dir_name(&name) == Some(our_pid) && !guard.contains(&name))
                    .then(|| entry.path())
            })
            .collect()
    };
    // ...delete outside it.
    for path in claimed {
        if remove_dir_robust(&path).is_ok() {
            tracing::info!("[ACP][scratch] reclaimed orphan {}", path.display());
        }
    }
}

/// Reclaim scratch directories left by OTHER codeg processes that have exited.
///
/// Runs at startup, where the interesting orphans are the ones a crash or a
/// force-quit left behind. Deletes only on a positively confirmed dead owner —
/// see [`probe_pid`] for why "the probe failed" must not be read as "the owner
/// is gone".
pub fn sweep_foreign_orphans() {
    let root = scratch_root();
    let our_pid = std::process::id();
    let Ok(entries) = std::fs::read_dir(&root) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(pid) = pid_from_dir_name(&name) else {
            continue;
        };
        // Our own pid is `sweep_own_orphans`' business; it is the only caller
        // that can tell a live launch from an orphan.
        if pid == our_pid {
            continue;
        }
        if probe_pid(pid) != PidState::Dead {
            continue;
        }
        let path = entry.path();
        if remove_dir_robust(&path).is_ok() {
            tracing::info!(
                "[ACP][scratch] reclaimed orphan {} from dead pid {pid}",
                path.display()
            );
        }
    }
}

/// Long-running task: [`sweep_own_orphans`] on a fixed interval. Spawned by
/// both runtimes at startup; never returns.
pub async fn scratch_sweep_task() {
    let mut ticker = tokio::time::interval(SWEEP_INTERVAL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    ticker.tick().await; // the first tick is immediate; skip it
    loop {
        ticker.tick().await;
        let _ = tokio::task::spawn_blocking(sweep_own_orphans).await;
    }
}

/// What a pid probe established. The third state is the point: a probe that
/// FAILED tells us nothing, and must not be collapsed into "dead" by a caller
/// that is about to delete something.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PidState {
    Alive,
    Dead,
    Unknown,
}

/// Tri-state liveness probe.
///
/// Deliberately NOT `delegation::parent_watcher::parent_alive`, which answers a
/// bool and treats every `OpenProcess` failure as "gone". That is correct for
/// its own caller — a child watching its own parent in the same session, where
/// access-denied cannot happen — and wrong here, where one codeg instance is
/// asking about another and an indeterminate answer must NOT authorize a
/// delete.
pub fn probe_pid(pid: u32) -> PidState {
    if pid == 0 {
        return PidState::Unknown;
    }
    #[cfg(unix)]
    {
        // `kill(pid, 0)` sends no signal; the kernel just validates the target.
        if unsafe { libc::kill(pid as libc::pid_t, 0) } == 0 {
            return PidState::Alive;
        }
        match std::io::Error::last_os_error().raw_os_error() {
            Some(e) if e == libc::ESRCH => PidState::Dead,
            // Alive, just owned by somebody else.
            Some(e) if e == libc::EPERM => PidState::Alive,
            _ => PidState::Unknown,
        }
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{
            CloseHandle, GetLastError, ERROR_INVALID_PARAMETER, STILL_ACTIVE,
        };
        use windows_sys::Win32::System::Threading::{
            GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };

        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() {
            // ERROR_INVALID_PARAMETER is the one failure that positively means
            // "no such pid". Access-denied and everything else mean the process
            // may well be running and we simply cannot see it.
            return if unsafe { GetLastError() } == ERROR_INVALID_PARAMETER {
                PidState::Dead
            } else {
                PidState::Unknown
            };
        }
        let mut code: u32 = 0;
        let read_ok = unsafe { GetExitCodeProcess(handle, &mut code as *mut u32) };
        unsafe {
            let _ = CloseHandle(handle);
        }
        if read_ok == 0 {
            return PidState::Unknown;
        }
        if code == STILL_ACTIVE as u32 {
            PidState::Alive
        } else {
            PidState::Dead
        }
    }
}

/// `<owning codeg pid>-<8 hex>`.
///
/// The pid is CODEG'S, not the agent's: the directory is created before the
/// spawn, so the agent has no pid yet. It is what lets a startup sweep tell
/// "some other codeg owns this" from "its owner is gone".
fn new_dir_name(pid: u32) -> String {
    let suffix: String = uuid::Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(8)
        .collect();
    format!("{pid}-{suffix}")
}

/// Inverse of [`new_dir_name`]. `None` for anything that does not match the
/// shape, so a stray file or a directory some other tool created is skipped
/// rather than deleted.
fn pid_from_dir_name(name: &str) -> Option<u32> {
    let (pid, suffix) = name.split_once('-')?;
    if suffix.len() != 8 || !suffix.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    pid.parse().ok()
}

/// `true` when the name was newly inserted.
fn register(name: &str) -> bool {
    registry()
        .lock()
        .map(|mut g| g.insert(name.to_string()))
        .unwrap_or(false)
}

fn unregister(name: &str) {
    if let Ok(mut g) = registry().lock() {
        g.remove(name);
    }
}

/// `remove_dir_all` plus one recovery pass for read-only children.
///
/// Windows refuses to delete a file carrying `FILE_ATTRIBUTE_READONLY`, and
/// read-only extracted payloads are not hypothetical — the macOS Antigravity
/// build writes its cached CA bundles as `r-xr-xr-x`. On Unix the attribute is
/// irrelevant to deletion (write permission on the PARENT is what matters), so
/// the recovery pass is a no-op there and the first call already succeeded.
fn remove_dir_robust(path: &Path) -> std::io::Result<()> {
    match std::fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(first) => {
            if clear_readonly_recursive(path).is_err() {
                return Err(first);
            }
            std::fs::remove_dir_all(path).or_else(|second| {
                if second.kind() == std::io::ErrorKind::NotFound {
                    Ok(())
                } else {
                    Err(second)
                }
            })
        }
    }
}

fn clear_readonly_recursive(path: &Path) -> std::io::Result<()> {
    let meta = std::fs::symlink_metadata(path)?;
    let mut perms = meta.permissions();
    if perms.readonly() {
        #[allow(clippy::permissions_set_readonly_false)]
        perms.set_readonly(false);
        let _ = std::fs::set_permissions(path, perms);
    }
    // Never follow a symlink out of the tree we are clearing.
    if meta.is_dir() && !meta.file_type().is_symlink() {
        for entry in std::fs::read_dir(path)?.flatten() {
            let _ = clear_readonly_recursive(&entry.path());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dir_name_round_trips_through_the_pid_parser() {
        let name = new_dir_name(4242);
        assert_eq!(pid_from_dir_name(&name), Some(4242));
    }

    #[test]
    fn dir_name_suffix_is_eight_hex_chars() {
        let name = new_dir_name(1);
        let (_, suffix) = name.split_once('-').expect("name must carry a suffix");
        assert_eq!(suffix.len(), 8);
        assert!(suffix.chars().all(|c| c.is_ascii_hexdigit()));
    }

    /// Anything that is not ours is skipped rather than deleted — the sweeps
    /// only ever touch names they can prove they minted.
    #[test]
    fn pid_parser_rejects_foreign_names() {
        for name in [
            "_MEI123456",     // another PyInstaller app
            "not-a-pid",      // suffix is not hex
            "123-abc",        // suffix too short
            "123-0123456789", // suffix too long
            "123",            // no suffix at all
            "",               // empty
            "-deadbeef",      // no pid
        ] {
            assert_eq!(pid_from_dir_name(name), None, "{name} must not parse");
        }
    }

    #[test]
    fn registering_the_same_name_twice_fails() {
        let name = new_dir_name(std::process::id());
        assert!(register(&name));
        assert!(!register(&name));
        unregister(&name);
        assert!(register(&name));
        unregister(&name);
    }

    /// Our own live pid is always `Alive`, and the probe never answers `Dead`
    /// for it — the case that would let a sweep delete a running launch.
    #[test]
    fn probe_reports_our_own_process_alive() {
        assert_eq!(probe_pid(std::process::id()), PidState::Alive);
    }

    #[test]
    fn probe_never_claims_pid_zero_is_dead() {
        assert_eq!(probe_pid(0), PidState::Unknown);
    }

    fn is_registered(name: &str) -> bool {
        registry().lock().map(|g| g.contains(name)).unwrap_or(false)
    }

    /// The failure this guards is silent and permanent: a handle destroyed
    /// without `release` (a cancelled HTTP request, an `on_exit` callback
    /// dropped because the connection never reported a reap) used to leave its
    /// name in `REGISTRY` forever, and `sweep_own_orphans` skips every
    /// registered name — so the directory became invisible to the one thing
    /// that would have reclaimed it.
    #[test]
    fn dropping_without_release_still_hands_the_name_back() {
        let dir = tempfile::tempdir().expect("tempdir");
        let name = new_dir_name(std::process::id());
        let path = dir.path().join(&name);
        std::fs::create_dir(&path).expect("create");
        assert!(register(&name));

        drop(LaunchScratch {
            name: name.clone(),
            path: path.clone(),
            released: false,
        });

        assert!(
            !is_registered(&name),
            "a dropped name must not stay claimed"
        );
        assert!(!path.exists(), "and the directory must be gone");
    }

    /// `release` is the same cleanup, just without the "somebody forgot" log.
    #[test]
    fn release_removes_the_directory_and_the_registration() {
        let dir = tempfile::tempdir().expect("tempdir");
        let name = new_dir_name(std::process::id());
        let path = dir.path().join(&name);
        std::fs::create_dir(&path).expect("create");
        assert!(register(&name));

        LaunchScratch {
            name: name.clone(),
            path: path.clone(),
            released: false,
        }
        .release();

        assert!(!is_registered(&name));
        assert!(!path.exists());
    }

    /// Windows env names are case-insensitive while this map is not, so a
    /// per-agent `tmp` would ride along beside the injected `TMP` and the child
    /// could read either. Unix is the opposite case: there the two really are
    /// different variables and dropping one would destroy a setting.
    #[test]
    fn a_case_variant_temp_key_cannot_shadow_the_scratch_dir() {
        let mut env = std::collections::BTreeMap::new();
        env.insert("tmp".to_string(), "/somewhere/else".to_string());
        env.insert("Temp".to_string(), "/somewhere/else".to_string());
        env.insert("UNRELATED".to_string(), "keep me".to_string());

        apply_to_env(&mut env, Path::new("/scratch/abc"));

        assert_eq!(env.get("UNRELATED").map(String::as_str), Some("keep me"));
        for key in TEMP_ENV_KEYS {
            assert_eq!(env.get(key).map(String::as_str), Some("/scratch/abc"));
        }
        for variant in ["tmp", "Temp"] {
            assert_eq!(
                env.contains_key(variant),
                !cfg!(windows),
                "{variant} must be dropped on Windows and kept on Unix"
            );
        }
    }

    #[test]
    fn apply_to_env_sets_all_three_names() {
        let mut env = std::collections::BTreeMap::new();
        // A per-agent value that would otherwise win: `GetTempPathW` reads
        // `TMP` first, so leaving this in place would silently defeat the
        // isolation.
        env.insert("TMP".to_string(), "/somewhere/else".to_string());
        apply_to_env(&mut env, Path::new("/scratch/abc"));
        for key in TEMP_ENV_KEYS {
            assert_eq!(env.get(key).map(String::as_str), Some("/scratch/abc"));
        }
    }

    #[test]
    fn remove_dir_robust_tolerates_a_missing_directory() {
        let dir = tempfile::tempdir().expect("tempdir");
        let missing = dir.path().join("never-existed");
        assert!(remove_dir_robust(&missing).is_ok());
    }

    #[test]
    fn remove_dir_robust_deletes_read_only_children() {
        let dir = tempfile::tempdir().expect("tempdir");
        let target = dir.path().join("payload");
        std::fs::create_dir_all(target.join("nested")).expect("create nested");
        let file = target.join("nested").join("cacert.pem");
        std::fs::write(&file, b"x").expect("write");
        let mut perms = std::fs::metadata(&file).expect("meta").permissions();
        perms.set_readonly(true);
        std::fs::set_permissions(&file, perms).expect("set readonly");

        assert!(remove_dir_robust(&target).is_ok());
        assert!(!target.exists());
    }
}
