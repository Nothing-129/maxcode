use super::*;

#[test]
fn grok_native_install_counts_any_copy_but_the_npm_packages() {
    let home = tempfile::tempdir().expect("tempdir");
    let grok_dir = home.path().join(".grok");
    let bin = grok_dir
        .join("bin")
        .join(if cfg!(windows) { "grok.exe" } else { "grok" });
    let config = grok_dir.join("config.toml");
    let found = || grok_native_install(home.path(), "grok");

    std::fs::create_dir_all(&grok_dir).expect("create grok dir");
    std::fs::write(&config, "[cli]\r\ninstaller = \"internal\"\r\n").expect("write config");
    assert_eq!(found(), None, "an installer record alone is not an install");

    std::fs::create_dir_all(bin.parent().expect("bin dir")).expect("create bin dir");
    std::fs::write(&bin, "").expect("write grok");
    // The record as `install.ps1` writes it, with CRLF line endings.
    assert_eq!(found().as_deref(), Some(bin.as_path()));

    // Only an explicit npm record excludes the copy.
    for other in ["", "[cli]\nauto_update = false\n", "not = [toml"] {
        std::fs::write(&config, other).expect("write config");
        assert_eq!(found().as_deref(), Some(bin.as_path()), "config: {other:?}");
    }
    std::fs::remove_file(&config).expect("remove config");
    assert_eq!(found().as_deref(), Some(bin.as_path()), "no config");

    // What `@xai-official/grok`'s postinstall writes; its copy outlives
    // `npm uninstall -g`.
    std::fs::write(&config, "[cli]\ninstaller = \"npm\"\nauto_update = true\n")
        .expect("write config");
    assert_eq!(found(), None);
}

#[cfg(not(windows))]
#[tokio::test]
async fn grok_native_install_is_the_last_npx_fallback() {
    use std::os::unix::fs::PermissionsExt;

    let home = tempfile::tempdir().expect("tempdir");
    let grok_dir = home.path().join(".grok");
    let native_bin = grok_dir.join("bin");
    let local_bin = home.path().join(".maxcode").join("npm-global").join("bin");
    let prefix = home.path().join("npm-prefix");
    let prefix_bin = npm_prefix_bin_dir(&prefix);
    // Names nothing on the real PATH or npm prefix can answer.
    let native_only = "codeg-test-grok-native-only";
    let with_local_bin = "codeg-test-grok-native-and-local-bin";
    let with_npm = "codeg-test-grok-native-and-npm-prefix";
    for path in [
        native_bin.join(native_only),
        native_bin.join(with_local_bin),
        local_bin.join(with_local_bin),
        native_bin.join(with_npm),
        prefix_bin.join(with_npm),
    ] {
        std::fs::create_dir_all(path.parent().expect("bin directory"))
            .expect("create bin directory");
        std::fs::write(&path, "").expect("write command");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .expect("mark command executable");
    }
    std::fs::write(
        grok_dir.join("config.toml"),
        "[cli]\ninstaller = \"internal\"\n",
    )
    .expect("write config");

    let got = temp_env::async_with_vars([("HOME", Some(home.path()))], async {
        let mut resolver = NpxCommandResolver {
            request_npm_prefix: Some(Some(prefix.clone())),
            ..Default::default()
        };
        (
            resolve_npx_command(native_only).await,
            resolve_npx_command_for(AgentType::Grok, native_only).await,
            resolve_npx_command_for(AgentType::Hermes, native_only).await,
            is_cmd_available(AgentType::Grok, native_only).await,
            resolver
                .resolve_for_list(AgentType::Grok, native_only)
                .await,
            // Asked after Grok's lookup cached the command.
            resolver
                .resolve_for_list(AgentType::Hermes, native_only)
                .await,
            resolve_npx_command_for(AgentType::Grok, with_local_bin).await,
            resolver.resolve_for_list(AgentType::Grok, with_npm).await,
        )
    })
    .await;

    let native = native_bin.join(native_only);
    assert_eq!(got.0, None);
    assert_eq!(got.1.as_deref(), Some(native.as_path()));
    assert_eq!(got.2, None, "only Grok looks in ~/.grok/bin");
    assert!(got.3, "the connect guard agrees");
    assert_eq!(got.4.as_deref(), Some(native.as_path()), "the list agrees");
    assert_eq!(
        got.5, None,
        "the list cache does not leak it to another agent"
    );
    assert_eq!(
        got.6.as_deref(),
        Some(local_bin.join(with_local_bin).as_path()),
        "MaxCode user npm prefix still wins"
    );
    assert_eq!(
        got.7.as_deref(),
        Some(prefix_bin.join(with_npm).as_path()),
        "the npm copy still wins"
    );
}
