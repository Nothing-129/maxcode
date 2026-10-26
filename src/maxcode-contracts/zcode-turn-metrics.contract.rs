use super::*;
// The custom agent these loop tests drive. Deliberately unregistered:
// nothing on the recording path looks the id up.

fn custom_update(update: serde_json::Value) -> GrokFrame {
    (
        "session/update",
        serde_json::json!({"sessionId": "s1", "update": update}),
    )
}

fn custom_text(text: &str) -> GrokFrame {
    custom_update(serde_json::json!({
        "sessionUpdate": "agent_message_chunk",
        "content": {"type": "text", "text": text},
    }))
}

/// One line per turn, for assertions that read like the conversation.
fn turn_shape(turns: &[crate::models::message::MessageTurn]) -> Vec<String> {
    use crate::models::message::ContentBlock as Block;
    turns
        .iter()
        .map(|turn| {
            let blocks: Vec<String> = turn
                .blocks
                .iter()
                .map(|block| match block {
                    Block::Text { text } => format!("text {text:?}"),
                    Block::ToolUse {
                        tool_use_id,
                        tool_name,
                        ..
                    } => format!("call {} {tool_name}", tool_use_id.as_deref().unwrap_or("?")),
                    Block::ToolResult {
                        tool_use_id,
                        output_preview,
                        ..
                    } => format!(
                        "result {} {:?}",
                        tool_use_id.as_deref().unwrap_or("?"),
                        output_preview.as_deref().unwrap_or("")
                    ),
                    other => format!("{other:?}"),
                })
                .collect();
            format!("{:?}: {}", turn.role, blocks.join(" | "))
        })
        .collect()
}

/// `run_conversation_loop` for a custom agent. Each prompt streams the next
/// turn of the script, then holds its response until the test releases it,
/// so every frame of a prompted turn is read INSIDE that turn. Frames handed
/// to [`CustomLoop::agent_sends`] go out at once, outside any prompt.
struct CustomLoop {
    state: Arc<RwLock<SessionState>>,
    cmd_tx: mpsc::Sender<ConnectionCommand>,
    events: tokio::sync::broadcast::Receiver<Arc<crate::acp::types::EventEnvelope>>,
    /// Every event the loop emitted so far, in order.
    seen: Vec<AcpEvent>,
    unprompted: tokio::sync::mpsc::UnboundedSender<Vec<GrokFrame>>,
    respond: Arc<tokio::sync::Notify>,
    /// What the agent answers the next `_session/steering` requests with,
    /// in order; `injected` once these run out.
    client: tokio::task::JoinHandle<()>,
    agent: tokio::task::JoinHandle<()>,
}

