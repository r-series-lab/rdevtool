#![allow(dead_code)]

use crate::build;
use crate::config::{
    AppConfig, DeployParamConfig, DeployParamKind, DeployTargetConfig, JobConfig, ProjectConfig,
};
use crate::credentials;
use crate::git;
use crate::gitlab;
use crate::jenkins;
use crate::operation::{OperationEvidence, OperationRisk, OperationStatus, RecommendedAction};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const BRANCH_LOCAL_FETCH_TIMEOUT: Duration = Duration::from_secs(8);
const BRANCH_GITLAB_TIMEOUT: Duration = Duration::from_secs(12);
const BRANCH_REMOTE_TIMEOUT: Duration = Duration::from_secs(8);

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchCatalogRequested {
    pub project: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchCatalogEffective {
    pub repo_path: Option<String>,
    pub strategy: Vec<String>,
    pub local_fetch_timeout_ms: u64,
    pub gitlab_timeout_ms: u64,
    pub remote_timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchCatalogAttempt {
    pub source: String,
    pub status: String,
    pub elapsed_ms: u64,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchCatalogObserved {
    pub source: String,
    pub freshness: String,
    pub branch_count: usize,
    pub elapsed_ms: u64,
    pub attempts: Vec<BranchCatalogAttempt>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchCatalogResponse {
    pub requested: BranchCatalogRequested,
    pub effective: BranchCatalogEffective,
    pub observed: BranchCatalogObserved,
    pub status: OperationStatus,
    pub evidence: Vec<OperationEvidence>,
    pub risks: Vec<OperationRisk>,
    pub recommended_actions: Vec<RecommendedAction>,
    pub branches: Vec<BranchOption>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
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
    pub requested: BuildPlanRequested,
    pub effective: BuildPlanEffective,
    pub observed: BuildPlanObserved,
    pub ignored_inputs: Vec<IgnoredBuildInput>,
    pub status: OperationStatus,
    pub evidence: Vec<OperationEvidence>,
    pub risks: Vec<OperationRisk>,
    pub recommended_actions: Vec<RecommendedAction>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildPlanRequested {
    pub project: String,
    pub target: Option<String>,
    pub env: Option<String>,
    pub branch: Option<String>,
    pub params: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildPlanEffective {
    pub target: String,
    pub env: Option<String>,
    pub branch: Option<String>,
    pub params: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildPlanObserved {
    pub repo_path: Option<String>,
    pub commit: Option<BranchCommitInfo>,
    pub commit_source: Option<String>,
    pub changed_paths: Vec<String>,
    pub change_sources: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IgnoredBuildInput {
    pub key: String,
    pub value: String,
    pub reason: String,
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
    #[serde(default)]
    pub project: String,
    #[serde(default)]
    pub projects: Vec<String>,
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
    #[serde(default)]
    pub selected_paths: Vec<String>,
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

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchFileDiffRequest {
    pub project: String,
    #[serde(default)]
    pub repo_path: Option<String>,
    pub path: String,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub max_bytes: Option<usize>,
    #[serde(default)]
    pub max_lines: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchFileDiffResponse {
    pub project_key: String,
    pub project_name: String,
    pub repo_path: String,
    pub path: String,
    pub mode: String,
    pub diff: String,
    pub truncated: bool,
    pub binary: bool,
    pub warnings: Vec<String>,
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
    pub is_workspace_instance: bool,
    pub managed: bool,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkout_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback_reason: Option<String>,
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
    let response = branch_catalog(config, key)?;
    if !response.status.success {
        anyhow::bail!(response.status.detail);
    }
    Ok(response.branches)
}

pub fn branch_catalog(config: &AppConfig, key: &str) -> Result<BranchCatalogResponse> {
    let project = config.find_project(key)?;
    let started = Instant::now();
    let requested = BranchCatalogRequested {
        project: project.key.clone(),
    };
    let effective = BranchCatalogEffective {
        repo_path: project
            .repo_path
            .as_ref()
            .map(|path| path.display().to_string()),
        strategy: vec![
            "localRepository".to_string(),
            "gitlabApi".to_string(),
            "gitRemote".to_string(),
        ],
        local_fetch_timeout_ms: duration_ms(BRANCH_LOCAL_FETCH_TIMEOUT),
        gitlab_timeout_ms: duration_ms(BRANCH_GITLAB_TIMEOUT),
        remote_timeout_ms: duration_ms(BRANCH_REMOTE_TIMEOUT),
    };
    let mut attempts = Vec::new();
    let mut risks = Vec::new();

    if let Some(repo_path) = project.repo_path.as_deref() {
        if repo_path.is_dir() {
            let attempt_started = Instant::now();
            match git::available_branch_activity_with_timeout(repo_path, BRANCH_LOCAL_FETCH_TIMEOUT)
            {
                Ok(snapshot) if !snapshot.branches.is_empty() => {
                    let source = "localRepository";
                    let freshness = if snapshot.fresh { "fresh" } else { "cached" };
                    if let Some(error) = snapshot.fetch_error.as_deref() {
                        risks.push(OperationRisk {
                            code: "localFetchFailed".to_string(),
                            severity: "warning".to_string(),
                            detail: safe_branch_error(config, project, error),
                        });
                    }
                    attempts.push(BranchCatalogAttempt {
                        source: source.to_string(),
                        status: if snapshot.fresh {
                            "succeeded".to_string()
                        } else {
                            "degraded".to_string()
                        },
                        elapsed_ms: snapshot.elapsed_ms,
                        detail: if snapshot.fresh {
                            "远端引用已刷新，并从本地仓库读取分支。".to_string()
                        } else {
                            "远端刷新失败，已立即降级使用本地已有引用。".to_string()
                        },
                    });
                    return Ok(successful_branch_catalog(
                        requested,
                        effective,
                        started,
                        source,
                        freshness,
                        attempts,
                        branch_options(snapshot.branches),
                        risks,
                    ));
                }
                Ok(snapshot) => attempts.push(BranchCatalogAttempt {
                    source: "localRepository".to_string(),
                    status: "empty".to_string(),
                    elapsed_ms: snapshot.elapsed_ms,
                    detail: "本地仓库没有可用分支引用，继续尝试远端来源。".to_string(),
                }),
                Err(error) => {
                    let detail = safe_branch_error(config, project, &error.to_string());
                    attempts.push(BranchCatalogAttempt {
                        source: "localRepository".to_string(),
                        status: "failed".to_string(),
                        elapsed_ms: elapsed_ms(attempt_started),
                        detail: detail.clone(),
                    });
                    risks.push(OperationRisk {
                        code: "localRepositoryReadFailed".to_string(),
                        severity: "warning".to_string(),
                        detail,
                    });
                }
            }
        } else {
            let detail = format!(
                "配置的本地仓库目录不存在或不是目录：{}",
                repo_path.display()
            );
            attempts.push(BranchCatalogAttempt {
                source: "localRepository".to_string(),
                status: "skipped".to_string(),
                elapsed_ms: 0,
                detail: detail.clone(),
            });
            risks.push(OperationRisk {
                code: "repoPathUnavailable".to_string(),
                severity: "warning".to_string(),
                detail,
            });
        }
    } else {
        attempts.push(BranchCatalogAttempt {
            source: "localRepository".to_string(),
            status: "skipped".to_string(),
            elapsed_ms: 0,
            detail: "项目未配置 repoPath。".to_string(),
        });
    }

    if let Ok(token) = credentials::load_gitlab_token(&config.defaults) {
        let attempt_started = Instant::now();
        match gitlab::available_branch_activity_with_timeout(
            &project.git_url,
            config.defaults.gitlab_api_base_url.as_deref(),
            &token,
            BRANCH_GITLAB_TIMEOUT,
        ) {
            Ok(remote_items) if !remote_items.is_empty() => {
                attempts.push(BranchCatalogAttempt {
                    source: "gitlabApi".to_string(),
                    status: "succeeded".to_string(),
                    elapsed_ms: elapsed_ms(attempt_started),
                    detail: "已通过 GitLab API 完整读取分支及活跃时间。".to_string(),
                });
                return Ok(successful_branch_catalog(
                    requested,
                    effective,
                    started,
                    "gitlabApi",
                    "fresh",
                    attempts,
                    branch_options(remote_items),
                    risks,
                ));
            }
            Ok(_) => attempts.push(BranchCatalogAttempt {
                source: "gitlabApi".to_string(),
                status: "empty".to_string(),
                elapsed_ms: elapsed_ms(attempt_started),
                detail: "GitLab API 返回空分支列表，继续尝试 Git remote。".to_string(),
            }),
            Err(error) => {
                let detail = safe_branch_error(config, project, &error.to_string());
                attempts.push(BranchCatalogAttempt {
                    source: "gitlabApi".to_string(),
                    status: "failed".to_string(),
                    elapsed_ms: elapsed_ms(attempt_started),
                    detail: detail.clone(),
                });
                risks.push(OperationRisk {
                    code: "gitlabBranchQueryFailed".to_string(),
                    severity: "warning".to_string(),
                    detail,
                });
            }
        }
    } else {
        attempts.push(BranchCatalogAttempt {
            source: "gitlabApi".to_string(),
            status: "skipped".to_string(),
            elapsed_ms: 0,
            detail: "GitLab 凭据不可用，未调用 API。".to_string(),
        });
    }

    if !project.git_url.trim().is_empty() {
        let attempt_started = Instant::now();
        match git::remote_branches_with_timeout(&project.git_url, BRANCH_REMOTE_TIMEOUT) {
            Ok(names) if !names.is_empty() => {
                attempts.push(BranchCatalogAttempt {
                    source: "gitRemote".to_string(),
                    status: "degraded".to_string(),
                    elapsed_ms: elapsed_ms(attempt_started),
                    detail: "已通过 git ls-remote 读取完整分支名；不包含活跃时间。".to_string(),
                });
                risks.push(OperationRisk {
                    code: "branchActivityUnavailable".to_string(),
                    severity: "info".to_string(),
                    detail: "当前来源只提供分支名，无法按远端活跃时间排序。".to_string(),
                });
                let branches = names
                    .into_iter()
                    .map(|name| BranchOption {
                        name,
                        updated_at: String::new(),
                        updated_ts: 0,
                    })
                    .collect();
                return Ok(successful_branch_catalog(
                    requested,
                    effective,
                    started,
                    "gitRemote",
                    "freshNames",
                    attempts,
                    branches,
                    risks,
                ));
            }
            Ok(_) => attempts.push(BranchCatalogAttempt {
                source: "gitRemote".to_string(),
                status: "empty".to_string(),
                elapsed_ms: elapsed_ms(attempt_started),
                detail: "git ls-remote 返回空分支列表。".to_string(),
            }),
            Err(error) => {
                let detail = safe_branch_error(config, project, &error.to_string());
                attempts.push(BranchCatalogAttempt {
                    source: "gitRemote".to_string(),
                    status: "failed".to_string(),
                    elapsed_ms: elapsed_ms(attempt_started),
                    detail: detail.clone(),
                });
                risks.push(OperationRisk {
                    code: "gitRemoteQueryFailed".to_string(),
                    severity: "error".to_string(),
                    detail,
                });
            }
        }
    } else {
        attempts.push(BranchCatalogAttempt {
            source: "gitRemote".to_string(),
            status: "skipped".to_string(),
            elapsed_ms: 0,
            detail: "项目未配置 gitUrl。".to_string(),
        });
    }

    let detail = attempts
        .iter()
        .filter(|attempt| matches!(attempt.status.as_str(), "failed" | "empty"))
        .map(|attempt| format!("{}: {}", attempt.source, attempt.detail))
        .collect::<Vec<_>>()
        .join("；");
    Ok(BranchCatalogResponse {
        requested,
        effective,
        observed: BranchCatalogObserved {
            source: "none".to_string(),
            freshness: "unavailable".to_string(),
            branch_count: 0,
            elapsed_ms: elapsed_ms(started),
            attempts,
        },
        status: OperationStatus {
            key: "failed".to_string(),
            label: "同步失败".to_string(),
            success: false,
            terminal: true,
            detail: if detail.is_empty() {
                "没有可用的分支来源。".to_string()
            } else {
                detail
            },
        },
        evidence: Vec::new(),
        risks,
        recommended_actions: vec![RecommendedAction {
            command: format!("rdevtool --json projects show {}", project.key),
            reason: "检查项目 repoPath、gitUrl 与当前工作区实例路径。".to_string(),
            risk: "read-only".to_string(),
        }],
        branches: Vec::new(),
    })
}

fn branch_options(items: Vec<git::BranchActivity>) -> Vec<BranchOption> {
    items
        .into_iter()
        .map(|item| BranchOption {
            name: item.name,
            updated_at: item.updated_at,
            updated_ts: item.updated_ts,
        })
        .collect()
}

fn successful_branch_catalog(
    requested: BranchCatalogRequested,
    effective: BranchCatalogEffective,
    started: Instant,
    source: &str,
    freshness: &str,
    attempts: Vec<BranchCatalogAttempt>,
    branches: Vec<BranchOption>,
    risks: Vec<OperationRisk>,
) -> BranchCatalogResponse {
    let degraded = freshness != "fresh";
    let branch_count = branches.len();
    BranchCatalogResponse {
        requested,
        effective,
        observed: BranchCatalogObserved {
            source: source.to_string(),
            freshness: freshness.to_string(),
            branch_count,
            elapsed_ms: elapsed_ms(started),
            attempts,
        },
        status: OperationStatus {
            key: if degraded { "degraded" } else { "ready" }.to_string(),
            label: if degraded {
                "可用（已降级）"
            } else {
                "同步完成"
            }
            .to_string(),
            success: true,
            terminal: true,
            detail: format!("已从 {source} 获取 {branch_count} 个分支。"),
        },
        evidence: vec![OperationEvidence {
            kind: "branchCatalog".to_string(),
            source: source.to_string(),
            detail: format!("branchCount={branch_count}, freshness={freshness}"),
        }],
        risks,
        recommended_actions: Vec::new(),
        branches,
    }
}

fn safe_branch_error(config: &AppConfig, project: &ProjectConfig, error: &str) -> String {
    let mut detail = error.to_string();
    if !project.git_url.trim().is_empty() {
        detail = detail.replace(&project.git_url, "<project-remote>");
    }
    if let Some(api_base) = config.defaults.gitlab_api_base_url.as_deref() {
        detail = detail.replace(api_base, "<gitlab-api>");
    }
    detail
}

fn duration_ms(duration: Duration) -> u64 {
    duration.as_millis().min(u64::MAX as u128) as u64
}

fn elapsed_ms(started: Instant) -> u64 {
    duration_ms(started.elapsed())
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
    build_plan_with_observation(config, request, false)
}

/// Build a deploy plan after refreshing the selected remote branch once.
///
/// Desktop previews intentionally use [`build_plan`] so a 220ms UI debounce does not turn into
/// repeated `git fetch` calls. CLI plans and real triggers use this refreshed variant.
pub fn build_plan_refreshed(config: &AppConfig, request: &DeployRequest) -> Result<DeployPlan> {
    build_plan_with_observation(config, request, true)
}

fn build_plan_with_observation(
    config: &AppConfig,
    request: &DeployRequest,
    refresh_remote: bool,
) -> Result<DeployPlan> {
    let project = config.find_project(&request.project)?;
    let requested_branch = requested_branch_value(request);
    let branch_inference = requested_branch
        .as_deref()
        .and_then(|branch| infer_branch_dimensions(project, branch));
    let target_key = request
        .target
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| request.variant.then_some("variant"))
        .or_else(|| branch_inference.as_ref().map(|value| value.target.as_str()))
        .or(Some("standard"));
    let target = selected_deploy_target(project, target_key)?;
    let mut effective_request = request.clone();
    effective_request.target = Some(target.key.clone());
    effective_request.branch = request
        .branch
        .as_ref()
        .map(|value| value.trim().to_string());
    effective_request.env = request.env.as_ref().map(|value| value.trim().to_string());
    if effective_request.env.as_deref().is_none_or(str::is_empty) {
        effective_request.env = branch_inference.as_ref().map(|value| value.env.clone());
    }

    let mut params = BTreeMap::new();

    for param in &target.params {
        let value = resolve_deploy_param_value(project, param, &effective_request)?;
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

    let mut requested_params = request.extra_params.clone();
    requested_params.extend(request.params.clone());
    let branch_param = target
        .params
        .iter()
        .find(|param| param.kind == DeployParamKind::Branch);
    let env_param = target.params.iter().find(|param| is_env_param(&param.key));
    let effective_branch = branch_param.and_then(|param| non_empty_param(&params, &param.key));
    let effective_env = env_param.and_then(|param| non_empty_param(&params, &param.key));

    let mut ignored_inputs = Vec::new();
    diagnose_structured_input(
        "branch",
        request.branch.as_deref(),
        branch_param.map(|param| param.key.as_str()),
        effective_branch.as_deref(),
        &mut ignored_inputs,
    );
    diagnose_structured_input(
        "env",
        request.env.as_deref(),
        env_param.map(|param| param.key.as_str()),
        effective_env.as_deref(),
        &mut ignored_inputs,
    );

    let mut risks = validate_effective_deploy_params(target, &params);
    if let (Some(inferred), Some(explicit)) = (
        branch_inference.as_ref(),
        request
            .target
            .as_deref()
            .filter(|value| !value.trim().is_empty()),
    ) && inferred.target != explicit
    {
        risks.push(OperationRisk {
            code: "branchTargetMismatch".to_string(),
            severity: "warning".to_string(),
            detail: format!(
                "分支 {} 推导目标为 {}，但显式目标为 {}；已采用显式目标。",
                requested_branch.as_deref().unwrap_or_default(),
                inferred.target,
                explicit
            ),
        });
    }
    if let (Some(inferred), Some(explicit)) = (
        branch_inference.as_ref(),
        request
            .env
            .as_deref()
            .filter(|value| !value.trim().is_empty()),
    ) && inferred.env != explicit
    {
        risks.push(OperationRisk {
            code: "branchEnvironmentMismatch".to_string(),
            severity: "warning".to_string(),
            detail: format!(
                "分支 {} 推导环境为 {}，但显式环境为 {}；已采用显式环境。",
                requested_branch.as_deref().unwrap_or_default(),
                inferred.env,
                explicit
            ),
        });
    }

    for ignored in &ignored_inputs {
        risks.push(OperationRisk {
            code: format!("{}NotEffective", ignored.key),
            severity: "error".to_string(),
            detail: ignored.reason.clone(),
        });
    }

    let mut observed = BuildPlanObserved {
        repo_path: project
            .repo_path
            .as_ref()
            .map(|path| path.display().to_string()),
        commit: None,
        commit_source: None,
        changed_paths: Vec::new(),
        change_sources: Vec::new(),
    };
    let mut evidence = Vec::new();

    if let Some(repo_path) = project.repo_path.as_ref() {
        match git::build_change_snapshot(repo_path) {
            Ok(snapshot) => {
                observed.changed_paths.extend(snapshot.paths);
                observed.change_sources.extend(snapshot.sources);
            }
            Err(error) => risks.push(OperationRisk {
                code: "changeInspectionFailed".to_string(),
                severity: "warning".to_string(),
                detail: format!("未能读取项目改动路径：{error:#}"),
            }),
        }

        if let Some(branch) = effective_branch.as_deref() {
            let commit_result = if refresh_remote {
                git::try_latest_remote_branch_commit(repo_path, branch)
                    .map(|value| (value, "freshRemote"))
            } else {
                git::cached_branch_commit(repo_path, branch).map(|value| (value, "repositoryCache"))
            };
            match commit_result {
                Ok((Some(commit), source)) => {
                    observed.commit = Some(branch_commit_info(commit));
                    observed.commit_source = Some(source.to_string());
                }
                Ok((None, _)) => risks.push(OperationRisk {
                    code: "branchCommitUnavailable".to_string(),
                    severity: "warning".to_string(),
                    detail: format!("未能从本地仓库缓存定位待构建分支 {branch} 的提交。"),
                }),
                Err(error) => {
                    if let Ok(Some(commit)) = git::cached_branch_commit(repo_path, branch) {
                        observed.commit = Some(branch_commit_info(commit));
                        observed.commit_source = Some("staleRepositoryCache".to_string());
                    }
                    risks.push(OperationRisk {
                        code: "branchCommitRefreshFailed".to_string(),
                        severity: "warning".to_string(),
                        detail: format!("刷新待构建分支 {branch} 失败：{error:#}"),
                    });
                }
            }

            match git::cached_branch_tip_changed_paths(repo_path, branch) {
                Ok(paths) if !paths.is_empty() => {
                    observed.changed_paths.extend(paths);
                    observed
                        .change_sources
                        .push("selectedBranchTip".to_string());
                }
                Ok(_) => {}
                Err(error) => risks.push(OperationRisk {
                    code: "branchChangeInspectionFailed".to_string(),
                    severity: "warning".to_string(),
                    detail: format!("未能读取待构建分支 {branch} 最新提交的改动路径：{error:#}"),
                }),
            }
        }
    } else {
        risks.push(OperationRisk {
            code: "repositoryUnavailable".to_string(),
            severity: "warning".to_string(),
            detail: "项目未配置本地仓库，无法核对提交和改动目录。".to_string(),
        });
    }

    observed.changed_paths.sort();
    observed.changed_paths.dedup();
    observed.change_sources.sort();
    observed.change_sources.dedup();
    risks.extend(build_side_change_risks(
        target,
        &params,
        &observed.changed_paths,
    ));

    if let Some(commit) = observed.commit.as_ref() {
        evidence.push(OperationEvidence {
            kind: "selectedCommit".to_string(),
            source: observed
                .commit_source
                .clone()
                .unwrap_or_else(|| "repository".to_string()),
            detail: format!("{} {}", commit.short_hash, commit.subject),
        });
    }
    if !observed.changed_paths.is_empty() {
        evidence.push(OperationEvidence {
            kind: "changedPaths".to_string(),
            source: observed.change_sources.join(","),
            detail: observed.changed_paths.join(", "),
        });
    }

    let has_blocking_risk = risks.iter().any(|risk| risk.severity == "error");
    let status = if has_blocking_risk {
        OperationStatus {
            key: "blocked".to_string(),
            label: "计划已阻断".to_string(),
            success: false,
            terminal: true,
            detail: "存在未生效输入或构建范围风险，请修正参数后再触发。".to_string(),
        }
    } else if risks.is_empty() {
        OperationStatus {
            key: "ready".to_string(),
            label: "可以触发".to_string(),
            success: true,
            terminal: true,
            detail: "构建参数已完整解析。".to_string(),
        }
    } else {
        OperationStatus {
            key: "readyWithWarnings".to_string(),
            label: "可以触发（有警告）".to_string(),
            success: true,
            terminal: true,
            detail: "构建参数已解析，但存在非阻断风险。".to_string(),
        }
    };
    let recommended_actions =
        build_plan_recommended_actions(project, target, &ignored_inputs, &risks);
    let adapter_plan = build::plan_adapter(config, project, target, &params)?;

    Ok(DeployPlan {
        project_key: project.key.clone(),
        project_name: project.name.clone(),
        adapter: adapter_plan.adapter,
        action_kind: adapter_plan.action_kind,
        job_kind: target.key.clone(),
        job_name: adapter_plan.job_name,
        trigger_url: adapter_plan.trigger_url,
        params: params.clone(),
        jenkins_base_url: adapter_plan.jenkins_base_url,
        command: adapter_plan.command,
        cwd: adapter_plan.cwd,
        output_dir: adapter_plan.output_dir,
        requested: BuildPlanRequested {
            project: request.project.clone(),
            target: request.target.clone(),
            env: request.env.clone(),
            branch: request.branch.clone(),
            params: requested_params,
        },
        effective: BuildPlanEffective {
            target: target.key.clone(),
            env: effective_env,
            branch: effective_branch,
            params,
        },
        observed,
        ignored_inputs,
        status,
        evidence,
        risks,
        recommended_actions,
    })
}

pub fn trigger_deploy(config: &AppConfig, request: &DeployRequest) -> Result<BuildTriggerResponse> {
    let project = config.find_project(&request.project)?;
    let plan = build_plan_refreshed(config, request)?;
    if !plan.status.success {
        let details = plan
            .risks
            .iter()
            .filter(|risk| risk.severity == "error")
            .map(|risk| risk.detail.as_str())
            .collect::<Vec<_>>()
            .join("；");
        anyhow::bail!("构建计划已阻断：{details}");
    }
    let target = selected_deploy_target(project, Some(&plan.effective.target))?;
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

pub fn plan_branch_sync(
    config: &AppConfig,
    request: &BranchSyncRequest,
) -> Result<BranchTaskResponse> {
    let mut project_keys = normalize_branch_list(&request.projects);
    let legacy_project = request.project.trim();
    if project_keys.is_empty() && !legacy_project.is_empty() {
        project_keys.push(legacy_project.to_string());
    }
    let source_branch = request.source_branch.trim();
    let target_branches = normalize_branch_list(&request.target_branches);
    if project_keys.is_empty() {
        anyhow::bail!("至少选择一个项目");
    }
    if source_branch.is_empty() {
        anyhow::bail!("源分支不能为空");
    }
    if target_branches.is_empty() {
        anyhow::bail!("至少选择一个目标分支");
    }

    let gitlab_token = credentials::load_gitlab_token(&config.defaults).ok();
    let mut items = Vec::new();
    for project_key in project_keys {
        let project = match config.find_project(&project_key) {
            Ok(project) => project,
            Err(error) => {
                for target_branch in &target_branches {
                    items.push(BranchTaskItemResult {
                        project_key: project_key.clone(),
                        project_name: project_key.clone(),
                        source_branch: source_branch.to_string(),
                        target_branch: Some(target_branch.clone()),
                        output_path: None,
                        checkout_mode: None,
                        fallback_reason: None,
                        success: false,
                        status_key: "project_missing".to_string(),
                        status_label: "失败".to_string(),
                        summary: "项目不存在".to_string(),
                        detail: error.to_string(),
                        remote: false,
                        commit: None,
                    });
                }
                continue;
            }
        };

        let remote_branches =
            match load_remote_branch_names(config, project, gitlab_token.as_deref()) {
                Ok(branches) => branches,
                Err(error) => {
                    for target_branch in &target_branches {
                        items.push(branch_task_failure(
                            project,
                            source_branch,
                            Some(target_branch),
                            "branch_check_failed",
                            "失败",
                            "远端分支检查失败",
                            &error.to_string(),
                        ));
                    }
                    continue;
                }
            };
        let source_exists = remote_branches.contains(source_branch);

        for target_branch in &target_branches {
            let target_exists = remote_branches.contains(target_branch.as_str());
            if let Some((status_key, summary, detail)) =
                branch_presence_failure(source_exists, target_exists, source_branch, target_branch)
            {
                items.push(branch_task_failure(
                    project,
                    source_branch,
                    Some(target_branch),
                    status_key,
                    "失败",
                    summary,
                    &detail,
                ));
                continue;
            }

            if target_branch == source_branch {
                items.push(BranchTaskItemResult {
                    project_key: project.key.clone(),
                    project_name: project.name.clone(),
                    source_branch: source_branch.to_string(),
                    target_branch: Some(target_branch.clone()),
                    output_path: None,
                    checkout_mode: None,
                    fallback_reason: None,
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

            items.push(BranchTaskItemResult {
                project_key: project.key.clone(),
                project_name: project.name.clone(),
                source_branch: source_branch.to_string(),
                target_branch: Some(target_branch.clone()),
                output_path: None,
                checkout_mode: None,
                fallback_reason: None,
                success: true,
                status_key: "ready".to_string(),
                status_label: "可合并".to_string(),
                summary: "远端分支检查通过".to_string(),
                detail: "源分支和目标分支均存在，可执行合并。".to_string(),
                remote: false,
                commit: None,
            });
        }
    }

    Ok(branch_task_response("sync", items))
}

pub fn execute_branch_sync(
    config: &AppConfig,
    request: &BranchSyncRequest,
) -> Result<BranchTaskResponse> {
    let plan = plan_branch_sync(config, request)?;
    let mut items = Vec::with_capacity(plan.items.len());

    for item in plan.items {
        if item.status_key != "ready" {
            items.push(item);
            continue;
        }

        let target_branch = match item.target_branch.as_deref() {
            Some(target_branch) => target_branch,
            None => {
                items.push(BranchTaskItemResult {
                    success: false,
                    status_key: "target_missing".to_string(),
                    status_label: "失败".to_string(),
                    summary: "目标分支不存在".to_string(),
                    detail: "预检结果没有包含目标分支。".to_string(),
                    ..item
                });
                continue;
            }
        };
        let merge_request = MergeRequest {
            project: item.project_key.clone(),
            source_branch: item.source_branch.clone(),
            target_branch: target_branch.to_string(),
        };
        match execute_merge(config, &merge_request) {
            Ok(result) => items.push(branch_task_item_from_merge_result(result)),
            Err(error) => {
                let project = config.find_project(&item.project_key)?;
                items.push(branch_task_failure(
                    project,
                    &item.source_branch,
                    item.target_branch.as_deref(),
                    "merge_failed",
                    "失败",
                    "合并失败",
                    &error.to_string(),
                ));
            }
        }
    }

    Ok(branch_task_response("sync", items))
}

fn load_remote_branch_names(
    config: &AppConfig,
    project: &ProjectConfig,
    gitlab_token: Option<&str>,
) -> Result<BTreeSet<String>> {
    let mut errors = Vec::new();

    if let Some(repo_path) = project.repo_path.as_deref() {
        match git::fetched_remote_branches(repo_path) {
            Ok(branches) => return Ok(branches.into_iter().collect()),
            Err(error) => errors.push(format!("本地仓库刷新失败: {error}")),
        }
    }

    if let Some(token) = gitlab_token {
        match gitlab::available_branch_activity(
            &project.git_url,
            config.defaults.gitlab_api_base_url.as_deref(),
            token,
        ) {
            Ok(branches) => {
                return Ok(branches.into_iter().map(|branch| branch.name).collect());
            }
            Err(error) => errors.push(format!("GitLab 分支读取失败: {error}")),
        }
    }

    match git::remote_branches(&project.git_url) {
        Ok(branches) => Ok(branches.into_iter().collect()),
        Err(error) => {
            errors.push(format!("远端仓库分支读取失败: {error}"));
            anyhow::bail!(errors.join("\n"))
        }
    }
}

fn branch_presence_failure(
    source_exists: bool,
    target_exists: bool,
    source_branch: &str,
    target_branch: &str,
) -> Option<(&'static str, &'static str, String)> {
    match (source_exists, target_exists) {
        (true, true) => None,
        (false, false) => Some((
            "branches_missing",
            "源分支和目标分支不存在",
            format!("远端不存在源分支 {source_branch} 和目标分支 {target_branch}。"),
        )),
        (false, true) => Some((
            "source_missing",
            "源分支不存在",
            format!("远端不存在源分支 {source_branch}，请先推送或创建该分支。"),
        )),
        (true, false) => Some((
            "target_missing",
            "目标分支不存在",
            format!(
                "远端不存在目标分支 {target_branch}；合并模式不会自动创建，请先在创建模式中创建。"
            ),
        )),
    }
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
                    checkout_mode: None,
                    fallback_reason: None,
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
                    checkout_mode: None,
                    fallback_reason: None,
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
                    checkout_mode: None,
                    fallback_reason: None,
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

    let destination = Path::new(request.destination_dir.trim());
    let result = if let Some(repo_path) = project.repo_path.as_ref() {
        checkout_branch_with_compat_fallback(
            &project.git_url,
            repo_path,
            source_branch,
            destination,
        )
    } else {
        git::clone_branch_to_directory(&project.git_url, source_branch, destination)
    };
    let items = match result {
        Ok(value) => {
            let checkout_mode = value.checkout_mode.key().to_string();
            let summary = match value.checkout_mode {
                git::BranchCheckoutMode::Worktree => "已创建 Git worktree",
                git::BranchCheckoutMode::Clone if value.fallback_reason.is_some() => {
                    "已回退为独立 clone 副本"
                }
                git::BranchCheckoutMode::Clone => "已创建独立 clone 副本",
            };
            vec![BranchTaskItemResult {
                project_key: project.key.clone(),
                project_name: project.name.clone(),
                source_branch: source_branch.to_string(),
                target_branch: None,
                output_path: Some(value.output_path.display().to_string()),
                checkout_mode: Some(checkout_mode),
                fallback_reason: value.fallback_reason,
                success: true,
                status_key: "checked_out".to_string(),
                status_label: "已创建".to_string(),
                summary: summary.to_string(),
                detail: value.detail,
                remote: true,
                commit: None,
            }]
        }
        Err(error) => vec![branch_task_failure(
            project,
            source_branch,
            None,
            "checkout_failed",
            "失败",
            "创建工作副本失败",
            &error.to_string(),
        )],
    };

    Ok(branch_task_response("checkout", items))
}

fn checkout_branch_with_compat_fallback(
    git_url: &str,
    repo_path: &Path,
    source_branch: &str,
    destination: &Path,
) -> Result<git::BranchCheckoutResult> {
    finish_checkout_with_clone_fallback(
        git::add_worktree_from_branch(repo_path, source_branch, destination),
        || git::clone_branch_to_directory(git_url, source_branch, destination),
    )
}

fn finish_checkout_with_clone_fallback(
    worktree_result: Result<git::BranchCheckoutResult>,
    clone_checkout: impl FnOnce() -> Result<git::BranchCheckoutResult>,
) -> Result<git::BranchCheckoutResult> {
    match worktree_result {
        Ok(result) => Ok(result),
        Err(worktree_error) if git::is_worktree_unavailable_error(&worktree_error) => {
            let fallback_reason = worktree_error.to_string();
            let mut result = clone_checkout().with_context(|| {
                format!(
                    "Git worktree 不可用，且独立 clone 回退失败；worktree 原因：{fallback_reason}"
                )
            })?;
            let fallback_notice = format!(
                "Git worktree 功能不可用，已使用独立 clone 创建副本。目录相互隔离，但 clone 会额外占用磁盘和网络。\n回退原因：{fallback_reason}"
            );
            result.detail = if result.detail.trim().is_empty() {
                fallback_notice
            } else {
                format!("{fallback_notice}\n\n{}", result.detail)
            };
            result.fallback_reason = Some(fallback_reason);
            Ok(result)
        }
        Err(error) => Err(error
            .context("创建 Git worktree 失败；未自动回退 clone，以免掩盖本地仓库、分支或目录错误")),
    }
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
    is_workspace_instance: bool,
    managed: bool,
    branch_hint: Option<&str>,
    detached_hint: bool,
) -> BranchWorktreeSummary {
    let repo_path_text = repo_path.display().to_string();
    let path_missing = !repo_path.exists();
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
                is_workspace_instance,
                managed,
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
                is_workspace_instance,
                managed,
                status_key: if path_missing {
                    "missing"
                } else {
                    "unavailable"
                }
                .to_string(),
                status_label: if path_missing {
                    "目录缺失"
                } else {
                    "不可用"
                }
                .to_string(),
                detail: if path_missing {
                    if is_git_worktree {
                        "目录已被删除，但 Git 仍保留工作副本登记；可直接修复并重建。".to_string()
                    } else {
                        "本地工作副本目录不存在，请重新选择或绑定目录。".to_string()
                    }
                } else {
                    error.to_string()
                },
                latest_commit: None,
            }
        }
    }
}

pub fn repair_project_worktree(
    config: &AppConfig,
    key: &str,
    repo_path: &Path,
) -> Result<BranchWorktreeSummary> {
    let project = config.find_project(key)?;
    let default_repo_path = project
        .repo_path
        .as_ref()
        .with_context(|| format!("project {} has no repo_path configured", project.key))?;
    if !default_repo_path.exists() {
        anyhow::bail!(
            "项目默认目录不存在，无法修复工作副本：{}",
            default_repo_path.display()
        );
    }
    if repo_path.exists() {
        anyhow::bail!("工作副本目录仍然存在，无需修复：{}", repo_path.display());
    }

    let repaired = git::repair_missing_worktree(default_repo_path, repo_path)?;
    Ok(branch_status_for_project_path(
        project,
        &repaired.path,
        false,
        true,
        false,
        false,
        Some(&repaired.branch),
        false,
    ))
}

pub fn project_worktrees(config: &AppConfig, key: &str) -> Result<Vec<BranchWorktreeSummary>> {
    let project = config.find_project(key)?;
    let default_repo_path = project
        .repo_path
        .as_ref()
        .with_context(|| format!("project {} has no repo_path configured", project.key))?;
    let default_identity = path_identity(default_repo_path);
    let mut seen = BTreeSet::new();
    let mut paths = Vec::<(PathBuf, bool, bool, bool, bool, Option<String>, bool)>::new();

    seen.insert(default_identity.clone());
    paths.push((
        default_repo_path.clone(),
        true,
        false,
        false,
        false,
        None,
        false,
    ));

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
                    false,
                    false,
                    worktree.branch,
                    worktree.detached,
                ));
            } else if identity == default_identity {
                paths[0].2 = true;
                paths[0].5 = worktree.branch;
                paths[0].6 = worktree.detached;
            }
        }
    }

    Ok(paths
        .into_iter()
        .map(
            |(
                path,
                is_default,
                is_git_worktree,
                is_workspace_instance,
                managed,
                branch_hint,
                detached_hint,
            )| {
                branch_status_for_project_path(
                    project,
                    &path,
                    is_default,
                    is_git_worktree,
                    is_workspace_instance,
                    managed,
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
        checkout_mode: None,
        fallback_reason: None,
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

pub fn branch_file_diff(
    config: &AppConfig,
    request: &BranchFileDiffRequest,
) -> Result<BranchFileDiffResponse> {
    let project = config.find_project(&request.project)?;
    let repo_path = resolve_branch_repo_path(project, request.repo_path.as_deref())?;
    let diff = git::changed_file_diff(
        &repo_path,
        &request.path,
        request.mode.as_deref(),
        request.max_bytes,
        request.max_lines,
    )?;

    Ok(BranchFileDiffResponse {
        project_key: project.key.clone(),
        project_name: project.name.clone(),
        repo_path: repo_path.display().to_string(),
        path: diff.path,
        mode: diff.mode,
        diff: diff.diff,
        truncated: diff.truncated,
        binary: diff.binary,
        warnings: diff.warnings,
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
        &request.selected_paths,
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
                checkout_mode: None,
                fallback_reason: None,
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
        checkout_mode: None,
        fallback_reason: None,
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
        checkout_mode: None,
        fallback_reason: None,
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
            let heading = format!(
                "{}: {} -> {} [{}]",
                item.project_name, item.source_branch, target, item.status_label
            );
            if item.success {
                return heading;
            }

            let mut lines = vec![heading];
            if !item.summary.trim().is_empty() {
                lines.push(format!("原因：{}", item.summary.trim()));
            }
            if !item.detail.trim().is_empty() && item.detail.trim() != item.summary.trim() {
                lines.push(item.detail.trim().to_string());
            }
            lines.join("\n")
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

#[derive(Debug, Clone)]
struct BranchDimensionInference {
    target: String,
    env: String,
}

fn requested_branch_value(request: &DeployRequest) -> Option<String> {
    request
        .branch
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            request
                .params
                .iter()
                .chain(request.extra_params.iter())
                .find(|(key, value)| is_branch_input_key(key) && !value.trim().is_empty())
                .map(|(_, value)| value.trim().to_string())
        })
}

fn is_branch_input_key(key: &str) -> bool {
    matches!(
        key.trim().to_ascii_lowercase().as_str(),
        "branch" | "git_branch" | "gitbranch"
    )
}

/// Infer `env-{environment}-{target}` only when the target and environment are both supported by
/// the project's own configuration. This keeps the convention generic and avoids project-specific
/// regular expressions.
fn infer_branch_dimensions(
    project: &ProjectConfig,
    branch: &str,
) -> Option<BranchDimensionInference> {
    let remainder = branch.trim().strip_prefix("env-")?;
    let mut matches = project
        .deploy_targets
        .iter()
        .filter_map(|target| {
            let suffix = format!("-{}", target.key);
            let env = remainder.strip_suffix(&suffix)?.trim();
            if env.is_empty() {
                return None;
            }
            let env_param = target.params.iter().find(|param| is_env_param(&param.key));
            if let Some(param) = env_param
                && !param.options.is_empty()
                && !param.options.iter().any(|option| option == env)
            {
                return None;
            }
            Some(BranchDimensionInference {
                target: target.key.clone(),
                env: env.to_string(),
            })
        })
        .collect::<Vec<_>>();
    (matches.len() == 1).then(|| matches.remove(0))
}

fn non_empty_param(params: &BTreeMap<String, String>, key: &str) -> Option<String> {
    params
        .get(key)
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn diagnose_structured_input(
    key: &str,
    requested_value: Option<&str>,
    mapped_param: Option<&str>,
    effective_value: Option<&str>,
    ignored: &mut Vec<IgnoredBuildInput>,
) {
    let Some(requested_value) = requested_value else {
        return;
    };
    let requested_value = requested_value.trim();
    match mapped_param {
        None => ignored.push(IgnoredBuildInput {
            key: key.to_string(),
            value: requested_value.to_string(),
            reason: format!("输入 --{key}={requested_value} 未映射到所选构建目标的正式参数。"),
        }),
        Some(param_key) if effective_value != Some(requested_value) => {
            ignored.push(IgnoredBuildInput {
                key: key.to_string(),
                value: requested_value.to_string(),
                reason: format!(
                    "输入 --{key}={requested_value} 被 {param_key}={} 覆盖，未成为实际值。",
                    effective_value.unwrap_or("<empty>")
                ),
            });
        }
        Some(_) => {}
    }
}

fn validate_effective_deploy_params(
    target: &DeployTargetConfig,
    params: &BTreeMap<String, String>,
) -> Vec<OperationRisk> {
    let mut risks = Vec::new();
    for param in &target.params {
        let value = params.get(&param.key).map(String::as_str).unwrap_or("");
        if param.required && value.trim().is_empty() {
            risks.push(OperationRisk {
                code: format!("requiredParamMissing.{}", param.key),
                severity: "error".to_string(),
                detail: format!("必填参数 {} 为空。", param.key),
            });
            continue;
        }
        if value.trim().is_empty() {
            continue;
        }
        if param.kind == DeployParamKind::Select
            && !param.options.is_empty()
            && !param.options.iter().any(|option| option == value)
        {
            risks.push(OperationRisk {
                code: format!("invalidSelectValue.{}", param.key),
                severity: "error".to_string(),
                detail: format!(
                    "参数 {} 的值 {} 不在允许选项 [{}] 中。",
                    param.key,
                    value,
                    param.options.join(", ")
                ),
            });
        }
        if param.kind == DeployParamKind::Boolean {
            let true_value = param.true_value.as_deref().unwrap_or("是");
            let false_value = param.false_value.as_deref().unwrap_or("否");
            if value != true_value && value != false_value {
                risks.push(OperationRisk {
                    code: format!("invalidBooleanValue.{}", param.key),
                    severity: "error".to_string(),
                    detail: format!(
                        "参数 {} 的值 {} 无效，仅允许 {} 或 {}。",
                        param.key, value, true_value, false_value
                    ),
                });
            }
        }
    }
    risks
}

fn default_impact_paths(param_key: &str) -> Vec<String> {
    match param_key {
        "IS_BUILD_MOBILE" => vec!["mobile/**".to_string()],
        "IS_BUILD_ADMIN" => vec!["imop-admin/**".to_string()],
        _ => Vec::new(),
    }
}

fn impact_path_matches(pattern: &str, path: &str) -> bool {
    let pattern = pattern.trim().trim_start_matches("./").replace('\\', "/");
    let path = path.trim().trim_start_matches("./").replace('\\', "/");
    if let Some(prefix) = pattern.strip_suffix("/**") {
        let prefix = prefix.trim_end_matches('/');
        return path == prefix || path.starts_with(&format!("{prefix}/"));
    }
    path == pattern
}

fn build_side_change_risks(
    target: &DeployTargetConfig,
    params: &BTreeMap<String, String>,
    changed_paths: &[String],
) -> Vec<OperationRisk> {
    let mut risks = Vec::new();
    for param in target
        .params
        .iter()
        .filter(|param| param.kind == DeployParamKind::Boolean)
    {
        let patterns = if param.impact_paths.is_empty() {
            default_impact_paths(&param.key)
        } else {
            param.impact_paths.clone()
        };
        if patterns.is_empty() {
            continue;
        }
        let matching_paths = changed_paths
            .iter()
            .filter(|path| {
                patterns
                    .iter()
                    .any(|pattern| impact_path_matches(pattern, path))
            })
            .take(5)
            .cloned()
            .collect::<Vec<_>>();
        if matching_paths.is_empty() {
            continue;
        }
        let actual = params.get(&param.key).map(String::as_str).unwrap_or("");
        let enabled = param.true_value.as_deref().unwrap_or("是");
        if actual != enabled {
            risks.push(OperationRisk {
                code: format!("buildSideDisabled.{}", param.key),
                severity: "error".to_string(),
                detail: format!(
                    "检测到 [{}] 有改动，但 {}={}；应设置为 {}。",
                    matching_paths.join(", "),
                    param.key,
                    if actual.is_empty() { "<empty>" } else { actual },
                    enabled
                ),
            });
        }
    }
    risks
}

fn build_plan_recommended_actions(
    project: &ProjectConfig,
    target: &DeployTargetConfig,
    ignored_inputs: &[IgnoredBuildInput],
    risks: &[OperationRisk],
) -> Vec<RecommendedAction> {
    let mut actions = Vec::new();
    if ignored_inputs.iter().any(|item| item.key == "branch")
        && !target
            .params
            .iter()
            .any(|param| param.kind == DeployParamKind::Branch)
    {
        actions.push(RecommendedAction {
            command: format!(
                "rdevtool projects build-param-add {} {} --key BRANCH --label 分支 --kind branch --required",
                project.key, target.key
            ),
            reason: "为目标建立正式分支参数映射，避免 --branch 被忽略。".to_string(),
            risk: "会修改 rDevTool 项目配置；执行前请确认 Jenkins 参数名为 BRANCH。"
                .to_string(),
        });
    }
    for risk in risks {
        let Some(param_key) = risk.code.strip_prefix("buildSideDisabled.") else {
            continue;
        };
        let enabled = target
            .params
            .iter()
            .find(|param| param.key == param_key)
            .and_then(|param| param.true_value.as_deref())
            .unwrap_or("是");
        actions.push(RecommendedAction {
            command: format!(
                "rdevtool build plan {} --target {} --set {}={}",
                project.key, target.key, param_key, enabled
            ),
            reason: format!("让改动目录对应的构建端 {param_key} 生效。"),
            risk: "重新核对计划后再执行 build run。".to_string(),
        });
    }
    actions
}

pub fn parse_extra_params_args(extra_params: Vec<String>) -> Result<BTreeMap<String, String>> {
    let mut parsed = BTreeMap::new();
    for item in extra_params {
        let (key, value) = item
            .split_once('=')
            .with_context(|| format!("invalid --set value: {item}, expected KEY=VALUE"))?;
        let key = key.trim();
        if key.is_empty() {
            anyhow::bail!("invalid --set value: {item}, parameter key is empty");
        }
        if parsed.insert(key.to_string(), value.to_string()).is_some() {
            anyhow::bail!("duplicate --set parameter: {key}");
        }
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
        return Ok(infer_branch(project, value).unwrap_or_default());
    }
    if is_env_param(&param.key) {
        if let Some(value) = request.env.clone() {
            return Ok(value);
        }
    }

    Ok(param_default_value(project, param))
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

#[cfg(test)]
mod tests {
    use super::*;

    fn run_test_git(repo: &Path, args: &[&str]) -> String {
        let output = std::process::Command::new("git")
            .args(["-C"])
            .arg(repo)
            .args(args)
            .output()
            .expect("run git command");
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn branch_catalog_test_repo(remote: Option<&Path>) -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "rdevtool-branch-catalog-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let repo = root.join("repo");
        std::fs::create_dir_all(&repo).expect("create branch catalog repo");
        run_test_git(&repo, &["init"]);
        run_test_git(
            &repo,
            &["config", "user.email", "rdevtool-test@example.com"],
        );
        run_test_git(&repo, &["config", "user.name", "rDevTool Test"]);
        std::fs::write(repo.join("README.md"), "catalog\n").expect("write catalog file");
        run_test_git(&repo, &["add", "README.md"]);
        run_test_git(&repo, &["commit", "-m", "catalog"]);
        run_test_git(&repo, &["branch", "-M", "main"]);
        if let Some(remote) = remote {
            run_test_git(
                &repo,
                &["remote", "add", "origin", remote.to_string_lossy().as_ref()],
            );
        }
        (root, repo)
    }

    fn branch_catalog_test_config(repo: &Path, git_url: &str) -> AppConfig {
        toml::from_str(&format!(
            r#"
[defaults]

[[projects]]
key = "demo"
name = "Demo"
repo_path = "{}"
git_url = "{}"
"#,
            repo.display(),
            git_url,
        ))
        .expect("parse branch catalog config")
    }

    fn build_plan_test_config(repo: &Path, vke_branch_param: bool) -> AppConfig {
        let branch_param = if vke_branch_param {
            r#"
[[projects.deploy_targets.params]]
key = "BRANCH"
label = "分支"
type = "branch"
required = true
"#
        } else {
            ""
        };
        toml::from_str(&format!(
            r#"
[defaults]

[[projects]]
key = "demo"
name = "Demo"
repo_path = "{}"
git_url = ""

[[projects.deploy_targets]]
key = "standard"
label = "Standard"
adapter = "local_command"
action_kind = "build"
job_name = "true"

[[projects.deploy_targets.params]]
key = "BRANCH"
label = "分支"
type = "branch"
required = true

[[projects.deploy_targets]]
key = "vke"
label = "VKE"
adapter = "local_command"
action_kind = "build"
job_name = "true"

[[projects.deploy_targets.params]]
key = "ENV_PROFILE"
label = "环境"
type = "select"
options = ["dc2", "uat"]
required = true

[[projects.deploy_targets.params]]
key = "IS_BUILD_ADMIN"
label = "管理端"
type = "boolean"
default = "是"
true_value = "是"
false_value = "否"
impact_paths = ["imop-admin/**"]

[[projects.deploy_targets.params]]
key = "IS_BUILD_MOBILE"
label = "移动端"
type = "boolean"
default = "否"
true_value = "是"
false_value = "否"
impact_paths = ["mobile/**"]
{branch_param}
"#,
            repo.display(),
        ))
        .expect("parse build plan config")
    }

    #[test]
    fn build_plan_reports_and_blocks_an_unmapped_branch_input() {
        let (root, repo) = branch_catalog_test_repo(None);
        let config = build_plan_test_config(&repo, false);
        let request = DeployRequest {
            project: "demo".to_string(),
            branch: Some("env-dc2-vke".to_string()),
            ..DeployRequest::default()
        };
        let plan = build_plan(&config, &request).expect("plan should remain inspectable");

        assert_eq!(plan.effective.target, "vke");
        assert_eq!(plan.effective.env.as_deref(), Some("dc2"));
        assert_eq!(plan.effective.branch, None);
        assert!(!plan.params.contains_key("BRANCH"));
        assert_eq!(plan.ignored_inputs.len(), 1);
        assert_eq!(plan.ignored_inputs[0].key, "branch");
        assert!(!plan.status.success);
        assert!(
            plan.risks
                .iter()
                .any(|risk| risk.code == "branchNotEffective" && risk.severity == "error")
        );
        let trigger_error = trigger_deploy(&config, &request)
            .expect_err("a blocked plan must never reach the build adapter");
        assert!(trigger_error.to_string().contains("构建计划已阻断"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn build_plan_maps_branch_and_infers_target_and_environment_from_config() {
        let (root, repo) = branch_catalog_test_repo(None);
        run_test_git(&repo, &["branch", "env-dc2-vke"]);
        let config = build_plan_test_config(&repo, true);
        let plan = build_plan(
            &config,
            &DeployRequest {
                project: "demo".to_string(),
                branch: Some("env-dc2-vke".to_string()),
                ..DeployRequest::default()
            },
        )
        .expect("build mapped plan");

        assert_eq!(plan.job_kind, "vke");
        assert_eq!(
            plan.params.get("ENV_PROFILE").map(String::as_str),
            Some("dc2")
        );
        assert_eq!(
            plan.params.get("BRANCH").map(String::as_str),
            Some("env-dc2-vke")
        );
        assert_eq!(plan.effective.branch.as_deref(), Some("env-dc2-vke"));
        assert!(plan.ignored_inputs.is_empty());
        assert!(plan.status.success);
        assert!(plan.observed.commit.is_some());

        let serialized = serde_json::to_value(&plan).expect("serialize build plan");
        for key in [
            "requested",
            "effective",
            "observed",
            "ignoredInputs",
            "status",
            "risks",
        ] {
            assert!(
                serialized.get(key).is_some(),
                "missing contract field {key}"
            );
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn build_plan_blocks_a_disabled_build_side_when_matching_paths_changed() {
        let (root, repo) = branch_catalog_test_repo(None);
        std::fs::create_dir_all(repo.join("mobile/src")).expect("create mobile directory");
        std::fs::write(repo.join("mobile/src/mid-page.ts"), "export {};\n")
            .expect("write mobile change");
        let config = build_plan_test_config(&repo, true);
        let request = DeployRequest {
            project: "demo".to_string(),
            target: Some("vke".to_string()),
            env: Some("dc2".to_string()),
            branch: Some("main".to_string()),
            ..DeployRequest::default()
        };
        let blocked = build_plan(&config, &request).expect("build blocked plan");

        assert!(!blocked.status.success);
        assert!(
            blocked
                .risks
                .iter()
                .any(|risk| risk.code == "buildSideDisabled.IS_BUILD_MOBILE")
        );
        assert!(
            blocked
                .observed
                .changed_paths
                .iter()
                .any(|path| path == "mobile/src/mid-page.ts")
        );

        let mut enabled_request = request;
        enabled_request
            .extra_params
            .insert("IS_BUILD_MOBILE".to_string(), "是".to_string());
        let enabled = build_plan(&config, &enabled_request).expect("build enabled plan");
        assert!(enabled.status.success);
        assert!(
            enabled
                .risks
                .iter()
                .all(|risk| risk.code != "buildSideDisabled.IS_BUILD_MOBILE")
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn build_plan_reports_structured_values_overridden_by_explicit_params() {
        let (root, repo) = branch_catalog_test_repo(None);
        let config = build_plan_test_config(&repo, true);
        let plan = build_plan(
            &config,
            &DeployRequest {
                project: "demo".to_string(),
                target: Some("vke".to_string()),
                env: Some("dc2".to_string()),
                branch: Some("main".to_string()),
                extra_params: BTreeMap::from([
                    ("ENV_PROFILE".to_string(), "uat".to_string()),
                    ("BRANCH".to_string(), "other".to_string()),
                ]),
                ..DeployRequest::default()
            },
        )
        .expect("build conflicting plan");

        assert!(!plan.status.success);
        assert_eq!(plan.ignored_inputs.len(), 2);
        assert_eq!(plan.effective.env.as_deref(), Some("uat"));
        assert_eq!(plan.effective.branch.as_deref(), Some("other"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn duplicate_set_parameters_are_rejected_instead_of_last_write_wins() {
        let error = parse_extra_params_args(vec![
            "IS_BUILD_MOBILE=否".to_string(),
            "IS_BUILD_MOBILE=是".to_string(),
        ])
        .expect_err("duplicate --set must fail");
        assert!(error.to_string().contains("duplicate --set parameter"));
    }

    #[test]
    fn branch_catalog_prefers_a_fresh_local_repository() {
        let (root, repo) = branch_catalog_test_repo(None);
        let config = branch_catalog_test_config(&repo, "https://invalid.example/demo.git");

        let response = branch_catalog(&config, "demo").expect("load branch catalog");

        assert!(response.status.success);
        assert_eq!(response.status.key, "ready");
        assert_eq!(response.observed.source, "localRepository");
        assert_eq!(response.observed.freshness, "fresh");
        assert_eq!(response.branches[0].name, "main");
        assert!(response.risks.is_empty());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn branch_catalog_uses_cached_refs_when_fetch_fails() {
        let missing_remote =
            std::env::temp_dir().join(format!("rdevtool-missing-remote-{}", std::process::id()));
        let (root, repo) = branch_catalog_test_repo(Some(&missing_remote));
        let config = branch_catalog_test_config(&repo, "https://invalid.example/demo.git");

        let response = branch_catalog(&config, "demo").expect("load degraded branch catalog");

        assert!(response.status.success);
        assert_eq!(response.status.key, "degraded");
        assert_eq!(response.observed.source, "localRepository");
        assert_eq!(response.observed.freshness, "cached");
        assert_eq!(response.branches[0].name, "main");
        assert!(
            response
                .risks
                .iter()
                .any(|risk| risk.code == "localFetchFailed")
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn branch_sync_plan_checks_multiple_projects_without_merging() {
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "rdevtool-branch-plan-{}-{suffix}",
            std::process::id()
        ));
        let remote = root.join("remote.git");
        let repo = root.join("repo");
        std::fs::create_dir_all(&remote).expect("create remote");
        std::fs::create_dir_all(&repo).expect("create repo");
        run_test_git(&remote, &["init", "--bare"]);
        run_test_git(&repo, &["init"]);
        run_test_git(
            &repo,
            &["config", "user.email", "rdevtool-test@example.com"],
        );
        run_test_git(&repo, &["config", "user.name", "rDevTool Test"]);
        std::fs::write(repo.join("README.md"), "main\n").expect("write main file");
        run_test_git(&repo, &["add", "README.md"]);
        run_test_git(&repo, &["commit", "-m", "main"]);
        run_test_git(&repo, &["branch", "-M", "main"]);
        run_test_git(
            &repo,
            &["remote", "add", "origin", remote.to_string_lossy().as_ref()],
        );
        run_test_git(&repo, &["push", "-u", "origin", "main"]);
        run_test_git(&repo, &["checkout", "-b", "feature/shared"]);
        std::fs::write(repo.join("README.md"), "feature\n").expect("write feature file");
        run_test_git(&repo, &["add", "README.md"]);
        run_test_git(&repo, &["commit", "-m", "feature"]);
        run_test_git(&repo, &["push", "-u", "origin", "feature/shared"]);
        let main_before = run_test_git(&repo, &["rev-parse", "refs/remotes/origin/main"]);

        let config_text = format!(
            r#"
[defaults]

[[projects]]
key = "alpha"
name = "Alpha"
repo_path = "{}"
git_url = "{}"

[[projects]]
key = "beta"
name = "Beta"
repo_path = "{}"
git_url = "{}"
"#,
            repo.display(),
            remote.display(),
            repo.display(),
            remote.display(),
        );
        let config: AppConfig = toml::from_str(&config_text).expect("parse app config");
        let plan = plan_branch_sync(
            &config,
            &BranchSyncRequest {
                project: String::new(),
                projects: vec!["alpha".to_string(), "beta".to_string()],
                source_branch: "feature/shared".to_string(),
                target_branches: vec!["main".to_string()],
            },
        )
        .expect("plan batch merge");
        let main_after = run_test_git(&repo, &["rev-parse", "refs/remotes/origin/main"]);

        assert!(plan.success);
        assert_eq!(plan.items.len(), 2);
        assert!(plan.items.iter().all(|item| item.status_key == "ready"));
        assert_eq!(main_before, main_after);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn branch_sync_request_accepts_legacy_and_batch_projects() {
        let legacy: BranchSyncRequest = serde_json::from_value(serde_json::json!({
            "project": "legacy",
            "sourceBranch": "feature/demo",
            "targetBranches": ["main"]
        }))
        .expect("legacy request should remain compatible");
        assert_eq!(legacy.project, "legacy");
        assert!(legacy.projects.is_empty());

        let batch: BranchSyncRequest = serde_json::from_value(serde_json::json!({
            "projects": ["alpha", "beta"],
            "sourceBranch": "feature/demo",
            "targetBranches": ["main"]
        }))
        .expect("batch request should be accepted");
        assert!(batch.project.is_empty());
        assert_eq!(batch.projects, vec!["alpha", "beta"]);
    }

    #[test]
    fn branch_presence_failure_identifies_missing_side() {
        assert!(branch_presence_failure(true, true, "source", "target").is_none());
        assert_eq!(
            branch_presence_failure(false, true, "source", "target")
                .expect("source should be missing")
                .0,
            "source_missing"
        );
        assert_eq!(
            branch_presence_failure(true, false, "source", "target")
                .expect("target should be missing")
                .0,
            "target_missing"
        );
        assert_eq!(
            branch_presence_failure(false, false, "source", "target")
                .expect("both branches should be missing")
                .0,
            "branches_missing"
        );
    }

    #[test]
    fn checkout_falls_back_only_when_worktree_capability_is_missing() {
        let fallback = finish_checkout_with_clone_fallback(
            Err(anyhow::anyhow!("git: 'worktree' is not a git command")),
            || {
                Ok(git::BranchCheckoutResult {
                    output_path: PathBuf::from("/tmp/clone-copy"),
                    checkout_mode: git::BranchCheckoutMode::Clone,
                    fallback_reason: None,
                    detail: "clone complete".to_string(),
                })
            },
        )
        .expect("fallback clone result");

        assert!(matches!(
            fallback.checkout_mode,
            git::BranchCheckoutMode::Clone
        ));
        assert_eq!(
            fallback.fallback_reason.as_deref(),
            Some("git: 'worktree' is not a git command")
        );
        assert!(fallback.detail.contains("额外占用磁盘和网络"));

        let clone_called = std::cell::Cell::new(false);
        let error = finish_checkout_with_clone_fallback(
            Err(anyhow::anyhow!("git fetch failed: authentication required")),
            || {
                clone_called.set(true);
                unreachable!("regular worktree errors must not trigger clone")
            },
        )
        .expect_err("regular worktree error");

        assert!(!clone_called.get());
        assert!(error.to_string().contains("未自动回退 clone"));
    }

    #[test]
    fn branch_task_response_preserves_failure_reason() {
        let response = branch_task_response(
            "sync",
            vec![BranchTaskItemResult {
                project_key: "notification".to_string(),
                project_name: "消息中心".to_string(),
                source_branch: "release-20260716".to_string(),
                target_branch: Some("master".to_string()),
                output_path: None,
                checkout_mode: None,
                fallback_reason: None,
                success: false,
                status_key: "merge_failed".to_string(),
                status_label: "失败".to_string(),
                summary: "合并失败".to_string(),
                detail: "HTTP 401 Unauthorized".to_string(),
                remote: false,
                commit: None,
            }],
        );

        assert!(!response.success);
        assert!(
            response
                .detail
                .contains("消息中心: release-20260716 -> master [失败]")
        );
        assert!(response.detail.contains("原因：合并失败"));
        assert!(response.detail.contains("HTTP 401 Unauthorized"));
    }
}
