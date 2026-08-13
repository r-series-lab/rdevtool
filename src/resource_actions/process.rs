use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow, bail};
use chrono::{DateTime, SecondsFormat, Utc};
use reqwest::Url;
use serde_json::{Value, json};
use uuid::Uuid;

use super::{
    DEFAULT_ACTION_TIMEOUT_SECONDS, RESOURCE_ACTION_RESULT_SCHEMA_VERSION,
    RESOURCE_ACTION_SCHEMA_VERSION, ResourceActionConfig, ResourceActionEffect,
    ResourceActionExecutionContext, ResourceActionOperationContext, ResourceActionOperationPhase,
    ResourceActionOutputMode, ResourceActionParamKind, ResourceActionParamRole,
    ResourceActionProgressEvent, ResourceActionProgressReporter, ResourceActionProgressStream,
    ResourceActionResultStatus, ResourceActionRunResult, ResourceActionStructuredResult,
};
use crate::config::default_config_dir;
use crate::operation::{OperationEventState, lifecycle_operation_event, save_operation_event};

const MAX_ACTION_INPUT_BYTES: usize = 256 * 1024;
const MAX_ACTION_OUTPUT_BYTES: usize = 256 * 1024;
const MAX_STRUCTURED_RESULT_ITEMS: usize = 500;
const MAX_STRUCTURED_RESULT_PARAMETERS: usize = 100;
const MAX_OPERATION_EVENT_OUTPUT_BYTES: usize = 16 * 1024;
const MAX_OPERATION_EVENT_PARAMS_BYTES: usize = 32 * 1024;
const MAX_OPERATION_EVENT_RESULT_ITEMS: usize = 100;
const MAX_OPERATION_ID_LENGTH: usize = 160;
pub const RDEVTOOL_PROGRAM_ALIAS: &str = "@rdevtool";

pub(super) fn run_process_action(
    config_path: &Path,
    action: &ResourceActionConfig,
    params: BTreeMap<String, Value>,
    execution_context: &ResourceActionExecutionContext,
    operation_context: &ResourceActionOperationContext,
) -> Result<ResourceActionRunResult> {
    let operation_id = resource_action_operation_id(operation_context.operation_id.as_deref())?;
    let started_at = Utc::now();
    let started = Instant::now();
    persist_resource_action_operation(
        config_path,
        action,
        &params,
        execution_context,
        operation_context,
        &operation_id,
        &started_at,
        None,
        None,
    );

    let result = run_process_action_inner(
        config_path,
        action,
        params.clone(),
        execution_context,
        operation_context,
        &operation_id,
        started_at.clone(),
        started,
    );
    persist_resource_action_operation(
        config_path,
        action,
        &params,
        execution_context,
        operation_context,
        &operation_id,
        &started_at,
        result.as_ref().ok(),
        result.as_ref().err(),
    );
    result
}

