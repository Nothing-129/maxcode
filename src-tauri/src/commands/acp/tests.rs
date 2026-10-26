use super::*;

#[test]
fn extract_version_token_finds_the_version_in_common_banners() {
    assert_eq!(extract_version_token("0.21.0").as_deref(), Some("0.21.0"));
    assert_eq!(
        extract_version_token("qwen version 0.21.0\n").as_deref(),
        Some("0.21.0")
    );
    assert_eq!(
        extract_version_token("goose v1.44.0 (release)").as_deref(),
        Some("1.44.0")
    );
    assert_eq!(
        extract_version_token("Foo CLI\nversion: 2.3.4-beta.1").as_deref(),
        Some("2.3.4-beta.1")
    );
    // A leading `v` is stripped; the word "version" is not mistaken for one.
    assert_eq!(
        extract_version_token("version v10.2.30").as_deref(),
        Some("10.2.30")
    );
    // curl-style `name/version` banners (omp prints exactly this).
    assert_eq!(
        extract_version_token("omp/17.1.7").as_deref(),
        Some("17.1.7")
    );
    // npm-style `package@version`, scoped packages included.
    assert_eq!(
        extract_version_token("@oh-my-pi/pi-coding-agent@17.1.7").as_deref(),
        Some("17.1.7")
    );
}

#[test]
fn extract_version_token_rejects_non_versions() {
    assert!(extract_version_token("").is_none());
    assert!(extract_version_token("usage: foo [args]").is_none());
    // Dotted but not digit-led, and digit-led but not dotted.
    assert!(extract_version_token("node.js required").is_none());
    assert!(extract_version_token("exit 1").is_none());
    // A URL's path segment must not read as a version, and slash-split
    // pieces without a dot don't qualify either.
    assert!(extract_version_token("docs: https://example.com/2.0/setup").is_none());
    assert!(extract_version_token("built 2026/07").is_none());
}

#[test]
fn probe_cache_key_misses_when_the_declared_probe_or_package_changes() {
    let bin = std::path::Path::new("/usr/local/bin/agent");
    // Editing the declared probe MUST be a cache miss — this was the bug:
    // a path+mtime key kept serving the old probe's result.
    let auto = probe_cache_key(bin, None, None);
    let probe_a = probe_cache_key(bin, Some("agent --version"), None);
    let probe_b = probe_cache_key(bin, Some("agent -V"), None);
    assert_ne!(auto, probe_a);
    assert_ne!(probe_a, probe_b);
    // Removing the probe again returns to the auto key.
    assert_eq!(probe_cache_key(bin, None, None), auto);
    // Two agents sharing a launcher but naming different npm packages must
    // not read each other's auto-path result…
    let pkg_a = probe_cache_key(bin, None, Some("@scope/a"));
    let pkg_b = probe_cache_key(bin, None, Some("@scope/b"));
    assert_ne!(pkg_a, pkg_b);
    // …and the package stays in the key even with a declared probe: a
    // failing probe falls back to the package conventions, so the package
    // still shapes the cached result.
    assert_ne!(
        probe_cache_key(bin, Some("agent --version"), Some("@scope/a")),
        probe_cache_key(bin, Some("agent --version"), Some("@scope/b")),
    );
}

#[cfg(unix)]
fn fake_version_script(dir: &std::path::Path, name: &str, banner: &str) -> PathBuf {
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;

    let bin = dir.join(name);
    {
        let mut f = std::fs::File::create(&bin).expect("create script");
        f.write_all(format!("#!/bin/sh\necho \"{banner}\"\n").as_bytes())
            .expect("write script");
    }
    std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    bin
}

#[cfg(unix)]
#[tokio::test]
async fn system_probed_version_reads_a_system_cli_via_the_version_convention() {
    let dir = tempfile::tempdir().expect("tempdir");
    let bin = fake_version_script(dir.path(), "fake-agent", "fake-agent version 1.2.3");

    // Unregistered custom id → no declared probe → the auto `--version`
    // path, exactly what a hand-added agent without a probe gets. The
    // same path serves built-ins, which can never declare a probe.
    let version = system_probed_version(AgentType::Custom("probe-e2e-test"), &bin, None).await;
    assert_eq!(version.as_deref(), Some("1.2.3"));
}

#[cfg(unix)]
#[tokio::test]
async fn a_failing_declared_probe_falls_back_to_the_version_convention() {
    let dir = tempfile::tempdir().expect("tempdir");
    // `name/version` banner — the shape that motivated the token split.
    let bin = fake_version_script(dir.path(), "fallback-agent", "fallback-agent/3.2.1");

    // The declared probe's program doesn't exist, so the probe yields
    // nothing; the convention path must still read the real install.
    let version =
        system_probed_version_with(Some("codeg-missing-probe-cmd-e2e --version"), &bin, None).await;
    assert_eq!(version.as_deref(), Some("3.2.1"));
}

#[test]
fn parse_grok_settings_reads_documented_keys() {
    let toml = "[ui]\npermission_mode = \"acceptEdits\"\n\n\
                    [models]\ndefault_reasoning_effort = \"high\"\n";
    let s = parse_grok_settings(toml);
    assert_eq!(s.permission_mode.as_deref(), Some("acceptEdits"));
    assert_eq!(s.default_reasoning_effort.as_deref(), Some("high"));
}

#[test]
fn parse_grok_settings_migrates_legacy_permission_values() {
    // codeg's old codeg-invented markers map onto grok's real enum so the
    // dropdown, launch flag, and grok's TUI agree.
    let approve = parse_grok_settings("[ui]\npermission_mode = \"always-approve\"\n");
    assert_eq!(
        approve.permission_mode.as_deref(),
        Some("bypassPermissions")
    );
    let ask = parse_grok_settings("[ui]\npermission_mode = \"ask\"\n");
    assert_eq!(ask.permission_mode.as_deref(), Some("default"));
    // A real grok mode is preserved untouched.
    let real = parse_grok_settings("[ui]\npermission_mode = \"auto\"\n");
    assert_eq!(real.permission_mode.as_deref(), Some("auto"));
}

#[test]
fn parse_grok_settings_absent_or_malformed_is_none() {
    let s = parse_grok_settings("[cli]\nauto_update = true\n");
    assert!(s.permission_mode.is_none());
    assert!(s.default_reasoning_effort.is_none());
    // Malformed TOML → all None, never panics.
    let bad = parse_grok_settings("this is not = = = toml");
    assert!(bad.default_reasoning_effort.is_none());
}

#[test]
fn apply_grok_structured_config_sets_and_creates_tables() {
    // Starting from an empty file, both keys land in their tables.
    let merged = apply_grok_structured_config(
        "",
        &GrokStructuredConfig {
            default_reasoning_effort: Some("high".into()),
            permission_mode: Some("acceptEdits".into()),
            ..Default::default()
        },
    )
    .unwrap();
    let back = parse_grok_settings(&merged);
    assert_eq!(back.default_reasoning_effort.as_deref(), Some("high"));
    assert_eq!(back.permission_mode.as_deref(), Some("acceptEdits"));
}

#[test]
fn apply_grok_structured_config_preserves_other_sections_and_comments() {
    let base = "# my grok config\n[cli]\nauto_update = true  # keep me\n\n\
                    [mcp_servers.context7]\ncommand = \"npx\"\n\n[models]\ndefault = \"grok-4.5\"\n";
    let merged = apply_grok_structured_config(
        base,
        &GrokStructuredConfig {
            default_reasoning_effort: Some("low".into()),
            permission_mode: Some("bypassPermissions".into()),
            ..Default::default()
        },
    )
    .unwrap();
    // Comments + unmanaged sections/keys survive (toml_edit is format-
    // preserving); the unmanaged `[models].default` is NOT touched.
    assert!(merged.contains("# my grok config"));
    assert!(merged.contains("# keep me"));
    assert!(merged.contains("[mcp_servers.context7]"));
    assert!(merged.contains("default = \"grok-4.5\""));
    let back = parse_grok_settings(&merged);
    assert_eq!(back.default_reasoning_effort.as_deref(), Some("low"));
    assert_eq!(back.permission_mode.as_deref(), Some("bypassPermissions"));
}

#[test]
fn apply_grok_structured_config_preserves_inline_table_siblings() {
    // A `[models]` written as an inline table must keep its other keys when a
    // managed key is set (regression: `is_table()` misses inline tables and
    // would clobber the whole value).
    let base = "models = { default = \"grok-4.5\", session_summary = \"grok-4.5\" }\n";
    let merged = apply_grok_structured_config(
        base,
        &GrokStructuredConfig {
            default_reasoning_effort: Some("high".into()),
            permission_mode: None,
            ..Default::default()
        },
    )
    .unwrap();
    assert!(
        merged.contains("session_summary"),
        "inline sibling preserved"
    );
    assert!(merged.contains("grok-4.5"), "inline default preserved");
    assert_eq!(
        parse_grok_settings(&merged)
            .default_reasoning_effort
            .as_deref(),
        Some("high")
    );
}

#[test]
fn apply_grok_structured_config_removes_on_none() {
    let base = "[ui]\npermission_mode = \"ask\"\n\n\
                    [models]\ndefault_reasoning_effort = \"high\"\n";
    let merged = apply_grok_structured_config(base, &GrokStructuredConfig::default()).unwrap();
    let back = parse_grok_settings(&merged);
    assert!(back.permission_mode.is_none(), "unset removes the key");
    assert!(back.default_reasoning_effort.is_none());
}

#[test]
fn apply_grok_structured_config_rejects_malformed_or_incompatible_base() {
    assert!(
        apply_grok_structured_config("== not toml ==", &GrokStructuredConfig::default()).is_err(),
        "a malformed base must error, never silently overwrite the user's config"
    );
    // A section that exists as a scalar must error rather than be replaced.
    let incompatible = apply_grok_structured_config(
        "ui = 1\n",
        &GrokStructuredConfig {
            default_reasoning_effort: None,
            permission_mode: Some("ask".into()),
            ..Default::default()
        },
    );
    assert!(
        incompatible.is_err(),
        "an incompatible non-table section must error, not clobber"
    );
}

// ---- Codex sandbox / approval structured controls -------------------
// Every expectation below was verified against a real codex-cli 0.145.0 by
// writing the shape into an isolated `CODEX_HOME` and reading the resulting
// `thread/start` sandbox back.

#[test]
fn parse_codex_sandbox_settings_reads_plain_keys() {
    let s = parse_codex_sandbox_settings(
        "approval_policy = \"never\"\nsandbox_mode = \"danger-full-access\"\n",
    );
    assert_eq!(s.approval_policy.as_deref(), Some("never"));
    assert_eq!(s.sandbox_mode.as_deref(), Some("danger-full-access"));
    assert!(s.granular.is_none());
    assert!(!s.shadowed_by_default_permissions);
}

#[test]
fn parse_codex_sandbox_settings_normalizes_legacy_on_failure() {
    // `on-failure` is a serde ALIAS of `on-request` upstream, not a distinct
    // policy, so the panel must show it as `on-request` rather than as an
    // unknown value it would then clobber.
    let s = parse_codex_sandbox_settings("approval_policy = \"on-failure\"\n");
    assert_eq!(s.approval_policy.as_deref(), Some("on-request"));
}

/// Map a config.toml body the way the launch path does.
fn initial_mode_for(toml: &str) -> Option<&'static str> {
    codex_initial_agent_mode(&parse_codex_sandbox_settings(toml))
}

#[test]
fn codex_initial_agent_mode_never_widens_the_sandbox() {
    // The invariant that matters: codex-acp's default preset is `agent`
    // (workspace-write), so an explicitly read-only config used to be
    // silently upgraded to writable. Every approval policy — including the
    // ones that cannot be represented — must still land on `read-only`.
    for policy in [
        "",
        "approval_policy = \"untrusted\"\n",
        "approval_policy = \"on-request\"\n",
        "approval_policy = \"on-failure\"\n",
        "approval_policy = \"never\"\n",
    ] {
        let toml = format!("{policy}sandbox_mode = \"read-only\"\n");
        assert_eq!(
            initial_mode_for(&toml),
            Some("read-only"),
            "read-only sandbox must survive {policy:?}"
        );
    }
    for policy in ["", "approval_policy = \"untrusted\"\n"] {
        let toml = format!("{policy}sandbox_mode = \"workspace-write\"\n");
        assert_eq!(initial_mode_for(&toml), Some("workspace-write"));
    }
}

#[test]
fn codex_initial_agent_mode_keeps_a_writable_config_writable_on_every_adapter() {
    // Regression guard for a fix that looks right and is not. codex-acp
    // 1.7.0 turned `read-only` into a workspace-write preset whose
    // approvals are user-adjudicated, which invites mapping EVERY
    // approval-wanting config onto it. But `supports_custom_version()` is
    // true for npx agents, and on a user-pinned ≤1.6.2 that preset is still
    // a genuinely READ-ONLY sandbox — the agent would silently be unable to
    // write a single file. `INITIAL_AGENT_MODE` is chosen before launch, so
    // the running adapter's version is not knowable here; the mapping must
    // therefore stay keyed on the sandbox, which is the axis whose meaning
    // did not move. See the "Why the reviewer axis is NOT used" note above.
    //
    // codex-acp 2.0.0 adds the preset that config actually describes —
    // `workspace-write`, a writable workspace whose escalations go to the
    // user — and an adapter that predates the id starts in its `agent`
    // default instead (`getInitialAgentMode`: an unknown id falls back),
    // which is exactly the old mapping. Writable on every version either
    // way; never `read-only`.
    for policy in [
        "",
        "approval_policy = \"on-request\"\n",
        "approval_policy = \"on-failure\"\n",
        "approval_policy = \"untrusted\"\n",
    ] {
        let toml = format!("{policy}sandbox_mode = \"workspace-write\"\n");
        assert_eq!(
            initial_mode_for(&toml),
            Some("workspace-write"),
            "a writable config must never be handed the read-only preset ({policy:?})"
        );
    }
    // No approvals wanted: no preset says exactly that without widening the
    // sandbox, and the model-screened default is the nearest.
    assert_eq!(
        initial_mode_for("approval_policy = \"never\"\nsandbox_mode = \"workspace-write\"\n"),
        Some("agent")
    );
}

#[test]
fn codex_initial_agent_mode_only_grants_full_access_on_an_exact_match() {
    // `agent-full-access` is the one preset with approvalPolicy `never`, so
    // it must never be inferred — both halves have to already say so.
    assert_eq!(
        initial_mode_for("approval_policy = \"never\"\nsandbox_mode = \"danger-full-access\"\n"),
        Some("agent-full-access")
    );
    // Sandbox says full access but approvals are still wanted: tighten the
    // sandbox to workspace-write rather than dropping approvals.
    for policy in [
        "",
        "approval_policy = \"on-request\"\n",
        "approval_policy = \"untrusted\"\n",
    ] {
        let toml = format!("{policy}sandbox_mode = \"danger-full-access\"\n");
        assert_eq!(
            initial_mode_for(&toml),
            Some("workspace-write"),
            "must not remove approvals for {policy:?}"
        );
    }
    // `never` alone must NOT reach for full access — that would widen the
    // sandbox from whatever codex-acp would otherwise use.
    assert_eq!(initial_mode_for("approval_policy = \"never\"\n"), None);
}

#[test]
fn codex_initial_agent_mode_declines_when_default_permissions_shadows_the_root_keys() {
    // codex resolves through the named profile and ignores the root keys, so
    // mapping them would hand the session a policy the config never asked
    // for. The nastiest case: a read-only profile with stale permissive root
    // keys would be GRANTED full access + no approvals, because codex-acp
    // re-sends the preset's policy every turn.
    assert_eq!(
        initial_mode_for(
            "approval_policy = \"never\"\nsandbox_mode = \"danger-full-access\"\n\
                 default_permissions = \":read-only\"\n"
        ),
        None,
        "must not widen a shadowed config"
    );
    // Declining is unconditional — even when the root keys look harmless,
    // they are not what codex is using.
    for body in [
        "sandbox_mode = \"read-only\"\ndefault_permissions = \":read-only\"\n",
        "sandbox_mode = \"workspace-write\"\ndefault_permissions = \":full-access\"\n",
    ] {
        assert_eq!(initial_mode_for(body), None, "shadowed: {body:?}");
    }
}

#[test]
fn codex_initial_agent_mode_stays_out_of_the_way_without_a_sandbox() {
    // Nothing expressed → nothing to preserve; leave codex-acp's own default
    // alone rather than pinning a preset the user never chose.
    assert_eq!(initial_mode_for(""), None);
    assert_eq!(initial_mode_for("model = \"gpt-5\"\n"), None);
    assert_eq!(initial_mode_for("approval_policy = \"untrusted\"\n"), None);
    // Unknown/malformed sandbox values are dropped by the parser, so they
    // behave like "unset" rather than mapping to something arbitrary.
    assert_eq!(initial_mode_for("sandbox_mode = \"wide-open\"\n"), None);
    assert_eq!(initial_mode_for("this is not toml\n"), None);
}

#[test]
fn parse_codex_sandbox_settings_reads_granular_in_both_toml_forms() {
    let inline = parse_codex_sandbox_settings(
        "approval_policy = { granular = { sandbox_approval = true, rules = false, \
             skill_approval = true, request_permissions = false, mcp_elicitations = true } }\n",
    );
    let section = parse_codex_sandbox_settings(
        "[approval_policy.granular]\nsandbox_approval = true\nrules = false\n\
             skill_approval = true\nrequest_permissions = false\nmcp_elicitations = true\n",
    );
    for s in [inline, section] {
        assert!(s.approval_policy.is_none(), "granular is not a string form");
        let g = s.granular.expect("granular table");
        assert!(g.sandbox_approval && g.skill_approval && g.mcp_elicitations);
        assert!(!g.rules && !g.request_permissions);
    }
}

#[test]
fn parse_codex_sandbox_settings_reads_workspace_write_group() {
    let s = parse_codex_sandbox_settings(
        "sandbox_mode = \"workspace-write\"\n\n[sandbox_workspace_write]\n\
             writable_roots = [\"/srv/one\", \"/srv/two\"]\nnetwork_access = true\n\
             exclude_slash_tmp = true\n",
    );
    assert_eq!(s.workspace_write.writable_roots, ["/srv/one", "/srv/two"]);
    assert!(s.workspace_write.network_access);
    assert!(s.workspace_write.exclude_slash_tmp);
    assert!(!s.workspace_write.exclude_tmpdir_env_var);
}

#[test]
fn parse_codex_sandbox_settings_flags_profile_shadowing() {
    // `default_permissions` makes codex resolve permissions through the
    // profile pipeline and ignore `sandbox_mode` entirely — verified live:
    // `:read-only` + `danger-full-access` yields a read-only sandbox.
    let s = parse_codex_sandbox_settings(
        "sandbox_mode = \"danger-full-access\"\ndefault_permissions = \":read-only\"\n\n\
             [permissions.tight]\nfile_system = \"restricted\"\n",
    );
    assert!(s.shadowed_by_default_permissions);
    assert!(s.has_permissions_table);
}

#[test]
fn parse_codex_sandbox_settings_ignores_unknown_values_and_bad_toml() {
    let unknown =
        parse_codex_sandbox_settings("approval_policy = \"yolo\"\nsandbox_mode = \"wide-open\"\n");
    assert!(unknown.approval_policy.is_none());
    assert!(unknown.sandbox_mode.is_none());
    let broken = parse_codex_sandbox_settings("== not toml ==");
    assert!(broken.sandbox_mode.is_none());
}

/// Set a field: `Some(Some(v))`. Clear it: `Some(None)`. Leave it exactly as
/// the base has it: `None` (the struct default).
fn set<T>(value: T) -> Option<Option<T>> {
    Some(Some(value))
}

