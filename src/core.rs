#![allow(dead_code)]

use crate::build;
use crate::config::{
    AppConfig, DeployParamConfig, DeployParamKind, DeployTargetConfig, JobConfig, ProjectConfig,
};
use crate::credentials;
use crate::git;
use crate::gitlab;
use crate::jenkins;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub key: String,
    pub name: String,
    pub category: String,
    pub has_variant: bool,
    pub deploy_targets: Vec<DeployTargetSummary>,
    pub supports_deploy: bool,
    pub supports_branch: bool,
    pub repo_path: Option<String>,
    pub source_branch_keywords: Vec<String>,
    pub target_branch_keywords: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetail {
    pub key: String,
    pub name: String,
    pub repo_path: Option<String>,
    pub git_url: String,
    pub standard_job_name: String,
    pub variant_job_name: Option<String>,
    pub deploy_targets: Vec<DeployTargetSummary>,
    pub current_branch: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchOption {
    pub name: String,
    pub updated_at: String,
    pub updated_ts: i64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployRequest {
    pub project: String,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub variant: bool,
    #[serde(default)]
    pub env: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub extra_params: BTreeMap<String, String>,
    #[serde(default)]
    pub params: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusRequest {
    pub queue_url: Option<String>,
    pub build_url: Option<String>,
    #[serde(default)]
    pub project: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployPlan {
    pub project_key: String,
    pub project_name: String,
    pub adapter: String,
    pub action_kind: String,
    pub job_kind: String,
    pub job_name: String,
    pub trigger_url: String,
    pub params: BTreeMap<String, String>,
    pub jenkins_base_url: String,
    pub command: Option<String>,
    pub cwd: Option<String>,
    pub output_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployTargetSummary {
    pub key: String,
    pub label: String,
    pub adapter: String,
    pub action_kind: String,
    pub job_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployTargetMeta {
    pub targets: Vec<DeployTargetSummary>,
    pub selected_target: String,
    pub params: Vec<DeployParamMeta>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployParamMeta {
    pub key: String,
    pub label: String,
    pub kind: String,
    pub default_value: String,
    pub options: Vec<String>,
    pub required: bool,
    pub true_value: String,
    pub false_value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployOptionsMeta {
    pub show_admin: bool,
    pub show_mobile: bool,
    pub show_gray: bool,
    pub show_branch: bool,
    pub admin_actual_default: String,
    pub admin_preferred_default: String,
    pub mobile_actual_default: String,
    pub mobile_preferred_default: String,
    pub gray_actual_default: String,
    pub gray_preferred_default: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildTriggerResponse {
    pub plan: DeployPlan,
    pub status: u16,
    pub queue_url: Option<String>,
    pub build_url: Option<String>,
    pub state_key: String,
    pub state_label: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildStatusResponse {
    pub queue_url: Option<String>,
    pub build_url: Option<String>,
    pub state_key: String,
    pub state_label: String,
    pub detail: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeRequest {
    pub project: String,
    pub target_branch: String,
    pub source_branch: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchCommitInfo {
    pub short_hash: String,
    pub subject: String,
    pub committed_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchCommitOverview {
    pub source: Option<BranchCommitInfo>,
    pub target: Option<BranchCommitInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeResponse {
    pub success: bool,
    pub project_key: String,
    pub project_name: String,
    pub target_branch: String,
    pub source_branch: String,
    pub merged_commit: Option<String>,
    pub latest_commit: Option<BranchCommitInfo>,
    pub source_commit: Option<BranchCommitInfo>,
    pub target_commit: Option<BranchCommitInfo>,
    pub pushed: bool,
    pub remote: bool,
    pub summary: String,
    pub detail: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchSyncRequest {
    pub project: String,
    pub source_branch: String,
    #[serde(default)]
    pub target_branches: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchCreateRequest {
    #[serde(default)]
    pub projects: Vec<String>,
    pub source_branch: String,
    pub target_branch: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchCheckoutRequest {
    pub project: String,
    pub source_branch: String,
    pub destination_dir: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchSwitchRequest {
    pub project: String,
    pub target_branch: String,
    #[serde(default)]
    pub repo_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchPushRequest {
    pub project: String,
    #[serde(default)]
    pub repo_path: Option<String>,
    #[serde(default)]
    pub commit_before_push: bool,
    pub commit_message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchPushFileStatus {
    pub path: String,
    pub code: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
    pub conflicted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchPushStatus {
    pub project_key: String,
    pub project_name: String,
    pub repo_path: String,
    pub current_branch: String,
    pub upstream_branch: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub clean: bool,
    pub can_push: bool,
    pub detached: bool,
    pub staged_count: usize,
    pub unstaged_count: usize,
    pub untracked_count: usize,
    pub conflicted_count: usize,
    pub files: Vec<BranchPushFileStatus>,
    pub latest_commit: Option<BranchCommitInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchWorktreeSummary {
    pub project_key: String,
    pub project_name: String,
    pub repo_path: String,
    pub label: String,
    pub current_branch: String,
    pub detached: bool,
    pub clean: bool,
    pub ahead: usize,
    pub behind: usize,
    pub is_default: bool,
    pub is_git_worktree: bool,
    pub status_key: String,
    pub status_label: String,
    pub detail: String,
    pub latest_commit: Option<BranchCommitInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchTaskItemResult {
    pub project_key: String,
    pub project_name: String,
    pub source_branch: String,
    pub target_branch: Option<String>,
    pub output_path: Option<String>,
    pub success: bool,
    pub status_key: String,
    pub status_label: String,
    pub summary: String,
    pub detail: String,
    pub remote: bool,
    pub commit: Option<BranchCommitInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchTaskResponse {
    pub task_kind: String,
    pub success: bool,
    pub summary: String,
    pub detail: String,
    pub items: Vec<BranchTaskItemResult>,
}

pub fn project_summaries(config: &AppConfig) -> Vec<ProjectSummary> {
    config
        .projects
        .iter()
        .map(|project| {
            let branch_rules = config
                .branch_rules_for_project(&project.key)
                .unwrap_or_default();

            ProjectSummary {
                key: project.key.clone(),
                name: project.name.clone(),
                category: project.category_label().to_string(),
                has_variant: project
                    .deploy_targets
                    .iter()
                    .any(|target| target.key == "variant"),
                deploy_targets: deploy_target_summaries(project),
                supports_deploy: project.supports_deploy(),
                supports_branch: project.supports_branch(),
                repo_path: project
                    .repo_path
                    .as_ref()
                    .map(|path| path.display().to_string()),
                source_branch_keywords: branch_rules.source_keywords,
                target_branch_keywords: branch_rules.target_keywords,
            }
        })
        .collect()
}

pub fn project_detail(config: &AppConfig, key: &str) -> Result<ProjectDetail> {
    let project = config.find_project(key)?;
    let current_branch = project
        .repo_path
        .as_ref()
        .and_then(|repo_path| git::current_branch(repo_path).ok());

    Ok(ProjectDetail {
        key: project.key.clone(),
        name: project.name.clone(),
        repo_path: project
            .repo_path
            .as_ref()
            .map(|path| path.display().to_string()),
        git_url: project.git_url.clone(),
        standard_job_name: project
            .deploy_targets
            .iter()
            .find(|target| target.key == "standard")
            .map(|target| target.job_name.clone())
            .unwrap_or_default(),
        variant_job_name: project
            .deploy_targets
            .iter()
            .find(|target| target.key == "variant")
            .map(|target| target.job_name.clone()),
        deploy_targets: deploy_target_summaries(project),
        current_branch,
    })
}

pub fn available_branches(config: &AppConfig, key: &str) -> Result<Vec<String>> {
    Ok(available_branch_options(config, key)?
        .into_iter()
        .map(|item| item.name)
        .collect())
}

pub fn available_branch_options(config: &AppConfig, key: &str) -> Result<Vec<BranchOption>> {
    let project = config.find_project(key)?;

    if let Ok(token) = credentials::load_gitlab_token(&config.defaults) {
        if let Ok(remote_items) = gitlab::available_branch_activity(
            &project.git_url,
            config.defaults.gitlab_api_base_url.as_deref(),
            &token,
        ) {
            return Ok(remote_items
                .into_iter()
                .map(|item| BranchOption {
                    name: item.name,
                    updated_at: item.updated_at,
                    updated_ts: item.updated_ts,
                })
                .collect());
        }
    }

    if let Some(repo_path) = project.repo_path.as_deref() {
        if let Ok(local_items) = git::available_branch_activity(repo_path) {
            return Ok(local_items
                .into_iter()
                .map(|item| BranchOption {
                    name: item.name,
                    updated_at: item.updated_at,
                    updated_ts: item.updated_ts,
                })
                .collect());
        }
    }

    Ok(git::remote_branches(&project.git_url)?
        .into_iter()
        .map(|name| BranchOption {
            name,
            updated_at: String::new(),
            updated_ts: 0,
        })
        .collect())
}

pub fn branch_hint(config: &AppConfig, key: &str) -> Result<String> {
    let project = config.find_project(key)?;
    infer_branch(project, None)
}

pub fn branch_commit_overview(
    config: &AppConfig,
    key: &str,
    source_branch: &str,
    target_branch: &str,
) -> Result<BranchCommitOverview> {
    let project = config.find_project(key)?;
    let token = credentials::load_gitlab_token(&config.defaults).ok();

    let source = load_branch_commit_info(
        config,
        project,
        source_branch.trim(),
        token.as_deref(),
        false,
    )?;
    let target = load_branch_commit_info(
        config,
        project,
        target_branch.trim(),
        token.as_deref(),
        true,
    )?;

    Ok(BranchCommitOverview { source, target })
}

pub fn env_options(config: &AppConfig, key: &str, use_variant: bool) -> Result<Vec<String>> {
    let target_key = if use_variant {
        Some("variant")
    } else {
        Some("standard")
    };
    Ok(deploy_target_meta(config, key, target_key)?
        .params
        .into_iter()
        .find(|param| param.kind == "select" && is_env_param(&param.key))
        .map(|param| param.options)
        .unwrap_or_default())
}

pub fn deploy_options_meta(
    config: &AppConfig,
    key: &str,
    use_variant: bool,
) -> Result<DeployOptionsMeta> {
    let target_key = if use_variant {
        Some("variant")
    } else {
        Some("standard")
    };
    let meta = deploy_target_meta(config, key, target_key)?;
    let find = |param_key: &str| meta.params.iter().find(|param| param.key == param_key);
    Ok(DeployOptionsMeta {
        show_admin: find("IS_BUILD_ADMIN").is_some(),
        show_mobile: find("IS_BUILD_MOBILE").is_some(),
        show_gray: find("IS_GRAY").is_some(),
        show_branch: meta.params.iter().any(|param| param.kind == "branch"),
        admin_actual_default: find("IS_BUILD_ADMIN")
            .map(|param| param.default_value.clone())
            .unwrap_or_else(|| "否".to_string()),
        admin_preferred_default: find("IS_BUILD_ADMIN")
            .map(|param| param.default_value.clone())
            .unwrap_or_else(|| "否".to_string()),
        mobile_actual_default: find("IS_BUILD_MOBILE")
            .map(|param| param.default_value.clone())
            .unwrap_or_else(|| "否".to_string()),
        mobile_preferred_default: find("IS_BUILD_MOBILE")
            .map(|param| param.default_value.clone())
            .unwrap_or_else(|| "否".to_string()),
        gray_actual_default: find("IS_GRAY")
            .map(|param| param.default_value.clone())
            .unwrap_or_else(|| "否".to_string()),
        gray_preferred_default: find("IS_GRAY")
            .map(|param| param.default_value.clone())
            .unwrap_or_else(|| "否".to_string()),
    })
}

pub fn deploy_target_meta(
    config: &AppConfig,
    key: &str,
    target_key: Option<&str>,
) -> Result<DeployTargetMeta> {
    let project = config.find_project(key)?;
    let target = selected_deploy_target(project, target_key)?;
    Ok(DeployTargetMeta {
        targets: deploy_target_summaries(project),
        selected_target: target.key.clone(),
        params: target
            .params
            .iter()
            .map(|param| deploy_param_meta(project, param))
            .collect(),
    })
}

pub fn build_plan(config: &AppConfig, request: &DeployRequest) -> Result<DeployPlan> {
    let project = config.find_project(&request.project)?;
    let target_key = request.target.as_deref().or_else(|| {
        if request.variant {
            Some("variant")
        } else {
            Some("standard")
        }
    });
    let target = selected_deploy_target(project, target_key)?;
    let mut params = BTreeMap::new();

    for param in &target.params {
        let value = resolve_deploy_param_value(project, param, request)?;
        if param.kind != DeployParamKind::Hidden || !value.is_empty() {
            params.insert(param.key.clone(), value);
        }
    }

    for (key, value) in &request.extra_params {
        params.insert(key.clone(), value.clone());
    }
    for (key, value) in &request.params {
        params.insert(key.clone(), value.clone());
    }

    let adapter_plan = build::plan_adapter(config, project, target, &params)?;

    Ok(DeployPlan {
        project_key: project.key.clone(),
        project_name: project.name.clone(),
        adapter: adapter_plan.adapter,
        action_kind: adapter_plan.action_kind,
        job_kind: target.key.clone(),
        job_name: adapter_plan.job_name,
        trigger_url: adapter_plan.trigger_url,
        params,
        jenkins_base_url: adapter_plan.jenkins_base_url,
        command: adapter_plan.command,
        cwd: adapter_plan.cwd,
        output_dir: adapter_plan.output_dir,
    })
}

pub fn trigger_deploy(config: &AppConfig, request: &DeployRequest) -> Result<BuildTriggerResponse> {
    let project = config.find_project(&request.project)?;
    let target_key = request.target.as_deref().or_else(|| {
        if request.variant {
            Some("variant")
        } else {
            Some("standard")
        }
    });
    let target = selected_deploy_target(project, target_key)?;
    let plan = build_plan(config, request)?;
    let result = build::trigger_adapter(
        config,
        project,
        target,
        build::BuildAdapterExecution {
            trigger_url: &plan.trigger_url,
            params: &plan.params,
            command: plan.command.as_deref(),
            cwd: plan.cwd.as_deref(),
            output_dir: plan.output_dir.as_deref(),
        },
    )?;

    Ok(BuildTriggerResponse {
        plan,
        status: result.status,
        queue_url: result.queue_url,
        build_url: result.build_url,
        state_key: result.state_key,
        state_label: result.state_label,
        detail: result.detail,
    })
}

pub fn refresh_deploy_status(
    config: &AppConfig,
    request: &StatusRequest,
) -> Result<BuildStatusResponse> {
    let result = build::refresh_jenkins_status(
        config,
        request.queue_url.as_deref(),
        request.build_url.as_deref(),
    )?;

    Ok(BuildStatusResponse {
        queue_url: result.queue_url,
        build_url: result.build_url,
        state_key: trigger_state_key(result.state).to_string(),
        state_label: result.state.label().to_string(),
        detail: result.detail,
    })
}

pub fn execute_merge(config: &AppConfig, request: &MergeRequest) -> Result<MergeResponse> {
    let project = config.find_project(&request.project)?;
    let target_branch = request.target_branch.trim();
    let source_branch = request.source_branch.trim();
    if target_branch.is_empty() || source_branch.is_empty() {
        anyhow::bail!("目标分支和源分支不能为空");
    }
    if target_branch == source_branch {
        anyhow::bail!("目标分支和源分支不能相同");
    }

    let gitlab_token = credentials::load_gitlab_token(&config.defaults).ok();
    let mut remote = false;
    let merge_result = match gitlab_token.as_deref() {
        Some(token) => {
            remote = true;
            let result = gitlab::merge_branches_via_api(
                &project.git_url,
                config.defaults.gitlab_api_base_url.as_deref(),
                token,
                source_branch,
                target_branch,
            )?;
            if let Some(repo_path) = project.repo_path.as_ref() {
                let _ = git::sync_local_branch_with_remote(repo_path, target_branch);
            }
            git::WorktreeMergeResult {
                target_branch: result.target_branch,
                source_branch: result.source_branch,
                merged_commit: result.merge_commit_sha,
                created_target_branch: result.created_target_branch,
                detail: result.detail,
            }
        }
        None => git::merge_branches_with_worktree(
            project
                .repo_path
                .as_ref()
                .with_context(|| format!("project {} has no repo_path configured", project.key))?,
            target_branch,
            source_branch,
        )?,
    };

    let latest_commit = project
        .repo_path
        .as_ref()
        .and_then(|repo_path| git::latest_branch_commit(repo_path, target_branch).ok())
        .map(branch_commit_info)
        .or_else(|| {
            gitlab_token
                .as_deref()
                .and_then(|loaded| {
                    gitlab::branch_commit_summary(
                        &project.git_url,
                        config.defaults.gitlab_api_base_url.as_deref(),
                        loaded,
                        target_branch,
                    )
                    .ok()
                })
                .flatten()
                .map(branch_commit_info)
        });
    let source_commit = project
        .repo_path
        .as_ref()
        .and_then(|repo_path| git::latest_remote_branch_commit(repo_path, source_branch).ok())
        .map(branch_commit_info)
        .or_else(|| {
            gitlab_token
                .as_deref()
                .and_then(|loaded| {
                    gitlab::branch_commit_summary(
                        &project.git_url,
                        config.defaults.gitlab_api_base_url.as_deref(),
                        loaded,
                        source_branch,
                    )
                    .ok()
                })
                .flatten()
                .map(branch_commit_info)
        });
    let target_commit = latest_commit.clone();

    Ok(MergeResponse {
        success: true,
        project_key: project.key.clone(),
        project_name: project.name.clone(),
        target_branch: merge_result.target_branch,
        source_branch: merge_result.source_branch,
        merged_commit: Some(merge_result.merged_commit),
        latest_commit: latest_commit.clone(),
        source_commit,
        target_commit,
        pushed: remote,
        remote,
        summary: if merge_result.created_target_branch {
            "目标分支不存在，已从源分支创建并推送".to_string()
        } else if remote {
            "已通过 GitLab API 合并并推送".to_string()
        } else {
            "已完成本地合并".to_string()
        },
        detail: merge_result.detail,
    })
}

pub fn execute_branch_sync(
    config: &AppConfig,
    request: &BranchSyncRequest,
) -> Result<BranchTaskResponse> {
    let project = config.find_project(&request.project)?;
    let source_branch = request.source_branch.trim();
    let target_branches = normalize_branch_list(&request.target_branches);
    if source_branch.is_empty() {
        anyhow::bail!("源分支不能为空");
    }
    if target_branches.is_empty() {
        anyhow::bail!("至少选择一个目标分支");
    }

    let gitlab_token = credentials::load_gitlab_token(&config.defaults).ok();
    let mut items = Vec::new();
    for target_branch in target_branches {
        if target_branch == source_branch {
            items.push(BranchTaskItemResult {
                project_key: project.key.clone(),
                project_name: project.name.clone(),
                source_branch: source_branch.to_string(),
                target_branch: Some(target_branch.clone()),
                output_path: None,
                success: true,
                status_key: "same_branch".to_string(),
                status_label: "跳过".to_string(),
                summary: "源分支和目标分支相同".to_string(),
                detail: "合并任务不会处理同名分支。".to_string(),
                remote: false,
                commit: None,
            });
            continue;
        }

        match load_branch_commit_info(
            config,
            project,
            &target_branch,
            gitlab_token.as_deref(),
            true,
        ) {
            Ok(Some(_)) => {}
            Ok(None) => {
                items.push(branch_task_failure(
                    project,
                    source_branch,
                    Some(&target_branch),
                    "target_missing",
                    "失败",
                    "目标分支不存在",
                    "合并模式不会自动创建目标分支，请先在创建模式中创建。",
                ));
                continue;
            }
            Err(error) => {
                items.push(branch_task_failure(
                    project,
                    source_branch,
                    Some(&target_branch),
                    "target_check_failed",
                    "失败",
                    "目标分支检查失败",
                    &error.to_string(),
                ));
                continue;
            }
        }

        let merge_request = MergeRequest {
            project: project.key.clone(),
            source_branch: source_branch.to_string(),
            target_branch: target_branch.clone(),
        };
        match execute_merge(config, &merge_request) {
            Ok(result) => items.push(branch_task_item_from_merge_result(result)),
            Err(error) => items.push(branch_task_failure(
                project,
                source_branch,
                Some(&target_branch),
                "merge_failed",
                "失败",
                "合并失败",
                &error.to_string(),
            )),
        }
    }

    Ok(branch_task_response("sync", items))
}

pub fn execute_branch_create(
    config: &AppConfig,
    request: &BranchCreateRequest,
) -> Result<BranchTaskResponse> {
    let project_keys = normalize_branch_list(&request.projects);
    let source_branch = request.source_branch.trim();
    let target_branch = request.target_branch.trim();
    if project_keys.is_empty() {
        anyhow::bail!("至少选择一个项目");
    }
    if source_branch.is_empty() || target_branch.is_empty() {
        anyhow::bail!("源分支和目标分支不能为空");
    }
    if source_branch == target_branch {
        anyhow::bail!("源分支和目标分支不能相同");
    }

    let gitlab_token = credentials::load_gitlab_token(&config.defaults).ok();
    let mut items = Vec::new();
    for project_key in project_keys {
        let project = match config.find_project(&project_key) {
            Ok(project) => project,
            Err(error) => {
                items.push(BranchTaskItemResult {
                    project_key: project_key.clone(),
                    project_name: project_key.clone(),
                    source_branch: source_branch.to_string(),
                    target_branch: Some(target_branch.to_string()),
                    output_path: None,
                    success: false,
                    status_key: "project_missing".to_string(),
                    status_label: "失败".to_string(),
                    summary: "项目不存在".to_string(),
                    detail: error.to_string(),
                    remote: false,
                    commit: None,
                });
                continue;
            }
        };

        match load_branch_commit_info(
            config,
            project,
            source_branch,
            gitlab_token.as_deref(),
            true,
        ) {
            Ok(Some(_)) => {}
            Ok(None) => {
                items.push(branch_task_failure(
                    project,
                    source_branch,
                    Some(target_branch),
                    "source_missing",
                    "失败",
                    "源分支不存在",
                    "该项目没有找到源分支，已跳过该项目。",
                ));
                continue;
            }
            Err(error) => {
                items.push(branch_task_failure(
                    project,
                    source_branch,
                    Some(target_branch),
                    "source_check_failed",
                    "失败",
                    "源分支检查失败",
                    &error.to_string(),
                ));
                continue;
            }
        }

        match load_branch_commit_info(
            config,
            project,
            target_branch,
            gitlab_token.as_deref(),
            true,
        ) {
            Ok(Some(commit)) => {
                items.push(BranchTaskItemResult {
                    project_key: project.key.clone(),
                    project_name: project.name.clone(),
                    source_branch: source_branch.to_string(),
                    target_branch: Some(target_branch.to_string()),
                    output_path: None,
                    success: true,
                    status_key: "skipped".to_string(),
                    status_label: "已存在".to_string(),
                    summary: "目标分支已存在，已跳过".to_string(),
                    detail: "创建模式不会覆盖或合并已有目标分支。".to_string(),
                    remote: gitlab_token.is_some(),
                    commit: Some(commit),
                });
                continue;
            }
            Ok(None) => {}
            Err(error) => {
                items.push(branch_task_failure(
                    project,
                    source_branch,
                    Some(target_branch),
                    "target_check_failed",
                    "失败",
                    "目标分支检查失败",
                    &error.to_string(),
                ));
                continue;
            }
        }

        let result = if let Some(token) = gitlab_token.as_deref() {
            gitlab::merge_branches_via_api(
                &project.git_url,
                config.defaults.gitlab_api_base_url.as_deref(),
                token,
                source_branch,
                target_branch,
            )
            .map(|api_result| git::WorktreeMergeResult {
                target_branch: api_result.target_branch,
                source_branch: api_result.source_branch,
                merged_commit: api_result.merge_commit_sha,
                created_target_branch: api_result.created_target_branch,
                detail: api_result.detail,
            })
        } else {
            let repo_path = project
                .repo_path
                .as_ref()
                .with_context(|| format!("project {} has no repo_path configured", project.key));
            match repo_path {
                Ok(path) => {
                    git::create_remote_branch_from_source(path, target_branch, source_branch)
                }
                Err(error) => Err(error),
            }
        };

        match result {
            Ok(created) => {
                let commit = project
                    .repo_path
                    .as_ref()
                    .and_then(|repo_path| {
                        git::latest_remote_branch_commit(repo_path, target_branch).ok()
                    })
                    .map(branch_commit_info)
                    .or_else(|| {
                        gitlab_token
                            .as_deref()
                            .and_then(|loaded| {
                                gitlab::branch_commit_summary(
                                    &project.git_url,
                                    config.defaults.gitlab_api_base_url.as_deref(),
                                    loaded,
                                    target_branch,
                                )
                                .ok()
                            })
                            .flatten()
                            .map(branch_commit_info)
                    });
                items.push(BranchTaskItemResult {
                    project_key: project.key.clone(),
                    project_name: project.name.clone(),
                    source_branch: created.source_branch,
                    target_branch: Some(created.target_branch),
                    output_path: None,
                    success: true,
                    status_key: "created".to_string(),
                    status_label: "已创建".to_string(),
                    summary: "已从源分支创建目标分支".to_string(),
                    detail: created.detail,
                    remote: gitlab_token.is_some(),
                    commit,
                });
            }
            Err(error) => items.push(branch_task_failure(
                project,
                source_branch,
                Some(target_branch),
                "create_failed",
                "失败",
                "创建失败",
                &error.to_string(),
            )),
        }
    }

    Ok(branch_task_response("create", items))
}

pub fn checkout_branch_to_directory(
    config: &AppConfig,
    request: &BranchCheckoutRequest,
) -> Result<BranchTaskResponse> {
    let project = config.find_project(&request.project)?;
    let source_branch = request.source_branch.trim();
    if source_branch.is_empty() {
        anyhow::bail!("源分支不能为空");
    }

    let result = git::clone_branch_to_directory(
        &project.git_url,
        source_branch,
        Path::new(request.destination_dir.trim()),
    );
    let items = match result {
        Ok(value) => vec![BranchTaskItemResult {
            project_key: project.key.clone(),
            project_name: project.name.clone(),
            source_branch: source_branch.to_string(),
            target_branch: None,
            output_path: Some(value.output_path.display().to_string()),
            success: true,
            status_key: "checked_out".to_string(),
            status_label: "已克隆".to_string(),
            summary: "已克隆到本地目录".to_string(),
            detail: value.detail,
            remote: true,
            commit: None,
        }],
        Err(error) => vec![branch_task_failure(
            project,
            source_branch,
            None,
            "checkout_failed",
            "失败",
            "克隆失败",
            &error.to_string(),
        )],
    };

    Ok(branch_task_response("checkout", items))
}

fn resolve_branch_repo_path(project: &ProjectConfig, repo_path: Option<&str>) -> Result<PathBuf> {
    if let Some(value) = repo_path.map(str::trim).filter(|value| !value.is_empty()) {
        let path = PathBuf::from(value);
        if !path.exists() {
            anyhow::bail!("本地工作副本目录不存在：{}", path.display());
        }
        if !path.is_dir() {
            anyhow::bail!("本地工作副本不是目录：{}", path.display());
        }
        return Ok(path);
    }

    project
        .repo_path
        .clone()
        .with_context(|| format!("project {} has no repo_path configured", project.key))
}

fn path_identity(path: &Path) -> String {
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string()
}

fn branch_worktree_label(path: &Path, is_default: bool, branch: &str) -> String {
    if is_default {
        return "默认目录".to_string();
    }
    if !branch.trim().is_empty() && branch != "HEAD" {
        return branch.to_string();
    }
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("本地目录")
        .to_string()
}

fn branch_status_for_project_path(
    project: &ProjectConfig,
    repo_path: &Path,
    is_default: bool,
    is_git_worktree: bool,
    branch_hint: Option<&str>,
    detached_hint: bool,
) -> BranchWorktreeSummary {
    let repo_path_text = repo_path.display().to_string();
    match git::working_tree_status(repo_path) {
        Ok(status) => {
            let latest_commit = if status.detached || status.current_branch.is_empty() {
                None
            } else {
                git::latest_branch_commit(repo_path, &status.current_branch)
                    .ok()
                    .map(branch_commit_info)
            };
            let current_branch = status.current_branch.clone();
            let label = branch_worktree_label(repo_path, is_default, &current_branch);
            BranchWorktreeSummary {
                project_key: project.key.clone(),
                project_name: project.name.clone(),
                repo_path: repo_path_text,
                label,
                current_branch,
                detached: status.detached,
                clean: status.clean,
                ahead: status.ahead,
                behind: status.behind,
                is_default,
                is_git_worktree,
                status_key: if status.clean { "clean" } else { "dirty" }.to_string(),
                status_label: if status.clean { "干净" } else { "有改动" }.to_string(),
                detail: status
                    .upstream_branch
                    .as_deref()
                    .map(|upstream| format!("upstream: {upstream}"))
                    .unwrap_or_else(|| "未配置 upstream".to_string()),
                latest_commit,
            }
        }
        Err(error) => {
            let current_branch = branch_hint.unwrap_or_default().to_string();
            BranchWorktreeSummary {
                project_key: project.key.clone(),
                project_name: project.name.clone(),
                repo_path: repo_path_text.clone(),
                label: branch_worktree_label(repo_path, is_default, &current_branch),
                current_branch,
                detached: detached_hint,
                clean: false,
                ahead: 0,
                behind: 0,
                is_default,
                is_git_worktree,
                status_key: "unavailable".to_string(),
                status_label: "不可用".to_string(),
                detail: error.to_string(),
                latest_commit: None,
            }
        }
    }
}

pub fn project_worktrees(config: &AppConfig, key: &str) -> Result<Vec<BranchWorktreeSummary>> {
    let project = config.find_project(key)?;
    let default_repo_path = project
        .repo_path
        .as_ref()
        .with_context(|| format!("project {} has no repo_path configured", project.key))?;
    let default_identity = path_identity(default_repo_path);
    let mut seen = BTreeSet::new();
    let mut paths = Vec::<(PathBuf, bool, bool, Option<String>, bool)>::new();

    seen.insert(default_identity.clone());
    paths.push((default_repo_path.clone(), true, false, None, false));

    if let Ok(worktrees) = git::list_worktrees(default_repo_path) {
        for worktree in worktrees {
            if worktree.bare {
                continue;
            }
            let identity = path_identity(&worktree.path);
            if seen.insert(identity.clone()) {
                paths.push((
                    worktree.path,
                    identity == default_identity,
                    true,
                    worktree.branch,
                    worktree.detached,
                ));
            } else if identity == default_identity {
                paths[0].2 = true;
                paths[0].3 = worktree.branch;
                paths[0].4 = worktree.detached;
            }
        }
    }

    Ok(paths
        .into_iter()
        .map(
            |(path, is_default, is_git_worktree, branch_hint, detached_hint)| {
                branch_status_for_project_path(
                    project,
                    &path,
                    is_default,
                    is_git_worktree,
                    branch_hint.as_deref(),
                    detached_hint,
                )
            },
        )
        .collect())
}

pub fn execute_branch_switch(
    config: &AppConfig,
    request: &BranchSwitchRequest,
) -> Result<BranchTaskResponse> {
    let project = config.find_project(&request.project)?;
    let repo_path = resolve_branch_repo_path(project, request.repo_path.as_deref())?;
    let target_branch = request.target_branch.trim();
    if target_branch.is_empty() {
        anyhow::bail!("目标分支不能为空");
    }

    let result = git::switch_branch(&repo_path, target_branch)?;
    let commit = if result.current_branch.trim().is_empty() {
        None
    } else {
        git::latest_branch_commit(&repo_path, &result.current_branch)
            .ok()
            .map(branch_commit_info)
    };

    let item = BranchTaskItemResult {
        project_key: project.key.clone(),
        project_name: project.name.clone(),
        source_branch: result.previous_branch,
        target_branch: Some(result.current_branch),
        output_path: None,
        success: true,
        status_key: if result.already_current {
            "same_branch".to_string()
        } else if result.created_tracking_branch {
            "switched_tracking".to_string()
        } else {
            "switched".to_string()
        },
        status_label: if result.already_current {
            "已在当前分支".to_string()
        } else {
            "已切换".to_string()
        },
        summary: if result.already_current {
            "当前已在目标分支".to_string()
        } else if result.created_tracking_branch {
            "已创建本地跟踪分支并切换".to_string()
        } else {
            "已切换本地工作副本分支".to_string()
        },
        detail: result.detail,
        remote: result.created_tracking_branch,
        commit,
    };

    Ok(branch_task_response("switch", vec![item]))
}

pub fn branch_push_status(
    config: &AppConfig,
    key: &str,
    repo_path: Option<&str>,
) -> Result<BranchPushStatus> {
    let project = config.find_project(key)?;
    let repo_path = resolve_branch_repo_path(project, repo_path)?;
    let status = git::working_tree_status(&repo_path)?;
    let latest_commit = if status.detached || status.current_branch.is_empty() {
        None
    } else {
        git::latest_branch_commit(&repo_path, &status.current_branch)
            .ok()
            .map(branch_commit_info)
    };

    Ok(BranchPushStatus {
        project_key: project.key.clone(),
        project_name: project.name.clone(),
        repo_path: repo_path.display().to_string(),
        current_branch: status.current_branch.clone(),
        upstream_branch: status.upstream_branch.clone(),
        ahead: status.ahead,
        behind: status.behind,
        clean: status.clean,
        can_push: !status.detached && !status.current_branch.trim().is_empty(),
        detached: status.detached,
        staged_count: status.staged_count,
        unstaged_count: status.unstaged_count,
        untracked_count: status.untracked_count,
        conflicted_count: status.conflicted_count,
        files: status
            .files
            .into_iter()
            .map(|item| BranchPushFileStatus {
                path: item.path,
                code: item.code,
                staged: item.staged,
                unstaged: item.unstaged,
                untracked: item.untracked,
                conflicted: item.conflicted,
            })
            .collect(),
        latest_commit,
    })
}

pub fn execute_branch_push(
    config: &AppConfig,
    request: &BranchPushRequest,
) -> Result<BranchTaskResponse> {
    let project = config.find_project(&request.project)?;
    let repo_path = resolve_branch_repo_path(project, request.repo_path.as_deref())?;
    let fallback_source_branch = git::working_tree_status(&repo_path)
        .ok()
        .map(|status| status.current_branch)
        .unwrap_or_default();

    let result = git::push_current_branch(
        &repo_path,
        request.commit_before_push,
        request.commit_message.as_deref(),
    );
    let items = match result {
        Ok(value) => {
            let mut detail = value.detail;
            if !value.status_before_push.clean && !value.committed {
                let reminder = "当前工作副本仍有未提交改动，本次仅推送已提交内容。";
                detail = if detail.trim().is_empty() {
                    reminder.to_string()
                } else {
                    format!("{reminder}\n\n{detail}")
                };
            }

            vec![BranchTaskItemResult {
                project_key: project.key.clone(),
                project_name: project.name.clone(),
                source_branch: value.current_branch.clone(),
                target_branch: value
                    .upstream_branch
                    .clone()
                    .or(Some(value.current_branch.clone())),
                output_path: None,
                success: true,
                status_key: if value.committed {
                    "committed_and_pushed".to_string()
                } else {
                    "pushed".to_string()
                },
                status_label: if value.committed {
                    "已提交并推送".to_string()
                } else {
                    "已推送".to_string()
                },
                summary: if value.committed {
                    "已提交并推送当前分支".to_string()
                } else {
                    "已推送当前分支".to_string()
                },
                detail,
                remote: true,
                commit: value.commit.map(branch_commit_info).or_else(|| {
                    git::latest_branch_commit(&repo_path, &value.current_branch)
                        .ok()
                        .map(branch_commit_info)
                }),
            }]
        }
        Err(error) => vec![branch_task_failure(
            project,
            &fallback_source_branch,
            None,
            "push_failed",
            "失败",
            "推送失败",
            &error.to_string(),
        )],
    };

    Ok(branch_task_response("push", items))
}

fn branch_commit_info(item: git::BranchCommitSummary) -> BranchCommitInfo {
    BranchCommitInfo {
        short_hash: item.short_hash,
        subject: item.subject,
        committed_at: item.committed_at,
    }
}

fn normalize_branch_list(values: &[String]) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut normalized = Vec::new();
    for value in values {
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        if seen.insert(value.to_string()) {
            normalized.push(value.to_string());
        }
    }
    normalized
}

fn branch_task_item_from_merge_result(result: MergeResponse) -> BranchTaskItemResult {
    BranchTaskItemResult {
        project_key: result.project_key,
        project_name: result.project_name,
        source_branch: result.source_branch,
        target_branch: Some(result.target_branch),
        output_path: None,
        success: result.success,
        status_key: "merged".to_string(),
        status_label: "已合并".to_string(),
        summary: result.summary,
        detail: result.detail,
        remote: result.remote,
        commit: result.target_commit.or(result.latest_commit),
    }
}

fn branch_task_failure(
    project: &ProjectConfig,
    source_branch: &str,
    target_branch: Option<&str>,
    status_key: &str,
    status_label: &str,
    summary: &str,
    detail: &str,
) -> BranchTaskItemResult {
    BranchTaskItemResult {
        project_key: project.key.clone(),
        project_name: project.name.clone(),
        source_branch: source_branch.to_string(),
        target_branch: target_branch.map(ToString::to_string),
        output_path: None,
        success: false,
        status_key: status_key.to_string(),
        status_label: status_label.to_string(),
        summary: summary.to_string(),
        detail: detail.to_string(),
        remote: false,
        commit: None,
    }
}

fn branch_task_response(task_kind: &str, items: Vec<BranchTaskItemResult>) -> BranchTaskResponse {
    let failed = items.iter().filter(|item| !item.success).count();
    let skipped = items
        .iter()
        .filter(|item| item.status_key == "skipped" || item.status_key == "same_branch")
        .count();
    let succeeded = items.len().saturating_sub(failed + skipped);
    let mut parts = vec![format!("成功 {succeeded}")];
    if skipped > 0 {
        parts.push(format!("跳过 {skipped}"));
    }
    if failed > 0 {
        parts.push(format!("失败 {failed}"));
    }
    let detail = items
        .iter()
        .map(|item| {
            let target = item
                .target_branch
                .as_deref()
                .or(item.output_path.as_deref())
                .unwrap_or("-");
            format!(
                "{}: {} -> {} [{}]",
                item.project_name, item.source_branch, target, item.status_label
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    BranchTaskResponse {
        task_kind: task_kind.to_string(),
        success: failed == 0,
        summary: parts.join(" / "),
        detail,
        items,
    }
}

fn load_branch_commit_info(
    config: &AppConfig,
    project: &ProjectConfig,
    branch: &str,
    gitlab_token: Option<&str>,
    allow_missing: bool,
) -> Result<Option<BranchCommitInfo>> {
    if branch.is_empty() {
        return Ok(None);
    }

    if let Some(repo_path) = project.repo_path.as_ref() {
        let local_result = if allow_missing {
            git::try_latest_remote_branch_commit(repo_path, branch)
        } else {
            git::latest_remote_branch_commit(repo_path, branch).map(Some)
        };

        match local_result {
            Ok(value) => {
                return Ok(value.map(branch_commit_info));
            }
            Err(local_error) => {
                if let Some(token) = gitlab_token {
                    let remote = gitlab::branch_commit_summary(
                        &project.git_url,
                        config.defaults.gitlab_api_base_url.as_deref(),
                        token,
                        branch,
                    )?;
                    if remote.is_some() || allow_missing {
                        return Ok(remote.map(branch_commit_info));
                    }
                }
                return Err(local_error);
            }
        }
    }

    let token = gitlab_token.with_context(|| {
        format!(
            "project {} has no repo_path configured, and GitLab token is unavailable",
            project.key
        )
    })?;

    let remote = gitlab::branch_commit_summary(
        &project.git_url,
        config.defaults.gitlab_api_base_url.as_deref(),
        token,
        branch,
    )?;

    if remote.is_none() && !allow_missing {
        anyhow::bail!("无法定位远端分支最新提交：{branch}");
    }

    Ok(remote.map(branch_commit_info))
}

pub fn parse_extra_params_args(extra_params: Vec<String>) -> Result<BTreeMap<String, String>> {
    let mut parsed = BTreeMap::new();
    for item in extra_params {
        let (key, value) = item
            .split_once('=')
            .with_context(|| format!("invalid --set value: {item}, expected KEY=VALUE"))?;
        parsed.insert(key.to_string(), value.to_string());
    }
    Ok(parsed)
}

fn selected_job<'a>(project: &'a ProjectConfig, use_variant: bool) -> Result<&'a JobConfig> {
    if use_variant {
        project
            .jobs
            .variant
            .as_ref()
            .with_context(|| format!("project {} does not have a variant job", project.key))
    } else {
        Ok(&project.jobs.standard)
    }
}

fn deploy_target_summaries(project: &ProjectConfig) -> Vec<DeployTargetSummary> {
    project
        .deploy_targets
        .iter()
        .map(|target| DeployTargetSummary {
            key: target.key.clone(),
            label: target.label.clone(),
            adapter: build::adapter_key(&target.adapter).to_string(),
            action_kind: build::action_kind_key(&target.action_kind).to_string(),
            job_name: target.job_name.clone(),
        })
        .collect()
}

fn selected_deploy_target<'a>(
    project: &'a ProjectConfig,
    target_key: Option<&str>,
) -> Result<&'a DeployTargetConfig> {
    if project.deploy_targets.is_empty() {
        anyhow::bail!("project {} has no deploy target configured", project.key);
    }

    let target_key = target_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| project.deploy_targets[0].key.as_str());

    project
        .deploy_targets
        .iter()
        .find(|target| target.key == target_key)
        .with_context(|| {
            format!(
                "deploy target {} not found for project {}",
                target_key, project.key
            )
        })
}

fn deploy_param_meta(project: &ProjectConfig, param: &DeployParamConfig) -> DeployParamMeta {
    let default_value = param_default_value(project, param);
    DeployParamMeta {
        key: param.key.clone(),
        label: param.label.clone(),
        kind: deploy_param_kind_key(&param.kind).to_string(),
        default_value,
        options: param.options.clone(),
        required: param.required,
        true_value: param.true_value.clone().unwrap_or_else(|| "是".to_string()),
        false_value: param
            .false_value
            .clone()
            .unwrap_or_else(|| "否".to_string()),
    }
}

fn resolve_deploy_param_value(
    project: &ProjectConfig,
    param: &DeployParamConfig,
    request: &DeployRequest,
) -> Result<String> {
    if let Some(value) = request.params.get(&param.key) {
        return Ok(value.clone());
    }
    if let Some(value) = request.extra_params.get(&param.key) {
        return Ok(value.clone());
    }
    if param.kind == DeployParamKind::Branch {
        let value = request.branch.clone().or_else(|| param.default.clone());
        return infer_branch(project, value);
    }
    if is_env_param(&param.key) {
        if let Some(value) = request.env.clone() {
            return Ok(value);
        }
    }

    let value = param_default_value(project, param);
    if param.required && value.trim().is_empty() {
        anyhow::bail!("deploy param {} is required", param.key);
    }
    Ok(value)
}

fn param_default_value(project: &ProjectConfig, param: &DeployParamConfig) -> String {
    if param.kind == DeployParamKind::Branch {
        return param
            .default
            .clone()
            .or_else(|| infer_branch(project, None).ok())
            .unwrap_or_default();
    }
    if param.kind == DeployParamKind::Boolean {
        return param
            .default
            .clone()
            .or_else(|| param.false_value.clone())
            .unwrap_or_else(|| "否".to_string());
    }
    param
        .default
        .clone()
        .or_else(|| param.options.first().cloned())
        .unwrap_or_default()
}

fn deploy_param_kind_key(kind: &DeployParamKind) -> &'static str {
    match kind {
        DeployParamKind::Select => "select",
        DeployParamKind::Boolean => "boolean",
        DeployParamKind::Branch => "branch",
        DeployParamKind::Text => "text",
        DeployParamKind::Hidden => "hidden",
    }
}

fn is_env_param(key: &str) -> bool {
    matches!(key, "ENV_PROFILE" | "projectEnv" | "env")
}

fn actual_deploy_param_default(job: &JobConfig, key: &str) -> String {
    job.default_params
        .get(key)
        .cloned()
        .unwrap_or_else(|| "否".to_string())
}

fn preferred_deploy_param_default(job: &JobConfig, key: &str) -> String {
    if key == "IS_BUILD_MOBILE" && job.params.iter().any(|param| param == key) {
        "是".to_string()
    } else {
        actual_deploy_param_default(job, key)
    }
}

fn find_param_key<'a>(job: &'a JobConfig, candidates: &[&str]) -> Option<&'a str> {
    job.params
        .iter()
        .find(|key| {
            candidates
                .iter()
                .any(|candidate| candidate == &key.as_str())
        })
        .map(String::as_str)
}

fn infer_branch(project: &ProjectConfig, branch_override: Option<String>) -> Result<String> {
    match branch_override {
        Some(branch) => Ok(branch),
        None => {
            let repo_path = project.repo_path.as_ref().with_context(|| {
                format!(
                    "project {} has no repo_path configured; pass --branch explicitly",
                    project.key
                )
            })?;
            git::current_branch(repo_path).with_context(|| {
                format!(
                    "failed to infer branch from repo path {}",
                    repo_path.display()
                )
            })
        }
    }
}

fn trigger_state_key(state: jenkins::TriggerState) -> &'static str {
    match state {
        jenkins::TriggerState::Accepted => "accepted",
        jenkins::TriggerState::Queued => "queued",
        jenkins::TriggerState::Running => "running",
        jenkins::TriggerState::Success => "success",
        jenkins::TriggerState::Failure => "failure",
        jenkins::TriggerState::Cancelled => "cancelled",
    }
}
