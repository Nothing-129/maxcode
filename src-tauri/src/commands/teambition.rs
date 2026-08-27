use std::{collections::HashSet, process::Stdio};

use rmcp::{
    model::CallToolRequestParams, service::RunningService, transport::TokioChildProcess,
    RoleClient, ServiceExt,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tokio::process::Command;
use tokio::time::{timeout, Duration};

use crate::app_error::AppCommandError;
use crate::commands::acp::{resolve_command_on_path, resolve_npx_command};
use crate::commands::mcp::find_local_server;

const USER_ROLES: &str = "creator,executor,involveMember";
const PAGE_SIZE: &str = "1000";
const PREFLIGHT_TIMEOUT: Duration = Duration::from_secs(20);
const REQUIRED_TOOLS: [&str; 5] = [
    "searchUserTasksV3",
    "searchTaskflowStatusesV3",
    "searchTaskflowsV3",
    "queryTaskV3",
    "updateTaskStatusV3",
];

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeambitionTask {
    pub task_id: String,
    pub project_id: String,
    pub unique_id: i64,
    pub content: String,
    pub tfs_id: String,
    pub sfc_id: String,
    #[serde(default)]
    pub executor_id: Option<String>,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub accomplish_time: Option<String>,
    pub is_done: bool,
    pub priority: i32,
    pub created: String,
    pub updated: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeambitionStatus {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub pos: i64,
    pub taskflow_id: String,
    pub is_deleted: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeambitionTaskflow {
    pub id: String,
    pub name: String,
    pub is_deleted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeambitionBoard {
    pub project_id: String,
    pub tasks: Vec<TeambitionTask>,
    pub statuses: Vec<TeambitionStatus>,
    pub taskflows: Vec<TeambitionTaskflow>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiPage<T> {
    code: i32,
    #[serde(default)]
    error_message: String,
    #[serde(default)]
    next_page_token: String,
    result: Vec<T>,
}

type McpClient = RunningService<RoleClient, ()>;

fn teambition_error(message: impl Into<String>) -> AppCommandError {
    AppCommandError::task_execution_failed(message)
}

fn validate_identifier(label: &str, value: String) -> Result<String, AppCommandError> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 128
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(AppCommandError::invalid_input(format!(
            "Invalid Teambition {label}"
        )));
    }
    Ok(value.to_string())
}

fn validate_enabled(spec: &Map<String, Value>) -> Result<(), AppCommandError> {
    for (key, disabled_value) in [("enabled", false), ("disabled", true)] {
        let Some(value) = spec.get(key) else {
            continue;
        };
        let value = value.as_bool().ok_or_else(|| {
            AppCommandError::configuration_invalid(format!(
                "Teambition MCP preflight failed: '{key}' must be a boolean"
            ))
        })?;
        if value == disabled_value {
            return Err(AppCommandError::configuration_missing(
                "Teambition MCP preflight failed: the 'teambition' server is disabled",
            ));
        }
    }
    Ok(())
}

fn missing_required_tools<'a>(available: impl IntoIterator<Item = &'a str>) -> Vec<&'static str> {
    let available = available.into_iter().collect::<HashSet<_>>();
    REQUIRED_TOOLS
        .iter()
        .copied()
        .filter(|tool| !available.contains(tool))
        .collect()
}

async fn preflight_tools(client: &McpClient) -> Result<(), AppCommandError> {
    let tools = timeout(PREFLIGHT_TIMEOUT, client.list_all_tools())
        .await
        .map_err(|_| {
            teambition_error("Teambition MCP preflight timed out while listing available tools")
        })?
        .map_err(|error| {
            teambition_error(format!(
                "Teambition MCP preflight could not list available tools: {error}"
            ))
        })?;
    let missing = missing_required_tools(tools.iter().map(|tool| tool.name.as_ref()));
    if missing.is_empty() {
        return Ok(());
    }
    Err(AppCommandError::dependency_missing(format!(
        "Teambition MCP preflight failed: missing required tools: {}",
        missing.join(", ")
    )))
}

async fn connect(server_id: &str) -> Result<McpClient, AppCommandError> {
    let server = find_local_server(server_id)?.ok_or_else(|| {
        AppCommandError::configuration_missing(
            format!(
                "Teambition MCP server '{server_id}' is not configured. Configure it from the Teambition page."
            ),
        )
    })?;
    let spec = server.spec.as_object().ok_or_else(|| {
        AppCommandError::configuration_invalid(
            "Teambition MCP preflight failed: config must be an object",
        )
    })?;
    validate_enabled(spec)?;
    let transport = spec.get("type").and_then(Value::as_str).unwrap_or("stdio");
    if transport != "stdio" {
        return Err(AppCommandError::configuration_invalid(
            "Teambition MCP preflight failed: the server must use the stdio transport",
        ));
    }
    let executable = spec
        .get("command")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppCommandError::configuration_invalid(
                "Teambition MCP preflight failed: config is missing its command",
            )
        })?;

    let executable = if executable == "npx" {
        resolve_npx_command("npx").await.ok_or_else(|| {
            AppCommandError::dependency_missing(
                "Teambition MCP requires Node.js and npx, but MaxCode could not find npx",
            )
        })?
    } else {
        resolve_command_on_path(executable).unwrap_or_else(|| executable.into())
    };

    let mut command = Command::new(executable);
    if let Some(args) = spec.get("args").and_then(Value::as_array) {
        command.args(args.iter().filter_map(Value::as_str));
    }
    if let Some(env) = spec.get("env").and_then(Value::as_object) {
        command.envs(
            env.iter()
                .filter_map(|(key, value)| value.as_str().map(|value| (key, value))),
        );
    }
    if let Some(cwd) = spec
        .get("cwd")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        command.current_dir(cwd);
    }

    let (transport, _) = TokioChildProcess::builder(command)
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            AppCommandError::dependency_missing(
                "Teambition MCP preflight failed: unable to start the configured command",
            )
            .with_detail(error.to_string())
        })?;
    let client = timeout(PREFLIGHT_TIMEOUT, ().serve(transport))
        .await
        .map_err(|_| teambition_error("Teambition MCP preflight timed out during initialization"))?
        .map_err(|error| {
            teambition_error(format!(
                "Teambition MCP preflight failed during initialization: {error}"
            ))
        })?;
    if let Err(error) = preflight_tools(&client).await {
        let _ = client.cancel().await;
        return Err(error);
    }
    Ok(client)
}

