use std::ffi::OsString;
use std::io::Read;
use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::{DateTime, TimeZone, Utc};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;

use crate::models::{
    AgentType, ContentBlock, ConversationDetail, ConversationSummary, MessageTurn, TurnRole,
    TurnUsage,
};
use crate::parsers::{
    compute_session_stats, folder_name_from_path, truncate_str, AgentParser, ParseError,
};

/// Caps mirroring the Cursor parser: bound one noisy tool's output / input
/// preview so a single verbose command cannot bloat a detail payload.
const ZCODE_TOOL_OUTPUT_CAP: usize = 100_000;
const ZCODE_TOOL_INPUT_CAP: usize = 8_000;
const ZCODE_MAX_INLINE_IMAGE_BYTES: usize = 8 * 1024 * 1024;
// Native artifacts can contain either image bytes or a base64 data URL.
const ZCODE_MAX_IMAGE_ARTIFACT_BYTES: usize = ZCODE_MAX_INLINE_IMAGE_BYTES * 4 / 3 + 1024;

/// The community ACP bridge's `ZCODE_HOME` names the data root directly.
/// Retain the CLI's legacy `ZCODE_DATA_BASE_DIR` fallback, which names the
/// PARENT of `.zcode` (default `$HOME`). Both the SQLite session store and
/// the bridge's durable ACP aliases must resolve against the same root.
pub(crate) fn resolve_zcode_data_root() -> PathBuf {
    resolve_zcode_data_root_from(
        std::env::var_os("ZCODE_HOME"),
        std::env::var_os("ZCODE_DATA_BASE_DIR"),
        dirs::home_dir(),
    )
}

fn resolve_zcode_data_root_from(
    zcode_home: Option<OsString>,
    base_env: Option<OsString>,
    home_dir: Option<PathBuf>,
) -> PathBuf {
    if let Some(dir) =
        zcode_home.filter(|value| value.to_str().is_some_and(|path| !path.trim().is_empty()))
    {
        return PathBuf::from(dir);
    }
    if let Some(dir) = base_env.filter(|value| !value.is_empty()) {
        return PathBuf::from(dir).join(".zcode");
    }
    home_dir.unwrap_or_default().join(".zcode")
}

/// Parser for ZCode's SQLite session store.
///
/// The zcode runtime (the same harness behind the ZCode desktop app)
/// persists every session in ONE database at `<root>/cli/db/db.sqlite`:
///
/// ```text
/// session(id, project_id, directory, title, mode, task_type, parent_id,
///         time_created, time_updated, time_archived, …)
/// message(id, session_id, sequence, time_created, data)   -- data: JSON
/// part(id, message_id, session_id, sequence, time_created, data)  -- JSON
/// ```
///
/// `message.data` is `{role: user|assistant, time:{created},
/// modelSelection?:{providerId, modelId, options?, label?}, …}`; native
/// assistant messages put `providerId` and `modelId` at the top level.
/// `part.data` follows the AI-SDK UIMessage part vocabulary:
/// - `{"type":"text","text","time":{start,end}}`
/// - `{"type":"reasoning","text",…}` (field name is `text`)
/// - `{"type":"tool","callID","tool","state":{"status","input","output"}}`
/// - `{"type":"file","mime":"image/png","url":"zcode-artifact://…"}`
/// - `{"type":"step-start"}` / `{"type":"step-finish","reason","tokens":
///    {total,input,output,reasoning,cache:{read,write}},"cost"}`
/// - `{"type":"timeline","timelineType":"model_change",…}` separators
///
/// Every decode is defensive: unknown part types are skipped, so an
/// upstream schema drift drops detail rather than failing the parse.
pub struct ZcodeParser {
    db_path: PathBuf,
}

impl ZcodeParser {
    pub fn new() -> Self {
        Self {
            db_path: resolve_zcode_data_root()
                .join("cli")
                .join("db")
                .join("db.sqlite"),
        }
    }

    #[cfg(any(test, feature = "test-utils"))]
    pub fn with_db_path(db_path: PathBuf) -> Self {
        Self { db_path }
    }

    /// `session/new` in zcode-acp-server initially returns an ACP UUID. On
    /// first use the bridge records its native `sess_...` id in this file.
    /// Follow exactly one mapping so malformed/cyclic aliases cannot loop,
    /// and never let the alias file redirect an existing native session id.
    fn resolve_session_alias(&self, conversation_id: &str) -> Option<String> {
        if conversation_id.starts_with("sess_") {
            return None;
        }
        let data_root = self.db_path.parent()?.parent()?.parent()?;
        let alias_path = data_root.join("v2").join("acp-lazy-sessions.json");
        let raw = std::fs::read(alias_path).ok()?;
        let aliases: Value = serde_json::from_slice(&raw).ok()?;
        let native_id = aliases.get(conversation_id)?.get("zcodeSid")?.as_str()?;
        native_id
            .strip_prefix("sess_")
            .filter(|suffix| !suffix.is_empty() && !suffix.chars().any(char::is_whitespace))
            .map(|_| native_id.to_string())
    }

