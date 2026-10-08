//! A backgrounded mobile socket must not deadlock its own outbound queue.
use super::*;
use crate::acp::types::{AcpEvent, EventEnvelope};
use crate::models::agent::AgentType;
use serde_json::{json, Value};
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;

#[derive(Default)]
struct RecordingSocket {
    frames: Vec<Value>,
    fail: bool,
    on_send: Option<Box<dyn FnOnce() + Send>>,
}

impl Sink<Message> for RecordingSocket {
    type Error = std::io::Error;

    fn poll_ready(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        if self.fail {
            Poll::Ready(Err(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "mobile socket closed",
            )))
        } else {
            Poll::Ready(Ok(()))
        }
    }

    fn start_send(mut self: Pin<&mut Self>, message: Message) -> Result<(), Self::Error> {
        let Message::Text(text) = message else {
            panic!("expected a JSON control frame");
        };
        self.frames.push(serde_json::from_str(&text).unwrap());
        if let Some(on_send) = self.on_send.take() {
            on_send();
        }
        Ok(())
    }

    fn poll_flush(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn poll_close(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }
}

async fn state() -> (Arc<AppState>, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let db = crate::db::test_helpers::fresh_in_memory_db().await;
    let state = Arc::new(AppState::new_for_test(db, dir.path().to_path_buf()));
    (state, dir)
}

fn full_queue() -> (mpsc::Sender<ServerMsg>, mpsc::Receiver<ServerMsg>) {
    let (tx, rx) = mpsc::channel(OUTBOUND_CAPACITY);
    for _ in 0..OUTBOUND_CAPACITY {
        tx.try_send(ServerMsg::Pong).unwrap();
    }
    assert_eq!(tx.capacity(), 0);
    (tx, rx)
}

fn event(seq: u64) -> Arc<EventEnvelope> {
    Arc::new(EventEnvelope {
        seq,
        connection_id: "mobile-connection".into(),
        payload: AcpEvent::ContentDelta {
            text: "reply received while the snapshot was being written".into(),
            parent_tool_use_id: None,
        },
    })
}

fn attach(since_seq: Option<u64>) -> ClientMsg {
    ClientMsg::Attach {
        subscription_id: "mobile-sub".into(),
        connection_id: "mobile-connection".into(),
        since_seq,
    }
}

#[tokio::test]
async fn ping_replies_even_when_the_mobile_outbound_queue_is_full() {
    let (state, _dir) = state().await;
    let (tx, _rx) = full_queue();
    let (cleanup_tx, _cleanup_rx) = mpsc::channel(OUTBOUND_CAPACITY);
    let mut subscriptions = HashMap::new();
    let mut epoch = 0;
    let mut socket = RecordingSocket::default();

    tokio::time::timeout(
        Duration::from_secs(1),
        handle_client_msg(
            ClientMsg::Ping,
            &mut socket,
            &state,
            &tx,
            &cleanup_tx,
            &mut subscriptions,
            &mut epoch,
        ),
    )
    .await
    .expect("pong must not wait for the loop's own queue")
    .unwrap();

    assert_eq!(socket.frames, vec![json!({ "type": "pong" })]);
    assert_eq!(tx.capacity(), 0, "the queue was never drained");
}

#[tokio::test]
async fn missing_connection_detaches_even_when_the_mobile_outbound_queue_is_full() {
    let (state, _dir) = state().await;
    let (tx, _rx) = full_queue();
    let (cleanup_tx, _cleanup_rx) = mpsc::channel(OUTBOUND_CAPACITY);
    let mut subscriptions = HashMap::new();
    let mut epoch = 0;
    let mut socket = RecordingSocket::default();

    tokio::time::timeout(
        Duration::from_secs(1),
        handle_client_msg(
            attach(None),
            &mut socket,
            &state,
            &tx,
            &cleanup_tx,
            &mut subscriptions,
            &mut epoch,
        ),
    )
    .await
    .expect("a gone connection must not leave a frozen transcript")
    .unwrap();

    assert_eq!(
        socket.frames,
        vec![json!({
            "type": "detached",
            "subscription_id": "mobile-sub",
            "reason": "connection_gone"
        })]
    );
    assert!(subscriptions.is_empty());
    assert_eq!(tx.capacity(), 0);
}

