use std::fs;
use std::path::{Component, Path, PathBuf};

use anyhow::{Context, Result, bail};
use chrono::Local;
use serde::Serialize;

use crate::config::{
    ConfigPaths, ProjectWorkspaceConfig, ProjectWorkspaceResourceCategoryConfig,
    ProjectWorkspaceResourceEntryConfig, default_project_workspace_root_dir,
    load_project_workspace_by_key, save_project_workspace_config,
};
use crate::config_store::{with_config_file_lock, write_config_text_atomic};

pub const DEFAULT_WORKSPACE_RESOURCE_DIR_NAME: &str = "resources";
pub const DEFAULT_WORKSPACE_WORKLOG_FILE: &str = "WORKLOG.md";
const WORKLOG_CATEGORY_TITLE: &str = "工作区资料";
const WORKLOG_CATEGORY_SHORT_LABEL: &str = "资料";
const RESOURCE_DIR_ENTRY_NAME: &str = "资料目录";
const WORKLOG_ENTRY_NAME: &str = "工作日志";
const MAX_WORKLOG_CONTENT_CHARS: usize = 32_000;
const MAX_AUTO_WORKLOG_DETAIL_CHARS: usize = 8_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceResourceStatus {
    pub workspace_key: String,
    pub workspace_name: String,
    pub resource_dir: String,
    pub worklog_file: String,
    pub worklog_path: String,
    pub worklog_exists: bool,
    pub worklog_created: bool,
    pub auto_record_enabled: bool,
}