async fn call_json(
    client: &McpClient,
    tool: &'static str,
    arguments: Value,
) -> Result<Value, AppCommandError> {
    let arguments = arguments.as_object().cloned().unwrap_or_else(Map::new);
    let result = client
        .call_tool(CallToolRequestParams::new(tool).with_arguments(arguments))
        .await
        .map_err(|error| teambition_error(format!("Teambition MCP call failed: {error}")))?;

    if let Some(value) = result.structured_content {
        return Ok(value);
    }

    let text = result
        .content
        .iter()
        .find_map(|content| content.raw.as_text().map(|text| text.text.as_str()))
        .ok_or_else(|| teambition_error("Teambition MCP returned no JSON content"))?;
    if result.is_error == Some(true) {
        return Err(teambition_error(text));
    }
    parse_tool_json(text)
}

fn parse_tool_json(text: &str) -> Result<Value, AppCommandError> {
    let start = text.find('{').ok_or_else(|| {
        teambition_error("Teambition MCP returned a response without a JSON object")
    })?;
    serde_json::from_str(&text[start..]).map_err(|error| {
        teambition_error(format!("Unable to parse Teambition MCP response: {error}"))
    })
}

fn parse_page<T: for<'de> Deserialize<'de>>(value: Value) -> Result<ApiPage<T>, AppCommandError> {
    let page: ApiPage<T> = serde_json::from_value(value).map_err(|error| {
        teambition_error(format!("Unexpected Teambition MCP response: {error}"))
    })?;
    if page.code != 200 {
        return Err(teambition_error(if page.error_message.is_empty() {
            format!("Teambition returned status {}", page.code)
        } else {
            page.error_message.clone()
        }));
    }
    Ok(page)
}

