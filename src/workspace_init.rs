use anyhow::{Context, Result, bail};
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use crate::config::{
    AppConfig, ConfigPaths, CreateProjectWorkspaceRequest, ProjectConfig, ProjectWorkspaceConfig,
    ProjectWorkspaceProjectInstanceConfig, ProjectWorkspaceResourceCategoryConfig,
    ProjectWorkspaceResourceEntryConfig, activate_project_workspace, build_project_workspace,
    default_project_workspace_root_dir, normalize_project_workspace_key,
    save_project_workspace_config,
};
use crate::git;
use crate::navigation::validate_workspace_resource_entry;
use crate::operation::{
    ManagedArtifact, OperationEvidence, OperationRisk, OperationStatus, RecommendedAction,
};
use crate::workspace_instance::{
    WorkspaceProjectInstanceValidation, validate_workspace_project_instance,
};
use crate::workspace_resources::{
    WorkspaceResourceStatus, materialize_workspace_resources, plan_workspace_resources,
    resolve_workspace_resource_dir,
};

const DEFAULT_DEMAND_WORKSPACE_TYPE: &str = "business";
const DEFAULT_REQUIREMENT_CATEGORY: &str = "需求资料";
const DEFAULT_REQUIREMENT_SHORT_LABEL: &str = "需求";
const DEFAULT_REQUIREMENT_ENTRY_NAME: &str = "需求目录";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum InitDemandWorkspaceCopyMode {
    Existing,
    Worktree,
    Clone,
}

impl InitDemandWorkspaceCopyMode {
    pub fn key(self) -> &'static str {
        match self {
            Self::Existing => "existing",
            Self::Worktree => "worktree",
            Self::Clone => "clone",
        }
    }

    fn managed(self) -> bool {
        self != Self::Existing
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum InitDemandWorkspaceDependencyMode {
    None,
    AutoLink,
}

impl InitDemandWorkspaceDependencyMode {
    pub fn key(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::AutoLink => "auto-link",
        }
    }
}

