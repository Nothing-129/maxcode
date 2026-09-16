use std::future::IntoFuture;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use codeg_lib::app_state::AppState;
use codeg_lib::web::event_bridge::{EventEmitter, WebEventBroadcaster};
use codeg_lib::web::{
    addresses_for_bind, advertise_host, find_static_dir_standalone, resolve_persisted_server_token,
    WebServerState,
};

fn main() -> ExitCode {
    // Capture our own executable path before anything can rename it (an
    // in-place upgrade swaps the binary mid-run; `current_exe()` would then
    // resolve to a `" (deleted)"` path on Linux). Cheap, single-shot.
    codeg_lib::update::runtime::prime_self_exe();

    // Support --version flag
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--version" || a == "-V") {
        println!("{}", env!("CARGO_PKG_VERSION"));
        return ExitCode::SUCCESS;
    }

    let electron = if codeg_lib::update::runtime::is_electron() {
        match ElectronLaunch::validate(
            std::env::var("CODEG_HOST").ok().as_deref(),
            std::env::var("CODEG_TOKEN").ok().as_deref(),
            std::env::var_os("CODEG_ELECTRON_READY_FILE").map(PathBuf::from),
        ) {
            Ok(launch) if !args.iter().any(|arg| arg == "--supervise") => Some(launch),
            Ok(_) => {
                eprintln!(
                    "[SERVER] Electron owns the backend lifecycle; --supervise is unavailable"
                );
                return ExitCode::from(2);
            }
            Err(message) => {
                eprintln!("[SERVER] Invalid Electron launch: {message}");
                return ExitCode::from(2);
            }
        }
    } else {
        None
    };

    // `--supervise`: run as the process supervisor that owns the worker's
    // lifecycle (PID 1 in Docker). It spawns `codeg-server` without this
    // flag and relaunches it after an in-place upgrade. Never returns.
    if args.iter().any(|a| a == "--supervise") {
        // This mode never reaches init_server(); install a stderr-only
        // subscriber so the supervisor's diagnostics still reach Docker logs.
        let _log_guard = codeg_lib::logging::init::init_stderr_only();
        codeg_lib::supervise::run();
    }

    // When invoked as a git credential helper (by the script written via
    // `git_credential::create_credential_helper_script`), respond to git's
    // credential protocol on stdin and exit. Mirrors the desktop binary's
    // early-exit in `main.rs` so server deployments don't accidentally try
    // to start a second server instance per `git credential` invocation.
    if args.iter().any(|a| a == "--credential-helper") {
        // Subprocess mode, before init_server(): stderr-only subscriber so
        // helper diagnostics aren't dropped, while stdout stays the git
        // credential protocol channel.
        let _log_guard = codeg_lib::logging::init::init_stderr_only();
        codeg_lib::git_credential::run_credential_helper();
        return ExitCode::SUCCESS;
    }

    // PATH initialisation MUST happen before the tokio runtime is created.
    // std::env::set_var is not thread-safe (unsafe in Rust edition 2024);
    // #[tokio::main] would spawn worker threads before we reach this point.
    codeg_lib::process::ensure_node_in_path();
    codeg_lib::process::ensure_user_npm_prefix_in_path();

    // Resolve and pin `CODEG_DATA_DIR` before any threads exist.
    //
    // Two things matter here, both single-shot:
    //
    // 1. Absolutize: child processes (notably the credential helper
    //    subprocess invoked by git from inside the user's repo) inherit
    //    the env var and use it via `keyring_store::tokens_file_path` to
    //    find `tokens.json`. A relative `CODEG_DATA_DIR=data` would
    //    otherwise resolve against git's CWD, not the server's startup
    //    CWD, and the helper would silently miss the token file even
    //    though we found the database.
    //
    // 2. Fill in the default if unset, so every downstream resolver —
    //    `paths::codeg_uploads_root`, `paths::codeg_pets_root`,
    //    the credential subprocess — converges on the same root the
    //    server itself chose for the database. Without this, a default
    //    deployment (env var unset) puts the DB under
    //    `dirs::data_dir()/codeg` but uploads under `~/.codeg/uploads`,
    //    splitting the persistent surface across two filesystem roots
    //    and silently breaking single-volume backups, container mounts,
    //    and any `file://` URI in session history that points at an
    //    upload.
    //
    // `std::env::set_var` is not thread-safe (unsafe in Rust edition
    // 2024); doing this before the tokio runtime is built guarantees we
    // are still single-threaded.
    let resolved_data_dir = std::env::var("CODEG_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| default_data_dir());
    let resolved_data_dir = codeg_lib::git_credential::absolutize(&resolved_data_dir);
    std::env::set_var("CODEG_DATA_DIR", &resolved_data_dir);

    // Install the logging subscriber now that CODEG_DATA_DIR is pinned (the logs
    // dir resolves from it). Doing it here — before the first server diagnostic
    // below — captures even the CODEG_HOME warning and the FATAL upload-quota
    // abort. Hold the guard for the whole process so buffered file lines flush
    // on a graceful exit.
    let _log_guard = codeg_lib::logging::init::init_server();

    // `CODEG_HOME` overrides `CODEG_DATA_DIR` for uploads/pets inside
    // `paths::codeg_*_root` (legacy `~/.codeg/` layout). If both are set
    // and resolve to different roots, the database and uploads land on
    // different filesystems — a silent split. Warn loudly so the
    // operator notices before relying on a backup or volume mount that
    // only covers one of them.
    if let Some(home) = std::env::var_os("CODEG_HOME").filter(|s| !s.is_empty()) {
        let home_path = codeg_lib::git_credential::absolutize(std::path::Path::new(&home));
        if home_path != resolved_data_dir {
            tracing::warn!(
                "[paths][WARN] CODEG_HOME ({}) and CODEG_DATA_DIR ({}) point at different roots. \
                 Uploads/pets follow CODEG_HOME; the database follows CODEG_DATA_DIR. \
                 Unset one or align them to avoid split state.",
                home_path.display(),
                resolved_data_dir.display()
            );
        }
    }

    // Strict-mode quota validation runs before any I/O. Failing fast
    // here means a misconfigured strict deployment never reaches the
    // tokio runtime, never binds a port, and never persists config —
    // the operator sees the FATAL line and a clean exit code 2.
    codeg_lib::web::handlers::files::log_upload_quota_config_at_startup();
    if let Err(err) = codeg_lib::web::handlers::files::validate_upload_quota_config() {
        tracing::error!("[uploads][FATAL] {err}; aborting startup.");
        // Return (don't process::exit) so `_log_guard` drops on the way out and
        // flushes the non-blocking file appender before the process ends.
        return ExitCode::from(2);
    }

    // `main` returns the worker's exit code so `_log_guard` drops here — after
    // the runtime finishes — flushing any buffered file logs on a clean exit.
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("Failed to build tokio runtime")
        .block_on(async_main(electron))
}

