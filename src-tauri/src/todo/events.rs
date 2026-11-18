use std::{convert::Infallible, sync::Arc, time::Duration};

use axum::{
    body::Body,
    http::{header, HeaderValue},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
};
use futures_util::{stream, StreamExt};
use tokio::sync::broadcast::error::RecvError;

use super::{
    field, rows, storage::member_scope, AppCommandError, DatabaseConnection, TodoState, PERSONAL,
};
use crate::web::{
    event_bridge::{emit_event, EventEmitter, WebEventBroadcaster},
    shutdown::ShutdownSignal,
};

const CHANGE_EVENT: &str = "todos://changed";
const STREAM_CONTENT_TYPE: &str = "text/event-stream";
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);

pub(crate) fn state_scope(state: &TodoState) -> Option<&str> {
    if state.mode == "personal" {
        Some(PERSONAL)
    } else {
        state.active_team_id.as_deref()
    }
}

pub(crate) fn notify(emitter: &EventEmitter, scope_id: Option<&str>, selection_changed: bool) {
    emit_event(
        emitter,
        CHANGE_EVENT,
        serde_json::json!({"scope_id": scope_id, "selection_changed": selection_changed}),
    );
}

pub(crate) async fn hosted_team_stream(
    conn: DatabaseConnection,
    broadcaster: &WebEventBroadcaster,
    token: String,
    shutdown: Arc<ShutdownSignal>,
) -> Result<Response, AppCommandError> {
    // Subscribe before authenticating so the first refresh covers everything
    // already committed, and no change between authentication and reply is lost.
    let receiver = broadcaster.subscribe();
    let scope = member_scope(&conn, &token).await?;
    let refresh = || Ok::<_, Infallible>(Event::default().data("refresh"));
    let updates = stream::unfold(receiver, move |mut receiver| {
        let conn = conn.clone();
        let token = token.clone();
        let scope = scope.clone();
        async move {
            loop {
                match receiver.recv().await {
                    Ok(event) => {
                        if event.channel != CHANGE_EVENT
                            || event.payload["scope_id"].as_str() != Some(scope.as_str())
                        {
                            continue;
                        }
                    }
                    Err(RecvError::Lagged(_)) => {}
                    Err(RecvError::Closed) => return None,
                }
                // A dissolved team or revoked membership ends an open stream,
                // without leaking further change signals to that credential.
                if member_scope(&conn, &token).await.as_deref().ok() != Some(scope.as_str()) {
                    return None;
                }
                return Some((refresh(), receiver));
            }
        }
    });
    let body = stream::once(async move { refresh() })
        .chain(updates)
        .take_until(async move { shutdown.wait().await });
    Ok(stream_headers(
        Sse::new(body)
            .keep_alive(KeepAlive::new().interval(HEARTBEAT_INTERVAL))
            .into_response(),
    ))
}

pub(crate) async fn proxy_team_stream(
    conn: &DatabaseConnection,
    team_id: String,
    shutdown: Arc<ShutdownSignal>,
) -> Result<Response, AppCommandError> {
    let found = rows(
        conn,
        "SELECT url, member_token FROM maxcode_todo_team WHERE id=? AND is_local=0",
        vec![team_id.into()],
    )
    .await?;
    let team = found
        .first()
        .ok_or_else(|| AppCommandError::not_found("Remote team not found"))?;
    let url: String = field(team, "url")?;
    let token: String = field(team, "member_token")?;
    let unavailable = || AppCommandError::network("Team change notifications are unavailable");
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(3 * HEARTBEAT_INTERVAL)
        .build()
        .map_err(|_| unavailable())?;
    let request = client
        .post(format!("{url}/api/team_todo_events"))
        .json(&serde_json::json!({ "token": token }));
    let upstream = tokio::select! {
        result = request.send() => result.map_err(|_| unavailable())?,
        _ = shutdown.wait() => return Err(unavailable()),
    };
    if !upstream.status().is_success()
        || !upstream
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.split(';').next() == Some(STREAM_CONTENT_TYPE))
    {
        return Err(unavailable());
    }
    let body = upstream
        .bytes_stream()
        .take_until(async move { shutdown.wait().await });
    let mut response = Response::new(Body::from_stream(body));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(STREAM_CONTENT_TYPE),
    );
    Ok(stream_headers(response))
}

fn stream_headers(mut response: Response) -> Response {
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    response
        .headers_mut()
        .insert("x-accel-buffering", HeaderValue::from_static("no"));
    response
}
