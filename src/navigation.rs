#![allow(dead_code)]

use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

use crate::config::{
    ProjectWorkspaceConfig, ProjectWorkspaceResourceCategoryConfig,
    ProjectWorkspaceResourceEntryConfig, RuntimeProfileConfig, default_config_dir,
};
use crate::config_store::write_config_text_atomic;

const DEFAULT_NAVIGATION_TEMPLATE: &str = include_str!("../navigation.template.toml");
const LEGACY_NAVIGATION_MARKDOWN_PATH: &str = "navigation.md";

pub fn default_navigation_path() -> PathBuf {
    default_config_dir().join("navigation.toml")
}

pub fn navigation_file_path() -> String {
    default_navigation_path().display().to_string()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationEntry {
    pub name: String,
    pub kind: String,
    pub target_label: String,
    pub url: Option<String>,
    pub browser: Option<String>,
    pub browser_profile: Option<String>,
    pub runtime_profile: Option<String>,
    pub bundle_id: Option<String>,
    pub app_name: Option<String>,
    pub script: Option<String>,
    pub tool: Option<String>,
    pub tool_key: Option<String>,
    pub tool_action: Option<String>,
    pub path: Option<String>,
    pub cwd: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationCategory {
    pub title: String,
    pub short_label: String,
    pub entries: Vec<NavigationEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationData {
    pub file_path: String,
    pub preferred_category: Option<String>,
    pub categories: Vec<NavigationCategory>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationEditorEntry {
    pub name: String,
    pub kind: String,
    pub url: Option<String>,
    pub browser: Option<String>,
    pub browser_profile: Option<String>,
    pub runtime_profile: Option<String>,
    pub bundle_id: Option<String>,
    pub app_name: Option<String>,
    pub script: Option<String>,
    pub tool: Option<String>,
    pub tool_key: Option<String>,
    pub tool_action: Option<String>,
    pub path: Option<String>,
    pub cwd: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationEditorCategory {
    pub title: String,
    pub short_label: String,
    pub entries: Vec<NavigationEditorEntry>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationEditorData {
    pub file_path: String,
    pub preferred_category: Option<String>,
    pub categories: Vec<NavigationEditorCategory>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationOpenResult {
    pub url: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationIndexEntry {
    pub category_title: String,
    pub category_short_label: String,
    pub kind: String,
    pub name: String,
    pub target_label: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
struct NavigationFileConfig {
    #[serde(default)]
    preferred_category: Option<String>,
    #[serde(default)]
    categories: Vec<NavigationCategoryConfig>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct NavigationCategoryConfig {
    title: String,
    #[serde(default)]
    short_label: Option<String>,
    #[serde(default)]
    entries: Vec<NavigationEntryConfig>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct NavigationEntryConfig {
    name: String,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    url: String,
    #[serde(default)]
    browser: Option<String>,
    #[serde(default)]
    browser_profile: Option<String>,
    #[serde(default)]
    runtime_profile: Option<String>,
    #[serde(default)]
    bundle_id: Option<String>,
    #[serde(default)]
    app_name: Option<String>,
    #[serde(default)]
    script: Option<String>,
    #[serde(default)]
    tool: Option<String>,
    #[serde(default, alias = "tool_key")]
    tool_key: Option<String>,
    #[serde(default, alias = "tool_action")]
    tool_action: Option<String>,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    note: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NavigationEntryKind {
    Url,
    App,
    Script,
    Tool,
    Directory,
    File,
}

impl NavigationEntryKind {
    fn key(self) -> &'static str {
        match self {
            Self::Url => "url",
            Self::App => "app",
            Self::Script => "script",
            Self::Tool => "tool",
            Self::Directory => "directory",
            Self::File => "file",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Url => "网站",
            Self::App => "应用",
            Self::Script => "脚本",
            Self::Tool => "工具",
            Self::Directory => "目录",
            Self::File => "文件",
        }
    }
}

pub fn load_navigation_data() -> Result<NavigationData> {
    load_navigation_data_from_path(&default_navigation_path())
}

pub fn load_navigation_data_from_path(path: &Path) -> Result<NavigationData> {
    let path = ensure_navigation_config_at(path)?;
    let content = fs::read_to_string(&path)
        .with_context(|| format!("failed to read navigation config: {}", path.display()))?;
    let config: NavigationFileConfig = toml::from_str(&content)
        .with_context(|| format!("failed to parse navigation config: {}", path.display()))?;

    Ok(navigation_data_from_config(
        config,
        path.display().to_string(),
    ))
}

pub fn load_navigation_data_for_workspace(
    workspace: &ProjectWorkspaceConfig,
) -> Result<NavigationData> {
    let data = load_navigation_data()?;
    Ok(merge_workspace_resource_categories(
        filter_navigation_data_for_workspace(data, workspace),
        workspace,
    ))
}

pub fn load_navigation_source_data_for_workspace(
    path: &Path,
    workspace: &ProjectWorkspaceConfig,
) -> Result<NavigationData> {
    let data = load_navigation_data_from_path(path)?;
    Ok(merge_workspace_resource_categories(data, workspace))
}

pub fn filter_navigation_data_for_workspace(
    data: NavigationData,
    workspace: &ProjectWorkspaceConfig,
) -> NavigationData {
    if workspace.include_all_navigation {
        return data;
    }

    let category_filter = workspace
        .navigation_categories
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let entry_filter = workspace
        .navigation_entries
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();

    let categories = data
        .categories
        .into_iter()
        .filter_map(|category| {
            if category_filter.contains(category.title.as_str()) {
                return Some(category);
            }

            let title = category.title.clone();
            let entries = category
                .entries
                .into_iter()
                .filter(|entry| {
                    let scoped_name = format!("{}/{}", title, entry.name);
                    entry_filter.contains(entry.name.as_str())
                        || entry_filter.contains(scoped_name.as_str())
                })
                .collect::<Vec<_>>();

            if entries.is_empty() {
                return None;
            }

            Some(NavigationCategory {
                title: category.title,
                short_label: category.short_label,
                entries,
            })
        })
        .collect::<Vec<_>>();

    let preferred_category = data
        .preferred_category
        .filter(|target| categories.iter().any(|category| category.title == *target))
        .or_else(|| preferred_navigation_category(&categories));

    NavigationData {
        file_path: data.file_path,
        preferred_category,
        categories,
    }
}

fn merge_workspace_resource_categories(
    mut data: NavigationData,
    workspace: &ProjectWorkspaceConfig,
) -> NavigationData {
    let workspace_categories = workspace_resource_categories(workspace);
    if workspace_categories.is_empty() {
        return data;
    }

    for category in workspace_categories.into_iter().rev() {
        if let Some(existing) = data
            .categories
            .iter_mut()
            .find(|existing| existing.title == category.title)
        {
            let mut entries = category.entries;
            entries.append(&mut existing.entries);
            existing.entries = entries;
            if existing.short_label.trim().is_empty() {
                existing.short_label = category.short_label;
            }
        } else {
            data.categories.insert(0, category);
        }
    }

    if data.preferred_category.is_none()
        || !data.categories.iter().any(|category| {
            data.preferred_category
                .as_deref()
                .is_some_and(|target| target == category.title)
        })
    {
        data.preferred_category = preferred_navigation_category(&data.categories);
    }

    data
}

fn workspace_resource_categories(workspace: &ProjectWorkspaceConfig) -> Vec<NavigationCategory> {
    workspace
        .resource_categories
        .iter()
        .filter_map(|category| workspace_resource_category(category, workspace.root_dir.as_deref()))
        .collect()
}

fn workspace_resource_category(
    category: &ProjectWorkspaceResourceCategoryConfig,
    root_dir: Option<&Path>,
) -> Option<NavigationCategory> {
    let title = category.title.trim().to_string();
    if title.is_empty() {
        return None;
    }
    let entries = category
        .entries
        .iter()
        .filter_map(|entry| workspace_resource_entry(entry, root_dir))
        .collect::<Vec<_>>();
    if entries.is_empty() {
        return None;
    }
    Some(NavigationCategory {
        short_label: category
            .short_label
            .as_deref()
            .and_then(|value| normalize_optional_text(Some(value.to_string())))
            .unwrap_or_else(|| navigation_category_label(&title)),
        title,
        entries,
    })
}

fn workspace_resource_entry(
    entry: &ProjectWorkspaceResourceEntryConfig,
    root_dir: Option<&Path>,
) -> Option<NavigationEntry> {
    navigation_entry_from_config(workspace_resource_entry_config(entry, root_dir))
}

fn workspace_resource_entry_config(
    entry: &ProjectWorkspaceResourceEntryConfig,
    root_dir: Option<&Path>,
) -> NavigationEntryConfig {
    NavigationEntryConfig {
        name: entry.name.clone(),
        kind: entry.kind.clone(),
        url: entry.url.clone(),
        browser: entry.browser.clone(),
        browser_profile: entry.browser_profile.clone(),
        runtime_profile: entry.runtime_profile.clone(),
        bundle_id: entry.bundle_id.clone(),
        app_name: entry.app_name.clone(),
        script: resolve_workspace_resource_path(entry.script.as_deref(), root_dir),
        tool: entry.tool.clone(),
        tool_key: entry.tool_key.clone(),
        tool_action: entry.tool_action.clone(),
        path: resolve_workspace_resource_path(entry.path.as_deref(), root_dir),
        cwd: resolve_workspace_resource_path(entry.cwd.as_deref(), root_dir),
        note: entry.note.clone(),
    }
}

fn resolve_workspace_resource_path(value: Option<&str>, root_dir: Option<&Path>) -> Option<String> {
    let value = value.map(str::trim).filter(|value| !value.is_empty())?;
    let path = PathBuf::from(value);
    if path.is_absolute() {
        return Some(path.display().to_string());
    }
    root_dir.map(|root| root.join(path).display().to_string())
}

pub fn load_navigation_editor_data() -> Result<NavigationEditorData> {
    load_navigation_editor_data_from_path(&default_navigation_path())
}

pub fn load_navigation_editor_data_from_path(path: &Path) -> Result<NavigationEditorData> {
    let path = ensure_navigation_config_at(path)?;
    let content = fs::read_to_string(&path)
        .with_context(|| format!("failed to read navigation config: {}", path.display()))?;
    let config: NavigationFileConfig = toml::from_str(&content)
        .with_context(|| format!("failed to parse navigation config: {}", path.display()))?;

    Ok(NavigationEditorData {
        file_path: path.display().to_string(),
        preferred_category: config
            .preferred_category
            .and_then(|value| normalize_optional_text(Some(value))),
        categories: config
            .categories
            .into_iter()
            .map(navigation_editor_category_from_config)
            .collect(),
    })
}

pub fn save_navigation_editor_data(data: NavigationEditorData) -> Result<NavigationData> {
    save_navigation_editor_data_to_path(data, &default_navigation_path())
}

pub fn save_navigation_editor_data_to_path(
    data: NavigationEditorData,
    path: &Path,
) -> Result<NavigationData> {
    let path = ensure_navigation_config_at(path)?;
    let config = navigation_file_config_from_editor(data)?;
    let content =
        toml::to_string_pretty(&config).context("failed to serialize navigation config")?;
    write_config_text_atomic(&path, content)
        .with_context(|| format!("failed to write navigation config: {}", path.display()))?;
    load_navigation_data_from_path(&path)
}

fn ensure_navigation_config() -> Result<PathBuf> {
    ensure_navigation_config_at(&default_navigation_path())
}

pub fn ensure_navigation_config_at(path: &Path) -> Result<PathBuf> {
    let path = path.to_path_buf();
    if path.exists() {
        return Ok(path);
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "failed to create navigation config dir: {}",
                parent.display()
            )
        })?;
    }

    let legacy_path = PathBuf::from(LEGACY_NAVIGATION_MARKDOWN_PATH);
    let content = if path == default_navigation_path() && legacy_path.exists() {
        let markdown = fs::read_to_string(&legacy_path).with_context(|| {
            format!(
                "failed to read legacy navigation file: {}",
                legacy_path.display()
            )
        })?;
        let data = parse_navigation_markdown(&markdown, legacy_path.display().to_string());
        if data.categories.is_empty() {
            DEFAULT_NAVIGATION_TEMPLATE.to_string()
        } else {
            toml::to_string_pretty(&navigation_config_from_data(&data))
                .context("failed to serialize migrated navigation config")?
        }
    } else {
        DEFAULT_NAVIGATION_TEMPLATE.to_string()
    };

    write_config_text_atomic(&path, content)
        .with_context(|| format!("failed to write navigation config: {}", path.display()))?;
    Ok(path)
}

fn navigation_data_from_config(config: NavigationFileConfig, file_path: String) -> NavigationData {
    let categories = config
        .categories
        .into_iter()
        .filter_map(|category| {
            let title = category.title.trim().to_string();
            if title.is_empty() {
                return None;
            }

            let entries = category
                .entries
                .into_iter()
                .filter_map(navigation_entry_from_config)
                .collect::<Vec<_>>();

            if entries.is_empty() {
                return None;
            }

            let short_label = category
                .short_label
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .unwrap_or_else(|| navigation_category_label(&title));

            Some(NavigationCategory {
                title,
                short_label,
                entries,
            })
        })
        .collect::<Vec<_>>();

    let preferred_category = config
        .preferred_category
        .and_then(|target| {
            let target = target.trim().to_string();
            categories
                .iter()
                .any(|category| category.title == target)
                .then_some(target)
        })
        .or_else(|| preferred_navigation_category(&categories));

    NavigationData {
        file_path,
        preferred_category,
        categories,
    }
}

fn navigation_entry_from_config(entry: NavigationEntryConfig) -> Option<NavigationEntry> {
    let name = entry.name.trim().to_string();
    if name.is_empty() {
        return None;
    }

    let kind = resolve_entry_kind(&entry)?;
    let note = normalize_optional_text(entry.note);
    let url = normalize_non_empty(entry.url);
    let browser = normalize_optional_text(entry.browser);
    let browser_profile = normalize_optional_text(entry.browser_profile);
    let runtime_profile = normalize_optional_text(entry.runtime_profile);
    let bundle_id = normalize_optional_text(entry.bundle_id);
    let app_name = normalize_optional_text(entry.app_name);
    let script = normalize_optional_text(entry.script);
    let tool = normalize_optional_text(entry.tool)
        .or_else(|| matches!(kind, NavigationEntryKind::Tool).then(|| "link".to_string()));
    let tool_key = normalize_optional_text(entry.tool_key);
    let tool_action = normalize_optional_text(entry.tool_action);
    let path = normalize_optional_text(entry.path);
    let cwd = normalize_optional_text(entry.cwd);

    let target_label = match kind {
        NavigationEntryKind::Url => {
            let value = url.as_ref()?;
            if !is_http_url(value) {
                return None;
            }
            value.clone()
        }
        NavigationEntryKind::App => bundle_id
            .clone()
            .or_else(|| app_name.clone())
            .filter(|value| !value.is_empty())?,
        NavigationEntryKind::Script => script.clone().filter(|value| !value.is_empty())?,
        NavigationEntryKind::Tool => tool_key
            .clone()
            .or_else(|| tool.clone())
            .unwrap_or_else(|| "tool".to_string()),
        NavigationEntryKind::Directory => path.clone().filter(|value| !value.is_empty())?,
        NavigationEntryKind::File => path.clone().filter(|value| !value.is_empty())?,
    };

    Some(NavigationEntry {
        name,
        kind: kind.key().to_string(),
        target_label,
        url: if matches!(kind, NavigationEntryKind::Url) {
            url
        } else {
            None
        },
        browser: if matches!(kind, NavigationEntryKind::Url) {
            browser
        } else {
            None
        },
        browser_profile: if matches!(kind, NavigationEntryKind::Url) {
            browser_profile
        } else {
            None
        },
        runtime_profile: if matches!(kind, NavigationEntryKind::Url) {
            runtime_profile
        } else {
            None
        },
        bundle_id: if matches!(kind, NavigationEntryKind::App) {
            bundle_id
        } else {
            None
        },
        app_name: if matches!(kind, NavigationEntryKind::App) {
            app_name
        } else {
            None
        },
        script: if matches!(kind, NavigationEntryKind::Script) {
            script
        } else {
            None
        },
        tool: if matches!(kind, NavigationEntryKind::Tool) {
            tool
        } else {
            None
        },
        tool_key: if matches!(kind, NavigationEntryKind::Tool) {
            tool_key
        } else {
            None
        },
        tool_action: if matches!(kind, NavigationEntryKind::Tool) {
            tool_action
        } else {
            None
        },
        path: if matches!(
            kind,
            NavigationEntryKind::Directory | NavigationEntryKind::File
        ) {
            path
        } else {
            None
        },
        cwd: if matches!(kind, NavigationEntryKind::Script) {
            cwd
        } else {
            None
        },
        note,
    })
}

fn navigation_entry_config_from_entry(entry: &NavigationEntry) -> NavigationEntryConfig {
    NavigationEntryConfig {
        name: entry.name.clone(),
        kind: Some(entry.kind.clone()),
        url: entry.url.clone().unwrap_or_default(),
        browser: entry.browser.clone(),
        browser_profile: entry.browser_profile.clone(),
        runtime_profile: entry.runtime_profile.clone(),
        bundle_id: entry.bundle_id.clone(),
        app_name: entry.app_name.clone(),
        script: entry.script.clone(),
        tool: entry.tool.clone(),
        tool_key: entry.tool_key.clone(),
        tool_action: entry.tool_action.clone(),
        path: entry.path.clone(),
        cwd: entry.cwd.clone(),
        note: entry.note.clone(),
    }
}

fn navigation_editor_category_from_config(
    category: NavigationCategoryConfig,
) -> NavigationEditorCategory {
    let title = category.title.trim().to_string();
    let short_label = category
        .short_label
        .and_then(|value| normalize_optional_text(Some(value)))
        .unwrap_or_else(|| navigation_category_label(&title));

    NavigationEditorCategory {
        title,
        short_label,
        entries: category
            .entries
            .into_iter()
            .map(navigation_editor_entry_from_config)
            .collect(),
    }
}

fn navigation_editor_entry_from_config(entry: NavigationEntryConfig) -> NavigationEditorEntry {
    let kind = entry
        .kind
        .as_deref()
        .and_then(normalize_entry_kind)
        .or_else(|| resolve_entry_kind(&entry).map(|kind| kind.key().to_string()))
        .unwrap_or_else(|| NavigationEntryKind::Url.key().to_string());

    NavigationEditorEntry {
        name: entry.name.trim().to_string(),
        kind,
        url: normalize_optional_text(Some(entry.url)),
        browser: normalize_optional_text(entry.browser),
        browser_profile: normalize_optional_text(entry.browser_profile),
        runtime_profile: normalize_optional_text(entry.runtime_profile),
        bundle_id: normalize_optional_text(entry.bundle_id),
        app_name: normalize_optional_text(entry.app_name),
        script: normalize_optional_text(entry.script),
        tool: normalize_optional_text(entry.tool),
        tool_key: normalize_optional_text(entry.tool_key),
        tool_action: normalize_optional_text(entry.tool_action),
        path: normalize_optional_text(entry.path),
        cwd: normalize_optional_text(entry.cwd),
        note: normalize_optional_text(entry.note),
    }
}

fn navigation_file_config_from_editor(data: NavigationEditorData) -> Result<NavigationFileConfig> {
    let mut categories = Vec::new();
    for category in data.categories {
        let title = category.title.trim().to_string();
        if title.is_empty() {
            anyhow::bail!("访达分类名称不能为空");
        }
        let short_label = normalize_optional_text(Some(category.short_label))
            .unwrap_or_else(|| navigation_category_label(&title));
        let entries = category
            .entries
            .into_iter()
            .filter(|entry| !navigation_editor_entry_is_blank(entry))
            .map(navigation_entry_config_from_editor_entry)
            .collect::<Result<Vec<_>>>()?;
        categories.push(NavigationCategoryConfig {
            title,
            short_label: Some(short_label),
            entries,
        });
    }

    let preferred_category = data
        .preferred_category
        .and_then(|value| normalize_optional_text(Some(value)))
        .filter(|value| categories.iter().any(|category| category.title == *value))
        .or_else(|| categories.first().map(|category| category.title.clone()));

    Ok(NavigationFileConfig {
        preferred_category,
        categories,
    })
}

fn navigation_editor_entry_is_blank(entry: &NavigationEditorEntry) -> bool {
    [
        entry.name.as_str(),
        entry.kind.as_str(),
        entry.url.as_deref().unwrap_or(""),
        entry.browser.as_deref().unwrap_or(""),
        entry.browser_profile.as_deref().unwrap_or(""),
        entry.runtime_profile.as_deref().unwrap_or(""),
        entry.bundle_id.as_deref().unwrap_or(""),
        entry.app_name.as_deref().unwrap_or(""),
        entry.script.as_deref().unwrap_or(""),
        entry.tool.as_deref().unwrap_or(""),
        entry.tool_key.as_deref().unwrap_or(""),
        entry.tool_action.as_deref().unwrap_or(""),
        entry.path.as_deref().unwrap_or(""),
        entry.cwd.as_deref().unwrap_or(""),
        entry.note.as_deref().unwrap_or(""),
    ]
    .iter()
    .all(|value| value.trim().is_empty())
}

fn navigation_entry_config_from_editor_entry(
    entry: NavigationEditorEntry,
) -> Result<NavigationEntryConfig> {
    let name = entry.name.trim().to_string();
    if name.is_empty() {
        anyhow::bail!("访达入口名称不能为空");
    }
    let kind = normalize_entry_kind(&entry.kind)
        .ok_or_else(|| anyhow!("不支持的访达入口类型: {}", entry.kind))?;
    let url = normalize_optional_text(entry.url);
    let browser = normalize_optional_text(entry.browser);
    let browser_profile = normalize_optional_text(entry.browser_profile);
    let runtime_profile = normalize_optional_text(entry.runtime_profile);
    let bundle_id = normalize_optional_text(entry.bundle_id);
    let app_name = normalize_optional_text(entry.app_name);
    let script = normalize_optional_text(entry.script);
    let tool = normalize_optional_text(entry.tool);
    let tool_key = normalize_optional_text(entry.tool_key);
    let tool_action = normalize_optional_text(entry.tool_action);
    let path = normalize_optional_text(entry.path);
    let cwd = normalize_optional_text(entry.cwd);
    let note = normalize_optional_text(entry.note);

    match kind.as_str() {
        "url" => {
            let Some(value) = url.as_deref() else {
                anyhow::bail!("网站入口需要填写 URL");
            };
            if !is_http_url(value) {
                anyhow::bail!("网站入口 URL 仅支持 http/https");
            }
        }
        "app" => {
            if bundle_id.is_none() && app_name.is_none() {
                anyhow::bail!("应用入口需要填写 Bundle ID 或应用名");
            }
        }
        "script" => {
            if script.is_none() {
                anyhow::bail!("脚本入口需要填写脚本路径");
            }
        }
        "tool" => {}
        "directory" => {
            let Some(value) = path.as_deref() else {
                anyhow::bail!("目录入口需要填写目录路径");
            };
            if !PathBuf::from(value).is_absolute() {
                anyhow::bail!("目录入口需要使用绝对路径");
            }
        }
        _ => unreachable!("entry kind was normalized"),
    }

    let is_url = kind == "url";
    let is_tool = kind == "tool";

    Ok(NavigationEntryConfig {
        name,
        kind: Some(kind),
        url: url.unwrap_or_default(),
        browser: if is_url { browser } else { None },
        browser_profile: if is_url { browser_profile } else { None },
        runtime_profile: if is_url { runtime_profile } else { None },
        bundle_id,
        app_name,
        script,
        tool: if is_tool {
            Some(tool.unwrap_or_else(|| "link".to_string()))
        } else {
            None
        },
        tool_key: if is_tool { tool_key } else { None },
        tool_action: if is_tool { tool_action } else { None },
        path,
        cwd,
        note,
    })
}

fn navigation_config_from_data(data: &NavigationData) -> NavigationFileConfig {
    NavigationFileConfig {
        preferred_category: data.preferred_category.clone(),
        categories: data
            .categories
            .iter()
            .map(|category| NavigationCategoryConfig {
                title: category.title.clone(),
                short_label: Some(category.short_label.clone()),
                entries: category
                    .entries
                    .iter()
                    .map(navigation_entry_config_from_entry)
                    .collect(),
            })
            .collect(),
    }
}

fn parse_navigation_markdown(content: &str, file_path: String) -> NavigationData {
    let mut categories = Vec::new();
    let mut current_title: Option<String> = None;
    let mut current_entries: Vec<NavigationEntry> = Vec::new();

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if let Some(title) = line.strip_prefix("## ") {
            if let Some(title) = current_title.take() {
                if !current_entries.is_empty() {
                    categories.push(NavigationCategory {
                        short_label: navigation_category_label(&title),
                        title,
                        entries: std::mem::take(&mut current_entries),
                    });
                }
            }
            current_title = Some(title.trim().to_string());
            continue;
        }

        if !line.starts_with('|') {
            continue;
        }

        let cells = line
            .trim_matches('|')
            .split('|')
            .map(|cell| cell.trim().trim_matches('`').to_string())
            .collect::<Vec<_>>();

        if cells.is_empty() || is_markdown_separator_row(&cells) || is_markdown_header_row(&cells) {
            continue;
        }

        if let Some(entry) = parse_nav_entry(&cells) {
            current_entries.push(entry);
        }
    }

    if let Some(title) = current_title.take() {
        if !current_entries.is_empty() {
            categories.push(NavigationCategory {
                short_label: navigation_category_label(&title),
                title,
                entries: current_entries,
            });
        }
    }

    let preferred_category = preferred_navigation_category(&categories);

    NavigationData {
        file_path,
        preferred_category,
        categories,
    }
}

pub fn open_navigation_entry(entry: &NavigationEntry) -> Result<NavigationOpenResult> {
    open_navigation_entry_with_runtime_profiles(entry, &[])
}

pub fn validate_workspace_resource_entry(
    entry: &ProjectWorkspaceResourceEntryConfig,
    root_dir: Option<&Path>,
) -> Result<()> {
    workspace_resource_entry(entry, root_dir)
        .ok_or_else(|| anyhow!("invalid workspace resource entry: {}", entry.name))?;
    Ok(())
}

pub fn open_navigation_entry_with_runtime_profiles(
    entry: &NavigationEntry,
    runtime_profiles: &[RuntimeProfileConfig],
) -> Result<NavigationOpenResult> {
    match entry_kind(entry)? {
        NavigationEntryKind::Url => open_navigation_url(entry, runtime_profiles),
        NavigationEntryKind::App => open_navigation_app(entry),
        NavigationEntryKind::Script => open_navigation_script(entry),
        NavigationEntryKind::Tool => open_navigation_tool(entry),
        NavigationEntryKind::Directory => open_navigation_directory(entry),
        NavigationEntryKind::File => open_navigation_file(entry),
    }
}

fn open_navigation_tool(entry: &NavigationEntry) -> Result<NavigationOpenResult> {
    let tool = entry.tool.as_deref().unwrap_or("tool");
    let action = entry
        .tool_action
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("open");
    let target = entry
        .tool_key
        .as_deref()
        .or(Some(entry.target_label.as_str()))
        .unwrap_or(tool);
    Ok(NavigationOpenResult {
        url: target.to_string(),
        detail: format!("工具入口 {tool} 已配置动作 {action}，请在 App 中查看或执行"),
    })
}

fn open_navigation_url(
    entry: &NavigationEntry,
    runtime_profiles: &[RuntimeProfileConfig],
) -> Result<NavigationOpenResult> {
    let url = entry
        .url
        .as_deref()
        .ok_or_else(|| anyhow!("missing url for url shortcut"))?;
    let runtime_profile =
        resolve_runtime_profile(entry.runtime_profile.as_deref(), runtime_profiles)?;
    let browser = entry
        .browser
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            runtime_profile
                .and_then(|profile| profile.browser.as_deref())
                .map(str::trim)
                .filter(|value| !value.is_empty())
        });
    let profile = entry
        .browser_profile
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            runtime_profile
                .and_then(|profile| profile.browser_profile.as_deref())
                .map(str::trim)
                .filter(|value| !value.is_empty())
        });
    let browser_user_data_dir = runtime_profile_browser_user_data_dir(runtime_profile);
    let browser_args = runtime_profile
        .map(runtime_profile_browser_args)
        .unwrap_or_default();

    let has_chromium_args =
        profile.is_some() || browser_user_data_dir.is_some() || !browser_args.is_empty();
    if has_chromium_args {
        let app_name = match browser.map(normalize_browser_choice) {
            Some(NavigationBrowserChoice::App(app_name)) => app_name.to_string(),
            _ => "Google Chrome".to_string(),
        };
        let result = open_chromium_instance(
            &app_name,
            profile,
            browser_user_data_dir.as_deref(),
            &browser_args,
            url,
        )?;
        return Ok(with_runtime_profile_detail(result, runtime_profile));
    }

    let result = match browser.map(normalize_browser_choice) {
        None | Some(NavigationBrowserChoice::CurrentChrome) => open_in_current_chrome(url),
        Some(NavigationBrowserChoice::System) => open_system_browser(url),
        Some(NavigationBrowserChoice::App(app_name)) => {
            if let Some(profile) = profile {
                open_chromium_profile(&app_name, profile, url)
            } else {
                open_browser_app(&app_name, url)
            }
        }
    }?;
    Ok(with_runtime_profile_detail(result, runtime_profile))
}

fn resolve_runtime_profile<'a>(
    key: Option<&str>,
    runtime_profiles: &'a [RuntimeProfileConfig],
) -> Result<Option<&'a RuntimeProfileConfig>> {
    let Some(key) = key.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    runtime_profiles
        .iter()
        .find(|profile| profile.key == key)
        .map(Some)
        .ok_or_else(|| anyhow!("运行配置不存在: {}", key))
}

fn with_runtime_profile_detail(
    mut result: NavigationOpenResult,
    runtime_profile: Option<&RuntimeProfileConfig>,
) -> NavigationOpenResult {
    if let Some(profile) = runtime_profile {
        result.detail = format!(
            "{} · 运行配置 {}",
            result.detail,
            if profile.label.trim().is_empty() {
                profile.key.as_str()
            } else {
                profile.label.as_str()
            }
        );
    }
    result
}

enum NavigationBrowserChoice<'a> {
    CurrentChrome,
    System,
    App(&'a str),
}

fn normalize_browser_choice(value: &str) -> NavigationBrowserChoice<'_> {
    match value.trim().to_ascii_lowercase().as_str() {
        "" | "current_chrome" | "current chrome" | "chrome_current" | "chrome-current" => {
            NavigationBrowserChoice::CurrentChrome
        }
        "system" | "default" | "system_default" | "default_browser" => {
            NavigationBrowserChoice::System
        }
        _ => NavigationBrowserChoice::App(value.trim()),
    }
}

