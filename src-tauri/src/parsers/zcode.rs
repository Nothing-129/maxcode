use std::ffi::OsString;
use std::path::PathBuf;

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

/// Resolve ZCode's data root, mirroring the CLI's own chain
/// (`resolvePath` in zcode): `ZCODE_DATA_BASE_DIR` names the PARENT of
/// `.zcode` (default `$HOME`), and everything hangs off `<base>/.zcode` —
/// the CLI session store at `cli/db/db.sqlite`, provider config at
/// `v2/provider_config.json`.
pub(crate) fn resolve_zcode_data_root() -> PathBuf {
    resolve_zcode_data_root_from(
        std::env::var_os("ZCODE_DATA_BASE_DIR"),
        dirs::home_dir(),
    )
}

fn resolve_zcode_data_root_from(
    base_env: Option<OsString>,
    home_dir: Option<PathBuf>,
) -> PathBuf {
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
/// modelSelection?:{providerId, modelId, options?, label?}, …}`.
/// `part.data` follows the AI-SDK UIMessage part vocabulary:
/// - `{"type":"text","text","time":{start,end}}`
/// - `{"type":"reasoning","text",…}` (field name is `text`)
/// - `{"type":"tool","callID","tool","state":{"status","input","output"}}`
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
            db_path: resolve_zcode_data_root().join("cli").join("db").join("db.sqlite"),
        }
    }

    #[cfg(any(test, feature = "test-utils"))]
    pub fn with_db_path(db_path: PathBuf) -> Self {
        Self { db_path }
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

/// Pull a compact model label out of a message's modelSelection, e.g.
/// `bigmodel-api/GLM-5.3`.
fn model_label(message: &Value) -> Option<String> {
    let selection = message.get("modelSelection")?;
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
            .query_map(
                [],
                |row| {
                    Ok(SessionRow {
                        id: row.get(0)?,
                        directory: row.get(1)?,
                        title: row.get(2)?,
                        time_created: row.get(3)?,
                        time_updated: row.get(4)?,
                        parent_id: row.get(5)?,
                    })
                },
            )
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
                            (SELECT json_extract(data, '$.modelSelection.providerId') || '/' ||
                                    json_extract(data, '$.modelSelection.modelId')
                             FROM message
                             WHERE session_id = ?1
                               AND json_extract(data, '$.modelSelection.providerId') IS NOT NULL
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
            return Err(ParseError::ConversationNotFound(conversation_id.to_string()));
        };
        let row = conn
            .query_row(
                "SELECT id, directory, title, time_created, time_updated, parent_id
                 FROM session WHERE id = ?1",
                [conversation_id],
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
            .query_map([conversation_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
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
            .query_map([conversation_id], |r| Ok((r.get(0)?, r.get(1)?)))
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
            let parts = parts_by_message.get(&message_id).cloned().unwrap_or_default();
            let mut blocks: Vec<ContentBlock> = Vec::new();
            let mut usage: Option<TurnUsage> = None;
            let mut last_end_ms: Option<i64> = None;
            for part in &parts {
                let part_type = part.get("type").and_then(Value::as_str).unwrap_or("");
                match part_type {
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
                        let status = state
                            .get("status")
                            .and_then(Value::as_str)
                            .map(str::to_string);
                        let input_preview = state
                            .get("input")
                            .filter(|v| !v.is_null())
                            .map(|input| {
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
                        let output = state.get("output");
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
                            tokens.get(key).and_then(Value::as_i64).map(|v| v.max(0) as u64)
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
            let duration_ms = match (last_end_ms, data.pointer("/time/created").and_then(Value::as_i64)) {
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

    fn fixture_db() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "zcode-parser-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("db.sqlite");
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
        insert_part("p1", "m1", 0, r#"{"type":"text","text":"Run echo hi","time":{"start":1000,"end":1000}}"#);
        insert_part("p2", "m2", 0, r#"{"type":"reasoning","text":"thinking","time":{"start":2000,"end":2100}}"#);
        insert_part(
            "p3",
            "m2",
            1,
            r#"{"type":"tool","callID":"call_1","tool":"Bash","state":{"status":"completed","input":{"command":"echo hi"},"output":"hi\n"}}"#,
        );
        insert_part("p4", "m2", 2, r#"{"type":"text","text":"It said hi","time":{"start":7000,"end":8000}}"#);
        insert_part(
            "p5",
            "m2",
            3,
            r#"{"type":"step-finish","reason":"stop","tokens":{"total":100,"input":90,"output":10,"reasoning":2,"cache":{"read":50,"write":5}}}"#,
        );
        drop(conn);
        db_path
    }

    #[test]
    fn lists_and_parses_zcode_sessions() {
        let parser = ZcodeParser::with_db_path(fixture_db());
        let summaries = parser.list_conversations().unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].id, "sess_a");
        assert_eq!(summaries[0].title.as_deref(), Some("Probe conversation"));
        assert_eq!(summaries[0].model.as_deref(), Some("test-flash/glm-5.3-flash"));

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
                assert!(input_preview.as_deref().unwrap_or_default().contains("echo hi"));
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
    fn data_root_resolves_env_then_home() {
        assert_eq!(
            resolve_zcode_data_root_from(
                Some(OsString::from("/base")),
                Some(PathBuf::from("/home/u"))
            ),
            PathBuf::from("/base/.zcode")
        );
        assert_eq!(
            resolve_zcode_data_root_from(None, Some(PathBuf::from("/home/u"))),
            PathBuf::from("/home/u/.zcode")
        );
    }
}
