//! Browser-mode protection must not depend on Electron or a reverse proxy.
use axum::{
    extract::Request,
    http::{header, HeaderValue},
    middleware::Next,
    response::Response,
};

const APP_CSP: &str = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; \
    style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; \
    font-src 'self' data: https:; media-src 'self' blob: data: https: http:; \
    connect-src 'self' https: http: ws: wss:; worker-src 'self' blob:; \
    frame-src https: http: blob:; object-src 'none'; base-uri 'self'; \
    form-action 'self'; frame-ancestors 'none'";

pub async fn security_headers(request: Request, next: Next) -> Response {
    let path = request.uri().path().to_owned();
    let mut response = next.run(request).await;
    let html = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| {
            v.split(';')
                .next()
                .is_some_and(|v| v.trim().eq_ignore_ascii_case("text/html"))
        });
    let headers = response.headers_mut();
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    // Capability URLs (previews/downloads) must never become outbound referrers.
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    if html && path.starts_with("/api/office-watch-proxy/") {
        // Enforce the preview's opaque origin even if its URL is opened directly.
        // Do not block scripts/forms needed by officecli, or embedding by the app.
        headers.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(
            "sandbox allow-scripts allow-popups allow-forms; object-src 'none'; frame-ancestors 'self'"
        ));
    } else if html && !path.starts_with("/api/") && !path.starts_with("/ws/") {
        headers.insert(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static(APP_CSP),
        );
        headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    }
    response
}

#[cfg(test)]
#[path = "../../../src/maxcode-contracts/server-security-headers.contract.rs"]
mod contract;