#[derive(Debug, Clone)]
pub struct InitDemandWorkspaceRequest {
    pub key: Option<String>,
    pub demand_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub workspace_type: Option<String>,
    pub requirement_dir: PathBuf,
    pub repo_path: Option<PathBuf>,
    pub project: Option<String>,
    pub branch: Option<String>,
    pub root_dir: Option<PathBuf>,
    pub instance_dir: Option<PathBuf>,
    pub copy_mode: InitDemandWorkspaceCopyMode,
    pub dependency_mode: InitDemandWorkspaceDependencyMode,
    pub resource_dir: Option<PathBuf>,
    pub worklog_file: Option<PathBuf>,
    pub create_worklog: bool,
    pub worklog_auto_record: bool,
    pub requirement_category: Option<String>,
    pub requirement_short_label: Option<String>,
    pub requirement_entry_name: Option<String>,
    pub activate: bool,
    pub allow_remote_mismatch: bool,
    pub dry_run: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitDemandWorkspaceResult {
    pub schema_version: u32,
    pub dry_run: bool,
    pub copy_mode: InitDemandWorkspaceCopyMode,
    pub dependency_mode: InitDemandWorkspaceDependencyMode,
    pub requested: InitDemandWorkspaceRequested,
    pub effective: InitDemandWorkspaceEffective,
    pub observed: InitDemandWorkspaceObserved,
    pub status: OperationStatus,
    pub evidence: Vec<OperationEvidence>,
    pub risks: Vec<OperationRisk>,
    pub managed_artifacts: Vec<ManagedArtifact>,
    pub recommended_actions: Vec<RecommendedAction>,
    pub planned_actions: Vec<InitDemandWorkspaceAction>,
    pub key: String,
    pub name: String,
    pub demand_id: Option<String>,
    pub workspace: ProjectWorkspaceConfig,
    pub project: InitDemandWorkspaceProject,
    pub requirement_entry: InitDemandWorkspaceRequirementEntry,
    pub resources: WorkspaceResourceStatus,
    pub branch: InitDemandWorkspaceBranch,
    pub metadata: BTreeMap<String, String>,
    pub warnings: Vec<String>,
    pub source_repository_validation: Option<WorkspaceProjectInstanceValidation>,
    pub project_instance_validation: Option<WorkspaceProjectInstanceValidation>,
    pub dependency_links: Vec<InitDemandWorkspaceDependencyLink>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitDemandWorkspaceRequested {
    pub copy_mode: String,
    pub dependency_mode: String,
    pub source_repo_path: Option<String>,
    pub instance_dir: Option<String>,
    pub branch: Option<String>,
    pub activate: bool,
    pub dry_run: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitDemandWorkspaceEffective {
    pub workspace_key: String,
    pub project_key: String,
    pub copy_mode: String,
    pub dependency_mode: String,
    pub root_dir: String,
    pub source_repo_path: Option<String>,
    pub instance_dir: String,
    pub branch: Option<String>,
    pub resource_dir: String,
    pub worklog_path: String,
    pub activate: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitDemandWorkspaceObserved {
    pub source_repo_exists: Option<bool>,
    pub source_repo_branch: Option<String>,
    pub workspace_root_existed_before: bool,
    pub workspace_root_exists_after: bool,
    pub instance_dir_existed_before: bool,
    pub instance_dir_exists_after: bool,
    pub workspace_config_existed_before: bool,
    pub workspace_config_exists_after: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitDemandWorkspaceAction {
    pub key: String,
    pub label: String,
    pub target: String,
    pub mutates: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitDemandWorkspaceDependencyLink {
    pub relative_dir: String,
    pub lock_file: String,
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitDemandWorkspaceProject {
    pub key: String,
    pub name: String,
    pub repo_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitDemandWorkspaceRequirementEntry {
    pub category: String,
    pub short_label: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitDemandWorkspaceBranch {
    pub expected: Option<String>,
    pub current: Option<String>,
    pub matches: Option<bool>,
}

pub fn init_demand_workspace(
    paths: &ConfigPaths,
    config: &AppConfig,
    request: InitDemandWorkspaceRequest,
) -> Result<InitDemandWorkspaceResult> {
    let name = require_non_empty("workspace name", &request.name)?;
    let requirement_dir = normalize_path_buf(request.requirement_dir)?;
    ensure_directory("requirement directory", &requirement_dir)?;
    let requested_repo_path = request.repo_path.map(normalize_path_buf).transpose()?;
    let project = resolve_project_for_request(
        config,
        request.project.as_deref(),
        requested_repo_path.as_deref(),
    )?;
    let source_repo_path =
        resolve_source_repo_path(&project, requested_repo_path.clone(), request.copy_mode)?;
    if let Some(source_repo_path) = source_repo_path.as_ref() {
        ensure_directory("source repo path", source_repo_path)?;
    }
    if request.copy_mode == InitDemandWorkspaceCopyMode::Clone && project.git_url.trim().is_empty()
    {
        bail!("project {} has no git_url for clone mode", project.key);
    }
    let demand_id = request
        .demand_id
        .as_deref()
        .and_then(normalize_optional_text)
        .or_else(|| {
            extract_demand_id([
                Some(name.as_str()),
                request.branch.as_deref(),
                Some(project.git_url.as_str()),
                source_repo_path
                    .as_ref()
                    .and_then(|path| path.file_name())
                    .and_then(|value| value.to_str()),
            ])
        });
    let key = resolve_workspace_key(
        request.key.as_deref(),
        demand_id.as_deref(),
        request.branch.as_deref(),
        &name,
    )?;
    let root_dir = request
        .root_dir
        .map(normalize_path_buf)
        .transpose()?
        .unwrap_or_else(|| default_project_workspace_root_dir(&key));
    let requested_instance_dir = request.instance_dir.clone();
    let instance_dir = resolve_instance_dir(
        request.copy_mode,
        source_repo_path.as_deref(),
        request.instance_dir,
        &root_dir,
        &project.key,
    )?;
    validate_instance_destination(
        request.copy_mode,
        &root_dir,
        &instance_dir,
        source_repo_path.as_deref(),
    )?;
    let effective_dependency_mode = if request.copy_mode.managed() {
        request.dependency_mode
    } else {
        InitDemandWorkspaceDependencyMode::None
    };
    let workspace_type = request
        .workspace_type
        .as_deref()
        .and_then(normalize_optional_text)
        .unwrap_or_else(|| DEFAULT_DEMAND_WORKSPACE_TYPE.to_string());
    let branch_expected = request.branch.as_deref().and_then(normalize_optional_text);
    if request.copy_mode.managed() && branch_expected.is_none() {
        bail!(
            "--branch is required when --copy-mode is {}",
            request.copy_mode.key()
        );
    }
    if request.copy_mode == InitDemandWorkspaceCopyMode::Worktree
        && let (Some(source_repo_path), Some(branch)) =
            (source_repo_path.as_deref(), branch_expected.as_deref())
        && let Some(occupied_path) = git::branch_worktree_path(source_repo_path, branch)?
    {
        bail!(
            "branch {branch} is already checked out at {}; use existing mode for that directory or release the branch before creating a managed worktree",
            occupied_path.display()
        );
    }
    let source_repo_branch = source_repo_path
        .as_ref()
        .map(|repo_path| {
            git::current_branch(repo_path).with_context(|| {
                format!(
                    "failed to inspect current branch for {}",
                    repo_path.display()
                )
            })
        })
        .transpose()?;
    let source_validation = source_repo_path
        .as_ref()
        .map(|repo_path| {
            validate_workspace_project_instance(
                &project,
                &ProjectWorkspaceProjectInstanceConfig {
                    project: project.key.clone(),
                    path: repo_path.clone(),
                    managed: false,
                },
                request.allow_remote_mismatch,
            )
        })
        .transpose()?;
    let mut project_instance_validation = (request.copy_mode
        == InitDemandWorkspaceCopyMode::Existing)
        .then(|| source_validation.clone())
        .flatten();
    let source_repository_validation = request
        .copy_mode
        .managed()
        .then_some(source_validation)
        .flatten();
    let mut branch_current = if request.copy_mode == InitDemandWorkspaceCopyMode::Existing {
        source_repo_branch.clone()
    } else {
        None
    };
    let mut branch_matches = branch_expected
        .as_ref()
        .zip(branch_current.as_ref())
        .map(|(expected, current)| expected == current);
    let description = request
        .description
        .as_deref()
        .and_then(normalize_optional_text)
        .or_else(|| default_description(&name, branch_expected.as_deref()));

    let activate = request.activate;
    let mut workspace = build_project_workspace(
        paths,
        CreateProjectWorkspaceRequest {
            key: key.clone(),
            name: name.clone(),
            description,
            workspace_type: Some(workspace_type),
            root_dir: Some(root_dir.clone()),
            copy_from: None,
            activate: false,
        },
    )?;

    workspace.include_all_projects = false;
    workspace.include_all_navigation = false;
    workspace.projects = vec![project.key.clone()];
    workspace.navigation_categories.clear();
    workspace.navigation_entries.clear();
    workspace.project_instances = vec![ProjectWorkspaceProjectInstanceConfig {
        project: project.key.clone(),
        path: instance_dir.clone(),
        managed: request.copy_mode.managed(),
    }];
    let mut metadata = BTreeMap::new();
    metadata.insert("kind".to_string(), "demand".to_string());
    metadata.insert("primaryProject".to_string(), project.key.clone());
    metadata.insert("copyMode".to_string(), request.copy_mode.key().to_string());
    metadata.insert(
        "dependencyMode".to_string(),
        effective_dependency_mode.key().to_string(),
    );
    metadata.insert(
        "requirementDir".to_string(),
        requirement_dir.display().to_string(),
    );
    metadata.insert("repoPath".to_string(), instance_dir.display().to_string());
    if let Some(source_repo_path) = source_repo_path.as_ref() {
        metadata.insert(
            "sourceRepoPath".to_string(),
            source_repo_path.display().to_string(),
        );
    }
    if let Some(demand_id) = demand_id.as_ref() {
        metadata.insert("demandId".to_string(), demand_id.clone());
    }
    if let Some(branch) = branch_expected.as_ref() {
        metadata.insert("targetBranch".to_string(), branch.clone());
    }
    workspace.metadata = metadata.clone();
    workspace.worklog_auto_record = request.worklog_auto_record;

    let requirement_category = request
        .requirement_category
        .as_deref()
        .and_then(normalize_optional_text)
        .unwrap_or_else(|| DEFAULT_REQUIREMENT_CATEGORY.to_string());
    let requirement_short_label = request
        .requirement_short_label
        .as_deref()
        .and_then(normalize_optional_text)
        .unwrap_or_else(|| DEFAULT_REQUIREMENT_SHORT_LABEL.to_string());
    let requirement_entry_name = request
        .requirement_entry_name
        .as_deref()
        .and_then(normalize_optional_text)
        .unwrap_or_else(|| DEFAULT_REQUIREMENT_ENTRY_NAME.to_string());
    let requirement_entry = ProjectWorkspaceResourceEntryConfig {
        name: requirement_entry_name.clone(),
        kind: Some("directory".to_string()),
        url: String::new(),
        browser: None,
        browser_profile: None,
        runtime_profile: None,
        bundle_id: None,
        app_name: None,
        script: None,
        tool: None,
        tool_key: None,
        tool_action: None,
        path: Some(requirement_dir.display().to_string()),
        cwd: None,
        note: Some(format!("{name} 需求目录")),
    };
    validate_workspace_resource_entry(&requirement_entry, workspace.root_dir.as_deref())?;
    workspace.resource_categories = vec![ProjectWorkspaceResourceCategoryConfig {
        title: requirement_category.clone(),
        short_label: Some(requirement_short_label.clone()),
        entries: vec![requirement_entry],
    }];
    workspace = workspace.normalized();
    let (workspace, resources) = plan_workspace_resources(
        workspace,
        request.resource_dir.clone(),
        request.worklog_file.clone(),
    )?;
    validate_managed_path_separation(request.copy_mode, &instance_dir, &resources)?;
    let workspace_path = paths
        .project_workspaces
        .join(format!("{}.toml", workspace.key));
    let root_existed = root_dir.exists();
    let instance_dir_existed = instance_dir.exists();
    let workspace_config_existed = workspace_path.exists();
    let resource_dir = resolve_workspace_resource_dir(&workspace, None)?;
    let resource_dir_existed = resource_dir.exists();
    let requested = InitDemandWorkspaceRequested {
        copy_mode: request.copy_mode.key().to_string(),
        dependency_mode: request.dependency_mode.key().to_string(),
        source_repo_path: requested_repo_path
            .as_ref()
            .map(|path| path.display().to_string()),
        instance_dir: requested_instance_dir
            .as_ref()
            .map(|path| path.display().to_string()),
        branch: request.branch.as_deref().and_then(normalize_optional_text),
        activate,
        dry_run: request.dry_run,
    };
    let effective = InitDemandWorkspaceEffective {
        workspace_key: workspace.key.clone(),
        project_key: project.key.clone(),
        copy_mode: request.copy_mode.key().to_string(),
        dependency_mode: effective_dependency_mode.key().to_string(),
        root_dir: root_dir.display().to_string(),
        source_repo_path: source_repo_path
            .as_ref()
            .map(|path| path.display().to_string()),
        instance_dir: instance_dir.display().to_string(),
        branch: branch_expected.clone(),
        resource_dir: resources.resource_dir.clone(),
        worklog_path: resources.worklog_path.clone(),
        activate,
    };
    let planned_actions = init_demand_planned_actions(
        request.copy_mode,
        effective_dependency_mode,
        &workspace_path,
        &root_dir,
        &instance_dir,
        &resources,
        activate,
    );
    let mut warnings = branch_warnings(
        branch_expected.as_deref(),
        branch_current.as_deref(),
        branch_matches,
    );
    if request.copy_mode == InitDemandWorkspaceCopyMode::Existing
        && project
            .repo_path
            .as_ref()
            .is_some_and(|path| !same_path(path, &instance_dir))
    {
        warnings.push(format!(
            "project {} is configured with a different repo path; workspace instance uses {}",
            project.key,
            instance_dir.display()
        ));
    }
    let mut evidence = init_demand_evidence(
        source_repository_validation
            .as_ref()
            .or(project_instance_validation.as_ref()),
        &instance_dir,
        instance_dir_existed,
        request.dry_run,
    );
    let mut risks = init_demand_risks(&warnings);
    if request.dry_run && request.copy_mode.managed() {
        risks.push(OperationRisk {
            code: "remote_branch_not_probed".to_string(),
            severity: "info".to_string(),
            detail: "dry-run 不执行网络 fetch；远端分支可用性会在正式创建副本时验证".to_string(),
        });
    }
    if request.dry_run {
        return Ok(InitDemandWorkspaceResult {
            schema_version: 2,
            dry_run: true,
            copy_mode: request.copy_mode,
            dependency_mode: effective_dependency_mode,
            requested,
            effective,
            observed: InitDemandWorkspaceObserved {
                source_repo_exists: source_repo_path.as_ref().map(|path| path.exists()),
                source_repo_branch,
                workspace_root_existed_before: root_existed,
                workspace_root_exists_after: root_existed,
                instance_dir_existed_before: instance_dir_existed,
                instance_dir_exists_after: instance_dir_existed,
                workspace_config_existed_before: workspace_config_existed,
                workspace_config_exists_after: workspace_config_existed,
            },
            status: OperationStatus {
                key: "planned".to_string(),
                label: "计划已生成".to_string(),
                success: true,
                terminal: true,
                detail: "已完成本地校验；未创建目录、Git 副本、配置或工作日志".to_string(),
            },
            evidence,
            risks,
            managed_artifacts: Vec::new(),
            recommended_actions: vec![RecommendedAction {
                command: "workspace init-demand（移除 --dry-run）".to_string(),
                reason: "确认 requested/effective/observed 后执行同一计划".to_string(),
                risk: "write-local-workspace".to_string(),
            }],
            planned_actions,
            key: workspace.key.clone(),
            name: workspace.name.clone(),
            demand_id,
            workspace,
            project: InitDemandWorkspaceProject {
                key: project.key.clone(),
                name: project.name.clone(),
                repo_path: instance_dir.display().to_string(),
            },
            requirement_entry: InitDemandWorkspaceRequirementEntry {
                category: requirement_category,
                short_label: requirement_short_label,
                name: requirement_entry_name,
                path: requirement_dir.display().to_string(),
            },
            resources,
            branch: InitDemandWorkspaceBranch {
                expected: branch_expected,
                current: branch_current,
                matches: branch_matches,
            },
            metadata,
            warnings,
            source_repository_validation,
            project_instance_validation,
            dependency_links: Vec::new(),
        });
    }

    let mut created_worklog = None;
    let mut managed_checkout_created = false;
    let prepared = (|| -> Result<(ProjectWorkspaceConfig, WorkspaceResourceStatus)> {
        fs::create_dir_all(&root_dir).with_context(|| {
            format!(
                "failed to create project workspace root: {}",
                root_dir.display()
            )
        })?;
        match request.copy_mode {
            InitDemandWorkspaceCopyMode::Existing => {}
            InitDemandWorkspaceCopyMode::Worktree => {
                let source_repo_path = source_repo_path.as_deref().with_context(|| {
                    format!("source repository is required for project {}", project.key)
                })?;
                git::add_managed_worktree_from_branch(
                    source_repo_path,
                    branch_expected.as_deref().unwrap_or_default(),
                    &instance_dir,
                )?;
                managed_checkout_created = true;
            }
            InitDemandWorkspaceCopyMode::Clone => {
                git::clone_branch_to_directory(
                    &project.git_url,
                    branch_expected.as_deref().unwrap_or_default(),
                    &instance_dir,
                )?;
                managed_checkout_created = true;
            }
        }
        project_instance_validation = Some(validate_workspace_project_instance(
            &project,
            &ProjectWorkspaceProjectInstanceConfig {
                project: project.key.clone(),
                path: instance_dir.clone(),
                managed: request.copy_mode.managed(),
            },
            request.allow_remote_mismatch,
        )?);
        branch_current = Some(git::current_branch(&instance_dir).with_context(|| {
            format!(
                "failed to inspect current branch for {}",
                instance_dir.display()
            )
        })?);
        branch_matches = branch_expected
            .as_ref()
            .zip(branch_current.as_ref())
            .map(|(expected, current)| expected == current);
        let (workspace, resources) =
            materialize_workspace_resources(workspace, None, None, request.create_worklog)?;
        if resources.worklog_created {
            created_worklog = Some(PathBuf::from(&resources.worklog_path));
        }
        save_project_workspace_config(&workspace_path, &workspace)?;
        if activate {
            activate_project_workspace(paths, &workspace.key)?;
        }
        Ok((workspace, resources))
    })();
    let (workspace, resources) = match prepared {
        Ok(result) => result,
        Err(error) => {
            let cleanup_warnings = rollback_failed_workspace_init(WorkspaceInitRollback {
                workspace_path: &workspace_path,
                root_dir: &root_dir,
                root_existed,
                resource_dir: &resource_dir,
                resource_dir_existed,
                created_worklog: created_worklog.as_deref(),
                copy_mode: request.copy_mode,
                source_repo_path: source_repo_path.as_deref(),
                instance_dir: &instance_dir,
                managed_checkout_created,
            });
            if cleanup_warnings.is_empty() {
                return Err(error);
            }
            return Err(error.context(format!(
                "workspace initialization rollback warnings: {}",
                cleanup_warnings.join("; ")
            )));
        }
    };

    warnings = branch_warnings(
        branch_expected.as_deref(),
        branch_current.as_deref(),
        branch_matches,
    );
    let mut dependency_links = Vec::new();
    if request.copy_mode.managed()
        && effective_dependency_mode == InitDemandWorkspaceDependencyMode::AutoLink
    {
        if let Some(source_repo_path) = source_repo_path.as_deref() {
            match auto_link_workspace_dependencies(source_repo_path, &instance_dir) {
                Ok(outcome) => {
                    dependency_links = outcome.links;
                    warnings.extend(outcome.warnings);
                }
                Err(error) => warnings.push(format!("依赖复用未完成：{error}")),
            }
        } else {
            warnings.push("依赖复用已跳过：未提供可复用依赖的源仓库目录".to_string());
        }
    }
    risks = init_demand_risks(&warnings);
    if let Some(validation) = project_instance_validation.as_ref() {
        evidence.push(OperationEvidence {
            kind: "git-project-instance".to_string(),
            source: validation.effective_path.clone(),
            detail: "项目实例目录和 Git remote 已验证".to_string(),
        });
    }
    let mut managed_artifacts = vec![ManagedArtifact {
        kind: "workspace-config".to_string(),
        path: workspace_path.display().to_string(),
        ownership: "rdevtool".to_string(),
        lifecycle: "workspace".to_string(),
    }];
    if !root_existed {
        managed_artifacts.push(ManagedArtifact {
            kind: "workspace-root".to_string(),
            path: root_dir.display().to_string(),
            ownership: "rdevtool".to_string(),
            lifecycle: "workspace".to_string(),
        });
    }
    if request.copy_mode.managed() {
        managed_artifacts.push(ManagedArtifact {
            kind: request.copy_mode.key().to_string(),
            path: instance_dir.display().to_string(),
            ownership: "rdevtool".to_string(),
            lifecycle: "workspace".to_string(),
        });
    }
    if !resource_dir_existed {
        managed_artifacts.push(ManagedArtifact {
            kind: "resource-directory".to_string(),
            path: resources.resource_dir.clone(),
            ownership: "rdevtool".to_string(),
            lifecycle: "workspace".to_string(),
        });
    }
    if resources.worklog_created {
        managed_artifacts.push(ManagedArtifact {
            kind: "worklog".to_string(),
            path: resources.worklog_path.clone(),
            ownership: "rdevtool".to_string(),
            lifecycle: "workspace".to_string(),
        });
    }
    for link in &dependency_links {
        managed_artifacts.push(ManagedArtifact {
            kind: "dependency-link".to_string(),
            path: link.target.clone(),
            ownership: "rdevtool".to_string(),
            lifecycle: "workspace".to_string(),
        });
        evidence.push(OperationEvidence {
            kind: "dependency-lock-match".to_string(),
            source: link.lock_file.clone(),
            detail: format!("锁文件一致，已安全复用依赖：{}", link.relative_dir),
        });
    }

    Ok(InitDemandWorkspaceResult {
        schema_version: 2,
        dry_run: false,
        copy_mode: request.copy_mode,
        dependency_mode: effective_dependency_mode,
        requested,
        effective,
        observed: InitDemandWorkspaceObserved {
            source_repo_exists: source_repo_path.as_ref().map(|path| path.exists()),
            source_repo_branch,
            workspace_root_existed_before: root_existed,
            workspace_root_exists_after: root_dir.exists(),
            instance_dir_existed_before: instance_dir_existed,
            instance_dir_exists_after: instance_dir.exists(),
            workspace_config_existed_before: workspace_config_existed,
            workspace_config_exists_after: workspace_path.exists(),
        },
        status: OperationStatus {
            key: "created".to_string(),
            label: "工作区已创建".to_string(),
            success: true,
            terminal: true,
            detail: format!(
                "已使用 {} 模式创建工作区 {}",
                request.copy_mode.key(),
                workspace.key
            ),
        },
        evidence,
        risks,
        managed_artifacts,
        recommended_actions: Vec::new(),
        planned_actions,
        key: workspace.key.clone(),
        name: workspace.name.clone(),
        demand_id,
        workspace,
        project: InitDemandWorkspaceProject {
            key: project.key.clone(),
            name: project.name.clone(),
            repo_path: instance_dir.display().to_string(),
        },
        requirement_entry: InitDemandWorkspaceRequirementEntry {
            category: requirement_category,
            short_label: requirement_short_label,
            name: requirement_entry_name,
            path: requirement_dir.display().to_string(),
        },
        resources,
        branch: InitDemandWorkspaceBranch {
            expected: branch_expected,
            current: branch_current,
            matches: branch_matches,
        },
        metadata,
        warnings,
        source_repository_validation,
        project_instance_validation,
        dependency_links,
    })
}

struct WorkspaceInitRollback<'a> {
    workspace_path: &'a Path,
    root_dir: &'a Path,
    root_existed: bool,
    resource_dir: &'a Path,
    resource_dir_existed: bool,
    created_worklog: Option<&'a Path>,
    copy_mode: InitDemandWorkspaceCopyMode,
    source_repo_path: Option<&'a Path>,
    instance_dir: &'a Path,
    managed_checkout_created: bool,
}

fn rollback_failed_workspace_init(context: WorkspaceInitRollback<'_>) -> Vec<String> {
    let WorkspaceInitRollback {
        workspace_path,
        root_dir,
        root_existed,
        resource_dir,
        resource_dir_existed,
        created_worklog,
        copy_mode,
        source_repo_path,
        instance_dir,
        managed_checkout_created,
    } = context;
    let mut warnings = Vec::new();
    remove_created_file(workspace_path, &mut warnings);
    if let Some(worklog) = created_worklog {
        remove_created_file(worklog, &mut warnings);
    }

    let managed_checkout_present =
        copy_mode.managed() && (managed_checkout_created || instance_dir.exists());
    let mut checkout_cleanup_failed = false;
    if managed_checkout_present {
        match copy_mode {
            InitDemandWorkspaceCopyMode::Existing => {}
            InitDemandWorkspaceCopyMode::Worktree => {
                let cleanup = source_repo_path
                    .with_context(|| "source repository is missing during worktree rollback")
                    .and_then(|repo_path| git::remove_managed_worktree(repo_path, instance_dir));
                if let Err(error) = cleanup {
                    checkout_cleanup_failed = true;
                    warnings.push(error.to_string());
                }
            }
            InitDemandWorkspaceCopyMode::Clone => {
                if instance_dir.exists()
                    && let Err(error) = fs::remove_dir_all(instance_dir)
                {
                    checkout_cleanup_failed = true;
                    warnings.push(format!(
                        "failed to remove managed clone {}: {}",
                        instance_dir.display(),
                        error
                    ));
                }
            }
        }
    }

    let removed_root = if !root_existed && !checkout_cleanup_failed {
        if root_dir.exists()
            && let Err(error) = fs::remove_dir_all(root_dir)
        {
            warnings.push(format!(
                "failed to remove created workspace root {}: {}",
                root_dir.display(),
                error
            ));
        }
        !root_dir.exists()
    } else {
        false
    };
    let resource_was_inside_removed_root = removed_root && resource_dir.starts_with(root_dir);
    if !resource_was_inside_removed_root
        && !resource_dir_existed
        && resource_dir.exists()
        && let Err(error) = fs::remove_dir(resource_dir)
    {
        warnings.push(format!(
            "failed to remove created resource directory {}: {}",
            resource_dir.display(),
            error
        ));
    }
    warnings
}

fn remove_created_file(path: &Path, warnings: &mut Vec<String>) {
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => warnings.push(format!(
            "failed to remove created file {}: {}",
            path.display(),
            error
        )),
    }
}

fn resolve_project_for_request(
    config: &AppConfig,
    project_key: Option<&str>,
    repo_path: Option<&Path>,
) -> Result<ProjectConfig> {
    if let Some(project_key) = project_key.and_then(normalize_optional_text) {
        let project = config
            .projects
            .iter()
            .find(|project| project.key == project_key)
            .with_context(|| format!("project not found: {project_key}"))?;
        return Ok(project.clone());
    }

    let repo_path = repo_path.with_context(
        || "--repo-path is required when --project is omitted so the project can be resolved",
    )?;
    let matches = config
        .projects
        .iter()
        .filter(|project| {
            project
                .repo_path
                .as_ref()
                .is_some_and(|candidate| same_path(candidate, repo_path))
        })
        .cloned()
        .collect::<Vec<_>>();

    match matches.as_slice() {
        [project] => Ok(project.clone()),
        [] => bail!(
            "no project configured for repo path {}; provide --project or add the project first",
            repo_path.display()
        ),
        _ => bail!(
            "multiple projects match repo path {}; provide --project",
            repo_path.display()
        ),
    }
}

fn resolve_source_repo_path(
    project: &ProjectConfig,
    requested_repo_path: Option<PathBuf>,
    copy_mode: InitDemandWorkspaceCopyMode,
) -> Result<Option<PathBuf>> {
    if copy_mode == InitDemandWorkspaceCopyMode::Clone {
        return Ok(requested_repo_path);
    }
    requested_repo_path
        .or_else(|| project.repo_path.clone())
        .map(normalize_path_buf)
        .transpose()?
        .map(Some)
        .with_context(|| {
            format!(
                "--repo-path or project repo_path is required when --copy-mode is {}",
                copy_mode.key()
            )
        })
}

fn resolve_instance_dir(
    copy_mode: InitDemandWorkspaceCopyMode,
    source_repo_path: Option<&Path>,
    requested_instance_dir: Option<PathBuf>,
    root_dir: &Path,
    project_key: &str,
) -> Result<PathBuf> {
    if copy_mode == InitDemandWorkspaceCopyMode::Existing {
        if requested_instance_dir.is_some() {
            bail!("--instance-dir is only valid with --copy-mode worktree or clone");
        }
        return source_repo_path
            .map(Path::to_path_buf)
            .with_context(|| "existing mode requires a source repository path");
    }
    requested_instance_dir
        .map(normalize_path_buf)
        .transpose()
        .map(|path| path.unwrap_or_else(|| root_dir.join(project_key)))
}

fn validate_instance_destination(
    copy_mode: InitDemandWorkspaceCopyMode,
    root_dir: &Path,
    instance_dir: &Path,
    source_repo_path: Option<&Path>,
) -> Result<()> {
    if copy_mode == InitDemandWorkspaceCopyMode::Existing {
        return Ok(());
    }
    if root_dir.exists() && !root_dir.is_dir() {
        bail!("workspace root must be a directory: {}", root_dir.display());
    }
    let parent = instance_dir.parent().with_context(|| {
        format!(
            "managed project instance must have a parent directory: {}",
            instance_dir.display()
        )
    })?;
    if normalized_compare_path(parent) != normalized_compare_path(root_dir) {
        bail!(
            "managed project instance must be a direct child of workspace root {}: {}",
            root_dir.display(),
            instance_dir.display()
        );
    }
    if instance_dir.exists() {
        bail!(
            "managed project instance destination already exists: {}",
            instance_dir.display()
        );
    }
    if let Some(source_repo_path) = source_repo_path {
        let source = normalized_compare_path(source_repo_path);
        let destination = normalized_compare_path(instance_dir);
        if destination.starts_with(&source) || source.starts_with(&destination) {
            bail!(
                "managed project instance must not overlap source repository {}: {}",
                source_repo_path.display(),
                instance_dir.display()
            );
        }
    }
    Ok(())
}

fn validate_managed_path_separation(
    copy_mode: InitDemandWorkspaceCopyMode,
    instance_dir: &Path,
    resources: &WorkspaceResourceStatus,
) -> Result<()> {
    if !copy_mode.managed() {
        return Ok(());
    }
    let instance = normalized_compare_path(instance_dir);
    let resource = normalized_compare_path(Path::new(&resources.resource_dir));
    if instance.starts_with(&resource) || resource.starts_with(&instance) {
        bail!(
            "managed project instance and resource directory must not overlap: {} and {}",
            instance_dir.display(),
            resources.resource_dir
        );
    }
    Ok(())
}

const DEPENDENCY_LOCK_FILES: [&str; 6] = [
    "package-lock.json",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
];
const DEPENDENCY_SCAN_MAX_DEPTH: usize = 4;

struct DependencyLinkOutcome {
    links: Vec<InitDemandWorkspaceDependencyLink>,
    warnings: Vec<String>,
}

fn auto_link_workspace_dependencies(
    source_repo: &Path,
    instance_dir: &Path,
) -> Result<DependencyLinkOutcome> {
    let mut candidates = Vec::new();
    collect_dependency_lock_dirs(instance_dir, instance_dir, 0, &mut candidates)?;
    let mut outcome = DependencyLinkOutcome {
        links: Vec::new(),
        warnings: Vec::new(),
    };

    for (relative_dir, lock_name) in candidates {
        let source_dir = source_repo.join(&relative_dir);
        let target_dir = instance_dir.join(&relative_dir);
        let source_lock = source_dir.join(&lock_name);
        let target_lock = target_dir.join(&lock_name);
        let source_dependencies = source_dir.join("node_modules");
        let target_dependencies = target_dir.join("node_modules");
        let display_dir = display_relative_dir(&relative_dir);

        if !source_dependencies.is_dir() {
            outcome.warnings.push(format!(
                "依赖复用已跳过（{display_dir}）：源项目没有 node_modules"
            ));
            continue;
        }
        if !source_lock.is_file() {
            outcome.warnings.push(format!(
                "依赖复用已跳过（{display_dir}）：源项目缺少 {lock_name}"
            ));
            continue;
        }
        let source_lock_content = match fs::read(&source_lock) {
            Ok(content) => content,
            Err(error) => {
                outcome.warnings.push(format!(
                    "依赖复用已跳过（{display_dir}）：读取源项目 {lock_name} 失败：{error}"
                ));
                continue;
            }
        };
        let target_lock_content = match fs::read(&target_lock) {
            Ok(content) => content,
            Err(error) => {
                outcome.warnings.push(format!(
                    "依赖复用已跳过（{display_dir}）：读取工作区 {lock_name} 失败：{error}"
                ));
                continue;
            }
        };
        if source_lock_content != target_lock_content {
            outcome.warnings.push(format!(
                "依赖复用已跳过（{display_dir}）：源项目与工作区的 {lock_name} 不一致，请在工作区安装依赖"
            ));
            continue;
        }
        match fs::symlink_metadata(&target_dependencies) {
            Ok(_) => {
                outcome.warnings.push(format!(
                    "依赖复用已跳过（{display_dir}）：工作区 node_modules 已存在"
                ));
                continue;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                outcome.warnings.push(format!(
                    "依赖复用已跳过（{display_dir}）：无法检查工作区 node_modules：{error}"
                ));
                continue;
            }
        }

        let canonical_source = match fs::canonicalize(&source_dependencies) {
            Ok(path) => path,
            Err(error) => {
                outcome.warnings.push(format!(
                    "依赖复用已跳过（{display_dir}）：解析源项目 node_modules 失败：{error}"
                ));
                continue;
            }
        };
        if let Err(error) = create_directory_symlink(&canonical_source, &target_dependencies) {
            outcome.warnings.push(format!(
                "依赖复用已跳过（{display_dir}）：创建 node_modules 链接失败：{error}"
            ));
            continue;
        }
        if let Err(error) = append_dependency_to_local_exclude(instance_dir, &relative_dir) {
            outcome.warnings.push(format!(
                "依赖已复用，但写入 Git 本地忽略失败（{display_dir}）：{error}"
            ));
        }
        outcome.links.push(InitDemandWorkspaceDependencyLink {
            relative_dir: display_dir,
            lock_file: target_lock.display().to_string(),
            source: canonical_source.display().to_string(),
            target: target_dependencies.display().to_string(),
        });
    }

    if outcome.links.is_empty() && outcome.warnings.is_empty() {
        outcome
            .warnings
            .push("未发现可复用依赖的前端锁文件目录".to_string());
    }
    Ok(outcome)
}

fn collect_dependency_lock_dirs(
    root: &Path,
    current: &Path,
    depth: usize,
    output: &mut Vec<(PathBuf, String)>,
) -> Result<()> {
    if depth > DEPENDENCY_SCAN_MAX_DEPTH {
        return Ok(());
    }
    if let Some(lock_name) = DEPENDENCY_LOCK_FILES
        .iter()
        .find(|name| current.join(name).is_file())
    {
        output.push((
            current.strip_prefix(root).unwrap_or(current).to_path_buf(),
            (*lock_name).to_string(),
        ));
    }
    if depth == DEPENDENCY_SCAN_MAX_DEPTH {
        return Ok(());
    }
    let mut entries = fs::read_dir(current)
        .with_context(|| {
            format!(
                "failed to scan dependency directories in {}",
                current.display()
            )
        })?
        .collect::<std::io::Result<Vec<_>>>()?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let name = entry.file_name();
        if matches!(name.to_str(), Some(".git" | "node_modules")) {
            continue;
        }
        let file_type = entry.file_type()?;
        if file_type.is_dir() && !file_type.is_symlink() {
            collect_dependency_lock_dirs(root, &entry.path(), depth + 1, output)?;
        }
    }
    Ok(())
}

fn display_relative_dir(path: &Path) -> String {
    if path.as_os_str().is_empty() {
        ".".to_string()
    } else {
        path.to_string_lossy().replace('\\', "/")
    }
}

fn append_dependency_to_local_exclude(repo_path: &Path, relative_dir: &Path) -> Result<()> {
    let exclude_path = git::local_exclude_path(repo_path)?;
    let relative = display_relative_dir(relative_dir);
    let raw_pattern = if relative == "." {
        "/node_modules".to_string()
    } else {
        format!("/{relative}/node_modules")
    };
    let pattern = raw_pattern
        .replace('\\', "\\\\")
        .replace(' ', "\\ ")
        .replace('#', "\\#")
        .replace('!', "\\!");
    let existing = fs::read_to_string(&exclude_path).unwrap_or_default();
    if existing.lines().any(|line| line.trim() == pattern) {
        return Ok(());
    }
    if let Some(parent) = exclude_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&exclude_path)?;
    if !existing.is_empty() && !existing.ends_with('\n') {
        writeln!(file)?;
    }
    writeln!(file, "{pattern}")?;
    Ok(())
}

#[cfg(unix)]
fn create_directory_symlink(source: &Path, target: &Path) -> Result<()> {
    std::os::unix::fs::symlink(source, target)?;
    Ok(())
}

#[cfg(windows)]
fn create_directory_symlink(source: &Path, target: &Path) -> Result<()> {
    std::os::windows::fs::symlink_dir(source, target)?;
    Ok(())
}

fn init_demand_planned_actions(
    copy_mode: InitDemandWorkspaceCopyMode,
    dependency_mode: InitDemandWorkspaceDependencyMode,
    workspace_path: &Path,
    root_dir: &Path,
    instance_dir: &Path,
    resources: &WorkspaceResourceStatus,
    activate: bool,
) -> Vec<InitDemandWorkspaceAction> {
    let mut actions = vec![InitDemandWorkspaceAction {
        key: "prepare-workspace-root".to_string(),
        label: "准备工作区根目录".to_string(),
        target: root_dir.display().to_string(),
        mutates: true,
    }];
    actions.push(InitDemandWorkspaceAction {
        key: match copy_mode {
            InitDemandWorkspaceCopyMode::Existing => "bind-existing-repository",
            InitDemandWorkspaceCopyMode::Worktree => "create-git-worktree",
            InitDemandWorkspaceCopyMode::Clone => "clone-git-repository",
        }
        .to_string(),
        label: match copy_mode {
            InitDemandWorkspaceCopyMode::Existing => "绑定已有仓库",
            InitDemandWorkspaceCopyMode::Worktree => "创建 Git worktree",
            InitDemandWorkspaceCopyMode::Clone => "克隆 Git 仓库",
        }
        .to_string(),
        target: instance_dir.display().to_string(),
        mutates: copy_mode.managed(),
    });
    if copy_mode.managed() && dependency_mode == InitDemandWorkspaceDependencyMode::AutoLink {
        actions.push(InitDemandWorkspaceAction {
            key: "auto-link-dependencies".to_string(),
            label: "安全复用前端依赖".to_string(),
            target: instance_dir.display().to_string(),
            mutates: true,
        });
    }
    actions.push(InitDemandWorkspaceAction {
        key: "materialize-resources".to_string(),
        label: "初始化资料目录和工作日志".to_string(),
        target: resources.resource_dir.clone(),
        mutates: true,
    });
    actions.push(InitDemandWorkspaceAction {
        key: "save-workspace-config".to_string(),
        label: "保存完整工作区配置".to_string(),
        target: workspace_path.display().to_string(),
        mutates: true,
    });
    if activate {
        actions.push(InitDemandWorkspaceAction {
            key: "activate-workspace".to_string(),
            label: "激活工作区".to_string(),
            target: workspace_path.display().to_string(),
            mutates: true,
        });
    }
    actions
}

fn init_demand_evidence(
    validation: Option<&WorkspaceProjectInstanceValidation>,
    instance_dir: &Path,
    instance_dir_existed: bool,
    dry_run: bool,
) -> Vec<OperationEvidence> {
    let mut evidence = Vec::new();
    if let Some(validation) = validation {
        evidence.push(OperationEvidence {
            kind: "git-source-repository".to_string(),
            source: validation.effective_path.clone(),
            detail: "源仓库目录和 Git remote 已验证".to_string(),
        });
    }
    evidence.push(OperationEvidence {
        kind: "filesystem-destination".to_string(),
        source: instance_dir.display().to_string(),
        detail: format!(
            "目标目录{}；{}",
            if instance_dir_existed {
                "已存在"
            } else {
                "不存在"
            },
            if dry_run {
                "仅完成本地预检"
            } else {
                "将按计划执行"
            }
        ),
    });
    evidence
}

fn branch_warnings(
    expected: Option<&str>,
    current: Option<&str>,
    matches: Option<bool>,
) -> Vec<String> {
    if matches != Some(false) {
        return Vec::new();
    }
    vec![format!(
        "project instance branch is {}, expected {}",
        current.unwrap_or("<unknown>"),
        expected.unwrap_or("<none>")
    )]
}

fn init_demand_risks(warnings: &[String]) -> Vec<OperationRisk> {
    warnings
        .iter()
        .map(|warning| OperationRisk {
            code: "workspace_init_warning".to_string(),
            severity: "warning".to_string(),
            detail: warning.clone(),
        })
        .collect()
}

fn resolve_workspace_key(
    explicit_key: Option<&str>,
    demand_id: Option<&str>,
    branch: Option<&str>,
    name: &str,
) -> Result<String> {
    if let Some(key) = explicit_key.and_then(normalize_optional_text) {
        return normalize_project_workspace_key(&key)
            .ok_or_else(|| anyhow::anyhow!("invalid workspace key: {key}"));
    }
    if let Some(branch_key) = branch.and_then(slug_ascii) {
        if branch_key.len() > 4 {
            return Ok(branch_key);
        }
    }
    if let Some(demand_id) = demand_id.and_then(slug_ascii) {
        return Ok(format!("feature_{demand_id}"));
    }
    if let Some(name_key) = slug_ascii(name) {
        if name_key.len() > 4 {
            return Ok(name_key);
        }
    }
    bail!("workspace key could not be generated; provide --key")
}

fn default_description(name: &str, branch: Option<&str>) -> Option<String> {
    let name = name.trim();
    if name.is_empty() {
        return None;
    }
    Some(match branch {
        Some(branch) => format!("{name} 专用工作区；关联分支 {branch}。"),
        None => format!("{name} 专用工作区。"),
    })
}

fn normalize_path_buf(path: PathBuf) -> Result<PathBuf> {
    let absolute = if path.is_absolute() {
        path
    } else {
        std::env::current_dir()?.join(path)
    };
    let mut normalized = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    bail!("path escapes filesystem root: {}", absolute.display());
                }
            }
            Component::Prefix(_) | Component::RootDir | Component::Normal(_) => {
                normalized.push(component.as_os_str());
            }
        }
    }
    Ok(normalized)
}

fn ensure_directory(label: &str, path: &Path) -> Result<()> {
    let metadata = fs::metadata(path)
        .with_context(|| format!("{label} does not exist: {}", path.display()))?;
    if !metadata.is_dir() {
        bail!("{label} must be a directory: {}", path.display());
    }
    Ok(())
}

fn require_non_empty(label: &str, value: &str) -> Result<String> {
    normalize_optional_text(value).ok_or_else(|| anyhow::anyhow!("{label} is required"))
}

fn normalize_optional_text(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn same_path(left: &Path, right: &Path) -> bool {
    normalized_compare_path(left) == normalized_compare_path(right)
}

fn normalized_compare_path(path: &Path) -> PathBuf {
    let path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(path))
            .unwrap_or_else(|_| path.to_path_buf())
    };
    fs::canonicalize(&path).unwrap_or(path)
}

