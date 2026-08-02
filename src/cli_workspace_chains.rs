use std::path::Path;
use std::process::Command;

use anyhow::{Result, bail};
use rdevtool_core::storage::Storage;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::cli_operation_context::{
    OPERATION_CHAIN_ID_ENV, OPERATION_CHAIN_LABEL_ENV, OPERATION_STEP_LABEL_ENV,
};

const WORKFLOW_STORAGE_NAMESPACE: &str = "workflow-signals";
const WORKFLOW_CHAINS_KEY: &str = "workspace-chains";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceWorkflowChain {
    pub id: String,
    pub workspace_key: String,
    pub name: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub steps: Vec<WorkspaceWorkflowStep>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceWorkflowStep {
    pub id: String,
    pub label: String,
    pub action: WorkspaceWorkflowAction,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceWorkflowAction {
    pub kind: String,
    pub label: String,
    #[serde(default)]
    pub workspace_key: Option<String>,
    #[serde(default)]
    pub project_key: Option<String>,
    #[serde(default)]
    pub payload: Option<Value>,
    pub dedupe_key: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceWorkflowStepPlan {
    pub index: usize,
    pub id: String,
    pub label: String,
    pub kind: String,
    pub command: Vec<String>,
    pub display: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceWorkflowPlan {
    pub chain_id: String,
    pub workspace_key: String,
    pub name: String,
    pub enabled: bool,
    pub steps: Vec<WorkspaceWorkflowStepPlan>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceWorkflowStepResult {
    pub index: usize,
    pub id: String,
    pub label: String,
    pub success: bool,
    pub exit_code: Option<i32>,
    pub output: Value,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceWorkflowRunResponse {
    pub chain_id: String,
    pub run_id: String,
    pub workspace_key: String,
    pub name: String,
    pub success: bool,
    pub completed_step_count: usize,
    pub total_step_count: usize,
    pub failed_step: Option<String>,
    pub steps: Vec<WorkspaceWorkflowStepResult>,
}

fn default_enabled() -> bool {
    true
}

fn required_string(value: Option<&Value>, label: &str) -> Result<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| anyhow::anyhow!("{label} is required"))
}

fn optional_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn append_option(args: &mut Vec<String>, name: &str, value: Option<String>) {
    if let Some(value) = value {
        args.push(name.to_string());
        args.push(value);
    }
}

fn branch_projects(request: &Value, action: &WorkspaceWorkflowAction) -> Vec<String> {
    let mut projects = string_array(request.get("projects"));
    if let Some(project) = optional_string(request.get("project")).or_else(|| {
        action
            .project_key
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    }) && !projects.contains(&project)
    {
        projects.push(project);
    }
    projects
}

fn branch_command(action: &WorkspaceWorkflowAction) -> Result<Vec<String>> {
    let payload = action
        .payload
        .as_ref()
        .and_then(Value::as_object)
        .ok_or_else(|| anyhow::anyhow!("Git action payload is missing"))?;
    let command = required_string(payload.get("command"), "Git replay command")?;
    let request = payload
        .get("request")
        .filter(|value| value.is_object())
        .ok_or_else(|| anyhow::anyhow!("Git replay request is missing"))?;
    let projects = branch_projects(request, action);

    let mut args = vec!["git".to_string()];
    match command.as_str() {
        "execute_branch_sync_task" => {
            if projects.is_empty() {
                bail!("merge step requires at least one project");
            }
            args.push("merge-many".to_string());
            for project in projects {
                args.extend(["--project".to_string(), project]);
            }
            args.extend([
                "--source".to_string(),
                required_string(request.get("sourceBranch"), "source branch")?,
            ]);
            let targets = string_array(request.get("targetBranches"));
            if targets.is_empty() {
                bail!("merge step requires at least one target branch");
            }
            for target in targets {
                args.extend(["--target".to_string(), target]);
            }
        }
        "execute_branch_create_task" => {
            if projects.is_empty() {
                bail!("create step requires at least one project");
            }
            args.push("create".to_string());
            for project in projects {
                args.extend(["--project".to_string(), project]);
            }
            args.extend([
                "--source".to_string(),
                required_string(request.get("sourceBranch"), "source branch")?,
                "--target".to_string(),
                required_string(request.get("targetBranch"), "target branch")?,
            ]);
        }
        "checkout_branch_to_directory_task" => {
            let project = required_string(request.get("project"), "project").or_else(|_| {
                action
                    .project_key
                    .clone()
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| anyhow::anyhow!("project is required"))
            })?;
            args.extend([
                "clone".to_string(),
                "--project".to_string(),
                project,
                "--source".to_string(),
                required_string(request.get("sourceBranch"), "source branch")?,
                required_string(request.get("destinationDir"), "destination directory")?,
            ]);
        }
        "execute_branch_switch_task" => {
            args.extend([
                "switch".to_string(),
                "--project".to_string(),
                required_string(request.get("project"), "project").or_else(|_| {
                    action
                        .project_key
                        .clone()
                        .filter(|value| !value.trim().is_empty())
                        .ok_or_else(|| anyhow::anyhow!("project is required"))
                })?,
                "--target".to_string(),
                required_string(request.get("targetBranch"), "target branch")?,
            ]);
            append_option(
                &mut args,
                "--repo-path",
                optional_string(request.get("repoPath")),
            );
        }
        "execute_branch_push_task" => {
            args.extend([
                "push".to_string(),
                "--project".to_string(),
                required_string(request.get("project"), "project").or_else(|_| {
                    action
                        .project_key
                        .clone()
                        .filter(|value| !value.trim().is_empty())
                        .ok_or_else(|| anyhow::anyhow!("project is required"))
                })?,
            ]);
            append_option(
                &mut args,
                "--repo-path",
                optional_string(request.get("repoPath")),
            );
            if request
                .get("commitBeforePush")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                args.extend([
                    "--message".to_string(),
                    required_string(request.get("commitMessage"), "commit message")?,
                ]);
                for path in string_array(request.get("selectedPaths")) {
                    args.extend(["--path".to_string(), path]);
                }
            }
        }
        _ => bail!("unsupported Git replay command: {command}"),
    }
    Ok(args)
}

fn build_command(action: &WorkspaceWorkflowAction) -> Result<Vec<String>> {
    let payload = action
        .payload
        .as_ref()
        .and_then(Value::as_object)
        .ok_or_else(|| anyhow::anyhow!("build action payload is missing"))?;
    let project = required_string(payload.get("project"), "build project").or_else(|_| {
        action
            .project_key
            .clone()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| anyhow::anyhow!("build project is required"))
    })?;
    let mut args = vec!["build".to_string(), "run".to_string(), project];
    append_option(
        &mut args,
        "--target",
        optional_string(payload.get("target")),
    );
    if let Some(params) = payload.get("params").and_then(Value::as_object) {
        let mut params = params
            .iter()
            .filter_map(|(key, value)| {
                value
                    .as_str()
                    .map(|value| (key.trim(), value))
                    .filter(|(key, _)| !key.is_empty())
            })
            .collect::<Vec<_>>();
        params.sort_by(|left, right| left.0.cmp(right.0));
        for (key, value) in params {
            args.extend(["--set".to_string(), format!("{key}={value}")]);
        }
    }
    args.push("--compact".to_string());
    Ok(args)
}

fn action_payload(action: &WorkspaceWorkflowAction) -> Result<&serde_json::Map<String, Value>> {
    action
        .payload
        .as_ref()
        .and_then(Value::as_object)
        .ok_or_else(|| anyhow::anyhow!("{} action payload is missing", action.kind))
}

fn action_project_key(action: &WorkspaceWorkflowAction) -> Result<String> {
    action
        .project_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| anyhow::anyhow!("{} action requires a project", action.kind))
}