    /// Resolve only native artifacts belonging to the requested session.
    /// NodeToolArtifactStore writes `<root>/cli/artifacts/<session>/
    /// <tool-call>-tool-result-<uuid>.<extension>`; it can persist an image
    /// as raw bytes or as a textual data URL. Never follow arbitrary paths
    /// or fetch remote URLs recorded in file parts.
    fn read_image_artifact(&self, uri: &str, session_id: &str) -> Option<Vec<u8>> {
        let (owner, artifact_id) = uri.strip_prefix("zcode-artifact://")?.split_once('/')?;
        let owner = urlencoding::decode(owner).ok()?;
        let artifact_id = urlencoding::decode(artifact_id).ok()?;
        if owner != session_id
            || !session_id.starts_with("sess_")
            || !session_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        {
            return None;
        }
        let uuid_text = artifact_id.strip_prefix("tool-result-")?;
        if uuid::Uuid::parse_str(uuid_text).ok()?.to_string() != uuid_text {
            return None;
        }
        let data_root = self.db_path.parent()?.parent()?.parent()?;
        let artifact_root = data_root
            .join("cli")
            .join("artifacts")
            .canonicalize()
            .ok()?;
        if !artifact_root.starts_with(data_root.canonicalize().ok()?) {
            return None;
        }
        let session_dir = artifact_root.join(session_id);
        if !std::fs::symlink_metadata(&session_dir)
            .ok()?
            .file_type()
            .is_dir()
        {
            return None;
        }
        let suffix = format!("-{artifact_id}");
        let mut matching = std::fs::read_dir(&session_dir).ok()?.filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            (entry.file_type().ok()?.is_file() && path.file_stem()?.to_str()?.ends_with(&suffix))
                .then_some(path)
        });
        let path = matching.next()?;
        // Ambiguous artifact names should not display an unrelated image.
        if matching.next().is_some() {
            return None;
        }
        let file = std::fs::File::open(path).ok()?;
        let meta = file.metadata().ok()?;
        if !meta.is_file() || meta.len() == 0 || meta.len() > ZCODE_MAX_IMAGE_ARTIFACT_BYTES as u64
        {
            return None;
        }
        let mut bytes = Vec::new();
        file.take(ZCODE_MAX_IMAGE_ARTIFACT_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .ok()?;
        (bytes.len() <= ZCODE_MAX_IMAGE_ARTIFACT_BYTES).then_some(bytes)
    }

    fn file_part_block(&self, part: &Value, session_id: &str) -> ContentBlock {
        let mime = part.get("mime").and_then(Value::as_str).unwrap_or("");
        let name = part
            .get("filename")
            .and_then(Value::as_str)
            .filter(|name| !name.trim().is_empty());
        let image = (|| {
            if !mime.starts_with("image/") {
                return None;
            }
            let uri = part.get("url")?.as_str()?;
            let (mime_type, data) = if uri.starts_with("data:") {
                decode_image_data_url(uri)?
            } else {
                let bytes = self.read_image_artifact(uri, session_id)?;
                if bytes.starts_with(b"data:") {
                    decode_image_data_url(std::str::from_utf8(&bytes).ok()?)?
                } else {
                    if bytes.is_empty() || bytes.len() > ZCODE_MAX_INLINE_IMAGE_BYTES {
                        return None;
                    }
                    // Text/JSON tool artifacts must not become broken image
                    // blocks just because a malformed part claims an image.
                    image::guess_format(&bytes).ok()?;
                    (mime.to_string(), STANDARD.encode(bytes))
                }
            };
            Some(ContentBlock::Image {
                data,
                mime_type,
                uri: name.map(str::to_string),
            })
        })();
        image.unwrap_or_else(|| {
            let kind = if mime.starts_with("image/") {
                "image"
            } else {
                "file"
            };
            let label = name.filter(|name| !name.is_empty()).unwrap_or(mime);
            ContentBlock::Text {
                text: if kind == "image" {
                    format!("[image unavailable: {}]", truncate_str(label, 200))
                } else if label.is_empty() {
                    format!("[{kind}]")
                } else {
                    format!("[{kind} {}]", truncate_str(label, 200))
                },
            }
        })
    }

    fn open(&self) -> Result<Option<Connection>, ParseError> {
        if !self.db_path.is_file() {
            return Ok(None);
        }
        // Read-only and immutable-free: the CLI owns this database and keeps
        // a live WAL. A read-only open sees committed WAL frames without
        // ever writing (checkpointing stays the CLI's job).
        let conn = Connection::open_with_flags(
            &self.db_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY
                | OpenFlags::SQLITE_OPEN_NO_MUTEX
                | OpenFlags::SQLITE_OPEN_URI,
        )
        .map_err(|e| ParseError::InvalidData(format!("zcode db open failed: {e}")))?;
        Ok(Some(conn))
    }
}

fn decode_image_data_url(uri: &str) -> Option<(String, String)> {
    if uri.len() > ZCODE_MAX_IMAGE_ARTIFACT_BYTES {
        return None;
    }
    let (mime, encoded) = uri.strip_prefix("data:")?.split_once(";base64,")?;
    if !mime.starts_with("image/") || mime.chars().any(char::is_whitespace) {
        return None;
    }
    let bytes = STANDARD.decode(encoded).ok()?;
    if bytes.is_empty() || bytes.len() > ZCODE_MAX_INLINE_IMAGE_BYTES {
        return None;
    }
    image::guess_format(&bytes).ok()?;
    Some((mime.to_string(), STANDARD.encode(bytes)))
}

impl Default for ZcodeParser {
    fn default() -> Self {
        Self::new()
    }
}

