use super::*;

fn permission_request(name: &str, kinds: &[PermissionOptionKind]) -> RequestPermissionRequest {
    RequestPermissionRequest::new(
        SessionId::new("maxcode-contract"),
        sacp::schema::ToolCallUpdate::new(
            "ask",
            sacp::schema::ToolCallUpdateFields::new().title(name.to_owned()),
        ),
        kinds
            .iter()
            .enumerate()
            .map(|(index, kind)| {
                sacp::schema::PermissionOption::new(index.to_string(), "Choose", *kind)
            })
            .collect(),
    )
}

#[test]
fn only_our_exact_ask_tool_can_skip_its_redundant_approval() {
    for name in [
        "mcp__codeg-mcp__ask_user_question",
        "codeg-mcp/ask_user_question",
        "codeg-mcp: ask_user_question",
        "MCP.Codeg-MCP.Ask_User_Question",
    ] {
        let req = permission_request(name, &[PermissionOptionKind::AllowOnce]);
        assert_eq!(
            codeg_ask_auto_allow_option(&req, true).as_deref(),
            Some("0")
        );
        assert_eq!(codeg_ask_auto_allow_option(&req, false), None);
    }
    for name in [
        "mcp__codeg-mcp-ask__user_question",
        "mcp__codeg__mcp_ask_user_question",
        "codeg-mcp-ask/user_question",
        "mcp__codeg_mcp__ask_user_question",
        "mcp__not-codeg-mcp__ask_user_question",
        "mcp__codeg-mcp-external__ask_user_question",
        "mcp__other__codeg_mcp_ask_user_question",
        "mcp__codeg-mcp__dangerous_ask_user_question",
        "mcp__codeg-mcp__ask_user_question_and_execute",
        "mcp__codeg-mcp__delegate_to_agent",
        "ask_user_question",
    ] {
        let req = permission_request(name, &[PermissionOptionKind::AllowOnce]);
        assert_eq!(codeg_ask_auto_allow_option(&req, true), None, "{name}");
    }
}

#[test]
fn own_ask_never_writes_a_persistent_allow_rule() {
    let name = "mcp__codeg-mcp__ask_user_question";
    let req = permission_request(name, &[PermissionOptionKind::AllowAlways]);
    assert_eq!(codeg_ask_auto_allow_option(&req, true), None);
    let req = permission_request(
        name,
        &[
            PermissionOptionKind::AllowAlways,
            PermissionOptionKind::AllowOnce,
        ],
    );
    assert_eq!(
        codeg_ask_auto_allow_option(&req, true).as_deref(),
        Some("1")
    );
}