#[allow(clippy::too_many_arguments)]
fn run_process_action_inner(
    config_path: &Path,
    action: &ResourceActionConfig,
    params: BTreeMap<String, Value>,
    execution_context: &ResourceActionExecutionContext,
    operation_context: &ResourceActionOperationContext,
    operation_id: &str,
    started_at: DateTime<Utc>,
    started: Instant,
) -> Result<ResourceActionRunResult> {
    let cwd = resolve_runner_cwd(config_path, action.runner.cwd.as_deref())?;
    let program = resolve_runner_program(&cwd, &action.runner.program, execution_context)?;
    let timeout_seconds = action
        .runner
        .timeout_seconds
        .unwrap_or(DEFAULT_ACTION_TIMEOUT_SECONDS);
    let payload = json!({
        "schemaVersion": RESOURCE_ACTION_SCHEMA_VERSION,
        "action": {
            "key": action.key,
            "name": action.name,
            "effect": action.effect,
        },
        "operation": {
            "id": operation_id,
            "startedAt": started_at.to_rfc3339(),
            "phase": operation_context.phase,
            "planId": operation_context.plan_id.as_deref(),
            "planEvidence": operation_context.plan_evidence.as_ref(),
        },
        "params": params,
    });
    let input =
        serde_json::to_vec(&payload).context("failed to serialize resource action input")?;
    if input.len() > MAX_ACTION_INPUT_BYTES {
        bail!(
            "resource action input is too large: {} bytes (max {})",
            input.len(),
            MAX_ACTION_INPUT_BYTES
        );
    }

    let mut command = Command::new(&program);
    command
        .args(&action.runner.args)
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .envs(&action.runner.env)
        .env("RDEVTOOL_ACTION_KEY", &action.key)
        .env("RDEVTOOL_ACTION_RUN_ID", &operation_id)
        .env("RDEVTOOL_ACTION_INPUT", "json_stdin");
    if let Some(cli_path) = &execution_context.rdevtool_cli_path {
        command
            .env("RDEVTOOL_CLI", cli_path)
            .env("RDEVTOOL_CLI_PATH", cli_path);
    }
    if let Some(config_path) = &execution_context.config_path {
        command.env("RDEVTOOL_CONFIG_PATH", config_path);
    }
    if let Some(workspace_key) = &execution_context.workspace_key {
        command.env("RDEVTOOL_WORKSPACE_KEY", workspace_key);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    let mut child = command.spawn().with_context(|| {
        format!(
            "failed to start resource action {} with program {}",
            action.key,
            program.display()
        )
    })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("failed to capture resource action stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("failed to capture resource action stderr"))?;
    let secret_values = action
        .params
        .iter()
        .filter(|param| param.kind == ResourceActionParamKind::Secret)
        .filter_map(|param| params.get(&param.key).and_then(Value::as_str))
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    let progress_sequence = Arc::new(AtomicU64::new(0));
    let output_suppressed = !secret_values.is_empty();
    if output_suppressed {
        report_action_progress(
            execution_context.progress_reporter.as_ref(),
            operation_id,
            &progress_sequence,
            ResourceActionProgressStream::System,
            String::new(),
            true,
        );
    }
    let stdout_progress =
        (!output_suppressed && action.runner.output == ResourceActionOutputMode::Text).then(|| {
            ReadProgress::new(
                execution_context.progress_reporter.clone(),
                operation_id,
                progress_sequence.clone(),
                ResourceActionProgressStream::Stdout,
            )
        });
    let stderr_progress = (!output_suppressed).then(|| {
        ReadProgress::new(
            execution_context.progress_reporter.clone(),
            operation_id,
            progress_sequence.clone(),
            ResourceActionProgressStream::Stderr,
        )
    });
    let stdout_reader = thread::spawn(move || {
        read_bounded(stdout, MAX_ACTION_OUTPUT_BYTES, stdout_progress.flatten())
    });
    let stderr_reader = thread::spawn(move || {
        read_bounded(stderr, MAX_ACTION_OUTPUT_BYTES, stderr_progress.flatten())
    });

    if let Some(mut stdin) = child.stdin.take()
        && let Err(error) = stdin.write_all(&input)
    {
        terminate_action_process(&mut child);
        let _ = child.wait();
        let _ = stdout_reader.join();
        let _ = stderr_reader.join();
        return Err(error).context("failed to write resource action JSON input");
    }

    let deadline = Instant::now() + Duration::from_secs(timeout_seconds);
    let mut timed_out = false;
    let mut cancelled = false;
    let status = loop {
        if let Some(status) = child
            .try_wait()
            .context("failed to inspect resource action process")?
        {
            break status;
        }
        if execution_context
            .cancellation_flag
            .as_ref()
            .is_some_and(|flag| flag.load(Ordering::SeqCst))
        {
            cancelled = true;
            terminate_action_process(&mut child);
            break child
                .wait()
                .context("failed to wait for cancelled resource action process")?;
        }
        if Instant::now() >= deadline {
            timed_out = true;
            terminate_action_process(&mut child);
            break child
                .wait()
                .context("failed to wait for timed out resource action process")?;
        }
        thread::sleep(Duration::from_millis(80));
    };

    let stdout = stdout_reader
        .join()
        .map_err(|_| anyhow!("resource action stdout reader panicked"))??;
    let stderr = stderr_reader
        .join()
        .map_err(|_| anyhow!("resource action stderr reader panicked"))??;
    let secret_value_refs = secret_values.iter().map(String::as_str).collect::<Vec<_>>();
    let mut stderr_text = redact_values(&stderr.text, &secret_value_refs);
    let mut structured_result = None;
    let mut protocol_valid = true;
    if action.runner.output == ResourceActionOutputMode::StructuredJson && !cancelled {
        match parse_structured_result(&stdout.text, action, &params, &secret_value_refs) {
            Ok(result) => structured_result = Some(result),
            Err(error) => {
                protocol_valid = false;
                if !stderr_text.is_empty() && !stderr_text.ends_with('\n') {
                    stderr_text.push('\n');
                }
                stderr_text.push_str(&format!("invalid structured action result: {error}"));
            }
        }
    }
    let structured_success = structured_result.as_ref().is_none_or(|result| {
        result
            .items
            .iter()
            .all(|item| item.status != ResourceActionResultStatus::Failed)
    });

    Ok(ResourceActionRunResult {
        operation_id: operation_id.to_string(),
        key: action.key.clone(),
        name: action.name.clone(),
        success: status.success()
            && !timed_out
            && !cancelled
            && protocol_valid
            && structured_success,
        exit_code: status.code(),
        timed_out,
        cancelled,
        stdout: redact_values(&stdout.text, &secret_value_refs),
        stderr: stderr_text,
        stdout_truncated: stdout.truncated,
        stderr_truncated: stderr.truncated,
        structured_result,
        started_at: started_at.to_rfc3339(),
        finished_at: Utc::now().to_rfc3339(),
        duration_ms: started.elapsed().as_millis(),
    })
}

fn resource_action_operation_id(preferred: Option<&str>) -> Result<String> {
    let Some(preferred) = preferred.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(format!("action-{}", Uuid::new_v4()));
    };
    if preferred.len() > MAX_OPERATION_ID_LENGTH
        || !preferred.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':' | '.')
        })
    {
        bail!("invalid resource action operation id: {preferred}");
    }
    Ok(preferred.to_string())
}

