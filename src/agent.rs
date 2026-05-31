use std::path::Path;

use anyhow::Result;
use serde::Serialize;

use crate::config::AppConfig;
use crate::core::{
    DeployTargetMeta, ProjectDetail, ProjectSummary, branch_hint, deploy_target_meta,
    project_detail, project_summaries,
};
use crate::navigation::{NavigationIndexEntry, search_navigation_entries};
use crate::storage::{
    DeployHistoryEntry, MergeHistoryEntry, NoteSummary, Storage, default_storage_path,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCapabilities {
    pub app_name: String,
    pub app_version: String,
    pub storage_path: String,
    pub features: Vec<String>,
    pub commands: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentContext {
    pub app: AgentCapabilities,
    pub projects: Vec<ProjectSummary>,
    pub project: Option<AgentProjectContext>,
    pub notes: Vec<NoteSummary>,
    pub deploy_history: Vec<DeployHistoryEntry>,
    pub merge_history: Vec<MergeHistoryEntry>,
    pub navigation: Vec<NavigationIndexEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProjectContext {
    pub detail: ProjectDetail,
    pub suggested_branch: Option<String>,
    pub deploy_targets: Vec<DeployTargetMeta>,
}

pub fn capabilities() -> AgentCapabilities {
    AgentCapabilities {
        app_name: "rDevTool".to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        storage_path: path_to_string(&default_storage_path()),
        features: vec![
            "deploy-plan".to_string(),
            "deploy-trigger".to_string(),
            "deploy-history".to_string(),
            "merge-overview".to_string(),
            "merge-execute".to_string(),
            "branch-sync".to_string(),
            "branch-create".to_string(),
            "branch-checkout".to_string(),
            "branch-switch".to_string(),
            "branch-push-status".to_string(),
            "branch-push".to_string(),
            "git-domain-cli".to_string(),
            "merge-history".to_string(),
            "notes".to_string(),
            "navigation".to_string(),
            "navigation-open".to_string(),
            "project-domain-cli".to_string(),
            "deploy-domain-cli".to_string(),
            "app-preferences-cli".to_string(),
            "shared-sqlite".to_string(),
            "cli-json-envelope".to_string(),
        ],
        commands: vec![
            "capabilities".to_string(),
            "context".to_string(),
            "app preferences|set-preferences".to_string(),
            "projects list|show|branch|branches|envs|options".to_string(),
            "deploy targets|plan|trigger|status|history".to_string(),
            "git current|branches|overview|merge|merge-many|create|clone|switch|push-status|push|history"
                .to_string(),
            "list".to_string(),
            "info".to_string(),
            "show".to_string(),
            "branches".to_string(),
            "envs".to_string(),
            "options".to_string(),
            "plan".to_string(),
            "trigger".to_string(),
            "status".to_string(),
            "merge-overview".to_string(),
            "merge".to_string(),
            "sync-branches".to_string(),
            "create-branch".to_string(),
            "checkout-branch".to_string(),
            "switch-branch".to_string(),
            "push-status".to_string(),
            "push-branch".to_string(),
            "notes list|get|create|save|delete|search".to_string(),
            "history deploy|merge".to_string(),
            "navigation path|list|search|open".to_string(),
            "agent capabilities|context".to_string(),
        ],
    }
}

pub fn context(
    config: &AppConfig,
    storage: &Storage,
    project_key: Option<&str>,
    query: Option<&str>,
    limit: usize,
) -> Result<AgentContext> {
    let project = project_key
        .map(|key| build_project_context(config, key))
        .transpose()?;
    let normalized_limit = normalize_limit(limit, 6);
    let filter_project_key = project_key.map(str::trim).filter(|value| !value.is_empty());

    Ok(AgentContext {
        app: capabilities(),
        projects: project_summaries(config),
        project,
        notes: storage
            .search_notes(query, normalized_limit)
            .map_err(anyhow::Error::msg)?,
        deploy_history: storage
            .list_deploy_history_filtered(filter_project_key, normalized_limit)
            .map_err(anyhow::Error::msg)?,
        merge_history: storage
            .list_merge_history_filtered(filter_project_key, normalized_limit)
            .map_err(anyhow::Error::msg)?,
        navigation: search_navigation_entries(query, normalized_limit)?,
    })
}

fn build_project_context(config: &AppConfig, key: &str) -> Result<AgentProjectContext> {
    let detail = project_detail(config, key)?;
    let deploy_targets = detail
        .deploy_targets
        .iter()
        .filter_map(|target| deploy_target_meta(config, key, Some(&target.key)).ok())
        .collect();

    Ok(AgentProjectContext {
        detail,
        suggested_branch: branch_hint(config, key).ok(),
        deploy_targets,
    })
}

fn normalize_limit(limit: usize, default_limit: usize) -> usize {
    if limit == 0 {
        default_limit
    } else {
        limit.min(20)
    }
}

fn path_to_string(path: &Path) -> String {
    path.display().to_string()
}