#[test]
fn apply_codex_sandbox_config_writes_and_preserves_unmanaged_keys() {
    let base = "# keep me\nmodel = \"gpt-5\"\n\n[features]\nskills = true\n";
    let merged = apply_codex_sandbox_config(
        base,
        &CodexSandboxStructuredConfig {
            approval_policy: set("never".into()),
            sandbox_mode: set("workspace-write".into()),
            writable_roots: Some(vec!["/srv/extra".into()]),
            network_access: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(merged.contains("# keep me"), "comments survive");
    assert!(merged.contains("model = \"gpt-5\""));
    assert!(merged.contains("skills = true"));
    let back = parse_codex_sandbox_settings(&merged);
    assert_eq!(back.approval_policy.as_deref(), Some("never"));
    assert_eq!(back.sandbox_mode.as_deref(), Some("workspace-write"));
    assert_eq!(back.workspace_write.writable_roots, ["/srv/extra"]);
    assert!(back.workspace_write.network_access);
}

#[test]
fn apply_codex_sandbox_config_writes_all_five_granular_keys() {
    // `sandbox_approval`, `rules` and `mcp_elicitations` have no upstream
    // default: a partial table makes codex refuse to load config.toml
    // ("missing field `sandbox_approval`"), so all five are always written.
    let merged = apply_codex_sandbox_config(
        "",
        &CodexSandboxStructuredConfig {
            granular: set(CodexGranularApproval {
                sandbox_approval: true,
                ..Default::default()
            }),
            ..Default::default()
        },
    )
    .unwrap();
    for key in [
        "sandbox_approval",
        "rules",
        "skill_approval",
        "request_permissions",
        "mcp_elicitations",
    ] {
        assert!(merged.contains(key), "granular table must carry {key}");
    }
    assert!(parse_codex_sandbox_settings(&merged).granular.is_some());
}

#[test]
fn apply_codex_sandbox_config_switches_granular_back_to_a_preset() {
    // The string form must REPLACE the table; an emptied `[approval_policy]`
    // would fail to deserialize as the externally tagged enum.
    let base = "[approval_policy.granular]\nsandbox_approval = true\nrules = true\n\
                    skill_approval = false\nrequest_permissions = false\nmcp_elicitations = true\n";
    let merged = apply_codex_sandbox_config(
        base,
        &CodexSandboxStructuredConfig {
            approval_policy: set("on-request".into()),
            granular: Some(None),
            ..Default::default()
        },
    )
    .unwrap();
    let back = parse_codex_sandbox_settings(&merged);
    assert_eq!(back.approval_policy.as_deref(), Some("on-request"));
    assert!(back.granular.is_none(), "the granular table is gone");
    assert!(!merged.contains("sandbox_approval"));
}

#[test]
fn apply_codex_sandbox_config_keeps_root_keys_out_of_existing_tables() {
    // TOML positioning guard: a root scalar or the `[approval_policy]`
    // granular table must not be emitted AFTER an existing section, which
    // would silently reparent unrelated root keys into that section.
    let base = "model = \"gpt-5\"\nmodel_provider = \"codeg\"\n\n\
                    [features]\nskills = true\n\n\
                    [mcp_servers.ctx]\ncommand = \"npx\"\n";
    let merged = apply_codex_sandbox_config(
        base,
        &CodexSandboxStructuredConfig {
            granular: set(CodexGranularApproval {
                sandbox_approval: true,
                rules: true,
                ..Default::default()
            }),
            sandbox_mode: set("workspace-write".into()),
            network_access: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    let table = merged
        .parse::<toml::Table>()
        .expect("merged config must stay valid TOML");
    assert_eq!(
        table.get("model").and_then(toml::Value::as_str),
        Some("gpt-5"),
        "root keys must stay at the root"
    );
    assert_eq!(
        table.get("model_provider").and_then(toml::Value::as_str),
        Some("codeg")
    );
    assert_eq!(
        table
            .get("features")
            .and_then(toml::Value::as_table)
            .and_then(|t| t.get("skills"))
            .and_then(toml::Value::as_bool),
        Some(true),
        "unmanaged sections keep their own keys"
    );
    assert!(table.get("mcp_servers").is_some());
    let back = parse_codex_sandbox_settings(&merged);
    assert!(back.granular.is_some());
    assert_eq!(back.sandbox_mode.as_deref(), Some("workspace-write"));
    assert!(back.workspace_write.network_access);
}

fn config_with_catalog_ref(value: &str) -> String {
    format!(
        "\
# my codex config
model = \"gw/x\"           # the model
model_catalog_json = \"{value}\"
model_provider = \"codeg\"

[model_providers.codeg]
base_url = \"https://example.test/v1\"
"
    )
}

#[test]
fn remove_codex_catalog_key_is_format_preserving_and_no_op_when_absent() {
    let home = Path::new("/tmp/codeg-test-codex-home");
    let base = config_with_catalog_ref("codeg-model-catalog.json");
    let next = remove_codex_catalog_key(&base, home)
        .unwrap()
        .expect("codeg-owned key was present");
    assert!(!next.contains("model_catalog_json"));
    // Comments and every unmanaged key survive verbatim.
    assert!(next.contains("# my codex config"));
    assert!(next.contains("model = \"gw/x\"           # the model"));
    assert!(next.contains("[model_providers.codeg]"));
    assert!(next.contains("base_url = \"https://example.test/v1\""));
    // No key → no rewrite at all (callers skip the disk write).
    assert!(remove_codex_catalog_key(&next, home).unwrap().is_none());
    assert!(remove_codex_catalog_key("", home).unwrap().is_none());
}

/// The cleanup must only ever reclaim codeg's OWN generated file. A catalog
/// the user wrote by hand (or typed into the advanced config.toml editor)
/// reaches this path on every panel save — deleting its reference would
/// silently orphan the user's models.
#[test]
fn remove_codex_catalog_key_preserves_user_owned_references() {
    let home = Path::new("/tmp/codeg-test-codex-home");
    for foreign in [
        "manual.json",
        "/abs/path/to/manual.json",
        "~/my-catalog.json",
        "nested/codeg-model-catalog.json",
        "  ",
    ] {
        let base = config_with_catalog_ref(foreign);
        assert!(
            remove_codex_catalog_key(&base, home).unwrap().is_none(),
            "must not touch a user-owned reference: {foreign}"
        );
    }
    // An absolute path naming codeg's own file IS codeg-owned.
    let abs = home
        .join(crate::acp::codex_model_catalog::CATALOG_REL)
        .to_string_lossy()
        .into_owned();
    assert!(is_codeg_owned_catalog_ref(&abs, home));
    assert!(is_codeg_owned_catalog_ref(
        crate::acp::codex_model_catalog::CATALOG_REL,
        home
    ));
    assert!(!is_codeg_owned_catalog_ref("manual.json", home));
}

fn catalog_slugs(home: &Path) -> Vec<String> {
    let text = fs::read_to_string(home.join(crate::acp::codex_model_catalog::CATALOG_REL))
        .expect("generated catalog");
    serde_json::from_str::<serde_json::Value>(&text).expect("catalog json")["models"]
        .as_array()
        .expect("models")
        .iter()
        .filter_map(|m| m["slug"].as_str().map(str::to_owned))
        .collect()
}

/// The official list before codex 0.159.1: today's minus GPT-6.1 Sol.
fn catalog_without_gpt_6_1_sol() -> Vec<serde_json::Value> {
    crate::acp::codex_model_catalog::bundled_snapshot_models()
        .into_iter()
        .filter(|m| m["slug"] != "gpt-6.1-sol")
        .collect()
}

/// A catalog codeg generated before an upgrade is re-expanded from its
/// stored intent, so the new official model shows up — in codex's own
/// rank, behind the custom — without the user re-saving anything.
#[test]
fn resync_rewrites_codegs_catalog_against_the_new_official_list() {
    let dir = tempfile::tempdir().expect("tempdir");
    let home = dir.path();
    let config = config_with_catalog_ref(crate::acp::codex_model_catalog::CATALOG_REL);
    fs::write(home.join("config.toml"), &config).unwrap();
    let intent = r#"{"customs":[{"slug":"gw/x","base":"gpt-5.6-sol"}],"default":"gw/x"}"#;
    crate::acp::codex_model_catalog::write_catalog_files(
        intent,
        home,
        &catalog_without_gpt_6_1_sol(),
    )
    .unwrap()
    .expect("customs → generated catalog");
    assert!(!catalog_slugs(home).iter().any(|s| s == "gpt-6.1-sol"));

    // Today's list plus one model no compiled-in snapshot has, so only
    // the list passed in can put it in the table.
    let mut new = crate::acp::codex_model_catalog::bundled_snapshot_models();
    let mut unshipped = new
        .iter()
        .find(|m| m["slug"] == "gpt-5.5")
        .cloned()
        .expect("gpt-5.5 in snapshot");
    unshipped["slug"] = serde_json::Value::String("gpt-test-unshipped".into());
    new.push(unshipped);
    assert_eq!(
        resync_codex_generated_catalog_at(home, &new).unwrap(),
        CodexCatalogResync::Rewritten
    );
    let slugs = catalog_slugs(home);
    assert_eq!(slugs[..3], ["gw/x", "gpt-6.1-sol", "gpt-6-astra"]);
    assert!(slugs.iter().any(|s| s == "gpt-test-unshipped"));
    assert_eq!(slugs.len(), new.len() + 1);
    // The intent and config.toml are untouched: same bytes as before.
    assert_eq!(
        fs::read_to_string(home.join(crate::acp::codex_model_catalog::SOURCE_REL)).unwrap(),
        intent
    );
    assert_eq!(
        fs::read_to_string(home.join("config.toml")).unwrap(),
        config
    );
}

/// Nothing that codeg cannot regenerate is touched: the user's own catalog,
/// a config with no catalog at all, and a codeg catalog whose intent sidecar
/// is gone (re-importing it against the NEW list would read every newly
/// shipped official as one the user removed).
#[test]
fn resync_leaves_catalogs_codeg_cannot_regenerate_alone() {
    let new = crate::acp::codex_model_catalog::bundled_snapshot_models();
    let intent = r#"{"customs":[{"slug":"gw/x","base":"gpt-5.6-sol"}]}"#;
    let catalog_path = |home: &Path| home.join(crate::acp::codex_model_catalog::CATALOG_REL);

    // No config.toml at all.
    let dir = tempfile::tempdir().expect("tempdir");
    assert_eq!(
        resync_codex_generated_catalog_at(dir.path(), &new).unwrap(),
        CodexCatalogResync::NotOwned
    );

    // The user's own catalog, even with a codeg sidecar lying around.
    let dir = tempfile::tempdir().expect("tempdir");
    let home = dir.path();
    fs::write(
        home.join("config.toml"),
        config_with_catalog_ref("manual.json"),
    )
    .unwrap();
    fs::write(
        home.join(crate::acp::codex_model_catalog::SOURCE_REL),
        intent,
    )
    .unwrap();
    assert_eq!(
        resync_codex_generated_catalog_at(home, &new).unwrap(),
        CodexCatalogResync::NotOwned
    );
    assert!(!catalog_path(home).exists(), "no catalog was generated");
    assert_eq!(
        fs::read_to_string(home.join("config.toml")).unwrap(),
        config_with_catalog_ref("manual.json"),
        "the user's reference is left byte-identical"
    );

    // No `model_catalog_json` key.
    fs::write(home.join("config.toml"), "model = \"gpt-5.5\"\n").unwrap();
    assert_eq!(
        resync_codex_generated_catalog_at(home, &new).unwrap(),
        CodexCatalogResync::NotOwned
    );
    assert!(!catalog_path(home).exists(), "no catalog was generated");

    // codeg's reference, but no sidecar: the old table stays as it is.
    let dir = tempfile::tempdir().expect("tempdir");
    let home = dir.path();
    fs::write(
        home.join("config.toml"),
        config_with_catalog_ref(crate::acp::codex_model_catalog::CATALOG_REL),
    )
    .unwrap();
    crate::acp::codex_model_catalog::write_catalog_files(
        intent,
        home,
        &catalog_without_gpt_6_1_sol(),
    )
    .unwrap()
    .expect("seeded");
    fs::remove_file(home.join(crate::acp::codex_model_catalog::SOURCE_REL)).unwrap();
    let before = fs::read_to_string(catalog_path(home)).unwrap();
    assert_eq!(
        resync_codex_generated_catalog_at(home, &new).unwrap(),
        CodexCatalogResync::NotOwned
    );
    assert_eq!(fs::read_to_string(catalog_path(home)).unwrap(), before);
}

/// When the new list makes the takeover moot (the only removal names a model
/// codex has since retired), control goes back to codex: the reference is
/// dropped — format-preservingly — and the generated files with it, so
/// config.toml never points at a file that is gone.
#[test]
fn resync_releases_a_takeover_the_new_list_makes_moot() {
    let dir = tempfile::tempdir().expect("tempdir");
    let home = dir.path();
    fs::write(
        home.join("config.toml"),
        config_with_catalog_ref(crate::acp::codex_model_catalog::CATALOG_REL),
    )
    .unwrap();
    // The old list still LISTED a model the user removed; the new one no
    // longer ships it at all.
    let mut old = crate::acp::codex_model_catalog::bundled_snapshot_models();
    let mut retired = old
        .iter()
        .find(|m| m["slug"] == "gpt-5.5")
        .cloned()
        .expect("gpt-5.5 in snapshot");
    retired["slug"] = serde_json::Value::String("gpt-5.4-retired".into());
    old.push(retired);
    let intent = r#"{"customs":[],"excludedOfficials":["gpt-5.4-retired"]}"#;
    crate::acp::codex_model_catalog::write_catalog_files(intent, home, &old)
        .unwrap()
        .expect("a live removal → generated catalog");

    let new = crate::acp::codex_model_catalog::bundled_snapshot_models();
    assert_eq!(
        resync_codex_generated_catalog_at(home, &new).unwrap(),
        CodexCatalogResync::Released
    );
    let config = fs::read_to_string(home.join("config.toml")).unwrap();
    assert!(!config.contains("model_catalog_json"), "{config}");
    assert!(config.contains("# my codex config"));
    assert!(config.contains("model = \"gw/x\"           # the model"));
    assert!(!home
        .join(crate::acp::codex_model_catalog::CATALOG_REL)
        .exists());
    assert!(!home
        .join(crate::acp::codex_model_catalog::SOURCE_REL)
        .exists());
}

#[test]
fn apply_codex_sandbox_config_removes_keys_and_empty_section() {
    let base = "approval_policy = \"never\"\nsandbox_mode = \"danger-full-access\"\n\n\
                    [sandbox_workspace_write]\nnetwork_access = true\n\n\
                    [features]\nskills = true\n";
    let merged = apply_codex_sandbox_config(
        base,
        &CodexSandboxStructuredConfig {
            approval_policy: Some(None),
            granular: Some(None),
            sandbox_mode: Some(None),
            writable_roots: Some(vec![]),
            network_access: Some(false),
            exclude_tmpdir_env_var: Some(false),
            exclude_slash_tmp: Some(false),
        },
    )
    .unwrap();
    let back = parse_codex_sandbox_settings(&merged);
    assert!(back.approval_policy.is_none());
    assert!(back.sandbox_mode.is_none());
    assert!(
        !merged.contains("sandbox_workspace_write"),
        "empty section removed"
    );
    assert!(merged.contains("skills = true"), "other sections untouched");
}

#[test]
fn apply_codex_sandbox_config_leaves_absent_fields_untouched() {
    // The core of the patch contract. The settings panel sends the raw
    // config.toml text alongside this patch and the patch wins, so a field
    // the user did not move must not be written from the panel's (possibly
    // stale) view — otherwise a hand-edit in the raw editor gets reverted.
    let base = "approval_policy = \"never\"\nsandbox_mode = \"read-only\"\n\n\
                    [sandbox_workspace_write]\nwritable_roots = [\"/srv/keep\"]\n\
                    network_access = true\nexclude_slash_tmp = true\n";
    let merged = apply_codex_sandbox_config(
        base,
        // Only the sandbox mode moved.
        &CodexSandboxStructuredConfig {
            sandbox_mode: set("workspace-write".into()),
            ..Default::default()
        },
    )
    .unwrap();
    let back = parse_codex_sandbox_settings(&merged);
    assert_eq!(back.sandbox_mode.as_deref(), Some("workspace-write"));
    assert_eq!(
        back.approval_policy.as_deref(),
        Some("never"),
        "an untouched approval must survive the patch"
    );
    assert_eq!(back.workspace_write.writable_roots, ["/srv/keep"]);
    assert!(back.workspace_write.network_access);
    assert!(back.workspace_write.exclude_slash_tmp);
}

#[test]
fn apply_codex_sandbox_config_empty_patch_is_a_no_op() {
    let base = "model = \"gpt-5\"\nsandbox_mode = \"read-only\"\n\n\
                    [approval_policy.granular]\nsandbox_approval = true\nrules = true\n\
                    skill_approval = false\nrequest_permissions = false\n\
                    mcp_elicitations = true\n\n\
                    [sandbox_workspace_write]\nnetwork_access = true\n";
    // An all-absent patch must not touch a single key.
    let merged =
        apply_codex_sandbox_config(base, &CodexSandboxStructuredConfig::default()).unwrap();
    assert_eq!(merged.trim(), base.trim());
}

#[test]
fn apply_codex_sandbox_config_partial_workspace_write_patch() {
    // Toggling one flag must not disturb its siblings or the roots list.
    let base = "[sandbox_workspace_write]\nwritable_roots = [\"/srv/keep\"]\n\
                    network_access = true\n";
    let merged = apply_codex_sandbox_config(
        base,
        &CodexSandboxStructuredConfig {
            exclude_slash_tmp: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    let back = parse_codex_sandbox_settings(&merged);
    assert_eq!(back.workspace_write.writable_roots, ["/srv/keep"]);
    assert!(back.workspace_write.network_access);
    assert!(back.workspace_write.exclude_slash_tmp);

    // Clearing the last remaining key drops the now-bare section header.
    let emptied = apply_codex_sandbox_config(
        "[sandbox_workspace_write]\nnetwork_access = true\n",
        &CodexSandboxStructuredConfig {
            network_access: Some(false),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(!emptied.contains("sandbox_workspace_write"));
}

#[test]
fn apply_codex_sandbox_config_rejects_bad_input() {
    // Relative writable_roots are NOT rejected by codex — they resolve
    // against CODEX_HOME ("rel/dir" → ~/.codex/rel/dir), silently granting
    // write access somewhere the user never meant. So codeg rejects them.
    assert!(apply_codex_sandbox_config(
        "",
        &CodexSandboxStructuredConfig {
            writable_roots: Some(vec!["rel/dir".into()]),
            ..Default::default()
        }
    )
    .is_err());
    assert!(apply_codex_sandbox_config(
        "",
        &CodexSandboxStructuredConfig {
            sandbox_mode: set("wide-open".into()),
            ..Default::default()
        }
    )
    .is_err());
    assert!(
        apply_codex_sandbox_config(
            "",
            &CodexSandboxStructuredConfig {
                approval_policy: set("never".into()),
                granular: set(CodexGranularApproval::default()),
                ..Default::default()
            }
        )
        .is_err(),
        "a string and a granular table cannot coexist"
    );
    assert!(
        apply_codex_sandbox_config("== not toml ==", &CodexSandboxStructuredConfig::default())
            .is_err(),
        "a malformed base must error, never silently overwrite the user's config"
    );
}

#[test]
fn apply_codex_sandbox_config_accepts_windows_absolute_roots() {
    let merged = apply_codex_sandbox_config(
        "",
        &CodexSandboxStructuredConfig {
            writable_roots: Some(vec!["C:\\work\\repo".into(), "\\\\srv\\share".into()]),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        parse_codex_sandbox_settings(&merged)
            .workspace_write
            .writable_roots
            .len(),
        2
    );
}

#[test]
fn codex_projection_folds_sandbox_keys_for_the_fingerprint() {
    // These keys only take effect at `thread/start`, so a running session
    // must be marked restart-required when they change; the projection is
    // what `fingerprint_config` hashes.
    let plain = codex_config_projection_from_toml("model = \"gpt-5\"\n");
    assert!(!plain.contains_key("sandboxMode"));
    assert!(!plain.contains_key("sandboxWorkspaceWrite"));
    let with_sandbox = codex_config_projection_from_toml(
        "model = \"gpt-5\"\napproval_policy = \"never\"\n\
             sandbox_mode = \"workspace-write\"\n\n\
             [sandbox_workspace_write]\nnetwork_access = true\n",
    );
    assert_eq!(
        with_sandbox.get("approvalPolicy").and_then(|v| v.as_str()),
        Some("never")
    );
    assert_eq!(
        with_sandbox.get("sandboxMode").and_then(|v| v.as_str()),
        Some("workspace-write")
    );
    assert!(with_sandbox.contains_key("sandboxWorkspaceWrite"));
    assert_ne!(plain, with_sandbox, "the fingerprint input must change");
}

#[test]
fn codex_projection_folds_default_mode_request_user_input() {
    // Feature flags resolve at thread creation, so turning questions on in
    // Default mode must mark running sessions restart-required.
    let base = "model = \"gpt-5\"\n";
    let plain = codex_config_projection_from_toml(base);
    assert!(!plain.contains_key("defaultModeRequestUserInput"));

    let on = codex_config_projection_from_toml(
        "model = \"gpt-5\"\n\n[features]\ndefault_mode_request_user_input = true\n",
    );
    assert_eq!(
        on.get("defaultModeRequestUserInput")
            .and_then(serde_json::Value::as_bool),
        Some(true)
    );
    assert_ne!(plain, on, "the fingerprint input must change");

    // Explicit `false` IS codex's default, so it must hash identically to
    // an untouched config — otherwise flipping the switch on and back off
    // would leave every running session falsely marked restart-required.
    let off = codex_config_projection_from_toml(
        "model = \"gpt-5\"\n\n[features]\ndefault_mode_request_user_input = false\n",
    );
    assert_eq!(plain, off);

    // Other `[features]` keys are not projected, and must not be mistaken
    // for this one.
    let other =
        codex_config_projection_from_toml("model = \"gpt-5\"\n\n[features]\nskills = true\n");
    assert_eq!(plain, other);
}

#[test]
fn parse_grok_settings_reads_custom_model_and_session() {
    let toml = "[model.foo]\nmodel = \"foo\"\nbase_url = \"https://api/v1\"\n\
                    api_key = \"sk-1\"\napi_backend = \"responses\"\ncontext_window = 262144\n\n\
                    [models]\ndefault = \"foo\"\n\n\
                    [session]\nauto_compact_threshold_percent = 90\n";
    let s = parse_grok_settings(toml);
    assert_eq!(s.custom_model_id.as_deref(), Some("foo"));
    assert_eq!(s.custom_base_url.as_deref(), Some("https://api/v1"));
    assert_eq!(s.custom_api_key.as_deref(), Some("sk-1"));
    assert_eq!(s.custom_api_backend.as_deref(), Some("responses"));
    assert_eq!(s.custom_context_window, Some(262144));
    assert_eq!(s.auto_compact_threshold_percent, Some(90));
}

#[test]
fn parse_grok_settings_untracks_default_without_model_block() {
    // `[models].default` naming a stock model (no `[model.*]` block) is not a
    // codeg-managed custom model — the panel must show the custom fields empty.
    let toml = "[model.foo]\nbase_url = \"x\"\n\n[models]\ndefault = \"grok-4.5\"\n";
    let s = parse_grok_settings(toml);
    assert!(s.custom_model_id.is_none());
    assert!(s.custom_base_url.is_none());
}

#[test]
fn apply_grok_custom_model_round_trips_through_parse() {
    let merged = apply_grok_structured_config(
        "",
        &GrokStructuredConfig {
            custom_model_id: Some("my-grok".into()),
            custom_base_url: Some("https://gw/v1".into()),
            custom_api_key: Some("sk-x".into()),
            custom_api_backend: Some("responses".into()),
            custom_context_window: Some(131072),
            auto_compact_threshold_percent: Some(80),
            ..Default::default()
        },
    )
    .unwrap();
    // The model becomes the default, and the block carries `model = <id>`.
    assert!(merged.contains("[model.my-grok]") || merged.contains("[model.\"my-grok\"]"));
    assert!(merged.contains("model = \"my-grok\""));
    let back = parse_grok_settings(&merged);
    assert_eq!(back.custom_model_id.as_deref(), Some("my-grok"));
    assert_eq!(back.custom_base_url.as_deref(), Some("https://gw/v1"));
    assert_eq!(back.custom_api_key.as_deref(), Some("sk-x"));
    assert_eq!(back.custom_api_backend.as_deref(), Some("responses"));
    assert_eq!(back.custom_context_window, Some(131072));
    assert_eq!(back.auto_compact_threshold_percent, Some(80));
}

#[test]
fn apply_grok_custom_model_empty_base_url_omits_key() {
    // "Leave empty ⇒ official endpoint": no `base_url` key is written.
    let merged = apply_grok_structured_config(
        "",
        &GrokStructuredConfig {
            custom_model_id: Some("foo".into()),
            custom_base_url: Some("   ".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(
        !merged.contains("base_url"),
        "empty base_url must omit the key"
    );
    let back = parse_grok_settings(&merged);
    assert_eq!(back.custom_model_id.as_deref(), Some("foo"));
    assert!(back.custom_base_url.is_none());
}

#[test]
fn apply_grok_custom_model_non_positive_context_window_omitted() {
    let merged = apply_grok_structured_config(
        "",
        &GrokStructuredConfig {
            custom_model_id: Some("foo".into()),
            custom_context_window: Some(0),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(!merged.contains("context_window"));
    assert!(parse_grok_settings(&merged).custom_context_window.is_none());
}

#[test]
fn apply_grok_custom_model_rename_moves_block() {
    let base = "[model.old]\nmodel = \"old\"\nbase_url = \"https://old/v1\"\n\n\
                    [models]\ndefault = \"old\"\n";
    let merged = apply_grok_structured_config(
        base,
        &GrokStructuredConfig {
            custom_model_id: Some("new".into()),
            custom_base_url: Some("https://new/v1".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(
        !merged.contains("old"),
        "the stale block + default must be gone"
    );
    let back = parse_grok_settings(&merged);
    assert_eq!(back.custom_model_id.as_deref(), Some("new"));
    assert_eq!(back.custom_base_url.as_deref(), Some("https://new/v1"));
}

#[test]
fn apply_grok_custom_model_update_preserves_unmanaged_block_keys() {
    // Editing a managed block keeps keys codeg doesn't own (e.g. temperature).
    let base = "[model.foo]\nmodel = \"foo\"\ntemperature = 0.7\nbase_url = \"https://old/v1\"\n\n\
                    [models]\ndefault = \"foo\"\n";
    let merged = apply_grok_structured_config(
        base,
        &GrokStructuredConfig {
            custom_model_id: Some("foo".into()),
            custom_base_url: Some("https://new/v1".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(merged.contains("temperature"), "unmanaged key preserved");
    let back = parse_grok_settings(&merged);
    assert_eq!(back.custom_base_url.as_deref(), Some("https://new/v1"));
}

#[test]
fn apply_grok_custom_model_clear_removes_managed_block_and_default() {
    let base = "[model.foo]\nmodel = \"foo\"\nbase_url = \"https://x/v1\"\n\n\
                    [models]\ndefault = \"foo\"\n";
    let merged = apply_grok_structured_config(base, &GrokStructuredConfig::default()).unwrap();
    assert!(!merged.contains("[model."), "managed block removed");
    let back = parse_grok_settings(&merged);
    assert!(back.custom_model_id.is_none());
}

#[test]
fn apply_grok_custom_model_clear_leaves_handset_stock_default() {
    // Clearing the (empty) custom form must NOT delete a hand-set stock
    // `[models].default` that was never codeg-managed.
    let base = "[models]\ndefault = \"grok-4.5\"\n";
    let merged = apply_grok_structured_config(base, &GrokStructuredConfig::default()).unwrap();
    assert!(merged.contains("default = \"grok-4.5\""));
}

#[test]
fn apply_grok_session_compaction_clamps_and_removes() {
    // Out-of-range value clamps into 0–100.
    let over = apply_grok_structured_config(
        "",
        &GrokStructuredConfig {
            auto_compact_threshold_percent: Some(150),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        parse_grok_settings(&over).auto_compact_threshold_percent,
        Some(100)
    );
    // `None` removes an existing key.
    let base = "[session]\nauto_compact_threshold_percent = 70\n";
    let cleared = apply_grok_structured_config(base, &GrokStructuredConfig::default()).unwrap();
    assert!(parse_grok_settings(&cleared)
        .auto_compact_threshold_percent
        .is_none());
}

#[test]
fn grok_config_permission_mode_maps_to_launch_flag() {
    // Legacy always-approve → real bypassPermissions, passed as the flag.
    assert_eq!(
        grok_config_permission_mode("[ui]\npermission_mode = \"always-approve\"\n").as_deref(),
        Some("bypassPermissions")
    );
    // A real granular mode passes through.
    assert_eq!(
        grok_config_permission_mode("[ui]\npermission_mode = \"acceptEdits\"\n").as_deref(),
        Some("acceptEdits")
    );
    // `default` (grok's own default) and legacy `ask` keep the flag off so
    // ACP permission requests reach codeg's UI.
    assert!(grok_config_permission_mode("[ui]\npermission_mode = \"default\"\n").is_none());
    assert!(grok_config_permission_mode("[ui]\npermission_mode = \"ask\"\n").is_none());
    // Unset / malformed / unknown ⇒ no flag (preserve the ability to prompt).
    assert!(grok_config_permission_mode("").is_none());
    assert!(grok_config_permission_mode("== not toml ==").is_none());
    assert!(grok_config_permission_mode("[ui]\npermission_mode = \"bogus\"\n").is_none());
}

fn touch(path: &Path) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, "x").unwrap();
}

fn canonical_key(dir: &Path) -> String {
    pi_canonical_path(dir).to_string_lossy().to_string()
}

/// A `runtime_env` whose `PI_CODING_AGENT_DIR` points at `agent_dir`, so the
/// launch gate reads a tempdir's `trust.json` instead of `~/.pi/agent`.
fn pi_env_for(agent_dir: &Path) -> BTreeMap<String, String> {
    BTreeMap::from([(
        "PI_CODING_AGENT_DIR".to_string(),
        agent_dir.to_string_lossy().to_string(),
    )])
}

fn resource_kinds(cwd: &Path) -> Vec<String> {
    pi_project_trust_resources(cwd)
        .into_iter()
        .map(|r| r.kind)
        .collect()
}

/// Every `.pi/*` entry pi gates behind project trust must be reported, so the
/// approval UI can name what it is about to let the repo load.
#[test]
fn pi_trust_resources_detects_every_gated_pi_entry() {
    for entry in PI_TRUST_REQUIRING_CONFIG_RESOURCES {
        let tmp = tempfile::tempdir().expect("tempdir");
        let ws = tmp.path().join("ws");
        let target = ws.join(".pi").join(entry);
        // Directory-shaped entries and file-shaped ones both count.
        if entry.contains('.') {
            touch(&target);
        } else {
            fs::create_dir_all(&target).unwrap();
        }

        assert_eq!(
            resource_kinds(&ws),
            vec![format!(".pi/{entry}")],
            "`.pi/{entry}` must be reported as a trust-gated resource",
        );
    }
}

/// `.pi/extensions` are modules whose top level runs at pi startup, and
/// `.pi/settings.json` can make pi install project packages. The approval UI
/// leans on this flag to say "this executes code" instead of calling it all
/// "config" — the exact confusion that produced the auto-trust bug.
#[test]
fn pi_trust_resources_flag_the_code_executing_kinds() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let ws = tmp.path().join("ws");
    fs::create_dir_all(ws.join(".pi").join("extensions")).unwrap();
    touch(&ws.join(".pi").join("settings.json"));
    fs::create_dir_all(ws.join(".pi").join("prompts")).unwrap();

    let by_kind = pi_project_trust_resources(&ws)
        .into_iter()
        .map(|r| (r.kind, r.executes_code))
        .collect::<BTreeMap<_, _>>();

    assert_eq!(by_kind.get(".pi/extensions"), Some(&true));
    assert_eq!(by_kind.get(".pi/settings.json"), Some(&true));
    assert_eq!(by_kind.get(".pi/prompts"), Some(&false));
}

/// pi 1.x starts a trusted project's `.pi/mcp.json` servers, and a stdio
/// server is a command it runs: a repo shipping only that file is gated.
#[test]
fn pi_trust_gates_a_project_mcp_config_that_runs_commands() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let ws = tmp.path().join("ws");
    touch(&ws.join(".pi").join("mcp.json"));

    let resources = pi_project_trust_resources(&ws);
    assert_eq!(resources.len(), 1);
    assert_eq!(resources[0].kind, ".pi/mcp.json");
    assert!(resources[0].executes_code);

    let agent_dir = tmp.path().join("agent");
    let mut map = serde_json::Map::new();
    map.insert(canonical_key(&ws), serde_json::Value::Bool(true));
    write_json_object_pretty(&agent_dir.join("trust.json"), &map).unwrap();
    assert!(launch_block_for(&agent_dir, &tmp.path().join("codeg-home"), &ws).is_some());
}

/// A bare `.pi/` directory is not a project resource for pi, so codeg must not
/// prompt about it (`hasTrustRequiringProjectResources` ignores it too).
#[test]
fn pi_trust_resources_ignores_a_bare_pi_dir() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let ws = tmp.path().join("ws");
    fs::create_dir_all(ws.join(".pi")).unwrap();

    assert!(pi_project_trust_resources(&ws).is_empty());
}

/// pi walks ancestors for `.agents/skills`, so a parent directory's store is
/// gated for this workspace too.
#[test]
fn pi_trust_resources_walks_ancestors_for_agents_skills() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let parent = tmp.path().join("parent");
    let ws = parent.join("repo");
    fs::create_dir_all(&ws).unwrap();
    fs::create_dir_all(parent.join(".agents").join("skills")).unwrap();

    assert_eq!(resource_kinds(&ws), vec![".agents/skills".to_string()]);
}

/// `~/.agents/skills` is the USER's own store, not a repo's — pi excludes it
/// from the trust decision and so must codeg, or every workspace under $HOME
/// would raise a bogus prompt.
#[test]
fn pi_trust_resources_excludes_the_user_agents_skills_store() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let home = tmp.path().join("home");
    let ws = home.join("repo");
    fs::create_dir_all(&ws).unwrap();
    fs::create_dir_all(home.join(".agents").join("skills")).unwrap();

    // The home is injected rather than pinned through the env: on Windows
    // `dirs::home_dir()` resolves the `FOLDERID_Profile` known folder and
    // ignores `HOME`/`USERPROFILE`, so an env-pinned home would leave the real
    // profile as the exclusion and report the fixture's store.
    //
    // Scope the assertion to the fixture as well — the ancestor walk climbs out
    // of the tempdir into the machine's own directories, and on Windows the
    // tempdir sits under that very profile dir.
    let root = pi_canonical_path(tmp.path());
    let from_fixture = pi_project_trust_resources_with_home(&ws, &home)
        .into_iter()
        .map(|resource| resource.path)
        .filter(|path| Path::new(path).starts_with(&root))
        .collect::<Vec<_>>();

    assert!(
        from_fixture.is_empty(),
        "the user's own ~/.agents/skills must not count as a repo resource, got {from_fixture:?}",
    );
}

/// The decision for the exact folder wins.
#[test]
fn pi_nearest_trust_decision_reads_the_exact_folder() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let ws = tmp.path().join("ws");
    fs::create_dir_all(&ws).unwrap();
    let trust = tmp.path().join("trust.json");
    let mut map = serde_json::Map::new();
    map.insert(canonical_key(&ws), serde_json::Value::Bool(false));
    write_json_object_pretty(&trust, &map).unwrap();

    assert_eq!(
        pi_nearest_trust_decision(&trust, &ws),
        Some((canonical_key(&ws), false)),
    );
}

/// Inheritance is the amplifier that made the old auto-seed so wide: one
/// entry on a parent covers every repo beneath it, including repos cloned
/// later. The UI has to be able to show that, so resolution must report the
/// ancestor that actually decided.
#[test]
fn pi_nearest_trust_decision_inherits_from_an_ancestor() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let parent = tmp.path().join("projects");
    let ws = parent.join("cloned-later");
    fs::create_dir_all(&ws).unwrap();
    let trust = tmp.path().join("trust.json");
    let mut map = serde_json::Map::new();
    map.insert(canonical_key(&parent), serde_json::Value::Bool(true));
    write_json_object_pretty(&trust, &map).unwrap();

    assert_eq!(
        pi_nearest_trust_decision(&trust, &ws),
        Some((canonical_key(&parent), true)),
        "the deciding ancestor must be reported, not the workspace itself",
    );
}

/// pi only honors real booleans; a `null` entry means "no decision here", so
/// the walk continues to the ancestor rather than stopping.
#[test]
fn pi_nearest_trust_decision_skips_null_entries() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let parent = tmp.path().join("projects");
    let ws = parent.join("repo");
    fs::create_dir_all(&ws).unwrap();
    let trust = tmp.path().join("trust.json");
    let mut map = serde_json::Map::new();
    map.insert(canonical_key(&ws), serde_json::Value::Null);
    map.insert(canonical_key(&parent), serde_json::Value::Bool(true));
    write_json_object_pretty(&trust, &map).unwrap();

    assert_eq!(
        pi_nearest_trust_decision(&trust, &ws),
        Some((canonical_key(&parent), true)),
    );
}

/// No file, or no matching entry, means nobody has decided — pi's own
/// non-interactive default then applies and the resources stay unloaded.
#[test]
fn pi_nearest_trust_decision_is_none_without_a_match() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let ws = tmp.path().join("ws");
    fs::create_dir_all(&ws).unwrap();

    assert_eq!(
        pi_nearest_trust_decision(&tmp.path().join("missing.json"), &ws),
        None,
    );
}

/// The launch path no longer writes trust, so the ONLY way a workspace becomes
/// trusted is this explicit call. Both verdicts must be recordable — declining
/// is a real answer, not just "don't write anything".
#[test]
fn pi_set_project_trust_records_either_verdict() {
    for verdict in [true, false] {
        let tmp = tempfile::tempdir().expect("tempdir");
        let ws = tmp.path().join("ws");
        fs::create_dir_all(&ws).unwrap();
        let trust = tmp.path().join("agent").join("trust.json");

        pi_write_trust_decision_at(&trust, &ws, Some(verdict)).unwrap();

        assert_eq!(
            read_json_object_or_empty(&trust).get(&canonical_key(&ws)),
            Some(&serde_json::Value::Bool(verdict)),
        );
    }
}

/// Revoking removes codeg's entry so the folder falls back to any ancestor
/// decision and then to pi's default. Other users' decisions must survive.
#[test]
fn pi_set_project_trust_revoke_removes_only_our_entry() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let ws = tmp.path().join("ws");
    fs::create_dir_all(&ws).unwrap();
    let trust = tmp.path().join("trust.json");
    let mut map = serde_json::Map::new();
    map.insert(canonical_key(&ws), serde_json::Value::Bool(true));
    map.insert("/some/other".to_string(), serde_json::Value::Bool(true));
    map.insert("/denied".to_string(), serde_json::Value::Bool(false));
    write_json_object_pretty(&trust, &map).unwrap();

    pi_write_trust_decision_at(&trust, &ws, None).unwrap();

    let after = read_json_object_or_empty(&trust);
    assert_eq!(after.get(&canonical_key(&ws)), None);
    assert_eq!(
        after.get("/some/other"),
        Some(&serde_json::Value::Bool(true))
    );
    assert_eq!(after.get("/denied"), Some(&serde_json::Value::Bool(false)));
}

/// Revoking a folder we never wrote (the decision is inherited) must not
/// create a trust file just to record an absence.
#[test]
fn pi_set_project_trust_revoke_is_a_noop_when_nothing_is_ours() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let ws = tmp.path().join("ws");
    fs::create_dir_all(&ws).unwrap();
    let trust = tmp.path().join("agent").join("trust.json");

    pi_write_trust_decision_at(&trust, &ws, None).unwrap();

    assert!(!trust.exists());
}

/// Drive the launch gate with an isolated pi agent dir AND an isolated codeg
/// home (the acknowledgement store lives there, via `CODEG_HOME`).
fn launch_block_for(agent_dir: &Path, codeg_home: &Path, cwd: &Path) -> Option<String> {
    temp_env::with_var(
        "CODEG_HOME",
        Some(codeg_home.to_string_lossy().to_string()),
        || pi_project_trust_launch_block(cwd, &pi_env_for(agent_dir)),
    )
}

/// Build a workspace shipping `.pi/extensions`, with `trust.json` saying what
/// `decision` says about the exact folder.
fn gated_workspace(tmp: &Path, decision: Option<bool>) -> (PathBuf, PathBuf, PathBuf) {
    let ws = tmp.join("ws");
    fs::create_dir_all(ws.join(".pi").join("extensions")).unwrap();
    let agent_dir = tmp.join("agent");
    fs::create_dir_all(&agent_dir).unwrap();
    if let Some(verdict) = decision {
        let mut map = serde_json::Map::new();
        map.insert(canonical_key(&ws), serde_json::Value::Bool(verdict));
        write_json_object_pretty(&agent_dir.join("trust.json"), &map).unwrap();
    }
    (ws, agent_dir, tmp.join("codeg-home"))
}

/// THE regression this whole change exists for on an upgraded install: pi
/// executes `.pi/extensions` at startup, so a grant nobody here confirmed —
/// written by the build that auto-trusted every opened folder — must stop the
/// launch. A notice shown after connecting would arrive after the code ran.
#[test]
fn pi_launch_is_blocked_by_an_unacknowledged_grant() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let (ws, agent_dir, home) = gated_workspace(tmp.path(), Some(true));

    let blocked = launch_block_for(&agent_dir, &home, &ws);

    assert!(blocked.is_some(), "an unconfirmed grant must not launch pi");
    assert!(blocked.unwrap().contains(".pi/extensions"));
}

/// The same grant inherited from a parent — the shape that covers a repo
/// cloned into a previously-opened folder long after it was seeded, which is
/// the case a per-folder check alone would miss entirely.
#[test]
fn pi_launch_is_blocked_by_an_unacknowledged_ancestor_grant() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let parent = tmp.path().join("projects");
    let ws = parent.join("cloned-later");
    fs::create_dir_all(ws.join(".pi").join("extensions")).unwrap();
    let agent_dir = tmp.path().join("agent");
    fs::create_dir_all(&agent_dir).unwrap();
    let mut map = serde_json::Map::new();
    map.insert(canonical_key(&parent), serde_json::Value::Bool(true));
    write_json_object_pretty(&agent_dir.join("trust.json"), &map).unwrap();

    let blocked = launch_block_for(&agent_dir, &tmp.path().join("codeg-home"), &ws);

    assert!(blocked.is_some());
    assert!(
        blocked.unwrap().contains("parent folder"),
        "the message must name the inherited grant, not imply this folder was approved",
    );
}

/// Once the user answers for the folder, it launches. Acknowledging records
/// only codeg's confirmation — pi's own grant is untouched.
#[test]
fn pi_launch_proceeds_after_the_grant_is_acknowledged() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let (ws, agent_dir, home) = gated_workspace(tmp.path(), Some(true));
    let trust_before = fs::read_to_string(agent_dir.join("trust.json")).unwrap();

    pi_set_trust_acknowledged_at(&home.join("pi-project-trust-ack.json"), &ws, true).unwrap();

    assert_eq!(launch_block_for(&agent_dir, &home, &ws), None);
    assert_eq!(
        fs::read_to_string(agent_dir.join("trust.json")).unwrap(),
        trust_before,
        "acknowledging must not change pi's own trust store",
    );
}

/// Nothing to confirm: with no decision, or a declined one, pi already skips
/// the resources, so blocking would be pure friction.
#[test]
fn pi_launch_proceeds_when_no_grant_is_in_force() {
    let tmp = tempfile::tempdir().expect("tempdir");
    for decision in [None, Some(false)] {
        let sub = tmp.path().join(format!("case{decision:?}"));
        fs::create_dir_all(&sub).unwrap();
        let (ws, agent_dir, home) = gated_workspace(&sub, decision);
        assert_eq!(
            launch_block_for(&agent_dir, &home, &ws),
            None,
            "decision {decision:?} must not block the launch",
        );
    }
}

/// A repo that ships nothing trust-gated is never blocked, however the folder
/// came to be trusted — there is nothing for the grant to load.
#[test]
fn pi_launch_proceeds_when_the_repo_ships_no_resources() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let ws = tmp.path().join("plain");
    fs::create_dir_all(&ws).unwrap();
    let agent_dir = tmp.path().join("agent");
    fs::create_dir_all(&agent_dir).unwrap();
    let mut map = serde_json::Map::new();
    map.insert(canonical_key(&ws), serde_json::Value::Bool(true));
    write_json_object_pretty(&agent_dir.join("trust.json"), &map).unwrap();

    assert_eq!(
        launch_block_for(&agent_dir, &tmp.path().join("codeg-home"), &ws),
        None,
    );
}

/// Revoking must drop the confirmation too, or re-granting later would ride
/// on a stale "already seen" and skip the disclosure.
#[test]
fn pi_trust_acknowledgement_round_trips_and_clears() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let ws = tmp.path().join("ws");
    fs::create_dir_all(&ws).unwrap();
    let ack = tmp.path().join("ack.json");

    assert!(!pi_trust_is_acknowledged_at(&ack, &canonical_key(&ws)));
    pi_set_trust_acknowledged_at(&ack, &ws, true).unwrap();
    assert!(pi_trust_is_acknowledged_at(&ack, &canonical_key(&ws)));
    pi_set_trust_acknowledged_at(&ack, &ws, false).unwrap();
    assert!(!pi_trust_is_acknowledged_at(&ack, &canonical_key(&ws)));
}

/// The write is a read-modify-write, and two codeg surfaces (the approval
/// banner and the settings list's revoke buttons) can fire at once. Without
/// serialization each writer would persist the map it read, so the last one
/// to land silently drops every entry added since it read — losing a grant
/// the user just made, or resurrecting one they just revoked.
#[test]
fn pi_trust_concurrent_writes_do_not_lose_entries() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let trust = tmp.path().join("agent").join("trust.json");

    let workspaces: Vec<PathBuf> = (0..8)
        .map(|i| {
            let ws = tmp.path().join(format!("ws{i}"));
            fs::create_dir_all(&ws).unwrap();
            ws
        })
        .collect();

    std::thread::scope(|scope| {
        for ws in &workspaces {
            let trust = trust.clone();
            scope.spawn(move || {
                pi_write_trust_decision_at(&trust, ws, Some(true)).expect("write");
            });
        }
    });

    // Every writer's entry survived, and the file is still parseable JSON —
    // interleaved truncating writes would corrupt it.
    let map = read_json_object_or_empty(&trust);
    assert_eq!(map.len(), workspaces.len(), "an entry was lost: {map:?}");
    for ws in &workspaces {
        assert_eq!(
            map.get(&canonical_key(ws)),
            Some(&serde_json::Value::Bool(true)),
        );
    }
}

/// The lock must not outlive the operation, or the next decision — from codeg
/// or from pi, which takes the same lock — would stall until it goes stale.
#[test]
fn pi_trust_write_releases_the_lock() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let ws = tmp.path().join("ws");
    fs::create_dir_all(&ws).unwrap();
    let trust = tmp.path().join("agent").join("trust.json");

    pi_write_trust_decision_at(&trust, &ws, Some(true)).unwrap();

    assert!(
        !tmp.path().join("agent").join("trust.json.lock").exists(),
        "the lock directory must be released when the write finishes",
    );
}

/// pi holds this same lock while it reads or writes its store. When it is
/// held, codeg must back off and report it rather than write anyway — writing
/// through the lock is exactly the interleaving the lock exists to prevent.
#[test]
fn pi_trust_write_defers_to_a_lock_held_by_pi() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let ws = tmp.path().join("ws");
    fs::create_dir_all(&ws).unwrap();
    let agent_dir = tmp.path().join("agent");
    fs::create_dir_all(&agent_dir).unwrap();
    let trust = agent_dir.join("trust.json");
    fs::write(&trust, "{}\n").unwrap();
    // Fresh (non-stale) lock, exactly as `proper-lockfile` leaves it.
    fs::create_dir(agent_dir.join("trust.json.lock")).unwrap();

    let err = pi_write_trust_decision_at(&trust, &ws, Some(true)).unwrap_err();

    assert!(err.to_string().contains("locked by another process"));
    assert_eq!(
        fs::read_to_string(&trust).unwrap(),
        "{}\n",
        "a contended write must leave the store untouched",
    );
}