pub fn open_in_current_chrome(url: &str) -> Result<NavigationOpenResult> {
    let script = [
        "on run argv",
        "set targetUrl to item 1 of argv",
        "tell application \"Google Chrome\"",
        "activate",
        "if (count of windows) = 0 then",
        "make new window",
        "end if",
        "set URL of active tab of front window to targetUrl",
        "end tell",
        "end run",
    ];

    let mut command = Command::new("osascript");
    for line in script {
        command.arg("-e").arg(line);
    }
    command.arg("--").arg(url);

    let output = command
        .output()
        .map_err(|error| anyhow!("failed to call osascript: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("failed to open Chrome tab: {}", stderr.trim());
    }

    Ok(NavigationOpenResult {
        url: url.to_string(),
        detail: "已在当前 Chrome 窗口打开入口".to_string(),
    })
}

fn open_system_browser(url: &str) -> Result<NavigationOpenResult> {
    let status = Command::new("open")
        .arg(url)
        .status()
        .map_err(|error| anyhow!("failed to open system browser: {error}"))?;
    if !status.success() {
        anyhow::bail!("failed to open system browser");
    }

    Ok(NavigationOpenResult {
        url: url.to_string(),
        detail: "已使用系统默认浏览器打开入口".to_string(),
    })
}

fn open_browser_app(app_name: &str, url: &str) -> Result<NavigationOpenResult> {
    let status = Command::new("open")
        .arg("-a")
        .arg(app_name)
        .arg(url)
        .status()
        .map_err(|error| anyhow!("failed to open browser app: {error}"))?;
    if !status.success() {
        anyhow::bail!("failed to open browser app: {}", app_name);
    }

    Ok(NavigationOpenResult {
        url: url.to_string(),
        detail: format!("已使用 {} 打开入口", app_name),
    })
}

fn open_chromium_profile(app_name: &str, profile: &str, url: &str) -> Result<NavigationOpenResult> {
    if !browser_supports_profile(app_name) {
        anyhow::bail!("{} 暂不支持 profile 打开方式", app_name);
    }

    let status = Command::new("open")
        .arg("-na")
        .arg(app_name)
        .arg("--args")
        .arg(format!("--profile-directory={profile}"))
        .arg(url)
        .status()
        .map_err(|error| anyhow!("failed to open browser profile: {error}"))?;
    if !status.success() {
        anyhow::bail!("failed to open {} profile: {}", app_name, profile);
    }

    Ok(NavigationOpenResult {
        url: url.to_string(),
        detail: format!("已使用 {} · {} 打开入口", app_name, profile),
    })
}

fn open_chromium_instance(
    app_name: &str,
    profile: Option<&str>,
    user_data_dir: Option<&Path>,
    browser_args: &[String],
    url: &str,
) -> Result<NavigationOpenResult> {
    if !browser_supports_profile(app_name) {
        anyhow::bail!("{} 暂不支持运行配置打开方式", app_name);
    }

    let mut command = Command::new("open");
    command.arg("-na").arg(app_name).arg("--args");
    if let Some(profile) = profile {
        command.arg(format!("--profile-directory={profile}"));
    }
    if let Some(user_data_dir) = user_data_dir {
        command.arg(format!("--user-data-dir={}", user_data_dir.display()));
    }
    for arg in browser_args {
        command.arg(arg);
    }
    command.arg(url);

    let status = command
        .status()
        .map_err(|error| anyhow!("failed to open browser runtime profile: {error}"))?;
    if !status.success() {
        anyhow::bail!("failed to open {} runtime profile", app_name);
    }

    Ok(NavigationOpenResult {
        url: url.to_string(),
        detail: format!("已使用 {} 运行配置打开入口", app_name),
    })
}

pub(crate) fn runtime_profile_browser_args(profile: &RuntimeProfileConfig) -> Vec<String> {
    let mut args = Vec::new();
    if profile.web_actions_enabled {
        args.push(format!(
            "--remote-debugging-port={}",
            profile.web_actions_port
        ));
    }
    let proxy_url = profile.proxy_url.trim();
    if !proxy_url.is_empty() {
        args.push(format!("--proxy-server={proxy_url}"));
    }
    let proxy_bypass = profile.proxy_bypass.trim();
    if !proxy_bypass.is_empty() {
        args.push(format!("--proxy-bypass-list={proxy_bypass}"));
    }
    let host_resolver_rules = profile
        .host_resolver_rules
        .iter()
        .map(|rule| rule.trim())
        .filter(|rule| !rule.is_empty())
        .collect::<Vec<_>>();
    if !host_resolver_rules.is_empty() {
        args.push(format!(
            "--host-resolver-rules={}",
            host_resolver_rules.join(", ")
        ));
    }
    args.extend(
        profile
            .browser_args
            .iter()
            .map(|arg| arg.trim())
            .filter(|arg| {
                !arg.is_empty()
                    && (!profile.web_actions_enabled
                        || !arg
                            .to_ascii_lowercase()
                            .starts_with("--remote-debugging-port"))
            })
            .map(ToString::to_string),
    );
    args
}

pub(crate) fn runtime_profile_browser_user_data_dir(
    profile: Option<&RuntimeProfileConfig>,
) -> Option<PathBuf> {
    profile.and_then(|profile| {
        profile
            .web_actions_user_data_dir
            .clone()
            .or_else(|| profile.browser_user_data_dir.clone())
            .or_else(|| {
                profile
                    .web_actions_enabled
                    .then(|| default_config_dir().join("chrome-cdp-profile"))
            })
    })
}

fn browser_supports_profile(app_name: &str) -> bool {
    let normalized = app_name.trim().to_ascii_lowercase();
    normalized.contains("chrome")
        || normalized.contains("edge")
        || normalized.contains("chromium")
        || normalized.contains("brave")
}

fn open_navigation_app(entry: &NavigationEntry) -> Result<NavigationOpenResult> {
    if let Some(bundle_id) = entry.bundle_id.as_deref() {
        let status = Command::new("open")
            .arg("-b")
            .arg(bundle_id)
            .status()
            .map_err(|error| anyhow!("failed to open app bundle: {error}"))?;
        if !status.success() {
            anyhow::bail!("failed to open app bundle: {}", bundle_id);
        }
        return Ok(NavigationOpenResult {
            url: bundle_id.to_string(),
            detail: "已唤起应用入口".to_string(),
        });
    }

    let app_name = entry
        .app_name
        .as_deref()
        .ok_or_else(|| anyhow!("missing app_name or bundle_id for app shortcut"))?;
    let status = Command::new("open")
        .arg("-a")
        .arg(app_name)
        .status()
        .map_err(|error| anyhow!("failed to open app by name: {error}"))?;
    if !status.success() {
        anyhow::bail!("failed to open app: {}", app_name);
    }

    Ok(NavigationOpenResult {
        url: app_name.to_string(),
        detail: "已唤起应用入口".to_string(),
    })
}

fn open_navigation_script(entry: &NavigationEntry) -> Result<NavigationOpenResult> {
    let script = entry
        .script
        .as_deref()
        .ok_or_else(|| anyhow!("missing script for script shortcut"))?;
    let cwd = entry.cwd.as_deref().map(PathBuf::from);
    let script_path = resolve_script_path(script, cwd.as_ref())?;
    let launch_cwd = cwd
        .filter(|path| path.is_absolute())
        .or_else(|| script_path.parent().map(Path::to_path_buf))
        .ok_or_else(|| anyhow!("failed to determine script cwd"))?;

    let mut command = Command::new("/bin/zsh");
    command
        .arg(script_path.as_os_str())
        .current_dir(&launch_cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let mut child = command
        .spawn()
        .map_err(|error| anyhow!("failed to launch script: {error}"))?;
    thread::sleep(Duration::from_millis(180));

    let detail = match child
        .try_wait()
        .map_err(|error| anyhow!("failed to inspect script status: {error}"))?
    {
        Some(status) if status.success() => "脚本已执行".to_string(),
        Some(status) => anyhow::bail!("脚本执行失败，退出码: {}", status),
        None => "脚本已启动".to_string(),
    };

    Ok(NavigationOpenResult {
        url: script_path.display().to_string(),
        detail,
    })
}

fn open_navigation_directory(entry: &NavigationEntry) -> Result<NavigationOpenResult> {
    let path = entry
        .path
        .as_deref()
        .ok_or_else(|| anyhow!("missing path for directory shortcut"))?;
    let directory = resolve_directory_path(path)?;

    let status = Command::new("open")
        .arg(directory.as_os_str())
        .status()
        .map_err(|error| anyhow!("failed to open directory: {error}"))?;
    if !status.success() {
        anyhow::bail!("failed to open directory: {}", directory.display());
    }

    Ok(NavigationOpenResult {
        url: directory.display().to_string(),
        detail: "已打开目录入口".to_string(),
    })
}

fn open_navigation_file(entry: &NavigationEntry) -> Result<NavigationOpenResult> {
    let path = entry
        .path
        .as_deref()
        .ok_or_else(|| anyhow!("missing path for file shortcut"))?;
    let file = resolve_file_path(path)?;

    let status = Command::new("open")
        .arg(file.as_os_str())
        .status()
        .map_err(|error| anyhow!("failed to open file: {error}"))?;
    if !status.success() {
        anyhow::bail!("failed to open file: {}", file.display());
    }

    Ok(NavigationOpenResult {
        url: file.display().to_string(),
        detail: "已打开文件入口".to_string(),
    })
}

pub fn list_navigation_entries(limit: usize) -> Result<Vec<NavigationIndexEntry>> {
    let data = load_navigation_data()?;
    Ok(list_navigation_entries_from_data(&data, limit))
}

pub fn list_navigation_entries_for_workspace(
    workspace: &ProjectWorkspaceConfig,
    limit: usize,
) -> Result<Vec<NavigationIndexEntry>> {
    let data = load_navigation_data_for_workspace(workspace)?;
    Ok(list_navigation_entries_from_data(&data, limit))
}

fn list_navigation_entries_from_data(
    data: &NavigationData,
    limit: usize,
) -> Vec<NavigationIndexEntry> {
    flatten_navigation_entries(data)
        .into_iter()
        .take(normalize_limit(limit, 24))
        .collect()
}

pub fn search_navigation_entries(
    query: Option<&str>,
    limit: usize,
) -> Result<Vec<NavigationIndexEntry>> {
    let data = load_navigation_data()?;
    Ok(search_navigation_entries_from_data(&data, query, limit))
}

pub fn search_navigation_entries_for_workspace(
    workspace: &ProjectWorkspaceConfig,
    query: Option<&str>,
    limit: usize,
) -> Result<Vec<NavigationIndexEntry>> {
    let data = load_navigation_data_for_workspace(workspace)?;
    Ok(search_navigation_entries_from_data(&data, query, limit))
}

fn search_navigation_entries_from_data(
    data: &NavigationData,
    query: Option<&str>,
    limit: usize,
) -> Vec<NavigationIndexEntry> {
    let normalized_query = query
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase());
    let limit = normalize_limit(limit, 24);

    let entries = flatten_navigation_entries(data)
        .into_iter()
        .filter(|entry| {
            let Some(query) = normalized_query.as_ref() else {
                return true;
            };
            let haystack = format!(
                "{} {} {} {} {} {}",
                entry.category_title,
                entry.category_short_label,
                entry.kind,
                entry.name,
                entry.target_label,
                entry.note.clone().unwrap_or_default()
            )
            .to_ascii_lowercase();
            haystack.contains(query)
        })
        .take(limit)
        .collect();

    entries
}

pub fn find_navigation_entry(
    name: Option<&str>,
    category: Option<&str>,
    query: Option<&str>,
) -> Result<(NavigationCategory, NavigationEntry)> {
    let data = load_navigation_data()?;
    find_navigation_entry_in_data(data, name, category, query)
}

pub fn find_navigation_entry_for_workspace(
    workspace: &ProjectWorkspaceConfig,
    name: Option<&str>,
    category: Option<&str>,
    query: Option<&str>,
) -> Result<(NavigationCategory, NavigationEntry)> {
    let data = load_navigation_data_for_workspace(workspace)?;
    find_navigation_entry_in_data(data, name, category, query)
}

fn find_navigation_entry_in_data(
    data: NavigationData,
    name: Option<&str>,
    category: Option<&str>,
    query: Option<&str>,
) -> Result<(NavigationCategory, NavigationEntry)> {
    let name = normalize_locator(name);
    let category = normalize_locator(category);
    let query = normalize_locator(query);

    if name.is_none() && query.is_none() {
        anyhow::bail!("navigation open requires --name or --query");
    }
    if name.is_some() && query.is_some() {
        anyhow::bail!("choose only one of --name or --query");
    }

    let mut matches = Vec::new();
    for category_item in data.categories {
        if !matches_category(&category_item, category.as_deref()) {
            continue;
        }

        for entry in category_item.entries.clone() {
            let matched = if let Some(name) = name.as_deref() {
                entry.name.eq_ignore_ascii_case(name)
            } else if let Some(query) = query.as_deref() {
                navigation_entry_haystack(&category_item, &entry)
                    .to_ascii_lowercase()
                    .contains(query)
            } else {
                false
            };

            if matched {
                matches.push((category_item.clone(), entry));
            }
        }
    }

    match matches.len() {
        0 => anyhow::bail!("navigation entry not found"),
        1 => Ok(matches.remove(0)),
        _ => anyhow::bail!(
            "multiple navigation entries matched; pass --category or a more specific --query"
        ),
    }
}

fn parse_nav_entry(cells: &[String]) -> Option<NavigationEntry> {
    let url_idx = cells.iter().position(|cell| is_http_url(cell))?;
    let url = cells.get(url_idx)?.trim().to_string();

    let name = cells[..url_idx]
        .iter()
        .filter(|cell| !cell.is_empty() && cell.as_str() != "-")
        .cloned()
        .collect::<Vec<_>>()
        .join(" / ");
    let note = cells[url_idx + 1..]
        .iter()
        .filter(|cell| !cell.is_empty() && cell.as_str() != "-")
        .cloned()
        .collect::<Vec<_>>()
        .join(" / ");

    Some(NavigationEntry {
        name: if name.is_empty() {
            "打开入口".to_string()
        } else {
            name
        },
        kind: NavigationEntryKind::Url.key().to_string(),
        target_label: url.clone(),
        url: Some(url),
        browser: None,
        browser_profile: None,
        runtime_profile: None,
        bundle_id: None,
        app_name: None,
        script: None,
        tool: None,
        tool_key: None,
        tool_action: None,
        path: None,
        cwd: None,
        note: if note.is_empty() { None } else { Some(note) },
    })
}

fn normalize_non_empty(value: String) -> Option<String> {
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() || trimmed == "-" {
        None
    } else {
        Some(trimmed)
    }
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty() && item != "-")
}

