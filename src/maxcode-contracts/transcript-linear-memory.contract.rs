use super::*;

#[test]
fn replay_batches_hold_linear_memory_and_preserve_partial_and_invalid_lines() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("session.jsonl");
    std::fs::write(&path, []).unwrap();
    let mut reader = WatchState::with_file_for_test("contract", path.clone());
    let record = "x".repeat(7000);
    let mut bytes = format!("{}\n", record).repeat(300).into_bytes();
    bytes.extend_from_slice(b"\xff\xfe\npartial");
    std::fs::write(&path, &bytes).unwrap();
    let lines = reader.read_new_lines(&path).unwrap();
    assert_eq!(lines.len(), 300);
    assert!(lines.iter().all(|line| line == &record));
    assert!(
        lines.iter().map(String::capacity).sum::<usize>()
            <= 2 * lines.iter().map(String::len).sum::<usize>()
    );
    assert_eq!(reader.carry, b"partial");
    assert!(reader.carry.capacity() < record.len());
    assert_eq!(reader.committed, bytes.len() as u64 - 7);
    use std::io::Write;
    std::fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap()
        .write_all(b" done\n")
        .unwrap();
    assert_eq!(reader.read_new_lines(&path).unwrap(), vec!["partial done"]);
}