/// A lock orphaned by a crash must not wedge project trust forever — pi
/// breaks the same tie by age, so codeg has to agree on when to steal it.
#[test]
fn pi_trust_lock_missing_or_unreadable_counts_as_stale() {
    let tmp = tempfile::tempdir().expect("tempdir");
    assert!(pi_trust_lock_is_stale(&tmp.path().join("nonexistent.lock")));
    // A lock created just now is live, so it is honored rather than stolen.
    let fresh = tmp.path().join("fresh.lock");
    fs::create_dir(&fresh).unwrap();
    assert!(!pi_trust_lock_is_stale(&fresh));
}

/// `trust.json` holds decisions the user made inside pi. If codeg can't parse
/// it, it must refuse loudly rather than rewrite the file from scratch.
#[test]
fn pi_set_project_trust_never_clobbers_an_unparseable_file() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let ws = tmp.path().join("ws");
    fs::create_dir_all(&ws).unwrap();
    let trust = tmp.path().join("trust.json");
    fs::write(&trust, "not json at all").unwrap();

    let err = pi_write_trust_decision_at(&trust, &ws, Some(true)).unwrap_err();

    assert!(err.to_string().contains("not a JSON object"));
    assert_eq!(fs::read_to_string(&trust).unwrap(), "not json at all");
}

/// The settings list surfaces decisions for review/revoke — including ones an
/// older codeg auto-seeded. `null` entries carry no decision, so they are not
/// listed.
#[test]
fn pi_trust_entries_lists_decisions_sorted_and_skips_nulls() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let trust = tmp.path().join("trust.json");
    let mut map = serde_json::Map::new();
    map.insert("/b/repo".to_string(), serde_json::Value::Bool(true));
    map.insert("/a/repo".to_string(), serde_json::Value::Bool(false));
    map.insert("/c/repo".to_string(), serde_json::Value::Null);
    write_json_object_pretty(&trust, &map).unwrap();

    let entries = pi_trust_entries_at(&trust);

    assert_eq!(
        entries
            .iter()
            .map(|e| (e.path.as_str(), e.trusted))
            .collect::<Vec<_>>(),
        vec![("/a/repo", false), ("/b/repo", true)],
    );
}

/// End-to-end shape of what the banner reads: a repo that ships an extension,
/// with nobody having decided yet, is exactly the case that must prompt.
#[test]
fn pi_project_trust_state_reports_undecided_repo_resources() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let ws = tmp.path().join("ws");
    fs::create_dir_all(ws.join(".pi").join("extensions")).unwrap();
    let trust = tmp.path().join("trust.json");

    let state = pi_project_trust_state_at(&trust, &tmp.path().join("ack.json"), &ws);

    assert_eq!(state.decision, None, "nobody has decided yet");
    assert_eq!(state.decided_at, None);
    assert!(!state.acknowledged);
    assert_eq!(
        state.resources.iter().map(|r| &r.kind).collect::<Vec<_>>(),
        vec![".pi/extensions"],
    );
    assert!(state.resources[0].executes_code);
    assert_eq!(state.workspace, canonical_key(&ws));
}

// --- pi models.json: the per-model reasoning declaration -----------------
//
// A custom model written without `reasoning` gets `reasoning: false` from pi,
// which collapses its thinking vocabulary to `["off"]` — every level the
// composer sends is clamped straight back and the picker looks broken. These
// pin the shape pi actually reads.

fn pi_reasoning_spec(reasoning: bool, map: &[(&str, Option<&str>)]) -> PiModelReasoningSpec {
    PiModelReasoningSpec {
        reasoning,
        thinking_level_map: map
            .iter()
            .map(|(level, wire)| (level.to_string(), wire.map(str::to_string)))
            .collect(),
    }
}

fn pi_models_of(entry: &serde_json::Map<String, serde_json::Value>) -> Vec<serde_json::Value> {
    entry
        .get("models")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default()
}

#[test]
fn pi_custom_model_adds_a_missing_model_with_its_declaration() {
    let mut entry = serde_json::Map::new();

    apply_pi_custom_model(
        &mut entry,
        "gpt-5.6-sol",
        Some(&pi_reasoning_spec(
            true,
            &[
                ("off", Some("none")),
                ("minimal", None),
                ("xhigh", Some("xhigh")),
                ("max", Some("max")),
            ],
        )),
    );

    let models = pi_models_of(&entry);
    assert_eq!(models.len(), 1);
    assert_eq!(models[0]["id"], "gpt-5.6-sol");
    assert_eq!(models[0]["name"], "gpt-5.6-sol");
    assert_eq!(models[0]["reasoning"], true);
    assert_eq!(models[0]["thinkingLevelMap"]["off"], "none");
    assert!(models[0]["thinkingLevelMap"]["minimal"].is_null());
    assert_eq!(models[0]["thinkingLevelMap"]["xhigh"], "xhigh");
    assert_eq!(models[0]["thinkingLevelMap"]["max"], "max");
}

/// A model that advertises max must retain its map through the Rust write path;
/// unsupported names must still be discarded before pi reads models.json.
#[test]
fn pi_custom_model_persists_max_without_unknown_levels() {
    let mut entry = serde_json::Map::new();
    apply_pi_custom_model(
        &mut entry,
        "reasoning-model",
        Some(&pi_reasoning_spec(
            true,
            &[
                ("minimal", Some("minimal")),
                ("max", Some("max")),
                ("ultra", Some("ultra")),
            ],
        )),
    );

    let models = pi_models_of(&entry);
    let map = models[0]["thinkingLevelMap"].as_object().unwrap();
    assert_eq!(map["minimal"], "minimal");
    assert_eq!(map["max"], "max");
    assert!(!map.contains_key("ultra"));
}

#[test]
fn pi_rpc_projection_keeps_only_capabilities_and_rejects_wrong_responses() {
    let line = r#"{"id":"codeg-models","type":"response","command":"get_available_models","success":true,"data":{"models":[{"provider":"openai","id":"gpt-5.6-sol","reasoning":true,"thinkingLevelMap":{"max":"max"},"baseUrl":"https://secret.example","apiKey":"secret"}]}}"#;
    let models = parse_pi_model_capabilities(line).unwrap().unwrap();
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].thinking_level_map["max"], Some("max".into()));
    let projected = serde_json::to_string(&models).unwrap();
    assert!(!projected.contains("secret"));
    // Someone else's line: keep reading.
    assert!(parse_pi_model_capabilities(&line.replace("codeg-models", "other")).is_none());
    // Our answer, refusing or unreadable: stop, and say it failed.
    assert_eq!(
        parse_pi_model_capabilities(&line.replace(r#""success":true"#, r#""success":false"#)),
        Some(Err(()))
    );
    assert_eq!(
        parse_pi_model_capabilities(&line.replace(r#""models":["#, r#""other":["#)),
        Some(Err(()))
    );
}

#[tokio::test]
async fn pi_db_read_error_does_not_select_native_profile() {
    // No migrations: the Pi settings SELECT fails instead of returning None.
    // A failed lookup must not select the process-global Pi profile, where
    // native settings and API keys would otherwise be written.
    let db = AppDatabase {
        conn: sea_orm::Database::connect("sqlite::memory:").await.unwrap(),
    };
    let lookup_failed = |error: AcpError| {
        let message = error.to_string();
        assert!(
            message.contains("Cannot read Pi agent settings"),
            "failed for another reason: {message}"
        );
    };
    lookup_failed(pi_settings_dir_from_db(&db).await.unwrap_err());
    lookup_failed(load_pi_config_for_db(&db).await.unwrap_err());
    let update = PiConfigUpdate {
        provider: "test-provider".into(),
        model: "test-model".into(),
        thinking_level: None,
        api_key: Some("must-not-reach-native-auth".into()),
        custom_base_url: None,
        custom_api: None,
        model_reasoning: None,
    };
    lookup_failed(
        acp_update_pi_config_core(update, &db, &EventEmitter::Noop)
            .await
            .unwrap_err(),
    );
    lookup_failed(acp_pi_list_trust_entries_core(&db).await.unwrap_err());
    lookup_failed(
        acp_pi_set_project_trust_core(&db, "/tmp/pi-db-error".into(), Some(true))
            .await
            .unwrap_err(),
    );
    lookup_failed(
        acp_pi_project_trust_state_core(&db, "/tmp/pi-db-error".into())
            .await
            .unwrap_err(),
    );
}

#[test]
fn pi_settings_rejects_relative_agent_directory_and_rpc_paths() {
    assert!(pi_settings_dir_checked(PathBuf::from("./agent")).is_err());
    assert!(pi_settings_dir_checked(home_dir_or_default().join("agent")).is_ok());
    let mut env = BTreeMap::new();
    env.insert("PI_ACP_PI_COMMAND".into(), "./pi-test.sh".into());
    assert!(!pi_runtime_paths_are_stable(&env));
    env.insert("PI_ACP_PI_COMMAND".into(), "pi".into());
    env.insert("PI_CODING_AGENT_DIR".into(), "./agent".into());
    assert!(!pi_runtime_paths_are_stable(&env));
    env.insert("PI_CODING_AGENT_DIR".into(), "~/agent".into());
    assert!(pi_runtime_paths_are_stable(&env));
}

#[test]
fn pi_agent_dir_expands_tilde_override_like_the_pi_runtime() {
    // Pin the child's home without depending on process-wide environment
    // changes made by other tests running in parallel.
    let home = tempfile::tempdir().unwrap();
    let mut env = BTreeMap::new();
    env.insert(
        CHILD_HOME_KEY.to_string(),
        home.path().to_string_lossy().into_owned(),
    );
    env.insert("PI_CODING_AGENT_DIR".to_string(), "~/custom-pi".to_string());
    assert_eq!(pi_agent_dir_for_env(&env), home.path().join("custom-pi"));
    // pi's `normalizePath` takes the value verbatim: a padded value is a
    // different (here: relative) directory, not the trimmed one.
    env.insert(
        "PI_CODING_AGENT_DIR".to_string(),
        " ~/custom-pi".to_string(),
    );
    assert_eq!(pi_agent_dir_for_env(&env), PathBuf::from(" ~/custom-pi"));
}

/// `~` is the CHILD's home — a launch that relocates `HOME` relocates pi's
/// profile with it. A key the launch leaves alone is inherited from codeg,
/// while a blank one is removed from the child, so pi falls back to its
/// default instead of inheriting anything.
#[cfg(unix)]
#[test]
fn pi_agent_dir_follows_the_child_env() {
    let home = tempfile::tempdir().unwrap();
    let inherited = || Some(std::ffi::OsString::from("/codeg/own/pi-agent"));
    let mut env = BTreeMap::new();
    env.insert(
        "HOME".to_string(),
        home.path().to_string_lossy().into_owned(),
    );
    assert_eq!(
        pi_agent_dir_for_child(&env, inherited()),
        PathBuf::from("/codeg/own/pi-agent")
    );

    env.insert("PI_CODING_AGENT_DIR".to_string(), "~/isolated".to_string());
    assert_eq!(
        pi_agent_dir_for_child(&env, inherited()),
        home.path().join("isolated")
    );

    env.insert("PI_CODING_AGENT_DIR".to_string(), String::new());
    assert_eq!(
        pi_agent_dir_for_child(&env, inherited()),
        home.path().join(".pi").join("agent")
    );

    // A relative HOME is taken verbatim too, so pi's default profile is
    // relative to its cwd — the workspace — and the gate must look there.
    env.insert("HOME".to_string(), "home-in-repo".to_string());
    assert_eq!(
        pi_agent_dir_for_child(&env, inherited()),
        PathBuf::from("home-in-repo").join(".pi").join("agent")
    );
    let workspace = home.path().join("ws");
    assert_eq!(
        pi_agent_dir_in_workspace(&env, &workspace),
        workspace.join("home-in-repo").join(".pi").join("agent")
    );
    assert!(pi_settings_dir_checked(pi_agent_dir_for_env(&env)).is_err());
}

/// Node keeps whatever home variable the child has — inherited empty
/// included, from which pi derives a `.pi/agent` relative to its cwd — and
/// asks the OS only when the launch removed it or there never was one.
#[test]
fn pi_child_home_is_whatever_home_the_child_has() {
    use std::ffi::OsString;
    let untouched = BTreeMap::new();
    assert_eq!(
        pi_child_home_from(&untouched, Some(OsString::new())),
        PathBuf::new()
    );
    assert_eq!(
        pi_child_home_from(&untouched, Some(OsString::from("inherited-home"))),
        PathBuf::from("inherited-home")
    );
    let account = account_home_dir().unwrap_or_else(home_dir_or_default);
    assert_eq!(pi_child_home_from(&untouched, None), account);
    let removed = BTreeMap::from([(CHILD_HOME_KEY.to_string(), String::new())]);
    assert_eq!(
        pi_child_home_from(&removed, Some(OsString::from("codeg-home"))),
        account
    );
}

/// A relative `PATH` entry lands under the child's cwd; a Windows
/// drive-relative one follows a per-drive directory nothing here can name,
/// so it is dropped rather than guessed.
#[test]
fn path_entries_are_anchored_where_the_child_looks() {
    let cwd = if cfg!(windows) {
        PathBuf::from("C:\\ws")
    } else {
        PathBuf::from("/ws")
    };
    let absolute = if cfg!(windows) {
        PathBuf::from("D:\\tools")
    } else {
        PathBuf::from("/usr/bin")
    };
    assert_eq!(anchor_path_entry(&absolute, &cwd), Some(absolute.clone()));
    assert_eq!(
        anchor_path_entry(Path::new("bin"), &cwd),
        Some(cwd.join("bin"))
    );
    assert_eq!(anchor_path_entry(Path::new(""), &cwd), Some(cwd.join("")));
    #[cfg(windows)]
    {
        assert_eq!(anchor_path_entry(Path::new("C:tools"), &cwd), None);
        assert_eq!(
            anchor_path_entry(Path::new("\\tools"), &cwd),
            Some(PathBuf::from("C:\\tools"))
        );
    }
}

/// Env names are case-insensitive on Windows only: there a lowercase key is
/// the variable pi reads; elsewhere it is a different variable.
#[test]
fn launch_env_names_follow_the_platform_case_rules() {
    let env = BTreeMap::from([("pi_coding_agent_dir".to_string(), "somewhere".to_string())]);
    let found = launch_env_value(&env, "PI_CODING_AGENT_DIR");
    if cfg!(windows) {
        assert_eq!(found, Some("somewhere"));
    } else {
        assert_eq!(found, None);
    }
}

/// A relative agent dir lives inside the workspace pi runs in, so the
/// repository itself can ship the `trust.json` pi reads there. The gate must
/// read that same file; one under codeg's own cwd would miss the grant.
#[test]
fn pi_launch_gate_reads_a_relative_agent_dir_inside_the_workspace() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let ws = tmp.path().join("ws");
    fs::create_dir_all(ws.join(".pi").join("extensions")).unwrap();
    let shipped = ws.join(".pi-agent");
    fs::create_dir_all(&shipped).unwrap();
    let mut grant = serde_json::Map::new();
    grant.insert(canonical_key(&ws), serde_json::Value::Bool(true));
    write_json_object_pretty(&shipped.join("trust.json"), &grant).unwrap();

    let env = BTreeMap::from([("PI_CODING_AGENT_DIR".to_string(), ".pi-agent".to_string())]);
    let blocked = temp_env::with_var(
        "CODEG_HOME",
        Some(tmp.path().join("codeg-home").to_string_lossy().to_string()),
        || pi_project_trust_launch_block(&ws, &env),
    );
    assert!(
        blocked.is_some(),
        "a grant shipped inside the workspace must stop the launch"
    );
}

#[test]
fn pi_config_projection_reads_selected_agent_directory() {
    let default = tempfile::tempdir().unwrap();
    let custom = tempfile::tempdir().unwrap();
    fs::write(
        default.path().join("settings.json"),
        r#"{"defaultModel":"wrong"}"#,
    )
    .unwrap();
    fs::write(
        custom.path().join("settings.json"),
        r#"{"defaultModel":"right","defaultThinkingLevel":"max"}"#,
    )
    .unwrap();
    let loaded = load_pi_config_at(custom.path());
    assert_eq!(loaded.default_model.as_deref(), Some("right"));
    assert_eq!(loaded.default_thinking_level.as_deref(), Some("max"));
}

/// How long a test waits on a fake pi that is expected to answer. The query
/// returns the moment pi replies, so this only bounds a real hang — while a
/// fake that answers in milliseconds can still take seconds to start on a
/// loaded CI runner (Windows `cmd.exe` above all), and a tight bound turns
/// that stall into a spurious `TimedOut`.
const PI_ANSWER_DEADLINE: Duration = Duration::from_secs(30);

#[cfg(unix)]
fn fake_pi(dir: &Path, name: &str, body: &str) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let script = dir.join(name);
    fs::write(&script, format!("#!/bin/sh\n{body}")).unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
    script
}

#[cfg(unix)]
#[tokio::test]
async fn pi_rpc_uses_configured_executable_and_agent_dir_offline() {
    let temp = tempfile::tempdir().unwrap();
    let command_dir = temp.path().join("Pi runtime with spaces");
    fs::create_dir(&command_dir).unwrap();
    let script = fake_pi(
        &command_dir,
        "pi",
        r#"read request
case "$request $*" in
  *codeg-models*--offline*--no-session*--no-extensions*)
    if [ -n "$PI_CODING_AGENT_DIR" ]; then
      printf '%s\n' '{"id":"codeg-models","type":"response","command":"get_available_models","success":true,"data":{"models":[{"provider":"openai","id":"via-override","reasoning":true,"thinkingLevelMap":{"max":"max"}}]}}'
    fi
    ;;
esac
"#,
    );
    let mut env = BTreeMap::new();
    env.insert(
        "PI_ACP_PI_COMMAND".into(),
        script.to_string_lossy().into_owned(),
    );
    env.insert(
        "PI_CODING_AGENT_DIR".into(),
        temp.path().to_string_lossy().into_owned(),
    );
    let catalog = query_pi_model_catalog(&env, PI_ANSWER_DEADLINE).await;
    assert_eq!(catalog.status, PiCatalogStatus::Ok);
    assert_eq!(catalog.models.len(), 1);
    assert_eq!(catalog.models[0].id, "via-override");
}

/// The panel words its hint from the status, so each way of not getting an
/// answer has to be told apart from "pi answered and does not list it".
#[cfg(unix)]
#[tokio::test]
async fn pi_catalog_says_why_pi_gave_no_answer() {
    let temp = tempfile::tempdir().unwrap();
    let status_for = |command: String, deadline: Duration| {
        let env = BTreeMap::from([
            ("PI_ACP_PI_COMMAND".to_string(), command),
            (
                "PI_CODING_AGENT_DIR".to_string(),
                temp.path().to_string_lossy().into_owned(),
            ),
        ]);
        async move { query_pi_model_catalog(&env, deadline).await.status }
    };

    assert_eq!(
        status_for("./pi-test.sh".into(), PI_ANSWER_DEADLINE).await,
        PiCatalogStatus::RelativePath
    );
    assert_eq!(
        status_for(
            "/nonexistent/definitely-not-pi-xyz".into(),
            PI_ANSWER_DEADLINE
        )
        .await,
        PiCatalogStatus::NotFound
    );
    let refusing = fake_pi(
        temp.path(),
        "refusing-pi",
        r#"read request
printf '%s\n' '{"id":"codeg-models","type":"response","command":"get_available_models","success":false,"error":"boom"}'
"#,
    );
    assert_eq!(
        status_for(refusing.to_string_lossy().into_owned(), PI_ANSWER_DEADLINE).await,
        PiCatalogStatus::Failed
    );
    let silent = fake_pi(temp.path(), "silent-pi", "read request\n");
    assert_eq!(
        status_for(silent.to_string_lossy().into_owned(), PI_ANSWER_DEADLINE).await,
        PiCatalogStatus::Failed
    );
    let slow = fake_pi(temp.path(), "slow-pi", "sleep 30\n");
    assert_eq!(
        status_for(
            slow.to_string_lossy().into_owned(),
            Duration::from_millis(500)
        )
        .await,
        PiCatalogStatus::TimedOut
    );
}

