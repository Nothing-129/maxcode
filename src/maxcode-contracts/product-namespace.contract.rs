use super::*;

#[test]
fn sqlite_wal_attachments_and_path_references_are_copied_without_mutating_codeg() {
    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("app.codeg");
    let target = root.path().join("app.maxcode");
    fs::create_dir_all(source.join("uploads")).unwrap();
    fs::write(source.join("uploads/picture.png"), b"original image").unwrap();
    fs::write(
        source.join(".codeg-restore-pending.json"),
        b"must not restore",
    )
    .unwrap();
    let db = rusqlite::Connection::open(source.join("codeg.db")).unwrap();
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE folder (id INTEGER PRIMARY KEY, path TEXT, content TEXT);").unwrap();
    let old_path = source
        .join("uploads/picture.png")
        .to_string_lossy()
        .into_owned();
    let old_uri = url::Url::from_file_path(source.join("uploads/picture.png"))
        .unwrap()
        .to_string();
    db.execute(
        "INSERT INTO folder VALUES(7,?1,?2)",
        [&old_path, &format!("![photo]({old_uri})")],
    )
    .unwrap();
    let mappings = vec![(source.clone(), target.clone())];
    assert!(copy_legacy_root(&source, &target, &mappings).unwrap());
    let copied = rusqlite::Connection::open(target.join("codeg.db")).unwrap();
    let (id, path, content): (i64, String, String) = copied
        .query_row("SELECT id,path,content FROM folder", [], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .unwrap();
    assert_eq!(id, 7);
    assert_eq!(path, target.join("uploads/picture.png").to_string_lossy());
    assert!(content.contains(
        &url::Url::from_file_path(target.join("uploads/picture.png"))
            .unwrap()
            .to_string()
    ));
    assert_eq!(
        db.query_row("SELECT path FROM folder", [], |r| r.get::<_, String>(0))
            .unwrap(),
        old_path
    );
    copied.execute("DELETE FROM folder", []).unwrap();
    fs::write(target.join("uploads/picture.png"), b"new image").unwrap();
    assert_eq!(
        fs::read(source.join("uploads/picture.png")).unwrap(),
        b"original image"
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM folder", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert!(!target.join(".codeg-restore-pending.json").exists());
    assert!(target.join(MIGRATION_MARKER).exists());
}

#[test]
fn existing_destination_is_never_merged_or_overwritten() {
    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("old");
    let target = root.path().join("new");
    fs::create_dir_all(&source).unwrap();
    fs::create_dir_all(&target).unwrap();
    fs::write(source.join("preferences.json"), "old").unwrap();
    fs::write(target.join("preferences.json"), "new").unwrap();
    assert!(!copy_legacy_root(&source, &target, &[]).unwrap());
    assert_eq!(
        fs::read_to_string(target.join("preferences.json")).unwrap(),
        "new"
    );
}

#[test]
fn failure_never_publishes_a_partial_database() {
    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("old");
    let target = root.path().join("new");
    fs::create_dir_all(&source).unwrap();
    fs::write(source.join("codeg.db"), b"not a database").unwrap();
    assert!(copy_legacy_root(&source, &target, &[]).is_err());
    assert!(!target.exists());
    assert_eq!(
        fs::read(source.join("codeg.db")).unwrap(),
        b"not a database"
    );
    assert!(!fs::read_dir(root.path()).unwrap().any(|p| p
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".maxcode-import-")));
}

#[cfg(unix)]
#[test]
fn internal_links_are_rebased_and_external_links_are_never_adopted() {
    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("old");
    let target = root.path().join("new");
    fs::create_dir_all(&source).unwrap();
    fs::write(source.join("owned.txt"), b"old").unwrap();
    fs::write(root.path().join("other-product.txt"), b"external").unwrap();
    std::os::unix::fs::symlink(source.join("owned.txt"), source.join("owned-link")).unwrap();
    fs::create_dir(source.join("sub")).unwrap();
    std::os::unix::fs::symlink("../../old/owned.txt", source.join("sub/relative-link")).unwrap();
    std::os::unix::fs::symlink(
        root.path().join("other-product.txt"),
        source.join("external-link"),
    )
    .unwrap();
    assert!(copy_legacy_root(&source, &target, &[(source.clone(), target.clone())]).unwrap());
    assert_eq!(
        fs::read_link(target.join("owned-link")).unwrap(),
        target.join("owned.txt")
    );
    assert!(!target.join("external-link").exists());
    assert_eq!(
        fs::read_link(target.join("sub/relative-link")).unwrap(),
        target.join("owned.txt")
    );
    fs::write(target.join("owned-link"), b"new").unwrap();
    assert_eq!(fs::read(source.join("owned.txt")).unwrap(), b"old");
}

#[test]
fn relocation_preserves_unrelated_and_similarly_named_paths() {
    let mappings = vec![(
        PathBuf::from("/data/app.codeg"),
        PathBuf::from("/data/app.maxcode"),
    )];
    assert_eq!(
        relocate_text("/data/app.codeg-extra/file", &mappings),
        "/data/app.codeg-extra/file"
    );
    assert_eq!(
        relocate_text("/projects/customer/repo", &mappings),
        "/projects/customer/repo"
    );
    assert_eq!(
        relocate_text(r#"{"path":"/data/app.codeg"}"#, &mappings),
        r#"{"path":"/data/app.maxcode"}"#
    );
}

#[test]
fn maxcode_overrides_precede_explicit_compatibility_aliases() {
    temp_env::with_vars(
        [
            ("MAXCODE_HOME", Some("/new/home")),
            ("CODEG_HOME", Some("/old/home")),
            ("MAXCODE_DATA_DIR", Some("/new/data")),
            ("CODEG_DATA_DIR", Some("/old/data")),
        ],
        || {
            assert_eq!(env_path("CODEG_HOME"), Some(PathBuf::from("/new/home")));
            assert_eq!(env_path("CODEG_DATA_DIR"), Some(PathBuf::from("/new/data")));
            assert_eq!(crate::paths::codeg_home_dir(), PathBuf::from("/new/home"));
        },
    );
}

#[test]
fn upgrade_preserves_all_web_service_settings_in_an_independent_copy() {
    for port in ["3080", "4488"] {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("old");
        let target = root.path().join("new");
        fs::create_dir_all(&source).unwrap();
        let old = rusqlite::Connection::open(source.join("codeg.db")).unwrap();
        old.execute_batch(&format!("CREATE TABLE app_metadata (id INTEGER PRIMARY KEY, key TEXT, value TEXT); INSERT INTO app_metadata(key,value) VALUES ('web_service_token','old-token'),('web_service_auto_start','true'),('web_service_port','{port}'),('web_service_public_share_url','https://old.example');")).unwrap();
        assert!(copy_legacy_root(&source, &target, &[]).unwrap());
        let new = rusqlite::Connection::open(target.join("codeg.db")).unwrap();
        let value = |db: &rusqlite::Connection, key: &str| {
            db.query_row(
                "SELECT value FROM app_metadata WHERE key=?1",
                [key],
                |row| row.get::<_, String>(0),
            )
        };
        assert_eq!(value(&old, "web_service_token").unwrap(), "old-token");
        assert_eq!(value(&old, "web_service_auto_start").unwrap(), "true");
        assert_eq!(value(&new, "web_service_port").unwrap(), port);
        for key in [
            "web_service_port",
            "web_service_auto_start",
            "web_service_token",
            "web_service_public_share_url",
        ] {
            assert_eq!(value(&new, key).unwrap(), value(&old, key).unwrap());
        }
        new.execute(
            "UPDATE app_metadata SET value='new-token' WHERE key='web_service_token'",
            [],
        )
        .unwrap();
        assert_eq!(value(&old, "web_service_token").unwrap(), "old-token");
    }
}

#[test]
fn interrupted_multi_root_import_resumes_without_overwriting_the_published_root() {
    let root = tempfile::tempdir().unwrap();
    let old_data = root.path().join("old-data");
    let new_data = root.path().join("new-data");
    let old_home = root.path().join("old-home");
    let new_home = root.path().join("new-home");
    fs::create_dir_all(&old_data).unwrap();
    fs::create_dir_all(&old_home).unwrap();
    rusqlite::Connection::open(old_data.join("codeg.db"))
        .unwrap()
        .execute_batch(
            "CREATE TABLE preserved(value TEXT); INSERT INTO preserved VALUES('source');",
        )
        .unwrap();
    fs::write(old_home.join("codeg.db"), b"broken sqlite").unwrap();
    let pairs = vec![
        (old_data.clone(), new_data.clone()),
        (old_home.clone(), new_home.clone()),
    ];
    assert!(migrate_pairs(&new_data, &pairs).is_err());
    assert!(new_data.join(MIGRATION_MARKER).is_file());
    assert!(!new_data.join(COMPLETE_MARKER).exists());
    let copied = rusqlite::Connection::open(new_data.join("codeg.db")).unwrap();
    copied
        .execute("UPDATE preserved SET value='edited copy'", [])
        .unwrap();
    fs::remove_file(old_home.join("codeg.db")).unwrap();
    fs::write(old_home.join("preferences.json"), "{}").unwrap();
    migrate_pairs(&new_data, &pairs).unwrap();
    assert!(new_data.join(COMPLETE_MARKER).exists());
    assert_eq!(
        copied
            .query_row("SELECT value FROM preserved", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "edited copy"
    );
    assert_eq!(
        fs::read_to_string(new_home.join("preferences.json")).unwrap(),
        "{}"
    );
}
