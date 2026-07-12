use project_runtime::{
    ProjectRuntimeLogKind, ProjectRuntimeLogResponse, ProjectRuntimePreflightResponse,
    ProjectRuntimeSnapshot, ProjectRuntimeState,
};
use rdevtool_core::agent::{AgentContext, context_for_workspace};
use rdevtool_core::build as core_build;
use rdevtool_core::config::{
    AppConfig, BranchRules, BuildActionKind, BuildTargetAdapter, ConfigPaths,
    CreateProjectWorkspaceRequest, DeployParamConfig, DeployParamKind, DeployTargetConfig, Jobs,
    ProjectAuthHelperConfig, ProjectAuthHelperItemConfig, ProjectCommandConfig, ProjectConfig,
    ProjectDebugLocalFileConfig, ProjectDebugProfileConfig, ProjectFocusConfig,
    ProjectLocalProxyConfig, ProjectLocalProxyRouteConfig, ProjectNetworkProxyConfig,
    ProjectReadyConfig, ProjectWorkspaceConfig, RuntimeProfileConfig, SYSTEM_PROJECT_WORKSPACE_KEY,
    active_project_workspace_key, apply_project_workspace_context, create_project_workspace,
    default_config_dir, default_project_workspace_root_dir, default_project_workspaces_dir,
    default_projects_path, default_workspace_path, ensure_default_configs,
    load_active_project_workspace, load_config, load_project_workspace_by_key,
    load_project_workspaces, load_workspace_config, save_config, save_project_workspace_config,
    save_workspace_config, set_project_workspace_instance,
};
use rdevtool_core::core::{
    BranchCheckoutRequest, BranchCommitOverview, BranchCreateRequest, BranchPushRequest,
    BranchPushStatus, BranchSwitchRequest, BranchSyncRequest, BranchTaskResponse,
    BranchWorktreeSummary, BuildStatusResponse, BuildTriggerResponse, DeployPlan, DeployRequest,
    DeployTargetMeta, ProjectDetail, ProjectSummary, StatusRequest, available_branch_options,
    branch_commit_overview, branch_hint, branch_push_status, build_plan,
    checkout_branch_to_directory, deploy_target_meta, execute_branch_create, execute_branch_push,
    execute_branch_switch, execute_branch_sync, execute_merge, project_detail, project_summaries,
    project_worktrees, refresh_deploy_status, trigger_deploy,
};
use rdevtool_core::core::{MergeRequest, MergeResponse};
use rdevtool_core::git;
use rdevtool_core::navigation::{
    NavigationData, NavigationEditorData, NavigationEntry, NavigationOpenResult,
    load_navigation_data_for_workspace, load_navigation_editor_data, navigation_file_path,
    open_navigation_entry_with_runtime_profiles, save_navigation_editor_data,
};
use rdevtool_core::proxy::{
    ProxyDashboard, ProxyProfile, ProxyProfilePack, ProxyRequestDiagnosis, ProxyRule,
    ProxyRuntimeState, default_proxy_path, delete_proxy_profile as core_delete_proxy_profile,
    delete_proxy_rule as core_delete_proxy_rule,
    diagnose_proxy_request as core_diagnose_proxy_request, ensure_proxy_config,
    export_proxy_profile_pack as core_export_proxy_profile_pack,
    import_proxy_profile_pack as core_import_proxy_profile_pack, load_proxy_config,
    save_proxy_config, upsert_proxy_profile, upsert_proxy_rule, validate_proxy_profile,
    validate_proxy_rule,
};
use rdevtool_core::runtime as core_runtime;
use rdevtool_core::runtime_link::{
    BindProxyRuntimeRequest, BindProxyRuntimeResult, bind_proxy_runtime_profile,
};
use rdevtool_core::storage::{
    BuildHistoryEntry, DeployHistoryEntry, MergeHistoryEntry, SaveBuildHistoryRequest,
    SaveDeployHistoryRequest, SaveMergeHistoryRequest, Storage, default_storage_path,
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
use rdevtool_core::workspace_init::{
    InitDemandWorkspaceRequest, InitDemandWorkspaceResult, init_demand_workspace,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{
    Arc, RwLock,
    atomic::{AtomicBool, Ordering},
};
use std::time::SystemTime;
use tauri::{
    AppHandle, Manager, RunEvent, Runtime, WindowEvent,
    image::Image,
    menu::{IconMenuItem, IsMenuItem, Menu, MenuItem, NativeIcon, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
#[cfg(target_os = "macos")]
use window_vibrancy::{NSVisualEffectMaterial, NSVisualEffectState, apply_vibrancy};

mod project_runtime;

#[derive(Clone)]
struct AppState {
    storage: Storage,
    project_runtime: ProjectRuntimeState,
    proxy_runtime: ProxyRuntimeState,
    config_state: AppConfigState,
    tray_replay_running: Arc<AtomicBool>,
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
    #[serde(default)]
    active_workspace: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectWorkspaceState {
    active_key: String,
    workspaces_dir: String,
    workspaces: Vec<ProjectWorkspaceSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectWorkspaceSummary {
    key: String,
    name: String,
    description: Option<String>,
    active: bool,
    system: bool,
    workspace_type: String,
    workspace_type_label: String,
    project_count: usize,
    resource_count: usize,
    include_all_projects: bool,
    include_all_navigation: bool,
    root_dir: Option<String>,
    workspace_kind: String,
    project_scope_label: String,
    navigation_scope_label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectWorkspaceEditorState {
    workspace: ProjectWorkspaceEditorDraft,
    projects: Vec<ProjectWorkspaceEditorProject>,
    navigation_categories: Vec<ProjectWorkspaceEditorNavigationCategory>,
    proxy_profiles: Vec<ProjectWorkspaceEditorProxyProfile>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectWorkspaceEditorDraft {
    key: String,
    name: String,
    description: Option<String>,
    system: bool,
    #[serde(default = "default_project_workspace_type_value")]
    workspace_type: String,
    #[serde(default)]
    workspace_type_label: String,
    #[serde(default)]
    root_dir: Option<String>,
    include_all_projects: bool,
    include_all_navigation: bool,
    projects: Vec<String>,
    navigation_categories: Vec<String>,
    navigation_entries: Vec<String>,
    #[serde(default)]
    proxy_profiles: Vec<String>,
    #[serde(default)]
    project_instances: Vec<ProjectWorkspaceProjectInstanceDraft>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectWorkspaceProjectInstanceDraft {
    project: String,
    path: String,
    #[serde(default)]
    managed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectWorkspaceEditorProject {
    key: String,
    name: String,
    category: String,
    repo_path: Option<String>,
    selected: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectWorkspaceEditorNavigationCategory {
    title: String,
    short_label: String,
    selected: bool,
    entries: Vec<ProjectWorkspaceEditorNavigationEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectWorkspaceEditorNavigationEntry {
    name: String,
    scoped_name: String,
    kind: String,
    selected: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectWorkspaceEditorProxyProfile {
    id: String,
    name: String,
    listen_host: String,
    listen_port: u16,
    workspace_key: Option<String>,
    workspace_label: String,
    selected: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateProjectWorkspacePayload {
    key: String,
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    workspace_type: Option<String>,
    #[serde(default)]
    root_dir: Option<String>,
    #[serde(default)]
    independent_dir: bool,
    #[serde(default = "default_true")]
    copy_current: bool,
    #[serde(default)]
    copy_from_workspace_key: Option<String>,
    #[serde(default = "default_true")]
    activate: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InitDemandWorkspacePayload {
    name: String,
    #[serde(default)]
    key: Option<String>,
    #[serde(default)]
    demand_id: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    workspace_type: Option<String>,
    requirement_dir: String,
    repo_path: String,
    #[serde(default)]
    project: Option<String>,
    #[serde(default)]
    branch: Option<String>,
    #[serde(default)]
    root_dir: Option<String>,
    #[serde(default)]
    requirement_category: Option<String>,
    #[serde(default)]
    requirement_short_label: Option<String>,
    #[serde(default)]
    requirement_entry_name: Option<String>,
    #[serde(default = "default_true")]
    activate: bool,
}

fn default_true() -> bool {
    true
}

fn default_project_workspace_type_value() -> String {
    "custom".to_string()
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
    #[serde(default = "default_focus_editor_auto_open_mode")]
    auto_open_mode: String,
    #[serde(default)]
    after_ready_actions_text: String,
    #[serde(default = "default_focus_editor_ready_enabled")]
    ready_enabled: bool,
    #[serde(default = "default_focus_editor_ready_timeout_ms")]
    ready_timeout_ms: u64,
    #[serde(default)]
    ready_url_patterns_text: String,
    #[serde(default)]
    ready_success_markers_text: String,
    #[serde(default)]
    ready_failure_markers_text: String,
}

fn default_focus_editor_auto_open_mode() -> String {
    ProjectFocusConfig::default().auto_open_mode
}

fn default_focus_editor_ready_enabled() -> bool {
    ProjectReadyConfig::default().enabled
}

fn default_focus_editor_ready_timeout_ms() -> u64 {
    ProjectReadyConfig::default().timeout_ms
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
    rdev_proxy_profile_id: Option<String>,
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
    adapter: String,
    action_kind: String,
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

const DEFAULT_PAGE_KEYS: [&str; 5] = ["overview", "projects", "merge", "build", "proxy"];
const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "main-tray";
const TRAY_SHOW_ID: &str = "tray_show_main";
const TRAY_REPLAY_LAST_ID: &str = "tray_replay_last";
const TRAY_PINNED_PREFIX: &str = "tray_pinned_action_";
const TRAY_PINNED_SUBMENU_ID: &str = "tray_pinned_menu";
const TRAY_QUIT_ID: &str = "tray_quit";
const TRAY_STORAGE_NAMESPACE: &str = "tray";
const TRAY_RECENT_STORAGE_KEY: &str = "recent-actions";
const TRAY_PINNED_STORAGE_KEY: &str = "pinned-actions";
const BRANCH_WORKFLOW_STORAGE_NAMESPACE: &str = "branch-workflow";
const BRANCH_WORKFLOW_HISTORY_KEY: &str = "history";
const TRAY_RECENT_LIMIT: usize = 6;
const TRAY_PINNED_STORAGE_LIMIT: usize = 60;
const TRAY_PINNED_MENU_LIMIT: usize = 5;

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspacePinnedActionsOverview {
    key: String,
    name: String,
    description: Option<String>,
    system: bool,
    root_dir: Option<String>,
    workspace_kind: String,
    workspace_type: String,
    workspace_type_label: String,
    project_count: usize,
    entry_count: usize,
    action_count: usize,
    proxy_profile_count: usize,
    resources: Vec<WorkspaceResourceShortcutItem>,
    project_directories: Vec<WorkspaceProjectDirectoryItem>,
    proxy_profiles: Vec<WorkspaceProxyProfileItem>,
    actions: Vec<WorkspacePinnedActionItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceProxyProfileItem {
    id: String,
    name: String,
    listen_host: String,
    listen_port: u16,
    listen_url: String,
    workspace_key: Option<String>,
    workspace_label: String,
    rule_count: usize,
    running: bool,
    started_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspacePinnedActionItem {
    action: TrayReplayAction,
    kind_label: String,
    label: String,
    detail: Option<String>,
    project_key: Option<String>,
    confirm_required: bool,
    updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceResourceShortcutItem {
    key: String,
    category: String,
    label: String,
    kind: String,
    kind_label: String,
    value: Option<String>,
    open_kind: Option<String>,
    openable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceProjectDirectoryItem {
    project_key: String,
    project_name: String,
    mode: String,
    mode_label: String,
    path: Option<String>,
    managed: bool,
    status_key: String,
    status_label: String,
    running: bool,
    can_start: bool,
    can_stop: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceAiContextResponse {
    workspace_key: String,
    workspace_name: String,
    markdown: String,
    json: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceAiContextOptions {
    #[serde(default = "default_true")]
    include_projects: bool,
    #[serde(default = "default_true")]
    include_entries: bool,
    #[serde(default = "default_true")]
    include_directories: bool,
    #[serde(default = "default_true")]
    include_actions: bool,
    #[serde(default = "default_true")]
    include_build_history: bool,
    #[serde(default = "default_true")]
    include_merge_history: bool,
    #[serde(default = "default_item_limit")]
    item_limit: usize,
    #[serde(default = "default_history_limit")]
    history_limit: usize,
}

impl Default for WorkspaceAiContextOptions {
    fn default() -> Self {
        Self {
            include_projects: true,
            include_entries: true,
            include_directories: true,
            include_actions: true,
            include_build_history: true,
            include_merge_history: true,
            item_limit: default_item_limit(),
            history_limit: default_history_limit(),
        }
    }
}

fn default_item_limit() -> usize {
    12
}

fn default_history_limit() -> usize {
    8
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
        "deploy" => Some("build".to_string()),
        "overview" | "build" | "merge" | "projects" | "proxy" => Some(value),
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

fn project_workspace_state(config: &AppConfig) -> Result<ProjectWorkspaceState, String> {
    let paths = ensure_default_configs().map_err(|error| error.to_string())?;
    let app_workspace =
        load_workspace_config(&paths.workspace).map_err(|error| error.to_string())?;
    let requested_active_key = active_project_workspace_key(&app_workspace);
    let workspaces =
        load_project_workspaces(&paths.project_workspaces).map_err(|error| error.to_string())?;
    let active_key = if workspaces
        .iter()
        .any(|workspace| workspace.key == requested_active_key)
    {
        requested_active_key
    } else {
        SYSTEM_PROJECT_WORKSPACE_KEY.to_string()
    };
    let summaries = workspaces
        .into_iter()
        .map(|workspace| project_workspace_summary(workspace, config, &active_key))
        .collect();

    Ok(ProjectWorkspaceState {
        active_key,
        workspaces_dir: paths.project_workspaces.display().to_string(),
        workspaces: summaries,
    })
}

fn project_workspace_summary(
    workspace: ProjectWorkspaceConfig,
    config: &AppConfig,
    active_key: &str,
) -> ProjectWorkspaceSummary {
    let system = workspace.is_system();
    let project_count = workspace.project_count_for(config);
    let resource_count = workspace_resource_count(&workspace);
    let workspace_type = workspace.workspace_type.clone();
    let workspace_type_label = workspace_type_label(&workspace);
    let project_scope_label = if workspace.include_all_projects {
        "全部项目".to_string()
    } else {
        format!("{} 个项目", project_count)
    };
    let navigation_scope_label = if workspace.include_all_navigation {
        "全部入口".to_string()
    } else {
        let category_count = workspace.navigation_categories.len();
        let entry_count = workspace.navigation_entries.len();
        match (category_count, entry_count, resource_count) {
            (0, 0, 0) => "未配置入口".to_string(),
            (0, 0, count) => format!("{count} 个动态入口"),
            (0, count, 0) => format!("{count} 个入口"),
            (count, 0, 0) => format!("{count} 个分类"),
            (category_count, entry_count, 0) => format!("{category_count} 类 / {entry_count} 项"),
            (category_count, entry_count, resource_count) => {
                format!("{category_count} 类 / {entry_count} 项 · {resource_count} 动态")
            }
        }
    };

    ProjectWorkspaceSummary {
        active: workspace.key == active_key,
        system,
        key: workspace.key,
        name: if system {
            "全局".to_string()
        } else {
            workspace.name.clone()
        },
        description: workspace.description,
        workspace_type,
        workspace_type_label,
        project_count,
        resource_count,
        include_all_projects: workspace.include_all_projects,
        include_all_navigation: workspace.include_all_navigation,
        root_dir: workspace
            .root_dir
            .as_ref()
            .map(|path| path.display().to_string()),
        workspace_kind: if system {
            "global".to_string()
        } else if workspace.root_dir.is_some() {
            "directory".to_string()
        } else {
            "scope".to_string()
        },
        project_scope_label,
        navigation_scope_label,
    }
}

fn workspace_resource_count(workspace: &ProjectWorkspaceConfig) -> usize {
    workspace
        .resource_categories
        .iter()
        .map(|category| category.entries.len())
        .sum()
}

fn load_project_workspace_for_editor(
    paths: &ConfigPaths,
    workspace_key: Option<String>,
) -> Result<ProjectWorkspaceConfig, String> {
    if let Some(workspace_key) = workspace_key
        .as_deref()
        .map(str::trim)
        .filter(|key| !key.is_empty())
    {
        return load_project_workspace_by_key(&paths.project_workspaces, workspace_key)
            .map_err(|error| error.to_string());
    }
    load_active_project_workspace(paths).map_err(|error| error.to_string())
}

fn project_workspace_editor_state(
    config: &AppConfig,
    workspace_key: Option<String>,
) -> Result<ProjectWorkspaceEditorState, String> {
    let paths = ensure_default_configs().map_err(|error| error.to_string())?;
    let workspace = load_project_workspace_for_editor(&paths, workspace_key)?;
    let system = workspace.is_system();
    let workspace_key = workspace.key.clone();
    let workspace_type = workspace.workspace_type.clone();
    let workspace_type_label = workspace_type_label(&workspace);
    let project_keys = workspace.projects.iter().cloned().collect::<BTreeSet<_>>();
    let navigation_category_keys = workspace
        .navigation_categories
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    let navigation_entry_keys = workspace
        .navigation_entries
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    let include_all_projects = workspace.include_all_projects;
    let include_all_navigation = workspace.include_all_navigation;
    let workspace_names = load_project_workspaces(&paths.project_workspaces)
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|workspace| {
            let name = if workspace.is_system() {
                "全局".to_string()
            } else {
                workspace.name
            };
            (workspace.key, name)
        })
        .collect::<BTreeMap<_, _>>();

    let projects = config
        .projects
        .iter()
        .map(|project| ProjectWorkspaceEditorProject {
            key: project.key.clone(),
            name: project.name.clone(),
            category: project.category.clone(),
            repo_path: project
                .repo_path
                .as_ref()
                .map(|path| path.display().to_string()),
            selected: include_all_projects || project_keys.contains(&project.key),
        })
        .collect::<Vec<_>>();

    let navigation = load_navigation_editor_data().map_err(|error| error.to_string())?;
    let navigation_categories = navigation
        .categories
        .into_iter()
        .filter(|category| !category.title.trim().is_empty())
        .map(|category| {
            let title = category.title.trim().to_string();
            let category_selected =
                include_all_navigation || navigation_category_keys.contains(&title);
            let entries = category
                .entries
                .into_iter()
                .filter(|entry| !entry.name.trim().is_empty())
                .map(|entry| {
                    let name = entry.name.trim().to_string();
                    let scoped_name = format!("{title}/{name}");
                    let selected = include_all_navigation
                        || category_selected
                        || navigation_entry_keys.contains(&name)
                        || navigation_entry_keys.contains(&scoped_name);
                    ProjectWorkspaceEditorNavigationEntry {
                        name,
                        scoped_name,
                        kind: entry.kind,
                        selected,
                    }
                })
                .collect();
            ProjectWorkspaceEditorNavigationCategory {
                title,
                short_label: category.short_label,
                selected: category_selected,
                entries,
            }
        })
        .collect::<Vec<_>>();

    let proxy_path = ensure_proxy_config().map_err(|error| error.to_string())?;
    let proxy_config = load_proxy_config(&proxy_path).map_err(|error| error.to_string())?;
    let proxy_profiles = proxy_config
        .profiles
        .iter()
        .map(|profile| {
            let selected =
                system || profile.workspace_key.as_deref() == Some(workspace_key.as_str());
            let workspace_label = profile
                .workspace_key
                .as_ref()
                .and_then(|key| workspace_names.get(key))
                .cloned()
                .unwrap_or_else(|| {
                    profile
                        .workspace_key
                        .clone()
                        .unwrap_or_else(|| "未归属".to_string())
                });
            ProjectWorkspaceEditorProxyProfile {
                id: profile.id.clone(),
                name: profile.name.clone(),
                listen_host: profile.listen_host.clone(),
                listen_port: profile.listen_port,
                workspace_key: profile.workspace_key.clone(),
                workspace_label,
                selected,
            }
        })
        .collect::<Vec<_>>();
    let selected_proxy_profiles = proxy_profiles
        .iter()
        .filter(|profile| profile.workspace_key.as_deref() == Some(workspace_key.as_str()))
        .map(|profile| profile.id.clone())
        .collect::<Vec<_>>();

    Ok(ProjectWorkspaceEditorState {
        workspace: ProjectWorkspaceEditorDraft {
            key: workspace.key,
            name: workspace.name,
            description: workspace.description,
            system,
            workspace_type,
            workspace_type_label,
            root_dir: workspace
                .root_dir
                .as_ref()
                .map(|path| path.display().to_string()),
            include_all_projects,
            include_all_navigation,
            projects: workspace.projects,
            navigation_categories: workspace.navigation_categories,
            navigation_entries: workspace.navigation_entries,
            proxy_profiles: if system {
                proxy_profiles
                    .iter()
                    .map(|profile| profile.id.clone())
                    .collect()
            } else {
                selected_proxy_profiles
            },
            project_instances: workspace
                .project_instances
                .into_iter()
                .map(|instance| ProjectWorkspaceProjectInstanceDraft {
                    project: instance.project,
                    path: instance.path.display().to_string(),
                    managed: instance.managed,
                })
                .collect(),
        },
        projects,
        navigation_categories,
        proxy_profiles,
    })
}

fn apply_active_workspace_context(config: &AppConfig) -> Result<AppConfig, String> {
    let paths = ensure_default_configs().map_err(|error| error.to_string())?;
    let workspace = load_active_project_workspace(&paths).map_err(|error| error.to_string())?;
    Ok(apply_project_workspace_context(config, &workspace))
}

fn same_path(left: &Path, right: &Path) -> bool {
    let left = left.canonicalize().unwrap_or_else(|_| left.to_path_buf());
    let right = right.canonicalize().unwrap_or_else(|_| right.to_path_buf());
    left == right
}

fn save_project_workspace_editor_state(
    config: &AppConfig,
    draft: ProjectWorkspaceEditorDraft,
) -> Result<ProjectWorkspaceEditorState, String> {
    let paths = ensure_default_configs().map_err(|error| error.to_string())?;
    let draft_key = draft.key.trim().to_string();
    if draft_key.is_empty() {
        return Err("工作区 key 不能为空".to_string());
    }
    let current_workspace = load_project_workspace_by_key(&paths.project_workspaces, &draft_key)
        .map_err(|error| error.to_string())?;
    if current_workspace.is_system() {
        return Err("全局工作区显示全部项目、入口和代理，不需要编辑范围".to_string());
    }
    let name = draft.name.trim();
    if name.is_empty() {
        return Err("工作区名称不能为空".to_string());
    }

    let mut workspace = ProjectWorkspaceConfig {
        key: current_workspace.key.clone(),
        name: name.to_string(),
        description: draft.description.and_then(|value| {
            let value = value.trim().to_string();
            (!value.is_empty()).then_some(value)
        }),
        workspace_type: draft.workspace_type,
        metadata: current_workspace.metadata,
        root_dir: draft.root_dir.and_then(|value| {
            let value = value.trim().to_string();
            (!value.is_empty()).then_some(PathBuf::from(value))
        }),
        include_all_projects: draft.include_all_projects,
        include_all_navigation: draft.include_all_navigation,
        projects: if draft.include_all_projects {
            Vec::new()
        } else {
            draft.projects
        },
        navigation_categories: if draft.include_all_navigation {
            Vec::new()
        } else {
            draft.navigation_categories
        },
        navigation_entries: if draft.include_all_navigation {
            Vec::new()
        } else {
            draft.navigation_entries
        },
        project_instances: draft
            .project_instances
            .into_iter()
            .filter_map(|instance| {
                let project = instance.project.trim().to_string();
                let path = instance.path.trim().to_string();
                if project.is_empty() || path.is_empty() {
                    return None;
                }
                Some(
                    rdevtool_core::config::ProjectWorkspaceProjectInstanceConfig {
                        project,
                        path: PathBuf::from(path),
                        managed: instance.managed,
                    },
                )
            })
            .collect(),
        resource_categories: current_workspace.resource_categories,
    }
    .normalized();

    if workspace.include_all_projects {
        workspace.projects.clear();
    }
    if workspace.include_all_navigation {
        workspace.navigation_categories.clear();
        workspace.navigation_entries.clear();
    }

    let path = paths
        .project_workspaces
        .join(format!("{}.toml", workspace.key));
    save_project_workspace_config(&path, &workspace).map_err(|error| error.to_string())?;

    let selected_proxy_profiles = draft.proxy_profiles.into_iter().collect::<BTreeSet<_>>();
    let proxy_path = ensure_proxy_config().map_err(|error| error.to_string())?;
    let mut proxy_config = load_proxy_config(&proxy_path).map_err(|error| error.to_string())?;
    for profile in &mut proxy_config.profiles {
        if selected_proxy_profiles.contains(&profile.id) {
            profile.workspace_key = Some(workspace.key.clone());
        } else if profile.workspace_key.as_deref() == Some(workspace.key.as_str()) {
            profile.workspace_key = None;
        }
    }
    save_proxy_config(&proxy_path, &proxy_config).map_err(|error| error.to_string())?;

    project_workspace_editor_state(config, Some(workspace.key.clone()))
}

fn active_workspace_project_filter() -> Result<Option<BTreeSet<String>>, String> {
    let paths = ensure_default_configs().map_err(|error| error.to_string())?;
    let workspace = load_active_project_workspace(&paths).map_err(|error| error.to_string())?;
    if workspace.include_all_projects {
        return Ok(None);
    }
    Ok(Some(workspace.projects.into_iter().collect()))
}

fn active_workspace_project_keys() -> Result<Option<Vec<String>>, String> {
    Ok(active_workspace_project_filter()?.map(|keys| keys.into_iter().collect::<Vec<_>>()))
}

fn filter_build_history_by_active_workspace(
    storage: &Storage,
) -> Result<Vec<BuildHistoryEntry>, String> {
    match active_workspace_project_filter()? {
        None => storage.list_deploy_history(),
        Some(project_keys) if project_keys.is_empty() => Ok(Vec::new()),
        Some(project_keys) => Ok(storage
            .list_all_deploy_history()?
            .into_iter()
            .filter(|entry| project_keys.contains(&entry.project_key))
            .take(20)
            .collect()),
    }
}

fn clear_build_history_by_active_workspace(storage: &Storage) -> Result<usize, String> {
    match active_workspace_project_keys()? {
        None => storage.clear_deploy_history(),
        Some(project_keys) => storage.clear_deploy_history_for_projects(&project_keys),
    }
}

fn filter_deploy_history_by_active_workspace(
    storage: &Storage,
) -> Result<Vec<DeployHistoryEntry>, String> {
    filter_build_history_by_active_workspace(storage)
}

fn clear_deploy_history_by_active_workspace(storage: &Storage) -> Result<usize, String> {
    clear_build_history_by_active_workspace(storage)
}

fn filter_merge_history_by_active_workspace(
    storage: &Storage,
) -> Result<Vec<MergeHistoryEntry>, String> {
    match active_workspace_project_filter()? {
        None => storage.list_merge_history(),
        Some(project_keys) if project_keys.is_empty() => Ok(Vec::new()),
        Some(project_keys) => Ok(storage
            .list_all_merge_history()?
            .into_iter()
            .filter(|entry| project_keys.contains(&entry.project_key))
            .take(12)
            .collect()),
    }
}

fn clear_merge_history_by_active_workspace(storage: &Storage) -> Result<usize, String> {
    match active_workspace_project_keys()? {
        None => storage.clear_merge_history(),
        Some(project_keys) => storage.clear_merge_history_for_projects(&project_keys),
    }
}

fn active_proxy_workspace() -> Result<ProjectWorkspaceConfig, String> {
    let paths = ensure_default_configs().map_err(|error| error.to_string())?;
    load_active_project_workspace(&paths).map_err(|error| error.to_string())
}

fn scope_proxy_profile_for_workspace(
    mut profile: ProxyProfile,
    workspace: &ProjectWorkspaceConfig,
) -> ProxyProfile {
    if !workspace.is_system() {
        profile.workspace_key = Some(workspace.key.clone());
    }
    profile
}

fn scope_proxy_pack_for_workspace(
    mut pack: ProxyProfilePack,
    workspace: &ProjectWorkspaceConfig,
) -> ProxyProfilePack {
    if !workspace.is_system() {
        for profile in &mut pack.profiles {
            profile.workspace_key = Some(workspace.key.clone());
        }
    }
    pack
}

fn filter_proxy_config_for_workspace(
    mut config: rdevtool_core::proxy::ProxyConfig,
    workspace: &ProjectWorkspaceConfig,
) -> rdevtool_core::proxy::ProxyConfig {
    if workspace.is_system() {
        return config;
    }

    let profile_ids = config
        .profiles
        .iter()
        .filter(|profile| profile.workspace_key.as_deref() == Some(workspace.key.as_str()))
        .map(|profile| profile.id.clone())
        .collect::<BTreeSet<_>>();
    config
        .profiles
        .retain(|profile| profile_ids.contains(&profile.id));
    config
        .rules
        .retain(|rule| profile_ids.contains(&rule.profile_id));
    config
}

fn filter_proxy_dashboard_by_workspace(
    mut dashboard: ProxyDashboard,
    workspace: &ProjectWorkspaceConfig,
) -> ProxyDashboard {
    if workspace.is_system() {
        return dashboard;
    }

    let profile_ids = dashboard
        .config
        .profiles
        .iter()
        .filter(|profile| profile.workspace_key.as_deref() == Some(workspace.key.as_str()))
        .map(|profile| profile.id.clone())
        .collect::<BTreeSet<_>>();

    dashboard
        .config
        .profiles
        .retain(|profile| profile_ids.contains(&profile.id));
    dashboard
        .config
        .rules
        .retain(|rule| profile_ids.contains(&rule.profile_id));
    dashboard
        .statuses
        .retain(|status| profile_ids.contains(&status.profile_id));
    dashboard
        .events
        .retain(|event| profile_ids.contains(&event.profile_id));
    dashboard
}

fn proxy_dashboard_for_active_workspace(
    runtime: &ProxyRuntimeState,
    path: &Path,
) -> Result<ProxyDashboard, String> {
    let workspace = active_proxy_workspace()?;
    let dashboard = runtime.dashboard(path).map_err(|error| error.to_string())?;
    Ok(filter_proxy_dashboard_by_workspace(dashboard, &workspace))
}

fn select_proxy_profile_for_request_diagnosis(
    config: &rdevtool_core::proxy::ProxyConfig,
    profile: Option<String>,
) -> Result<ProxyProfile, String> {
    if let Some(profile) = optional_editor_string(profile) {
        return config
            .profiles
            .iter()
            .find(|item| item.id == profile || item.name == profile)
            .cloned()
            .ok_or_else(|| format!("代理配置在当前工作区不可见: {}", profile));
    }
    match config.profiles.as_slice() {
        [profile] => Ok(profile.clone()),
        [] => Err("当前工作区没有可用代理配置".to_string()),
        _ => Err("当前工作区有多个代理配置，请指定 profile".to_string()),
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
        "workspacesPath": default_project_workspaces_dir().display().to_string(),
        "navigationPath": navigation_file_path(),
        "proxyPath": default_proxy_path().display().to_string(),
        "storagePath": default_storage_path().display().to_string(),
    })
}

#[tauri::command]
async fn get_workspace_app_preferences() -> Result<WorkspaceAppPreferences, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let config = load_workspace_config(&paths.workspace).map_err(|error| error.to_string())?;
        let active_workspace = active_project_workspace_key(&config);
        let enabled_pages = effective_page_list(config.app.enabled_pages);
        Ok(WorkspaceAppPreferences {
            style_mode: normalize_style_mode(&config.app.style_mode),
            default_page: normalize_default_page_for_enabled_pages(
                config.app.default_page,
                &enabled_pages,
            ),
            enabled_pages,
            active_workspace: Some(active_workspace),
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
        if let Some(active_workspace) = preferences.active_workspace {
            config.app.active_workspace = Some(active_workspace);
        }
        save_workspace_config(&paths.workspace, &config).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_project_workspaces(
    state: tauri::State<'_, AppState>,
) -> Result<ProjectWorkspaceState, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        project_workspace_state(&config)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn set_active_project_workspace(
    state: tauri::State<'_, AppState>,
    workspace_key: String,
) -> Result<ProjectWorkspaceState, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let workspace = load_project_workspace_by_key(&paths.project_workspaces, &workspace_key)
            .map_err(|error| error.to_string())?;
        let mut app_workspace =
            load_workspace_config(&paths.workspace).map_err(|error| error.to_string())?;
        app_workspace.app.active_workspace = Some(workspace.key);
        save_workspace_config(&paths.workspace, &app_workspace)
            .map_err(|error| error.to_string())?;

        let config = config_state.load()?;
        project_workspace_state(&config)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn create_project_workspace_config(
    state: tauri::State<'_, AppState>,
    payload: CreateProjectWorkspacePayload,
) -> Result<ProjectWorkspaceState, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let copy_from = if payload.copy_current {
            if let Some(copy_from_key) = payload
                .copy_from_workspace_key
                .as_deref()
                .map(str::trim)
                .filter(|key| !key.is_empty())
            {
                Some(
                    load_project_workspace_by_key(&paths.project_workspaces, copy_from_key)
                        .map_err(|error| error.to_string())?,
                )
            } else {
                Some(load_active_project_workspace(&paths).map_err(|error| error.to_string())?)
            }
        } else {
            None
        };
        let root_dir = payload
            .root_dir
            .as_ref()
            .and_then(|value| {
                let value = value.trim().to_string();
                (!value.is_empty()).then_some(PathBuf::from(value))
            })
            .or_else(|| {
                payload
                    .independent_dir
                    .then(|| default_project_workspace_root_dir(&payload.key))
            });
        create_project_workspace(
            &paths,
            CreateProjectWorkspaceRequest {
                key: payload.key,
                name: payload.name,
                description: payload.description,
                workspace_type: payload.workspace_type,
                root_dir,
                copy_from,
                activate: payload.activate,
            },
        )
        .map_err(|error| error.to_string())?;

        let config = config_state.load()?;
        project_workspace_state(&config)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn init_demand_workspace_config(
    state: tauri::State<'_, AppState>,
    payload: InitDemandWorkspacePayload,
) -> Result<InitDemandWorkspaceResult, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let config = config_state.load()?;
        init_demand_workspace(
            &paths,
            &config,
            InitDemandWorkspaceRequest {
                key: payload.key,
                demand_id: payload.demand_id,
                name: payload.name,
                description: payload.description,
                workspace_type: payload.workspace_type,
                requirement_dir: PathBuf::from(payload.requirement_dir),
                repo_path: PathBuf::from(payload.repo_path),
                project: payload.project,
                branch: payload.branch,
                root_dir: payload.root_dir.map(PathBuf::from),
                requirement_category: payload.requirement_category,
                requirement_short_label: payload.requirement_short_label,
                requirement_entry_name: payload.requirement_entry_name,
                activate: payload.activate,
            },
        )
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_project_workspace_editor(
    state: tauri::State<'_, AppState>,
    workspace_key: Option<String>,
) -> Result<ProjectWorkspaceEditorState, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        project_workspace_editor_state(&config, workspace_key)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_project_workspace_editor(
    state: tauri::State<'_, AppState>,
    draft: ProjectWorkspaceEditorDraft,
) -> Result<ProjectWorkspaceEditorState, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        save_project_workspace_editor_state(&config, draft)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_proxy_dashboard(state: tauri::State<'_, AppState>) -> Result<ProxyDashboard, String> {
    let runtime = state.proxy_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = ensure_proxy_config().map_err(|error| error.to_string())?;
        proxy_dashboard_for_active_workspace(&runtime, &path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn diagnose_proxy_request(
    profile: Option<String>,
    method: String,
    url: String,
    headers: Option<BTreeMap<String, String>>,
) -> Result<ProxyRequestDiagnosis, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = ensure_proxy_config().map_err(|error| error.to_string())?;
        let workspace = active_proxy_workspace()?;
        let config = filter_proxy_config_for_workspace(
            load_proxy_config(&path).map_err(|error| error.to_string())?,
            &workspace,
        );
        let selected_profile = select_proxy_profile_for_request_diagnosis(&config, profile)?;
        core_diagnose_proxy_request(
            &config,
            &selected_profile.id,
            &method,
            &url,
            &headers.unwrap_or_default(),
        )
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_proxy_profile(
    state: tauri::State<'_, AppState>,
    profile: ProxyProfile,
) -> Result<ProxyDashboard, String> {
    let runtime = state.proxy_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = active_proxy_workspace()?;
        let profile = scope_proxy_profile_for_workspace(profile, &workspace);
        validate_proxy_profile(&profile).map_err(|error| error.to_string())?;
        let path = ensure_proxy_config().map_err(|error| error.to_string())?;
        upsert_proxy_profile(&path, profile).map_err(|error| error.to_string())?;
        proxy_dashboard_for_active_workspace(&runtime, &path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn delete_proxy_profile(
    state: tauri::State<'_, AppState>,
    profile_id: String,
) -> Result<ProxyDashboard, String> {
    let runtime = state.proxy_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = ensure_proxy_config().map_err(|error| error.to_string())?;
        runtime.stop_profile(&profile_id);
        core_delete_proxy_profile(&path, &profile_id).map_err(|error| error.to_string())?;
        runtime.clear_events(Some(&profile_id));
        proxy_dashboard_for_active_workspace(&runtime, &path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_proxy_rule(
    state: tauri::State<'_, AppState>,
    rule: ProxyRule,
) -> Result<ProxyDashboard, String> {
    let runtime = state.proxy_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        validate_proxy_rule(&rule).map_err(|error| error.to_string())?;
        let path = ensure_proxy_config().map_err(|error| error.to_string())?;
        upsert_proxy_rule(&path, rule).map_err(|error| error.to_string())?;
        proxy_dashboard_for_active_workspace(&runtime, &path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn delete_proxy_rule(
    state: tauri::State<'_, AppState>,
    rule_id: String,
) -> Result<ProxyDashboard, String> {
    let runtime = state.proxy_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = ensure_proxy_config().map_err(|error| error.to_string())?;
        core_delete_proxy_rule(&path, &rule_id).map_err(|error| error.to_string())?;
        proxy_dashboard_for_active_workspace(&runtime, &path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn start_proxy_profile(
    state: tauri::State<'_, AppState>,
    profile_id: String,
) -> Result<ProxyDashboard, String> {
    let runtime = state.proxy_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = ensure_proxy_config().map_err(|error| error.to_string())?;
        let config = load_proxy_config(&path).map_err(|error| error.to_string())?;
        let profile = config
            .profiles
            .iter()
            .find(|item| item.id == profile_id)
            .ok_or_else(|| format!("代理配置不存在：{profile_id}"))?;
        validate_proxy_profile(profile).map_err(|error| error.to_string())?;
        runtime
            .start_profile(path.clone(), profile_id)
            .map_err(|error| error.to_string())?;
        proxy_dashboard_for_active_workspace(&runtime, &path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn stop_proxy_profile(
    state: tauri::State<'_, AppState>,
    profile_id: String,
) -> Result<ProxyDashboard, String> {
    let runtime = state.proxy_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = ensure_proxy_config().map_err(|error| error.to_string())?;
        runtime.stop_profile(&profile_id);
        proxy_dashboard_for_active_workspace(&runtime, &path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn clear_proxy_events(
    state: tauri::State<'_, AppState>,
    profile_id: Option<String>,
) -> Result<ProxyDashboard, String> {
    let runtime = state.proxy_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = ensure_proxy_config().map_err(|error| error.to_string())?;
        let workspace = active_proxy_workspace()?;
        if let Some(profile_id) = profile_id.as_deref() {
            runtime.clear_events(Some(profile_id));
        } else if workspace.is_system() {
            runtime.clear_events(None);
        } else {
            let config = load_proxy_config(&path).map_err(|error| error.to_string())?;
            for profile in config
                .profiles
                .iter()
                .filter(|profile| profile.workspace_key.as_deref() == Some(workspace.key.as_str()))
            {
                runtime.clear_events(Some(&profile.id));
            }
        }
        proxy_dashboard_for_active_workspace(&runtime, &path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn export_proxy_profile_pack(
    state: tauri::State<'_, AppState>,
    profile_id: String,
    path: String,
) -> Result<ProxyDashboard, String> {
    let runtime = state.proxy_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let target_path = PathBuf::from(path);
        if target_path.as_os_str().is_empty() {
            return Err("导出路径不能为空".to_string());
        }
        let config_path = ensure_proxy_config().map_err(|error| error.to_string())?;
        let pack = core_export_proxy_profile_pack(&config_path, &profile_id)
            .map_err(|error| error.to_string())?;
        let content = serde_json::to_string_pretty(&pack).map_err(|error| error.to_string())?;
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(&target_path, content).map_err(|error| error.to_string())?;
        proxy_dashboard_for_active_workspace(&runtime, &config_path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn import_proxy_profile_pack(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<ProxyDashboard, String> {
    let runtime = state.proxy_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let source_path = PathBuf::from(path);
        if source_path.as_os_str().is_empty() {
            return Err("导入路径不能为空".to_string());
        }
        let content = fs::read_to_string(&source_path).map_err(|error| error.to_string())?;
        let pack: ProxyProfilePack =
            serde_json::from_str(&content).map_err(|error| error.to_string())?;
        let workspace = active_proxy_workspace()?;
        let pack = scope_proxy_pack_for_workspace(pack, &workspace);
        let config_path = ensure_proxy_config().map_err(|error| error.to_string())?;
        core_import_proxy_profile_pack(&config_path, pack).map_err(|error| error.to_string())?;
        proxy_dashboard_for_active_workspace(&runtime, &config_path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn bind_proxy_runtime_profile_config(
    state: tauri::State<'_, AppState>,
    request: BindProxyRuntimeRequest,
) -> Result<BindProxyRuntimeResult, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let mut config = config_state.load()?;
        let proxy_path = ensure_proxy_config().map_err(|error| error.to_string())?;
        let proxy_config = load_proxy_config(&proxy_path).map_err(|error| error.to_string())?;
        let result = bind_proxy_runtime_profile(&mut config, &proxy_config, request)
            .map_err(|error| error.to_string())?;
        save_config(&paths.projects, &config).map_err(|error| error.to_string())?;
        config_state.invalidate()?;
        Ok(result)
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

fn normalize_focus_auto_open_mode(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "started" | "start" | "immediate" => "started".to_string(),
        "manual" | "off" | "none" => "manual".to_string(),
        _ => "ready".to_string(),
    }
}

fn normalize_multiline_config_list(value: &str, fallback: Vec<String>) -> Vec<String> {
    let items = value
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .collect::<Vec<_>>();
    if items.is_empty() { fallback } else { items }
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
        other => Err(format!("unsupported build param type: {}", other)),
    }
}

fn build_target_adapter_key(adapter: &BuildTargetAdapter) -> &'static str {
    match adapter {
        BuildTargetAdapter::Jenkins => "jenkins",
        BuildTargetAdapter::LocalCommand => "local_command",
        BuildTargetAdapter::RSeriesPackage => "r_series_package",
    }
}

fn build_target_adapter_from_key(value: &str) -> Result<BuildTargetAdapter, String> {
    match value.trim() {
        "" | "jenkins" => Ok(BuildTargetAdapter::Jenkins),
        "local_command" => Ok(BuildTargetAdapter::LocalCommand),
        "r_series_package" => Ok(BuildTargetAdapter::RSeriesPackage),
        other => Err(format!("unsupported build adapter: {}", other)),
    }
}

fn build_action_kind_key(action_kind: &BuildActionKind) -> &'static str {
    match action_kind {
        BuildActionKind::Build => "build",
        BuildActionKind::Deploy => "deploy",
        BuildActionKind::Package => "package",
        BuildActionKind::Release => "release",
    }
}

fn build_action_kind_from_key(value: &str) -> Result<BuildActionKind, String> {
    match value.trim() {
        "" | "deploy" => Ok(BuildActionKind::Deploy),
        "build" => Ok(BuildActionKind::Build),
        "package" => Ok(BuildActionKind::Package),
        "release" => Ok(BuildActionKind::Release),
        other => Err(format!("unsupported build action kind: {}", other)),
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
        rdev_proxy_profile_id: profile.rdev_proxy_profile_id.clone(),
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
            rdev_proxy_profile_id: optional_editor_string(profile.rdev_proxy_profile_id),
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

fn prepare_rdev_proxy_runtime_profile(
    config: &mut AppConfig,
    proxy_runtime: &ProxyRuntimeState,
    runtime_profile_key: Option<&str>,
) -> Result<(), String> {
    let Some(runtime_profile_key) = runtime_profile_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(());
    };
    let Some(profile) = config
        .defaults
        .runtime_profiles
        .iter_mut()
        .find(|profile| profile.key == runtime_profile_key)
    else {
        return Err(format!("运行配置不存在: {}", runtime_profile_key));
    };
    let Some(proxy_profile_id) = profile
        .rdev_proxy_profile_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
    else {
        return Ok(());
    };

    let path = ensure_proxy_config().map_err(|error| error.to_string())?;
    let proxy_config = load_proxy_config(&path).map_err(|error| error.to_string())?;
    let proxy_profile = proxy_config
        .profiles
        .iter()
        .find(|item| item.id == proxy_profile_id.as_str())
        .ok_or_else(|| {
            format!(
                "运行配置 {} 绑定的代理服务不存在: {}",
                profile.key, proxy_profile_id
            )
        })?;
    validate_proxy_profile(proxy_profile).map_err(|error| error.to_string())?;
    let status = proxy_runtime
        .ensure_profile_running(path.clone(), proxy_profile_id)
        .map_err(|error| error.to_string())?;
    profile.proxy_url = status.listen_url;
    if profile.proxy_bypass.trim().is_empty() {
        profile.proxy_bypass = "localhost;127.0.0.1;::1".to_string();
    }
    Ok(())
}

fn project_runtime_profile_key(
    config: &AppConfig,
    project_key: &str,
    debug_profile_key: Option<&str>,
) -> Result<Option<String>, String> {
    let Some(debug_profile_key) = debug_profile_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    let project = config
        .find_project(project_key)
        .map_err(|error| error.to_string())?;
    let profile = project
        .debug_profiles
        .iter()
        .find(|profile| profile.key == debug_profile_key)
        .ok_or_else(|| format!("调试档案不存在: {}", debug_profile_key))?;
    Ok(optional_editor_string(profile.runtime_profile.clone()))
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
            auto_open_mode: project.focus.auto_open_mode.clone(),
            after_ready_actions_text: project.focus.after_ready_actions.join("\n"),
            ready_enabled: project.focus.ready.enabled,
            ready_timeout_ms: project.focus.ready.timeout_ms,
            ready_url_patterns_text: project.focus.ready.url_patterns.join("\n"),
            ready_success_markers_text: project.focus.ready.success_markers.join("\n"),
            ready_failure_markers_text: project.focus.ready.failure_markers.join("\n"),
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
                adapter: build_target_adapter_key(&target.adapter).to_string(),
                action_kind: build_action_kind_key(&target.action_kind).to_string(),
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
        let target_key = validate_config_key("构建目标", &target.key)?;
        if !target_keys.insert(target_key.clone()) {
            return Err(format!("构建目标 key 重复: {}", target_key));
        }
        let label = target.label.trim();
        let jenkins_profile = target.jenkins_profile.trim();
        let job_name = target.job_name.trim();
        let adapter = build_target_adapter_from_key(&target.adapter)?;
        if label.is_empty() {
            return Err(format!("构建目标 {} 的名称不能为空", target_key));
        }
        if adapter == BuildTargetAdapter::Jenkins && jenkins_profile.is_empty() {
            return Err(format!(
                "构建目标 {} 的 Jenkins Profile 不能为空",
                target_key
            ));
        }
        if adapter == BuildTargetAdapter::Jenkins && job_name.is_empty() {
            return Err(format!("构建目标 {} 的 Job Name 不能为空", target_key));
        }

        let mut param_keys = std::collections::BTreeSet::new();
        let mut params = Vec::with_capacity(target.params.len());
        for param in target.params {
            let param_key = validate_config_key("参数", &param.key)?;
            if !param_keys.insert(param_key.clone()) {
                return Err(format!(
                    "构建目标 {} 参数 key 重复: {}",
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
            adapter,
            action_kind: build_action_kind_from_key(&target.action_kind)?,
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
            auto_open_mode: normalize_focus_auto_open_mode(&request.focus.auto_open_mode),
            after_ready_actions: normalize_multiline_config_list(
                &request.focus.after_ready_actions_text,
                Vec::new(),
            ),
            ready: ProjectReadyConfig {
                enabled: request.focus.ready_enabled,
                timeout_ms: request.focus.ready_timeout_ms.clamp(1_000, 600_000),
                url_patterns: normalize_multiline_config_list(
                    &request.focus.ready_url_patterns_text,
                    ProjectReadyConfig::default().url_patterns,
                ),
                success_markers: normalize_multiline_config_list(
                    &request.focus.ready_success_markers_text,
                    ProjectReadyConfig::default().success_markers,
                ),
                failure_markers: normalize_multiline_config_list(
                    &request.focus.ready_failure_markers_text,
                    ProjectReadyConfig::default().failure_markers,
                ),
            },
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
                    "build target {} not found for project {}",
                    request.target_key, request.project_key
                )
            })?;

        let label = request.label.trim();
        let jenkins_profile = request.jenkins_profile.trim();
        let job_name = request.job_name.trim();
        if label.is_empty() {
            return Err("构建名称不能为空".to_string());
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
        let config = apply_active_workspace_context(&config)?;
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
        let config = apply_active_workspace_context(&config)?;
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
        let config = apply_active_workspace_context(&config)?;
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
        let config = apply_active_workspace_context(&config)?;
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
        let config = apply_active_workspace_context(&config)?;
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
        let config = apply_active_workspace_context(&config)?;
        deploy_target_meta(&config, &project, target.as_deref()).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_build_target_meta(
    state: tauri::State<'_, AppState>,
    project: String,
    target: Option<String>,
) -> Result<DeployTargetMeta, String> {
    get_deploy_target_meta(state, project, target).await
}

#[tauri::command]
async fn build_deploy_plan(
    state: tauri::State<'_, AppState>,
    request: DeployRequest,
) -> Result<DeployPlan, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        let config = apply_active_workspace_context(&config)?;
        build_plan(&config, &request).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn preview_build_plan(
    state: tauri::State<'_, AppState>,
    request: DeployRequest,
) -> Result<DeployPlan, String> {
    build_deploy_plan(state, request).await
}

#[tauri::command]
async fn trigger_build(
    state: tauri::State<'_, AppState>,
    request: DeployRequest,
) -> Result<BuildTriggerResponse, String> {
    let config_state = state.config_state.clone();
    let runtime = state.project_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        let config = apply_active_workspace_context(&config)?;
        trigger_build_for_desktop(&runtime, &config, request)
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
    let runtime = state.project_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        let config = apply_active_workspace_context(&config)?;
        if let Some(project) = request.project.as_deref().filter(|value| !value.is_empty()) {
            return refresh_runtime_build_status(&runtime, &config, project);
        }
        refresh_deploy_status(&config, &request).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn trigger_build_for_desktop(
    runtime: &ProjectRuntimeState,
    config: &AppConfig,
    request: DeployRequest,
) -> Result<BuildTriggerResponse, String> {
    let plan = build_plan(config, &request).map_err(|error| error.to_string())?;
    let project = config
        .find_project(&plan.project_key)
        .map_err(|error| error.to_string())?;
    let target = project
        .deploy_targets
        .iter()
        .find(|item| item.key == plan.job_kind)
        .ok_or_else(|| format!("构建目标不存在: {}", plan.job_kind))?;

    if !matches!(
        target.adapter,
        BuildTargetAdapter::LocalCommand | BuildTargetAdapter::RSeriesPackage
    ) {
        return trigger_deploy(config, &request).map_err(|error| error.to_string());
    }

    let command = plan
        .command
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "本地构建命令为空".to_string())?;
    let cwd = plan
        .cwd
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "本地构建目录为空".to_string())?;
    let env = core_build::local_execution_env(
        project,
        target,
        &plan.params,
        &command,
        &cwd,
        plan.output_dir.as_deref(),
    );
    let snapshot =
        runtime.run_build_command(config, &plan.project_key, command, PathBuf::from(&cwd), env)?;

    Ok(build_response_from_runtime_snapshot(plan, snapshot))
}

fn refresh_runtime_build_status(
    runtime: &ProjectRuntimeState,
    config: &AppConfig,
    project: &str,
) -> Result<BuildStatusResponse, String> {
    let snapshots = runtime.list_selected(config, &[project.to_string()])?;
    let snapshot = snapshots
        .into_iter()
        .next()
        .ok_or_else(|| format!("项目不存在: {}", project))?;
    Ok(BuildStatusResponse {
        queue_url: None,
        build_url: None,
        state_key: runtime_build_state_key(&snapshot).to_string(),
        state_label: snapshot.build_status_label.clone(),
        detail: runtime_build_detail(&snapshot),
    })
}

fn build_response_from_runtime_snapshot(
    plan: DeployPlan,
    snapshot: ProjectRuntimeSnapshot,
) -> BuildTriggerResponse {
    let state_key = runtime_build_state_key(&snapshot).to_string();
    let detail = runtime_build_detail_with_plan(&snapshot, Some(&plan));
    BuildTriggerResponse {
        plan,
        status: runtime_build_status_code(&state_key),
        queue_url: None,
        build_url: None,
        state_key,
        state_label: snapshot.build_status_label.clone(),
        detail,
    }
}

fn runtime_build_state_key(snapshot: &ProjectRuntimeSnapshot) -> &str {
    match snapshot.build_status_key.as_str() {
        "succeeded" => "success",
        "failed" | "exited" | "invalidConfig" | "notConfigured" => "failure",
        "running" => "running",
        "stopped" => "cancelled",
        other => other,
    }
}

fn runtime_build_status_code(state_key: &str) -> u16 {
    match state_key {
        "running" => 202,
        "success" | "succeeded" => 0,
        _ => 1,
    }
}

fn runtime_build_detail(snapshot: &ProjectRuntimeSnapshot) -> String {
    runtime_build_detail_with_plan(snapshot, None)
}

fn runtime_build_detail_with_plan(
    snapshot: &ProjectRuntimeSnapshot,
    plan: Option<&DeployPlan>,
) -> String {
    let mut parts = vec![snapshot.build_detail.clone()];
    if let Some(pid) = snapshot.build_pid {
        parts.push(format!("PID: {}", pid));
    }
    if let Some(command) = plan
        .and_then(|value| value.command.as_deref())
        .or(snapshot.build_command.as_deref())
    {
        parts.push(format!("命令: {}", command));
    }
    if let Some(cwd) = plan
        .and_then(|value| value.cwd.as_deref())
        .or(snapshot.build_cwd.as_deref())
    {
        parts.push(format!("目录: {}", cwd));
    }
    if let Some(output_dir) = plan
        .and_then(|value| value.output_dir.as_deref())
        .or(snapshot.build_output_dir.as_deref())
    {
        parts.push(format!("产物: {}", output_dir));
    }
    if let Some(log_path) = snapshot.build_log_path.as_deref() {
        parts.push(format!("日志: {}", log_path));
    }
    parts.join("\n")
}

#[tauri::command]
async fn execute_branch_merge(
    state: tauri::State<'_, AppState>,
    request: MergeRequest,
) -> Result<MergeResponse, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        let config = apply_active_workspace_context(&config)?;
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
        let config = apply_active_workspace_context(&config)?;
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
        let config = apply_active_workspace_context(&config)?;
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
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let workspace = load_active_project_workspace(&paths).map_err(|error| error.to_string())?;
        let config = config_state.load()?;
        let config = apply_project_workspace_context(&config, &workspace);
        let result =
            checkout_branch_to_directory(&config, &request).map_err(|error| error.to_string())?;
        if !workspace.is_system() && result.success {
            if let Some(output_path) = result
                .items
                .iter()
                .find(|item| item.success)
                .and_then(|item| item.output_path.as_deref())
                .filter(|value| !value.trim().is_empty())
            {
                set_project_workspace_instance(
                    &paths,
                    &workspace.key,
                    &request.project,
                    PathBuf::from(output_path),
                    true,
                )
                .map_err(|error| error.to_string())?;
            }
        }
        Ok(result)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn create_project_workspace_project_copy(
    state: tauri::State<'_, AppState>,
    workspace_key: Option<String>,
    project: String,
) -> Result<ProjectWorkspaceEditorState, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let workspace = load_project_workspace_for_editor(&paths, workspace_key)?;
        if workspace.is_system() {
            return Err("全局工作区不能创建项目副本".to_string());
        }
        let root_dir = workspace
            .root_dir
            .clone()
            .ok_or_else(|| "当前工作区未配置工作区目录".to_string())?;
        let project_key = project.trim().to_string();
        if project_key.is_empty() {
            return Err("项目不能为空".to_string());
        }
        if workspace.project_instance_path(&project_key).is_some() {
            return Err("当前项目已经绑定了工作区目录".to_string());
        }

        let config = config_state.load()?;
        let project_config = config
            .find_project(&project_key)
            .map_err(|error| error.to_string())?;
        let repo_path = project_config
            .repo_path
            .as_ref()
            .ok_or_else(|| "项目未配置默认目录，无法创建工作区副本".to_string())?;
        let branch = git::current_branch(repo_path)
            .map_err(|error| format!("无法读取项目当前分支: {error}"))?;
        if branch.trim().is_empty() {
            return Err("项目当前分支为空，无法创建工作区副本".to_string());
        }

        let destination = root_dir.join("projects").join(&project_key);
        let request = BranchCheckoutRequest {
            project: project_key.clone(),
            source_branch: branch,
            destination_dir: destination.display().to_string(),
        };
        let result =
            checkout_branch_to_directory(&config, &request).map_err(|error| error.to_string())?;
        if !result.success {
            let detail = result
                .items
                .iter()
                .find_map(|item| {
                    (!item.success).then(|| {
                        let detail = item.detail.trim();
                        if detail.is_empty() {
                            item.summary.clone()
                        } else {
                            detail.to_string()
                        }
                    })
                })
                .unwrap_or_else(|| "创建工作区副本失败".to_string());
            return Err(detail);
        }
        set_project_workspace_instance(&paths, &workspace.key, &project_key, destination, true)
            .map_err(|error| error.to_string())?;
        let config = config_state.load()?;
        project_workspace_editor_state(&config, Some(workspace.key))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn bind_project_workspace_project_directory(
    state: tauri::State<'_, AppState>,
    workspace_key: Option<String>,
    project: String,
    path: String,
) -> Result<ProjectWorkspaceEditorState, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let workspace = load_project_workspace_for_editor(&paths, workspace_key)?;
        if workspace.is_system() {
            return Err("全局工作区不能绑定项目目录".to_string());
        }
        let project_key = project.trim().to_string();
        if project_key.is_empty() {
            return Err("项目不能为空".to_string());
        }
        let path = PathBuf::from(path.trim());
        if path.as_os_str().is_empty() {
            return Err("目录不能为空".to_string());
        }
        let path = if path.is_absolute() {
            path
        } else if let Some(root_dir) = workspace.root_dir.as_ref() {
            root_dir.join(path)
        } else {
            return Err("相对目录需要先配置工作区目录".to_string());
        };
        if !path.exists() {
            return Err(format!("目录不存在: {}", path.display()));
        }
        if !path.is_dir() {
            return Err(format!("目标不是目录: {}", path.display()));
        }
        let config = config_state.load()?;
        config
            .find_project(&project_key)
            .map_err(|error| error.to_string())?;
        set_project_workspace_instance(&paths, &workspace.key, &project_key, path, false)
            .map_err(|error| error.to_string())?;
        let config = config_state.load()?;
        project_workspace_editor_state(&config, Some(workspace.key))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn unbind_project_workspace_project_directory(
    state: tauri::State<'_, AppState>,
    workspace_key: Option<String>,
    project: String,
) -> Result<ProjectWorkspaceEditorState, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let mut workspace = load_project_workspace_for_editor(&paths, workspace_key)?;
        if workspace.is_system() {
            return Err("全局工作区不能解绑项目目录".to_string());
        }
        let project_key = project.trim().to_string();
        if project_key.is_empty() {
            return Err("项目不能为空".to_string());
        }
        workspace
            .project_instances
            .retain(|instance| instance.project != project_key);
        let workspace_key = workspace.key.clone();
        let path = paths
            .project_workspaces
            .join(format!("{}.toml", workspace.key));
        save_project_workspace_config(&path, &workspace.normalized())
            .map_err(|error| error.to_string())?;
        let config = config_state.load()?;
        project_workspace_editor_state(&config, Some(workspace_key))
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
        let config = apply_active_workspace_context(&config)?;
        execute_branch_switch(&config, &request).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_project_worktrees(
    state: tauri::State<'_, AppState>,
    project: String,
) -> Result<Vec<BranchWorktreeSummary>, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let workspace = load_active_project_workspace(&paths).map_err(|error| error.to_string())?;
        let config = config_state.load()?;
        let config = apply_project_workspace_context(&config, &workspace);
        let mut items = project_worktrees(&config, &project).map_err(|error| error.to_string())?;
        if let Some(instance) = workspace
            .project_instances
            .iter()
            .find(|instance| instance.project == project)
        {
            for item in &mut items {
                if same_path(Path::new(&item.repo_path), &instance.path) {
                    item.is_workspace_instance = true;
                    item.managed = instance.managed;
                    if item.label == "默认目录" {
                        item.label = "工作区副本".to_string();
                    }
                }
            }
        }
        Ok(items)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_project_push_status(
    state: tauri::State<'_, AppState>,
    project: String,
    repo_path: Option<String>,
) -> Result<BranchPushStatus, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        let config = apply_active_workspace_context(&config)?;
        branch_push_status(&config, &project, repo_path.as_deref())
            .map_err(|error| error.to_string())
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
        let config = apply_active_workspace_context(&config)?;
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
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let workspace = load_active_project_workspace(&paths).map_err(|error| error.to_string())?;
        load_navigation_data_for_workspace(&workspace).map_err(|error| error.to_string())
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
    let proxy_runtime = state.proxy_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut config = config_state.load()?;
        prepare_rdev_proxy_runtime_profile(
            &mut config,
            &proxy_runtime,
            entry.runtime_profile.as_deref(),
        )?;
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
    let proxy_runtime = state.proxy_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut config = config_state.load()?;
        prepare_rdev_proxy_runtime_profile(
            &mut config,
            &proxy_runtime,
            entry.runtime_profile.as_deref(),
        )?;
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
    let proxy_runtime = state.proxy_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut config = config_state.load()?;
        prepare_rdev_proxy_runtime_profile(
            &mut config,
            &proxy_runtime,
            entry.runtime_profile.as_deref(),
        )?;
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
    let proxy_runtime = state.proxy_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut config = config_state.load()?;
        prepare_rdev_proxy_runtime_profile(
            &mut config,
            &proxy_runtime,
            entry.runtime_profile.as_deref(),
        )?;
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
    let proxy_runtime = state.proxy_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut config = config_state.load()?;
        prepare_rdev_proxy_runtime_profile(
            &mut config,
            &proxy_runtime,
            entry.runtime_profile.as_deref(),
        )?;
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
async fn get_workspace_pinned_actions_overview(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<WorkspacePinnedActionsOverview>, String> {
    let storage = state.storage.clone();
    let config_state = state.config_state.clone();
    let proxy_runtime = state.proxy_runtime.clone();
    let project_runtime = state.project_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        workspace_pinned_actions_overview(&config, &storage, &proxy_runtime, &project_runtime)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_workspace_ai_context(
    state: tauri::State<'_, AppState>,
    workspace_key: String,
    options: Option<WorkspaceAiContextOptions>,
) -> Result<WorkspaceAiContextResponse, String> {
    let storage = state.storage.clone();
    let config_state = state.config_state.clone();
    let proxy_runtime = state.proxy_runtime.clone();
    let project_runtime = state.project_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        workspace_ai_context_response(
            &config,
            &storage,
            &proxy_runtime,
            &project_runtime,
            workspace_key,
            options,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn execute_tray_pinned_action(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    action: TrayReplayAction,
) -> Result<(), String> {
    let replay_guard = state.tray_replay_running.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if replay_guard.swap(true, Ordering::AcqRel) {
            return Err("已有快捷动作正在执行".to_string());
        }

        let result = execute_tray_replay_action(&app, &action);
        replay_guard.store(false, Ordering::Release);
        result
    })
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
async fn list_build_history(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<BuildHistoryEntry>, String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || filter_build_history_by_active_workspace(&storage))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_build_history(
    state: tauri::State<'_, AppState>,
    request: SaveBuildHistoryRequest,
) -> Result<(), String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || storage.save_deploy_history(request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn clear_build_history(state: tauri::State<'_, AppState>) -> Result<usize, String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || clear_build_history_by_active_workspace(&storage))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_deploy_history(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DeployHistoryEntry>, String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || {
        filter_deploy_history_by_active_workspace(&storage)
    })
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
    tauri::async_runtime::spawn_blocking(move || clear_deploy_history_by_active_workspace(&storage))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_merge_history(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<MergeHistoryEntry>, String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || filter_merge_history_by_active_workspace(&storage))
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
    tauri::async_runtime::spawn_blocking(move || clear_merge_history_by_active_workspace(&storage))
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
        let config = apply_active_workspace_context(&config)?;
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
        let config = apply_active_workspace_context(&config)?;
        runtime.list_selected(&config, &projects)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn preflight_project_runtime(
    state: tauri::State<'_, AppState>,
    project: String,
    debug_profile: Option<String>,
) -> Result<ProjectRuntimePreflightResponse, String> {
    let runtime = state.project_runtime.clone();
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        let config = apply_active_workspace_context(&config)?;
        runtime.preflight(
            &config,
            &project,
            optional_editor_string(debug_profile).as_deref(),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn inspect_project_runtime(
    state: tauri::State<'_, AppState>,
    project: String,
    debug_profile: Option<String>,
) -> Result<core_runtime::ProjectRuntimeInspectResponse, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        let config = apply_active_workspace_context(&config)?;
        let proxy_config =
            load_proxy_config(&default_proxy_path()).map_err(|error| error.to_string())?;
        core_runtime::inspect_project_runtime(
            &config,
            &proxy_config,
            &project,
            optional_editor_string(debug_profile).as_deref(),
        )
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
    let proxy_runtime = state.proxy_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut config = config_state.load()?;
        let debug_profile_key = optional_editor_string(debug_profile);
        let runtime_profile_key =
            project_runtime_profile_key(&config, &project, debug_profile_key.as_deref())?;
        prepare_rdev_proxy_runtime_profile(
            &mut config,
            &proxy_runtime,
            runtime_profile_key.as_deref(),
        )?;
        let config = apply_active_workspace_context(&config)?;
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
            .map(|project| {
                project.focus.auto_on_start
                    && project
                        .focus
                        .auto_open_mode
                        .trim()
                        .eq_ignore_ascii_case("started")
            })
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
    let proxy_runtime = state.proxy_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut config = config_state.load()?;
        let debug_profile_key = optional_editor_string(debug_profile);
        let runtime_profile_key =
            project_runtime_profile_key(&config, &project, debug_profile_key.as_deref())?;
        prepare_rdev_proxy_runtime_profile(
            &mut config,
            &proxy_runtime,
            runtime_profile_key.as_deref(),
        )?;
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

#[tauri::command]
async fn clear_project_runtime_log(
    state: tauri::State<'_, AppState>,
    project: String,
    kind: ProjectRuntimeLogKind,
) -> Result<ProjectRuntimeLogResponse, String> {
    let runtime = state.project_runtime.clone();
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        runtime.clear_log(&config, &project, kind)
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
        .take(TRAY_PINNED_STORAGE_LIMIT)
        .collect()
}

fn action_project_allowed(
    action: &TrayReplayAction,
    project_filter: Option<&BTreeSet<String>>,
) -> bool {
    match project_filter {
        None => true,
        Some(project_keys) if project_keys.is_empty() => false,
        Some(project_keys) => action
            .project_key
            .as_deref()
            .is_none_or(|project_key| project_keys.contains(project_key)),
    }
}

fn json_string(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(value) => value.clone(),
        serde_json::Value::Null => String::new(),
        serde_json::Value::Bool(_) | serde_json::Value::Number(_) => value.to_string(),
        _ => serde_json::to_string(value).unwrap_or_default(),
    }
}

fn normalized_params(value: Option<&serde_json::Value>) -> BTreeMap<String, String> {
    let Some(serde_json::Value::Object(values)) = value else {
        return BTreeMap::new();
    };
    values
        .iter()
        .map(|(key, value)| (key.clone(), json_string(value)))
        .collect()
}

fn build_history_matches_pinned_action(
    action: &TrayReplayAction,
    build_history: &[BuildHistoryEntry],
) -> bool {
    let Some(serde_json::Value::Object(payload)) = action.payload.as_ref() else {
        return false;
    };
    let project_key = payload
        .get("project")
        .and_then(|value| value.as_str())
        .or(action.project_key.as_deref())
        .unwrap_or_default();
    let target = payload
        .get("target")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let params = normalized_params(payload.get("params"));

    build_history.iter().any(|entry| {
        entry.project_key == project_key
            && entry.mode == target
            && normalized_params(Some(&entry.params)) == params
    })
}

fn branch_history_items(storage: &Storage) -> Vec<serde_json::Value> {
    storage
        .get_json(
            BRANCH_WORKFLOW_STORAGE_NAMESPACE,
            BRANCH_WORKFLOW_HISTORY_KEY,
        )
        .ok()
        .flatten()
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
}

fn branch_history_entry_allowed(
    entry: &serde_json::Value,
    project_filter: Option<&BTreeSet<String>>,
) -> bool {
    match project_filter {
        None => true,
        Some(project_keys) if project_keys.is_empty() => false,
        Some(project_keys) => entry
            .get("items")
            .and_then(|value| value.as_array())
            .is_some_and(|items| {
                items.iter().any(|item| {
                    item.get("projectKey")
                        .and_then(|value| value.as_str())
                        .is_some_and(|project_key| project_keys.contains(project_key))
                })
            }),
    }
}

fn branch_history_matches_pinned_action(
    action: &TrayReplayAction,
    branch_history: &[serde_json::Value],
    project_filter: Option<&BTreeSet<String>>,
) -> bool {
    let Some(serde_json::Value::Object(payload)) = action.payload.as_ref() else {
        return false;
    };
    let Some(command) = payload.get("command") else {
        return false;
    };
    let Some(request) = payload.get("request") else {
        return false;
    };

    branch_history.iter().any(|entry| {
        branch_history_entry_allowed(entry, project_filter)
            && entry
                .get("replay")
                .and_then(|value| value.as_object())
                .is_some_and(|replay| {
                    replay.get("command") == Some(command) && replay.get("request") == Some(request)
                })
    })
}

fn tray_pinned_actions_for_menu(storage: &Storage) -> Vec<TrayReplayAction> {
    let actions = tray_pinned_actions(storage);
    if actions.is_empty() {
        return actions;
    }

    let project_filter = match active_workspace_project_filter() {
        Ok(value) => value,
        Err(error) => {
            eprintln!(
                "failed to filter tray pinned actions by workspace: {}",
                error
            );
            None
        }
    };
    let build_history = filter_build_history_by_active_workspace(storage).unwrap_or_else(|error| {
        eprintln!("failed to filter tray pinned build history: {}", error);
        Vec::new()
    });
    let branch_history = branch_history_items(storage);

    actions
        .into_iter()
        .filter(|action| {
            if !action_project_allowed(action, project_filter.as_ref()) {
                return false;
            }
            match action.kind.as_str() {
                "build.replay" | "deploy.replay" => {
                    build_history_matches_pinned_action(action, &build_history)
                }
                "branch.replay" => branch_history_matches_pinned_action(
                    action,
                    &branch_history,
                    project_filter.as_ref(),
                ),
                _ => true,
            }
        })
        .take(TRAY_PINNED_MENU_LIMIT)
        .collect()
}

fn tray_action_kind_label(kind: &str) -> String {
    match kind {
        "build.replay" | "deploy.replay" => "构建".to_string(),
        "branch.replay" => "分支".to_string(),
        "finder.shortcut.open" => "入口".to_string(),
        "project.runtime.start" => "启动".to_string(),
        "project.runtime.focus" => "聚焦".to_string(),
        "project.build.run" => "构建".to_string(),
        "project.build.openOutput" | "project.openDirectory" => "打开".to_string(),
        _ => "动作".to_string(),
    }
}

fn tray_action_confirm_required(kind: &str) -> bool {
    matches!(
        kind,
        "build.replay"
            | "deploy.replay"
            | "branch.replay"
            | "project.runtime.start"
            | "project.build.run"
    )
}

fn branch_action_project_keys(action: &TrayReplayAction) -> BTreeSet<String> {
    let Some(serde_json::Value::Object(payload)) = action.payload.as_ref() else {
        return BTreeSet::new();
    };
    let Some(serde_json::Value::Object(request)) = payload.get("request") else {
        return BTreeSet::new();
    };

    let mut keys = BTreeSet::new();
    if let Some(project) = request
        .get("project")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        keys.insert(project.to_string());
    }
    if let Some(projects) = request.get("projects").and_then(|value| value.as_array()) {
        for project in projects {
            if let Some(project) = project
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                keys.insert(project.to_string());
            }
        }
    }
    keys
}

fn tray_action_project_keys(action: &TrayReplayAction) -> BTreeSet<String> {
    let mut keys = BTreeSet::new();
    if let Some(project_key) = action
        .project_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        keys.insert(project_key.to_string());
    }

    if let Some(serde_json::Value::Object(payload)) = action.payload.as_ref() {
        if let Some(project_key) = payload
            .get("project")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            keys.insert(project_key.to_string());
        }
    }

    if action.kind == "branch.replay" {
        keys.extend(branch_action_project_keys(action));
    }

    keys
}

fn same_navigation_entry(left: &NavigationEntry, right: &NavigationEntry) -> bool {
    left.kind == right.kind && left.name == right.name && left.target_label == right.target_label
}

fn workspace_allows_navigation_action(
    workspace: &ProjectWorkspaceConfig,
    action: &TrayReplayAction,
) -> bool {
    let Some(entry) = action.entry.as_ref() else {
        return false;
    };
    if workspace.include_all_navigation {
        return true;
    }

    load_navigation_data_for_workspace(workspace)
        .ok()
        .is_some_and(|data| {
            data.categories.into_iter().any(|category| {
                category
                    .entries
                    .into_iter()
                    .any(|candidate| same_navigation_entry(&candidate, entry))
            })
        })
}

fn workspace_entry_count(workspace: &ProjectWorkspaceConfig) -> usize {
    load_navigation_data_for_workspace(workspace)
        .ok()
        .map(|data| {
            data.categories
                .into_iter()
                .map(|category| category.entries.len())
                .sum()
        })
        .unwrap_or_default()
}

fn workspace_display_name(workspace: &ProjectWorkspaceConfig) -> String {
    if workspace.is_system() {
        "全局".to_string()
    } else {
        workspace.name.clone()
    }
}

fn workspace_kind_label(workspace: &ProjectWorkspaceConfig) -> String {
    if workspace.is_system() {
        "global".to_string()
    } else if workspace.root_dir.is_some() {
        "directory".to_string()
    } else {
        "scope".to_string()
    }
}

fn workspace_type_label(workspace: &ProjectWorkspaceConfig) -> String {
    match workspace.workspace_type.as_str() {
        "system" => "全局".to_string(),
        "business" => "业务".to_string(),
        "dev" => "研发".to_string(),
        "tool" => "工具".to_string(),
        "personal" => "个人".to_string(),
        "other" => "其他".to_string(),
        "custom" | "" => "未分类".to_string(),
        value => value.to_string(),
    }
}

fn workspace_resource_kind_label(kind: &str) -> String {
    match kind {
        "url" => "网站",
        "directory" => "目录",
        "app" => "应用",
        "script" => "脚本",
        _ => "入口",
    }
    .to_string()
}

fn navigation_entry_shortcut_kind(entry: &NavigationEntry) -> String {
    match entry.kind.trim().to_ascii_lowercase().as_str() {
        "dir" | "folder" => "directory".to_string(),
        "" => "url".to_string(),
        other => other.to_string(),
    }
}

fn navigation_entry_shortcut_open_target(
    entry: &NavigationEntry,
) -> (Option<String>, Option<String>) {
    match navigation_entry_shortcut_kind(entry).as_str() {
        "url" => {
            let value = entry
                .url
                .as_deref()
                .unwrap_or(entry.target_label.as_str())
                .trim();
            if value.is_empty() {
                (None, None)
            } else {
                (Some("url".to_string()), Some(value.to_string()))
            }
        }
        "directory" => {
            let value = entry
                .path
                .as_deref()
                .unwrap_or(entry.target_label.as_str())
                .trim();
            if value.is_empty() {
                (None, None)
            } else {
                (Some("localPath".to_string()), Some(value.to_string()))
            }
        }
        _ => (None, None),
    }
}

fn workspace_resource_shortcuts(
    workspace: &ProjectWorkspaceConfig,
) -> Vec<WorkspaceResourceShortcutItem> {
    let workspace_key = workspace.key.clone();
    load_navigation_data_for_workspace(workspace)
        .ok()
        .map(|data| {
            data.categories
                .into_iter()
                .flat_map(|category| {
                    let category_title = category.title;
                    let workspace_key = workspace_key.clone();
                    category
                        .entries
                        .into_iter()
                        .enumerate()
                        .map(move |(index, entry)| {
                            let kind = navigation_entry_shortcut_kind(&entry);
                            let (open_kind, value) = navigation_entry_shortcut_open_target(&entry);
                            let label = entry.name.trim();
                            let label = if label.is_empty() {
                                entry.target_label.trim()
                            } else {
                                label
                            }
                            .to_string();
                            let openable = open_kind.is_some() && value.is_some();
                            WorkspaceResourceShortcutItem {
                                key: format!("{}:{}:{}", workspace_key, category_title, index),
                                category: category_title.clone(),
                                label,
                                kind_label: workspace_resource_kind_label(&kind),
                                kind,
                                value,
                                open_kind,
                                openable,
                            }
                        })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn workspace_project_directory_items(
    config: &AppConfig,
    workspace: &ProjectWorkspaceConfig,
    runtime_statuses: &BTreeMap<String, ProjectRuntimeSnapshot>,
) -> Vec<WorkspaceProjectDirectoryItem> {
    let project_keys = if workspace.include_all_projects {
        config
            .projects
            .iter()
            .map(|project| project.key.clone())
            .collect::<Vec<_>>()
    } else {
        workspace.projects.clone()
    };

    project_keys
        .into_iter()
        .filter_map(|project_key| {
            let project = config
                .projects
                .iter()
                .find(|item| item.key == project_key)?;
            let instance = workspace
                .project_instances
                .iter()
                .find(|item| item.project == project.key);
            let (mode, mode_label, path, managed) = if let Some(instance) = instance {
                (
                    if instance.managed { "managed" } else { "bound" },
                    if instance.managed {
                        "工作区副本"
                    } else {
                        "绑定目录"
                    },
                    Some(instance.path.display().to_string()),
                    instance.managed,
                )
            } else {
                (
                    "global",
                    "全局目录",
                    project
                        .repo_path
                        .as_ref()
                        .map(|path| path.display().to_string()),
                    false,
                )
            };
            let runtime_status = runtime_statuses.get(&project.key);

            Some(WorkspaceProjectDirectoryItem {
                project_key: project.key.clone(),
                project_name: project.name.clone(),
                mode: mode.to_string(),
                mode_label: mode_label.to_string(),
                path,
                managed,
                status_key: runtime_status
                    .map(|snapshot| snapshot.status_key.clone())
                    .unwrap_or_else(|| "unknown".to_string()),
                status_label: runtime_status
                    .map(|snapshot| snapshot.status_label.clone())
                    .unwrap_or_else(|| "未知".to_string()),
                running: runtime_status
                    .map(|snapshot| snapshot.status_key == "running")
                    .unwrap_or(false),
                can_start: runtime_status
                    .map(|snapshot| snapshot.can_start)
                    .unwrap_or(false),
                can_stop: runtime_status
                    .map(|snapshot| snapshot.can_stop)
                    .unwrap_or(false),
            })
        })
        .collect()
}

fn workspace_matches_action(
    workspace: &ProjectWorkspaceConfig,
    action: &TrayReplayAction,
    project_keys: &BTreeSet<String>,
) -> bool {
    if !project_keys.is_empty()
        && project_keys
            .iter()
            .any(|project_key| workspace.allows_project(project_key))
    {
        return true;
    }
    workspace_allows_navigation_action(workspace, action)
}

fn tray_action_available(
    action: &TrayReplayAction,
    build_history: &[BuildHistoryEntry],
    branch_history: &[serde_json::Value],
) -> bool {
    match action.kind.as_str() {
        "build.replay" | "deploy.replay" => {
            build_history_matches_pinned_action(action, build_history)
        }
        "branch.replay" => branch_history_matches_pinned_action(action, branch_history, None),
        _ => true,
    }
}

fn workspace_pinned_action_item(action: TrayReplayAction) -> WorkspacePinnedActionItem {
    let project_key = tray_action_project_keys(&action).into_iter().next();
    WorkspacePinnedActionItem {
        kind_label: tray_action_kind_label(&action.kind),
        label: action.label.clone(),
        detail: action.detail.clone(),
        project_key,
        confirm_required: tray_action_confirm_required(&action.kind),
        updated_at_ms: action.updated_at_ms,
        action,
    }
}

fn proxy_rule_counts_by_profile(dashboard: &ProxyDashboard) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for rule in &dashboard.config.rules {
        *counts.entry(rule.profile_id.clone()).or_insert(0) += 1;
    }
    counts
}

fn proxy_status_by_profile(
    dashboard: &ProxyDashboard,
) -> BTreeMap<String, (bool, String, Option<String>)> {
    dashboard
        .statuses
        .iter()
        .map(|status| {
            (
                status.profile_id.clone(),
                (
                    status.running,
                    status.listen_url.clone(),
                    status.started_at.clone(),
                ),
            )
        })
        .collect()
}

fn workspace_proxy_profile_items(
    dashboard: &ProxyDashboard,
    workspace: &ProjectWorkspaceConfig,
    workspace_names: &BTreeMap<String, String>,
    rule_counts: &BTreeMap<String, usize>,
    statuses: &BTreeMap<String, (bool, String, Option<String>)>,
) -> Vec<WorkspaceProxyProfileItem> {
    dashboard
        .config
        .profiles
        .iter()
        .filter(|profile| {
            workspace.is_system()
                || profile.workspace_key.as_deref() == Some(workspace.key.as_str())
        })
        .map(|profile| {
            let (running, listen_url, started_at) = statuses
                .get(&profile.id)
                .cloned()
                .unwrap_or_else(|| (false, profile.listen_url(), None));
            let workspace_label = profile
                .workspace_key
                .as_ref()
                .and_then(|key| workspace_names.get(key))
                .cloned()
                .unwrap_or_else(|| {
                    profile
                        .workspace_key
                        .clone()
                        .unwrap_or_else(|| "未归属".to_string())
                });
            WorkspaceProxyProfileItem {
                id: profile.id.clone(),
                name: profile.name.clone(),
                listen_host: profile.listen_host.clone(),
                listen_port: profile.listen_port,
                listen_url,
                workspace_key: profile.workspace_key.clone(),
                workspace_label,
                rule_count: *rule_counts.get(&profile.id).unwrap_or(&0),
                running,
                started_at,
            }
        })
        .collect()
}

fn workspace_pinned_actions_overview(
    config: &AppConfig,
    storage: &Storage,
    proxy_runtime: &ProxyRuntimeState,
    project_runtime: &ProjectRuntimeState,
) -> Result<Vec<WorkspacePinnedActionsOverview>, String> {
    let paths = ensure_default_configs().map_err(|error| error.to_string())?;
    let workspaces =
        load_project_workspaces(&paths.project_workspaces).map_err(|error| error.to_string())?;
    let actions = tray_pinned_actions(storage);
    let proxy_path = ensure_proxy_config().map_err(|error| error.to_string())?;
    let proxy_dashboard = proxy_runtime
        .dashboard(&proxy_path)
        .map_err(|error| error.to_string())?;
    let proxy_rule_counts = proxy_rule_counts_by_profile(&proxy_dashboard);
    let proxy_statuses = proxy_status_by_profile(&proxy_dashboard);
    let project_runtime_statuses = project_runtime
        .list(config)?
        .into_iter()
        .map(|snapshot| (snapshot.key.clone(), snapshot))
        .collect::<BTreeMap<_, _>>();
    let workspace_names = workspaces
        .iter()
        .map(|workspace| (workspace.key.clone(), workspace_display_name(workspace)))
        .collect::<BTreeMap<_, _>>();

    let build_history = storage.list_all_deploy_history()?;
    let branch_history = branch_history_items(storage);
    let mut grouped = workspaces
        .iter()
        .map(|workspace| (workspace.key.clone(), Vec::<TrayReplayAction>::new()))
        .collect::<BTreeMap<_, _>>();

    for action in actions {
        if !tray_action_available(&action, &build_history, &branch_history) {
            continue;
        }

        let project_keys = tray_action_project_keys(&action);
        let matched_workspace_keys = workspaces
            .iter()
            .filter(|workspace| !workspace.is_system())
            .filter(|workspace| workspace_matches_action(workspace, &action, &project_keys))
            .map(|workspace| workspace.key.clone())
            .collect::<Vec<_>>();
        let target_key = if matched_workspace_keys.len() == 1 {
            matched_workspace_keys[0].clone()
        } else {
            SYSTEM_PROJECT_WORKSPACE_KEY.to_string()
        };

        grouped.entry(target_key).or_default().push(action);
    }

    let overview = workspaces
        .into_iter()
        .map(|workspace| {
            let actions = grouped.remove(&workspace.key).unwrap_or_default();
            let project_count = workspace.project_count_for(config);
            let entry_count = workspace_entry_count(&workspace);
            let resources = workspace_resource_shortcuts(&workspace);
            let project_directories =
                workspace_project_directory_items(config, &workspace, &project_runtime_statuses);
            let proxy_profiles = workspace_proxy_profile_items(
                &proxy_dashboard,
                &workspace,
                &workspace_names,
                &proxy_rule_counts,
                &proxy_statuses,
            );
            let items = actions
                .into_iter()
                .map(workspace_pinned_action_item)
                .collect::<Vec<_>>();
            WorkspacePinnedActionsOverview {
                key: workspace.key.clone(),
                name: workspace_display_name(&workspace),
                description: workspace.description.clone(),
                system: workspace.is_system(),
                root_dir: workspace
                    .root_dir
                    .as_ref()
                    .map(|path| path.display().to_string()),
                workspace_kind: workspace_kind_label(&workspace),
                workspace_type: workspace.workspace_type.clone(),
                workspace_type_label: workspace_type_label(&workspace),
                project_count,
                entry_count,
                action_count: items.len(),
                proxy_profile_count: proxy_profiles.len(),
                resources,
                project_directories,
                proxy_profiles,
                actions: items,
            }
        })
        .collect();

    Ok(overview)
}

fn workspace_ai_context_response(
    config: &AppConfig,
    storage: &Storage,
    proxy_runtime: &ProxyRuntimeState,
    project_runtime: &ProjectRuntimeState,
    workspace_key: String,
    options: Option<WorkspaceAiContextOptions>,
) -> Result<WorkspaceAiContextResponse, String> {
    let options = normalize_workspace_ai_context_options(options);
    let paths = ensure_default_configs().map_err(|error| error.to_string())?;
    let workspace_key = workspace_key.trim();
    let workspace_key = if workspace_key.is_empty() {
        SYSTEM_PROJECT_WORKSPACE_KEY
    } else {
        workspace_key
    };
    let workspace = load_project_workspace_by_key(&paths.project_workspaces, workspace_key)
        .map_err(|error| error.to_string())?;
    let overview =
        workspace_pinned_actions_overview(config, storage, proxy_runtime, project_runtime)?
            .into_iter()
            .find(|item| item.key == workspace.key)
            .ok_or_else(|| format!("工作区不存在: {}", workspace.key))?;
    let context_limit = options.item_limit.max(options.history_limit);
    let context =
        context_for_workspace(config, storage, Some(&workspace), None, None, context_limit)
            .map_err(|error| error.to_string())?;
    let markdown = workspace_ai_context_markdown(&context, &overview, &options);
    let workspace_name = overview.name.clone();
    let workspace_key = overview.key.clone();
    let (json_context, json_overview) =
        filtered_workspace_ai_context_payload(context.clone(), overview.clone(), &options);
    let json = json!({
        "options": options,
        "context": json_context,
        "overview": json_overview,
    });

    Ok(WorkspaceAiContextResponse {
        workspace_key,
        workspace_name,
        markdown,
        json,
    })
}

fn normalize_workspace_ai_context_options(
    options: Option<WorkspaceAiContextOptions>,
) -> WorkspaceAiContextOptions {
    let mut options = options.unwrap_or_default();
    options.item_limit = normalize_ai_context_limit(options.item_limit, default_item_limit());
    options.history_limit =
        normalize_ai_context_limit(options.history_limit, default_history_limit());
    options
}

fn normalize_ai_context_limit(value: usize, fallback: usize) -> usize {
    if value == 0 { fallback } else { value.min(20) }
}

fn truncate_to<T>(values: &mut Vec<T>, limit: usize) {
    if values.len() > limit {
        values.truncate(limit);
    }
}

fn filtered_workspace_ai_context_payload(
    mut context: AgentContext,
    mut overview: WorkspacePinnedActionsOverview,
    options: &WorkspaceAiContextOptions,
) -> (AgentContext, WorkspacePinnedActionsOverview) {
    if options.include_projects {
        truncate_to(&mut context.projects, options.item_limit);
    } else {
        context.projects.clear();
    }

    if options.include_entries {
        truncate_to(&mut overview.resources, options.item_limit);
        truncate_to(&mut context.navigation, options.item_limit);
    } else {
        overview.resources.clear();
        context.navigation.clear();
    }

    if options.include_directories {
        truncate_to(&mut overview.project_directories, options.item_limit);
    } else {
        overview.project_directories.clear();
    }
    truncate_to(&mut overview.proxy_profiles, options.item_limit);

    if options.include_actions {
        truncate_to(&mut overview.actions, options.item_limit);
    } else {
        overview.actions.clear();
    }

    if options.include_build_history {
        truncate_to(&mut context.build_history, options.history_limit);
        truncate_to(&mut context.deploy_history, options.history_limit);
    } else {
        context.build_history.clear();
        context.deploy_history.clear();
    }

    if options.include_merge_history {
        truncate_to(&mut context.merge_history, options.history_limit);
    } else {
        context.merge_history.clear();
    }
    context
        .replay_actions
        .retain(|action| match action.kind.as_str() {
            "build" => options.include_build_history,
            "merge" => options.include_merge_history,
            _ => options.include_actions,
        });
    truncate_to(&mut context.replay_actions, options.history_limit);

    truncate_to(&mut context.notes, options.item_limit);
    (context, overview)
}

fn workspace_ai_context_markdown(
    context: &AgentContext,
    overview: &WorkspacePinnedActionsOverview,
    options: &WorkspaceAiContextOptions,
) -> String {
    let mut lines = Vec::new();
    lines.push(format!("# rDevTool 工作区上下文：{}", overview.name));
    lines.push(String::new());
    lines.push("## 工作区".to_string());
    lines.push(format!("- Key: `{}`", overview.key));
    lines.push(format!("- 类型: {}", overview.workspace_kind));
    if let Some(description) = overview
        .description
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("- 说明: {}", description));
    }
    if let Some(root_dir) = overview
        .root_dir
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("- 工作区目录: `{}`", root_dir));
    }
    lines.push(format!("- 项目数: {}", overview.project_count));
    lines.push(format!("- 入口数: {}", overview.entry_count));
    lines.push(format!("- 代理服务数: {}", overview.proxy_profile_count));
    lines.push(format!("- 动作数: {}", overview.action_count));
    lines.push(format!(
        "- 包含范围: {}",
        workspace_ai_context_scope_labels(options).join(" / ")
    ));
    lines.push("- 安全约定: 这份上下文不包含 token、密码或私密环境变量值。".to_string());

    if options.include_projects {
        lines.push(String::new());
        lines.push("## 项目".to_string());
        if context.projects.is_empty() {
            lines.push("- 暂无项目".to_string());
        } else {
            for project in context.projects.iter().take(options.item_limit) {
                let path = overview
                    .project_directories
                    .iter()
                    .find(|directory| directory.project_key == project.key)
                    .and_then(|directory| directory.path.as_deref())
                    .or(project.repo_path.as_deref())
                    .unwrap_or("未配置目录");
                let mut meta = Vec::new();
                if project.supports_branch {
                    meta.push("Git工作流");
                }
                if project.supports_deploy {
                    meta.push("构建/部署");
                }
                let meta = if meta.is_empty() {
                    String::new()
                } else {
                    format!(" · {}", meta.join(" / "))
                };
                lines.push(format!(
                    "- {} (`{}`) · {}{} · `{}`",
                    project.name, project.key, project.category, meta, path
                ));
            }
            if context.projects.len() > options.item_limit {
                lines.push(format!(
                    "- ……另有 {} 个项目",
                    context.projects.len() - options.item_limit
                ));
            }
        }
    }

    if options.include_entries {
        lines.push(String::new());
        lines.push("## 入口".to_string());
        if overview.resources.is_empty() {
            lines.push("- 暂无工作区入口".to_string());
        } else {
            for resource in overview.resources.iter().take(options.item_limit) {
                let value = resource.value.as_deref().unwrap_or("未配置目标");
                lines.push(format!(
                    "- {} · {} · `{}`",
                    resource.label, resource.kind_label, value
                ));
            }
            if overview.resources.len() > options.item_limit {
                lines.push(format!(
                    "- ……另有 {} 个入口",
                    overview.resources.len() - options.item_limit
                ));
            }
        }
    }

    if options.include_directories {
        lines.push(String::new());
        lines.push("## 项目目录".to_string());
        if overview.project_directories.is_empty() {
            lines.push("- 暂无项目目录映射".to_string());
        } else {
            for directory in overview.project_directories.iter().take(options.item_limit) {
                let path = directory.path.as_deref().unwrap_or("未配置目录");
                lines.push(format!(
                    "- {} (`{}`) · {} · `{}`",
                    directory.project_name, directory.project_key, directory.mode_label, path
                ));
            }
            if overview.project_directories.len() > options.item_limit {
                lines.push(format!(
                    "- ……另有 {} 个项目目录",
                    overview.project_directories.len() - options.item_limit
                ));
            }
        }
    }

    lines.push(String::new());
    lines.push("## 代理服务".to_string());
    if overview.proxy_profiles.is_empty() {
        lines.push("- 暂无代理服务".to_string());
    } else {
        for profile in overview.proxy_profiles.iter().take(options.item_limit) {
            let state = if profile.running {
                "运行中"
            } else {
                "未启动"
            };
            lines.push(format!(
                "- {} (`{}`) · {} · {} 条规则 · {}",
                profile.name, profile.id, profile.listen_url, profile.rule_count, state
            ));
        }
        if overview.proxy_profiles.len() > options.item_limit {
            lines.push(format!(
                "- ……另有 {} 个代理服务",
                overview.proxy_profiles.len() - options.item_limit
            ));
        }
    }

    if options.include_actions {
        lines.push(String::new());
        lines.push("## 最近动作".to_string());
        if overview.actions.is_empty() {
            lines.push("- 暂无标记动作".to_string());
        } else {
            for action in overview.actions.iter().take(options.item_limit) {
                let detail = action.detail.as_deref().unwrap_or("");
                let project = action
                    .project_key
                    .as_deref()
                    .map(|value| format!(" · `{}`", value))
                    .unwrap_or_default();
                if detail.is_empty() {
                    lines.push(format!(
                        "- {} · {}{}",
                        action.kind_label, action.label, project
                    ));
                } else {
                    lines.push(format!(
                        "- {} · {}{} · {}",
                        action.kind_label, action.label, project, detail
                    ));
                }
            }
        }
    }

    if options.include_build_history {
        lines.push(String::new());
        lines.push("## 最近构建/部署".to_string());
        if context.build_history.is_empty() {
            lines.push("- 暂无构建/部署记录".to_string());
        } else {
            for item in context.build_history.iter().take(options.history_limit) {
                lines.push(format!(
                    "- {} · {} · {} · {} · {}",
                    item.project_name, item.mode, item.env, item.branch, item.state_label
                ));
            }
        }
    }

    if options.include_merge_history {
        lines.push(String::new());
        lines.push("## 最近分支/合并".to_string());
        if context.merge_history.is_empty() {
            lines.push("- 暂无合并记录".to_string());
        } else {
            for item in context.merge_history.iter().take(options.history_limit) {
                let status = if item.success { "成功" } else { "失败" };
                lines.push(format!(
                    "- {} · {} → {} · {} · {}",
                    item.project_name, item.source_branch, item.target_branch, status, item.summary
                ));
            }
        }
    }

    if options.include_build_history || options.include_merge_history {
        lines.push(String::new());
        lines.push("## 可回放动作".to_string());
        if context.replay_actions.is_empty() {
            lines.push("- 暂无可回放动作".to_string());
        } else {
            for action in context.replay_actions.iter().take(options.history_limit) {
                lines.push(format!(
                    "- `{}` · {} · 风险: {}",
                    action.id, action.label, action.risk_level
                ));
                lines.push(format!("  - 预览: `{}`", action.preview_command.display));
                lines.push(format!("  - 执行: `{}`", action.run_command.display));
            }
        }
    }

    lines.push(String::new());
    lines.push("## 给 AI 的使用提示".to_string());
    lines.push("- 优先围绕上述工作区、项目目录、入口、代理服务和最近动作回答。".to_string());
    lines
        .push("- 合并、部署、推送等高风险动作必须先执行预览命令，再经用户确认后执行。".to_string());
    lines.push("- 需要执行命令或改代码前，先确认目标项目和目录。".to_string());
    lines.push("- 不要假设未出现在上下文中的密钥、账号或环境变量值。".to_string());
    lines.join("\n")
}

fn workspace_ai_context_scope_labels(options: &WorkspaceAiContextOptions) -> Vec<&'static str> {
    let mut labels = Vec::new();
    if options.include_projects {
        labels.push("项目");
    }
    if options.include_entries {
        labels.push("入口");
    }
    if options.include_directories {
        labels.push("项目目录");
    }
    if options.include_actions {
        labels.push("最近动作");
    }
    if options.include_build_history {
        labels.push("构建/部署");
    }
    if options.include_merge_history {
        labels.push("分支/合并");
    }
    if labels.is_empty() {
        labels.push("基础信息");
    }
    labels
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
        if normalized.len() >= TRAY_PINNED_STORAGE_LIMIT {
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
        "build.replay" | "deploy.replay" => ("构建", NativeIcon::Advanced),
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
        .or_else(|| action.label.trim().strip_prefix("构建："))
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
                tray_pinned_actions_for_menu(&state.storage),
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
            .take(TRAY_PINNED_MENU_LIMIT)
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

fn execute_build_tray_replay(
    runtime: &ProjectRuntimeState,
    config: &AppConfig,
    action: &TrayReplayAction,
) -> Result<(), String> {
    let request: DeployRequest = serde_json::from_value(tray_payload(action, "构建")?)
        .map_err(|error| format!("构建回放参数无效: {}", error))?;
    trigger_build_for_desktop(runtime, config, request)?;
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
            let mut config = state.config_state.load()?;
            let debug_profile = action
                .payload
                .as_ref()
                .and_then(|payload| payload.get("debugProfile"))
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let runtime_profile_key =
                project_runtime_profile_key(&config, project_key, debug_profile)?;
            prepare_rdev_proxy_runtime_profile(
                &mut config,
                &state.proxy_runtime,
                runtime_profile_key.as_deref(),
            )?;
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
            let mut config = state.config_state.load()?;
            let debug_profile = action
                .payload
                .as_ref()
                .and_then(|payload| payload.get("debugProfile"))
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let runtime_profile_key =
                project_runtime_profile_key(&config, project_key, debug_profile)?;
            prepare_rdev_proxy_runtime_profile(
                &mut config,
                &state.proxy_runtime,
                runtime_profile_key.as_deref(),
            )?;
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
            let mut config = state.config_state.load()?;
            prepare_rdev_proxy_runtime_profile(
                &mut config,
                &state.proxy_runtime,
                entry.runtime_profile.as_deref(),
            )?;
            open_navigation_entry_with_runtime_profiles(&entry, &config.defaults.runtime_profiles)
                .map_err(|error| error.to_string())?;
        }
        "build.replay" | "deploy.replay" => {
            let config = state.config_state.load()?;
            execute_build_tray_replay(&state.project_runtime, &config, action)?;
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
    let replay_guard = app
        .try_state::<AppState>()
        .map(|state| state.tray_replay_running.clone());
    if let Some(guard) = replay_guard.as_ref() {
        if guard.swap(true, Ordering::AcqRel) {
            return;
        }
    }

    tauri::async_runtime::spawn_blocking(move || {
        let result = execute_tray_replay_action(&app, &action);
        if let Some(guard) = replay_guard {
            guard.store(false, Ordering::Release);
        }
        if let Err(error) = result {
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
        .map(|state| tray_pinned_actions_for_menu(&state.storage))
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
                        .strip_prefix(TRAY_PINNED_PREFIX)
                        .and_then(|value| value.parse::<usize>().ok());
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

    tray_builder = tray_builder
        .icon(create_tray_icon_image())
        .icon_as_template(true);

    let _ = tray_builder.build(app)?;
    Ok(())
}

fn create_tray_icon_image() -> Image<'static> {
    const SIZE: u32 = 32;
    Image::new_owned(create_tray_mark_rgba(SIZE, SIZE), SIZE, SIZE)
}

fn create_tray_mark_rgba(width: u32, height: u32) -> Vec<u8> {
    let mut rgba = vec![0u8; (width * height * 4) as usize];
    let samples = 4;

    for y in 0..height {
        for x in 0..width {
            let mut alpha_acc = 0.0;

            for sy in 0..samples {
                for sx in 0..samples {
                    let fx = (x as f32 + (sx as f32 + 0.5) / samples as f32) / width as f32;
                    let fy = (y as f32 + (sy as f32 + 0.5) / samples as f32) / height as f32;
                    if inside_tray_bolt(fx, fy) || inside_tray_rail(fx, fy) {
                        alpha_acc += 1.0;
                    }
                }
            }

            let alpha = (alpha_acc / (samples * samples) as f32).clamp(0.0, 1.0);
            if alpha <= 0.0 {
                continue;
            }

            let idx = ((y * width + x) * 4) as usize;
            rgba[idx] = 255;
            rgba[idx + 1] = 255;
            rgba[idx + 2] = 255;
            rgba[idx + 3] = (alpha * 255.0).round() as u8;
        }
    }

    rgba
}

fn inside_tray_bolt(x: f32, y: f32) -> bool {
    inside_polygon(
        x,
        y,
        &[
            (0.600, 0.040),
            (0.215, 0.565),
            (0.465, 0.565),
            (0.355, 0.965),
            (0.800, 0.365),
            (0.555, 0.365),
        ],
    )
}

fn inside_tray_rail(x: f32, y: f32) -> bool {
    inside_rounded_rect(x, y, 0.610, 0.620, 0.865, 0.685, 0.033)
        || inside_rounded_rect(x, y, 0.590, 0.725, 0.805, 0.790, 0.033)
        || inside_rounded_rect(x, y, 0.570, 0.830, 0.735, 0.895, 0.033)
}

fn inside_rounded_rect(x: f32, y: f32, x0: f32, y0: f32, x1: f32, y1: f32, radius: f32) -> bool {
    let cx = (x0 + x1) * 0.5;
    let cy = (y0 + y1) * 0.5;
    let hw = (x1 - x0) * 0.5;
    let hh = (y1 - y0) * 0.5;
    let qx = (x - cx).abs() - (hw - radius);
    let qy = (y - cy).abs() - (hh - radius);
    let ox = qx.max(0.0);
    let oy = qy.max(0.0);
    let outside = (ox * ox + oy * oy).sqrt();
    let inside = qx.max(qy).min(0.0);
    outside + inside <= radius
}

fn inside_polygon(x: f32, y: f32, points: &[(f32, f32)]) -> bool {
    let mut inside = false;
    let mut previous = points.len() - 1;

    for current in 0..points.len() {
        let (xi, yi) = points[current];
        let (xj, yj) = points[previous];
        let dy = yj - yi;
        let intersects =
            dy.abs() > f32::EPSILON && (yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / dy + xi;
        if intersects {
            inside = !inside;
        }
        previous = current;
    }

    inside
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
                proxy_runtime: ProxyRuntimeState::default(),
                config_state: AppConfigState::default(),
                tray_replay_running: Arc::new(AtomicBool::new(false)),
            });
            if should_use_tray() {
                build_tray(app.handle(), tray_quitting.clone()).map_err(std::io::Error::other)?;
            }
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                apply_vibrancy(
                    &window,
                    NSVisualEffectMaterial::HudWindow,
                    Some(NSVisualEffectState::Active),
                    Some(18.0),
                )
                .map_err(std::io::Error::other)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            get_workspace_app_preferences,
            save_workspace_app_preferences,
            get_project_workspaces,
            set_active_project_workspace,
            create_project_workspace_config,
            init_demand_workspace_config,
            get_project_workspace_editor,
            save_project_workspace_editor,
            get_proxy_dashboard,
            diagnose_proxy_request,
            save_proxy_profile,
            delete_proxy_profile,
            save_proxy_rule,
            delete_proxy_rule,
            start_proxy_profile,
            stop_proxy_profile,
            clear_proxy_events,
            export_proxy_profile_pack,
            import_proxy_profile_pack,
            bind_proxy_runtime_profile_config,
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
            get_build_target_meta,
            build_deploy_plan,
            preview_build_plan,
            trigger_build,
            refresh_build_status,
            execute_branch_merge,
            execute_branch_sync_task,
            execute_branch_create_task,
            checkout_branch_to_directory_task,
            create_project_workspace_project_copy,
            bind_project_workspace_project_directory,
            unbind_project_workspace_project_directory,
            execute_branch_switch_task,
            list_project_worktrees,
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
            get_workspace_pinned_actions_overview,
            get_workspace_ai_context,
            execute_tray_pinned_action,
            set_tray_pinned_actions,
            list_build_history,
            save_build_history,
            clear_build_history,
            list_deploy_history,
            save_deploy_history,
            clear_deploy_history,
            list_merge_history,
            save_merge_history,
            clear_merge_history,
            list_project_runtimes,
            list_selected_project_runtimes,
            preflight_project_runtime,
            inspect_project_runtime,
            start_project_runtime,
            stop_project_runtime,
            run_project_build,
            stop_project_build,
            open_project_build_output,
            open_project_directory,
            focus_project_runtime,
            read_project_runtime_log,
            clear_project_runtime_log
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                if let Some(state) = app.try_state::<AppState>() {
                    state.project_runtime.shutdown_all();
                }
            }
        });
}
