use std::path::Path;

use anyhow::Result;
use serde::Serialize;

use crate::config::{AppConfig, ProjectWorkspaceConfig, apply_project_workspace_filter};
use crate::core::{
    DeployTargetMeta, ProjectDetail, ProjectSummary, branch_hint, deploy_target_meta,
    project_detail, project_summaries,
};
use crate::navigation::{
    NavigationIndexEntry, search_navigation_entries, search_navigation_entries_for_workspace,
};
use crate::replay::{ReplayAction, replay_actions_from_history};
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
    pub workspace: Option<AgentWorkspaceContext>,
    pub projects: Vec<ProjectSummary>,
    pub project: Option<AgentProjectContext>,
    pub notes: Vec<NoteSummary>,
    pub build_history: Vec<DeployHistoryEntry>,
    pub deploy_history: Vec<DeployHistoryEntry>,
    pub merge_history: Vec<MergeHistoryEntry>,
    pub replay_actions: Vec<ReplayAction>,
    pub navigation: Vec<NavigationIndexEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentWorkspaceContext {
    pub key: String,
    pub name: String,
    pub description: Option<String>,
    pub system: bool,
    pub include_all_projects: bool,
    pub include_all_navigation: bool,
    pub project_count: usize,
    pub navigation_categories: Vec<String>,
    pub navigation_entries: Vec<String>,
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
            "build-plan".to_string(),
            "build-run".to_string(),
            "build-history".to_string(),
            "deploy-compat".to_string(),
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
            "config-source-management".to_string(),
            "config-source-compare".to_string(),
            "config-source-copy".to_string(),
            "proxy-read".to_string(),
            "proxy-config-source".to_string(),
            "proxy-profile-crud".to_string(),
            "proxy-rule-crud".to_string(),
            "proxy-daemon-lifecycle".to_string(),
            "proxy-diagnose".to_string(),
            "proxy-verify".to_string(),
            "proxy-runtime-bind".to_string(),
            "runtime-cli".to_string(),
            "runtime-preflight".to_string(),
            "runtime-start".to_string(),
            "runtime-daemon-lifecycle".to_string(),
            "runtime-diagnose".to_string(),
            "runtime-focus".to_string(),
            "runtime-log".to_string(),
            "web-actions-cli".to_string(),
            "workspace-context".to_string(),
            "workspace-scope-cli".to_string(),
            "workspace-init-demand".to_string(),
            "workspace-filtered-history".to_string(),
            "navigation-crud".to_string(),
            "doctor".to_string(),
            "project-domain-cli".to_string(),
            "project-config-crud".to_string(),
            "build-domain-cli".to_string(),
            "history-replay".to_string(),
            "agent-replay-context".to_string(),
            "build-adapter-jenkins".to_string(),
            "deploy-domain-compat".to_string(),
            "app-preferences-cli".to_string(),
            "shared-sqlite".to_string(),
            "cli-json-envelope".to_string(),
        ],
        commands: vec![
            "capabilities".to_string(),
            "context".to_string(),
            "app preferences|set-preferences".to_string(),
            "workspace list|show|create|init-demand|use|scope".to_string(),
            "projects list|show|add|update|delete|set-command|build-target-add|build-target-update|build-target-delete|build-param-add|build-param-update|build-param-delete|branch|branches|envs|options".to_string(),
            "build targets|plan|run|trigger|status|history".to_string(),
            "deploy targets|plan|trigger|status|history".to_string(),
            "git current|branches|overview|merge|merge-many|create|clone|switch|push-status|push|history"
                .to_string(),
            "doctor".to_string(),
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
            "history build|deploy|merge|replay-plan|replay-run".to_string(),
            "navigation path|list|search|open|add|update|delete".to_string(),
            "config-source list|show|compare|copy|use".to_string(),
            "proxy path|source|list|start|stop|restart|status|show|add|update|delete|export|import|rule-list|rule-show|rule-add|rule-update|rule-delete|diagnose|verify|bind-runtime".to_string(),
            "runtime profiles|profile-show|inspect|preflight|start|status|list|stop|restart|adopt|diagnose|focus|log".to_string(),
            "web-actions path|list|targets|open|run|script".to_string(),
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
    context_for_workspace(config, storage, None, project_key, query, limit)
}