impl CustomLoop {
    async fn start_for(agent_type: AgentType, turns: Vec<Vec<GrokFrame>>) -> Self {
        use agent_client_protocol::schema::v1::PromptResponse;
        let turns = Arc::new(std::sync::Mutex::new(VecDeque::from(turns)));
        let respond = Arc::new(tokio::sync::Notify::new());
        let agent_respond = Arc::clone(&respond);
        let steer_outcomes = Arc::new(std::sync::Mutex::new(VecDeque::new()));
        let agent_steer_outcomes = Arc::clone(&steer_outcomes);
        let (unprompted, mut unprompted_rx) =
            tokio::sync::mpsc::unbounded_channel::<Vec<GrokFrame>>();
        let (client_end, agent_end) = agent_client_protocol::Channel::duplex();

        let agent = tokio::spawn(async move {
            let _ = Agent
                .builder()
                .on_receive_request(
                    async |_req: NewSessionRequest,
                           responder: Responder<NewSessionResponse>,
                           _cx: ConnectionTo<Client>| {
                        responder.respond(NewSessionResponse::new(SessionId::new("s1")))
                    },
                    on_receive_request!(),
                )
                .on_receive_request(
                    async move |_req: PromptRequest,
                                responder: Responder<PromptResponse>,
                                cx: ConnectionTo<Client>| {
                        let frames = turns.lock().unwrap().pop_front().unwrap_or_default();
                        send_grok_frames(&cx, &frames)?;
                        let respond = Arc::clone(&agent_respond);
                        // Off the handler, so a held response doesn't hold
                        // up the agent's other incoming messages.
                        tokio::spawn(async move {
                            respond.notified().await;
                            responder.respond(PromptResponse::new(StopReason::EndTurn))
                        });
                        Ok(())
                    },
                    on_receive_request!(),
                )
                .on_receive_request(
                    async move |_req: TestSteeringRequest,
                                responder: Responder<serde_json::Value>,
                                _cx: ConnectionTo<Client>| {
                        let outcome = agent_steer_outcomes
                            .lock()
                            .unwrap()
                            .pop_front()
                            .unwrap_or_else(|| serde_json::json!({"outcome": "injected"}));
                        responder.respond(outcome)
                    },
                    on_receive_request!(),
                )
                .connect_with(agent_end, async move |cx: ConnectionTo<Client>| {
                    while let Some(frames) = unprompted_rx.recv().await {
                        send_grok_frames(&cx, &frames)?;
                    }
                    std::future::pending::<Result<(), agent_client_protocol::Error>>().await
                })
                .await;
        });

        let state = Arc::new(RwLock::new(SessionState::new(
            "conn-custom".to_string(),
            agent_type,
            None,
            "win".to_string(),
            None,
        )));
        let events = state.read().await.event_stream().subscribe();
        let (cmd_tx, mut cmd_rx) = mpsc::channel(16);
        let loop_state = Arc::clone(&state);
        let client = tokio::spawn(async move {
            let _ = Client
                .builder()
                .connect_with(client_end, async move |cx: ConnectionTo<Agent>| {
                    let raw = cx
                        .send_request_to(
                            Agent,
                            UntypedMessage::new("session/new", NewSessionRequest::new("/tmp"))?,
                        )
                        .block_task()
                        .await?;
                    let response: NewSessionResponse = serde_json::from_value(raw)
                        .map_err(agent_client_protocol::Error::into_internal_error)?;
                    let mut session = AgentSession::attach(&cx, response)?;
                    let perms = PendingPermissions::default();
                    let ledger = background_watch::PromptLedger::shared();
                    let stderr_tail = Arc::new(StderrTail::new());
                    run_conversation_loop(
                        &mut session,
                        "conn-custom",
                        &EventEmitter::Noop,
                        &loop_state,
                        agent_type,
                        &perms,
                        &mut cmd_rx,
                        Arc::new(TerminalRuntime::with_base_env(BTreeMap::new())),
                        "/tmp",
                        false,
                        &[],
                        &ledger,
                        None,
                        &stderr_tail,
                    )
                    .await?;
                    Ok(())
                })
                .await;
        });

        Self {
            state,
            cmd_tx,
            events,
            seen: Vec::new(),
            unprompted,
            respond,
            client,
            agent,
        }
    }

    /// Have the agent send `frames` now, outside any prompt.
    fn agent_sends(&self, frames: Vec<GrokFrame>) {
        self.unprompted.send(frames).expect("the agent is running");
    }

    /// Run one prompted turn to its end: admit the prompt the way
    /// `send_prompt_inner` does, wait until `last_text` has been read
    /// inside the turn, then release the response and wait for the end.
    async fn run_turn(&mut self, prompt: &str, last_text: &str) {
        self.open_turn(prompt, last_text).await;
        self.close_turn().await;
    }

    /// The first half of [`Self::run_turn`]: the turn stays open.
    async fn open_turn(&mut self, prompt: &str, last_text: &str) {
        self.state.write().await.turn_in_flight = true;
        self.cmd_tx
            .send(ConnectionCommand::Prompt {
                blocks: vec![PromptInputBlock::Text {
                    text: prompt.into(),
                }],
                user_message: None,
            })
            .await
            .expect("the loop is running");
        self.until_text(last_text).await;
    }

    /// The second half of [`Self::run_turn`].
    async fn close_turn(&mut self) {
        self.respond.notify_one();
        self.until("the turn end", |e| {
            matches!(e, AcpEvent::TurnComplete { .. })
        })
        .await;
    }

    async fn until_text(&mut self, text: &str) -> usize {
        self.until(
            "the reply",
            |e| matches!(e, AcpEvent::ContentDelta { text: delta, .. } if delta == text),
        )
        .await
    }

    /// Record events until one matches, and return its index in `seen`.
    async fn until(&mut self, what: &str, matches: impl Fn(&AcpEvent) -> bool) -> usize {
        let deadline = std::time::Duration::from_secs(10);
        loop {
            let envelope = tokio::time::timeout(deadline, self.events.recv())
                .await
                .unwrap_or_else(|_| panic!("timed out waiting for {what}; saw {:#?}", self.seen))
                .expect("event stream");
            self.seen.push(envelope.payload.clone());
            if matches(&envelope.payload) {
                return self.seen.len() - 1;
            }
        }
    }

    /// Wait until a [`grok_barrier`] the agent sent has been through the
    /// loop — and with it every frame sent before it.
    async fn until_barrier(&mut self) -> usize {
        self.until("the agent's barrier", |e| {
            matches!(e, AcpEvent::AvailableCommands { .. })
        })
        .await
    }