fn normalize_locator(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
}

fn matches_category(category: &NavigationCategory, locator: Option<&str>) -> bool {
    let Some(locator) = locator else {
        return true;
    };
    category.title.eq_ignore_ascii_case(locator)
        || category.short_label.eq_ignore_ascii_case(locator)
        || category.title.to_ascii_lowercase().contains(locator)
        || category.short_label.to_ascii_lowercase().contains(locator)
}

fn navigation_entry_haystack(category: &NavigationCategory, entry: &NavigationEntry) -> String {
    format!(
        "{} {} {} {} {} {}",
        category.title,
        category.short_label,
        entry.kind,
        entry.name,
        entry.target_label,
        entry.note.clone().unwrap_or_default()
    )
}

fn resolve_entry_kind(entry: &NavigationEntryConfig) -> Option<NavigationEntryKind> {
    let explicit = entry.kind.as_deref().map(str::trim).unwrap_or("");
    if !explicit.is_empty() {
        return match explicit.to_ascii_lowercase().as_str() {
            "url" => Some(NavigationEntryKind::Url),
            "app" => Some(NavigationEntryKind::App),
            "script" => Some(NavigationEntryKind::Script),
            "tool" => Some(NavigationEntryKind::Tool),
            "directory" | "dir" | "folder" => Some(NavigationEntryKind::Directory),
            "file" | "document" => Some(NavigationEntryKind::File),
            _ => None,
        };
    }

    if is_http_url(&entry.url) {
        return Some(NavigationEntryKind::Url);
    }
    if normalize_optional_text(entry.bundle_id.clone()).is_some()
        || normalize_optional_text(entry.app_name.clone()).is_some()
    {
        return Some(NavigationEntryKind::App);
    }
    if normalize_optional_text(entry.script.clone()).is_some() {
        return Some(NavigationEntryKind::Script);
    }
    if normalize_optional_text(entry.tool.clone()).is_some()
        || normalize_optional_text(entry.tool_key.clone()).is_some()
    {
        return Some(NavigationEntryKind::Tool);
    }
    if normalize_optional_text(entry.path.clone()).is_some() {
        return Some(NavigationEntryKind::Directory);
    }
    None
}

