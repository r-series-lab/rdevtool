use project_runtime::{
    ProjectRuntimeLogKind, ProjectRuntimeLogResponse, ProjectRuntimeSnapshot, ProjectRuntimeState,
};
use rdevtool_core::config::{
    AppConfig, BranchRules, DeployParamConfig, DeployParamKind, DeployTargetConfig, Jobs,
    ProjectAuthHelperConfig, ProjectAuthHelperItemConfig, ProjectCommandConfig, ProjectConfig,
    ProjectDebugLocalFileConfig, ProjectDebugProfileConfig, ProjectFocusConfig,
    ProjectLocalProxyConfig, ProjectLocalProxyRouteConfig, ProjectNetworkProxyConfig,
    RuntimeProfileConfig, default_config_dir, default_projects_path, default_workspace_path,
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
    load_navigation_data, load_navigation_editor_data, navigation_file_path,
    open_navigation_entry_with_runtime_profiles, save_navigation_editor_data,
};
use rdevtool_core::storage::{
    DeployHistoryEntry, MergeHistoryEntry, SaveDeployHistoryRequest, SaveMergeHistoryRequest,
    Storage, default_storage_path,
};
use rdevtool_core::web_actions::{
    WebActionListResponse, WebActionRunRequest, WebActionRunResult, WebActionScriptRunRequest,
    WebActionTarget, list_web_action_navigation_targets as core_list_web_action_navigation_targets,
    list_web_action_targets as core_list_web_action_targets,
    list_web_actions as core_list_web_actions,
    open_web_action_navigation_target as core_open_web_action_navigation_target,
    open_web_action_target as core_open_web_action_target, run_web_action as core_run_web_action,
    run_web_action_navigation as core_run_web_action_navigation,
    run_web_action_navigation_script as core_run_web_action_navigation_script,
    run_web_action_script as core_run_web_action_script,
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
    menu::{IconMenuItem, IsMenuItem, Menu, MenuItem, NativeIcon, PredefinedMenuItem, Submenu},
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
    runtime_profiles: Vec<RuntimeProfileEditor>,
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
    #[serde(default)]
    runtime_profile: Option<String>,
    env_text: String,
    local_files: Vec<ProjectDebugLocalFileEditor>,
    browser: Option<String>,
    browser_profile: Option<String>,
    #[serde(default)]
    browser_user_data_dir: Option<String>,
    #[serde(default)]
    browser_args_text: String,
    #[serde(default)]
    network_proxy: ProjectNetworkProxyEditor,
    #[serde(default)]
    local_proxy: ProjectLocalProxyEditor,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct RuntimeProfileEditor {
    key: String,
    label: String,
    browser: Option<String>,
    browser_profile: Option<String>,
    #[serde(default)]
    browser_user_data_dir: Option<String>,
    #[serde(default)]
    web_actions_enabled: bool,
    #[serde(default = "default_web_actions_port")]
    web_actions_port: u16,
    #[serde(default)]
    web_actions_user_data_dir: Option<String>,
    #[serde(default)]
    browser_args_text: String,
    #[serde(default)]
    proxy_url: String,
    #[serde(default)]
    proxy_bypass: String,
    #[serde(default)]
    host_resolver_rules_text: String,
    #[serde(default)]
    network_proxy: ProjectNetworkProxyEditor,
}

fn default_web_actions_port() -> u16 {
    9223
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectNetworkProxyEditor {
    enabled: bool,
    proxy_url: String,
    inject_env: bool,
    node_hook: bool,
    no_proxy: String,
}

impl Default for ProjectNetworkProxyEditor {
    fn default() -> Self {
        Self {
            enabled: false,
            proxy_url: String::new(),
            inject_env: true,
            node_hook: false,
            no_proxy: "localhost,127.0.0.1,::1".to_string(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectLocalProxyEditor {
    enabled: bool,
    listen: String,
    frontend_url: String,
    upstream_proxy: String,
    routes: Vec<ProjectLocalProxyRouteEditor>,
    auth_helper: ProjectAuthHelperEditor,
}

impl Default for ProjectLocalProxyEditor {
    fn default() -> Self {
        Self {
            enabled: false,
            listen: "127.0.0.1:3000".to_string(),
            frontend_url: String::new(),
            upstream_proxy: String::new(),
            routes: Vec::new(),
            auth_helper: ProjectAuthHelperEditor::default(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectLocalProxyRouteEditor {
    enabled: bool,
    match_prefix: String,
    target: String,
    rewrite_prefix: String,
    headers_text: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectAuthHelperEditor {
    enabled: bool,
    path: String,
    redirect_path: String,
    items: Vec<ProjectAuthHelperItemEditor>,
}

impl Default for ProjectAuthHelperEditor {
    fn default() -> Self {
        Self {
            enabled: false,
            path: "/__auth-helper".to_string(),
            redirect_path: "/#/".to_string(),
            items: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectAuthHelperItemEditor {
    enabled: bool,
    storage: String,
    key: String,
    from_json_path: String,
    value: String,
    cookie_path: String,
    cookie_max_age_seconds: Option<i64>,
    cookie_same_site: String,
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
struct SaveRuntimeProfilesRequest {
    runtime_profiles: Vec<RuntimeProfileEditor>,
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

fn network_proxy_to_editor(proxy: &ProjectNetworkProxyConfig) -> ProjectNetworkProxyEditor {
    ProjectNetworkProxyEditor {
        enabled: proxy.enabled,
        proxy_url: proxy.proxy_url.clone(),
        inject_env: proxy.inject_env,
        node_hook: proxy.node_hook,
        no_proxy: proxy.no_proxy.clone(),
    }
}

fn network_proxy_from_editor(
    profile_key: &str,
    editor: ProjectNetworkProxyEditor,
) -> Result<ProjectNetworkProxyConfig, String> {
    let proxy_url = editor.proxy_url.trim().to_string();
    let no_proxy = {
        let value = editor.no_proxy.trim();
        if value.is_empty() {
            "localhost,127.0.0.1,::1".to_string()
        } else {
            value.to_string()
        }
    };

    if editor.enabled {
        if proxy_url.is_empty() {
            return Err(format!("调试档案 {} 的代理地址不能为空", profile_key));
        }
        let supported = ["http://", "https://", "socks5://", "socks5h://"]
            .iter()
            .any(|prefix| proxy_url.to_lowercase().starts_with(prefix));
        if !supported {
            return Err(format!(
                "调试档案 {} 的代理地址需要以 http://、https://、socks5:// 或 socks5h:// 开头",
                profile_key
            ));
        }
        if editor.node_hook && !proxy_url.to_lowercase().starts_with("http://") {
            return Err(format!(
                "调试档案 {} 的 Node Hook 当前只支持 http:// 代理",
                profile_key
            ));
        }
    }

    Ok(ProjectNetworkProxyConfig {
        enabled: editor.enabled,
        proxy_url,
        inject_env: editor.inject_env,
        node_hook: editor.node_hook,
        no_proxy,
    })
}

fn local_proxy_to_editor(proxy: &ProjectLocalProxyConfig) -> ProjectLocalProxyEditor {
    ProjectLocalProxyEditor {
        enabled: proxy.enabled,
        listen: proxy.listen.clone(),
        frontend_url: proxy.frontend_url.clone(),
        upstream_proxy: proxy.upstream_proxy.clone(),
        routes: proxy
            .routes
            .iter()
            .map(|route| ProjectLocalProxyRouteEditor {
                enabled: route.enabled,
                match_prefix: route.match_prefix.clone(),
                target: route.target.clone(),
                rewrite_prefix: route.rewrite_prefix.clone(),
                headers_text: env_map_to_editor_text(&route.headers),
            })
            .collect(),
        auth_helper: auth_helper_to_editor(&proxy.auth_helper),
    }
}

fn auth_helper_to_editor(helper: &ProjectAuthHelperConfig) -> ProjectAuthHelperEditor {
    ProjectAuthHelperEditor {
        enabled: helper.enabled,
        path: helper.path.clone(),
        redirect_path: helper.redirect_path.clone(),
        items: helper
            .items
            .iter()
            .map(|item| ProjectAuthHelperItemEditor {
                enabled: item.enabled,
                storage: item.storage.clone(),
                key: item.key.clone(),
                from_json_path: item.from_json_path.clone(),
                value: item.value.clone(),
                cookie_path: item.cookie_path.clone(),
                cookie_max_age_seconds: item.cookie_max_age_seconds,
                cookie_same_site: item.cookie_same_site.clone(),
            })
            .collect(),
    }
}

fn local_proxy_from_editor(
    profile_key: &str,
    editor: ProjectLocalProxyEditor,
) -> Result<ProjectLocalProxyConfig, String> {
    let listen = editor.listen.trim().to_string();
    let frontend_url = editor.frontend_url.trim().to_string();
    let upstream_proxy = editor.upstream_proxy.trim().to_string();

    if editor.enabled {
        if listen.is_empty() || !listen.contains(':') {
            return Err(format!(
                "调试档案 {} 的本地代理监听地址需要形如 127.0.0.1:3000",
                profile_key
            ));
        }
        if frontend_url.is_empty() {
            return Err(format!("调试档案 {} 的前端地址不能为空", profile_key));
        }
        if !is_http_url(&frontend_url) {
            return Err(format!(
                "调试档案 {} 的前端地址需要以 http:// 或 https:// 开头",
                profile_key
            ));
        }
        if !upstream_proxy.is_empty() && !upstream_proxy.to_lowercase().starts_with("http://") {
            return Err(format!(
                "调试档案 {} 的上游代理当前只支持 http://",
                profile_key
            ));
        }
    }

    let routes = editor
        .routes
        .into_iter()
        .filter_map(|route| {
            let match_prefix = route.match_prefix.trim().to_string();
            let target = route.target.trim().to_string();
            if match_prefix.is_empty() && target.is_empty() {
                None
            } else {
                Some((match_prefix, target, route))
            }
        })
        .map(|(match_prefix, target, route)| {
            if match_prefix.is_empty() {
                return Err(format!("调试档案 {} 的代理路由前缀不能为空", profile_key));
            }
            if target.is_empty() || !is_http_url(&target) {
                return Err(format!(
                    "调试档案 {} 的代理路由目标需要以 http:// 或 https:// 开头",
                    profile_key
                ));
            }
            Ok(ProjectLocalProxyRouteConfig {
                enabled: route.enabled,
                match_prefix,
                target,
                rewrite_prefix: route.rewrite_prefix.trim().to_string(),
                headers: env_map_from_editor_text(&route.headers_text)?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    Ok(ProjectLocalProxyConfig {
        enabled: editor.enabled,
        listen,
        frontend_url,
        upstream_proxy,
        routes,
        auth_helper: auth_helper_from_editor(profile_key, editor.auth_helper)?,
    })
}

fn auth_helper_from_editor(
    profile_key: &str,
    editor: ProjectAuthHelperEditor,
) -> Result<ProjectAuthHelperConfig, String> {
    let path = editor.path.trim();
    let redirect_path = editor.redirect_path.trim();
    if editor.enabled {
        if !path.starts_with('/') {
            return Err(format!(
                "调试档案 {} 的 Auth Helper 路径需要以 / 开头",
                profile_key
            ));
        }
        if redirect_path.is_empty() {
            return Err(format!(
                "调试档案 {} 的 Auth Helper 跳转路径不能为空",
                profile_key
            ));
        }
    }

    let items = editor
        .items
        .into_iter()
        .filter_map(|item| {
            let key = item.key.trim().to_string();
            if key.is_empty()
                && item.from_json_path.trim().is_empty()
                && item.value.trim().is_empty()
            {
                None
            } else {
                Some((key, item))
            }
        })
        .map(|(key, item)| {
            if key.is_empty() {
                return Err(format!(
                    "调试档案 {} 的 Auth Helper key 不能为空",
                    profile_key
                ));
            }
            let storage = item.storage.trim();
            if !matches!(storage, "localStorage" | "sessionStorage" | "cookie") {
                return Err(format!(
                    "调试档案 {} 的 Auth Helper storage 不支持: {}",
                    profile_key, storage
                ));
            }
            Ok(ProjectAuthHelperItemConfig {
                enabled: item.enabled,
                storage: storage.to_string(),
                key,
                from_json_path: item.from_json_path.trim().to_string(),
                value: item.value,
                cookie_path: if item.cookie_path.trim().is_empty() {
                    "/".to_string()
                } else {
                    item.cookie_path.trim().to_string()
                },
                cookie_max_age_seconds: item.cookie_max_age_seconds,
                cookie_same_site: item.cookie_same_site.trim().to_string(),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    Ok(ProjectAuthHelperConfig {
        enabled: editor.enabled,
        path: if path.is_empty() {
            "/__auth-helper".to_string()
        } else {
            path.to_string()
        },
        redirect_path: if redirect_path.is_empty() {
            "/#/".to_string()
        } else {
            redirect_path.to_string()
        },
        items,
    })
}

fn is_http_url(value: &str) -> bool {
    let value = value.to_lowercase();
    value.starts_with("http://") || value.starts_with("https://")
}

fn runtime_profile_to_editor(profile: &RuntimeProfileConfig) -> RuntimeProfileEditor {
    RuntimeProfileEditor {
        key: profile.key.clone(),
        label: profile.label.clone(),
        browser: profile.browser.clone(),
        browser_profile: profile.browser_profile.clone(),
        browser_user_data_dir: profile
            .browser_user_data_dir
            .as_ref()
            .map(|path| path.display().to_string()),
        web_actions_enabled: profile.web_actions_enabled,
        web_actions_port: profile.web_actions_port,
        web_actions_user_data_dir: profile
            .web_actions_user_data_dir
            .as_ref()
            .map(|path| path.display().to_string()),
        browser_args_text: profile.browser_args.join("\n"),
        proxy_url: profile.proxy_url.clone(),
        proxy_bypass: profile.proxy_bypass.clone(),
        host_resolver_rules_text: profile.host_resolver_rules.join("\n"),
        network_proxy: network_proxy_to_editor(&profile.network_proxy),
    }
}

fn runtime_profiles_from_editor(
    profiles: Vec<RuntimeProfileEditor>,
) -> Result<Vec<RuntimeProfileConfig>, String> {
    let mut profile_keys = std::collections::BTreeSet::new();
    let mut next_profiles = Vec::with_capacity(profiles.len());

    for profile in profiles {
        let key = validate_config_key("运行配置", &profile.key)?;
        if !profile_keys.insert(key.clone()) {
            return Err(format!("运行配置 key 重复: {}", key));
        }
        let label = profile.label.trim();
        let profile_label = format!("运行配置 {}", key);
        let proxy_url = profile.proxy_url.trim().to_string();
        if !proxy_url.is_empty() && !is_supported_browser_proxy_url(&proxy_url) {
            return Err(format!(
                "运行配置 {} 的浏览器代理地址需要以 http://、https://、socks5:// 或 socks5h:// 开头",
                key
            ));
        }
        if profile.web_actions_enabled && profile.web_actions_port == 0 {
            return Err(format!("运行配置 {} 的网页动作端口不能为 0", key));
        }
        if profile.web_actions_enabled
            && profile
                .browser_args_text
                .lines()
                .map(str::trim)
                .any(|line| {
                    line.to_ascii_lowercase()
                        .starts_with("--remote-debugging-port")
                })
        {
            return Err(format!(
                "运行配置 {} 已启用网页动作受控模式，请使用调试端口字段，不要在浏览器参数里填写 --remote-debugging-port",
                key
            ));
        }
        next_profiles.push(RuntimeProfileConfig {
            key: key.clone(),
            label: if label.is_empty() {
                key.clone()
            } else {
                label.to_string()
            },
            browser: optional_editor_string(profile.browser),
            browser_profile: optional_editor_string(profile.browser_profile),
            browser_user_data_dir: optional_editor_string(profile.browser_user_data_dir)
                .map(PathBuf::from),
            web_actions_enabled: profile.web_actions_enabled,
            web_actions_port: if profile.web_actions_port == 0 {
                default_web_actions_port()
            } else {
                profile.web_actions_port
            },
            web_actions_user_data_dir: optional_editor_string(profile.web_actions_user_data_dir)
                .map(PathBuf::from),
            browser_args: browser_args_from_editor_text(
                &profile_label,
                &profile.browser_args_text,
            )?,
            proxy_url,
            proxy_bypass: profile.proxy_bypass.trim().to_string(),
            host_resolver_rules: profile
                .host_resolver_rules_text
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty() && !line.starts_with('#'))
                .map(ToString::to_string)
                .collect(),
            network_proxy: network_proxy_from_editor(&profile_label, profile.network_proxy)?,
        });
    }

    Ok(next_profiles)
}

fn is_supported_browser_proxy_url(value: &str) -> bool {
    let value = value.to_lowercase();
    ["http://", "https://", "socks5://", "socks5h://"]
        .iter()
        .any(|prefix| value.starts_with(prefix))
}

fn debug_profile_to_editor(profile: &ProjectDebugProfileConfig) -> ProjectDebugProfileEditor {
    ProjectDebugProfileEditor {
        key: profile.key.clone(),
        label: profile.label.clone(),
        runtime_profile: profile.runtime_profile.clone(),
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
        browser_user_data_dir: profile
            .browser_user_data_dir
            .as_ref()
            .map(|path| path.display().to_string()),
        browser_args_text: profile.browser_args.join("\n"),
        network_proxy: network_proxy_to_editor(&profile.network_proxy),
        local_proxy: local_proxy_to_editor(&profile.local_proxy),
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
                key.clone()
            } else {
                label.to_string()
            },
            runtime_profile: optional_editor_string(profile.runtime_profile),
            env: env_map_from_editor_text(&profile.env_text)?,
            local_files,
            browser: optional_editor_string(profile.browser),
            browser_profile: optional_editor_string(profile.browser_profile),
            browser_user_data_dir: optional_editor_string(profile.browser_user_data_dir)
                .map(PathBuf::from),
            browser_args: browser_args_from_editor_text(&key, &profile.browser_args_text)?,
            network_proxy: network_proxy_from_editor(&key, profile.network_proxy)?,
            local_proxy: local_proxy_from_editor(&key, profile.local_proxy)?,
        });
    }

    Ok(next_profiles)
}

fn browser_args_from_editor_text(profile_key: &str, value: &str) -> Result<Vec<String>, String> {
    value
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| {
            if !line.starts_with("--") {
                return Err(format!(
                    "调试档案 {} 的浏览器参数必须以 -- 开头: {}",
                    profile_key, line
                ));
            }
            Ok(normalize_browser_arg_text(line))
        })
        .collect()
}

fn normalize_browser_arg_text(value: &str) -> String {
    let Some((key, raw_value)) = value.split_once('=') else {
        return value.to_string();
    };
    let raw_value = raw_value.trim();
    if raw_value.len() >= 2 && raw_value.starts_with('"') && raw_value.ends_with('"') {
        return format!("{}={}", key.trim(), &raw_value[1..raw_value.len() - 1]);
    }
    value.to_string()
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
        runtime_profiles: config
            .defaults
            .runtime_profiles
            .iter()
            .map(runtime_profile_to_editor)
            .collect(),
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
async fn save_runtime_profiles(
    state: tauri::State<'_, AppState>,
    request: SaveRuntimeProfilesRequest,
) -> Result<ProjectConfigEditorState, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let mut config = load_config(&paths.projects).map_err(|error| error.to_string())?;

        config.defaults.runtime_profiles = runtime_profiles_from_editor(request.runtime_profiles)?;

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
    state: tauri::State<'_, AppState>,
    entry: NavigationEntry,
) -> Result<NavigationOpenResult, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        let result =
            open_navigation_entry_with_runtime_profiles(&entry, &config.defaults.runtime_profiles)
                .map_err(|error| error.to_string())?;
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
async fn open_web_action_navigation_target(
    state: tauri::State<'_, AppState>,
    entry: NavigationEntry,
) -> Result<WebActionTarget, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        core_open_web_action_navigation_target(&entry, &config.defaults.runtime_profiles)
            .map_err(|error| error.to_string())
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
async fn list_web_action_navigation_targets(
    state: tauri::State<'_, AppState>,
    entry: NavigationEntry,
) -> Result<Vec<WebActionTarget>, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        core_list_web_action_navigation_targets(&entry, &config.defaults.runtime_profiles)
            .map_err(|error| error.to_string())
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
async fn run_web_action_navigation(
    state: tauri::State<'_, AppState>,
    entry: NavigationEntry,
    request: WebActionRunRequest,
) -> Result<WebActionRunResult, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        core_run_web_action_navigation(&entry, &config.defaults.runtime_profiles, request)
            .map_err(|error| error.to_string())
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
async fn run_web_action_navigation_script(
    state: tauri::State<'_, AppState>,
    entry: NavigationEntry,
    request: WebActionScriptRunRequest,
) -> Result<WebActionRunResult, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        core_run_web_action_navigation_script(&entry, &config.defaults.runtime_profiles, request)
            .map_err(|error| error.to_string())
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
            match runtime.focus_runtime(&config, &project, debug_profile_key.as_deref()) {
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
    debug_profile: Option<String>,
) -> Result<ProjectRuntimeSnapshot, String> {
    let runtime = state.project_runtime.clone();
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        let debug_profile_key = optional_editor_string(debug_profile);
        let updated = runtime.focus_runtime(&config, &project, debug_profile_key.as_deref())?;
        let mut action = tray_action_for_project(
            "project.runtime.focus",
            format!("聚焦 {}", updated.name),
            Some(updated.detail.clone()),
            project,
        );
        if let Some(profile_key) = debug_profile_key.as_ref() {
            action.detail = Some(match action.detail.as_ref() {
                Some(detail) => format!("{} · {}", detail, profile_key),
                None => format!("调试档案 {}", profile_key),
            });
            action.dedupe_key = format!(
                "project.runtime.focus:{}:{}",
                action.project_key.as_deref().unwrap_or_default(),
                profile_key
            );
            action.payload = Some(json!({ "debugProfile": profile_key }));
        }
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
    const MAX_CHARS: usize = 24;
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

fn tray_action_menu_meta(action: &TrayReplayAction) -> (&'static str, NativeIcon) {
    match action.kind.as_str() {
        "branch.replay" => ("分支", NativeIcon::FollowLinkFreestanding),
        "deploy.replay" => ("部署", NativeIcon::Network),
        "finder.shortcut.open" => ("入口", NativeIcon::Bookmarks),
        "project.runtime.start" => ("启动", NativeIcon::RightFacingTriangle),
        "project.runtime.focus" => ("聚焦", NativeIcon::RevealFreestanding),
        "project.build.run" => ("构建", NativeIcon::Advanced),
        "project.build.openOutput" | "project.openDirectory" => ("打开", NativeIcon::Folder),
        _ => ("操作", NativeIcon::SmartBadge),
    }
}

fn tray_action_menu_label(action: &TrayReplayAction) -> String {
    let (category, _) = tray_action_menu_meta(action);
    let label = action
        .label
        .trim()
        .strip_prefix("分支：")
        .or_else(|| action.label.trim().strip_prefix("部署："))
        .or_else(|| action.label.trim().strip_prefix("打开 "))
        .unwrap_or_else(|| action.label.trim());
    truncate_menu_label(&format!("{} · {}", category, label))
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

    let show_item = IconMenuItem::with_id_and_native_icon(
        app,
        TRAY_SHOW_ID,
        "打开 rDevTool",
        true,
        Some(NativeIcon::Computer),
        None::<&str>,
    )?;
    let replay_last_item = IconMenuItem::with_id_and_native_icon(
        app,
        TRAY_REPLAY_LAST_ID,
        recent_actions
            .first()
            .map(|action| format!("重复上次：{}", tray_action_menu_label(action)))
            .unwrap_or_else(|| "重复上次操作".to_string()),
        !recent_actions.is_empty(),
        Some(NativeIcon::RefreshFreestanding),
        None::<&str>,
    )?;

    let pinned_menu_items = if pinned_actions.is_empty() {
        vec![IconMenuItem::with_id_and_native_icon(
            app,
            "tray_pinned_empty",
            "暂无已标记操作",
            false,
            Some(NativeIcon::Bookmarks),
            None::<&str>,
        )?]
    } else {
        pinned_actions
            .iter()
            .take(TRAY_PINNED_LIMIT)
            .enumerate()
            .map(|(index, action)| {
                let (_, icon) = tray_action_menu_meta(action);
                IconMenuItem::with_id_and_native_icon(
                    app,
                    format!("{}{}", TRAY_PINNED_PREFIX, index),
                    tray_action_menu_label(action),
                    true,
                    Some(icon),
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
        "已标记",
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
            let debug_profile = action
                .payload
                .as_ref()
                .and_then(|payload| payload.get("debugProfile"))
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty());
            state
                .project_runtime
                .focus_runtime(&config, project_key, debug_profile)?;
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
            let config = state.config_state.load()?;
            open_navigation_entry_with_runtime_profiles(&entry, &config.defaults.runtime_profiles)
                .map_err(|error| error.to_string())?;
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
    let width = icon.width() as usize;
    let height = icon.height() as usize;
    let mut alpha_mask = Vec::with_capacity(width * height);

    for chunk in rgba.chunks_exact(4) {
        let alpha = chunk[3] as f32 / 255.0;
        if alpha <= 0.0 {
            alpha_mask.push(0);
            continue;
        }

        let luminance =
            0.2126 * chunk[0] as f32 + 0.7152 * chunk[1] as f32 + 0.0722 * chunk[2] as f32;
        if luminance <= threshold {
            alpha_mask.push(0);
            continue;
        }

        let whiteness = ((luminance - threshold) / (255.0 - threshold)).clamp(0.0, 1.0);
        let tray_alpha = (alpha * whiteness * 255.0).round() as u8;
        alpha_mask.push(tray_alpha);
    }

    let mut min_x = width;
    let mut min_y = height;
    let mut max_x = 0usize;
    let mut max_y = 0usize;
    for (index, alpha) in alpha_mask.iter().enumerate() {
        if *alpha <= 4 {
            continue;
        }
        let x = index % width;
        let y = index / width;
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x);
        max_y = max_y.max(y);
    }

    if min_x >= width || min_y >= height {
        return Image::new_owned(vec![0; rgba.len()], icon.width(), icon.height());
    }

    let source_width = max_x - min_x + 1;
    let source_height = max_y - min_y + 1;
    let target_limit = ((width.min(height) as f32) * 0.88).round() as usize;
    let scale = (target_limit as f32 / source_width.max(source_height) as f32).max(1.0);
    let target_width = ((source_width as f32) * scale).round().min(width as f32) as usize;
    let target_height = ((source_height as f32) * scale).round().min(height as f32) as usize;
    let target_x = (width - target_width) / 2;
    let target_y = (height - target_height) / 2;
    let mut enlarged_alpha = vec![0u8; width * height];

    for y in 0..target_height {
        for x in 0..target_width {
            let source_x =
                min_x + ((x as f32 / target_width as f32) * source_width as f32) as usize;
            let source_y =
                min_y + ((y as f32 / target_height as f32) * source_height as f32) as usize;
            enlarged_alpha[(target_y + y) * width + target_x + x] =
                alpha_mask[source_y.min(max_y) * width + source_x.min(max_x)];
        }
    }

    let mut bold_alpha = enlarged_alpha.clone();
    for y in 0..height {
        for x in 0..width {
            let mut strongest = 0u8;
            for next_y in y.saturating_sub(1)..=(y + 1).min(height - 1) {
                for next_x in x.saturating_sub(1)..=(x + 1).min(width - 1) {
                    strongest = strongest.max(enlarged_alpha[next_y * width + next_x]);
                }
            }
            bold_alpha[y * width + x] = strongest;
        }
    }

    let mut out = Vec::with_capacity(rgba.len());
    for alpha in bold_alpha {
        out.extend_from_slice(&[255, 255, 255, alpha]);
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
            save_runtime_profiles,
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
            open_web_action_navigation_target,
            list_web_action_targets,
            list_web_action_navigation_targets,
            run_web_action,
            run_web_action_navigation,
            run_web_action_script,
            run_web_action_navigation_script,
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