    async fn shutdown(self) {
        let _ = self.cmd_tx.send(ConnectionCommand::Disconnect).await;
        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), self.client).await;
        self.agent.abort();
    }
}

#[tokio::test]
async fn zcode_terminal_metrics_reach_history_once_before_turn_complete() {
    use crate::parsers::AgentParser as _;
    let home = tempfile::tempdir().unwrap();
    let home_str = home.path().to_string_lossy().into_owned();
    temp_env::async_with_vars([("CODEG_HOME", Some(home_str.as_str()))], async {
            let start = || ("_zcode/turnState", serde_json::json!({"sessionId":"s1","running":true}));
            let end = |input: u64, ms: u64| serde_json::json!({
                "sessionId":"s1","running":false,"turnMs":ms,
                "usage":{"inputTokens":input,"outputTokens":350,"cachedReadTokens":900,"cachedWriteTokens":120,"totalTokens":input+1370}
            });
            let mut lp = CustomLoop::start_for(AgentType::Zcode, vec![
                vec![start(),
                    custom_update(serde_json::json!({"sessionUpdate":"usage_update","used":9999,"size":131072})),
                    ("_zcode/turnState",end(180,4200)),
                    ("$/zcode/turnState",end(9999,9999)),
                    ("_zcode/turnState",end(9999,9999)), custom_text("first")],
                vec![start(), ("_zcode/turnState",end(12,1700)), custom_text("second")],
                // A late prior-turn end and idle/replay data have no opening
                // marker in this prompt, so they cannot seed its metadata.
                vec![("_zcode/turnState",end(9999,9999)),custom_text("third")],
            ]).await;
            lp.agent_sends(vec![custom_text("startup replay must not be recorded"),start(),("_zcode/turnState",end(9999,9999)),grok_barrier()]);
            lp.until_barrier().await;
            let parser = || crate::parsers::acp_native::AcpNativeParser::new_in(
                AgentType::Zcode, crate::paths::codeg_acp_transcripts_root(),
            );
            lp.run_turn("one", "first").await;
            // TurnComplete is the refetch trigger: its footer must already be
            // durable and readable, without a test-only flush after the event.
            let first = parser().get_conversation("s1").unwrap();
            let usage = first.turns[1].usage.as_ref().unwrap();
            assert_eq!((usage.input_tokens,usage.output_tokens,usage.cache_read_input_tokens,usage.cache_creation_input_tokens),(180,350,900,120));
            assert_eq!(first.turns[1].duration_ms,Some(4200));
            let stats = first.session_stats.unwrap();
            assert_eq!(stats.total_tokens,Some(1550));
            assert_eq!(stats.context_window_used_tokens,Some(9999));
            assert_eq!(stats.total_duration_ms,4200);
            lp.run_turn("two", "second").await;
            lp.run_turn("three", "third").await;
            let cold = parser().get_conversation("s1").unwrap();
            assert_eq!(cold.turns.len(),6);
            assert_eq!(cold.turns[3].usage.as_ref().unwrap().input_tokens,12);
            assert_eq!(cold.turns[3].duration_ms,Some(1700));
            assert!(cold.turns[5].usage.is_none());
            let raw = crate::acp_transcript::read_transcript("codeg-zcode-acp","s1");
            assert_eq!(raw.entries.iter().filter(|e| e.k==crate::acp_transcript::EntryKind::TurnEnd).count(),3);
            assert!(raw.entries.iter().rev().find(|e| e.k==crate::acp_transcript::EntryKind::TurnEnd).unwrap().p.get("usage").is_none());
            lp.shutdown().await;
        }).await;
}

