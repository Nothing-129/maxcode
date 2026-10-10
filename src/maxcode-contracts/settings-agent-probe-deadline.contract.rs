use super::*;

fn fake_npm(dir: &Path, body: &str) -> PathBuf {
    #[cfg(windows)]
    let (name, script) = ("npm.cmd", format!("@echo off\r\n{body}\r\n"));
    #[cfg(not(windows))]
    let (name, script) = ("npm", format!("#!/bin/sh\n{body}\n"));
    let bin = dir.join(name);
    fs::write(&bin, script).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
    }
    bin
}

#[tokio::test]
async fn hung_npm_metadata_does_not_strand_settings_requests() {
    let dir = tempfile::tempdir().unwrap();
    #[cfg(windows)]
    let body = ":again\r\ngoto again";
    #[cfg(not(windows))]
    let body = "while :; do :; done";
    let bin = fake_npm(dir.path(), body);
    let started = std::time::Instant::now();
    // Drive the real subprocess deadline, including npm's .cmd shape on
    // Windows. The outer deadline makes removal of the production limit fail.
    let version = tokio::time::timeout(
        Duration::from_secs(8),
        npm_list_version(&bin, "@test/agent", None),
    )
    .await
    .expect("a wedged npm must return before the frontend's 60s deadline");
    assert_eq!(version, None);
    assert!(started.elapsed() >= NPM_LIST_TIMEOUT);
}

#[tokio::test]
async fn npm_metadata_still_reports_installed_versions() {
    let dir = tempfile::tempdir().unwrap();
    #[cfg(windows)]
    let body = "echo {\"dependencies\":{\"@test/agent\":{\"version\":\"1.2.3\"}}}";
    #[cfg(not(windows))]
    let body = "echo '{\"dependencies\":{\"@test/agent\":{\"version\":\"1.2.3\"}}}'";
    let bin = fake_npm(dir.path(), body);
    assert_eq!(
        npm_list_version(&bin, "@test/agent", None).await.as_deref(),
        Some("1.2.3")
    );
}

#[tokio::test]
async fn failed_npm_metadata_keeps_cli_version_fallback_usable() {
    let dir = tempfile::tempdir().unwrap();
    let bin = fake_npm(dir.path(), "echo adapter/2.3.4");
    assert_eq!(npm_list_version(&bin, "@test/agent", None).await, None);
    assert_eq!(
        system_probed_version_with(None, &bin, None)
            .await
            .as_deref(),
        Some("2.3.4")
    );
}

#[tokio::test]
async fn settings_version_probes_run_together_instead_of_queueing() {
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    let first_ready = first.path().join("ready");
    let second_ready = second.path().join("ready");
    let script = |own: &Path, other: &Path| {
        #[cfg(windows)]
        let body = format!(
            "echo ready>\"{}\"\r\n:wait\r\nif not exist \"{}\" goto wait\r\necho adapter/1.2.3",
            own.display(),
            other.display()
        );
        #[cfg(not(windows))]
        let body = format!(
            "touch '{}'\nwhile [ ! -f '{}' ]; do sleep 0.01; done\necho adapter/1.2.3",
            own.display(),
            other.display()
        );
        body
    };
    let first_bin = fake_npm(first.path(), &script(&first_ready, &second_ready));
    let second_bin = fake_npm(second.path(), &script(&second_ready, &first_ready));
    // Each fake CLI waits for the other to start. Serial probing cannot pass;
    // concurrent probing completes without waiting for either CLI's timeout.
    let installations = tokio::time::timeout(
        Duration::from_secs(8),
        probe_agent_installations(vec![
            (AgentType::DeepSeek, None, Some(first_bin)),
            (AgentType::Zcode, None, Some(second_bin)),
        ]),
    )
    .await
    .expect("independent settings version probes must start together");
    for agent in [AgentType::DeepSeek, AgentType::Zcode] {
        assert_eq!(installations[&agent], (true, "npx", Some("1.2.3".into())));
    }
}