async fn async_main(electron: Option<ElectronLaunch>) -> ExitCode {
    // Register shutdown handling during startup, before channels or ACP
    // sessions can launch children. A signal received while initializing is
    // retained until the main loop can clean up the shared managers.
    let electron_owned = electron.is_some();
    let mut shutdown_requested = tokio::spawn(async move {
        tokio::select! {
            _ = wait_for_shutdown() => {}
            _ = wait_for_electron_parent(electron_owned) => {}
        }
    });
    // Sweep stale ACP binary cache trash (rename-aside fallback artifacts).
    // Detached OS thread: cannot block startup, panics are caught and dropped,
    // errors are silenced, no subprocesses spawned.
    std::thread::spawn(|| {
        let _ = std::panic::catch_unwind(|| {
            codeg_lib::acp::binary_cache::migrate_legacy_root();
            codeg_lib::sweep_acp_binary_trash();
            codeg_lib::sweep_acp_scratch_dirs();
        });
    });

    let port: u16 = std::env::var("CODEG_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(3080);
    let host = if electron.is_some() {
        "127.0.0.1".to_string()
    } else {
        std::env::var("CODEG_HOST").unwrap_or_else(|_| "0.0.0.0".to_string())
    };
    // CODEG_DATA_DIR was already resolved and absolutized in `main()` so
    // all path resolvers across the process see the same root. Read it
    // back rather than re-deriving the default.
    let data_dir =
        PathBuf::from(std::env::var("CODEG_DATA_DIR").expect("CODEG_DATA_DIR set by main()"));
    let static_dir_env = std::env::var("CODEG_STATIC_DIR").ok();

    let static_dir = find_static_dir_standalone(static_dir_env.as_deref());
    let app_version = env!("CARGO_PKG_VERSION");

    // Staged-upgrade marker lifecycle. The marker is a proof token: it stays on
    // disk for the whole trial window so a second self-update is refused while
    // this freshly-swapped version is still unproven (re-swapping would clobber
    // the only good `.bak` and make a trial-failure rollback restore the
    // unproven version).
    if electron.is_some() {
        // The shell owns the bundle: never inspect or clear server upgrade
        // markers next to the packaged backend executable.
    } else if codeg_lib::update::runtime::is_supervised() {
        // Supervised trial: if this launch is the trial of a freshly-swapped
        // version (marker present), keep the marker until we have stayed up
        // past the trial window — at which point the upgrade is proven and the
        // marker is cleared so future updates are allowed again. The supervisor
        // only peeks at the marker to set probation; clearing is the worker's
        // job. If this version can't survive the window the supervisor rolls it
        // back first (which clears the marker), so this task never fires.
        if codeg_lib::update::install::upgrade_staged() {
            let trial = codeg_lib::update::runtime::upgrade_trial_secs();
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(trial)).await;
                let _ = codeg_lib::update::install::take_upgrade_staged();
            });
        }
    } else {
        // Standalone (non-supervised) self-update re-execs this binary in place,
        // with no supervisor and thus no trial/rollback. Clear the marker on
        // startup so a re-exec'd upgrade doesn't leave it behind and block every
        // future update with "already staged".
        let _ = codeg_lib::update::install::take_upgrade_staged();
    }

    tracing::info!("[SERVER] codeg-server v{}", app_version);
    tracing::info!("[SERVER] Data directory: {}", data_dir.display());
    tracing::info!("[SERVER] Static directory: {}", static_dir.display());

    // Initialize database
    let db = codeg_lib::db::init_database(&data_dir, app_version)
        .await
        .expect("Failed to initialize database");

    // Logging phase 2: override the default level from the persisted
    // `logging.level` now that the DB is open. Phase 3 (wiring the emitter)
    // happens once AppState exists, below.
    codeg_lib::logging::init::apply_persisted_level(&db.conn).await;

    // Resolve the access token *after* the DB is up so a generated token can be
    // persisted and reused across restarts (a self-update restart must not
    // rotate it). An empty/whitespace CODEG_TOKEN is treated as unset.
    let mut token_generated = false;
    let token = if let Some(launch) = &electron {
        // The shell supplies an ephemeral launch secret. Do not persist it in
        // the user's database or fall back to a long-lived server token.
        launch.token.clone()
    } else {
        resolve_persisted_server_token(
            &db.conn,
            std::env::var("CODEG_TOKEN").ok(),
            &mut token_generated,
        )
        .await
    };
    if token_generated {
        // Operator-facing startup notice on stderr ONLY: the access token is a
        // bearer credential and must never enter the durable log files or the
        // in-app log viewer. `eprintln!` bypasses the tracing sinks (file +
        // ring buffer); only the local terminal / Docker stderr sees it.
        eprintln!("[SERVER] No CODEG_TOKEN set; generated an access token (persisted): {token}");
        eprintln!("[SERVER] Pin your own by setting the CODEG_TOKEN environment variable.");
    }

    // Restore and apply saved system proxy settings before any network operation.
    // reqwest clients (including the LazyLock in check_app_update) cache the proxy
    // config at build time, so this must run before the first one is constructed.
    codeg_lib::init_proxy_from_db(&db.conn).await;

    // Reclaim orphaned chat scratch dirs (pre-send drafts that never bound to a
    // conversation, plus dirs left behind by deleted chat conversations).
    // Background, non-blocking; failures are logged but non-fatal.
    {
        let gc_conn = db.conn.clone();
        let gc_data_dir = data_dir.clone();
        tokio::spawn(async move {
            match codeg_lib::commands::conversations::gc_orphan_chat_dirs_core(
                &gc_conn,
                &gc_data_dir,
            )
            .await
            {
                Ok(n) if n > 0 => {
                    tracing::info!("[SERVER] chat-dir GC: reclaimed {n} orphan scratch dir(s)")
                }
                Ok(_) => {}
                Err(err) => tracing::error!("[SERVER] chat-dir GC failed: {err}"),
            }
        });
    }

    // Create shared broadcaster + internal ACP event bus.
    let broadcaster = Arc::new(WebEventBroadcaster::new());
    let event_bus_metrics = Arc::new(codeg_lib::acp::EventBusMetrics::default());
    let acp_event_bus = Arc::new(codeg_lib::acp::InternalEventBus::new(
        event_bus_metrics.clone(),
    ));
    let emitter = EventEmitter::web_only(broadcaster.clone(), acp_event_bus.clone());

    // Build AppState
    let pet_state_handle = codeg_lib::pet_state_mapper::new_pet_state_handle();
    let connection_manager = codeg_lib::app_state::default_connection_manager();
    let (
        delegation_broker,
        delegation_tokens,
        delegation_socket_path,
        feedback_config,
        question_config,
        session_info_config,
        chat_authoring_config,
    ) = codeg_lib::app_state::build_delegation_stack(
        &connection_manager,
        db.conn.clone(),
        data_dir.clone(),
    );
    let state = Arc::new(AppState {
        db,
        connection_manager,
        terminal_manager: codeg_lib::app_state::default_terminal_manager(),
        event_broadcaster: broadcaster,
        acp_event_bus: acp_event_bus.clone(),
        emitter,
        data_dir,
        web_server_state: WebServerState::new(),
        chat_channel_manager: codeg_lib::app_state::default_chat_channel_manager(),
        workspace_transfer: Arc::new(
            codeg_lib::workspace_transfer::WorkspaceTransferManager::new_from_env(),
        ),
        pet_state: pet_state_handle.clone(),
        delegation_broker: delegation_broker.clone(),
        delegation_tokens: delegation_tokens.clone(),
        delegation_socket_path: delegation_socket_path.clone(),
        feedback_config: feedback_config.clone(),
        question_config: question_config.clone(),
        session_info_config: session_info_config.clone(),
        chat_authoring_config: chat_authoring_config.clone(),
        system_op_lock: codeg_lib::app_state::default_system_op_lock(),
        update_state: codeg_lib::app_state::default_update_state(),
    });
    state
        .connection_manager
        .install_chat_channel(state.chat_channel_manager.clone_ref());

    // Logging phase 3: wire the emitter so the Logs viewer's live tail
    // (`logs://appended`) reaches WS clients.
    if let Some(hub) = codeg_lib::logging::hub::log_hub() {
        hub.set_emitter(state.emitter.clone());
    }

    // Apply persisted delegation settings (depth, enabled) before
    // the listener starts accepting so even the first companion request
    // sees the operator's configured behavior. Cancellation is handled
    // out-of-band via MCP `notifications/cancelled` — no broker-side
    // timeout to apply here.
    codeg_lib::commands::delegation::apply_persisted_config(&state.db.conn, &delegation_broker)
        .await;
    // Same for the live-feedback enable flag, so the first companion launch
    // sees the operator's configured behavior.
    codeg_lib::commands::feedback::apply_persisted_feedback_config(
        &state.db.conn,
        &feedback_config,
    )
    .await;
    // Same for the ask-user-question enable flag.
    codeg_lib::commands::question::apply_persisted_question_config(
        &state.db.conn,
        &question_config,
    )
    .await;
    // Same for the get-session-info enable flag.
    codeg_lib::commands::session_info::apply_persisted_session_info_config(
        &state.db.conn,
        &session_info_config,
    )
    .await;
    // Same for the chat-authoring flags, so the first companion launch knows
    // whether to advertise `create_automation` / `create_work_task`.
    codeg_lib::commands::chat_authoring::apply_persisted_chat_authoring_config(
        &state.db.conn,
        &chat_authoring_config,
    )
    .await;
    // Before accepting connections: keep ACP model terminal fallbacks aligned
    // with the same default-shell preference the built-in terminal uses, and
    // seed the command-color opt-in that every launch env is built from.
    let terminal_shell_config = state.connection_manager.terminal_shell_config();
    codeg_lib::commands::system_settings::apply_persisted_terminal_settings(
        &state.db.conn,
        &terminal_shell_config,
    )
    .await;

    // Spawn the delegation listener so companion processes can round-trip
    // through the broker. Path is PID-scoped, so the listener owns it for
    // the lifetime of the process.
    {
        let listener = codeg_lib::acp::delegation::listener::DelegationListener::new(
            delegation_broker,
            delegation_tokens,
            Arc::new(codeg_lib::acp::manager::ConnectionManagerParentLookup {
                manager: Arc::new(state.connection_manager.clone_ref()),
            }),
            Arc::new(codeg_lib::acp::manager::ConnectionManagerFeedbackLookup {
                manager: Arc::new(state.connection_manager.clone_ref()),
            }),
            Arc::new(codeg_lib::acp::manager::ConnectionManagerQuestionLookup {
                manager: Arc::new(state.connection_manager.clone_ref()),
            }),
            Arc::new(codeg_lib::commands::session_info::DbSessionInfoLookup::new(
                Arc::new(codeg_lib::db::AppDatabase {
                    conn: state.db.conn.clone(),
                }),
            )),
            Arc::new(codeg_lib::work_task::EngineWorkTaskTools),
            Arc::new(codeg_lib::commands::chat_authoring::DbChatAuthoring::new(
                Arc::new(codeg_lib::db::AppDatabase {
                    conn: state.db.conn.clone(),
                }),
                state.emitter.clone(),
                chat_authoring_config.clone(),
            )),
        );
        let socket = delegation_socket_path.clone();
        tokio::spawn(async move {
            if let Err(e) = listener.run(socket).await {
                tracing::info!("[delegation] listener exited: {e}");
            }
        });
    }

    // Install bundled expert skills into the central store
    // (`~/.codeg/skills/`). Runs in the background; failures are logged
    // but non-fatal.
    tokio::spawn(async move {
        let report = codeg_lib::commands::experts::ensure_central_experts_installed().await;
        if !report.errors.is_empty() {
            tracing::error!(
                "[Experts] install finished with {} error(s): {:?}",
                report.errors.len(),
                report.errors
            );
        } else {
            tracing::info!(
                "[Experts] install ok: installed={} updated={} pending_review={}",
                report.installed_count,
                report.updated_count,
                report.pending_user_review.len()
            );
        }
    });

    // Install bundled scientific-research skills into the same central store.
    // Runs in the background; failures are logged but non-fatal.
    tokio::spawn(async move {
        let report = codeg_lib::commands::science::ensure_central_science_installed().await;
        if !report.errors.is_empty() {
            tracing::error!(
                "[Science] install finished with {} error(s): {:?}",
                report.errors.len(),
                report.errors
            );
        } else {
            tracing::info!(
                "[Science] install ok: installed={} updated={} pending_review={}",
                report.installed_count,
                report.updated_count,
                report.pending_user_review.len()
            );
        }
    });

    // Start chat channel background tasks (event subscriber, command dispatcher, scheduler, auto-connect)
    state
        .chat_channel_manager
        .start_background(
            state.event_broadcaster.clone(),
            state.acp_event_bus.clone(),
            state.db.conn.clone(),
            state.data_dir.clone(),
            state.connection_manager.clone_ref(),
            state.emitter.clone(),
        )
        .await;

    // Spawn the LifecycleSubscriber for cross-connection DB writes. The
    // broker is supplied so TurnComplete on a delegation child resolves the
    // parent's pending `delegate_to_agent` tool_use_id and emits
    // `DelegationCompleted`.
    tokio::spawn(codeg_lib::lifecycle_subscriber_task(
        state.db.conn.clone(),
        state.connection_manager.clone_ref(),
        state.acp_event_bus.clone(),
        Some(state.delegation_broker.clone()),
    ));

    // Spawn the desktop pet state mapper so server-mode browsers viewing
    // /pet receive `pet://state` and `pet://oneshot` over the WebSocket
    // bridge, shared by Electron and browser clients. ACP events
    // come through the typed bus; folder/app side-channels stay on the
    // JSON broadcaster.
    tokio::spawn(codeg_lib::pet_state_mapper::pet_state_subscriber_task(
        state.acp_event_bus.clone(),
        state.event_broadcaster.clone(),
        state.emitter.clone(),
        pet_state_handle,
    ));

    tokio::spawn(codeg_lib::commands::agent_auto_updates::run(
        codeg_lib::db::AppDatabase {
            conn: state.db.conn.clone(),
        },
        state.connection_manager.clone_ref(),
        state.emitter.clone(),
    ));

    // Spawn the idle sweep so connections abandoned without an explicit
    // disconnect (e.g. browser tab closed, panic survivors) are reaped.
    // Override the 60-second default via `CODEG_ACP_IDLE_TIMEOUT_SECS`
    // (set to `0` to disable).
    if let Some(idle_timeout) = codeg_lib::idle_timeout_from_env() {
        tokio::spawn(codeg_lib::idle_sweep_task(
            state.connection_manager.clone_ref(),
            idle_timeout,
            std::time::Duration::from_secs(codeg_lib::SWEEP_INTERVAL_SECS),
        ));
    }

    // Reclaim scratch directories lost track of mid-session. Deliberately NOT
    // gated on `idle_timeout_from_env` like the sweep above: setting
    // `CODEG_ACP_IDLE_TIMEOUT_SECS=0` disables idle disconnects, not disk
    // reclamation.
    tokio::spawn(codeg_lib::scratch_sweep_task());

    // Office watch preview servers: reap dead children + ref0 stragglers.
    if let Some(idle_timeout) = codeg_lib::office_watch::idle_timeout_from_env() {
        tokio::spawn(codeg_lib::office_watch::office_watch_idle_sweep_task(
            idle_timeout,
            std::time::Duration::from_secs(codeg_lib::office_watch::SWEEP_INTERVAL_SECS),
        ));
    }

    // Automation engine (mirrors lib.rs setup): manual + scheduled fires,
    // event-bus completion, reconcile, boot recovery. One per process.
    if let Some(engine) = codeg_lib::automation::build_engine(
        codeg_lib::db::AppDatabase {
            conn: state.db.conn.clone(),
        },
        state.connection_manager.clone_ref(),
        state.emitter.clone(),
        state.acp_event_bus.clone(),
        state.data_dir.clone(),
    ) {
        tokio::spawn(codeg_lib::automation::run_automation_engine(engine));
    }

    // Work-task engine (mirrors lib.rs setup): manual pipeline, event-bus
    // settlement, merging git-truth recovery. One per process.
    if let Some(engine) = codeg_lib::work_task::build_task_engine(
        codeg_lib::db::AppDatabase {
            conn: state.db.conn.clone(),
        },
        state.connection_manager.clone_ref(),
        state.emitter.clone(),
        state.acp_event_bus.clone(),
        state.data_dir.clone(),
    ) {
        tokio::spawn(codeg_lib::work_task::run_task_engine(engine));
    }

    // Label worktree folders registered before aliases were seeded at creation
    // with the branch they have checked out (mirrors lib.rs setup). Background;
    // changed folders are broadcast, so a browser that already fetched its
    // folder list still picks them up.
    {
        let db = codeg_lib::db::AppDatabase {
            conn: state.db.conn.clone(),
        };
        let emitter = state.emitter.clone();
        tokio::spawn(async move {
            let n =
                codeg_lib::commands::folders::backfill_worktree_folder_aliases(&emitter, &db).await;
            if n > 0 {
                tracing::info!("[folders] labeled {n} worktree folder(s) by branch");
            }
        });
    }

    // Sweep abandoned upload staging files from any prior run before
    // serving the first request. The quota log/validate ran earlier in
    // `main` so strict-mode misconfigurations abort before we touch
    // disk; no second log line here.
    codeg_lib::web::handlers::files::purge_upload_staging().await;

    // Build router
    // Electron's private transport must survive stopping the public listener.
    let shutdown_signal = if electron.is_some() {
        Arc::new(codeg_lib::web::shutdown::ShutdownSignal::new())
    } else {
        state.web_server_state.shutdown_signal()
    };
    let router = codeg_lib::web::router::build_router(
        state.clone(),
        token.clone(),
        static_dir.clone(),
        shutdown_signal.clone(),
    );

    // Bind
    let addr = format!("{}:{}", host, port);
    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(listener) => listener,
        Err(e) => {
            tracing::error!("[SERVER] Failed to bind {}: {}", addr, e);
            cleanup_children(&state).await;
            return ExitCode::from(1);
        }
    };

    if let Err(e) = codeg_lib::web::socket_inherit::mark_listener_non_inheritable(&listener) {
        tracing::warn!(
            "[SERVER][WARN] failed to mark listener non-inheritable: {}",
            e
        );
    }

    let local_addr = listener.local_addr().ok();
    let actual_port = local_addr.map(|a| a.port()).unwrap_or(port);
    // `CODEG_HOST` may be `localhost` or a bracketed IPv6 (`[::1]`); advertise
    // the concrete IP the socket bound to, not the raw config string.
    let advertised_host = advertise_host(local_addr, &host);

    // Publish runtime state so the settings page (served by us) shows
    // the truth — running on `actual_port` with this token — instead of
    // the placeholder "stopped" that triggers the stale-port banner.
    if electron.is_none() {
        state.web_server_state.mark_externally_running(
            advertised_host.clone(),
            actual_port,
            token.clone(),
        );
    } else {
        match codeg_lib::web::load_web_service_config(&state.db.conn).await {
            Ok(config) if config.auto_start => {
                if let Err(error) = codeg_lib::web::do_start_web_server_with_state(
                    state.clone(),
                    static_dir,
                    None,
                    None,
                    None,
                )
                .await
                {
                    // A busy public port must not prevent the desktop from opening.
                    tracing::warn!("[WEB] Could not auto-start public Web service: {error}");
                }
            }
            Ok(_) => {}
            Err(error) => tracing::warn!("[WEB] Could not load Web service settings: {error}"),
        }
    }
    let addresses = addresses_for_bind(&advertised_host, actual_port);

    // Token on stderr ONLY (bearer credential — keep it out of the log files
    // and the in-app viewer); the bind addresses are safe to log normally.
    if electron.is_none() {
        eprintln!("[SERVER] Token: {}", token);
    }
    tracing::info!("[SERVER] Listening on:");
    for addr in &addresses {
        tracing::info!("  {}", addr);
    }

    // The shell reads only the port from a private, atomically published file.
    // It never has to parse log lines or put a bearer token in a window URL.
    let _ready_file = if let Some(launch) = &electron {
        match ElectronReadyFile::publish(&launch.ready_file, actual_port) {
            Ok(ready_file) => Some(ready_file),
            Err(e) => {
                tracing::error!("[SERVER] Failed to publish Electron readiness: {e}");
                cleanup_children(&state).await;
                return ExitCode::from(1);
            }
        }
    } else {
        None
    };

    let graceful_signal = shutdown_signal.clone();
    let mut server = Box::pin(
        axum::serve(listener, router)
            .with_graceful_shutdown(async move { graceful_signal.wait().await })
            .into_future(),
    );
    let result = tokio::select! {
        result = &mut server => result,
        _ = &mut shutdown_requested => {
            tracing::info!("[SERVER] Shutting down");
            shutdown_signal.trigger();
            // WebSockets also observe this signal; cap the HTTP drain so a
            // hung request cannot prevent ACP/terminal cleanup on desktop quit.
            match tokio::time::timeout(Duration::from_secs(2), &mut server).await {
                Ok(result) => result,
                Err(_) => Ok(()),
            }
        }
    };
    shutdown_requested.abort();
    shutdown_signal.trigger();
    drop(server);
    cleanup_children(&state).await;
    if let Err(e) = result {
        tracing::error!("[SERVER] Server error: {}", e);
        return ExitCode::from(1);
    }
    ExitCode::SUCCESS
}