#[allow(clippy::too_many_arguments)]
fn persist_resource_action_operation(
    config_path: &Path,
    action: &ResourceActionConfig,
    params: &BTreeMap<String, Value>,
    execution_context: &ResourceActionExecutionContext,
    operation_context: &ResourceActionOperationContext,
    operation_id: &str,
    started_at: &DateTime<Utc>,
    result: Option<&ResourceActionRunResult>,
    error: Option<&anyhow::Error>,
) {
    let (Some(storage), Some(origin)) = (
        execution_context.operation_storage.as_ref(),
        execution_context.operation_origin,
    ) else {
        return;
    };
    let phase = resource_action_phase_key(operation_context.phase);
    let state = match (result, error) {
        (Some(result), _) if result.success => OperationEventState::Success,
        (Some(_), _) | (_, Some(_)) => OperationEventState::Failed,
        _ => OperationEventState::Running,
    };
    let summary = resource_action_operation_summary(action, state, result);
    let detail = resource_action_operation_detail(result, error);
    let (persisted_params, params_truncated) = persisted_resource_action_params(action, params);
    let secret_params = action
        .params
        .iter()
        .filter(|param| param.kind == ResourceActionParamKind::Secret)
        .map(|param| param.key.clone())
        .collect::<Vec<_>>();
    let provided_secret_params = action
        .params
        .iter()
        .filter(|param| param.kind == ResourceActionParamKind::Secret)
        .filter(|param| params.get(&param.key).is_some_and(param_value_is_present))
        .map(|param| param.key.clone())
        .collect::<Vec<_>>();
    let dry_run = action.params.iter().any(|param| {
        param.role == Some(ResourceActionParamRole::DryRun)
            && params.get(&param.key).and_then(Value::as_bool) == Some(true)
    });
    let can_write = matches!(
        action.effect,
        ResourceActionEffect::LocalWrite
            | ResourceActionEffect::RemoteWrite
            | ResourceActionEffect::Destructive
    );
    let plan_phase = operation_context.phase == ResourceActionOperationPhase::Plan;
    let side_effect_occurred = match (state, can_write && !dry_run && !plan_phase) {
        (_, false) => Value::Bool(false),
        (OperationEventState::Success, true) => Value::Bool(true),
        _ => Value::Null,
    };
    let error_payload = error
        .map(|error| {
            json!({
                "code": "resource_action_execution_error",
                "message": bounded_text(&error.to_string(), MAX_OPERATION_EVENT_OUTPUT_BYTES),
                "retryable": false,
                "sideEffectOccurred": side_effect_occurred.clone(),
            })
        })
        .or_else(|| {
            result.filter(|result| !result.success).map(|result| {
                json!({
                    "code": if result.cancelled {
                        "resource_action_cancelled"
                    } else if result.timed_out {
                        "resource_action_timeout"
                    } else {
                        "resource_action_failed"
                    },
                    "message": summary.clone(),
                    "retryable": false,
                    "sideEffectOccurred": side_effect_occurred.clone(),
                })
            })
        });
    let payload = json!({
        "operationId": operation_id,
        "actionKey": action.key,
        "actionName": action.name,
        "effect": action.effect,
        "phase": phase,
        "planId": operation_context.plan_id.as_deref(),
        "configPath": config_path.display().to_string(),
        "params": persisted_params,
        "paramsTruncated": params_truncated,
        "secretParams": secret_params,
        "providedSecretParams": provided_secret_params,
        "dryRun": dry_run,
        "sideEffectOccurred": side_effect_occurred,
        "result": result.map(persisted_resource_action_result),
        "error": error_payload,
    });
    let title = match operation_context.phase {
        ResourceActionOperationPhase::Run => "执行参数化 Action",
        ResourceActionOperationPhase::Plan => "检查参数化 Action 计划",
        ResourceActionOperationPhase::Apply => "按计划执行参数化 Action",
    };
    let mut event = lifecycle_operation_event(
        operation_id.to_string(),
        origin,
        execution_context
            .workspace_key
            .clone()
            .unwrap_or_else(|| "system".to_string()),
        "action",
        phase,
        state,
        title,
        &summary,
        &detail,
        None,
        None,
        Some(payload),
    );
    event.created_at = started_at.to_rfc3339_opts(SecondsFormat::Millis, true);
    if let Some(result) = result {
        event.updated_at = result.finished_at.clone();
    }
    if let Err(error) = save_operation_event(storage, &event) {
        eprintln!("warning: failed to save resource action operation event: {error}");
    }
}