fn ensure_success(value: &Value) -> Result<(), AppCommandError> {
    let code = value.get("code").and_then(Value::as_i64).ok_or_else(|| {
        teambition_error("Unexpected Teambition MCP response: missing status code")
    })?;
    if code == 200 {
        return Ok(());
    }
    let message = value
        .get("errorMessage")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("Teambition returned status {code}"));
    Err(teambition_error(message))
}

async fn list_tasks(
    client: &McpClient,
    project_id: &str,
) -> Result<Vec<TeambitionTask>, AppCommandError> {
    let mut tasks = Vec::new();
    let mut page_token = String::new();
    loop {
        let mut arguments = json!({
            "roleTypes": USER_ROLES,
            "pageSize": PAGE_SIZE,
            "tql": format!("projectId={project_id} AND isArchived=false"),
        });
        if !page_token.is_empty() {
            arguments["pageToken"] = Value::String(page_token);
        }
        let page: ApiPage<TeambitionTask> =
            parse_page(call_json(client, "searchUserTasksV3", arguments).await?)?;
        tasks.extend(
            page.result
                .into_iter()
                .filter(|task| task.project_id == project_id),
        );
        page_token = page.next_page_token;
        if page_token.is_empty() {
            break;
        }
    }
    tasks.sort_by(|left, right| right.updated.cmp(&left.updated));
    let mut seen = HashSet::new();
    tasks.retain(|task| seen.insert(task.task_id.clone()));
    Ok(tasks)
}

async fn list_statuses(
    client: &McpClient,
    project_id: &str,
) -> Result<Vec<TeambitionStatus>, AppCommandError> {
    let mut statuses = Vec::new();
    let mut page_token = String::new();
    loop {
        let mut arguments = json!({
            "projectId": project_id,
            "pageSize": 1000,
        });
        if !page_token.is_empty() {
            arguments["pageToken"] = Value::String(page_token);
        }
        let page: ApiPage<TeambitionStatus> =
            parse_page(call_json(client, "searchTaskflowStatusesV3", arguments).await?)?;
        statuses.extend(page.result.into_iter().filter(|status| !status.is_deleted));
        page_token = page.next_page_token;
        if page_token.is_empty() {
            break;
        }
    }
    statuses.sort_by(|left, right| {
        left.taskflow_id
            .cmp(&right.taskflow_id)
            .then(left.pos.cmp(&right.pos))
            .then(left.id.cmp(&right.id))
    });
    Ok(statuses)
}

async fn list_taskflows(
    client: &McpClient,
    project_id: &str,
) -> Result<Vec<TeambitionTaskflow>, AppCommandError> {
    let page: ApiPage<TeambitionTaskflow> = parse_page(
        call_json(
            client,
            "searchTaskflowsV3",
            json!({ "projectId": project_id, "pageSize": 1000 }),
        )
        .await?,
    )?;
    Ok(page
        .result
        .into_iter()
        .filter(|taskflow| !taskflow.is_deleted)
        .collect())
}

