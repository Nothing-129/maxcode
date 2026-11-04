use super::*;

#[test]
fn whole_file_reads_are_agent_specific_under_every_policy() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("large.txt");
    let text = "x".repeat(3 * 1024 * 1024);
    std::fs::write(&path, &text).unwrap();
    for mode in ["strict", "default", "unrestricted"] {
        let env = BTreeMap::from([(FS_POLICY_ENV.to_string(), mode.to_string())]);
        let policy = FsAccessPolicy::from_env(dir.path(), AgentType::Antigravity, &env);
        assert_eq!(
            read_text_file_impl(&path, None, None, &policy).unwrap(),
            text
        );
        for agent in [
            AgentType::ClaudeCode,
            AgentType::Codex,
            AgentType::Grok,
            AgentType::Pi,
            AgentType::DeepSeek,
            AgentType::Zcode,
        ] {
            let policy = FsAccessPolicy::from_env(dir.path(), agent, &env);
            assert!(
                read_text_file_impl(&path, None, None, &policy).is_err(),
                "{agent} {mode}"
            );
        }
    }
    std::fs::write(&path, vec![b'x'; FS_MAX_FILE_SIZE_BYTES as usize + 1]).unwrap();
    let policy = FsAccessPolicy::permissive(dir.path(), AgentType::Antigravity, &BTreeMap::new());
    assert!(read_text_file_impl(&path, None, None, &policy).is_err());
    let outside = tempfile::NamedTempFile::new().unwrap();
    let env = BTreeMap::from([(FS_POLICY_ENV.to_string(), "strict".to_string())]);
    let strict = FsAccessPolicy::from_env(dir.path(), AgentType::Antigravity, &env);
    assert!(read_text_file_impl(outside.path(), None, None, &strict).is_err());
}
