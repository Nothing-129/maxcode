//! Date-only scheduling is optional, scoped and paginated on the host.
use super::*;
use crate::db::test_helpers::fresh_in_memory_db;

async fn create(conn: &DatabaseConnection, due: Option<&str>, priority: Option<&str>) -> TodoItem {
    let title = new_id();
    call(
        conn,
        TodoRequest {
            action: "create".into(),
            title: Some(title.clone()),
            content: Some("Check release".into()),
            due_date: due.map(str::to_owned),
            priority: priority.map(str::to_owned),
            ..Default::default()
        },
    )
    .await
    .unwrap()
    .todos
    .into_iter()
    .find(|item| item.title == title)
    .unwrap()
}

#[tokio::test]
async fn schedule_roundtrip_clear_revision_and_validation() {
    let db = fresh_in_memory_db().await;
    let conn = &db.conn;
    let item = create(conn, Some("2026-10-15"), Some("urgent")).await;
    assert_eq!(item.priority.as_deref(), Some("urgent"));
    let state = call(
        conn,
        TodoRequest {
            action: "update".into(),
            id: Some(item.id.clone()),
            revision: Some(item.revision),
            title: Some(item.title.clone()),
            content: Some(item.content.clone()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let cleared = state.todos.iter().find(|t| t.id == item.id).unwrap();
    assert!(cleared.due_date.is_none() && cleared.priority.is_none());
    assert_eq!(cleared.revision, item.revision + 1);
    for (due, priority) in [
        (Some("2026-02-30"), None),
        (Some("2026-1-01"), None),
        (None, Some("critical")),
    ] {
        assert!(call(
            conn,
            TodoRequest {
                action: "create".into(),
                content: Some("Invalid".into()),
                due_date: due.map(str::to_owned),
                priority: priority.map(str::to_owned),
                ..Default::default()
            }
        )
        .await
        .is_err());
    }
}

#[tokio::test]
async fn filtered_completed_pages_count_all_matches_and_keep_unfinished() {
    let db = fresh_in_memory_db().await;
    let conn = &db.conn;
    let open = create(conn, Some("2026-10-14"), Some("low")).await;
    for index in 0..23 {
        let item = create(
            conn,
            Some(if index < 21 {
                "2026-10-15"
            } else {
                "2026-10-16"
            }),
            Some("urgent"),
        )
        .await;
        call(
            conn,
            TodoRequest {
                action: "complete".into(),
                id: Some(item.id.clone()),
                revision: Some(item.revision),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        call(
            conn,
            TodoRequest {
                action: "verify".into(),
                id: Some(item.id),
                revision: Some(item.revision + 1),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    }
    let query = TodoRequest {
        action: "state".into(),
        completed_filter: Some("today".into()),
        today: Some("2026-10-15".into()),
        completed_page: Some(2),
        ..Default::default()
    };
    let state = call(conn, query.clone()).await.unwrap();
    assert_eq!(state.completed_pagination.total, 21);
    assert_eq!(state.completed_pagination.page, 2);
    assert_eq!(
        state
            .todos
            .iter()
            .filter(|t| t.status == "completed")
            .count(),
        1
    );
    assert!(state.todos.iter().any(|t| t.id == open.id));
    let overdue = call(
        conn,
        TodoRequest {
            completed_filter: Some("overdue".into()),
            ..query.clone()
        },
    )
    .await
    .unwrap();
    assert_eq!(overdue.completed_pagination.total, 0);
    let urgent = call(
        conn,
        TodoRequest {
            completed_filter: Some("urgent".into()),
            ..query
        },
    )
    .await
    .unwrap();
    assert_eq!(urgent.completed_pagination.total, 23);
}

#[tokio::test]
async fn team_member_schedule_and_exact_source_edits_stay_in_scope() {
    use super::conversation_groups::TodoOrigin;
    use super::conversation_sources::{origin_call, OriginAction, TodoOriginCallRequest};
    let db = fresh_in_memory_db().await;
    let conn = &db.conn;
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(1, 1)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let state = call(
        conn,
        TodoRequest {
            action: "create_team".into(),
            name: Some("Schedule team".into()),
            member_name: Some("Host".into()),
            avatar: Some(format!(
                "data:image/png;base64,{}",
                STANDARD.encode(png.into_inner())
            )),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let team = state.active_team_id.unwrap();
    let token: String = field(
        &rows(
            conn,
            "SELECT member_token FROM maxcode_todo_team WHERE id=?",
            vec![team.clone().into()],
        )
        .await
        .unwrap()[0],
        "member_token",
    )
    .unwrap();
    let result = member_call(
        conn,
        TeamMemberRequest {
            token,
            request: TodoRequest {
                action: "create".into(),
                content: Some("Member release".into()),
                due_date: Some("2026-10-15".into()),
                priority: Some("high".into()),
                ..Default::default()
            },
        },
    )
    .await
    .unwrap();
    let item = &result.todos[0];
    assert_eq!(item.due_date.as_deref(), Some("2026-10-15"));
    let origin = TodoOrigin {
        scope_id: team,
        todo_id: item.id.clone(),
    };
    call(
        conn,
        TodoRequest {
            action: "set_mode".into(),
            mode: Some("personal".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let changed = origin_call(
        conn,
        TodoOriginCallRequest {
            origin,
            operation: OriginAction {
                action: "update".into(),
                title: Some(item.title.clone()),
                content: Some(item.content.clone()),
                revision: Some(item.revision),
                due_date: Some("2026-10-20".into()),
                priority: Some("urgent".into()),
                ..Default::default()
            },
        },
    )
    .await
    .unwrap()
    .todo
    .unwrap();
    assert_eq!(changed.due_date.as_deref(), Some("2026-10-20"));
    assert_eq!(changed.priority.as_deref(), Some("urgent"));
    assert!(call(
        conn,
        TodoRequest {
            action: "state".into(),
            ..Default::default()
        }
    )
    .await
    .unwrap()
    .todos
    .is_empty());
}
