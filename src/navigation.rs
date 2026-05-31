#![allow(dead_code)]

use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

use crate::config::default_config_dir;

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
    pub bundle_id: Option<String>,
    pub app_name: Option<String>,
    pub script: Option<String>,
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
    bundle_id: Option<String>,
    #[serde(default)]
    app_name: Option<String>,
    #[serde(default)]
    script: Option<String>,
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
}

impl NavigationEntryKind {
    fn key(self) -> &'static str {
        match self {
            Self::Url => "url",
            Self::App => "app",
            Self::Script => "script",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Url => "网页",
            Self::App => "应用",
            Self::Script => "脚本",
        }
    }
}

pub fn load_navigation_data() -> Result<NavigationData> {
    let path = ensure_navigation_config()?;
    let content = fs::read_to_string(&path)
        .with_context(|| format!("failed to read navigation config: {}", path.display()))?;
    let config: NavigationFileConfig = toml::from_str(&content)
        .with_context(|| format!("failed to parse navigation config: {}", path.display()))?;

    Ok(navigation_data_from_config(
        config,
        path.display().to_string(),
    ))
}

fn ensure_navigation_config() -> Result<PathBuf> {
    let path = default_navigation_path();
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
    let content = if legacy_path.exists() {
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

    fs::write(&path, content)
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
    let bundle_id = normalize_optional_text(entry.bundle_id);
    let app_name = normalize_optional_text(entry.app_name);
    let script = normalize_optional_text(entry.script);
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
        bundle_id,
        app_name,
        script,
        cwd,
        note,
    })
}

fn navigation_entry_config_from_entry(entry: &NavigationEntry) -> NavigationEntryConfig {
    NavigationEntryConfig {
        name: entry.name.clone(),
        kind: Some(entry.kind.clone()),
        url: entry.url.clone().unwrap_or_default(),
        bundle_id: entry.bundle_id.clone(),
        app_name: entry.app_name.clone(),
        script: entry.script.clone(),
        cwd: entry.cwd.clone(),
        note: entry.note.clone(),
    }
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
    match entry_kind(entry)? {
        NavigationEntryKind::Url => {
            let url = entry
                .url
                .as_deref()
                .ok_or_else(|| anyhow!("missing url for url shortcut"))?;
            open_in_current_chrome(url)
        }
        NavigationEntryKind::App => open_navigation_app(entry),
        NavigationEntryKind::Script => open_navigation_script(entry),
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

pub fn list_navigation_entries(limit: usize) -> Result<Vec<NavigationIndexEntry>> {
    let data = load_navigation_data()?;
    Ok(flatten_navigation_entries(&data)
        .into_iter()
        .take(normalize_limit(limit, 24))
        .collect())
}

pub fn search_navigation_entries(
    query: Option<&str>,
    limit: usize,
) -> Result<Vec<NavigationIndexEntry>> {
    let data = load_navigation_data()?;
    let normalized_query = query
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase());
    let limit = normalize_limit(limit, 24);

    let entries = flatten_navigation_entries(&data)
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

    Ok(entries)
}

pub fn find_navigation_entry(
    name: Option<&str>,
    category: Option<&str>,
    query: Option<&str>,
) -> Result<(NavigationCategory, NavigationEntry)> {
    let data = load_navigation_data()?;
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
        bundle_id: None,
        app_name: None,
        script: None,
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
    None
}

fn entry_kind(entry: &NavigationEntry) -> Result<NavigationEntryKind> {
    match entry.kind.trim().to_ascii_lowercase().as_str() {
        "url" => Ok(NavigationEntryKind::Url),
        "app" => Ok(NavigationEntryKind::App),
        "script" => Ok(NavigationEntryKind::Script),
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