async fn query_task(
    client: &McpClient,
    project_id: &str,
    task_id: &str,
) -> Result<TeambitionTask, AppCommandError> {
    let page: ApiPage<TeambitionTask> =
        parse_page(call_json(client, "queryTaskV3", json!({ "taskId": task_id })).await?)?;
    let task = page
        .result
        .into_iter()
        .find(|task| task.task_id == task_id)
        .ok_or_else(|| AppCommandError::not_found("Teambition task not found"))?;
    if task.project_id != project_id {
        return Err(AppCommandError::permission_denied(
            "Teambition task does not belong to the configured project",
        ));
    }
    Ok(task)
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn teambition_board(
    server_id: String,
    project_id: String,
) -> Result<TeambitionBoard, AppCommandError> {
    let server_id = validate_identifier("MCP server ID", server_id)?;
    let project_id = validate_identifier("project ID", project_id)?;
    let client = connect(&server_id).await?;
    let result = async {
        let tasks = list_tasks(&client, &project_id).await?;
        let statuses = list_statuses(&client, &project_id).await?;
        let taskflows = list_taskflows(&client, &project_id).await?;
        Ok(TeambitionBoard {
            project_id,
            tasks,
            statuses,
            taskflows,
        })
    }
    .await;
    let _ = client.cancel().await;
    result
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn teambition_update_task_status(
    server_id: String,
    project_id: String,
    task_id: String,
    status_id: String,
) -> Result<TeambitionTask, AppCommandError> {
    let server_id = validate_identifier("MCP server ID", server_id)?;
    let project_id = validate_identifier("project ID", project_id)?;
    let client = connect(&server_id).await?;
    let result = async {
        let before = query_task(&client, &project_id, &task_id).await?;
        let statuses = list_statuses(&client, &project_id).await?;
        let current = statuses
            .iter()
            .find(|status| status.id == before.tfs_id)
            .ok_or_else(|| teambition_error("Current Teambition task status is unavailable"))?;
        let target = statuses
            .iter()
            .find(|status| status.id == status_id)
            .ok_or_else(|| AppCommandError::invalid_input("Unknown Teambition task status"))?;
        if current.taskflow_id != target.taskflow_id {
            return Err(AppCommandError::invalid_input(
                "The target status belongs to a different Teambition workflow",
            ));
        }
        if before.tfs_id == target.id {
            return Ok(before);
        }

        let update = call_json(
            &client,
            "updateTaskStatusV3",
            json!({
                "taskId": task_id,
                "requestBody": { "taskflowstatusId": target.id },
            }),
        )
        .await?;
        ensure_success(&update)?;
        let after = query_task(&client, &project_id, &task_id).await?;
        if after.tfs_id != target.id {
            return Err(teambition_error(
                "Teambition did not apply the requested task status",
            ));
        }
        Ok(after)
    }
    .await;
    let _ = client.cancel().await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_mcp_text_prefix() {
        let value = parse_tool_json("API Response (Status: 200):\n{\"code\":200}").unwrap();
        assert_eq!(value["code"], 200);
    }

    #[test]
    fn rejects_non_json_mcp_text() {
        assert!(parse_tool_json("not json").is_err());
    }

    #[test]
    fn rejects_explicitly_disabled_server() {
        let spec =
            serde_json::from_value::<Map<String, Value>>(json!({ "enabled": false })).unwrap();
        assert!(validate_enabled(&spec).is_err());

        let spec =
            serde_json::from_value::<Map<String, Value>>(json!({ "disabled": true })).unwrap();
        assert!(validate_enabled(&spec).is_err());
    }

    #[test]
    fn rejects_invalid_enabled_flag() {
        let spec =
            serde_json::from_value::<Map<String, Value>>(json!({ "enabled": "yes" })).unwrap();
        assert!(validate_enabled(&spec).is_err());
    }

    #[test]
    fn reports_every_missing_required_tool() {
        let missing = missing_required_tools(["searchUserTasksV3", "queryTaskV3"]);
        assert_eq!(
            missing,
            vec![
                "searchTaskflowStatusesV3",
                "searchTaskflowsV3",
                "updateTaskStatusV3"
            ]
        );
    }

    #[test]
    fn accepts_complete_required_tool_set() {
        assert!(missing_required_tools(REQUIRED_TOOLS).is_empty());
    }

    #[test]
    fn validates_configured_identifiers() {
        assert_eq!(
            validate_identifier("project ID", " 67244dbc1b2dbce76a282336 ".into()).unwrap(),
            "67244dbc1b2dbce76a282336"
        );
        assert!(validate_identifier("project ID", "projectId=x OR true".into()).is_err());
        assert!(validate_identifier("MCP server ID", "".into()).is_err());
    }
}
