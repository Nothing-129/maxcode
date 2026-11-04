use super::*;

#[test]
fn custom_models_follow_groks_file_order_without_changing_explicit_windows() {
    let raw = r#"
[model.custom]
model = "shared"
[model.first]
model = "shared"
context_window = 300000
[model.last]
model = "shared"
context_window = 500000
[model.explicit]
model = "shared"
context_window = 123456
"#;
    assert_eq!(
        grok_context_window_from_config_toml(raw, "custom"),
        Some(123456)
    );
    assert_eq!(
        grok_context_window_from_config_toml(raw, "first"),
        Some(300000)
    );
    assert_eq!(grok_context_window_from_config_toml(raw, "missing"), None);
    let zero = raw.replace("context_window = 123456", "context_window = 0");
    assert_eq!(grok_context_window_from_config_toml(&zero, "custom"), None);
}
