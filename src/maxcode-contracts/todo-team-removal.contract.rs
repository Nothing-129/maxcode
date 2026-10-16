//! Removing a joined team is local; dissolution is host-only and name-confirmed.
use super::*;
use crate::db::test_helpers::fresh_in_memory_db;

fn request(action: &str, id: &str, name: Option<&str>) -> TodoRequest {
    TodoRequest {
        action: action.into(),
        team_id: Some(id.into()),
        name: name.map(str::to_string),
        ..Default::default()
    }
}
async fn host(conn: &DatabaseConnection, name: &str) -> TodoState {
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(1, 1)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    call(
        conn,
        TodoRequest {
            action: "create_team".into(),
            name: Some(name.into()),
            member_name: Some("Host".into()),
            avatar: Some(format!(
                "data:image/png;base64,{}",
                STANDARD.encode(png.into_inner())
            )),
            ..Default::default()
        },
    )
    .await
    .unwrap()
}
#[tokio::test]
async fn dissolve_requires_host_action_and_exact_name_and_revokes_member_access() {
    let db = fresh_in_memory_db().await;
    let team = host(&db.conn, "Engineering").await;
    let id = team.active_team_id.unwrap();
    let row = rows(
        &db.conn,
        "SELECT member_token FROM maxcode_todo_team WHERE id=?",
        vec![id.clone().into()],
    )
    .await
    .unwrap();
    let token: String = field(&row[0], "member_token").unwrap();
    for (action, name) in [
        ("remove_team", None),
        ("dissolve_team", None),
        ("dissolve_team", Some("Wrong")),
    ] {
        assert!(call(&db.conn, request(action, &id, name)).await.is_err());
    }
    for action in ["remove_team", "dissolve_team"] {
        assert!(member_call(
            &db.conn,
            TeamMemberRequest {
                token: token.clone(),
                request: request(action, &id, Some("Engineering"))
            }
        )
        .await
        .is_err());
    }
    let state = call(&db.conn, request("state", &id, None)).await.unwrap();
    assert_eq!(state.members.len(), 1);
    let removed = call(&db.conn, request("dissolve_team", &id, Some("Engineering")))
        .await
        .unwrap();
    assert_eq!(removed.mode, "personal");
    assert!(removed.active_team_id.is_none());
    assert!(removed.teams.is_empty());
    assert!(mutate(
        &db.conn,
        &id,
        &state.members[0].id,
        &TodoRequest {
            action: "create".into(),
            content: Some("Late write".into()),
            ..Default::default()
        },
        &None
    )
    .await
    .is_err());
    assert!(member_call(
        &db.conn,
        TeamMemberRequest {
            token,
            request: TodoRequest {
                action: "state".into(),
                ..Default::default()
            }
        }
    )
    .await
    .is_err());
}
#[tokio::test]
async fn dissolution_cleans_only_its_scope_and_preserves_other_selection() {
    let db = fresh_in_memory_db().await;
    let first = host(&db.conn, "First").await.active_team_id.unwrap();
    call(
        &db.conn,
        TodoRequest {
            action: "create".into(),
            content: Some("Team task".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    execute(&db.conn, "INSERT INTO maxcode_todo_share(token,todo_id,scope_id,snapshot_json) VALUES('share','item',?,'{}')", vec![first.clone().into()]).await.unwrap();
    execute(&db.conn, "INSERT INTO maxcode_todo_attachment(id,scope_id,name,url,size,mime,created_at) VALUES('file',?,'file','https://files.example/a',1,'text/plain','now')", vec![first.clone().into()]).await.unwrap();
    let second = host(&db.conn, "Second").await;
    call(
        &db.conn,
        TodoRequest {
            action: "create".into(),
            content: Some("Keep this task".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let removed = call(&db.conn, request("dissolve_team", &first, Some("First")))
        .await
        .unwrap();
    assert_eq!(removed.active_team_id, second.active_team_id);
    assert_eq!(removed.mode, "team");
    assert_eq!(removed.todos[0].content, "Keep this task");
    for (table, column) in [
        ("maxcode_todo_item", "scope_id"),
        ("maxcode_todo_share", "scope_id"),
        ("maxcode_todo_attachment", "scope_id"),
        ("maxcode_todo_member", "team_id"),
        ("maxcode_todo_conversation_link", "scope_id"),
    ] {
        assert!(rows(
            &db.conn,
            &format!("SELECT * FROM {table} WHERE {column}=?"),
            vec![first.clone().into()]
        )
        .await
        .unwrap()
        .is_empty());
    }
}
#[tokio::test]
async fn joined_team_removal_works_offline_and_rejects_dissolution() {
    let db = fresh_in_memory_db().await;
    execute(&db.conn, "INSERT INTO maxcode_todo_team(id,name,url,is_local,self_id,member_token) VALUES('remote','Remote','http://127.0.0.1:1',0,'me','token')", vec![]).await.unwrap();
    execute(&db.conn, "INSERT INTO maxcode_todo_join_attempt(team_id,url,join_key) VALUES('remote','http://127.0.0.1:1','join')", vec![]).await.unwrap();
    execute(
        &db.conn,
        "UPDATE maxcode_todo_preferences SET mode='team',active_team_id='remote'",
        vec![],
    )
    .await
    .unwrap();
    assert!(
        call(&db.conn, request("dissolve_team", "remote", Some("Remote")))
            .await
            .is_err()
    );
    let state = call(&db.conn, request("remove_team", "remote", None))
        .await
        .unwrap();
    assert_eq!(state.mode, "personal");
    assert!(state.teams.is_empty());
    let attempts = rows(
        &db.conn,
        "SELECT join_key FROM maxcode_todo_join_attempt WHERE team_id='remote'",
        vec![],
    )
    .await
    .unwrap();
    assert_eq!(field::<String>(&attempts[0], "join_key").unwrap(), "join");
    assert!(call(&db.conn, request("remove_team", "missing", None))
        .await
        .is_err());
}
