use super::*;
use agent_client_protocol::schema::v1::{
    PromptResponse, SetSessionConfigOptionResponse, SetSessionModeResponse,
};
use std::sync::Mutex;

fn mode_options(mode: &str) -> Vec<SessionConfigOption> {
    serde_json::from_value(serde_json::json!([{
        "id": "mode", "name": "Mode", "category": "mode", "type": "select",
        "currentValue": mode,
        "options": [
            {"value":"build","name":"Build"},
            {"value":"plan","name":"Plan"},
            {"value":"yolo","name":"Yolo"}
        ]
    }]))
    .unwrap()
}

async fn drive_mode_gate(preferred: Option<&str>, confirm: bool, accept_mode: bool) -> Vec<String> {
    drive_mode_gate_with_cancel(preferred, confirm, accept_mode, false).await
}

async fn drive_mode_gate_with_cancel(
    preferred: Option<&str>,
    confirm: bool,
    accept_mode: bool,
    cancel_mode: bool,
) -> Vec<String> {
    let handshake = CancellationToken::new();
    let native_handshake = handshake.clone();
    let seen = Arc::new(Mutex::new(Vec::<String>::new()));
    let seen_mode = seen.clone();
    let seen_legacy = seen.clone();
    let native_mode = Arc::new(Mutex::new(None::<String>));
    let native_set = native_mode.clone();
    let native_config = native_mode.clone();
    let seen_prompt = seen.clone();
    let (client_end, agent_end) = agent_client_protocol::Channel::duplex();
    let agent = tokio::spawn(
        Agent
            .builder()
            .on_receive_request(
                async move |req: SetSessionModeRequest,
                            responder: Responder<SetSessionModeResponse>,
                            _cx: ConnectionTo<Client>| {
                    seen_legacy
                        .lock()
                        .unwrap()
                        .push(format!("mode:{}", req.mode_id));
                    if cancel_mode {
                        native_handshake.cancel();
                        std::future::pending::<()>().await;
                    }
                    if accept_mode {
                        *native_set.lock().unwrap() = Some(req.mode_id.to_string());
                        responder.respond(SetSessionModeResponse::new())
                    } else {
                        responder.respond_with_error(
                            agent_client_protocol::Error::invalid_params().data("mode rejected"),
                        )
                    }
                },
                on_receive_request!(),
            )
            .on_receive_request(
                async move |req: SetSessionConfigOptionRequest,
                            responder: Responder<SetSessionConfigOptionResponse>,
                            _cx: ConnectionTo<Client>| {
                    let value = serde_json::to_value(&req.value).unwrap();
                    let mode = value["value"].as_str().unwrap().to_string();
                    seen_mode.lock().unwrap().push(format!("config:{mode}"));
                    if confirm && native_config.lock().unwrap().as_deref() == Some(mode.as_str()) {
                        responder.respond(SetSessionConfigOptionResponse::new(mode_options(&mode)))
                    } else {
                        responder.respond(SetSessionConfigOptionResponse::new(mode_options("yolo")))
                    }
                },
                on_receive_request!(),
            )
            .on_receive_request(
                async move |_req: PromptRequest,
                            responder: Responder<PromptResponse>,
                            _cx: ConnectionTo<Client>| {
                    seen_prompt.lock().unwrap().push("prompt".into());
                    responder.respond(PromptResponse::new(StopReason::EndTurn))
                },
                on_receive_request!(),
            )
            .connect_to(agent_end),
    );
    Client
        .builder()
        .connect_with(client_end, async |cx: ConnectionTo<Agent>| {
            let modes: SessionModeState = serde_json::from_value(serde_json::json!({
                "currentModeId":"yolo",
                "availableModes":[{"id":"build","name":"Build"},{"id":"plan","name":"Plan"},{"id":"yolo","name":"Yolo"}]
            }))
            .unwrap();
            let response = NewSessionResponse::new(SessionId::new("zcode-test"))
                .modes(modes)
                .config_options(mode_options("yolo"));
            let session = AgentSession::attach(&cx, response)?;
            let result = configure_new_zcode_session(
                AgentType::Zcode,
                &cx,
                &session,
                &handshake,
                preferred,
                &BTreeMap::new(),
                Some(mode_options("yolo")),
            )
            .await;
            if cancel_mode {
                assert!(result.unwrap_err().to_string().contains(HANDSHAKE_CANCELLED_SENTINEL));
            } else if confirm && accept_mode {
                let (_, preferences) = result?;
                assert_eq!(
                    preferences.get("mode").map(String::as_str),
                    Some(preferred.unwrap_or("build"))
                );
                cx.send_request_to(
                    Agent,
                    PromptRequest::new(session.session_id().clone(), vec![]),
                )
                .block_task()
                .await?;
            } else {
                assert!(
                    result.is_err(),
                    "a contradictory confirmation must block prompting"
                );
            }
            Ok::<_, agent_client_protocol::Error>(())
        })
        .await
        .unwrap();
    agent.abort();
    let observed = seen.lock().unwrap().clone();
    observed
}