fn resource_action_phase_key(phase: ResourceActionOperationPhase) -> &'static str {
    match phase {
        ResourceActionOperationPhase::Run => "run",
        ResourceActionOperationPhase::Plan => "plan",
        ResourceActionOperationPhase::Apply => "apply",
    }
}

fn resource_action_operation_summary(
    action: &ResourceActionConfig,
    state: OperationEventState,
    result: Option<&ResourceActionRunResult>,
) -> String {
    if let Some(summary) = result
        .and_then(|result| result.structured_result.as_ref())
        .and_then(|structured| structured.summary.as_deref())
        .map(str::trim)
        .filter(|summary| !summary.is_empty())
    {
        return summary.to_string();
    }
    if result.is_some_and(|result| result.cancelled) {
        return format!("{}已取消", action.name);
    }
    match state {
        OperationEventState::Running => format!("{} · 进行中", action.name),
        OperationEventState::Success => format!("{}执行完成", action.name),
        OperationEventState::Failed => format!("{}执行失败", action.name),
        OperationEventState::Info => action.name.clone(),
    }
}

fn resource_action_operation_detail(
    result: Option<&ResourceActionRunResult>,
    error: Option<&anyhow::Error>,
) -> String {
    if let Some(error) = error {
        return bounded_text(&error.to_string(), MAX_OPERATION_EVENT_OUTPUT_BYTES);
    }
    let Some(result) = result else {
        return String::new();
    };
    let mut lines = result
        .structured_result
        .as_ref()
        .into_iter()
        .flat_map(|structured| structured.items.iter())
        .take(MAX_OPERATION_EVENT_RESULT_ITEMS)
        .map(|item| {
            let status = match item.status {
                ResourceActionResultStatus::Success => "success",
                ResourceActionResultStatus::Warning => "warning",
                ResourceActionResultStatus::Failed => "failed",
                ResourceActionResultStatus::Skipped => "skipped",
            };
            let summary = item.summary.as_deref().unwrap_or_default();
            let detail = item.detail.as_deref().unwrap_or_default();
            [
                format!("{}: {status}", item.label),
                summary.to_string(),
                detail.to_string(),
            ]
            .into_iter()
            .filter(|value| !value.trim().is_empty())
            .collect::<Vec<_>>()
            .join(" · ")
        })
        .collect::<Vec<_>>();
    if !result.stderr.trim().is_empty() {
        lines.push(bounded_text(
            result.stderr.trim(),
            MAX_OPERATION_EVENT_OUTPUT_BYTES,
        ));
    }
    bounded_text(&lines.join("\n"), MAX_OPERATION_EVENT_OUTPUT_BYTES)
}

