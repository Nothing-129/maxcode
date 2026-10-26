use super::*;
use axum::{body::Body, middleware, routing::get, Router};
use tower::ServiceExt;

#[tokio::test]
async fn security_headers_protect_pages_without_breaking_api_and_preview_frames() {
    for (path, content_type) in [
        ("/workspace", "text/html; charset=utf-8"),
        ("/api/office-watch-proxy/1234/", "text/html"),
        ("/api/team_todo_call", "application/json"),
        ("/api/workspace_media/ticket", "video/mp4"),
        ("/_next/static/chunk.js", "application/javascript"),
    ] {
        let app = Router::new()
            .route(
                path,
                get(move || async move { ([(header::CONTENT_TYPE, content_type)], "body") }),
            )
            .layer(middleware::from_fn(security_headers));
        let response = app
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(
            response.headers()[header::X_CONTENT_TYPE_OPTIONS],
            "nosniff"
        );
        assert_eq!(response.headers()[header::REFERRER_POLICY], "no-referrer");
        assert_eq!(response.headers()[header::CONTENT_TYPE], content_type);
        let csp = response
            .headers()
            .get(header::CONTENT_SECURITY_POLICY)
            .map(|v| v.to_str().unwrap());
        if path == "/workspace" {
            assert!(csp.unwrap().contains("frame-ancestors 'none'"));
            assert_eq!(response.headers()[header::X_FRAME_OPTIONS], "DENY");
        } else if path.starts_with("/api/office-watch-proxy/") {
            assert!(csp.unwrap().contains("sandbox allow-scripts"));
            assert!(!csp.unwrap().contains("allow-same-origin"));
            assert!(response.headers().get(header::X_FRAME_OPTIONS).is_none());
        } else {
            assert!(csp.is_none());
        }
    }
}
