use super::*;
use axum::{
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, Multipart},
    http::{Request, StatusCode},
    routing::post,
    Router,
};
use tower::ServiceExt;

async fn small_upload(mut multipart: Multipart) -> Result<String, AppCommandError> {
    let field = multipart.next_field().await.unwrap().unwrap();
    bounded_text(field, 8).await
}

#[tokio::test]
async fn chunked_fields_enforce_the_limit_without_content_length() {
    for (value, valid) in [("12345678", true), ("123456789", false)] {
        let app = Router::new()
            .route("/upload", post(small_upload))
            .layer(DefaultBodyLimit::disable());
        // Each byte arrives separately, with no Content-Length to trust.
        let payload = format!("--bound\r\nContent-Disposition: form-data; name=\"file\"\r\n\r\n{value}\r\n--bound--\r\n");
        let stream = futures_util::stream::iter(
            payload
                .into_bytes()
                .into_iter()
                .map(|b| Ok::<_, std::io::Error>(Bytes::from(vec![b]))),
        );
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/upload")
                    .header("content-type", "multipart/form-data; boundary=bound")
                    .body(Body::from_stream(stream))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status().is_success(), valid);
    }
}

async fn parse_upload(multipart: Multipart) -> Result<(), AppCommandError> {
    read_attachment(multipart).await.map(|_| ())
}

#[tokio::test]
async fn attachment_parser_rejects_oversized_metadata_and_multiple_files() {
    for (fields, valid) in [
        (
            vec![
                ("scope_id", "personal".to_string()),
                ("file", "hello".to_string()),
            ],
            true,
        ),
        (
            vec![("scope_id", "s".repeat(81)), ("file", "hello".to_string())],
            false,
        ),
        (
            vec![
                ("content", "x".repeat(1024 * 1024 + 1)),
                ("file", "hello".to_string()),
            ],
            false,
        ),
        (
            vec![("file", "one".to_string()), ("file", "two".to_string())],
            false,
        ),
    ] {
        let mut payload = String::new();
        for (name, value) in fields {
            payload.push_str(&format!(
                "--bound\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
            ));
        }
        payload.push_str("--bound--\r\n");
        let app = Router::new()
            .route("/upload", post(parse_upload))
            .layer(DefaultBodyLimit::max(ATTACHMENT_REQUEST_MAX_BYTES));
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/upload")
                    .header("content-type", "multipart/form-data; boundary=bound")
                    .body(Body::from(payload))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status() == StatusCode::OK, valid);
    }
}

#[test]
fn upload_slots_reject_excess_work_and_are_released() {
    let first = ATTACHMENT_UPLOADS.try_acquire_many(2).unwrap();
    assert!(ATTACHMENT_UPLOADS.try_acquire().is_err());
    drop(first);
    assert!(ATTACHMENT_UPLOADS.try_acquire().is_ok());
}