fn ms_to_utc(ms: i64) -> DateTime<Utc> {
    Utc.timestamp_millis_opt(ms)
        .single()
        .unwrap_or_else(|| Utc.timestamp_millis_opt(0).single().unwrap_or_default())
}

/// User messages carry modelSelection; assistant messages persist their
/// actual providerId/modelId at the top level.
fn model_label(message: &Value) -> Option<String> {
    let selection = message
        .get("modelSelection")
        .filter(|selection| selection.is_object())
        .unwrap_or(message);
    let provider = selection.get("providerId").and_then(Value::as_str)?;
    let model = selection.get("modelId").and_then(Value::as_str)?;
    Some(format!("{provider}/{model}"))
}

struct SessionRow {
    id: String,
    directory: String,
    title: String,
    time_created: i64,
    time_updated: i64,
    parent_id: Option<String>,
}

impl AgentParser for ZcodeParser {
    fn list_conversations(&self) -> Result<Vec<ConversationSummary>, ParseError> {
        let Some(conn) = self.open()? else {
            return Ok(Vec::new());
        };
        let mut stmt = conn
            .prepare(
                "SELECT id, directory, title, time_created, time_updated, parent_id
                 FROM session
                 WHERE time_archived IS NULL
                 ORDER BY time_updated DESC",
            )
            .map_err(|e| ParseError::InvalidData(format!("zcode session query failed: {e}")))?;
        let rows: Vec<SessionRow> = stmt
            .query_map([], |row| {
                Ok(SessionRow {
                    id: row.get(0)?,
                    directory: row.get(1)?,
                    title: row.get(2)?,
                    time_created: row.get(3)?,
                    time_updated: row.get(4)?,
                    parent_id: row.get(5)?,
                })
            })
            .map_err(|e| ParseError::InvalidData(format!("zcode session query failed: {e}")))?
            .collect::<Result<_, _>>()
            .map_err(|e| ParseError::InvalidData(format!("zcode session row failed: {e}")))?;

        let mut summaries = Vec::new();
        for row in rows {
            // Interactive sessions only: the store also keeps workflow
            // children and subagent mirrors, which duplicate the parent
            // conversation's content in the aggregate list.
            let interactive: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM message WHERE session_id = ?1
                     AND json_extract(data, '$.role') = 'user')",
                    [&row.id],
                    |r| r.get::<_, i64>(0),
                )
                .map(|v| v != 0)
                .unwrap_or(false);
            if !interactive {
                continue;
            }
            let (message_count, model) = conn
                .query_row(
                    "SELECT COUNT(*),
                            (SELECT COALESCE(
                                        json_extract(data, '$.modelSelection.providerId') || '/' ||
                                        json_extract(data, '$.modelSelection.modelId'),
                                        json_extract(data, '$.providerId') || '/' ||
                                        json_extract(data, '$.modelId'))
                             FROM message
                             WHERE session_id = ?1
                               AND (json_extract(data, '$.modelSelection.providerId') IS NOT NULL
                                    OR json_extract(data, '$.providerId') IS NOT NULL)
                             ORDER BY time_created LIMIT 1)
                     FROM message WHERE session_id = ?1",
                    [&row.id],
                    |r| {
                        let model: Option<String> = r.get(1)?;
                        Ok((r.get::<_, i64>(0)?, model))
                    },
                )
                .unwrap_or((0, None));
            let folder = Some(row.directory.clone()).filter(|d| !d.trim().is_empty());
            summaries.push(ConversationSummary {
                id: row.id.clone(),
                agent_type: AgentType::Zcode,
                folder_name: folder.as_deref().map(folder_name_from_path),
                folder_path: folder,
                title: Some(row.title.clone()).filter(|t| !t.trim().is_empty()),
                started_at: ms_to_utc(row.time_created),
                ended_at: Some(ms_to_utc(row.time_updated)),
                message_count: message_count.max(0) as u32,
                model,
                git_branch: None,
                parent_id: row.parent_id,
                parent_tool_use_id: None,
                delegation_call_id: None,
            });
        }
        Ok(summaries)
    }

    fn get_conversation(&self, conversation_id: &str) -> Result<ConversationDetail, ParseError> {
        let Some(conn) = self.open()? else {
            return Err(ParseError::ConversationNotFound(
                conversation_id.to_string(),
            ));
        };
        let alias = self.resolve_session_alias(conversation_id);
        let session_id = alias.as_deref().unwrap_or(conversation_id);
        let row = conn
            .query_row(
                "SELECT id, directory, title, time_created, time_updated, parent_id
                 FROM session WHERE id = ?1",
                [session_id],
                |r| {
                    Ok(SessionRow {
                        id: r.get(0)?,
                        directory: r.get(1)?,
                        title: r.get(2)?,
                        time_created: r.get(3)?,
                        time_updated: r.get(4)?,
                        parent_id: r.get(5)?,
                    })
                },
            )
            .map_err(|e| ParseError::InvalidData(format!("zcode session query failed: {e}")))
            .map_err(|_| ParseError::ConversationNotFound(conversation_id.to_string()))?;

        // Two passes: messages in order, then each message's parts.
        let mut msg_stmt = conn
            .prepare(
                "SELECT id, time_created, data FROM message
                 WHERE session_id = ?1
                 ORDER BY sequence, time_created, id",
            )
            .map_err(|e| ParseError::InvalidData(format!("zcode message query failed: {e}")))?;
        let messages: Vec<(String, i64, String)> = msg_stmt
            .query_map([&row.id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(|e| ParseError::InvalidData(format!("zcode message query failed: {e}")))?
            .collect::<Result<_, _>>()
            .map_err(|e| ParseError::InvalidData(format!("zcode message row failed: {e}")))?;
        drop(msg_stmt);

        let mut part_stmt = conn
            .prepare(
                "SELECT message_id, data FROM part
                 WHERE session_id = ?1
                 ORDER BY message_id, sequence, time_created, id",
            )
            .map_err(|e| ParseError::InvalidData(format!("zcode part query failed: {e}")))?;
        let parts: Vec<(String, String)> = part_stmt
            .query_map([&row.id], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| ParseError::InvalidData(format!("zcode part query failed: {e}")))?
            .collect::<Result<_, _>>()
            .map_err(|e| ParseError::InvalidData(format!("zcode part row failed: {e}")))?;
        drop(part_stmt);

        let mut parts_by_message: std::collections::HashMap<String, Vec<Value>> =
            std::collections::HashMap::new();
        for (message_id, raw) in parts {
            if let Ok(value) = serde_json::from_str::<Value>(&raw) {
                parts_by_message.entry(message_id).or_default().push(value);
            }
        }

        let mut turns: Vec<MessageTurn> = Vec::new();
        for (index, (message_id, time_created, raw)) in messages.into_iter().enumerate() {
            let data: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
            let role = data.get("role").and_then(Value::as_str).unwrap_or("");
            let turn_role = match role {
                "user" => TurnRole::User,
                "assistant" => TurnRole::Assistant,
                _ => continue,
            };
            let parts = parts_by_message
                .get(&message_id)
                .cloned()
                .unwrap_or_default();
            let mut blocks: Vec<ContentBlock> = Vec::new();
            let mut usage: Option<TurnUsage> = None;
            let mut last_end_ms: Option<i64> = None;
            for part in &parts {
                let part_type = part.get("type").and_then(Value::as_str).unwrap_or("");
                match part_type {
                    "file" => blocks.push(self.file_part_block(part, &row.id)),
                    "text" => {
                        if let Some(text) = part.get("text").and_then(Value::as_str) {
                            if !text.trim().is_empty() {
                                blocks.push(ContentBlock::Text {
                                    text: text.to_string(),
                                });
                            }
                        }
                    }
                    "reasoning" => {
                        if let Some(text) = part.get("text").and_then(Value::as_str) {
                            if !text.trim().is_empty() {
                                blocks.push(ContentBlock::Thinking {
                                    text: truncate_str(text, ZCODE_TOOL_OUTPUT_CAP),
                                });
                            }
                        }
                    }
                    "tool" => {
                        let call_id = part
                            .get("callID")
                            .and_then(Value::as_str)
                            .map(str::to_string);
                        let tool_name = part
                            .get("tool")
                            .and_then(Value::as_str)
                            .unwrap_or("tool")
                            .to_string();
                        let state = part.get("state").cloned().unwrap_or(Value::Null);
                        let status = state.get("status").and_then(Value::as_str).map(|status| {
                            // Native persisted errors use `error`; the
                            // shared tool renderer expects `failed`.
                            if status == "error" { "failed" } else { status }.to_string()
                        });
                        let input_preview =
                            state.get("input").filter(|v| !v.is_null()).map(|input| {
                                truncate_str(
                                    &serde_json::to_string_pretty(input)
                                        .unwrap_or_else(|_| input.to_string()),
                                    ZCODE_TOOL_INPUT_CAP,
                                )
                            });
                        blocks.push(ContentBlock::ToolUse {
                            tool_use_id: call_id.clone(),
                            tool_name: tool_name.clone(),
                            input_preview,
                            status: status.clone(),
                            meta: None,
                        });
                        let output = state
                            .get("output")
                            .filter(|output| !output.is_null())
                            .or_else(|| state.get("error"));
                        let output_preview = match output {
                            None | Some(Value::Null) => None,
                            Some(Value::String(text)) => {
                                Some(truncate_str(text, ZCODE_TOOL_OUTPUT_CAP))
                            }
                            Some(other) => Some(truncate_str(
                                &serde_json::to_string_pretty(other)
                                    .unwrap_or_else(|_| other.to_string()),
                                ZCODE_TOOL_OUTPUT_CAP,
                            )),
                        };
                        let is_error = matches!(status.as_deref(), Some("failed"));
                        blocks.push(ContentBlock::ToolResult {
                            tool_use_id: call_id,
                            output_preview,
                            is_error,
                            agent_stats: None,
                            images: Vec::new(),
                        });
                    }
                    "step-finish" => {
                        let tokens = part.get("tokens").cloned().unwrap_or(Value::Null);
                        let read_u64 = |key: &str| {
                            tokens
                                .get(key)
                                .and_then(Value::as_i64)
                                .map(|v| v.max(0) as u64)
                        };
                        let cache_read = tokens
                            .pointer("/cache/read")
                            .and_then(Value::as_i64)
                            .map(|v| v.max(0) as u64);
                        let cache_write = tokens
                            .pointer("/cache/write")
                            .and_then(Value::as_i64)
                            .map(|v| v.max(0) as u64);
                        usage = Some(TurnUsage {
                            input_tokens: read_u64("input").unwrap_or(0),
                            output_tokens: read_u64("output").unwrap_or(0),
                            cache_creation_input_tokens: cache_write.unwrap_or(0),
                            cache_read_input_tokens: cache_read.unwrap_or(0),
                        });
                    }
                    _ => {
                        // step-start / timeline / future types: skip.
                    }
                }
                if let Some(end) = part.pointer("/time/end").and_then(Value::as_i64) {
                    last_end_ms = Some(end);
                } else if let Some(start) = part.pointer("/time/start").and_then(Value::as_i64) {
                    last_end_ms.get_or_insert(start);
                }
            }
            if blocks.is_empty() {
                continue;
            }
            let timestamp = data
                .pointer("/time/created")
                .and_then(Value::as_i64)
                .map(ms_to_utc)
                .unwrap_or_else(|| ms_to_utc(time_created));
            let completed_at = last_end_ms.map(ms_to_utc);
            let duration_ms = match (
                last_end_ms,
                data.pointer("/time/created").and_then(Value::as_i64),
            ) {
                (Some(end), Some(start)) if end >= start => Some((end - start) as u64),
                _ => None,
            };
            turns.push(MessageTurn {
                id: format!("turn-{index}"),
                role: turn_role,
                blocks,
                timestamp,
                usage,
                duration_ms,
                model: model_label(&data),
                completed_at,
                agent_message_id: Some(message_id),
            });
        }

        let folder = Some(row.directory.clone()).filter(|d| !d.trim().is_empty());
        let summary = ConversationSummary {
            id: row.id.clone(),
            agent_type: AgentType::Zcode,
            folder_name: folder.as_deref().map(folder_name_from_path),
            folder_path: folder,
            title: Some(row.title.clone()).filter(|t| !t.trim().is_empty()),
            started_at: ms_to_utc(row.time_created),
            ended_at: Some(ms_to_utc(row.time_updated)),
            message_count: turns.len() as u32,
            model: turns.iter().find_map(|t| t.model.clone()),
            git_branch: None,
            parent_id: row.parent_id,
            parent_tool_use_id: None,
            delegation_call_id: None,
        };
        let session_stats = compute_session_stats(&turns);
        Ok(ConversationDetail {
            summary,
            turns,
            session_stats,
            transcript_watermark: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    // The same 64x64 red PNG used in the real ACP image smoke test.
    const RED_PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAb0lEQVR4nO3PAQkAAAyEwO9feoshgnABdLep8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3IPanc8OLDQitxAAAAAElFTkSuQmCC";
    const IMAGE_ARTIFACT_ID: &str = "tool-result-01234567-89ab-4cde-8123-456789abcdef";

    fn replace_user_prompt_with_image(db_path: &std::path::Path, url: &str) {
        let conn = Connection::open(db_path).unwrap();
        let part = serde_json::json!({
            "type": "file", "mime": "image/png", "filename": "fixture.png", "url": url
        });
        conn.execute(
            "UPDATE part SET data = ?1 WHERE id = 'p1'",
            [part.to_string()],
        )
        .unwrap();
    }

    fn assert_image_placeholder(parser: &ZcodeParser) {
        let detail = parser.get_conversation("sess_a").unwrap();
        assert_eq!(
            detail.turns.len(),
            2,
            "a missing image must not drop its user turn"
        );
        assert!(matches!(
            &detail.turns[0].blocks[0],
            ContentBlock::Text { text } if text == "[image unavailable: fixture.png]"
        ));
    }

    fn fixture_db() -> (tempfile::TempDir, PathBuf) {
        let root = tempfile::tempdir().unwrap();
        let db_dir = root.path().join("cli").join("db");
        std::fs::create_dir_all(&db_dir).unwrap();
        let db_path = db_dir.join("db.sqlite");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE session (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL DEFAULT 'p',
                directory TEXT NOT NULL,
                title TEXT NOT NULL,
                time_created INTEGER NOT NULL,
                time_updated INTEGER NOT NULL,
                time_archived INTEGER,
                parent_id TEXT,
                version TEXT NOT NULL DEFAULT '',
                slug TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE message (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                time_created INTEGER NOT NULL,
                time_updated INTEGER NOT NULL,
                data TEXT NOT NULL,
                sequence INTEGER
            );
            CREATE TABLE part (
                id TEXT PRIMARY KEY,
                message_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                time_created INTEGER NOT NULL,
                time_updated INTEGER NOT NULL,
                data TEXT NOT NULL,
                sequence INTEGER
            );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO session (id, directory, title, time_created, time_updated)
             VALUES ('sess_a', '/tmp/proj', 'Probe conversation', 1000, 9000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO message (id, session_id, time_created, time_updated, data, sequence)
             VALUES ('m1', 'sess_a', 1000, 1000,
                     '{\"role\":\"user\",\"time\":{\"created\":1000}}', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO message (id, session_id, time_created, time_updated, data, sequence)
             VALUES ('m2', 'sess_a', 2000, 8000,
                     '{\"role\":\"assistant\",\"time\":{\"created\":2000},
                       \"modelSelection\":{\"providerId\":\"test-flash\",\"modelId\":\"glm-5.3-flash\"}}', 1)",
            [],
        )
        .unwrap();
        let insert_part = |id: &str, message: &str, seq: i64, data: &str| {
            conn.execute(
                "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data, sequence)
                 VALUES (?1, ?2, 'sess_a', 100, 100, ?3, ?4)",
                params![id, message, data, seq],
            )
            .unwrap();
        };
        insert_part(
            "p1",
            "m1",
            0,
            r#"{"type":"text","text":"Run echo hi","time":{"start":1000,"end":1000}}"#,
        );
        insert_part(
            "p2",
            "m2",
            0,
            r#"{"type":"reasoning","text":"thinking","time":{"start":2000,"end":2100}}"#,
        );
        insert_part(
            "p3",
            "m2",
            1,
            r#"{"type":"tool","callID":"call_1","tool":"Bash","state":{"status":"completed","input":{"command":"echo hi"},"output":"hi\n"}}"#,
        );
        insert_part(
            "p4",
            "m2",
            2,
            r#"{"type":"text","text":"It said hi","time":{"start":7000,"end":8000}}"#,
        );
        insert_part(
            "p5",
            "m2",
            3,
            r#"{"type":"step-finish","reason":"stop","tokens":{"total":100,"input":90,"output":10,"reasoning":2,"cache":{"read":50,"write":5}}}"#,
        );
        drop(conn);
        (root, db_path)
    }

    #[test]
    fn lists_and_parses_zcode_sessions() {
        let (_root, db_path) = fixture_db();
        let parser = ZcodeParser::with_db_path(db_path);
        let summaries = parser.list_conversations().unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].id, "sess_a");
        assert_eq!(summaries[0].title.as_deref(), Some("Probe conversation"));
        assert_eq!(
            summaries[0].model.as_deref(),
            Some("test-flash/glm-5.3-flash")
        );

        let detail = parser.get_conversation("sess_a").unwrap();
        assert_eq!(detail.turns.len(), 2);
        assert!(matches!(detail.turns[0].role, TurnRole::User));
        assert!(matches!(detail.turns[1].role, TurnRole::Assistant));
        // reasoning + tool_use/tool_result + text + usage on the assistant turn
        assert_eq!(detail.turns[1].blocks.len(), 4);
        assert!(matches!(
            detail.turns[1].blocks[0],
            ContentBlock::Thinking { .. }
        ));
        match &detail.turns[1].blocks[1] {
            ContentBlock::ToolUse {
                tool_name,
                input_preview,
                ..
            } => {
                assert_eq!(tool_name, "Bash");
                assert!(input_preview
                    .as_deref()
                    .unwrap_or_default()
                    .contains("echo hi"));
            }
            other => panic!("expected tool use, got {other:?}"),
        }
        let usage = detail.turns[1].usage.as_ref().expect("step-finish usage");
        assert_eq!(usage.input_tokens, 90);
        assert_eq!(usage.output_tokens, 10);
        assert_eq!(usage.cache_read_input_tokens, 50);
        assert_eq!(usage.cache_creation_input_tokens, 5);
        assert!(detail.session_stats.is_some());
    }

    #[test]
    fn missing_db_is_empty_not_error() {
        let parser = ZcodeParser::with_db_path(PathBuf::from("/nonexistent/zcode/db.sqlite"));
        assert!(parser.list_conversations().unwrap().is_empty());
        assert!(parser.get_conversation("x").is_err());
    }

    #[test]
    fn native_assistant_model_fields_survive_history_and_list_parsing() {
        let (_root, db_path) = fixture_db();
        let conn = Connection::open(&db_path).unwrap();
        // Real 0.16 native assistant records use these top-level fields,
        // unlike user records' modelSelection wrapper.
        conn.execute(
            "UPDATE message SET data = ?1 WHERE id = 'm2'",
            [r#"{"role":"assistant","time":{"created":2000},"providerId":"native-provider","modelId":"glm-5.3-flash"}"#],
        )
        .unwrap();
        drop(conn);
        let parser = ZcodeParser::with_db_path(db_path);
        let detail = parser.get_conversation("sess_a").unwrap();
        assert_eq!(
            detail.turns[1].model.as_deref(),
            Some("native-provider/glm-5.3-flash")
        );
        assert_eq!(detail.summary.model, detail.turns[1].model);
        assert_eq!(
            parser.list_conversations().unwrap()[0].model,
            detail.summary.model
        );
    }

    #[test]
    fn native_tool_errors_retain_failure_status_and_error_text() {
        let (_root, db_path) = fixture_db();
        let conn = Connection::open(&db_path).unwrap();
        // The installed runtime's persistPart failure branch writes
        // state.status=error and state.error, with no state.output.
        conn.execute(
            "UPDATE part SET data = ?1 WHERE id = 'p3'",
            [r#"{"type":"tool","callID":"call_1","tool":"Bash","state":{"status":"error","input":{"command":"false"},"error":"Command exited with code 1","time":{"start":2000,"end":2100}}}"#],
        )
        .unwrap();
        drop(conn);
        let detail = ZcodeParser::with_db_path(db_path)
            .get_conversation("sess_a")
            .unwrap();
        assert!(matches!(
            &detail.turns[1].blocks[1],
            ContentBlock::ToolUse { status: Some(status), .. } if status == "failed"
        ));
        assert!(matches!(
            &detail.turns[1].blocks[2],
            ContentBlock::ToolResult { is_error: true, output_preview: Some(text), .. }
                if text == "Command exited with code 1"
        ));
    }

    #[test]
    fn native_image_only_turn_keeps_data_urls_and_session_artifacts() {
        let (root, db_path) = fixture_db();
        let parser = ZcodeParser::with_db_path(db_path.clone());
        let data_url = format!("data:image/png;base64,{RED_PNG}");
        let artifact_uri = format!("zcode-artifact://sess_a/{IMAGE_ARTIFACT_ID}");
        let artifact_dir = root.path().join("cli").join("artifacts").join("sess_a");
        std::fs::create_dir_all(&artifact_dir).unwrap();
        let artifact_file = artifact_dir.join(format!("attachment-{IMAGE_ARTIFACT_ID}.txt"));

        // Native artifact stores support data URL text and binary images.
        for (url, artifact_bytes) in [
            (data_url.as_str(), Vec::new()),
            (artifact_uri.as_str(), data_url.as_bytes().to_vec()),
            (artifact_uri.as_str(), STANDARD.decode(RED_PNG).unwrap()),
        ] {
            std::fs::write(&artifact_file, artifact_bytes).unwrap();
            replace_user_prompt_with_image(&db_path, url);
            let detail = parser.get_conversation("sess_a").unwrap();
            assert_eq!(detail.turns.len(), 2);
            assert!(matches!(detail.turns[0].role, TurnRole::User));
            assert!(matches!(
                &detail.turns[0].blocks[0],
                ContentBlock::Image { data, mime_type, uri }
                    if data == RED_PNG && mime_type == "image/png" && uri.as_deref() == Some("fixture.png")
            ));
        }

        // Captured from the real image prompt: no filename/source, and an
        // artifact URI plus image metadata. The native store held a .txt
        // file whose body was a data URL for the same 168-byte PNG.
        let native_part = serde_json::json!({
            "type": "file", "mime": "image/png", "url": artifact_uri,
            "metadata": {
                "image": {
                    "height": 64, "width": 64, "maxDimension": 2000,
                    "originalHeight": 64, "originalWidth": 64,
                    "resized": false, "transformedSizeBytes": 168
                },
                "recoverability": "provider_ready", "sizeBytes": 246,
                "storageKind": "artifact", "artifactUri": artifact_uri
            }
        });
        std::fs::write(&artifact_file, &data_url).unwrap();
        let conn = Connection::open(&db_path).unwrap();
        conn.execute(
            "UPDATE part SET data = ?1 WHERE id = 'p1'",
            [native_part.to_string()],
        )
        .unwrap();
        drop(conn);
        let detail = parser.get_conversation("sess_a").unwrap();
        assert!(matches!(
            &detail.turns[0].blocks[0],
            ContentBlock::Image { data, mime_type, uri: None }
                if data == RED_PNG && mime_type == "image/png"
        ));
    }

    #[test]
    fn image_history_bounds_reads_and_keeps_unavailable_attachment_placeholders() {
        let (root, db_path) = fixture_db();
        let parser = ZcodeParser::with_db_path(db_path.clone());
        let valid_uri = format!("zcode-artifact://sess_a/{IMAGE_ARTIFACT_ID}");
        let other_uri = format!("zcode-artifact://sess_other/{IMAGE_ARTIFACT_ID}");
        let unsafe_uri = format!("zcode-artifact://sess_a/%2e%2e%2f{IMAGE_ARTIFACT_ID}");
        let oversized_data = format!(
            "data:image/png;base64,{}",
            "A".repeat(ZCODE_MAX_IMAGE_ARTIFACT_BYTES)
        );
        for uri in [
            valid_uri.as_str(), // missing artifact
            other_uri.as_str(),
            unsafe_uri.as_str(),
            "data:image/png;base64,%%%",
            "data:image/png;base64,e30=", // JSON bytes, not an image
            "data:text/plain;base64,QUJD",
            "https://example.invalid/fixture.png",
            "file:///unrelated/fixture.png",
            oversized_data.as_str(),
        ] {
            replace_user_prompt_with_image(&db_path, uri);
            assert_image_placeholder(&parser);
        }
        let artifact_dir = root.path().join("cli").join("artifacts").join("sess_a");
        std::fs::create_dir_all(&artifact_dir).unwrap();
        let artifact_file = artifact_dir.join(format!("attachment-{IMAGE_ARTIFACT_ID}.png"));
        let file = std::fs::File::create(&artifact_file).unwrap();
        file.set_len(ZCODE_MAX_IMAGE_ARTIFACT_BYTES as u64 + 1)
            .unwrap();
        replace_user_prompt_with_image(&db_path, &valid_uri);
        assert_image_placeholder(&parser);
        std::fs::write(artifact_file, b"corrupt artifact").unwrap();
        assert_image_placeholder(&parser);
    }

    #[cfg(unix)]
    #[test]
    fn image_artifacts_do_not_follow_file_or_session_directory_symlinks() {
        let (root, db_path) = fixture_db();
        let parser = ZcodeParser::with_db_path(db_path.clone());
        let outside = tempfile::tempdir().unwrap();
        let outside_file = outside
            .path()
            .join(format!("attachment-{IMAGE_ARTIFACT_ID}.png"));
        std::fs::write(&outside_file, STANDARD.decode(RED_PNG).unwrap()).unwrap();
        let artifact_dir = root.path().join("cli").join("artifacts").join("sess_a");
        std::fs::create_dir_all(&artifact_dir).unwrap();
        let link = artifact_dir.join(outside_file.file_name().unwrap());
        std::os::unix::fs::symlink(&outside_file, &link).unwrap();
        replace_user_prompt_with_image(
            &db_path,
            &format!("zcode-artifact://sess_a/{IMAGE_ARTIFACT_ID}"),
        );
        assert_image_placeholder(&parser);
        std::fs::remove_file(link).unwrap();
        std::fs::remove_dir(&artifact_dir).unwrap();
        std::os::unix::fs::symlink(outside.path(), &artifact_dir).unwrap();
        assert_image_placeholder(&parser);
    }

    #[test]
    fn lazy_acp_alias_loads_native_history_without_changing_list_ids() {
        let (root, db_path) = fixture_db();
        let parser = ZcodeParser::with_db_path(db_path);
        let acp_id = "11111111-2222-4333-8444-555555555555";
        let aliases_dir = root.path().join("v2");
        std::fs::create_dir_all(&aliases_dir).unwrap();
        let alias_path = aliases_dir.join("acp-lazy-sessions.json");

        // A newly created placeholder has no persisted native session yet.
        std::fs::write(
            &alias_path,
            serde_json::json!({acp_id: {"cwd": "/tmp/proj", "createdAt": 1}}).to_string(),
        )
        .unwrap();
        assert!(matches!(
            parser.get_conversation(acp_id),
            Err(ParseError::ConversationNotFound(id)) if id == acp_id
        ));

        // First prompt materializes the same alias; the next read sees it.
        let materialized = serde_json::json!({
            acp_id: {"cwd": "/tmp/proj", "zcodeSid": "sess_a", "createdAt": 1}
        })
        .to_string();
        std::fs::write(&alias_path, &materialized).unwrap();
        let detail = parser.get_conversation(acp_id).unwrap();
        assert_eq!(detail.summary.id, "sess_a");
        assert_eq!(detail.turns.len(), 2);
        assert!(matches!(
            &detail.turns[0].blocks[0],
            ContentBlock::Text { text } if text == "Run echo hi"
        ));
        assert_eq!(detail.turns[1].usage.as_ref().unwrap().output_tokens, 10);
        let summaries = parser.list_conversations().unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].id, "sess_a");
        assert_eq!(std::fs::read_to_string(&alias_path).unwrap(), materialized);
    }

    #[test]
    fn missing_corrupt_or_cyclic_aliases_are_not_found_without_hiding_native_history() {
        let (root, db_path) = fixture_db();
        let parser = ZcodeParser::with_db_path(db_path);
        let aliases_dir = root.path().join("v2");
        std::fs::create_dir_all(&aliases_dir).unwrap();
        let alias_path = aliases_dir.join("acp-lazy-sessions.json");

        assert!(matches!(
            parser.get_conversation("alias"),
            Err(ParseError::ConversationNotFound(id)) if id == "alias"
        ));
        for contents in [
            "{",
            "null",
            "[]",
            "{}",
            r#"{"alias":{"zcodeSid":null}}"#,
            r#"{"alias":{"zcodeSid":17}}"#,
            r#"{"alias":{"zcodeSid":""}}"#,
            r#"{"alias":{"zcodeSid":"sess_"}}"#,
            r#"{"alias":{"zcodeSid":"sess_ "}}"#,
            r#"{"alias":{"zcodeSid":"sess_missing"}}"#,
            r#"{"alias":{"zcodeSid":"alias"}}"#,
            r#"{"alias":{"zcodeSid":"other"},"other":{"zcodeSid":"alias"}}"#,
            r#"{"sess_a":{"zcodeSid":"sess_missing"}}"#,
        ] {
            std::fs::write(&alias_path, contents).unwrap();
            assert!(
                matches!(
                    parser.get_conversation("alias"),
                    Err(ParseError::ConversationNotFound(id)) if id == "alias"
                ),
                "unexpected result for {contents}"
            );
            assert_eq!(
                parser.get_conversation("sess_a").unwrap().summary.id,
                "sess_a"
            );
        }
    }

    #[test]
    fn data_root_resolves_env_then_home() {
        assert_eq!(
            resolve_zcode_data_root_from(
                Some(OsString::from("/custom/.zcode")),
                Some(OsString::from("/base")),
                Some(PathBuf::from("/home/u"))
            ),
            PathBuf::from("/custom/.zcode")
        );
        assert_eq!(
            resolve_zcode_data_root_from(
                None,
                Some(OsString::from("/base")),
                Some(PathBuf::from("/home/u"))
            ),
            PathBuf::from("/base/.zcode")
        );
        assert_eq!(
            resolve_zcode_data_root_from(None, None, Some(PathBuf::from("/home/u"))),
            PathBuf::from("/home/u/.zcode")
        );
        for empty in ["", " "] {
            assert_eq!(
                resolve_zcode_data_root_from(
                    Some(OsString::from(empty)),
                    Some(OsString::from("/base")),
                    Some(PathBuf::from("/home/u"))
                ),
                PathBuf::from("/base/.zcode")
            );
        }
        assert_eq!(
            resolve_zcode_data_root_from(
                None,
                Some(OsString::new()),
                Some(PathBuf::from("/home/u"))
            ),
            PathBuf::from("/home/u/.zcode")
        );
    }
}
