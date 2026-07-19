use anyhow::{Context, Result, bail};
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::config::{
    AppConfig, ConfigPaths, CreateProjectWorkspaceRequest, ProjectConfig, ProjectWorkspaceConfig,
    ProjectWorkspaceProjectInstanceConfig, ProjectWorkspaceResourceCategoryConfig,
    ProjectWorkspaceResourceEntryConfig, create_project_workspace,
    default_project_workspace_root_dir, normalize_project_workspace_key,
    save_project_workspace_config,
};
use crate::git;
use crate::navigation::validate_workspace_resource_entry;

const DEFAULT_DEMAND_WORKSPACE_TYPE: &str = "business";
const DEFAULT_REQUIREMENT_CATEGORY: &str = "需求资料";
const DEFAULT_REQUIREMENT_SHORT_LABEL: &str = "需求";
const DEFAULT_REQUIREMENT_ENTRY_NAME: &str = "需求目录";

#[derive(Debug, Clone)]
pub struct InitDemandWorkspaceRequest {
    pub key: Option<String>,
    pub demand_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub workspace_type: Option<String>,
    pub requirement_dir: PathBuf,
    pub repo_path: PathBuf,
    pub project: Option<String>,
    pub branch: Option<String>,
    pub root_dir: Option<PathBuf>,
    pub requirement_category: Option<String>,
    pub requirement_short_label: Option<String>,
    pub requirement_entry_name: Option<String>,
    pub activate: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitDemandWorkspaceResult {
    pub key: String,
    pub name: String,
    pub demand_id: Option<String>,
    pub workspace: ProjectWorkspaceConfig,
    pub project: InitDemandWorkspaceProject,
    pub requirement_entry: InitDemandWorkspaceRequirementEntry,
    pub branch: InitDemandWorkspaceBranch,
    pub metadata: BTreeMap<String, String>,
    pub warnings: Vec<String>,
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
    let repo_path = normalize_path_buf(request.repo_path)?;
    ensure_directory("requirement directory", &requirement_dir)?;
    ensure_directory("repo path", &repo_path)?;

    let project = resolve_project_for_repo(config, request.project.as_deref(), &repo_path)?;
    let demand_id = request
        .demand_id
        .as_deref()
        .and_then(normalize_optional_text)
        .or_else(|| {
            extract_demand_id([
                Some(name.as_str()),
                request.branch.as_deref(),
                Some(project.git_url.as_str()),
                repo_path.file_name().and_then(|value| value.to_str()),
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
    let workspace_type = request
        .workspace_type
        .as_deref()
        .and_then(normalize_optional_text)
        .unwrap_or_else(|| DEFAULT_DEMAND_WORKSPACE_TYPE.to_string());
    let branch_expected = request.branch.as_deref().and_then(normalize_optional_text);
    let branch_current = git::current_branch(&repo_path).with_context(|| {
        format!(
            "failed to inspect current branch for {}",
            repo_path.display()
        )
    })?;
    let branch_matches = branch_expected
        .as_ref()
        .map(|expected| expected == &branch_current);
    let description = request
        .description
        .as_deref()
        .and_then(normalize_optional_text)
        .or_else(|| default_description(&name, branch_expected.as_deref()));

    let mut workspace = create_project_workspace(
        paths,
        CreateProjectWorkspaceRequest {
            key: key.clone(),
            name: name.clone(),
            description,
            workspace_type: Some(workspace_type),
            root_dir: Some(root_dir),
            copy_from: None,
            activate: request.activate,
        },
    )?;

    workspace.include_all_projects = false;
    workspace.include_all_navigation = false;
    workspace.projects = vec![project.key.clone()];
    workspace.navigation_categories.clear();
    workspace.navigation_entries.clear();
    workspace.project_instances = vec![ProjectWorkspaceProjectInstanceConfig {
        project: project.key.clone(),
        path: repo_path.clone(),
        managed: true,
    }];
    let mut metadata = BTreeMap::new();
    metadata.insert("kind".to_string(), "demand".to_string());
    metadata.insert("primaryProject".to_string(), project.key.clone());
    metadata.insert(
        "requirementDir".to_string(),
        requirement_dir.display().to_string(),
    );
    metadata.insert("repoPath".to_string(), repo_path.display().to_string());
    if let Some(demand_id) = demand_id.as_ref() {
        metadata.insert("demandId".to_string(), demand_id.clone());
    }
    if let Some(branch) = branch_expected.as_ref() {
        metadata.insert("targetBranch".to_string(), branch.clone());
    }
    workspace.metadata = metadata.clone();

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
    save_project_workspace_config(
        &paths
            .project_workspaces
            .join(format!("{}.toml", workspace.key)),
        &workspace,
    )?;

    let mut warnings = Vec::new();
    if branch_matches == Some(false) {
        if let Some(expected) = branch_expected.as_ref() {
            warnings.push(format!(
                "current branch is {branch_current}, expected {expected}; workspace was created without switching branches"
            ));
        }
    }
    if project
        .repo_path
        .as_ref()
        .is_some_and(|path| !same_path(path, &repo_path))
    {
        warnings.push(format!(
            "project {} is configured with a different repo path; workspace instance uses {}",
            project.key,
            repo_path.display()
        ));
    }

    Ok(InitDemandWorkspaceResult {
        key: workspace.key.clone(),
        name: workspace.name.clone(),
        demand_id,
        workspace,
        project: InitDemandWorkspaceProject {
            key: project.key.clone(),
            name: project.name.clone(),
            repo_path: repo_path.display().to_string(),
        },
        requirement_entry: InitDemandWorkspaceRequirementEntry {
            category: requirement_category,
            short_label: requirement_short_label,
            name: requirement_entry_name,
            path: requirement_dir.display().to_string(),
        },
        branch: InitDemandWorkspaceBranch {
            expected: branch_expected,
            current: Some(branch_current),
            matches: branch_matches,
        },
        metadata,
        warnings,
    })
}

fn resolve_project_for_repo(
    config: &AppConfig,
    project_key: Option<&str>,
    repo_path: &Path,
) -> Result<ProjectConfig> {
    if let Some(project_key) = project_key.and_then(normalize_optional_text) {
        let project = config
            .projects
            .iter()
            .find(|project| project.key == project_key)
            .with_context(|| format!("project not found: {project_key}"))?;
        return Ok(project.clone());
    }

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
    if path.is_absolute() {
        Ok(path)
    } else {
        Ok(std::env::current_dir()?.join(path))
    }
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