struct ElectronLaunch {
    ready_file: PathBuf,
    token: String,
}

impl ElectronLaunch {
    fn validate(
        host: Option<&str>,
        token: Option<&str>,
        ready_file: Option<PathBuf>,
    ) -> Result<Self, &'static str> {
        if host.is_some_and(|host| host != "127.0.0.1") {
            return Err("CODEG_HOST must be 127.0.0.1");
        }
        let token = token
            .map(str::trim)
            .filter(|token| !token.is_empty())
            .ok_or("CODEG_TOKEN must be explicitly set and nonempty")?;
        let ready_file = ready_file
            .filter(|path| path.is_absolute() && path.file_name().is_some())
            .ok_or("CODEG_ELECTRON_READY_FILE must be an absolute file path")?;
        Ok(Self {
            ready_file,
            token: token.to_string(),
        })
    }
}

struct ElectronReadyFile(PathBuf);

impl ElectronReadyFile {
    fn publish(path: &Path, port: u16) -> std::io::Result<Self> {
        let parent = path.parent().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "ready file has no parent")
        })?;
        let mut file = tempfile::NamedTempFile::new_in(parent)?;
        write!(file, "{{\"port\":{port}}}")?;
        file.flush()?;
        // Refuse a stale ready file instead of announcing an unrelated
        // previous server. The shell creates a fresh private directory.
        file.persist_noclobber(path).map_err(|error| error.error)?;
        Ok(Self(path.to_path_buf()))
    }
}