#[tokio::test]
async fn zcode_confirms_build_before_first_prompt() {
    assert_eq!(
        drive_mode_gate(None, true, true).await,
        vec!["mode:build", "config:build", "prompt"]
    );
}

#[tokio::test]
async fn zcode_preserves_explicit_yolo_choice() {
    assert_eq!(
        drive_mode_gate(Some("yolo"), true, true).await,
        vec!["mode:yolo", "config:yolo", "prompt"]
    );
}

#[tokio::test]
async fn zcode_does_not_prompt_after_failed_mode_confirmation() {
    assert_eq!(
        drive_mode_gate(None, false, true).await,
        vec!["mode:build", "config:build"]
    );
}

#[tokio::test]
async fn zcode_plan_updates_native_mode_before_confirming_config() {
    assert_eq!(
        drive_mode_gate(Some("plan"), true, true).await,
        vec!["mode:plan", "config:plan", "prompt"]
    );
}

#[tokio::test]
async fn zcode_does_not_prompt_or_set_config_after_rejected_native_mode() {
    assert_eq!(drive_mode_gate(None, true, false).await, vec!["mode:build"]);
}

#[tokio::test]
async fn zcode_cancelled_handshake_stops_mode_confirmation_before_config_or_prompt() {
    let observed = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        drive_mode_gate_with_cancel(None, true, true, true),
    )
    .await
    .expect("a cancelled ZCode handshake must not wait for mode confirmation");
    assert_eq!(observed, vec!["mode:build"]);
}

#[test]
fn zcode_does_not_replay_the_mode_its_gate_applied() {
    assert_eq!(
        mode_to_replay_after_gate(AgentType::Zcode, Some("plan".into())),
        None
    );
    assert_eq!(
        mode_to_replay_after_gate(AgentType::OpenCode, Some("plan".into())),
        Some("plan".to_string())
    );
    assert_eq!(mode_to_replay_after_gate(AgentType::OpenCode, None), None);
}

#[test]
fn zcode_does_not_offer_unvalidated_attachments() {
    let advertised = agent_client_protocol::schema::v1::PromptCapabilities::default()
        .image(true)
        .audio(true)
        .embedded_context(true);
    let zcode = effective_prompt_capabilities(AgentType::Zcode, &advertised);
    assert!(!zcode.image && !zcode.audio && !zcode.embedded_context);
    let other = effective_prompt_capabilities(AgentType::KimiCode, &advertised);
    assert!(other.image && other.audio && other.embedded_context);
}

#[test]
fn zcode_records_history_without_enabling_native_parser_agents() {
    assert_eq!(
        transcript_dir_for(AgentType::Zcode),
        Some("codeg-zcode-acp")
    );
    assert_eq!(transcript_dir_for(AgentType::ClaudeCode), None);
    assert_eq!(transcript_dir_for(AgentType::DeepSeek), None);
    assert!(transcript_dir_for(AgentType::custom("example").unwrap()).is_some());
}
