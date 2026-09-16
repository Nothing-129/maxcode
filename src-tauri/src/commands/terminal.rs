use std::collections::HashMap;

use crate::git_credential;

/// Build extra env vars for the terminal session.
///
/// Uses `credential.helper` with a script that calls the app binary with
/// `--credential-helper`. The binary opens the DB, looks up the matching
/// account, and outputs credentials. No credentials are written to disk.
pub(crate) fn prepare_credential_env(
    app_data_dir: &std::path::Path,
) -> Option<HashMap<String, String>> {
    // Get the path to the current running binary
    let app_binary = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => {
            tracing::error!("[TERM] failed to get current exe path: {}", e);
            return None;
        }
    };

    let helper_script =
        match git_credential::create_credential_helper_script(app_data_dir, &app_binary) {
            Ok(p) => p,
            Err(e) => {
                tracing::error!("[TERM] failed to create credential helper script: {}", e);
                return None;
            }
        };

    let helper_path_str = helper_script.to_string_lossy().to_string();

    // GIT_CONFIG_COUNT adds config entries that are tried BEFORE file-based config.
    // For multi-valued keys like credential.helper, this means our helper runs first;
    // if it exits 0 with no output, git falls through to the user's existing helpers.
    let mut env = HashMap::new();
    env.insert("GIT_CONFIG_COUNT".to_string(), "1".to_string());
    env.insert(
        "GIT_CONFIG_KEY_0".to_string(),
        "credential.helper".to_string(),
    );
    // The '!' prefix tells git to run the rest as `sh -c <value>`. Single-quote
    // the path so spaces, `$`, backticks, etc. don't get re-interpreted by sh.
    env.insert(
        "GIT_CONFIG_VALUE_0".to_string(),
        format!("!{}", git_credential::sh_single_quote(&helper_path_str)),
    );

    Some(env)
}
