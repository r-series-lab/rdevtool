use project_runtime::{
    ProjectRuntimeLogKind, ProjectRuntimeLogResponse, ProjectRuntimeSnapshot, ProjectRuntimeState,
};
use rdevtool_core::config::{
    AppConfig, BranchRules, DeployParamConfig, DeployParamKind, DeployTargetConfig, Jobs,
    ProjectCommandConfig, ProjectConfig, ProjectDebugLocalFileConfig, ProjectDebugProfileConfig,
    ProjectFocusConfig, default_config_dir, default_projects_path, default_workspace_path,
    ensure_default_configs, load_config, load_workspace_config, save_config, save_workspace_config,
};
use rdevtool_core::core::{
    BranchCheckoutRequest, BranchCommitOverview, BranchCreateRequest, BranchPushRequest,
    BranchPushStatus, BranchSwitchRequest, BranchSyncRequest, BranchTaskResponse,
    BuildStatusResponse, BuildTriggerResponse, DeployPlan, DeployRequest, DeployTargetMeta,
    ProjectDetail, ProjectSummary, StatusRequest, available_branch_options, branch_commit_overview,
    branch_hint, branch_push_status, build_plan, checkout_branch_to_directory, deploy_target_meta,
    execute_branch_create, execute_branch_push, execute_branch_switch, execute_branch_sync,
    execute_merge, project_detail, project_summaries, refresh_deploy_status, trigger_deploy,
};
use rdevtool_core::core::{MergeRequest, MergeResponse};
use rdevtool_core::navigation::{
    NavigationData, NavigationEditorData, NavigationEntry, NavigationOpenResult,
    load_navigation_data, load_navigation_editor_data, navigation_file_path, open_navigation_entry,
    save_navigation_editor_data,
};
use rdevtool_core::web_actions::{
    WebActionListResponse, WebActionRunRequest, WebActionRunResult, WebActionScriptRunRequest,
    WebActionTarget,
    list_web_action_targets as core_list_web_action_targets,
    list_web_actions as core_list_web_actions, open_web_action_target as core_open_web_action_target,
    run_web_action as core_run_web_action, run_web_action_script as core_run_web_action_script,
};
use rdevtool_core::storage::{
    DeployHistoryEntry, MergeHistoryEntry, SaveDeployHistoryRequest, SaveMergeHistoryRequest,
    Storage, default_storage_path,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{
    Arc, RwLock,
    atomic::{AtomicBool, Ordering},
};
use std::time::SystemTime;
use tauri::{
    AppHandle, Manager, Runtime, WindowEvent,
    image::Image,
    menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

mod project_runtime;

#[derive(Clone)]
struct AppState {
    storage: Storage,
    project_runtime: ProjectRuntimeState,
    config_state: AppConfigState,
}

#[derive(Clone, Default)]
struct AppConfigState {
    inner: Arc<RwLock<Option<CachedAppConfig>>>,
}

#[derive(Clone)]
struct CachedAppConfig {
    config: AppConfig,
    modified_at: Option<SystemTime>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceAppPreferences {
    style_mode: String,
    default_page: Option<String>,
    enabled_pages: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectConfigEditorState {
    config_path: String,
    jenkins_profiles: Vec<String>,
    default_branch_rules: BranchRulesEditor,
    projects: Vec<ProjectConfigEditorProject>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectConfigEditorProject {
    key: String,
    name: String,
    category: String,
    repo_path: Option<String>,
    git_url: String,
    dev: ProjectCommandEditor,
    build: ProjectCommandEditor,
    focus: ProjectFocusEditor,
    branch_rules: BranchRulesEditor,
    deploy_targets: Vec<DeployTargetEditor>,
    debug_profiles: Vec<ProjectDebugProfileEditor>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct ProjectCommandEditor {
    command: String,
    cwd: Option<String>,
    output_dir: Option<String>,
    env_count: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct ProjectFocusEditor {
    url: Option<String>,
    bundle_id: Option<String>,
    auto_on_start: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct ProjectDebugProfileEditor {
    key: String,
    label: String,
    env_text: String,
    local_files: Vec<ProjectDebugLocalFileEditor>,
    browser: Option<String>,
    browser_profile: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectDebugLocalFileEditor {
    path: String,
    mode: String,
    content: String,
    enabled: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct BranchRulesEditor {
    source_keywords: Vec<String>,
    target_keywords: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeployTargetEditor {
    key: String,
    label: String,
    jenkins_profile: String,
    job_name: String,
    params: Vec<DeployParamEditor>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeployParamEditor {
    key: String,
    label: String,
    kind: String,
    default_value: Option<String>,
    options: Vec<String>,
    required: bool,
    true_value: Option<String>,
    false_value: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveProjectConfigBasicsRequest {
    key: String,
    name: String,
    category: String,
    repo_path: Option<String>,
    git_url: String,
    dev: ProjectCommandEditor,
    build: ProjectCommandEditor,
    focus: ProjectFocusEditor,
    branch_rules: BranchRulesEditor,
    debug_profiles: Vec<ProjectDebugProfileEditor>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveDefaultBranchRulesRequest {
    branch_rules: BranchRulesEditor,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveProjectDeployTargetBasicsRequest {
    project_key: String,
    target_key: String,
    label: String,
    jenkins_profile: String,
    job_name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddProjectConfigRequest {
    key: String,
    name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteProjectConfigRequest {
    key: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveProjectDeployTargetsRequest {
    project_key: String,
    deploy_targets: Vec<DeployTargetEditor>,
}

const DEFAULT_PAGE_KEYS: [&str; 3] = ["projects", "merge", "deploy"];
const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "main-tray";
const TRAY_SHOW_ID: &str = "tray_show_main";
const TRAY_REPLAY_LAST_ID: &str = "tray_replay_last";
const TRAY_PINNED_PREFIX: &str = "tray_pinned_";
const TRAY_PINNED_SUBMENU_ID: &str = "tray_pinned_menu";
const TRAY_QUIT_ID: &str = "tray_quit";
const TRAY_STORAGE_NAMESPACE: &str = "tray";
const TRAY_RECENT_STORAGE_KEY: &str = "recent-actions";
const TRAY_PINNED_STORAGE_KEY: &str = "pinned-actions";
const TRAY_RECENT_LIMIT: usize = 6;
const TRAY_PINNED_LIMIT: usize = 5;

fn should_use_tray() -> bool {
    !cfg!(debug_assertions)
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrayReplayAction {
    kind: String,
    label: String,
    detail: Option<String>,
    project_key: Option<String>,
    entry: Option<NavigationEntry>,
    #[serde(default)]
    payload: Option<serde_json::Value>,
    dedupe_key: String,
    updated_at_ms: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrayBranchReplayPayload {
    command: String,
    request: serde_json::Value,
}

impl AppConfigState {
    fn load(&self) -> Result<AppConfig, String> {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let modified_at = fs::metadata(&paths.projects)
            .ok()
            .and_then(|metadata| metadata.modified().ok());

        let mut guard = self
            .inner
            .write()
            .map_err(|_| "app config cache lock poisoned".to_string())?;

        if let Some(cached) = guard.as_ref() {
            if cached.modified_at == modified_at {
                return Ok(cached.config.clone());
            }
        }

        let config = load_config(&paths.projects).map_err(|error| error.to_string())?;
        *guard = Some(CachedAppConfig {
            config: config.clone(),
            modified_at,
        });
        Ok(config)
    }

    fn invalidate(&self) -> Result<(), String> {
        let mut guard = self
            .inner
            .write()
            .map_err(|_| "app config cache lock poisoned".to_string())?;
        *guard = None;
        Ok(())
    }
}

fn normalize_style_mode(value: &str) -> String {
    match value {
        "mono" => "mono".to_string(),
        _ => "light".to_string(),
    }
}

fn normalize_page_key(value: Option<String>) -> Option<String> {
    let value = value?.trim().to_string();
    match value.as_str() {
        "navigation" => Some("projects".to_string()),
        "deploy" | "merge" | "projects" => Some(value),
        _ => None,
    }
}

fn normalize_page_list(values: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    for value in values {
        let Some(page) = normalize_page_key(Some(value)) else {
            continue;
        };
        if !normalized.contains(&page) {
            normalized.push(page);
        }
    }
    normalized
}

fn default_page_list() -> Vec<String> {
    DEFAULT_PAGE_KEYS
        .iter()
        .map(|page| (*page).to_string())
        .collect()
}

fn effective_page_list(values: Vec<String>) -> Vec<String> {
    let normalized = normalize_page_list(values);
    if normalized.is_empty() {
        default_page_list()
    } else {
        normalized
    }
}

fn compress_page_list(values: Vec<String>) -> Vec<String> {
    let normalized = normalize_page_list(values);
    if normalized.is_empty() || normalized == default_page_list() {
        Vec::new()
    } else {
        normalized
    }
}

fn normalize_default_page_for_enabled_pages(
    value: Option<String>,
    enabled_pages: &[String],
) -> Option<String> {
    let normalized = normalize_page_key(value)?;
    if enabled_pages.is_empty() || enabled_pages.contains(&normalized) {
        Some(normalized)
    } else {
        enabled_pages.first().cloned()
    }
}

#[tauri::command]
fn app_info() -> serde_json::Value {
    json!({
        "name": "rDevTool",
        "stack": "React + Tauri + SQLite",
        "version": env!("CARGO_PKG_VERSION"),
        "configDir": default_config_dir().display().to_string(),
        "configPath": default_projects_path().display().to_string(),
        "workspacePath": default_workspace_path().display().to_string(),
        "navigationPath": navigation_file_path(),
        "storagePath": default_storage_path().display().to_string(),
    })
}

#[tauri::command]
async fn get_workspace_app_preferences() -> Result<WorkspaceAppPreferences, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let config = load_workspace_config(&paths.workspace).map_err(|error| error.to_string())?;
        let enabled_pages = effective_page_list(config.app.enabled_pages);
        Ok(WorkspaceAppPreferences {
            style_mode: normalize_style_mode(&config.app.style_mode),
            default_page: normalize_default_page_for_enabled_pages(
                config.app.default_page,
                &enabled_pages,
            ),
            enabled_pages,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_workspace_app_preferences(
    preferences: WorkspaceAppPreferences,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let mut config =
            load_workspace_config(&paths.workspace).map_err(|error| error.to_string())?;
        config.app.style_mode = normalize_style_mode(&preferences.style_mode);
        config.app.enabled_pages = compress_page_list(preferences.enabled_pages);
        config.app.default_page = normalize_default_page_for_enabled_pages(
            preferences.default_page,
            &config.app.enabled_pages,
        );
        save_workspace_config(&paths.workspace, &config).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn optional_editor_string(value: Option<String>) -> Option<String> {
    value.and_then(|item| {
        let trimmed = item.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn optional_editor_path(value: Option<String>) -> Option<PathBuf> {
    optional_editor_string(value).map(PathBuf::from)
}

fn command_to_editor(command: &Option<ProjectCommandConfig>) -> ProjectCommandEditor {
    let Some(command) = command else {
        return ProjectCommandEditor::default();
    };

    ProjectCommandEditor {
        command: command.command.clone(),
        cwd: command.cwd.as_ref().map(|path| path.display().to_string()),
        output_dir: command
            .output_dir
            .as_ref()
            .map(|path| path.display().to_string()),
        env_count: command.env.len(),
    }
}

fn apply_editor_command(
    existing: Option<ProjectCommandConfig>,
    editor: ProjectCommandEditor,
) -> Option<ProjectCommandConfig> {
    let mut next = existing.unwrap_or_default();
    next.command = editor.command.trim().to_string();
    next.cwd = optional_editor_path(editor.cwd);
    next.output_dir = optional_editor_path(editor.output_dir);

    if next.command.is_empty()
        && next.cwd.is_none()
        && next.output_dir.is_none()
        && next.env.is_empty()
    {
        None
    } else {
        Some(next)
    }
}

fn deploy_param_kind_key(kind: &DeployParamKind) -> &'static str {
    match kind {
        DeployParamKind::Select => "select",
        DeployParamKind::Boolean => "boolean",
        DeployParamKind::Branch => "branch",
        DeployParamKind::Text => "text",
        DeployParamKind::Hidden => "hidden",
    }
}

fn deploy_param_kind_from_key(value: &str) -> Result<DeployParamKind, String> {
    match value.trim() {
        "select" => Ok(DeployParamKind::Select),
        "boolean" => Ok(DeployParamKind::Boolean),
        "branch" => Ok(DeployParamKind::Branch),
        "text" => Ok(DeployParamKind::Text),
        "hidden" => Ok(DeployParamKind::Hidden),
        other => Err(format!("unsupported deploy param type: {}", other)),
    }
}

fn validate_config_key(kind: &str, value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{} key 不能为空", kind));
    }
    if value.chars().any(char::is_whitespace) {
        return Err(format!("{} key 不能包含空白字符", kind));
    }
    Ok(value.to_string())
}

fn normalize_keyword_list(values: Vec<String>) -> Vec<String> {
    values
        .into_iter()
        .filter_map(|value| optional_editor_string(Some(value)))
        .collect()
}

fn env_map_to_editor_text(env: &std::collections::BTreeMap<String, String>) -> String {
    env.iter()
        .map(|(key, value)| format!("{}={}", key, value))
        .collect::<Vec<_>>()
        .join("\n")
}

fn env_map_from_editor_text(
    value: &str,
) -> Result<std::collections::BTreeMap<String, String>, String> {
    let mut env = std::collections::BTreeMap::new();
    for (index, line) in value.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, next_value)) = line.split_once('=') else {
            return Err(format!("环境变量第 {} 行需要使用 KEY=VALUE", index + 1));
        };
        let key = key.trim();
        if key.is_empty() {
            return Err(format!("环境变量第 {} 行的 key 不能为空", index + 1));
        }
        if key.chars().any(char::is_whitespace) {
            return Err(format!("环境变量 key 不能包含空白字符: {}", key));
        }
        env.insert(key.to_string(), next_value.trim().to_string());
    }
    Ok(env)
}

fn debug_profile_to_editor(profile: &ProjectDebugProfileConfig) -> ProjectDebugProfileEditor {
    ProjectDebugProfileEditor {
        key: profile.key.clone(),
        label: profile.label.clone(),
        env_text: env_map_to_editor_text(&profile.env),
        local_files: profile
            .local_files
            .iter()
            .map(|file| ProjectDebugLocalFileEditor {
                path: file.path.display().to_string(),
                mode: file.mode.clone(),
                content: file.content.clone(),
                enabled: file.enabled,
            })
            .collect(),
        browser: profile.browser.clone(),
        browser_profile: profile.browser_profile.clone(),
    }
}

fn debug_profiles_from_editor(
    profiles: Vec<ProjectDebugProfileEditor>,
) -> Result<Vec<ProjectDebugProfileConfig>, String> {
    let mut profile_keys = std::collections::BTreeSet::new();
    let mut next_profiles = Vec::with_capacity(profiles.len());

    for profile in profiles {
        let key = validate_config_key("调试档案", &profile.key)?;
        if !profile_keys.insert(key.clone()) {
            return Err(format!("调试档案 key 重复: {}", key));
        }
        let label = profile.label.trim();
        let local_files = profile
            .local_files
            .into_iter()
            .filter_map(|file| {
                let path = file.path.trim().to_string();
                if path.is_empty() && file.content.trim().is_empty() {
                    None
                } else {
                    Some((path, file))
                }
            })
            .map(|(path, file)| {
                if path.is_empty() {
                    return Err(format!("调试档案 {} 的本地文件路径不能为空", key));
                }
                let mode = match file.mode.trim() {
                    "" | "overwrite" => "overwrite".to_string(),
                    "append_block" => "append_block".to_string(),
                    other => {
                        return Err(format!(
                            "调试档案 {} 的本地文件写入方式不支持: {}",
                            key, other
                        ));
                    }
                };
                Ok(ProjectDebugLocalFileConfig {
                    path: PathBuf::from(path),
                    mode,
                    content: file.content,
                    enabled: file.enabled,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;

        next_profiles.push(ProjectDebugProfileConfig {
            key: key.clone(),
            label: if label.is_empty() {
                key
            } else {
                label.to_string()
            },
            env: env_map_from_editor_text(&profile.env_text)?,
            local_files,
            browser: optional_editor_string(profile.browser),
            browser_profile: optional_editor_string(profile.browser_profile),
        });
    }

    Ok(next_profiles)
}

fn project_to_editor(project: &rdevtool_core::config::ProjectConfig) -> ProjectConfigEditorProject {
    ProjectConfigEditorProject {
        key: project.key.clone(),
        name: project.name.clone(),
        category: project.category.clone(),
        repo_path: project
            .repo_path
            .as_ref()
            .map(|path| path.display().to_string()),
        git_url: project.git_url.clone(),
        dev: command_to_editor(&project.dev),
        build: command_to_editor(&project.build),
        focus: ProjectFocusEditor {
            url: project.focus.url.clone(),
            bundle_id: project.focus.bundle_id.clone(),
            auto_on_start: project.focus.auto_on_start,
        },
        branch_rules: BranchRulesEditor {
            source_keywords: project.branch_rules.source_keywords.clone(),
            target_keywords: project.branch_rules.target_keywords.clone(),
        },
        deploy_targets: project
            .deploy_targets
            .iter()
            .map(|target| DeployTargetEditor {
                key: target.key.clone(),
                label: target.label.clone(),
                jenkins_profile: target.jenkins_profile.clone(),
                job_name: target.job_name.clone(),
                params: target
                    .params
                    .iter()
                    .map(|param| DeployParamEditor {
                        key: param.key.clone(),
                        label: param.label.clone(),
                        kind: deploy_param_kind_key(&param.kind).to_string(),
                        default_value: param.default.clone(),
                        options: param.options.clone(),
                        required: param.required,
                        true_value: param.true_value.clone(),
                        false_value: param.false_value.clone(),
                    })
                    .collect(),
            })
            .collect(),
        debug_profiles: project
            .debug_profiles
            .iter()
            .map(debug_profile_to_editor)
            .collect(),
    }
}

fn load_project_config_editor_state(path: &Path) -> Result<ProjectConfigEditorState, String> {
    let config = load_config(path).map_err(|error| error.to_string())?;
    Ok(ProjectConfigEditorState {
        config_path: path.display().to_string(),
        jenkins_profiles: config.defaults.jenkins_profiles.keys().cloned().collect(),
        default_branch_rules: BranchRulesEditor {
            source_keywords: config.defaults.branch_rules.source_keywords.clone(),
            target_keywords: config.defaults.branch_rules.target_keywords.clone(),
        },
        projects: config.projects.iter().map(project_to_editor).collect(),
    })
}

fn deploy_targets_from_editor(
    deploy_targets: Vec<DeployTargetEditor>,
) -> Result<Vec<DeployTargetConfig>, String> {
    let mut target_keys = std::collections::BTreeSet::new();
    let mut next_targets = Vec::with_capacity(deploy_targets.len());

    for target in deploy_targets {
        let target_key = validate_config_key("部署目标", &target.key)?;
        if !target_keys.insert(target_key.clone()) {
            return Err(format!("部署目标 key 重复: {}", target_key));
        }
        let label = target.label.trim();
        let jenkins_profile = target.jenkins_profile.trim();
        let job_name = target.job_name.trim();
        if label.is_empty() {
            return Err(format!("部署目标 {} 的名称不能为空", target_key));
        }
        if jenkins_profile.is_empty() {
            return Err(format!(
                "部署目标 {} 的 Jenkins Profile 不能为空",
                target_key
            ));
        }
        if job_name.is_empty() {
            return Err(format!("部署目标 {} 的 Job Name 不能为空", target_key));
        }

        let mut param_keys = std::collections::BTreeSet::new();
        let mut params = Vec::with_capacity(target.params.len());
        for param in target.params {
            let param_key = validate_config_key("参数", &param.key)?;
            if !param_keys.insert(param_key.clone()) {
                return Err(format!(
                    "部署目标 {} 参数 key 重复: {}",
                    target_key, param_key
                ));
            }
            let label = param.label.trim();
            if label.is_empty() {
                return Err(format!("参数 {} 的名称不能为空", param_key));
            }
            params.push(DeployParamConfig {
                key: param_key,
                label: label.to_string(),
                kind: deploy_param_kind_from_key(&param.kind)?,
                default: optional_editor_string(param.default_value),
                options: param
                    .options
                    .into_iter()
                    .filter_map(|option| optional_editor_string(Some(option)))
                    .collect(),
                required: param.required,
                true_value: optional_editor_string(param.true_value),
                false_value: optional_editor_string(param.false_value),
            });
        }

        next_targets.push(DeployTargetConfig {
            key: target_key,
            label: label.to_string(),
            jenkins_profile: jenkins_profile.to_string(),
            job_name: job_name.to_string(),
            params,
        });
    }

    Ok(next_targets)
}

#[tauri::command]
async fn get_project_config_editor() -> Result<ProjectConfigEditorState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        load_project_config_editor_state(&paths.projects)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_project_config_basics(
    state: tauri::State<'_, AppState>,
    request: SaveProjectConfigBasicsRequest,
) -> Result<ProjectConfigEditorState, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let mut config = load_config(&paths.projects).map_err(|error| error.to_string())?;
        let project = config
            .projects
            .iter_mut()
            .find(|project| project.key == request.key)
            .ok_or_else(|| format!("project {} not found", request.key))?;

        let name = request.name.trim();
        if name.is_empty() {
            return Err("项目名称不能为空".to_string());
        }

        project.name = name.to_string();
        project.category = {
            let value = request.category.trim();
            if value.is_empty() {
                "Workspace".to_string()
            } else {
                value.to_string()
            }
        };
        project.repo_path = optional_editor_path(request.repo_path);
        project.git_url = request.git_url.trim().to_string();
        project.focus = ProjectFocusConfig {
            url: optional_editor_string(request.focus.url),
            bundle_id: optional_editor_string(request.focus.bundle_id),
            auto_on_start: request.focus.auto_on_start,
        };
        project.branch_rules = BranchRules {
            source_keywords: normalize_keyword_list(request.branch_rules.source_keywords),
            target_keywords: normalize_keyword_list(request.branch_rules.target_keywords),
        };
        project.dev = apply_editor_command(project.dev.take(), request.dev);
        project.build = apply_editor_command(project.build.take(), request.build);
        project.debug_profiles = debug_profiles_from_editor(request.debug_profiles)?;

        save_config(&paths.projects, &config).map_err(|error| error.to_string())?;
        config_state.invalidate()?;

        load_project_config_editor_state(&paths.projects)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_default_branch_rules(
    state: tauri::State<'_, AppState>,
    request: SaveDefaultBranchRulesRequest,
) -> Result<ProjectConfigEditorState, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let mut config = load_config(&paths.projects).map_err(|error| error.to_string())?;

        config.defaults.branch_rules = BranchRules {
            source_keywords: normalize_keyword_list(request.branch_rules.source_keywords),
            target_keywords: normalize_keyword_list(request.branch_rules.target_keywords),
        };

        save_config(&paths.projects, &config).map_err(|error| error.to_string())?;
        config_state.invalidate()?;
        load_project_config_editor_state(&paths.projects)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn add_project_config(
    state: tauri::State<'_, AppState>,
    request: AddProjectConfigRequest,
) -> Result<ProjectConfigEditorState, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let mut config = load_config(&paths.projects).map_err(|error| error.to_string())?;
        let key = validate_config_key("项目", &request.key)?;
        if config.projects.iter().any(|project| project.key == key) {
            return Err(format!("项目 key 已存在: {}", key));
        }
        let name = request.name.trim();
        if name.is_empty() {
            return Err("项目名称不能为空".to_string());
        }

        config.projects.push(ProjectConfig {
            key,
            name: name.to_string(),
            category: "Workspace".to_string(),
            repo_path: None,
            git_url: String::new(),
            deploy_targets: Vec::new(),
            jobs: Jobs::default(),
            dev: None,
            build: None,
            focus: ProjectFocusConfig::default(),
            branch_rules: BranchRules::empty(),
            debug_profiles: Vec::new(),
        });

        save_config(&paths.projects, &config).map_err(|error| error.to_string())?;
        config_state.invalidate()?;
        load_project_config_editor_state(&paths.projects)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn delete_project_config(
    state: tauri::State<'_, AppState>,
    request: DeleteProjectConfigRequest,
) -> Result<ProjectConfigEditorState, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let mut config = load_config(&paths.projects).map_err(|error| error.to_string())?;
        let original_len = config.projects.len();
        config.projects.retain(|project| project.key != request.key);
        if config.projects.len() == original_len {
            return Err(format!("project {} not found", request.key));
        }

        save_config(&paths.projects, &config).map_err(|error| error.to_string())?;
        config_state.invalidate()?;
        load_project_config_editor_state(&paths.projects)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_project_deploy_target_basics(
    state: tauri::State<'_, AppState>,
    request: SaveProjectDeployTargetBasicsRequest,
) -> Result<ProjectConfigEditorState, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let mut config = load_config(&paths.projects).map_err(|error| error.to_string())?;
        let project = config
            .projects
            .iter_mut()
            .find(|project| project.key == request.project_key)
            .ok_or_else(|| format!("project {} not found", request.project_key))?;
        let target = project
            .deploy_targets
            .iter_mut()
            .find(|target| target.key == request.target_key)
            .ok_or_else(|| {
                format!(
                    "deploy target {} not found for project {}",
                    request.target_key, request.project_key
                )
            })?;

        let label = request.label.trim();
        let jenkins_profile = request.jenkins_profile.trim();
        let job_name = request.job_name.trim();
        if label.is_empty() {
            return Err("部署名称不能为空".to_string());
        }
        if jenkins_profile.is_empty() {
            return Err("Jenkins Profile 不能为空".to_string());
        }
        if job_name.is_empty() {
            return Err("Job Name 不能为空".to_string());
        }

        target.label = label.to_string();
        target.jenkins_profile = jenkins_profile.to_string();
        target.job_name = job_name.to_string();

        save_config(&paths.projects, &config).map_err(|error| error.to_string())?;
        config_state.invalidate()?;

        load_project_config_editor_state(&paths.projects)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_project_deploy_targets(
    state: tauri::State<'_, AppState>,
    request: SaveProjectDeployTargetsRequest,
) -> Result<ProjectConfigEditorState, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let mut config = load_config(&paths.projects).map_err(|error| error.to_string())?;
        let project = config
            .projects
            .iter_mut()
            .find(|project| project.key == request.project_key)
            .ok_or_else(|| format!("project {} not found", request.project_key))?;

        project.deploy_targets = deploy_targets_from_editor(request.deploy_targets)?;

        save_config(&paths.projects, &config).map_err(|error| error.to_string())?;
        config_state.invalidate()?;
        load_project_config_editor_state(&paths.projects)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_projects(state: tauri::State<'_, AppState>) -> Result<Vec<ProjectSummary>, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        Ok(project_summaries(&config))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_project_detail(
    state: tauri::State<'_, AppState>,
    project: String,
) -> Result<ProjectDetail, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        project_detail(&config, &project).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_project_branches(
    state: tauri::State<'_, AppState>,
    project: String,
) -> Result<Vec<rdevtool_core::core::BranchOption>, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        available_branch_options(&config, &project).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_default_branch(
    state: tauri::State<'_, AppState>,
    project: String,
) -> Result<String, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        branch_hint(&config, &project).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_branch_commit_overview(
    state: tauri::State<'_, AppState>,
    project: String,
    source_branch: String,
    target_branch: String,
) -> Result<BranchCommitOverview, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        branch_commit_overview(&config, &project, &source_branch, &target_branch)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_deploy_target_meta(
    state: tauri::State<'_, AppState>,
    project: String,
    target: Option<String>,
) -> Result<DeployTargetMeta, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        deploy_target_meta(&config, &project, target.as_deref()).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn build_deploy_plan(
    state: tauri::State<'_, AppState>,
    request: DeployRequest,
) -> Result<DeployPlan, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        build_plan(&config, &request).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn trigger_build(
    state: tauri::State<'_, AppState>,
    request: DeployRequest,
) -> Result<BuildTriggerResponse, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        trigger_deploy(&config, &request).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn refresh_build_status(
    state: tauri::State<'_, AppState>,
    request: StatusRequest,
) -> Result<BuildStatusResponse, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        refresh_deploy_status(&config, &request).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn execute_branch_merge(
    state: tauri::State<'_, AppState>,
    request: MergeRequest,
) -> Result<MergeResponse, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        execute_merge(&config, &request).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn execute_branch_sync_task(
    state: tauri::State<'_, AppState>,
    request: BranchSyncRequest,
) -> Result<BranchTaskResponse, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        execute_branch_sync(&config, &request).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn execute_branch_create_task(
    state: tauri::State<'_, AppState>,
    request: BranchCreateRequest,
) -> Result<BranchTaskResponse, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        execute_branch_create(&config, &request).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn checkout_branch_to_directory_task(
    state: tauri::State<'_, AppState>,
    request: BranchCheckoutRequest,
) -> Result<BranchTaskResponse, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        checkout_branch_to_directory(&config, &request).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn execute_branch_switch_task(
    state: tauri::State<'_, AppState>,
    request: BranchSwitchRequest,
) -> Result<BranchTaskResponse, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        execute_branch_switch(&config, &request).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_project_push_status(
    state: tauri::State<'_, AppState>,
    project: String,
) -> Result<BranchPushStatus, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        branch_push_status(&config, &project).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn execute_branch_push_task(
    state: tauri::State<'_, AppState>,
    request: BranchPushRequest,
) -> Result<BranchTaskResponse, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        execute_branch_push(&config, &request).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn open_local_path(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || open_path(PathBuf::from(path)))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn open_external_resource(kind: String, value: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let value = value.trim().to_string();
        if value.is_empty() {
            return Err("外部资源为空".to_string());
        }

        match kind.as_str() {
            "localPath" => open_path(PathBuf::from(value)),
            "url" => open_url(&value),
            _ => Err(format!("不支持的外部资源类型: {}", kind)),
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn load_page_navigation() -> Result<NavigationData, String> {
    tauri::async_runtime::spawn_blocking(move || {
        load_navigation_data().map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_navigation_editor() -> Result<NavigationEditorData, String> {
    tauri::async_runtime::spawn_blocking(move || {
        load_navigation_editor_data().map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_navigation_editor(data: NavigationEditorData) -> Result<NavigationData, String> {
    tauri::async_runtime::spawn_blocking(move || {
        save_navigation_editor_data(data).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn open_page_navigation_entry(
    app: AppHandle,
    entry: NavigationEntry,
) -> Result<NavigationOpenResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let result = open_navigation_entry(&entry).map_err(|error| error.to_string())?;
        let action = tray_action_for_navigation_entry(&entry);
        if let Err(error) = record_tray_replay_action(&app, action) {
            eprintln!("failed to record tray action: {}", error);
        }
        Ok(result)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_web_actions(
    scope: Option<String>,
    url: Option<String>,
) -> Result<WebActionListResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        core_list_web_actions(scope.as_deref(), url.as_deref()).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn open_web_action_target(url: String) -> Result<WebActionTarget, String> {
    tauri::async_runtime::spawn_blocking(move || {
        core_open_web_action_target(&url).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_web_action_targets() -> Result<Vec<WebActionTarget>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        core_list_web_action_targets().map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn run_web_action(request: WebActionRunRequest) -> Result<WebActionRunResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        core_run_web_action(request).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn run_web_action_script(
    request: WebActionScriptRunRequest,
) -> Result<WebActionRunResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        core_run_web_action_script(request).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn storage_get_json(
    state: tauri::State<'_, AppState>,
    namespace: String,
    key: String,
) -> Result<Option<serde_json::Value>, String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || storage.get_json(&namespace, &key))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn storage_set_json(
    state: tauri::State<'_, AppState>,
    namespace: String,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || storage.set_json(&namespace, &key, &value))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn storage_delete_json(
    state: tauri::State<'_, AppState>,
    namespace: String,
    key: String,
) -> Result<(), String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || storage.delete_json(&namespace, &key))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_tray_pinned_actions(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<TrayReplayAction>, String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || Ok(tray_pinned_actions(&storage)))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn set_tray_pinned_actions(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    actions: Vec<TrayReplayAction>,
) -> Result<(), String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let normalized = normalize_tray_pinned_actions(actions);
        save_tray_pinned_actions(&storage, &normalized)?;
        refresh_tray_menu(&app);
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_deploy_history(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DeployHistoryEntry>, String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || storage.list_deploy_history())
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_deploy_history(
    state: tauri::State<'_, AppState>,
    request: SaveDeployHistoryRequest,
) -> Result<(), String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || storage.save_deploy_history(request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn clear_deploy_history(state: tauri::State<'_, AppState>) -> Result<usize, String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || storage.clear_deploy_history())
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_merge_history(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<MergeHistoryEntry>, String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || storage.list_merge_history())
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_merge_history(
    state: tauri::State<'_, AppState>,
    request: SaveMergeHistoryRequest,
) -> Result<(), String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || storage.save_merge_history(request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn clear_merge_history(state: tauri::State<'_, AppState>) -> Result<usize, String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || storage.clear_merge_history())
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_project_runtimes(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ProjectRuntimeSnapshot>, String> {
    let runtime = state.project_runtime.clone();
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        runtime.list(&config)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_selected_project_runtimes(
    state: tauri::State<'_, AppState>,
    projects: Vec<String>,
) -> Result<Vec<ProjectRuntimeSnapshot>, String> {
    let runtime = state.project_runtime.clone();
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        runtime.list_selected(&config, &projects)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn start_project_runtime(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    project: String,
    debug_profile: Option<String>,
    env_overrides: Option<BTreeMap<String, String>>,
) -> Result<ProjectRuntimeSnapshot, String> {
    let runtime = state.project_runtime.clone();
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        let debug_profile_key = optional_editor_string(debug_profile);
        let explicit_env_overrides = env_overrides.is_some();
        let env_overrides = normalize_runtime_env_overrides(env_overrides);
        let mut updated = runtime.start(
            &config,
            &project,
            debug_profile_key.as_deref(),
            if explicit_env_overrides {
                Some(&env_overrides)
            } else {
                None
            },
        )?;
        if should_auto_focus_project(&config, &project, &updated) {
            match runtime.focus_runtime(&config, &project) {
                Ok(next_snapshot) => {
                    updated = next_snapshot;
                }
                Err(error) => {
                    eprintln!("failed to auto focus project after start: {}", error);
                }
            }
        }
        let mut action = tray_action_for_project(
            "project.runtime.start",
            format!("启动 {} dev", updated.name),
            updated.command.clone(),
            project.clone(),
        );
        if let Some(profile_key) = debug_profile_key.as_ref() {
            action.detail = Some(match action.detail.as_ref() {
                Some(detail) => format!("{} · {}", detail, profile_key),
                None => format!("调试档案 {}", profile_key),
            });
            action.dedupe_key = format!("project.runtime.start:{}:{}", project, profile_key);
            action.payload = Some(json!({ "debugProfile": profile_key }));
        }
        if explicit_env_overrides {
            let env_detail = if env_overrides.is_empty() {
                "自定义启动 env".to_string()
            } else {
                format!("临时参数 {} 项", env_overrides.len())
            };
            action.detail = Some(match action.detail.as_ref() {
                Some(detail) => format!("{} · {}", detail, env_detail),
                None => env_detail,
            });
            action.dedupe_key = format!(
                "project.runtime.start:{}:{}:{}",
                project,
                debug_profile_key.as_deref().unwrap_or("default"),
                stable_runtime_env_key(&env_overrides)
            );
            action.payload = Some(json!({
                "debugProfile": debug_profile_key,
                "envOverrides": env_overrides,
            }));
        }
        if let Err(error) = record_tray_replay_action(&app, action) {
            eprintln!("failed to record tray action: {}", error);
        }
        Ok(updated)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn should_auto_focus_project(
    config: &AppConfig,
    project_key: &str,
    snapshot: &ProjectRuntimeSnapshot,
) -> bool {
    snapshot.status_key == "running"
        && snapshot.can_focus_runtime
        && config
            .find_project(project_key)
            .map(|project| project.focus.auto_on_start)
            .unwrap_or(false)
}

fn normalize_runtime_env_overrides(
    env_overrides: Option<BTreeMap<String, String>>,
) -> BTreeMap<String, String> {
    env_overrides
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(key, value)| {
            let key = key.trim().to_string();
            if key.is_empty() {
                None
            } else {
                Some((key, value))
            }
        })
        .collect()
}

fn stable_runtime_env_key(values: &BTreeMap<String, String>) -> String {
    values
        .iter()
        .map(|(key, value)| format!("{}={}", key, value))
        .collect::<Vec<_>>()
        .join("&")
}

#[tauri::command]
async fn stop_project_runtime(
    state: tauri::State<'_, AppState>,
    project: String,
) -> Result<ProjectRuntimeSnapshot, String> {
    let runtime = state.project_runtime.clone();
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        runtime.stop(&config, &project)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn run_project_build(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    project: String,
) -> Result<ProjectRuntimeSnapshot, String> {
    let runtime = state.project_runtime.clone();
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        let updated = runtime.run_build(&config, &project)?;
        let action = tray_action_for_project(
            "project.build.run",
            format!("构建 {}", updated.name),
            updated.build_command.clone(),
            project,
        );
        if let Err(error) = record_tray_replay_action(&app, action) {
            eprintln!("failed to record tray action: {}", error);
        }
        Ok(updated)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn stop_project_build(
    state: tauri::State<'_, AppState>,
    project: String,
) -> Result<ProjectRuntimeSnapshot, String> {
    let runtime = state.project_runtime.clone();
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        runtime.stop_build(&config, &project)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn open_project_build_output(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    project: String,
) -> Result<ProjectRuntimeSnapshot, String> {
    let runtime = state.project_runtime.clone();
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        let updated = runtime.open_build_output(&config, &project)?;
        let action = tray_action_for_project(
            "project.build.openOutput",
            format!("打开 {} 产物", updated.name),
            updated.build_output_dir.clone(),
            project,
        );
        if let Err(error) = record_tray_replay_action(&app, action) {
            eprintln!("failed to record tray action: {}", error);
        }
        Ok(updated)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn open_project_directory(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    project: String,
) -> Result<ProjectRuntimeSnapshot, String> {
    let runtime = state.project_runtime.clone();
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        let updated = open_project_directory_action(&runtime, &config, &project)?;
        let action = tray_action_for_project(
            "project.openDirectory",
            format!("打开 {} 目录", updated.name),
            updated.cwd.clone().or(updated.repo_path.clone()),
            project,
        );
        if let Err(error) = record_tray_replay_action(&app, action) {
            eprintln!("failed to record tray action: {}", error);
        }
        Ok(updated)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn focus_project_runtime(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    project: String,
) -> Result<ProjectRuntimeSnapshot, String> {
    let runtime = state.project_runtime.clone();
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        let updated = runtime.focus_runtime(&config, &project)?;
        let action = tray_action_for_project(
            "project.runtime.focus",
            format!("聚焦 {}", updated.name),
            Some(updated.detail.clone()),
            project,
        );
        if let Err(error) = record_tray_replay_action(&app, action) {
            eprintln!("failed to record tray action: {}", error);
        }
        Ok(updated)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn read_project_runtime_log(
    state: tauri::State<'_, AppState>,
    project: String,
    kind: ProjectRuntimeLogKind,
    max_lines: usize,
) -> Result<ProjectRuntimeLogResponse, String> {
    let runtime = state.project_runtime.clone();
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        runtime.read_log(&config, &project, kind, max_lines)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn open_path(path: PathBuf) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(&path);
        command
    };

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(&path);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.arg("/C").arg("start").arg("").arg(&path);
        command
    };

    let status = command
        .status()
        .map_err(|error| format!("打开路径失败: {}", error))?;
    if !status.success() {
        return Err(format!("打开路径失败，退出码 {:?}", status.code()));
    }

    Ok(())
}

fn open_url(url: &str) -> Result<(), String> {
    let normalized = url.trim();
    let lower = normalized.to_ascii_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return Err("仅支持打开 http/https 地址".to_string());
    }

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(normalized);
        command
    };

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(normalized);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.arg("/C").arg("start").arg("").arg(normalized);
        command
    };

    let status = command
        .status()
        .map_err(|error| format!("打开地址失败: {}", error))?;
    if !status.success() {
        return Err(format!("打开地址失败，退出码 {:?}", status.code()));
    }

    Ok(())
}

fn show_main_window<R: tauri::Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };

    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn tray_action_for_project(
    kind: &str,
    label: String,
    detail: Option<String>,
    project_key: String,
) -> TrayReplayAction {
    TrayReplayAction {
        kind: kind.to_string(),
        label,
        detail,
        dedupe_key: format!("{}:{}", kind, project_key),
        project_key: Some(project_key),
        entry: None,
        payload: None,
        updated_at_ms: unix_time_ms(),
    }
}

fn tray_action_for_navigation_entry(entry: &NavigationEntry) -> TrayReplayAction {
    let dedupe_key = [
        "finder.shortcut.open",
        entry.kind.as_str(),
        entry.name.as_str(),
        entry.target_label.as_str(),
    ]
    .join(":");

    TrayReplayAction {
        kind: "finder.shortcut.open".to_string(),
        label: format!("打开 {}", entry.name),
        detail: Some(entry.target_label.clone()),
        project_key: None,
        entry: Some(entry.clone()),
        payload: None,
        dedupe_key,
        updated_at_ms: unix_time_ms(),
    }
}

fn tray_recent_actions(storage: &Storage) -> Vec<TrayReplayAction> {
    storage
        .get_json(TRAY_STORAGE_NAMESPACE, TRAY_RECENT_STORAGE_KEY)
        .ok()
        .flatten()
        .and_then(|value| serde_json::from_value::<Vec<TrayReplayAction>>(value).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(valid_tray_action)
        .take(TRAY_RECENT_LIMIT)
        .collect()
}

fn save_tray_recent_actions(storage: &Storage, actions: &[TrayReplayAction]) -> Result<(), String> {
    let value = serde_json::to_value(actions).map_err(|error| error.to_string())?;
    storage.set_json(TRAY_STORAGE_NAMESPACE, TRAY_RECENT_STORAGE_KEY, &value)
}

fn valid_tray_action(action: &TrayReplayAction) -> bool {
    !action.kind.trim().is_empty()
        && !action.label.trim().is_empty()
        && !action.dedupe_key.trim().is_empty()
}

fn tray_pinned_actions(storage: &Storage) -> Vec<TrayReplayAction> {
    storage
        .get_json(TRAY_STORAGE_NAMESPACE, TRAY_PINNED_STORAGE_KEY)
        .ok()
        .flatten()
        .and_then(|value| serde_json::from_value::<Vec<TrayReplayAction>>(value).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(valid_tray_action)
        .take(TRAY_PINNED_LIMIT)
        .collect()
}

fn normalize_tray_pinned_actions(mut actions: Vec<TrayReplayAction>) -> Vec<TrayReplayAction> {
    let mut normalized = Vec::new();
    for mut action in actions.drain(..) {
        if !valid_tray_action(&action) {
            continue;
        }
        if action.updated_at_ms == 0 {
            action.updated_at_ms = unix_time_ms();
        }
        if normalized
            .iter()
            .any(|item: &TrayReplayAction| item.dedupe_key == action.dedupe_key)
        {
            continue;
        }
        normalized.push(action);
        if normalized.len() >= TRAY_PINNED_LIMIT {
            break;
        }
    }
    normalized
}

fn save_tray_pinned_actions(storage: &Storage, actions: &[TrayReplayAction]) -> Result<(), String> {
    let value = serde_json::to_value(actions).map_err(|error| error.to_string())?;
    storage.set_json(TRAY_STORAGE_NAMESPACE, TRAY_PINNED_STORAGE_KEY, &value)
}

fn record_tray_replay_action<R: Runtime>(
    app: &AppHandle<R>,
    mut action: TrayReplayAction,
) -> Result<(), String> {
    let Some(state) = app.try_state::<AppState>() else {
        return Ok(());
    };

    action.updated_at_ms = unix_time_ms();
    let mut actions = tray_recent_actions(&state.storage);
    actions.retain(|item| item.dedupe_key != action.dedupe_key);
    actions.insert(0, action);
    actions.truncate(TRAY_RECENT_LIMIT);
    save_tray_recent_actions(&state.storage, &actions)?;
    refresh_tray_menu(app);
    Ok(())
}

fn truncate_menu_label(value: &str) -> String {
    const MAX_CHARS: usize = 28;
    let mut chars = value.trim().chars();
    let mut output = String::new();
    for _ in 0..MAX_CHARS {
        let Some(next) = chars.next() else {
            return output;
        };
        output.push(next);
    }
    if chars.next().is_some() {
        output.push('…');
    }
    output
}

fn create_tray_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let (recent_actions, pinned_actions) = app
        .try_state::<AppState>()
        .map(|state| {
            (
                tray_recent_actions(&state.storage),
                tray_pinned_actions(&state.storage),
            )
        })
        .unwrap_or_default();

    let show_item = MenuItem::with_id(app, TRAY_SHOW_ID, "打开 rDevTool", true, None::<&str>)?;
    let replay_last_item = MenuItem::with_id(
        app,
        TRAY_REPLAY_LAST_ID,
        recent_actions
            .first()
            .map(|action| format!("重复上次操作：{}", truncate_menu_label(&action.label)))
            .unwrap_or_else(|| "重复上次操作".to_string()),
        !recent_actions.is_empty(),
        None::<&str>,
    )?;

    let pinned_menu_items = if pinned_actions.is_empty() {
        vec![MenuItem::with_id(
            app,
            "tray_pinned_empty",
            "暂无置顶操作",
            false,
            None::<&str>,
        )?]
    } else {
        pinned_actions
            .iter()
            .take(TRAY_PINNED_LIMIT)
            .enumerate()
            .map(|(index, action)| {
                MenuItem::with_id(
                    app,
                    format!("{}{}", TRAY_PINNED_PREFIX, index),
                    truncate_menu_label(&action.label),
                    true,
                    None::<&str>,
                )
            })
            .collect::<tauri::Result<Vec<_>>>()?
    };
    let pinned_menu_refs = pinned_menu_items
        .iter()
        .map(|item| item as &dyn IsMenuItem<R>)
        .collect::<Vec<_>>();
    let pinned_submenu = Submenu::with_id_and_items(
        app,
        TRAY_PINNED_SUBMENU_ID,
        "置顶操作",
        true,
        &pinned_menu_refs,
    )?;

    let separator_top = PredefinedMenuItem::separator(app)?;
    let separator_bottom = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, TRAY_QUIT_ID, "退出", true, None::<&str>)?;
    Menu::with_items(
        app,
        &[
            &show_item,
            &replay_last_item,
            &separator_top,
            &pinned_submenu,
            &separator_bottom,
            &quit_item,
        ],
    )
}

fn refresh_tray_menu<R: Runtime>(app: &AppHandle<R>) {
    if !should_use_tray() {
        return;
    }
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    match create_tray_menu(app).and_then(|menu| tray.set_menu(Some(menu))) {
        Ok(()) => {}
        Err(error) => eprintln!("failed to refresh tray menu: {}", error),
    }
}

fn open_project_directory_action(
    runtime: &ProjectRuntimeState,
    config: &AppConfig,
    project_key: &str,
) -> Result<ProjectRuntimeSnapshot, String> {
    let snapshots = runtime.list_selected(config, &[project_key.to_string()])?;
    let snapshot = snapshots
        .into_iter()
        .next()
        .ok_or_else(|| format!("未找到项目: {}", project_key))?;
    let path = snapshot
        .cwd
        .clone()
        .or_else(|| snapshot.repo_path.clone())
        .ok_or_else(|| "当前项目未配置目录".to_string())?;
    open_path(PathBuf::from(path))?;
    Ok(snapshot)
}

fn tray_payload(action: &TrayReplayAction, label: &str) -> Result<serde_json::Value, String> {
    action
        .payload
        .clone()
        .ok_or_else(|| format!("缺少{}回放参数", label))
}

fn execute_deploy_tray_replay(config: &AppConfig, action: &TrayReplayAction) -> Result<(), String> {
    let request: DeployRequest = serde_json::from_value(tray_payload(action, "部署")?)
        .map_err(|error| format!("部署回放参数无效: {}", error))?;
    trigger_deploy(config, &request).map_err(|error| error.to_string())?;
    Ok(())
}

fn execute_branch_tray_replay(config: &AppConfig, action: &TrayReplayAction) -> Result<(), String> {
    let payload: TrayBranchReplayPayload = serde_json::from_value(tray_payload(action, "分支")?)
        .map_err(|error| format!("分支回放参数无效: {}", error))?;

    match payload.command.as_str() {
        "execute_branch_sync_task" => {
            let request: BranchSyncRequest = serde_json::from_value(payload.request)
                .map_err(|error| format!("分支同步参数无效: {}", error))?;
            execute_branch_sync(config, &request).map_err(|error| error.to_string())?;
        }
        "execute_branch_create_task" => {
            let request: BranchCreateRequest = serde_json::from_value(payload.request)
                .map_err(|error| format!("创建分支参数无效: {}", error))?;
            execute_branch_create(config, &request).map_err(|error| error.to_string())?;
        }
        "checkout_branch_to_directory_task" => {
            let request: BranchCheckoutRequest = serde_json::from_value(payload.request)
                .map_err(|error| format!("检出分支参数无效: {}", error))?;
            checkout_branch_to_directory(config, &request).map_err(|error| error.to_string())?;
        }
        "execute_branch_switch_task" => {
            let request: BranchSwitchRequest = serde_json::from_value(payload.request)
                .map_err(|error| format!("切换分支参数无效: {}", error))?;
            execute_branch_switch(config, &request).map_err(|error| error.to_string())?;
        }
        "execute_branch_push_task" => {
            let request: BranchPushRequest = serde_json::from_value(payload.request)
                .map_err(|error| format!("推送分支参数无效: {}", error))?;
            execute_branch_push(config, &request).map_err(|error| error.to_string())?;
        }
        _ => return Err(format!("不支持回放的分支操作: {}", payload.command)),
    }

    Ok(())
}

fn execute_tray_replay_action<R: Runtime>(
    app: &AppHandle<R>,
    action: &TrayReplayAction,
) -> Result<(), String> {
    let Some(state) = app.try_state::<AppState>() else {
        return Err("应用状态尚未就绪".to_string());
    };

    match action.kind.as_str() {
        "project.runtime.start" => {
            let project_key = action
                .project_key
                .as_deref()
                .ok_or_else(|| "缺少项目 Key".to_string())?;
            let config = state.config_state.load()?;
            let debug_profile = action
                .payload
                .as_ref()
                .and_then(|payload| payload.get("debugProfile"))
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let env_overrides = action
                .payload
                .as_ref()
                .and_then(|payload| payload.get("envOverrides"))
                .and_then(|value| {
                    serde_json::from_value::<BTreeMap<String, String>>(value.clone()).ok()
                });
            let explicit_env_overrides = env_overrides.is_some();
            let env_overrides = normalize_runtime_env_overrides(env_overrides);
            state.project_runtime.start(
                &config,
                project_key,
                debug_profile,
                if explicit_env_overrides {
                    Some(&env_overrides)
                } else {
                    None
                },
            )?;
        }
        "project.build.run" => {
            let project_key = action
                .project_key
                .as_deref()
                .ok_or_else(|| "缺少项目 Key".to_string())?;
            let config = state.config_state.load()?;
            state.project_runtime.run_build(&config, project_key)?;
        }
        "project.build.openOutput" => {
            let project_key = action
                .project_key
                .as_deref()
                .ok_or_else(|| "缺少项目 Key".to_string())?;
            let config = state.config_state.load()?;
            state
                .project_runtime
                .open_build_output(&config, project_key)?;
        }
        "project.runtime.focus" => {
            let project_key = action
                .project_key
                .as_deref()
                .ok_or_else(|| "缺少项目 Key".to_string())?;
            let config = state.config_state.load()?;
            state.project_runtime.focus_runtime(&config, project_key)?;
        }
        "project.openDirectory" => {
            let project_key = action
                .project_key
                .as_deref()
                .ok_or_else(|| "缺少项目 Key".to_string())?;
            let config = state.config_state.load()?;
            open_project_directory_action(&state.project_runtime, &config, project_key)?;
        }
        "finder.shortcut.open" => {
            let entry = action
                .entry
                .clone()
                .ok_or_else(|| "缺少快捷入口".to_string())?;
            open_navigation_entry(&entry).map_err(|error| error.to_string())?;
        }
        "deploy.replay" => {
            let config = state.config_state.load()?;
            execute_deploy_tray_replay(&config, action)?;
        }
        "branch.replay" => {
            let config = state.config_state.load()?;
            execute_branch_tray_replay(&config, action)?;
        }
        _ => return Err(format!("不支持回放的操作: {}", action.kind)),
    }
    record_tray_replay_action(app, action.clone())?;
    Ok(())
}

fn spawn_tray_replay<R: Runtime>(app: AppHandle<R>, action: TrayReplayAction) {
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = execute_tray_replay_action(&app, &action) {
            eprintln!("tray replay failed: {}", error);
            show_main_window(&app);
        }
    });
}

fn tray_action_by_index<R: Runtime>(app: &AppHandle<R>, index: usize) -> Option<TrayReplayAction> {
    app.try_state::<AppState>()
        .map(|state| tray_recent_actions(&state.storage))
        .and_then(|actions| actions.into_iter().nth(index))
}

fn tray_pinned_action_by_index<R: Runtime>(
    app: &AppHandle<R>,
    index: usize,
) -> Option<TrayReplayAction> {
    app.try_state::<AppState>()
        .map(|state| tray_pinned_actions(&state.storage))
        .and_then(|actions| actions.into_iter().nth(index))
}

fn build_tray<R: tauri::Runtime>(
    app: &AppHandle<R>,
    is_quitting: Arc<AtomicBool>,
) -> tauri::Result<()> {
    let menu = create_tray_menu(app)?;

    let mut tray_builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("rDevTool")
        .show_menu_on_left_click(false)
        .on_menu_event({
            let is_quitting = is_quitting.clone();
            move |app, event| match event.id().as_ref() {
                TRAY_SHOW_ID => show_main_window(app),
                TRAY_REPLAY_LAST_ID => {
                    if let Some(action) = tray_action_by_index(app, 0) {
                        spawn_tray_replay(app.clone(), action);
                    }
                }
                TRAY_QUIT_ID => {
                    is_quitting.store(true, Ordering::Relaxed);
                    app.exit(0);
                }
                id if id.starts_with(TRAY_PINNED_PREFIX) => {
                    let index = id
                        .trim_start_matches(TRAY_PINNED_PREFIX)
                        .parse::<usize>()
                        .ok();
                    if let Some(action) =
                        index.and_then(|value| tray_pinned_action_by_index(app, value))
                    {
                        spawn_tray_replay(app.clone(), action);
                    }
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app
        .default_window_icon()
        .cloned()
        .map(|icon| create_monochrome_tray_icon(icon.to_owned()))
    {
        tray_builder = tray_builder.icon(icon);
    }

    let _ = tray_builder.build(app)?;
    Ok(())
}

fn create_monochrome_tray_icon(icon: Image<'static>) -> Image<'static> {
    let threshold = 188.0f32;
    let rgba = icon.rgba();
    let mut out = Vec::with_capacity(rgba.len());

    for chunk in rgba.chunks_exact(4) {
        let alpha = chunk[3] as f32 / 255.0;
        if alpha <= 0.0 {
            out.extend_from_slice(&[0, 0, 0, 0]);
            continue;
        }

        let luminance =
            0.2126 * chunk[0] as f32 + 0.7152 * chunk[1] as f32 + 0.0722 * chunk[2] as f32;
        if luminance <= threshold {
            out.extend_from_slice(&[0, 0, 0, 0]);
            continue;
        }

        let whiteness = ((luminance - threshold) / (255.0 - threshold)).clamp(0.0, 1.0);
        let tray_alpha = (alpha * whiteness * 255.0).round() as u8;
        out.extend_from_slice(&[255, 255, 255, tray_alpha]);
    }

    Image::new_owned(out, icon.width(), icon.height())
}

pub fn run() {
    let is_quitting = Arc::new(AtomicBool::new(false));
    let tray_quitting = is_quitting.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(&app);
        }))
        .on_window_event({
            let is_quitting = is_quitting.clone();
            move |window, event| {
                if window.label() != MAIN_WINDOW_LABEL {
                    return;
                }

                if let WindowEvent::CloseRequested { api, .. } = event {
                    if is_quitting.load(Ordering::Relaxed) {
                        return;
                    }

                    if should_use_tray() {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .setup(move |app| {
            let storage = Storage::new_default().map_err(std::io::Error::other)?;
            app.manage(AppState {
                storage,
                project_runtime: ProjectRuntimeState::default(),
                config_state: AppConfigState::default(),
            });
            if should_use_tray() {
                build_tray(app.handle(), tray_quitting.clone()).map_err(std::io::Error::other)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            get_workspace_app_preferences,
            save_workspace_app_preferences,
            get_project_config_editor,
            save_default_branch_rules,
            save_project_config_basics,
            add_project_config,
            delete_project_config,
            save_project_deploy_target_basics,
            save_project_deploy_targets,
            list_projects,
            get_project_detail,
            get_project_branches,
            get_default_branch,
            get_branch_commit_overview,
            get_deploy_target_meta,
            build_deploy_plan,
            trigger_build,
            refresh_build_status,
            execute_branch_merge,
            execute_branch_sync_task,
            execute_branch_create_task,
            checkout_branch_to_directory_task,
            execute_branch_switch_task,
            get_project_push_status,
            execute_branch_push_task,
            open_local_path,
            open_external_resource,
            load_page_navigation,
            get_navigation_editor,
            save_navigation_editor,
            open_page_navigation_entry,
            list_web_actions,
            open_web_action_target,
            list_web_action_targets,
            run_web_action,
            run_web_action_script,
            storage_get_json,
            storage_set_json,
            storage_delete_json,
            get_tray_pinned_actions,
            set_tray_pinned_actions,
            list_deploy_history,
            save_deploy_history,
            clear_deploy_history,
            list_merge_history,
            save_merge_history,
            clear_merge_history,
            list_project_runtimes,
            list_selected_project_runtimes,
            start_project_runtime,
            stop_project_runtime,
            run_project_build,
            stop_project_build,
            open_project_build_output,
            open_project_directory,
            focus_project_runtime,
            read_project_runtime_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