#[derive(Debug, Clone)]
pub struct WorkspaceOperationWorklogEvent {
    pub event_id: Option<String>,
    pub kind: String,
    pub summary: String,
    pub detail: Option<String>,
    pub success: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWorklogAppendResult {
    pub workspace_key: String,
    pub path: String,
    pub kind: String,
    pub summary: String,
    pub recorded_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWorklogContent {
    pub workspace_key: String,
    pub path: String,
    pub exists: bool,
    pub total_lines: usize,
    pub shown_lines: usize,
    pub content_truncated: bool,
    pub content: String,
}

pub fn initialize_workspace_resources(
    paths: &ConfigPaths,
    workspace_key: &str,
    resource_dir: Option<PathBuf>,
    worklog_file: Option<PathBuf>,
    create_worklog: bool,
) -> Result<(ProjectWorkspaceConfig, WorkspaceResourceStatus)> {
    let workspace = load_project_workspace_by_key(&paths.project_workspaces, workspace_key)?;
    ensure_workspace_resources_mutable(&workspace)?;
    let (workspace, status) =
        materialize_workspace_resources(workspace, resource_dir, worklog_file, create_worklog)?;
    let workspace_path = paths
        .project_workspaces
        .join(format!("{}.toml", workspace.key));
    save_project_workspace_config(&workspace_path, &workspace)?;
    Ok((workspace, status))
}

pub fn materialize_workspace_resources(
    workspace: ProjectWorkspaceConfig,
    resource_dir: Option<PathBuf>,
    worklog_file: Option<PathBuf>,
    create_worklog: bool,
) -> Result<(ProjectWorkspaceConfig, WorkspaceResourceStatus)> {
    ensure_workspace_resources_mutable(&workspace)?;
    let (workspace, mut status) = plan_workspace_resources(workspace, resource_dir, worklog_file)?;
    let resource_dir = PathBuf::from(&status.resource_dir);
    let worklog_path = PathBuf::from(&status.worklog_path);
    fs::create_dir_all(&resource_dir).with_context(|| {
        format!(
            "failed to create workspace resource directory: {}",
            resource_dir.display()
        )
    })?;

    status.worklog_created = if create_worklog && !worklog_path.exists() {
        let write_path = writable_worklog_path(&worklog_path)?;
        write_config_text_atomic(&write_path, worklog_template(&workspace))?;
        true
    } else {
        false
    };
    status.worklog_exists = worklog_path.exists();
    Ok((workspace, status))
}

pub fn plan_workspace_resources(
    mut workspace: ProjectWorkspaceConfig,
    resource_dir: Option<PathBuf>,
    worklog_file: Option<PathBuf>,
) -> Result<(ProjectWorkspaceConfig, WorkspaceResourceStatus)> {
    ensure_workspace_resources_mutable(&workspace)?;
    if workspace.is_system() {
        bail!("the system workspace cannot own a resource directory");
    }

    let resource_dir = resolve_workspace_resource_dir(&workspace, resource_dir)?;
    let worklog_file = validate_workspace_worklog_file(
        worklog_file
            .or_else(|| workspace.worklog_file.clone())
            .unwrap_or_else(|| PathBuf::from(DEFAULT_WORKSPACE_WORKLOG_FILE)),
    )?;
    let worklog_path = resource_dir.join(&worklog_file);
    workspace.resource_dir = Some(resource_dir.clone());
    workspace.worklog_file = Some(worklog_file.clone());
    ensure_workspace_resource_entries(&mut workspace, &resource_dir, &worklog_path);
    workspace = workspace.normalized();

    let status = WorkspaceResourceStatus {
        workspace_key: workspace.key.clone(),
        workspace_name: workspace.name.clone(),
        resource_dir: resource_dir.display().to_string(),
        worklog_file: worklog_file.display().to_string(),
        worklog_path: worklog_path.display().to_string(),
        worklog_exists: worklog_path.exists(),
        worklog_created: false,
        auto_record_enabled: workspace.worklog_auto_record,
    };
    Ok((workspace, status))
}

pub fn workspace_resource_status(
    workspace: &ProjectWorkspaceConfig,
) -> Option<WorkspaceResourceStatus> {
    let resource_dir = workspace.resource_dir.as_ref()?;
    let worklog_file = validate_workspace_worklog_file(
        workspace
            .worklog_file
            .clone()
            .unwrap_or_else(|| PathBuf::from(DEFAULT_WORKSPACE_WORKLOG_FILE)),
    )
    .ok()?;
    let worklog_path = resource_dir.join(&worklog_file);
    Some(WorkspaceResourceStatus {
        workspace_key: workspace.key.clone(),
        workspace_name: workspace.name.clone(),
        resource_dir: resource_dir.display().to_string(),
        worklog_file: worklog_file.display().to_string(),
        worklog_path: worklog_path.display().to_string(),
        worklog_exists: worklog_path.exists(),
        worklog_created: false,
        auto_record_enabled: workspace.worklog_auto_record,
    })
}

pub fn clear_workspace_worklog_configuration(workspace: &mut ProjectWorkspaceConfig) {
    workspace.resource_dir = None;
    workspace.worklog_file = None;
    workspace.worklog_auto_record = false;
    for category in &mut workspace.resource_categories {
        if category.title == WORKLOG_CATEGORY_TITLE {
            category.entries.retain(|entry| {
                entry.name != RESOURCE_DIR_ENTRY_NAME && entry.name != WORKLOG_ENTRY_NAME
            });
        }
    }
    workspace
        .resource_categories
        .retain(|category| !category.entries.is_empty());
}

pub fn set_workspace_worklog_auto_record(
    paths: &ConfigPaths,
    workspace_key: &str,
    enabled: bool,
) -> Result<WorkspaceResourceStatus> {
    let mut workspace = load_project_workspace_by_key(&paths.project_workspaces, workspace_key)?;
    ensure_workspace_resources_mutable(&workspace)?;
    if workspace.is_system() {
        bail!("the system workspace cannot own a worklog");
    }
    if workspace.resource_dir.is_none() {
        bail!("workspace has no resource directory; run workspace resources-init first");
    }
    workspace.worklog_auto_record = enabled;
    let workspace_path = paths
        .project_workspaces
        .join(format!("{}.toml", workspace.key));
    save_project_workspace_config(&workspace_path, &workspace)?;
    workspace_resource_status(&workspace)
        .with_context(|| format!("workspace {} has no worklog configuration", workspace.key))
}

pub fn append_workspace_worklog(
    paths: &ConfigPaths,
    workspace_key: &str,
    kind: &str,
    summary: &str,
    detail: Option<&str>,
) -> Result<WorkspaceWorklogAppendResult> {
    let workspace = load_project_workspace_by_key(&paths.project_workspaces, workspace_key)?;
    ensure_workspace_resources_mutable(&workspace)?;
    let kind = require_heading_text("worklog kind", kind)?;
    let summary = require_heading_text("worklog summary", summary)?;
    let detail = detail.and_then(normalize_text);
    append_workspace_worklog_entry(&workspace, kind, summary, detail, None)?
        .with_context(|| format!("failed to append workspace worklog for {}", workspace.key))
}

pub fn append_workspace_operation_worklog(
    paths: &ConfigPaths,
    workspace_key: &str,
    event: WorkspaceOperationWorklogEvent,
) -> Result<Option<WorkspaceWorklogAppendResult>> {
    let workspace = load_project_workspace_by_key(&paths.project_workspaces, workspace_key)?;
    ensure_workspace_resources_mutable(&workspace)?;
    if workspace.is_system() || !workspace.worklog_auto_record || workspace.resource_dir.is_none() {
        return Ok(None);
    }
    let kind = require_heading_text("worklog event kind", &event.kind)?;
    let summary = require_heading_text("worklog event summary", &event.summary)?;
    let result_label = if event.success { "成功" } else { "失败" };
    let detail = event
        .detail
        .as_deref()
        .and_then(normalize_text)
        .map(|detail| {
            let (detail, truncated) =
                truncate_content_from_start(detail, MAX_AUTO_WORKLOG_DETAIL_CHARS);
            if truncated {
                format!("- 结果: {result_label}\n- 详情: 已截取末尾\n\n{detail}")
            } else {
                format!("- 结果: {result_label}\n\n{detail}")
            }
        })
        .or_else(|| Some(format!("- 结果: {result_label}")));
    let marker = event
        .event_id
        .as_deref()
        .and_then(normalize_worklog_event_id)
        .map(|event_id| format!("<!-- rdevtool:auto:{event_id} -->"));
    append_workspace_worklog_entry(&workspace, kind, summary, detail, marker.as_deref())
}

fn ensure_workspace_resources_mutable(workspace: &ProjectWorkspaceConfig) -> Result<()> {
    if workspace.is_archived() {
        bail!(
            "project workspace is archived: {}; restore it before changing workspace resources",
            workspace.key
        );
    }
    Ok(())
}

pub fn read_workspace_worklog(
    paths: &ConfigPaths,
    workspace_key: &str,
    max_lines: usize,
) -> Result<WorkspaceWorklogContent> {
    let workspace = load_project_workspace_by_key(&paths.project_workspaces, workspace_key)?;
    read_workspace_worklog_for_workspace(&workspace, max_lines)
}

pub fn read_workspace_worklog_for_workspace(
    workspace: &ProjectWorkspaceConfig,
    max_lines: usize,
) -> Result<WorkspaceWorklogContent> {
    let status = workspace_resource_status(&workspace).with_context(|| {
        format!(
            "workspace {} has no resource directory; run workspace resources-init first",
            workspace.key
        )
    })?;
    let path = PathBuf::from(&status.worklog_path);
    if !path.exists() {
        return Ok(WorkspaceWorklogContent {
            workspace_key: workspace.key.clone(),
            path: path.display().to_string(),
            exists: false,
            total_lines: 0,
            shown_lines: 0,
            content_truncated: false,
            content: String::new(),
        });
    }
    let content = fs::read_to_string(&path)
        .with_context(|| format!("failed to read workspace worklog: {}", path.display()))?;
    let lines = content.lines().collect::<Vec<_>>();
    let limit = max_lines.clamp(1, 500);
    let start = lines.len().saturating_sub(limit);
    let shown = lines[start..].join("\n");
    let (shown, content_truncated) = truncate_content_from_start(shown, MAX_WORKLOG_CONTENT_CHARS);
    Ok(WorkspaceWorklogContent {
        workspace_key: workspace.key.clone(),
        path: path.display().to_string(),
        exists: true,
        total_lines: lines.len(),
        shown_lines: lines.len() - start,
        content_truncated,
        content: shown,
    })
}

pub fn resolve_workspace_resource_dir(
    workspace: &ProjectWorkspaceConfig,
    requested: Option<PathBuf>,
) -> Result<PathBuf> {
    let path = requested
        .or_else(|| workspace.resource_dir.clone())
        .or_else(|| {
            workspace
                .root_dir
                .as_ref()
                .map(|root| root.join(DEFAULT_WORKSPACE_RESOURCE_DIR_NAME))
        })
        .unwrap_or_else(|| {
            default_project_workspace_root_dir(&workspace.key)
                .join(DEFAULT_WORKSPACE_RESOURCE_DIR_NAME)
        });
    if path.is_absolute() {
        Ok(path)
    } else {
        Ok(std::env::current_dir()?.join(path))
    }
}

pub fn validate_workspace_worklog_file(path: PathBuf) -> Result<PathBuf> {
    if path.as_os_str().is_empty() || path.is_absolute() {
        bail!("worklog file must be a relative Markdown path");
    }
    if path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        bail!("worklog file must stay inside the workspace resource directory");
    }
    let is_markdown = path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("md"));
    if !is_markdown {
        bail!("worklog file must use the .md extension");
    }
    Ok(path)
}