fn runtime_command(action: &WorkspaceWorkflowAction) -> Result<Vec<String>> {
    let project = action_project_key(action)?;
    let mut args = vec!["runtime".to_string()];
    match action.kind.trim() {
        "project.runtime.start" => {
            args.extend(["start".to_string(), "--project".to_string(), project]);
            if let Some(payload) = action.payload.as_ref().and_then(Value::as_object) {
                append_option(
                    &mut args,
                    "--debug-profile",
                    optional_string(payload.get("debugProfile")),
                );
                if let Some(port) = payload.get("expectedPort").and_then(Value::as_u64) {
                    args.extend(["--expect-port".to_string(), port.to_string()]);
                }
                if let Some(env) = payload.get("envOverrides").and_then(Value::as_object) {
                    let mut entries = env
                        .iter()
                        .filter_map(|(key, value)| {
                            value
                                .as_str()
                                .map(|value| (key.trim(), value))
                                .filter(|(key, _)| !key.is_empty())
                        })
                        .collect::<Vec<_>>();
                    entries.sort_by(|left, right| left.0.cmp(right.0));
                    for (key, value) in entries {
                        args.extend(["--env".to_string(), format!("{key}={value}")]);
                    }
                }
            }
        }
        "project.runtime.stop" => {
            args.extend(["stop".to_string(), "--project".to_string(), project]);
        }
        kind => bail!("unsupported runtime workflow action: {kind}"),
    }
    Ok(args)
}

