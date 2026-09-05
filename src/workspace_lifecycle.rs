use anyhow::{Result, bail};
use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::config::{
    AppConfig, ConfigPaths, ProjectWorkspaceArchiveConfig, ProjectWorkspaceConfig,
    SYSTEM_PROJECT_WORKSPACE_KEY, active_project_workspace_key, apply_project_workspace_context,
    load_all_project_workspaces, load_project_workspace_by_key, load_workspace_config,
    save_project_workspace_config, save_workspace_config,
};
use crate::config_sources::{load_config_source_preference, resolve_config_source};
use crate::proxy::{ProxyConfig, load_proxy_config};
use crate::proxy_daemon::{proxy_daemon_status, proxy_daemon_stop};
use crate::runtime_daemon::{self, RuntimeDaemonStatus};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceArchiveBlocker {
    pub kind: String,
    pub id: String,
    pub label: String,
    pub managed: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceArchivePlan {
    pub workspace_key: String,
    pub workspace_name: String,
    pub already_archived: bool,
    pub active: bool,
    pub can_archive: bool,
    pub blockers: Vec<WorkspaceArchiveBlocker>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceLifecycleResult {
    pub workspace: ProjectWorkspaceConfig,
    pub changed: bool,
    pub previous_active_workspace_key: String,
    pub active_workspace_key: String,
    pub stopped_items: Vec<String>,
}

struct WorkspaceProxyContext {
    config_path: PathBuf,
    config: ProxyConfig,
}

pub fn plan_project_workspace_archive(
    paths: &ConfigPaths,
    config: &AppConfig,
    workspace_key: &str,
) -> Result<WorkspaceArchivePlan> {
    let workspace = load_project_workspace_by_key(&paths.project_workspaces, workspace_key)?;
    if workspace.is_system() {
        bail!("cannot archive the system workspace");
    }

    let app_workspace = load_workspace_config(&paths.workspace)?;
    let active = active_project_workspace_key(&app_workspace) == workspace.key;
    if workspace.is_archived() {
        return Ok(WorkspaceArchivePlan {
            workspace_key: workspace.key,
            workspace_name: workspace.name,
            already_archived: true,
            active,
            can_archive: true,
            blockers: Vec::new(),
            warnings: Vec::new(),
        });
    }

    let mut warnings = Vec::new();
    let mut blockers = running_workspace_runtimes(config, &workspace)?
        .into_iter()
        .map(|status| WorkspaceArchiveBlocker {
            kind: "runtime".to_string(),
            id: status.status_key,
            label: format!("项目运行：{}", status.project_key),
            managed: status.managed,
            detail: status.detail,
        })
        .collect::<Vec<_>>();

    match workspace_proxy_context(paths, &workspace) {
        Ok(Some(context)) => {
            for profile in &context.config.profiles {
                if profile.workspace_key.as_deref() != Some(workspace.key.as_str()) {
                    continue;
                }
                match proxy_daemon_status(&context.config_path, &profile.id) {
                    Ok(status) if status.running => blockers.push(WorkspaceArchiveBlocker {
                        kind: "proxy".to_string(),
                        id: profile.id.clone(),
                        label: format!("本地代理：{}", profile.name),
                        managed: status.managed,
                        detail: status.detail,
                    }),
                    Ok(_) => {}
                    Err(error) => warnings.push(format!(
                        "无法确认代理 {} 的运行状态：{}",
                        profile.name, error
                    )),
                }
            }
        }
        Ok(None) => {}
        Err(error) => warnings.push(format!("无法检查工作区代理状态：{error}")),
    }

    Ok(WorkspaceArchivePlan {
        workspace_key: workspace.key,
        workspace_name: workspace.name,
        already_archived: false,
        active,
        can_archive: blockers.is_empty(),
        blockers,
        warnings,
    })
}

pub fn archive_project_workspace(
    paths: &ConfigPaths,
    config: &AppConfig,
    workspace_key: &str,
    reason: Option<String>,
    stop_running: bool,
) -> Result<WorkspaceLifecycleResult> {
    let mut workspace = load_project_workspace_by_key(&paths.project_workspaces, workspace_key)?;
    if workspace.is_system() {
        bail!("cannot archive the system workspace");
    }

    let mut app_workspace = load_workspace_config(&paths.workspace)?;
    let previous_active_workspace_key = active_project_workspace_key(&app_workspace);
    if workspace.is_archived() {
        return Ok(WorkspaceLifecycleResult {
            workspace,
            changed: false,
            active_workspace_key: previous_active_workspace_key.clone(),
            previous_active_workspace_key,
            stopped_items: Vec::new(),
        });
    }

    let plan = plan_project_workspace_archive(paths, config, &workspace.key)?;
    let mut stopped_items = Vec::new();
    if !plan.blockers.is_empty() {
        if !stop_running {
            bail!(
                "workspace has {} running item(s); stop them first or use stop_running",
                plan.blockers.len()
            );
        }
        if let Some(blocker) = plan.blockers.iter().find(|blocker| !blocker.managed) {
            bail!(
                "cannot stop unmanaged workspace item: {} ({})",
                blocker.label,
                blocker.detail
            );
        }
        stopped_items = stop_workspace_processes(paths, config, &workspace)?;
        let next_plan = plan_project_workspace_archive(paths, config, &workspace.key)?;
        if !next_plan.blockers.is_empty() {
            bail!(
                "workspace still has {} running item(s) after stop",
                next_plan.blockers.len()
            );
        }
    }

    workspace.archive = Some(ProjectWorkspaceArchiveConfig {
        archived_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        reason: normalized_reason(reason),
    });
    save_project_workspace_config(
        &paths
            .project_workspaces
            .join(format!("{}.toml", workspace.key)),
        &workspace,
    )?;

    let active_workspace_key = if previous_active_workspace_key == workspace.key {
        app_workspace.app.active_workspace = Some(SYSTEM_PROJECT_WORKSPACE_KEY.to_string());
        save_workspace_config(&paths.workspace, &app_workspace)?;
        SYSTEM_PROJECT_WORKSPACE_KEY.to_string()
    } else {
        previous_active_workspace_key.clone()
    };

    Ok(WorkspaceLifecycleResult {
        workspace,
        changed: true,
        previous_active_workspace_key,
        active_workspace_key,
        stopped_items,
    })
}

pub fn restore_project_workspace(
    paths: &ConfigPaths,
    workspace_key: &str,
) -> Result<WorkspaceLifecycleResult> {
    let mut workspace = load_project_workspace_by_key(&paths.project_workspaces, workspace_key)?;
    if workspace.is_system() {
        bail!("the system workspace is always available");
    }

    let app_workspace = load_workspace_config(&paths.workspace)?;
    let active_workspace_key = active_project_workspace_key(&app_workspace);
    if !workspace.is_archived() {
        return Ok(WorkspaceLifecycleResult {
            workspace,
            changed: false,
            previous_active_workspace_key: active_workspace_key.clone(),
            active_workspace_key,
            stopped_items: Vec::new(),
        });
    }

    workspace.archive = None;
    save_project_workspace_config(
        &paths
            .project_workspaces
            .join(format!("{}.toml", workspace.key)),
        &workspace,
    )?;

    Ok(WorkspaceLifecycleResult {
        workspace,
        changed: true,
        previous_active_workspace_key: active_workspace_key.clone(),
        active_workspace_key,
        stopped_items: Vec::new(),
    })
}

fn running_workspace_runtimes(
    config: &AppConfig,
    workspace: &ProjectWorkspaceConfig,
) -> Result<Vec<RuntimeDaemonStatus>> {
    let effective_config = apply_project_workspace_context(config, workspace);
    let project_roots = effective_config
        .projects
        .iter()
        .filter_map(|project| {
            project
                .repo_path
                .as_ref()
                .map(|path| (project.key.as_str(), normalized_path(path)))
        })
        .collect::<Vec<_>>();

    Ok(runtime_daemon::list()?
        .into_iter()
        .filter(|status| status.running)
        .filter(|status| {
            project_roots.iter().any(|(project_key, root)| {
                *project_key == status.project_key
                    && Path::new(&status.canonical_cwd).starts_with(root)
            })
        })
        .collect())
}

fn workspace_proxy_context(
    paths: &ConfigPaths,
    workspace: &ProjectWorkspaceConfig,
) -> Result<Option<WorkspaceProxyContext>> {
    let all_workspaces = load_all_project_workspaces(&paths.project_workspaces)?;
    let source_id = load_config_source_preference(paths, &workspace.key, "proxy")?;
    let source = resolve_config_source(Some(&source_id), &all_workspaces)?;
    let Some(config_path) = source.files.proxy.map(PathBuf::from) else {
        return Ok(None);
    };
    let config = load_proxy_config(&config_path)?;
    Ok(Some(WorkspaceProxyContext {
        config_path,
        config,
    }))
}

fn stop_workspace_processes(
    paths: &ConfigPaths,
    config: &AppConfig,
    workspace: &ProjectWorkspaceConfig,
) -> Result<Vec<String>> {
    let mut stopped_items = Vec::new();
    for status in running_workspace_runtimes(config, workspace)? {
        runtime_daemon::stop(&status.project_key, Path::new(&status.canonical_cwd))?;
        stopped_items.push(format!("runtime:{}", status.project_key));
    }

    if let Some(context) = workspace_proxy_context(paths, workspace)? {
        for profile in &context.config.profiles {
            if profile.workspace_key.as_deref() != Some(workspace.key.as_str()) {
                continue;
            }
            let status = proxy_daemon_status(&context.config_path, &profile.id)?;
            if status.running {
                proxy_daemon_stop(&context.config_path, &profile.id)?;
                stopped_items.push(format!("proxy:{}", profile.id));
            }
        }
    }
    Ok(stopped_items)
}

fn normalized_reason(reason: Option<String>) -> Option<String> {
    reason.and_then(|reason| {
        let reason = reason.trim().to_string();
        (!reason.is_empty()).then_some(reason)
    })
}

fn normalized_path(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{
        WorkspaceConfig, load_all_project_workspaces, load_project_workspaces,
        save_workspace_config,
    };
    use std::fs;
    use uuid::Uuid;

    fn test_paths(name: &str) -> ConfigPaths {
        let dir = std::env::temp_dir().join(format!(
            "rdevtool-workspace-lifecycle-{name}-{}",
            Uuid::new_v4()
        ));
        let project_workspaces = dir.join("project-workspaces");
        fs::create_dir_all(&project_workspaces).expect("create project workspaces");
        ConfigPaths {
            projects: dir.join("projects.toml"),
            workspace: dir.join("workspace.toml"),
            project_workspaces,
            dir,
        }
    }

    fn test_config() -> AppConfig {
        toml::from_str("projects = []\n[defaults]\n").expect("parse app config")
    }

    fn save_test_workspace(paths: &ConfigPaths, active: bool) {
        let workspace = ProjectWorkspaceConfig {
            key: "feature-a".to_string(),
            name: "Feature A".to_string(),
            include_all_projects: false,
            include_all_navigation: false,
            ..ProjectWorkspaceConfig::default()
        };
        save_project_workspace_config(&paths.project_workspaces.join("feature-a.toml"), &workspace)
            .expect("save project workspace");
        let mut app_workspace = WorkspaceConfig::default();
        app_workspace.app.active_workspace = active.then(|| "feature-a".to_string());
        save_workspace_config(&paths.workspace, &app_workspace).expect("save workspace config");
    }

    #[test]
    fn archive_hides_workspace_and_moves_active_scope_to_system() {
        let paths = test_paths("archive");
        save_test_workspace(&paths, true);

        let result = archive_project_workspace(
            &paths,
            &test_config(),
            "feature-a",
            Some(" shipped ".to_string()),
            false,
        )
        .expect("archive workspace");

        assert!(result.changed);
        assert_eq!(result.active_workspace_key, SYSTEM_PROJECT_WORKSPACE_KEY);
        assert_eq!(
            result
                .workspace
                .archive
                .as_ref()
                .and_then(|archive| archive.reason.as_deref()),
            Some("shipped")
        );
        assert!(
            load_project_workspaces(&paths.project_workspaces)
                .expect("load open workspaces")
                .iter()
                .all(|workspace| workspace.key != "feature-a")
        );
        assert!(
            load_all_project_workspaces(&paths.project_workspaces)
                .expect("load all workspaces")
                .iter()
                .any(|workspace| workspace.key == "feature-a" && workspace.is_archived())
        );

        fs::remove_dir_all(paths.dir).expect("remove test config");
    }

    #[test]
    fn restore_keeps_current_scope_and_returns_workspace_to_open_list() {
        let paths = test_paths("restore");
        save_test_workspace(&paths, false);
        archive_project_workspace(&paths, &test_config(), "feature-a", None, false)
            .expect("archive workspace");

        let result =
            restore_project_workspace(&paths, "feature-a").expect("restore project workspace");

        assert!(result.changed);
        assert_eq!(result.active_workspace_key, SYSTEM_PROJECT_WORKSPACE_KEY);
        assert!(!result.workspace.is_archived());
        assert!(
            load_project_workspaces(&paths.project_workspaces)
                .expect("load open workspaces")
                .iter()
                .any(|workspace| workspace.key == "feature-a")
        );

        fs::remove_dir_all(paths.dir).expect("remove test config");
    }

    #[test]
    fn system_workspace_cannot_be_archived() {
        let paths = test_paths("system");
        save_workspace_config(&paths.workspace, &WorkspaceConfig::default())
            .expect("save workspace config");

        let error = archive_project_workspace(
            &paths,
            &test_config(),
            SYSTEM_PROJECT_WORKSPACE_KEY,
            None,
            false,
        )
        .expect_err("system archive must fail");

        assert!(error.to_string().contains("system workspace"));
        fs::remove_dir_all(paths.dir).expect("remove test config");
    }
}