fn ensure_workspace_resource_entries(
    workspace: &mut ProjectWorkspaceConfig,
    resource_dir: &Path,
    worklog_path: &Path,
) {
    let resource_target = resource_dir.display().to_string();
    let worklog_target = worklog_path.display().to_string();
    let directory_entry = ProjectWorkspaceResourceEntryConfig {
        name: RESOURCE_DIR_ENTRY_NAME.to_string(),
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
        path: Some(resource_target.clone()),
        cwd: None,
        note: Some("工作区文档、附件、脚本和软链接".to_string()),
    };
    let worklog_entry = ProjectWorkspaceResourceEntryConfig {
        name: WORKLOG_ENTRY_NAME.to_string(),
        kind: Some("file".to_string()),
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
        path: Some(worklog_target.clone()),
        cwd: None,
        note: Some("需求优化、问题修复和关键决策记录".to_string()),
    };
    if let Some(category) = workspace
        .resource_categories
        .iter_mut()
        .find(|category| category.title == WORKLOG_CATEGORY_TITLE)
    {
        category.entries.retain(|candidate| {
            candidate.name != RESOURCE_DIR_ENTRY_NAME
                && candidate.name != WORKLOG_ENTRY_NAME
                && candidate.path.as_deref() != Some(&resource_target)
                && candidate.path.as_deref() != Some(&worklog_target)
        });
        category.entries.push(directory_entry);
        category.entries.push(worklog_entry);
        return;
    }
    workspace
        .resource_categories
        .push(ProjectWorkspaceResourceCategoryConfig {
            title: WORKLOG_CATEGORY_TITLE.to_string(),
            short_label: Some(WORKLOG_CATEGORY_SHORT_LABEL.to_string()),
            entries: vec![directory_entry, worklog_entry],
        });
}