fn normalize_entry_kind(value: &str) -> Option<String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "url" => Some(NavigationEntryKind::Url.key().to_string()),
        "app" => Some(NavigationEntryKind::App.key().to_string()),
        "script" => Some(NavigationEntryKind::Script.key().to_string()),
        "tool" => Some(NavigationEntryKind::Tool.key().to_string()),
        "directory" | "dir" | "folder" => Some(NavigationEntryKind::Directory.key().to_string()),
        "file" | "document" => Some(NavigationEntryKind::File.key().to_string()),
        _ => None,
    }
}

fn entry_kind(entry: &NavigationEntry) -> Result<NavigationEntryKind> {
    match entry.kind.trim().to_ascii_lowercase().as_str() {
        "url" => Ok(NavigationEntryKind::Url),
        "app" => Ok(NavigationEntryKind::App),
        "script" => Ok(NavigationEntryKind::Script),
        "tool" => Ok(NavigationEntryKind::Tool),
        "directory" | "dir" | "folder" => Ok(NavigationEntryKind::Directory),
        "file" | "document" => Ok(NavigationEntryKind::File),
        other => Err(anyhow!("unsupported navigation entry kind: {}", other)),
    }
}

fn resolve_script_path(script: &str, cwd: Option<&PathBuf>) -> Result<PathBuf> {
    let script_path = PathBuf::from(script);
    let resolved = if script_path.is_absolute() {
        script_path
    } else if let Some(cwd) = cwd.filter(|path| path.is_absolute()) {
        cwd.join(script_path)
    } else {
        anyhow::bail!("script shortcut with relative path requires an absolute cwd");
    };

    if !resolved.exists() {
        anyhow::bail!("script does not exist: {}", resolved.display());
    }
    if !resolved.is_file() {
        anyhow::bail!("script is not a file: {}", resolved.display());
    }

    Ok(resolved)
}

