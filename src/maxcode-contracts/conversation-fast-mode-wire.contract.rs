//! A saved Fast choice survives adapters changing between select and boolean.
use super::*;
use agent_client_protocol::schema::v1::SetSessionConfigOptionResponse;

fn fast_option(boolean: bool, enabled: bool) -> SessionConfigOption {
    let json = if boolean {
        serde_json::json!({
            "id": "fast-mode", "name": "Fast mode", "type": "boolean",
            "currentValue": enabled,
        })
    } else {
        serde_json::json!({
            "id": "fast-mode", "name": "Fast mode", "type": "select",
            "currentValue": if enabled { "on" } else { "off" },
            "options": [{"value": "on", "name": "On"}, {"value": "off", "name": "Off"}],
        })
    };
    serde_json::from_value(json).unwrap()
}

async fn resume_fast(
    boolean: bool,
    initial_enabled: bool,
    saved: &str,
) -> (Vec<serde_json::Value>, String, BTreeMap<String, String>) {
    let received = Arc::new(std::sync::Mutex::new(Vec::new()));
    let agent_received = Arc::clone(&received);
    let (client_end, agent_end) = agent_client_protocol::Channel::duplex();
    let agent = tokio::spawn(async move {
        let _ = Agent
            .builder()
            .on_receive_request(
                async move |_req: NewSessionRequest,
                            responder: Responder<NewSessionResponse>,
                            _cx: ConnectionTo<Client>| {
                    responder.respond(
                        NewSessionResponse::new(SessionId::new("fast"))
                            .config_options(vec![fast_option(boolean, initial_enabled)]),
                    )
                },
                on_receive_request!(),
            )
            .on_receive_request(
                async move |req: SetSessionConfigOptionRequest,
                            responder: Responder<SetSessionConfigOptionResponse>,
                            _cx: ConnectionTo<Client>| {
                    let wire = serde_json::to_value(req).unwrap();
                    let value = wire["value"].clone();
                    let enabled = value == true || value == "on";
                    agent_received.lock().unwrap().push(value);
                    responder.respond(SetSessionConfigOptionResponse::new(vec![fast_option(
                        boolean, enabled,
                    )]))
                },
                on_receive_request!(),
            )
            .connect_with(agent_end, async |_cx: ConnectionTo<Client>| {
                std::future::pending::<Result<(), agent_client_protocol::Error>>().await
            })
            .await;
    });
    let state = Arc::new(RwLock::new(SessionState::new(
        "fast".into(),
        AgentType::Codex,
        None,
        "web".into(),
        None,
    )));
    let establishment_state = Arc::clone(&state);
    let preferred = BTreeMap::from([("fast-mode".to_string(), saved.to_string())]);
    let current = Client
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
            let initial = response.config_options.clone().unwrap_or_default();
            let mut session = AgentSession::attach(&cx, response)?;
            let result = apply_preferred_session_options(
                &cx,
                &mut session,
                &establishment_state,
                &EventEmitter::Noop,
                AgentType::Codex,
                None,
                &preferred,
                None,
                initial,
            )
            .await?;
            Ok(
                current_config_option_values(&map_session_config_options(&result))["fast-mode"]
                    .clone(),
            )
        })
        .await
        .expect("session establishment succeeds");
    agent.abort();
    let requests = received.lock().unwrap().clone();
    let asserted = state.read().await.asserted_config_values.clone();
    (requests, current, asserted)
}

#[tokio::test]
async fn fast_selection_survives_a_change_in_the_adapter_option_type() {
    for (boolean, initial, saved, wire, expected) in [
        (true, false, "on", serde_json::json!(true), "true"),
        (false, false, "true", serde_json::json!("on"), "on"),
        (true, true, "off", serde_json::json!(false), "false"),
        (false, true, "false", serde_json::json!("off"), "off"),
        (false, true, "off", serde_json::json!("off"), "off"),
    ] {
        let (requests, current, asserted) = resume_fast(boolean, initial, saved).await;
        assert_eq!(requests, vec![wire]);
        assert_eq!(current, expected);
        assert_eq!(
            asserted.get("fast-mode").map(String::as_str),
            Some(expected)
        );
    }
}
