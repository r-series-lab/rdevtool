use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::config::{
    AppConfig, ProjectWorkspaceConfig, ProjectWorkspaceResourceCategoryConfig,
    ProjectWorkspaceResourceEntryConfig, RuntimeProfileConfig, default_config_dir,
    load_project_workspace_by_key, normalize_project_workspace_key, save_project_workspace_config,
};
use crate::config_store::write_config_text_atomic;
use crate::proxy::{ProxyConfig, ProxyProfile};
use crate::ui_profiles::{DEFAULT_LINK_UI_PROFILE, ui_profile_kind};

pub fn default_links_path() -> PathBuf {
    default_config_dir().join("links.toml")
}

pub fn links_file_path() -> String {
    default_links_path().display().to_string()
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LinkFileConfig {
    #[serde(default)]
    pub links: Vec<LinkConfig>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkConfig {
    pub key: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "ui_profile")]
    pub ui_profile: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "schema_version"
    )]
    pub schema_version: Option<u32>,
    #[serde(default, alias = "workspace_key")]
    pub workspace_key: Option<String>,
    #[serde(default)]
    pub project: Option<String>,
    #[serde(default)]
    pub steps: Vec<LinkStepConfig>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LinkStepConfig {
    #[serde(default)]
    pub id: String,
    #[serde(default, rename = "type", alias = "step_type")]
    pub step_type: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub project: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub profile: Option<String>,
    #[serde(default, alias = "debug_profile")]
    pub debug_profile: Option<String>,
    #[serde(default, alias = "runtime_profile")]
    pub runtime_profile: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default, alias = "expected_port")]
    pub expected_port: Option<u16>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, toml::Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkSummary {
    pub key: String,
    pub name: String,
    pub kind: Option<String>,
    pub ui_profile: String,
    pub schema_version: u32,
    pub workspace_key: Option<String>,
    pub project: Option<String>,
    pub step_count: usize,
    pub proxy_profiles: Vec<LinkProxySummary>,
    pub runtime: Option<LinkRuntimeSummary>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkRuntimeSummary {
    pub status: String,
    pub label: String,
    pub running_steps: usize,
    pub controllable_steps: usize,
    pub blocked_steps: usize,
    pub can_run: bool,
    pub can_stop: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkProxySummary {
    pub id: String,
    pub name: String,
    pub listen_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkPlan {
    pub key: String,
    pub name: String,
    pub kind: Option<String>,
    pub ui_profile: String,
    pub schema_version: u32,
    pub workspace_key: Option<String>,
    pub project: Option<String>,
    pub steps: Vec<LinkPlanStep>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkPlanStep {
    pub id: String,
    #[serde(rename = "type")]
    pub step_type: String,
    pub label: String,
    pub summary: String,
    pub status: String,
    pub risks: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkExecutionReport {
    pub key: String,
    pub name: String,
    pub mode: String,
    pub plan: LinkPlan,
    pub steps: Vec<LinkExecutionStepReport>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkExecutionStepReport {
    pub id: String,
    #[serde(rename = "type")]
    pub step_type: String,
    pub label: String,
    pub status: String,
    pub summary: String,
    pub detail: Option<serde_json::Value>,
    pub risks: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkWorkspaceAttachRequest {
    pub workspace_key: String,
    pub link_key: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub short_label: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkWorkspaceAttachResult {
    pub workspace_key: String,
    pub category: String,
    pub entry_name: String,
    pub link_key: String,
    pub created: bool,
    pub workspace: ProjectWorkspaceConfig,
}

pub fn load_links_config() -> Result<LinkFileConfig> {
    load_links_config_from_path(&default_links_path())
}

pub fn load_links_config_from_path(path: &Path) -> Result<LinkFileConfig> {
    if !path.exists() {
        return Ok(LinkFileConfig::default());
    }
    let content = fs::read_to_string(&path)
        .with_context(|| format!("failed to read links config: {}", path.display()))?;
    let mut config: LinkFileConfig = toml::from_str(&content)
        .with_context(|| format!("failed to parse links config: {}", path.display()))?;
    normalize_links_config(&mut config);
    Ok(config)
}

pub fn save_links_config(config: LinkFileConfig) -> Result<LinkFileConfig> {
    save_links_config_to_path(&default_links_path(), config)
}

pub fn save_links_config_to_path(path: &Path, config: LinkFileConfig) -> Result<LinkFileConfig> {
    let mut config = config;
    normalize_links_config(&mut config);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create links config dir: {}", parent.display()))?;
    }
    let content = toml::to_string_pretty(&config)
        .with_context(|| format!("failed to serialize links config: {}", path.display()))?;
    write_config_text_atomic(path, content)
        .with_context(|| format!("failed to write links config: {}", path.display()))?;
    Ok(config)
}

pub fn list_links() -> Result<Vec<LinkConfig>> {
    Ok(load_links_config()?.links)
}

pub fn list_links_from_path(path: &Path) -> Result<Vec<LinkConfig>> {
    Ok(load_links_config_from_path(path)?.links)
}

pub fn upsert_link(link: LinkConfig) -> Result<LinkConfig> {
    upsert_link_to_path(&default_links_path(), link)
}

pub fn upsert_link_to_path(path: &Path, link: LinkConfig) -> Result<LinkConfig> {
    upsert_link_to_path_with_previous_key(path, link, None)
}

pub fn upsert_link_to_path_with_previous_key(
    path: &Path,
    link: LinkConfig,
    previous_key: Option<&str>,
) -> Result<LinkConfig> {
    let mut config = load_links_config_from_path(path)?;
    let mut link = link;
    normalize_link_config(&mut link, 0);
    if link.key.is_empty() {
        anyhow::bail!("link key is required");
    }
    if link.name.is_empty() {
        anyhow::bail!("link name is required");
    }

    let previous_key = previous_key
        .map(|value| normalize_key(value).ok_or_else(|| anyhow!("previous link key is invalid")))
        .transpose()?;
    if previous_key
        .as_deref()
        .is_some_and(|previous| previous != link.key)
        && config.links.iter().any(|item| item.key == link.key)
    {
        anyhow::bail!("link key already exists: {}", link.key);
    }
    if let Some(previous_key) = previous_key.as_deref() {
        if previous_key != link.key {
            config.links.retain(|item| item.key != previous_key);
        }
    }

    if let Some(index) = config.links.iter().position(|item| item.key == link.key) {
        config.links[index] = link.clone();
    } else {
        config.links.push(link.clone());
    }
    save_links_config_to_path(path, config)?;
    Ok(link)
}

pub fn delete_link(key: &str) -> Result<bool> {
    delete_link_from_path(&default_links_path(), key)
}

pub fn delete_link_from_path(path: &Path, key: &str) -> Result<bool> {
    let key = normalize_key(key).ok_or_else(|| anyhow!("link key is required"))?;
    let mut config = load_links_config_from_path(path)?;
    let original_len = config.links.len();
    config.links.retain(|link| link.key != key);
    let deleted = config.links.len() != original_len;
    if deleted {
        save_links_config_to_path(path, config)?;
    }
    Ok(deleted)
}

pub fn get_link(key: &str) -> Result<LinkConfig> {
    get_link_from_path(&default_links_path(), key)
}

pub fn get_link_from_path(path: &Path, key: &str) -> Result<LinkConfig> {
    let key = normalize_key(key).ok_or_else(|| anyhow!("link key is required"))?;
    load_links_config_from_path(path)?
        .links
        .into_iter()
        .find(|link| link.key == key)
        .ok_or_else(|| anyhow!("link not found: {key}"))
}

pub fn attach_link_to_workspace(
    workspaces_dir: &Path,
    request: LinkWorkspaceAttachRequest,
) -> Result<LinkWorkspaceAttachResult> {
    let workspace_key = normalize_text(&request.workspace_key)
        .ok_or_else(|| anyhow!("workspace key is required"))?;
    let link_key =
        normalize_key(&request.link_key).ok_or_else(|| anyhow!("link key is required"))?;
    let link = get_link(&link_key)?;
    let mut workspace = load_project_workspace_by_key(workspaces_dir, &workspace_key)?;
    if workspace.is_system() {
        anyhow::bail!("system workspace cannot own tool entries");
    }

    let category = request
        .category
        .as_deref()
        .and_then(normalize_text)
        .unwrap_or_else(|| "工具".to_string());
    let short_label = request
        .short_label
        .as_deref()
        .and_then(normalize_text)
        .unwrap_or_else(|| category.clone());
    let entry_name = request
        .name
        .as_deref()
        .and_then(normalize_text)
        .unwrap_or_else(|| link.name.clone());
    let note = request.note.as_deref().and_then(normalize_text);
    let entry = ProjectWorkspaceResourceEntryConfig {
        name: entry_name.clone(),
        kind: Some("tool".to_string()),
        url: String::new(),
        browser: None,
        browser_profile: None,
        runtime_profile: None,
        bundle_id: None,
        app_name: None,
        script: None,
        tool: Some("link".to_string()),
        tool_key: Some(link_key.clone()),
        tool_action: Some("plan".to_string()),
        path: None,
        cwd: None,
        note,
    };

    let category_item = workspace_resource_category_mut(&mut workspace, &category, short_label);
    let mut created = true;
    if let Some(index) = category_item.entries.iter().position(|item| {
        item.name == entry.name || item.tool_key.as_deref() == Some(link_key.as_str())
    }) {
        category_item.entries[index] = entry;
        created = false;
    } else {
        category_item.entries.push(entry);
    }

    let workspace = workspace.normalized();
    let path = workspaces_dir.join(format!("{}.toml", workspace.key));
    save_project_workspace_config(&path, &workspace)?;
    Ok(LinkWorkspaceAttachResult {
        workspace_key,
        category,
        entry_name,
        link_key,
        created,
        workspace,
    })
}

pub fn list_link_summaries(
    app_config: &AppConfig,
    workspaces: &[ProjectWorkspaceConfig],
    proxy_config: &ProxyConfig,
) -> Result<Vec<LinkSummary>> {
    list_link_summaries_from_path(&default_links_path(), app_config, workspaces, proxy_config)
}

pub fn list_link_summaries_from_path(
    path: &Path,
    app_config: &AppConfig,
    workspaces: &[ProjectWorkspaceConfig],
    proxy_config: &ProxyConfig,
) -> Result<Vec<LinkSummary>> {
    Ok(load_links_config_from_path(path)?
        .links
        .iter()
        .map(|link| link_summary(link, app_config, workspaces, proxy_config))
        .collect())
}

pub fn plan_link(
    key: &str,
    app_config: &AppConfig,
    workspaces: &[ProjectWorkspaceConfig],
    proxy_config: &ProxyConfig,
) -> Result<LinkPlan> {
    plan_link_from_path(
        &default_links_path(),
        key,
        app_config,
        workspaces,
        proxy_config,
    )
}

pub fn plan_link_from_path(
    path: &Path,
    key: &str,
    app_config: &AppConfig,
    workspaces: &[ProjectWorkspaceConfig],
    proxy_config: &ProxyConfig,
) -> Result<LinkPlan> {
    let link = get_link_from_path(path, key)?;
    Ok(plan_link_config(
        &link,
        app_config,
        workspaces,
        proxy_config,
    ))
}

pub fn plan_link_config(
    link: &LinkConfig,
    app_config: &AppConfig,
    workspaces: &[ProjectWorkspaceConfig],
    proxy_config: &ProxyConfig,
) -> LinkPlan {
    let project_keys = app_config
        .projects
        .iter()
        .map(|project| project.key.as_str())
        .collect::<BTreeSet<_>>();
    let workspace_keys = workspaces
        .iter()
        .map(|workspace| workspace.key.as_str())
        .collect::<BTreeSet<_>>();
    let runtime_profile_keys = app_config
        .defaults
        .runtime_profiles
        .iter()
        .map(|profile| profile.key.as_str())
        .collect::<BTreeSet<_>>();

    let mut warnings = Vec::new();
    if link.key.trim().is_empty() {
        warnings.push("Link key 为空，建议在 links.toml 中补充唯一 key。".to_string());
    }
    if link.name.trim().is_empty() {
        warnings.push(format!("Link {} 缺少名称。", link.key));
    }
    if let Some(workspace_key) = link.workspace_key.as_deref() {
        if !workspace_keys.contains(workspace_key) {
            warnings.push(format!("关联工作区不存在：{workspace_key}"));
        }
    }
    if let Some(project_key) = link.project.as_deref() {
        if !project_keys.contains(project_key) {
            warnings.push(format!("关联项目不存在：{project_key}"));
        } else if let Some(workspace_key) = link.workspace_key.as_deref() {
            if let Some(workspace) = workspaces.iter().find(|item| item.key == workspace_key) {
                if !workspace.allows_project(project_key) {
                    warnings.push(format!(
                        "项目 {project_key} 不在工作区 {workspace_key} 的范围内。"
                    ));
                }
            }
        }
    }
    if link.steps.is_empty() {
        warnings.push("当前 Link 没有步骤，计划预览为空。".to_string());
    }

    let steps = link
        .steps
        .iter()
        .enumerate()
        .map(|(index, step)| {
            plan_step(
                link,
                step,
                index,
                app_config,
                proxy_config,
                &project_keys,
                &runtime_profile_keys,
            )
        })
        .collect::<Vec<_>>();

    LinkPlan {
        key: link.key.clone(),
        name: link.name.clone(),
        kind: link_kind(link),
        ui_profile: link_ui_profile(link),
        schema_version: link.schema_version.unwrap_or(1),
        workspace_key: link.workspace_key.clone(),
        project: link.project.clone(),
        steps,
        warnings,
    }
}

fn link_summary(
    link: &LinkConfig,
    app_config: &AppConfig,
    workspaces: &[ProjectWorkspaceConfig],
    proxy_config: &ProxyConfig,
) -> LinkSummary {
    let plan = plan_link_config(link, app_config, workspaces, proxy_config);
    let mut proxy_profiles = Vec::new();
    let mut seen = BTreeSet::new();
    for step in &link.steps {
        if !matches!(step.step_type.trim(), "proxy.start" | "proxy.check") {
            continue;
        }
        let Some(profile_key) = normalize_optional(step.profile.as_deref()) else {
            continue;
        };
        if !seen.insert(profile_key.clone()) {
            continue;
        }
        if let Some(profile) = find_proxy_profile(proxy_config, &profile_key) {
            proxy_profiles.push(proxy_summary(profile));
        }
    }

    LinkSummary {
        key: link.key.clone(),
        name: link.name.clone(),
        kind: link_kind(link),
        ui_profile: link_ui_profile(link),
        schema_version: link.schema_version.unwrap_or(1),
        workspace_key: link.workspace_key.clone(),
        project: link.project.clone(),
        step_count: link.steps.len(),
        proxy_profiles,
        runtime: None,
        warnings: plan.warnings,
    }
}

fn plan_step(
    link: &LinkConfig,
    step: &LinkStepConfig,
    index: usize,
    app_config: &AppConfig,
    proxy_config: &ProxyConfig,
    project_keys: &BTreeSet<&str>,
    runtime_profile_keys: &BTreeSet<&str>,
) -> LinkPlanStep {
    let id = normalize_text(step.id.as_str()).unwrap_or_else(|| format!("step-{}", index + 1));
    let step_type = normalize_text(step.step_type.as_str()).unwrap_or_default();
    let label = step.label.as_deref().and_then(normalize_text);
    let mut risks = Vec::new();

    let (default_label, summary) = match step_type.as_str() {
        "localFile.ensure" => {
            let project_key = step
                .project
                .as_deref()
                .and_then(normalize_text)
                .or_else(|| link.project.as_deref().and_then(normalize_text));
            let path = step.path.as_deref().and_then(normalize_text);
            if let Some(project_key) = project_key.as_deref() {
                if !project_keys.contains(project_key) {
                    risks.push(format!("项目不存在：{project_key}"));
                }
            } else {
                risks.push("缺少 project，无法确认本地覆盖文件属于哪个项目。".to_string());
            }
            if path.is_none() {
                risks.push("缺少 path，无法定位本地覆盖文件。".to_string());
            }
            (
                "本地覆盖文件".to_string(),
                match (project_key, path) {
                    (Some(project_key), Some(path)) => {
                        format!("确认项目 {project_key} 使用 {path} 作为本地覆盖文件")
                    }
                    (_, Some(path)) => format!("确认本地覆盖文件 {path}"),
                    _ => "确认本地覆盖文件".to_string(),
                },
            )
        }
        "proxy.start" => {
            let profile_key = step.profile.as_deref().and_then(normalize_text);
            let summary = if let Some(profile_key) = profile_key.as_deref() {
                if let Some(profile) = find_proxy_profile(proxy_config, profile_key) {
                    format!(
                        "计划启动代理 {}，监听 {}",
                        profile.name,
                        profile.listen_url()
                    )
                } else {
                    risks.push(format!("代理 profile 不存在：{profile_key}"));
                    format!("计划启动代理 {profile_key}")
                }
            } else {
                risks.push("缺少 profile，无法定位代理服务。".to_string());
                "计划启动代理服务".to_string()
            };
            ("代理服务".to_string(), summary)
        }
        "proxy.check" => {
            let profile_key = step.profile.as_deref().and_then(normalize_text);
            if let Some(profile_key) = profile_key.as_deref() {
                if find_proxy_profile(proxy_config, profile_key).is_none() {
                    risks.push(format!("代理 profile 不存在：{profile_key}"));
                }
            } else {
                risks.push("缺少 profile，无法检查代理服务。".to_string());
            }
            ("代理检查".to_string(), "检查代理监听与规则命中".to_string())
        }
        "runtime.start" => {
            let project_key = step
                .project
                .as_deref()
                .and_then(normalize_text)
                .or_else(|| link.project.as_deref().and_then(normalize_text));
            let debug_profile = step.debug_profile.as_deref().and_then(normalize_text);
            let runtime_profile = step.runtime_profile.as_deref().and_then(normalize_text);

            if let Some(project_key) = project_key.as_deref() {
                if !project_keys.contains(project_key) {
                    risks.push(format!("项目不存在：{project_key}"));
                } else if let Some(debug_profile) = debug_profile.as_deref() {
                    validate_debug_profile(app_config, project_key, debug_profile, &mut risks);
                }
            } else {
                risks.push("缺少 project，无法定位运行项目。".to_string());
            }
            if let Some(runtime_profile) = runtime_profile.as_deref() {
                if !runtime_profile_keys.contains(runtime_profile) {
                    risks.push(format!("运行配置不存在：{runtime_profile}"));
                }
            }

            (
                "运行配置".to_string(),
                match (project_key, debug_profile, runtime_profile) {
                    (Some(project_key), Some(debug_profile), _) => {
                        format!("计划用调试配置 {debug_profile} 启动项目 {project_key}")
                    }
                    (Some(project_key), _, Some(runtime_profile)) => {
                        format!("计划用运行配置 {runtime_profile} 启动项目 {project_key}")
                    }
                    (Some(project_key), _, _) => format!("计划启动项目 {project_key}"),
                    _ => "计划启动项目运行配置".to_string(),
                },
            )
        }
        "runtime.focus" => {
            let project_key = step
                .project
                .as_deref()
                .and_then(normalize_text)
                .or_else(|| link.project.as_deref().and_then(normalize_text));
            if let Some(project_key) = project_key.as_deref() {
                if !project_keys.contains(project_key) {
                    risks.push(format!("项目不存在：{project_key}"));
                }
            } else {
                risks.push("缺少 project，无法定位要聚焦的项目。".to_string());
            }
            ("打开页面".to_string(), "计划打开项目调试页面".to_string())
        }
        "webAction.open" | "webAction.run" | "webAction.check" => {
            let action = step
                .extra
                .get("action")
                .and_then(|value| value.as_str())
                .and_then(normalize_text);
            if action.is_none() {
                risks.push("缺少 action，无法定位网页动作。".to_string());
            }
            let default_label = match step_type.as_str() {
                "webAction.open" => "打开网页动作",
                "webAction.check" => "检查网页动作",
                _ => "执行网页动作",
            };
            (
                default_label.to_string(),
                action
                    .map(|action| format!("计划处理网页动作 {action}"))
                    .unwrap_or_else(|| "计划处理网页动作".to_string()),
            )
        }
        "" => {
            risks.push("缺少 type，无法识别步骤类型。".to_string());
            ("未命名步骤".to_string(), "缺少步骤类型".to_string())
        }
        other => {
            risks.push(format!("暂不支持的步骤类型：{other}"));
            ("扩展步骤".to_string(), format!("保留扩展步骤 {other}"))
        }
    };

    LinkPlanStep {
        id,
        step_type,
        label: label.unwrap_or(default_label),
        summary,
        status: if risks.is_empty() {
            "planned".to_string()
        } else {
            "invalid".to_string()
        },
        risks,
    }
}

fn validate_debug_profile(
    app_config: &AppConfig,
    project_key: &str,
    debug_profile_key: &str,
    risks: &mut Vec<String>,
) {
    let Some(project) = app_config
        .projects
        .iter()
        .find(|project| project.key == project_key)
    else {
        return;
    };
    if !project
        .debug_profiles
        .iter()
        .any(|profile| profile.key == debug_profile_key)
    {
        risks.push(format!(
            "项目 {project_key} 缺少调试配置：{debug_profile_key}"
        ));
    }
}

fn find_proxy_profile<'a>(config: &'a ProxyConfig, key: &str) -> Option<&'a ProxyProfile> {
    config
        .profiles
        .iter()
        .find(|profile| profile.id == key || profile.name == key)
}

fn proxy_summary(profile: &ProxyProfile) -> LinkProxySummary {
    LinkProxySummary {
        id: profile.id.clone(),
        name: profile.name.clone(),
        listen_url: profile.listen_url(),
    }
}

fn normalize_links_config(config: &mut LinkFileConfig) {
    let mut used_keys = BTreeSet::new();
    for (index, link) in config.links.iter_mut().enumerate() {
        normalize_link_config(link, index);
        if !used_keys.insert(link.key.clone()) {
            link.key = format!("{}-{}", link.key, index + 1);
        }
    }
}

fn link_ui_profile(link: &LinkConfig) -> String {
    link.ui_profile
        .as_deref()
        .and_then(normalize_text)
        .unwrap_or_else(|| DEFAULT_LINK_UI_PROFILE.to_string())
}

fn link_kind(link: &LinkConfig) -> Option<String> {
    link.kind
        .as_deref()
        .and_then(normalize_text)
        .or_else(|| Some(link_kind_from_ui_profile(&link_ui_profile(link))))
}

fn link_kind_from_ui_profile(value: &str) -> String {
    ui_profile_kind(value).unwrap_or_else(|| {
        value
            .strip_prefix("link-")
            .unwrap_or(value)
            .trim()
            .to_string()
    })
}

fn normalize_link_config(link: &mut LinkConfig, index: usize) {
    link.key = normalize_key(&link.key).unwrap_or_else(|| format!("link-{}", index + 1));
    link.name = normalize_text(link.name.as_str()).unwrap_or_else(|| link.key.clone());
    link.ui_profile = link.ui_profile.as_deref().and_then(normalize_text);
    link.kind = link.kind.as_deref().and_then(normalize_text);
    link.schema_version = link.schema_version.filter(|version| *version > 0);
    link.workspace_key = link
        .workspace_key
        .as_deref()
        .and_then(normalize_project_workspace_key);
    link.project = link.project.as_deref().and_then(normalize_text);
    for (step_index, step) in link.steps.iter_mut().enumerate() {
        step.id = normalize_key(&step.id).unwrap_or_else(|| format!("step-{}", step_index + 1));
        step.step_type = normalize_text(step.step_type.as_str()).unwrap_or_default();
        step.label = step.label.as_deref().and_then(normalize_text);
        step.project = step.project.as_deref().and_then(normalize_text);
        step.path = step.path.as_deref().and_then(normalize_text);
        step.profile = step.profile.as_deref().and_then(normalize_text);
        step.debug_profile = step.debug_profile.as_deref().and_then(normalize_text);
        step.runtime_profile = step.runtime_profile.as_deref().and_then(normalize_text);
        step.note = step.note.as_deref().and_then(normalize_text);
    }
}

fn workspace_resource_category_mut<'a>(
    workspace: &'a mut ProjectWorkspaceConfig,
    category: &str,
    short_label: String,
) -> &'a mut ProjectWorkspaceResourceCategoryConfig {
    if let Some(index) = workspace
        .resource_categories
        .iter()
        .position(|item| item.title == category)
    {
        workspace.resource_categories[index].short_label = Some(short_label);
        return &mut workspace.resource_categories[index];
    }
    workspace
        .resource_categories
        .push(ProjectWorkspaceResourceCategoryConfig {
            title: category.to_string(),
            short_label: Some(short_label),
            entries: Vec::new(),
        });
    workspace
        .resource_categories
        .last_mut()
        .expect("workspace resource category was just pushed")
}

fn normalize_key(value: &str) -> Option<String> {
    normalize_optional(Some(value))
        .map(|value| {
            value
                .chars()
                .map(|ch| {
                    if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
                        ch
                    } else {
                        '-'
                    }
                })
                .collect::<String>()
                .trim_matches('-')
                .to_string()
        })
        .filter(|value| !value.is_empty())
}

fn normalize_optional(value: Option<&str>) -> Option<String> {
    value.and_then(normalize_text)
}

fn normalize_text(value: &str) -> Option<String> {
    Some(value)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

#[allow(dead_code)]
fn _runtime_profile_label(profile: &RuntimeProfileConfig) -> String {
    if profile.label.trim().is_empty() {
        profile.key.clone()
    } else {
        profile.label.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_path() -> PathBuf {
        std::env::temp_dir().join(format!("rdevtool-link-{}.toml", uuid::Uuid::new_v4()))
    }

    fn cleanup(path: &Path) {
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(crate::config_store::backup_path(path));
    }

    fn link(key: &str, name: &str) -> LinkConfig {
        LinkConfig {
            key: key.to_string(),
            name: name.to_string(),
            kind: Some("proxy-only".to_string()),
            ui_profile: Some("link-proxy-only".to_string()),
            schema_version: Some(1),
            workspace_key: None,
            project: None,
            steps: vec![LinkStepConfig {
                id: "proxy".to_string(),
                step_type: "proxy.start".to_string(),
                profile: Some("default".to_string()),
                ..LinkStepConfig::default()
            }],
        }
    }

    #[test]
    fn renames_a_link_without_leaving_the_previous_key() {
        let path = test_path();
        upsert_link_to_path(&path, link("before", "Before")).unwrap();
        upsert_link_to_path_with_previous_key(&path, link("after", "After"), Some("before"))
            .unwrap();

        assert!(get_link_from_path(&path, "before").is_err());
        assert_eq!(get_link_from_path(&path, "after").unwrap().name, "After");
        cleanup(&path);
    }

    #[test]
    fn rejects_a_rename_that_would_overwrite_an_existing_link() {
        let path = test_path();
        upsert_link_to_path(&path, link("first", "First")).unwrap();
        upsert_link_to_path(&path, link("second", "Second")).unwrap();

        let result =
            upsert_link_to_path_with_previous_key(&path, link("second", "Renamed"), Some("first"));
        assert!(result.is_err());
        assert_eq!(get_link_from_path(&path, "first").unwrap().name, "First");
        assert_eq!(get_link_from_path(&path, "second").unwrap().name, "Second");
        cleanup(&path);
    }
}