fn resolve_directory_path(path: &str) -> Result<PathBuf> {
    let directory = PathBuf::from(path);
    if !directory.is_absolute() {
        anyhow::bail!("directory shortcut requires an absolute path");
    }
    if !directory.exists() {
        anyhow::bail!("directory does not exist: {}", directory.display());
    }
    if !directory.is_dir() {
        anyhow::bail!(
            "directory shortcut target is not a directory: {}",
            directory.display()
        );
    }

    Ok(directory)
}

fn resolve_file_path(path: &str) -> Result<PathBuf> {
    let file = PathBuf::from(path);
    if !file.is_absolute() {
        anyhow::bail!("file shortcut requires an absolute path");
    }
    if !file.exists() {
        anyhow::bail!("file does not exist: {}", file.display());
    }
    if !file.is_file() {
        anyhow::bail!("file shortcut target is not a file: {}", file.display());
    }
    Ok(file)
}

fn preferred_navigation_category(categories: &[NavigationCategory]) -> Option<String> {
    categories.first().map(|category| category.title.clone())
}

fn flatten_navigation_entries(data: &NavigationData) -> Vec<NavigationIndexEntry> {
    let mut entries = Vec::new();
    for category in &data.categories {
        for entry in &category.entries {
            entries.push(NavigationIndexEntry {
                category_title: category.title.clone(),
                category_short_label: category.short_label.clone(),
                kind: entry.kind.clone(),
                name: entry.name.clone(),
                target_label: entry.target_label.clone(),
                note: entry.note.clone(),
            });
        }
    }
    entries
}

