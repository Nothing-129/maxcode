//! Todo files live on disk (personal) or the team's S3-compatible MinIO server.
//! Only the host's authenticated instance API can configure storage credentials.
use super::*;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

#[derive(Clone, Default, Deserialize, Serialize)]
pub struct MinioConfig {
    pub endpoint: String,
    pub bucket: String,
    pub public_url: String,
    pub access_key: String,
    #[serde(default)]
    pub secret_key: String,
    #[serde(default = "default_region")]
    pub region: String,
    #[serde(default)]
    pub has_secret: bool,
}
fn default_region() -> String {
    "us-east-1".into()
}

pub fn validate_config(config: &MinioConfig) -> Result<(), AppCommandError> {
    for value in [&config.endpoint, &config.public_url] {
        let url = url::Url::parse(value)
            .map_err(|_| AppCommandError::invalid_input("Enter a valid MinIO HTTP(S) address"))?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(AppCommandError::invalid_input(
                "Enter a valid MinIO HTTP(S) address without credentials or query parameters",
            ));
        }
    }
    if config.bucket.len() < 3
        || config.bucket.len() > 63
        || !config
            .bucket
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-' || c == b'.')
        || config.access_key.trim().is_empty()
        || config.region.trim().is_empty()
        || !config
            .region
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err(AppCommandError::invalid_input(
            "Enter the MinIO bucket, access key and region",
        ));
    }
    Ok(())
}
fn config_key(scope: &str) -> String {
    format!("todo-minio:{scope}")
}
pub(super) fn remove_config(scope: &str) {
    if crate::keyring_store::get_token(&config_key(scope)).is_none() {
        return;
    }
    if let Err(error) = crate::keyring_store::delete_token(&config_key(scope)) {
        tracing::warn!("Cannot remove retired team storage credentials: {error}");
    }
}
fn load_config(scope: &str) -> Result<MinioConfig, AppCommandError> {
    crate::keyring_store::get_token(&config_key(scope))
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .ok_or_else(|| {
            AppCommandError::configuration_missing(
                "The team creator must configure MinIO before uploading attachments",
            )
        })
}
pub fn save_config(scope: &str, mut config: MinioConfig) -> Result<(), AppCommandError> {
    validate_config(&config)?;
    if config.secret_key.is_empty() {
        config.secret_key = load_config(scope)?.secret_key;
    }
    if config.secret_key.is_empty() {
        return Err(AppCommandError::invalid_input("Enter the MinIO secret key"));
    }
    config.has_secret = true;
    crate::keyring_store::set_token(
        &config_key(scope),
        &serde_json::to_string(&config)
            .map_err(|_| AppCommandError::io_error("Cannot encode storage settings"))?,
    )
    .map_err(|_| AppCommandError::io_error("Cannot save MinIO credentials"))
}
#[derive(Deserialize)]
pub struct ConfigRequest {
    pub scope_id: String,
    pub config: Option<MinioConfig>,
}
pub async fn configure(
    conn: &DatabaseConnection,
    request: ConfigRequest,
) -> Result<Option<MinioConfig>, AppCommandError> {
    let local = rows(
        conn,
        "SELECT id FROM maxcode_todo_team WHERE id=? AND is_local=1",
        vec![request.scope_id.clone().into()],
    )
    .await?;
    if local.is_empty() {
        return Err(AppCommandError::permission_denied(
            "Only the team creator can configure MinIO",
        ));
    }
    if let Some(config) = request.config {
        save_config(&request.scope_id, config)?;
    }
    Ok(load_config(&request.scope_id).ok().map(|mut config| {
        config.has_secret = !config.secret_key.is_empty();
        config.secret_key.clear();
        config
    }))
}

#[derive(Clone, Deserialize, Serialize)]
pub struct UploadedAttachment {
    pub name: String,
    pub url: String,
    pub size: usize,
    pub mime: String,
}

