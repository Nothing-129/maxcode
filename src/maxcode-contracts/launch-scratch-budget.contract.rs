use super::*;

#[test]
fn macos_length_temp_path_leaves_room_for_a_child_socket_and_keeps_old_roots_sweepable() {
    let ambient = PathBuf::from(format!("/var/folders/hl/{}/T", "x".repeat(30)));
    let root = choose_root(&ambient);
    create_root(&root).unwrap();
    let leaf = root.join(new_dir_name(std::process::id()));
    create_leaf(&leaf).unwrap();
    let socket_path = leaf.join(format!("znr-{}.sock", uuid::Uuid::new_v4()));
    let listener = std::os::unix::net::UnixListener::bind(&socket_path);
    let dialed = listener
        .as_ref()
        .map(|_| std::os::unix::net::UnixStream::connect(&socket_path));
    assert!(dialed.is_ok_and(|result| result.is_ok()));
    drop(listener);
    std::fs::remove_dir_all(leaf).unwrap();
    let roots = sweep_roots();
    assert!(roots.contains(&std::env::temp_dir().join(SCRATCH_NAMESPACE)));
    assert!(roots.contains(&short_root()));
}

#[test]
fn a_preexisting_symlink_is_never_adopted_as_private_scratch() {
    let holder = tempfile::tempdir_in("/tmp").unwrap();
    let target = holder.path().join("target");
    std::fs::create_dir(&target).unwrap();
    let root = holder.path().join("codeg-acp");
    std::os::unix::fs::symlink(&target, &root).unwrap();
    assert!(create_root(&root).is_err());
    assert!(read_sweep_root(&root).is_none());
    assert!(std::fs::read_dir(target).unwrap().next().is_none());
}
