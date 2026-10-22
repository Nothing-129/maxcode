use super::*;

#[tokio::test]
async fn contended_cleanup_can_drop_outside_the_runtime_context() {
    let connections = Arc::new(tokio::sync::Mutex::new(HashMap::new()));
    let lock = connections.lock().await;
    let cleanup = ConnectionCleanupGuard {
        connections: connections.clone(),
        connection_id: "finished-connection".into(),
        runtime: tokio::runtime::Handle::current(),
    };
    // Match the actual driver: the RAII guard drops after block_on returns.
    std::thread::spawn(move || drop(cleanup))
        .join()
        .expect("cleanup must not require an entered Tokio runtime");
    drop(lock);
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while Arc::strong_count(&connections) != 1 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("deferred cleanup should finish and release its map reference");
}

#[test]
fn cleanup_does_not_panic_when_the_runtime_has_stopped() {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let connections = Arc::new(tokio::sync::Mutex::new(HashMap::new()));
    let lock = connections.try_lock().unwrap();
    let cleanup = ConnectionCleanupGuard {
        connections: connections.clone(),
        connection_id: "shutdown-connection".into(),
        runtime: runtime.handle().clone(),
    };
    drop(runtime);
    drop(cleanup);
    drop(lock);
    assert_eq!(Arc::strong_count(&connections), 1);
}