fn navigation_category_label(category: &str) -> String {
    let trimmed = category.trim();
    if trimmed.is_empty() {
        return "分类".to_string();
    }

    let acronym: String = trimmed
        .chars()
        .filter(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit())
        .take(6)
        .collect();
    if !acronym.is_empty() {
        return acronym;
    }

    let ascii_words = trimmed
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|part| !part.is_empty())
        .take(2)
        .collect::<Vec<_>>();
    if !ascii_words.is_empty() {
        let label = ascii_words.join(" ");
        if label.chars().count() <= 8 {
            return label;
        }
        return label.chars().take(8).collect();
    }

    trimmed.chars().take(4).collect()
}

fn is_http_url(value: &str) -> bool {
    let lower = value.trim().to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

fn is_markdown_separator_row(cells: &[String]) -> bool {
    cells.iter().all(|cell| {
        let trimmed = cell.trim();
        !trimmed.is_empty()
            && trimmed
                .chars()
                .all(|ch| matches!(ch, '-' | ':' | ' ' | '—' | '－'))
    })
}

fn is_markdown_header_row(cells: &[String]) -> bool {
    cells.iter().any(|cell| {
        let normalized = cell.trim().to_ascii_lowercase();
        matches!(
            normalized.as_str(),
            "系统" | "平台" | "名称" | "环境" | "入口" | "url" | "地址" | "备注"
        )
    })
}

fn normalize_limit(limit: usize, default_limit: usize) -> usize {
    if limit == 0 {
        default_limit
    } else {
        limit.min(100)
    }
}
