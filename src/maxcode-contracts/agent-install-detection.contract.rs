use super::*;

/// Register an npx agent for the detection tests below. The caller holds
/// the registry lock. Its command and package are unique to the test, so
/// whether the command resolves is up to the test's own HOME
/// (`~/.codeg/npm-global/bin`), never to what this machine has installed.
fn register_npx_detection_agent(id: &str) -> AgentType {
    use crate::acp::custom_registry::{
        CustomAgentDef, CustomAgentSpec, CustomDistributionKind, NpxSpec,
    };
    let def = CustomAgentDef {
        registry_id: id.to_string(),
        name: id.to_string(),
        description: String::new(),
        version: "0.0.34".into(),
        distribution_kind: CustomDistributionKind::Npx,
        spec: CustomAgentSpec {
            npx: Some(NpxSpec {
                package: format!("{id}@0.0.34"),
                args: Vec::new(),
                env: BTreeMap::new(),
                cmd: Some(id.to_string()),
                node_required: None,
            }),
            ..Default::default()
        },
        icon_url: None,
        skills_shared_store: false,
        skills_dir: None,
        source: Default::default(),
        version_probe: None,
        supports_mcp: true,
    };
    assert!(
        custom_registry::hydrate(&[def]).is_empty(),
        "the definition registers"
    );
    AgentType::custom(id).expect("a valid custom id")
}

/// A settings row for `agent` that records `version` as installed.
async fn db_recording_installed_version(agent: AgentType, version: &str) -> AppDatabase {
    let db = crate::db::test_helpers::fresh_in_memory_db().await;
    agent_setting_service::ensure_defaults(
        &db.conn,
        &[agent_setting_service::AgentDefaultInput {
            agent_type: agent,
            registry_id: registry::registry_id_for(agent).to_string(),
            default_sort_order: 0,
        }],
    )
    .await
    .expect("settings row");
    agent_setting_service::set_installed_version(&db.conn, agent, Some(version.to_string()))
        .await
        .expect("installed version");
    db
}

async fn stored_installed_version(db: &AppDatabase, agent: AgentType) -> Option<String> {
    agent_setting_service::get_by_agent_type(&db.conn, agent)
        .await
        .expect("settings row")
        .and_then(|m| m.installed_version)
}

// An npx agent recorded as installed whose command no longer resolves (the
// package was removed outside codeg, or the npm global prefix moved on a
// Node version switch) cannot be launched, so detection must say so. It
// used to hand the stored version back, and Settings showed the agent as
// installed and up to date while every connect refused it as not installed.
#[allow(clippy::await_holding_lock)]
#[tokio::test]
async fn detection_clears_a_stored_npx_version_whose_command_no_longer_resolves() {
    let _registry = custom_registry::hydrate_test_guard();
    let agent = register_npx_detection_agent("detect-gone-npx-agent");
    let db = db_recording_installed_version(agent, "0.0.34").await;
    let broadcaster = std::sync::Arc::new(crate::web::event_bridge::WebEventBroadcaster::new());
    let mut events = broadcaster.subscribe();
    let emitter = EventEmitter::test_web_only(broadcaster.clone());
    let home = tempfile::tempdir().expect("tempdir");

    let (gate, detected) = temp_env::async_with_vars([("HOME", Some(home.path()))], async {
        let gate = verify_agent_installed(agent).await;
        let detected = acp_detect_agent_local_version_core(agent, &db.conn, &emitter)
            .await
            .expect("detection runs");
        (gate, detected)
    })
    .await;
    custom_registry::hydrate(&[]);

    assert!(gate.is_err(), "the connect gate refuses the agent");
    assert_eq!(detected, None, "detection agrees with the connect gate");
    assert_eq!(stored_installed_version(&db, agent).await, None);
    let event = events.try_recv().expect("the composer is told to reload");
    assert_eq!(event.channel, ACP_AGENTS_UPDATED_EVENT);
    assert_eq!(event.payload["reason"], "local_version_cleared");
}

// The stored version still stands in when the command resolves and only
// its version could not be read this time (`npm list` failing, a
// `--version` that prints nothing): the agent is launchable.
#[cfg(unix)]
#[allow(clippy::await_holding_lock)]
#[tokio::test]
async fn detection_keeps_a_stored_npx_version_whose_command_resolves_without_a_version() {
    let _registry = custom_registry::hydrate_test_guard();
    let agent = register_npx_detection_agent("detect-quiet-npx-agent");
    let db = db_recording_installed_version(agent, "0.0.34").await;
    let home = tempfile::tempdir().expect("tempdir");
    let bin_dir = home.path().join(".codeg").join("npm-global").join("bin");
    std::fs::create_dir_all(&bin_dir).expect("bin dir");
    use std::os::unix::fs::PermissionsExt;
    let bin = bin_dir.join("detect-quiet-npx-agent");
    std::fs::write(&bin, "#!/bin/sh\n").expect("write script");
    std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).expect("chmod");

    let (gate, detected) = temp_env::async_with_vars([("HOME", Some(home.path()))], async {
        let gate = verify_agent_installed(agent).await;
        let detected = acp_detect_agent_local_version_core(agent, &db.conn, &EventEmitter::Noop)
            .await
            .expect("detection runs");
        (gate, detected)
    })
    .await;
    custom_registry::hydrate(&[]);

    assert!(
        gate.is_ok(),
        "the command resolves in the user npm fallback prefix: {gate:?}"
    );
    assert_eq!(detected.as_deref(), Some("0.0.34"));
    assert_eq!(
        stored_installed_version(&db, agent).await.as_deref(),
        Some("0.0.34")
    );
}

#[test]
fn a_repository_mcp_config_is_explicitly_a_code_executing_pi_resource() {
    let workspace = tempfile::tempdir().expect("workspace");
    let pi_dir = workspace.path().join(".pi");
    std::fs::create_dir(&pi_dir).unwrap();
    std::fs::write(
        pi_dir.join("mcp.json"),
        r#"{"mcpServers":{"local":{"command":"node"}}}"#,
    )
    .unwrap();
    let resources = pi_project_trust_resources(workspace.path());
    assert_eq!(resources.len(), 1);
    assert_eq!(resources[0].kind, ".pi/mcp.json");
    assert!(resources[0].executes_code);
}