impl Drop for ElectronReadyFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

async fn wait_for_shutdown() {
    let interrupt = tokio::signal::ctrl_c();
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => {
                tracing::error!("[SERVER] Cannot register SIGTERM handler: {error}");
            }
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        result = interrupt => {
            if let Err(error) = result {
                tracing::error!("[SERVER] Cannot register interrupt handler: {error}");
            }
        }
        _ = terminate => {}
    }
}

async fn wait_for_electron_parent(electron_owned: bool) {
    if !electron_owned {
        std::future::pending::<()>().await;
        return;
    }
    let (closed, receiver) = tokio::sync::oneshot::channel();
    // Electron owns the write end of stdin. EOF means an intentional quit or
    // a crashed shell, on every platform (including Windows, where SIGTERM
    // cannot be caught). Use an OS thread: Tokio's blocking stdin task cannot
    // be cancelled and would hold runtime teardown open after a Unix signal.
    std::thread::spawn(move || {
        let _ = std::io::copy(&mut std::io::stdin().lock(), &mut std::io::sink());
        let _ = closed.send(());
    });
    let _ = receiver.await;
}

async fn cleanup_children(state: &AppState) {
    if codeg_lib::update::runtime::is_electron() {
        codeg_lib::web::do_stop_web_server(&state.web_server_state).await;
    } else {
        state.web_server_state.shutdown_signal().trigger();
    }
    let _ = tokio::time::timeout(
        Duration::from_secs(2),
        state.chat_channel_manager.stop_all(),
    )
    .await;
    state.terminal_manager.kill_all();
    codeg_lib::office_watch::stop_all_office_watches();
    // A connection being established holds a read lock while waiting for its
    // handshake. Disconnect it while requesting the write lock; waiting for
    // that lock first could stall quit until a hung agent's handshake expires.
    let (_new_connections, _) = tokio::join!(
        tokio::time::timeout(
            Duration::from_secs(1),
            state.connection_manager.lock_out_new_connections(),
        ),
        state.connection_manager.disconnect_all(),
    );
    // Cover a spawn that finished registering while the lock was acquired.
    state.connection_manager.disconnect_all().await;
}

