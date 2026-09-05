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
use crate::config_sources::{ConfigSource, ConfigSourceReference};
use crate::config_store::{
    with_config_file_lock, with_config_file_locks, write_config_text_atomic,
};
use crate::proxy::{ProxyConfig, ProxyProfile};
use crate::runtime::{
    ProjectRuntimeContextSnapshot, ProjectRuntimeLaunchOptions, project_runtime_context_snapshot,
};
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
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

#[derive(Debug, Clone, Deserialize, Serialize, Default, PartialEq)]
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_context: Option<LinkSourceContext>,
    pub steps: Vec<LinkPlanStep>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkSourceContext {
    pub link_source_id: String,
    pub link_source_name: String,
    pub proxy_source_id: String,
    pub proxy_source_name: String,
    pub runtime_source_id: String,
    pub runtime_source_name: String,
    pub aligned: bool,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime: Option<ProjectRuntimeContextSnapshot>,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkSourceMatch {
    pub source: ConfigSourceReference,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkSourceDiscovery {
    pub key: String,
    pub matches: Vec<LinkSourceMatch>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkMigrationPlan {
    pub key: String,
    pub source_path: String,
    pub target_path: String,
    pub mode: String,
    pub replace: bool,
    pub source_state: String,
    pub target_state: String,
    pub can_apply: bool,
    pub actions: Vec<String>,
    pub risks: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkMigrationResult {
    pub plan: LinkMigrationPlan,
    pub applied: bool,
    pub target_written: bool,
    pub source_deleted: bool,
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
    with_config_file_lock(path, || save_links_config_to_path_unlocked(path, config))
}

fn save_links_config_to_path_unlocked(
    path: &Path,
    config: LinkFileConfig,
) -> Result<LinkFileConfig> {
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
    with_config_file_lock(path, || {
        upsert_link_to_path_with_previous_key_unlocked(path, link, previous_key)
    })
}

fn upsert_link_to_path_with_previous_key_unlocked(
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
    save_links_config_to_path_unlocked(path, config)?;
    Ok(link)
}

pub fn delete_link(key: &str) -> Result<bool> {
    delete_link_from_path(&default_links_path(), key)
}

pub fn delete_link_from_path(path: &Path, key: &str) -> Result<bool> {
    with_config_file_lock(path, || delete_link_from_path_unlocked(path, key))
}

fn delete_link_from_path_unlocked(path: &Path, key: &str) -> Result<bool> {
    let key = normalize_key(key).ok_or_else(|| anyhow!("link key is required"))?;
    let mut config = load_links_config_from_path(path)?;
    let original_len = config.links.len();
    config.links.retain(|link| link.key != key);
    let deleted = config.links.len() != original_len;
    if deleted {
        save_links_config_to_path_unlocked(path, config)?;
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

pub fn discover_link_sources(sources: &[ConfigSource], key: &str) -> Result<LinkSourceDiscovery> {
    let key = normalize_key(key).ok_or_else(|| anyhow!("link key is required"))?;
    let mut matches = Vec::new();
    let mut warnings = Vec::new();
    for source in sources {
        if !source
            .capabilities
            .iter()
            .any(|capability| capability.eq_ignore_ascii_case("link"))
        {
            continue;
        }
        let path = PathBuf::from(&source.files.links);
        match get_link_from_path(&path, &key) {
            Ok(_) => matches.push(LinkSourceMatch {
                source: ConfigSourceReference {
                    id: source.id.clone(),
                    name: source.name.clone(),
                    kind: source.kind.clone(),
                },
                path: path.display().to_string(),
            }),
            Err(error) if !path.exists() || error.to_string().contains("link not found") => {}
            Err(error) => warnings.push(format!(
                "无法检查配置源 {} ({})：{}",
                source.name, source.id, error
            )),
        }
    }
    Ok(LinkSourceDiscovery {
        key,
        matches,
        warnings,
    })
}

pub fn plan_link_migration(
    source_path: &Path,
    target_path: &Path,
    key: &str,
    copy: bool,
    replace: bool,
) -> Result<LinkMigrationPlan> {
    let key = normalize_key(key).ok_or_else(|| anyhow!("link key is required"))?;
    if same_config_path(source_path, target_path) {
        anyhow::bail!("Link 源和目标配置文件必须不同：{}", source_path.display());
    }
    let source = load_links_config_from_path(source_path)?;
    let target = load_links_config_from_path(target_path)?;
    Ok(build_link_migration_plan(
        source_path,
        target_path,
        &key,
        copy,
        replace,
        &source,
        &target,
    ))
}

pub fn execute_link_migration(
    source_path: &Path,
    target_path: &Path,
    key: &str,
    copy: bool,
    replace: bool,
) -> Result<LinkMigrationResult> {
    let key = normalize_key(key).ok_or_else(|| anyhow!("link key is required"))?;
    if same_config_path(source_path, target_path) {
        anyhow::bail!("Link 源和目标配置文件必须不同：{}", source_path.display());
    }
    with_config_file_locks(
        [source_path.to_path_buf(), target_path.to_path_buf()],
        || {
            let mut source = load_links_config_from_path(source_path)?;
            let mut target = load_links_config_from_path(target_path)?;
            let plan = build_link_migration_plan(
                source_path,
                target_path,
                &key,
                copy,
                replace,
                &source,
                &target,
            );
            if !plan.can_apply {
                anyhow::bail!("Link 迁移计划不可执行：{}", plan.risks.join("；"));
            }
            if plan.actions.is_empty() {
                return Ok(LinkMigrationResult {
                    plan,
                    applied: false,
                    target_written: false,
                    source_deleted: false,
                });
            }

            let source_link = source
                .links
                .iter()
                .find(|link| link.key == key)
                .cloned()
                .ok_or_else(|| anyhow!("Link 源配置不存在：{key}"))?;
            let original_target = target.clone();
            let target_existed = target_path.exists();
            let mut target_written = false;
            let mut source_deleted = false;

            if plan
                .actions
                .iter()
                .any(|action| action == "writeTarget" || action == "replaceTarget")
            {
                if let Some(index) = target.links.iter().position(|link| link.key == key) {
                    target.links[index] = source_link.clone();
                } else {
                    target.links.push(source_link.clone());
                }
                save_links_config_to_path_unlocked(target_path, target)?;
                target_written = true;
                let verified = get_link_from_path(target_path, &key)
                    .is_ok_and(|target_link| target_link == source_link);
                if !verified {
                    let rollback = if target_existed {
                        save_links_config_to_path_unlocked(target_path, original_target.clone())
                            .map(|_| ())
                    } else if target_path.exists() {
                        fs::remove_file(target_path).with_context(|| {
                            format!(
                                "failed to remove unverified target: {}",
                                target_path.display()
                            )
                        })
                    } else {
                        Ok(())
                    };
                    if let Err(rollback_error) = rollback {
                        return Err(anyhow!(
                            "Link 目标写入后校验失败，且目标回滚失败：{rollback_error}"
                        ));
                    }
                    anyhow::bail!("Link 目标写入后校验失败，已回滚目标配置");
                }
            }

            if !copy {
                source.links.retain(|link| link.key != key);
                if let Err(error) = save_links_config_to_path_unlocked(source_path, source) {
                    if target_written {
                        let rollback = if target_existed {
                            save_links_config_to_path_unlocked(target_path, original_target)
                                .map(|_| ())
                        } else if target_path.exists() {
                            fs::remove_file(target_path).with_context(|| {
                                format!(
                                    "failed to remove rolled back target: {}",
                                    target_path.display()
                                )
                            })
                        } else {
                            Ok(())
                        };
                        if let Err(rollback_error) = rollback {
                            return Err(anyhow!(
                                "Link 源删除失败：{error}；目标回滚也失败：{rollback_error}"
                            ));
                        }
                    }
                    return Err(error).context("Link 目标已回滚，源配置删除失败");
                }
                source_deleted = true;
            }

            Ok(LinkMigrationResult {
                plan,
                applied: target_written || source_deleted,
                target_written,
                source_deleted,
            })
        },
    )
}

fn build_link_migration_plan(
    source_path: &Path,
    target_path: &Path,
    key: &str,
    copy: bool,
    replace: bool,
    source: &LinkFileConfig,
    target: &LinkFileConfig,
) -> LinkMigrationPlan {
    let source_link = source.links.iter().find(|link| link.key == key);
    let target_link = target.links.iter().find(|link| link.key == key);
    let source_state = if source_link.is_some() {
        "present"
    } else {
        "missing"
    };
    let target_state = match (source_link, target_link) {
        (_, None) => "missing",
        (Some(source_link), Some(target_link)) if source_link == target_link => "equivalent",
        (None, Some(_)) => "presentUnverified",
        (Some(_), Some(_)) => "conflict",
    };
    let mut actions = Vec::new();
    let mut risks = Vec::new();
    let can_apply = match (source_link, target_link) {
        (None, None) => {
            risks.push(format!("源配置中不存在 Link：{key}"));
            false
        }
        (None, Some(_)) => {
            risks.push(format!(
                "源配置中不存在 Link {key}，但目标存在同名配置；无法验证目标是否来自本次迁移。请检查 --from/--to。"
            ));
            false
        }
        (Some(_), None) => {
            actions.push("writeTarget".to_string());
            if !copy {
                actions.push("deleteSource".to_string());
            }
            true
        }
        (Some(source_link), Some(target_link)) if source_link == target_link => {
            if !copy {
                actions.push("deleteSource".to_string());
            }
            true
        }
        (Some(_), Some(_)) if replace => {
            actions.push("replaceTarget".to_string());
            if !copy {
                actions.push("deleteSource".to_string());
            }
            risks.push("目标配置中的同名 Link 将被显式覆盖。".to_string());
            true
        }
        (Some(_), Some(_)) => {
            risks.push("目标配置存在内容不同的同名 Link；使用 --replace 才能覆盖。".to_string());
            false
        }
    };
    LinkMigrationPlan {
        key: key.to_string(),
        source_path: source_path.display().to_string(),
        target_path: target_path.display().to_string(),
        mode: if copy { "copy" } else { "move" }.to_string(),
        replace,
        source_state: source_state.to_string(),
        target_state: target_state.to_string(),
        can_apply,
        actions,
        risks,
    }
}

fn same_config_path(left: &Path, right: &Path) -> bool {
    fn resolved(path: &Path) -> PathBuf {
        path.canonicalize().unwrap_or_else(|_| {
            let Some(parent) = path.parent() else {
                return path.to_path_buf();
            };
            let parent = parent
                .canonicalize()
                .unwrap_or_else(|_| parent.to_path_buf());
            path.file_name()
                .map(|file_name| parent.join(file_name))
                .unwrap_or(parent)
        })
    }
    resolved(left) == resolved(right)
}

pub fn attach_link_to_workspace(
    workspaces_dir: &Path,
    request: LinkWorkspaceAttachRequest,
) -> Result<LinkWorkspaceAttachResult> {
    attach_link_to_workspace_from_path(workspaces_dir, &default_links_path(), request)
}

pub fn attach_link_to_workspace_from_path(
    workspaces_dir: &Path,
    links_path: &Path,
    request: LinkWorkspaceAttachRequest,
) -> Result<LinkWorkspaceAttachResult> {
    let workspace_key = normalize_text(&request.workspace_key)
        .ok_or_else(|| anyhow!("workspace key is required"))?;
    let link_key =
        normalize_key(&request.link_key).ok_or_else(|| anyhow!("link key is required"))?;
    let link = get_link_from_path(links_path, &link_key)?;
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
        .map(|(index, step)| plan_step(link, step, index, app_config, proxy_config, &project_keys))
        .collect::<Vec<_>>();

    LinkPlan {
        key: link.key.clone(),
        name: link.name.clone(),
        kind: link_kind(link),
        ui_profile: link_ui_profile(link),
        schema_version: link.schema_version.unwrap_or(1),
        workspace_key: link.workspace_key.clone(),
        project: link.project.clone(),
        source_context: None,
        steps,
        warnings,
    }
}

pub fn link_proxy_check_status(step_type: &str, running: bool, managed: bool) -> &'static str {
    if !running {
        return if step_type == "proxy.start" {
            "ready"
        } else {
            "blocked"
        };
    }
    if managed { "checked" } else { "blocked" }
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
) -> LinkPlanStep {
    let id = normalize_text(step.id.as_str()).unwrap_or_else(|| format!("step-{}", index + 1));
    let step_type = normalize_text(step.step_type.as_str()).unwrap_or_default();
    let label = step.label.as_deref().and_then(normalize_text);
    let mut risks = Vec::new();
    let mut runtime = None;

    let (default_label, summary) =
        match step_type.as_str() {
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
                    }
                } else {
                    risks.push("缺少 project，无法定位运行项目。".to_string());
                }

                if let Some(project_key) = project_key.as_deref()
                    && project_keys.contains(project_key)
                {
                    runtime =
                        resolve_link_runtime_context(app_config, project_key, step, &mut risks);
                }

                (
                "运行环境".to_string(),
                match (project_key, debug_profile, runtime_profile, runtime.as_ref()) {
                    (Some(project_key), Some(debug_profile), _, Some(context)) => context
                        .effective
                        .target
                        .as_ref()
                        .map(|target| {
                            format!(
                                "计划用调试配置 {debug_profile} 启动项目 {project_key}，cwd={}",
                                target.cwd
                            )
                        })
                        .unwrap_or_else(|| {
                            format!("计划用调试配置 {debug_profile} 启动项目 {project_key}")
                        }),
                    (Some(project_key), _, Some(runtime_profile), Some(context)) => context
                        .effective
                        .target
                        .as_ref()
                        .map(|target| {
                            format!(
                                "计划用运行环境 {runtime_profile} 启动项目 {project_key}，cwd={}",
                                target.cwd
                            )
                        })
                        .unwrap_or_else(|| {
                            format!("计划用运行环境 {runtime_profile} 启动项目 {project_key}")
                        }),
                    (Some(project_key), _, _, Some(context)) => context
                        .effective
                        .target
                        .as_ref()
                        .map(|target| format!("计划启动项目 {project_key}，cwd={}", target.cwd))
                        .unwrap_or_else(|| format!("计划启动项目 {project_key}")),
                    (Some(project_key), Some(debug_profile), _, _) => {
                        format!("计划用调试配置 {debug_profile} 启动项目 {project_key}")
                    }
                    (Some(project_key), _, Some(runtime_profile), _) => {
                        format!("计划用运行环境 {runtime_profile} 启动项目 {project_key}")
                    }
                    (Some(project_key), _, _, _) => format!("计划启动项目 {project_key}"),
                    _ => "计划启动项目运行环境".to_string(),
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
                    } else {
                        runtime =
                            resolve_link_runtime_context(app_config, project_key, step, &mut risks);
                    }
                } else {
                    risks.push("缺少 project，无法定位要聚焦的项目。".to_string());
                }
                (
                    "打开页面".to_string(),
                    runtime
                        .as_ref()
                        .and_then(|context| context.effective.target.as_ref())
                        .and_then(|target| target.focus_url.as_ref())
                        .map(|url| format!("计划打开项目调试页面 {url}"))
                        .unwrap_or_else(|| "计划打开项目调试页面".to_string()),
                )
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
        runtime,
    }
}

fn resolve_link_runtime_context(
    app_config: &AppConfig,
    project_key: &str,
    step: &LinkStepConfig,
    risks: &mut Vec<String>,
) -> Option<ProjectRuntimeContextSnapshot> {
    let options = ProjectRuntimeLaunchOptions {
        debug_profile: step.debug_profile.clone(),
        runtime_profile: step.runtime_profile.clone(),
        command: step.command.clone(),
        expected_port: step.expected_port,
        env: step.env.clone(),
    };
    match project_runtime_context_snapshot(app_config, project_key, &options) {
        Ok(context) => {
            if !context.status.success {
                for risk in context.risks.iter().filter(|risk| risk.severity == "error") {
                    if !risks.contains(&risk.detail) {
                        risks.push(risk.detail.clone());
                    }
                }
            }
            Some(context)
        }
        Err(error) => {
            risks.push(error);
            None
        }
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
    use std::sync::{Arc, Barrier};
    use std::thread;

    fn test_path() -> PathBuf {
        std::env::temp_dir().join(format!("rdevtool-link-{}.toml", uuid::Uuid::new_v4()))
    }

    fn cleanup(path: &Path) {
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(crate::config_store::backup_path(path));
    }

    fn cleanup_paths(paths: &[&Path]) {
        for path in paths {
            cleanup(path);
        }
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

    #[test]
    fn concurrent_upserts_preserve_both_links() {
        let path = test_path();
        let barrier = Arc::new(Barrier::new(3));
        let handles = [("first", "First"), ("second", "Second")]
            .into_iter()
            .map(|(key, name)| {
                let path = path.clone();
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    upsert_link_to_path(&path, link(key, name)).unwrap();
                })
            })
            .collect::<Vec<_>>();
        barrier.wait();
        for handle in handles {
            handle.join().unwrap();
        }

        let links = list_links_from_path(&path).unwrap();
        assert_eq!(links.len(), 2);
        assert!(links.iter().any(|item| item.key == "first"));
        assert!(links.iter().any(|item| item.key == "second"));
        cleanup(&path);
    }

    #[test]
    fn moves_one_link_without_replacing_unrelated_entries() {
        let source = test_path();
        let target = test_path();
        upsert_link_to_path(&source, link("moving", "Moving")).unwrap();
        upsert_link_to_path(&source, link("source-only", "Source Only")).unwrap();
        upsert_link_to_path(&target, link("target-only", "Target Only")).unwrap();

        let result = execute_link_migration(&source, &target, "moving", false, false).unwrap();
        assert!(result.applied);
        assert!(result.target_written);
        assert!(result.source_deleted);
        assert!(get_link_from_path(&source, "moving").is_err());
        assert!(get_link_from_path(&source, "source-only").is_ok());
        assert_eq!(
            get_link_from_path(&target, "moving").unwrap().name,
            "Moving"
        );
        assert!(get_link_from_path(&target, "target-only").is_ok());
        cleanup_paths(&[&source, &target]);
    }

    #[test]
    fn migration_conflict_requires_explicit_replace() {
        let source = test_path();
        let target = test_path();
        upsert_link_to_path(&source, link("shared", "Source")).unwrap();
        upsert_link_to_path(&target, link("shared", "Target")).unwrap();

        let plan = plan_link_migration(&source, &target, "shared", false, false).unwrap();
        assert_eq!(plan.target_state, "conflict");
        assert!(!plan.can_apply);
        assert!(execute_link_migration(&source, &target, "shared", false, false).is_err());

        let result = execute_link_migration(&source, &target, "shared", false, true).unwrap();
        assert!(result.applied);
        assert_eq!(
            get_link_from_path(&target, "shared").unwrap().name,
            "Source"
        );
        assert!(get_link_from_path(&source, "shared").is_err());
        cleanup_paths(&[&source, &target]);
    }

    #[test]
    fn migration_rejects_an_unverified_target_when_source_is_missing() {
        let source = test_path();
        let target = test_path();
        upsert_link_to_path(&target, link("shared", "Shared")).unwrap();

        let plan = plan_link_migration(&source, &target, "shared", false, false).unwrap();
        assert_eq!(plan.source_state, "missing");
        assert_eq!(plan.target_state, "presentUnverified");
        assert!(!plan.can_apply);
        assert!(execute_link_migration(&source, &target, "shared", false, false).is_err());
        assert!(get_link_from_path(&target, "shared").is_ok());
        cleanup_paths(&[&source, &target]);
    }

    #[test]
    fn classifies_proxy_start_as_ready_before_the_daemon_is_started() {
        assert_eq!(
            link_proxy_check_status("proxy.start", false, false),
            "ready"
        );
    }

    #[test]
    fn classifies_missing_proxy_check_and_external_listeners_as_blocked() {
        assert_eq!(
            link_proxy_check_status("proxy.check", false, false),
            "blocked"
        );
        assert_eq!(
            link_proxy_check_status("proxy.start", true, false),
            "blocked"
        );
        assert_eq!(
            link_proxy_check_status("proxy.check", true, false),
            "blocked"
        );
    }

    #[test]
    fn classifies_managed_proxy_listeners_as_checked() {
        assert_eq!(
            link_proxy_check_status("proxy.start", true, true),
            "checked"
        );
        assert_eq!(
            link_proxy_check_status("proxy.check", true, true),
            "checked"
        );
    }

    #[test]
    fn runtime_plan_step_exposes_effective_target_and_observed_boundary() {
        let repo = std::env::temp_dir().join(format!(
            "rdevtool-link-runtime-context-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&repo).unwrap();
        let project_key = format!("link-runtime-{}", uuid::Uuid::new_v4());
        let config: AppConfig = serde_json::from_value(serde_json::json!({
            "defaults": {},
            "projects": [{
                "key": project_key,
                "name": "Link Runtime",
                "git_url": "",
                "repo_path": repo,
                "dev": { "command": "npm run dev" },
                "debug_profiles": [{
                    "key": "h5",
                    "label": "H5",
                    "focus_url": "http://127.0.0.1:4173/h5",
                    "ready_probe": { "path": "/health" }
                }]
            }]
        }))
        .unwrap();
        let link = LinkConfig {
            key: "runtime-link".to_string(),
            name: "Runtime Link".to_string(),
            kind: Some("runtime".to_string()),
            ui_profile: None,
            schema_version: Some(1),
            workspace_key: None,
            project: Some(project_key.clone()),
            steps: vec![LinkStepConfig {
                id: "runtime".to_string(),
                step_type: "runtime.start".to_string(),
                debug_profile: Some("h5".to_string()),
                ..LinkStepConfig::default()
            }],
        };

        let plan = plan_link_config(&link, &config, &[], &ProxyConfig::default());
        let step = &plan.steps[0];
        assert_eq!(step.status, "planned");
        let runtime = step.runtime.as_ref().expect("runtime context");
        assert_eq!(runtime.requested.debug_profile_key.as_deref(), Some("h5"));
        assert_eq!(runtime.status.key, "configured");
        assert!(runtime.observed.available);
        let target = runtime.effective.target.as_ref().expect("runtime target");
        assert_eq!(
            target.focus_url.as_deref(),
            Some("http://127.0.0.1:4173/h5")
        );
        assert_eq!(
            target
                .ready_probe
                .as_ref()
                .and_then(|probe| probe.path.as_deref()),
            Some("/health")
        );

        std::fs::remove_dir_all(repo).unwrap();
    }
}