fn extract_demand_id<'a>(values: impl IntoIterator<Item = Option<&'a str>>) -> Option<String> {
    for value in values.into_iter().flatten() {
        let upper = value.to_ascii_uppercase();
        let bytes = upper.as_bytes();
        let mut index = 0usize;
        while index + 2 < bytes.len() {
            if bytes[index] == b'C' && bytes[index + 1] == b'R' {
                let start = index + 2;
                let mut end = start;
                while end < bytes.len() && bytes[end].is_ascii_digit() {
                    end += 1;
                }
                if end > start {
                    return Some(format!("CR{}", &upper[start..end]));
                }
            }
            index += 1;
        }
    }
    None
}

fn slug_ascii(value: &str) -> Option<String> {
    let mut output = String::new();
    let mut last_was_separator = false;
    for ch in value.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            output.push(ch.to_ascii_lowercase());
            last_was_separator = false;
        } else if !last_was_separator && !output.is_empty() {
            output.push('_');
            last_was_separator = true;
        }
    }
    while output.ends_with('_') {
        output.pop();
    }
    normalize_project_workspace_key(&output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{BranchRules, Defaults, Jobs, ProjectFocusConfig, RuntimeProfileConfig};
    use std::process::Command;
    use uuid::Uuid;

    fn run_git(repo: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(args)
            .status()
            .expect("run git");
        assert!(status.success(), "git command failed: {args:?}");
    }

    fn init_test_repo(repo: &Path) {
        fs::create_dir_all(repo).expect("create repo");
        run_git(repo, &["init"]);
        run_git(repo, &["symbolic-ref", "HEAD", "refs/heads/main"]);
        run_git(
            repo,
            &[
                "-c",
                "user.name=rDevTool Test",
                "-c",
                "user.email=rdevtool@example.invalid",
                "commit",
                "--allow-empty",
                "-m",
                "initial",
            ],
        );
    }

    fn project(repo: &Path) -> ProjectConfig {
        ProjectConfig {
            key: "sample".to_string(),
            name: "Sample".to_string(),
            category: "Workspace".to_string(),
            repo_path: Some(repo.to_path_buf()),
            git_url: String::new(),
            deploy_targets: Vec::new(),
            jobs: Jobs::default(),
            dev: None,
            build: None,
            focus: ProjectFocusConfig::default(),
            branch_rules: BranchRules::default(),
            debug_profiles: Vec::new(),
        }
    }

    fn app_config(project: ProjectConfig) -> AppConfig {
        AppConfig {
            defaults: Defaults {
                jenkins_profiles: BTreeMap::new(),
                jenkins_base_url: String::new(),
                jenkins_username: String::new(),
                jenkins_password: None,
                jenkins_password_env: "JENKINS_PASSWORD".to_string(),
                jenkins_password_fallback_file: None,
                gitlab_api_base_url: None,
                gitlab_token_env: "GITLAB_TOKEN".to_string(),
                gitlab_token: None,
                branch_rules: BranchRules::default(),
                runtime_profiles: Vec::<RuntimeProfileConfig>::new(),
            },
            projects: vec![project],
        }
    }

    fn demand_request(
        key: &str,
        requirement_dir: PathBuf,
        root_dir: PathBuf,
        repo_path: Option<PathBuf>,
        branch: &str,
        copy_mode: InitDemandWorkspaceCopyMode,
    ) -> InitDemandWorkspaceRequest {
        InitDemandWorkspaceRequest {
            key: Some(key.to_string()),
            demand_id: None,
            name: key.to_string(),
            description: None,
            workspace_type: None,
            requirement_dir,
            repo_path,
            project: Some("sample".to_string()),
            branch: Some(branch.to_string()),
            root_dir: Some(root_dir),
            instance_dir: None,
            copy_mode,
            dependency_mode: InitDemandWorkspaceDependencyMode::None,
            resource_dir: None,
            worklog_file: None,
            create_worklog: true,
            worklog_auto_record: true,
            requirement_category: None,
            requirement_short_label: None,
            requirement_entry_name: None,
            activate: false,
            allow_remote_mismatch: false,
            dry_run: false,
        }
    }

    #[test]
    fn dry_run_worktree_reports_plan_without_creating_artifacts() {
        let temp =
            std::env::temp_dir().join(format!("rdevtool-init-demand-plan-{}", Uuid::new_v4()));
        let repo = temp.join("repo");
        let requirement_dir = temp.join("requirement");
        let workspace_root = temp.join("workspace-root");
        init_test_repo(&repo);
        run_git(&repo, &["branch", "feature-plan"]);
        fs::create_dir_all(&requirement_dir).expect("create requirement dir");
        let paths = ConfigPaths {
            dir: temp.clone(),
            projects: temp.join("projects.toml"),
            workspace: temp.join("workspace.toml"),
            project_workspaces: temp.join("workspaces"),
        };
        let mut request = demand_request(
            "feature-plan",
            requirement_dir,
            workspace_root.clone(),
            Some(repo.clone()),
            "feature-plan",
            InitDemandWorkspaceCopyMode::Worktree,
        );
        request.dry_run = true;

        let result = init_demand_workspace(&paths, &app_config(project(&repo)), request)
            .expect("plan demand workspace");

        assert!(result.dry_run);
        assert_eq!(result.status.key, "planned");
        assert!(result.managed_artifacts.is_empty());
        assert!(!workspace_root.exists());
        assert!(!paths.project_workspaces.join("feature-plan.toml").exists());
        assert!(!workspace_root.join("sample").exists());
        assert!(
            result
                .risks
                .iter()
                .any(|risk| risk.code == "remote_branch_not_probed")
        );
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn managed_instance_must_be_new_direct_child_of_workspace_root() {
        let temp = std::env::temp_dir().join(format!(
            "rdevtool-init-demand-path-boundary-{}",
            Uuid::new_v4()
        ));
        let root = temp.join("workspace");
        let outside = temp.join("outside");
        assert!(
            validate_instance_destination(
                InitDemandWorkspaceCopyMode::Worktree,
                &root,
                &outside,
                None,
            )
            .is_err()
        );

        fs::create_dir_all(root.join("sample")).expect("create existing destination");
        assert!(
            validate_instance_destination(
                InitDemandWorkspaceCopyMode::Clone,
                &root,
                &root.join("sample"),
                None,
            )
            .is_err()
        );
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn worktree_mode_creates_managed_project_instance() {
        let temp =
            std::env::temp_dir().join(format!("rdevtool-init-demand-worktree-{}", Uuid::new_v4()));
        let repo = temp.join("repo");
        let requirement_dir = temp.join("requirement");
        let workspace_root = temp.join("workspace-root");
        init_test_repo(&repo);
        run_git(&repo, &["branch", "feature-worktree"]);
        fs::create_dir_all(&requirement_dir).expect("create requirement dir");
        let paths = ConfigPaths {
            dir: temp.clone(),
            projects: temp.join("projects.toml"),
            workspace: temp.join("workspace.toml"),
            project_workspaces: temp.join("workspaces"),
        };
        let request = demand_request(
            "feature-worktree",
            requirement_dir,
            workspace_root.clone(),
            Some(repo.clone()),
            "feature-worktree",
            InitDemandWorkspaceCopyMode::Worktree,
        );

        let result = init_demand_workspace(&paths, &app_config(project(&repo)), request)
            .expect("create managed worktree workspace");
        let instance = workspace_root.join("sample");

        assert!(!result.dry_run);
        assert!(result.workspace.project_instances[0].managed);
        assert_eq!(result.workspace.project_instances[0].path, instance);
        assert_eq!(
            git::current_branch(&instance).expect("worktree branch"),
            "feature-worktree"
        );
        assert!(
            paths
                .project_workspaces
                .join("feature-worktree.toml")
                .is_file()
        );
        assert!(
            result
                .managed_artifacts
                .iter()
                .any(|artifact| artifact.kind == "worktree"
                    && artifact.path == instance.display().to_string())
        );
        git::remove_managed_worktree(&repo, &instance).expect("remove test worktree");
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn worktree_mode_auto_links_dependencies_when_lock_file_matches() {
        let temp = std::env::temp_dir().join(format!(
            "rdevtool-init-demand-dependencies-{}",
            Uuid::new_v4()
        ));
        let repo = temp.join("repo");
        let requirement_dir = temp.join("requirement");
        let workspace_root = temp.join("workspace-root");
        init_test_repo(&repo);
        fs::create_dir_all(repo.join("web/node_modules/@vue/cli-service"))
            .expect("create source dependencies");
        fs::create_dir_all(repo.join("web")).expect("create web directory");
        fs::write(repo.join("web/package-lock.json"), "lock-content")
            .expect("write dependency lock");
        run_git(&repo, &["add", "web/package-lock.json"]);
        run_git(
            &repo,
            &[
                "-c",
                "user.name=rDevTool Test",
                "-c",
                "user.email=rdevtool@example.invalid",
                "commit",
                "-m",
                "add dependency lock",
            ],
        );
        run_git(&repo, &["branch", "feature-dependencies"]);
        fs::create_dir_all(&requirement_dir).expect("create requirement dir");
        let paths = ConfigPaths {
            dir: temp.clone(),
            projects: temp.join("projects.toml"),
            workspace: temp.join("workspace.toml"),
            project_workspaces: temp.join("workspaces"),
        };
        let mut request = demand_request(
            "feature-dependencies",
            requirement_dir,
            workspace_root.clone(),
            Some(repo.clone()),
            "feature-dependencies",
            InitDemandWorkspaceCopyMode::Worktree,
        );
        request.dependency_mode = InitDemandWorkspaceDependencyMode::AutoLink;

        let result = init_demand_workspace(&paths, &app_config(project(&repo)), request)
            .expect("create worktree with dependency reuse");
        let instance = workspace_root.join("sample");
        let linked_dependencies = instance.join("web/node_modules");

        assert_eq!(result.dependency_links.len(), 1);
        assert_eq!(result.dependency_links[0].relative_dir, "web");
        assert!(
            fs::symlink_metadata(&linked_dependencies)
                .expect("dependency link metadata")
                .file_type()
                .is_symlink()
        );
        assert_eq!(
            fs::canonicalize(&linked_dependencies).expect("linked dependency target"),
            fs::canonicalize(repo.join("web/node_modules")).expect("source dependency target")
        );
        let exclude = fs::read_to_string(git::local_exclude_path(&instance).expect("exclude path"))
            .expect("read local exclude");
        assert!(exclude.lines().any(|line| line == "/web/node_modules"));

        git::remove_managed_worktree(&repo, &instance).expect("remove test worktree");
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn dependency_reuse_never_links_mismatched_lock_files() {
        let temp = std::env::temp_dir().join(format!(
            "rdevtool-init-demand-dependency-mismatch-{}",
            Uuid::new_v4()
        ));
        let source = temp.join("source");
        let target = temp.join("target");
        fs::create_dir_all(source.join("node_modules")).expect("create source dependencies");
        fs::create_dir_all(&target).expect("create target");
        fs::write(source.join("package-lock.json"), "source-lock").expect("write source lock");
        fs::write(target.join("package-lock.json"), "target-lock").expect("write target lock");

        let outcome =
            auto_link_workspace_dependencies(&source, &target).expect("evaluate dependency reuse");

        assert!(outcome.links.is_empty());
        assert!(!target.join("node_modules").exists());
        assert!(
            outcome
                .warnings
                .iter()
                .any(|warning| warning.contains("不一致"))
        );
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn clone_mode_can_resolve_project_without_local_repo_argument() {
        let temp =
            std::env::temp_dir().join(format!("rdevtool-init-demand-clone-{}", Uuid::new_v4()));
        let repo = temp.join("repo");
        let requirement_dir = temp.join("requirement");
        let workspace_root = temp.join("workspace-root");
        init_test_repo(&repo);
        run_git(&repo, &["branch", "feature-clone"]);
        fs::create_dir_all(&requirement_dir).expect("create requirement dir");
        let paths = ConfigPaths {
            dir: temp.clone(),
            projects: temp.join("projects.toml"),
            workspace: temp.join("workspace.toml"),
            project_workspaces: temp.join("workspaces"),
        };
        let mut clone_project = project(&repo);
        clone_project.git_url = repo.display().to_string();
        let request = demand_request(
            "feature-clone",
            requirement_dir,
            workspace_root.clone(),
            None,
            "feature-clone",
            InitDemandWorkspaceCopyMode::Clone,
        );

        let result = init_demand_workspace(&paths, &app_config(clone_project), request)
            .expect("create managed clone workspace");
        let instance = workspace_root.join("sample");

        assert!(instance.is_dir());
        assert_eq!(
            git::current_branch(&instance).expect("clone branch"),
            "feature-clone"
        );
        assert!(result.source_repository_validation.is_none());
        assert_eq!(
            result
                .project_instance_validation
                .as_ref()
                .and_then(|validation| validation.remote_matches),
            Some(true)
        );
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn clone_mode_rolls_back_checkout_when_activation_fails() {
        let temp = std::env::temp_dir().join(format!(
            "rdevtool-init-demand-clone-rollback-{}",
            Uuid::new_v4()
        ));
        let repo = temp.join("repo");
        let requirement_dir = temp.join("requirement");
        let workspace_root = temp.join("workspace-root");
        init_test_repo(&repo);
        run_git(&repo, &["branch", "feature-rollback"]);
        fs::create_dir_all(&requirement_dir).expect("create requirement dir");
        let paths = ConfigPaths {
            dir: temp.clone(),
            projects: temp.join("projects.toml"),
            workspace: temp.join("missing-workspace.toml"),
            project_workspaces: temp.join("workspaces"),
        };
        let mut clone_project = project(&repo);
        clone_project.git_url = repo.display().to_string();
        let mut request = demand_request(
            "feature-rollback",
            requirement_dir,
            workspace_root.clone(),
            None,
            "feature-rollback",
            InitDemandWorkspaceCopyMode::Clone,
        );
        request.activate = true;

        let result = init_demand_workspace(&paths, &app_config(clone_project), request);

        assert!(result.is_err());
        assert!(!workspace_root.exists());
        assert!(
            !paths
                .project_workspaces
                .join("feature-rollback.toml")
                .exists()
        );
        assert!(repo.exists(), "source repository must never be removed");
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn worktree_mode_rolls_back_registration_when_activation_fails() {
        let temp = std::env::temp_dir().join(format!(
            "rdevtool-init-demand-worktree-rollback-{}",
            Uuid::new_v4()
        ));
        let repo = temp.join("repo");
        let requirement_dir = temp.join("requirement");
        let workspace_root = temp.join("workspace-root");
        init_test_repo(&repo);
        run_git(&repo, &["branch", "feature-worktree-rollback"]);
        fs::create_dir_all(&requirement_dir).expect("create requirement dir");
        let paths = ConfigPaths {
            dir: temp.clone(),
            projects: temp.join("projects.toml"),
            workspace: temp.join("missing-workspace.toml"),
            project_workspaces: temp.join("workspaces"),
        };
        let mut request = demand_request(
            "feature-worktree-rollback",
            requirement_dir,
            workspace_root.clone(),
            Some(repo.clone()),
            "feature-worktree-rollback",
            InitDemandWorkspaceCopyMode::Worktree,
        );
        request.activate = true;

        let result = init_demand_workspace(&paths, &app_config(project(&repo)), request);

        assert!(result.is_err());
        assert!(!workspace_root.exists());
        assert!(
            !git::list_worktrees(&repo)
                .expect("list worktrees")
                .into_iter()
                .any(|item| item.path.ends_with("sample"))
        );
        assert!(repo.exists(), "source repository must never be removed");
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn init_demand_rolls_back_owned_artifacts_when_activation_fails() {
        let temp =
            std::env::temp_dir().join(format!("rdevtool-init-demand-rollback-{}", Uuid::new_v4()));
        let repo = temp.join("repo");
        let requirement_dir = temp.join("requirement");
        let workspace_root = temp.join("workspace-root");
        fs::create_dir_all(&repo).expect("create repo");
        fs::create_dir_all(&requirement_dir).expect("create requirement dir");
        run_git(&repo, &["init"]);
        run_git(&repo, &["symbolic-ref", "HEAD", "refs/heads/main"]);
        run_git(
            &repo,
            &[
                "-c",
                "user.name=rDevTool Test",
                "-c",
                "user.email=rdevtool@example.invalid",
                "commit",
                "--allow-empty",
                "-m",
                "initial",
            ],
        );

        let paths = ConfigPaths {
            dir: temp.clone(),
            projects: temp.join("projects.toml"),
            workspace: temp.join("missing-workspace.toml"),
            project_workspaces: temp.join("workspaces"),
        };
        let result = init_demand_workspace(
            &paths,
            &app_config(project(&repo)),
            InitDemandWorkspaceRequest {
                key: Some("feature-test".to_string()),
                demand_id: None,
                name: "Feature Test".to_string(),
                description: None,
                workspace_type: None,
                requirement_dir,
                repo_path: Some(repo.clone()),
                project: Some("sample".to_string()),
                branch: Some("main".to_string()),
                root_dir: Some(workspace_root.clone()),
                instance_dir: None,
                copy_mode: InitDemandWorkspaceCopyMode::Existing,
                dependency_mode: InitDemandWorkspaceDependencyMode::None,
                resource_dir: None,
                worklog_file: None,
                create_worklog: true,
                worklog_auto_record: true,
                requirement_category: None,
                requirement_short_label: None,
                requirement_entry_name: None,
                activate: true,
                allow_remote_mismatch: false,
                dry_run: false,
            },
        );

        assert!(result.is_err());
        assert!(!paths.project_workspaces.join("feature-test.toml").exists());
        assert!(!workspace_root.exists());
        assert!(repo.exists(), "existing repository must never be removed");
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn init_demand_persists_complete_workspace_before_activation() {
        let temp =
            std::env::temp_dir().join(format!("rdevtool-init-demand-success-{}", Uuid::new_v4()));
        let repo = temp.join("repo");
        let requirement_dir = temp.join("requirement");
        let workspace_root = temp.join("workspace-root");
        fs::create_dir_all(&repo).expect("create repo");
        fs::create_dir_all(&requirement_dir).expect("create requirement dir");
        run_git(&repo, &["init"]);
        run_git(&repo, &["symbolic-ref", "HEAD", "refs/heads/main"]);
        run_git(
            &repo,
            &[
                "-c",
                "user.name=rDevTool Test",
                "-c",
                "user.email=rdevtool@example.invalid",
                "commit",
                "--allow-empty",
                "-m",
                "initial",
            ],
        );
        let paths = ConfigPaths {
            dir: temp.clone(),
            projects: temp.join("projects.toml"),
            workspace: temp.join("workspace.toml"),
            project_workspaces: temp.join("workspaces"),
        };
        crate::config::save_workspace_config(
            &paths.workspace,
            &crate::config::WorkspaceConfig::default(),
        )
        .expect("save workspace config");

        let result = init_demand_workspace(
            &paths,
            &app_config(project(&repo)),
            InitDemandWorkspaceRequest {
                key: Some("feature-success".to_string()),
                demand_id: None,
                name: "Feature Success".to_string(),
                description: None,
                workspace_type: None,
                requirement_dir,
                repo_path: Some(repo.clone()),
                project: Some("sample".to_string()),
                branch: Some("main".to_string()),
                root_dir: Some(workspace_root.clone()),
                instance_dir: None,
                copy_mode: InitDemandWorkspaceCopyMode::Existing,
                dependency_mode: InitDemandWorkspaceDependencyMode::None,
                resource_dir: None,
                worklog_file: None,
                create_worklog: true,
                worklog_auto_record: true,
                requirement_category: None,
                requirement_short_label: None,
                requirement_entry_name: None,
                activate: true,
                allow_remote_mismatch: false,
                dry_run: false,
            },
        )
        .expect("initialize demand workspace");

        assert_eq!(result.workspace.project_instances.len(), 1);
        assert!(!result.workspace.project_instances[0].managed);
        assert!(workspace_root.join("resources").is_dir());
        assert!(workspace_root.join("resources/WORKLOG.md").is_file());
        let app_workspace = crate::config::load_workspace_config(&paths.workspace)
            .expect("load active workspace config");
        assert_eq!(
            app_workspace.app.active_workspace.as_deref(),
            Some("feature-success")
        );
        assert!(
            paths
                .project_workspaces
                .join("feature-success.toml")
                .is_file()
        );
        assert!(repo.exists());
        let _ = fs::remove_dir_all(temp);
    }
}