fn writable_worklog_path(path: &Path) -> Result<PathBuf> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => fs::canonicalize(path)
            .with_context(|| format!("workspace worklog symlink is broken: {}", path.display())),
        Ok(_) => Ok(path.to_path_buf()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(path.to_path_buf()),
        Err(error) => Err(error)
            .with_context(|| format!("failed to inspect workspace worklog: {}", path.display())),
    }
}

fn append_workspace_worklog_entry(
    workspace: &ProjectWorkspaceConfig,
    kind: String,
    summary: String,
    detail: Option<String>,
    marker: Option<&str>,
) -> Result<Option<WorkspaceWorklogAppendResult>> {
    let status = workspace_resource_status(workspace).with_context(|| {
        format!(
            "workspace {} has no resource directory; run workspace resources-init first",
            workspace.key
        )
    })?;
    let path = PathBuf::from(&status.worklog_path);
    let recorded_at = Local::now().format("%Y-%m-%d %H:%M:%S %:z").to_string();
    let entry = worklog_entry(&recorded_at, &kind, &summary, detail.as_deref(), marker);
    let write_path = writable_worklog_path(&path)?;
    let appended = with_config_file_lock(&write_path, || {
        let mut content = if write_path.exists() {
            fs::read_to_string(&write_path).with_context(|| {
                format!("failed to read workspace worklog: {}", write_path.display())
            })?
        } else {
            worklog_template(workspace)
        };
        if marker.is_some_and(|marker| content.contains(marker)) {
            return Ok(false);
        }
        if !content.ends_with('\n') {
            content.push('\n');
        }
        content.push_str(&entry);
        write_config_text_atomic(&write_path, content)?;
        Ok(true)
    })?;
    Ok(appended.then_some(WorkspaceWorklogAppendResult {
        workspace_key: workspace.key.clone(),
        path: path.display().to_string(),
        kind,
        summary,
        recorded_at,
    }))
}

fn truncate_content_from_start(content: String, max_chars: usize) -> (String, bool) {
    let char_count = content.chars().count();
    if char_count <= max_chars {
        return (content, false);
    }
    let start = content
        .char_indices()
        .nth(char_count - max_chars)
        .map(|(index, _)| index)
        .unwrap_or(0);
    (content[start..].to_string(), true)
}

fn worklog_template(workspace: &ProjectWorkspaceConfig) -> String {
    format!(
        "# {} 工作记录\n\n- 工作区: `{}`\n- 创建时间: {}\n\n## 记录约定\n\n按时间记录需求相关的优化、修复、决策与验证结果。\n\n",
        workspace.name,
        workspace.key,
        Local::now().format("%Y-%m-%d %H:%M:%S %:z")
    )
}