fn proxy_command(action: &WorkspaceWorkflowAction) -> Result<Vec<String>> {
    let payload = action_payload(action)?;
    let profile = required_string(payload.get("profileId"), "proxy profile")?;
    let command = match action.kind.trim() {
        "proxy.start" => "start",
        "proxy.stop" => "stop",
        kind => bail!("unsupported proxy workflow action: {kind}"),
    };
    let mut args = vec!["proxy".to_string()];
    append_option(
        &mut args,
        "--source",
        optional_string(payload.get("sourceId")),
    );
    args.extend([command.to_string(), profile]);
    Ok(args)
}

fn link_command(action: &WorkspaceWorkflowAction) -> Result<Vec<String>> {
    let payload = action_payload(action)?;
    let key = required_string(payload.get("linkKey"), "Link key")?;
    let command = match action.kind.trim() {
        "link.run" => "run",
        "link.stop" => "stop",
        kind => bail!("unsupported Link workflow action: {kind}"),
    };
    let mut args = vec!["link".to_string()];
    append_option(
        &mut args,
        "--source",
        optional_string(payload.get("sourceId")),
    );
    args.extend([command.to_string(), key]);
    Ok(args)
}

fn step_command(step: &WorkspaceWorkflowStep) -> Result<Vec<String>> {
    match step.action.kind.trim() {
        "branch.replay" => branch_command(&step.action),
        "build.replay" | "deploy.replay" => build_command(&step.action),
        "project.runtime.start" | "project.runtime.stop" => runtime_command(&step.action),
        "proxy.start" | "proxy.stop" => proxy_command(&step.action),
        "link.run" | "link.stop" => link_command(&step.action),
        kind => bail!("unsupported workflow action kind: {kind}"),
    }
}

