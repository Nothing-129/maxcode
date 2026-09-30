//! Independent ownership and preference preservation for 155916e6.
use super::*;
use crate::acp::codex_model_catalog as catalog;
use serde_json::{json, Value};

#[test]
fn official_priority_is_stable_and_keeps_the_native_default() {
    let mut snapshot = vec![
        json!({"slug":"astra","priority":2}),
        json!({"slug":"sol","priority":1}),
        json!({"slug":"luna","priority":2}),
        json!({"slug":"other"}),
    ];
    catalog::sort_by_priority(&mut snapshot);
    assert_eq!(
        snapshot
            .iter()
            .map(|m| m["slug"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["sol", "astra", "luna", "other"]
    );
    assert_eq!(
        catalog::fallback_base_slug(&snapshot).as_deref(),
        Some("sol")
    );
}

#[test]
fn owned_upgrade_keeps_customs_exclusions_and_config_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path();
    let config = format!(
        "# my settings\nmodel = \"gw/custom\"\nmodel_catalog_json = \"{}\"\n",
        catalog::CATALOG_REL
    );
    fs::write(home.join("config.toml"), &config).unwrap();
    let intent = r#"{"customs":[{"slug":"gw/custom","base":"gpt-5.6-sol"}],"default":"gw/custom","excludedOfficials":["gpt-6-astra"]}"#;
    let new = catalog::bundled_snapshot_models();
    let old: Vec<_> = new
        .iter()
        .filter(|m| m["slug"] != "gpt-6.1-sol")
        .cloned()
        .collect();
    catalog::write_catalog_files(intent, home, &old).unwrap();
    assert_eq!(
        resync_codex_generated_catalog_at(home, &new).unwrap(),
        CodexCatalogResync::Rewritten
    );
    let generated: Value =
        serde_json::from_str(&fs::read_to_string(home.join(catalog::CATALOG_REL)).unwrap())
            .unwrap();
    let slugs: Vec<_> = generated["models"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["slug"].as_str().unwrap())
        .collect();
    assert_eq!(slugs[0], "gw/custom");
    assert!(slugs.contains(&"gpt-6.1-sol"));
    assert!(!slugs.contains(&"gpt-6-astra"));
    assert_eq!(
        fs::read_to_string(home.join("config.toml")).unwrap(),
        config
    );
    assert_eq!(
        fs::read_to_string(home.join(catalog::SOURCE_REL)).unwrap(),
        intent
    );
}

#[test]
fn manual_and_orphan_catalogs_are_never_reinterpreted() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path();
    let snapshot = catalog::bundled_snapshot_models();
    for reference in ["manual.json", catalog::CATALOG_REL] {
        let config = format!("model_catalog_json = \"{reference}\"\n");
        fs::write(home.join("config.toml"), &config).unwrap();
        fs::write(home.join(reference), "original bytes").unwrap();
        assert_eq!(
            resync_codex_generated_catalog_at(home, &snapshot).unwrap(),
            CodexCatalogResync::NotOwned
        );
        assert_eq!(
            fs::read_to_string(home.join(reference)).unwrap(),
            "original bytes"
        );
        assert_eq!(
            fs::read_to_string(home.join("config.toml")).unwrap(),
            config
        );
    }
}
