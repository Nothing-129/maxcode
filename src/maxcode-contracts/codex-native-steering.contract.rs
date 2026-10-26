use super::*;

const FIXTURE: &str = include_str!("fixtures/codex-steering-2.2.2.txt");

#[test]
fn launch_copy_preserves_installed_package_and_module_resolution() {
    let dir = tempfile::tempdir().unwrap();
    let package = dir.path().join("package with spaces");
    std::fs::create_dir_all(package.join("dist")).unwrap();
    std::fs::write(
        package.join("package.json"),
        r#"{"name":"@agentclientprotocol/codex-acp","version":"2.2.2"}"#,
    )
    .unwrap();
    let entry = package.join("dist/index.js");
    let source = format!("{FIXTURE}\nconst original = import.meta.url;");
    std::fs::write(&entry, &source).unwrap();
    let scratch = dir.path().join("scratch");
    std::fs::create_dir(&scratch).unwrap();
    let (_, copy) = prepare(&entry, Some(&scratch)).expect("reviewed adapter launch");
    assert!(copy.starts_with(&scratch));
    assert_eq!(std::fs::read_to_string(&entry).unwrap(), source);
    let copied = std::fs::read_to_string(copy).unwrap();
    assert!(!copied.contains("import.meta.url"));
    assert!(copied.contains("package%20with%20spaces/dist/index.js"));
    assert!(prepare(&entry, None).is_none());
    std::fs::write(
        package.join("package.json"),
        r#"{"name":"@agentclientprotocol/codex-acp","version":"9.0.0"}"#,
    )
    .unwrap();
    assert!(prepare(&entry, Some(&scratch)).is_none());
}

#[test]
fn unknown_or_already_transformed_adapter_cannot_claim_compatibility() {
    assert!(patch_source("arbitrary JavaScript").is_none());
    let patched = patch_source(FIXTURE).unwrap();
    assert_eq!(
        patch_source(&FIXTURE.replace("\r\n", "\n").replace('\n', "\r\n")),
        Some(patched.clone()),
        "Windows line endings preserve the reviewed adapter contract"
    );
    assert!(patch_source(&patched).is_none());
    assert!(patch_source(&FIXTURE.replace("supported: true", "supported: false")).is_none());
    let peer = agent_client_protocol::schema::v1::Implementation::new("codex-acp", "2.2.2");
    let plain = serde_json::json!({"steering":{"supported":true}});
    let safe = serde_json::json!({"steering":{"supported":true,"maxcodePromptRequired":1}});
    assert!(!advertises_safe_steering(plain.as_object(), Some(&peer)));
    assert!(advertises_safe_steering(safe.as_object(), Some(&peer)));
    assert!(!advertises_safe_steering(safe.as_object(), None));
    let other = agent_client_protocol::schema::v1::Implementation::new("codex-acp", "2.2.3");
    assert!(!advertises_safe_steering(safe.as_object(), Some(&other)));
}

#[test]
fn reviewed_adapter_delivers_once_and_leaves_ended_turns_host_owned() {
    let patched = patch_source(FIXTURE).unwrap();
    let harness = r#"
const assert = require('node:assert/strict');
(async () => {
  function setup() {
    const agent = new Agent();
    const owner = {};
    const state = {sessionId: 's', currentTurnId: 't'};
    agent.activePrompts = new Map([['s', owner]]);
    agent.pendingTurnStarts = new Map();
    agent.steeringQueues = new Map();
    agent.getSessionState = () => state;
    agent.assertSteerInputSupported = () => {};
    agent.sessionIsClosing = () => false;
    agent.runWithProcessCheck = fn => fn();
    agent.isNoActiveTurnToSteerError = e => e.message === 'no active turn to steer';
    let calls = 0, starts = 0;
    agent.codexAcpClient = {
      steerTurn: async ({turnId, prompt}) => {
        assert.equal(turnId, 't');
        assert.equal(prompt[1].type, 'image');
        calls++;
      },
      waitForSessionNotifications: async () => {},
    };
    agent.startNewTurnFromSteering = async () => { starts++; return {outcome: 'startedNewTurn'}; };
    agent.getSteeringQueue = () => ({enqueue: p => agent.performSteeringRequest(p)});
    const params = () => agent.parseSessionSteerParams({sessionId: 's', prompt: [
      {type: 'text', text: 'change direction'}, {type: 'image', data: 'aGVsbG8=', mimeType: 'image/png'}
    ], _meta: {steering: {idleBehavior: 'promptRequired'}}});
    return {agent, state, params, calls: () => calls, starts: () => starts};
  }
  let h = setup();
  assert.equal(h.agent.initialize().steering.maxcodePromptRequired, 1);
  assert.equal((await h.agent.executeOrQueueSteeringRequest(h.params())).outcome, 'injected');
  assert.equal(h.calls(), 1);
  assert.equal(h.starts(), 0);
  assert.ok(h.agent.activePrompts.has('s'), 'owning prompt survives injection');

  h = setup(); h.state.currentTurnId = null; h.agent.activePrompts.clear();
  assert.equal((await h.agent.executeOrQueueSteeringRequest(h.params())).outcome, 'promptRequired');
  assert.equal(h.calls(), 0); assert.equal(h.starts(), 0);

  h = setup();
  h.agent.codexAcpClient.steerTurn = async () => {
    h.state.currentTurnId = null;
    throw Error('no active turn to steer');
  };
  assert.equal((await h.agent.executeOrQueueSteeringRequest(h.params())).outcome, 'promptRequired');
  assert.equal(h.starts(), 0);

  h = setup();
  h.agent.getSteeringQueue = () => ({enqueue: async p => {
    h.agent.activePrompts.set('s', {}); // next prompt started while queued
    return h.agent.performSteeringRequest(p);
  }});
  assert.equal((await h.agent.executeOrQueueSteeringRequest(h.params())).outcome, 'promptRequired');
  assert.equal(h.calls(), 0); assert.equal(h.starts(), 0);

  h = setup(); h.state.currentTurnId = null;
  let begin;
  h.agent.pendingTurnStarts.set('s', {promise: new Promise(r => begin = r)});
  const waiting = h.agent.executeOrQueueSteeringRequest(h.params());
  begin('t');
  assert.equal((await waiting).outcome, 'injected');
  assert.equal(h.calls(), 1); assert.equal(h.starts(), 0);

  h = setup();
  h.agent.codexAcpClient.steerTurn = async () => { throw Error('transport failed'); };
  assert.equal((await h.agent.executeOrQueueSteeringRequest(h.params())).outcome, 'failed');
  assert.equal(h.starts(), 0);
})().catch(error => { console.error(error); process.exitCode = 1; });
"#;
    let dir = tempfile::tempdir().unwrap();
    let script = dir.path().join("contract.cjs");
    std::fs::write(&script, format!("{patched}\n{harness}")).unwrap();
    let output = std::process::Command::new("node")
        .arg(script)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}