pub fn context_for_workspace(
    config: &AppConfig,
    storage: &Storage,
    workspace: Option<&ProjectWorkspaceConfig>,
    project_key: Option<&str>,
    query: Option<&str>,
    limit: usize,
) -> Result<AgentContext> {
    let effective_config = workspace
        .map(|workspace| apply_project_workspace_filter(config, workspace))
        .unwrap_or_else(|| config.clone());
    let project = project_key
        .map(|key| build_project_context(&effective_config, key))
        .transpose()?;
    let normalized_limit = normalize_limit(limit, 6);
    let filter_project_key = project_key.map(str::trim).filter(|value| !value.is_empty());
    let build_history =
        filtered_deploy_history(storage, filter_project_key, workspace, normalized_limit)?;
    let merge_history =
        filtered_merge_history(storage, filter_project_key, workspace, normalized_limit)?;
    let replay_actions =
        replay_actions_from_history(&build_history, &merge_history, normalized_limit);

    Ok(AgentContext {
        app: capabilities(),
        workspace: workspace.map(|workspace| workspace_context(workspace, config)),
        projects: project_summaries(&effective_config),
        project,
        notes: storage
            .search_notes(query, normalized_limit)
            .map_err(anyhow::Error::msg)?,
        build_history: build_history.clone(),
        deploy_history: build_history,
        merge_history,
        replay_actions,
        navigation: match workspace {
            Some(workspace) => {
                search_navigation_entries_for_workspace(workspace, query, normalized_limit)?
            }
            None => search_navigation_entries(query, normalized_limit)?,
        },
    })
}

fn workspace_context(
    workspace: &ProjectWorkspaceConfig,
    config: &AppConfig,
) -> AgentWorkspaceContext {
    AgentWorkspaceContext {
        key: workspace.key.clone(),
        name: workspace.name.clone(),
        description: workspace.description.clone(),
        system: workspace.is_system(),
        include_all_projects: workspace.include_all_projects,
        include_all_navigation: workspace.include_all_navigation,
        project_count: workspace.project_count_for(config),
        navigation_categories: workspace.navigation_categories.clone(),
        navigation_entries: workspace.navigation_entries.clone(),
    }
}

fn filtered_deploy_history(
    storage: &Storage,
    project_key: Option<&str>,
    workspace: Option<&ProjectWorkspaceConfig>,
    limit: usize,
) -> Result<Vec<DeployHistoryEntry>> {
    if let Some(workspace) = workspace.filter(|workspace| !workspace.is_system()) {
        if project_key.is_some_and(|project_key| !workspace.allows_project(project_key)) {
            return Ok(Vec::new());
        }
        return Ok(storage
            .list_all_deploy_history()
            .map_err(anyhow::Error::msg)?
            .into_iter()
            .filter(|entry| entry.workspace_key.as_deref() == Some(workspace.key.as_str()))
            .filter(|entry| project_key.is_none_or(|key| entry.project_key == key))
            .take(limit)
            .collect());
    }
    storage
        .list_deploy_history_filtered(project_key, limit)
        .map_err(anyhow::Error::msg)
}

fn filtered_merge_history(
    storage: &Storage,
    project_key: Option<&str>,
    workspace: Option<&ProjectWorkspaceConfig>,
    limit: usize,
) -> Result<Vec<MergeHistoryEntry>> {
    if let Some(workspace) = workspace.filter(|workspace| !workspace.is_system()) {
        if project_key.is_some_and(|project_key| !workspace.allows_project(project_key)) {
            return Ok(Vec::new());
        }
        return Ok(storage
            .list_all_merge_history()
            .map_err(anyhow::Error::msg)?
            .into_iter()
            .filter(|entry| entry.workspace_key.as_deref() == Some(workspace.key.as_str()))
            .filter(|entry| project_key.is_none_or(|key| entry.project_key == key))
            .take(limit)
            .collect());
    }
    storage
        .list_merge_history_filtered(project_key, limit)
        .map_err(anyhow::Error::msg)
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
