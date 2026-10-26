//! Storage credentials are host-only; uploaded bytes stay out of todo records.
use super::*;
use crate::db::test_helpers::fresh_in_memory_db;

fn config() -> MinioConfig {
    MinioConfig {
        endpoint: "http://localhost:9000".into(),
        bucket: "files".into(),
        public_url: "http://localhost:9000/files".into(),
        access_key: "TEST_ACCESS".into(),
        secret_key: "not-a-real-secret".into(),
        region: "us-east-1".into(),
        has_secret: false,
    }
}
#[test]
fn minio_urls_and_signatures_handle_unicode_and_reserved_filenames() {
    let config = config();
    validate_config(&config).unwrap();
    let url = object_url(
        &config.endpoint,
        &["files", "maxcode-todos", "team-a", "id", "图(1).png"],
    )
    .unwrap();
    assert_eq!(
        url.path(),
        "/files/maxcode-todos/team-a/id/%E5%9B%BE%281%29.png"
    );
    let signed = authorization(
        &config,
        &url,
        &hex(Sha256::digest(b"file bytes")),
        "20261016T000000Z",
    );
    // Independent Python hashlib/hmac SigV4 fixture, including endpoint port.
    assert!(signed
        .ends_with("Signature=9544f6aaffec97f43daddf5bbcf8d798ffd04b831e98fe1206ad1c8e2c23fd19"));
    assert!(!signed.contains("not-a-real-secret"));
    let mut invalid = config.clone();
    invalid.endpoint = "https://user:secret@host/bucket?token=secret".into();
    assert!(validate_config(&invalid).is_err());
    invalid.endpoint = "file:///tmp/bucket".into();
    assert!(validate_config(&invalid).is_err());
}

async fn mock_minio(
    public_read: bool,
    put_status: axum::http::StatusCode,
) -> (
    String,
    tokio::task::JoinHandle<()>,
    std::sync::Arc<std::sync::Mutex<Vec<(String, String, bool, Vec<u8>)>>>,
) {
    use axum::{
        body::Bytes,
        http::{HeaderMap, Method, Uri},
        routing::any,
        Router,
    };
    let calls = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let seen = calls.clone();
    let router = Router::new().route(
        "/{*path}",
        any(
            move |method: Method, uri: Uri, headers: HeaderMap, body: Bytes| {
                let seen = seen.clone();
                async move {
                    seen.lock().unwrap().push((
                        method.to_string(),
                        uri.to_string(),
                        headers.contains_key("authorization"),
                        body.to_vec(),
                    ));
                    if method == Method::PUT {
                        put_status
                    } else if public_read {
                        axum::http::StatusCode::OK
                    } else {
                        axum::http::StatusCode::FORBIDDEN
                    }
                }
            },
        ),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    (address, server, calls)
}
#[tokio::test]
async fn uploads_signed_bytes_and_returns_only_a_permanent_readable_url() {
    let (endpoint, server, calls) = mock_minio(true, axum::http::StatusCode::OK).await;
    let config = MinioConfig {
        endpoint: endpoint.clone(),
        public_url: format!("{endpoint}/files"),
        ..config()
    };
    let url = put_minio(
        &config,
        "team-a",
        "id",
        "图.png",
        "image/png",
        b"image bytes".to_vec(),
    )
    .await
    .unwrap();
    assert_eq!(
        url,
        format!("{endpoint}/files/maxcode-todos/team-a/id/%E5%9B%BE.png")
    );
    assert!(!url.contains("Signature"));
    let calls = calls.lock().unwrap();
    assert_eq!(calls[0].0, "PUT");
    assert!(calls[0].2);
    assert_eq!(calls[0].3, b"image bytes");
    assert_eq!(calls[1].0, "HEAD");
    assert!(!calls[1].2, "public read check must not send credentials");
    server.abort();
}
#[tokio::test]
async fn rejects_failed_uploads_and_private_or_invalid_public_urls() {
    for (public, status) in [
        (false, axum::http::StatusCode::OK),
        (true, axum::http::StatusCode::FORBIDDEN),
    ] {
        let (endpoint, server, _) = mock_minio(public, status).await;
        let config = MinioConfig {
            endpoint: endpoint.clone(),
            public_url: format!("{endpoint}/files"),
            ..config()
        };
        assert!(put_minio(
            &config,
            "team-a",
            "id",
            "a.txt",
            "application/octet-stream",
            vec![1]
        )
        .await
        .is_err());
        server.abort();
    }
}
#[tokio::test]
async fn aggregate_limit_counts_only_referenced_files_in_the_authorized_scope() {
    let db = fresh_in_memory_db().await;
    for (id, scope, url, size) in [
        (
            "a",
            "personal",
            "https://files.test/a",
            TODO_ATTACHMENT_MAX_BYTES,
        ),
        ("b", "personal", "https://files.test/b", 1),
        (
            "c",
            "team-b",
            "https://files.test/c",
            TODO_ATTACHMENT_MAX_BYTES,
        ),
    ] {
        execute(&db.conn, "INSERT INTO maxcode_todo_attachment(id,scope_id,name,url,size,mime,created_at) VALUES (?,?,?,?,?,'application/octet-stream','now')", vec![id.into(), scope.into(), "file".into(), url.into(), (size as i64).into()]).await.unwrap();
    }
    let content = "[a](https://files.test/a)\n[c](https://files.test/c)";
    assert_eq!(
        content_bytes(&db.conn, "personal", content).await.unwrap(),
        TODO_ATTACHMENT_MAX_BYTES
    );
    validate_content_size(&db.conn, "personal", content, 0)
        .await
        .unwrap();
    assert!(validate_content_size(&db.conn, "personal", content, 1)
        .await
        .is_err());
    assert!(validate_content_size(
        &db.conn,
        "personal",
        "[a](https://files.test/a) [b](https://files.test/b)",
        0
    )
    .await
    .is_err());
    validate_content_size(&db.conn, "personal", "Removed the old file", 100)
        .await
        .unwrap();
    assert!(
        validate_content_size(&db.conn, "team-b", content, TODO_ATTACHMENT_MAX_BYTES + 1)
            .await
            .is_err()
    );
    // Team tasks can reference multiple files, but each upload is bounded.
    validate_content_size(&db.conn, "team-b", content, TODO_ATTACHMENT_MAX_BYTES)
        .await
        .unwrap();
    let result = call(
        &db.conn,
        TodoRequest {
            action: "create".into(),
            title: Some("URL only".into()),
            content: Some("![picture](https://files.test/a)".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(result.todos[0].content, "![picture](https://files.test/a)");
}
#[tokio::test]
async fn membership_determines_upload_scope_and_remote_members_cannot_configure_storage() {
    let db = fresh_in_memory_db().await;
    execute(&db.conn, "INSERT INTO maxcode_todo_team(id,name,is_local,self_id,member_token) VALUES ('team-a','A',1,'host','host-token'),('remote','Remote',0,'member','remote-token')", vec![]).await.unwrap();
    let token = "0123456789abcdef0123456789abcdef";
    execute(&db.conn, "INSERT INTO maxcode_todo_member(id,team_id,name,avatar,token) VALUES ('member','team-a','M','',?)", vec![token.into()]).await.unwrap();
    assert_eq!(member_scope(&db.conn, token).await.unwrap(), "team-a");
    assert!(member_scope(&db.conn, "invalid").await.is_err());
    assert!(configure(
        &db.conn,
        ConfigRequest {
            scope_id: "remote".into(),
            config: Some(config())
        }
    )
    .await
    .is_err());
}