#[tokio::test]
async fn snapshot_precedes_buffered_live_events_with_a_full_mobile_queue() {
    let (state, _dir) = state().await;
    state
        .connection_manager
        .insert_test_connection(
            "mobile-connection",
            AgentType::Codex,
            None,
            state.emitter.clone(),
        )
        .await;
    let session = state
        .connection_manager
        .get_state("mobile-connection")
        .await
        .unwrap();
    let stream = session.read().await.event_stream();
    let (tx, mut rx) = full_queue();
    let (cleanup_tx, _cleanup_rx) = mpsc::channel(OUTBOUND_CAPACITY);
    let mut subscriptions = HashMap::new();
    let mut epoch = 0;
    let mut socket = RecordingSocket {
        on_send: Some(Box::new(move || stream.send(event(1)))),
        ..Default::default()
    };

    tokio::time::timeout(
        Duration::from_secs(1),
        handle_client_msg(
            attach(None),
            &mut socket,
            &state,
            &tx,
            &cleanup_tx,
            &mut subscriptions,
            &mut epoch,
        ),
    )
    .await
    .expect("snapshot must be written before the queue can drain")
    .unwrap();
    assert_eq!(socket.frames[0]["type"], "snapshot");
    assert_eq!(socket.frames[0]["event_seq"], 0);
    assert_eq!(subscriptions["mobile-sub"].epoch, 1);

    for _ in 0..OUTBOUND_CAPACITY {
        assert!(matches!(rx.recv().await.unwrap(), ServerMsg::Pong));
    }
    let next = tokio::time::timeout(Duration::from_secs(1), rx.recv())
        .await
        .expect("the event buffered during the snapshot must survive")
        .unwrap();
    send_server_msg(&mut socket, &next).await.unwrap();
    assert_eq!(socket.frames[1]["type"], "event");
    assert_eq!(socket.frames[1]["envelope"]["seq"], 1);

    handle_client_msg(
        ClientMsg::Detach {
            subscription_id: "mobile-sub".into(),
        },
        &mut socket,
        &state,
        &tx,
        &cleanup_tx,
        &mut subscriptions,
        &mut epoch,
    )
    .await
    .unwrap();
    assert!(subscriptions.is_empty());
}

#[tokio::test]
async fn replay_recovers_missed_reply_events_with_a_full_mobile_queue() {
    let (state, _dir) = state().await;
    state
        .connection_manager
        .insert_test_connection(
            "mobile-connection",
            AgentType::Codex,
            None,
            state.emitter.clone(),
        )
        .await;
    let session = state
        .connection_manager
        .get_state("mobile-connection")
        .await
        .unwrap();
    {
        let mut session = session.write().await;
        session.event_seq = 1;
        let _ = session.push_recent_event(event(1));
    }
    let (tx, _rx) = full_queue();
    let (cleanup_tx, _cleanup_rx) = mpsc::channel(OUTBOUND_CAPACITY);
    let mut subscriptions = HashMap::new();
    let mut epoch = 0;
    let mut socket = RecordingSocket::default();

    tokio::time::timeout(
        Duration::from_secs(1),
        handle_client_msg(
            attach(Some(0)),
            &mut socket,
            &state,
            &tx,
            &cleanup_tx,
            &mut subscriptions,
            &mut epoch,
        ),
    )
    .await
    .expect("replay must not wait for the loop's own queue")
    .unwrap();
    assert_eq!(socket.frames[0]["type"], "replay");
    assert_eq!(socket.frames[0]["events"][0]["seq"], 1);
    assert_eq!(socket.frames[0]["high_water_seq"], 1);
    for (_, sub) in subscriptions.drain() {
        sub.handle.abort();
    }
}

#[tokio::test]
async fn failed_snapshot_write_does_not_spawn_a_replacement_forwarder() {
    let (state, _dir) = state().await;
    state
        .connection_manager
        .insert_test_connection(
            "mobile-connection",
            AgentType::Codex,
            None,
            state.emitter.clone(),
        )
        .await;
    let (tx, _rx) = full_queue();
    let (cleanup_tx, _cleanup_rx) = mpsc::channel(OUTBOUND_CAPACITY);
    let mut subscriptions = HashMap::new();
    let old = tokio::spawn(std::future::pending::<()>());
    let old_abort = old.abort_handle();
    subscriptions.insert(
        "mobile-sub".into(),
        ActiveSubscription {
            handle: old,
            epoch: 1,
        },
    );
    let mut epoch = 1;
    let mut socket = RecordingSocket {
        fail: true,
        ..Default::default()
    };

    let result = tokio::time::timeout(
        Duration::from_secs(1),
        handle_client_msg(
            attach(None),
            &mut socket,
            &state,
            &tx,
            &cleanup_tx,
            &mut subscriptions,
            &mut epoch,
        ),
    )
    .await
    .expect("a failed write must propagate to socket cleanup");

    assert!(result.is_err());
    assert!(subscriptions.is_empty());
    assert_eq!(epoch, 1, "no new forwarder was allocated");
    tokio::task::yield_now().await;
    assert!(
        old_abort.is_finished(),
        "the replaced forwarder was aborted"
    );
}
