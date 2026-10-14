//! Host-managed DingTalk event consumers. No historical-message polling and no
//! autonomous subscription retries; the user can restart a failed listener.
use crate::{
    db::{
        service::{automation_runtime_service, automation_service},
        AppDatabase,
    },
    models::{
        automation::{AutomationMessageScope, AutomationMessageTrigger},
        AutomationConfig, AutomationInfo, AutomationListenerInfo, TriggerKind,
    },
    web::event_bridge::{emit_event, AutomationChange, EventEmitter, AUTOMATION_CHANGED_EVENT},
};
use std::{
    collections::HashMap,
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    sync::{watch, Mutex},
    task::JoinHandle,
};

#[derive(Default)]
pub struct MessageListeners {
    jobs: Mutex<HashMap<i32, ListenerJob>>,
    stopped: AtomicBool,
}
struct ListenerJob {
    source: String,
    cancel: watch::Sender<bool>,
    task: JoinHandle<()>,
    status: Arc<Mutex<AutomationListenerInfo>>,
}
pub fn source_key(source: &AutomationMessageTrigger) -> String {
    serde_json::json!([
        source.scope,
        source.target.trim(),
        source.profile.trim(),
        source.keywords.trim()
    ])
    .to_string()
}
pub fn listener_args(source: &AutomationMessageTrigger) -> Vec<String> {
    let kind = match source.scope {
        AutomationMessageScope::AtMe => "at-me",
        AutomationMessageScope::Sender => "sender",
        AutomationMessageScope::Group => "group",
        AutomationMessageScope::AllDirect => "all-direct",
        AutomationMessageScope::AllGroup => "all-group",
    };
    let mut args: Vec<String> = [
        "event",
        "+listen-im",
        "--kind",
        kind,
        "--events",
        "message",
        "--format",
        "ndjson",
    ]
    .into_iter()
    .map(String::from)
    .collect();
    let target_flag = match source.scope {
        AutomationMessageScope::Sender => Some("--user-query"),
        AutomationMessageScope::Group => Some("--chat-query"),
        _ => None,
    };
    if let Some(flag) = target_flag {
        args.extend([flag.into(), source.target.trim().into()]);
    }
    for (flag, value) in [
        ("--profile", &source.profile),
        ("--query", &source.keywords),
    ] {
        if !value.trim().is_empty() {
            args.extend([flag.into(), value.trim().into()]);
        }
    }
    args
}
pub fn message_key(payload: &serde_json::Value) -> Option<String> {
    let field = |key| {
        payload
            .get(key)
            .and_then(|v| {
                v.as_str()
                    .map(str::to_owned)
                    .or_else(|| v.as_i64().map(|n| n.to_string()))
            })
            .filter(|s| !s.is_empty())
    };
    if let Some(id) = field("message_id") {
        return Some(serde_json::json!([field("conversation_id"), id]).to_string());
    }
    field("event_id")
}
fn notify(emitter: &EventEmitter, id: i32) {
    emit_event(
        emitter,
        AUTOMATION_CHANGED_EVENT,
        AutomationChange::Upsert { id },
    );
}
impl MessageListeners {
    pub async fn sync(&self, db: &AppDatabase, emitter: &EventEmitter) {
        if self.stopped.load(Ordering::Acquire) {
            return;
        }
        let Ok(automations) = automation_service::list(&db.conn).await else {
            return;
        };
        let desired: HashMap<_, _> = automations
            .into_iter()
            .filter(|a| a.enabled && a.trigger_kind == TriggerKind::Message)
            .filter_map(|a| {
                let cfg: AutomationConfig = serde_json::from_value(a.config).ok()?;
                Some((a.id, cfg.message_trigger?))
            })
            .collect();
        let mut jobs = self.jobs.lock().await;
        if self.stopped.load(Ordering::Acquire) {
            return;
        }
        let obsolete: Vec<_> = jobs
            .iter()
            .filter(|(id, job)| desired.get(id).is_none_or(|s| source_key(s) != job.source))
            .map(|(id, _)| *id)
            .collect();
        for id in obsolete {
            if let Some(job) = jobs.remove(&id) {
                stop_job(job).await;
                notify(emitter, id);
            }
        }
        for (id, source) in desired {
            // Keep finished jobs too: failures require an explicit user restart.
            if jobs.contains_key(&id) {
                continue;
            }
            let key = source_key(&source);
            let (cancel, rx) = watch::channel(false);
            let status = Arc::new(Mutex::new(AutomationListenerInfo {
                state: "starting".into(),
                ..Default::default()
            }));
            let task = tokio::spawn(consume(
                AppDatabase {
                    conn: db.conn.clone(),
                },
                emitter.clone(),
                id,
                source,
                status.clone(),
                rx,
            ));
            jobs.insert(
                id,
                ListenerJob {
                    source: key,
                    cancel,
                    task,
                    status,
                },
            );
            notify(emitter, id);
        }
    }
    pub async fn status(
        &self,
        db: &AppDatabase,
        auto: &AutomationInfo,
    ) -> Result<AutomationListenerInfo, String> {
        let mut info = match self.jobs.lock().await.get(&auto.id) {
            Some(job) => job.status.lock().await.clone(),
            None => AutomationListenerInfo {
                state: "stopped".into(),
                ..Default::default()
            },
        };
        if let Ok(cfg) = serde_json::from_value::<AutomationConfig>(auto.config.clone()) {
            if let Some(source) = cfg.message_trigger {
                let (count, last) = automation_runtime_service::queue_status(
                    &db.conn,
                    auto.id,
                    &source_key(&source),
                )
                .await
                .map_err(|e| e.to_string())?;
                info.pending_count = count;
                info.last_received_at = last;
            }
        }
        Ok(info)
    }
    pub async fn restart(&self, id: i32) {
        if let Some(job) = self.jobs.lock().await.remove(&id) {
            stop_job(job).await;
        }
    }
    pub async fn stop_all(&self) {
        self.stopped.store(true, Ordering::Release);
        let jobs: Vec<_> = self.jobs.lock().await.drain().map(|(_, j)| j).collect();
        for job in &jobs {
            let _ = job.cancel.send(true);
        }
        for job in jobs {
            let _ = job.task.await;
        }
    }
    pub fn is_stopped(&self) -> bool {
        self.stopped.load(Ordering::Acquire)
    }
}
async fn stop_job(job: ListenerJob) {
    let _ = job.cancel.send(true);
    let _ = job.task.await;
}
async fn stop_child(child: &mut tokio::process::Child) {
    // dws cleans subscriptions on SIGTERM or pipe stdin EOF. Never SIGKILL.
    drop(child.stdin.take());
    #[cfg(unix)]
    if let Some(pid) = child.id() {
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
    }
    let _ = tokio::time::timeout(Duration::from_secs(10), child.wait()).await;
}
async fn consume(
    db: AppDatabase,
    emitter: EventEmitter,
    id: i32,
    source: AutomationMessageTrigger,
    status: Arc<Mutex<AutomationListenerInfo>>,
    mut cancel: watch::Receiver<bool>,
) {
    let result = consume_inner(&db, &emitter, id, &source, &status, &mut cancel).await;
    let mut info = status.lock().await;
    match result {
        Ok(()) => info.state = "stopped".into(),
        Err(error) => {
            info.state = "error".into();
            info.error = Some(error);
        }
    }
    drop(info);
    notify(&emitter, id);
}
async fn consume_inner(
    db: &AppDatabase,
    emitter: &EventEmitter,
    id: i32,
    source: &AutomationMessageTrigger,
    status: &Arc<Mutex<AutomationListenerInfo>>,
    cancel: &mut watch::Receiver<bool>,
) -> Result<(), String> {
    // GUI-launched services may lack ~/.local/bin on PATH.
    let program = which::which("dws")
        .ok()
        .or_else(|| {
            dirs::home_dir()
                .map(|home| {
                    home.join(".local").join("bin").join(if cfg!(windows) {
                        "dws.exe"
                    } else {
                        "dws"
                    })
                })
                .filter(|path| path.is_file())
        })
        .unwrap_or_else(|| std::path::PathBuf::from("dws"));
    let mut command = crate::process::tokio_command(program);
    command
        .args(listener_args(source))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let child = command
        .spawn()
        .map_err(|e| format!("Cannot start DingTalk listener. Install dws and sign in: {e}"))?;
    consume_child(db, emitter, id, source, status, cancel, child).await
}
async fn consume_child(
    db: &AppDatabase,
    emitter: &EventEmitter,
    id: i32,
    source: &AutomationMessageTrigger,
    status: &Arc<Mutex<AutomationListenerInfo>>,
    cancel: &mut watch::Receiver<bool>,
    mut child: tokio::process::Child,
) -> Result<(), String> {
    let mut stdout = BufReader::new(child.stdout.take().ok_or("missing listener output")?).lines();
    let mut stderr = BufReader::new(child.stderr.take().ok_or("missing listener status")?).lines();
    let mut ready = false;
    let mut stderr_open = true;
    let deadline = tokio::time::sleep(Duration::from_secs(120));
    tokio::pin!(deadline);
    let key = source_key(source);
    let outcome = loop {
        tokio::select! {
            _ = cancel.changed() => { break Ok(()); }
            _ = &mut deadline, if !ready => {
                break Err("DingTalk listener did not become ready. Check dws login, account and target, then restart.".into());
            }
            line = stderr.next_line(), if stderr_open => match line {
                Ok(Some(line)) if line.starts_with("[event] ready ") => {
                    ready = true;
                    status.lock().await.state = "listening".into();
                    notify(emitter, id);
                }
                Ok(Some(_)) => {}
                Ok(None) => stderr_open = false,
                Err(_) => break Err("Cannot read DingTalk listener status".into()),
            },
            line = stdout.next_line(), if ready => match line {
                Ok(Some(line)) => {
                    if line.len() > 64 * 1024 { break Err("A DingTalk message exceeded the 64 KiB inbox limit".into()); }
                    let Ok(payload) = serde_json::from_str::<serde_json::Value>(&line) else { continue; };
                    let Some(message_id) = message_key(&payload) else { continue; };
                    if let Err(e) = automation_runtime_service::enqueue(&db.conn, id, &key, &message_id, &line).await {
                        break Err(format!("Cannot save incoming message: {e}"));
                    }
                    notify(emitter, id);
                }
                Ok(None) => break Err("DingTalk listener disconnected. Check dws login, account and target, then restart.".into()),
                Err(_) => break Err("Cannot read DingTalk message stream".into()),
            },
            result = child.wait() => {
                break Err(format!("DingTalk listener exited ({}). Check dws login, account and target, then restart.",
                    result.map(|s| s.to_string()).unwrap_or_else(|e| e.to_string())));
            }
        }
    };
    stop_child(&mut child).await;
    outcome
}

#[cfg(all(test, unix))]
#[path = "../../../src/maxcode-contracts/automation-message-stream.contract.rs"]
mod maxcode_automation_message_stream_contract;
