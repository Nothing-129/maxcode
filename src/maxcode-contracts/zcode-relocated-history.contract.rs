//! A saved data root must move SQLite history and ACP aliases together.
use super::*;
use crate::parsers::AgentEnv;
use std::collections::BTreeMap;

#[test]
fn saved_root_and_legacy_root_keep_single_hop_acp_aliases_together() {
    let dir = tempfile::tempdir().unwrap();
    let native_root = dir.path().join("chosen");
    let legacy_base = dir.path().join("legacy");
    for (home, expected) in [
        (native_root.to_string_lossy().into_owned(), native_root),
        (String::new(), legacy_base.join(".zcode")),
    ] {
        let inherited = std::env::var_os("ZCODE_HOME");
        let env = AgentEnv::from_overrides(BTreeMap::from([
            ("ZCODE_HOME".to_string(), home),
            (
                "ZCODE_DATA_BASE_DIR".to_string(),
                legacy_base.to_string_lossy().into_owned(),
            ),
        ]));
        std::fs::create_dir_all(expected.join("v2")).unwrap();
        std::fs::write(
            expected.join("v2/acp-lazy-sessions.json"),
            r#"{
            "acp-uuid":{"zcodeSid":"sess_native"},
            "second-hop":{"zcodeSid":"acp-uuid"},
            "sess_existing":{"zcodeSid":"sess_other"}
        }"#,
        )
        .unwrap();
        let parser = ZcodeParser::for_env(&env);
        assert_eq!(parser.db_path, expected.join("cli/db/db.sqlite"));
        assert_eq!(
            parser.resolve_session_alias("acp-uuid").as_deref(),
            Some("sess_native")
        );
        assert!(parser.resolve_session_alias("second-hop").is_none());
        assert!(parser.resolve_session_alias("sess_existing").is_none());
        assert_eq!(std::env::var_os("ZCODE_HOME"), inherited);
    }
}
