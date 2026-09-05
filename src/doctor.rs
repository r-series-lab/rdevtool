use std::collections::BTreeSet;
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};

use anyhow::Result;
use serde::Serialize;

use crate::config::{
    AppConfig, ConfigPaths, ProjectWorkspaceConfig, WorkspaceConfig, active_project_workspace_key,
    apply_project_workspace_context, ensure_default_configs, load_active_project_workspace,
    load_all_project_workspaces, load_config, load_project_workspace_by_key,
    load_project_workspaces, load_workspace_config, resolve_config_path,
};
use crate::config_sources::{
    apply_runtime_overrides_for_source, config_sources_file_path, list_config_sources,
    preferred_config_source_id_for_scope, resolve_config_source_for_workspace,
};
use crate::health::{HealthSnapshot, collect_health_snapshot};
use crate::navigation::{list_navigation_entries_for_workspace, navigation_file_path};
use crate::proxy::{
    default_proxy_path, load_proxy_config, validate_proxy_profile, validate_proxy_rule,
};
use crate::proxy_daemon::{ProxyDaemonStatus, proxy_daemon_status};
use crate::storage::{self, Storage};
use crate::web_actions::default_web_actions_path;

#[derive(Debug, Clone, Default)]
pub struct DoctorRequest {
    pub config_override: Option<PathBuf>,
    pub workspace_key: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DoctorStatus {
    Ok,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorCheck {
    pub status: DoctorStatus,
    pub code: String,
    pub message: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorPaths {
    pub config_dir: String,
    pub projects: String,
    pub workspace: String,
    pub workspaces_dir: String,
    pub navigation: String,
    pub proxy: String,
    pub config_sources: String,
    pub proxy_active: Option<String>,
    pub web_actions: String,
    pub storage: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorWorkspaceSummary {
    pub key: String,
    pub name: String,
    pub system: bool,
    pub project_count: usize,
    pub include_all_projects: bool,
    pub include_all_navigation: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorSnapshot {
    pub schema_version: u16,
    pub status: DoctorStatus,
    pub error_count: usize,
    pub warning_count: usize,
    pub paths: DoctorPaths,
    pub health: HealthSnapshot,
    pub active_workspace: Option<DoctorWorkspaceSummary>,
    pub checks: Vec<DoctorCheck>,
}

pub struct DoctorInspection {
    pub snapshot: DoctorSnapshot,
    pub effective_config: Option<AppConfig>,
    pub active_workspace: Option<ProjectWorkspaceConfig>,
    pub effective_workspace_key: String,
}

pub fn inspect_doctor(request: DoctorRequest) -> Result<DoctorInspection> {
    let paths = ensure_default_configs()?;
    inspect_doctor_with_paths(&paths, request)
}

fn inspect_doctor_with_paths(
    paths: &ConfigPaths,
    request: DoctorRequest,
) -> Result<DoctorInspection> {
    let mut checks = Vec::new();
    let health = collect_health_snapshot();
    let mut active_workspace = None;
    let mut app_workspace_config = None;
    let mut config_source_workspaces = Vec::new();
    let mut known_workspace_keys = BTreeSet::new();

    let config_path = request
        .config_override
        .as_deref()
        .and_then(|path| resolve_config_path(path).ok())
        .unwrap_or_else(|| paths.projects.clone());
    let config_result = load_effective_config(paths, &request);
    let mut effective_config = None;

    match config_result {
        Ok((config, _)) => {
            push_check(
                &mut checks,
                DoctorStatus::Ok,
                "projects_config",
                format!("loaded {} projects", config.projects.len()),
                Some(config_path.display().to_string()),
            );
            check_project_config(&mut checks, &config);
            effective_config = Some(config);
        }
        Err(error) => push_check(
            &mut checks,
            DoctorStatus::Error,
            "projects_config",
            "failed to load projects config",
            Some(error.to_string()),
        ),
    }

    let mut effective_workspace_key = request.workspace_key.clone().unwrap_or_default();
    match load_workspace_config(&paths.workspace) {
        Ok(workspace_config) => {
            let configured_active_key = active_project_workspace_key(&workspace_config);
            if effective_workspace_key.is_empty() {
                effective_workspace_key = configured_active_key.clone();
            }
            app_workspace_config = Some(workspace_config);
            push_check(
                &mut checks,
                DoctorStatus::Ok,
                "workspace_preferences",
                if effective_workspace_key == configured_active_key {
                    format!("active workspace is {configured_active_key}")
                } else {
                    format!(
                        "command scope is {effective_workspace_key}; app active workspace is {configured_active_key}"
                    )
                },
                Some(paths.workspace.display().to_string()),
            );

            match load_all_project_workspaces(&paths.project_workspaces) {
                Ok(all_workspaces) => {
                    let workspace_count = all_workspaces
                        .iter()
                        .filter(|workspace| !workspace.is_archived())
                        .count();
                    let archived_count = all_workspaces.len().saturating_sub(workspace_count);
                    known_workspace_keys = all_workspaces
                        .iter()
                        .filter(|workspace| !workspace.is_archived())
                        .map(|workspace| workspace.key.clone())
                        .collect();
                    config_source_workspaces = all_workspaces;
                    push_check(
                        &mut checks,
                        DoctorStatus::Ok,
                        "workspace_catalog",
                        format!(
                            "loaded {workspace_count} workspaces and {archived_count} archived workspaces"
                        ),
                        Some(paths.project_workspaces.display().to_string()),
                    );
                }
                Err(error) => push_check(
                    &mut checks,
                    DoctorStatus::Error,
                    "workspace_catalog",
                    "failed to load workspaces",
                    Some(error.to_string()),
                ),
            }

            match load_requested_workspace(paths, request.workspace_key.as_deref()) {
                Ok(workspace) => {
                    if let Some(config) = &effective_config {
                        check_workspace_scope(&mut checks, &workspace, config);
                    }
                    check_navigation_config(&mut checks, &workspace);
                    active_workspace = Some(workspace);
                }
                Err(error) => push_check(
                    &mut checks,
                    DoctorStatus::Error,
                    "active_workspace",
                    "failed to load active workspace",
                    Some(error.to_string()),
                ),
            }
        }
        Err(error) => push_check(
            &mut checks,
            DoctorStatus::Error,
            "workspace_preferences",
            "failed to load workspace preferences",
            Some(error.to_string()),
        ),
    }

    let active_proxy_path = check_config_sources(
        &mut checks,
        &config_source_workspaces,
        active_workspace.as_ref(),
        app_workspace_config.as_ref(),
    )
    .unwrap_or_else(default_proxy_path);
    check_proxy_config(&mut checks, &known_workspace_keys, &active_proxy_path);
    check_storage(&mut checks);
    check_web_actions(&mut checks);
    push_check(
        &mut checks,
        DoctorStatus::Ok,
        "self_identity",
        format!(
            "{} {} ({})",
            health.identity.version,
            health.identity.install_kind,
            health.identity.executable_path.display()
        ),
        health
            .identity
            .build_commit
            .as_deref()
            .map(|commit| format!("build commit {commit}")),
    );
    for risk in &health.risks {
        push_check(
            &mut checks,
            if risk.severity == "error" {
                DoctorStatus::Error
            } else {
                DoctorStatus::Warning
            },
            &risk.code,
            &risk.summary,
            Some(risk.detail.clone()),
        );
    }

    let workspace_summary = active_workspace
        .as_ref()
        .map(|workspace| DoctorWorkspaceSummary {
            key: workspace.key.clone(),
            name: workspace.name.clone(),
            system: workspace.is_system(),
            project_count: effective_config
                .as_ref()
                .map_or(0, |config| workspace.project_count_for(config)),
            include_all_projects: workspace.include_all_projects,
            include_all_navigation: workspace.include_all_navigation,
        });
    let (status, error_count, warning_count) = summarize_checks(&checks);
    let snapshot = DoctorSnapshot {
        schema_version: 1,
        status,
        error_count,
        warning_count,
        paths: DoctorPaths {
            config_dir: paths.dir.display().to_string(),
            projects: config_path.display().to_string(),
            workspace: paths.workspace.display().to_string(),
            workspaces_dir: paths.project_workspaces.display().to_string(),
            navigation: navigation_file_path(),
            proxy: default_proxy_path().display().to_string(),
            config_sources: config_sources_file_path().display().to_string(),
            proxy_active: Some(active_proxy_path.display().to_string()),
            web_actions: default_web_actions_path().display().to_string(),
            storage: storage::default_storage_path().display().to_string(),
        },
        health,
        active_workspace: workspace_summary,
        checks,
    };

    Ok(DoctorInspection {
        snapshot,
        effective_config,
        active_workspace,
        effective_workspace_key,
    })
}

fn load_effective_config(
    paths: &ConfigPaths,
    request: &DoctorRequest,
) -> Result<(AppConfig, PathBuf)> {
    let config_path = match request.config_override.as_deref() {
        Some(path) => resolve_config_path(path)?,
        None => paths.projects.clone(),
    };
    let config = load_config(&config_path)?;
    if request.config_override.is_some() && request.workspace_key.is_none() {
        return Ok((config, config_path));
    }
    let workspace = load_requested_workspace(paths, request.workspace_key.as_deref())?;
    let mut effective = apply_project_workspace_context(&config, &workspace);
    if request.config_override.is_none() {
        let workspaces = load_project_workspaces(&paths.project_workspaces)?;
        let runtime_source =
            resolve_config_source_for_workspace(paths, &workspace, &workspaces, "runtime", None)?;
        apply_runtime_overrides_for_source(&mut effective, &runtime_source)?;
    }
    Ok((effective, config_path))
}

fn load_requested_workspace(
    paths: &ConfigPaths,
    workspace_key: Option<&str>,
) -> Result<ProjectWorkspaceConfig> {
    let workspace = match workspace_key.map(str::trim).filter(|key| !key.is_empty()) {
        Some(key) => load_project_workspace_by_key(&paths.project_workspaces, key),
        None => load_active_project_workspace(paths),
    }?;
    if workspace.is_archived() {
        anyhow::bail!(
            "project workspace is archived: {}; restore it before running workspace operations",
            workspace.key
        );
    }
    Ok(workspace)
}

fn check_project_config(checks: &mut Vec<DoctorCheck>, config: &AppConfig) {
    let mut seen = BTreeSet::new();
    let mut duplicates = Vec::new();
    let mut missing_repos = Vec::new();
    for project in &config.projects {
        if !seen.insert(project.key.clone()) {
            duplicates.push(project.key.clone());
        }
        if let Some(path) = &project.repo_path
            && !path.exists()
        {
            missing_repos.push(format!("{} -> {}", project.key, path.display()));
        }
    }
    if duplicates.is_empty() {
        push_check(
            checks,
            DoctorStatus::Ok,
            "project_keys",
            "project keys are unique",
            None,
        );
    } else {
        push_check(
            checks,
            DoctorStatus::Error,
            "project_keys",
            "duplicate project keys found",
            Some(duplicates.join(", ")),
        );
    }
    if missing_repos.is_empty() {
        push_check(
            checks,
            DoctorStatus::Ok,
            "project_repo_paths",
            "configured repo paths exist",
            None,
        );
    } else {
        push_check(
            checks,
            DoctorStatus::Warning,
            "project_repo_paths",
            format!("{} repo paths do not exist", missing_repos.len()),
            Some(missing_repos.join("; ")),
        );
    }
}

fn check_workspace_scope(
    checks: &mut Vec<DoctorCheck>,
    workspace: &ProjectWorkspaceConfig,
    config: &AppConfig,
) {
    if workspace.include_all_projects {
        push_check(
            checks,
            DoctorStatus::Ok,
            "workspace_projects",
            "active workspace includes all projects",
            Some(workspace.key.clone()),
        );
        return;
    }
    let project_keys = config
        .projects
        .iter()
        .map(|project| project.key.as_str())
        .collect::<BTreeSet<_>>();
    let missing = workspace
        .projects
        .iter()
        .filter(|key| !project_keys.contains(key.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if missing.is_empty() {
        push_check(
            checks,
            DoctorStatus::Ok,
            "workspace_projects",
            format!(
                "active workspace references {} projects",
                workspace.projects.len()
            ),
            Some(workspace.key.clone()),
        );
    } else {
        push_check(
            checks,
            DoctorStatus::Warning,
            "workspace_projects",
            "active workspace references missing projects",
            Some(missing.join(", ")),
        );
    }
}

fn check_navigation_config(checks: &mut Vec<DoctorCheck>, workspace: &ProjectWorkspaceConfig) {
    match list_navigation_entries_for_workspace(workspace, 2000) {
        Ok(entries) if entries.is_empty() => push_check(
            checks,
            DoctorStatus::Warning,
            "navigation",
            "navigation has no entries in active workspace",
            Some(navigation_file_path()),
        ),
        Ok(entries) => push_check(
            checks,
            DoctorStatus::Ok,
            "navigation",
            format!(
                "loaded {} navigation entries for active workspace",
                entries.len()
            ),
            Some(navigation_file_path()),
        ),
        Err(error) => push_check(
            checks,
            DoctorStatus::Error,
            "navigation",
            "failed to load navigation entries",
            Some(error.to_string()),
        ),
    }
}

fn check_config_sources(
    checks: &mut Vec<DoctorCheck>,
    workspaces: &[ProjectWorkspaceConfig],
    active_workspace: Option<&ProjectWorkspaceConfig>,
    app_workspace: Option<&WorkspaceConfig>,
) -> Option<PathBuf> {
    let sources = match list_config_sources(workspaces) {
        Ok(sources) => sources,
        Err(error) => {
            push_check(
                checks,
                DoctorStatus::Error,
                "config_sources",
                "failed to load config sources",
                Some(error.to_string()),
            );
            return None;
        }
    };
    let capability_summary = ["resource", "link", "proxy", "runtime"]
        .into_iter()
        .map(|capability| {
            let count = sources
                .iter()
                .filter(|source| {
                    source
                        .capabilities
                        .iter()
                        .any(|item| item.eq_ignore_ascii_case(capability))
                })
                .count();
            format!("{capability}={count}")
        })
        .collect::<Vec<_>>()
        .join(", ");
    push_check(
        checks,
        DoctorStatus::Ok,
        "config_sources",
        format!("loaded {} config sources", sources.len()),
        Some(format!(
            "{}; {}",
            config_sources_file_path().display(),
            capability_summary
        )),
    );

    let preferred_source_id = match (active_workspace, app_workspace) {
        (Some(workspace), Some(app_workspace)) => {
            preferred_config_source_id_for_scope(workspace, app_workspace, "proxy")
        }
        _ => "default".to_string(),
    };
    let preferred_normalized = preferred_source_id.replace('_', "-");
    let preferred_source = sources.iter().find(|source| {
        source.id == preferred_source_id || source.id.replace('_', "-") == preferred_normalized
    });
    let source = preferred_source.or_else(|| sources.iter().find(|source| source.is_default))?;
    if preferred_source.is_none() {
        push_check(
            checks,
            DoctorStatus::Warning,
            "proxy_source",
            "preferred proxy config source no longer exists; using default",
            Some(preferred_source_id),
        );
    }
    if !source
        .capabilities
        .iter()
        .any(|capability| capability.eq_ignore_ascii_case("proxy"))
    {
        push_check(
            checks,
            DoctorStatus::Error,
            "proxy_source",
            "active config source does not support proxy",
            Some(format!("{} ({})", source.name, source.id)),
        );
        return None;
    }
    let path = source.files.proxy.as_deref().map(PathBuf::from);
    match &path {
        Some(path) => push_check(
            checks,
            DoctorStatus::Ok,
            "proxy_source",
            format!("active proxy source is {} ({})", source.name, source.id),
            Some(path.display().to_string()),
        ),
        None => push_check(
            checks,
            DoctorStatus::Error,
            "proxy_source",
            "active config source has no proxy file mapping",
            Some(format!("{} ({})", source.name, source.id)),
        ),
    }
    path
}

fn check_proxy_config(
    checks: &mut Vec<DoctorCheck>,
    known_workspace_keys: &BTreeSet<String>,
    proxy_path: &Path,
) {
    if !proxy_path.exists() {
        push_check(
            checks,
            DoctorStatus::Warning,
            "proxy_config",
            "active proxy config has not been initialized",
            Some(proxy_path.display().to_string()),
        );
        return;
    }
    let proxy_config = match load_proxy_config(proxy_path) {
        Ok(config) => config,
        Err(error) => {
            push_check(
                checks,
                DoctorStatus::Error,
                "proxy_config",
                "failed to load proxy config",
                Some(error.to_string()),
            );
            return;
        }
    };
    let mut validation_errors = Vec::new();
    let mut workspace_warnings = Vec::new();
    let mut listen_addrs = BTreeSet::new();
    let mut duplicate_addrs = Vec::new();
    let mut managed_addrs = Vec::new();
    let mut outdated_daemons = Vec::new();
    let mut unavailable_addrs = Vec::new();
    for profile in &proxy_config.profiles {
        if let Err(error) = validate_proxy_profile(profile) {
            validation_errors.push(format!("profile {}: {error}", profile.id));
        }
        if let Some(workspace_key) = &profile.workspace_key
            && !known_workspace_keys.is_empty()
            && !known_workspace_keys.contains(workspace_key)
        {
            workspace_warnings.push(format!("{} -> {}", profile.id, workspace_key));
        }
        let listen_addr = profile.listen_addr();
        if !listen_addrs.insert(listen_addr.clone()) {
            duplicate_addrs.push(listen_addr.clone());
        }
        if TcpListener::bind(&listen_addr).is_err() {
            let daemon_status = proxy_daemon_status(proxy_path, &profile.id).ok();
            if proxy_listener_is_managed(daemon_status.as_ref()) {
                if daemon_status
                    .as_ref()
                    .is_some_and(|status| !status.version_compatible)
                {
                    outdated_daemons.push(format!("{} ({})", profile.id, listen_addr));
                }
                managed_addrs.push(listen_addr);
            } else {
                unavailable_addrs.push(listen_addr);
            }
        }
    }
    if outdated_daemons.is_empty() {
        push_check(
            checks,
            DoctorStatus::Ok,
            "proxy_daemon_versions",
            "running proxy daemons use the current runtime",
            None,
        );
    } else {
        push_check(
            checks,
            DoctorStatus::Warning,
            "proxy_daemon_versions",
            "some proxy daemons will be upgraded on next start or restart",
            Some(outdated_daemons.join(", ")),
        );
    }
    for rule in &proxy_config.rules {
        if let Err(error) = validate_proxy_rule(rule) {
            validation_errors.push(format!("rule {}: {error}", rule.id));
        }
    }
    if validation_errors.is_empty() {
        push_check(
            checks,
            DoctorStatus::Ok,
            "proxy_config",
            format!(
                "loaded {} profiles and {} rules",
                proxy_config.profiles.len(),
                proxy_config.rules.len()
            ),
            Some(proxy_path.display().to_string()),
        );
    } else {
        push_check(
            checks,
            DoctorStatus::Error,
            "proxy_config",
            "proxy config contains invalid profiles or rules",
            Some(validation_errors.join("; ")),
        );
    }
    if workspace_warnings.is_empty() {
        push_check(
            checks,
            DoctorStatus::Ok,
            "proxy_workspaces",
            "proxy workspace references are valid",
            None,
        );
    } else {
        push_check(
            checks,
            DoctorStatus::Warning,
            "proxy_workspaces",
            "proxy profiles reference missing workspaces",
            Some(workspace_warnings.join("; ")),
        );
    }
    if duplicate_addrs.is_empty() && unavailable_addrs.is_empty() {
        push_check(
            checks,
            DoctorStatus::Ok,
            "proxy_ports",
            "proxy listen ports look available or managed by rDevTool",
            (!managed_addrs.is_empty())
                .then(|| format!("managed by rDevTool: {}", managed_addrs.join(", "))),
        );
    } else {
        let detail = [
            (!duplicate_addrs.is_empty())
                .then(|| format!("duplicate: {}", duplicate_addrs.join(", "))),
            (!unavailable_addrs.is_empty()).then(|| {
                format!(
                    "unavailable or already running: {}",
                    unavailable_addrs.join(", ")
                )
            }),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join("; ");
        push_check(
            checks,
            DoctorStatus::Warning,
            "proxy_ports",
            "some proxy listen addresses need attention",
            Some(detail),
        );
    }
}

pub fn proxy_listener_is_managed(status: Option<&ProxyDaemonStatus>) -> bool {
    status.is_some_and(|status| status.running && status.managed)
}

fn check_storage(checks: &mut Vec<DoctorCheck>) {
    match Storage::new_default() {
        Ok(_) => push_check(
            checks,
            DoctorStatus::Ok,
            "storage",
            "storage database is available",
            Some(storage::default_storage_path().display().to_string()),
        ),
        Err(error) => push_check(
            checks,
            DoctorStatus::Error,
            "storage",
            "failed to open storage database",
            Some(error),
        ),
    }
}

fn check_web_actions(checks: &mut Vec<DoctorCheck>) {
    let path = default_web_actions_path();
    if path.exists() {
        match fs::read_to_string(&path) {
            Ok(_) => push_check(
                checks,
                DoctorStatus::Ok,
                "web_actions",
                "web actions config is readable",
                Some(path.display().to_string()),
            ),
            Err(error) => push_check(
                checks,
                DoctorStatus::Warning,
                "web_actions",
                "web actions config exists but is not readable",
                Some(error.to_string()),
            ),
        }
    } else {
        push_check(
            checks,
            DoctorStatus::Ok,
            "web_actions",
            "web actions config is optional and not initialized",
            Some(path.display().to_string()),
        );
    }
}

pub fn push_check(
    checks: &mut Vec<DoctorCheck>,
    status: DoctorStatus,
    code: &str,
    message: impl Into<String>,
    detail: Option<String>,
) {
    checks.push(DoctorCheck {
        status,
        code: code.to_string(),
        message: message.into(),
        detail,
    });
}

pub fn summarize_checks(checks: &[DoctorCheck]) -> (DoctorStatus, usize, usize) {
    let error_count = checks
        .iter()
        .filter(|check| check.status == DoctorStatus::Error)
        .count();
    let warning_count = checks
        .iter()
        .filter(|check| check.status == DoctorStatus::Warning)
        .count();
    let status = if error_count > 0 {
        DoctorStatus::Error
    } else if warning_count > 0 {
        DoctorStatus::Warning
    } else {
        DoctorStatus::Ok
    };
    (status, error_count, warning_count)
}

#[cfg(test)]
mod tests {
    use super::{DoctorCheck, DoctorStatus, summarize_checks};

    #[test]
    fn summary_prefers_errors_then_warnings() {
        let checks = vec![
            DoctorCheck {
                status: DoctorStatus::Ok,
                code: "ok".to_string(),
                message: "ok".to_string(),
                detail: None,
            },
            DoctorCheck {
                status: DoctorStatus::Warning,
                code: "warning".to_string(),
                message: "warning".to_string(),
                detail: None,
            },
        ];
        assert_eq!(summarize_checks(&checks), (DoctorStatus::Warning, 0, 1));

        let mut with_error = checks;
        with_error.push(DoctorCheck {
            status: DoctorStatus::Error,
            code: "error".to_string(),
            message: "error".to_string(),
            detail: None,
        });
        assert_eq!(summarize_checks(&with_error), (DoctorStatus::Error, 1, 1));
    }
}