fn default_data_dir() -> PathBuf {
    dirs::data_dir()
        .map(|d| d.join("codeg"))
        .unwrap_or_else(|| PathBuf::from(".codeg-data"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn electron_launch_rejects_network_bind_and_missing_secret() {
        let file = std::env::temp_dir().join("electron-ready.json");
        assert!(
            ElectronLaunch::validate(Some("0.0.0.0"), Some("secret"), Some(file.clone())).is_err()
        );
        assert!(ElectronLaunch::validate(None, Some(" \t"), Some(file.clone())).is_err());
        assert!(ElectronLaunch::validate(None, None, Some(file.clone())).is_err());
        assert!(
            ElectronLaunch::validate(None, Some("secret"), Some(PathBuf::from("ready.json")))
                .is_err()
        );
        assert!(ElectronLaunch::validate(Some("127.0.0.1"), Some("secret"), Some(file)).is_ok());
    }

    #[test]
    fn electron_readiness_publishes_only_port_and_removes_on_shutdown() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ready.json");
        let ready = ElectronReadyFile::publish(&path, 40123).unwrap();
        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(value, serde_json::json!({ "port": 40123 }));
        assert!(ElectronReadyFile::publish(&path, 40124).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"port\":40123}");
        drop(ready);
        assert!(!path.exists());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }
}