fn shell_display(args: &[String]) -> String {
    args.iter()
        .map(|arg| {
            if arg
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || "-_./:=".contains(character))
            {
                arg.clone()
            } else {
                format!("'{}'", arg.replace('\'', "'\\''"))
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub(crate) fn load_workspace_chains(storage: &Storage) -> Result<Vec<WorkspaceWorkflowChain>> {
    let value = storage
        .get_json(WORKFLOW_STORAGE_NAMESPACE, WORKFLOW_CHAINS_KEY)
        .map_err(anyhow::Error::msg)?
        .unwrap_or_else(|| json!([]));
    serde_json::from_value(value).map_err(anyhow::Error::from)
}

pub(crate) fn find_workspace_chain(
    storage: &Storage,
    chain_id: &str,
    workspace_scope: Option<&str>,
) -> Result<WorkspaceWorkflowChain> {
    let chain_id = chain_id.trim();
    let chain = load_workspace_chains(storage)?
        .into_iter()
        .find(|chain| chain.id == chain_id)
        .ok_or_else(|| anyhow::anyhow!("workspace workflow chain {chain_id} not found"))?;
    if let Some(workspace_scope) = workspace_scope
        && chain.workspace_key != workspace_scope
    {
        bail!(
            "workflow chain {} belongs to workspace {}, not {}",
            chain.id,
            chain.workspace_key,
            workspace_scope
        );
    }
    Ok(chain)
}

pub(crate) fn plan_workspace_chain(
    chain: &WorkspaceWorkflowChain,
    allow_disabled: bool,
) -> Result<WorkspaceWorkflowPlan> {
    if !chain.enabled && !allow_disabled {
        bail!("workflow chain {} is disabled", chain.id);
    }
    if chain.steps.len() < 2 {
        bail!("workflow chain {} requires at least two steps", chain.id);
    }
    let steps = chain
        .steps
        .iter()
        .enumerate()
        .map(|(index, step)| {
            let command = step_command(step)
                .map_err(|error| anyhow::anyhow!("step {}: {error}", index + 1))?;
            Ok(WorkspaceWorkflowStepPlan {
                index: index + 1,
                id: step.id.clone(),
                label: step.label.clone(),
                kind: step.action.kind.clone(),
                display: format!(
                    "rdevtool --workspace {} {}",
                    shell_display(std::slice::from_ref(&chain.workspace_key)),
                    shell_display(&command)
                ),
                command,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(WorkspaceWorkflowPlan {
        chain_id: chain.id.clone(),
        workspace_key: chain.workspace_key.clone(),
        name: chain.name.clone(),
        enabled: chain.enabled,
        steps,
    })
}

fn parse_child_output(stdout: &[u8]) -> Value {
    let text = String::from_utf8_lossy(stdout).trim().to_string();
    if text.is_empty() {
        return Value::Null;
    }
    serde_json::from_str(&text).unwrap_or_else(|_| json!({ "stdout": text }))
}

pub(crate) fn run_workspace_chain(
    plan: &WorkspaceWorkflowPlan,
    config_override: Option<&Path>,
    follow_build: bool,
    poll_interval_ms: Option<u64>,
    timeout_secs: Option<u64>,
) -> Result<WorkspaceWorkflowRunResponse> {
    let executable = std::env::current_exe()?;
    let run_id = format!(
        "workspace-chain:{}:cli-{}",
        plan.chain_id.trim(),
        Uuid::new_v4()
    );
    let mut results = Vec::new();

    for step in &plan.steps {
        let mut command = Command::new(&executable);
        if let Some(config_override) = config_override {
            command.arg("--config").arg(config_override);
        }
        command
            .arg("--workspace")
            .arg(&plan.workspace_key)
            .arg("--json")
            .args(&step.command);
        command
            .env(OPERATION_CHAIN_ID_ENV, &run_id)
            .env(OPERATION_CHAIN_LABEL_ENV, &plan.name)
            .env(OPERATION_STEP_LABEL_ENV, &step.label);
        if follow_build && matches!(step.kind.as_str(), "build.replay" | "deploy.replay") {
            command.arg("--follow");
            if let Some(poll_interval_ms) = poll_interval_ms {
                command
                    .arg("--poll-interval-ms")
                    .arg(poll_interval_ms.to_string());
            }
            if let Some(timeout_secs) = timeout_secs {
                command.arg("--timeout-secs").arg(timeout_secs.to_string());
            }
        }

        let output = command.output()?;
        let success = output.status.success();
        let parsed_output = parse_child_output(&output.stdout);
        let error = if success {
            None
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Some(if stderr.is_empty() {
                parsed_output
                    .pointer("/error/message")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| format!("step exited with status {}", output.status))
            } else {
                stderr
            })
        };
        results.push(WorkspaceWorkflowStepResult {
            index: step.index,
            id: step.id.clone(),
            label: step.label.clone(),
            success,
            exit_code: output.status.code(),
            output: parsed_output,
            error,
        });
        if !success {
            break;
        }
    }

    let success = results.len() == plan.steps.len() && results.iter().all(|step| step.success);
    let completed_step_count = results.iter().filter(|step| step.success).count();
    let failed_step = results
        .iter()
        .find(|step| !step.success)
        .map(|step| step.label.clone());
    Ok(WorkspaceWorkflowRunResponse {
        chain_id: plan.chain_id.clone(),
        run_id,
        workspace_key: plan.workspace_key.clone(),
        name: plan.name.clone(),
        success,
        completed_step_count,
        total_step_count: plan.steps.len(),
        failed_step,
        steps: results,
    })
}

#[cfg(test)]
mod tests {
    use super::{WorkspaceWorkflowChain, plan_workspace_chain};

    fn chain() -> WorkspaceWorkflowChain {
        serde_json::from_value(serde_json::json!({
            "id": "delivery",
            "workspaceKey": "feature-a",
            "name": "推送并构建",
            "enabled": true,
            "steps": [
                {
                    "id": "push",
                    "label": "推送分支",
                    "action": {
                        "kind": "branch.replay",
                        "label": "推送分支",
                        "workspaceKey": "feature-a",
                        "projectKey": "admin",
                        "payload": {
                            "command": "execute_branch_push_task",
                            "request": {
                                "project": "admin",
                                "repoPath": "/tmp/admin"
                            }
                        },
                        "dedupeKey": "push:admin"
                    }
                },
                {
                    "id": "build",
                    "label": "构建 UAT",
                    "action": {
                        "kind": "build.replay",
                        "label": "构建 UAT",
                        "workspaceKey": "feature-a",
                        "projectKey": "admin",
                        "payload": {
                            "project": "admin",
                            "target": "uat",
                            "params": {
                                "BRANCH": "feature/a",
                                "ENV": "uat"
                            }
                        },
                        "dedupeKey": "build:admin:uat"
                    }
                }
            ]
        }))
        .expect("chain")
    }

    #[test]
    fn plans_existing_git_and_build_commands() {
        let plan = plan_workspace_chain(&chain(), false).expect("plan");
        assert_eq!(
            plan.steps[0].command,
            [
                "git",
                "push",
                "--project",
                "admin",
                "--repo-path",
                "/tmp/admin"
            ]
        );
        assert_eq!(
            plan.steps[1].command,
            [
                "build",
                "run",
                "admin",
                "--target",
                "uat",
                "--set",
                "BRANCH=feature/a",
                "--set",
                "ENV=uat",
                "--compact"
            ]
        );
    }

    #[test]
    fn disabled_chain_requires_explicit_override() {
        let mut value = chain();
        value.enabled = false;
        assert!(plan_workspace_chain(&value, false).is_err());
        assert!(plan_workspace_chain(&value, true).is_ok());
    }

    #[test]
    fn plans_runtime_proxy_and_link_actions_through_domain_commands() {
        let value: WorkspaceWorkflowChain = serde_json::from_value(serde_json::json!({
            "id": "local-debug",
            "workspaceKey": "feature-a",
            "name": "本地联调",
            "enabled": true,
            "steps": [
                {
                    "id": "proxy",
                    "label": "启动代理",
                    "action": {
                        "kind": "proxy.start",
                        "label": "启动代理",
                        "workspaceKey": "feature-a",
                        "payload": {
                            "sourceId": "workspace-proxy",
                            "profileId": "local-debug"
                        },
                        "dedupeKey": "proxy.start:local-debug"
                    }
                },
                {
                    "id": "runtime",
                    "label": "启动项目",
                    "action": {
                        "kind": "project.runtime.start",
                        "label": "启动项目",
                        "workspaceKey": "feature-a",
                        "projectKey": "admin",
                        "payload": {
                            "debugProfile": "dc2",
                            "expectedPort": 8080,
                            "envOverrides": {
                                "APP_ENV": "dc2"
                            }
                        },
                        "dedupeKey": "runtime.start:admin:dc2"
                    }
                },
                {
                    "id": "link",
                    "label": "启动链路",
                    "action": {
                        "kind": "link.run",
                        "label": "启动链路",
                        "workspaceKey": "feature-a",
                        "payload": {
                            "sourceId": "workspace-link",
                            "linkKey": "cooperation-debug"
                        },
                        "dedupeKey": "link.run:cooperation-debug"
                    }
                }
            ]
        }))
        .expect("generic workflow chain");

        let plan = plan_workspace_chain(&value, false).expect("plan");
        assert_eq!(
            plan.steps[0].command,
            [
                "proxy",
                "--source",
                "workspace-proxy",
                "start",
                "local-debug"
            ]
        );
        assert_eq!(
            plan.steps[1].command,
            [
                "runtime",
                "start",
                "--project",
                "admin",
                "--debug-profile",
                "dc2",
                "--expect-port",
                "8080",
                "--env",
                "APP_ENV=dc2"
            ]
        );
        assert_eq!(
            plan.steps[2].command,
            [
                "link",
                "--source",
                "workspace-link",
                "run",
                "cooperation-debug"
            ]
        );
    }
}