fn persisted_resource_action_params(
    action: &ResourceActionConfig,
    params: &BTreeMap<String, Value>,
) -> (Value, bool) {
    let secret_keys = action
        .params
        .iter()
        .filter(|param| param.kind == ResourceActionParamKind::Secret)
        .map(|param| param.key.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    let persisted = params
        .iter()
        .filter(|(key, _)| !secret_keys.contains(key.as_str()))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect::<BTreeMap<_, _>>();
    let value = serde_json::to_value(&persisted).unwrap_or_else(|_| json!({}));
    if serde_json::to_vec(&value).is_ok_and(|bytes| bytes.len() <= MAX_OPERATION_EVENT_PARAMS_BYTES)
    {
        (value, false)
    } else {
        (json!({}), true)
    }
}

fn persisted_resource_action_result(result: &ResourceActionRunResult) -> Value {
    let structured_result = result.structured_result.as_ref().map(|structured| {
        json!({
            "schemaVersion": structured.schema_version,
            "summary": structured.summary.as_deref(),
            "items": structured
                .items
                .iter()
                .take(MAX_OPERATION_EVENT_RESULT_ITEMS)
                .collect::<Vec<_>>(),
            "itemsTruncated": structured.items.len() > MAX_OPERATION_EVENT_RESULT_ITEMS,
            "retry": structured.retry.as_ref(),
        })
    });
    json!({
        "success": result.success,
        "exitCode": result.exit_code,
        "timedOut": result.timed_out,
        "cancelled": result.cancelled,
        "stdout": bounded_text(&result.stdout, MAX_OPERATION_EVENT_OUTPUT_BYTES),
        "stderr": bounded_text(&result.stderr, MAX_OPERATION_EVENT_OUTPUT_BYTES),
        "stdoutTruncated": result.stdout_truncated,
        "stderrTruncated": result.stderr_truncated,
        "structuredResult": structured_result,
        "startedAt": result.started_at,
        "finishedAt": result.finished_at,
        "durationMs": result.duration_ms,
    })
}

fn param_value_is_present(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::String(value) => !value.is_empty(),
        Value::Array(value) => !value.is_empty(),
        Value::Object(value) => !value.is_empty(),
        Value::Bool(_) | Value::Number(_) => true,
    }
}

fn bounded_text(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut start = value.len().saturating_sub(max_bytes);
    while start < value.len() && !value.is_char_boundary(start) {
        start += 1;
    }
    format!("[truncated]\n{}", &value[start..])
}