/// A relative `PATH` entry must not resolve inside the shared temp dir,
/// where anyone can put a `pi` — the query runs in a private, empty one.
#[cfg(unix)]
#[tokio::test]
async fn pi_catalog_never_runs_a_pi_planted_in_the_shared_temp_dir() {
    let entry = format!("codeg-planted-{}", uuid::Uuid::new_v4());
    let planted_dir = std::env::temp_dir().join(&entry);
    fs::create_dir(&planted_dir).unwrap();
    fake_pi(
        &planted_dir,
        "pi",
        r#"read request
printf '%s\n' '{"id":"codeg-models","type":"response","command":"get_available_models","success":true,"data":{"models":[]}}'
"#,
    );
    let agent_dir = tempfile::tempdir().unwrap();
    let env = BTreeMap::from([
        ("PATH".to_string(), entry),
        (
            "PI_CODING_AGENT_DIR".to_string(),
            agent_dir.path().to_string_lossy().into_owned(),
        ),
    ]);
    let status = query_pi_model_catalog(&env, Duration::from_secs(2))
        .await
        .status;
    fs::remove_dir_all(&planted_dir).unwrap();
    assert_eq!(status, PiCatalogStatus::NotFound);
}

#[cfg(windows)]
#[tokio::test]
async fn pi_rpc_launches_npm_cmd_from_path_with_spaces() {
    let temp = tempfile::tempdir().unwrap();
    let command_dir = temp.path().join("Pi runtime with spaces");
    fs::create_dir(&command_dir).unwrap();
    let script = command_dir.join("pi.cmd");
    fs::write(
            &script,
            r#"@echo off
set /p request=
echo {"id":"codeg-models","type":"response","command":"get_available_models","success":true,"data":{"models":[{"provider":"openai","id":"windows","reasoning":true,"thinkingLevelMap":{"max":"max"}}]}}
"#.replace('\n', "\r\n"),
        ).unwrap();
    let mut env = BTreeMap::new();
    env.insert(
        "PI_ACP_PI_COMMAND".into(),
        script.to_string_lossy().into_owned(),
    );
    let catalog = query_pi_model_catalog(&env, PI_ANSWER_DEADLINE).await;
    assert_eq!(catalog.status, PiCatalogStatus::Ok);
    assert_eq!(catalog.models.len(), 1);
    assert_eq!(catalog.models[0].id, "windows");
}

/// The older writer skipped an already-listed model entirely, so a declaration
/// could never reach one. Upserting must still leave every field the form has
/// no opinion about — including a renamed `name` — exactly as the user left it.
#[test]
fn pi_custom_model_upserts_without_clobbering_hand_tuned_fields() {
    let mut entry = serde_json::Map::new();
    entry.insert(
        "models".to_string(),
        serde_json::json!([
            { "id": "other", "name": "Other" },
            {
                "id": "gpt-5.6-sol",
                "name": "My renamed model",
                "contextWindow": 400000,
                "cost": { "input": 5, "output": 30, "cacheRead": 0.5, "cacheWrite": 0 },
                "compat": { "some": "knob" },
            },
        ]),
    );

    apply_pi_custom_model(
        &mut entry,
        "gpt-5.6-sol",
        Some(&pi_reasoning_spec(true, &[("off", Some("none"))])),
    );

    let models = pi_models_of(&entry);
    assert_eq!(models.len(), 2, "no duplicate entry for the same id");
    let target = models
        .iter()
        .find(|m| m["id"] == "gpt-5.6-sol")
        .expect("model kept");
    assert_eq!(target["name"], "My renamed model");
    assert_eq!(target["contextWindow"], 400000);
    assert_eq!(target["cost"]["input"], 5);
    assert_eq!(target["compat"]["some"], "knob");
    assert_eq!(target["reasoning"], true);
    assert_eq!(models[0]["id"], "other", "untouched sibling stays put");
}

/// Turning the switch off only flips the flag: the level selection stays on
/// disk so re-enabling restores it instead of making the user re-pick.
#[test]
fn pi_custom_model_disabling_reasoning_keeps_the_level_map() {
    let mut entry = serde_json::Map::new();
    apply_pi_custom_model(
        &mut entry,
        "m",
        Some(&pi_reasoning_spec(true, &[("minimal", None)])),
    );

    apply_pi_custom_model(
        &mut entry,
        "m",
        Some(&pi_reasoning_spec(false, &[("minimal", None)])),
    );

    let models = pi_models_of(&entry);
    assert_eq!(models[0]["reasoning"], false);
    assert!(models[0]["thinkingLevelMap"]["minimal"].is_null());
}

/// `{}` would read as a declaration that constrains nothing; drop the key so
/// pi falls back to its own defaults.
#[test]
fn pi_custom_model_drops_an_empty_level_map() {
    let mut entry = serde_json::Map::new();
    apply_pi_custom_model(
        &mut entry,
        "m",
        Some(&pi_reasoning_spec(true, &[("low", Some("LOW"))])),
    );

    apply_pi_custom_model(&mut entry, "m", Some(&pi_reasoning_spec(true, &[])));

    let models = pi_models_of(&entry);
    assert!(models[0].get("thinkingLevelMap").is_none());
}

/// A level name outside pi's fixed vocabulary must never reach disk.
#[test]
fn pi_custom_model_filters_levels_pi_does_not_know() {
    let mut entry = serde_json::Map::new();

    apply_pi_custom_model(
        &mut entry,
        "m",
        Some(&pi_reasoning_spec(
            true,
            &[("ultra", Some("ultra")), ("high", Some("high"))],
        )),
    );

    let models = pi_models_of(&entry);
    let map = models[0]["thinkingLevelMap"].as_object().unwrap();
    assert!(!map.contains_key("ultra"));
    assert_eq!(map["high"], "high");
}

/// Built-in providers (and any client that predates the control) send no spec.
/// That must not erase a declaration already on disk.
#[test]
fn pi_custom_model_without_a_spec_leaves_the_declaration_alone() {
    let mut entry = serde_json::Map::new();
    entry.insert(
        "models".to_string(),
        serde_json::json!([
            { "id": "m", "name": "m", "reasoning": true,
              "thinkingLevelMap": { "off": "none" } },
        ]),
    );

    apply_pi_custom_model(&mut entry, "m", None);

    let models = pi_models_of(&entry);
    assert_eq!(models[0]["reasoning"], true);
    assert_eq!(models[0]["thinkingLevelMap"]["off"], "none");
}

/// What the writer emits has to survive the read the panel rehydrates from,
/// or reopening the settings would show the wrong chips.
#[test]
fn pi_custom_models_projection_reads_back_what_was_written() {
    let mut entry = serde_json::Map::new();
    apply_pi_custom_model(
        &mut entry,
        "gpt-5.6-sol",
        Some(&pi_reasoning_spec(
            true,
            &[
                ("off", Some("none")),
                ("minimal", None),
                ("low", Some("LOW")),
            ],
        )),
    );

    let models = pi_custom_models_from_entry(&serde_json::Value::Object(entry));

    assert_eq!(models.len(), 1);
    assert_eq!(models[0].id, "gpt-5.6-sol");
    assert_eq!(models[0].reasoning, Some(true));
    assert_eq!(
        models[0].thinking_level_map["off"],
        Some("none".to_string())
    );
    assert_eq!(models[0].thinking_level_map["minimal"], None);
    assert_eq!(models[0].thinking_level_map["low"], Some("LOW".to_string()));
}

/// A model with no `reasoning` key must project as `None`, not `Some(false)` —
/// the panel distinguishes "never declared" from "declared off".
#[test]
fn pi_custom_models_projection_keeps_an_undeclared_model_undeclared() {
    let entry = serde_json::json!({
        "models": [
            { "id": "b", "name": "b" },
            { "id": "a", "name": "a", "thinkingLevelMap": { "low": 7 } },
            { "name": "no id at all" },
        ]
    });

    let models = pi_custom_models_from_entry(&entry);

    assert_eq!(
        models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
        vec!["a", "b"],
        "sorted by id, entries without one skipped"
    );
    assert_eq!(models[0].reasoning, None);
    assert!(
        models[0].thinking_level_map.is_empty(),
        "a non-string, non-null wire value is dropped rather than guessed at"
    );
}

/// End to end through the files pi actually reads: the panel's rehydrate path
/// must find the declaration under the provider it was saved to.
#[test]
fn load_pi_config_projects_custom_provider_models() {
    let tmp = tempfile::tempdir().expect("tempdir");
    temp_env::with_var("PI_CODING_AGENT_DIR", Some(tmp.path()), || {
        fs::write(
                tmp.path().join("settings.json"),
                r#"{"defaultProvider":"gs","defaultModel":"gpt-5.6-sol","defaultThinkingLevel":"high"}"#,
            )
            .unwrap();
        fs::write(
            tmp.path().join("models.json"),
            r#"{"providers":{"gs":{"api":"openai-responses","baseUrl":"https://example.test/v1",
                   "models":[{"id":"gpt-5.6-sol","name":"gpt-5.6-sol","reasoning":true,
                   "thinkingLevelMap":{"off":"none","minimal":null,"xhigh":"xhigh"}}]}}}"#,
        )
        .unwrap();

        let cfg = load_pi_config_core();

        assert_eq!(cfg.default_provider.as_deref(), Some("gs"));
        assert_eq!(cfg.default_thinking_level.as_deref(), Some("high"));
        let provider = &cfg.custom_providers[0];
        assert_eq!(provider.id, "gs");
        assert_eq!(provider.api, "openai-responses");
        assert_eq!(provider.models[0].id, "gpt-5.6-sol");
        assert_eq!(provider.models[0].reasoning, Some(true));
        assert_eq!(
            provider.models[0].thinking_level_map["xhigh"],
            Some("xhigh".to_string())
        );
    });
}

#[test]
fn opencode_auth_empty_payload_truncates_to_empty_object() {
    // Clearing the last credential sends "" — it must persist `{}` (clearing
    // the file), not be skipped (which would strand a stale key on disk).
    assert_eq!(
        opencode_auth_payload_to_write(Some("")),
        Some("{}".to_string())
    );
    assert_eq!(
        opencode_auth_payload_to_write(Some("   \n")),
        Some("{}".to_string())
    );
}

#[test]
fn opencode_auth_payload_preserves_non_empty_and_skips_none() {
    let json = r#"{"openai":{"type":"api","key":"k"}}"#;
    assert_eq!(
        opencode_auth_payload_to_write(Some(json)),
        Some(json.to_string())
    );
    // No payload supplied → leave auth.json untouched.
    assert_eq!(opencode_auth_payload_to_write(None), None);
}

// Call-site guard: both acp_update_agent_config_core and
// acp_update_agent_preferences_core route OpenCode persistence through
// persist_opencode_native_config, so testing it covers both exposed paths.
#[test]
fn persist_opencode_native_config_empty_auth_clears_file() {
    let tmp = tempfile::tempdir().expect("tempdir");
    // Pin HOME and clear XDG_DATA_HOME so the auth path resolves under the
    // temp dir regardless of the developer's environment.
    temp_env::with_vars(
        [
            ("HOME", Some(tmp.path())),
            ("XDG_DATA_HOME", None::<&std::path::Path>),
        ],
        || {
            let auth_path = opencode_auth_json_path();
            fs::create_dir_all(auth_path.parent().unwrap()).expect("mkdir");
            fs::write(&auth_path, r#"{"openai":{"type":"api","key":"k"}}"#).expect("seed");

            // Disconnecting the last provider sends an empty auth payload: it
            // must truncate auth.json to {}, not strand the stale credential.
            persist_opencode_native_config(Some(""), None).expect("persist");

            assert_eq!(fs::read_to_string(&auth_path).unwrap().trim(), "{}");
        },
    );
}

#[test]
fn persist_opencode_native_config_none_auth_leaves_file() {
    let tmp = tempfile::tempdir().expect("tempdir");
    temp_env::with_vars(
        [
            ("HOME", Some(tmp.path())),
            ("XDG_DATA_HOME", None::<&std::path::Path>),
        ],
        || {
            let auth_path = opencode_auth_json_path();
            fs::create_dir_all(auth_path.parent().unwrap()).expect("mkdir");
            let original = "{\"openai\":{\"type\":\"api\",\"key\":\"k\"}}\n";
            fs::write(&auth_path, original).expect("seed");

            // No auth payload supplied → file untouched.
            persist_opencode_native_config(None, None).expect("persist");

            assert_eq!(fs::read_to_string(&auth_path).unwrap(), original);
        },
    );
}

#[test]
fn opencode_config_path_falls_back_when_xdg_config_home_empty() {
    // An empty XDG_CONFIG_HOME must fall back to <home>/.config, not resolve
    // to a relative "opencode/opencode.json". `dirs::home_dir()` ignores the
    // HOME env var on Windows, so derive the expected base from the same
    // resolution production uses instead of pinning HOME.
    temp_env::with_var("XDG_CONFIG_HOME", Some(""), || {
        assert_eq!(
            opencode_primary_config_path(),
            home_dir_or_default()
                .join(".config")
                .join("opencode")
                .join("opencode.json")
        );
    });
}

#[test]
fn opencode_paths_follow_xdg_when_set() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let cfg = tmp.path().join("xdg-config");
    let data = tmp.path().join("xdg-data");
    temp_env::with_vars(
        [
            ("HOME", Some(tmp.path())),
            ("XDG_CONFIG_HOME", Some(cfg.as_path())),
            ("XDG_DATA_HOME", Some(data.as_path())),
        ],
        || {
            assert_eq!(
                opencode_primary_config_path(),
                cfg.join("opencode").join("opencode.json")
            );
            assert_eq!(
                opencode_auth_json_path(),
                data.join("opencode").join("auth.json")
            );
        },
    );
}

#[test]
fn codex_config_projection_tracks_model_provider_for_fingerprint() {
    // Two configs sharing one base_url but naming different providers must
    // produce different projections, so `fingerprint_config` (which hashes
    // this projection) flags a provider switch even though the resolved
    // endpoint is unchanged. codex-acp 1.0.1 reads `model_provider` from
    // config.toml directly, so it is no longer pinned into the launch env
    // where the fingerprint previously caught it incidentally.
    let codeg = r#"
model = "gpt-5-codex"
model_provider = "codeg"

[model_providers.codeg]
base_url = "https://gateway.example/v1"
wire_api = "responses"

[model_providers.other]
base_url = "https://gateway.example/v1"
wire_api = "chat"
"#;
    let other = codeg.replace("model_provider = \"codeg\"", "model_provider = \"other\"");

    let p_codeg = codex_config_projection_from_toml(codeg);
    let p_other = codex_config_projection_from_toml(&other);

    assert_eq!(
        p_codeg.get("modelProvider").and_then(|v| v.as_str()),
        Some("codeg")
    );
    assert_eq!(
        p_other.get("modelProvider").and_then(|v| v.as_str()),
        Some("other")
    );
    // Same endpoint resolved for both providers...
    assert_eq!(p_codeg.get("apiBaseUrl"), p_other.get("apiBaseUrl"));
    // ...yet the projections differ, so the launch-config fingerprint does too.
    assert_ne!(p_codeg, p_other);

    // Deterministic for identical input.
    assert_eq!(codex_config_projection_from_toml(codeg), p_codeg);

    // `modelProvider` must NOT be an AgentRuntimeConfig key, or
    // build_runtime_env_from_setting would mirror it back into a runtime env
    // var (reintroducing the very MODEL_PROVIDER pin we removed).
    assert!(
        serde_json::from_value::<AgentRuntimeConfig>(serde_json::Value::Object(p_codeg.clone()))
            .is_ok()
    );

    // No model_provider declared (official OpenAI / ChatGPT) → no
    // modelProvider key, matching the pre-1.0.1 "leave MODEL_PROVIDER unset"
    // behavior; the bare `model` still projects.
    let bare = codex_config_projection_from_toml("model = \"gpt-5-codex\"\n");
    assert!(!bare.contains_key("modelProvider"));
    assert_eq!(
        bare.get("model").and_then(|v| v.as_str()),
        Some("gpt-5-codex")
    );

    // Malformed TOML must not panic — yields an empty projection.
    assert!(codex_config_projection_from_toml("model_provider = ").is_empty());
}

fn unique_test_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("codeg-acp-{name}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("create test directory");
    dir
}

#[test]
fn kimi_code_skill_storage_spec_targets_kimi_home() {
    // `resolve_kimi_code_home_dir()` reads the process-wide `$HOME` (when
    // `KIMI_CODE_HOME` is unset), and other tests mutate HOME via `temp_env`.
    // Pin it (and clear `KIMI_CODE_HOME`) so the spec and the expected path
    // resolve against one consistent home instead of racing a concurrent
    // HOME-mutating test. Deriving `expected` from the same production helper
    // keeps it correct on Windows, where `dirs::home_dir()` ignores HOME.
    let tmp = tempfile::tempdir().expect("tempdir");
    temp_env::with_vars(
        [
            ("HOME", Some(tmp.path())),
            ("KIMI_CODE_HOME", None::<&std::path::Path>),
        ],
        || {
            let spec = skill_storage_spec(AgentType::KimiCode).expect("Kimi Code supports skills");
            assert_eq!(spec.kind, SkillStorageKind::SkillDirectoryOnly);
            assert_eq!(spec.project_rel_dirs, vec![".kimi-code/skills"]);
            let expected = crate::parsers::kimi_code::resolve_kimi_code_home_dir().join("skills");
            assert_eq!(spec.global_dirs, vec![expected]);
        },
    );
}

#[test]
fn pi_skill_storage_spec_targets_pi_agent_dir() {
    // `pi_agent_dir()` and `home_dir_or_default()` both read the process-wide
    // `$HOME`, and other tests mutate HOME via `temp_env`. Pin it (and clear
    // the BYO `PI_CODING_AGENT_DIR` override) so this test serializes against
    // those mutators through temp_env's shared lock and reads one consistent
    // home for both the spec and the expected paths. Deriving `expected` from
    // the same production helpers keeps it correct on Windows, where
    // `dirs::home_dir()` ignores the pinned HOME.
    let tmp = tempfile::tempdir().expect("tempdir");
    temp_env::with_vars(
        [
            ("HOME", Some(tmp.path())),
            ("PI_CODING_AGENT_DIR", None::<&std::path::Path>),
        ],
        || {
            let spec = skill_storage_spec(AgentType::Pi).expect("Pi supports skills");
            // pi's native dir accepts standalone `.md` files, like Codex.
            assert_eq!(spec.kind, SkillStorageKind::SkillDirectoryOrMarkdownFile);
            assert_eq!(spec.project_rel_dirs, vec![".pi/skills", ".agents/skills"]);
            // Native pi dir first (preferred link target), shared store second.
            let expected = vec![
                pi_agent_dir().join("skills"),
                home_dir_or_default().join(".agents").join("skills"),
            ];
            assert_eq!(spec.global_dirs, expected);
        },
    );
}

#[test]
fn deepseek_skill_storage_spec_mirrors_dsh_skill_roots() {
    // Both resolvers read the process-wide `$HOME` when their env override
    // is unset, and other tests mutate HOME via `temp_env`. Pin it (and
    // clear both overrides) so the spec and the expected paths resolve
    // against one consistent home. `expected` comes from the same
    // production helpers so this stays correct on Windows, where
    // `dirs::home_dir()` ignores the pinned HOME.
    let tmp = tempfile::tempdir().expect("tempdir");
    temp_env::with_vars(
        [
            ("HOME", Some(tmp.path())),
            ("DSH_HOME", None::<&std::path::Path>),
            ("DSH_AGENTS_HOME", None::<&std::path::Path>),
        ],
        || {
            let spec = skill_storage_spec(AgentType::DeepSeek).expect("DeepSeek supports skills");
            // `dsh-skill-filesystem` discovers directory bundles AND flat
            // `.md` files, like Codex and pi.
            assert_eq!(spec.kind, SkillStorageKind::SkillDirectoryOrMarkdownFile);
            assert_eq!(spec.project_rel_dirs, vec![".dsh/skills", ".agents/skills"]);
            // Harness-native dir first (preferred link target), shared
            // cross-agent store second.
            let expected = vec![
                crate::parsers::deepseek::resolve_dsh_home_dir().join("skills"),
                crate::parsers::deepseek::resolve_dsh_agents_home_dir().join("skills"),
            ];
            assert_eq!(spec.global_dirs, expected);
            // The product CLI owns `$DSH_HOME/skills/.system` (the provider
            // sets `skipSystem` on that root), so codeg never writes there.
            assert!(is_read_only_skill_path(
                AgentType::DeepSeek,
                &expected[0].join(".system").join("imagegen")
            ));
            assert!(!is_read_only_skill_path(
                AgentType::DeepSeek,
                &expected[0].join("my-skill")
            ));
        },
    );
}

#[test]
fn deepseek_project_skills_hang_off_the_git_root() {
    // `dsh-skill-filesystem` resolves project roots by walking up to the
    // nearest `.git`, so opening a package subdirectory must still target
    // the repo root — otherwise codeg writes a skill the agent never scans.
    let tmp = tempfile::tempdir().expect("tempdir");
    let repo = tmp.path().join("repo");
    let nested = repo.join("packages").join("app");
    std::fs::create_dir_all(&nested).expect("create nested");
    // A linked worktree records `.git` as a FILE, which upstream's
    // `pathExists` accepts — so must this.
    std::fs::write(repo.join(".git"), "gitdir: /elsewhere\n").expect("write .git file");

    let dirs = scoped_skill_dirs(
        AgentType::DeepSeek,
        AgentSkillScope::Project,
        Some(nested.to_str().expect("utf-8 path")),
    )
    .expect("project dirs");
    assert_eq!(
        dirs,
        vec![repo.join(".dsh/skills"), repo.join(".agents/skills")]
    );

    // No `.git` anywhere above ⇒ fall back to the workspace itself.
    let bare = tmp.path().join("bare");
    std::fs::create_dir_all(&bare).expect("create bare");
    let fallback = scoped_skill_dirs(
        AgentType::DeepSeek,
        AgentSkillScope::Project,
        Some(bare.to_str().expect("utf-8 path")),
    )
    .expect("fallback dirs");
    assert_eq!(fallback[0], bare.join(".dsh/skills"));

    // Every other agent keeps the plain workspace-relative layout.
    let codex = scoped_skill_dirs(
        AgentType::Codex,
        AgentSkillScope::Project,
        Some(nested.to_str().expect("utf-8 path")),
    )
    .expect("codex dirs");
    assert_eq!(codex[0], nested.join(".codex/skills"));

    // ...and the LIST path must resolve the same base as the WRITE path:
    // a skill saved from the nested workspace lands at the repo root, so
    // listing the workspace directly would show it as missing.
    let saved = repo.join(".dsh/skills").join("demo");
    std::fs::create_dir_all(&saved).expect("create skill dir");
    std::fs::write(saved.join("SKILL.md"), "---\nname: demo\n---\nbody\n").expect("write SKILL.md");
    let listed = tokio::runtime::Runtime::new()
        .expect("runtime")
        .block_on(acp_list_agent_skills(
            AgentType::DeepSeek,
            Some(nested.to_string_lossy().to_string()),
        ))
        .expect("list skills");
    assert!(
        listed.skills.iter().any(|s| s.id == "demo"),
        "skill saved at the git root must be listed from a nested workspace: {:?}",
        listed.skills
    );
    assert!(
        listed
            .locations
            .iter()
            .any(|l| l.path == repo.join(".dsh/skills").to_string_lossy()),
        "the listed project location must be the git root: {:?}",
        listed.locations
    );
}

