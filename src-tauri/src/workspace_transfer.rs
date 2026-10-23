use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, Semaphore};
use tokio_util::sync::CancellationToken;

pub const WORKSPACE_TRANSFER_PROGRESS_EVENT: &str = "workspace://transfer-progress";

const DOWNLOAD_TICKET_TTL_SECS: u64 = 60;
const DEFAULT_WORKSPACE_UPLOAD_CONCURRENCY: usize = 4;
const DEFAULT_REMOTE_WORKSPACE_UPLOAD_CONCURRENCY: usize = 2;
const DEFAULT_WORKSPACE_ZIP_CONCURRENCY: usize = 2;
const DEFAULT_REMOTE_WORKSPACE_DOWNLOAD_CONCURRENCY: usize = 2;
const DEFAULT_TRANSFER_IDLE_TIMEOUT_SECS: u64 = 300;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DownloadKind {
    File,
    Dir,
}

#[derive(Clone, Debug)]
pub struct DownloadTicketSpec {
    pub root_path: PathBuf,
    pub target_path: PathBuf,
    pub relative_path: String,
    pub kind: DownloadKind,
    pub filename: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTicketIssued {
    pub ticket: String,
    pub url: String,
    pub filename: String,
    pub expires_at: i64,
}

#[derive(Clone, Debug)]
pub struct DownloadTicket {
    pub root_path: PathBuf,
    pub target_path: PathBuf,
    pub relative_path: String,
    pub kind: DownloadKind,
    pub filename: String,
    pub expires_at: Instant,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTransferProgress {
    pub transfer_id: String,
    pub direction: TransferDirection,
    pub loaded: u64,
    pub total: Option<u64>,
    pub state: TransferState,
    pub path: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TransferDirection {
    Upload,
    Download,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TransferState {
    Running,
    Done,
    Cancelled,
    Error,
}

pub struct WorkspaceTransferManager {
    tickets: Mutex<HashMap<String, DownloadTicket>>,
    media_tickets: Mutex<HashMap<String, (DownloadTicketSpec, Instant)>>,
    cancels: Mutex<HashMap<String, CancellationToken>>,
    ticket_ttl: Duration,
    pub workspace_upload_semaphore: Semaphore,
    pub remote_upload_semaphore: Semaphore,
    pub zip_semaphore: Semaphore,
    pub remote_download_semaphore: Semaphore,
    pub idle_timeout: Duration,
}

impl WorkspaceTransferManager {
    pub fn new_from_env() -> Self {
        Self {
            tickets: Mutex::new(HashMap::new()),
            media_tickets: Mutex::new(HashMap::new()),
            cancels: Mutex::new(HashMap::new()),
            ticket_ttl: Duration::from_secs(DOWNLOAD_TICKET_TTL_SECS),
            workspace_upload_semaphore: Semaphore::new(env_usize(
                "CODEG_WORKSPACE_UPLOAD_MAX_CONCURRENCY",
                DEFAULT_WORKSPACE_UPLOAD_CONCURRENCY,
            )),
            remote_upload_semaphore: Semaphore::new(env_usize(
                "CODEG_REMOTE_WORKSPACE_UPLOAD_MAX_CONCURRENCY",
                DEFAULT_REMOTE_WORKSPACE_UPLOAD_CONCURRENCY,
            )),
            zip_semaphore: Semaphore::new(env_usize(
                "CODEG_WORKSPACE_ZIP_MAX_CONCURRENCY",
                DEFAULT_WORKSPACE_ZIP_CONCURRENCY,
            )),
            remote_download_semaphore: Semaphore::new(env_usize(
                "CODEG_REMOTE_WORKSPACE_DOWNLOAD_MAX_CONCURRENCY",
                DEFAULT_REMOTE_WORKSPACE_DOWNLOAD_CONCURRENCY,
            )),
            idle_timeout: env_duration_secs(
                "CODEG_WORKSPACE_TRANSFER_IDLE_TIMEOUT_SECS",
                DEFAULT_TRANSFER_IDLE_TIMEOUT_SECS,
            ),
        }
    }

    pub fn new_for_tests(ticket_ttl: Duration) -> Self {
        Self {
            tickets: Mutex::new(HashMap::new()),
            media_tickets: Mutex::new(HashMap::new()),
            cancels: Mutex::new(HashMap::new()),
            ticket_ttl,
            workspace_upload_semaphore: Semaphore::new(DEFAULT_WORKSPACE_UPLOAD_CONCURRENCY),
            remote_upload_semaphore: Semaphore::new(DEFAULT_REMOTE_WORKSPACE_UPLOAD_CONCURRENCY),
            zip_semaphore: Semaphore::new(DEFAULT_WORKSPACE_ZIP_CONCURRENCY),
            remote_download_semaphore: Semaphore::new(
                DEFAULT_REMOTE_WORKSPACE_DOWNLOAD_CONCURRENCY,
            ),
            idle_timeout: Duration::from_secs(DEFAULT_TRANSFER_IDLE_TIMEOUT_SECS),
        }
    }

    // Media requests reuse a narrowly scoped ticket for metadata and byte ranges.
    pub async fn issue_media_ticket(&self, spec: DownloadTicketSpec) -> String {
        let mut tickets = self.media_tickets.lock().await;
        tickets.retain(|_, (_, expiry)| *expiry > Instant::now());
        let ticket = uuid::Uuid::new_v4().simple().to_string();
        tickets.insert(
            ticket.clone(),
            (spec, Instant::now() + Duration::from_secs(3600)),
        );
        ticket
    }

    pub async fn media_ticket(&self, ticket: &str) -> Option<DownloadTicketSpec> {
        let mut tickets = self.media_tickets.lock().await;
        tickets.retain(|_, (_, expiry)| *expiry > Instant::now());
        tickets.get(ticket).map(|(spec, _)| spec.clone())
    }

    pub async fn register_transfer(&self) -> (String, CancellationToken) {
        let transfer_id = uuid::Uuid::new_v4().simple().to_string();
        let token = CancellationToken::new();
        self.cancels
            .lock()
            .await
            .insert(transfer_id.clone(), token.clone());
        (transfer_id, token)
    }

    pub async fn finish_transfer(&self, transfer_id: &str) {
        self.cancels.lock().await.remove(transfer_id);
    }

    pub async fn cancel(&self, transfer_id: &str) -> bool {
        let token = self.cancels.lock().await.remove(transfer_id);
        if let Some(token) = token {
            token.cancel();
            true
        } else {
            false
        }
    }

    pub async fn issue_download_ticket(&self, spec: DownloadTicketSpec) -> DownloadTicketIssued {
        self.cleanup_expired_tickets().await;

        let ticket = uuid::Uuid::new_v4().simple().to_string();
        let expires_at_instant = Instant::now() + self.ticket_ttl;
        let expires_at = SystemTime::now()
            .checked_add(self.ticket_ttl)
            .unwrap_or(SystemTime::now())
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        self.tickets.lock().await.insert(
            ticket.clone(),
            DownloadTicket {
                root_path: spec.root_path,
                target_path: spec.target_path,
                relative_path: spec.relative_path,
                kind: spec.kind,
                filename: spec.filename.clone(),
                expires_at: expires_at_instant,
            },
        );

        DownloadTicketIssued {
            url: ticket.clone(),
            ticket,
            filename: spec.filename,
            expires_at,
        }
    }

    pub async fn consume_download_ticket(&self, ticket: &str) -> Option<DownloadTicket> {
        self.cleanup_expired_tickets().await;
        let found = self.tickets.lock().await.remove(ticket);
        found.filter(|ticket| Instant::now() <= ticket.expires_at)
    }

    pub async fn cleanup_expired_tickets(&self) {
        let now = Instant::now();
        self.tickets
            .lock()
            .await
            .retain(|_, ticket| ticket.expires_at > now);
    }
}

pub fn env_usize(name: &str, default: usize) -> usize {
    std::env::var(name)
        .ok()
        .and_then(|raw| raw.trim().parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(default)
}

pub fn env_duration_secs(name: &str, default_secs: u64) -> Duration {
    Duration::from_secs(
        std::env::var(name)
            .ok()
            .and_then(|raw| raw.trim().parse::<u64>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(default_secs),
    )
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn media_ticket_is_reusable_scoped_and_expires() {
        let manager = WorkspaceTransferManager::new_for_tests(Duration::from_secs(60));
        let ticket = manager
            .issue_media_ticket(DownloadTicketSpec {
                root_path: PathBuf::from("/repo"),
                target_path: PathBuf::from("/repo/clip.mov"),
                relative_path: "clip.mov".into(),
                kind: DownloadKind::File,
                filename: "clip.mov".into(),
            })
            .await;
        for _ in 0..2 {
            assert_eq!(
                manager.media_ticket(&ticket).await.unwrap().relative_path,
                "clip.mov"
            );
        }
        assert!(manager.consume_download_ticket(&ticket).await.is_none());
        assert!(manager.media_ticket("invalid").await.is_none());
        manager
            .media_tickets
            .lock()
            .await
            .get_mut(&ticket)
            .unwrap()
            .1 = Instant::now();
        assert!(manager.media_ticket(&ticket).await.is_none());
    }

    use super::*;
    use std::path::PathBuf;
    use std::time::Duration;

    #[test]
    fn env_usize_uses_default_for_missing_invalid_and_zero() {
        temp_env::with_var_unset("CODEG_WORKSPACE_UPLOAD_MAX_CONCURRENCY", || {
            assert_eq!(env_usize("CODEG_WORKSPACE_UPLOAD_MAX_CONCURRENCY", 4), 4);
        });
        temp_env::with_var(
            "CODEG_WORKSPACE_UPLOAD_MAX_CONCURRENCY",
            Some("nope"),
            || {
                assert_eq!(env_usize("CODEG_WORKSPACE_UPLOAD_MAX_CONCURRENCY", 4), 4);
            },
        );
        temp_env::with_var("CODEG_WORKSPACE_UPLOAD_MAX_CONCURRENCY", Some("0"), || {
            assert_eq!(env_usize("CODEG_WORKSPACE_UPLOAD_MAX_CONCURRENCY", 4), 4);
        });
    }

    #[tokio::test]
    async fn ticket_is_single_use_and_expires() {
        let manager = WorkspaceTransferManager::new_for_tests(Duration::from_millis(20));
        let ticket = manager
            .issue_download_ticket(DownloadTicketSpec {
                root_path: PathBuf::from("/tmp/root"),
                target_path: PathBuf::from("/tmp/root/file.txt"),
                relative_path: "file.txt".to_string(),
                kind: DownloadKind::File,
                filename: "file.txt".to_string(),
            })
            .await;
        assert!(manager
            .consume_download_ticket(&ticket.ticket)
            .await
            .is_some());
        assert!(manager
            .consume_download_ticket(&ticket.ticket)
            .await
            .is_none());

        let expired = manager
            .issue_download_ticket(DownloadTicketSpec {
                root_path: PathBuf::from("/tmp/root"),
                target_path: PathBuf::from("/tmp/root/old.txt"),
                relative_path: "old.txt".to_string(),
                kind: DownloadKind::File,
                filename: "old.txt".to_string(),
            })
            .await;
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert!(manager
            .consume_download_ticket(&expired.ticket)
            .await
            .is_none());
    }

    #[tokio::test]
    async fn cancel_marks_token_and_removes_entry() {
        let manager = WorkspaceTransferManager::new_for_tests(Duration::from_secs(60));
        let (id, token) = manager.register_transfer().await;
        assert!(!token.is_cancelled());
        assert!(manager.cancel(&id).await);
        assert!(token.is_cancelled());
        assert!(!manager.cancel(&id).await);
    }
}