fn parse_structured_result(
    stdout: &str,
    action: &ResourceActionConfig,
    params: &BTreeMap<String, Value>,
    secret_values: &[&str],
) -> Result<ResourceActionStructuredResult> {
    let stdout = stdout.trim();
    if stdout.is_empty() {
        bail!("stdout is empty");
    }
    let mut result: ResourceActionStructuredResult = serde_json::from_str(stdout)
        .context("stdout is not a valid structured result JSON object")?;
    if result.schema_version != RESOURCE_ACTION_RESULT_SCHEMA_VERSION {
        bail!(
            "unsupported result schema version: {} (expected {})",
            result.schema_version,
            RESOURCE_ACTION_RESULT_SCHEMA_VERSION
        );
    }
    if result.items.len() > MAX_STRUCTURED_RESULT_ITEMS {
        bail!(
            "structured result contains too many items: {} (max {})",
            result.items.len(),
            MAX_STRUCTURED_RESULT_ITEMS
        );
    }
    let mut item_keys = std::collections::BTreeSet::new();
    for item in &result.items {
        require_result_text("item key", &item.key)?;
        require_result_text("item label", &item.label)?;
        if !item_keys.insert(item.key.as_str()) {
            bail!("duplicate structured result item key: {}", item.key);
        }
        if item.parameters.len() > MAX_STRUCTURED_RESULT_PARAMETERS {
            bail!(
                "structured result item {} contains too many parameters: {} (max {})",
                item.key,
                item.parameters.len(),
                MAX_STRUCTURED_RESULT_PARAMETERS
            );
        }
        for parameter in &item.parameters {
            require_result_text("parameter key", &parameter.key)?;
            require_result_text("parameter label", &parameter.label)?;
        }
        if let Some(url) = item.url.as_deref() {
            let parsed = Url::parse(url).with_context(|| {
                format!("structured result item {} has an invalid URL", item.key)
            })?;
            if !matches!(parsed.scheme(), "http" | "https") {
                bail!(
                    "structured result item {} URL must use http or https",
                    item.key
                );
            }
        }
    }
    if let Some(retry) = &result.retry {
        require_result_text("retry parameter", &retry.param)?;
        let param = action
            .params
            .iter()
            .find(|param| param.key == retry.param)
            .with_context(|| format!("retry parameter is not configured: {}", retry.param))?;
        if !matches!(
            param.kind,
            ResourceActionParamKind::MultiSelect | ResourceActionParamKind::ProjectMulti
        ) {
            bail!(
                "retry parameter must be multi_select or project_multi: {}",
                retry.param
            );
        }
        let requested = params
            .get(&retry.param)
            .and_then(Value::as_array)
            .with_context(|| {
                format!(
                    "retry parameter was not provided as an array: {}",
                    retry.param
                )
            })?
            .iter()
            .filter_map(Value::as_str)
            .collect::<std::collections::BTreeSet<_>>();
        let mut retry_values = std::collections::BTreeSet::new();
        for value in &retry.values {
            require_result_text("retry value", value)?;
            if !retry_values.insert(value.as_str()) {
                bail!("duplicate retry value: {value}");
            }
            if !requested.contains(value.as_str()) {
                bail!("retry value was not part of the original input: {value}");
            }
        }
    }
    redact_structured_result(&mut result, secret_values);
    Ok(result)
}

fn require_result_text(label: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        bail!("structured result {label} is required");
    }
    Ok(())
}

fn redact_structured_result(result: &mut ResourceActionStructuredResult, secret_values: &[&str]) {
    if let Some(summary) = &mut result.summary {
        *summary = redact_values(summary, secret_values);
    }
    for item in &mut result.items {
        item.key = redact_values(&item.key, secret_values);
        item.label = redact_values(&item.label, secret_values);
        if let Some(summary) = &mut item.summary {
            *summary = redact_values(summary, secret_values);
        }
        if let Some(detail) = &mut item.detail {
            *detail = redact_values(detail, secret_values);
        }
        if let Some(url) = &mut item.url {
            *url = redact_values(url, secret_values);
        }
        for parameter in &mut item.parameters {
            parameter.key = redact_values(&parameter.key, secret_values);
            parameter.label = redact_values(&parameter.label, secret_values);
            parameter.value = redact_values(&parameter.value, secret_values);
        }
    }
}

