//! Subprocess-level end-to-end test for the git credential helper.
//!
//! The lib-level `test_credential_helper_e2e_server_mode` exercises the
//! lookup function directly. This test goes one layer deeper: it spawns
//! the actual `codeg-server` binary with `--credential-helper`, pipes the
//! git credential protocol through stdin, and asserts on stdout. That
//! covers the parts the lib test can't reach — the binary's main()
//! short-circuit, real argv parsing, real stdin reading, and the exact
//! `username=...\npassword=...\n` wire format git expects.
//!
//! File-store server mode only: both Electron and Tauri enable native-keyring,
//! which we won't poke from CI. The server CI matrix runs this subprocess test.

#![cfg(all(unix, not(feature = "native-keyring")))]

use std::io::Write;
use std::process::{Command, Stdio};

use codeg_lib::db::service::app_metadata_service;

const GITHUB_ACCOUNTS_KEY: &str = "github_accounts";

/// Hand-roll the JSON written to `app_metadata.github_accounts` so this
/// test stays at the integration boundary and doesn't reach into private
/// internal types (`crate::models::system`). Schema must match
/// `GitHubAccountsSettings` / `GitHubAccount` in `src/models/system.rs`.
fn accounts_json(account_id: &str, username: &str) -> String {
    serde_json::json!({
        "accounts": [{
            "id": account_id,
            "server_url": "https://github.com",
            "username": username,
            "scopes": [],
            "avatar_url": null,
            "is_default": true,
            "created_at": "",
        }],
    })
    .to_string()
}

#[tokio::test(flavor = "current_thread")]
async fn helper_subprocess_emits_username_and_password_for_seeded_host() {
    let data_dir =
        std::env::temp_dir().join(format!("codeg-helper-subproc-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&data_dir).expect("create data dir");

    let username = "octocat";
    let token = "ghp_subprocess_e2e_token";
    let account_id = "acct-subproc-1";

    // Seed the on-disk DB with one matching account, then drop the writer
    // so the helper subprocess can open the file read-only without WAL
    // contention.
    {
        let db = codeg_lib::db::init_database(&data_dir, "test")
            .await
            .expect("init db");

        app_metadata_service::upsert_value(
            &db.conn,
            GITHUB_ACCOUNTS_KEY,
            &accounts_json(account_id, username),
        )
        .await
        .expect("seed accounts");
    }

    // Write token to the file-based store the way set_token does, but
    // bypass the global env var so we don't race with the parent test
    // process. The helper subprocess gets `CODEG_DATA_DIR` via its
    // environment below, which `keyring_store` then resolves.
    let tokens_path = data_dir.join("tokens.json");
    let mut tokens = std::collections::HashMap::new();
    tokens.insert(format!("github-token:{account_id}"), token.to_string());
    std::fs::write(
        &tokens_path,
        serde_json::to_string_pretty(&tokens).expect("serialize tokens"),
    )
    .expect("write tokens.json");

    let binary = env!("CARGO_BIN_EXE_codeg-server");
    let mut child = Command::new(binary)
        .arg("--credential-helper")
        .arg("--data-dir")
        .arg(&data_dir)
        // Keep the env minimal so the subprocess uses --data-dir, not
        // whatever CODEG_DATA_DIR happens to be set to in the test runner.
        .env_clear()
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .env("CODEG_DATA_DIR", &data_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn codeg-server --credential-helper");

    // git's credential protocol: lines of `key=value`, terminated by a
    // blank line. We only need `host=` for the lookup.
    {
        let mut stdin = child.stdin.take().expect("subprocess stdin");
        stdin
            .write_all(b"protocol=https\nhost=github.com\n\n")
            .expect("write stdin");
    }

    let output = child
        .wait_with_output()
        .expect("wait for credential helper subprocess");

    assert!(
        output.status.success(),
        "subprocess exited with {:?}, stderr: {}",
        output.status.code(),
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8(output.stdout).expect("stdout utf8");
    // git parses `key=value` lines until a blank line / EOF; ordering of
    // username vs password is not significant, but both must be present.
    assert!(
        stdout.contains(&format!("username={username}")),
        "stdout missing username line. Got:\n{stdout}\nstderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        stdout.contains(&format!("password={token}")),
        "stdout missing password line. Got:\n{stdout}\nstderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let _ = std::fs::remove_dir_all(&data_dir);
}

#[tokio::test(flavor = "current_thread")]
async fn helper_subprocess_outputs_nothing_for_unconfigured_host() {
    let data_dir =
        std::env::temp_dir().join(format!("codeg-helper-subproc-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&data_dir).expect("create data dir");

    // Init an empty DB — no accounts seeded.
    {
        let _db = codeg_lib::db::init_database(&data_dir, "test")
            .await
            .expect("init db");
    }

    let binary = env!("CARGO_BIN_EXE_codeg-server");
    let mut child = Command::new(binary)
        .arg("--credential-helper")
        .arg("--data-dir")
        .arg(&data_dir)
        .env_clear()
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .env("CODEG_DATA_DIR", &data_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn codeg-server --credential-helper");

    {
        let mut stdin = child.stdin.take().expect("subprocess stdin");
        stdin
            .write_all(b"protocol=https\nhost=github.com\n\n")
            .expect("write stdin");
    }

    let output = child
        .wait_with_output()
        .expect("wait for credential helper subprocess");

    assert!(output.status.success(), "subprocess should exit cleanly");
    let stdout = String::from_utf8(output.stdout).expect("stdout utf8");
    // No matching account -> helper writes nothing on stdout, lets git
    // fall through to the next configured helper.
    assert!(
        !stdout.contains("username="),
        "miss should not emit username; got:\n{stdout}"
    );
    assert!(
        !stdout.contains("password="),
        "miss should not emit password; got:\n{stdout}"
    );

    // Miss path must also be silent on stderr — otherwise agent terminals
    // get noisy on every GitLab/enterprise URL and the local data-dir path
    // leaks into output the user sees.
    let stderr = String::from_utf8(output.stderr).expect("stderr utf8");
    assert!(
        stderr.is_empty(),
        "miss should not write to stderr; got:\n{stderr}"
    );

    let _ = std::fs::remove_dir_all(&data_dir);
}