pub async fn content_bytes(
    conn: &DatabaseConnection,
    scope: &str,
    content: &str,
) -> Result<usize, AppCommandError> {
    let mut size = 0usize;
    for row in rows(
        conn,
        "SELECT url,size FROM maxcode_todo_attachment WHERE scope_id=?",
        vec![scope.into()],
    )
    .await?
    {
        let url: String = field(&row, "url")?;
        if content.contains(&url) {
            size += field::<i64>(&row, "size")?.max(0) as usize;
        }
    }
    Ok(size)
}
pub async fn validate_content_size(
    conn: &DatabaseConnection,
    scope: &str,
    content: &str,
    added: usize,
) -> Result<(), AppCommandError> {
    if scope != PERSONAL {
        return Ok(());
    }
    if content_bytes(conn, scope, content)
        .await?
        .saturating_add(added)
        > TODO_ATTACHMENT_MAX_BYTES
    {
        return Err(AppCommandError::invalid_input(
            "Attachments exceed the 100 MB total limit",
        ));
    }
    Ok(())
}
pub fn local_root() -> PathBuf {
    crate::paths::codeg_uploads_root().join("todo-attachments")
}
fn hex(data: impl AsRef<[u8]>) -> String {
    data.as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
fn hmac(key: &[u8], data: &str) -> Vec<u8> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(data.as_bytes());
    mac.finalize().into_bytes().to_vec()
}
// S3 SigV4: https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html
fn authorization(config: &MinioConfig, url: &url::Url, hash: &str, date: &str) -> String {
    let host = &url[url::Position::BeforeHost..url::Position::AfterPort];
    let headers = format!("host:{host}\nx-amz-content-sha256:{hash}\nx-amz-date:{date}\n");
    let signed = "host;x-amz-content-sha256;x-amz-date";
    let canonical = format!("PUT\n{}\n\n{headers}\n{signed}\n{hash}", url.path());
    let day = &date[..8];
    let scope = format!("{day}/{}/s3/aws4_request", config.region);
    let string = format!(
        "AWS4-HMAC-SHA256\n{date}\n{scope}\n{}",
        hex(Sha256::digest(canonical.as_bytes()))
    );
    let key = hmac(format!("AWS4{}", config.secret_key).as_bytes(), day);
    let key = hmac(&key, &config.region);
    let key = hmac(&key, "s3");
    let key = hmac(&key, "aws4_request");
    format!(
        "AWS4-HMAC-SHA256 Credential={}/{scope}, SignedHeaders={signed}, Signature={}",
        config.access_key,
        hex(hmac(&key, &string))
    )
}
fn object_url(base: &str, segments: &[&str]) -> Result<url::Url, AppCommandError> {
    let suffix = segments
        .iter()
        .map(|segment| urlencoding::encode(segment).into_owned())
        .collect::<Vec<_>>()
        .join("/");
    url::Url::parse(&format!("{}/{suffix}", base.trim_end_matches('/')))
        .map_err(|_| AppCommandError::invalid_input("Invalid storage URL"))
}

async fn put_minio(
    config: &MinioConfig,
    scope: &str,
    id: &str,
    name: &str,
    mime: &str,
    bytes: Vec<u8>,
) -> Result<String, AppCommandError> {
    let target = object_url(
        &config.endpoint,
        &[&config.bucket, "maxcode-todos", scope, id, name],
    )?;
    // Public URL includes the bucket (or a CDN mapping to that bucket).
    let public = object_url(&config.public_url, &["maxcode-todos", scope, id, name])?.to_string();
    let hash = hex(Sha256::digest(&bytes));
    let date = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let auth = authorization(config, &target, &hash, &date);
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|_| AppCommandError::network("Cannot connect to MinIO"))?;
    let result = client
        .put(target)
        .header("x-amz-content-sha256", hash)
        .header("x-amz-date", date)
        .header("Authorization", auth)
        .header("Content-Type", mime)
        .body(bytes)
        .send()
        .await
        .map_err(|_| {
            AppCommandError::network("MinIO upload failed; check the endpoint and connection")
        })?;
    if !result.status().is_success() {
        return Err(AppCommandError::network(format!(
            "MinIO rejected the upload (HTTP {})",
            result.status().as_u16()
        )));
    }
    // Permanent Markdown URLs must be readable without embedding credentials.
    let readable = client
        .head(&public)
        .send()
        .await
        .map_err(|_| AppCommandError::network("Cannot read the MinIO public file URL"))?;
    if !readable.status().is_success() {
        return Err(AppCommandError::configuration_missing(
            "The MinIO file URL is not readable; configure the public bucket URL and read policy",
        ));
    }
    Ok(public)
}

