use std::path::{Path, PathBuf};
use std::thread;

use rdevtool_core::config::{
    AppConfig, ProjectConfig, ProjectWorkspaceConfig, ProjectWorkspaceProjectInstanceConfig,
};
use rdevtool_core::core::{BranchWorktreeSummary, repair_project_worktree};
use rdevtool_core::git;
use rdevtool_core::workspace_instance::validate_workspace_project_instance;
use rdevtool_core::workspace_resources::WorkspaceOperationWorklogEvent;
use serde::Serialize;

use crate::{
    AppState, ProjectWorkspaceEditorState, load_project_workspace_for_editor,
    project_workspace_editor_state, record_workspace_operation,
};

const MAX_PARALLEL_INSTANCE_INSPECTIONS: usize = 4;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectWorkspaceDirectoryInspection {
    project_key: String,
    requested_path: String,
    pub(crate) effective_path: String,
    repository_root: String,
    configured_remote: Option<String>,
    observed_remote_count: usize,
    remote_matches: Option<bool>,
    requires_remote_mismatch_confirmation: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectWorkspaceInstanceStatus {
    project_key: String,
    project_name: String,
    path: String,
    managed: bool,
    status_key: String,
    status_label: String,
    detail: String,
    exists: bool,
    can_open: bool,
    repository_root: Option<String>,
    remote_matches: Option<bool>,
    observed_remote_count: usize,
    repair_supported: bool,
    repair_branch: Option<String>,
}

fn path_identity(path: &Path) -> PathBuf {
    if let Ok(canonical) = path.canonicalize() {
        return canonical;
    }

    let mut ancestor = path;
    let mut suffix = Vec::new();
    while !ancestor.exists() {
        let Some(name) = ancestor.file_name() else {
            break;
        };
        suffix.push(name.to_os_string());
        let Some(parent) = ancestor.parent() else {
            break;
        };
        ancestor = parent;
    }
    let mut normalized = ancestor
        .canonicalize()
        .unwrap_or_else(|_| ancestor.to_path_buf());
    for component in suffix.into_iter().rev() {
        normalized.push(component);
    }
    normalized
}

fn same_path(left: &Path, right: &Path) -> bool {
    path_identity(left) == path_identity(right)
}

fn missing_worktree_repair_branch(project: &ProjectConfig, path: &Path) -> Option<String> {
    let default_repo_path = project.repo_path.as_ref()?;
    if !default_repo_path.is_dir() {
        return None;
    }
    git::list_worktrees(default_repo_path)
        .ok()?
        .into_iter()
        .find(|worktree| {
            !worktree.bare && worktree.branch.is_some() && same_path(&worktree.path, path)
        })
        .and_then(|worktree| worktree.branch)
}

pub(crate) fn validate_project_instance_binding(
    project: &ProjectConfig,
    path: &Path,
    allow_remote_mismatch: bool,
) -> Result<ProjectWorkspaceDirectoryInspection, String> {
    let instance = ProjectWorkspaceProjectInstanceConfig {
        project: project.key.clone(),
        path: path.to_path_buf(),
        managed: false,
    };
    let validation = validate_workspace_project_instance(project, &instance, true)
        .map_err(|_| "所选目录必须是可访问的 Git 仓库根目录".to_string())?;
    let requires_remote_mismatch_confirmation = validation.remote_matches == Some(false);
    if requires_remote_mismatch_confirmation && !allow_remote_mismatch {
        return Err("所选目录的 Git Remote 与项目配置不一致".to_string());
    }
    Ok(ProjectWorkspaceDirectoryInspection {
        project_key: validation.project_key,
        requested_path: validation.requested_path,
        effective_path: validation.effective_path,
        repository_root: validation.repository_root,
        configured_remote: validation.configured_remote,
        observed_remote_count: validation.observed_remotes.len(),
        remote_matches: validation.remote_matches,
        requires_remote_mismatch_confirmation,
    })
}

fn instance_status(
    project: Option<ProjectConfig>,
    instance: ProjectWorkspaceProjectInstanceConfig,
    repair_allowed: bool,
) -> ProjectWorkspaceInstanceStatus {
    let path = instance.path.display().to_string();
    let exists = instance.path.exists();
    let can_open = instance.path.is_dir();
    let Some(project) = project else {
        return ProjectWorkspaceInstanceStatus {
            project_key: instance.project.clone(),
            project_name: instance.project,
            path,
            managed: instance.managed,
            status_key: "invalid".to_string(),
            status_label: "项目配置缺失".to_string(),
            detail: "实例引用的项目已不在当前配置中".to_string(),
            exists,
            can_open,
            repository_root: None,
            remote_matches: None,
            observed_remote_count: 0,
            repair_supported: false,
            repair_branch: None,
        };
    };
    if !exists {
        let repair_branch = if instance.managed && repair_allowed {
            missing_worktree_repair_branch(&project, &instance.path)
        } else {
            None
        };
        let repair_supported = repair_branch.is_some();
        return ProjectWorkspaceInstanceStatus {
            project_key: project.key,
            project_name: project.name,
            path,
            managed: instance.managed,
            status_key: "missing".to_string(),
            status_label: "目录缺失".to_string(),
            detail: if repair_supported {
                "目录已被删除，但 Git 仍保留工作副本登记；可按原路径和分支修复".to_string()
            } else {
                "项目实例目录不存在，可以解除关联后重新绑定".to_string()
            },
            exists: false,
            can_open: false,
            repository_root: None,
            remote_matches: None,
            observed_remote_count: 0,
            repair_supported,
            repair_branch,
        };
    }
    match validate_workspace_project_instance(&project, &instance, true) {
        Ok(validation) => {
            let remote_mismatch = validation.remote_matches == Some(false);
            ProjectWorkspaceInstanceStatus {
                project_key: project.key,
                project_name: project.name,
                path,
                managed: instance.managed,
                status_key: if remote_mismatch {
                    "remoteMismatch".to_string()
                } else {
                    "healthy".to_string()
                },
                status_label: if remote_mismatch {
                    "Remote 不匹配".to_string()
                } else {
                    "正常".to_string()
                },
                detail: if remote_mismatch {
                    "目录 Git Remote 与项目配置不一致".to_string()
                } else {
                    "Git 仓库根目录与 Remote 已验证".to_string()
                },
                exists: true,
                can_open: true,
                repository_root: Some(validation.repository_root),
                remote_matches: validation.remote_matches,
                observed_remote_count: validation.observed_remotes.len(),
                repair_supported: false,
                repair_branch: None,
            }
        }
        Err(_) => ProjectWorkspaceInstanceStatus {
            project_key: project.key,
            project_name: project.name,
            path,
            managed: instance.managed,
            status_key: "invalid".to_string(),
            status_label: "仓库无效".to_string(),
            detail: "目录不是可验证的 Git 仓库根目录".to_string(),
            exists: true,
            can_open,
            repository_root: None,
            remote_matches: None,
            observed_remote_count: 0,
            repair_supported: false,
            repair_branch: None,
        },
    }
}

pub(crate) fn repair_managed_project_instance(
    config: &AppConfig,
    workspace: &ProjectWorkspaceConfig,
    project_key: &str,
) -> Result<BranchWorktreeSummary, String> {
    let instance = workspace
        .project_instances
        .iter()
        .find(|instance| instance.project == project_key)
        .ok_or_else(|| "当前工作区没有该项目实例".to_string())?;
    if !instance.managed {
        return Err("只有 rDevTool 托管的工作区副本可以自动修复".to_string());
    }
    if instance.path.exists() {
        return Err("工作区副本目录仍然存在，无需修复".to_string());
    }
    let project = config
        .find_project(project_key)
        .map_err(|error| error.to_string())?;
    if missing_worktree_repair_branch(project, &instance.path).is_none() {
        return Err("Git 未保留该工作副本的路径和分支登记，无法自动修复".to_string());
    }
    repair_project_worktree(config, project_key, &instance.path).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn repair_project_workspace_project_instance(
    state: tauri::State<'_, AppState>,
    workspace_key: Option<String>,
    project: String,
) -> Result<ProjectWorkspaceEditorState, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths =
            rdevtool_core::config::ensure_default_configs().map_err(|error| error.to_string())?;
        let workspace = load_project_workspace_for_editor(&paths, workspace_key)?;
        if workspace.is_system() {
            return Err("全局工作区没有可修复的项目实例".to_string());
        }
        if workspace.is_archived() {
            return Err("已归档工作区需要先恢复，才能修复项目实例".to_string());
        }
        let project_key = project.trim().to_string();
        if project_key.is_empty() {
            return Err("项目不能为空".to_string());
        }
        let instance_path = workspace
            .project_instances
            .iter()
            .find(|instance| instance.project == project_key)
            .map(|instance| instance.path.display().to_string())
            .unwrap_or_default();
        let config = config_state.load()?;
        let repaired = match repair_managed_project_instance(&config, &workspace, &project_key) {
            Ok(repaired) => repaired,
            Err(error) => {
                record_workspace_operation(
                    &workspace.key,
                    WorkspaceOperationWorklogEvent {
                        event_id: None,
                        kind: "配置".to_string(),
                        summary: format!("修复 {project_key} 工作区副本失败"),
                        detail: Some(format!("- 目录: `{instance_path}`\n\n{error}")),
                        success: false,
                    },
                );
                return Err(error);
            }
        };
        record_workspace_operation(
            &workspace.key,
            WorkspaceOperationWorklogEvent {
                event_id: None,
                kind: "配置".to_string(),
                summary: format!("修复 {project_key} 工作区副本"),
                detail: Some(format!(
                    "- 目录: `{}`\n- 分支: `{}`",
                    repaired.repo_path, repaired.current_branch
                )),
                success: true,
            },
        );
        project_workspace_editor_state(&config, Some(workspace.key))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn inspect_project_workspace_project_directory(
    state: tauri::State<'_, AppState>,
    workspace_key: Option<String>,
    project: String,
    path: String,
) -> Result<ProjectWorkspaceDirectoryInspection, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths =
            rdevtool_core::config::ensure_default_configs().map_err(|error| error.to_string())?;
        let workspace = load_project_workspace_for_editor(&paths, workspace_key)?;
        if workspace.is_system() {
            return Err("全局工作区不能绑定项目目录".to_string());
        }
        let requested_path = PathBuf::from(path.trim());
        if requested_path.as_os_str().is_empty() {
            return Err("目录不能为空".to_string());
        }
        let requested_path = if requested_path.is_absolute() {
            requested_path
        } else if let Some(root_dir) = workspace.root_dir.as_ref() {
            root_dir.join(requested_path)
        } else {
            return Err("相对目录需要先配置工作区目录".to_string());
        };
        let config = config_state.load()?;
        let project = config
            .find_project(project.trim())
            .map_err(|error| error.to_string())?;
        validate_project_instance_binding(project, &requested_path, true)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn list_project_workspace_instance_statuses(
    state: tauri::State<'_, AppState>,
    workspace_key: Option<String>,
) -> Result<Vec<ProjectWorkspaceInstanceStatus>, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths =
            rdevtool_core::config::ensure_default_configs().map_err(|error| error.to_string())?;
        let workspace = load_project_workspace_for_editor(&paths, workspace_key)?;
        let config = config_state.load()?;
        let repair_allowed = !workspace.is_archived();
        let mut jobs = workspace
            .project_instances
            .into_iter()
            .map(|instance| {
                let project = config
                    .projects
                    .iter()
                    .find(|project| project.key == instance.project)
                    .cloned();
                (project, instance, repair_allowed)
            })
            .collect::<Vec<_>>();
        jobs.sort_by(|left, right| left.1.project.cmp(&right.1.project));

        let mut statuses = Vec::with_capacity(jobs.len());
        for chunk in jobs.chunks(MAX_PARALLEL_INSTANCE_INSPECTIONS) {
            let inspected = thread::scope(|scope| {
                chunk
                    .iter()
                    .cloned()
                    .map(|(project, instance, repair_allowed)| {
                        scope.spawn(move || instance_status(project, instance, repair_allowed))
                    })
                    .collect::<Vec<_>>()
                    .into_iter()
                    .filter_map(|handle| handle.join().ok())
                    .collect::<Vec<_>>()
            });
            statuses.extend(inspected);
        }
        statuses.sort_by(|left, right| {
            left.project_name
                .to_lowercase()
                .cmp(&right.project_name.to_lowercase())
        });
        Ok(statuses)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::fs;
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    use rdevtool_core::config::{
        BranchRules, Defaults, Jobs, ProjectFocusConfig, ProjectWorkspaceConfig,
    };

    use super::*;

    fn project(git_url: &str) -> ProjectConfig {
        ProjectConfig {
            key: "sample".to_string(),
            name: "Sample".to_string(),
            category: "Workspace".to_string(),
            repo_path: None,
            git_url: git_url.to_string(),
            deploy_targets: Vec::new(),
            jobs: Jobs::default(),
            dev: None,
            build: None,
            focus: ProjectFocusConfig::default(),
            branch_rules: BranchRules::default(),
            debug_profiles: Vec::new(),
        }
    }

    fn run_git(path: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(path)
            .args(args)
            .status()
            .expect("run git");
        assert!(status.success(), "git command failed: {args:?}");
    }

    #[test]
    fn missing_instance_status_is_structured_without_running_git() {
        let instance = ProjectWorkspaceProjectInstanceConfig {
            project: "sample".to_string(),
            path: std::env::temp_dir().join("rdevtool-missing-instance-status"),
            managed: true,
        };
        let status = instance_status(Some(project("")), instance, true);
        assert_eq!(status.status_key, "missing");
        assert!(!status.can_open);
        assert!(status.managed);
        assert!(!status.repair_supported);
    }

    #[test]
    fn missing_managed_registered_worktree_exposes_repair_evidence() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "rdevtool-workspace-repair-status-{}-{suffix}",
            std::process::id()
        ));
        let repo = root.join("repo");
        let worktree = root.join("feature-copy");
        fs::create_dir_all(&repo).expect("create repository");
        run_git(&repo, &["init"]);
        run_git(&repo, &["config", "user.email", "rdevtool@example.test"]);
        run_git(&repo, &["config", "user.name", "rDevTool Test"]);
        run_git(&repo, &["commit", "--allow-empty", "-m", "initial"]);
        run_git(
            &repo,
            &[
                "worktree",
                "add",
                "-b",
                "feature/repair",
                worktree.to_string_lossy().as_ref(),
            ],
        );
        fs::remove_dir_all(&worktree).expect("remove worktree directory only");

        let mut configured_project = project("");
        configured_project.repo_path = Some(repo.clone());
        let managed = instance_status(
            Some(configured_project.clone()),
            ProjectWorkspaceProjectInstanceConfig {
                project: "sample".to_string(),
                path: worktree.clone(),
                managed: true,
            },
            true,
        );
        assert!(managed.repair_supported);
        assert_eq!(managed.repair_branch.as_deref(), Some("feature/repair"));

        let archived = instance_status(
            Some(configured_project.clone()),
            ProjectWorkspaceProjectInstanceConfig {
                project: "sample".to_string(),
                path: worktree.clone(),
                managed: true,
            },
            false,
        );
        assert!(!archived.repair_supported);

        let referenced = instance_status(
            Some(configured_project),
            ProjectWorkspaceProjectInstanceConfig {
                project: "sample".to_string(),
                path: worktree,
                managed: false,
            },
            true,
        );
        assert!(!referenced.repair_supported);
        assert!(referenced.repair_branch.is_none());

        let configured_project = {
            let mut value = project("");
            value.repo_path = Some(repo.clone());
            value
        };
        let config = AppConfig {
            defaults: Defaults {
                jenkins_profiles: BTreeMap::new(),
                jenkins_base_url: String::new(),
                jenkins_username: String::new(),
                jenkins_password: None,
                jenkins_password_env: String::new(),
                jenkins_password_fallback_file: None,
                gitlab_api_base_url: None,
                gitlab_token_env: String::new(),
                gitlab_token: None,
                branch_rules: BranchRules::default(),
                runtime_profiles: Vec::new(),
            },
            projects: vec![configured_project],
        };
        let mut workspace = ProjectWorkspaceConfig {
            key: "feature-repair".to_string(),
            name: "Feature Repair".to_string(),
            ..ProjectWorkspaceConfig::default()
        };
        workspace.project_instances = vec![ProjectWorkspaceProjectInstanceConfig {
            project: "sample".to_string(),
            path: root.join("feature-copy"),
            managed: true,
        }];
        let repaired = repair_managed_project_instance(&config, &workspace, "sample")
            .expect("repair registered managed worktree");
        assert_eq!(repaired.current_branch, "feature/repair");
        assert!(Path::new(&repaired.repo_path).is_dir());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn remote_mismatch_requires_explicit_allowance_and_redacts_credentials() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "rdevtool-workspace-binding-{}-{suffix}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create repository");
        run_git(&root, &["init"]);
        run_git(
            &root,
            &[
                "remote",
                "add",
                "origin",
                "https://user:observed-secret@example.com/team/actual.git",
            ],
        );
        let project =
            project("https://configured-user:configured-secret@example.com/team/expected.git");

        let blocked = validate_project_instance_binding(&project, &root, false)
            .expect_err("mismatched remote should be blocked");
        assert_eq!(blocked, "所选目录的 Git Remote 与项目配置不一致");
        assert!(!blocked.contains("secret"));

        let allowed = validate_project_instance_binding(&project, &root, true)
            .expect("explicit mismatch allowance should validate");
        assert!(allowed.requires_remote_mismatch_confirmation);
        assert_eq!(
            allowed.configured_remote.as_deref(),
            Some("example.com/team/expected")
        );
        assert_eq!(allowed.observed_remote_count, 1);
        assert!(!format!("{allowed:?}").contains("secret"));
        let _ = fs::remove_dir_all(root);
    }
}
