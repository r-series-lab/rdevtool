use anyhow::Result;
use chrono::{SecondsFormat, Utc};
use rdevtool_core::config::AppConfig;
use rdevtool_core::core::{
    self, BranchPushRequest, MergeRequest, branch_push_status, execute_branch_push,
};
use rdevtool_core::history_id;
use rdevtool_core::replay::ReplayAction;
use rdevtool_core::storage::Storage;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;

use crate::BuildFollowOptions;

mod checkpoint;

pub use checkpoint::PromoteExecution;
#[cfg(test)]
use checkpoint::{PromoteStageCheckpoint, PromoteStageState, stage_mut};
use checkpoint::{begin_stage, complete_stage, fail_stage, load_execution, save_execution};

const PROMOTE_PLAN_NAMESPACE: &str = "workflow-promote-plan";

#[derive(Debug, Clone)]
pub struct PromotePlanRequest {
    pub project: String,
    pub repo_path: Option<String>,
    pub source_branch: Option<String>,
    pub target_branch: String,
    pub deploy_history_id: String,
    pub commit_message: Option<String>,
    pub selected_paths: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoteEffective {
    pub project: String,
    pub repo_path: String,
    pub source_branch: String,
    pub target_branch: String,
    pub deploy_history_id: String,
    pub commit_message: Option<String>,
    pub selected_paths: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoteObserved {
    pub push_status: Value,
    pub merge_overview: Value,
    pub deploy_action: ReplayAction,
    pub deploy_preview: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromotePlan {
    pub schema_version: u32,
    pub plan_hash: String,
    pub workspace_key: String,
    pub created_at: String,
    pub effective: PromoteEffective,
    pub observed: PromoteObserved,
    pub stages: Vec<PromoteStagePlan>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoteStagePlan {
    pub key: String,
    pub label: String,
    pub side_effect: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoteStatus {
    pub plan: PromotePlan,
    pub execution: PromoteExecution,
}

pub fn create_promote_plan(config: &AppConfig, request: PromotePlanRequest) -> Result<PromotePlan> {
    validate_commit_scope(&request)?;
    let workspace = crate::active_history_workspace_cli()?;
    let push_status = branch_push_status(config, &request.project, request.repo_path.as_deref())?;
    if push_status.detached {
        anyhow::bail!("promote source repository is in detached HEAD state");
    }
    if push_status.conflicted_count > 0 {
        anyhow::bail!(
            "promote source repository has {} conflicted file(s)",
            push_status.conflicted_count
        );
    }

    let source_branch = request
        .source_branch
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&push_status.current_branch)
        .to_string();
    if source_branch != push_status.current_branch {
        anyhow::bail!(
            "promote source branch mismatch: requested {}, repository is on {}",
            source_branch,
            push_status.current_branch
        );
    }
    validate_selected_paths(&request.selected_paths, &push_status.files)?;

    let effective = PromoteEffective {
        project: request.project,
        repo_path: push_status.repo_path.clone(),
        source_branch,
        target_branch: required_value("target branch", &request.target_branch)?,
        deploy_history_id: required_value("deploy history id", &request.deploy_history_id)?,
        commit_message: normalized_optional(request.commit_message),
        selected_paths: normalized_paths(request.selected_paths),
    };
    let scoped_config = config_with_repo_path(config, &effective)?;
    let merge_overview = core::branch_commit_overview(
        &scoped_config,
        &effective.project,
        &effective.source_branch,
        &effective.target_branch,
    )?;
    let deploy_action = crate::find_history_replay_action(
        &Storage::new_default().map_err(anyhow::Error::msg)?,
        &effective.deploy_history_id,
    )?;
    if deploy_action.kind != "build" {
        anyhow::bail!("promote deploy history must reference a build action");
    }
    if deploy_action.project_key != effective.project {
        anyhow::bail!(
            "promote project mismatch: workflow uses {}, deploy history uses {}",
            effective.project,
            deploy_action.project_key
        );
    }
    let deploy_preview = crate::preview_history_replay(&scoped_config, &deploy_action)?;
    let deploy_branch = deploy_preview_branch(&deploy_preview)
        .ok_or_else(|| anyhow::anyhow!("deploy replay preview has no effective branch"))?;
    if deploy_branch != effective.target_branch {
        anyhow::bail!(
            "promote deploy branch mismatch: merge target is {}, deploy replay uses {}",
            effective.target_branch,
            deploy_branch
        );
    }
    if deploy_preview
        .pointer("/status/success")
        .and_then(Value::as_bool)
        == Some(false)
    {
        anyhow::bail!("deploy replay preview is blocked; inspect its risks before promotion");
    }

    let plan_hash = history_id::from_seed(
        "promote",
        &serde_json::to_string(&(workspace.key.as_str(), &effective))?,
    );
    let plan = PromotePlan {
        schema_version: 1,
        plan_hash: plan_hash.clone(),
        workspace_key: workspace.key,
        created_at: timestamp(),
        effective,
        observed: PromoteObserved {
            push_status: serde_json::to_value(push_status)?,
            merge_overview: serde_json::to_value(merge_overview)?,
            deploy_action,
            deploy_preview,
        },
        stages: stage_plans(),
    };
    let storage = Storage::new_default().map_err(anyhow::Error::msg)?;
    storage
        .set_json(
            PROMOTE_PLAN_NAMESPACE,
            &plan_hash,
            &serde_json::to_value(&plan)?,
        )
        .map_err(anyhow::Error::msg)?;
    Ok(plan)
}

pub fn run_promote_plan(
    config: &AppConfig,
    plan_hash: &str,
    follow: BuildFollowOptions,
) -> Result<PromoteStatus> {
    let storage = Storage::new_default().map_err(anyhow::Error::msg)?;
    let plan = load_plan(&storage, plan_hash)?;
    let workspace = crate::active_history_workspace_cli()?;
    if workspace.key != plan.workspace_key {
        anyhow::bail!(
            "promote plan belongs to workspace {}; rerun with `--workspace {}`",
            plan.workspace_key,
            plan.workspace_key
        );
    }
    let scoped_config = config_with_repo_path(config, &plan.effective)?;
    let mut execution = load_execution(&storage, &plan)?;

    run_push_stage(&storage, &scoped_config, &plan, &mut execution)?;
    run_merge_stage(&storage, &scoped_config, &plan, &mut execution)?;
    run_deploy_stage(&storage, &scoped_config, &plan, &mut execution, follow)?;

    execution.status = "completed".to_string();
    execution.success = deploy_result_success(
        execution
            .stages
            .iter()
            .find(|stage| stage.key == "deploy")
            .and_then(|stage| stage.result.as_ref()),
    );
    execution.updated_at = timestamp();
    save_execution(&storage, &execution)?;
    Ok(PromoteStatus { plan, execution })
}

pub fn promote_status(plan_hash: &str) -> Result<PromoteStatus> {
    let storage = Storage::new_default().map_err(anyhow::Error::msg)?;
    let plan = load_plan(&storage, plan_hash)?;
    let execution = load_execution(&storage, &plan)?;
    Ok(PromoteStatus { plan, execution })
}

fn run_push_stage(
    storage: &Storage,
    config: &AppConfig,
    plan: &PromotePlan,
    execution: &mut PromoteExecution,
) -> Result<()> {
    if !begin_stage(storage, execution, "push")? {
        return Ok(());
    }
    let status = match branch_push_status(
        config,
        &plan.effective.project,
        Some(&plan.effective.repo_path),
    ) {
        Ok(status) => status,
        Err(error) => return fail_stage(storage, execution, "push", error, false),
    };
    if status.current_branch != plan.effective.source_branch {
        return fail_stage(
            storage,
            execution,
            "push",
            anyhow::anyhow!(
                "source repository moved from {} to {}",
                plan.effective.source_branch,
                status.current_branch
            ),
            false,
        );
    }

    let request = BranchPushRequest {
        project: plan.effective.project.clone(),
        repo_path: Some(plan.effective.repo_path.clone()),
        commit_before_push: plan.effective.commit_message.is_some(),
        commit_message: plan.effective.commit_message.clone(),
        selected_paths: plan.effective.selected_paths.clone(),
    };
    let result = execute_branch_push(config, &request);
    crate::record_cli_branch_task_artifacts("提交推送", "push", None, &result);
    crate::record_cli_branch_task("提交推送", &result);
    match result {
        Ok(response) if response.success => {
            complete_stage(storage, execution, "push", serde_json::to_value(response)?)
        }
        Ok(response) => fail_stage(
            storage,
            execution,
            "push",
            anyhow::anyhow!(response.detail),
            false,
        ),
        Err(error) => fail_stage(storage, execution, "push", error, false),
    }
}

fn run_merge_stage(
    storage: &Storage,
    config: &AppConfig,
    plan: &PromotePlan,
    execution: &mut PromoteExecution,
) -> Result<()> {
    if !begin_stage(storage, execution, "merge")? {
        return Ok(());
    }
    let request = MergeRequest {
        project: plan.effective.project.clone(),
        source_branch: plan.effective.source_branch.clone(),
        target_branch: plan.effective.target_branch.clone(),
    };
    let result = core::execute_merge(config, &request);
    crate::record_cli_merge_result(
        "交付流程合并",
        &request.project,
        &request.source_branch,
        &request.target_branch,
        &result,
    );
    match result {
        Ok(response) if response.success => {
            complete_stage(storage, execution, "merge", serde_json::to_value(response)?)
        }
        Ok(response) => fail_stage(
            storage,
            execution,
            "merge",
            anyhow::anyhow!(response.detail),
            false,
        ),
        Err(error) => fail_stage(storage, execution, "merge", error, false),
    }
}

fn run_deploy_stage(
    storage: &Storage,
    config: &AppConfig,
    plan: &PromotePlan,
    execution: &mut PromoteExecution,
    follow: BuildFollowOptions,
) -> Result<()> {
    if !begin_stage(storage, execution, "deploy")? {
        return Ok(());
    }
    match crate::run_history_replay(config, &plan.observed.deploy_action, follow, true) {
        Ok(result) => complete_stage(storage, execution, "deploy", result),
        Err(error) => fail_stage(storage, execution, "deploy", error, true),
    }
}

fn load_plan(storage: &Storage, plan_hash: &str) -> Result<PromotePlan> {
    let value = storage
        .get_json(PROMOTE_PLAN_NAMESPACE, plan_hash)
        .map_err(anyhow::Error::msg)?
        .ok_or_else(|| anyhow::anyhow!("promote plan not found: {plan_hash}"))?;
    serde_json::from_value(value).map_err(anyhow::Error::from)
}

fn config_with_repo_path(config: &AppConfig, effective: &PromoteEffective) -> Result<AppConfig> {
    let mut config = config.clone();
    let project = config
        .projects
        .iter_mut()
        .find(|project| project.key == effective.project)
        .ok_or_else(|| anyhow::anyhow!("project not found: {}", effective.project))?;
    project.repo_path = Some(PathBuf::from(&effective.repo_path));
    Ok(config)
}

fn validate_commit_scope(request: &PromotePlanRequest) -> Result<()> {
    let has_message = request
        .commit_message
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    if has_message && request.selected_paths.is_empty() {
        anyhow::bail!("--message requires at least one explicit --path");
    }
    if !has_message && !request.selected_paths.is_empty() {
        anyhow::bail!("--path requires --message so the selected files have a commit");
    }
    Ok(())
}

fn validate_selected_paths(
    selected_paths: &[String],
    files: &[rdevtool_core::core::BranchPushFileStatus],
) -> Result<()> {
    for selected in normalized_paths(selected_paths.to_vec()) {
        let prefix = format!("{}/", selected.trim_end_matches('/'));
        if !files
            .iter()
            .any(|file| file.path == selected || file.path.starts_with(&prefix))
        {
            anyhow::bail!("selected promote path has no local change: {selected}");
        }
    }
    Ok(())
}

fn normalized_paths(paths: Vec<String>) -> Vec<String> {
    let mut paths = paths
        .into_iter()
        .map(|path| path.trim().trim_start_matches("./").to_string())
        .filter(|path| !path.is_empty())
        .collect::<Vec<_>>();
    paths.sort();
    paths.dedup();
    paths
}

fn normalized_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn required_value(label: &str, value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() {
        anyhow::bail!("{label} is required");
    }
    Ok(value.to_string())
}

fn stage_plans() -> Vec<PromoteStagePlan> {
    vec![
        PromoteStagePlan {
            key: "push".to_string(),
            label: "提交并推送指定文件".to_string(),
            side_effect: true,
        },
        PromoteStagePlan {
            key: "merge".to_string(),
            label: "合并并推送环境分支".to_string(),
            side_effect: true,
        },
        PromoteStagePlan {
            key: "deploy".to_string(),
            label: "回放环境部署".to_string(),
            side_effect: true,
        },
    ]
}

fn deploy_result_success(result: Option<&Value>) -> bool {
    let state = result.and_then(|result| {
        result
            .pointer("/finalStatus/stateKey")
            .or_else(|| result.pointer("/trigger/stateKey"))
            .or_else(|| result.pointer("/stateKey"))
            .and_then(Value::as_str)
    });
    !matches!(
        state,
        Some("failure" | "failed" | "error" | "cancelled" | "canceled" | "aborted")
    )
}

fn deploy_preview_branch(preview: &Value) -> Option<&str> {
    [
        "/effective/branch",
        "/effective/params/BRANCH",
        "/effective/params/branch",
        "/effective/params/Branch",
    ]
    .into_iter()
    .find_map(|pointer| {
        preview
            .pointer(pointer)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
    })
}

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn commit_scope_requires_message_and_paths_together() {
        let request = |message: Option<&str>, paths: Vec<&str>| PromotePlanRequest {
            project: "demo".to_string(),
            repo_path: None,
            source_branch: None,
            target_branch: "env-dc2".to_string(),
            deploy_history_id: "build:build-1".to_string(),
            commit_message: message.map(ToString::to_string),
            selected_paths: paths.into_iter().map(ToString::to_string).collect(),
        };

        assert!(validate_commit_scope(&request(Some("feat"), vec![])).is_err());
        assert!(validate_commit_scope(&request(None, vec!["src/a.ts"])).is_err());
        assert!(validate_commit_scope(&request(Some("feat"), vec!["src/a.ts"])).is_ok());
        assert!(validate_commit_scope(&request(None, vec![])).is_ok());
    }

    #[test]
    fn failed_terminal_deploy_result_is_not_successful() {
        assert!(!deploy_result_success(Some(&serde_json::json!({
            "finalStatus": { "stateKey": "failure" }
        }))));
        assert!(deploy_result_success(Some(&serde_json::json!({
            "trigger": { "stateKey": "queued" }
        }))));
    }

    #[test]
    fn deploy_branch_falls_back_to_effective_raw_branch_parameter() {
        let preview = serde_json::json!({
            "effective": {
                "branch": null,
                "params": {
                    "BRANCH": "env-dc2-vke"
                }
            }
        });
        assert_eq!(deploy_preview_branch(&preview), Some("env-dc2-vke"));
    }

    #[test]
    fn completed_stage_is_skipped_and_blocked_stage_is_not_retried() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "rdevtool-promote-checkpoint-{}-{suffix}.sqlite3",
            std::process::id()
        ));
        let storage = Storage::new(path.clone()).expect("create checkpoint storage");
        let mut execution = PromoteExecution {
            plan_hash: "promote-test".to_string(),
            workspace_key: "feature-a".to_string(),
            status: "pending".to_string(),
            success: false,
            updated_at: timestamp(),
            stages: ["push", "merge", "deploy"]
                .into_iter()
                .map(|key| PromoteStageCheckpoint {
                    key: key.to_string(),
                    state: PromoteStageState::Pending,
                    attempts: 0,
                    updated_at: timestamp(),
                    error: None,
                    result: None,
                })
                .collect(),
        };

        assert!(begin_stage(&storage, &mut execution, "push").expect("begin push"));
        complete_stage(
            &storage,
            &mut execution,
            "push",
            serde_json::json!({ "success": true }),
        )
        .expect("complete push");
        assert!(!begin_stage(&storage, &mut execution, "push").expect("skip completed push"));

        assert!(begin_stage(&storage, &mut execution, "deploy").expect("begin deploy"));
        assert!(
            fail_stage(
                &storage,
                &mut execution,
                "deploy",
                anyhow::anyhow!("ambiguous response"),
                true,
            )
            .is_err()
        );
        assert!(begin_stage(&storage, &mut execution, "deploy").is_err());
        assert_eq!(
            stage_mut(&mut execution, "deploy")
                .expect("deploy stage")
                .attempts,
            1
        );

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(format!("{}-wal", path.display()));
        let _ = std::fs::remove_file(format!("{}-shm", path.display()));
    }
}
