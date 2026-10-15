//! Contracts for independent human todos and member-scoped team access.
use super::*;
use crate::db::test_helpers::fresh_in_memory_db;

fn avatar() -> String {
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(1, 1)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    format!(
        "data:image/png;base64,{}",
        STANDARD.encode(png.into_inner())
    )
}
fn request(action: &str) -> TodoRequest {
    TodoRequest {
        action: action.to_string(),
        ..Default::default()
    }
}
async fn team(conn: &DatabaseConnection, name: &str) -> TodoState {
    call(
        conn,
        TodoRequest {
            action: "create_team".to_string(),
            name: Some(name.to_string()),
            member_name: Some("Host".to_string()),
            avatar: Some(avatar()),
            ..Default::default()
        },
    )
    .await
    .unwrap()
}
async fn token(conn: &DatabaseConnection, id: &str) -> String {
    field(
        &rows(
            conn,
            "SELECT member_token FROM maxcode_todo_team WHERE id=?",
            vec![id.into()],
        )
        .await
        .unwrap()[0],
        "member_token",
    )
    .unwrap()
}
#[tokio::test]
async fn todo_scope_isolation_and_preferences_survive_reentry() {
    let db = fresh_in_memory_db().await;
    let personal = call(
        &db.conn,
        TodoRequest {
            action: "create".to_string(),
            content: Some("Personal notes".to_string()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(personal.todos.len(), 1);
    let first = team(&db.conn, "First").await;
    assert!(first.todos.is_empty());
    assert!(first.team_code.is_none());
    let id = first.active_team_id.unwrap();
    let state = call(
        &db.conn,
        TodoRequest {
            action: "create".to_string(),
            content: Some("Team notes".to_string()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(state.todos.len(), 1);
    assert_eq!(state.todos[0].title, "Team notes");
    let second = team(&db.conn, "Second").await;
    assert!(second.todos.is_empty());
    let selected = call(
        &db.conn,
        TodoRequest {
            action: "set_mode".to_string(),
            mode: Some("team".to_string()),
            team_id: Some(id.clone()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(selected.todos[0].content, "Team notes");
    let personal = call(
        &db.conn,
        TodoRequest {
            action: "set_mode".to_string(),
            mode: Some("personal".to_string()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(personal.todos[0].content, "Personal notes");
    let selected = call(
        &db.conn,
        TodoRequest {
            action: "set_mode".to_string(),
            mode: Some("team".to_string()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(selected.active_team_id, Some(id));
    assert_eq!(selected.todos[0].content, "Team notes");
}
#[tokio::test]
async fn member_capability_cannot_access_other_scopes_or_local_conversations() {
    let db = fresh_in_memory_db().await;
    let a = team(&db.conn, "A").await;
    let id = a.active_team_id.unwrap();
    let member_token = token(&db.conn, &id).await;
    let b = team(&db.conn, "B").await;
    let other = b.active_team_id.unwrap();
    let result = member_call(
        &db.conn,
        TeamMemberRequest {
            token: member_token.clone(),
            request: TodoRequest {
                action: "create".to_string(),
                team_id: Some(other),
                title: Some("Scoped".to_string()),
                content: Some("Member task".to_string()),
                ..Default::default()
            },
        },
    )
    .await
    .unwrap();
    assert_eq!(result.active_team_id, Some(id));
    assert_eq!(result.teams.len(), 1);
    assert_eq!(result.teams[0].name, "A");
    assert_eq!(result.todos.len(), 1);
    assert!(call(&db.conn, request("state"))
        .await
        .unwrap()
        .todos
        .is_empty());
    for action in ["set_mode", "create_team", "join_team"] {
        assert!(member_call(
            &db.conn,
            TeamMemberRequest {
                token: member_token.clone(),
                request: request(action)
            }
        )
        .await
        .is_err());
    }
    assert!(member_call(
        &db.conn,
        TeamMemberRequest {
            token: member_token.clone(),
            request: TodoRequest {
                action: "create".to_string(),
                conversation_id: Some(1),
                ..Default::default()
            }
        }
    )
    .await
    .is_err());
    assert!(member_call(
        &db.conn,
        TeamMemberRequest {
            token: "invalid".to_string(),
            request: request("state")
        }
    )
    .await
    .is_err());
    assert!(member_call(
        &db.conn,
        TeamMemberRequest {
            token: member_token,
            request: TodoRequest {
                action: "create".to_string(),
                content: Some("Bad assignment".to_string()),
                assignee_id: Some(PERSONAL.to_string()),
                ..Default::default()
            }
        }
    )
    .await
    .is_err());
}
#[tokio::test]
async fn claims_and_all_mutations_require_current_revision() {
    let db = fresh_in_memory_db().await;
    let state = team(&db.conn, "A").await;
    let team_id = state.active_team_id.unwrap();
    let host_token = token(&db.conn, &team_id).await;
    let invite: String = field(
        &rows(
            &db.conn,
            "SELECT invite_token FROM maxcode_todo_team WHERE id=?",
            vec![team_id.clone().into()],
        )
        .await
        .unwrap()[0],
        "invite_token",
    )
    .unwrap();
    let member = join(
        &db.conn,
        TeamJoinRequest {
            team_id,
            invite,
            member_name: "Other".to_string(),
            avatar: avatar(),
            join_key: new_id(),
        },
    )
    .await
    .unwrap();
    let state = call(
        &db.conn,
        TodoRequest {
            action: "create".to_string(),
            content: Some("Claim me".to_string()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let task = &state.todos[0];
    let claim = |token: String| TeamMemberRequest {
        token,
        request: TodoRequest {
            action: "claim".to_string(),
            id: Some(task.id.clone()),
            revision: Some(1),
            ..Default::default()
        },
    };
    let (left, right) = tokio::join!(
        member_call(&db.conn, claim(host_token.clone())),
        member_call(&db.conn, claim(member.member_token.clone()))
    );
    assert_ne!(left.is_ok(), right.is_ok());
    let state = call(&db.conn, request("state")).await.unwrap();
    assert_eq!(state.todos[0].revision, 2);
    assert_eq!(state.todos[0].status, "claimed");
    let stale = TodoRequest {
        action: "update".to_string(),
        id: Some(task.id.clone()),
        revision: Some(1),
        title: Some("Overwrite".to_string()),
        content: Some("Stale".to_string()),
        ..Default::default()
    };
    assert!(member_call(
        &db.conn,
        TeamMemberRequest {
            token: member.member_token.clone(),
            request: stale
        }
    )
    .await
    .is_err());
    // Every member can complete somebody else's task.
    let done = member_call(
        &db.conn,
        TeamMemberRequest {
            token: member.member_token,
            request: TodoRequest {
                action: "complete".to_string(),
                id: Some(task.id.clone()),
                revision: Some(2),
                ..Default::default()
            },
        },
    )
    .await
    .unwrap();
    assert_eq!(done.todos[0].status, "completed");
    assert_eq!(done.todos[0].revision, 3);
    assert!(call(
        &db.conn,
        TodoRequest {
            action: "delete".to_string(),
            id: Some(task.id.clone()),
            revision: Some(2),
            ..Default::default()
        }
    )
    .await
    .is_err());
}

#[tokio::test]
async fn creation_and_join_replays_keep_one_team_member_and_todo() {
    let db = fresh_in_memory_db().await;
    let create = TodoRequest {
        action: "create_team".to_string(),
        operation_id: Some(new_id()),
        name: Some("Retry team".to_string()),
        member_name: Some("Host".to_string()),
        avatar: Some(avatar()),
        ..Default::default()
    };
    let first = call(&db.conn, create.clone()).await.unwrap();
    let again = call(&db.conn, create).await.unwrap();
    assert_eq!(first.active_team_id, again.active_team_id);
    assert_eq!(again.teams.len(), 1);
    assert_eq!(again.members.len(), 1);
    let id = first.active_team_id.unwrap();
    let invite: String = field(
        &rows(
            &db.conn,
            "SELECT invite_token FROM maxcode_todo_team WHERE id=?",
            vec![id.clone().into()],
        )
        .await
        .unwrap()[0],
        "invite_token",
    )
    .unwrap();
    let key = new_id();
    let join_request = || TeamJoinRequest {
        team_id: id.clone(),
        invite: invite.clone(),
        member_name: "Other".to_string(),
        avatar: avatar(),
        join_key: key.clone(),
    };
    let first = join(&db.conn, join_request()).await.unwrap();
    let again = join(&db.conn, join_request()).await.unwrap();
    assert_eq!(first.member_id, again.member_id);
    assert_eq!(first.member_token, again.member_token);
    let create = TodoRequest {
        action: "create".to_string(),
        operation_id: Some(new_id()),
        content: Some("Retry task".to_string()),
        ..Default::default()
    };
    let first = member_call(
        &db.conn,
        TeamMemberRequest {
            token: first.member_token.clone(),
            request: create.clone(),
        },
    )
    .await
    .unwrap();
    let again = member_call(
        &db.conn,
        TeamMemberRequest {
            token: again.member_token,
            request: create,
        },
    )
    .await
    .unwrap();
    assert_eq!(again.todos.len(), 1);
    assert_eq!(first.todos[0].id, again.todos[0].id);
    assert_eq!(again.members.len(), 2);
    let mut invalid = join_request();
    invalid.invite = "invalid".to_string();
    assert!(join(&db.conn, invalid).await.is_err());
}

#[tokio::test]
async fn task_shares_are_atomic_sanitized_replayable_and_revoked_on_delete() {
    use crate::models::{AgentType, ContentBlock, MessageTurn, TurnRole};
    let db = fresh_in_memory_db().await;
    let mut snapshot = SharedConversationSnapshot {
        version: 2,
        title: Some("Transcript".to_string()),
        agent_type: AgentType::Codex,
        model: None,
        message_count: 1,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        shared_at: Utc::now(),
        turns: vec![MessageTurn {
            id: "private-id".to_string(),
            role: TurnRole::User,
            blocks: vec![
                ContentBlock::Text {
                    text: "Shared content".to_string(),
                },
                ContentBlock::Thinking {
                    text: "private thinking".to_string(),
                },
            ],
            timestamp: Utc::now(),
            usage: None,
            duration_ms: None,
            model: None,
            completed_at: None,
            agent_message_id: None,
        }],
        share_options: Default::default(),
        session_stats: None,
    };
    let create = TodoRequest {
        action: "create".to_string(),
        operation_id: Some(new_id()),
        content: Some("Review this".to_string()),
        snapshot: Some(snapshot.clone()),
        ..Default::default()
    };
    // Internal create path tests snapshot+todo commit; local UI cannot supply
    // arbitrary snapshots, only authorized local conversation IDs.
    mutate(&db.conn, PERSONAL, PERSONAL, &create, &None)
        .await
        .unwrap();
    mutate(&db.conn, PERSONAL, PERSONAL, &create, &None)
        .await
        .unwrap();
    let state = scope_state(
        &db.conn,
        PERSONAL,
        PERSONAL,
        None,
        None,
        requested_completed_pagination(&request("state")),
    )
    .await
    .unwrap();
    assert_eq!(state.todos.len(), 1);
    let todo = &state.todos[0];
    let token = todo.source_url.as_ref().unwrap().split('#').nth(1).unwrap();
    let shared = conversation_share::get_shared_conversation_core(&db.conn, token)
        .await
        .unwrap();
    assert!(!serde_json::to_string(&shared).unwrap().contains("private"));
    assert_eq!(
        rows(&db.conn, "SELECT token FROM maxcode_todo_share", vec![])
            .await
            .unwrap()
            .len(),
        1
    );
    snapshot.turns.clear();
    let invalid = TodoRequest {
        snapshot: Some(snapshot),
        operation_id: Some(new_id()),
        ..create.clone()
    };
    assert!(mutate(&db.conn, PERSONAL, PERSONAL, &invalid, &None)
        .await
        .is_err());
    assert_eq!(
        scope_state(
            &db.conn,
            PERSONAL,
            PERSONAL,
            None,
            None,
            requested_completed_pagination(&request("state")),
        )
        .await
        .unwrap()
        .todos
        .len(),
        1
    );
    mutate(
        &db.conn,
        PERSONAL,
        PERSONAL,
        &TodoRequest {
            action: "delete".to_string(),
            id: Some(todo.id.clone()),
            revision: Some(1),
            ..Default::default()
        },
        &None,
    )
    .await
    .unwrap();
    assert!(
        conversation_share::get_shared_conversation_core(&db.conn, token)
            .await
            .is_err()
    );
}
#[test]
fn malformed_codes_and_non_raster_avatars_are_rejected() {
    for code in ["", "12345", "maxcode-team:!!!", "maxcode-team:e30"] {
        assert!(parse_code(code).is_err());
    }
    for url in [
        "file:///tmp",
        "https://user:pass@example.com",
        "https://example.com/subpath",
        "https://example.com/?token=secret",
    ] {
        let code = InviteCode {
            url: url.to_string(),
            team_id: new_id(),
            invite: new_id(),
        };
        assert!(parse_code(&format!(
            "maxcode-team:{}",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&code).unwrap())
        ))
        .is_err());
    }
    assert!(validate_profile("", &avatar()).is_err());
    assert!(validate_profile("Member", "data:image/svg+xml;base64,PHN2Zz4=").is_err());
    assert!(validate_profile("Member", "data:image/png;base64,YWJj").is_err());
    assert!(validate_profile("Member", &avatar()).is_ok());
}
#[tokio::test]
async fn offline_selection_stays_in_team_scope() {
    let db = fresh_in_memory_db().await;
    call(
        &db.conn,
        TodoRequest {
            action: "create".to_string(),
            content: Some("Private".to_string()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    execute(&db.conn,"INSERT INTO maxcode_todo_team (id,name,url,is_local,self_id,member_token) VALUES ('remote','Offline','http://127.0.0.1:1',0,'me','secret')",vec![]).await.unwrap();
    let state = call(
        &db.conn,
        TodoRequest {
            action: "set_mode".to_string(),
            mode: Some("team".to_string()),
            team_id: Some("remote".to_string()),
            completed_page: Some(3),
            completed_page_size: Some(10),
            completed_search: Some(" Review ".to_string()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(state.mode, "team");
    assert_eq!(state.active_team_id.as_deref(), Some("remote"));
    assert!(state.todos.is_empty());
    assert!(state.connection_error.is_some());
    assert_eq!(state.completed_pagination.page, 3);
    assert_eq!(state.completed_pagination.page_size, 10);
    assert_eq!(state.completed_pagination.total, 0);
    assert_eq!(state.completed_pagination.search, "Review");
    let state = call(&db.conn, request("state")).await.unwrap();
    assert_eq!(state.mode, "team");
    assert!(state.todos.is_empty());
    assert_eq!(state.completed_pagination.page, 1);
    assert_eq!(state.completed_pagination.page_size, 20);
    assert_eq!(state.completed_pagination.total, 0);
    assert!(state.completed_pagination.search.is_empty());
}

#[tokio::test]
async fn hosted_team_startup_does_not_depend_on_selected_todo_scope() {
    let db = fresh_in_memory_db().await;
    let url = Some("https://team.example.com");
    assert!(!hosted_team_service_required(&db.conn, url).await.unwrap());
    team(&db.conn, "Host").await;
    assert!(!hosted_team_service_required(&db.conn, None).await.unwrap());
    assert!(hosted_team_service_required(&db.conn, url).await.unwrap());
    call(
        &db.conn,
        TodoRequest {
            action: "set_mode".to_string(),
            mode: Some("personal".to_string()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(hosted_team_service_required(&db.conn, url).await.unwrap());
    execute(&db.conn,"INSERT INTO maxcode_todo_team (id,name,url,is_local,self_id,member_token) VALUES ('remote','Other','http://127.0.0.1:1',0,'me','token')",vec![]).await.unwrap();
    select_team(&db.conn, "remote").await.unwrap();
    assert!(hosted_team_service_required(&db.conn, url).await.unwrap());
}

#[tokio::test]
async fn editing_without_a_title_generates_one_and_preserves_status_and_share() {
    let db = fresh_in_memory_db().await;
    let original = call(
        &db.conn,
        TodoRequest {
            action: "create".to_string(),
            title: Some("Original".to_string()),
            content: Some("Original content".to_string()),
            assignee_id: Some(PERSONAL.to_string()),
            ..Default::default()
        },
    )
    .await
    .unwrap()
    .todos
    .remove(0);
    let source = "/share#0123456789abcdef0123456789abcdef";
    execute(
        &db.conn,
        "UPDATE maxcode_todo_item SET source_url=? WHERE id=?",
        vec![source.into(), original.id.clone().into()],
    )
    .await
    .unwrap();
    call(
        &db.conn,
        TodoRequest {
            action: "complete".to_string(),
            id: Some(original.id.clone()),
            revision: Some(1),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let edited = call(
        &db.conn,
        TodoRequest {
            action: "update".to_string(),
            id: Some(original.id),
            revision: Some(2),
            title: Some(String::new()),
            content: Some("\n Edited personal title\nDetails".to_string()),
            assignee_id: Some(PERSONAL.to_string()),
            // Edits keep the original snapshot; they do not look up a conversation.
            conversation_id: Some(-123),
            ..Default::default()
        },
    )
    .await
    .unwrap()
    .todos
    .remove(0);
    assert_eq!(edited.title, "Edited personal title");
    assert_eq!(edited.status, "completed");
    assert_eq!(edited.source_url.as_deref(), Some(source));
    assert_eq!(edited.revision, 3);

    let state = team(&db.conn, "Team").await;
    let team_id = state.active_team_id.unwrap();
    let self_id = state.self_id.unwrap();
    let original = call(
        &db.conn,
        TodoRequest {
            action: "create".to_string(),
            title: Some("Original".to_string()),
            content: Some("Original team content".to_string()),
            assignee_id: Some(self_id.clone()),
            ..Default::default()
        },
    )
    .await
    .unwrap()
    .todos
    .remove(0);
    execute(
        &db.conn,
        "UPDATE maxcode_todo_item SET source_url=? WHERE id=?",
        vec![source.into(), original.id.clone().into()],
    )
    .await
    .unwrap();
    let edited = member_call(
        &db.conn,
        TeamMemberRequest {
            token: token(&db.conn, &team_id).await,
            request: TodoRequest {
                action: "update".to_string(),
                id: Some(original.id),
                revision: Some(1),
                title: Some("  ".to_string()),
                content: Some("\n Edited team title\nDetails".to_string()),
                assignee_id: Some(self_id),
                ..Default::default()
            },
        },
    )
    .await
    .unwrap()
    .todos
    .remove(0);
    assert_eq!(edited.title, "Edited team title");
    assert_eq!(edited.status, "claimed");
    assert_eq!(edited.source_url.as_deref(), Some(source));
    assert_eq!(edited.revision, 2);
}

async fn seed_todos(
    conn: &DatabaseConnection,
    scope: &str,
    self_id: &str,
    completed: u32,
    unclaimed: u32,
    claimed: u32,
) {
    let txn = conn.begin().await.unwrap();
    for (status, count) in [
        ("completed", completed),
        ("unclaimed", unclaimed),
        ("claimed", claimed),
    ] {
        for index in 0..count {
            let id = format!("{scope}-{status}-{index:03}");
            let assignee = (status != "unclaimed").then(|| self_id.to_string());
            // Pairs have identical update times, exercising the id tie breaker.
            execute(
                &txn,
                "INSERT INTO maxcode_todo_item (id,scope_id,title,content,status,assignee_id,creator_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                vec![
                    id.clone().into(),
                    scope.into(),
                    format!("Task {index}").into(),
                    id.into(),
                    status.into(),
                    assignee.into(),
                    self_id.into(),
                    "2026-10-14T00:00:00Z".into(),
                    format!("2026-10-14T00:{:02}:00Z", index / 2).into(),
                ],
            )
            .await
            .unwrap();
        }
    }
    txn.commit().await.unwrap();
}

fn todo_ids(state: &TodoState, completed: bool) -> Vec<String> {
    state
        .todos
        .iter()
        .filter(|todo| (todo.status == "completed") == completed)
        .map(|todo| todo.id.clone())
        .collect()
}

fn page_request(page: u64) -> TodoRequest {
    TodoRequest {
        completed_page: Some(page),
        ..request("state")
    }
}

#[tokio::test]
async fn completed_pages_leave_every_unfinished_personal_todo_visible() {
    let db = fresh_in_memory_db().await;
    seed_todos(&db.conn, PERSONAL, PERSONAL, 45, 23, 24).await;
    let first = call(&db.conn, request("state")).await.unwrap();
    assert_eq!(first.completed_pagination.page, 1);
    assert_eq!(first.completed_pagination.page_size, 20);
    assert_eq!(first.completed_pagination.total, 45);
    assert!(first.completed_pagination.search.is_empty());
    let unfinished = todo_ids(&first, false);
    assert_eq!(unfinished.len(), 47);
    let first_ids = todo_ids(&first, true);
    assert_eq!(first_ids.len(), 20);
    assert_eq!(first_ids[0], "personal-completed-044");
    assert_eq!(first_ids[19], "personal-completed-025");

    let second = call(&db.conn, page_request(2)).await.unwrap();
    assert_eq!(second.completed_pagination.page, 2);
    assert_eq!(second.completed_pagination.total, 45);
    assert_eq!(todo_ids(&second, false), unfinished);
    let second_ids = todo_ids(&second, true);
    assert_eq!(second_ids.len(), 20);
    assert_eq!(second_ids[0], "personal-completed-024");
    assert_eq!(second_ids[19], "personal-completed-005");
    assert!(first_ids.iter().all(|id| !second_ids.contains(id)));

    let last = call(&db.conn, page_request(u64::MAX)).await.unwrap();
    assert_eq!(last.completed_pagination.page, 3);
    assert_eq!(todo_ids(&last, false), unfinished);
    assert_eq!(todo_ids(&last, true).len(), 5);
    assert_eq!(todo_ids(&last, true)[0], "personal-completed-004");

    // Paging is local to this request and never becomes a shared preference.
    let first_again = call(&db.conn, request("state")).await.unwrap();
    assert_eq!(first_again.completed_pagination.page, 1);
    assert_eq!(todo_ids(&first_again, true), first_ids);
    let minimum = call(
        &db.conn,
        TodoRequest {
            completed_page: Some(0),
            completed_page_size: Some(0),
            ..request("state")
        },
    )
    .await
    .unwrap();
    assert_eq!(minimum.completed_pagination.page, 1);
    assert_eq!(minimum.completed_pagination.page_size, 1);
    assert_eq!(todo_ids(&minimum, true).len(), 1);
    assert_eq!(todo_ids(&minimum, false), unfinished);
    let maximum = call(
        &db.conn,
        TodoRequest {
            completed_page_size: Some(u64::MAX),
            ..request("state")
        },
    )
    .await
    .unwrap();
    assert_eq!(maximum.completed_pagination.page_size, 100);
    assert_eq!(todo_ids(&maximum, true).len(), 45);
}

#[tokio::test]
async fn member_paging_uses_token_scope_instead_of_caller_selection() {
    let db = fresh_in_memory_db().await;
    seed_todos(&db.conn, PERSONAL, PERSONAL, 45, 23, 24).await;
    let a = team(&db.conn, "A").await;
    let a_id = a.active_team_id.unwrap();
    let a_self = a.self_id.unwrap();
    seed_todos(&db.conn, &a_id, &a_self, 25, 25, 25).await;
    let a_token = token(&db.conn, &a_id).await;
    let b = team(&db.conn, "B").await;
    let b_id = b.active_team_id.unwrap();
    seed_todos(&db.conn, &b_id, &b.self_id.unwrap(), 41, 1, 1).await;
    let state = member_call(
        &db.conn,
        TeamMemberRequest {
            token: a_token,
            request: TodoRequest {
                mode: Some("personal".to_string()),
                team_id: Some(b_id.clone()),
                ..page_request(2)
            },
        },
    )
    .await
    .unwrap();
    assert_eq!(state.active_team_id.as_deref(), Some(a_id.as_str()));
    assert_eq!(state.completed_pagination.total, 25);
    assert_eq!(state.completed_pagination.page, 2);
    assert_eq!(todo_ids(&state, true).len(), 5);
    assert_eq!(todo_ids(&state, false).len(), 50);
    assert!(state.todos.iter().all(|todo| todo.id.starts_with(&a_id)));
    // A public member request cannot change the host's selected team.
    let selected = call(&db.conn, request("state")).await.unwrap();
    assert_eq!(selected.active_team_id.as_deref(), Some(b_id.as_str()));
    assert_eq!(selected.completed_pagination.total, 41);
    let local = call(
        &db.conn,
        TodoRequest {
            action: "set_mode".to_string(),
            mode: Some("team".to_string()),
            team_id: Some(a_id),
            completed_page: Some(2),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(todo_ids(&local, true), todo_ids(&state, true));
    assert_eq!(todo_ids(&local, false), todo_ids(&state, false));
}

#[tokio::test]
async fn completed_mutations_preserve_requested_page_and_clamp_empty_last_pages() {
    let db = fresh_in_memory_db().await;
    seed_todos(&db.conn, PERSONAL, PERSONAL, 41, 25, 25).await;
    let last = call(&db.conn, page_request(999)).await.unwrap();
    assert_eq!(last.completed_pagination.page, 3);
    assert_eq!(last.completed_pagination.total, 41);
    let last_todo = last
        .todos
        .iter()
        .find(|todo| todo.status == "completed")
        .unwrap();
    let deleted = call(
        &db.conn,
        TodoRequest {
            action: "delete".to_string(),
            id: Some(last_todo.id.clone()),
            revision: Some(last_todo.revision),
            completed_page: Some(3),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(deleted.completed_pagination.page, 2);
    assert_eq!(deleted.completed_pagination.total, 40);
    assert_eq!(todo_ids(&deleted, true).len(), 20);
    assert_eq!(todo_ids(&deleted, false).len(), 50);

    let reopened = call(
        &db.conn,
        TodoRequest {
            action: "reopen".to_string(),
            id: Some("personal-completed-001".to_string()),
            revision: Some(1),
            completed_page: Some(2),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(reopened.completed_pagination.page, 2);
    assert_eq!(reopened.completed_pagination.total, 39);
    assert_eq!(todo_ids(&reopened, true).len(), 19);
    assert_eq!(todo_ids(&reopened, false).len(), 51);
    let completed = call(
        &db.conn,
        TodoRequest {
            action: "complete".to_string(),
            id: Some("personal-completed-001".to_string()),
            revision: Some(2),
            completed_page: Some(2),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(completed.completed_pagination.page, 2);
    assert_eq!(completed.completed_pagination.total, 40);
    assert_eq!(todo_ids(&completed, true).len(), 20);
    assert_eq!(todo_ids(&completed, false).len(), 50);
}

#[tokio::test]
async fn completed_search_queries_all_pages_and_treats_wildcards_as_literals() {
    let db = fresh_in_memory_db().await;
    seed_todos(&db.conn, PERSONAL, PERSONAL, 45, 23, 24).await;
    execute(
        &db.conn,
        "UPDATE maxcode_todo_item SET title=?,content=? WHERE id='personal-completed-000'",
        vec!["Older special title".into(), "Literal 100%_\\path".into()],
    )
    .await
    .unwrap();
    let first = call(&db.conn, request("state")).await.unwrap();
    assert!(!todo_ids(&first, true).contains(&"personal-completed-000".to_string()));
    for query in [" Older SPECIAL ", "100%_\\path", "%", "_", "\\"] {
        let matched = call(
            &db.conn,
            TodoRequest {
                completed_search: Some(query.to_string()),
                ..page_request(99)
            },
        )
        .await
        .unwrap();
        assert_eq!(matched.completed_pagination.total, 1, "{query}");
        assert_eq!(matched.completed_pagination.page, 1);
        assert_eq!(matched.completed_pagination.search, query.trim());
        assert_eq!(todo_ids(&matched, true), ["personal-completed-000"]);
        assert_eq!(todo_ids(&matched, false), todo_ids(&first, false));
    }
    let assigned_to_me = call(
        &db.conn,
        TodoRequest {
            completed_search: Some("我".to_string()),
            ..page_request(2)
        },
    )
    .await
    .unwrap();
    assert_eq!(assigned_to_me.completed_pagination.total, 45);
    assert_eq!(assigned_to_me.completed_pagination.page, 2);
    assert_eq!(todo_ids(&assigned_to_me, true).len(), 20);
    let no_match = call(
        &db.conn,
        TodoRequest {
            completed_search: Some("No such completed task".to_string()),
            ..page_request(99)
        },
    )
    .await
    .unwrap();
    assert_eq!(no_match.completed_pagination.total, 0);
    assert_eq!(no_match.completed_pagination.page, 1);
    assert!(todo_ids(&no_match, true).is_empty());
    assert_eq!(todo_ids(&no_match, false), todo_ids(&first, false));
}

#[tokio::test]
async fn completed_member_search_is_scoped_and_matches_assignee_name() {
    let db = fresh_in_memory_db().await;
    seed_todos(&db.conn, PERSONAL, PERSONAL, 45, 1, 1).await;
    let a = team(&db.conn, "A").await;
    let a_id = a.active_team_id.unwrap();
    seed_todos(&db.conn, &a_id, &a.self_id.unwrap(), 25, 23, 24).await;
    let a_token = token(&db.conn, &a_id).await;
    let b = team(&db.conn, "B").await;
    let b_id = b.active_team_id.unwrap();
    seed_todos(&db.conn, &b_id, &b.self_id.unwrap(), 45, 1, 1).await;
    // Identical assignee names exist in both teams, but only A's tasks count.
    let matched = member_call(
        &db.conn,
        TeamMemberRequest {
            token: a_token.clone(),
            request: TodoRequest {
                team_id: Some(b_id.clone()),
                completed_search: Some(" host ".to_string()),
                ..page_request(2)
            },
        },
    )
    .await
    .unwrap();
    assert_eq!(matched.completed_pagination.total, 25);
    assert_eq!(matched.completed_pagination.search, "host");
    assert_eq!(todo_ids(&matched, true).len(), 5);
    assert_eq!(todo_ids(&matched, false).len(), 47);
    assert!(matched.todos.iter().all(|todo| todo.id.starts_with(&a_id)));
    let foreign = member_call(
        &db.conn,
        TeamMemberRequest {
            token: a_token,
            request: TodoRequest {
                team_id: Some(b_id.clone()),
                completed_search: Some(b_id),
                ..page_request(2)
            },
        },
    )
    .await
    .unwrap();
    assert_eq!(foreign.completed_pagination.total, 0);
    assert!(todo_ids(&foreign, true).is_empty());
    assert_eq!(todo_ids(&foreign, false).len(), 47);
}

#[tokio::test]
async fn remote_members_forward_completed_paging_and_search_to_the_host() {
    let host = fresh_in_memory_db().await;
    let state = team(&host.conn, "Host").await;
    let id = state.active_team_id.unwrap();
    let self_id = state.self_id.unwrap();
    seed_todos(&host.conn, &id, &self_id, 45, 23, 24).await;
    let member_token = token(&host.conn, &id).await;
    let host_conn = host.conn.clone();
    let router = axum::Router::new().route(
        "/api/team_todo_call",
        axum::routing::post(move |axum::Json(request): axum::Json<TeamMemberRequest>| {
            let conn = host_conn.clone();
            async move { axum::Json(member_call(&conn, request).await.unwrap()) }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let serving = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let client = fresh_in_memory_db().await;
    execute(
        &client.conn,
        "INSERT INTO maxcode_todo_team (id,name,url,is_local,self_id,member_token) VALUES (?,?,?,0,?,?)",
        vec![id.clone().into(), "Host".into(), url.into(), self_id.into(), member_token.into()],
    )
    .await
    .unwrap();
    let state = call(
        &client.conn,
        TodoRequest {
            action: "set_mode".to_string(),
            mode: Some("team".to_string()),
            team_id: Some(id.clone()),
            completed_page: Some(2),
            completed_page_size: Some(10),
            completed_search: Some(" Host ".to_string()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(state.active_team_id.as_deref(), Some(id.as_str()));
    assert!(state.connection_error.is_none());
    assert_eq!(state.completed_pagination.page, 2);
    assert_eq!(state.completed_pagination.page_size, 10);
    assert_eq!(state.completed_pagination.total, 45);
    assert_eq!(state.completed_pagination.search, "Host");
    assert_eq!(todo_ids(&state, true).len(), 10);
    assert_eq!(todo_ids(&state, false).len(), 47);
    serving.abort();
}
