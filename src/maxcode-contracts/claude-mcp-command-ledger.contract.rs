use super::*;

#[test]
fn mcp_command_identity_dedupes_once_without_consuming_literal_prose() {
    let ledger = PromptLedger::shared();
    ledger.record_text("/mcp:my.server:greet hello");
    assert!(!ledger.consume_matching(&TurnInitiatorText::Verbatim(
        "/mcp__my_server__greet hello".into()
    )));
    assert!(
        !ledger.consume_matching(&TurnInitiatorText::ReconstructedSlashCommand(
            "/mcp__my_server__greet hello again".into()
        ))
    );
    let recorded =
        TurnInitiatorText::ReconstructedSlashCommand("/mcp__my_server__greet hello".into());
    assert!(ledger.consume_matching(&recorded));
    assert!(!ledger.consume_matching(&recorded));
}
