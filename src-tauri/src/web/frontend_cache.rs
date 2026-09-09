//! Mutable frontend entry points must revalidate across application upgrades.
use axum::{
    extract::Request,
    http::{header, HeaderValue},
    middleware::Next,
    response::Response,
};

pub async fn frontend_cache(request: Request, next: Next) -> Response {
    let path = request.uri().path().to_owned();
    let mut response = next.run(request).await;
    if path.starts_with("/api/") || path.starts_with("/ws/") {
        return response;
    }
    let html = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.split(';').next() == Some("text/html"));
    let entry = html
        || path.ends_with(".html")
        || !path.rsplit('/').next().unwrap_or("").contains('.')
        || matches!(path.as_str(), "/frontend-version.json" | "/sw.js");
    if entry {
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    } else if response.status().is_success() || response.status().as_u16() == 304 {
        let filename = path.rsplit('/').next().unwrap_or("");
        let stem = filename
            .strip_suffix(".js")
            .or_else(|| filename.strip_suffix(".css"));
        let hashed = stem.is_some_and(|stem| {
            let hash = stem.rsplit('-').next().unwrap_or("");
            hash.len() >= 8 && hash.bytes().all(|byte| byte.is_ascii_hexdigit())
        });
        if path.starts_with("/_next/static/") && hashed {
            response.headers_mut().insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=31536000, immutable"),
            );
        }
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, middleware, routing::get, Router};
    use tower::ServiceExt;

    #[tokio::test]
    async fn revalidates_entries_but_preserves_hashed_assets_and_api_policy() {
        for (path, content_type, status, expected) in [
            (
                "/workspace?x=1",
                "text/html; charset=utf-8",
                200,
                Some("no-cache"),
            ),
            ("/workspace.html", "text/html", 200, Some("no-cache")),
            ("/workspace/", "", 304, Some("no-cache")),
            (
                "/frontend-version.json",
                "application/json",
                200,
                Some("no-cache"),
            ),
            ("/sw.js", "text/javascript", 200, Some("no-cache")),
            (
                "/_next/static/chunks/abcdef123456.js",
                "text/javascript",
                200,
                Some("public, max-age=31536000, immutable"),
            ),
            (
                "/_next/static/chunks/turbopack-abcdef123456.js",
                "text/javascript",
                304,
                Some("public, max-age=31536000, immutable"),
            ),
            (
                "/_next/static/chunks/abcdef123456.css",
                "text/css",
                200,
                Some("public, max-age=31536000, immutable"),
            ),
            (
                "/_next/static/chunks/missing12345.js",
                "text/html",
                200,
                Some("no-cache"),
            ),
            (
                "/_next/static/chunks/abcdef123456.js",
                "text/plain",
                404,
                None,
            ),
            ("/vs/loader.js", "text/javascript", 200, None),
            ("/api/example", "application/json", 200, None),
        ] {
            let app = Router::new()
                .fallback(get(move || async move {
                    Response::builder()
                        .status(status)
                        .header(header::CONTENT_TYPE, content_type)
                        .body(Body::empty())
                        .unwrap()
                }))
                .layer(middleware::from_fn(frontend_cache));
            let response = app
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(
                response
                    .headers()
                    .get(header::CACHE_CONTROL)
                    .map(|v| v.to_str().unwrap()),
                expected,
                "{path} ({status})"
            );
        }
    }
}