#[test]
fn parse_provider_model_emits_claude_custom_model_option_trio() {
    // A Claude provider that defines the custom model option must surface all
    // three ANTHROPIC_CUSTOM_MODEL_OPTION* env vars (Some => set) alongside
    // the standard model fields.
    let raw = r#"{
            "main": "gw/opus",
            "customOption": "gw/opus-preview",
            "customOptionName": "Gateway Opus",
            "customOptionDescription": "via gateway"
        }"#;
    let out = parse_provider_model(AgentType::ClaudeCode, Some(raw));
    assert_eq!(
        out.get("ANTHROPIC_CUSTOM_MODEL_OPTION"),
        Some(&Some("gw/opus-preview".to_string()))
    );
    assert_eq!(
        out.get("ANTHROPIC_CUSTOM_MODEL_OPTION_NAME"),
        Some(&Some("Gateway Opus".to_string()))
    );
    assert_eq!(
        out.get("ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION"),
        Some(&Some("via gateway".to_string()))
    );
    assert_eq!(
        out.get("ANTHROPIC_MODEL"),
        Some(&Some("gw/opus".to_string()))
    );

    // Omitted custom keys are authoritative clears (None => remove from env),
    // matching the five model fields' overwrite semantics.
    let bare = parse_provider_model(AgentType::ClaudeCode, Some(r#"{"main":"x"}"#));
    assert_eq!(bare.get("ANTHROPIC_CUSTOM_MODEL_OPTION"), Some(&None));
    assert_eq!(bare.get("ANTHROPIC_CUSTOM_MODEL_OPTION_NAME"), Some(&None));
    assert_eq!(
        bare.get("ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION"),
        Some(&None)
    );
}

#[test]
fn parse_provider_model_emits_claude_default_fable_model() {
    // `fable` is a provider-owned pin like the other model fields: a value
    // sets ANTHROPIC_DEFAULT_FABLE_MODEL (trimmed), and an omitted one is an
    // authoritative clear, so the previous provider's Fable pin cannot
    // survive a bind or a provider edit.
    let out = parse_provider_model(
        AgentType::ClaudeCode,
        Some(r#"{"opus":"gw/opus","fable":" gw/fable "}"#),
    );
    assert_eq!(
        out.get("ANTHROPIC_DEFAULT_FABLE_MODEL"),
        Some(&Some("gw/fable".to_string()))
    );
    assert_eq!(
        out.get("ANTHROPIC_DEFAULT_OPUS_MODEL"),
        Some(&Some("gw/opus".to_string()))
    );

    let bare = parse_provider_model(AgentType::ClaudeCode, Some(r#"{"main":"x"}"#));
    assert_eq!(bare.get("ANTHROPIC_DEFAULT_FABLE_MODEL"), Some(&None));
}

#[test]
fn parse_provider_model_codex_uses_default_slug() {
    // A structured codex catalog resolves OPENAI_MODEL to its default slug,
    // not the whole JSON blob.
    let raw = r#"{"models":[{"slug":"gw/a","base":"gpt-5.4"},{"slug":"gw/b","base":"gpt-5.4"}],"default":"gw/b"}"#;
    let out = parse_provider_model(AgentType::Codex, Some(raw));
    assert_eq!(out.get("OPENAI_MODEL"), Some(&Some("gw/b".to_string())));

    // A legacy plain slug passes through as the model.
    let legacy = parse_provider_model(AgentType::Codex, Some("gpt-5.5"));
    assert_eq!(
        legacy.get("OPENAI_MODEL"),
        Some(&Some("gpt-5.5".to_string()))
    );

    // No models → OPENAI_MODEL cleared (None).
    let empty = parse_provider_model(AgentType::Codex, Some(r#"{"models":[]}"#));
    assert_eq!(empty.get("OPENAI_MODEL"), Some(&None));
}

#[test]
fn merge_json_values_clears_stale_custom_model_option_via_null() {
    // The local-config cascade (cascade_update_agent_config) encodes a
    // cleared model key as JSON-null. merge_json_values must DELETE that key
    // from the on-disk config (nested under `env`) while preserving sibling
    // keys — this is what stops a stale ANTHROPIC_CUSTOM_MODEL_OPTION* in
    // ~/.claude/settings.json from winning after binding to a provider that
    // omits the trio (parse_provider_model yields `None` => null here).
    let mut base = serde_json::json!({
        "env": {
            "ANTHROPIC_CUSTOM_MODEL_OPTION": "gw/opus-stale",
            "ANTHROPIC_CUSTOM_MODEL_OPTION_NAME": "Stale",
            "ANTHROPIC_MODEL": "keep-me"
        }
    });
    let patch = serde_json::json!({
        "env": {
            "ANTHROPIC_CUSTOM_MODEL_OPTION": null,
            "ANTHROPIC_CUSTOM_MODEL_OPTION_NAME": null
        }
    });
    merge_json_values(&mut base, &patch);
    let env = base
        .get("env")
        .and_then(|v| v.as_object())
        .expect("env object survives the merge");
    assert!(!env.contains_key("ANTHROPIC_CUSTOM_MODEL_OPTION"));
    assert!(!env.contains_key("ANTHROPIC_CUSTOM_MODEL_OPTION_NAME"));
    assert_eq!(
        env.get("ANTHROPIC_MODEL").and_then(|v| v.as_str()),
        Some("keep-me")
    );
}

#[test]
fn merge_json_values_never_materializes_a_removal_into_a_missing_parent() {
    // The regression: binding a Claude provider that configures NO models
    // against a ~/.claude/settings.json that has no `env` object yet. Every
    // ANTHROPIC_*_MODEL entry of the cascade patch is a removal, and the old
    // merge copied the whole `env` subtree in verbatim because the key was
    // absent — writing the sentinels out as real JSON nulls. The Claude Code
    // CLI stringifies settings env into `process.env`, so those became the
    // model name "null" and every row of the composer's model picker read
    // `null`.
    let mut base = serde_json::json!({ "effortLevel": "high" });
    let patch = serde_json::json!({
        "env": {
            "ANTHROPIC_BASE_URL": "https://gw.example",
            "ANTHROPIC_AUTH_TOKEN": "sk-1",
            "ANTHROPIC_MODEL": null,
            "ANTHROPIC_DEFAULT_OPUS_MODEL": null,
            "ANTHROPIC_CUSTOM_MODEL_OPTION": null
        }
    });
    merge_json_values(&mut base, &patch);
    let env = base
        .get("env")
        .and_then(|v| v.as_object())
        .expect("env object created for the real values");
    assert_eq!(
        env.get("ANTHROPIC_BASE_URL").and_then(|v| v.as_str()),
        Some("https://gw.example")
    );
    assert_eq!(
        env.get("ANTHROPIC_AUTH_TOKEN").and_then(|v| v.as_str()),
        Some("sk-1")
    );
    // Not "present and null" — absent.
    assert!(!env.contains_key("ANTHROPIC_MODEL"));
    assert!(!env.contains_key("ANTHROPIC_DEFAULT_OPUS_MODEL"));
    assert!(!env.contains_key("ANTHROPIC_CUSTOM_MODEL_OPTION"));
    // Untouched siblings survive.
    assert_eq!(
        base.get("effortLevel").and_then(|v| v.as_str()),
        Some("high")
    );
}

#[test]
fn merge_json_values_skips_a_patch_subtree_that_is_only_removals() {
    // Same missing-parent case, but the patch has nothing real to add:
    // creating an empty `env` husk in a config that never had one would be
    // writing a key the user never asked for.
    let mut base = serde_json::json!({});
    merge_json_values(
        &mut base,
        &serde_json::json!({ "env": { "ANTHROPIC_MODEL": null } }),
    );
    assert!(!base.as_object().expect("object").contains_key("env"));

    // An object the patch author wrote as empty IS a value — it still lands.
    let mut base = serde_json::json!({});
    merge_json_values(&mut base, &serde_json::json!({ "env": {} }));
    assert_eq!(base.get("env"), Some(&serde_json::json!({})));
}

#[test]
fn merge_json_values_strips_removals_when_replacing_a_mistyped_base() {
    // A base whose `env` is not an object can't be merged into, so the patch
    // replaces it — still without materializing the sentinels.
    let mut base = serde_json::json!({ "env": "not-an-object" });
    merge_json_values(
        &mut base,
        &serde_json::json!({ "env": { "ANTHROPIC_BASE_URL": "https://gw", "ANTHROPIC_MODEL": null } }),
    );
    assert_eq!(
        base.get("env"),
        Some(&serde_json::json!({ "ANTHROPIC_BASE_URL": "https://gw" }))
    );

    // Arrays are data, not key/value maps: a null element is preserved.
    let mut base = serde_json::json!({});
    merge_json_values(&mut base, &serde_json::json!({ "xs": [1, null, 2] }));
    assert_eq!(base.get("xs"), Some(&serde_json::json!([1, null, 2])));
}

#[test]
fn agent_runtime_config_env_survives_a_non_string_value() {
    // A settings.json corrupted by the old merge (env values as JSON null)
    // must not cost the launch env everything else in the file: the bad
    // entries are skipped, the rest — including the credentials — still land.
    let config: AgentRuntimeConfig = serde_json::from_str(
        r#"{"env":{"ANTHROPIC_BASE_URL":"https://gw","ANTHROPIC_MODEL":null,"PORT":8080}}"#,
    )
    .expect("a null env value must not fail the whole parse");
    assert_eq!(
        config.env.get("ANTHROPIC_BASE_URL").map(String::as_str),
        Some("https://gw")
    );
    assert!(!config.env.contains_key("ANTHROPIC_MODEL"));
    assert!(!config.env.contains_key("PORT"));
}

#[test]
fn fingerprint_config_is_deterministic_and_excludes_volatile_keys() {
    let agent = AgentType::Codex;
    let mut env = BTreeMap::new();
    env.insert("OPENAI_BASE_URL".to_string(), "https://a".to_string());
    env.insert("OPENAI_API_KEY".to_string(), "k1".to_string());

    // `fingerprint_config` folds in the on-disk native config, so this test
    // must pin CODEX_HOME the way the Grok/Cursor fingerprint tests below
    // pin theirs. Reading the developer's real ~/.codex would make the
    // "same inputs → same fingerprint" assertions depend on whether another
    // test happened to be inside its own `temp_env` CODEX_HOME scope at the
    // time — temp_env mutates the process environment, and only tests that
    // take its lock are serialized against each other.
    let dir = tempfile::tempdir().expect("tempdir");
    temp_env::with_var("CODEX_HOME", Some(dir.path()), || {
        // Same inputs → same fingerprint (the native-config read is
        // identical across all calls in this test, so only the env varies).
        let fp1 = fingerprint_config(agent, &env);
        assert_eq!(fp1, fingerprint_config(agent, &env));

        // Changing a real config value changes the fingerprint.
        let mut env_changed = env.clone();
        env_changed.insert("OPENAI_API_KEY".to_string(), "k2".to_string());
        assert_ne!(fp1, fingerprint_config(agent, &env_changed));

        // The per-launch volatile key is excluded — adding it must NOT
        // change the fingerprint (otherwise OpenClaw would look stale once a
        // real session id is assigned and the reset flag drops).
        let mut env_volatile = env.clone();
        env_volatile.insert("OPENCLAW_RESET_SESSION".to_string(), "1".to_string());
        assert_eq!(fp1, fingerprint_config(agent, &env_volatile));
    });
}

#[test]
fn grok_fingerprint_tracks_config_toml_changes() {
    // Grok's ~/.grok/config.toml is edited via the Grok settings panel but
    // is NOT in `agent_local_config_path`, so `fingerprint_config` must fold
    // it in explicitly — otherwise `refresh_config_staleness` never marks a
    // running Grok session restart-required after a config.toml change.
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("config.toml");
    temp_env::with_var("GROK_HOME", Some(dir.path()), || {
        let env: BTreeMap<String, String> = BTreeMap::new();
        let empty_fp = fingerprint_config(AgentType::Grok, &env);

        std::fs::write(&path, "[models]\ndefault_reasoning_effort = \"low\"\n").expect("write low");
        let low_fp = fingerprint_config(AgentType::Grok, &env);
        assert_ne!(
            empty_fp, low_fp,
            "adding ~/.grok/config.toml must change the fingerprint"
        );

        std::fs::write(&path, "[models]\ndefault_reasoning_effort = \"high\"\n")
            .expect("write high");
        let high_fp = fingerprint_config(AgentType::Grok, &env);
        assert_ne!(
            low_fp, high_fp,
            "changing default_reasoning_effort must change the fingerprint"
        );
    });
}

/// Parse a provider table out of a TOML fragment so the auth-default tests
/// read like the config.toml a user would actually write.
fn provider_table_of(raw: &str) -> toml::map::Map<String, toml::Value> {
    raw.parse::<toml::Value>()
        .expect("fragment must parse")
        .get("model_providers")
        .and_then(toml::Value::as_table)
        .and_then(|providers| providers.get("codeg"))
        .and_then(toml::Value::as_table)
        .cloned()
        .expect("fragment must define model_providers.codeg")
}

fn auth_flag_of(table: &toml::map::Map<String, toml::Value>) -> Option<bool> {
    table
        .get("requires_openai_auth")
        .and_then(toml::Value::as_bool)
}

#[test]
fn codex_auth_default_is_supplied_only_when_absent() {
    // codeg provisions its provider with the key in auth.json and no
    // `env_key`, so a provider WE create needs requires_openai_auth = true.
    let mut fresh = provider_table_of("[model_providers.codeg]\nbase_url = \"https://x/v1\"\n");
    ensure_codex_provider_auth_default(&mut fresh);
    assert_eq!(auth_flag_of(&fresh), Some(true));

    // An explicit false is the user's call and must survive every path —
    // this is the regression the whole change exists for.
    let mut explicit_false = provider_table_of(
        "[model_providers.codeg]\nbase_url = \"https://x/v1\"\nrequires_openai_auth = false\n",
    );
    ensure_codex_provider_auth_default(&mut explicit_false);
    assert_eq!(auth_flag_of(&explicit_false), Some(false));

    // An explicit true is left alone rather than rewritten.
    let mut explicit_true =
        provider_table_of("[model_providers.codeg]\nrequires_openai_auth = true\n");
    ensure_codex_provider_auth_default(&mut explicit_true);
    assert_eq!(auth_flag_of(&explicit_true), Some(true));
}

#[test]
fn codex_auth_default_yields_to_actor_authorization() {
    // codex's uses_openai_actor_authorization() is
    // `!requires_openai_auth && <non-empty x-openai-actor-authorization>`,
    // so writing the default here would silently disable that auth path.
    let mut header_present = provider_table_of(
        "[model_providers.codeg]\nbase_url = \"https://x/v1\"\n\n\
             [model_providers.codeg.http_headers]\n\
             x-openai-actor-authorization = \"local-image-extension\"\n",
    );
    ensure_codex_provider_auth_default(&mut header_present);
    assert_eq!(auth_flag_of(&header_present), None);

    // Header matching is case-insensitive, mirroring eq_ignore_ascii_case.
    let mut mixed_case = provider_table_of(
        "[model_providers.codeg.http_headers]\n\
             X-OpenAI-Actor-Authorization = \"local-image-extension\"\n",
    );
    ensure_codex_provider_auth_default(&mut mixed_case);
    assert_eq!(auth_flag_of(&mixed_case), None);

    // An inline table is the same table to the parser.
    let mut inline = provider_table_of(
        "[model_providers.codeg]\n\
             http_headers = { \"x-openai-actor-authorization\" = \"local-image-extension\" }\n",
    );
    ensure_codex_provider_auth_default(&mut inline);
    assert_eq!(auth_flag_of(&inline), None);

    // An empty header value does not enable the path upstream
    // (`!value.trim().is_empty()`), so the default still applies.
    let mut empty_value = provider_table_of(
        "[model_providers.codeg.http_headers]\nx-openai-actor-authorization = \"  \"\n",
    );
    ensure_codex_provider_auth_default(&mut empty_value);
    assert_eq!(auth_flag_of(&empty_value), Some(true));

    // A header plus an explicit true is a contradictory config, but it is
    // the user's: never rewrite or remove it.
    let mut header_and_true = provider_table_of(
        "[model_providers.codeg]\nrequires_openai_auth = true\n\n\
             [model_providers.codeg.http_headers]\n\
             x-openai-actor-authorization = \"local-image-extension\"\n",
    );
    ensure_codex_provider_auth_default(&mut header_and_true);
    assert_eq!(auth_flag_of(&header_and_true), Some(true));

    // A quoted key containing dots is ONE literal key, not an http_headers
    // sub-table, so it must not suppress the default.
    let mut literal_dotted_key = provider_table_of(
        "[model_providers.codeg]\n\
             \"http_headers.x-openai-actor-authorization\" = \"local-image-extension\"\n",
    );
    ensure_codex_provider_auth_default(&mut literal_dotted_key);
    assert_eq!(auth_flag_of(&literal_dotted_key), Some(true));
}

#[test]
fn codex_cascade_preserves_explicit_auth_flag_and_headers() {
    // Repro path 2 from issue #406: editing a bound model provider's URL /
    // key / model cascades into ~/.codex/config.toml, which used to
    // overwrite requires_openai_auth on the way through.
    let dir = tempfile::tempdir().expect("tempdir");
    temp_env::with_var("CODEX_HOME", Some(dir.path()), || {
        let config_path = dir.path().join("config.toml");
        std::fs::write(
            &config_path,
            "model_provider = \"codeg\"\n\n\
                 [model_providers.codeg]\n\
                 base_url = \"https://old.example/v1\"\n\
                 name = \"codeg\"\n\
                 wire_api = \"responses\"\n\
                 requires_openai_auth = false\n\n\
                 [model_providers.codeg.http_headers]\n\
                 x-openai-actor-authorization = \"local-image-extension\"\n",
        )
        .expect("seed config.toml");

        cascade_update_agent_config(
            AgentType::Codex,
            "https://new.example/v1",
            "sk-test",
            &BTreeMap::new(),
            &CodexModelAction::Set("gpt-5-codex".to_string()),
            None,
        )
        .expect("cascade must succeed");

        let written = std::fs::read_to_string(&config_path).expect("read back");
        let table = provider_table_of(&written);
        assert_eq!(
            auth_flag_of(&table),
            Some(false),
            "an explicit requires_openai_auth = false must survive the cascade"
        );
        assert!(
            codex_provider_uses_actor_authorization(&table),
            "the actor-authorization header must survive the cascade"
        );
        assert_eq!(
            table.get("base_url").and_then(toml::Value::as_str),
            Some("https://new.example/v1"),
            "the cascade must still apply the new base_url"
        );
    });
}

#[test]
fn codex_cascade_seeds_auth_flag_for_a_fresh_provider() {
    let dir = tempfile::tempdir().expect("tempdir");
    temp_env::with_var("CODEX_HOME", Some(dir.path()), || {
        cascade_update_agent_config(
            AgentType::Codex,
            "https://new.example/v1",
            "sk-test",
            &BTreeMap::new(),
            &CodexModelAction::NoOp,
            None,
        )
        .expect("cascade must succeed");

        let written = std::fs::read_to_string(dir.path().join("config.toml")).expect("read back");
        assert_eq!(
            auth_flag_of(&provider_table_of(&written)),
            Some(true),
            "a provider codeg creates still gets the default"
        );
    });
}

#[test]
fn codex_cascade_leaves_a_non_codeg_provider_alone() {
    let dir = tempfile::tempdir().expect("tempdir");
    temp_env::with_var("CODEX_HOME", Some(dir.path()), || {
        let config_path = dir.path().join("config.toml");
        std::fs::write(
            &config_path,
            "model_provider = \"custom\"\n\n\
                 [model_providers.custom]\n\
                 base_url = \"https://old.example/v1\"\n",
        )
        .expect("seed config.toml");

        cascade_update_agent_config(
            AgentType::Codex,
            "https://new.example/v1",
            "sk-test",
            &BTreeMap::new(),
            &CodexModelAction::NoOp,
            None,
        )
        .expect("cascade must succeed");

        let written = std::fs::read_to_string(&config_path).expect("read back");
        let parsed = written.parse::<toml::Value>().expect("must parse");
        let custom = parsed
            .get("model_providers")
            .and_then(toml::Value::as_table)
            .and_then(|providers| providers.get("custom"))
            .and_then(toml::Value::as_table)
            .expect("custom provider must survive");
        assert!(
            !custom.contains_key("requires_openai_auth"),
            "only the codeg provider is codeg-managed"
        );
    });
}

#[test]
fn cursor_fingerprint_tracks_cli_config_changes() {
    // Cursor's ~/.cursor/cli-config.json (permission rules / sandbox) is
    // edited via the Cursor settings panel but is NOT in
    // `agent_local_config_path`, so `fingerprint_config` must fold it in
    // explicitly — otherwise a permission-rule change never marks a running
    // Cursor session restart-required.
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("cli-config.json");
    temp_env::with_var("CURSOR_CONFIG_DIR", Some(dir.path()), || {
        let env: BTreeMap<String, String> = BTreeMap::new();
        let empty_fp = fingerprint_config(AgentType::Cursor, &env);

        std::fs::write(&path, "{\"permissions\":{\"allow\":[\"Shell(ls)\"]}}")
            .expect("write allow");
        let allow_fp = fingerprint_config(AgentType::Cursor, &env);
        assert_ne!(
            empty_fp, allow_fp,
            "adding cli-config.json must change the fingerprint"
        );

        std::fs::write(&path, "{\"permissions\":{\"deny\":[\"Shell(rm)\"]}}").expect("write deny");
        let deny_fp = fingerprint_config(AgentType::Cursor, &env);
        assert_ne!(
            allow_fp, deny_fp,
            "changing permission rules must change the fingerprint"
        );
    });
}

#[test]
fn cursor_structured_config_merges_preserving_unknown_keys() {
    // The panel's structured save must only touch the managed keys —
    // editor prefs and other CLI-owned keys survive verbatim, and
    // empty-string scalars remove their key.
    let base = r#"{
  "version": 1,
  "editor": { "vimMode": true },
  "approvalMode": "allowlist",
  "sandbox": { "mode": "disabled", "networkAccess": "full" },
  "permissions": { "allow": ["Shell(ls)"], "deny": [] }
}"#;
    let patch = crate::acp::types::CursorStructuredConfig {
        sandbox_mode: Some("enabled".to_string()),
        permissions_allow: Some(vec![
            "Shell(npm run build)".to_string(),
            "  ".to_string(), // blank rows are dropped
        ]),
        permissions_deny: None, // untouched
    };
    let merged = apply_cursor_structured_config(base, &patch).expect("merge");
    let v: serde_json::Value = serde_json::from_str(&merged).expect("valid json");
    assert_eq!(v.pointer("/editor/vimMode"), Some(&serde_json::json!(true)));
    assert_eq!(
        v.pointer("/sandbox/networkAccess"),
        Some(&serde_json::json!("full"))
    );
    assert!(
        v.get("approvalMode").is_none(),
        "the legacy approvalMode key is dropped: the CLI never reads it \
             from cli-config.json"
    );
    assert_eq!(
        v.pointer("/sandbox/mode"),
        Some(&serde_json::json!("enabled"))
    );
    assert_eq!(
        v.pointer("/permissions/allow"),
        Some(&serde_json::json!(["Shell(npm run build)"]))
    );
    assert_eq!(v.pointer("/permissions/deny"), Some(&serde_json::json!([])));
}

#[tokio::test]
async fn qoder_probe_env_materializes_the_token() {
    let db = crate::db::test_helpers::fresh_in_memory_db().await;

    // The form value wins over saved env and is trimmed.
    let env = qoder_probe_env(&db, Some("  pat-123  ")).await;
    assert_eq!(
        env.get("QODER_PERSONAL_ACCESS_TOKEN").map(String::as_str),
        Some("pat-123")
    );

    // No token on screen → present but empty, so `run_qoder_probe` strips
    // any inherited one instead of probing a credential a launch wouldn't use.
    let cleared = qoder_probe_env(&db, Some("")).await;
    assert_eq!(
        cleared
            .get("QODER_PERSONAL_ACCESS_TOKEN")
            .map(String::as_str),
        Some("")
    );
    let unset = qoder_probe_env(&db, None).await;
    assert_eq!(
        unset.get("QODER_PERSONAL_ACCESS_TOKEN").map(String::as_str),
        Some("")
    );
}

#[tokio::test]
async fn cursor_probe_env_materializes_key_and_scrubs_base_url() {
    let db = crate::db::test_helpers::fresh_in_memory_db().await;

    // API-key mode: the form value wins over saved env and is trimmed; the
    // base URL is always scrubbed to empty (⇒ removed by run_cursor_probe).
    let env = cursor_probe_env(&db, Some("  my-key  ")).await;
    assert_eq!(
        env.get("CURSOR_API_KEY").map(String::as_str),
        Some("my-key")
    );
    assert_eq!(env.get("CURSOR_API_BASE_URL").map(String::as_str), Some(""));

    // Subscription passes an empty key → present but empty, so the probe
    // strips any inherited value instead of leaking it.
    let cleared = cursor_probe_env(&db, Some("")).await;
    assert_eq!(cleared.get("CURSOR_API_KEY").map(String::as_str), Some(""));
    assert_eq!(
        cleared.get("CURSOR_API_BASE_URL").map(String::as_str),
        Some("")
    );

    // No override + empty DB → key still materialized empty.
    let none = cursor_probe_env(&db, None).await;
    assert_eq!(none.get("CURSOR_API_KEY").map(String::as_str), Some(""));
    assert_eq!(
        none.get("CURSOR_API_BASE_URL").map(String::as_str),
        Some("")
    );
}

#[test]
fn parse_cursor_models_reads_id_label_and_default() {
    // Verbatim shape of `cursor-agent models` (id - label [(default)]).
    let stdout = "Available models\n\n\
             auto - Auto (default)\n\
             claude-opus-4-8-high - Opus 4.8 1M\n\
             gpt-5.3-codex - Codex 5.3\n\
             claude-fable-5-thinking-high - Fable 5 1M Thinking (NO ZDR)\n";
    let (models, default_model) = parse_cursor_models(stdout);

    // The "Available models" header (has whitespace, no " - ") is skipped.
    assert_eq!(models.len(), 4);
    assert_eq!(default_model.as_deref(), Some("auto"));

    assert_eq!(models[0].id, "auto");
    assert_eq!(models[0].label, "Auto");
    assert!(models[0].is_default);

    assert_eq!(models[1].id, "claude-opus-4-8-high");
    assert_eq!(models[1].label, "Opus 4.8 1M");
    assert!(!models[1].is_default);

    // A parenthetical that isn't the default marker stays in the label.
    assert_eq!(models[3].label, "Fable 5 1M Thinking (NO ZDR)");
}

#[test]
fn parse_cursor_models_tolerates_ansi_markers_and_bare_ids() {
    // ANSI SGR + a leading list marker + a bare-id line with no label.
    let stdout = "\u{1b}[1mAvailable models\u{1b}[0m\n- gpt-5.2 - GPT-5.2\ncomposer-2.5\n";
    let (models, default_model) = parse_cursor_models(stdout);
    assert_eq!(default_model, None);
    assert_eq!(models.len(), 2);
    assert_eq!(models[0].id, "gpt-5.2");
    assert_eq!(models[0].label, "GPT-5.2");
    // Bare id (no " - <label>") → id kept, label empty.
    assert_eq!(models[1].id, "composer-2.5");
    assert_eq!(models[1].label, "");
}

#[tokio::test]
async fn find_connection_for_conversation_core_returns_info_when_bound() {
    // A live connection bound to the conversation → discovery returns its
    // id plus the current event_seq (informational; the viewer cold-attaches
    // with a full snapshot, not a cursor replay).
    use crate::acp::manager::ConnectionManager;
    use crate::models::AgentType;
    use crate::web::event_bridge::EventEmitter;

    let mgr = ConnectionManager::new();
    mgr.insert_test_connection("c1", AgentType::ClaudeCode, None, EventEmitter::Noop)
        .await;
    {
        let state = mgr.get_state("c1").await.expect("state present");
        let mut s = state.write().await;
        s.conversation_id = Some(42);
        s.event_seq = 7;
    }

    let info = acp_find_connection_for_conversation_core(&mgr, 42, None, AgentType::ClaudeCode)
        .await
        .expect("ok")
        .expect("a live connection is bound to conversation 42");
    assert_eq!(info.connection_id, "c1");
    assert_eq!(info.event_seq, 7);
}

#[tokio::test]
async fn find_connection_for_conversation_core_none_when_unbound() {
    // No live connection owns the conversation → None (the client spawns +
    // owns one instead of attaching as a viewer).
    use crate::acp::manager::ConnectionManager;
    use crate::models::AgentType;
    use crate::web::event_bridge::EventEmitter;

    let mgr = ConnectionManager::new();
    mgr.insert_test_connection("c1", AgentType::ClaudeCode, None, EventEmitter::Noop)
        .await;
    assert!(
        acp_find_connection_for_conversation_core(&mgr, 999, None, AgentType::ClaudeCode)
            .await
            .expect("ok")
            .is_none()
    );
}

#[tokio::test]
async fn find_connection_for_conversation_core_falls_back_to_session_id() {
    // A live connection exists with its external_id set but its
    // conversation_id NOT yet bound (the pre-first-prompt window). The
    // by-conversation lookup misses; the session_id fallback finds it, so a
    // second client opening the same historical conversation attaches as a
    // viewer instead of reusing-as-owner and later killing the connection.
    use crate::acp::manager::ConnectionManager;
    use crate::models::AgentType;
    use crate::web::event_bridge::EventEmitter;

    let mgr = ConnectionManager::new();
    mgr.insert_test_connection("c1", AgentType::ClaudeCode, None, EventEmitter::Noop)
        .await;
    {
        let state = mgr.get_state("c1").await.expect("state present");
        let mut s = state.write().await;
        s.external_id = Some("sess-abc".to_string());
        s.event_seq = 3;
        // conversation_id intentionally left None.
    }

    // by-conversation misses, no session fallback → None.
    assert!(
        acp_find_connection_for_conversation_core(&mgr, 42, None, AgentType::ClaudeCode)
            .await
            .expect("ok")
            .is_none(),
        "without a session_id fallback an unbound connection is undiscoverable"
    );

    // session fallback finds the live owner (matching agent_type).
    let info = acp_find_connection_for_conversation_core(
        &mgr,
        42,
        Some("sess-abc"),
        AgentType::ClaudeCode,
    )
    .await
    .expect("ok")
    .expect("session_id fallback finds the unbound live connection");
    assert_eq!(info.connection_id, "c1");
    assert_eq!(info.event_seq, 3);

    // a non-matching session id still misses.
    assert!(acp_find_connection_for_conversation_core(
        &mgr,
        42,
        Some("other"),
        AgentType::ClaudeCode
    )
    .await
    .expect("ok")
    .is_none());

    // the SAME session id but a DIFFERENT agent_type must NOT match
    // (external_id is unique only per agent) — otherwise a viewer could
    // attach to the wrong agent's connection.
    assert!(
        acp_find_connection_for_conversation_core(&mgr, 42, Some("sess-abc"), AgentType::Codex)
            .await
            .expect("ok")
            .is_none(),
        "external_id fallback must be scoped by agent_type"
    );
}

#[tokio::test]
async fn find_connection_for_conversation_core_none_when_terminal_status() {
    // A connection bound to the conversation but already in a terminal
    // status (teardown wrote it before the map entry was removed) is NOT a
    // live attach target → None, so the viewer reads persisted detail
    // instead of attaching to a dying stream.
    use crate::acp::manager::ConnectionManager;
    use crate::models::AgentType;
    use crate::web::event_bridge::EventEmitter;

    for terminal in [ConnectionStatus::Disconnected, ConnectionStatus::Error] {
        let mgr = ConnectionManager::new();
        mgr.insert_test_connection("c1", AgentType::ClaudeCode, None, EventEmitter::Noop)
            .await;
        {
            let state = mgr.get_state("c1").await.expect("state present");
            let mut s = state.write().await;
            s.conversation_id = Some(42);
            s.status = terminal.clone();
        }
        assert!(
            acp_find_connection_for_conversation_core(&mgr, 42, None, AgentType::ClaudeCode)
                .await
                .expect("ok")
                .is_none(),
            "terminal status {terminal:?} must not be returned as a live connection"
        );
    }
}

#[test]
fn sanitize_custom_version_accepts_version_like_inputs() {
    assert_eq!(sanitize_custom_version("0.44.1").as_deref(), Some("0.44.1"));
    assert_eq!(
        sanitize_custom_version("  v1.2.3 ").as_deref(),
        Some("1.2.3")
    );
    assert_eq!(
        sanitize_custom_version("2026.5.20").as_deref(),
        Some("2026.5.20")
    );
    assert_eq!(
        sanitize_custom_version("1.2.3-beta.1").as_deref(),
        Some("1.2.3-beta.1")
    );
    assert_eq!(
        sanitize_custom_version("1.0.0+build.5").as_deref(),
        Some("1.0.0+build.5")
    );
}

#[test]
fn sanitize_custom_version_rejects_invalid_inputs() {
    for bad in [
        "",
        "   ",
        "latest",
        "next",
        "v",
        "2",
        "v9",
        "1.2 .3",
        "1.2.3@evil",
        "../etc",
    ] {
        assert_eq!(
            sanitize_custom_version(bad),
            None,
            "expected {bad:?} rejected"
        );
    }
}

#[test]
fn build_npm_install_spec_uses_registry_when_no_override() {
    assert_eq!(
        build_npm_install_spec("@google/gemini-cli@0.44.1", None).unwrap(),
        "@google/gemini-cli@0.44.1"
    );
    assert_eq!(
        build_npm_install_spec("@google/gemini-cli@0.44.1", Some("  ")).unwrap(),
        "@google/gemini-cli@0.44.1"
    );
}

#[test]
fn build_npm_install_spec_applies_custom_version() {
    assert_eq!(
        build_npm_install_spec("@google/gemini-cli@0.44.1", Some("0.43.0")).unwrap(),
        "@google/gemini-cli@0.43.0"
    );
    // Scoped/plain package name is preserved; a leading `v` is stripped.
    assert_eq!(
        build_npm_install_spec("cline@3.0.9", Some("v2.0.0")).unwrap(),
        "cline@2.0.0"
    );
}

#[test]
fn build_npm_install_spec_rejects_invalid_override() {
    assert!(build_npm_install_spec("cline@3.0.9", Some("latest")).is_err());
}

// The pinned default is byte-identical to what `build_npm_install_spec`
// produced before the channel existed, with no fallback attempt.
#[test]
fn npm_install_attempts_defaults_to_the_pinned_spec() {
    assert_eq!(
        npm_install_attempts("@google/gemini-cli@0.44.1", None, false).unwrap(),
        ("@google/gemini-cli@0.44.1".to_string(), None)
    );
    assert_eq!(
        npm_install_attempts("@google/gemini-cli@0.44.1", Some("  "), false).unwrap(),
        ("@google/gemini-cli@0.44.1".to_string(), None)
    );
}

// The latest channel tries the `latest` dist-tag first and keeps the
// registry pin as the fallback, so a failed latest install degrades to the
// reviewed version instead of no install at all.
#[test]
fn npm_install_attempts_maps_latest_channel_onto_the_dist_tag() {
    assert_eq!(
        npm_install_attempts("@google/gemini-cli@0.44.1", None, true).unwrap(),
        (
            "@google/gemini-cli@latest".to_string(),
            Some("@google/gemini-cli@0.44.1".to_string())
        )
    );
    // A blank override is the same as none.
    assert_eq!(
        npm_install_attempts("cline@3.0.9", Some(" "), true).unwrap(),
        ("cline@latest".to_string(), Some("cline@3.0.9".to_string()))
    );
}

// An explicit custom version wins on either channel and never falls back:
// the user asked for that exact version, and quietly installing another
// would relabel their choice.
#[test]
fn npm_install_attempts_lets_an_explicit_override_win() {
    assert_eq!(
        npm_install_attempts("cline@3.0.9", Some("2.0.0"), true).unwrap(),
        ("cline@2.0.0".to_string(), None)
    );
    assert!(npm_install_attempts("cline@3.0.9", Some("nightly"), true).is_err());
}

// The latest channel introduces a NEW SPEC SHAPE (`<name>@latest`), and the
// spec — not the agent type — is what every downstream step keys off.
// `npm_package_requires_scripts` is the one that bites: hermes-agent's
// postinstall bootstraps its runtime, and it is the only package codeg
// force-enables lifecycle scripts for. A spec shape that hid the package
// name from it would install a shim that only fails later, at connect,
// with "runtime is not ready". Both attempts must be recognized, since
// either one can be the spec that actually lands.
#[test]
fn the_latest_spec_still_names_the_package_downstream_readers_key_off() {
    let (latest, pinned) = npm_install_attempts("hermes-agent@0.21.1", None, true).unwrap();
    assert_eq!(latest, "hermes-agent@latest");
    assert!(npm_package_requires_scripts(&latest));
    assert!(npm_package_requires_scripts(&pinned.unwrap()));
    // And the `@latest` tag is never mistaken for a version number, so a
    // successful latest install falls through to the real post-install
    // probe instead of recording "latest" as the installed version.
    assert_eq!(version_from_package_spec(&latest), None);
}

// Only the exact (trimmed) sentinel opts into the latest channel; absence
// and every other value stay on the pin, matching the frontend reader.
#[test]
fn adapter_channel_reads_only_the_exact_latest_sentinel() {
    let env = |value: Option<&str>| {
        let mut map = BTreeMap::new();
        map.insert("XAI_API_KEY".to_string(), "abc".to_string());
        if let Some(value) = value {
            map.insert(ADAPTER_CHANNEL_ENV.to_string(), value.to_string());
        }
        map
    };
    assert!(!adapter_channel_is_latest(&env(None)));
    assert!(adapter_channel_is_latest(&env(Some("latest"))));
    assert!(adapter_channel_is_latest(&env(Some(" latest "))));
    assert!(!adapter_channel_is_latest(&env(Some("pinned"))));
    assert!(!adapter_channel_is_latest(&env(Some("Latest"))));
    assert!(!adapter_channel_is_latest(&env(Some(""))));
}

#[test]
fn apply_custom_version_to_url_substitutes_all_occurrences() {
    // Codex URL embeds the version twice (path tag + asset filename).
    let codex = "https://github.com/zed-industries/codex-acp/releases/download/v0.15.0/codex-acp-0.15.0-aarch64-apple-darwin.tar.gz";
    assert_eq!(
            apply_custom_version_to_url(codex, "0.15.0", "0.14.0"),
            "https://github.com/zed-industries/codex-acp/releases/download/v0.14.0/codex-acp-0.14.0-aarch64-apple-darwin.tar.gz"
        );

    // OpenCode URL embeds the version once (path tag only).
    let opencode = "https://github.com/anomalyco/opencode/releases/download/v1.15.12/opencode-darwin-arm64.zip";
    assert_eq!(
        apply_custom_version_to_url(opencode, "1.15.12", "1.16.0"),
        "https://github.com/anomalyco/opencode/releases/download/v1.16.0/opencode-darwin-arm64.zip"
    );
}

#[test]
fn parses_npm_global_prefix_stdout() {
    let prefix = npm_global_prefix_from_stdout(b"npm-prefix\n");
    assert_eq!(prefix.as_deref(), Some(Path::new("npm-prefix")));

    assert_eq!(npm_global_prefix_from_stdout(b"\n"), None);
}

#[test]
fn resolves_npx_command_from_npm_prefix_bin_dir() {
    let prefix = unique_test_dir("npm-prefix");
    let bin_dir = npm_prefix_bin_dir(&prefix);
    std::fs::create_dir_all(&bin_dir).expect("create npm prefix bin directory");

    #[cfg(windows)]
    let command_path = bin_dir.join("gemini.cmd");
    #[cfg(not(windows))]
    let command_path = bin_dir.join("gemini");

    std::fs::write(&command_path, "").expect("write command shim");
    #[cfg(not(windows))]
    {
        use std::os::unix::fs::PermissionsExt;

        let mut permissions = std::fs::metadata(&command_path)
            .expect("read command shim metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&command_path, permissions).expect("mark command shim executable");
    }

    let resolved = resolve_npx_command_from_npm_prefix("gemini", &prefix);

    assert_eq!(resolved.as_deref(), Some(command_path.as_path()));
    let _ = std::fs::remove_dir_all(prefix);
}

#[cfg(not(windows))]
#[test]
fn resolves_npx_command_from_eacces_fallback_without_path() {
    let home = unique_test_dir("npm-user-prefix-home");
    temp_env::with_var("HOME", Some(&home), || {
        let prefix = crate::process::user_npm_prefix().expect("user npm prefix");
        let bin_dir = npm_prefix_bin_dir(&prefix);
        std::fs::create_dir_all(&bin_dir).expect("create fallback bin directory");
        let command_path = bin_dir.join("codeg-eacces-fallback-test");
        std::fs::write(&command_path, "#!/bin/sh\n").expect("write command shim");

        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(&command_path)
            .expect("read command shim metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&command_path, permissions).expect("mark command shim executable");

        assert_eq!(
            resolve_npx_command_from_user_prefix("codeg-eacces-fallback-test").as_deref(),
            Some(command_path.as_path())
        );
    });
    let _ = std::fs::remove_dir_all(home);
}

#[cfg(not(windows))]
#[tokio::test]
async fn deepseek_status_rejects_a_recorded_version_when_runtime_is_broken() {
    let dir = unique_test_dir("deepseek-broken-runtime");
    let command_path = dir.join("deepseek-acp");
    std::fs::write(&command_path, "#!/bin/sh\nexit 1\n").expect("write broken command");

    use std::os::unix::fs::PermissionsExt;
    let mut permissions = std::fs::metadata(&command_path)
        .expect("read command metadata")
        .permissions();
    permissions.set_mode(0o755);
    std::fs::set_permissions(&command_path, permissions).expect("make command executable");

    let resolved = Some(command_path.clone());
    let version = npx_displayed_version(
        AgentType::DeepSeek,
        resolved.as_ref(),
        "deepseek-acp@0.7.0",
        Some("0.7.0".to_string()),
    )
    .await;

    assert_eq!(version, None, "a DB version must not mask a broken runtime");
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn does_not_cache_failed_npm_global_prefix_resolution() {
    let cache = tokio::sync::OnceCell::const_new();
    let first = cached_npm_global_prefix_with(&cache, || async { None }).await;
    assert_eq!(first, None);

    let expected = PathBuf::from("npm-prefix");
    let second = cached_npm_global_prefix_with(&cache, || async { Some(expected.clone()) }).await;

    assert_eq!(second, Some(expected));
}

#[cfg(not(windows))]
#[test]
fn ignores_non_executable_npx_command_from_npm_prefix_bin_dir() {
    let prefix = unique_test_dir("npm-prefix-non-executable");
    let bin_dir = npm_prefix_bin_dir(&prefix);
    std::fs::create_dir_all(&bin_dir).expect("create npm prefix bin directory");
    let command_path = bin_dir.join("gemini");
    std::fs::write(&command_path, "").expect("write command shim");

    let resolved = resolve_npx_command_from_npm_prefix("gemini", &prefix);

    assert_eq!(resolved, None);
    let _ = std::fs::remove_dir_all(prefix);
}

fn write_skill_md(name: &str, body: &str) -> (PathBuf, PathBuf) {
    let dir = unique_test_dir(name);
    let path = dir.join("SKILL.md");
    std::fs::write(&path, body).expect("write skill markdown");
    (dir, path)
}

#[test]
fn frontmatter_scalar_strips_quotes_and_rejects_blocks() {
    assert_eq!(
        parse_frontmatter_scalar(" \"hello world\"  ").as_deref(),
        Some("hello world")
    );
    assert_eq!(
        parse_frontmatter_scalar(" 'single quoted' ").as_deref(),
        Some("single quoted")
    );
    assert_eq!(
        parse_frontmatter_scalar("  unquoted value  ").as_deref(),
        Some("unquoted value")
    );
    assert_eq!(parse_frontmatter_scalar("   ").as_deref(), None);
    assert_eq!(parse_frontmatter_scalar(" |").as_deref(), None);
    assert_eq!(parse_frontmatter_scalar(" > folded").as_deref(), None);
}

#[test]
fn skill_description_reads_top_level_description() {
    let (dir, path) = write_skill_md(
        "skill-top-desc",
        "---\nname: demo\ndescription: top level desc\n---\nbody\n",
    );
    assert_eq!(
        read_skill_description(&path).as_deref(),
        Some("top level desc")
    );
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn skill_description_prefers_nested_short_description() {
    let (dir, path) = write_skill_md(
            "skill-short-desc",
            "---\nname: demo\ndescription: long fallback\nmetadata:\n  short-description: pithy summary\n---\nbody\n",
        );
    assert_eq!(
        read_skill_description(&path).as_deref(),
        Some("pithy summary")
    );
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn skill_description_falls_back_when_no_short() {
    let (dir, path) = write_skill_md(
        "skill-fallback",
        "---\nname: demo\ndescription: \"quoted fallback\"\nmetadata:\n  other: value\n---\nbody\n",
    );
    assert_eq!(
        read_skill_description(&path).as_deref(),
        Some("quoted fallback")
    );
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn skill_description_ignores_nested_description_key() {
    // A nested `description:` (e.g. inside `metadata:` or a tool block)
    // must not be picked up as the top-level fallback.
    let (dir, path) = write_skill_md(
        "skill-nested-desc",
        "---\nname: demo\nmetadata:\n  description: nested only\n---\nbody\n",
    );
    assert_eq!(read_skill_description(&path), None);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn skill_description_requires_frontmatter_fence() {
    let (dir, path) = write_skill_md(
        "skill-no-fence",
        "name: demo\ndescription: not really frontmatter\n",
    );
    assert_eq!(read_skill_description(&path), None);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn skill_description_stops_at_closing_fence() {
    let (dir, path) = write_skill_md(
        "skill-closed",
        "---\nname: demo\n---\ndescription: in body, not frontmatter\n",
    );
    assert_eq!(read_skill_description(&path), None);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn skill_description_handles_utf8_content() {
    let (dir, path) = write_skill_md(
        "skill-utf8",
        "---\nname: demo\ndescription: 中文 描述 🚀\n---\nbody\n",
    );
    assert_eq!(
        read_skill_description(&path).as_deref(),
        Some("中文 描述 🚀")
    );
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn skill_description_returns_none_for_missing_file() {
    let dir = unique_test_dir("skill-missing");
    let path = dir.join("does-not-exist.md");
    assert_eq!(read_skill_description(&path), None);
    let _ = std::fs::remove_dir_all(dir);
}

// ----- Hermes config helpers -----

#[test]
fn parse_env_file_ignores_comments_and_strips_quotes() {
    let raw = "# comment\n\nexport OPENROUTER_API_KEY=\"sk-or-123\"\nOPENAI_BASE_URL='https://x.test/v1'\nBARE=plain\n=novalue\n";
    let map = parse_env_file(raw);
    assert_eq!(
        map.get("OPENROUTER_API_KEY").map(String::as_str),
        Some("sk-or-123")
    );
    assert_eq!(
        map.get("OPENAI_BASE_URL").map(String::as_str),
        Some("https://x.test/v1")
    );
    assert_eq!(map.get("BARE").map(String::as_str), Some("plain"));
    assert!(!map.contains_key(""));
}

#[test]
fn patch_env_text_replaces_in_place_and_preserves_rest() {
    let existing = "# secrets\nOPENROUTER_API_KEY=old\n\nOTHER_TOKEN=keep\n";
    let out = patch_env_text(existing, &[("OPENROUTER_API_KEY", "new")]);
    assert!(out.contains("# secrets"), "comment preserved: {out}");
    assert!(
        out.contains("OPENROUTER_API_KEY=new"),
        "key replaced: {out}"
    );
    assert!(
        !out.contains("OPENROUTER_API_KEY=old"),
        "old value gone: {out}"
    );
    assert!(
        out.contains("OTHER_TOKEN=keep"),
        "unrelated key preserved: {out}"
    );
    // Replacement happens in place, not appended at the end.
    assert_eq!(out.matches("OPENROUTER_API_KEY=").count(), 1);
    assert!(out.ends_with('\n'));
}

#[test]
fn patch_env_text_drops_duplicate_keys() {
    // A pre-existing duplicate must not survive: parse_env_file is
    // last-occurrence-wins, so a stale second line would shadow the update.
    let existing = "OPENAI_API_KEY=old1\nKEEP=1\nOPENAI_API_KEY=old2\n";
    let out = patch_env_text(existing, &[("OPENAI_API_KEY", "new")]);
    assert_eq!(
        out.matches("OPENAI_API_KEY=").count(),
        1,
        "single key: {out}"
    );
    assert!(out.contains("OPENAI_API_KEY=new"));
    assert!(
        !out.contains("old1") && !out.contains("old2"),
        "stale gone: {out}"
    );
    assert!(out.contains("KEEP=1"));
    // And a reader of the result sees the new value, not a stale shadow.
    assert_eq!(
        parse_env_file(&out)
            .get("OPENAI_API_KEY")
            .map(String::as_str),
        Some("new")
    );
}

#[test]
fn patch_env_text_appends_missing_key() {
    let out = patch_env_text("EXISTING=1\n", &[("ANTHROPIC_API_KEY", "sk-ant")]);
    assert!(out.contains("EXISTING=1"));
    assert!(out.contains("ANTHROPIC_API_KEY=sk-ant"));
    let empty = patch_env_text("", &[("OPENAI_API_KEY", "k")]);
    assert_eq!(empty, "OPENAI_API_KEY=k\n");
}

#[test]
fn patch_env_text_empty_value_clears_present_and_appends_to_mask() {
    // Clearing a PRESENT key rewrites it to `KEY=` in place.
    let cleared = patch_env_text("OPENAI_API_KEY=secret\nKEEP=1\n", &[("OPENAI_API_KEY", "")]);
    assert!(cleared.contains("OPENAI_API_KEY="));
    assert!(!cleared.contains("OPENAI_API_KEY=secret"));
    assert!(cleared.contains("KEEP=1"));
    // An ABSENT key is still appended as an explicit empty line — under
    // Hermes' dotenv override loading that is what masks a value of the same
    // name inherited from the process environment.
    let absent = patch_env_text("KEEP=1\n", &[("OPENAI_API_KEY", "")]);
    assert!(absent.contains("KEEP=1"));
    assert!(absent.contains("OPENAI_API_KEY="));
}

#[test]
fn merge_hermes_model_config_sets_model_and_keeps_other_keys() {
    let existing =
        "terminal:\n  backend: local\nmodel:\n  default: old-model\n  provider: openai\n";
    let merged = merge_hermes_model_config(
        Some(existing),
        "openrouter",
        "moonshotai/kimi-k2",
        BaseUrlWrite::Preserve,
        InlineApiKeyWrite::Clear,
    )
    .expect("merge");
    let value: serde_yaml::Value = serde_yaml::from_str(&merged).expect("parse merged");
    let model = value.get("model").expect("model section");
    assert_eq!(
        model.get("provider").and_then(|v| v.as_str()),
        Some("openrouter")
    );
    assert_eq!(
        model.get("default").and_then(|v| v.as_str()),
        Some("moonshotai/kimi-k2")
    );
    // Unrelated top-level keys survive the targeted merge.
    assert_eq!(
        value
            .get("terminal")
            .and_then(|t| t.get("backend"))
            .and_then(|v| v.as_str()),
        Some("local")
    );
    // No base_url was requested, so none is written.
    assert!(model.get("base_url").is_none());
}

#[test]
fn merge_hermes_model_config_set_writes_clears_and_preserve_keeps_base_url() {
    let with_base = merge_hermes_model_config(
        None,
        "openai-api",
        "my-model",
        BaseUrlWrite::Set("https://api.test/v1"),
        InlineApiKeyWrite::Clear,
    )
    .expect("merge with base");
    let value: serde_yaml::Value = serde_yaml::from_str(&with_base).expect("parse");
    assert_eq!(
        value
            .get("model")
            .and_then(|m| m.get("base_url"))
            .and_then(|v| v.as_str()),
        Some("https://api.test/v1")
    );
    // Set("") clears the field (user emptied the API URL input).
    let cleared = merge_hermes_model_config(
        Some(&with_base),
        "openai-api",
        "my-model",
        BaseUrlWrite::Set(""),
        InlineApiKeyWrite::Clear,
    )
    .expect("merge clear");
    let value: serde_yaml::Value = serde_yaml::from_str(&cleared).expect("parse");
    assert!(value.get("model").and_then(|m| m.get("base_url")).is_none());
    // Preserve leaves an existing endpoint untouched (provider whose base URL
    // is not user-editable in the panel must not lose an out-of-band value).
    let kept = merge_hermes_model_config(
        Some(&with_base),
        "anthropic",
        "my-model",
        BaseUrlWrite::Preserve,
        InlineApiKeyWrite::Clear,
    )
    .expect("merge preserve");
    let value: serde_yaml::Value = serde_yaml::from_str(&kept).expect("parse");
    assert_eq!(
        value
            .get("model")
            .and_then(|m| m.get("base_url"))
            .and_then(|v| v.as_str()),
        Some("https://api.test/v1")
    );
}

#[test]
fn merge_hermes_model_config_custom_writes_and_clears_inline_key() {
    // custom writes the key inline in `model.api_key` (+ keeps base_url).
    let with_key = merge_hermes_model_config(
        None,
        "custom",
        "gpt-5.5",
        BaseUrlWrite::Set("https://endpoint.test/v1"),
        InlineApiKeyWrite::Set {
            key: "sk-abc",
            scrub_mode: true,
        },
    )
    .expect("merge custom");
    let value: serde_yaml::Value = serde_yaml::from_str(&with_key).expect("parse");
    let model = value.get("model").expect("model section");
    assert_eq!(
        model.get("provider").and_then(|v| v.as_str()),
        Some("custom")
    );
    assert_eq!(
        model.get("api_key").and_then(|v| v.as_str()),
        Some("sk-abc")
    );
    assert_eq!(
        model.get("base_url").and_then(|v| v.as_str()),
        Some("https://endpoint.test/v1")
    );

    // A blank inline key drops the field (keyless local server).
    let keyless = merge_hermes_model_config(
        Some(&with_key),
        "custom",
        "gpt-5.5",
        BaseUrlWrite::Set("https://endpoint.test/v1"),
        InlineApiKeyWrite::Set {
            key: "",
            scrub_mode: false,
        },
    )
    .expect("merge keyless");
    let value: serde_yaml::Value = serde_yaml::from_str(&keyless).expect("parse");
    assert!(value.get("model").and_then(|m| m.get("api_key")).is_none());

    // custom→custom re-save with scrub_mode=false preserves a raw-editor
    // `api_mode`; switching in with scrub_mode=true drops it.
    let with_mode = "model:\n  provider: custom\n  default: m\n  api_mode: anthropic_messages\n";
    let resaved = merge_hermes_model_config(
        Some(with_mode),
        "custom",
        "m",
        BaseUrlWrite::Set("https://e/v1"),
        InlineApiKeyWrite::Set {
            key: "sk-1",
            scrub_mode: false,
        },
    )
    .expect("merge resave");
    let value: serde_yaml::Value = serde_yaml::from_str(&resaved).expect("parse");
    assert_eq!(
        value
            .get("model")
            .and_then(|m| m.get("api_mode"))
            .and_then(|v| v.as_str()),
        Some("anthropic_messages"),
        "custom→custom re-save preserves api_mode"
    );
    let switched_in = merge_hermes_model_config(
        Some(with_mode),
        "custom",
        "m",
        BaseUrlWrite::Set("https://e/v1"),
        InlineApiKeyWrite::Set {
            key: "sk-1",
            scrub_mode: true,
        },
    )
    .expect("merge switch-in");
    let value: serde_yaml::Value = serde_yaml::from_str(&switched_in).expect("parse");
    assert!(
        value.get("model").and_then(|m| m.get("api_mode")).is_none(),
        "switching TO custom scrubs a stale api_mode"
    );

    // Switching to a keyed provider scrubs the stale inline key + api_mode.
    let stale = "model:\n  provider: custom\n  default: gpt-5.5\n  api_key: sk-old\n  api_mode: chat_completions\n";
    let switched = merge_hermes_model_config(
        Some(stale),
        "anthropic",
        "claude",
        BaseUrlWrite::Set(""),
        InlineApiKeyWrite::Clear,
    )
    .expect("merge switch");
    let value: serde_yaml::Value = serde_yaml::from_str(&switched).expect("parse");
    let model = value.get("model").expect("model section");
    assert!(
        model.get("api_key").is_none(),
        "stale inline key must be scrubbed"
    );
    assert!(
        model.get("api_mode").is_none(),
        "stale api_mode must be scrubbed"
    );
}

#[test]
fn plan_hermes_write_preserves_base_url_for_fixed_endpoint_provider() {
    // Anthropic (needsBaseUrl: false) behind a proxy: a structured save that
    // doesn't touch the hidden API URL field must keep the existing endpoint.
    let existing =
        "model:\n  provider: anthropic\n  default: old\n  base_url: https://my-proxy/v1\n";
    let (yaml, env) = plan_hermes_write(
        "anthropic",
        Some("sk-ant"),
        "claude-x",
        None,
        None,
        Some(existing),
    )
    .expect("plan");
    let value: serde_yaml::Value = serde_yaml::from_str(&yaml).expect("yaml");
    assert_eq!(
        value
            .get("model")
            .and_then(|m| m.get("base_url"))
            .and_then(|v| v.as_str()),
        Some("https://my-proxy/v1"),
        "out-of-band base_url must survive a structured save"
    );
    // Only the API key is touched in `.env`; no base-URL var for anthropic.
    assert_eq!(env, vec![("ANTHROPIC_API_KEY", "sk-ant".to_string())]);
}

#[test]
fn plan_hermes_write_clears_stale_base_url_on_provider_switch() {
    // Existing config is `openai-api` with a custom proxy endpoint; the user
    // switches to `anthropic` (fixed endpoint, field hidden). The stale OpenAI
    // base URL must NOT carry over to anthropic.
    let existing =
        "model:\n  provider: openai-api\n  default: gpt-x\n  base_url: https://openai-proxy/v1\n";
    let (yaml, _env) = plan_hermes_write(
        "anthropic",
        Some("sk-ant"),
        "claude-x",
        None,
        None,
        Some(existing),
    )
    .expect("plan");
    let value: serde_yaml::Value = serde_yaml::from_str(&yaml).expect("yaml");
    assert_eq!(
        value
            .get("model")
            .and_then(|m| m.get("provider"))
            .and_then(|v| v.as_str()),
        Some("anthropic")
    );
    assert!(
        value.get("model").and_then(|m| m.get("base_url")).is_none(),
        "stale base_url from the previous provider must be cleared on switch: {yaml}"
    );
}

#[test]
fn plan_hermes_write_neutralizes_openrouter_openai_fallback() {
    // Saving openrouter ALWAYS writes empty OPENAI_API_KEY/OPENAI_BASE_URL —
    // hermes 0.16.0 openrouter resolution falls back to OPENAI_API_KEY (and
    // treats OPENAI_BASE_URL as an override). It runs regardless of the
    // previous provider, including legacy ids no longer in the table.
    for prev in ["openai-api", "openai", "custom", "anthropic"] {
        let existing = format!("model:\n  provider: {prev}\n  default: m\n");
        let (_, env) = plan_hermes_write("openrouter", None, "m", None, None, Some(&existing))
            .expect("→openrouter");
        assert!(
            env.contains(&("OPENAI_API_KEY", String::new())),
            "OPENAI_API_KEY must be neutralized (prev={prev}): {env:?}"
        );
        assert!(env.contains(&("OPENAI_BASE_URL", String::new())));
        // Blank openrouter key → its own var is left untouched.
        assert!(!env.iter().any(|(k, _)| *k == "OPENROUTER_API_KEY"));
    }
    // A provided key is written alongside the neutralization.
    let (_, env) =
        plan_hermes_write("openrouter", Some("sk-or"), "m", None, None, None).expect("keyed");
    assert!(env.contains(&("OPENROUTER_API_KEY", "sk-or".to_string())));
    assert!(env.contains(&("OPENAI_API_KEY", String::new())));
}

#[test]
fn plan_hermes_write_switch_preserves_unrelated_previous_credential() {
    // Switching anthropic → zai must NOT wipe the still-valid ANTHROPIC_API_KEY
    // (zai does not read it, so clearing it would only destroy a good
    // credential). Only zai's own key var is written.
    let existing = "model:\n  provider: anthropic\n  default: m\n";
    let (_, env) = plan_hermes_write("zai", Some("sk-glm"), "m", None, None, Some(existing))
        .expect("anthropic→zai");
    assert_eq!(env, vec![("GLM_API_KEY", "sk-glm".to_string())]);
    assert!(!env.iter().any(|(k, _)| *k == "ANTHROPIC_API_KEY"));
}

#[cfg(unix)]
#[test]
fn write_hermes_secret_file_secures_fresh_and_preserves_existing() {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let mode_of = |p: &Path| fs::metadata(p).expect("metadata").permissions().mode() & 0o777;
    let tmp = tempfile::tempdir().expect("tempdir");
    let home = tmp.path().join(".hermes");
    fs::create_dir_all(&home).expect("home");

    // A brand-new secret is created owner-only (0600) and round-trips.
    let env_path = home.join(".env");
    write_hermes_secret_file(&env_path, "OPENROUTER_API_KEY=sk-1\n", ".env").expect("write env");
    assert_eq!(mode_of(&env_path), 0o600, "fresh .env must be 0600");
    assert_eq!(
        fs::read_to_string(&env_path).unwrap(),
        "OPENROUTER_API_KEY=sk-1\n"
    );
    let cfg_path = home.join("config.yaml");
    write_hermes_secret_file(&cfg_path, "model:\n  provider: openai-api\n", "config.yaml")
        .expect("write config.yaml");
    assert_eq!(mode_of(&cfg_path), 0o600, "fresh config.yaml must be 0600");

    // An existing file is written through IN PLACE: a managed group-readable
    // mode (0640) and the inode itself are preserved (so owner/group, ACL and
    // xattrs ride along), while the content updates.
    fs::set_permissions(&env_path, fs::Permissions::from_mode(0o640)).expect("loosen");
    let inode_before = fs::metadata(&env_path).unwrap().ino();
    write_hermes_secret_file(&env_path, "OPENROUTER_API_KEY=sk-2\n", ".env").expect("rewrite env");
    assert_eq!(
        mode_of(&env_path),
        0o640,
        "existing managed mode must be preserved"
    );
    assert_eq!(
        fs::metadata(&env_path).unwrap().ino(),
        inode_before,
        "existing file must be rewritten in place (same inode), not replaced"
    );
    assert_eq!(
        fs::read_to_string(&env_path).unwrap(),
        "OPENROUTER_API_KEY=sk-2\n"
    );
}

#[cfg(unix)]
#[test]
fn write_hermes_secret_file_writes_through_symlink() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let dir = tmp.path();
    // A dotfile/secret-manager layout: config.yaml is a symlink to the real
    // file. Saving must update the real target and keep the symlink intact.
    let real = dir.join("real-config.yaml");
    fs::write(&real, "model:\n  provider: openai-api\n").unwrap();
    let link = dir.join("config.yaml");
    std::os::unix::fs::symlink(&real, &link).unwrap();

    write_hermes_secret_file(&link, "model:\n  provider: anthropic\n", "config.yaml")
        .expect("write through symlink");
    assert!(
        fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink(),
        "the symlink must be preserved, not replaced by a regular file"
    );
    assert_eq!(
        fs::read_to_string(&real).unwrap(),
        "model:\n  provider: anthropic\n",
        "the symlink's real target must be updated"
    );
}

#[cfg(unix)]
#[test]
fn write_hermes_secret_file_secures_dangling_symlink_target() {
    use std::os::unix::fs::PermissionsExt;
    let tmp = tempfile::tempdir().expect("tempdir");
    let dir = tmp.path();
    // A managed layout: `.env` symlinks to a target that doesn't exist yet.
    let real = dir.join("vault-hermes.env");
    let link = dir.join(".env");
    std::os::unix::fs::symlink(&real, &link).unwrap();
    assert!(
        fs::metadata(&link).is_err(),
        "precondition: dangling symlink"
    );

    write_hermes_secret_file(&link, "OPENROUTER_API_KEY=sk\n", ".env").expect("write");
    // The target is created THROUGH the symlink and is owner-only (0600), not
    // the umask default (0644) — a fresh secret must never be world-readable.
    assert_eq!(
        fs::metadata(&real).unwrap().permissions().mode() & 0o777,
        0o600,
        "a freshly created symlink target must be 0600"
    );
    assert_eq!(
        fs::read_to_string(&real).unwrap(),
        "OPENROUTER_API_KEY=sk\n"
    );
    assert!(
        fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink(),
        "the symlink itself must be preserved"
    );
}

#[cfg(unix)]
#[test]
fn write_hermes_secret_file_tightens_world_readable_existing_secret() {
    use std::os::unix::fs::PermissionsExt;
    // The tightening is honored only where Hermes would chmod (not a
    // container/managed opt-out, e.g. a Docker CI runner with /.dockerenv).
    if hermes_skip_chmod() {
        return;
    }
    let mode_of = |p: &Path| fs::metadata(p).unwrap().permissions().mode() & 0o777;
    let tmp = tempfile::tempdir().expect("tempdir");
    let dir = tmp.path();

    // A secret left world-readable (0644) by an older build is repaired to
    // owner-only 0600 on the next save (0640 would still expose it to a broad
    // group like staff); content updates.
    let env_path = dir.join(".env");
    fs::write(&env_path, "OPENROUTER_API_KEY=old\n").unwrap();
    fs::set_permissions(&env_path, fs::Permissions::from_mode(0o644)).unwrap();
    write_hermes_secret_file(&env_path, "OPENROUTER_API_KEY=new\n", ".env").unwrap();
    assert_eq!(
        mode_of(&env_path),
        0o600,
        "a world-readable 0644 secret → 0600"
    );
    assert_eq!(
        fs::read_to_string(&env_path).unwrap(),
        "OPENROUTER_API_KEY=new\n"
    );

    // A deliberately group-shared managed mode (0640, no world bits) survives.
    let managed = dir.join("managed.env");
    fs::write(&managed, "K=1\n").unwrap();
    fs::set_permissions(&managed, fs::Permissions::from_mode(0o640)).unwrap();
    write_hermes_secret_file(&managed, "K=2\n", ".env").unwrap();
    assert_eq!(
        mode_of(&managed),
        0o640,
        "managed group-shared mode preserved"
    );
}

#[cfg(unix)]
#[test]
fn ensure_hermes_home_secure_respects_existing_and_managed_dirs() {
    use std::os::unix::fs::PermissionsExt;
    let mode_of = |p: &Path| fs::metadata(p).expect("metadata").permissions().mode() & 0o777;
    let tmp = tempfile::tempdir().expect("tempdir");

    // Fresh home → 0700 by default (HERMES_HOME_MODE cleared so the assertion
    // is deterministic regardless of the ambient env; skipped when this env
    // opts out of chmod, like a Docker CI runner).
    temp_env::with_var("HERMES_HOME_MODE", None::<&str>, || {
        let fresh = tmp.path().join("fresh-hermes");
        ensure_hermes_home_secure(&fresh).expect("ensure fresh");
        if !hermes_skip_chmod() {
            assert_eq!(mode_of(&fresh), 0o700, "fresh hermes home must be 0700");
        }
    });

    // HERMES_HOME_MODE overrides the default for a freshly-created home (e.g.
    // 0750 for a web server that traverses HERMES_HOME).
    temp_env::with_var("HERMES_HOME_MODE", Some("0750"), || {
        let fresh = tmp.path().join("fresh-hermes-moded");
        ensure_hermes_home_secure(&fresh).expect("ensure fresh moded");
        if !hermes_skip_chmod() {
            assert_eq!(mode_of(&fresh), 0o750, "HERMES_HOME_MODE must be honored");
        }
    });

    // A pre-existing, group-accessible home (managed/NixOS layout) is left
    // untouched — revoking shared access would break other Hermes processes.
    let managed = tmp.path().join("managed-hermes");
    fs::create_dir_all(&managed).unwrap();
    fs::set_permissions(&managed, fs::Permissions::from_mode(0o755)).unwrap();
    ensure_hermes_home_secure(&managed).expect("ensure managed");
    assert_eq!(
        mode_of(&managed),
        0o755,
        "existing hermes home mode preserved"
    );
}

// ── Hermes base-URL reconcile (auxiliary/main endpoint parity) ──────────

#[test]
fn plan_hermes_base_url_reconcile_mirrors_yaml_when_env_absent() {
    // openai-api with config.yaml model.base_url but no .env OPENAI_BASE_URL
    // → write the var so the auxiliary path matches the main loop.
    assert_eq!(
        plan_hermes_base_url_reconcile("openai-api", Some("https://sub2api/v1"), None),
        Some(("OPENAI_BASE_URL", "https://sub2api/v1".to_string()))
    );
}

#[test]
fn plan_hermes_base_url_reconcile_no_op_when_equal() {
    assert_eq!(
        plan_hermes_base_url_reconcile(
            "openai-api",
            Some("https://sub2api/v1"),
            Some("https://sub2api/v1"),
        ),
        None
    );
}

#[test]
fn plan_hermes_base_url_reconcile_ignores_trailing_slash() {
    // Trailing-slash-only differences must not churn .env (both directions).
    assert_eq!(
        plan_hermes_base_url_reconcile("openai-api", Some("https://x/v1/"), Some("https://x/v1")),
        None
    );
    assert_eq!(
        plan_hermes_base_url_reconcile("openai-api", Some("https://x/v1"), Some("https://x/v1/")),
        None
    );
}

#[test]
fn plan_hermes_base_url_reconcile_clears_stale_when_yaml_empty() {
    // config.yaml has no base_url but .env carries a stale override → clear it
    // (empty value) so it can't shadow the registry default in the aux path.
    assert_eq!(
        plan_hermes_base_url_reconcile("openai-api", None, Some("https://old/v1")),
        Some(("OPENAI_BASE_URL", String::new()))
    );
}

#[test]
fn plan_hermes_base_url_reconcile_no_op_when_both_empty() {
    // Absent var and explicitly-empty var both → no-op (no redundant `KEY=`).
    assert_eq!(
        plan_hermes_base_url_reconcile("openai-api", None, None),
        None
    );
    assert_eq!(
        plan_hermes_base_url_reconcile("openai-api", None, Some("")),
        None
    );
    assert_eq!(
        plan_hermes_base_url_reconcile("openai-api", Some("  "), Some("")),
        None
    );
}

#[test]
fn plan_hermes_base_url_reconcile_skips_unknown_provider() {
    for p in ["custom", "openai", "custom:my-proxy", "totally-unknown"] {
        assert_eq!(
            plan_hermes_base_url_reconcile(p, Some("https://x/v1"), None),
            None,
            "unknown provider {p} must be a no-op"
        );
    }
}

#[test]
fn plan_hermes_base_url_reconcile_skips_providers_without_base_url_var() {
    // OAuth / AWS / kimi-coding-cn carry no base-URL env var → never written,
    // even when config.yaml has a base_url.
    for p in ["nous", "bedrock", "kimi-coding-cn"] {
        assert_eq!(
            plan_hermes_base_url_reconcile(p, Some("https://x/v1"), None),
            None,
            "provider {p} has no base_url env var"
        );
    }
}

#[test]
fn plan_hermes_base_url_reconcile_openrouter_only_touches_its_own_var() {
    // openrouter never returns an OPENAI_BASE_URL write (that would re-pollute
    // the panel's neutralization); it only reconciles OPENROUTER_BASE_URL.
    assert_eq!(
        plan_hermes_base_url_reconcile("openrouter", None, None),
        None
    );
    assert_eq!(
        plan_hermes_base_url_reconcile("openrouter", Some("https://or/api/v1"), None),
        Some(("OPENROUTER_BASE_URL", "https://or/api/v1".to_string()))
    );
}

#[test]
fn plan_hermes_base_url_reconcile_covers_non_needs_base_url_providers() {
    // The aux/main asymmetry is not limited to openai-api — a proxied anthropic
    // (base_url in YAML, not in .env) has the same divergence.
    assert_eq!(
        plan_hermes_base_url_reconcile("anthropic", Some("https://proxy/anthropic"), None),
        Some(("ANTHROPIC_BASE_URL", "https://proxy/anthropic".to_string()))
    );
}

#[test]
fn plan_hermes_base_url_reconcile_writes_verbatim_not_normalized() {
    // When a write IS needed, the trailing slash is preserved in the value
    // (only the comparison normalizes it).
    assert_eq!(
        plan_hermes_base_url_reconcile(
            "openai-api",
            Some("https://x/v1/"),
            Some("https://x/other"),
        ),
        Some(("OPENAI_BASE_URL", "https://x/v1/".to_string()))
    );
}

#[test]
fn plan_hermes_base_url_reconcile_rejects_embedded_newline() {
    // A base_url carrying a newline must never be mirrored — it would inject an
    // extra `.env` line (another provider's var) through patch_env_text.
    assert_eq!(
        plan_hermes_base_url_reconcile(
            "openai-api",
            Some("https://x/v1\nOPENROUTER_BASE_URL=https://evil"),
            None,
        ),
        None
    );
    assert_eq!(
        plan_hermes_base_url_reconcile(
            "openai-api",
            Some("https://x/v1\rFOO=bar"),
            Some("https://x/v1"),
        ),
        None
    );
}

#[test]
fn reconcile_writes_env_and_is_idempotent() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let home = tmp.path();
    fs::write(
        home.join("config.yaml"),
        "model:\n  provider: openai-api\n  default: gpt-5.5\n  base_url: https://sub2api/v1\n",
    )
    .unwrap();
    fs::write(home.join(".env"), "OPENAI_API_KEY=sk-secret\n").unwrap();

    reconcile_hermes_runtime_env_in(home).expect("reconcile");
    let env = fs::read_to_string(home.join(".env")).unwrap();
    assert!(
        env.contains("OPENAI_BASE_URL=https://sub2api/v1"),
        "base url mirrored: {env:?}"
    );
    assert!(
        env.contains("OPENAI_API_KEY=sk-secret"),
        "existing key preserved: {env:?}"
    );

    // Second run is a pure no-op: content AND mtime unchanged (the planner
    // returns None, so .env is never reopened for writing).
    let mtime1 = fs::metadata(home.join(".env")).unwrap().modified().unwrap();
    reconcile_hermes_runtime_env_in(home).expect("reconcile again");
    assert_eq!(
        fs::read_to_string(home.join(".env")).unwrap(),
        env,
        "idempotent content"
    );
    assert_eq!(
        fs::metadata(home.join(".env")).unwrap().modified().unwrap(),
        mtime1,
        "idempotent run must not rewrite .env"
    );
}

#[test]
fn reconcile_no_op_without_config_yaml() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let home = tmp.path();
    fs::write(home.join(".env"), "OPENAI_API_KEY=sk\n").unwrap();
    reconcile_hermes_runtime_env_in(home).expect("reconcile");
    assert_eq!(
        fs::read_to_string(home.join(".env")).unwrap(),
        "OPENAI_API_KEY=sk\n",
        ".env must be byte-identical when there is no config.yaml"
    );
}

#[test]
fn reconcile_preserves_openrouter_neutralization() {
    // openrouter with no model.base_url + the panel's empty OPENAI_* masks must
    // survive untouched (reconcile only ever considers OPENROUTER_BASE_URL).
    let tmp = tempfile::tempdir().expect("tempdir");
    let home = tmp.path();
    fs::write(
        home.join("config.yaml"),
        "model:\n  provider: openrouter\n  default: x\n",
    )
    .unwrap();
    let env = "OPENROUTER_API_KEY=sk-or\nOPENAI_API_KEY=\nOPENAI_BASE_URL=\n";
    fs::write(home.join(".env"), env).unwrap();
    reconcile_hermes_runtime_env_in(home).expect("reconcile");
    assert_eq!(
        fs::read_to_string(home.join(".env")).unwrap(),
        env,
        "neutralization preserved"
    );
}

#[test]
fn reconcile_clears_stale_base_url_on_disk() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let home = tmp.path();
    // openai-api with no base_url in config.yaml, but a stale OPENAI_BASE_URL.
    fs::write(
        home.join("config.yaml"),
        "model:\n  provider: openai-api\n  default: gpt-5.5\n",
    )
    .unwrap();
    fs::write(
        home.join(".env"),
        "OPENAI_API_KEY=sk\nOPENAI_BASE_URL=https://old/v1\n",
    )
    .unwrap();
    reconcile_hermes_runtime_env_in(home).expect("reconcile");
    let env = fs::read_to_string(home.join(".env")).unwrap();
    assert!(
        env.contains("OPENAI_BASE_URL=\n"),
        "stale base url cleared: {env:?}"
    );
    assert!(env.contains("OPENAI_API_KEY=sk"), "key preserved: {env:?}");
}

#[test]
fn reconcile_skips_unreadable_env_without_clobbering() {
    // An existing-but-unreadable `.env` (invalid UTF-8) must abort the
    // reconcile, not be rewritten from an empty baseline — otherwise the
    // user's API keys/comments would be dropped on launch.
    let tmp = tempfile::tempdir().expect("tempdir");
    let home = tmp.path();
    fs::write(
        home.join("config.yaml"),
        "model:\n  provider: openai-api\n  base_url: https://sub2api/v1\n",
    )
    .unwrap();
    let raw: &[u8] = b"\xff\xfeOPENAI_API_KEY=sk-secret\n";
    fs::write(home.join(".env"), raw).unwrap();
    assert!(
        reconcile_hermes_runtime_env_in(home).is_err(),
        "an unreadable .env must surface an error, not silently patch from empty"
    );
    assert_eq!(
        fs::read(home.join(".env")).unwrap(),
        raw.to_vec(),
        "an unreadable .env must be left byte-identical, never clobbered"
    );
}

#[test]
fn hermes_home_for_launch_matches_hermes_resolution() {
    // A non-empty override is used VERBATIM — Hermes' get_hermes_home does
    // `Path(val.strip())` with no `~` expansion, so reconcile must not expand
    // either (both an absolute path and a literal `~/…` path are passed as-is).
    let mut abs = BTreeMap::new();
    abs.insert("HERMES_HOME".to_string(), "/tmp/hermes-alt".to_string());
    assert_eq!(
        hermes_home_for_launch(&abs),
        PathBuf::from("/tmp/hermes-alt")
    );

    let mut tilde = BTreeMap::new();
    tilde.insert("HERMES_HOME".to_string(), "~/alt-hermes".to_string());
    assert_eq!(
        hermes_home_for_launch(&tilde),
        PathBuf::from("~/alt-hermes")
    );

    // A blank override REPLACES the parent value in the child, and Hermes then
    // falls back to the default `~/.hermes` — not the parent's HERMES_HOME.
    let mut blank = BTreeMap::new();
    blank.insert("HERMES_HOME".to_string(), "  ".to_string());
    assert_eq!(
        hermes_home_for_launch(&blank),
        home_dir_or_default().join(".hermes")
    );

    // No override → the child inherits the parent env (codeg's resolution).
    assert_eq!(hermes_home_for_launch(&BTreeMap::new()), hermes_home_dir());
}

#[test]
fn reconcile_wrapper_targets_runtime_env_home() {
    // End-to-end: the wrapper must patch the `.env` under the launch env's
    // HERMES_HOME, not the parent/default home.
    let tmp = tempfile::tempdir().expect("tempdir");
    let home = tmp.path();
    fs::write(
        home.join("config.yaml"),
        "model:\n  provider: openai-api\n  base_url: https://sub2api/v1\n",
    )
    .unwrap();
    fs::write(home.join(".env"), "OPENAI_API_KEY=sk\n").unwrap();
    let mut runtime_env = BTreeMap::new();
    runtime_env.insert("HERMES_HOME".to_string(), home.display().to_string());

    reconcile_hermes_runtime_env(&runtime_env);
    let env = fs::read_to_string(home.join(".env")).unwrap();
    assert!(
        env.contains("OPENAI_BASE_URL=https://sub2api/v1"),
        "wrapper reconciled the runtime_env HERMES_HOME: {env:?}"
    );
    assert!(env.contains("OPENAI_API_KEY=sk"), "key preserved: {env:?}");
}

#[cfg(unix)]
#[test]
fn reconcile_writes_through_symlinked_env() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let home = tmp.path();
    fs::write(
        home.join("config.yaml"),
        "model:\n  provider: openai-api\n  base_url: https://sub2api/v1\n",
    )
    .unwrap();
    // .env is a symlink to a real target (dotfile-manager layout).
    let real = home.join("vault.env");
    fs::write(&real, "OPENAI_API_KEY=sk\n").unwrap();
    std::os::unix::fs::symlink(&real, home.join(".env")).unwrap();

    reconcile_hermes_runtime_env_in(home).expect("reconcile");
    assert!(
        fs::symlink_metadata(home.join(".env"))
            .unwrap()
            .file_type()
            .is_symlink(),
        "symlink preserved"
    );
    let env = fs::read_to_string(&real).unwrap();
    assert!(
        env.contains("OPENAI_BASE_URL=https://sub2api/v1"),
        "target updated: {env:?}"
    );
    assert!(env.contains("OPENAI_API_KEY=sk"), "key preserved: {env:?}");
}

#[cfg(unix)]
#[test]
fn hermes_skip_chmod_requires_a_non_empty_opt_out() {
    // A non-empty opt-out enables skip.
    temp_env::with_vars(
        [("HERMES_SKIP_CHMOD", Some("1")), ("HERMES_CONTAINER", None)],
        || assert!(hermes_skip_chmod(), "non-empty HERMES_SKIP_CHMOD skips"),
    );
    // An EMPTY opt-out must NOT skip (Hermes' Python truthiness treats `` as
    // falsy) — but only assert that on a host that isn't itself a container.
    let host_is_container = temp_env::with_vars(
        [
            ("HERMES_SKIP_CHMOD", None::<&str>),
            ("HERMES_CONTAINER", None),
        ],
        hermes_skip_chmod,
    );
    if !host_is_container {
        temp_env::with_vars(
            [
                ("HERMES_SKIP_CHMOD", Some("")),
                ("HERMES_CONTAINER", Some("")),
            ],
            || assert!(!hermes_skip_chmod(), "an empty opt-out must not skip"),
        );
    }
}

#[cfg(unix)]
#[test]
fn parse_hermes_home_mode_handles_octal_and_defaults() {
    assert_eq!(parse_hermes_home_mode(None), 0o700);
    assert_eq!(parse_hermes_home_mode(Some("")), 0o700);
    assert_eq!(parse_hermes_home_mode(Some("0701")), 0o701);
    assert_eq!(parse_hermes_home_mode(Some(" 750 ")), 0o750);
    assert_eq!(parse_hermes_home_mode(Some("0o700")), 0o700);
    assert_eq!(parse_hermes_home_mode(Some("nonsense")), 0o700);
}

#[test]
fn hermes_provider_maps_key_var_and_base_url_flag() {
    let openrouter = hermes_provider("openrouter").expect("openrouter");
    assert_eq!(openrouter.key_env_var, "OPENROUTER_API_KEY");
    assert!(!openrouter.needs_base_url);
    // `openai-api` is the OpenAI-compatible path: OPENAI_API_KEY + a
    // user-supplied base URL.
    let openai_api = hermes_provider("openai-api").expect("openai-api");
    assert_eq!(openai_api.key_env_var, "OPENAI_API_KEY");
    assert!(openai_api.needs_base_url);
    // Hermes' first-priority key var per provider (auth.py PROVIDER_REGISTRY).
    assert_eq!(
        hermes_provider("zai").expect("zai").key_env_var,
        "GLM_API_KEY"
    );
    assert_eq!(
        hermes_provider("kimi-coding")
            .expect("kimi-coding")
            .key_env_var,
        "KIMI_API_KEY"
    );
    // OAuth + AWS providers carry no API-key env var (set via terminal --setup
    // or the AWS SDK chain).
    assert_eq!(hermes_provider("nous").expect("nous").key_env_var, "");
    assert_eq!(hermes_provider("bedrock").expect("bedrock").key_env_var, "");
    // `custom` IS in the table — the OpenAI-compatible BYO endpoint. It has
    // no `.env` key/base-url var (both ride inline in config.yaml), but is
    // flagged user-editable so the API URL field renders.
    let custom = hermes_provider("custom").expect("custom");
    assert_eq!(custom.key_env_var, "");
    assert_eq!(custom.base_url_env_var, "");
    assert!(custom.needs_base_url);
    assert!(hermes_inlines_api_key("custom"));
    assert!(!hermes_inlines_api_key("openai-api"));
    // The legacy bare `openai` alias (which Hermes routes to OpenRouter) is
    // intentionally not in the table.
    assert!(hermes_provider("openai").is_none());
    assert!(hermes_provider("does-not-exist").is_none());
}

#[test]
fn hermes_provider_key_env_vars_match_authoritative_registry() {
    // The full id → first api-key env var mapping from Hermes' own
    // `hermes_cli/auth.py` PROVIDER_REGISTRY (empty for OAuth/AWS providers).
    // Locks the table down so a wrong mapping (e.g. zai → ZAI_API_KEY instead
    // of GLM_API_KEY) fails CI rather than silently sending the wrong key var.
    let expected: &[(&str, &str)] = &[
        ("openrouter", "OPENROUTER_API_KEY"),
        ("openai-api", "OPENAI_API_KEY"),
        ("anthropic", "ANTHROPIC_API_KEY"),
        ("gemini", "GOOGLE_API_KEY"),
        ("deepseek", "DEEPSEEK_API_KEY"),
        ("xai", "XAI_API_KEY"),
        ("zai", "GLM_API_KEY"),
        ("minimax", "MINIMAX_API_KEY"),
        ("minimax-cn", "MINIMAX_CN_API_KEY"),
        ("kimi-coding", "KIMI_API_KEY"),
        ("kimi-coding-cn", "KIMI_CN_API_KEY"),
        ("nvidia", "NVIDIA_API_KEY"),
        ("alibaba", "DASHSCOPE_API_KEY"),
        ("alibaba-coding-plan", "ALIBABA_CODING_PLAN_API_KEY"),
        ("copilot", "COPILOT_GITHUB_TOKEN"),
        ("lmstudio", "LM_API_KEY"),
        ("azure-foundry", "AZURE_FOUNDRY_API_KEY"),
        ("stepfun", "STEPFUN_API_KEY"),
        ("arcee", "ARCEEAI_API_KEY"),
        ("gmi", "GMI_API_KEY"),
        ("huggingface", "HF_TOKEN"),
        ("kilocode", "KILOCODE_API_KEY"),
        ("opencode-zen", "OPENCODE_ZEN_API_KEY"),
        ("opencode-go", "OPENCODE_GO_API_KEY"),
        ("xiaomi", "XIAOMI_API_KEY"),
        ("tencent-tokenhub", "TOKENHUB_API_KEY"),
        ("ollama-cloud", "OLLAMA_API_KEY"),
        ("novita", "NOVITA_API_KEY"),
        ("ai-gateway", "AI_GATEWAY_API_KEY"),
        // BYO OpenAI-compatible endpoint — key rides inline in config.yaml,
        // so it has no `.env` key var.
        ("custom", ""),
        ("nous", ""),
        ("openai-codex", ""),
        ("minimax-oauth", ""),
        ("xai-oauth", ""),
        ("qwen-oauth", ""),
        ("google-gemini-cli", ""),
        ("copilot-acp", ""),
        ("bedrock", ""),
        // Vertex AI authenticates via Google service-account/ADC OAuth2 —
        // no key var, no base-URL var (endpoint computed per request).
        ("vertex", ""),
    ];
    assert_eq!(
        expected.len(),
        HERMES_PROVIDERS.len(),
        "expected list must cover every table entry"
    );
    for (id, key) in expected {
        let p = hermes_provider(id).unwrap_or_else(|| panic!("missing provider {id}"));
        assert_eq!(p.key_env_var, *key, "{id} key_env_var");
    }
    // No table entry is left unverified.
    for p in HERMES_PROVIDERS {
        assert!(
            expected.iter().any(|(id, _)| *id == p.id),
            "untested provider {}",
            p.id
        );
    }
    // The base-URL env var for the three user-supplied-endpoint providers.
    assert_eq!(
        hermes_provider("openai-api").unwrap().base_url_env_var,
        "OPENAI_BASE_URL"
    );
    assert_eq!(
        hermes_provider("lmstudio").unwrap().base_url_env_var,
        "LM_BASE_URL"
    );
    assert_eq!(
        hermes_provider("azure-foundry").unwrap().base_url_env_var,
        "AZURE_FOUNDRY_BASE_URL"
    );
}

#[test]
fn plan_hermes_write_structured_maps_key_and_config() {
    let (yaml, env) =
        plan_hermes_write("anthropic", Some("sk-ant-1"), "kimi", None, None, None).expect("plan");
    assert_eq!(env, vec![("ANTHROPIC_API_KEY", "sk-ant-1".to_string())]);
    let value: serde_yaml::Value = serde_yaml::from_str(&yaml).expect("yaml");
    assert_eq!(
        value
            .get("model")
            .and_then(|m| m.get("provider"))
            .and_then(|v| v.as_str()),
        Some("anthropic")
    );
}

#[test]
fn plan_hermes_write_custom_inlines_key_and_base_url_never_touching_env() {
    let (yaml, env) = plan_hermes_write(
        "custom",
        Some("sk-custom-1"),
        "gpt-5.5",
        Some("https://endpoint.test/v1"),
        None,
        None,
    )
    .expect("plan custom");
    // custom NEVER writes `.env` — key + endpoint live inline in config.yaml.
    assert!(env.is_empty(), "custom must not write any .env var");
    let value: serde_yaml::Value = serde_yaml::from_str(&yaml).expect("yaml");
    let model = value.get("model").expect("model section");
    assert_eq!(
        model.get("provider").and_then(|v| v.as_str()),
        Some("custom")
    );
    assert_eq!(
        model.get("default").and_then(|v| v.as_str()),
        Some("gpt-5.5")
    );
    assert_eq!(
        model.get("api_key").and_then(|v| v.as_str()),
        Some("sk-custom-1")
    );
    assert_eq!(
        model.get("base_url").and_then(|v| v.as_str()),
        Some("https://endpoint.test/v1")
    );
    // A newline in the inline key is rejected (same guard as the `.env` path).
    assert!(plan_hermes_write(
        "custom",
        Some("sk\nbad"),
        "m",
        Some("https://x/v1"),
        None,
        None
    )
    .is_err());

    // Switching TO custom from another provider that carried an `api_mode`
    // scrubs the stale mode (it must not bleed into the custom endpoint).
    let prior = "model:\n  provider: openai-api\n  default: gpt\n  api_mode: chat_completions\n";
    let (yaml, _env) = plan_hermes_write(
        "custom",
        Some("sk-2"),
        "gpt-5.5",
        Some("https://e/v1"),
        None,
        Some(prior),
    )
    .expect("plan switch-in");
    let value: serde_yaml::Value = serde_yaml::from_str(&yaml).expect("yaml");
    assert!(
        value.get("model").and_then(|m| m.get("api_mode")).is_none(),
        "stale api_mode must be scrubbed when switching to custom"
    );
}

#[test]
fn plan_hermes_write_raw_mode_never_touches_env() {
    // Even if a caller sends an apiKey alongside rawConfigYaml, the .env must
    // not be updated (server-side contract, not payload-dependent).
    let (yaml, env) = plan_hermes_write(
        "openrouter",
        Some("sk-or-should-be-ignored"),
        "kimi",
        None,
        Some("model:\n  provider: anthropic\n"),
        None,
    )
    .expect("plan");
    assert!(env.is_empty(), "raw mode must not write .env");
    assert!(
        yaml.contains("anthropic"),
        "raw yaml written verbatim: {yaml}"
    );
}

#[test]
fn plan_hermes_write_oauth_and_blank_key_produce_no_env() {
    // OAuth provider (empty key var) → no .env update.
    let (_, env) =
        plan_hermes_write("nous", Some("ignored"), "m", None, None, None).expect("oauth");
    assert!(env.is_empty());
    // Blank key on a keyed provider with no base-URL var → nothing touched.
    let (_, env) =
        plan_hermes_write("anthropic", Some("   "), "m", None, None, None).expect("blank");
    assert!(env.is_empty());
    let (_, env) = plan_hermes_write("anthropic", None, "m", None, None, None).expect("none");
    assert!(env.is_empty());
}

#[test]
fn plan_hermes_write_rejects_newline_key_and_invalid_yaml() {
    assert!(
        plan_hermes_write("openai-api", Some("a\nb"), "m", None, None, None).is_err(),
        "newline in key must be rejected"
    );
    assert!(
        plan_hermes_write(
            "openai-api",
            None,
            "m",
            None,
            Some("model: [unterminated"),
            None
        )
        .is_err(),
        "invalid raw yaml must be rejected"
    );
}

#[test]
fn plan_hermes_write_openai_api_provider_writes_base_url() {
    let (yaml, env) = plan_hermes_write(
        "openai-api",
        Some("sk-x"),
        "m",
        Some("https://api.test/v1"),
        None,
        None,
    )
    .expect("plan");
    // The endpoint is written to BOTH the key var's sibling base-URL var and
    // config.yaml model.base_url, so the two agree under either resolution path.
    assert_eq!(
        env,
        vec![
            ("OPENAI_API_KEY", "sk-x".to_string()),
            ("OPENAI_BASE_URL", "https://api.test/v1".to_string()),
        ]
    );
    let value: serde_yaml::Value = serde_yaml::from_str(&yaml).expect("yaml");
    assert_eq!(
        value
            .get("model")
            .and_then(|m| m.get("base_url"))
            .and_then(|v| v.as_str()),
        Some("https://api.test/v1")
    );
    // Clearing the base URL writes an empty override so a stale `.env` value
    // can't shadow the default endpoint.
    let (_, env) =
        plan_hermes_write("openai-api", None, "m", None, None, None).expect("clear base");
    assert_eq!(env, vec![("OPENAI_BASE_URL", String::new())]);
}

#[test]
fn plan_hermes_write_structured_rejects_unknown_provider() {
    // Legacy/unknown ids can't be mapped to a credential layout → reject in
    // structured mode so we never write a provider with no credential.
    // (`custom` IS handled now — see `plan_hermes_write_custom_*`.)
    assert!(plan_hermes_write("openai", Some("k"), "m", None, None, None).is_err());
    assert!(plan_hermes_write("totally-made-up", None, "m", None, None, None).is_err());
    // Raw mode stays the escape hatch: any provider id is accepted verbatim.
    let (yaml, env) = plan_hermes_write(
        "custom:my-proxy",
        None,
        "m",
        None,
        Some("model:\n  provider: custom:my-proxy\n"),
        None,
    )
    .expect("raw mode accepts any provider");
    assert!(env.is_empty());
    assert!(yaml.contains("custom:my-proxy"));
}

#[test]
fn project_hermes_key_and_base_falls_back_to_env_base_url() {
    let mut env = BTreeMap::new();
    env.insert("OPENAI_API_KEY".to_string(), "sk-1".to_string());
    env.insert(
        "OPENAI_BASE_URL".to_string(),
        "https://proxy/v1".to_string(),
    );
    // No YAML base_url → the panel still sees the endpoint from `.env`, so a
    // later save won't clear it (regression guard for the dual-write change).
    let (key, base) = project_hermes_key_and_base("openai-api", &env, None, None);
    assert_eq!(key, Some("sk-1".to_string()));
    assert_eq!(base, Some("https://proxy/v1".to_string()));
    // YAML base_url wins over the env fallback.
    let (_, base) = project_hermes_key_and_base("openai-api", &env, Some("https://yaml/v1"), None);
    assert_eq!(base, Some("https://yaml/v1".to_string()));
    // A keyed provider with no base-URL var and no YAML base → no base URL.
    let mut env2 = BTreeMap::new();
    env2.insert("ANTHROPIC_API_KEY".to_string(), "sk-a".to_string());
    let (key, base) = project_hermes_key_and_base("anthropic", &env2, None, None);
    assert_eq!(key, Some("sk-a".to_string()));
    assert_eq!(base, None);
    // `custom` reads its key from config.yaml `model.api_key`, NOT `.env`.
    let (key, base) = project_hermes_key_and_base(
        "custom",
        &env,
        Some("https://endpoint/v1"),
        Some("sk-inline"),
    );
    assert_eq!(key, Some("sk-inline".to_string()));
    assert_eq!(base, Some("https://endpoint/v1".to_string()));
    // Unknown provider → nothing projected from `.env`.
    let (key, base) = project_hermes_key_and_base("custom:x", &env, None, None);
    assert_eq!(key, None);
    assert_eq!(base, None);
}

#[test]
fn uvx_python_args_pins_interpreter_or_is_empty() {
    assert_eq!(
        uvx_python_args(Some("3.13")),
        vec!["--python".to_string(), "3.13".to_string()]
    );
    assert!(uvx_python_args(None).is_empty());
}

#[test]
fn shell_quote_arg_leaves_spacefree_windows_paths_unquoted() {
    // A backslash path with no spaces must NOT be quoted on Windows. A
    // leading double-quoted string makes PowerShell parse the line as a
    // string expression and fail with "Unexpected token" instead of running
    // uvx; an unquoted bare path runs in both cmd and PowerShell.
    let path = r"C:\Users\Administrator\AppData\Local\app.codeg\acp-binaries\uv-tool\windows-x86_64\uvx.exe";
    assert_eq!(shell_quote_arg_for(path, true), path);
    // On POSIX the backslash is the escape char, so it still forces quoting.
    assert_eq!(shell_quote_arg_for(path, false), format!("'{path}'"));
}

#[test]
fn shell_quote_arg_still_quotes_when_required() {
    // Spaces force quoting on both platforms (this case is the known
    // PowerShell-incompatible residual: a quoted leading path needs `&`).
    assert_eq!(
        shell_quote_arg_for(r"C:\Program Files\uv-tool\uvx.exe", true),
        "\"C:\\Program Files\\uv-tool\\uvx.exe\""
    );
    // The pinned package's brackets and comma must stay quoted so PowerShell
    // does not split `[acp,mcp]` into an array argument.
    let pkg = "hermes-agent[acp,mcp]==0.19.0";
    assert_eq!(shell_quote_arg_for(pkg, true), format!("\"{pkg}\""));
    assert_eq!(shell_quote_arg_for(pkg, false), format!("'{pkg}'"));
    // Plain flag/value tokens are never quoted on either platform.
    for windows in [true, false] {
        assert_eq!(shell_quote_arg_for("--python", windows), "--python");
        assert_eq!(shell_quote_arg_for("3.13", windows), "3.13");
        assert_eq!(shell_quote_arg_for("hermes-acp", windows), "hermes-acp");
    }
}

#[tokio::test]
async fn hermes_setup_argvs_address_the_hermes_bin() {
    // Every recipe form must drive the wrapper's `hermes` bin (the ACP
    // CLI): `<hermes> acp --setup` / `<hermes> model` when a binary
    // resolves, else `npx -y --package <pin> hermes …`. The `--package`
    // flag is load-bearing in the npx form — the package's DEFAULT bin is
    // `hermes-agent` (`run_agent:main`), not the `hermes` CLI — and the
    // pinned spec keeps the on-demand bootstrap on the audited version.
    let (setup, model) = hermes_setup_argvs().await;
    assert_eq!(setup.last().map(String::as_str), Some("--setup"));
    assert_eq!(model.last().map(String::as_str), Some("model"));
    for argv in [&setup, &model] {
        if argv.first().map(String::as_str) == Some("npx") {
            let pkg_idx = argv
                .iter()
                .position(|a| a == "--package")
                .expect("npx recipe must pin via --package");
            assert_eq!(
                argv.get(pkg_idx + 1).map(String::as_str),
                Some("hermes-agent@0.21.1")
            );
            assert_eq!(argv.get(pkg_idx + 2).map(String::as_str), Some("hermes"));
        } else {
            // Resolved-binary form: bare `hermes` from PATH or an absolute
            // npm-prefix path ending in the hermes bin.
            let first = argv.first().expect("non-empty argv");
            assert!(
                first == "hermes"
                    || std::path::Path::new(first)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .is_some_and(
                            |n| n.trim_end_matches(".cmd").trim_end_matches(".exe") == "hermes"
                        ),
                "unexpected launcher: {argv:?}"
            );
        }
    }
}

#[test]
fn kimi_parse_provider_model_uses_kimi_model_name() {
    let out = parse_provider_model(AgentType::KimiCode, Some("kimi-for-coding"));
    assert_eq!(
        out.get("KIMI_MODEL_NAME"),
        Some(&Some("kimi-for-coding".to_string()))
    );
    assert!(!out.contains_key("OPENAI_MODEL"));
}

#[test]
fn kimi_managed_block_writes_provider_model_and_default() {
    let spec = KimiManagedSpec {
        interface_type: "anthropic".to_string(),
        base_url: Some("https://api.anthropic.com".to_string()),
        api_key: Some("sk-ant".to_string()),
        env: BTreeMap::new(),
        model: "claude-opus-4-7".to_string(),
        max_context_size: Some(200_000),
        capabilities: Vec::new(),
        support_efforts: Vec::new(),
        default_effort: None,
    };
    let mut doc = toml::Value::Table(toml::map::Map::new());
    // Pre-existing user content that must survive a managed-block write.
    doc.as_table_mut()
        .unwrap()
        .insert("telemetry".to_string(), toml::Value::Boolean(true));
    apply_kimi_managed_block(&mut doc, Some(&spec)).expect("write managed block");
    // Round-trip through the serializer the real writer uses.
    let serialized = toml::to_string_pretty(&doc).expect("serialize");
    let reparsed: toml::Value = serialized.parse().expect("valid toml");
    let t = reparsed.as_table().unwrap();
    assert_eq!(
        t.get("telemetry").and_then(toml::Value::as_bool),
        Some(true)
    );
    assert_eq!(
        t.get("default_model").and_then(toml::Value::as_str),
        Some(KIMI_MANAGED_MODEL_ALIAS)
    );
    let provider = t
        .get("providers")
        .and_then(|p| p.get(KIMI_MANAGED_PROVIDER))
        .and_then(toml::Value::as_table)
        .expect("managed provider present");
    assert_eq!(
        provider.get("type").and_then(toml::Value::as_str),
        Some("anthropic")
    );
    assert_eq!(
        provider.get("api_key").and_then(toml::Value::as_str),
        Some("sk-ant")
    );
    let model = t
        .get("models")
        .and_then(|m| m.get(KIMI_MANAGED_MODEL_ALIAS))
        .and_then(toml::Value::as_table)
        .expect("managed model present");
    assert_eq!(
        model.get("provider").and_then(toml::Value::as_str),
        Some(KIMI_MANAGED_PROVIDER)
    );
    assert_eq!(
        model.get("model").and_then(toml::Value::as_str),
        Some("claude-opus-4-7")
    );
    assert_eq!(
        model
            .get("max_context_size")
            .and_then(toml::Value::as_integer),
        Some(200_000)
    );
}

#[test]
fn kimi_managed_block_always_writes_positive_max_context_size() {
    // Regression: kimi's schema requires `max_context_size` to be a positive
    // integer and silently discards the whole `[models.*]` block when it is
    // missing — leaving `default_model` dangling so every prompt ends with no
    // reply. A blank field MUST therefore still serialize a positive default.
    for ctx in [None, Some(0), Some(-5)] {
        let spec = KimiManagedSpec {
            interface_type: "kimi".to_string(),
            base_url: Some("https://api.moonshot.cn/v1".to_string()),
            api_key: Some("sk-test".to_string()),
            env: BTreeMap::new(),
            model: "kimi-k2.7-code".to_string(),
            max_context_size: ctx,
            capabilities: Vec::new(),
            support_efforts: Vec::new(),
            default_effort: None,
        };
        let mut doc = toml::Value::Table(toml::map::Map::new());
        apply_kimi_managed_block(&mut doc, Some(&spec)).expect("write managed block");
        let serialized = toml::to_string_pretty(&doc).expect("serialize");
        let reparsed: toml::Value = serialized.parse().expect("valid toml");
        let written = reparsed
            .get("models")
            .and_then(|m| m.get(KIMI_MANAGED_MODEL_ALIAS))
            .and_then(|m| m.get("max_context_size"))
            .and_then(toml::Value::as_integer)
            .expect("max_context_size present for ctx input");
        assert!(
            written > 0,
            "expected a positive max_context_size for input {ctx:?}, got {written}"
        );
        assert_eq!(written, KIMI_DEFAULT_MAX_CONTEXT_SIZE);
    }
}

#[test]
fn kimi_managed_block_clear_preserves_user_sections() {
    let mut doc: toml::Value = r#"
default_model = "mine"
[providers.codeg]
type = "openai"
api_key = "sk"
[providers.mine]
type = "openai"
api_key = "sk-user"
[models.codeg-managed]
provider = "codeg"
model = "x"
[models.mine]
provider = "mine"
model = "gpt"
"#
    .parse()
    .expect("valid toml");
    apply_kimi_managed_block(&mut doc, None).expect("clear managed block");
    let t = doc.as_table().unwrap();
    // A user-owned default_model (not our alias) survives untouched.
    assert_eq!(
        t.get("default_model").and_then(toml::Value::as_str),
        Some("mine")
    );
    let providers = t.get("providers").and_then(toml::Value::as_table).unwrap();
    assert!(!providers.contains_key(KIMI_MANAGED_PROVIDER));
    assert!(providers.contains_key("mine"));
    let models = t.get("models").and_then(toml::Value::as_table).unwrap();
    assert!(!models.contains_key(KIMI_MANAGED_MODEL_ALIAS));
    assert!(models.contains_key("mine"));
}

#[test]
fn kimi_managed_block_clear_resets_our_default_and_empties() {
    let mut doc: toml::Value = r#"
default_model = "codeg-managed"
[providers.codeg]
type = "kimi"
[models.codeg-managed]
provider = "codeg"
model = "kimi-for-coding"
"#
    .parse()
    .expect("valid toml");
    apply_kimi_managed_block(&mut doc, None).expect("clear");
    let t = doc.as_table().unwrap();
    assert!(t.get("default_model").is_none());
    // Emptied tables are dropped entirely.
    assert!(t.get("providers").is_none());
    assert!(t.get("models").is_none());
}

#[test]
fn kimi_build_spec_env_auth_writes_provider_key_var() {
    let update = KimiCodeConfigUpdate {
        mode: "apikey".to_string(),
        interface_type: Some("openai".to_string()),
        auth_type: Some("env".to_string()),
        base_url: Some("https://api.deepseek.com/v1".to_string()),
        api_key: Some("sk-deep".to_string()),
        model: Some("deepseek-chat".to_string()),
        max_context_size: None,
        vertex_project: None,
        vertex_location: None,
        raw_config_toml: None,
        reasoning_enabled: None,
        always_thinking: None,
        support_efforts: None,
        default_effort: None,
    };
    let spec = build_kimi_managed_spec(&update).expect("valid spec");
    // env auth → key lands in the provider env sub-table, NOT the inline field.
    assert!(spec.api_key.is_none());
    assert_eq!(spec.env.get("OPENAI_API_KEY"), Some(&"sk-deep".to_string()));
}

#[test]
fn kimi_build_spec_vertex_uses_adc_not_api_key() {
    let update = KimiCodeConfigUpdate {
        mode: "apikey".to_string(),
        interface_type: Some("vertexai".to_string()),
        auth_type: None,
        base_url: None,
        api_key: Some("ignored".to_string()),
        model: Some("gemini-2.5-pro".to_string()),
        max_context_size: None,
        vertex_project: Some("my-proj".to_string()),
        vertex_location: Some("us-central1".to_string()),
        raw_config_toml: None,
        reasoning_enabled: None,
        always_thinking: None,
        support_efforts: None,
        default_effort: None,
    };
    let spec = build_kimi_managed_spec(&update).expect("valid vertex spec");
    assert!(spec.api_key.is_none());
    assert_eq!(
        spec.env.get("GOOGLE_CLOUD_PROJECT"),
        Some(&"my-proj".to_string())
    );
    assert_eq!(
        spec.env.get("GOOGLE_CLOUD_LOCATION"),
        Some(&"us-central1".to_string())
    );
}

#[test]
fn kimi_build_spec_rejects_unknown_type_and_missing_model() {
    let base = KimiCodeConfigUpdate {
        mode: "apikey".to_string(),
        interface_type: Some("nope".to_string()),
        auth_type: None,
        base_url: None,
        api_key: None,
        model: Some("m".to_string()),
        max_context_size: None,
        vertex_project: None,
        vertex_location: None,
        raw_config_toml: None,
        reasoning_enabled: None,
        always_thinking: None,
        support_efforts: None,
        default_effort: None,
    };
    assert!(build_kimi_managed_spec(&base).is_err());
    let no_model = KimiCodeConfigUpdate {
        interface_type: Some("kimi".to_string()),
        model: None,
        ..base.clone()
    };
    assert!(build_kimi_managed_spec(&no_model).is_err());
}

/// A minimal valid api-key update; reasoning fields are filled per test.
fn kimi_reasoning_update(
    reasoning_enabled: Option<bool>,
    always_thinking: Option<bool>,
    support_efforts: Option<Vec<String>>,
    default_effort: Option<&str>,
) -> KimiCodeConfigUpdate {
    KimiCodeConfigUpdate {
        mode: "apikey".to_string(),
        interface_type: Some("kimi".to_string()),
        auth_type: None,
        base_url: None,
        api_key: Some("sk-x".to_string()),
        model: Some("kimi-k2".to_string()),
        max_context_size: None,
        vertex_project: None,
        vertex_location: None,
        raw_config_toml: None,
        reasoning_enabled,
        always_thinking,
        support_efforts,
        default_effort: default_effort.map(str::to_string),
    }
}

#[test]
fn kimi_reasoning_off_writes_no_capability_keys() {
    // With reasoning off the model block must stay byte-identical to the
    // pre-feature shape: an ABSENT `capabilities` is what keeps kimi's
    // permissive "allow every modality" default in force.
    let spec = build_kimi_managed_spec(&kimi_reasoning_update(None, None, None, None))
        .expect("valid spec");
    assert!(spec.capabilities.is_empty());
    assert!(spec.support_efforts.is_empty());
    assert!(spec.default_effort.is_none());

    let mut doc = toml::Value::Table(toml::map::Map::new());
    apply_kimi_managed_block(&mut doc, Some(&spec)).expect("applied");
    let model = doc
        .get("models")
        .and_then(|m| m.get(KIMI_MANAGED_MODEL_ALIAS))
        .and_then(toml::Value::as_table)
        .expect("model block");
    assert!(model.get("capabilities").is_none());
    assert!(model.get("support_efforts").is_none());
    assert!(model.get("default_effort").is_none());
}

#[test]
fn kimi_reasoning_on_declares_thinking_plus_the_permissive_modalities() {
    // `thinking` alone would REVOKE image/video input, because kimi only
    // treats an absent capabilities array as "allow all".
    let spec = build_kimi_managed_spec(&kimi_reasoning_update(
        Some(true),
        None,
        Some(vec!["low".into(), "high".into()]),
        Some("high"),
    ))
    .expect("valid spec");
    assert_eq!(
        spec.capabilities,
        vec!["thinking", "image_in", "video_in", "tool_use"]
    );
    assert_eq!(spec.support_efforts, vec!["low", "high"]);
    assert_eq!(spec.default_effort.as_deref(), Some("high"));

    let mut doc = toml::Value::Table(toml::map::Map::new());
    apply_kimi_managed_block(&mut doc, Some(&spec)).expect("applied");
    let model = doc
        .get("models")
        .and_then(|m| m.get(KIMI_MANAGED_MODEL_ALIAS))
        .and_then(toml::Value::as_table)
        .expect("model block");
    let caps: Vec<&str> = model["capabilities"]
        .as_array()
        .expect("array")
        .iter()
        .filter_map(toml::Value::as_str)
        .collect();
    assert!(caps.contains(&"thinking") && caps.contains(&"image_in"));
    assert_eq!(
        model["default_effort"].as_str(),
        Some("high"),
        "default_effort must reach config.toml"
    );
}

#[test]
fn kimi_reasoning_off_clears_keys_a_previous_save_wrote() {
    // Turning reasoning back off must REMOVE the keys, not just stop
    // refreshing them: a lingering `capabilities` array would keep kimi in
    // whitelist mode (and keep advertising a Thinking picker) forever.
    let mut doc = toml::Value::Table(toml::map::Map::new());
    let on = build_kimi_managed_spec(&kimi_reasoning_update(
        Some(true),
        Some(true),
        Some(vec!["low".into(), "high".into()]),
        Some("high"),
    ))
    .expect("valid spec");
    apply_kimi_managed_block(&mut doc, Some(&on)).expect("write reasoning on");
    assert!(doc["models"][KIMI_MANAGED_MODEL_ALIAS]
        .get("capabilities")
        .is_some());

    let off = build_kimi_managed_spec(&kimi_reasoning_update(Some(false), None, None, None))
        .expect("valid spec");
    apply_kimi_managed_block(&mut doc, Some(&off)).expect("write reasoning off");
    let model = doc["models"][KIMI_MANAGED_MODEL_ALIAS]
        .as_table()
        .expect("model block");
    assert!(model.get("capabilities").is_none(), "capabilities must go");
    assert!(model.get("support_efforts").is_none());
    assert!(model.get("default_effort").is_none());
    // The keys that are NOT part of reasoning must survive the rewrite.
    assert_eq!(model["model"].as_str(), Some("kimi-k2"));
    assert!(model.get("max_context_size").is_some());
}

#[test]
fn kimi_reasoning_always_thinking_swaps_the_capability() {
    let spec = build_kimi_managed_spec(&kimi_reasoning_update(
        Some(true),
        Some(true),
        Some(vec!["high".into()]),
        None,
    ))
    .expect("valid spec");
    assert!(spec.capabilities.contains(&"always_thinking".to_string()));
    assert!(!spec.capabilities.contains(&"thinking".to_string()));
}

#[test]
fn kimi_reasoning_normalizes_efforts_and_drops_an_unlisted_default() {
    let spec = build_kimi_managed_spec(&kimi_reasoning_update(
        Some(true),
        None,
        Some(vec![
            "  low  ".into(),
            "".into(),
            "low".into(),
            "high".into(),
        ]),
        // kimi clamps an unlisted default to the middle entry anyway, so
        // writing it would only misreport what the composer will show.
        Some("max"),
    ))
    .expect("valid spec");
    assert_eq!(spec.support_efforts, vec!["low", "high"]);
    assert!(spec.default_effort.is_none());
}

#[test]
fn kimi_reasoning_rejects_a_newline_in_an_effort() {
    let err = build_kimi_managed_spec(&kimi_reasoning_update(
        Some(true),
        None,
        Some(vec!["hi\ngh".into()]),
        None,
    ));
    assert!(err.is_err());
}

#[test]
fn kimi_project_managed_config_round_trips_reasoning_metadata() {
    let value: toml::Value = r#"
default_model = "codeg-managed"
[providers.codeg]
type = "openai_responses"
[models.codeg-managed]
provider = "codeg"
model = "gpt-5.6-sol"
max_context_size = 1000000
capabilities = ["thinking", "image_in", "video_in", "tool_use"]
support_efforts = ["low", "medium", "high"]
default_effort = "high"
"#
    .parse()
    .expect("valid toml");
    let proj = project_kimi_managed_config(&value);
    let caps: Vec<&str> = proj["capabilities"]
        .as_array()
        .expect("array")
        .iter()
        .filter_map(|v| v.as_str())
        .collect();
    assert!(caps.contains(&"thinking"));
    let efforts: Vec<&str> = proj["supportEfforts"]
        .as_array()
        .expect("array")
        .iter()
        .filter_map(|v| v.as_str())
        .collect();
    assert_eq!(efforts, vec!["low", "medium", "high"]);
    assert_eq!(
        proj.get("defaultEffort").and_then(|v| v.as_str()),
        Some("high")
    );
}

#[test]
fn kimi_project_managed_config_omits_reasoning_keys_when_absent() {
    // The shape the panel wrote before this feature — the projection must
    // not invent empty arrays, or the panel would read reasoning as "on".
    let value: toml::Value = r#"
[providers.codeg]
type = "kimi"
[models.codeg-managed]
provider = "codeg"
model = "kimi-k2"
max_context_size = 262144
"#
    .parse()
    .expect("valid toml");
    let proj = project_kimi_managed_config(&value);
    assert!(proj.get("capabilities").is_none());
    assert!(proj.get("supportEfforts").is_none());
    assert!(proj.get("defaultEffort").is_none());
}

#[test]
fn kimi_project_managed_config_uses_non_colliding_keys() {
    // The projection MUST avoid AgentRuntimeConfig keys (apiKey / apiBaseUrl /
    // model / env); otherwise `build_runtime_env_from_setting` would mirror the
    // config.toml values back into the KIMI_MODEL_* runtime env, defeating the
    // single-source-of-truth between env override and config.toml.
    let value: toml::Value = r#"
default_model = "codeg-managed"
[providers.codeg]
type = "anthropic"
base_url = "https://api.anthropic.com"
api_key = "sk-ant"
[models.codeg-managed]
provider = "codeg"
model = "claude-opus-4-7"
max_context_size = 200000
"#
    .parse()
    .expect("valid toml");
    let proj = project_kimi_managed_config(&value);
    assert_eq!(
        proj.get("interfaceType").and_then(|v| v.as_str()),
        Some("anthropic")
    );
    assert_eq!(
        proj.get("baseUrl").and_then(|v| v.as_str()),
        Some("https://api.anthropic.com")
    );
    assert_eq!(proj.get("key").and_then(|v| v.as_str()), Some("sk-ant"));
    assert_eq!(
        proj.get("authType").and_then(|v| v.as_str()),
        Some("api_key")
    );
    assert_eq!(
        proj.get("modelId").and_then(|v| v.as_str()),
        Some("claude-opus-4-7")
    );
    assert_eq!(
        proj.get("maxContextSize").and_then(|v| v.as_i64()),
        Some(200000)
    );
    assert_eq!(
        proj.get("hasManagedBlock"),
        Some(&serde_json::Value::Bool(true))
    );
    for forbidden in [
        "apiKey",
        "apiBaseUrl",
        "api_key",
        "api_base_url",
        "model",
        "env",
    ] {
        assert!(
            !proj.contains_key(forbidden),
            "projection must not contain colliding key {forbidden}"
        );
    }
}

#[test]
fn kimi_project_managed_config_env_subtable_surfaces_as_env_auth() {
    let value: toml::Value = r#"
[providers.codeg]
type = "openai"
[providers.codeg.env]
OPENAI_API_KEY = "sk-x"
[models.codeg-managed]
provider = "codeg"
model = "gpt"
"#
    .parse()
    .expect("valid toml");
    let proj = project_kimi_managed_config(&value);
    assert_eq!(proj.get("key").and_then(|v| v.as_str()), Some("sk-x"));
    assert_eq!(proj.get("authType").and_then(|v| v.as_str()), Some("env"));
}

#[test]
fn kimi_seed_synthetic_credential_opens_gate() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let path = tmp.path().join("credentials").join("kimi-code.json");
    seed_kimi_synthetic_credential_at(&path).expect("seed");
    let token = read_kimi_token_at(&path).expect("token written");
    // A non-empty access_token is exactly what `kimi acp`'s session gate
    // (`harnessIsAuthed`) checks — and it must be flagged as ours.
    assert!(kimi_token_has_access(&token));
    assert!(kimi_token_is_synthetic(&token));
    assert_eq!(
        token.get("access_token").and_then(|v| v.as_str()),
        Some(KIMI_SYNTHETIC_TOKEN_ACCESS)
    );
}

#[test]
fn kimi_seed_preserves_a_real_login_token() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let path = tmp.path().join("credentials").join("kimi-code.json");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    // A real OAuth login: non-empty access_token, no synthetic marker.
    std::fs::write(
        &path,
        r#"{"access_token":"real-oauth-abc","token_type":"Bearer"}"#,
    )
    .unwrap();
    seed_kimi_synthetic_credential_at(&path).expect("seed");
    let token = read_kimi_token_at(&path).expect("token");
    assert_eq!(
        token.get("access_token").and_then(|v| v.as_str()),
        Some("real-oauth-abc"),
        "a real login must never be clobbered by the synthetic seed"
    );
    assert!(!kimi_token_is_synthetic(&token));
}

#[test]
fn kimi_remove_if_ours_deletes_synthetic_but_keeps_real() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let path = tmp.path().join("credentials").join("kimi-code.json");
    // Synthetic → removed.
    seed_kimi_synthetic_credential_at(&path).expect("seed");
    assert!(path.exists());
    remove_kimi_synthetic_credential_if_ours_at(&path).expect("remove");
    assert!(!path.exists());
    // Real login → preserved.
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, r#"{"access_token":"real-oauth-abc"}"#).unwrap();
    remove_kimi_synthetic_credential_if_ours_at(&path).expect("remove");
    assert!(path.exists(), "a real login token must not be removed");
}

#[test]
fn npm_bootstrap_failure_names_the_proxy_only_for_a_wrapper_download() {
    let download = || {
        AcpError::Protocol(
            "failed to install npm package globally: Installation failed: fetch failed".to_string(),
        )
    };

    let annotated = annotate_npm_bootstrap_failure("hermes-agent@0.21.1", download());
    let text = annotated.to_string();
    assert!(text.contains("fetch failed"), "keeps the original error");
    assert!(text.contains("HTTP(S)_PROXY"), "adds the proxy hint");

    // A package whose install runs no bootstrap can't fail this way, so the
    // hint would be noise even on a matching message.
    let other = annotate_npm_bootstrap_failure("@zed-industries/claude-code-acp", download());
    assert!(!other.to_string().contains("HTTP(S)_PROXY"));

    // DeepSeek needs lifecycle scripts and runtime validation too, but it
    // does not download a separate wrapper runtime, so the Hermes-specific
    // proxy diagnosis must not leak onto its failures.
    let deepseek = annotate_npm_bootstrap_failure("deepseek-acp@0.7.0", download());
    assert!(!deepseek.to_string().contains("HTTP(S)_PROXY"));

    // A hermes failure that isn't a download stays untouched.
    let permissions = annotate_npm_bootstrap_failure(
        "hermes-agent@0.21.1",
        AcpError::Protocol("failed to install npm package globally: EACCES".to_string()),
    );
    assert!(!permissions.to_string().contains("HTTP(S)_PROXY"));
}

#[test]
fn native_npm_agents_require_scripts_and_runtime_validation() {
    assert!(npm_package_requires_scripts("hermes-agent@0.20.5"));
    assert!(npm_package_requires_scripts("deepseek-acp@0.7.0"));
    assert!(!npm_package_requires_scripts(
        "@zed-industries/claude-code-acp@0.15.0"
    ));
    assert!(npm_package_bootstraps_runtime("hermes-agent@0.20.5"));
    assert!(!npm_package_bootstraps_runtime("deepseek-acp@0.7.0"));
}

/// The proxy hint is keyed on npm's URL-parse failure, so every other way an
/// install can die has to pass through untouched. (The positive branch also
/// requires a scheme-less proxy in the process env; asserting that would
/// mean mutating env under a parallel test binary.)
#[test]
fn npm_proxy_url_hint_leaves_unrelated_failures_alone() {
    for err in [
        AcpError::Protocol("failed to install npm package globally: EACCES".to_string()),
        AcpError::Protocol("failed to install npm package globally: ETIMEDOUT".to_string()),
        AcpError::SdkNotInstalled("npm is not installed".to_string()),
    ] {
        let before = err.to_string();
        assert_eq!(
            annotate_npm_proxy_url_failure(err).to_string(),
            before,
            "only an ERR_INVALID_URL failure may be annotated"
        );
    }
}