/// A local cancel lets go of the prompt without waiting for the agent, so
/// the cancelled reply's last frames land on the idle loop. No turn end is
/// recorded ahead of them (as for every agent whose history is codeg's
/// transcript): the late chunk stays part of the reply it ends, and the
/// bridge's late report for the cancelled work bills no other prompt.
#[tokio::test]
async fn zcode_cancel_keeps_the_late_tail_in_its_reply_and_bills_no_other_prompt() {
    use crate::parsers::AgentParser as _;
    let home = tempfile::tempdir().unwrap();
    let home_str = home.path().to_string_lossy().into_owned();
    temp_env::async_with_vars([("CODEG_HOME", Some(home_str.as_str()))], async {
            let turn_state = |body: serde_json::Value| ("_zcode/turnState", body);
            let start = || turn_state(serde_json::json!({"sessionId": "s1", "running": true}));
            let end = |input: u64| {
                turn_state(serde_json::json!({
                    "sessionId": "s1", "running": false, "turnMs": 42,
                    "usage": {"inputTokens": input, "outputTokens": 12}
                }))
            };
            let mut lp = CustomLoop::start_for(
                AgentType::Zcode,
                vec![
                    vec![start(), end(30), custom_text("first")],
                    vec![start(), custom_text("working, ")],
                    vec![start(), end(5), custom_text("third")],
                ],
            )
            .await;
            lp.run_turn("one", "first").await;
            lp.open_turn("two", "working, ").await;
            lp.cmd_tx.send(ConnectionCommand::Cancel).await.unwrap();
            lp.until("cancelled", |e| {
                matches!(e, AcpEvent::TurnComplete { stop_reason, .. } if stop_reason == "cancelled")
            })
            .await;
            lp.agent_sends(vec![custom_text("late tail"), end(777), grok_barrier()]);
            lp.until_barrier().await;
            // The cancelled prompt's own response, which nothing waits on.
            lp.respond.notify_one();
            lp.run_turn("three", "third").await;

            let raw = crate::acp_transcript::read_transcript("codeg-zcode-acp", "s1");
            let ends: Vec<_> = raw
                .entries
                .iter()
                .filter(|e| e.k == crate::acp_transcript::EntryKind::TurnEnd)
                .collect();
            assert_eq!(ends.len(), 2, "a local cancel records no turn end");
            assert_eq!(ends[0].p["usage"]["inputTokens"], 30);
            assert_eq!(ends[1].p["usage"]["inputTokens"], 5);
            let history = crate::parsers::acp_native::AcpNativeParser::new_in(
                AgentType::Zcode,
                crate::paths::codeg_acp_transcripts_root(),
            )
            .get_conversation("s1")
            .unwrap();
            assert_eq!(
                turn_shape(&history.turns),
                [
                    "User: text \"one\"",
                    "Assistant: text \"first\"",
                    "User: text \"two\"",
                    "Assistant: text \"working, late tail\"",
                    "User: text \"three\"",
                    "Assistant: text \"third\"",
                ]
            );
            assert!(history.turns[3].usage.is_none());
            lp.shutdown().await;
        })
        .await;
}

/// One prompt can hold several busy windows: a compaction it waited
/// behind (reported bare), then the rounds of an `/auto` loop. Each round
/// reports its own usage, so the reply carries their total; its duration
/// is codeg's own measurement of the prompt, not any round's clock.
#[tokio::test]
async fn zcode_a_prompt_held_over_several_windows_totals_them_on_codegs_clock() {
    use crate::parsers::AgentParser as _;
    let home = tempfile::tempdir().unwrap();
    let home_str = home.path().to_string_lossy().into_owned();
    temp_env::async_with_vars([("CODEG_HOME", Some(home_str.as_str()))], async {
        let turn_state = |body: serde_json::Value| ("_zcode/turnState", body);
        let start = || turn_state(serde_json::json!({"sessionId": "s1", "running": true}));
        let end = |input: u64, ms: u64| {
            turn_state(serde_json::json!({
                "sessionId": "s1", "running": false, "turnMs": ms,
                "usage": {"inputTokens": input, "outputTokens": 10, "cachedReadTokens": 100}
            }))
        };
        let mut lp = CustomLoop::start_for(
            AgentType::Zcode,
            vec![vec![
                start(),
                turn_state(serde_json::json!({"sessionId": "s1", "running": false})),
                start(),
                custom_text("round one, "),
                end(40, 3_600_000),
                start(),
                end(2, 1_800_000),
                custom_text("round two"),
            ]],
        )
        .await;
        lp.run_turn("/auto ship it", "round two").await;

        let history = crate::parsers::acp_native::AcpNativeParser::new_in(
            AgentType::Zcode,
            crate::paths::codeg_acp_transcripts_root(),
        )
        .get_conversation("s1")
        .unwrap();
        assert_eq!(
            turn_shape(&history.turns),
            [
                "User: text \"/auto ship it\"",
                "Assistant: text \"round one, round two\"",
            ]
        );
        let reply = &history.turns[1];
        let usage = reply.usage.as_ref().unwrap();
        assert_eq!(
            (
                usage.input_tokens,
                usage.output_tokens,
                usage.cache_read_input_tokens,
                usage.cache_creation_input_tokens
            ),
            (42, 20, 200, 0)
        );
        let duration = reply.duration_ms.unwrap();
        assert!(duration < 1_800_000, "codeg's clock, got {duration}");
        lp.shutdown().await;
    })
    .await;
}
