use std::collections::BTreeSet;
use std::path::Path;

use anyhow::Result;
use serde::Serialize;

use crate::artifacts::{
    ManagedArtifactContextSummary, ManagedArtifactQuery, managed_artifact_context_summary,
};
use crate::config::{
    AppConfig, ConfigPaths, ProjectWorkspaceConfig, apply_project_workspace_context,
};
use crate::core::{
    DeployTargetMeta, ProjectDetail, ProjectSummary, branch_hint, deploy_target_meta,
    project_detail, project_summaries,
};
use crate::navigation::{
    NavigationIndexEntry, search_navigation_entries, search_navigation_entries_for_workspace,
};
use crate::project_notes::{NoteDocumentSummary, search_note_documents};
use crate::replay::{ReplayAction, replay_actions_from_history};
use crate::runtime::{
    ProjectRuntimeContextSnapshot, ProjectRuntimeLaunchOptions, project_runtime_context_snapshot,
};
use crate::storage::{
    DeployHistoryEntry, MergeHistoryEntry, NoteSummary, Storage, default_storage_path,
};
use crate::workspace_resources::{
    WorkspaceWorklogContent, read_workspace_worklog_for_workspace, workspace_resource_status,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCapabilities {
    pub schema_version: u16,
    pub app_name: String,
    pub app_version: String,
    pub build_commit: Option<String>,
    pub storage_path: String,
    pub features: Vec<String>,
    pub commands: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub command_specs: Vec<AgentCommandCapability>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCommandCapability {
    pub path: String,
    pub risk: String,
    pub supports_json: bool,
    pub supports_follow: bool,
    pub requires_confirmation: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deprecated_by: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentContext {
    pub schema_version: u16,
    pub preset: Option<String>,
    pub compact: bool,
    pub included_sections: Vec<String>,
    pub app: AgentCapabilities,
    pub workspace: Option<AgentWorkspaceContext>,
    pub projects: Vec<ProjectSummary>,
    pub project: Option<AgentProjectContext>,
    pub notes: Vec<NoteSummary>,
    pub file_notes: Vec<NoteDocumentSummary>,
    pub build_history: Vec<DeployHistoryEntry>,
    pub deploy_history: Vec<DeployHistoryEntry>,
    pub merge_history: Vec<MergeHistoryEntry>,
    pub replay_actions: Vec<ReplayAction>,
    pub navigation: Vec<NavigationIndexEntry>,
    pub proxy: Option<AgentProxyContext>,
    pub runtime: Option<AgentRuntimeContext>,
    pub artifacts: Option<ManagedArtifactContextSummary>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentContextPreset {
    Workspace,
    Git,
    Runtime,
    Build,
    WebActions,
    Artifacts,
}

impl AgentContextPreset {
    pub fn key(self) -> &'static str {
        match self {
            Self::Workspace => "workspace",
            Self::Git => "git",
            Self::Runtime => "runtime",
            Self::Build => "build",
            Self::WebActions => "web-actions",
            Self::Artifacts => "artifacts",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum AgentContextSection {
    History,
    Notes,
    Navigation,
    Proxy,
    Projects,
    Worklog,
    Artifacts,
}

impl AgentContextSection {
    pub fn key(self) -> &'static str {
        match self {
            Self::History => "history",
            Self::Notes => "notes",
            Self::Navigation => "navigation",
            Self::Proxy => "proxy",
            Self::Projects => "projects",
            Self::Worklog => "worklog",
            Self::Artifacts => "artifacts",
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct AgentContextOptions {
    pub preset: Option<AgentContextPreset>,
    pub compact: bool,
    pub includes: BTreeSet<AgentContextSection>,
    pub debug_profile: Option<String>,
    pub runtime_profile: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeContext {
    pub selection: String,
    pub requested_debug_profile_key: Option<String>,
    pub requested_runtime_profile_key: Option<String>,
    pub targets: Vec<ProjectRuntimeContextSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProxyContext {
    pub source: String,
    pub observed: bool,
    pub debug_profiles: Vec<AgentProxyDebugProfileContext>,
    pub runtime_profiles: Vec<AgentProxyRuntimeProfileContext>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProxyDebugProfileContext {
    pub key: String,
    pub runtime_profile: Option<String>,
    pub network_proxy_enabled: bool,
    pub proxy_configured: bool,
    pub node_hook: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProxyRuntimeProfileContext {
    pub key: String,
    pub proxy_profile_id: Option<String>,
    pub proxy_configured: bool,
    pub web_actions_enabled: bool,
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
    pub root_dir: Option<String>,
    pub resource_dir: Option<String>,
    pub worklog_path: Option<String>,
    pub worklog_auto_record: bool,
    pub worklog: Option<WorkspaceWorklogContent>,
    pub project_instances: Vec<AgentWorkspaceProjectInstanceContext>,
    pub navigation_categories: Vec<String>,
    pub navigation_entries: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentWorkspaceProjectInstanceContext {
    pub project_key: String,
    pub configured_repo_path: Option<String>,
    pub effective_repo_path: Option<String>,
    pub path_source: String,
    pub managed: bool,
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
        schema_version: 2,
        app_name: "rDevTool".to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        build_commit: option_env!("RDEVTOOL_BUILD_COMMIT").map(str::to_string),
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
            "link-plan".to_string(),
            "link-check".to_string(),
            "link-run".to_string(),
            "link-stop".to_string(),
            "link-workspace-attach".to_string(),
            "config-source-management".to_string(),
            "config-source-compare".to_string(),
            "config-source-copy".to_string(),
            "config-pack-export".to_string(),
            "config-pack-import-plan".to_string(),
            "config-pack-transaction-rollback".to_string(),
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
            "runtime-current-session-log".to_string(),
            "runtime-http-wait".to_string(),
            "runtime-context-snapshot".to_string(),
            "managed-artifact-inventory".to_string(),
            "managed-artifact-cleanup-plan".to_string(),
            "agent-context-artifacts".to_string(),
            "web-actions-cli".to_string(),
            "workspace-context".to_string(),
            "workspace-scope-cli".to_string(),
            "workspace-init-demand".to_string(),
            "workspace-review".to_string(),
            "workspace-resources".to_string(),
            "workspace-worklog".to_string(),
            "workspace-worklog-auto-record".to_string(),
            "workspace-filtered-history".to_string(),
            "workspace-workflow-chain".to_string(),
            "navigation-crud".to_string(),
            "doctor".to_string(),
            "project-domain-cli".to_string(),
            "project-config-crud".to_string(),
            "build-domain-cli".to_string(),
            "history-replay".to_string(),
            "operation-event-history".to_string(),
            "operation-safe-retry".to_string(),
            "agent-replay-context".to_string(),
            "agent-context-presets".to_string(),
            "build-adapter-jenkins".to_string(),
            "deploy-domain-compat".to_string(),
            "app-preferences-cli".to_string(),
            "shared-sqlite".to_string(),
            "project-notes".to_string(),
            "project-notes-search".to_string(),
            "resource-actions".to_string(),
            "resource-action-plan-apply".to_string(),
            "agent-skill-compatibility".to_string(),
            "structured-command-capabilities".to_string(),
            "cli-json-envelope".to_string(),
        ],
        commands: vec![
            "capabilities".to_string(),
            "context".to_string(),
            "app preferences|set-preferences".to_string(),
            "workspace list|show|review|create|init-demand|resources-init|worklog-append|worklog-show|worklog-auto|use|archive|restore|scope".to_string(),
            "projects list|show|add|update|delete|set-command|build-target-add|build-target-update|build-target-delete|build-param-add|build-param-update|build-param-delete|branch|branches|envs|options".to_string(),
            "build targets|plan|run|trigger|status|history".to_string(),
            "deploy targets|plan|trigger|status|history".to_string(),
            "git current|branches|overview|merge|merge-many|create|clone|switch|push-status|diff|push|history"
                .to_string(),
            "workflow promote plan|run|status".to_string(),
            "workflow chain list|show|plan|run".to_string(),
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
            "notes path|init|project-path|project-init|index|file-search|list|get|create|save|delete|search"
                .to_string(),
            "history operations|build|deploy|merge|replay-plan|replay-run".to_string(),
            "navigation path|list|search|open|add|update|delete".to_string(),
            "link path|list|inspect|show|plan|check|run|stop|save|delete|migrate|attach"
                .to_string(),
            "config-source list|show|compare|copy|use".to_string(),
            "pack inventory|export|inspect|import-plan|import-run|rollback".to_string(),
            "action path|list|show|validate|plan|plan-show|apply|run".to_string(),
            "proxy path|source|list|start|stop|restart|status|show|add|update|delete|export|import|rule-list|rule-show|rule-add|rule-update|rule-delete|diagnose|verify|bind-runtime".to_string(),
            "runtime profiles|profile-show|inspect|preflight|start|status|list|stop|restart|adopt|diagnose|focus|wait|log".to_string(),
            "artifacts list|cleanup-plan".to_string(),
            "web-actions path|list|targets|open|run|script".to_string(),
            "agent capabilities|compatibility|context".to_string(),
        ],
        command_specs: Vec::new(),
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
    context_for_workspace_with_options(
        config,
        storage,
        workspace,
        project_key,
        query,
        limit,
        &AgentContextOptions::default(),
    )
}

pub fn context_for_workspace_with_options(
    config: &AppConfig,
    storage: &Storage,
    workspace: Option<&ProjectWorkspaceConfig>,
    project_key: Option<&str>,
    query: Option<&str>,
    limit: usize,
    options: &AgentContextOptions,
) -> Result<AgentContext> {
    context_for_workspace_with_options_and_optional_paths(
        config,
        storage,
        workspace,
        project_key,
        query,
        limit,
        options,
        None,
    )
}

pub fn context_for_workspace_with_options_and_paths(
    config: &AppConfig,
    storage: &Storage,
    workspace: Option<&ProjectWorkspaceConfig>,
    project_key: Option<&str>,
    query: Option<&str>,
    limit: usize,
    options: &AgentContextOptions,
    paths: &ConfigPaths,
) -> Result<AgentContext> {
    context_for_workspace_with_options_and_optional_paths(
        config,
        storage,
        workspace,
        project_key,
        query,
        limit,
        options,
        Some(paths),
    )
}

fn context_for_workspace_with_options_and_optional_paths(
    config: &AppConfig,
    storage: &Storage,
    workspace: Option<&ProjectWorkspaceConfig>,
    project_key: Option<&str>,
    query: Option<&str>,
    limit: usize,
    options: &AgentContextOptions,
    paths: Option<&ConfigPaths>,
) -> Result<AgentContext> {
    let effective_config = workspace
        .map(|workspace| apply_project_workspace_context(config, workspace))
        .unwrap_or_else(|| config.clone());
    let mut project = project_key
        .map(|key| build_project_context(&effective_config, key))
        .transpose()?;
    if options.compact
        && options.preset != Some(AgentContextPreset::Build)
        && let Some(project) = project.as_mut()
    {
        project.detail.deploy_targets.clear();
        project.detail.standard_job_name.clear();
        project.detail.variant_job_name = None;
        project.deploy_targets.clear();
    }
    let filter_project_key = project_key.map(str::trim).filter(|value| !value.is_empty());
    let omit_project_details = options.compact
        && options.preset == Some(AgentContextPreset::Artifacts)
        && !options.includes.contains(&AgentContextSection::Projects);
    if omit_project_details {
        project = None;
    }
    let normalized_limit = normalize_limit(limit, 6);
    let legacy_full = options.preset.is_none() && !options.compact && options.includes.is_empty();
    let include_history = legacy_full || options.includes.contains(&AgentContextSection::History);
    let include_notes = legacy_full || options.includes.contains(&AgentContextSection::Notes);
    let include_navigation = legacy_full
        || options.includes.contains(&AgentContextSection::Navigation)
        || options.preset == Some(AgentContextPreset::Workspace);
    let include_proxy = options.includes.contains(&AgentContextSection::Proxy);
    let include_projects = legacy_full
        || options.includes.contains(&AgentContextSection::Projects)
        || options.preset == Some(AgentContextPreset::Workspace)
        || filter_project_key.is_none();
    let include_worklog = legacy_full || options.includes.contains(&AgentContextSection::Worklog);
    let include_artifacts = options.preset == Some(AgentContextPreset::Artifacts)
        || options.includes.contains(&AgentContextSection::Artifacts);
    let include_runtime = matches!(
        options.preset,
        Some(AgentContextPreset::Runtime | AgentContextPreset::WebActions)
    );
    let build_history = if include_history && options.preset != Some(AgentContextPreset::Git) {
        filtered_deploy_history(storage, filter_project_key, workspace, normalized_limit)?
    } else {
        Vec::new()
    };
    let merge_history = if include_history && options.preset != Some(AgentContextPreset::Build) {
        filtered_merge_history(storage, filter_project_key, workspace, normalized_limit)?
    } else {
        Vec::new()
    };
    let replay_actions =
        replay_actions_from_history(&build_history, &merge_history, normalized_limit);
    let mut included_sections = vec!["workspace".to_string()];
    if !omit_project_details {
        included_sections.push("project".to_string());
    }
    if include_projects && !omit_project_details {
        included_sections.push("projects".to_string());
    }
    if include_history {
        included_sections.push("history".to_string());
    }
    if include_notes {
        included_sections.push("notes".to_string());
    }
    if include_navigation {
        included_sections.push("navigation".to_string());
    }
    if include_proxy {
        included_sections.push("proxy".to_string());
    }
    if include_worklog {
        included_sections.push("worklog".to_string());
    }
    let runtime = if include_runtime {
        filter_project_key
            .map(|project_key| build_runtime_context(&effective_config, project_key, options))
            .transpose()?
    } else {
        None
    };
    if runtime.is_some() {
        included_sections.push("runtime".to_string());
    }
    let artifacts = if include_artifacts {
        let paths = paths.ok_or_else(|| {
            anyhow::anyhow!("config paths are required for managed artifact context")
        })?;
        Some(managed_artifact_context_summary(
            config,
            paths,
            &ManagedArtifactQuery {
                workspace: workspace.map(|workspace| workspace.key.clone()),
                all_workspaces: false,
                project: filter_project_key.map(ToString::to_string),
                kinds: Vec::new(),
            },
        )?)
    } else {
        None
    };
    if artifacts.is_some() {
        included_sections.push("artifacts".to_string());
    }

    Ok(AgentContext {
        schema_version: 2,
        preset: options.preset.map(|preset| preset.key().to_string()),
        compact: options.compact,
        included_sections,
        app: context_capabilities(options),
        workspace: workspace.map(|workspace| workspace_context(workspace, config, include_worklog)),
        projects: if omit_project_details {
            Vec::new()
        } else if include_projects {
            project_summaries(&effective_config)
                .into_iter()
                .map(|project| context_project_summary(project, options))
                .collect()
        } else {
            project_summaries(&effective_config)
                .into_iter()
                .filter(|project| filter_project_key == Some(project.key.as_str()))
                .map(|project| context_project_summary(project, options))
                .collect()
        },
        project,
        notes: if include_notes {
            storage
                .search_notes(query, normalized_limit)
                .map_err(anyhow::Error::msg)?
        } else {
            Vec::new()
        },
        file_notes: if include_notes {
            bounded_file_notes(filter_project_key, query, normalized_limit.min(4))?
        } else {
            Vec::new()
        },
        build_history: build_history.clone(),
        deploy_history: if legacy_full {
            build_history
        } else {
            Vec::new()
        },
        merge_history,
        replay_actions,
        navigation: if include_navigation {
            match workspace {
                Some(workspace) => {
                    search_navigation_entries_for_workspace(workspace, query, normalized_limit)?
                }
                None => search_navigation_entries(query, normalized_limit)?,
            }
        } else {
            Vec::new()
        },
        proxy: include_proxy.then(|| build_proxy_context(&effective_config, filter_project_key)),
        runtime,
        artifacts,
    })
}

fn bounded_file_notes(
    project_key: Option<&str>,
    query: Option<&str>,
    limit: usize,
) -> Result<Vec<NoteDocumentSummary>> {
    let candidate_limit = limit.saturating_mul(3).clamp(1, 24);
    Ok(search_note_documents(project_key, query, candidate_limit)?
        .documents
        .into_iter()
        .filter(|document| {
            document
                .relative_path
                .file_name()
                .is_none_or(|name| !name.to_string_lossy().eq_ignore_ascii_case("README.md"))
        })
        .take(limit)
        .collect())
}

fn build_runtime_context(
    config: &AppConfig,
    project_key: &str,
    options: &AgentContextOptions,
) -> Result<AgentRuntimeContext> {
    let project = config.find_project(project_key)?;
    let requested_debug_profile_key = options
        .debug_profile
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let requested_runtime_profile_key = options
        .runtime_profile
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let debug_profile_keys = if let Some(debug_profile_key) = requested_debug_profile_key.as_ref() {
        vec![Some(debug_profile_key.clone())]
    } else {
        std::iter::once(None)
            .chain(
                project
                    .debug_profiles
                    .iter()
                    .map(|profile| Some(profile.key.clone())),
            )
            .collect()
    };
    let targets = debug_profile_keys
        .into_iter()
        .map(|debug_profile| {
            project_runtime_context_snapshot(
                config,
                project_key,
                &ProjectRuntimeLaunchOptions {
                    debug_profile,
                    runtime_profile: requested_runtime_profile_key.clone(),
                    ..ProjectRuntimeLaunchOptions::default()
                },
            )
            .map_err(anyhow::Error::msg)
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(AgentRuntimeContext {
        selection: if requested_debug_profile_key.is_some() {
            "explicit".to_string()
        } else {
            "defaultAndDebugProfiles".to_string()
        },
        requested_debug_profile_key,
        requested_runtime_profile_key,
        targets,
    })
}

fn workspace_context(
    workspace: &ProjectWorkspaceConfig,
    config: &AppConfig,
    include_worklog: bool,
) -> AgentWorkspaceContext {
    let resources = workspace_resource_status(workspace);
    let worklog = include_worklog
        .then(|| {
            resources
                .as_ref()
                .and_then(|_| read_workspace_worklog_for_workspace(workspace, 80).ok())
        })
        .flatten();
    let effective_config = apply_project_workspace_context(config, workspace);
    let project_instances = effective_config
        .projects
        .iter()
        .map(|project| {
            let configured_repo_path = config
                .projects
                .iter()
                .find(|configured| configured.key == project.key)
                .and_then(|configured| configured.repo_path.as_ref())
                .map(|path| path.display().to_string());
            let instance = workspace
                .project_instances
                .iter()
                .find(|instance| instance.project == project.key);
            AgentWorkspaceProjectInstanceContext {
                project_key: project.key.clone(),
                configured_repo_path,
                effective_repo_path: project
                    .repo_path
                    .as_ref()
                    .map(|path| path.display().to_string()),
                path_source: if instance.is_some() {
                    "workspaceProjectInstance"
                } else {
                    "projectConfiguration"
                }
                .to_string(),
                managed: instance.is_some_and(|instance| instance.managed),
            }
        })
        .collect();
    AgentWorkspaceContext {
        key: workspace.key.clone(),
        name: workspace.name.clone(),
        description: workspace.description.clone(),
        system: workspace.is_system(),
        include_all_projects: workspace.include_all_projects,
        include_all_navigation: workspace.include_all_navigation,
        project_count: workspace.project_count_for(config),
        root_dir: workspace
            .root_dir
            .as_ref()
            .map(|path| path.display().to_string()),
        resource_dir: resources
            .as_ref()
            .map(|resources| resources.resource_dir.clone()),
        worklog_path: resources
            .as_ref()
            .map(|resources| resources.worklog_path.clone()),
        worklog_auto_record: workspace.worklog_auto_record,
        worklog,
        project_instances,
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

fn context_project_summary(
    mut project: ProjectSummary,
    options: &AgentContextOptions,
) -> ProjectSummary {
    if options.compact && options.preset != Some(AgentContextPreset::Build) {
        project.deploy_targets.clear();
        if options.preset != Some(AgentContextPreset::Git) {
            project.source_branch_keywords.clear();
            project.target_branch_keywords.clear();
        }
    }
    project
}

fn context_capabilities(options: &AgentContextOptions) -> AgentCapabilities {
    let mut value = capabilities();
    if options.preset.is_none() && !options.compact {
        return value;
    }
    let mut terms = vec!["agent", "workspace", "projects"];
    if let Some(preset) = options.preset {
        match preset {
            AgentContextPreset::Workspace => terms.extend(["navigation", "workspace"]),
            AgentContextPreset::Git => terms.extend(["git", "branch", "merge"]),
            AgentContextPreset::Runtime => terms.extend(["runtime", "debug"]),
            AgentContextPreset::Build => terms.extend(["build", "deploy"]),
            AgentContextPreset::WebActions => terms.extend(["web-actions", "runtime"]),
            AgentContextPreset::Artifacts => terms.push("artifact"),
        }
    }
    if options.includes.contains(&AgentContextSection::Proxy) {
        terms.push("proxy");
    }
    if options.includes.contains(&AgentContextSection::History) {
        terms.push("history");
        terms.push("replay");
    }
    if options.includes.contains(&AgentContextSection::Artifacts) {
        terms.push("artifact");
    }
    value.features.retain(|feature| {
        let feature = feature.to_ascii_lowercase();
        terms.iter().any(|term| feature.contains(term))
    });
    value.commands.retain(|command| {
        let command = command.to_ascii_lowercase();
        terms.iter().any(|term| command.contains(term))
    });
    value.command_specs.retain(|command| {
        let path = command.path.to_ascii_lowercase();
        terms.iter().any(|term| path.contains(term))
    });
    value
}

fn build_proxy_context(config: &AppConfig, project_key: Option<&str>) -> AgentProxyContext {
    let project = project_key.and_then(|key| config.projects.iter().find(|item| item.key == key));
    let debug_profiles = project
        .map(|project| {
            project
                .debug_profiles
                .iter()
                .map(|profile| AgentProxyDebugProfileContext {
                    key: profile.key.clone(),
                    runtime_profile: profile.runtime_profile.clone(),
                    network_proxy_enabled: profile.network_proxy.enabled,
                    proxy_configured: !profile.network_proxy.proxy_url.trim().is_empty(),
                    node_hook: profile.network_proxy.node_hook,
                })
                .collect()
        })
        .unwrap_or_default();
    let referenced_runtime_profiles = project
        .map(|project| {
            project
                .debug_profiles
                .iter()
                .filter_map(|profile| profile.runtime_profile.clone())
                .collect::<BTreeSet<_>>()
        })
        .unwrap_or_default();
    let runtime_profiles = config
        .defaults
        .runtime_profiles
        .iter()
        .filter(|profile| {
            referenced_runtime_profiles.is_empty()
                || referenced_runtime_profiles.contains(profile.key.as_str())
        })
        .map(|profile| AgentProxyRuntimeProfileContext {
            key: profile.key.clone(),
            proxy_profile_id: profile.rdev_proxy_profile_id.clone(),
            proxy_configured: !profile.proxy_url.trim().is_empty(),
            web_actions_enabled: profile.web_actions_enabled,
        })
        .collect();
    AgentProxyContext {
        source: "configurationBindings".to_string(),
        observed: false,
        debug_profiles,
        runtime_profiles,
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{
        ProjectWorkspaceProjectInstanceConfig, WorkspaceAppConfig, WorkspaceConfig,
        save_project_workspace_config, save_workspace_config,
    };
    use serde_json::json;
    use std::collections::BTreeMap;
    use uuid::Uuid;

    #[test]
    fn capabilities_publish_link_and_operation_surfaces() {
        let value = capabilities();

        assert!(value.features.iter().any(|feature| feature == "link-plan"));
        assert!(
            value
                .features
                .iter()
                .any(|feature| feature == "operation-safe-retry")
        );
        assert!(
            value
                .features
                .iter()
                .any(|feature| feature == "workspace-workflow-chain")
        );
        assert!(value.commands.iter().any(|command| {
            command.starts_with(
                "link path|list|inspect|show|plan|check|run|stop|save|delete|migrate|attach",
            )
        }));
        assert!(
            value
                .commands
                .iter()
                .any(|command| command == "workflow chain list|show|plan|run")
        );
        assert!(
            value
                .features
                .iter()
                .any(|feature| { feature == "agent-skill-compatibility" })
        );
        assert!(value.commands.iter().any(|command| {
            command == "action path|list|show|validate|plan|plan-show|apply|run"
        }));
    }

    #[test]
    fn workspace_context_uses_effective_project_instance_path() {
        let dir = std::env::temp_dir().join(format!(
            "rdevtool-agent-workspace-instance-{}",
            Uuid::new_v4()
        ));
        let configured_repo = dir.join("configured");
        let instance_repo = dir.join("workspace").join("sample");
        std::fs::create_dir_all(&configured_repo).expect("create configured repository path");
        std::fs::create_dir_all(&instance_repo).expect("create workspace instance path");
        let config: AppConfig = serde_json::from_value(json!({
            "defaults": {},
            "projects": [{
                "key": "sample",
                "name": "Sample",
                "git_url": "",
                "repo_path": configured_repo
            }]
        }))
        .expect("parse test config");
        let workspace = ProjectWorkspaceConfig {
            key: "feature-a".to_string(),
            name: "Feature A".to_string(),
            description: None,
            archive: None,
            workspace_type: "business".to_string(),
            metadata: BTreeMap::new(),
            root_dir: Some(dir.join("workspace")),
            resource_dir: None,
            worklog_file: None,
            worklog_auto_record: false,
            include_all_projects: false,
            include_all_navigation: false,
            projects: vec!["sample".to_string()],
            navigation_categories: Vec::new(),
            navigation_entries: Vec::new(),
            project_instances: vec![ProjectWorkspaceProjectInstanceConfig {
                project: "sample".to_string(),
                path: instance_repo.clone(),
                managed: false,
            }],
            resource_categories: Vec::new(),
        };
        let db_path = dir.join("agent.sqlite3");
        let storage = Storage::new(db_path).expect("create test storage");

        let value = context_for_workspace_with_options(
            &config,
            &storage,
            Some(&workspace),
            None,
            None,
            6,
            &AgentContextOptions {
                preset: Some(AgentContextPreset::Workspace),
                compact: true,
                ..AgentContextOptions::default()
            },
        )
        .expect("build workspace context");

        assert_eq!(value.projects.len(), 1);
        assert_eq!(
            value.projects[0].repo_path.as_deref(),
            Some(instance_repo.to_string_lossy().as_ref())
        );
        let workspace_context = value.workspace.expect("workspace context");
        assert_eq!(workspace_context.project_instances.len(), 1);
        assert_eq!(
            workspace_context.project_instances[0]
                .configured_repo_path
                .as_deref(),
            Some(configured_repo.to_string_lossy().as_ref())
        );
        assert_eq!(
            workspace_context.project_instances[0]
                .effective_repo_path
                .as_deref(),
            Some(instance_repo.to_string_lossy().as_ref())
        );
        assert_eq!(
            workspace_context.project_instances[0].path_source,
            "workspaceProjectInstance"
        );
        drop(storage);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn runtime_compact_context_omits_unrequested_collections() {
        let repo =
            std::env::temp_dir().join(format!("rdevtool-agent-runtime-context-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&repo).expect("create runtime project");
        let config: AppConfig = serde_json::from_value(json!({
            "defaults": {
                "runtime_profiles": [{
                    "key": "local",
                    "label": "Local",
                    "proxy_url": "http://127.0.0.1:8788"
                }]
            },
            "projects": [{
                "key": "sample",
                "name": "Sample",
                "git_url": "",
                "repo_path": repo,
                "dev": { "command": "npm run dev" },
                "focus": { "url": "http://127.0.0.1:3000/" },
                "debug_profiles": [{
                    "key": "local",
                    "label": "Local",
                    "runtime_profile": "local",
                    "focus_url": "http://127.0.0.1:4173/debug",
                    "ready_probe": { "path": "/health" },
                    "network_proxy": {
                        "enabled": true,
                        "proxy_url": "http://127.0.0.1:8788",
                        "node_hook": true
                    }
                }]
            }]
        }))
        .expect("parse test config");
        let db_path =
            std::env::temp_dir().join(format!("rdevtool-agent-context-{}.sqlite3", Uuid::new_v4()));
        let storage = Storage::new(db_path.clone()).expect("create test storage");
        let mut includes = BTreeSet::new();
        includes.insert(AgentContextSection::Proxy);
        let value = context_for_workspace_with_options(
            &config,
            &storage,
            None,
            Some("sample"),
            None,
            6,
            &AgentContextOptions {
                preset: Some(AgentContextPreset::Runtime),
                compact: true,
                includes,
                debug_profile: None,
                runtime_profile: None,
            },
        )
        .expect("build compact context");

        assert_eq!(value.preset.as_deref(), Some("runtime"));
        assert!(value.compact);
        assert!(value.notes.is_empty());
        assert!(value.build_history.is_empty());
        assert!(value.merge_history.is_empty());
        assert!(value.navigation.is_empty());
        assert_eq!(value.projects.len(), 1);
        assert!(value.projects[0].deploy_targets.is_empty());
        assert!(
            value
                .project
                .as_ref()
                .is_some_and(|project| project.deploy_targets.is_empty())
        );
        let proxy = value.proxy.expect("proxy configuration context");
        assert!(!proxy.observed);
        assert_eq!(proxy.debug_profiles.len(), 1);
        assert_eq!(proxy.runtime_profiles.len(), 1);
        assert!(
            value
                .app
                .commands
                .iter()
                .any(|command| command.contains("runtime"))
        );
        assert!(value.app.commands.len() < capabilities().commands.len());
        let runtime = value.runtime.expect("runtime context");
        assert_eq!(runtime.selection, "defaultAndDebugProfiles");
        assert_eq!(runtime.targets.len(), 2);
        let profile_target = runtime
            .targets
            .iter()
            .find(|target| target.effective.debug_profile_key.as_deref() == Some("local"))
            .and_then(|target| target.effective.target.as_ref())
            .expect("resolved debug profile target");
        assert_eq!(
            profile_target.focus_url.as_deref(),
            Some("http://127.0.0.1:4173/debug")
        );
        assert_eq!(
            profile_target
                .ready_probe
                .as_ref()
                .and_then(|probe| probe.path.as_deref()),
            Some("/health")
        );
        drop(storage);
        let _ = std::fs::remove_file(db_path);
        let _ = std::fs::remove_dir_all(repo);
    }

    #[test]
    fn artifacts_compact_context_contains_only_the_read_only_summary() {
        let dir = std::env::temp_dir().join(format!(
            "rdevtool-agent-artifacts-context-{}",
            Uuid::new_v4()
        ));
        let paths = ConfigPaths {
            dir: dir.clone(),
            projects: dir.join("projects.toml"),
            workspace: dir.join("workspace.toml"),
            project_workspaces: dir.join("workspaces"),
        };
        let root = dir.join("feature-a");
        let managed_path = root.join("sample");
        std::fs::create_dir_all(&managed_path).expect("create managed instance");
        std::fs::create_dir_all(&paths.project_workspaces).expect("create workspace config dir");
        let workspace = ProjectWorkspaceConfig {
            key: "feature-a".to_string(),
            name: "Feature A".to_string(),
            description: None,
            archive: None,
            workspace_type: "business".to_string(),
            metadata: BTreeMap::new(),
            root_dir: Some(root),
            resource_dir: None,
            worklog_file: None,
            worklog_auto_record: false,
            include_all_projects: false,
            include_all_navigation: false,
            projects: vec!["sample".to_string()],
            navigation_categories: Vec::new(),
            navigation_entries: Vec::new(),
            project_instances: vec![ProjectWorkspaceProjectInstanceConfig {
                project: "sample".to_string(),
                path: managed_path.clone(),
                managed: true,
            }],
            resource_categories: Vec::new(),
        };
        save_project_workspace_config(&paths.project_workspaces.join("feature-a.toml"), &workspace)
            .expect("save workspace");
        save_workspace_config(
            &paths.workspace,
            &WorkspaceConfig {
                app: WorkspaceAppConfig {
                    active_workspace: Some("feature-a".to_string()),
                    ..WorkspaceAppConfig::default()
                },
            },
        )
        .expect("save active workspace");
        let config: AppConfig = serde_json::from_value(json!({
            "defaults": {},
            "projects": [{
                "key": "sample",
                "name": "Sample",
                "git_url": "",
                "repo_path": managed_path
            }]
        }))
        .expect("parse test config");
        let db_path = dir.join("agent.sqlite3");
        let storage = Storage::new(db_path).expect("create test storage");

        let value = context_for_workspace_with_options_and_paths(
            &config,
            &storage,
            Some(&workspace),
            Some("sample"),
            None,
            6,
            &AgentContextOptions {
                preset: Some(AgentContextPreset::Artifacts),
                compact: true,
                ..AgentContextOptions::default()
            },
            &paths,
        )
        .expect("build artifact context");

        assert_eq!(value.preset.as_deref(), Some("artifacts"));
        assert!(value.included_sections.contains(&"artifacts".to_string()));
        assert!(!value.included_sections.contains(&"project".to_string()));
        assert!(!value.included_sections.contains(&"projects".to_string()));
        assert!(value.project.is_none());
        assert!(value.projects.is_empty());
        assert!(value.runtime.is_none());
        assert!(value.proxy.is_none());
        let artifacts = value.artifacts.expect("artifact summary");
        assert!(!artifacts.effective.execution_supported);
        assert_eq!(artifacts.observed.summary.managed_count, 1);
        assert_eq!(artifacts.recommended_actions.len(), 1);
        assert_eq!(artifacts.recommended_actions[0].risk, "readOnly");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
