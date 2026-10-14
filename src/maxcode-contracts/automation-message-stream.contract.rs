use super::*;
use tokio::io::AsyncWriteExt;

fn source() -> AutomationMessageTrigger {
    AutomationMessageTrigger {
        scope: AutomationMessageScope::AtMe,
        target: String::new(),
        profile: String::new(),
        keywords: String::new(),
        batch_minutes: 10,
    }
}
#[tokio::test]
async fn waits_for_ready_then_persists_valid_messages_once_and_exits_on_cancel() {
    let db = crate::db::test_helpers::fresh_in_memory_db().await;
    let mut cmd = crate::process::tokio_command("sh");
    cmd.args(["-c", r#"
      printf '%s\n' '{"message_id":"m1","conversation_id":"c1","content":"task"}'
      read -r ready
      printf '%s\n' '[event] ready event_key=test' >&2
      printf '%s\n' 'not-json' '{"content":"no ID"}' '{"message_id":"m1","conversation_id":"c1","content":"task"}'
      read -r stop
    "#]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().unwrap();
    let mut control = child.stdin.take().unwrap();
    let status = Arc::new(Mutex::new(AutomationListenerInfo {
        state: "starting".into(),
        ..Default::default()
    }));
    let source = source();
    let key = source_key(&source);
    let (cancel, mut rx) = watch::channel(false);
    let task_db = AppDatabase {
        conn: db.conn.clone(),
    };
    let task_status = status.clone();
    let task = tokio::spawn(async move {
        consume_child(
            &task_db,
            &EventEmitter::Noop,
            1,
            &source,
            &task_status,
            &mut rx,
            child,
        )
        .await
    });
    // No stdout event is accepted while the consumer is not ready.
    assert_eq!(
        automation_runtime_service::queue_status(&db.conn, 1, &key)
            .await
            .unwrap()
            .0,
        0
    );
    control.write_all(b"ready\n").await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if automation_runtime_service::queue_status(&db.conn, 1, &key)
                .await
                .unwrap()
                .0
                == 1
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(status.lock().await.state, "listening");
    cancel.send(true).unwrap();
    assert!(tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .unwrap()
        .unwrap()
        .is_ok());
    assert_eq!(
        automation_runtime_service::pending(&db.conn, 1, &key)
            .await
            .unwrap()
            .len(),
        1
    );
}
#[tokio::test]
async fn failed_start_never_accepts_stdout_as_a_ready_event() {
    let db = crate::db::test_helpers::fresh_in_memory_db().await;
    let mut cmd = crate::process::tokio_command("sh");
    cmd.args(["-c", "printf '%s\\n' '{\"message_id\":\"m1\"}'; exit 2"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let status = Arc::new(Mutex::new(AutomationListenerInfo::default()));
    let (_cancel, mut rx) = watch::channel(false);
    let result = consume_child(
        &db,
        &EventEmitter::Noop,
        1,
        &source(),
        &status,
        &mut rx,
        cmd.spawn().unwrap(),
    )
    .await;
    assert!(result.unwrap_err().contains("exited"));
    assert_eq!(
        automation_runtime_service::queue_status(&db.conn, 1, &source_key(&source()))
            .await
            .unwrap()
            .0,
        0
    );
}