pub async fn upload_host(
    conn: &DatabaseConnection,
    scope: &str,
    name: String,
    mime: String,
    bytes: Vec<u8>,
    content: &str,
) -> Result<UploadedAttachment, AppCommandError> {
    validate_content_size(conn, scope, content, bytes.len()).await?;
    if name.is_empty()
        || name.len() > 512
        || matches!(name.as_str(), "." | "..")
        || name.contains(['/', '\\'])
        || name.chars().any(char::is_control)
    {
        return Err(AppCommandError::invalid_input("Filename is too long"));
    }
    let id = new_id();
    let size = bytes.len();
    let mime = if matches!(
        mime.as_str(),
        "image/png" | "image/jpeg" | "image/gif" | "image/webp"
    ) {
        mime
    } else {
        "application/octet-stream".into()
    };
    let url = if scope == PERSONAL {
        tokio::fs::create_dir_all(local_root())
            .await
            .map_err(|_| AppCommandError::io_error("Cannot create attachment directory"))?;
        tokio::fs::write(local_root().join(&id), &bytes)
            .await
            .map_err(|_| AppCommandError::io_error("Cannot write attachment"))?;
        format!("/api/todo_attachment/{id}")
    } else {
        let config = load_config(scope)?;
        validate_config(&config)?;
        put_minio(&config, scope, &id, &name, &mime, bytes).await?
    };
    execute(conn, "INSERT INTO maxcode_todo_attachment (id,scope_id,name,url,size,mime,created_at) VALUES (?,?,?,?,?,?,?)", vec![id.into(), scope.into(), name.clone().into(), url.clone().into(), (size as i64).into(), mime.clone().into(), Utc::now().to_rfc3339().into()]).await?;
    Ok(UploadedAttachment {
        name,
        url,
        size,
        mime,
    })
}

pub async fn upload_local(
    conn: &DatabaseConnection,
    scope: &str,
    name: String,
    mime: String,
    bytes: Vec<u8>,
    content: &str,
) -> Result<UploadedAttachment, AppCommandError> {
    if scope == PERSONAL {
        return upload_host(conn, scope, name, mime, bytes, content).await;
    }
    let all = teams(conn, &None).await?;
    let team = all
        .iter()
        .find(|team| team.team.id == scope)
        .ok_or_else(|| AppCommandError::permission_denied("Unknown todo scope"))?;
    if team.team.is_local {
        return upload_host(conn, scope, name, mime, bytes, content).await;
    }
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(name)
        .mime_str(&mime)
        .map_err(|_| AppCommandError::invalid_input("Invalid file type"))?;
    let form = reqwest::multipart::Form::new()
        .text("content", content.to_owned())
        .part("file", part);
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|_| AppCommandError::network("Cannot connect to team"))?;
    let res = client
        .post(format!(
            "{}/api/team_todo_attachment",
            team.team
                .url
                .as_deref()
                .ok_or_else(|| AppCommandError::configuration_missing("Team address missing"))?
        ))
        .header("X-MaxCode-Team-Token", &team.member_token)
        .multipart(form)
        .send()
        .await
        .map_err(|_| AppCommandError::network("Team attachment upload failed"))?;
    if !res.status().is_success() {
        return Err(res
            .json::<AppCommandError>()
            .await
            .unwrap_or_else(|_| AppCommandError::network("Team attachment upload failed")));
    }
    res.json()
        .await
        .map_err(|_| AppCommandError::network("Invalid attachment response"))
}
pub async fn member_scope(
    conn: &DatabaseConnection,
    token: &str,
) -> Result<String, AppCommandError> {
    if token.len() != 32 {
        return Err(AppCommandError::permission_denied(
            "Invalid team membership",
        ));
    }
    let found = rows(conn, "SELECT t.id FROM maxcode_todo_member m JOIN maxcode_todo_team t ON t.id=m.team_id WHERE m.token=? AND t.is_local=1", vec![token.into()]).await?;
    field(
        found
            .first()
            .ok_or_else(|| AppCommandError::permission_denied("Invalid team membership"))?,
        "id",
    )
}

#[cfg(test)]
#[path = "../../../src/maxcode-contracts/todo-minio.contract.rs"]
mod contract;
