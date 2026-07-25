use notify::{Event, RecursiveMode, Watcher};
use project_runtime::{
    AppStartedRuntimeShutdownReport, AppStartedRuntimeSummary, ProjectDebugProfileSummary,
    ProjectRuntimeLaunchOptions, ProjectRuntimeLogKind, ProjectRuntimeLogResponse,
    ProjectRuntimeSnapshot, ProjectRuntimeState,
};
use rdevtool_core::agent::{AgentContext, context_for_workspace};
use rdevtool_core::artifacts::{
    ManagedArtifactInventoryResponse, ManagedArtifactQuery, managed_artifact_inventory,
};
use rdevtool_core::build as core_build;
use rdevtool_core::config::{
    AppConfig, BranchRules, BuildActionKind, BuildArtifactConfig, BuildTargetAdapter, ConfigPaths,
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
use rdevtool_core::config_sources::{
    ConfigSource, ConfigSourceComparison, ConfigSourceCopyResult, ConfigSourceDefinition,
    CopyConfigSourceRequest, compare_config_sources as core_compare_config_sources,
    config_sources_file_path, copy_config_source as core_copy_config_source,
    delete_custom_config_source as core_delete_custom_config_source,
    get_custom_config_source_definition, list_config_sources as core_list_config_sources,
    load_config_source_preference as core_load_config_source_preference,
    resolve_config_source as core_resolve_config_source,
    save_config_source_preference as core_save_config_source_preference,
    save_custom_config_source as core_save_custom_config_source,
};
use rdevtool_core::config_store::{is_recent_internal_config_write, write_config_text_atomic};
use rdevtool_core::core::{
    BranchCatalogResponse, BranchCheckoutRequest, BranchCommitOverview, BranchCreateRequest,
    BranchFileDiffRequest, BranchFileDiffResponse, BranchPushRequest, BranchPushStatus,
    BranchSwitchRequest, BranchSyncRequest, BranchTaskResponse, BranchWorktreeSummary,
    BuildStatusResponse, BuildTriggerResponse, DeployPlan, DeployRequest, DeployTargetMeta,
    ProjectDetail, ProjectSummary, StatusRequest, branch_catalog, branch_commit_overview,
    branch_file_diff, branch_hint, branch_push_status, build_plan, checkout_branch_to_directory,
    deploy_target_meta, execute_branch_create, execute_branch_push, execute_branch_switch,
    execute_branch_sync, execute_merge, plan_branch_sync, project_detail, project_summaries,
    project_worktrees, refresh_deploy_status,
    repair_project_worktree as core_repair_project_worktree, trigger_deploy,
};
use rdevtool_core::core::{MergeRequest, MergeResponse};
use rdevtool_core::git;
use rdevtool_core::link::{
    LinkConfig, LinkExecutionReport, LinkExecutionStepReport, LinkPlan, LinkRuntimeSummary,
    LinkSourceContext, LinkStepConfig, LinkSummary, LinkWorkspaceAttachRequest,
    LinkWorkspaceAttachResult, attach_link_to_workspace as core_attach_link_to_workspace,
    delete_link_from_path as core_delete_link_from_path,
    get_link_from_path as core_get_link_from_path, link_proxy_check_status, links_file_path,
    list_link_summaries_from_path as core_list_link_summaries_from_path,
    list_links_from_path as core_list_links_from_path,
    plan_link_from_path as core_plan_link_from_path,
    upsert_link_to_path_with_previous_key as core_upsert_link_to_path_with_previous_key,
};
use rdevtool_core::navigation::{
    NavigationData, NavigationEditorData, NavigationEntry, NavigationOpenResult,
    load_navigation_data_for_workspace, load_navigation_editor_data,
    load_navigation_editor_data_from_path, load_navigation_source_data_for_workspace,
    navigation_file_path, open_navigation_entry_with_runtime_profiles,
    save_navigation_editor_data_to_path,
};
use rdevtool_core::operation::{
    OperationEvent, OperationEventOrigin, OperationEventState, branch_task_operation_event,
    build_history_request, build_operation_event, failed_build_operation_event,
    lifecycle_operation_event, link_operation_event, list_operation_events, operation_event_id,
    save_operation_event, update_build_operation_event_from_history,
};
use rdevtool_core::proxy::{
    ProxyConfig, ProxyDashboard, ProxyProfile, ProxyProfilePack, ProxyRequestDiagnosis, ProxyRule,
    default_proxy_path, delete_proxy_profile as core_delete_proxy_profile,
    delete_proxy_rule as core_delete_proxy_rule,
    diagnose_proxy_request as core_diagnose_proxy_request, ensure_proxy_config,
    export_proxy_profile_pack as core_export_proxy_profile_pack,
    import_proxy_profile_pack as core_import_proxy_profile_pack, load_proxy_config,
    save_proxy_config, upsert_proxy_profile, upsert_proxy_rule, validate_proxy_profile,
    validate_proxy_rule,
};
use rdevtool_core::proxy_daemon::{ProxyDaemonRuntime as ProxyRuntimeState, proxy_daemon_status};
use rdevtool_core::runtime as core_runtime;
use rdevtool_core::runtime_link::{
    BindProxyRuntimeRequest, BindProxyRuntimeResult, bind_proxy_runtime_profile,
};
use rdevtool_core::storage::{
    BuildHistoryEntry, DeployHistoryEntry, MergeHistoryEntry, SaveBuildHistoryRequest,
    SaveDeployHistoryRequest, SaveMergeHistoryRequest, Storage, default_storage_path,
};
use rdevtool_core::ui_profiles::{UiProfileManifest, ui_profile_manifest};
use rdevtool_core::workspace_init::{
    InitDemandWorkspaceCopyMode, InitDemandWorkspaceRequest, InitDemandWorkspaceResult,
    init_demand_workspace,
};
use rdevtool_core::workspace_resources::{
    WorkspaceOperationWorklogEvent, append_workspace_operation_worklog,
    clear_workspace_worklog_configuration, initialize_workspace_resources,
    set_workspace_worklog_auto_record, validate_workspace_worklog_file, workspace_resource_status,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{
    Arc, RwLock,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use std::time::{Duration, Instant, SystemTime};
use tauri::{
    AppHandle, Emitter, Manager, RunEvent, Runtime, WindowEvent,
    image::Image,
    menu::{IconMenuItem, Menu, MenuItem, NativeIcon, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
#[cfg(target_os = "macos")]
use window_vibrancy::{NSVisualEffectMaterial, NSVisualEffectState, apply_vibrancy};

mod commands;
mod project_runtime;

#[derive(Clone)]
struct AppState {
    storage: Storage,
    project_runtime: ProjectRuntimeState,
    proxy_runtime: ProxyRuntimeState,
    config_state: AppConfigState,
    exit_coordinator: AppExitCoordinator,
    tray_replay_running: Arc<AtomicBool>,
    tray_menu_actions: Arc<RwLock<BTreeMap<String, TrayReplayAction>>>,
    workspace_config_watcher_stop: Arc<AtomicBool>,
}

#[derive(Clone, Default)]
struct AppExitCoordinator {
    is_quitting: Arc<AtomicBool>,
    request_in_progress: Arc<AtomicBool>,
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

const WORKSPACE_STATE_CHANGED_EVENT: &str = "rdevtool://workspace-state-changed";
const CONFIG_SOURCES_CHANGED_EVENT: &str = "rdevtool://config-sources-changed";
const TRAY_DOMAIN_ACTION_REQUESTED_EVENT: &str = "rdevtool://tray-domain-action-requested";
const WORKSPACE_CONFIG_EVENT_DEBOUNCE: Duration = Duration::from_millis(180);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceStateChangedPayload {
    revision: u64,
    origin: String,
    scopes: Vec<String>,
    project_workspace_keys: Vec<String>,
    project_workspaces_unknown: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigSourcesChangedPayload {
    revision: u64,
    origin: String,
    source_ids: Vec<String>,
    catalog_changed: bool,
}

struct WorkspaceConfigWatchTargets {
    projects: PathBuf,
    workspace: PathBuf,
    project_workspaces: PathBuf,
}

#[derive(Debug, Default, Eq, PartialEq)]
struct WorkspaceConfigEventImpact {
    scopes: BTreeSet<&'static str>,
    project_workspace_keys: BTreeSet<String>,
    project_workspaces_unknown: bool,
}

#[derive(Debug, Clone)]
struct ConfigSourceWatchTarget {
    id: String,
    base_dir: PathBuf,
    files: Vec<PathBuf>,
}

#[derive(Debug, Default, Eq, PartialEq)]
struct ConfigSourceEventImpact {
    source_ids: BTreeSet<String>,
    catalog_changed: bool,
}

impl ConfigSourceEventImpact {
    fn merge(&mut self, other: Self) {
        self.source_ids.extend(other.source_ids);
        self.catalog_changed |= other.catalog_changed;
    }
}

impl WorkspaceConfigEventImpact {
    fn merge(&mut self, other: Self) {
        self.scopes.extend(other.scopes);
        self.project_workspace_keys
            .extend(other.project_workspace_keys);
        self.project_workspaces_unknown |= other.project_workspaces_unknown;
    }
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
    resource_dir: Option<String>,
    worklog_path: Option<String>,
    worklog_exists: bool,
    worklog_auto_record: bool,
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
    #[serde(default)]
    resource_dir: Option<String>,
    #[serde(default)]
    worklog_file: Option<String>,
    #[serde(default = "default_true")]
    worklog_auto_record: bool,
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
    resource_dir: Option<String>,
    #[serde(default)]
    worklog_file: Option<String>,
    #[serde(default = "default_true")]
    create_worklog: bool,
    #[serde(default = "default_true")]
    worklog_auto_record: bool,
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
    #[serde(default)]
    repo_path: Option<String>,
    #[serde(default)]
    project: Option<String>,
    #[serde(default)]
    branch: Option<String>,
    #[serde(default)]
    root_dir: Option<String>,
    #[serde(default)]
    instance_dir: Option<String>,
    #[serde(default)]
    copy_mode: Option<String>,
    #[serde(default)]
    resource_dir: Option<String>,
    #[serde(default)]
    worklog_file: Option<String>,
    #[serde(default = "default_true")]
    create_worklog: bool,
    #[serde(default = "default_true")]
    worklog_auto_record: bool,
    #[serde(default)]
    requirement_category: Option<String>,
    #[serde(default)]
    requirement_short_label: Option<String>,
    #[serde(default)]
    requirement_entry_name: Option<String>,
    #[serde(default = "default_true")]
    activate: bool,
    #[serde(default)]
    allow_remote_mismatch: bool,
    #[serde(default)]
    dry_run: bool,
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
    #[serde(default)]
    runtime_config_path: Option<String>,
    #[serde(default)]
    runtime_profile_scope: String,
    jenkins_profiles: Vec<String>,
    default_branch_rules: BranchRulesEditor,
    runtime_profiles: Vec<RuntimeProfileEditor>,
    projects: Vec<ProjectConfigEditorProject>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigSourceFileInspection {
    key: String,
    label: String,
    capability: String,
    path: Option<String>,
    supported: bool,
    exists: bool,
    status: String,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigSourceInspection {
    source: ConfigSource,
    definition: Option<ConfigSourceDefinition>,
    editable: bool,
    registry_path: String,
    status: String,
    summary: String,
    issues: Vec<String>,
    files: Vec<ConfigSourceFileInspection>,
    runtime_profile_scope: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
struct RuntimeOverridesFile {
    #[serde(default)]
    runtime_profiles: Vec<RuntimeProfileConfig>,
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
    command: Option<String>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    expected_port: Option<u16>,
    #[serde(default)]
    focus_url: Option<String>,
    #[serde(default)]
    ready_probe: Option<ProjectDebugReadyProbeEditor>,
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
struct ProjectDebugReadyProbeEditor {
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    expected_statuses: Vec<u16>,
    #[serde(default)]
    timeout_ms: Option<u64>,
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
    #[serde(default)]
    artifact_output_dir: Option<String>,
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
    #[serde(default)]
    impact_paths: Vec<String>,
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

const DEFAULT_PAGE_KEYS: [&str; 4] = ["overview", "projectManagement", "resources", "proxy"];
const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "main-tray";
const TRAY_SHOW_ID: &str = "tray_show_main";
const TRAY_REPLAY_LAST_ID: &str = "tray_replay_last";
const TRAY_WORKSPACE_ACTION_PREFIX: &str = "tray_workspace_action_";
const TRAY_MORE_WORKSPACES_ID: &str = "tray_more_workspaces";
const TRAY_QUIT_ID: &str = "tray_quit";
const TRAY_STORAGE_NAMESPACE: &str = "tray";
const TRAY_RECENT_STORAGE_KEY: &str = "recent-actions";
const TRAY_PINNED_STORAGE_KEY: &str = "pinned-actions";
const APP_EXIT_STORAGE_NAMESPACE: &str = "app";
const APP_EXIT_RUNTIME_POLICY_KEY: &str = "exit-runtime-policy";
const APP_EXIT_REQUESTED_EVENT: &str = "rdevtool://app-exit-requested";
const APP_EXIT_FAILED_EVENT: &str = "rdevtool://app-exit-failed";
const BRANCH_WORKFLOW_STORAGE_NAMESPACE: &str = "branch-workflow";
const BRANCH_WORKFLOW_HISTORY_KEY: &str = "history";
const TRAY_RECENT_LIMIT: usize = 6;
const TRAY_PINNED_STORAGE_LIMIT: usize = 60;
const TRAY_WORKSPACE_MENU_LIMIT: usize = 6;
const TRAY_CATEGORY_ITEM_LIMIT: usize = 10;

fn should_use_tray() -> bool {
    !cfg!(debug_assertions)
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum AppExitRuntimePolicy {
    Ask,
    Keep,
    Stop,
}

impl AppExitRuntimePolicy {
    fn parse(value: &str) -> Option<Self> {
        match value.trim() {
            "ask" => Some(Self::Ask),
            "keep" => Some(Self::Keep),
            "stop" => Some(Self::Stop),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Ask => "ask",
            Self::Keep => "keep",
            Self::Stop => "stop",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppExitRequestedPayload {
    active_runtime_count: usize,
    project_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppExitFailedPayload {
    message: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrayReplayAction {
    kind: String,
    label: String,
    detail: Option<String>,
    #[serde(default)]
    workspace_key: Option<String>,
    project_key: Option<String>,
    entry: Option<NavigationEntry>,
    #[serde(default)]
    payload: Option<serde_json::Value>,
    dedupe_key: String,
    updated_at_ms: u64,
}

#[derive(Debug, Clone)]
struct TrayMenuActionItem {
    label: String,
    enabled: bool,
    action: TrayReplayAction,
}

#[derive(Debug, Clone)]
struct TrayMenuCategory {
    key: String,
    label: String,
    actions: Vec<TrayMenuActionItem>,
}

#[derive(Debug, Clone)]
struct TrayWorkspaceMenu {
    label: String,
    active: bool,
    open_action: TrayMenuActionItem,
    categories: Vec<TrayMenuCategory>,
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
    resource_dir: Option<String>,
    worklog_path: Option<String>,
    worklog_exists: bool,
    worklog_auto_record: bool,
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
    config_source_id: String,
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
    params: Vec<WorkspaceActionParamItem>,
    confirm_required: bool,
    updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceActionParamItem {
    label: String,
    value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceResourceShortcutItem {
    key: String,
    config_source_id: String,
    category: String,
    label: String,
    kind: String,
    kind_label: String,
    value: Option<String>,
    detail: Option<String>,
    tool: Option<String>,
    tool_key: Option<String>,
    tool_action: Option<String>,
    link_runtime: Option<LinkRuntimeSummary>,
    open_kind: Option<String>,
    openable: bool,
    #[serde(skip)]
    entry: NavigationEntry,
    #[serde(skip)]
    tool_config_source_id: Option<String>,
    #[serde(skip)]
    tool_proxy_source_id: Option<String>,
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
    can_focus_runtime: bool,
    debug_profiles: Vec<ProjectDebugProfileSummary>,
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

fn path_matches_config_file(path: &Path, target: &Path) -> bool {
    if path == target {
        return true;
    }

    let Some(target_name) = target.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    path.parent() == target.parent()
        && path
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|name| {
                name.starts_with(&format!(".{target_name}.")) && name.ends_with(".tmp")
            })
}

fn project_workspace_key_from_event_path(
    path: &Path,
    project_workspaces_dir: &Path,
) -> Option<String> {
    if path.parent() != Some(project_workspaces_dir) {
        return None;
    }
    let file_name = path.file_name()?.to_str()?;
    if let Some(key) = file_name.strip_suffix(".toml") {
        return (!key.is_empty()).then(|| key.to_string());
    }
    let temporary_name = file_name.strip_prefix('.')?.strip_suffix(".tmp")?;
    let (key, _) = temporary_name.split_once(".toml.")?;
    (!key.is_empty()).then(|| key.to_string())
}

fn workspace_config_event_impact(
    paths: &[PathBuf],
    targets: &WorkspaceConfigWatchTargets,
) -> WorkspaceConfigEventImpact {
    let mut impact = WorkspaceConfigEventImpact::default();
    for path in paths {
        if path_matches_config_file(path, &targets.workspace) {
            impact.scopes.insert("workspace");
        }
        if path_matches_config_file(path, &targets.projects) {
            impact.scopes.insert("projects");
        }
        if path == &targets.project_workspaces {
            impact.scopes.insert("projectWorkspaces");
            impact.project_workspaces_unknown = true;
        } else if let Some(key) =
            project_workspace_key_from_event_path(path, &targets.project_workspaces)
        {
            impact.scopes.insert("projectWorkspaces");
            impact.project_workspace_keys.insert(key);
        }
    }
    impact
}

fn load_config_source_watch_targets() -> Result<Vec<ConfigSourceWatchTarget>, String> {
    let paths = ensure_default_configs().map_err(|error| error.to_string())?;
    let workspaces =
        load_project_workspaces(&paths.project_workspaces).map_err(|error| error.to_string())?;
    let sources = core_list_config_sources(&workspaces).map_err(|error| error.to_string())?;
    Ok(sources
        .into_iter()
        .map(|source| {
            let mut files = vec![
                PathBuf::from(source.files.navigation),
                PathBuf::from(source.files.links),
            ];
            files.extend(source.files.proxy.map(PathBuf::from));
            files.extend(source.files.runtime_overrides.map(PathBuf::from));
            ConfigSourceWatchTarget {
                id: source.id,
                base_dir: PathBuf::from(source.base_dir),
                files,
            }
        })
        .collect())
}

fn config_source_event_impact(
    paths: &[PathBuf],
    registry_path: &Path,
    targets: &[ConfigSourceWatchTarget],
) -> ConfigSourceEventImpact {
    let mut impact = ConfigSourceEventImpact::default();
    for path in paths {
        if path_matches_config_file(path, registry_path) {
            impact.catalog_changed = true;
        }
        for target in targets {
            if path == &target.base_dir
                || target
                    .files
                    .iter()
                    .any(|file| path_matches_config_file(path, file))
            {
                impact.source_ids.insert(target.id.clone());
            }
        }
    }
    impact
}

fn config_event_origin(
    paths: &[PathBuf],
    workspace_targets: &WorkspaceConfigWatchTargets,
    registry_path: &Path,
    config_source_targets: &[ConfigSourceWatchTarget],
) -> &'static str {
    let mut matched_targets = BTreeSet::new();
    for path in paths {
        if path_matches_config_file(path, &workspace_targets.workspace) {
            matched_targets.insert(workspace_targets.workspace.clone());
        }
        if path_matches_config_file(path, &workspace_targets.projects) {
            matched_targets.insert(workspace_targets.projects.clone());
        }
        if let Some(key) =
            project_workspace_key_from_event_path(path, &workspace_targets.project_workspaces)
        {
            matched_targets.insert(
                workspace_targets
                    .project_workspaces
                    .join(format!("{key}.toml")),
            );
        }
        if path_matches_config_file(path, registry_path) {
            matched_targets.insert(registry_path.to_path_buf());
        }
        for target in config_source_targets {
            if path == &target.base_dir {
                matched_targets.insert(target.base_dir.clone());
            }
            for file in &target.files {
                if path_matches_config_file(path, file) {
                    matched_targets.insert(file.clone());
                }
            }
        }
    }

    if matched_targets.is_empty() {
        return "external";
    }
    let has_recent_internal_write = matched_targets
        .iter()
        .any(|path| is_recent_internal_config_write(path));
    let has_unmatched_file = matched_targets
        .iter()
        .any(|path| !path.is_dir() && !is_recent_internal_config_write(path));
    if has_recent_internal_write && !has_unmatched_file {
        "internal"
    } else {
        "external"
    }
}

fn config_source_watch_directories(
    config_dir: &Path,
    targets: &[ConfigSourceWatchTarget],
) -> BTreeSet<PathBuf> {
    let mut candidates = BTreeSet::new();
    for target in targets {
        candidates.insert(target.base_dir.clone());
        candidates.extend(
            target
                .files
                .iter()
                .filter_map(|path| path.parent().map(Path::to_path_buf)),
        );
    }
    candidates.retain(|path| path.exists() && !path.starts_with(config_dir));
    let snapshot = candidates.clone();
    candidates.retain(|path| {
        !snapshot
            .iter()
            .any(|other| other != path && path.starts_with(other))
    });
    candidates
}

fn sync_config_source_watch_directories<W: Watcher>(
    watcher: &mut W,
    config_dir: &Path,
    targets: &[ConfigSourceWatchTarget],
    watched_directories: &mut BTreeSet<PathBuf>,
) {
    let desired = config_source_watch_directories(config_dir, targets);
    let mut active = watched_directories
        .intersection(&desired)
        .cloned()
        .collect::<BTreeSet<_>>();
    for directory in watched_directories.difference(&desired) {
        if let Err(error) = watcher.unwatch(directory) {
            eprintln!(
                "[workspace-config-watcher] failed to stop watching {}: {error}",
                directory.display()
            );
        }
    }
    for directory in desired.difference(watched_directories) {
        match watcher.watch(directory, RecursiveMode::Recursive) {
            Ok(()) => {
                active.insert(directory.clone());
            }
            Err(error) => {
                eprintln!(
                    "[workspace-config-watcher] failed to watch config source {}: {error}",
                    directory.display()
                );
            }
        }
    }
    *watched_directories = active;
}

fn start_workspace_config_watcher(app: AppHandle, stop: Arc<AtomicBool>) -> Result<(), String> {
    let paths = ensure_default_configs().map_err(|error| error.to_string())?;
    let workspace_targets = WorkspaceConfigWatchTargets {
        projects: paths.projects,
        workspace: paths.workspace,
        project_workspaces: paths.project_workspaces,
    };
    let config_dir = default_config_dir();
    let registry_path = config_sources_file_path();
    let mut config_source_targets = load_config_source_watch_targets().unwrap_or_else(|error| {
        eprintln!("[workspace-config-watcher] failed to load config sources: {error}");
        Vec::new()
    });
    let mut watched_config_source_directories = BTreeSet::new();
    let (event_tx, event_rx) = std::sync::mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
        let _ = event_tx.send(result);
    })
    .map_err(|error| format!("failed to create workspace config watcher: {error}"))?;
    watcher
        .watch(&config_dir, RecursiveMode::Recursive)
        .map_err(|error| format!("failed to watch {}: {error}", config_dir.display()))?;
    sync_config_source_watch_directories(
        &mut watcher,
        &config_dir,
        &config_source_targets,
        &mut watched_config_source_directories,
    );

    std::thread::Builder::new()
        .name("rdevtool-workspace-config-watcher".to_string())
        .spawn(move || {
            let revision = AtomicU64::new(0);
            while !stop.load(Ordering::Relaxed) {
                let event = match event_rx.recv_timeout(Duration::from_millis(250)) {
                    Ok(Ok(event)) if !event.kind.is_access() => event,
                    Ok(Ok(_)) => continue,
                    Ok(Err(error)) => {
                        eprintln!("[workspace-config-watcher] {error}");
                        continue;
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                };

                let mut changed_paths = event.paths.iter().cloned().collect::<BTreeSet<_>>();
                let mut workspace_impact =
                    workspace_config_event_impact(&event.paths, &workspace_targets);
                let mut config_source_impact = config_source_event_impact(
                    &event.paths,
                    &registry_path,
                    &config_source_targets,
                );
                if workspace_impact.scopes.is_empty()
                    && config_source_impact.source_ids.is_empty()
                    && !config_source_impact.catalog_changed
                {
                    continue;
                }

                let debounce_deadline = Instant::now() + WORKSPACE_CONFIG_EVENT_DEBOUNCE;
                loop {
                    let now = Instant::now();
                    if now >= debounce_deadline {
                        break;
                    }
                    match event_rx.recv_timeout(debounce_deadline - now) {
                        Ok(Ok(event)) if !event.kind.is_access() => {
                            changed_paths.extend(event.paths.iter().cloned());
                            workspace_impact.merge(workspace_config_event_impact(
                                &event.paths,
                                &workspace_targets,
                            ));
                            config_source_impact.merge(config_source_event_impact(
                                &event.paths,
                                &registry_path,
                                &config_source_targets,
                            ));
                        }
                        Ok(Ok(_)) => {}
                        Ok(Err(error)) => {
                            eprintln!("[workspace-config-watcher] {error}");
                        }
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => break,
                        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
                    }
                }

                let changed_paths = changed_paths.into_iter().collect::<Vec<_>>();
                let origin = config_event_origin(
                    &changed_paths,
                    &workspace_targets,
                    &registry_path,
                    &config_source_targets,
                )
                .to_string();
                let catalog_changed = config_source_impact.catalog_changed
                    || workspace_impact.scopes.contains("projectWorkspaces");
                if catalog_changed {
                    match load_config_source_watch_targets() {
                        Ok(next_targets) => {
                            sync_config_source_watch_directories(
                                &mut watcher,
                                &config_dir,
                                &next_targets,
                                &mut watched_config_source_directories,
                            );
                            config_source_targets = next_targets;
                        }
                        Err(error) => {
                            eprintln!(
                                "[workspace-config-watcher] failed to refresh config sources: {error}"
                            );
                        }
                    }
                }

                let next_revision = revision.fetch_add(1, Ordering::Relaxed) + 1;
                if !workspace_impact.scopes.is_empty() {
                    let payload = WorkspaceStateChangedPayload {
                        revision: next_revision,
                        origin: origin.clone(),
                        scopes: workspace_impact
                            .scopes
                            .into_iter()
                            .map(str::to_string)
                            .collect(),
                        project_workspace_keys: workspace_impact
                            .project_workspace_keys
                            .into_iter()
                            .collect(),
                        project_workspaces_unknown: workspace_impact.project_workspaces_unknown,
                    };
                    if let Err(error) = app.emit(WORKSPACE_STATE_CHANGED_EVENT, payload) {
                        eprintln!("[workspace-config-watcher] failed to emit update: {error}");
                    }
                }
                if catalog_changed || !config_source_impact.source_ids.is_empty() {
                    let payload = ConfigSourcesChangedPayload {
                        revision: next_revision,
                        origin,
                        source_ids: config_source_impact.source_ids.into_iter().collect(),
                        catalog_changed,
                    };
                    if let Err(error) = app.emit(CONFIG_SOURCES_CHANGED_EVENT, payload) {
                        eprintln!(
                            "[workspace-config-watcher] failed to emit config source update: {error}"
                        );
                    }
                }
                refresh_tray_menu(&app);
            }

            drop(watcher);
        })
        .map_err(|error| format!("failed to start workspace config watcher: {error}"))?;
    Ok(())
}

fn normalize_style_mode(value: &str) -> String {
    match value {
        "system" => "system".to_string(),
        "mono" => "mono".to_string(),
        _ => "light".to_string(),
    }
}

fn normalize_page_key(value: Option<String>) -> Option<String> {
    let value = value?.trim().to_string();
    match value.as_str() {
        "navigation" | "projects" => Some("resources".to_string()),
        "deploy" => Some("build".to_string()),
        "overview" | "projectManagement" | "resources" | "build" | "merge" | "proxy" => Some(value),
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
    let resource_status = workspace_resource_status(&workspace);
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
        resource_dir: resource_status
            .as_ref()
            .map(|status| status.resource_dir.clone()),
        worklog_path: resource_status
            .as_ref()
            .map(|status| status.worklog_path.clone()),
        worklog_exists: resource_status
            .as_ref()
            .is_some_and(|status| status.worklog_exists),
        worklog_auto_record: workspace.worklog_auto_record,
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
            resource_dir: workspace
                .resource_dir
                .as_ref()
                .map(|path| path.display().to_string()),
            worklog_file: workspace
                .worklog_file
                .as_ref()
                .map(|path| path.display().to_string()),
            worklog_auto_record: workspace.worklog_auto_record,
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
    apply_workspace_context(config, &workspace, &paths)
}

fn apply_workspace_context(
    config: &AppConfig,
    workspace: &ProjectWorkspaceConfig,
    paths: &ConfigPaths,
) -> Result<AppConfig, String> {
    let workspaces =
        load_project_workspaces(&paths.project_workspaces).map_err(|error| error.to_string())?;
    let mut next_config = apply_project_workspace_context(config, workspace);
    let source = resolve_workspace_capability_source(paths, workspace, &workspaces, "runtime")?;
    apply_runtime_overrides_for_source(&mut next_config, &source)?;
    Ok(next_config)
}

fn active_workspace_proxy_path() -> Result<PathBuf, String> {
    let paths = ensure_default_configs().map_err(|error| error.to_string())?;
    let workspace = load_active_project_workspace(&paths).map_err(|error| error.to_string())?;
    let workspaces =
        load_project_workspaces(&paths.project_workspaces).map_err(|error| error.to_string())?;
    let source = resolve_workspace_capability_source(&paths, &workspace, &workspaces, "proxy")?;
    proxy_path_for_config_source(&source)
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
        resource_dir: draft.resource_dir.and_then(|value| {
            let value = value.trim().to_string();
            (!value.is_empty()).then_some(PathBuf::from(value))
        }),
        worklog_file: draft
            .worklog_file
            .and_then(|value| {
                let value = value.trim().to_string();
                (!value.is_empty()).then_some(PathBuf::from(value))
            })
            .map(validate_workspace_worklog_file)
            .transpose()
            .map_err(|error| error.to_string())?,
        worklog_auto_record: draft.worklog_auto_record,
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
    if workspace.resource_dir.is_none() {
        clear_workspace_worklog_configuration(&mut workspace);
    }

    let path = paths
        .project_workspaces
        .join(format!("{}.toml", workspace.key));
    save_project_workspace_config(&path, &workspace).map_err(|error| error.to_string())?;
    if workspace.resource_dir.is_some() {
        (workspace, _) = initialize_workspace_resources(&paths, &workspace.key, None, None, true)
            .map_err(|error| error.to_string())?;
    }

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

fn active_history_workspace() -> Result<ProjectWorkspaceConfig, String> {
    let paths = ensure_default_configs().map_err(|error| error.to_string())?;
    load_active_project_workspace(&paths).map_err(|error| error.to_string())
}

fn history_workspace_key_for_save(
    requested_workspace_key: Option<&str>,
    active_workspace_key: &str,
) -> String {
    requested_workspace_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(active_workspace_key)
        .to_string()
}

fn history_scope_for_save(
    project_key: &str,
    requested_workspace_key: Option<&str>,
) -> Result<(String, Option<String>), String> {
    let active_workspace = active_history_workspace()?;
    let workspace_key =
        history_workspace_key_for_save(requested_workspace_key, &active_workspace.key);
    let workspace = if workspace_key == active_workspace.key {
        active_workspace
    } else {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        load_project_workspace_by_key(&paths.project_workspaces, &workspace_key)
            .map_err(|error| error.to_string())?
    };
    let project_instance_path = workspace
        .project_instance_path(project_key)
        .map(|path| path.display().to_string());
    Ok((workspace.key, project_instance_path))
}

fn record_workspace_operation(workspace_key: &str, event: WorkspaceOperationWorklogEvent) {
    let result = (|| {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        append_workspace_operation_worklog(&paths, workspace_key, event)
            .map_err(|error| error.to_string())
    })();
    if let Err(error) = result {
        eprintln!("failed to record workspace worklog: {error}");
    }
}

fn record_active_workspace_operation(event: WorkspaceOperationWorklogEvent) {
    match active_history_workspace() {
        Ok(workspace) => record_workspace_operation(&workspace.key, event),
        Err(error) => eprintln!("failed to resolve workspace worklog: {error}"),
    }
}

fn build_history_worklog_event(
    request: &SaveBuildHistoryRequest,
) -> Option<WorkspaceOperationWorklogEvent> {
    let success = matches!(request.state_key.as_str(), "success" | "succeeded");
    let failure = matches!(
        request.state_key.as_str(),
        "failure" | "failed" | "error" | "cancelled"
    );
    if !success && !failure {
        return None;
    }
    let mut detail = vec![format!("- 项目: `{}`", request.project_key)];
    if !request.mode.trim().is_empty() {
        detail.push(format!("- 任务: {}", request.mode.trim()));
    }
    if let Some(env) = request
        .env
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        detail.push(format!("- 环境: `{}`", env.trim()));
    }
    if let Some(branch) = request
        .branch
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        detail.push(format!("- 分支: `{}`", branch.trim()));
    }
    if !request.detail.trim().is_empty() {
        detail.push(String::new());
        detail.push(request.detail.trim().to_string());
    }
    if let Some(url) = request
        .build_url
        .as_deref()
        .or(request.queue_url.as_deref())
        .filter(|value| !value.trim().is_empty())
    {
        detail.push(String::new());
        detail.push(format!("- 构建地址: {url}"));
    }
    Some(WorkspaceOperationWorklogEvent {
        event_id: Some(format!(
            "build:{}:{}",
            request.history_key, request.state_key
        )),
        kind: "构建".to_string(),
        summary: format!("{} · {}", request.project_name, request.state_label),
        detail: Some(detail.join("\n")),
        success,
    })
}

fn sync_build_history_side_effects(storage: &Storage, request: &SaveDeployHistoryRequest) {
    if let Err(error) = update_build_operation_event_from_history(storage, request) {
        eprintln!("failed to update build operation event: {error}");
    }
    if let Some(event) = build_history_worklog_event(request) {
        record_workspace_operation(
            request.workspace_key.as_deref().unwrap_or_default(),
            event,
        );
    }
}

fn save_build_history_record(
    storage: &Storage,
    request: SaveDeployHistoryRequest,
) -> Result<(), String> {
    storage.save_deploy_history(request.clone())?;
    sync_build_history_side_effects(storage, &request);
    Ok(())
}

fn default_build_operation_title(action: &str) -> &'static str {
    match action.trim().to_ascii_lowercase().as_str() {
        "deploy" => "触发部署",
        "package" => "触发产物构建",
        "release" => "触发发布",
        _ => "触发构建",
    }
}

fn merge_history_worklog_event(
    request: &SaveMergeHistoryRequest,
) -> WorkspaceOperationWorklogEvent {
    let mut detail = vec![
        format!("- 项目: `{}`", request.project_key),
        format!(
            "- 分支: `{}` → `{}`",
            request.source_branch, request.target_branch
        ),
        format!("- 模式: {}", if request.remote { "远程" } else { "本地" }),
    ];
    if !request.detail.trim().is_empty() {
        detail.push(String::new());
        detail.push(request.detail.trim().to_string());
    }
    WorkspaceOperationWorklogEvent {
        event_id: Some(format!(
            "git-merge:{}:{}",
            request.history_key,
            if request.success {
                "success"
            } else {
                "failure"
            }
        )),
        kind: "Git".to_string(),
        summary: format!("{} · {}", request.project_name, request.summary),
        detail: Some(detail.join("\n")),
        success: request.success,
    }
}

fn record_branch_task_operation(
    workspace_key: &str,
    action: &str,
    result: &Result<BranchTaskResponse, String>,
) {
    let event = match result {
        Ok(response) => {
            let failed_items = response
                .items
                .iter()
                .filter(|item| !item.success)
                .map(|item| format!("- {}: {}", item.project_name, item.detail))
                .collect::<Vec<_>>();
            let detail = if failed_items.is_empty() {
                response.detail.clone()
            } else {
                format!("{}\n\n{}", response.detail, failed_items.join("\n"))
            };
            WorkspaceOperationWorklogEvent {
                event_id: None,
                kind: "Git".to_string(),
                summary: format!("{action} · {}", response.summary),
                detail: Some(detail),
                success: response.success,
            }
        }
        Err(error) => WorkspaceOperationWorklogEvent {
            event_id: None,
            kind: "Git".to_string(),
            summary: format!("{action}失败"),
            detail: Some(error.clone()),
            success: false,
        },
    };
    record_workspace_operation(workspace_key, event);
}

#[allow(clippy::too_many_arguments)]
fn record_branch_task_event(
    storage: &Storage,
    event_id: String,
    origin: OperationEventOrigin,
    workspace_key: &str,
    action_label: &str,
    action_key: &str,
    fallback_project_key: Option<&str>,
    result: &Result<BranchTaskResponse, String>,
    related_history_keys: Vec<String>,
) {
    let event = branch_task_operation_event(
        event_id,
        origin,
        workspace_key.to_string(),
        action_label,
        action_key,
        fallback_project_key,
        result.as_ref().ok(),
        result.as_ref().err().map(String::as_str),
        related_history_keys,
    );
    if let Err(error) = save_operation_event(storage, &event) {
        eprintln!("failed to save branch operation event: {error}");
    }
}

fn operation_event_origin(value: Option<&str>) -> OperationEventOrigin {
    if value.is_some_and(|value| value.trim().eq_ignore_ascii_case("tray")) {
        OperationEventOrigin::Tray
    } else {
        OperationEventOrigin::App
    }
}

#[allow(clippy::too_many_arguments)]
fn record_lifecycle_operation_event(
    storage: &Storage,
    event_id: String,
    origin: OperationEventOrigin,
    workspace_key: &str,
    domain: &str,
    action: &str,
    state: OperationEventState,
    title: &str,
    summary: &str,
    detail: &str,
    project_key: Option<&str>,
    project_name: Option<&str>,
    payload: Option<serde_json::Value>,
) {
    let event = lifecycle_operation_event(
        event_id,
        origin,
        workspace_key.to_string(),
        domain,
        action,
        state,
        title,
        summary,
        detail,
        project_key,
        project_name,
        payload,
    );
    if let Err(error) = save_operation_event(storage, &event) {
        eprintln!("failed to save {domain} operation event: {error}");
    }
}

fn record_link_operation_event(
    storage: &Storage,
    event_id: String,
    origin: OperationEventOrigin,
    workspace_key: &str,
    action: &str,
    link_key: &str,
    source_id: Option<&str>,
    result: &Result<LinkExecutionReport, String>,
) {
    let event = link_operation_event(
        event_id,
        origin,
        workspace_key.to_string(),
        action,
        link_key,
        source_id,
        result.as_ref().ok(),
        result.as_ref().err().map(String::as_str),
    );
    if let Err(error) = save_operation_event(storage, &event) {
        eprintln!("failed to save link operation event: {error}");
    }
}

fn runtime_start_operation_state(status_key: &str) -> OperationEventState {
    match status_key.trim() {
        "running" => OperationEventState::Success,
        "failed" | "exited" | "invalidConfig" | "lost" => OperationEventState::Failed,
        _ => OperationEventState::Info,
    }
}

fn operation_summary(status_label: &str, detail: &str) -> String {
    let status_label = status_label.trim();
    let detail = detail.trim();
    match (status_label.is_empty(), detail.is_empty()) {
        (false, false) => format!("{status_label} · {detail}"),
        (false, true) => status_label.to_string(),
        (true, false) => detail.to_string(),
        (true, true) => "操作已完成".to_string(),
    }
}

fn scoped_build_history(
    storage: &Storage,
    workspace: &ProjectWorkspaceConfig,
) -> Result<Vec<BuildHistoryEntry>, String> {
    if workspace.is_system() {
        return storage.list_deploy_history();
    }
    Ok(storage
        .list_all_deploy_history()?
        .into_iter()
        .filter(|entry| entry.workspace_key.as_deref() == Some(workspace.key.as_str()))
        .filter(|entry| workspace.allows_project(&entry.project_key))
        .take(20)
        .collect())
}

fn filter_build_history_by_active_workspace(
    storage: &Storage,
) -> Result<Vec<BuildHistoryEntry>, String> {
    let workspace = active_history_workspace()?;
    scoped_build_history(storage, &workspace)
}

fn clear_build_history_by_active_workspace(storage: &Storage) -> Result<usize, String> {
    let workspace = active_history_workspace()?;
    if workspace.is_system() {
        storage.clear_deploy_history()
    } else {
        storage.clear_deploy_history_for_workspace(&workspace.key)
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
    let workspace = active_history_workspace()?;
    if workspace.is_system() {
        return storage.list_merge_history();
    }
    Ok(storage
        .list_all_merge_history()?
        .into_iter()
        .filter(|entry| entry.workspace_key.as_deref() == Some(workspace.key.as_str()))
        .filter(|entry| workspace.allows_project(&entry.project_key))
        .take(12)
        .collect())
}

fn filter_operation_events_by_active_workspace(
    storage: &Storage,
) -> Result<Vec<OperationEvent>, String> {
    let workspace = active_history_workspace()?;
    let events = list_operation_events(storage)?;
    if workspace.is_system() {
        return Ok(events);
    }
    Ok(events
        .into_iter()
        .filter(|event| event.workspace_key == workspace.key)
        .filter(|event| {
            event
                .project_key
                .as_deref()
                .is_none_or(|project_key| workspace.allows_project(project_key))
        })
        .collect())
}

fn clear_merge_history_by_active_workspace(storage: &Storage) -> Result<usize, String> {
    let workspace = active_history_workspace()?;
    if workspace.is_system() {
        storage.clear_merge_history()
    } else {
        storage.clear_merge_history_for_workspace(&workspace.key)
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
        "linksPath": links_file_path(),
        "proxyPath": default_proxy_path().display().to_string(),
        "storagePath": default_storage_path().display().to_string(),
    })
}

fn load_app_exit_runtime_policy(storage: &Storage) -> AppExitRuntimePolicy {
    storage
        .get_json(APP_EXIT_STORAGE_NAMESPACE, APP_EXIT_RUNTIME_POLICY_KEY)
        .ok()
        .flatten()
        .and_then(|value| value.as_str().and_then(AppExitRuntimePolicy::parse))
        .unwrap_or(AppExitRuntimePolicy::Ask)
}

fn persist_app_exit_runtime_policy(
    storage: &Storage,
    policy: AppExitRuntimePolicy,
) -> Result<(), String> {
    storage.set_json(
        APP_EXIT_STORAGE_NAMESPACE,
        APP_EXIT_RUNTIME_POLICY_KEY,
        &json!(policy.as_str()),
    )
}

#[tauri::command]
async fn get_app_exit_runtime_policy(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || {
        Ok(load_app_exit_runtime_policy(&storage).as_str().to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_app_exit_runtime_policy(
    state: tauri::State<'_, AppState>,
    policy: String,
) -> Result<String, String> {
    let policy = AppExitRuntimePolicy::parse(&policy)
        .ok_or_else(|| "退出策略必须是 ask、keep 或 stop".to_string())?;
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || {
        persist_app_exit_runtime_policy(&storage, policy)?;
        Ok(policy.as_str().to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn cancel_app_exit(state: tauri::State<'_, AppState>) {
    state
        .exit_coordinator
        .request_in_progress
        .store(false, Ordering::Release);
}

#[tauri::command]
async fn confirm_app_exit(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    policy: String,
    remember: bool,
) -> Result<AppStartedRuntimeShutdownReport, String> {
    let policy = AppExitRuntimePolicy::parse(&policy)
        .filter(|policy| *policy != AppExitRuntimePolicy::Ask)
        .ok_or_else(|| "请选择保留运行或停止后退出".to_string())?;
    let runtime = state.project_runtime.clone();
    let storage = state.storage.clone();
    let exit_coordinator = state.exit_coordinator.clone();
    let report = tauri::async_runtime::spawn_blocking(move || {
        if policy == AppExitRuntimePolicy::Stop {
            runtime.shutdown_app_started_runtimes()
        } else {
            AppStartedRuntimeShutdownReport {
                requested: 0,
                stopped: 0,
                skipped: 0,
                failures: Vec::new(),
            }
        }
    })
    .await
    .map_err(|error| error.to_string())?;

    if !report.failures.is_empty() {
        exit_coordinator
            .request_in_progress
            .store(false, Ordering::Release);
        return Err(report.failures.join("；"));
    }
    if remember {
        persist_app_exit_runtime_policy(&storage, policy)?;
    }
    begin_app_exit(&app, &exit_coordinator);
    Ok(report)
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
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    workspace_key: String,
) -> Result<ProjectWorkspaceState, String> {
    let config_state = state.config_state.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        activate_project_workspace(&config_state, &workspace_key)
    })
    .await
    .map_err(|error| error.to_string())?;
    if result.is_ok() {
        refresh_tray_menu(&app);
    }
    result
}

fn activate_project_workspace(
    config_state: &AppConfigState,
    workspace_key: &str,
) -> Result<ProjectWorkspaceState, String> {
    let paths = ensure_default_configs().map_err(|error| error.to_string())?;
    let workspace = load_project_workspace_by_key(&paths.project_workspaces, workspace_key)
        .map_err(|error| error.to_string())?;
    let mut app_workspace =
        load_workspace_config(&paths.workspace).map_err(|error| error.to_string())?;
    app_workspace.app.active_workspace = Some(workspace.key);
    save_workspace_config(&paths.workspace, &app_workspace).map_err(|error| error.to_string())?;

    let config = config_state.load()?;
    project_workspace_state(&config)
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
        let resource_dir = payload.resource_dir.as_deref().and_then(|value| {
            let value = value.trim().to_string();
            (!value.is_empty()).then_some(PathBuf::from(value))
        });
        let worklog_file = payload.worklog_file.as_deref().and_then(|value| {
            let value = value.trim().to_string();
            (!value.is_empty()).then_some(PathBuf::from(value))
        });
        let mut workspace = create_project_workspace(
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
        if payload.create_worklog || resource_dir.is_some() || worklog_file.is_some() {
            initialize_workspace_resources(
                &paths,
                &workspace.key,
                resource_dir,
                worklog_file,
                payload.create_worklog,
            )
            .map_err(|error| error.to_string())?;
            set_workspace_worklog_auto_record(&paths, &workspace.key, payload.worklog_auto_record)
                .map_err(|error| error.to_string())?;
        } else {
            workspace.worklog_auto_record = false;
            save_project_workspace_config(
                &paths
                    .project_workspaces
                    .join(format!("{}.toml", workspace.key)),
                &workspace,
            )
            .map_err(|error| error.to_string())?;
        }

        let config = config_state.load()?;
        project_workspace_state(&config)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn delete_project_workspace_config(
    state: tauri::State<'_, AppState>,
    workspace_key: String,
) -> Result<ProjectWorkspaceState, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let workspace = load_project_workspace_by_key(&paths.project_workspaces, &workspace_key)
            .map_err(|error| error.to_string())?;
        if workspace.is_system() {
            return Err("全局工作区不能删除".to_string());
        }

        let path = paths
            .project_workspaces
            .join(format!("{}.toml", workspace.key));
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|error| format!("删除工作区配置失败：{} ({})", path.display(), error))?;
        }

        let mut app_workspace =
            load_workspace_config(&paths.workspace).map_err(|error| error.to_string())?;
        if active_project_workspace_key(&app_workspace) == workspace.key {
            app_workspace.app.active_workspace = Some(SYSTEM_PROJECT_WORKSPACE_KEY.to_string());
            save_workspace_config(&paths.workspace, &app_workspace)
                .map_err(|error| error.to_string())?;
        }

        let proxy_path = ensure_proxy_config().map_err(|error| error.to_string())?;
        let mut proxy_config = load_proxy_config(&proxy_path).map_err(|error| error.to_string())?;
        let mut proxy_changed = false;
        for profile in &mut proxy_config.profiles {
            if profile.workspace_key.as_deref() == Some(workspace.key.as_str()) {
                profile.workspace_key = None;
                proxy_changed = true;
            }
        }
        if proxy_changed {
            save_proxy_config(&proxy_path, &proxy_config).map_err(|error| error.to_string())?;
        }

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
        let copy_mode = match payload.copy_mode.as_deref().unwrap_or("existing") {
            "existing" => InitDemandWorkspaceCopyMode::Existing,
            "worktree" => InitDemandWorkspaceCopyMode::Worktree,
            "clone" => InitDemandWorkspaceCopyMode::Clone,
            value => return Err(format!("不支持的工作区副本模式：{value}")),
        };
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
                repo_path: payload
                    .repo_path
                    .filter(|value| !value.trim().is_empty())
                    .map(PathBuf::from),
                project: payload.project,
                branch: payload.branch,
                root_dir: payload.root_dir.map(PathBuf::from),
                instance_dir: payload.instance_dir.map(PathBuf::from),
                copy_mode,
                resource_dir: payload.resource_dir.map(PathBuf::from),
                worklog_file: payload.worklog_file.map(PathBuf::from),
                create_worklog: payload.create_worklog,
                worklog_auto_record: payload.create_worklog && payload.worklog_auto_record,
                requirement_category: payload.requirement_category,
                requirement_short_label: payload.requirement_short_label,
                requirement_entry_name: payload.requirement_entry_name,
                activate: payload.activate,
                allow_remote_mismatch: payload.allow_remote_mismatch,
                dry_run: payload.dry_run,
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
async fn get_proxy_dashboard(
    state: tauri::State<'_, AppState>,
    source_id: Option<String>,
) -> Result<ProxyDashboard, String> {
    let runtime = state.proxy_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (source, path) = proxy_path_for_source_id(source_id)?;
        proxy_dashboard_for_source(&runtime, &source, &path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn diagnose_proxy_request(
    source_id: Option<String>,
    profile: Option<String>,
    method: String,
    url: String,
    headers: Option<BTreeMap<String, String>>,
) -> Result<ProxyRequestDiagnosis, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (source, path) = proxy_path_for_source_id(source_id)?;
        let config = load_proxy_config(&path).map_err(|error| error.to_string())?;
        let config = if source.is_default {
            let workspace = active_proxy_workspace()?;
            filter_proxy_config_for_workspace(config, &workspace)
        } else {
            config
        };
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
    source_id: Option<String>,
    profile: ProxyProfile,
) -> Result<ProxyDashboard, String> {
    let runtime = state.proxy_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (source, path) = proxy_path_for_source_id(source_id)?;
        let profile = if source.is_default {
            let workspace = active_proxy_workspace()?;
            scope_proxy_profile_for_workspace(profile, &workspace)
        } else {
            profile
        };
        validate_proxy_profile(&profile).map_err(|error| error.to_string())?;
        upsert_proxy_profile(&path, profile).map_err(|error| error.to_string())?;
        proxy_dashboard_for_source(&runtime, &source, &path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn delete_proxy_profile(
    state: tauri::State<'_, AppState>,
    source_id: Option<String>,
    profile_id: String,
) -> Result<ProxyDashboard, String> {
    let runtime = state.proxy_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (source, path) = proxy_path_for_source_id(source_id)?;
        runtime.stop_profile(&path, &profile_id);
        core_delete_proxy_profile(&path, &profile_id).map_err(|error| error.to_string())?;
        runtime.clear_events(&path, Some(&profile_id));
        proxy_dashboard_for_source(&runtime, &source, &path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_proxy_rule(
    state: tauri::State<'_, AppState>,
    source_id: Option<String>,
    rule: ProxyRule,
) -> Result<ProxyDashboard, String> {
    let runtime = state.proxy_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (source, path) = proxy_path_for_source_id(source_id)?;
        validate_proxy_rule(&rule).map_err(|error| error.to_string())?;
        upsert_proxy_rule(&path, rule).map_err(|error| error.to_string())?;
        proxy_dashboard_for_source(&runtime, &source, &path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn delete_proxy_rule(
    state: tauri::State<'_, AppState>,
    source_id: Option<String>,
    rule_id: String,
) -> Result<ProxyDashboard, String> {
    let runtime = state.proxy_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (source, path) = proxy_path_for_source_id(source_id)?;
        core_delete_proxy_rule(&path, &rule_id).map_err(|error| error.to_string())?;
        proxy_dashboard_for_source(&runtime, &source, &path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn start_proxy_profile(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    source_id: Option<String>,
    profile_id: String,
    activity_id: Option<String>,
    operation_origin: Option<String>,
) -> Result<ProxyDashboard, String> {
    let runtime = state.proxy_runtime.clone();
    let storage = state.storage.clone();
    let workspace_key = active_history_workspace()?.key;
    let origin = operation_event_origin(operation_origin.as_deref());
    let event_id = operation_event_id(activity_id.as_deref(), origin, "proxy-start");
    let event_profile_id = profile_id.clone();
    let event_source_id = source_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let (source, path) = proxy_path_for_source_id(source_id)?;
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
        proxy_dashboard_for_source(&runtime, &source, &path)
    })
    .await
    .map_err(|error| error.to_string())?;
    if result.is_ok() {
        refresh_tray_menu(&app);
    }
    match &result {
        Ok(dashboard) => {
            let profile = dashboard
                .config
                .profiles
                .iter()
                .find(|profile| profile.id == event_profile_id);
            let status = dashboard
                .statuses
                .iter()
                .find(|status| status.profile_id == event_profile_id);
            let profile_name = profile
                .map(|profile| profile.name.as_str())
                .unwrap_or(event_profile_id.as_str());
            let listen_url = status
                .map(|status| status.listen_url.clone())
                .or_else(|| profile.map(|profile| profile.listen_url()))
                .unwrap_or_default();
            let running = status.is_some_and(|status| status.running);
            record_lifecycle_operation_event(
                &storage,
                event_id,
                origin,
                &workspace_key,
                "proxy",
                "start",
                if running {
                    OperationEventState::Success
                } else {
                    OperationEventState::Failed
                },
                if running {
                    "代理服务已启动"
                } else {
                    "代理服务启动失败"
                },
                &format!(
                    "{profile_name} · {}",
                    if running { "已启动" } else { "启动后未监听" }
                ),
                &format!("监听地址：{listen_url}"),
                None,
                None,
                Some(json!({
                    "profileId": event_profile_id.clone(),
                    "profileName": profile_name,
                    "sourceId": event_source_id.clone(),
                    "listenUrl": listen_url,
                    "running": running,
                    "configPath": dashboard.config_path.clone(),
                })),
            );
        }
        Err(error) => record_lifecycle_operation_event(
            &storage,
            event_id,
            origin,
            &workspace_key,
            "proxy",
            "start",
            OperationEventState::Failed,
            "启动代理服务",
            "代理服务启动失败",
            error,
            None,
            None,
            Some(json!({
                "profileId": event_profile_id.clone(),
                "sourceId": event_source_id.clone(),
            })),
        ),
    }
    result
}

#[tauri::command]
async fn stop_proxy_profile(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    source_id: Option<String>,
    profile_id: String,
    activity_id: Option<String>,
    operation_origin: Option<String>,
) -> Result<ProxyDashboard, String> {
    let runtime = state.proxy_runtime.clone();
    let storage = state.storage.clone();
    let workspace_key = active_history_workspace()?.key;
    let origin = operation_event_origin(operation_origin.as_deref());
    let event_id = operation_event_id(activity_id.as_deref(), origin, "proxy-stop");
    let event_profile_id = profile_id.clone();
    let event_source_id = source_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let (source, path) = proxy_path_for_source_id(source_id)?;
        runtime
            .stop_profile_result(&path, &profile_id)
            .map_err(|error| error.to_string())?;
        proxy_dashboard_for_source(&runtime, &source, &path)
    })
    .await
    .map_err(|error| error.to_string())?;
    if result.is_ok() {
        refresh_tray_menu(&app);
    }
    match &result {
        Ok(dashboard) => {
            let profile = dashboard
                .config
                .profiles
                .iter()
                .find(|profile| profile.id == event_profile_id);
            let status = dashboard
                .statuses
                .iter()
                .find(|status| status.profile_id == event_profile_id);
            let profile_name = profile
                .map(|profile| profile.name.as_str())
                .unwrap_or(event_profile_id.as_str());
            let listen_url = status
                .map(|status| status.listen_url.clone())
                .or_else(|| profile.map(|profile| profile.listen_url()))
                .unwrap_or_default();
            let running = status.is_some_and(|status| status.running);
            record_lifecycle_operation_event(
                &storage,
                event_id,
                origin,
                &workspace_key,
                "proxy",
                "stop",
                if running {
                    OperationEventState::Failed
                } else {
                    OperationEventState::Success
                },
                if running {
                    "代理服务停止失败"
                } else {
                    "代理服务已停止"
                },
                &format!(
                    "{profile_name} · {}",
                    if running { "停止后仍在监听" } else { "已停止" }
                ),
                &format!("监听地址：{listen_url}"),
                None,
                None,
                Some(json!({
                    "profileId": event_profile_id.clone(),
                    "profileName": profile_name,
                    "sourceId": event_source_id.clone(),
                    "listenUrl": listen_url,
                    "running": running,
                    "configPath": dashboard.config_path.clone(),
                })),
            );
        }
        Err(error) => record_lifecycle_operation_event(
            &storage,
            event_id,
            origin,
            &workspace_key,
            "proxy",
            "stop",
            OperationEventState::Failed,
            "停止代理服务",
            "代理服务停止失败",
            error,
            None,
            None,
            Some(json!({
                "profileId": event_profile_id.clone(),
                "sourceId": event_source_id.clone(),
            })),
        ),
    }
    result
}

#[tauri::command]
async fn clear_proxy_events(
    state: tauri::State<'_, AppState>,
    source_id: Option<String>,
    profile_id: Option<String>,
) -> Result<ProxyDashboard, String> {
    let runtime = state.proxy_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (source, path) = proxy_path_for_source_id(source_id)?;
        if let Some(profile_id) = profile_id.as_deref() {
            runtime.clear_events(&path, Some(profile_id));
        } else if source.is_default {
            let workspace = active_proxy_workspace()?;
            if workspace.is_system() {
                runtime.clear_events(&path, None);
            } else {
                let config = load_proxy_config(&path).map_err(|error| error.to_string())?;
                for profile in config.profiles.iter().filter(|profile| {
                    profile.workspace_key.as_deref() == Some(workspace.key.as_str())
                }) {
                    runtime.clear_events(&path, Some(&profile.id));
                }
            }
        } else {
            runtime.clear_events(&path, None);
        }
        proxy_dashboard_for_source(&runtime, &source, &path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn export_proxy_profile_pack(
    state: tauri::State<'_, AppState>,
    source_id: Option<String>,
    profile_id: String,
    path: String,
) -> Result<ProxyDashboard, String> {
    let runtime = state.proxy_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let target_path = PathBuf::from(path);
        if target_path.as_os_str().is_empty() {
            return Err("导出路径不能为空".to_string());
        }
        let (source, config_path) = proxy_path_for_source_id(source_id)?;
        let pack = core_export_proxy_profile_pack(&config_path, &profile_id)
            .map_err(|error| error.to_string())?;
        let content = serde_json::to_string_pretty(&pack).map_err(|error| error.to_string())?;
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(&target_path, content).map_err(|error| error.to_string())?;
        proxy_dashboard_for_source(&runtime, &source, &config_path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn import_proxy_profile_pack(
    state: tauri::State<'_, AppState>,
    source_id: Option<String>,
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
        let (source, config_path) = proxy_path_for_source_id(source_id)?;
        let pack = if source.is_default {
            let workspace = active_proxy_workspace()?;
            scope_proxy_pack_for_workspace(pack, &workspace)
        } else {
            pack
        };
        core_import_proxy_profile_pack(&config_path, pack).map_err(|error| error.to_string())?;
        proxy_dashboard_for_source(&runtime, &source, &config_path)
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
    proxy_path: &Path,
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

    let path = proxy_path.to_path_buf();
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
        command: profile.command.clone(),
        cwd: profile.cwd.as_ref().map(|path| path.display().to_string()),
        expected_port: profile.expected_port,
        focus_url: profile.focus_url.clone(),
        ready_probe: profile
            .ready_probe
            .as_ref()
            .map(|probe| ProjectDebugReadyProbeEditor {
                url: probe.url.clone(),
                path: probe.path.clone(),
                expected_statuses: probe.expected_statuses.clone(),
                timeout_ms: probe.timeout_ms,
            }),
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
        if profile.expected_port == Some(0) {
            return Err(format!("调试档案 {} 的预期端口必须在 1-65535 之间", key));
        }
        let focus_url = optional_editor_string(profile.focus_url);
        if focus_url
            .as_deref()
            .is_some_and(|url| !url.starts_with("http://") && !url.starts_with("https://"))
        {
            return Err(format!("调试档案 {} 的启动页面必须使用 http 或 https", key));
        }
        let ready_probe = profile
            .ready_probe
            .map(|probe| {
                let url = optional_editor_string(probe.url);
                if url
                    .as_deref()
                    .is_some_and(|url| !url.starts_with("http://") && !url.starts_with("https://"))
                {
                    return Err(format!(
                        "调试档案 {} 的 Ready URL 必须使用 http 或 https",
                        key
                    ));
                }
                if probe
                    .expected_statuses
                    .iter()
                    .any(|status| !(100..=599).contains(status))
                {
                    return Err(format!(
                        "调试档案 {} 的 Ready 状态码必须在 100-599 之间",
                        key
                    ));
                }
                if probe
                    .timeout_ms
                    .is_some_and(|timeout| !(100..=600_000).contains(&timeout))
                {
                    return Err(format!(
                        "调试档案 {} 的 Ready 超时必须在 100-600000ms 之间",
                        key
                    ));
                }
                Ok(rdevtool_core::config::ProjectDebugReadyProbeConfig {
                    url,
                    path: optional_editor_string(probe.path),
                    expected_statuses: probe.expected_statuses,
                    timeout_ms: probe.timeout_ms,
                })
            })
            .transpose()?;
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
            command: optional_editor_string(profile.command),
            cwd: optional_editor_string(profile.cwd).map(PathBuf::from),
            expected_port: profile.expected_port,
            focus_url,
            ready_probe,
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
                artifact_output_dir: target
                    .artifact
                    .as_ref()
                    .and_then(|artifact| artifact.output_dir.as_ref())
                    .map(|path| path.display().to_string()),
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
                        impact_paths: param.impact_paths.clone(),
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
        runtime_config_path: None,
        runtime_profile_scope: "global".to_string(),
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

fn load_project_config_editor_state_for_source(
    path: &Path,
    source: &ConfigSource,
) -> Result<ProjectConfigEditorState, String> {
    let mut state = load_project_config_editor_state(path)?;
    if source.is_default {
        return Ok(state);
    }
    let Some(runtime_path) = runtime_overrides_path_for_config_source(source)? else {
        state.runtime_profile_scope = "unsupported".to_string();
        return Ok(state);
    };
    state.runtime_config_path = Some(runtime_path.display().to_string());
    if runtime_path.exists() {
        let overrides = load_runtime_overrides(&runtime_path)?;
        state.runtime_profiles = overrides
            .runtime_profiles
            .iter()
            .map(runtime_profile_to_editor)
            .collect();
        state.runtime_profile_scope = "override".to_string();
    } else {
        state.runtime_profile_scope = "inherited".to_string();
    }
    Ok(state)
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
                impact_paths: param
                    .impact_paths
                    .into_iter()
                    .filter_map(|path| optional_editor_string(Some(path)))
                    .collect(),
            });
        }

        next_targets.push(DeployTargetConfig {
            key: target_key,
            label: label.to_string(),
            adapter,
            action_kind: build_action_kind_from_key(&target.action_kind)?,
            jenkins_profile: jenkins_profile.to_string(),
            job_name: job_name.to_string(),
            artifact: optional_editor_path(target.artifact_output_dir).map(|output_dir| {
                BuildArtifactConfig {
                    output_dir: Some(output_dir),
                }
            }),
            params,
        });
    }

    Ok(next_targets)
}

#[tauri::command]
async fn get_project_config_editor(
    source_id: Option<String>,
) -> Result<ProjectConfigEditorState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let source = resolve_app_config_source(source_id)?;
        load_project_config_editor_state_for_source(&paths.projects, &source)
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
    source_id: Option<String>,
    request: SaveRuntimeProfilesRequest,
) -> Result<ProjectConfigEditorState, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let source = resolve_app_config_source(source_id)?;
        let runtime_profiles = runtime_profiles_from_editor(request.runtime_profiles)?;
        if !source.is_default {
            let runtime_path = runtime_overrides_path_for_config_source(&source)?
                .ok_or_else(|| format!("配置源不支持运行配置：{}", source.name))?;
            save_runtime_overrides(&runtime_path, runtime_profiles)?;
            return load_project_config_editor_state_for_source(&paths.projects, &source);
        }
        let mut config = load_config(&paths.projects).map_err(|error| error.to_string())?;

        config.defaults.runtime_profiles = runtime_profiles;

        save_config(&paths.projects, &config).map_err(|error| error.to_string())?;
        config_state.invalidate()?;

        load_project_config_editor_state_for_source(&paths.projects, &source)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn restore_runtime_profile_inheritance(
    source_id: String,
) -> Result<ProjectConfigEditorState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let source = resolve_app_config_source(Some(source_id))?;
        if source.is_default {
            return Err("默认配置没有可恢复的上级运行配置".to_string());
        }
        let runtime_path = runtime_overrides_path_for_config_source(&source)?
            .ok_or_else(|| format!("配置源不支持运行配置：{}", source.name))?;
        if runtime_path.exists() {
            fs::remove_file(&runtime_path).map_err(|error| {
                format!("删除运行配置覆盖失败：{} ({error})", runtime_path.display())
            })?;
        }
        load_project_config_editor_state_for_source(&paths.projects, &source)
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
) -> Result<BranchCatalogResponse, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        let config = apply_active_workspace_context(&config)?;
        branch_catalog(&config, &project).map_err(|error| error.to_string())
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
    activity_id: Option<String>,
    operation_origin: Option<String>,
    activity_title: Option<String>,
    expected_workspace_key: Option<String>,
) -> Result<BuildTriggerResponse, String> {
    let storage = state.storage.clone();
    let config_state = state.config_state.clone();
    let runtime = state.project_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = active_history_workspace()?;
        ensure_build_execution_workspace(&workspace, expected_workspace_key.as_deref())?;
        let origin = operation_event_origin(operation_origin.as_deref());
        let event_id = operation_event_id(activity_id.as_deref(), origin, "build");
        let project_key = request.project.clone();
        let config = config_state.load()?;
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let config = apply_workspace_context(&config, &workspace, &paths)?;
        let project_name = config
            .find_project(&project_key)
            .ok()
            .map(|project| project.name.clone());
        let replay_request = request.clone();
        let result = trigger_build_for_desktop(&runtime, &config, request);
        match &result {
            Ok(response) => {
                let title = activity_title
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| default_build_operation_title(&response.plan.action_kind));
                let history = build_history_request(&workspace, response, &event_id);
                let event = build_operation_event(
                    event_id,
                    origin,
                    workspace.key.clone(),
                    title,
                    &response.plan.action_kind,
                    &history,
                );
                if let Err(error) = save_operation_event(&storage, &event) {
                    eprintln!("failed to save build operation event: {error}");
                }
                if let Err(error) = save_build_history_record(&storage, history) {
                    eprintln!("failed to save build history: {error}");
                }
            }
            Err(error) => {
                let title = activity_title
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| default_build_operation_title("build"));
                let event = failed_build_operation_event(
                    event_id.clone(),
                    origin,
                    workspace.key.clone(),
                    title,
                    "build",
                    project_name.as_deref(),
                    &replay_request,
                    error,
                );
                if let Err(save_error) = save_operation_event(&storage, &event) {
                    eprintln!("failed to save build failure event: {save_error}");
                }
                record_workspace_operation(
                    &workspace.key,
                    WorkspaceOperationWorklogEvent {
                        event_id: Some(format!("build:{event_id}:failure")),
                        kind: "构建".to_string(),
                        summary: format!("{title}失败"),
                        detail: Some(error.clone()),
                        success: false,
                    },
                );
            }
        }
        result
    })
    .await
    .map_err(|error| error.to_string())?
}

fn ensure_build_execution_workspace(
    active_workspace: &ProjectWorkspaceConfig,
    expected_workspace_key: Option<&str>,
) -> Result<(), String> {
    let Some(expected_workspace_key) = expected_workspace_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(());
    };
    if expected_workspace_key == active_workspace.key {
        return Ok(());
    }
    Err(format!(
        "构建工作区已变化：记录来自「{expected_workspace_key}」，当前工作区为「{}」。请先切换到原工作区后重试。",
        active_workspace.key
    ))
}

#[tauri::command]
async fn refresh_build_status(
    state: tauri::State<'_, AppState>,
    request: StatusRequest,
) -> Result<BuildStatusResponse, String> {
    let storage = state.storage.clone();
    let config_state = state.config_state.clone();
    let runtime = state.project_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = active_history_workspace()?;
        let history_workspace_key = (!workspace.is_system()).then_some(workspace.key);
        let config = config_state.load()?;
        let config = apply_active_workspace_context(&config)?;
        let result = if let Some(project) = request
            .project
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            refresh_runtime_build_status(&runtime, &config, project)
        } else {
            refresh_deploy_status(&config, &request).map_err(|error| error.to_string())
        }?;
        match storage.update_deploy_history_status(
            &result,
            request.queue_url.as_deref(),
            request.build_url.as_deref(),
            request.project.as_deref(),
            history_workspace_key.as_deref(),
        ) {
            Ok(Some(history)) => sync_build_history_side_effects(&storage, &history),
            Ok(None) => {}
            Err(error) => eprintln!("failed to update build history status: {error}"),
        }
        Ok(result)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn trigger_build_for_desktop(
    runtime: &ProjectRuntimeState,
    config: &AppConfig,
    request: DeployRequest,
) -> Result<BuildTriggerResponse, String> {
    let plan = rdevtool_core::core::build_plan_refreshed(config, &request)
        .map_err(|error| error.to_string())?;
    if !plan.status.success {
        let detail = plan
            .risks
            .iter()
            .filter(|risk| risk.severity == "error")
            .map(|risk| risk.detail.as_str())
            .collect::<Vec<_>>()
            .join("；");
        return Err(format!("构建计划已阻断：{detail}"));
    }
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
async fn plan_branch_sync_task(
    state: tauri::State<'_, AppState>,
    request: BranchSyncRequest,
) -> Result<BranchTaskResponse, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        let config = apply_active_workspace_context(&config)?;
        plan_branch_sync(&config, &request).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn execute_branch_sync_task(
    state: tauri::State<'_, AppState>,
    request: BranchSyncRequest,
    activity_id: Option<String>,
    operation_origin: Option<String>,
) -> Result<BranchTaskResponse, String> {
    let storage = state.storage.clone();
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = active_history_workspace()?;
        let origin = operation_event_origin(operation_origin.as_deref());
        let event_id = operation_event_id(activity_id.as_deref(), origin, "sync");
        let config = config_state.load()?;
        let config = apply_active_workspace_context(&config)?;
        let result = execute_branch_sync(&config, &request).map_err(|error| error.to_string());
        let mut related_history_keys = Vec::new();
        if let Ok(response) = &result {
            match storage.save_branch_task_merge_history_for_event(
                &workspace,
                response,
                origin.as_str(),
                &event_id,
            ) {
                Ok(history_keys) => related_history_keys = history_keys,
                Err(error) => eprintln!("failed to save batch merge history: {error}"),
            }
        }
        let fallback_project_key = request
            .projects
            .first()
            .map(String::as_str)
            .or_else(|| (!request.project.trim().is_empty()).then_some(request.project.as_str()));
        record_branch_task_event(
            &storage,
            event_id,
            origin,
            &workspace.key,
            "合并分支",
            "sync",
            fallback_project_key,
            &result,
            related_history_keys,
        );
        record_branch_task_operation(&workspace.key, "合并分支", &result);
        result
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn execute_branch_create_task(
    state: tauri::State<'_, AppState>,
    request: BranchCreateRequest,
    activity_id: Option<String>,
    operation_origin: Option<String>,
) -> Result<BranchTaskResponse, String> {
    let storage = state.storage.clone();
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let workspace_key = active_history_workspace()?.key;
        let origin = operation_event_origin(operation_origin.as_deref());
        let event_id = operation_event_id(activity_id.as_deref(), origin, "create");
        let config = config_state.load()?;
        let config = apply_active_workspace_context(&config)?;
        let result = execute_branch_create(&config, &request).map_err(|error| error.to_string());
        record_branch_task_event(
            &storage,
            event_id.clone(),
            origin,
            &workspace_key,
            "创建分支",
            "create",
            request.projects.first().map(String::as_str),
            &result,
            vec![event_id],
        );
        record_branch_task_operation(&workspace_key, "创建分支", &result);
        result
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn checkout_branch_to_directory_task(
    state: tauri::State<'_, AppState>,
    request: BranchCheckoutRequest,
    activity_id: Option<String>,
    operation_origin: Option<String>,
) -> Result<BranchTaskResponse, String> {
    let storage = state.storage.clone();
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let workspace = load_active_project_workspace(&paths).map_err(|error| error.to_string())?;
        let origin = operation_event_origin(operation_origin.as_deref());
        let event_id = operation_event_id(activity_id.as_deref(), origin, "checkout");
        let project_key = request.project.clone();
        let config = config_state.load()?;
        let config = apply_project_workspace_context(&config, &workspace);
        let result = (|| {
            let result = checkout_branch_to_directory(&config, &request)
                .map_err(|error| error.to_string())?;
            if !workspace.is_system()
                && result.success
                && let Some(output_path) = result
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
            Ok(result)
        })();
        record_branch_task_event(
            &storage,
            event_id.clone(),
            origin,
            &workspace.key,
            "创建工作副本",
            "checkout",
            Some(&project_key),
            &result,
            vec![event_id],
        );
        record_branch_task_operation(&workspace.key, "创建工作副本", &result);
        result
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
    activity_id: Option<String>,
    operation_origin: Option<String>,
) -> Result<BranchTaskResponse, String> {
    let storage = state.storage.clone();
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let workspace_key = active_history_workspace()?.key;
        let origin = operation_event_origin(operation_origin.as_deref());
        let event_id = operation_event_id(activity_id.as_deref(), origin, "switch");
        let project_key = request.project.clone();
        let config = config_state.load()?;
        let config = apply_active_workspace_context(&config)?;
        let result = execute_branch_switch(&config, &request).map_err(|error| error.to_string());
        record_branch_task_event(
            &storage,
            event_id.clone(),
            origin,
            &workspace_key,
            "切换分支",
            "switch",
            Some(&project_key),
            &result,
            vec![event_id],
        );
        record_branch_task_operation(&workspace_key, "切换分支", &result);
        result
    })
    .await
    .map_err(|error| error.to_string())?
}

fn project_worktree_items(
    config: &AppConfig,
    workspace: &ProjectWorkspaceConfig,
    project: &str,
) -> Result<Vec<BranchWorktreeSummary>, String> {
    let mut items = project_worktrees(config, project).map_err(|error| error.to_string())?;
    let workspace_config = apply_project_workspace_context(config, workspace);
    if let Ok(workspace_items) = project_worktrees(&workspace_config, project) {
        for item in workspace_items {
            if !items
                .iter()
                .any(|current| same_path(Path::new(&current.repo_path), Path::new(&item.repo_path)))
            {
                items.push(item);
            }
        }
    }

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
        project_worktree_items(&config, &workspace, &project)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn repair_project_worktree(
    state: tauri::State<'_, AppState>,
    project: String,
    repo_path: String,
) -> Result<Vec<BranchWorktreeSummary>, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let workspace = load_active_project_workspace(&paths).map_err(|error| error.to_string())?;
        let config = config_state.load()?;
        let repo_path = PathBuf::from(repo_path.trim());
        if repo_path.as_os_str().is_empty() {
            return Err("工作副本目录不能为空".to_string());
        }
        if let Err(error) = core_repair_project_worktree(&config, &project, &repo_path) {
            let error = error.to_string();
            record_workspace_operation(
                &workspace.key,
                WorkspaceOperationWorklogEvent {
                    event_id: None,
                    kind: "配置".to_string(),
                    summary: format!("修复 {project} 工作副本失败"),
                    detail: Some(format!("- 目录: `{}`\n\n{error}", repo_path.display())),
                    success: false,
                },
            );
            return Err(error);
        }
        record_workspace_operation(
            &workspace.key,
            WorkspaceOperationWorklogEvent {
                event_id: None,
                kind: "配置".to_string(),
                summary: format!("修复 {project} 工作副本"),
                detail: Some(format!("- 目录: `{}`", repo_path.display())),
                success: true,
            },
        );
        project_worktree_items(&config, &workspace, &project)
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
async fn get_project_file_diff(
    state: tauri::State<'_, AppState>,
    request: BranchFileDiffRequest,
) -> Result<BranchFileDiffResponse, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        let config = apply_active_workspace_context(&config)?;
        branch_file_diff(&config, &request).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn execute_branch_push_task(
    state: tauri::State<'_, AppState>,
    request: BranchPushRequest,
    activity_id: Option<String>,
    operation_origin: Option<String>,
) -> Result<BranchTaskResponse, String> {
    let storage = state.storage.clone();
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let workspace_key = active_history_workspace()?.key;
        let origin = operation_event_origin(operation_origin.as_deref());
        let event_id = operation_event_id(activity_id.as_deref(), origin, "push");
        let project_key = request.project.clone();
        let config = config_state.load()?;
        let config = apply_active_workspace_context(&config)?;
        let result = execute_branch_push(&config, &request).map_err(|error| error.to_string());
        record_branch_task_event(
            &storage,
            event_id.clone(),
            origin,
            &workspace_key,
            "提交推送",
            "push",
            Some(&project_key),
            &result,
            vec![event_id],
        );
        record_branch_task_operation(&workspace_key, "提交推送", &result);
        result
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
async fn load_page_navigation(source_id: Option<String>) -> Result<NavigationData, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let workspace = load_active_project_workspace(&paths).map_err(|error| error.to_string())?;
        let source = core_resolve_config_source(
            source_id.as_deref(),
            &load_project_workspaces(&paths.project_workspaces)
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        if source.is_default {
            load_navigation_data_for_workspace(&workspace).map_err(|error| error.to_string())
        } else {
            load_navigation_source_data_for_workspace(
                &PathBuf::from(source.files.navigation),
                &workspace,
            )
            .map_err(|error| error.to_string())
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_config_sources() -> Result<Vec<ConfigSource>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspaces = load_config_source_workspaces()?;
        core_list_config_sources(&workspaces).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn compare_config_sources(
    left_source_id: String,
    right_source_id: String,
) -> Result<ConfigSourceComparison, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspaces = load_config_source_workspaces()?;
        core_compare_config_sources(&workspaces, &left_source_id, &right_source_id)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn copy_config_source(
    request: CopyConfigSourceRequest,
) -> Result<ConfigSourceCopyResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspaces = load_config_source_workspaces()?;
        let source_id = request.source_id.clone();
        let target_id = request.id.clone();
        match core_copy_config_source(&workspaces, request) {
            Ok(result) => {
                record_active_workspace_operation(WorkspaceOperationWorklogEvent {
                    event_id: None,
                    kind: "配置".to_string(),
                    summary: format!("复制配置源 {source_id} → {target_id}"),
                    detail: Some(format!(
                        "- 已复制文件: {}\n- 缺失文件: {}",
                        result.copied_count, result.missing_count
                    )),
                    success: true,
                });
                Ok(result)
            }
            Err(error) => {
                record_active_workspace_operation(WorkspaceOperationWorklogEvent {
                    event_id: None,
                    kind: "配置".to_string(),
                    summary: format!("复制配置源 {source_id} → {target_id} 失败"),
                    detail: Some(error.to_string()),
                    success: false,
                });
                Err(error.to_string())
            }
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn list_ui_profiles() -> Result<UiProfileManifest, String> {
    ui_profile_manifest().map_err(|error| error.to_string())
}

fn inspect_config_source_file<F>(
    key: &str,
    label: &str,
    capability: &str,
    path: Option<&str>,
    supported: bool,
    validate: F,
) -> ConfigSourceFileInspection
where
    F: FnOnce(&Path) -> Result<(), String>,
{
    let path = path.map(str::to_string);
    if !supported {
        return ConfigSourceFileInspection {
            key: key.to_string(),
            label: label.to_string(),
            capability: capability.to_string(),
            path,
            supported: false,
            exists: false,
            status: "unsupported".to_string(),
            message: "当前配置源未启用此能力".to_string(),
        };
    }
    let Some(file_path) = path.as_deref() else {
        return ConfigSourceFileInspection {
            key: key.to_string(),
            label: label.to_string(),
            capability: capability.to_string(),
            path,
            supported: true,
            exists: false,
            status: "invalid".to_string(),
            message: "未配置文件路径".to_string(),
        };
    };
    let file_path = PathBuf::from(file_path);
    if !file_path.exists() {
        return ConfigSourceFileInspection {
            key: key.to_string(),
            label: label.to_string(),
            capability: capability.to_string(),
            path,
            supported: true,
            exists: false,
            status: "missing".to_string(),
            message: "首次保存时创建".to_string(),
        };
    }
    match validate(&file_path) {
        Ok(()) => ConfigSourceFileInspection {
            key: key.to_string(),
            label: label.to_string(),
            capability: capability.to_string(),
            path,
            supported: true,
            exists: true,
            status: "ready".to_string(),
            message: "格式有效".to_string(),
        },
        Err(error) => ConfigSourceFileInspection {
            key: key.to_string(),
            label: label.to_string(),
            capability: capability.to_string(),
            path,
            supported: true,
            exists: true,
            status: "invalid".to_string(),
            message: error,
        },
    }
}

fn inspect_config_source_state(source: ConfigSource) -> Result<ConfigSourceInspection, String> {
    let resource_supported = config_source_supports(&source, "resource");
    let link_supported = config_source_supports(&source, "link");
    let proxy_supported = config_source_supports(&source, "proxy");
    let runtime_supported = config_source_supports(&source, "runtime");
    let files = vec![
        inspect_config_source_file(
            "navigation",
            "资源入口",
            "resource",
            Some(&source.files.navigation),
            resource_supported,
            |path| {
                load_navigation_editor_data_from_path(path)
                    .map(|_| ())
                    .map_err(|error| error.to_string())
            },
        ),
        inspect_config_source_file(
            "links",
            "链路",
            "link",
            Some(&source.files.links),
            link_supported,
            |path| {
                core_list_links_from_path(path)
                    .map(|_| ())
                    .map_err(|error| error.to_string())
            },
        ),
        inspect_config_source_file(
            "proxy",
            "代理服务",
            "proxy",
            source.files.proxy.as_deref(),
            proxy_supported,
            |path| {
                load_proxy_config(path)
                    .map(|_| ())
                    .map_err(|error| error.to_string())
            },
        ),
        inspect_config_source_file(
            "runtimeOverrides",
            "运行配置覆盖",
            "runtime",
            source.files.runtime_overrides.as_deref(),
            runtime_supported,
            |path| load_runtime_overrides(path).map(|_| ()),
        ),
    ];
    let invalid_files = files
        .iter()
        .filter(|file| file.status == "invalid")
        .collect::<Vec<_>>();
    let missing_count = files
        .iter()
        .filter(|file| file.supported && file.status == "missing")
        .count();
    let supported_count = files.iter().filter(|file| file.supported).count();
    let (status, summary) = if !invalid_files.is_empty() {
        (
            "invalid".to_string(),
            format!("{} 个配置文件需要修复", invalid_files.len()),
        )
    } else if supported_count == 0 {
        ("unsupported".to_string(), "未启用配置能力".to_string())
    } else if missing_count == supported_count {
        (
            "empty".to_string(),
            "尚未初始化，首次保存时创建文件".to_string(),
        )
    } else if missing_count > 0 {
        (
            "ready".to_string(),
            format!("配置可用，{missing_count} 个文件尚未创建"),
        )
    } else {
        ("ready".to_string(), "全部配置文件格式有效".to_string())
    };
    let issues = invalid_files
        .into_iter()
        .map(|file| format!("{}：{}", file.label, file.message))
        .collect::<Vec<_>>();
    let definition =
        get_custom_config_source_definition(&source.id).map_err(|error| error.to_string())?;
    let runtime_profile_scope = if source.is_default {
        "global"
    } else if !runtime_supported {
        "unsupported"
    } else if source
        .files
        .runtime_overrides
        .as_deref()
        .is_some_and(|path| Path::new(path).exists())
    {
        "override"
    } else {
        "inherited"
    };
    Ok(ConfigSourceInspection {
        editable: definition.is_some(),
        source,
        definition,
        registry_path: config_sources_file_path().display().to_string(),
        status,
        summary,
        issues,
        files,
        runtime_profile_scope: runtime_profile_scope.to_string(),
    })
}

#[tauri::command]
async fn inspect_config_source(
    source_id: Option<String>,
) -> Result<ConfigSourceInspection, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = resolve_app_config_source(source_id)?;
        inspect_config_source_state(source)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_config_source(
    definition: ConfigSourceDefinition,
) -> Result<ConfigSourceInspection, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspaces = load_config_source_workspaces()?;
        let source = core_save_custom_config_source(&workspaces, definition)
            .map_err(|error| error.to_string())?;
        inspect_config_source_state(source)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn delete_config_source(source_id: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let workspaces = load_config_source_workspaces()?;
        core_delete_custom_config_source(&workspaces, &source_id).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_config_source_preference(
    workspace_key: String,
    capability: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        core_load_config_source_preference(&paths, &workspace_key, &capability)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_config_source_preference(
    workspace_key: String,
    capability: String,
    source_id: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        match core_save_config_source_preference(&paths, &workspace_key, &capability, &source_id) {
            Ok(source) => {
                record_workspace_operation(
                    &workspace_key,
                    WorkspaceOperationWorklogEvent {
                        event_id: None,
                        kind: "配置".to_string(),
                        summary: format!("切换 {capability} 配置源"),
                        detail: Some(format!("- 配置源: `{}`", source.id)),
                        success: true,
                    },
                );
                Ok(source.id)
            }
            Err(error) => {
                record_workspace_operation(
                    &workspace_key,
                    WorkspaceOperationWorklogEvent {
                        event_id: None,
                        kind: "配置".to_string(),
                        summary: format!("切换 {capability} 配置源失败"),
                        detail: Some(error.to_string()),
                        success: false,
                    },
                );
                Err(error.to_string())
            }
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

fn load_config_source_workspaces() -> Result<Vec<ProjectWorkspaceConfig>, String> {
    let paths = ensure_default_configs().map_err(|error| error.to_string())?;
    load_project_workspaces(&paths.project_workspaces).map_err(|error| error.to_string())
}

fn resolve_app_config_source(source_id: Option<String>) -> Result<ConfigSource, String> {
    let workspaces = load_config_source_workspaces()?;
    core_resolve_config_source(source_id.as_deref(), &workspaces).map_err(|error| error.to_string())
}

fn config_source_supports(source: &ConfigSource, capability: &str) -> bool {
    source
        .capabilities
        .iter()
        .any(|item| item.trim() == capability)
}

fn proxy_path_for_config_source(source: &ConfigSource) -> Result<PathBuf, String> {
    if !config_source_supports(source, "proxy") {
        return Err(format!("配置源不支持代理配置：{}", source.name));
    }
    let path = source
        .files
        .proxy
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| format!("配置源没有代理配置文件：{}", source.name))?;
    if !path.exists() {
        save_proxy_config(&path, &ProxyConfig::default()).map_err(|error| error.to_string())?;
    }
    Ok(path)
}

fn proxy_path_for_source_id(source_id: Option<String>) -> Result<(ConfigSource, PathBuf), String> {
    let source = resolve_app_config_source(source_id)?;
    let path = proxy_path_for_config_source(&source)?;
    Ok((source, path))
}

fn runtime_overrides_path_for_config_source(
    source: &ConfigSource,
) -> Result<Option<PathBuf>, String> {
    if !config_source_supports(source, "runtime") {
        return Ok(None);
    }
    Ok(source.files.runtime_overrides.as_deref().map(PathBuf::from))
}

fn load_runtime_overrides(path: &Path) -> Result<RuntimeOverridesFile, String> {
    if !path.exists() {
        return Ok(RuntimeOverridesFile::default());
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    toml::from_str(&content).map_err(|error| error.to_string())
}

fn save_runtime_overrides(path: &Path, profiles: Vec<RuntimeProfileConfig>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let data = RuntimeOverridesFile {
        runtime_profiles: profiles,
    };
    let content = toml::to_string_pretty(&data).map_err(|error| error.to_string())?;
    write_config_text_atomic(path, content).map_err(|error| error.to_string())
}

fn apply_runtime_overrides_for_source(
    config: &mut AppConfig,
    source: &ConfigSource,
) -> Result<(), String> {
    if source.is_default {
        return Ok(());
    }
    let Some(path) = runtime_overrides_path_for_config_source(source)? else {
        return Ok(());
    };
    if !path.exists() {
        return Ok(());
    }
    let overrides = load_runtime_overrides(&path)?;
    config.defaults.runtime_profiles = overrides.runtime_profiles;
    Ok(())
}

fn proxy_dashboard_for_source(
    runtime: &ProxyRuntimeState,
    source: &ConfigSource,
    path: &Path,
) -> Result<ProxyDashboard, String> {
    let dashboard = runtime.dashboard(path).map_err(|error| error.to_string())?;
    if source.is_default {
        let workspace = active_proxy_workspace()?;
        Ok(filter_proxy_dashboard_by_workspace(dashboard, &workspace))
    } else {
        Ok(dashboard)
    }
}

#[tauri::command]
async fn get_navigation_editor(source_id: Option<String>) -> Result<NavigationEditorData, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = resolve_app_config_source(source_id)?;
        load_navigation_editor_data_from_path(&PathBuf::from(source.files.navigation))
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_navigation_editor(
    source_id: Option<String>,
    data: NavigationEditorData,
) -> Result<NavigationData, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = resolve_app_config_source(source_id)?;
        save_navigation_editor_data_to_path(data, &PathBuf::from(source.files.navigation))
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_links(
    state: tauri::State<'_, AppState>,
    source_id: Option<String>,
) -> Result<Vec<LinkSummary>, String> {
    let config_state = state.config_state.clone();
    let proxy_runtime = state.proxy_runtime.clone();
    let project_runtime = state.project_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let context = workspace_execution_context(&config_state, None)?;
        let link_source = core_resolve_config_source(source_id.as_deref(), &context.workspaces)
            .map_err(|error| error.to_string())?;
        let proxy_path = proxy_path_for_config_source(&context.proxy_source)?;
        let proxy_config = load_proxy_config(&proxy_path).map_err(|error| error.to_string())?;
        let links_path = PathBuf::from(link_source.files.links);
        let mut summaries = core_list_link_summaries_from_path(
            &links_path,
            &context.config,
            &context.workspaces,
            &proxy_config,
        )
        .map_err(|error| error.to_string())?;
        let links = core_list_links_from_path(&links_path).map_err(|error| error.to_string())?;
        let project_statuses = project_runtime
            .list(&context.config)?
            .into_iter()
            .map(|snapshot| (snapshot.key.clone(), snapshot))
            .collect::<BTreeMap<_, _>>();
        attach_link_runtime_summaries(
            &mut summaries,
            &links,
            &proxy_path,
            &proxy_config,
            &proxy_runtime,
            &project_statuses,
        );
        Ok(summaries)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_link(source_id: Option<String>, key: String) -> Result<LinkConfig, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = resolve_app_config_source(source_id)?;
        core_get_link_from_path(&PathBuf::from(source.files.links), &key)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn plan_link(
    state: tauri::State<'_, AppState>,
    source_id: Option<String>,
    key: String,
) -> Result<LinkPlan, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let context = workspace_execution_context(&config_state, None)?;
        let link_source = core_resolve_config_source(source_id.as_deref(), &context.workspaces)
            .map_err(|error| error.to_string())?;
        let proxy_path = proxy_path_for_config_source(&context.proxy_source)?;
        let proxy_config = load_proxy_config(&proxy_path).map_err(|error| error.to_string())?;
        let mut plan = core_plan_link_from_path(
            &PathBuf::from(&link_source.files.links),
            &key,
            &context.config,
            &context.workspaces,
            &proxy_config,
        )
        .map_err(|error| error.to_string())?;
        plan.source_context = Some(link_source_context(&context, &link_source));
        Ok(plan)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_link(
    state: tauri::State<'_, AppState>,
    source_id: Option<String>,
    previous_key: Option<String>,
    link: LinkConfig,
) -> Result<serde_json::Value, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let context = workspace_execution_context(&config_state, None)?;
        let link_source = core_resolve_config_source(source_id.as_deref(), &context.workspaces)
            .map_err(|error| error.to_string())?;
        let proxy_path = proxy_path_for_config_source(&context.proxy_source)?;
        let proxy_config = load_proxy_config(&proxy_path).map_err(|error| error.to_string())?;
        let links_path = PathBuf::from(&link_source.files.links);
        let link =
            core_upsert_link_to_path_with_previous_key(&links_path, link, previous_key.as_deref())
                .map_err(|error| error.to_string())?;
        let mut plan = core_plan_link_from_path(
            &links_path,
            &link.key,
            &context.config,
            &context.workspaces,
            &proxy_config,
        )
        .map_err(|error| error.to_string())?;
        plan.source_context = Some(link_source_context(&context, &link_source));
        Ok(json!({ "link": link, "plan": plan }))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn delete_link(source_id: Option<String>, key: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = resolve_app_config_source(source_id)?;
        let deleted = core_delete_link_from_path(&PathBuf::from(source.files.links), &key)
            .map_err(|error| error.to_string())?;
        Ok(json!({ "key": key, "deleted": deleted }))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn attach_link_to_workspace(
    state: tauri::State<'_, AppState>,
    request: LinkWorkspaceAttachRequest,
) -> Result<serde_json::Value, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let link_key = request.link_key.clone();
        let workspace_key = request.workspace_key.clone();
        let result: LinkWorkspaceAttachResult =
            core_attach_link_to_workspace(&paths.project_workspaces, request)
                .map_err(|error| error.to_string())?;
        let context = workspace_execution_context(&config_state, Some(&workspace_key))?;
        let proxy_path = proxy_path_for_config_source(&context.proxy_source)?;
        let proxy_config = load_proxy_config(&proxy_path).map_err(|error| error.to_string())?;
        let mut plan = core_plan_link_from_path(
            &PathBuf::from(&context.link_source.files.links),
            &link_key,
            &context.config,
            &context.workspaces,
            &proxy_config,
        )
        .map_err(|error| error.to_string())?;
        plan.source_context = Some(link_source_context(&context, &context.link_source));
        Ok(json!({ "result": result, "plan": plan }))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn check_link(
    state: tauri::State<'_, AppState>,
    source_id: Option<String>,
    key: String,
) -> Result<LinkExecutionReport, String> {
    execute_link_app_command(state, source_id, key, "check").await
}

#[tauri::command]
async fn run_link(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    source_id: Option<String>,
    key: String,
    activity_id: Option<String>,
    operation_origin: Option<String>,
) -> Result<LinkExecutionReport, String> {
    let origin = operation_event_origin(operation_origin.as_deref());
    let event_id = operation_event_id(activity_id.as_deref(), origin, "link-run");
    let workspace_key = active_history_workspace()
        .map(|workspace| workspace.key)
        .unwrap_or_else(|_| SYSTEM_PROJECT_WORKSPACE_KEY.to_string());
    let link_key = key.clone();
    let event_source_id = source_id.clone();
    let storage = state.storage.clone();
    let result = execute_link_app_command(state, source_id, key, "run").await;
    record_link_operation_event(
        &storage,
        event_id,
        origin,
        &workspace_key,
        "run",
        &link_key,
        event_source_id.as_deref(),
        &result,
    );
    if result.is_ok() {
        refresh_tray_menu(&app);
    }
    result
}

#[tauri::command]
async fn stop_link(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    source_id: Option<String>,
    key: String,
    activity_id: Option<String>,
    operation_origin: Option<String>,
) -> Result<LinkExecutionReport, String> {
    let origin = operation_event_origin(operation_origin.as_deref());
    let event_id = operation_event_id(activity_id.as_deref(), origin, "link-stop");
    let workspace_key = active_history_workspace()
        .map(|workspace| workspace.key)
        .unwrap_or_else(|_| SYSTEM_PROJECT_WORKSPACE_KEY.to_string());
    let link_key = key.clone();
    let event_source_id = source_id.clone();
    let storage = state.storage.clone();
    let result = execute_link_app_command(state, source_id, key, "stop").await;
    record_link_operation_event(
        &storage,
        event_id,
        origin,
        &workspace_key,
        "stop",
        &link_key,
        event_source_id.as_deref(),
        &result,
    );
    if result.is_ok() {
        refresh_tray_menu(&app);
    }
    result
}

async fn execute_link_app_command(
    state: tauri::State<'_, AppState>,
    source_id: Option<String>,
    key: String,
    mode: &'static str,
) -> Result<LinkExecutionReport, String> {
    let config_state = state.config_state.clone();
    let proxy_runtime = state.proxy_runtime.clone();
    let project_runtime = state.project_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        execute_link_app(
            &config_state,
            &proxy_runtime,
            &project_runtime,
            LinkAppExecutionRequest {
                link_source_id: source_id,
                proxy_source_id: None,
                workspace_key: None,
                key,
                mode: mode.to_string(),
            },
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

fn attach_link_runtime_summaries(
    summaries: &mut [LinkSummary],
    links: &[LinkConfig],
    proxy_path: &Path,
    proxy_config: &ProxyConfig,
    proxy_runtime: &ProxyRuntimeState,
    project_statuses: &BTreeMap<String, ProjectRuntimeSnapshot>,
) {
    let links_by_key = links
        .iter()
        .map(|link| (link.key.as_str(), link))
        .collect::<BTreeMap<_, _>>();
    for summary in summaries {
        summary.runtime = links_by_key.get(summary.key.as_str()).map(|link| {
            link_runtime_summary_app(
                link,
                proxy_path,
                proxy_config,
                proxy_runtime,
                project_statuses,
            )
        });
    }
}

fn link_runtime_summary_app(
    link: &LinkConfig,
    proxy_path: &Path,
    proxy_config: &ProxyConfig,
    proxy_runtime: &ProxyRuntimeState,
    project_statuses: &BTreeMap<String, ProjectRuntimeSnapshot>,
) -> LinkRuntimeSummary {
    let mut controllable_steps = 0usize;
    let mut running_steps = 0usize;
    let mut stoppable_steps = 0usize;
    let mut blocked_steps = 0usize;

    for step in &link.steps {
        match step.step_type.trim() {
            "proxy.start" => {
                controllable_steps += 1;
                let Some(profile) = link_step_proxy_profile(step)
                    .and_then(|profile_key| find_link_proxy_profile(proxy_config, &profile_key))
                else {
                    blocked_steps += 1;
                    continue;
                };
                let running = proxy_runtime
                    .statuses_for_profiles(proxy_path, std::slice::from_ref(profile))
                    .into_iter()
                    .next()
                    .is_some_and(|status| status.running);
                if running {
                    running_steps += 1;
                    stoppable_steps += 1;
                }
            }
            "runtime.start" => {
                controllable_steps += 1;
                let Some(project_key) = link_step_project(link, step) else {
                    blocked_steps += 1;
                    continue;
                };
                let Some(snapshot) = project_statuses.get(&project_key) else {
                    blocked_steps += 1;
                    continue;
                };
                if snapshot.can_stop {
                    running_steps += 1;
                    stoppable_steps += 1;
                } else if matches!(
                    snapshot.status_key.as_str(),
                    "running" | "ready" | "external"
                ) {
                    running_steps += 1;
                }
            }
            _ => {}
        }
    }

    let (status, label) = if controllable_steps == 0 {
        ("planned", "计划")
    } else if blocked_steps >= controllable_steps && running_steps == 0 {
        ("invalid", "配置异常")
    } else if running_steps == 0 && blocked_steps > 0 {
        ("warning", "有风险")
    } else if running_steps == 0 {
        ("stopped", "未启动")
    } else if blocked_steps == 0 && running_steps >= controllable_steps {
        ("running", "运行中")
    } else {
        ("partial", "部分运行")
    };
    let can_stop = stoppable_steps > 0;
    let can_run = controllable_steps == 0
        || (blocked_steps < controllable_steps && running_steps < controllable_steps);

    LinkRuntimeSummary {
        status: status.to_string(),
        label: label.to_string(),
        running_steps,
        controllable_steps,
        blocked_steps,
        can_run,
        can_stop,
    }
}

struct LinkAppExecutionRequest {
    link_source_id: Option<String>,
    proxy_source_id: Option<String>,
    workspace_key: Option<String>,
    key: String,
    mode: String,
}

fn execute_link_app(
    config_state: &AppConfigState,
    proxy_runtime: &ProxyRuntimeState,
    project_runtime: &ProjectRuntimeState,
    request: LinkAppExecutionRequest,
) -> Result<LinkExecutionReport, String> {
    let context = workspace_execution_context(config_state, request.workspace_key.as_deref())?;
    let link_source = if let Some(source_id) = request.link_source_id.as_deref() {
        core_resolve_config_source(Some(source_id), &context.workspaces)
            .map_err(|error| error.to_string())?
    } else {
        context.link_source.clone()
    };
    let proxy_source = if let Some(source_id) = request.proxy_source_id.as_deref() {
        core_resolve_config_source(Some(source_id), &context.workspaces)
            .map_err(|error| error.to_string())?
    } else {
        context.proxy_source.clone()
    };
    let links_path = PathBuf::from(&link_source.files.links);
    let link =
        core_get_link_from_path(&links_path, &request.key).map_err(|error| error.to_string())?;
    let proxy_path = proxy_path_for_config_source(&proxy_source)?;
    let proxy_config = load_proxy_config(&proxy_path).map_err(|error| error.to_string())?;
    let mut plan = core_plan_link_from_path(
        &links_path,
        &link.key,
        &context.config,
        &context.workspaces,
        &proxy_config,
    )
    .map_err(|error| error.to_string())?;
    plan.source_context = Some(link_source_context(&context, &link_source));
    let mut warnings = plan.warnings.clone();
    let mut indices = (0..link.steps.len()).collect::<Vec<_>>();
    if request.mode == "stop" {
        indices.reverse();
    }

    let mut steps = Vec::new();
    for index in indices {
        let step = &link.steps[index];
        let report = execute_link_step_app(
            &request.mode,
            &context.config,
            proxy_runtime,
            project_runtime,
            &proxy_path,
            &proxy_config,
            &link,
            step,
            plan.steps.get(index),
            index,
        );
        for risk in &report.risks {
            if report.status == "skipped" || report.status == "failed" {
                push_unique_link_warning(&mut warnings, risk.clone());
            }
        }
        steps.push(report);
    }

    Ok(LinkExecutionReport {
        key: plan.key.clone(),
        name: plan.name.clone(),
        mode: request.mode,
        plan,
        steps,
        warnings,
    })
}

#[allow(clippy::too_many_arguments)]
fn execute_link_step_app(
    mode: &str,
    effective_config: &AppConfig,
    proxy_runtime: &ProxyRuntimeState,
    project_runtime: &ProjectRuntimeState,
    proxy_path: &Path,
    proxy_config: &ProxyConfig,
    link: &LinkConfig,
    step: &LinkStepConfig,
    plan_step: Option<&rdevtool_core::link::LinkPlanStep>,
    index: usize,
) -> LinkExecutionStepReport {
    let id = plan_step
        .map(|item| item.id.clone())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("step-{}", index + 1));
    let step_type = plan_step
        .map(|item| item.step_type.clone())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| step.step_type.trim().to_string());
    let label = plan_step
        .map(|item| item.label.clone())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| id.clone());
    let planned_summary = plan_step
        .map(|item| item.summary.clone())
        .unwrap_or_else(|| "Link step".to_string());
    let planned_risks = plan_step.map(|item| item.risks.clone()).unwrap_or_default();
    let planned_runtime = plan_step.and_then(|item| item.runtime.as_ref()).cloned();

    if !planned_risks.is_empty() {
        return LinkExecutionStepReport {
            id,
            step_type,
            label,
            status: "skipped".to_string(),
            summary: "计划校验未通过，已跳过执行。".to_string(),
            detail: None,
            risks: planned_risks,
        };
    }

    match mode {
        "check" => check_link_step_app(
            effective_config,
            project_runtime,
            proxy_path,
            proxy_config,
            link,
            step,
            id,
            step_type,
            label,
            planned_summary,
            planned_runtime.as_ref(),
        ),
        "run" => run_link_step_app(
            effective_config,
            proxy_runtime,
            project_runtime,
            proxy_path,
            proxy_config,
            link,
            step,
            id,
            step_type,
            label,
            planned_summary,
        ),
        "stop" => stop_link_step_app(
            effective_config,
            proxy_runtime,
            project_runtime,
            proxy_path,
            proxy_config,
            link,
            step,
            id,
            step_type,
            label,
            planned_summary,
        ),
        _ => LinkExecutionStepReport {
            id,
            step_type,
            label,
            status: "failed".to_string(),
            summary: format!("不支持的 Link 执行模式：{mode}"),
            detail: None,
            risks: vec![format!("不支持的 Link 执行模式：{mode}")],
        },
    }
}

#[allow(clippy::too_many_arguments)]
fn check_link_step_app(
    effective_config: &AppConfig,
    project_runtime: &ProjectRuntimeState,
    proxy_path: &Path,
    proxy_config: &ProxyConfig,
    link: &LinkConfig,
    step: &LinkStepConfig,
    id: String,
    step_type: String,
    label: String,
    planned_summary: String,
    planned_runtime: Option<&core_runtime::ProjectRuntimeContextSnapshot>,
) -> LinkExecutionStepReport {
    match step_type.as_str() {
        "localFile.ensure" => {
            let project_key = link_step_project(link, step);
            let path = optional_link_text(step.path.as_deref());
            let mut risks = Vec::new();
            let detail = match (project_key.as_deref(), path.as_deref()) {
                (Some(project_key), Some(path)) => match effective_config.find_project(project_key)
                {
                    Ok(project) => {
                        let absolute_path = project.repo_path.as_ref().map(|repo| repo.join(path));
                        json!({
                            "project": project_key,
                            "path": path,
                            "absolutePath": absolute_path.as_ref().map(|value| value.display().to_string()),
                            "exists": absolute_path.as_ref().is_some_and(|value| value.exists())
                        })
                    }
                    Err(error) => {
                        risks.push(error.to_string());
                        json!({ "project": project_key, "path": path })
                    }
                },
                _ => json!({ "project": project_key, "path": path }),
            };
            LinkExecutionStepReport {
                id,
                step_type,
                label,
                status: if risks.is_empty() {
                    "checked".to_string()
                } else {
                    "failed".to_string()
                },
                summary: "本地覆盖文件由运行调试配置在启动前应用。".to_string(),
                detail: Some(detail),
                risks,
            }
        }
        "proxy.start" | "proxy.check" => match link_step_proxy_profile(step)
            .and_then(|profile_key| find_link_proxy_profile(proxy_config, &profile_key))
        {
            Some(profile) => match proxy_daemon_status(proxy_path, &profile.id) {
                Ok(runtime_status) => {
                    let status = link_proxy_check_status(
                        &step_type,
                        runtime_status.running,
                        runtime_status.managed,
                    );
                    let risks = if status == "blocked" {
                        if runtime_status.running {
                            vec!["代理端口由非 rDevTool 进程占用，无法安全接管。".to_string()]
                        } else {
                            vec![format!("代理尚未启动：{}", profile.listen_url())]
                        }
                    } else {
                        Vec::new()
                    };
                    LinkExecutionStepReport {
                        id,
                        step_type,
                        label,
                        status: status.to_string(),
                        summary: match status {
                            "checked" => format!("代理正在监听 {}", profile.listen_url()),
                            "ready" => format!("代理配置有效，可以启动 {}", profile.listen_url()),
                            _ if runtime_status.running => {
                                format!("代理端口已被外部进程占用 {}", profile.listen_url())
                            }
                            _ => format!("代理尚未启动，期望监听 {}", profile.listen_url()),
                        },
                        detail: Some(json!({
                            "profileId": profile.id,
                            "profileName": profile.name,
                            "listenUrl": profile.listen_url(),
                            "runtimeStatus": runtime_status
                        })),
                        risks,
                    }
                }
                Err(error) => LinkExecutionStepReport {
                    id,
                    step_type,
                    label,
                    status: "failed".to_string(),
                    summary: format!("代理状态检查失败：{error}"),
                    detail: None,
                    risks: vec![error.to_string()],
                },
            },
            None => LinkExecutionStepReport {
                id,
                step_type,
                label,
                status: "failed".to_string(),
                summary: planned_summary,
                detail: None,
                risks: vec!["代理 profile 不存在，无法检查监听。".to_string()],
            },
        },
        "runtime.start" => {
            let Some(project_key) = link_step_project(link, step) else {
                return LinkExecutionStepReport {
                    id,
                    step_type,
                    label,
                    status: "failed".to_string(),
                    summary: "缺少项目，无法执行运行前检查。".to_string(),
                    detail: None,
                    risks: vec!["缺少 project。".to_string()],
                };
            };
            let options = link_step_runtime_launch_options(step);
            match project_runtime.preflight_with_options(effective_config, &project_key, &options) {
                Ok(response) => {
                    let status = if response.status_key == "error" {
                        "failed"
                    } else {
                        "checked"
                    };
                    let risks = response
                        .checks
                        .iter()
                        .filter(|check| check.status_key == "error")
                        .map(|check| format!("{}：{}", check.title, check.detail))
                        .collect::<Vec<_>>();
                    LinkExecutionStepReport {
                        id,
                        step_type,
                        label,
                        status: status.to_string(),
                        summary: response.summary.clone(),
                        detail: Some(json!({
                            "preflight": response,
                            "runtime": planned_runtime,
                        })),
                        risks,
                    }
                }
                Err(error) => LinkExecutionStepReport {
                    id,
                    step_type,
                    label,
                    status: "failed".to_string(),
                    summary: format!("运行前检查失败：{error}"),
                    detail: None,
                    risks: vec![error],
                },
            }
        }
        "runtime.focus" => LinkExecutionStepReport {
            id,
            step_type,
            label,
            status: "checked".to_string(),
            summary: planned_runtime
                .and_then(|runtime| runtime.effective.target.as_ref())
                .and_then(|target| target.focus_url.as_ref())
                .map(|url| format!("已解析打开页面 {url}；检查模式不执行打开动作。"))
                .unwrap_or_else(|| "打开页面步骤已识别，检查模式不执行打开动作。".to_string()),
            detail: planned_runtime.map(|runtime| json!(runtime)),
            risks: Vec::new(),
        },
        _ => LinkExecutionStepReport {
            id,
            step_type,
            label,
            status: "skipped".to_string(),
            summary: planned_summary,
            detail: None,
            risks: vec!["该步骤类型尚未接入 App 检查器。".to_string()],
        },
    }
}

#[allow(clippy::too_many_arguments)]
fn run_link_step_app(
    effective_config: &AppConfig,
    proxy_runtime: &ProxyRuntimeState,
    project_runtime: &ProjectRuntimeState,
    proxy_path: &Path,
    proxy_config: &ProxyConfig,
    link: &LinkConfig,
    step: &LinkStepConfig,
    id: String,
    step_type: String,
    label: String,
    planned_summary: String,
) -> LinkExecutionStepReport {
    match step_type.as_str() {
        "localFile.ensure" => LinkExecutionStepReport {
            id,
            step_type,
            label,
            status: "checked".to_string(),
            summary: "本地覆盖文件不会由 Link 直接写入；启动 runtime 时由调试配置应用。"
                .to_string(),
            detail: Some(json!({
                "project": link_step_project(link, step),
                "path": optional_link_text(step.path.as_deref())
            })),
            risks: Vec::new(),
        },
        "proxy.start" => {
            let Some(profile) = link_step_proxy_profile(step)
                .and_then(|profile_key| find_link_proxy_profile(proxy_config, &profile_key))
            else {
                return LinkExecutionStepReport {
                    id,
                    step_type,
                    label,
                    status: "failed".to_string(),
                    summary: "代理 profile 不存在，无法启动。".to_string(),
                    detail: None,
                    risks: vec!["代理 profile 不存在，无法启动。".to_string()],
                };
            };
            if let Err(error) = validate_proxy_profile(profile) {
                return LinkExecutionStepReport {
                    id,
                    step_type,
                    label,
                    status: "failed".to_string(),
                    summary: format!("代理配置校验失败：{error}"),
                    detail: None,
                    risks: vec![error.to_string()],
                };
            }
            match proxy_runtime.start_profile(proxy_path.to_path_buf(), profile.id.clone()) {
                Ok(status) => LinkExecutionStepReport {
                    id,
                    step_type,
                    label,
                    status: "started".to_string(),
                    summary: format!("代理已启动：{}", status.listen_url),
                    detail: Some(json!(status)),
                    risks: Vec::new(),
                },
                Err(error) => LinkExecutionStepReport {
                    id,
                    step_type,
                    label,
                    status: "failed".to_string(),
                    summary: format!("代理启动失败：{error}"),
                    detail: None,
                    risks: vec![error.to_string()],
                },
            }
        }
        "proxy.check" => check_link_step_app(
            effective_config,
            project_runtime,
            proxy_path,
            proxy_config,
            link,
            step,
            id,
            step_type,
            label,
            planned_summary,
            None,
        ),
        "runtime.start" => {
            let Some(project_key) = link_step_project(link, step) else {
                return LinkExecutionStepReport {
                    id,
                    step_type,
                    label,
                    status: "failed".to_string(),
                    summary: "缺少项目，无法启动 runtime。".to_string(),
                    detail: None,
                    risks: vec!["缺少 project。".to_string()],
                };
            };
            let options = link_step_runtime_launch_options(step);
            let mut runtime_config = effective_config.clone();
            let runtime_profile_key = match options.runtime_profile.clone() {
                Some(value) => Some(value),
                None => match project_runtime_profile_key(
                    &runtime_config,
                    &project_key,
                    options.debug_profile.as_deref(),
                ) {
                    Ok(value) => value,
                    Err(error) => {
                        return LinkExecutionStepReport {
                            id,
                            step_type,
                            label,
                            status: "failed".to_string(),
                            summary: format!("运行配置解析失败：{error}"),
                            detail: None,
                            risks: vec![error],
                        };
                    }
                },
            };
            if let Err(error) = prepare_rdev_proxy_runtime_profile(
                &mut runtime_config,
                proxy_runtime,
                proxy_path,
                runtime_profile_key.as_deref(),
            ) {
                return LinkExecutionStepReport {
                    id,
                    step_type,
                    label,
                    status: "failed".to_string(),
                    summary: format!("运行配置代理准备失败：{error}"),
                    detail: None,
                    risks: vec![error],
                };
            }
            match project_runtime.start_with_options(&runtime_config, &project_key, &options) {
                Ok(snapshot) => LinkExecutionStepReport {
                    id,
                    step_type,
                    label,
                    status: "started".to_string(),
                    summary: snapshot.detail.clone(),
                    detail: Some(json!(snapshot)),
                    risks: Vec::new(),
                },
                Err(error) => LinkExecutionStepReport {
                    id,
                    step_type,
                    label,
                    status: "failed".to_string(),
                    summary: format!("项目启动失败：{error}"),
                    detail: None,
                    risks: vec![error],
                },
            }
        }
        "runtime.focus" => {
            let Some(project_key) = link_step_project(link, step) else {
                return LinkExecutionStepReport {
                    id,
                    step_type,
                    label,
                    status: "failed".to_string(),
                    summary: "缺少项目，无法打开调试页面。".to_string(),
                    detail: None,
                    risks: vec!["缺少 project。".to_string()],
                };
            };
            let options = link_step_runtime_launch_options(step);
            match project_runtime.focus_runtime_with_profile(
                effective_config,
                &project_key,
                options.debug_profile.as_deref(),
                options.runtime_profile.as_deref(),
            ) {
                Ok(snapshot) => LinkExecutionStepReport {
                    id,
                    step_type,
                    label,
                    status: "started".to_string(),
                    summary: snapshot.detail.clone(),
                    detail: Some(json!(snapshot)),
                    risks: Vec::new(),
                },
                Err(error) => LinkExecutionStepReport {
                    id,
                    step_type,
                    label,
                    status: "failed".to_string(),
                    summary: format!("打开调试页面失败：{error}"),
                    detail: None,
                    risks: vec![error],
                },
            }
        }
        _ => LinkExecutionStepReport {
            id,
            step_type,
            label,
            status: "skipped".to_string(),
            summary: planned_summary,
            detail: None,
            risks: vec!["该步骤类型尚未接入 App 执行器。".to_string()],
        },
    }
}

#[allow(clippy::too_many_arguments)]
fn stop_link_step_app(
    effective_config: &AppConfig,
    proxy_runtime: &ProxyRuntimeState,
    project_runtime: &ProjectRuntimeState,
    proxy_path: &Path,
    proxy_config: &ProxyConfig,
    link: &LinkConfig,
    step: &LinkStepConfig,
    id: String,
    step_type: String,
    label: String,
    planned_summary: String,
) -> LinkExecutionStepReport {
    match step_type.as_str() {
        "runtime.start" => {
            let Some(project_key) = link_step_project(link, step) else {
                return LinkExecutionStepReport {
                    id,
                    step_type,
                    label,
                    status: "failed".to_string(),
                    summary: "缺少项目，无法停止 runtime。".to_string(),
                    detail: None,
                    risks: vec!["缺少 project。".to_string()],
                };
            };
            match project_runtime.stop(effective_config, &project_key) {
                Ok(snapshot) => LinkExecutionStepReport {
                    id,
                    step_type,
                    label,
                    status: "stopped".to_string(),
                    summary: snapshot.detail.clone(),
                    detail: Some(json!(snapshot)),
                    risks: Vec::new(),
                },
                Err(error) => LinkExecutionStepReport {
                    id,
                    step_type,
                    label,
                    status: "failed".to_string(),
                    summary: format!("停止项目失败：{error}"),
                    detail: None,
                    risks: vec![error],
                },
            }
        }
        "proxy.start" => {
            let Some(profile) = link_step_proxy_profile(step)
                .and_then(|profile_key| find_link_proxy_profile(proxy_config, &profile_key))
            else {
                return LinkExecutionStepReport {
                    id,
                    step_type,
                    label,
                    status: "failed".to_string(),
                    summary: "代理 profile 不存在，无法停止。".to_string(),
                    detail: None,
                    risks: vec!["代理 profile 不存在，无法停止。".to_string()],
                };
            };
            match proxy_runtime.stop_profile_result(proxy_path, &profile.id) {
                Ok(status) => LinkExecutionStepReport {
                    id,
                    step_type,
                    label,
                    status: "stopped".to_string(),
                    summary: format!("代理已停止：{}", profile.name),
                    detail: Some(json!(status)),
                    risks: Vec::new(),
                },
                Err(error) => LinkExecutionStepReport {
                    id,
                    step_type,
                    label,
                    status: "failed".to_string(),
                    summary: format!("代理停止失败：{error}"),
                    detail: None,
                    risks: vec![error.to_string()],
                },
            }
        }
        "localFile.ensure" => LinkExecutionStepReport {
            id,
            step_type,
            label,
            status: "skipped".to_string(),
            summary: "本地覆盖文件不会在 Link stop 中自动删除。".to_string(),
            detail: Some(json!({
                "project": link_step_project(link, step),
                "path": optional_link_text(step.path.as_deref())
            })),
            risks: Vec::new(),
        },
        "proxy.check" | "runtime.focus" => LinkExecutionStepReport {
            id,
            step_type,
            label,
            status: "skipped".to_string(),
            summary: "检查/打开类步骤没有停止动作。".to_string(),
            detail: None,
            risks: Vec::new(),
        },
        _ => LinkExecutionStepReport {
            id,
            step_type,
            label,
            status: "skipped".to_string(),
            summary: planned_summary,
            detail: None,
            risks: Vec::new(),
        },
    }
}

fn link_step_project(link: &LinkConfig, step: &LinkStepConfig) -> Option<String> {
    optional_link_text(step.project.as_deref())
        .or_else(|| optional_link_text(link.project.as_deref()))
}

fn link_step_proxy_profile(step: &LinkStepConfig) -> Option<String> {
    optional_link_text(step.profile.as_deref())
}

fn link_step_runtime_launch_options(step: &LinkStepConfig) -> ProjectRuntimeLaunchOptions {
    ProjectRuntimeLaunchOptions {
        debug_profile: optional_link_text(step.debug_profile.as_deref()),
        runtime_profile: optional_link_text(step.runtime_profile.as_deref()),
        command: optional_link_text(step.command.as_deref()),
        expected_port: step.expected_port,
        env: step.env.clone(),
    }
}

fn optional_link_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn find_link_proxy_profile<'a>(config: &'a ProxyConfig, key: &str) -> Option<&'a ProxyProfile> {
    config
        .profiles
        .iter()
        .find(|profile| profile.id == key || profile.name == key)
}

fn push_unique_link_warning(warnings: &mut Vec<String>, warning: String) {
    if !warnings.iter().any(|item| item == &warning) {
        warnings.push(warning);
    }
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
        let mut config = apply_active_workspace_context(&config_state.load()?)?;
        let proxy_path = active_workspace_proxy_path()?;
        prepare_rdev_proxy_runtime_profile(
            &mut config,
            &proxy_runtime,
            &proxy_path,
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
async fn storage_prepend_json_array(
    state: tauri::State<'_, AppState>,
    namespace: String,
    key: String,
    value: serde_json::Value,
    limit: usize,
) -> Result<serde_json::Value, String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || {
        storage.prepend_json_array(&namespace, &key, value, limit)
    })
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
fn record_tray_pinned_action_execution(
    app: AppHandle,
    action: TrayReplayAction,
) -> Result<(), String> {
    record_tray_replay_action(&app, action)
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
async fn list_managed_artifacts(
    state: tauri::State<'_, AppState>,
    workspace: Option<String>,
    all_workspaces: bool,
    project: Option<String>,
    kinds: Option<Vec<String>>,
) -> Result<ManagedArtifactInventoryResponse, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        managed_artifact_inventory(
            &config,
            &paths,
            &ManagedArtifactQuery {
                workspace,
                all_workspaces,
                project,
                kinds: kinds.unwrap_or_default(),
            },
        )
        .map_err(|error| error.to_string())
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
    activity_id: Option<String>,
    operation_origin: Option<String>,
) -> Result<ProjectRuntimeSnapshot, String> {
    let runtime = state.project_runtime.clone();
    let config_state = state.config_state.clone();
    let proxy_runtime = state.proxy_runtime.clone();
    let storage = state.storage.clone();
    let workspace_key = active_history_workspace()?.key;
    let origin = operation_event_origin(operation_origin.as_deref());
    let event_id = operation_event_id(activity_id.as_deref(), origin, "runtime-start");
    let log_project = project.clone();
    let event_debug_profile = optional_editor_string(debug_profile.clone());
    let event_env_overrides = env_overrides.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut config = apply_active_workspace_context(&config_state.load()?)?;
        let proxy_path = active_workspace_proxy_path()?;
        let debug_profile_key = optional_editor_string(debug_profile);
        let runtime_profile_key =
            project_runtime_profile_key(&config, &project, debug_profile_key.as_deref())?;
        prepare_rdev_proxy_runtime_profile(
            &mut config,
            &proxy_runtime,
            &proxy_path,
            runtime_profile_key.as_deref(),
        )?;
        let explicit_env_overrides = env_overrides.is_some();
        let env_overrides = normalize_runtime_env_overrides(env_overrides);
        let launch_options = ProjectRuntimeLaunchOptions {
            debug_profile: debug_profile_key.clone(),
            env: env_overrides.clone(),
            ..ProjectRuntimeLaunchOptions::default()
        };
        let preflight = runtime.preflight_with_options(&config, &project, &launch_options)?;
        if preflight.status_key == "error" {
            let details = preflight
                .checks
                .iter()
                .filter(|check| check.status_key == "error")
                .map(|check| format!("{}：{}", check.title, check.detail))
                .collect::<Vec<_>>()
                .join("；");
            return Err(if details.is_empty() {
                format!("启动前检查未通过：{}", preflight.summary)
            } else {
                format!("启动前检查未通过：{}（{}）", preflight.summary, details)
            });
        }
        let mut updated = runtime.start_with_options(&config, &project, &launch_options)?;
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
    .map_err(|error| error.to_string())?;
    let event = match &result {
        Ok(snapshot) => WorkspaceOperationWorklogEvent {
            event_id: Some(format!(
                "runtime-start:{}:{}",
                snapshot.key,
                snapshot.started_at_ms.unwrap_or(snapshot.updated_at_ms)
            )),
            kind: "运行".to_string(),
            summary: format!("启动 {} · {}", snapshot.name, snapshot.status_label),
            detail: Some(format!(
                "- 项目: `{}`\n- 命令: `{}`\n- 目录: `{}`\n\n{}",
                snapshot.key,
                snapshot.command.as_deref().unwrap_or("未配置"),
                snapshot.cwd.as_deref().unwrap_or("未配置"),
                snapshot.detail
            )),
            success: true,
        },
        Err(error) => WorkspaceOperationWorklogEvent {
            event_id: None,
            kind: "运行".to_string(),
            summary: format!("启动 {log_project} 失败"),
            detail: Some(error.clone()),
            success: false,
        },
    };
    record_workspace_operation(&workspace_key, event);
    match &result {
        Ok(snapshot) => {
            let state = runtime_start_operation_state(&snapshot.status_key);
            let title = match snapshot.status_key.as_str() {
                "running" => "dev 服务已启动",
                "exited" | "failed" => "dev 服务启动失败",
                _ => "启动 dev 服务",
            };
            let summary = if snapshot.status_key == "running" {
                "已启动 · dev 服务启动成功".to_string()
            } else {
                operation_summary(&snapshot.status_label, &snapshot.detail)
            };
            let mut payload = serde_json::to_value(snapshot).unwrap_or_else(|_| json!({}));
            if let Some(payload) = payload.as_object_mut() {
                payload.insert(
                    "debugProfile".to_string(),
                    json!(event_debug_profile.clone()),
                );
                payload.insert(
                    "envOverrides".to_string(),
                    json!(event_env_overrides.clone()),
                );
            }
            record_lifecycle_operation_event(
                &storage,
                event_id,
                origin,
                &workspace_key,
                "runtime",
                "start",
                state,
                title,
                &summary,
                &snapshot.detail,
                Some(&snapshot.key),
                Some(&snapshot.name),
                Some(payload),
            );
        }
        Err(error) => record_lifecycle_operation_event(
            &storage,
            event_id,
            origin,
            &workspace_key,
            "runtime",
            "start",
            OperationEventState::Failed,
            "启动 dev 服务",
            "dev 服务启动失败",
            error,
            Some(&log_project),
            None,
            Some(json!({
                "projectKey": log_project.clone(),
                "debugProfile": event_debug_profile.clone(),
                "envOverrides": event_env_overrides.clone(),
            })),
        ),
    }
    result
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
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    project: String,
    activity_id: Option<String>,
    operation_origin: Option<String>,
) -> Result<ProjectRuntimeSnapshot, String> {
    let runtime = state.project_runtime.clone();
    let config_state = state.config_state.clone();
    let storage = state.storage.clone();
    let workspace_key = active_history_workspace()?.key;
    let origin = operation_event_origin(operation_origin.as_deref());
    let event_id = operation_event_id(activity_id.as_deref(), origin, "runtime-stop");
    let log_project = project.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let config = apply_active_workspace_context(&config_state.load()?)?;
        runtime.stop(&config, &project)
    })
    .await
    .map_err(|error| error.to_string())?;
    if result.is_ok() {
        refresh_tray_menu(&app);
    }
    let event = match &result {
        Ok(snapshot) => WorkspaceOperationWorklogEvent {
            event_id: Some(format!(
                "runtime-stop:{}:{}",
                snapshot.key, snapshot.updated_at_ms
            )),
            kind: "运行".to_string(),
            summary: format!("停止 {} · {}", snapshot.name, snapshot.status_label),
            detail: Some(format!("- 项目: `{}`\n\n{}", snapshot.key, snapshot.detail)),
            success: true,
        },
        Err(error) => WorkspaceOperationWorklogEvent {
            event_id: None,
            kind: "运行".to_string(),
            summary: format!("停止 {log_project} 失败"),
            detail: Some(error.clone()),
            success: false,
        },
    };
    record_workspace_operation(&workspace_key, event);
    match &result {
        Ok(snapshot) => {
            let summary = operation_summary(&snapshot.status_label, &snapshot.detail);
            record_lifecycle_operation_event(
                &storage,
                event_id,
                origin,
                &workspace_key,
                "runtime",
                "stop",
                OperationEventState::Success,
                "停止 dev 服务",
                &summary,
                &snapshot.detail,
                Some(&snapshot.key),
                Some(&snapshot.name),
                serde_json::to_value(snapshot).ok(),
            );
        }
        Err(error) => record_lifecycle_operation_event(
            &storage,
            event_id,
            origin,
            &workspace_key,
            "runtime",
            "stop",
            OperationEventState::Failed,
            "停止 dev 服务",
            "dev 服务停止失败",
            error,
            Some(&log_project),
            None,
            Some(json!({ "projectKey": log_project.clone() })),
        ),
    }
    result
}

#[tauri::command]
async fn adopt_project_runtime(
    state: tauri::State<'_, AppState>,
    project: String,
    pid: u32,
    debug_profile: Option<String>,
    activity_id: Option<String>,
    operation_origin: Option<String>,
) -> Result<ProjectRuntimeSnapshot, String> {
    let runtime = state.project_runtime.clone();
    let config_state = state.config_state.clone();
    let storage = state.storage.clone();
    let workspace_key = active_history_workspace()?.key;
    let origin = operation_event_origin(operation_origin.as_deref());
    let event_id = operation_event_id(activity_id.as_deref(), origin, "runtime-adopt");
    let log_project = project.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let config = apply_active_workspace_context(&config_state.load()?)?;
        let options = ProjectRuntimeLaunchOptions {
            debug_profile: optional_editor_string(debug_profile),
            ..ProjectRuntimeLaunchOptions::default()
        };
        runtime.adopt_with_options(&config, &project, pid, &options)
    })
    .await
    .map_err(|error| error.to_string())?;
    match &result {
        Ok(snapshot) => record_lifecycle_operation_event(
            &storage,
            event_id,
            origin,
            &workspace_key,
            "runtime",
            "adopt",
            OperationEventState::Success,
            "已认领外部 dev 服务",
            &format!("{} 已由 Runtime Daemon 托管", snapshot.name),
            &snapshot.detail,
            Some(&snapshot.key),
            Some(&snapshot.name),
            serde_json::to_value(snapshot).ok(),
        ),
        Err(error) => record_lifecycle_operation_event(
            &storage,
            event_id,
            origin,
            &workspace_key,
            "runtime",
            "adopt",
            OperationEventState::Failed,
            "认领外部 dev 服务",
            "外部 dev 服务认领失败",
            error,
            Some(&log_project),
            None,
            Some(json!({ "projectKey": log_project, "pid": pid })),
        ),
    }
    result
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
    output_dir: Option<String>,
) -> Result<ProjectRuntimeSnapshot, String> {
    let runtime = state.project_runtime.clone();
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        let updated = runtime.open_build_output(&config, &project, output_dir.as_deref())?;
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
        let mut config = apply_active_workspace_context(&config_state.load()?)?;
        let proxy_path = active_workspace_proxy_path()?;
        let debug_profile_key = optional_editor_string(debug_profile);
        let runtime_profile_key =
            project_runtime_profile_key(&config, &project, debug_profile_key.as_deref())?;
        prepare_rdev_proxy_runtime_profile(
            &mut config,
            &proxy_runtime,
            &proxy_path,
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
        workspace_key: None,
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
        workspace_key: None,
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
        entry.workspace_key == action.workspace_key
            && entry.project_key == project_key
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
    workspace: Option<&ProjectWorkspaceConfig>,
) -> bool {
    let Some(workspace) = workspace.filter(|workspace| !workspace.is_system()) else {
        return true;
    };
    if entry.get("workspaceKey").and_then(|value| value.as_str()) != Some(workspace.key.as_str()) {
        return false;
    }
    entry
        .get("items")
        .and_then(|value| value.as_array())
        .is_some_and(|items| {
            items.iter().any(|item| {
                item.get("projectKey")
                    .and_then(|value| value.as_str())
                    .is_some_and(|project_key| workspace.allows_project(project_key))
            })
        })
}

fn branch_history_matches_pinned_action(
    action: &TrayReplayAction,
    branch_history: &[serde_json::Value],
    workspace: Option<&ProjectWorkspaceConfig>,
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
        entry.get("workspaceKey").and_then(|value| value.as_str())
            == action.workspace_key.as_deref()
            && branch_history_entry_allowed(entry, workspace)
            && entry
                .get("replay")
                .and_then(|value| value.as_object())
                .is_some_and(|replay| {
                    replay.get("command") == Some(command) && replay.get("request") == Some(request)
                })
    })
}

fn tray_action_kind_label(kind: &str) -> String {
    match kind {
        "build.replay" | "deploy.replay" => "构建".to_string(),
        "branch.replay" => "分支".to_string(),
        "finder.shortcut.open" => "入口".to_string(),
        "project.runtime.start" => "启动".to_string(),
        "project.runtime.stop" => "停止".to_string(),
        "project.runtime.focus" => "聚焦".to_string(),
        "project.build.run" => "构建".to_string(),
        "project.build.openOutput" | "project.openDirectory" => "打开".to_string(),
        "proxy.start" | "proxy.stop" => "代理".to_string(),
        "link.run" | "link.stop" => "联调".to_string(),
        "workspace.open" => "工作区".to_string(),
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
        "file" => "文件",
        "app" => "应用",
        "script" => "脚本",
        "tool" => "工具",
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
        "directory" | "file" => {
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
        "tool" => {
            let value = entry
                .tool_key
                .as_deref()
                .or(entry.tool.as_deref())
                .unwrap_or(entry.target_label.as_str())
                .trim();
            if value.is_empty() {
                (None, None)
            } else {
                (Some("tool".to_string()), Some(value.to_string()))
            }
        }
        _ => (None, None),
    }
}

fn workspace_resource_shortcuts(
    workspace: &ProjectWorkspaceConfig,
    link_summaries: &BTreeMap<String, LinkSummary>,
    config_source: &ConfigSource,
) -> Vec<WorkspaceResourceShortcutItem> {
    let workspace_key = workspace.key.clone();
    let config_source_id = config_source.id.clone();
    let navigation = if config_source.is_default {
        load_navigation_data_for_workspace(workspace)
    } else {
        load_navigation_source_data_for_workspace(
            &PathBuf::from(&config_source.files.navigation),
            workspace,
        )
    };
    navigation
        .ok()
        .map(|data| {
            data.categories
                .into_iter()
                .flat_map(|category| {
                    let category_title = category.title;
                    let workspace_key = workspace_key.clone();
                    let config_source_id = config_source_id.clone();
                    category
                        .entries
                        .into_iter()
                        .enumerate()
                        .map(move |(index, entry)| {
                            let menu_entry = entry.clone();
                            let kind = navigation_entry_shortcut_kind(&entry);
                            let (open_kind, value) = navigation_entry_shortcut_open_target(&entry);
                            let tool = entry.tool.clone();
                            let tool_key = entry.tool_key.clone();
                            let tool_action = entry.tool_action.clone();
                            let detail = workspace_resource_detail(&entry, link_summaries);
                            let link_runtime = if kind == "tool"
                                && tool
                                    .as_deref()
                                    .unwrap_or("link")
                                    .eq_ignore_ascii_case("link")
                            {
                                tool_key
                                    .as_deref()
                                    .and_then(|key| link_summaries.get(key))
                                    .and_then(|summary| summary.runtime.clone())
                            } else {
                                None
                            };
                            let label = entry.name.trim();
                            let label = if label.is_empty() {
                                entry.target_label.trim()
                            } else {
                                label
                            }
                            .to_string();
                            let openable = kind != "tool" && open_kind.is_some() && value.is_some();
                            WorkspaceResourceShortcutItem {
                                key: format!("{}:{}:{}", workspace_key, category_title, index),
                                config_source_id: config_source_id.clone(),
                                category: category_title.clone(),
                                label,
                                kind_label: workspace_resource_kind_label(&kind),
                                kind,
                                value,
                                detail,
                                tool,
                                tool_key,
                                tool_action,
                                link_runtime,
                                open_kind,
                                openable,
                                entry: menu_entry,
                                tool_config_source_id: None,
                                tool_proxy_source_id: None,
                            }
                        })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn workspace_resource_detail(
    entry: &NavigationEntry,
    link_summaries: &BTreeMap<String, LinkSummary>,
) -> Option<String> {
    if navigation_entry_shortcut_kind(entry) != "tool" {
        return entry.note.clone();
    }
    let tool = entry.tool.as_deref().unwrap_or("link").trim();
    let tool_key = entry.tool_key.as_deref().filter(|value| !value.is_empty());
    let action = entry
        .tool_action
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if !tool.eq_ignore_ascii_case("link") {
        let mut parts = Vec::new();
        match tool.to_ascii_lowercase().as_str() {
            "workflow" => {
                parts.push("Workflow".to_string());
                if let Some(key) = tool_key {
                    parts.push(key.to_string());
                }
            }
            "webaction" | "web-action" | "web_action" => {
                parts.push("Web Action".to_string());
                if let Some(key) = tool_key {
                    parts.push(key.to_string());
                }
            }
            "runtime" => {
                if let Some(key) = tool_key {
                    parts.push(format!("项目 {key}"));
                } else {
                    parts.push("Runtime".to_string());
                }
                if let Some(profile) = entry
                    .runtime_profile
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    parts.push(format!("运行配置 {profile}"));
                }
            }
            _ => {
                parts.push(format!("工具 {tool}"));
                if let Some(key) = tool_key {
                    parts.push(key.to_string());
                }
            }
        }
        if let Some(action) = action {
            parts.push(format!("动作 {action}"));
        }
        if let Some(note) = entry
            .note
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            parts.push(note.trim().to_string());
        }
        return Some(parts.join(" · "));
    }
    let Some(tool_key) = entry.tool_key.as_deref().filter(|value| !value.is_empty()) else {
        return Some(
            entry
                .note
                .clone()
                .unwrap_or_else(|| "缺少 Link key，无法生成计划预览".to_string()),
        );
    };
    let Some(summary) = link_summaries.get(tool_key) else {
        return Some(format!("Link 配置不存在：{tool_key}"));
    };
    let mut parts = Vec::new();
    parts.push(format!("{} 步", summary.step_count));
    if let Some(runtime) = summary.runtime.as_ref() {
        if runtime.status != "planned" {
            parts.push(runtime.label.clone());
        }
    }
    if let Some(project) = summary.project.as_deref() {
        parts.push(format!("项目 {project}"));
    }
    if !summary.proxy_profiles.is_empty() {
        parts.push(format!(
            "代理 {}",
            summary
                .proxy_profiles
                .iter()
                .map(|profile| profile.name.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    if !summary.warnings.is_empty() {
        parts.push(format!("{} 条提示", summary.warnings.len()));
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" · "))
    }
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
                    .map(|snapshot| matches!(snapshot.status_key.as_str(), "running" | "external"))
                    .unwrap_or(false),
                can_start: runtime_status
                    .map(|snapshot| snapshot.can_start)
                    .unwrap_or(false),
                can_stop: runtime_status
                    .map(|snapshot| snapshot.can_stop)
                    .unwrap_or(false),
                can_focus_runtime: runtime_status
                    .map(|snapshot| snapshot.can_focus_runtime)
                    .unwrap_or(false),
                debug_profiles: runtime_status
                    .map(|snapshot| snapshot.debug_profiles.clone())
                    .unwrap_or_default(),
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

fn workspace_key_for_pinned_action(
    workspaces: &[ProjectWorkspaceConfig],
    action: &TrayReplayAction,
) -> String {
    if let Some(workspace_key) = action.workspace_key.as_deref().filter(|workspace_key| {
        workspaces
            .iter()
            .any(|workspace| workspace.key == *workspace_key)
    }) {
        return workspace_key.to_string();
    }
    if matches!(
        action.kind.as_str(),
        "build.replay" | "deploy.replay" | "branch.replay"
    ) {
        return SYSTEM_PROJECT_WORKSPACE_KEY.to_string();
    }

    let project_keys = tray_action_project_keys(action);
    let matched_workspace_keys = workspaces
        .iter()
        .filter(|workspace| !workspace.is_system())
        .filter(|workspace| workspace_matches_action(workspace, action, &project_keys))
        .map(|workspace| workspace.key.clone())
        .collect::<Vec<_>>();
    if matched_workspace_keys.len() == 1 {
        matched_workspace_keys[0].clone()
    } else {
        SYSTEM_PROJECT_WORKSPACE_KEY.to_string()
    }
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

fn workspace_pinned_action_item(
    config: &AppConfig,
    action: TrayReplayAction,
) -> WorkspacePinnedActionItem {
    let project_key = tray_action_project_keys(&action).into_iter().next();
    let params = workspace_action_params(config, &action);
    WorkspacePinnedActionItem {
        kind_label: tray_action_kind_label(&action.kind),
        label: action.label.clone(),
        detail: action.detail.clone(),
        project_key,
        params,
        confirm_required: tray_action_confirm_required(&action.kind),
        updated_at_ms: action.updated_at_ms,
        action,
    }
}

fn workspace_action_params(
    config: &AppConfig,
    action: &TrayReplayAction,
) -> Vec<WorkspaceActionParamItem> {
    match action.kind.as_str() {
        "build.replay" | "deploy.replay" => workspace_build_action_params(config, action),
        "branch.replay" => workspace_branch_action_params(action),
        "project.build.run" => workspace_project_build_action_params(action),
        _ => Vec::new(),
    }
}

fn workspace_project_build_action_params(
    action: &TrayReplayAction,
) -> Vec<WorkspaceActionParamItem> {
    let mut params = Vec::new();
    if let Some(project_key) = action
        .project_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        push_action_param(&mut params, "项目", project_key);
    }
    params
}

fn workspace_build_action_params(
    config: &AppConfig,
    action: &TrayReplayAction,
) -> Vec<WorkspaceActionParamItem> {
    let Some(serde_json::Value::Object(payload)) = action.payload.as_ref() else {
        return Vec::new();
    };
    let project_key = json_object_string(payload, "project")
        .or_else(|| action.project_key.clone())
        .unwrap_or_default();
    let target_key = json_object_string(payload, "target");
    let mut params = Vec::new();
    if let Some(target) = target_key.as_deref() {
        push_action_param(&mut params, "目标", target);
    }
    if let Some(env) = json_object_string(payload, "env") {
        push_action_param(&mut params, "环境", &env);
    }
    if let Some(branch) = json_object_string(payload, "branch") {
        push_action_param(&mut params, "分支", &branch);
    }
    if let Some(target) = target_key
        .as_deref()
        .and_then(|target| find_build_target(config, &project_key, target))
    {
        push_action_param(
            &mut params,
            "类型",
            build_target_adapter_key(&target.adapter),
        );
        if !target.job_name.trim().is_empty() {
            push_action_param(&mut params, "Job", &target.job_name);
        }
        if !target.jenkins_profile.trim().is_empty() {
            push_action_param(&mut params, "Profile", &target.jenkins_profile);
        }
    }
    if payload
        .get("variant")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        push_action_param(&mut params, "变体", "是");
    }
    push_json_params(&mut params, payload.get("params"));
    push_json_params(&mut params, payload.get("extraParams"));
    params.truncate(8);
    params
}

fn workspace_branch_action_params(action: &TrayReplayAction) -> Vec<WorkspaceActionParamItem> {
    let Some(serde_json::Value::Object(payload)) = action.payload.as_ref() else {
        return Vec::new();
    };
    let Some(serde_json::Value::Object(request)) = payload.get("request") else {
        return Vec::new();
    };
    let mut params = Vec::new();
    if let Some(project) = json_object_string(request, "project") {
        push_action_param(&mut params, "项目", &project);
    } else if let Some(projects) = request.get("projects").and_then(|value| value.as_array()) {
        let projects = projects
            .iter()
            .filter_map(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .take(3)
            .collect::<Vec<_>>();
        if !projects.is_empty() {
            push_action_param(&mut params, "项目", &projects.join(", "));
        }
    }
    if let Some(source_branch) = json_object_string(request, "sourceBranch") {
        push_action_param(&mut params, "源分支", &source_branch);
    }
    if let Some(target_branch) = json_object_string(request, "targetBranch") {
        push_action_param(&mut params, "目标分支", &target_branch);
    } else if let Some(target_branches) = request
        .get("targetBranches")
        .and_then(|value| value.as_array())
    {
        let branches = target_branches
            .iter()
            .filter_map(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .take(3)
            .collect::<Vec<_>>();
        if !branches.is_empty() {
            push_action_param(&mut params, "目标分支", &branches.join(", "));
        }
    }
    if let Some(destination_dir) = json_object_string(request, "destinationDir") {
        push_action_param(&mut params, "目录", &destination_dir);
    } else if let Some(repo_path) = json_object_string(request, "repoPath") {
        push_action_param(&mut params, "目录", &repo_path);
    }
    if request
        .get("commitBeforePush")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        push_action_param(&mut params, "提交", "是");
    }
    if let Some(message) = json_object_string(request, "commitMessage") {
        push_action_param(&mut params, "提交信息", &message);
    }
    if let Some(paths) = request
        .get("selectedPaths")
        .and_then(|value| value.as_array())
    {
        let count = paths
            .iter()
            .filter_map(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .count();
        if count > 0 {
            push_action_param(&mut params, "已选文件", &count.to_string());
        }
    }
    params.truncate(8);
    params
}

fn find_build_target<'a>(
    config: &'a AppConfig,
    project_key: &str,
    target_key: &str,
) -> Option<&'a DeployTargetConfig> {
    config
        .projects
        .iter()
        .find(|project| project.key == project_key)
        .and_then(|project| {
            project
                .deploy_targets
                .iter()
                .find(|target| target.key == target_key)
        })
}

fn json_object_string(
    object: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Option<String> {
    object
        .get(key)
        .and_then(json_value_summary)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn json_value_summary(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Null => None,
        serde_json::Value::String(value) => Some(value.clone()),
        serde_json::Value::Bool(value) => Some(if *value { "是" } else { "否" }.to_string()),
        serde_json::Value::Number(value) => Some(value.to_string()),
        serde_json::Value::Array(values) => {
            let summary = values
                .iter()
                .filter_map(json_value_summary)
                .take(3)
                .collect::<Vec<_>>()
                .join(", ");
            if summary.is_empty() {
                None
            } else {
                Some(summary)
            }
        }
        serde_json::Value::Object(_) => None,
    }
}

fn push_json_params(params: &mut Vec<WorkspaceActionParamItem>, value: Option<&serde_json::Value>) {
    let Some(serde_json::Value::Object(values)) = value else {
        return;
    };
    for (key, value) in values {
        let key = key.trim();
        if key.is_empty() {
            continue;
        }
        let value = if sensitive_action_param_key(key) {
            Some("******".to_string())
        } else {
            json_value_summary(value)
        };
        if let Some(value) = value {
            push_action_param(params, key, &value);
        }
    }
}

fn sensitive_action_param_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    ["token", "secret", "password", "passwd", "credential"]
        .iter()
        .any(|needle| key.contains(needle))
}

fn push_action_param(params: &mut Vec<WorkspaceActionParamItem>, label: &str, value: &str) {
    let label = label.trim();
    let value = value.trim();
    if label.is_empty() || value.is_empty() {
        return;
    }
    if params
        .iter()
        .any(|item| item.label == label && item.value == value)
    {
        return;
    }
    params.push(WorkspaceActionParamItem {
        label: label.to_string(),
        value: compact_action_param_value(value),
    });
}

fn compact_action_param_value(value: &str) -> String {
    const LIMIT: usize = 56;
    let value = value.trim();
    if value.chars().count() <= LIMIT {
        return value.to_string();
    }
    let mut compact = value
        .chars()
        .take(LIMIT.saturating_sub(1))
        .collect::<String>();
    compact.push('…');
    compact
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
    config_source_id: &str,
    filter_workspace: bool,
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
            !filter_workspace
                || workspace.is_system()
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
                config_source_id: config_source_id.to_string(),
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

fn resolve_workspace_capability_source(
    paths: &ConfigPaths,
    workspace: &ProjectWorkspaceConfig,
    workspaces: &[ProjectWorkspaceConfig],
    capability: &str,
) -> Result<ConfigSource, String> {
    let source_id = core_load_config_source_preference(paths, &workspace.key, capability)
        .map_err(|error| error.to_string())?;
    core_resolve_config_source(Some(&source_id), workspaces).map_err(|error| error.to_string())
}

fn workspace_link_summary_map(
    link_source: &ConfigSource,
    config: &AppConfig,
    workspaces: &[ProjectWorkspaceConfig],
    proxy_path: &Path,
    proxy_config: &ProxyConfig,
    proxy_runtime: &ProxyRuntimeState,
    project_runtime_statuses: &BTreeMap<String, ProjectRuntimeSnapshot>,
) -> BTreeMap<String, LinkSummary> {
    let links_path = PathBuf::from(&link_source.files.links);
    let mut summaries =
        core_list_link_summaries_from_path(&links_path, config, workspaces, proxy_config)
            .unwrap_or_default();
    let links = core_list_links_from_path(&links_path).unwrap_or_default();
    attach_link_runtime_summaries(
        &mut summaries,
        &links,
        proxy_path,
        proxy_config,
        proxy_runtime,
        project_runtime_statuses,
    );
    summaries
        .into_iter()
        .map(|summary| (summary.key.clone(), summary))
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

        let target_key = workspace_key_for_pinned_action(&workspaces, &action);

        grouped.entry(target_key).or_default().push(action);
    }

    let workspace_configs = workspaces.clone();
    let mut overview = Vec::new();
    for workspace in workspaces {
        let resource_source = resolve_workspace_capability_source(
            &paths,
            &workspace,
            &workspace_configs,
            "resource",
        )?;
        let link_source =
            resolve_workspace_capability_source(&paths, &workspace, &workspace_configs, "link")?;
        let proxy_source =
            resolve_workspace_capability_source(&paths, &workspace, &workspace_configs, "proxy")?;
        let runtime_source =
            resolve_workspace_capability_source(&paths, &workspace, &workspace_configs, "runtime")?;
        let mut effective_config = apply_project_workspace_context(config, &workspace);
        apply_runtime_overrides_for_source(&mut effective_config, &runtime_source)?;
        let project_runtime_statuses = project_runtime
            .list(&effective_config)?
            .into_iter()
            .map(|snapshot| (snapshot.key.clone(), snapshot))
            .collect::<BTreeMap<_, _>>();
        let proxy_path = proxy_path_for_config_source(&proxy_source)?;
        let proxy_dashboard = proxy_runtime
            .dashboard(&proxy_path)
            .map_err(|error| error.to_string())?;
        let proxy_dashboard = if proxy_source.is_default {
            filter_proxy_dashboard_by_workspace(proxy_dashboard, &workspace)
        } else {
            proxy_dashboard
        };
        let proxy_rule_counts = proxy_rule_counts_by_profile(&proxy_dashboard);
        let proxy_statuses = proxy_status_by_profile(&proxy_dashboard);
        let link_summaries = workspace_link_summary_map(
            &link_source,
            &effective_config,
            &workspace_configs,
            &proxy_path,
            &proxy_dashboard.config,
            proxy_runtime,
            &project_runtime_statuses,
        );
        let actions = grouped.remove(&workspace.key).unwrap_or_default();
        let project_count = workspace.project_count_for(config);
        let mut resources =
            workspace_resource_shortcuts(&workspace, &link_summaries, &resource_source);
        for resource in &mut resources {
            if resource.kind == "tool" {
                resource.tool_config_source_id = Some(link_source.id.clone());
                resource.tool_proxy_source_id = Some(proxy_source.id.clone());
            }
        }
        let entry_count = resources.len();
        let project_directories = workspace_project_directory_items(
            &effective_config,
            &workspace,
            &project_runtime_statuses,
        );
        let proxy_profiles = workspace_proxy_profile_items(
            &proxy_dashboard,
            &proxy_source.id,
            false,
            &workspace,
            &workspace_names,
            &proxy_rule_counts,
            &proxy_statuses,
        );
        let items = actions
            .into_iter()
            .map(|action| workspace_pinned_action_item(&effective_config, action))
            .collect::<Vec<_>>();
        let resource_status = workspace_resource_status(&workspace);
        overview.push(WorkspacePinnedActionsOverview {
            key: workspace.key.clone(),
            name: workspace_display_name(&workspace),
            description: workspace.description.clone(),
            system: workspace.is_system(),
            root_dir: workspace
                .root_dir
                .as_ref()
                .map(|path| path.display().to_string()),
            resource_dir: resource_status
                .as_ref()
                .map(|status| status.resource_dir.clone()),
            worklog_path: resource_status
                .as_ref()
                .map(|status| status.worklog_path.clone()),
            worklog_exists: resource_status
                .as_ref()
                .is_some_and(|status| status.worklog_exists),
            worklog_auto_record: workspace.worklog_auto_record,
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
        });
    }

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
    if let Some(resource_dir) = overview
        .resource_dir
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("- 资料目录: `{}`", resource_dir));
    }
    if let Some(worklog_path) = overview
        .worklog_path
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        lines.push(format!(
            "- 工作日志: `{}` ({})",
            worklog_path,
            if overview.worklog_exists {
                "已就绪"
            } else {
                "尚未创建"
            }
        ));
        lines.push(format!(
            "- 自动记录关键操作: {}",
            if overview.worklog_auto_record {
                "已开启"
            } else {
                "已关闭"
            }
        ));
    }
    lines.push(format!("- 项目数: {}", overview.project_count));
    lines.push(format!("- 入口数: {}", overview.entry_count));
    lines.push(format!("- 代理服务数: {}", overview.proxy_profile_count));
    lines.push(format!("- 动作数: {}", overview.action_count));
    lines.push(format!(
        "- 包含范围: {}",
        workspace_ai_context_scope_labels(options).join(" / ")
    ));
    lines.push(
        "- 内容约定: 配置密钥和私密环境变量不会主动输出；工作日志按文件原文提供。".to_string(),
    );

    if let Some(worklog) = context
        .workspace
        .as_ref()
        .and_then(|workspace| workspace.worklog.as_ref())
    {
        lines.push(String::new());
        lines.push("## 最近工作记录".to_string());
        lines.push(format!("- 文件: `{}`", worklog.path));
        if worklog.content_truncated {
            lines.push("- 说明: 内容较长，以下仅包含最近片段".to_string());
        }
        if !worklog.exists || worklog.content.trim().is_empty() {
            lines.push("- 暂无记录".to_string());
        } else {
            lines.extend(worklog.content.lines().map(|line| {
                if line.is_empty() {
                    ">".to_string()
                } else {
                    format!("> {line}")
                }
            }));
        }
    }

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
                let detail = resource
                    .detail
                    .as_deref()
                    .filter(|value| !value.is_empty())
                    .map(|value| format!(" · {}", value))
                    .unwrap_or_default();
                lines.push(format!(
                    "- {} · {} · `{}`{}",
                    resource.label, resource.kind_label, value, detail
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
        action.workspace_key = action
            .workspace_key
            .take()
            .map(|workspace_key| workspace_key.trim().to_string())
            .filter(|workspace_key| !workspace_key.is_empty());
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

    if action.workspace_key.is_none()
        && let Ok(workspace) = active_history_workspace()
    {
        action.workspace_key = Some(workspace.key);
    }
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
        "workspace.open" => ("工作区", NativeIcon::Home),
        "branch.replay" => ("分支", NativeIcon::FollowLinkFreestanding),
        "build.replay" | "deploy.replay" => ("构建", NativeIcon::Advanced),
        "finder.shortcut.open" => ("入口", NativeIcon::Bookmarks),
        "project.runtime.start" => ("启动", NativeIcon::RightFacingTriangle),
        "project.runtime.stop" => ("停止", NativeIcon::StopProgressFreestanding),
        "project.runtime.focus" => ("聚焦", NativeIcon::RevealFreestanding),
        "project.build.run" => ("构建", NativeIcon::Advanced),
        "project.build.openOutput" | "project.openDirectory" => ("打开", NativeIcon::Folder),
        "proxy.start" => ("启动", NativeIcon::Network),
        "proxy.stop" => ("停止", NativeIcon::StopProgressFreestanding),
        "link.run" => ("启动", NativeIcon::FollowLinkFreestanding),
        "link.stop" => ("停止", NativeIcon::StopProgressFreestanding),
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

fn tray_workspace_action(
    kind: &str,
    workspace_key: &str,
    label: String,
    detail: Option<String>,
    project_key: Option<String>,
    payload: Option<serde_json::Value>,
    dedupe_suffix: &str,
) -> TrayReplayAction {
    TrayReplayAction {
        kind: kind.to_string(),
        label,
        detail,
        workspace_key: Some(workspace_key.to_string()),
        project_key,
        entry: None,
        payload,
        dedupe_key: format!("{kind}:{workspace_key}:{dedupe_suffix}"),
        updated_at_ms: unix_time_ms(),
    }
}

fn tray_workspace_open_action(workspace_key: &str, workspace_name: &str) -> TrayReplayAction {
    tray_workspace_action(
        "workspace.open",
        workspace_key,
        format!("打开工作区 {}", workspace_name),
        None,
        None,
        None,
        workspace_key,
    )
}

fn tray_navigation_action(
    workspace_key: &str,
    resource: &WorkspaceResourceShortcutItem,
) -> TrayReplayAction {
    let mut action = tray_action_for_navigation_entry(&resource.entry);
    action.workspace_key = Some(workspace_key.to_string());
    action.dedupe_key = format!("finder.shortcut.open:{}:{}", workspace_key, resource.key);
    action
}

fn tray_recent_project_debug_profile(
    recent_actions: &[TrayReplayAction],
    workspace_key: &str,
    active_workspace_key: &str,
    project: &WorkspaceProjectDirectoryItem,
) -> Option<(String, String)> {
    let recent_profile = recent_actions.iter().find_map(|action| {
        if action.kind != "project.runtime.start"
            || action.project_key.as_deref() != Some(project.project_key.as_str())
            || !(action.workspace_key.as_deref() == Some(workspace_key)
                || (action.workspace_key.is_none() && workspace_key == active_workspace_key))
        {
            return None;
        }
        action
            .payload
            .as_ref()
            .and_then(|payload| payload.get("debugProfile"))
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    });
    let profile_key = recent_profile.or_else(|| {
        if project.debug_profiles.len() == 1 {
            project
                .debug_profiles
                .first()
                .map(|profile| profile.key.clone())
        } else {
            None
        }
    })?;
    let label = project
        .debug_profiles
        .iter()
        .find(|profile| profile.key == profile_key)
        .map(|profile| profile.label.clone())
        .unwrap_or_else(|| profile_key.clone());
    Some((profile_key, label))
}

fn tray_project_menu_actions(
    workspace_key: &str,
    active_workspace_key: &str,
    projects: &[WorkspaceProjectDirectoryItem],
    recent_actions: &[TrayReplayAction],
    open_action: &TrayReplayAction,
) -> Vec<TrayMenuActionItem> {
    let mut actions = Vec::new();
    let include_directory_action = projects.len() == 1;
    let recent_project_rank = recent_actions
        .iter()
        .filter(|action| {
            action.workspace_key.as_deref() == Some(workspace_key)
                || (action.workspace_key.is_none() && workspace_key == active_workspace_key)
        })
        .filter_map(|action| {
            action
                .project_key
                .as_ref()
                .map(|key| (key.clone(), action.updated_at_ms))
        })
        .fold(BTreeMap::<String, u64>::new(), |mut ranks, (key, rank)| {
            ranks
                .entry(key)
                .and_modify(|current| *current = (*current).max(rank))
                .or_insert(rank);
            ranks
        });
    let mut projects = projects.iter().collect::<Vec<_>>();
    projects.sort_by(|left, right| {
        right
            .running
            .cmp(&left.running)
            .then_with(|| {
                recent_project_rank
                    .get(&right.project_key)
                    .copied()
                    .unwrap_or_default()
                    .cmp(
                        &recent_project_rank
                            .get(&left.project_key)
                            .copied()
                            .unwrap_or_default(),
                    )
            })
            .then_with(|| left.project_name.cmp(&right.project_name))
    });
    for project in projects {
        let debug_profile = tray_recent_project_debug_profile(
            recent_actions,
            workspace_key,
            active_workspace_key,
            project,
        );
        if project.running {
            if project.can_focus_runtime {
                let (payload, profile_label) = debug_profile
                    .as_ref()
                    .map(|(key, label)| {
                        (Some(json!({ "debugProfile": key })), Some(label.as_str()))
                    })
                    .unwrap_or((None, None));
                actions.push(TrayMenuActionItem {
                    label: profile_label
                        .map(|profile| format!("打开 · {} · {}", project.project_name, profile))
                        .unwrap_or_else(|| format!("打开 · {}", project.project_name)),
                    enabled: true,
                    action: tray_workspace_action(
                        "project.runtime.focus",
                        workspace_key,
                        format!("打开 {}", project.project_name),
                        None,
                        Some(project.project_key.clone()),
                        payload,
                        &project.project_key,
                    ),
                });
            } else {
                let mut action = open_action.clone();
                action.project_key = Some(project.project_key.clone());
                actions.push(TrayMenuActionItem {
                    label: format!("运行中 · {}", project.project_name),
                    enabled: false,
                    action,
                });
            }
            if project.can_stop {
                actions.push(TrayMenuActionItem {
                    label: format!("停止 · {}", project.project_name),
                    enabled: true,
                    action: tray_workspace_action(
                        "project.runtime.stop",
                        workspace_key,
                        format!("停止 {}", project.project_name),
                        None,
                        Some(project.project_key.clone()),
                        None,
                        &project.project_key,
                    ),
                });
            }
        } else if project.can_start {
            let (payload, profile_label, dedupe_suffix) = match debug_profile {
                Some((key, label)) => (
                    Some(json!({ "debugProfile": key })),
                    Some(label),
                    format!("{}:profile", project.project_key),
                ),
                None => (None, None, project.project_key.clone()),
            };
            let label = profile_label
                .as_deref()
                .map(|profile| format!("启动 · {} · {}", project.project_name, profile))
                .unwrap_or_else(|| format!("启动 · {}", project.project_name));
            actions.push(TrayMenuActionItem {
                label,
                enabled: true,
                action: tray_workspace_action(
                    "project.runtime.start",
                    workspace_key,
                    format!("启动 {}", project.project_name),
                    profile_label,
                    Some(project.project_key.clone()),
                    payload,
                    &dedupe_suffix,
                ),
            });
        } else {
            let mut action = open_action.clone();
            action.project_key = Some(project.project_key.clone());
            actions.push(TrayMenuActionItem {
                label: format!("{} · {}", project.status_label, project.project_name),
                enabled: false,
                action,
            });
        }

        if include_directory_action && project.path.is_some() {
            actions.push(TrayMenuActionItem {
                label: format!("打开目录 · {}", project.project_name),
                enabled: true,
                action: tray_workspace_action(
                    "project.openDirectory",
                    workspace_key,
                    format!("打开 {} 目录", project.project_name),
                    project.path.clone(),
                    Some(project.project_key.clone()),
                    None,
                    &project.project_key,
                ),
            });
        }
    }
    actions
}

fn tray_proxy_menu_actions(
    workspace_key: &str,
    profiles: &[WorkspaceProxyProfileItem],
) -> Vec<TrayMenuActionItem> {
    profiles
        .iter()
        .map(|profile| {
            let (kind, verb) = if profile.running {
                ("proxy.stop", "停止")
            } else {
                ("proxy.start", "启动")
            };
            TrayMenuActionItem {
                label: format!("{} · {}", verb, profile.name),
                enabled: true,
                action: tray_workspace_action(
                    kind,
                    workspace_key,
                    format!("{} {}", verb, profile.name),
                    Some(profile.listen_url.clone()),
                    None,
                    Some(json!({
                        "sourceId": profile.config_source_id,
                        "profileId": profile.id,
                    })),
                    &profile.id,
                ),
            }
        })
        .collect()
}

fn tray_link_menu_actions(
    workspace_key: &str,
    resources: &[WorkspaceResourceShortcutItem],
    open_action: &TrayReplayAction,
) -> Vec<TrayMenuActionItem> {
    let mut actions = Vec::new();
    for resource in resources.iter().filter(|resource| {
        resource.kind == "tool"
            && resource
                .tool
                .as_deref()
                .unwrap_or("link")
                .eq_ignore_ascii_case("link")
    }) {
        let Some(link_key) = resource
            .tool_key
            .as_deref()
            .filter(|value| !value.is_empty())
        else {
            let mut action = open_action.clone();
            action.detail = resource.detail.clone();
            actions.push(TrayMenuActionItem {
                label: format!("配置异常 · {}", resource.label),
                enabled: false,
                action,
            });
            continue;
        };
        let Some(runtime) = resource.link_runtime.as_ref() else {
            let mut action = open_action.clone();
            action.detail = resource.detail.clone();
            actions.push(TrayMenuActionItem {
                label: format!("配置异常 · {}", resource.label),
                enabled: false,
                action,
            });
            continue;
        };
        let payload = json!({
            "sourceId": resource.tool_config_source_id,
            "proxySourceId": resource.tool_proxy_source_id,
            "linkKey": link_key,
        });
        if runtime.can_run {
            let verb = if runtime.controllable_steps == 0 {
                "执行"
            } else if runtime.status == "partial" {
                "继续启动"
            } else {
                "启动"
            };
            actions.push(TrayMenuActionItem {
                label: format!("{} · {}", verb, resource.label),
                enabled: true,
                action: tray_workspace_action(
                    "link.run",
                    workspace_key,
                    format!("{} {}", verb, resource.label),
                    resource.detail.clone(),
                    None,
                    Some(payload.clone()),
                    link_key,
                ),
            });
        }
        if runtime.can_stop {
            actions.push(TrayMenuActionItem {
                label: format!("停止 · {}", resource.label),
                enabled: true,
                action: tray_workspace_action(
                    "link.stop",
                    workspace_key,
                    format!("停止 {}", resource.label),
                    resource.detail.clone(),
                    None,
                    Some(payload),
                    link_key,
                ),
            });
        }
        if !runtime.can_run && !runtime.can_stop {
            let mut action = open_action.clone();
            action.detail = resource.detail.clone();
            actions.push(TrayMenuActionItem {
                label: format!("{} · {}", runtime.label, resource.label),
                enabled: false,
                action,
            });
        }
    }
    actions
}

fn limited_tray_category_actions(
    mut actions: Vec<TrayMenuActionItem>,
    open_action: &TrayReplayAction,
) -> Vec<TrayMenuActionItem> {
    if actions.len() <= TRAY_CATEGORY_ITEM_LIMIT {
        return actions;
    }
    actions.truncate(TRAY_CATEGORY_ITEM_LIMIT.saturating_sub(1));
    actions.push(TrayMenuActionItem {
        label: "在 rDevTool 中查看全部…".to_string(),
        enabled: true,
        action: open_action.clone(),
    });
    actions
}

fn tray_workspace_menus(
    overview: Vec<WorkspacePinnedActionsOverview>,
    active_workspace_key: &str,
    recent_actions: &[TrayReplayAction],
) -> (Vec<TrayWorkspaceMenu>, usize) {
    let recent_workspace_rank = recent_actions
        .iter()
        .filter_map(|action| {
            action
                .workspace_key
                .as_ref()
                .map(|key| (key.clone(), action.updated_at_ms))
        })
        .fold(BTreeMap::<String, u64>::new(), |mut ranks, (key, rank)| {
            ranks
                .entry(key)
                .and_modify(|current| *current = (*current).max(rank))
                .or_insert(rank);
            ranks
        });
    let mut overview = overview
        .into_iter()
        .filter(|workspace| !workspace.system)
        .collect::<Vec<_>>();
    overview.sort_by(|left, right| {
        let left_active = left.key == active_workspace_key;
        let right_active = right.key == active_workspace_key;
        right_active
            .cmp(&left_active)
            .then_with(|| {
                recent_workspace_rank
                    .get(&right.key)
                    .copied()
                    .unwrap_or_default()
                    .cmp(
                        &recent_workspace_rank
                            .get(&left.key)
                            .copied()
                            .unwrap_or_default(),
                    )
            })
            .then_with(|| left.name.cmp(&right.name))
    });
    let workspace_count = overview.len();
    overview.truncate(TRAY_WORKSPACE_MENU_LIMIT);

    let menus = overview
        .into_iter()
        .map(|workspace| {
            let active = workspace.key == active_workspace_key;
            let open_action = tray_workspace_open_action(&workspace.key, &workspace.name);
            let open_item = TrayMenuActionItem {
                label: "打开工作区".to_string(),
                enabled: true,
                action: open_action.clone(),
            };
            let entry_actions = workspace
                .resources
                .iter()
                .filter(|resource| resource.kind != "tool")
                .map(|resource| TrayMenuActionItem {
                    label: resource.label.clone(),
                    enabled: true,
                    action: tray_navigation_action(&workspace.key, resource),
                })
                .collect::<Vec<_>>();
            let project_actions = tray_project_menu_actions(
                &workspace.key,
                active_workspace_key,
                &workspace.project_directories,
                recent_actions,
                &open_action,
            );
            let proxy_actions = tray_proxy_menu_actions(&workspace.key, &workspace.proxy_profiles);
            let link_actions =
                tray_link_menu_actions(&workspace.key, &workspace.resources, &open_action);
            let shortcut_actions = workspace
                .actions
                .into_iter()
                .map(|item| {
                    let mut action = item.action;
                    action.workspace_key = Some(workspace.key.clone());
                    TrayMenuActionItem {
                        label: tray_action_menu_label(&action),
                        enabled: true,
                        action,
                    }
                })
                .collect::<Vec<_>>();
            let mut categories = Vec::new();
            for (key, label, actions) in [
                ("entries", "入口", entry_actions),
                ("projects", "项目", project_actions),
                ("proxies", "代理", proxy_actions),
                ("links", "本地联调", link_actions),
                ("shortcuts", "快捷操作", shortcut_actions),
            ] {
                if !actions.is_empty() {
                    categories.push(TrayMenuCategory {
                        key: key.to_string(),
                        label: label.to_string(),
                        actions: limited_tray_category_actions(actions, &open_action),
                    });
                }
            }
            TrayWorkspaceMenu {
                label: if active {
                    format!("● {}", truncate_menu_label(&workspace.name))
                } else {
                    truncate_menu_label(&workspace.name)
                },
                active,
                open_action: open_item,
                categories,
            }
        })
        .collect();
    (menus, workspace_count)
}

fn register_tray_menu_action(
    actions: &mut BTreeMap<String, TrayReplayAction>,
    action: TrayReplayAction,
) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in action
        .workspace_key
        .as_deref()
        .unwrap_or_default()
        .bytes()
        .chain(action.kind.bytes())
        .chain(action.dedupe_key.bytes())
    {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    let base_id = format!("{}{hash:016x}", TRAY_WORKSPACE_ACTION_PREFIX);
    let mut id = base_id.clone();
    let mut occurrence = 2;
    while actions.contains_key(&id) {
        id = format!("{base_id}_{occurrence}");
        occurrence += 1;
    }
    actions.insert(id.clone(), action);
    id
}

fn tray_category_icon(category: &str) -> NativeIcon {
    match category {
        "entries" => NativeIcon::Bookmarks,
        "projects" => NativeIcon::Folder,
        "proxies" => NativeIcon::Network,
        "links" => NativeIcon::FollowLinkFreestanding,
        "shortcuts" => NativeIcon::SmartBadge,
        _ => NativeIcon::ListView,
    }
}

fn create_tray_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let (recent_actions, workspace_menus, workspace_count) = if let Some(state) =
        app.try_state::<AppState>()
    {
        let recent_actions = tray_recent_actions(&state.storage);
        let active_workspace_key = active_history_workspace()
            .map(|workspace| workspace.key)
            .unwrap_or_else(|error| {
                eprintln!("failed to load active workspace for tray menu: {error}");
                SYSTEM_PROJECT_WORKSPACE_KEY.to_string()
            });
        let workspace_menus = state
            .config_state
            .load()
            .and_then(|config| {
                workspace_pinned_actions_overview(
                    &config,
                    &state.storage,
                    &state.proxy_runtime,
                    &state.project_runtime,
                )
            })
            .map(|overview| tray_workspace_menus(overview, &active_workspace_key, &recent_actions))
            .unwrap_or_else(|error| {
                eprintln!("failed to build workspace tray menu: {error}");
                (Vec::new(), 0)
            });
        (recent_actions, workspace_menus.0, workspace_menus.1)
    } else {
        (Vec::new(), Vec::new(), 0)
    };

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
    let menu = Menu::new(app)?;
    menu.append(&show_item)?;
    menu.append(&replay_last_item)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;

    let mut registered_actions = BTreeMap::new();
    if workspace_menus.is_empty() {
        let empty_item = IconMenuItem::with_id_and_native_icon(
            app,
            "tray_workspaces_empty",
            "暂无可用工作区",
            false,
            Some(NativeIcon::Folder),
            None::<&str>,
        )?;
        menu.append(&empty_item)?;
    } else {
        for (workspace_index, workspace) in workspace_menus.into_iter().enumerate() {
            let workspace_submenu = Submenu::with_id_and_native_icon(
                app,
                format!("tray_workspace_menu_{workspace_index}"),
                workspace.label,
                true,
                Some(if workspace.active {
                    NativeIcon::StatusAvailable
                } else {
                    NativeIcon::Folder
                }),
            )?;
            let open_id =
                register_tray_menu_action(&mut registered_actions, workspace.open_action.action);
            let open_item = IconMenuItem::with_id_and_native_icon(
                app,
                open_id,
                workspace.open_action.label,
                workspace.open_action.enabled,
                Some(NativeIcon::Home),
                None::<&str>,
            )?;
            workspace_submenu.append(&open_item)?;

            if !workspace.categories.is_empty() {
                workspace_submenu.append(&PredefinedMenuItem::separator(app)?)?;
            }
            for (category_index, category) in workspace.categories.into_iter().enumerate() {
                let category_submenu = Submenu::with_id_and_native_icon(
                    app,
                    format!(
                        "tray_workspace_category_{}_{}_{}",
                        workspace_index, category_index, category.key
                    ),
                    category.label,
                    true,
                    Some(tray_category_icon(&category.key)),
                )?;
                for item in category.actions {
                    let (_, icon) = tray_action_menu_meta(&item.action);
                    let action_id = register_tray_menu_action(&mut registered_actions, item.action);
                    let action_item = IconMenuItem::with_id_and_native_icon(
                        app,
                        action_id,
                        truncate_menu_label(&item.label),
                        item.enabled,
                        Some(icon),
                        None::<&str>,
                    )?;
                    category_submenu.append(&action_item)?;
                }
                workspace_submenu.append(&category_submenu)?;
            }
            menu.append(&workspace_submenu)?;
        }
    }

    if workspace_count > TRAY_WORKSPACE_MENU_LIMIT {
        let more_item = IconMenuItem::with_id_and_native_icon(
            app,
            TRAY_MORE_WORKSPACES_ID,
            "更多工作区…",
            true,
            Some(NativeIcon::ListView),
            None::<&str>,
        )?;
        menu.append(&more_item)?;
    }

    menu.append(&PredefinedMenuItem::separator(app)?)?;
    let quit_item = MenuItem::with_id(app, TRAY_QUIT_ID, "退出", true, None::<&str>)?;
    menu.append(&quit_item)?;

    if let Some(state) = app.try_state::<AppState>() {
        match state.tray_menu_actions.write() {
            Ok(mut actions) => *actions = registered_actions,
            Err(_) => eprintln!("failed to update tray menu action registry"),
        }
    }

    Ok(menu)
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

struct WorkspaceExecutionContext {
    workspaces: Vec<ProjectWorkspaceConfig>,
    config: AppConfig,
    link_source: ConfigSource,
    proxy_source: ConfigSource,
    runtime_source: ConfigSource,
    proxy_path: PathBuf,
}

fn workspace_execution_context(
    config_state: &AppConfigState,
    workspace_key: Option<&str>,
) -> Result<WorkspaceExecutionContext, String> {
    let paths = ensure_default_configs().map_err(|error| error.to_string())?;
    let workspaces =
        load_project_workspaces(&paths.project_workspaces).map_err(|error| error.to_string())?;
    let workspace = if let Some(workspace_key) = workspace_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        load_project_workspace_by_key(&paths.project_workspaces, workspace_key)
            .map_err(|error| error.to_string())?
    } else {
        load_active_project_workspace(&paths).map_err(|error| error.to_string())?
    };
    let mut config = apply_project_workspace_context(&config_state.load()?, &workspace);
    let runtime_source =
        resolve_workspace_capability_source(&paths, &workspace, &workspaces, "runtime")?;
    apply_runtime_overrides_for_source(&mut config, &runtime_source)?;
    let link_source = resolve_workspace_capability_source(&paths, &workspace, &workspaces, "link")?;
    let proxy_source =
        resolve_workspace_capability_source(&paths, &workspace, &workspaces, "proxy")?;
    let proxy_path = proxy_path_for_config_source(&proxy_source)?;
    Ok(WorkspaceExecutionContext {
        workspaces,
        config,
        link_source,
        proxy_source,
        runtime_source,
        proxy_path,
    })
}

fn link_source_context(
    context: &WorkspaceExecutionContext,
    link_source: &ConfigSource,
) -> LinkSourceContext {
    LinkSourceContext {
        link_source_id: link_source.id.clone(),
        link_source_name: link_source.name.clone(),
        proxy_source_id: context.proxy_source.id.clone(),
        proxy_source_name: context.proxy_source.name.clone(),
        runtime_source_id: context.runtime_source.id.clone(),
        runtime_source_name: context.runtime_source.name.clone(),
        aligned: link_source.id == context.proxy_source.id
            && link_source.id == context.runtime_source.id,
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

fn tray_payload_string(
    action: &TrayReplayAction,
    key: &str,
    label: &str,
) -> Result<String, String> {
    action
        .payload
        .as_ref()
        .and_then(|payload| payload.get(key))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("缺少{label}"))
}

fn tray_optional_payload_string(action: &TrayReplayAction, key: &str) -> Option<String> {
    action
        .payload
        .as_ref()
        .and_then(|payload| payload.get(key))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn tray_action_is_repeatable(action: &TrayReplayAction) -> bool {
    !matches!(
        action.kind.as_str(),
        "workspace.open" | "project.runtime.stop" | "proxy.stop" | "link.stop"
    )
}

fn tray_action_uses_frontend_workflow(action: &TrayReplayAction) -> bool {
    matches!(
        action.kind.as_str(),
        "build.replay" | "deploy.replay" | "branch.replay"
    )
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

fn tray_action_workspace_key(action: &TrayReplayAction) -> Result<String, String> {
    action
        .workspace_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .map(Ok)
        .unwrap_or_else(|| active_history_workspace().map(|workspace| workspace.key))
}

fn execute_tray_replay_action<R: Runtime>(
    app: &AppHandle<R>,
    action: &TrayReplayAction,
) -> Result<(), String> {
    let Some(state) = app.try_state::<AppState>() else {
        return Err("应用状态尚未就绪".to_string());
    };

    match action.kind.as_str() {
        "workspace.open" => {
            let workspace_key = action
                .workspace_key
                .as_deref()
                .ok_or_else(|| "缺少工作区 Key".to_string())?;
            activate_project_workspace(&state.config_state, workspace_key)?;
            show_main_window(app);
            let _ = app.emit(
                WORKSPACE_STATE_CHANGED_EVENT,
                WorkspaceStateChangedPayload {
                    revision: unix_time_ms(),
                    origin: "internal".to_string(),
                    scopes: vec!["workspace".to_string()],
                    project_workspace_keys: vec![workspace_key.to_string()],
                    project_workspaces_unknown: false,
                },
            );
        }
        "project.runtime.start" => {
            let project_key = action
                .project_key
                .as_deref()
                .ok_or_else(|| "缺少项目 Key".to_string())?;
            let workspace_key = tray_action_workspace_key(action)?;
            let event_id = operation_event_id(None, OperationEventOrigin::Tray, "runtime-start");
            let result = (|| {
                let mut context = workspace_execution_context(
                    &state.config_state,
                    action.workspace_key.as_deref(),
                )?;
                let debug_profile = action
                    .payload
                    .as_ref()
                    .and_then(|payload| payload.get("debugProfile"))
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .filter(|value| !value.is_empty());
                let runtime_profile_key =
                    project_runtime_profile_key(&context.config, project_key, debug_profile)?;
                prepare_rdev_proxy_runtime_profile(
                    &mut context.config,
                    &state.proxy_runtime,
                    &context.proxy_path,
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
                    &context.config,
                    project_key,
                    debug_profile,
                    if explicit_env_overrides {
                        Some(&env_overrides)
                    } else {
                        None
                    },
                )
            })();
            match &result {
                Ok(snapshot) => record_lifecycle_operation_event(
                    &state.storage,
                    event_id,
                    OperationEventOrigin::Tray,
                    &workspace_key,
                    "runtime",
                    "start",
                    runtime_start_operation_state(&snapshot.status_key),
                    if snapshot.status_key == "running" {
                        "dev 服务已启动"
                    } else {
                        "启动 dev 服务"
                    },
                    &operation_summary(&snapshot.status_label, &snapshot.detail),
                    &snapshot.detail,
                    Some(&snapshot.key),
                    Some(&snapshot.name),
                    serde_json::to_value(snapshot).ok(),
                ),
                Err(error) => record_lifecycle_operation_event(
                    &state.storage,
                    event_id,
                    OperationEventOrigin::Tray,
                    &workspace_key,
                    "runtime",
                    "start",
                    OperationEventState::Failed,
                    "启动 dev 服务",
                    "dev 服务启动失败",
                    error,
                    Some(project_key),
                    None,
                    Some(json!({ "projectKey": project_key })),
                ),
            }
            result?;
        }
        "project.runtime.stop" => {
            let project_key = action
                .project_key
                .as_deref()
                .ok_or_else(|| "缺少项目 Key".to_string())?;
            let workspace_key = tray_action_workspace_key(action)?;
            let event_id = operation_event_id(None, OperationEventOrigin::Tray, "runtime-stop");
            let result = (|| {
                let context = workspace_execution_context(
                    &state.config_state,
                    action.workspace_key.as_deref(),
                )?;
                state.project_runtime.stop(&context.config, project_key)
            })();
            match &result {
                Ok(snapshot) => record_lifecycle_operation_event(
                    &state.storage,
                    event_id,
                    OperationEventOrigin::Tray,
                    &workspace_key,
                    "runtime",
                    "stop",
                    OperationEventState::Success,
                    "dev 服务已停止",
                    &operation_summary(&snapshot.status_label, &snapshot.detail),
                    &snapshot.detail,
                    Some(&snapshot.key),
                    Some(&snapshot.name),
                    serde_json::to_value(snapshot).ok(),
                ),
                Err(error) => record_lifecycle_operation_event(
                    &state.storage,
                    event_id,
                    OperationEventOrigin::Tray,
                    &workspace_key,
                    "runtime",
                    "stop",
                    OperationEventState::Failed,
                    "停止 dev 服务",
                    "dev 服务停止失败",
                    error,
                    Some(project_key),
                    None,
                    Some(json!({ "projectKey": project_key })),
                ),
            }
            result?;
        }
        "project.build.run" => {
            let project_key = action
                .project_key
                .as_deref()
                .ok_or_else(|| "缺少项目 Key".to_string())?;
            let context =
                workspace_execution_context(&state.config_state, action.workspace_key.as_deref())?;
            state
                .project_runtime
                .run_build(&context.config, project_key)?;
        }
        "project.build.openOutput" => {
            let project_key = action
                .project_key
                .as_deref()
                .ok_or_else(|| "缺少项目 Key".to_string())?;
            let context =
                workspace_execution_context(&state.config_state, action.workspace_key.as_deref())?;
            state
                .project_runtime
                .open_build_output(&context.config, project_key, None)?;
        }
        "project.runtime.focus" => {
            let project_key = action
                .project_key
                .as_deref()
                .ok_or_else(|| "缺少项目 Key".to_string())?;
            let mut context =
                workspace_execution_context(&state.config_state, action.workspace_key.as_deref())?;
            let debug_profile = action
                .payload
                .as_ref()
                .and_then(|payload| payload.get("debugProfile"))
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let runtime_profile_key =
                project_runtime_profile_key(&context.config, project_key, debug_profile)?;
            prepare_rdev_proxy_runtime_profile(
                &mut context.config,
                &state.proxy_runtime,
                &context.proxy_path,
                runtime_profile_key.as_deref(),
            )?;
            state
                .project_runtime
                .focus_runtime(&context.config, project_key, debug_profile)?;
        }
        "project.openDirectory" => {
            let project_key = action
                .project_key
                .as_deref()
                .ok_or_else(|| "缺少项目 Key".to_string())?;
            let context =
                workspace_execution_context(&state.config_state, action.workspace_key.as_deref())?;
            open_project_directory_action(&state.project_runtime, &context.config, project_key)?;
        }
        "finder.shortcut.open" => {
            let entry = action
                .entry
                .clone()
                .ok_or_else(|| "缺少快捷入口".to_string())?;
            let mut context =
                workspace_execution_context(&state.config_state, action.workspace_key.as_deref())?;
            prepare_rdev_proxy_runtime_profile(
                &mut context.config,
                &state.proxy_runtime,
                &context.proxy_path,
                entry.runtime_profile.as_deref(),
            )?;
            open_navigation_entry_with_runtime_profiles(
                &entry,
                &context.config.defaults.runtime_profiles,
            )
            .map_err(|error| error.to_string())?;
        }
        "proxy.start" | "proxy.stop" => {
            let profile_id = tray_payload_string(action, "profileId", "代理配置 Key")?;
            let event_source_id = tray_optional_payload_string(action, "sourceId");
            let workspace_key = tray_action_workspace_key(action)?;
            let action_key = if action.kind == "proxy.start" {
                "start"
            } else {
                "stop"
            };
            let event_id = operation_event_id(
                None,
                OperationEventOrigin::Tray,
                &format!("proxy-{action_key}"),
            );
            let result: Result<(String, String, bool, serde_json::Value), String> = (|| {
                let context = workspace_execution_context(
                    &state.config_state,
                    action.workspace_key.as_deref(),
                )?;
                let source_id = event_source_id
                    .clone()
                    .unwrap_or_else(|| context.proxy_source.id.clone());
                let source = core_resolve_config_source(Some(&source_id), &context.workspaces)
                    .map_err(|error| error.to_string())?;
                let proxy_path = proxy_path_for_config_source(&source)?;
                let config = load_proxy_config(&proxy_path).map_err(|error| error.to_string())?;
                let profile = config
                    .profiles
                    .iter()
                    .find(|profile| profile.id == profile_id)
                    .ok_or_else(|| format!("代理配置不存在：{profile_id}"))?;
                let profile_name = profile.name.clone();
                let listen_url = profile.listen_url();
                if action.kind == "proxy.start" {
                    validate_proxy_profile(profile).map_err(|error| error.to_string())?;
                    let status = state
                        .proxy_runtime
                        .start_profile(proxy_path.clone(), profile_id.clone())
                        .map_err(|error| error.to_string())?;
                    Ok((
                        profile_name,
                        listen_url,
                        status.running,
                        json!({
                            "profileId": profile_id.clone(),
                            "profileName": profile.name.clone(),
                            "sourceId": source_id.clone(),
                            "listenUrl": status.listen_url,
                            "running": status.running,
                            "configPath": proxy_path.display().to_string(),
                        }),
                    ))
                } else {
                    let status = state
                        .proxy_runtime
                        .stop_profile_result(&proxy_path, &profile_id)
                        .map_err(|error| error.to_string())?;
                    Ok((
                        profile_name,
                        listen_url,
                        status.running,
                        json!({
                            "profileId": profile_id.clone(),
                            "profileName": profile.name.clone(),
                            "sourceId": source_id.clone(),
                            "listenUrl": status.listen_url,
                            "running": status.running,
                            "configPath": proxy_path.display().to_string(),
                        }),
                    ))
                }
            })();
            match &result {
                Ok((profile_name, listen_url, running, payload)) => {
                    let expected_running = action_key == "start";
                    record_lifecycle_operation_event(
                        &state.storage,
                        event_id,
                        OperationEventOrigin::Tray,
                        &workspace_key,
                        "proxy",
                        action_key,
                        if *running == expected_running {
                            OperationEventState::Success
                        } else {
                            OperationEventState::Failed
                        },
                        if expected_running {
                            "代理服务已启动"
                        } else {
                            "代理服务已停止"
                        },
                        &format!(
                            "{} · {}",
                            profile_name,
                            if expected_running { "已启动" } else { "已停止" }
                        ),
                        &format!("监听地址：{listen_url}"),
                        None,
                        None,
                        Some(payload.clone()),
                    );
                }
                Err(error) => record_lifecycle_operation_event(
                    &state.storage,
                    event_id,
                    OperationEventOrigin::Tray,
                    &workspace_key,
                    "proxy",
                    action_key,
                    OperationEventState::Failed,
                    if action_key == "start" {
                        "启动代理服务"
                    } else {
                        "停止代理服务"
                    },
                    if action_key == "start" {
                        "代理服务启动失败"
                    } else {
                        "代理服务停止失败"
                    },
                    error,
                    None,
                    None,
                    Some(json!({
                        "profileId": profile_id.clone(),
                        "sourceId": event_source_id.clone(),
                    })),
                ),
            }
            result?;
        }
        "link.run" | "link.stop" => {
            let link_key = tray_payload_string(action, "linkKey", "Link Key")?;
            let source_id = tray_optional_payload_string(action, "sourceId");
            let event_source_id = source_id.clone();
            let proxy_source_id = tray_optional_payload_string(action, "proxySourceId");
            let workspace_key = tray_action_workspace_key(action)?;
            let action_key = if action.kind == "link.run" {
                "run"
            } else {
                "stop"
            };
            let event_id = operation_event_id(
                None,
                OperationEventOrigin::Tray,
                &format!("link-{action_key}"),
            );
            let result = execute_link_app(
                &state.config_state,
                &state.proxy_runtime,
                &state.project_runtime,
                LinkAppExecutionRequest {
                    link_source_id: source_id,
                    proxy_source_id,
                    workspace_key: action.workspace_key.clone(),
                    key: link_key.clone(),
                    mode: action_key.to_string(),
                },
            );
            record_link_operation_event(
                &state.storage,
                event_id,
                OperationEventOrigin::Tray,
                &workspace_key,
                action_key,
                &link_key,
                event_source_id.as_deref(),
                &result,
            );
            result?;
        }
        "build.replay" | "deploy.replay" => {
            let context =
                workspace_execution_context(&state.config_state, action.workspace_key.as_deref())?;
            execute_build_tray_replay(&state.project_runtime, &context.config, action)?;
        }
        "branch.replay" => {
            let context =
                workspace_execution_context(&state.config_state, action.workspace_key.as_deref())?;
            execute_branch_tray_replay(&context.config, action)?;
        }
        _ => return Err(format!("不支持回放的操作: {}", action.kind)),
    }
    if tray_action_is_repeatable(action) {
        record_tray_replay_action(app, action.clone())?;
    } else {
        refresh_tray_menu(app);
    }
    Ok(())
}

fn spawn_tray_replay<R: Runtime>(app: AppHandle<R>, action: TrayReplayAction) {
    if tray_action_uses_frontend_workflow(&action) {
        show_main_window(&app);
        if let Err(error) = app.emit(TRAY_DOMAIN_ACTION_REQUESTED_EVENT, action) {
            eprintln!("tray domain action dispatch failed: {}", error);
        }
        return;
    }

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

fn tray_workspace_action_by_id<R: Runtime>(
    app: &AppHandle<R>,
    action_id: &str,
) -> Option<TrayReplayAction> {
    app.try_state::<AppState>().and_then(|state| {
        state
            .tray_menu_actions
            .read()
            .ok()
            .and_then(|actions| actions.get(action_id).cloned())
    })
}

fn begin_app_exit<R: Runtime>(app: &AppHandle<R>, coordinator: &AppExitCoordinator) {
    coordinator.is_quitting.store(true, Ordering::Release);
    app.exit(0);
}

fn emit_app_exit_failure<R: Runtime>(
    app: &AppHandle<R>,
    coordinator: &AppExitCoordinator,
    message: String,
) {
    coordinator
        .request_in_progress
        .store(false, Ordering::Release);
    show_main_window(app);
    let _ = app.emit(APP_EXIT_FAILED_EVENT, AppExitFailedPayload { message });
}

fn request_app_exit<R: Runtime>(app: &AppHandle<R>) {
    let Some(state) = app.try_state::<AppState>() else {
        app.exit(0);
        return;
    };
    let coordinator = state.exit_coordinator.clone();
    if coordinator.is_quitting.load(Ordering::Acquire)
        || coordinator
            .request_in_progress
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
    {
        return;
    }

    let summary: AppStartedRuntimeSummary = state.project_runtime.app_started_runtime_summary();
    if summary.count == 0 {
        begin_app_exit(app, &coordinator);
        return;
    }

    match load_app_exit_runtime_policy(&state.storage) {
        AppExitRuntimePolicy::Keep => begin_app_exit(app, &coordinator),
        AppExitRuntimePolicy::Ask => {
            show_main_window(app);
            let _ = app.emit(
                APP_EXIT_REQUESTED_EVENT,
                AppExitRequestedPayload {
                    active_runtime_count: summary.count,
                    project_names: summary.project_names,
                },
            );
        }
        AppExitRuntimePolicy::Stop => {
            let runtime = state.project_runtime.clone();
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let report = runtime.shutdown_app_started_runtimes();
                if report.failures.is_empty() {
                    begin_app_exit(&app, &coordinator);
                } else {
                    emit_app_exit_failure(&app, &coordinator, report.failures.join("；"));
                }
            });
        }
    }
}

fn build_tray<R: tauri::Runtime>(
    app: &AppHandle<R>,
    exit_coordinator: AppExitCoordinator,
) -> tauri::Result<()> {
    let menu = create_tray_menu(app)?;

    let mut tray_builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("rDevTool")
        .show_menu_on_left_click(false)
        .on_menu_event({
            let exit_coordinator = exit_coordinator.clone();
            move |app, event| match event.id().as_ref() {
                TRAY_SHOW_ID => show_main_window(app),
                TRAY_MORE_WORKSPACES_ID => show_main_window(app),
                TRAY_REPLAY_LAST_ID => {
                    if let Some(action) = tray_action_by_index(app, 0) {
                        spawn_tray_replay(app.clone(), action);
                    }
                }
                TRAY_QUIT_ID => {
                    if !exit_coordinator.is_quitting.load(Ordering::Acquire) {
                        request_app_exit(app);
                    }
                }
                id if id.starts_with(TRAY_WORKSPACE_ACTION_PREFIX) => {
                    if let Some(action) = tray_workspace_action_by_id(app, id) {
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
    let exit_coordinator = AppExitCoordinator::default();
    let window_exit_coordinator = exit_coordinator.clone();
    let setup_exit_coordinator = exit_coordinator.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(&app);
        }))
        .on_window_event({
            move |window, event| {
                if window.label() != MAIN_WINDOW_LABEL {
                    return;
                }

                if let WindowEvent::CloseRequested { api, .. } = event {
                    if window_exit_coordinator.is_quitting.load(Ordering::Acquire) {
                        return;
                    }

                    api.prevent_close();
                    if should_use_tray() {
                        let _ = window.hide();
                    } else {
                        request_app_exit(window.app_handle());
                    }
                }
            }
        })
        .setup(move |app| {
            let storage = Storage::new_default().map_err(std::io::Error::other)?;
            let workspace_config_watcher_stop = Arc::new(AtomicBool::new(false));
            app.manage(AppState {
                storage,
                project_runtime: ProjectRuntimeState::default(),
                proxy_runtime: ProxyRuntimeState::default(),
                config_state: AppConfigState::default(),
                exit_coordinator: setup_exit_coordinator.clone(),
                tray_replay_running: Arc::new(AtomicBool::new(false)),
                tray_menu_actions: Arc::new(RwLock::new(BTreeMap::new())),
                workspace_config_watcher_stop: workspace_config_watcher_stop.clone(),
            });
            if let Err(error) =
                start_workspace_config_watcher(app.handle().clone(), workspace_config_watcher_stop)
            {
                eprintln!("[workspace-config-watcher] {error}");
            }
            if should_use_tray() {
                build_tray(app.handle(), setup_exit_coordinator.clone())
                    .map_err(std::io::Error::other)?;
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
            get_app_exit_runtime_policy,
            save_app_exit_runtime_policy,
            cancel_app_exit,
            confirm_app_exit,
            get_workspace_app_preferences,
            save_workspace_app_preferences,
            get_project_workspaces,
            set_active_project_workspace,
            create_project_workspace_config,
            delete_project_workspace_config,
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
            restore_runtime_profile_inheritance,
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
            plan_branch_sync_task,
            execute_branch_sync_task,
            execute_branch_create_task,
            checkout_branch_to_directory_task,
            create_project_workspace_project_copy,
            bind_project_workspace_project_directory,
            unbind_project_workspace_project_directory,
            execute_branch_switch_task,
            list_project_worktrees,
            repair_project_worktree,
            get_project_push_status,
            get_project_file_diff,
            execute_branch_push_task,
            open_local_path,
            open_external_resource,
            list_config_sources,
            compare_config_sources,
            copy_config_source,
            list_ui_profiles,
            inspect_config_source,
            save_config_source,
            delete_config_source,
            get_config_source_preference,
            save_config_source_preference,
            load_page_navigation,
            get_navigation_editor,
            save_navigation_editor,
            list_links,
            get_link,
            plan_link,
            save_link,
            delete_link,
            attach_link_to_workspace,
            check_link,
            run_link,
            stop_link,
            open_page_navigation_entry,
            commands::web_actions::list_web_actions,
            commands::web_actions::open_web_action_target,
            commands::web_actions::open_web_action_navigation_target,
            commands::web_actions::list_web_action_targets,
            commands::web_actions::list_web_action_navigation_targets,
            commands::web_actions::run_web_action,
            commands::web_actions::run_web_action_navigation,
            commands::web_actions::run_web_action_script,
            commands::web_actions::run_web_action_navigation_script,
            storage_get_json,
            storage_set_json,
            storage_prepend_json_array,
            storage_delete_json,
            get_tray_pinned_actions,
            get_workspace_pinned_actions_overview,
            get_workspace_ai_context,
            execute_tray_pinned_action,
            record_tray_pinned_action_execution,
            set_tray_pinned_actions,
            commands::history::list_build_history,
            commands::history::save_build_history,
            commands::history::clear_build_history,
            commands::history::list_deploy_history,
            commands::history::save_deploy_history,
            commands::history::clear_deploy_history,
            commands::history::list_merge_history,
            commands::history::list_operation_event_history,
            commands::history::save_merge_history,
            commands::history::clear_merge_history,
            commands::runtime::list_project_runtimes,
            list_managed_artifacts,
            commands::runtime::list_selected_project_runtimes,
            commands::runtime::preflight_project_runtime,
            commands::runtime::get_project_runtime_context,
            commands::runtime::inspect_project_runtime,
            start_project_runtime,
            stop_project_runtime,
            adopt_project_runtime,
            run_project_build,
            stop_project_build,
            open_project_build_output,
            open_project_directory,
            focus_project_runtime,
            commands::runtime::read_project_runtime_log,
            clear_project_runtime_log
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            RunEvent::ExitRequested { api, .. } => {
                if let Some(state) = app.try_state::<AppState>()
                    && !state.exit_coordinator.is_quitting.load(Ordering::Acquire)
                {
                    api.prevent_exit();
                    request_app_exit(app);
                }
            }
            RunEvent::Exit => {
                if let Some(state) = app.try_state::<AppState>() {
                    state
                        .workspace_config_watcher_stop
                        .store(true, Ordering::Relaxed);
                    state.project_runtime.shutdown_all();
                }
            }
            _ => {}
        });
}

#[cfg(test)]
mod workspace_config_watcher_tests {
    use super::*;

    fn workspace(key: &str, projects: &[&str]) -> ProjectWorkspaceConfig {
        ProjectWorkspaceConfig {
            key: key.to_string(),
            name: key.to_string(),
            projects: projects.iter().map(|project| project.to_string()).collect(),
            ..ProjectWorkspaceConfig::default()
        }
    }

    fn build_history_request(state_key: &str) -> SaveBuildHistoryRequest {
        SaveBuildHistoryRequest {
            history_key: "build-1".to_string(),
            workspace_key: Some("feature-a".to_string()),
            project_instance_path: None,
            project_key: "admin".to_string(),
            project_name: "管理端".to_string(),
            mode: "build".to_string(),
            env: Some("uat".to_string()),
            branch: Some("feature-a".to_string()),
            state_key: state_key.to_string(),
            state_label: state_key.to_string(),
            detail: "构建详情".to_string(),
            queue_url: None,
            build_url: Some("https://ci.example/build/1".to_string()),
            params: json!({}),
        }
    }

    #[test]
    fn build_execution_requires_the_recorded_workspace() {
        let active = workspace("release", &["demo"]);

        assert!(ensure_build_execution_workspace(&active, Some("release")).is_ok());
        assert!(ensure_build_execution_workspace(&active, None).is_ok());

        let error = ensure_build_execution_workspace(&active, Some("feature")).unwrap_err();
        assert!(error.contains("记录来自「feature」"));
        assert!(error.contains("当前工作区为「release」"));
    }

    #[test]
    fn history_save_keeps_the_recorded_workspace_after_an_active_switch() {
        assert_eq!(
            history_workspace_key_for_save(Some(" feature "), "release"),
            "feature"
        );
        assert_eq!(history_workspace_key_for_save(None, "release"), "release");
    }

    #[test]
    fn auto_worklog_only_records_terminal_build_states() {
        assert!(build_history_worklog_event(&build_history_request("running")).is_none());

        let event = build_history_worklog_event(&build_history_request("failure")).unwrap();
        assert!(!event.success);
        assert_eq!(event.event_id.as_deref(), Some("build:build-1:failure"));
        assert!(event.detail.unwrap().contains("构建详情"));
    }

    #[test]
    fn merge_worklog_keeps_failure_reason() {
        let event = merge_history_worklog_event(&SaveMergeHistoryRequest {
            history_key: "merge-1".to_string(),
            workspace_key: Some("feature-a".to_string()),
            project_instance_path: None,
            project_key: "admin".to_string(),
            project_name: "管理端".to_string(),
            source_branch: "feature-a".to_string(),
            target_branch: "master".to_string(),
            success: false,
            remote: true,
            summary: "合并失败".to_string(),
            detail: "存在冲突".to_string(),
            merged_commit: None,
            source_commit: None,
            target_commit: None,
        });

        assert!(!event.success);
        assert!(event.detail.unwrap().contains("存在冲突"));
    }

    fn build_pin(workspace_key: Option<&str>) -> TrayReplayAction {
        TrayReplayAction {
            kind: "build.replay".to_string(),
            label: "构建 demo".to_string(),
            detail: None,
            workspace_key: workspace_key.map(ToString::to_string),
            project_key: Some("demo".to_string()),
            entry: None,
            payload: None,
            dedupe_key: "build.replay:demo".to_string(),
            updated_at_ms: 1,
        }
    }

    fn test_navigation_entry(name: &str, kind: &str) -> NavigationEntry {
        NavigationEntry {
            name: name.to_string(),
            kind: kind.to_string(),
            target_label: format!("/{name}"),
            url: (kind == "url").then(|| format!("https://{name}.example.com")),
            browser: None,
            browser_profile: None,
            runtime_profile: None,
            bundle_id: None,
            app_name: None,
            script: None,
            tool: None,
            tool_key: None,
            tool_action: None,
            path: (kind == "directory").then(|| format!("/{name}")),
            cwd: None,
            note: None,
        }
    }

    fn test_resource(workspace_key: &str, name: &str) -> WorkspaceResourceShortcutItem {
        WorkspaceResourceShortcutItem {
            key: format!("{workspace_key}:{name}"),
            config_source_id: "default".to_string(),
            category: "常用".to_string(),
            label: name.to_string(),
            kind: "url".to_string(),
            kind_label: "网站".to_string(),
            value: Some(format!("https://{name}.example.com")),
            detail: None,
            tool: None,
            tool_key: None,
            tool_action: None,
            link_runtime: None,
            open_kind: Some("url".to_string()),
            openable: true,
            entry: test_navigation_entry(name, "url"),
            tool_config_source_id: None,
            tool_proxy_source_id: None,
        }
    }

    fn test_link_resource(workspace_key: &str, name: &str) -> WorkspaceResourceShortcutItem {
        let mut entry = test_navigation_entry(name, "tool");
        entry.tool = Some("link".to_string());
        entry.tool_key = Some(format!("{workspace_key}-link"));
        WorkspaceResourceShortcutItem {
            key: format!("{workspace_key}:{name}"),
            config_source_id: "workspace-test".to_string(),
            category: "工具".to_string(),
            label: name.to_string(),
            kind: "tool".to_string(),
            kind_label: "工具".to_string(),
            value: Some(format!("{workspace_key}-link")),
            detail: None,
            tool: Some("link".to_string()),
            tool_key: Some(format!("{workspace_key}-link")),
            tool_action: Some("run".to_string()),
            link_runtime: Some(LinkRuntimeSummary {
                status: "stopped".to_string(),
                label: "未启动".to_string(),
                running_steps: 0,
                controllable_steps: 2,
                blocked_steps: 0,
                can_run: true,
                can_stop: false,
            }),
            open_kind: Some("tool".to_string()),
            openable: false,
            entry,
            tool_config_source_id: Some("workspace-test".to_string()),
            tool_proxy_source_id: Some("default".to_string()),
        }
    }

    fn test_project(key: &str, name: &str) -> WorkspaceProjectDirectoryItem {
        WorkspaceProjectDirectoryItem {
            project_key: key.to_string(),
            project_name: name.to_string(),
            mode: "global".to_string(),
            mode_label: "全局目录".to_string(),
            path: Some(format!("/{key}")),
            managed: false,
            status_key: "stopped".to_string(),
            status_label: "未启动".to_string(),
            running: false,
            can_start: true,
            can_stop: false,
            can_focus_runtime: false,
            debug_profiles: Vec::new(),
        }
    }

    fn test_proxy(workspace_key: &str, id: &str) -> WorkspaceProxyProfileItem {
        WorkspaceProxyProfileItem {
            config_source_id: "default".to_string(),
            id: id.to_string(),
            name: format!("{id} 代理"),
            listen_host: "127.0.0.1".to_string(),
            listen_port: 8791,
            listen_url: "http://127.0.0.1:8791".to_string(),
            workspace_key: Some(workspace_key.to_string()),
            workspace_label: workspace_key.to_string(),
            rule_count: 2,
            running: false,
            started_at: None,
        }
    }

    fn test_overview(
        key: &str,
        active_content: bool,
        system: bool,
    ) -> WorkspacePinnedActionsOverview {
        WorkspacePinnedActionsOverview {
            key: key.to_string(),
            name: key.to_string(),
            description: None,
            system,
            root_dir: None,
            resource_dir: None,
            worklog_path: None,
            worklog_exists: false,
            worklog_auto_record: false,
            workspace_kind: if system { "global" } else { "scope" }.to_string(),
            workspace_type: if system { "system" } else { "custom" }.to_string(),
            workspace_type_label: if system { "全局" } else { "未分类" }.to_string(),
            project_count: usize::from(active_content),
            entry_count: usize::from(active_content),
            action_count: 0,
            proxy_profile_count: usize::from(active_content),
            resources: if active_content {
                vec![
                    test_resource(key, "需求入口"),
                    test_link_resource(key, "本地联调"),
                ]
            } else {
                Vec::new()
            },
            project_directories: if active_content {
                vec![test_project("demo", "演示项目")]
            } else {
                Vec::new()
            },
            proxy_profiles: if active_content {
                vec![test_proxy(key, "demo-proxy")]
            } else {
                Vec::new()
            },
            actions: Vec::new(),
        }
    }

    fn targets() -> WorkspaceConfigWatchTargets {
        WorkspaceConfigWatchTargets {
            projects: PathBuf::from("/config/projects.toml"),
            workspace: PathBuf::from("/config/workspace.toml"),
            project_workspaces: PathBuf::from("/config/workspaces"),
        }
    }

    fn config_source_targets() -> Vec<ConfigSourceWatchTarget> {
        vec![ConfigSourceWatchTarget {
            id: "team".to_string(),
            base_dir: PathBuf::from("/sources/team"),
            files: vec![
                PathBuf::from("/sources/team/navigation.toml"),
                PathBuf::from("/sources/team/links.toml"),
            ],
        }]
    }

    #[test]
    fn keeps_explicit_build_pin_in_its_workspace_when_projects_overlap() {
        let workspaces = vec![
            ProjectWorkspaceConfig::default(),
            workspace("feature", &["demo"]),
            workspace("release", &["demo"]),
        ];

        assert_eq!(
            workspace_key_for_pinned_action(&workspaces, &build_pin(Some("feature"))),
            "feature"
        );
    }

    #[test]
    fn keeps_legacy_build_pin_global_when_workspace_is_ambiguous() {
        let workspaces = vec![
            ProjectWorkspaceConfig::default(),
            workspace("feature", &["demo"]),
            workspace("release", &["demo"]),
        ];

        assert_eq!(
            workspace_key_for_pinned_action(&workspaces, &build_pin(None)),
            SYSTEM_PROJECT_WORKSPACE_KEY
        );
    }

    #[test]
    fn builds_workspace_first_three_level_tray_model() {
        let recent = TrayReplayAction {
            kind: "project.runtime.start".to_string(),
            label: "启动演示项目".to_string(),
            detail: None,
            workspace_key: Some("active".to_string()),
            project_key: Some("demo".to_string()),
            entry: None,
            payload: Some(json!({ "debugProfile": "dc2" })),
            dedupe_key: "project.runtime.start:active:demo:dc2".to_string(),
            updated_at_ms: 10,
        };
        let (menus, count) = tray_workspace_menus(
            vec![
                test_overview("system", false, true),
                test_overview("other", false, false),
                test_overview("active", true, false),
            ],
            "active",
            &[recent],
        );

        assert_eq!(count, 2);
        assert_eq!(menus.len(), 2);
        assert!(menus[0].active);
        assert!(menus[0].label.starts_with("● "));
        assert_eq!(
            menus[0]
                .categories
                .iter()
                .map(|category| category.label.as_str())
                .collect::<Vec<_>>(),
            vec!["入口", "项目", "代理", "本地联调"]
        );
        let project_actions = &menus[0].categories[1].actions;
        assert_eq!(project_actions[0].label, "启动 · 演示项目 · dc2");
        assert_eq!(
            project_actions[0].action.workspace_key.as_deref(),
            Some("active")
        );
        assert_eq!(menus[0].categories[2].actions[0].action.kind, "proxy.start");
        assert_eq!(menus[0].categories[3].actions[0].action.kind, "link.run");
    }

    #[test]
    fn limits_workspaces_and_long_category_lists() {
        let mut crowded = test_overview("active", false, false);
        crowded.resources = (0..12)
            .map(|index| test_resource("active", &format!("入口{index}")))
            .collect();
        let mut overview = vec![crowded];
        overview
            .extend((0..6).map(|index| test_overview(&format!("workspace-{index}"), false, false)));

        let (menus, count) = tray_workspace_menus(overview, "active", &[]);

        assert_eq!(count, 7);
        assert_eq!(menus.len(), TRAY_WORKSPACE_MENU_LIMIT);
        assert_eq!(
            menus[0].categories[0].actions.len(),
            TRAY_CATEGORY_ITEM_LIMIT
        );
        assert_eq!(
            menus[0].categories[0].actions.last().unwrap().label,
            "在 rDevTool 中查看全部…"
        );
    }

    #[test]
    fn keeps_tray_action_ids_stable_across_menu_refreshes() {
        let action = tray_workspace_open_action("active", "Active");
        let mut first_menu = BTreeMap::new();
        let first_id = register_tray_menu_action(&mut first_menu, action.clone());
        let duplicate_id = register_tray_menu_action(&mut first_menu, action.clone());
        let mut refreshed_menu = BTreeMap::new();
        let refreshed_id = register_tray_menu_action(&mut refreshed_menu, action);

        assert_eq!(first_id, refreshed_id);
        assert_ne!(first_id, duplicate_id);
    }

    #[test]
    fn build_and_branch_tray_actions_use_frontend_workflows() {
        let mut build = build_pin(Some("active"));
        build.kind = "build.replay".to_string();
        let mut branch = build.clone();
        branch.kind = "branch.replay".to_string();
        let mut runtime = build.clone();
        runtime.kind = "project.runtime.start".to_string();

        assert!(tray_action_uses_frontend_workflow(&build));
        assert!(tray_action_uses_frontend_workflow(&branch));
        assert!(!tray_action_uses_frontend_workflow(&runtime));
    }

    #[test]
    fn classifies_workspace_configuration_paths() {
        let paths = vec![
            PathBuf::from("/config/workspace.toml"),
            PathBuf::from("/config/projects.toml"),
            PathBuf::from("/config/workspaces/team.toml"),
        ];

        assert_eq!(
            workspace_config_event_impact(&paths, &targets()),
            WorkspaceConfigEventImpact {
                scopes: BTreeSet::from(["projectWorkspaces", "projects", "workspace"]),
                project_workspace_keys: BTreeSet::from(["team".to_string()]),
                project_workspaces_unknown: false,
            },
        );
    }

    #[test]
    fn recognizes_atomic_write_temporary_files() {
        let paths = vec![
            PathBuf::from("/config/.workspace.toml.123.456.0.tmp"),
            PathBuf::from("/config/.projects.toml.123.456.0.tmp"),
        ];

        assert_eq!(
            workspace_config_event_impact(&paths, &targets()),
            WorkspaceConfigEventImpact {
                scopes: BTreeSet::from(["projects", "workspace"]),
                ..WorkspaceConfigEventImpact::default()
            },
        );
    }

    #[test]
    fn extracts_project_workspace_keys_from_atomic_writes() {
        let paths = vec![
            PathBuf::from("/config/workspaces/.team.toml.123.456.0.tmp"),
            PathBuf::from("/config/workspaces/other.toml"),
            PathBuf::from("/config/workspaces/other.toml.bak"),
        ];

        assert_eq!(
            workspace_config_event_impact(&paths, &targets()),
            WorkspaceConfigEventImpact {
                scopes: BTreeSet::from(["projectWorkspaces"]),
                project_workspace_keys: BTreeSet::from(["other".to_string(), "team".to_string(),]),
                project_workspaces_unknown: false,
            },
        );
    }

    #[test]
    fn marks_directory_level_workspace_events_as_unknown() {
        let paths = vec![PathBuf::from("/config/workspaces")];

        assert!(workspace_config_event_impact(&paths, &targets()).project_workspaces_unknown);
    }

    #[test]
    fn ignores_unrelated_configuration_files() {
        let paths = vec![
            PathBuf::from("/config/proxy.toml"),
            PathBuf::from("/config/projects.toml.bak"),
        ];

        assert!(
            workspace_config_event_impact(&paths, &targets())
                .scopes
                .is_empty()
        );
    }

    #[test]
    fn classifies_config_source_registry_and_content_changes() {
        let paths = vec![
            PathBuf::from("/config/config_sources.toml"),
            PathBuf::from("/sources/team/.navigation.toml.123.456.0.tmp"),
        ];

        assert_eq!(
            config_source_event_impact(
                &paths,
                Path::new("/config/config_sources.toml"),
                &config_source_targets(),
            ),
            ConfigSourceEventImpact {
                source_ids: BTreeSet::from(["team".to_string()]),
                catalog_changed: true,
            },
        );
    }

    #[test]
    fn ignores_config_source_backups_and_unmapped_files() {
        let paths = vec![
            PathBuf::from("/sources/team/navigation.toml.bak"),
            PathBuf::from("/sources/team/notes.txt"),
        ];

        assert_eq!(
            config_source_event_impact(
                &paths,
                Path::new("/config/config_sources.toml"),
                &config_source_targets(),
            ),
            ConfigSourceEventImpact::default(),
        );
    }

    #[test]
    fn marks_recent_app_writes_as_internal() {
        let root = std::env::temp_dir().join(format!(
            "rdevtool-origin-{}",
            SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let workspace_targets = WorkspaceConfigWatchTargets {
            projects: root.join("projects.toml"),
            workspace: root.join("workspace.toml"),
            project_workspaces: root.join("workspaces"),
        };
        rdevtool_core::config_store::register_internal_config_write(&workspace_targets.workspace);

        assert_eq!(
            config_event_origin(
                &[root.join(".workspace.toml.123.456.0.tmp")],
                &workspace_targets,
                &root.join("config_sources.toml"),
                &[],
            ),
            "internal",
        );
    }

    #[test]
    fn keeps_mixed_app_and_external_writes_external() {
        let root = std::env::temp_dir().join(format!(
            "rdevtool-origin-mixed-{}",
            SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let workspace_targets = WorkspaceConfigWatchTargets {
            projects: root.join("projects.toml"),
            workspace: root.join("workspace.toml"),
            project_workspaces: root.join("workspaces"),
        };
        rdevtool_core::config_store::register_internal_config_write(&workspace_targets.workspace);

        assert_eq!(
            config_event_origin(
                &[
                    workspace_targets.workspace.clone(),
                    workspace_targets.projects.clone(),
                ],
                &workspace_targets,
                &root.join("config_sources.toml"),
                &[],
            ),
            "external",
        );
    }
}
