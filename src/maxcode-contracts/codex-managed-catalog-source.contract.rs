//! Managed runtime ownership protects catalogs from another global installation.
use super::*;

#[test]
fn explicit_and_managed_sources_do_not_fall_through_to_old_global_packages() {
    let dir = tempfile::tempdir().unwrap();
    let runtime = dir.path().join("codex");
    std::fs::write(&runtime, "runtime").unwrap();
    let managed = dir.path().join("managed");
    let fallback = dir.path().join("global");
    assert_eq!(
        select_catalog_sources(
            runtime.to_str(),
            Some(managed.clone()),
            None,
            vec![fallback.clone()]
        ),
        vec![CatalogSource::Runtime(runtime)]
    );
    assert_eq!(
        select_catalog_sources(None, Some(managed.clone()), None, vec![fallback.clone()]),
        vec![CatalogSource::Runtime(managed)]
    );
    assert!(select_catalog_sources(Some("./missing/codex"), None, None, vec![fallback]).is_empty());
}

#[cfg(unix)]
#[tokio::test]
async fn native_catalog_queries_need_no_node_and_keep_failure_explicit() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let runtime = dir.path().join("codex");
    std::fs::write(&runtime,"#!/bin/sh\n[ \"$*\" = \"debug models --bundled\" ] || exit 3\nprintf '%s' '{\"models\":[{\"slug\":\"active\",\"priority\":1}]}'\n").unwrap();
    std::fs::set_permissions(&runtime, std::fs::Permissions::from_mode(0o755)).unwrap();
    let result = fetch_sources(vec![CatalogSource::Runtime(runtime.clone())], None)
        .await
        .unwrap();
    assert_eq!(result[0]["slug"], "active");
    std::fs::write(&runtime, "#!/bin/sh\nexit 1\n").unwrap();
    assert!(fetch_sources(vec![CatalogSource::Runtime(runtime)], None)
        .await
        .is_none());
}

#[cfg(unix)]
#[test]
fn adapter_symlinks_resolve_the_actual_package() {
    let dir = tempfile::tempdir().unwrap();
    let package = dir.path().join("active-package");
    std::fs::create_dir_all(package.join("dist")).unwrap();
    std::fs::write(
        package.join("package.json"),
        r#"{"name":"@agentclientprotocol/codex-acp"}"#,
    )
    .unwrap();
    std::fs::write(package.join("dist/main.js"), "").unwrap();
    let shim = dir.path().join("codex-acp");
    std::os::unix::fs::symlink(package.join("dist/main.js"), &shim).unwrap();
    assert_eq!(
        adapter_dir_for_command(&shim),
        Some(std::fs::canonicalize(package).unwrap())
    );
}