fn worklog_entry(
    recorded_at: &str,
    kind: &str,
    summary: &str,
    detail: Option<&str>,
    marker: Option<&str>,
) -> String {
    let mut output = format!("## {recorded_at} · {kind} · {summary}\n");
    if let Some(marker) = marker {
        output.push_str(marker);
        output.push('\n');
    }
    if let Some(detail) = detail {
        output.push_str("\n");
        output.push_str(detail);
        output.push('\n');
    }
    output.push('\n');
    output
}

fn normalize_worklog_event_id(value: &str) -> Option<String> {
    let mut normalized = String::new();
    for character in value.trim().chars().take(160) {
        if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | ':') {
            normalized.push(character);
        } else if !normalized.ends_with('-') {
            normalized.push('-');
        }
    }
    let normalized = normalized.trim_matches('-').to_string();
    (!normalized.is_empty()).then_some(normalized)
}

fn require_heading_text(label: &str, value: &str) -> Result<String> {
    let value = value
        .lines()
        .filter_map(normalize_text)
        .collect::<Vec<_>>()
        .join(" ");
    normalize_text(&value).with_context(|| format!("{label} is required"))
}

fn normalize_text(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{CreateProjectWorkspaceRequest, create_project_workspace};
    use crate::navigation::load_navigation_data_for_workspace;
    use uuid::Uuid;

    fn paths() -> ConfigPaths {
        let root =
            std::env::temp_dir().join(format!("rdevtool-workspace-resources-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        ConfigPaths {
            dir: root.clone(),
            projects: root.join("projects.toml"),
            workspace: root.join("workspace.toml"),
            project_workspaces: root.join("workspaces"),
        }
    }

    fn create_workspace(paths: &ConfigPaths) -> ProjectWorkspaceConfig {
        create_project_workspace(
            paths,
            CreateProjectWorkspaceRequest {
                key: "feature-a".to_string(),
                name: "Feature A".to_string(),
                description: None,
                workspace_type: None,
                root_dir: Some(paths.dir.join("feature-a")),
                copy_from: None,
                activate: false,
            },
        )
        .unwrap()
    }

    #[test]
    fn initializes_resource_directory_and_worklog_entry() {
        let paths = paths();
        let workspace = create_workspace(&paths);
        let (workspace, status) =
            initialize_workspace_resources(&paths, &workspace.key, None, None, true).unwrap();

        assert!(status.worklog_created);
        assert!(Path::new(&status.worklog_path).exists());
        assert_eq!(
            workspace.resource_dir,
            Some(paths.dir.join("feature-a/resources"))
        );
        assert_eq!(workspace.worklog_file, Some(PathBuf::from("WORKLOG.md")));
        assert!(workspace.resource_categories.iter().any(|category| {
            category
                .entries
                .iter()
                .any(|entry| entry.name == WORKLOG_ENTRY_NAME)
        }));
        let navigation = load_navigation_data_for_workspace(&workspace).unwrap();
        let kinds = navigation
            .categories
            .iter()
            .flat_map(|category| category.entries.iter().map(|entry| entry.kind.as_str()))
            .collect::<Vec<_>>();
        assert!(kinds.contains(&"directory"));
        assert!(kinds.contains(&"file"));
    }

    #[test]
    fn appends_and_reads_recent_worklog_content() {
        let paths = paths();
        let workspace = create_workspace(&paths);
        initialize_workspace_resources(&paths, &workspace.key, None, None, true).unwrap();

        append_workspace_worklog(
            &paths,
            &workspace.key,
            "修复",
            "修复分支刷新",
            Some("切换项目后主动获取远程分支。"),
        )
        .unwrap();
        let content = read_workspace_worklog(&paths, &workspace.key, 20).unwrap();

        assert!(content.content.contains("修复分支刷新"));
        assert!(content.content.contains("主动获取远程分支"));
    }

    #[test]
    fn automatically_records_terminal_operation_once() {
        let paths = paths();
        let workspace = create_workspace(&paths);
        initialize_workspace_resources(&paths, &workspace.key, None, None, true).unwrap();
        let event = WorkspaceOperationWorklogEvent {
            event_id: Some("build:history-1:success".to_string()),
            kind: "构建".to_string(),
            summary: "管理端构建完成".to_string(),
            detail: Some("- 项目: `admin`".to_string()),
            success: true,
        };

        let first =
            append_workspace_operation_worklog(&paths, &workspace.key, event.clone()).unwrap();
        let second = append_workspace_operation_worklog(&paths, &workspace.key, event).unwrap();
        let content = read_workspace_worklog(&paths, &workspace.key, 40).unwrap();

        assert!(first.is_some());
        assert!(second.is_none());
        assert_eq!(content.content.matches("管理端构建完成").count(), 1);
        assert!(content.content.contains("- 结果: 成功"));
        assert!(
            content
                .content
                .contains("<!-- rdevtool:auto:build:history-1:success -->")
        );
    }

    #[test]
    fn automatic_recording_respects_workspace_setting() {
        let paths = paths();
        let workspace = create_workspace(&paths);
        let (mut workspace, status) =
            initialize_workspace_resources(&paths, &workspace.key, None, None, true).unwrap();
        workspace.worklog_auto_record = false;
        save_project_workspace_config(
            &paths
                .project_workspaces
                .join(format!("{}.toml", workspace.key)),
            &workspace,
        )
        .unwrap();

        let result = append_workspace_operation_worklog(
            &paths,
            &workspace.key,
            WorkspaceOperationWorklogEvent {
                event_id: None,
                kind: "Git".to_string(),
                summary: "合并完成".to_string(),
                detail: None,
                success: true,
            },
        )
        .unwrap();

        assert!(result.is_none());
        assert!(
            !fs::read_to_string(status.worklog_path)
                .unwrap()
                .contains("合并完成")
        );
    }

    #[cfg(unix)]
    #[test]
    fn appending_to_a_symlinked_worklog_preserves_the_symlink() {
        use std::os::unix::fs::symlink;

        let paths = paths();
        let workspace = create_workspace(&paths);
        let resource_dir = paths.dir.join("linked-resources");
        let source = paths.dir.join("shared-worklog.md");
        fs::create_dir_all(&resource_dir).unwrap();
        fs::write(&source, "# Shared\n").unwrap();
        symlink(&source, resource_dir.join(DEFAULT_WORKSPACE_WORKLOG_FILE)).unwrap();
        initialize_workspace_resources(
            &paths,
            &workspace.key,
            Some(resource_dir.clone()),
            None,
            true,
        )
        .unwrap();

        append_workspace_worklog(&paths, &workspace.key, "记录", "保留链接", None).unwrap();

        assert!(
            fs::symlink_metadata(resource_dir.join(DEFAULT_WORKSPACE_WORKLOG_FILE))
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert!(fs::read_to_string(source).unwrap().contains("保留链接"));
    }

    #[test]
    fn worklog_content_is_bounded_for_agent_context() {
        let content = "前".repeat(MAX_WORKLOG_CONTENT_CHARS + 20);
        let (content, truncated) = truncate_content_from_start(content, MAX_WORKLOG_CONTENT_CHARS);

        assert!(truncated);
        assert_eq!(content.chars().count(), MAX_WORKLOG_CONTENT_CHARS);
    }

    #[test]
    fn rejects_worklog_path_outside_resource_directory() {
        assert!(validate_workspace_worklog_file(PathBuf::from("../WORKLOG.md")).is_err());
        assert!(validate_workspace_worklog_file(PathBuf::from("WORKLOG.txt")).is_err());
    }

    #[test]
    fn copied_workspace_does_not_reuse_source_resource_directory() {
        let paths = paths();
        let source = create_workspace(&paths);
        let (source, _) =
            initialize_workspace_resources(&paths, &source.key, None, None, true).unwrap();
        let copied = create_project_workspace(
            &paths,
            CreateProjectWorkspaceRequest {
                key: "feature-b".to_string(),
                name: "Feature B".to_string(),
                description: None,
                workspace_type: None,
                root_dir: Some(paths.dir.join("feature-b")),
                copy_from: Some(source),
                activate: false,
            },
        )
        .unwrap();

        assert!(copied.resource_dir.is_none());
        assert!(copied.worklog_file.is_none());
        assert!(copied.resource_categories.is_empty());
    }

    #[test]
    fn system_workspace_discards_resource_configuration() {
        let workspace = ProjectWorkspaceConfig {
            resource_dir: Some(PathBuf::from("/tmp/resources")),
            worklog_file: Some(PathBuf::from("WORKLOG.md")),
            ..ProjectWorkspaceConfig::default()
        }
        .normalized();

        assert!(workspace.resource_dir.is_none());
        assert!(workspace.worklog_file.is_none());
    }
}
