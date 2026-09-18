use super::*;

#[tokio::test]
async fn long_temp_dir_still_produces_a_dialable_private_broker_socket() {
    use std::os::unix::fs::PermissionsExt;
    let path = default_socket_path(Path::new(&format!("/tmp/{}", "x".repeat(SUN_PATH_CAP))));
    let listener = bind_unix_socket(&path).await.unwrap();
    let client = tokio::net::UnixStream::connect(&path).await.unwrap();
    let (_, _) = listener.accept().await.unwrap();
    let parent = path.parent().unwrap();
    assert_eq!(
        std::fs::metadata(parent).unwrap().permissions().mode() & 0o777,
        0o700
    );
    assert_ne!(parent, crate::acp::scratch_dir::scratch_root());
    drop(client);
    drop(listener);
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
async fn rejected_broker_path_does_not_unlink_or_create_anything() {
    let holder = tempfile::tempdir_in("/tmp").unwrap();
    let leaf = "s".repeat(SUN_PATH_CAP - holder.path().as_os_str().len() - 1);
    let path = holder.path().join(leaf);
    std::fs::write(&path, "existing endpoint").unwrap();
    let err = bind_unix_socket(&path).await.unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::InvalidInput);
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "existing endpoint");
    let missing = holder.path().join("missing");
    let err = bind_unix_socket(&missing.join("s".repeat(SUN_PATH_CAP)))
        .await
        .unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::InvalidInput);
    assert!(!missing.exists());
}
