use super::*;
use axum::{
    body::Body,
    http::{Request, StatusCode},
    response::Response,
    Router,
};
use futures_util::StreamExt;
use std::{sync::Arc, time::Duration};
use tower::ServiceExt;

async fn post(app: &Router, path: &str, payload: serde_json::Value) -> Response {
    let mut request = Request::post(path).header("Content-Type", "application/json");
    if !path.starts_with("/api/team_") {
        request = request.header("Authorization", "Bearer instance-token");
    }
    app.clone()
        .oneshot(request.body(Body::from(payload.to_string())).unwrap())
        .await
        .unwrap()
}

#[tokio::test]
async fn a_member_stream_only_refreshes_after_a_write_in_its_own_team() {
    let db = crate::db::test_helpers::fresh_in_memory_db().await;
    let dir = tempfile::tempdir().unwrap();
    let state = Arc::new(crate::app_state::AppState::new_for_test(
        db,
        dir.path().to_path_buf(),
    ));
    let shutdown = Arc::new(crate::web::shutdown::ShutdownSignal::new());
    let app = crate::web::router::build_router(
        state.clone(),
        "instance-token".into(),
        dir.path().to_path_buf(),
        shutdown.clone(),
    );
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(1, 1)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let avatar = format!(
        "data:image/png;base64,{}",
        STANDARD.encode(png.into_inner())
    );
    for name in ["A", "B"] {
        let result = post(
            &app,
            "/api/todo_call",
            serde_json::json!({"action":"create_team","name":name,"member_name":"Creator","avatar":avatar}),
        )
        .await;
        assert_eq!(result.status(), StatusCode::OK);
    }
    let records = teams(&state.db.conn, &None).await.unwrap();
    let a = &records[0];
    let b = &records[1];
    let rejected = post(
        &app,
        "/api/team_todo_events",
        serde_json::json!({"token":"00000000000000000000000000000000"}),
    )
    .await;
    assert_eq!(rejected.status(), StatusCode::FORBIDDEN);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let host_url = format!("http://{}", listener.local_addr().unwrap());
    let host = app.clone();
    let serving = tokio::spawn(async move { axum::serve(listener, host).await.unwrap() });
    let member_db = crate::db::test_helpers::fresh_in_memory_db().await;
    execute(
        &member_db.conn,
        "INSERT INTO maxcode_todo_team (id,name,url,is_local,self_id,member_token) VALUES (?,?,?,0,?,?)",
        vec![
            a.team.id.clone().into(),
            a.team.name.clone().into(),
            host_url.into(),
            a.self_id.clone().into(),
            a.member_token.clone().into(),
        ],
    )
    .await
    .unwrap();
    let member_dir = tempfile::tempdir().unwrap();
    let member = crate::web::router::build_router(
        Arc::new(crate::app_state::AppState::new_for_test(
            member_db,
            member_dir.path().to_path_buf(),
        )),
        "instance-token".into(),
        member_dir.path().to_path_buf(),
        Arc::new(crate::web::shutdown::ShutdownSignal::new()),
    );
    let mut streams = Vec::new();
    for response in [
        post(
            &member,
            "/api/todo_team_events",
            serde_json::json!({"team_id": a.team.id}),
        )
        .await,
        post(
            &app,
            "/api/team_todo_events",
            serde_json::json!({"token": b.member_token}),
        )
        .await,
    ] {
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["content-type"], "text/event-stream");
        let mut stream = response.into_body().into_data_stream();
        assert_eq!(stream.next().await.unwrap().unwrap(), "data: refresh\n\n");
        streams.push(stream);
    }
    let read = post(
        &app,
        "/api/team_todo_call",
        serde_json::json!({"token":a.member_token,"action":"state"}),
    )
    .await;
    assert_eq!(read.status(), StatusCode::OK);
    assert!(
        tokio::time::timeout(Duration::from_millis(30), streams[0].next())
            .await
            .is_err()
    );

    let created = post(
        &app,
        "/api/team_todo_call",
        serde_json::json!({"token":a.member_token,"action":"create","title":"Team task","content":"Details"}),
    )
    .await;
    assert_eq!(created.status(), StatusCode::OK);
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(1), streams[0].next())
            .await
            .unwrap()
            .unwrap()
            .unwrap(),
        "data: refresh\n\n"
    );
    assert!(
        tokio::time::timeout(Duration::from_millis(30), streams[1].next())
            .await
            .is_err()
    );

    let created = post(
        &app,
        "/api/todo_call",
        serde_json::json!({"action":"create","title":"Creator's task","content":"Details"}),
    )
    .await;
    assert_eq!(created.status(), StatusCode::OK);
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(1), streams[1].next())
            .await
            .unwrap()
            .unwrap()
            .unwrap(),
        "data: refresh\n\n"
    );
    assert!(
        tokio::time::timeout(Duration::from_millis(30), streams[0].next())
            .await
            .is_err()
    );

    let dissolved = post(
        &app,
        "/api/todo_call",
        serde_json::json!({"action":"dissolve_team","team_id":a.team.id,"name":"A"}),
    )
    .await;
    assert_eq!(dissolved.status(), StatusCode::OK);
    assert!(
        tokio::time::timeout(Duration::from_secs(1), streams[0].next())
            .await
            .unwrap()
            .is_none()
    );
    shutdown.trigger();
    assert!(
        tokio::time::timeout(Duration::from_secs(1), streams[1].next())
            .await
            .unwrap()
            .is_none()
    );
    serving.abort();
}
