use super::*;

#[test]
fn scripts_are_allowed_for_grok_on_all_install_attempts() {
    assert_eq!(
        npm_run_scripts_args("@xai-official/grok@1.0.77"),
        vec![
            "--ignore-scripts=false",
            "--allow-scripts=@xai-official/grok"
        ]
    );
    assert!(npm_run_scripts_args("pi-acp@0.0.34").is_empty());
    assert!(npm_package_requires_scripts("deepseek-acp@0.9.0"));
    assert!(!npm_package_bootstraps_runtime("@xai-official/grok@1.0.77"));
}

#[test]
fn unmarked_npm_copy_does_not_survive_as_native_installation() {
    let temp = tempfile::tempdir().unwrap();
    let bin = temp.path().join(".grok/bin");
    fs::create_dir_all(&bin).unwrap();
    let cmd = if cfg!(windows) { "grok.exe" } else { "grok" };
    fs::write(bin.join(cmd), b"npm build").unwrap();
    fs::write(bin.join("grok-1.0.77"), b"npm build").unwrap();
    assert!(grok_native_install(temp.path(), "grok").is_none());
    fs::write(
        temp.path().join(".grok/config.toml"),
        "[cli]\ninstaller = 'native'\n",
    )
    .unwrap();
    assert!(grok_native_install(temp.path(), "grok").is_some());
}
