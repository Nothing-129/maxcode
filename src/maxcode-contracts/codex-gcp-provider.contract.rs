use super::*;

#[test]
fn saving_model_settings_leaves_the_gcp_builtin_table_untouched() {
    let home = tempfile::tempdir().unwrap();
    let config_path = home.path().join("config.toml");
    let initial = "model_provider = \"gcp\"\nmodel = \"gpt-6.1-sol\"\n[model_providers.gcp]\nproject_id = \"existing-project\"\n";
    fs::write(&config_path, initial).unwrap();
    temp_env::with_var("CODEX_HOME", Some(home.path()), || {
        persist_codex_local_config(Some(r#"{"model":"gpt-6.1-terra"}"#)).unwrap();
    });
    let saved: toml::Value = fs::read_to_string(config_path).unwrap().parse().unwrap();
    assert_eq!(saved["model"].as_str(), Some("gpt-6.1-terra"));
    assert_eq!(saved["model_provider"].as_str(), Some("gcp"));
    let before: toml::Value = initial.parse().unwrap();
    assert_eq!(
        saved["model_providers"]["gcp"],
        before["model_providers"]["gcp"]
    );
}