fn terminate_action_process(child: &mut Child) {
    #[cfg(unix)]
    {
        let process_group = format!("-{}", child.id());
        let _ = Command::new("kill")
            .args(["-TERM", process_group.as_str()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        thread::sleep(Duration::from_millis(150));
        let _ = Command::new("kill")
            .args(["-KILL", process_group.as_str()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
}

pub(super) fn resolve_runner_cwd(config_path: &Path, cwd: Option<&str>) -> Result<PathBuf> {
    let base_dir = config_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(default_config_dir);
    let cwd = cwd.map(str::trim).filter(|value| !value.is_empty());
    let resolved = match cwd {
        Some(value) if Path::new(value).is_absolute() => PathBuf::from(value),
        Some(value) => base_dir.join(value),
        None => base_dir,
    };
    if !resolved.exists() {
        bail!("resource action cwd does not exist: {}", resolved.display());
    }
    if !resolved.is_dir() {
        bail!(
            "resource action cwd is not a directory: {}",
            resolved.display()
        );
    }
    Ok(resolved)
}

pub(super) fn resolve_runner_program(
    cwd: &Path,
    program: &str,
    execution_context: &ResourceActionExecutionContext,
) -> Result<PathBuf> {
    if program == RDEVTOOL_PROGRAM_ALIAS {
        return execution_context.rdevtool_cli_path.clone().ok_or_else(|| {
            anyhow!(
                "@rdevtool is unavailable: {}",
                execution_context
                    .rdevtool_cli_error
                    .as_deref()
                    .unwrap_or("the App did not provide a compatible CLI")
            )
        });
    }
    let path = Path::new(program);
    Ok(if path.is_absolute() || path.components().count() == 1 {
        path.to_path_buf()
    } else {
        cwd.join(path)
    })
}

struct BoundedRead {
    text: String,
    truncated: bool,
}

struct ReadProgress {
    reporter: Option<ResourceActionProgressReporter>,
    operation_id: String,
    sequence: Arc<AtomicU64>,
    stream: ResourceActionProgressStream,
}

impl ReadProgress {
    fn new(
        reporter: Option<ResourceActionProgressReporter>,
        operation_id: &str,
        sequence: Arc<AtomicU64>,
        stream: ResourceActionProgressStream,
    ) -> Option<Self> {
        reporter.as_ref()?;
        Some(Self {
            reporter,
            operation_id: operation_id.to_string(),
            sequence,
            stream,
        })
    }

    fn report(&self, chunk: &[u8]) {
        report_action_progress(
            self.reporter.as_ref(),
            &self.operation_id,
            &self.sequence,
            self.stream,
            String::from_utf8_lossy(chunk).into_owned(),
            false,
        );
    }
}

fn report_action_progress(
    reporter: Option<&ResourceActionProgressReporter>,
    operation_id: &str,
    sequence: &AtomicU64,
    stream: ResourceActionProgressStream,
    chunk: String,
    output_suppressed: bool,
) {
    let Some(reporter) = reporter else {
        return;
    };
    reporter.report(ResourceActionProgressEvent {
        operation_id: operation_id.to_string(),
        sequence: sequence.fetch_add(1, Ordering::SeqCst) + 1,
        stream,
        chunk,
        output_suppressed,
        occurred_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
    });
}

fn read_bounded(
    mut reader: impl Read,
    limit: usize,
    progress: Option<ReadProgress>,
) -> Result<BoundedRead> {
    let mut kept = Vec::with_capacity(limit.min(16 * 1024));
    let mut buffer = [0_u8; 8 * 1024];
    let mut truncated = false;
    loop {
        let count = reader
            .read(&mut buffer)
            .context("failed to read resource action output")?;
        if count == 0 {
            break;
        }
        if let Some(progress) = &progress {
            progress.report(&buffer[..count]);
        }
        let remaining = limit.saturating_sub(kept.len());
        if remaining > 0 {
            kept.extend_from_slice(&buffer[..count.min(remaining)]);
        }
        if count > remaining {
            truncated = true;
        }
    }
    Ok(BoundedRead {
        text: String::from_utf8_lossy(&kept).into_owned(),
        truncated,
    })
}

fn redact_values(text: &str, secret_values: &[&str]) -> String {
    secret_values
        .iter()
        .fold(text.to_string(), |current, secret| {
            current.replace(secret, "***")
        })
}
