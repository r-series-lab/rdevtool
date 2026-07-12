mod desktop;
mod tui;

use anyhow::Result;
use clap::{Parser, Subcommand, ValueEnum, error::ErrorKind};
use rdevtool_core::agent::{AgentCapabilities, AgentContext, capabilities, context_for_workspace};
use rdevtool_core::config::{
    AppConfig, BranchRules, BuildActionKind, BuildTargetAdapter, CreateProjectWorkspaceRequest,
    DeployParamConfig, DeployParamKind, DeployTargetConfig, JobConfig, Jobs, ProjectConfig,
    ProjectFocusConfig, ProjectWorkspaceConfig, ProjectWorkspaceProjectInstanceConfig,
    ProjectWorkspaceResourceCategoryConfig, ProjectWorkspaceResourceEntryConfig,
    SYSTEM_PROJECT_WORKSPACE_KEY, active_project_workspace_key, apply_project_workspace_context,
    create_project_workspace, default_config_dir, default_project_workspace_root_dir,
    default_project_workspaces_dir, default_projects_path, default_workspace_path,
    ensure_default_configs, load_active_project_workspace, load_config,
    load_project_workspace_by_key, load_project_workspaces, load_workspace_config,
    resolve_config_path, save_config, save_project_workspace_config, save_workspace_config,
};
use rdevtool_core::core::{
    self, BranchCheckoutRequest, BranchCommitOverview, BranchCreateRequest, BranchPushRequest,
    BranchPushStatus, BranchSwitchRequest, BranchSyncRequest, BranchTaskResponse,
    BuildStatusResponse, DeployRequest, DeployTargetMeta, MergeRequest, MergeResponse,
    StatusRequest, branch_push_status, checkout_branch_to_directory, execute_branch_create,
    execute_branch_push, execute_branch_switch, execute_branch_sync, parse_extra_params_args,
};
use rdevtool_core::navigation::{
    NavigationEditorCategory, NavigationEditorEntry, NavigationIndexEntry,
    find_navigation_entry_for_workspace, list_navigation_entries_for_workspace,
    load_navigation_editor_data, navigation_file_path, open_navigation_entry,
    save_navigation_editor_data, search_navigation_entries_for_workspace,
    validate_workspace_resource_entry,
};
use rdevtool_core::proxy::{
    ProxyConfig, ProxyOutboundMode, ProxyProfile, ProxyProfilePack, ProxyRequestDiagnosis,
    ProxyRule, ProxyRuleAction, default_proxy_path,
    delete_proxy_profile as core_delete_proxy_profile, delete_proxy_rule as core_delete_proxy_rule,
    diagnose_proxy_request, ensure_proxy_config, export_proxy_profile_pack,
    import_proxy_profile_pack, load_proxy_config, save_proxy_config, upsert_proxy_profile,
    upsert_proxy_rule, validate_proxy_profile, validate_proxy_rule,
};
use rdevtool_core::replay::{
    ReplayAction, build_replay_action, merge_replay_action, replay_kind_and_history_key,
};
use rdevtool_core::runtime::{
    ProjectRuntimeFocusResponse, ProjectRuntimeInspectResponse, ProjectRuntimeLogKind,
    ProjectRuntimeLogResponse, ProjectRuntimePreflightResponse, ProjectRuntimeStartResponse,
    RuntimeProfileSummary, RuntimeProfilesResponse, clear_project_runtime_log,
    focus_project_runtime, inspect_project_runtime, project_runtime_preflight,
    read_project_runtime_log, runtime_profile_show, runtime_profiles,
    start_project_runtime_detached,
};
use rdevtool_core::runtime_link::{BindProxyRuntimeRequest, bind_proxy_runtime_profile};
use rdevtool_core::storage::{
    self, DeployHistoryEntry, MergeHistoryEntry, SaveNoteRequest, Storage,
};
use rdevtool_core::web_actions::{
    WebActionListResponse, WebActionRunRequest, WebActionRunResult, WebActionScriptRunRequest,
    WebActionTarget, default_web_actions_path, list_web_action_targets, list_web_actions,
    open_web_action_target, run_web_action, run_web_action_script,
};
use rdevtool_core::workspace_init::{
    InitDemandWorkspaceBranch, InitDemandWorkspaceProject, InitDemandWorkspaceRequest,
    InitDemandWorkspaceRequirementEntry, InitDemandWorkspaceResult, init_demand_workspace,
};
use serde::Serialize;
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{self, Read};
use std::net::TcpListener;
use std::path::{Path, PathBuf};

#[derive(Parser)]
#[command(name = "rdevtool")]
#[command(bin_name = "rdevtool")]
#[command(about = "A lightweight frontend workspace helper.")]
struct Cli {
    #[arg(long)]
    config: Option<PathBuf>,
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Desktop,
    Info,
    Capabilities,
    Doctor,
    Context {
        #[arg(long)]
        project: Option<String>,
        #[arg(long)]
        query: Option<String>,
        #[arg(long, default_value_t = 6)]
        limit: usize,
    },
    App {
        #[command(subcommand)]
        command: AppCommands,
    },
    Workspace {
        #[command(subcommand)]
        command: WorkspaceCommands,
    },
    Projects {
        #[command(subcommand)]
        command: ProjectCommands,
    },
    List,
    Tui,
    Show {
        project: String,
    },
    Branch {
        project: String,
    },
    Branches {
        project: String,
    },
    Envs {
        project: String,
        #[arg(long)]
        target: Option<String>,
    },
    Options {
        project: String,
        #[arg(long)]
        target: Option<String>,
    },
    Plan {
        project: String,
        #[arg(long)]
        target: Option<String>,
        #[arg(long)]
        env: Option<String>,
        #[arg(long)]
        branch: Option<String>,
        #[arg(long = "set")]
        extra_params: Vec<String>,
    },
    Trigger {
        project: String,
        #[arg(long)]
        target: Option<String>,
        #[arg(long)]
        env: Option<String>,
        #[arg(long)]
        branch: Option<String>,
        #[arg(long = "set")]
        extra_params: Vec<String>,
    },
    Status {
        #[arg(long)]
        queue_url: Option<String>,
        #[arg(long)]
        build_url: Option<String>,
    },
    Deploy {
        #[command(subcommand)]
        command: DeployCommands,
    },
    Build {
        #[command(subcommand)]
        command: BuildCommands,
    },
    Git {
        #[command(subcommand)]
        command: GitCommands,
    },
    MigrateConfig {
        #[arg(long)]
        input: Option<PathBuf>,
        #[arg(long)]
        output: Option<PathBuf>,
    },
    MergeOverview {
        project: String,
        #[arg(long)]
        source: String,
        #[arg(long)]
        target: String,
    },
    Merge {
        project: String,
        #[arg(long)]
        source: String,
        #[arg(long)]
        target: String,
    },
    SyncBranches {
        #[arg(long)]
        project: String,
        #[arg(long = "source")]
        source_branch: String,
        #[arg(long = "target")]
        target_branches: Vec<String>,
    },
    CreateBranch {
        #[arg(long = "project")]
        projects: Vec<String>,
        #[arg(long = "source")]
        source_branch: String,
        #[arg(long = "target")]
        target_branch: String,
    },
    CheckoutBranch {
        #[arg(long)]
        project: String,
        #[arg(long = "source")]
        source_branch: String,
        #[arg(long)]
        destination: PathBuf,
    },
    SwitchBranch {
        #[arg(long)]
        project: String,
        #[arg(long = "target")]
        target_branch: String,
    },
    PushStatus {
        #[arg(long)]
        project: String,
    },
    PushBranch {
        #[arg(long)]
        project: String,
        #[arg(long)]
        message: Option<String>,
    },
    Navigation {
        #[command(subcommand)]
        command: NavigationCommands,
    },
    Proxy {
        #[command(subcommand)]
        command: ProxyCommands,
    },
    Runtime {
        #[command(subcommand)]
        command: RuntimeCommands,
    },
    WebActions {
        #[command(subcommand)]
        command: WebActionCommands,
    },
    Notes {
        #[command(subcommand)]
        command: NoteCommands,
    },
    History {
        #[command(subcommand)]
        command: HistoryCommands,
    },
    Agent {
        #[command(subcommand)]
        command: AgentCommands,
    },
}

#[derive(Subcommand)]
enum AppCommands {
    Preferences,
    SetPreferences {
        #[arg(long)]
        style_mode: Option<String>,
        #[arg(long)]
        default_page: Option<String>,
        #[arg(long = "enabled-page")]
        enabled_pages: Vec<String>,
        #[arg(long)]
        clear_enabled_pages: bool,
    },
}

#[derive(Subcommand)]
enum WorkspaceCommands {
    List,
    Show {
        workspace: Option<String>,
    },
    Create {
        key: String,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        description: Option<String>,
        #[arg(long)]
        root_dir: Option<PathBuf>,
        #[arg(long)]
        independent_dir: bool,
        #[arg(long)]
        empty: bool,
        #[arg(long)]
        no_switch: bool,
    },
    InitDemand {
        #[arg(long)]
        name: String,
        #[arg(long)]
        key: Option<String>,
        #[arg(long)]
        demand_id: Option<String>,
        #[arg(long)]
        description: Option<String>,
        #[arg(long)]
        workspace_type: Option<String>,
        #[arg(long)]
        requirement_dir: PathBuf,
        #[arg(long)]
        repo_path: PathBuf,
        #[arg(long)]
        project: Option<String>,
        #[arg(long)]
        branch: Option<String>,
        #[arg(long)]
        root_dir: Option<PathBuf>,
        #[arg(long, default_value = "需求资料")]
        requirement_category: String,
        #[arg(long, default_value = "需求")]
        requirement_short_label: String,
        #[arg(long, default_value = "需求目录")]
        requirement_entry_name: String,
        #[arg(long)]
        no_switch: bool,
    },
    Use {
        workspace: String,
    },
    Scope {
        workspace: Option<String>,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        description: Option<String>,
        #[arg(long)]
        clear_description: bool,
        #[arg(long)]
        all_projects: bool,
        #[arg(long)]
        clear_projects: bool,
        #[arg(long = "project")]
        projects: Vec<String>,
        #[arg(long)]
        all_navigation: bool,
        #[arg(long)]
        clear_navigation: bool,
        #[arg(long = "navigation-category")]
        navigation_categories: Vec<String>,
        #[arg(long = "navigation-entry")]
        navigation_entries: Vec<String>,
        #[arg(long = "proxy-profile")]
        proxy_profiles: Vec<String>,
        #[arg(long)]
        clear_proxy_profiles: bool,
        #[arg(long)]
        root_dir: Option<PathBuf>,
        #[arg(long)]
        clear_root_dir: bool,
        #[arg(long = "project-instance")]
        project_instances: Vec<String>,
        #[arg(long)]
        clear_project_instances: bool,
    },
}

#[derive(Subcommand)]
enum ProjectCommands {
    List,
    Add {
        #[arg(long)]
        key: String,
        #[arg(long)]
        name: String,
        #[arg(long)]
        category: Option<String>,
        #[arg(long)]
        repo_path: Option<PathBuf>,
        #[arg(long)]
        git_url: Option<String>,
    },
    Update {
        project: String,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        category: Option<String>,
        #[arg(long)]
        repo_path: Option<PathBuf>,
        #[arg(long)]
        clear_repo_path: bool,
        #[arg(long)]
        git_url: Option<String>,
    },
    Delete {
        project: String,
    },
    SetCommand {
        project: String,
        #[arg(long, value_enum)]
        kind: ProjectCommandKind,
        #[arg(long)]
        command: Option<String>,
        #[arg(long)]
        cwd: Option<PathBuf>,
        #[arg(long)]
        output_dir: Option<PathBuf>,
        #[arg(long = "env")]
        env: Vec<String>,
        #[arg(long)]
        clear_env: bool,
        #[arg(long)]
        clear: bool,
    },
    #[command(visible_alias = "build-target-add")]
    TargetAdd {
        project: String,
        #[arg(long)]
        key: String,
        #[arg(long)]
        label: String,
        #[arg(long, value_enum)]
        adapter: Option<BuildAdapterArg>,
        #[arg(long, value_enum)]
        action_kind: Option<BuildActionKindArg>,
        #[arg(long)]
        profile: Option<String>,
        #[arg(long)]
        job: Option<String>,
    },
    #[command(visible_alias = "build-target-update")]
    TargetUpdate {
        project: String,
        target: String,
        #[arg(long)]
        label: Option<String>,
        #[arg(long, value_enum)]
        adapter: Option<BuildAdapterArg>,
        #[arg(long, value_enum)]
        action_kind: Option<BuildActionKindArg>,
        #[arg(long)]
        profile: Option<String>,
        #[arg(long)]
        job: Option<String>,
    },
    #[command(visible_alias = "build-target-delete")]
    TargetDelete {
        project: String,
        target: String,
    },
    #[command(visible_alias = "build-param-add")]
    TargetParamAdd {
        project: String,
        target: String,
        #[arg(long)]
        key: String,
        #[arg(long)]
        label: String,
        #[arg(long, value_enum)]
        kind: DeployParamKindArg,
        #[arg(long)]
        default: Option<String>,
        #[arg(long = "option")]
        options: Vec<String>,
        #[arg(long)]
        required: bool,
        #[arg(long)]
        true_value: Option<String>,
        #[arg(long)]
        false_value: Option<String>,
    },
    #[command(visible_alias = "build-param-update")]
    TargetParamUpdate {
        project: String,
        target: String,
        param: String,
        #[arg(long)]
        label: Option<String>,
        #[arg(long, value_enum)]
        kind: Option<DeployParamKindArg>,
        #[arg(long)]
        default: Option<String>,
        #[arg(long)]
        clear_default: bool,
        #[arg(long = "option")]
        options: Vec<String>,
        #[arg(long)]
        clear_options: bool,
        #[arg(long)]
        required: bool,
        #[arg(long)]
        optional: bool,
        #[arg(long)]
        true_value: Option<String>,
        #[arg(long)]
        clear_true_value: bool,
        #[arg(long)]
        false_value: Option<String>,
        #[arg(long)]
        clear_false_value: bool,
    },
    #[command(visible_alias = "build-param-delete")]
    TargetParamDelete {
        project: String,
        target: String,
        param: String,
    },
    Show {
        project: String,
    },
    Branch {
        project: String,
    },
    Branches {
        project: String,
    },
    Envs {
        project: String,
        #[arg(long)]
        target: Option<String>,
    },
    Options {
        project: String,
        #[arg(long)]
        target: Option<String>,
    },
}

impl ProjectCommands {
    fn writes_config(&self) -> bool {
        matches!(
            self,
            ProjectCommands::Add { .. }
                | ProjectCommands::Update { .. }
                | ProjectCommands::Delete { .. }
                | ProjectCommands::SetCommand { .. }
                | ProjectCommands::TargetAdd { .. }
                | ProjectCommands::TargetUpdate { .. }
                | ProjectCommands::TargetDelete { .. }
                | ProjectCommands::TargetParamAdd { .. }
                | ProjectCommands::TargetParamUpdate { .. }
                | ProjectCommands::TargetParamDelete { .. }
        )
    }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum ProjectCommandKind {
    Dev,
    Build,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum DeployParamKindArg {
    Select,
    Boolean,
    Branch,
    Text,
    Hidden,
}

impl From<DeployParamKindArg> for DeployParamKind {
    fn from(value: DeployParamKindArg) -> Self {
        match value {
            DeployParamKindArg::Select => DeployParamKind::Select,
            DeployParamKindArg::Boolean => DeployParamKind::Boolean,
            DeployParamKindArg::Branch => DeployParamKind::Branch,
            DeployParamKindArg::Text => DeployParamKind::Text,
            DeployParamKindArg::Hidden => DeployParamKind::Hidden,
        }
    }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum BuildAdapterArg {
    #[value(name = "jenkins")]
    Jenkins,
    #[value(name = "local_command", alias = "local-command")]
    LocalCommand,
    #[value(name = "r_series_package", alias = "r-series-package")]
    RSeriesPackage,
}

impl From<BuildAdapterArg> for BuildTargetAdapter {
    fn from(value: BuildAdapterArg) -> Self {
        match value {
            BuildAdapterArg::Jenkins => BuildTargetAdapter::Jenkins,
            BuildAdapterArg::LocalCommand => BuildTargetAdapter::LocalCommand,
            BuildAdapterArg::RSeriesPackage => BuildTargetAdapter::RSeriesPackage,
        }
    }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum BuildActionKindArg {
    Build,
    Deploy,
    Package,
    Release,
}

impl From<BuildActionKindArg> for BuildActionKind {
    fn from(value: BuildActionKindArg) -> Self {
        match value {
            BuildActionKindArg::Build => BuildActionKind::Build,
            BuildActionKindArg::Deploy => BuildActionKind::Deploy,
            BuildActionKindArg::Package => BuildActionKind::Package,
            BuildActionKindArg::Release => BuildActionKind::Release,
        }
    }
}

fn default_action_kind_for_adapter(adapter: &BuildTargetAdapter) -> BuildActionKind {
    match adapter {
        BuildTargetAdapter::Jenkins => BuildActionKind::Deploy,
        BuildTargetAdapter::LocalCommand => BuildActionKind::Build,
        BuildTargetAdapter::RSeriesPackage => BuildActionKind::Package,
    }
}

#[derive(Subcommand)]
enum DeployCommands {
    Targets {
        project: String,
        #[arg(long)]
        target: Option<String>,
    },
    Plan {
        project: String,
        #[arg(long)]
        target: Option<String>,
        #[arg(long)]
        env: Option<String>,
        #[arg(long)]
        branch: Option<String>,
        #[arg(long = "set")]
        extra_params: Vec<String>,
    },
    Trigger {
        project: String,
        #[arg(long)]
        target: Option<String>,
        #[arg(long)]
        env: Option<String>,
        #[arg(long)]
        branch: Option<String>,
        #[arg(long = "set")]
        extra_params: Vec<String>,
    },
    Status {
        #[arg(long)]
        queue_url: Option<String>,
        #[arg(long)]
        build_url: Option<String>,
    },
    History {
        #[arg(long)]
        project: Option<String>,
        #[arg(long, default_value_t = 20)]
        limit: usize,
    },
}

#[derive(Subcommand)]
enum BuildCommands {
    Targets {
        project: String,
        #[arg(long)]
        target: Option<String>,
    },
    Plan {
        project: String,
        #[arg(long)]
        target: Option<String>,
        #[arg(long)]
        env: Option<String>,
        #[arg(long)]
        branch: Option<String>,
        #[arg(long = "set")]
        extra_params: Vec<String>,
    },
    Run {
        project: String,
        #[arg(long)]
        target: Option<String>,
        #[arg(long)]
        env: Option<String>,
        #[arg(long)]
        branch: Option<String>,
        #[arg(long = "set")]
        extra_params: Vec<String>,
    },
    Trigger {
        project: String,
        #[arg(long)]
        target: Option<String>,
        #[arg(long)]
        env: Option<String>,
        #[arg(long)]
        branch: Option<String>,
        #[arg(long = "set")]
        extra_params: Vec<String>,
    },
    Status {
        #[arg(long)]
        queue_url: Option<String>,
        #[arg(long)]
        build_url: Option<String>,
    },
    History {
        #[arg(long)]
        project: Option<String>,
        #[arg(long, default_value_t = 20)]
        limit: usize,
    },
}

#[derive(Subcommand)]
enum GitCommands {
    Current {
        project: String,
    },
    Branches {
        project: String,
    },
    Overview {
        #[arg(long)]
        project: String,
        #[arg(long)]
        source: String,
        #[arg(long)]
        target: String,
    },
    Merge {
        #[arg(long)]
        project: String,
        #[arg(long)]
        source: String,
        #[arg(long)]
        target: String,
    },
    MergeMany {
        #[arg(long)]
        project: String,
        #[arg(long = "source")]
        source_branch: String,
        #[arg(long = "target")]
        target_branches: Vec<String>,
    },
    Create {
        #[arg(long = "project")]
        projects: Vec<String>,
        #[arg(long = "source")]
        source_branch: String,
        #[arg(long = "target")]
        target_branch: String,
    },
    #[command(name = "clone")]
    CloneBranch {
        #[arg(long)]
        project: String,
        #[arg(long = "source")]
        source_branch: String,
        #[arg(long)]
        destination: PathBuf,
    },
    Switch {
        #[arg(long)]
        project: String,
        #[arg(long = "target")]
        target_branch: String,
    },
    PushStatus {
        #[arg(long)]
        project: String,
    },
    Push {
        #[arg(long)]
        project: String,
        #[arg(long)]
        message: Option<String>,
    },
    History {
        #[arg(long)]
        project: Option<String>,
        #[arg(long, default_value_t = 20)]
        limit: usize,
    },
}

#[derive(Subcommand)]
enum NoteCommands {
    List {
        #[arg(long, default_value_t = 24)]
        limit: usize,
    },
    Search {
        query: String,
        #[arg(long, default_value_t = 24)]
        limit: usize,
    },
    Get {
        id: String,
    },
    Create {
        #[arg(long)]
        title: Option<String>,
    },
    Save {
        id: String,
        #[arg(long)]
        title: String,
        #[arg(long)]
        content: Option<String>,
        #[arg(long)]
        file: Option<PathBuf>,
        #[arg(long)]
        stdin: bool,
        #[arg(long, value_delimiter = ',')]
        tags: Vec<String>,
        #[arg(long)]
        pinned: bool,
    },
    Delete {
        id: String,
    },
}

#[derive(Subcommand)]
enum HistoryCommands {
    Build {
        #[arg(long)]
        project: Option<String>,
        #[arg(long, default_value_t = 12)]
        limit: usize,
    },
    Deploy {
        #[arg(long)]
        project: Option<String>,
        #[arg(long, default_value_t = 12)]
        limit: usize,
    },
    Merge {
        #[arg(long)]
        project: Option<String>,
        #[arg(long, default_value_t = 12)]
        limit: usize,
    },
    ReplayPlan {
        id: String,
    },
    ReplayRun {
        id: String,
    },
}

#[derive(Subcommand)]
enum NavigationCommands {
    Path,
    List {
        #[arg(long, default_value_t = 24)]
        limit: usize,
    },
    Search {
        query: String,
        #[arg(long, default_value_t = 24)]
        limit: usize,
    },
    Open {
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        category: Option<String>,
        #[arg(long)]
        query: Option<String>,
    },
    Add {
        #[arg(long)]
        category: String,
        #[arg(long)]
        name: String,
        #[arg(long)]
        kind: String,
        #[arg(long)]
        url: Option<String>,
        #[arg(long)]
        path: Option<String>,
        #[arg(long)]
        bundle_id: Option<String>,
        #[arg(long)]
        app_name: Option<String>,
        #[arg(long)]
        script: Option<String>,
        #[arg(long)]
        cwd: Option<String>,
        #[arg(long)]
        browser: Option<String>,
        #[arg(long)]
        browser_profile: Option<String>,
        #[arg(long)]
        runtime_profile: Option<String>,
        #[arg(long)]
        note: Option<String>,
        #[arg(long)]
        short_label: Option<String>,
        #[arg(long)]
        workspace: Option<String>,
    },
    Update {
        #[arg(long)]
        category: String,
        #[arg(long)]
        name: String,
        #[arg(long)]
        new_name: Option<String>,
        #[arg(long)]
        kind: Option<String>,
        #[arg(long)]
        url: Option<String>,
        #[arg(long)]
        path: Option<String>,
        #[arg(long)]
        bundle_id: Option<String>,
        #[arg(long)]
        app_name: Option<String>,
        #[arg(long)]
        script: Option<String>,
        #[arg(long)]
        cwd: Option<String>,
        #[arg(long)]
        browser: Option<String>,
        #[arg(long)]
        browser_profile: Option<String>,
        #[arg(long)]
        runtime_profile: Option<String>,
        #[arg(long)]
        note: Option<String>,
        #[arg(long)]
        workspace: Option<String>,
    },
    Delete {
        #[arg(long)]
        category: String,
        #[arg(long)]
        name: String,
        #[arg(long)]
        workspace: Option<String>,
    },
}

#[derive(Subcommand)]
enum ProxyCommands {
    Path,
    List,
    Show {
        profile: String,
    },
    Add {
        #[arg(long)]
        id: Option<String>,
        #[arg(long)]
        name: String,
        #[arg(long, default_value = "127.0.0.1")]
        listen_host: String,
        #[arg(long)]
        listen_port: u16,
        #[arg(long)]
        upstream_base_url: Option<String>,
        #[arg(long)]
        upstream_proxy: Option<String>,
        #[arg(long)]
        workspace: Option<String>,
        #[arg(long)]
        global: bool,
    },
    Update {
        profile: String,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        listen_host: Option<String>,
        #[arg(long)]
        listen_port: Option<u16>,
        #[arg(long)]
        upstream_base_url: Option<String>,
        #[arg(long)]
        upstream_proxy: Option<String>,
        #[arg(long)]
        workspace: Option<String>,
        #[arg(long)]
        clear_workspace: bool,
    },
    Delete {
        profile: String,
    },
    Export {
        profile: String,
        #[arg(long)]
        output: Option<PathBuf>,
    },
    Import {
        #[arg(long)]
        file: PathBuf,
        #[arg(long)]
        workspace: Option<String>,
        #[arg(long)]
        global: bool,
    },
    RuleList {
        #[arg(long)]
        profile: Option<String>,
    },
    RuleShow {
        rule: String,
    },
    RuleAdd {
        #[arg(long)]
        profile: String,
        #[arg(long)]
        id: Option<String>,
        #[arg(long)]
        name: String,
        #[arg(long, default_value_t = 0)]
        priority: i32,
        #[arg(long)]
        disabled: bool,
        #[arg(long)]
        method: Option<String>,
        #[arg(long)]
        url_contains: Option<String>,
        #[arg(long)]
        path_prefix: Option<String>,
        #[arg(long)]
        header_name: Option<String>,
        #[arg(long)]
        header_contains: Option<String>,
        #[arg(long, default_value = "forward")]
        action: String,
        #[arg(long)]
        target_base_url: Option<String>,
        #[arg(long)]
        rewrite_prefix: Option<String>,
        #[arg(long = "request-header")]
        request_headers: Vec<String>,
        #[arg(long = "response-header")]
        response_headers: Vec<String>,
        #[arg(long)]
        outbound_mode: Option<String>,
        #[arg(long)]
        outbound_proxy: Option<String>,
        #[arg(long)]
        status: Option<u16>,
        #[arg(long)]
        content_type: Option<String>,
        #[arg(long)]
        body: Option<String>,
        #[arg(long = "header")]
        headers: Vec<String>,
        #[arg(long)]
        delay_ms: Option<u64>,
    },
    RuleUpdate {
        rule: String,
        #[arg(long)]
        profile: Option<String>,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        priority: Option<i32>,
        #[arg(long)]
        enable: bool,
        #[arg(long)]
        disable: bool,
        #[arg(long)]
        method: Option<String>,
        #[arg(long)]
        url_contains: Option<String>,
        #[arg(long)]
        path_prefix: Option<String>,
        #[arg(long)]
        header_name: Option<String>,
        #[arg(long)]
        header_contains: Option<String>,
        #[arg(long)]
        action: Option<String>,
        #[arg(long)]
        target_base_url: Option<String>,
        #[arg(long)]
        rewrite_prefix: Option<String>,
        #[arg(long = "request-header")]
        request_headers: Vec<String>,
        #[arg(long = "response-header")]
        response_headers: Vec<String>,
        #[arg(long)]
        outbound_mode: Option<String>,
        #[arg(long)]
        outbound_proxy: Option<String>,
        #[arg(long)]
        status: Option<u16>,
        #[arg(long)]
        content_type: Option<String>,
        #[arg(long)]
        body: Option<String>,
        #[arg(long = "header")]
        headers: Vec<String>,
        #[arg(long)]
        delay_ms: Option<u64>,
    },
    RuleDelete {
        rule: String,
    },
    Diagnose {
        #[arg(long)]
        profile: Option<String>,
        #[arg(long, default_value = "GET")]
        method: String,
        #[arg(long)]
        url: String,
        #[arg(long = "header")]
        headers: Vec<String>,
    },
    BindRuntime {
        #[arg(long)]
        profile: String,
        #[arg(long)]
        runtime_profile: Option<String>,
        #[arg(long)]
        label: Option<String>,
        #[arg(long)]
        project: Option<String>,
        #[arg(long)]
        debug_profile: Option<String>,
        #[arg(long)]
        create_debug_profile: bool,
        #[arg(long)]
        debug_profile_label: Option<String>,
        #[arg(long)]
        network_proxy: bool,
        #[arg(long)]
        node_hook: bool,
    },
}

#[derive(Subcommand)]
enum RuntimeCommands {
    Profiles,
    ProfileShow {
        key: String,
    },
    Inspect {
        #[arg(long)]
        project: String,
        #[arg(long = "debug-profile")]
        debug_profile: Option<String>,
    },
    Preflight {
        #[arg(long)]
        project: String,
        #[arg(long = "debug-profile")]
        debug_profile: Option<String>,
    },
    Start {
        #[arg(long)]
        project: String,
        #[arg(long = "debug-profile")]
        debug_profile: Option<String>,
        #[arg(long = "env")]
        env: Vec<String>,
    },
    Focus {
        #[arg(long)]
        project: String,
        #[arg(long = "debug-profile")]
        debug_profile: Option<String>,
        #[arg(long)]
        url: Option<String>,
    },
    Log {
        #[arg(long)]
        project: String,
        #[arg(long, value_enum, default_value = "dev")]
        kind: RuntimeLogKindArg,
        #[arg(long, default_value_t = 160)]
        max_lines: usize,
        #[arg(long)]
        clear: bool,
    },
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum RuntimeLogKindArg {
    Dev,
    Build,
}

impl From<RuntimeLogKindArg> for ProjectRuntimeLogKind {
    fn from(value: RuntimeLogKindArg) -> Self {
        match value {
            RuntimeLogKindArg::Dev => ProjectRuntimeLogKind::Dev,
            RuntimeLogKindArg::Build => ProjectRuntimeLogKind::Build,
        }
    }
}

#[derive(Subcommand)]
enum WebActionCommands {
    Path,
    List {
        #[arg(long)]
        scope: Option<String>,
        #[arg(long)]
        url: Option<String>,
    },
    Targets,
    Open {
        #[arg(long)]
        url: String,
    },
    Run {
        #[arg(long)]
        action: String,
        #[arg(long)]
        target: Option<String>,
        #[arg(long)]
        scope: Option<String>,
        #[arg(long)]
        url: Option<String>,
        #[arg(long = "param")]
        params: Vec<String>,
        #[arg(long = "context")]
        context_params: Vec<String>,
    },
    Script {
        #[arg(long)]
        target: String,
        #[arg(long)]
        script: Option<String>,
        #[arg(long)]
        file: Option<PathBuf>,
        #[arg(long)]
        stdin: bool,
        #[arg(long = "param")]
        params: Vec<String>,
    },
}

#[derive(Subcommand)]
enum AgentCommands {
    Capabilities,
    Context {
        #[arg(long)]
        project: Option<String>,
        #[arg(long)]
        query: Option<String>,
        #[arg(long, default_value_t = 6)]
        limit: usize,
    },
}

fn main() {
    let args: Vec<_> = std::env::args_os().collect();
    let json_mode = args.iter().any(|value| value == "--json");

    let exit_code = match Cli::try_parse_from(&args) {
        Ok(cli) => match run_cli(cli) {
            Ok(()) => 0,
            Err(error) => {
                emit_cli_error(&error, json_mode);
                classify_error(&error).1
            }
        },
        Err(error) => {
            if matches!(
                error.kind(),
                ErrorKind::DisplayHelp | ErrorKind::DisplayVersion
            ) {
                if json_mode {
                    let command = if matches!(error.kind(), ErrorKind::DisplayVersion) {
                        "version"
                    } else {
                        "help"
                    };
                    let _ = print_json_command(command, &json!({ "text": error.to_string() }));
                } else {
                    let _ = error.print();
                }
                0
            } else {
                emit_parse_error(&error, json_mode);
                2
            }
        }
    };

    std::process::exit(exit_code);
}

fn run_cli(cli: Cli) -> Result<()> {
    let Cli {
        config,
        json,
        command,
    } = cli;
    let config_override = config.as_deref();

    match command {
        Commands::Desktop => {
            let (config, _) = load_cli_config(config_override)?;
            desktop::run(config)
        }
        Commands::Info => {
            let (config, config_path) = load_cli_config(config_override)?;
            show_info(&config, &config_path, json)
        }
        Commands::Capabilities => run_capabilities(json),
        Commands::Doctor => run_doctor(config_override, json),
        Commands::Context {
            project,
            query,
            limit,
        } => {
            let (config, workspace, _) = load_cli_context(config_override)?;
            run_context(&config, &workspace, project, query, limit, json)
        }
        Commands::App { command } => run_app(command, json),
        Commands::Workspace { command } => run_workspace(command, config_override, json),
        Commands::Projects { command } => {
            if command.writes_config() {
                run_project_config_command(command, config_override, json)
            } else {
                let (config, _) = load_cli_effective_config(config_override)?;
                run_projects(&config, command, json)
            }
        }
        Commands::List => {
            let (config, _) = load_cli_effective_config(config_override)?;
            list_projects(&config, json)
        }
        Commands::Tui => {
            let (config, _) = load_cli_config(config_override)?;
            tui::run(&config)
        }
        Commands::Show { project } => {
            let (config, _) = load_cli_effective_config(config_override)?;
            show_project(&config, &project, json)
        }
        Commands::Branch { project } => {
            let (config, _) = load_cli_effective_config(config_override)?;
            show_branch(&config, &project, json)
        }
        Commands::Branches { project } => {
            let (config, _) = load_cli_effective_config(config_override)?;
            show_branches(&config, &project, json)
        }
        Commands::Envs { project, target } => {
            let (config, _) = load_cli_effective_config(config_override)?;
            show_envs(&config, &project, target, json)
        }
        Commands::Options { project, target } => {
            let (config, _) = load_cli_effective_config(config_override)?;
            show_options(&config, &project, target, json)
        }
        Commands::Plan {
            project,
            target,
            env,
            branch,
            extra_params,
        } => {
            let (config, _) = load_cli_effective_config(config_override)?;
            plan_deploy(&config, project, target, env, branch, extra_params, json)
        }
        Commands::Trigger {
            project,
            target,
            env,
            branch,
            extra_params,
        } => {
            let (config, _) = load_cli_effective_config(config_override)?;
            trigger_deploy(&config, project, target, env, branch, extra_params, json)
        }
        Commands::Status {
            queue_url,
            build_url,
        } => {
            let (config, _) = load_cli_effective_config(config_override)?;
            show_status(&config, queue_url, build_url, json)
        }
        Commands::Deploy { command } => {
            let (config, _) = load_cli_effective_config(config_override)?;
            run_deploy(&config, command, json)
        }
        Commands::Build { command } => {
            let (config, _) = load_cli_effective_config(config_override)?;
            run_build(&config, command, json)
        }
        Commands::Git { command } => {
            let (config, _) = load_cli_effective_config(config_override)?;
            run_git(&config, command, json)
        }
        Commands::MigrateConfig { input, output } => {
            let input_path = input.unwrap_or_else(default_projects_path);
            let output_path = output.unwrap_or_else(|| input_path.clone());
            migrate_projects_config(&input_path, &output_path, json)
        }
        Commands::MergeOverview {
            project,
            source,
            target,
        } => {
            let (config, _) = load_cli_effective_config(config_override)?;
            show_merge_overview(&config, &project, &source, &target, json)
        }
        Commands::Merge {
            project,
            source,
            target,
        } => {
            let (config, _) = load_cli_effective_config(config_override)?;
            run_merge(&config, project, source, target, json)
        }
        Commands::SyncBranches {
            project,
            source_branch,
            target_branches,
        } => {
            let (config, _) = load_cli_effective_config(config_override)?;
            run_branch_sync(&config, project, source_branch, target_branches, json)
        }
        Commands::CreateBranch {
            projects,
            source_branch,
            target_branch,
        } => {
            let (config, _) = load_cli_effective_config(config_override)?;
            run_branch_create(&config, projects, source_branch, target_branch, json)
        }
        Commands::CheckoutBranch {
            project,
            source_branch,
            destination,
        } => {
            let (config, _) = load_cli_effective_config(config_override)?;
            run_branch_checkout(&config, project, source_branch, destination, json)
        }
        Commands::SwitchBranch {
            project,
            target_branch,
        } => {
            let (config, _) = load_cli_effective_config(config_override)?;
            run_branch_switch(&config, project, target_branch, json)
        }
        Commands::PushStatus { project } => {
            let (config, _) = load_cli_effective_config(config_override)?;
            run_push_status(&config, project, json)
        }
        Commands::PushBranch { project, message } => {
            let (config, _) = load_cli_effective_config(config_override)?;
            run_push_branch(&config, project, message, json)
        }
        Commands::Navigation { command } => run_navigation(command, json),
        Commands::Proxy { command } => run_proxy(command, config_override, json),
        Commands::Runtime { command } => {
            let (config, _) = load_cli_effective_config(config_override)?;
            run_runtime(&config, command, json)
        }
        Commands::WebActions { command } => run_web_actions(command, json),
        Commands::Notes { command } => run_notes(command, json),
        Commands::History { command } => {
            let (config, _) = load_cli_effective_config(config_override)?;
            run_history(&config, command, json)
        }
        Commands::Agent { command } => {
            let context_input = match &command {
                AgentCommands::Capabilities => None,
                AgentCommands::Context { .. } => Some(load_cli_context(config_override)?),
            };
            run_agent(context_input.as_ref(), command, json)
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    name: String,
    version: String,
    config_dir: String,
    config_path: String,
    workspace_path: String,
    workspaces_path: String,
    active_workspace: String,
    storage_path: String,
    navigation_file_path: String,
    project_count: usize,
    jenkins_profiles: Vec<JenkinsProfileInfo>,
    gitlab_token_env: String,
    has_gitlab_token: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JenkinsProfileInfo {
    key: String,
    base_url: String,
    username: String,
    password_env: String,
    has_password: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspacePreferenceInfo {
    workspace_path: String,
    style_mode: String,
    default_page: Option<String>,
    enabled_pages: Vec<String>,
    active_workspace: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DoctorReport {
    status: DoctorStatus,
    error_count: usize,
    warning_count: usize,
    paths: DoctorPaths,
    active_workspace: Option<ProjectWorkspaceCliInfo>,
    checks: Vec<DoctorCheck>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DoctorPaths {
    config_dir: String,
    projects: String,
    workspace: String,
    workspaces_dir: String,
    navigation: String,
    proxy: String,
    web_actions: String,
    storage: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DoctorCheck {
    status: DoctorStatus,
    code: String,
    message: String,
    detail: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxyCliInfo {
    path: String,
    workspace: ProjectWorkspaceCliInfo,
    profiles: Vec<ProxyProfile>,
    rules: Vec<ProxyRule>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceScopeCliInfo {
    workspace: ProjectWorkspaceCliInfo,
    proxy_profiles: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InitDemandWorkspaceCliInfo {
    workspace: ProjectWorkspaceCliInfo,
    project: InitDemandWorkspaceProject,
    requirement_entry: InitDemandWorkspaceRequirementEntry,
    branch: InitDemandWorkspaceBranch,
    metadata: BTreeMap<String, String>,
    warnings: Vec<String>,
}

struct WorkspaceScopeUpdate {
    name: Option<String>,
    description: Option<String>,
    clear_description: bool,
    all_projects: bool,
    clear_projects: bool,
    projects: Vec<String>,
    all_navigation: bool,
    clear_navigation: bool,
    navigation_categories: Vec<String>,
    navigation_entries: Vec<String>,
    proxy_profiles: Vec<String>,
    clear_proxy_profiles: bool,
    root_dir: Option<PathBuf>,
    clear_root_dir: bool,
    project_instances: Vec<String>,
    clear_project_instances: bool,
}

struct ProxyRuleCliPatch {
    profile: Option<String>,
    id: Option<String>,
    name: Option<String>,
    priority: Option<i32>,
    enabled: Option<bool>,
    method: Option<String>,
    url_contains: Option<String>,
    path_prefix: Option<String>,
    header_name: Option<String>,
    header_contains: Option<String>,
    action: Option<String>,
    target_base_url: Option<String>,
    rewrite_prefix: Option<String>,
    request_headers: Vec<String>,
    response_headers: Vec<String>,
    outbound_mode: Option<String>,
    outbound_proxy: Option<String>,
    status: Option<u16>,
    content_type: Option<String>,
    body: Option<String>,
    headers: Vec<String>,
    delay_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum DoctorStatus {
    Ok,
    Warning,
    Error,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectWorkspaceCliInfo {
    key: String,
    name: String,
    description: Option<String>,
    active: bool,
    system: bool,
    workspace_kind: String,
    workspace_type: String,
    metadata: BTreeMap<String, String>,
    root_dir: Option<String>,
    project_count: usize,
    resource_count: usize,
    include_all_projects: bool,
    include_all_navigation: bool,
    projects: Vec<String>,
    navigation_categories: Vec<String>,
    navigation_entries: Vec<String>,
    project_instances: Vec<ProjectWorkspaceProjectInstanceCliInfo>,
    resource_categories: Vec<ProjectWorkspaceResourceCategoryCliInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectWorkspaceProjectInstanceCliInfo {
    project: String,
    path: String,
    managed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectWorkspaceResourceCategoryCliInfo {
    title: String,
    short_label: Option<String>,
    entries: Vec<ProjectWorkspaceResourceEntryCliInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectWorkspaceResourceEntryCliInfo {
    name: String,
    kind: Option<String>,
    target: String,
    note: Option<String>,
}

fn load_cli_config(config_override: Option<&Path>) -> Result<(AppConfig, PathBuf)> {
    let config_path = match config_override {
        Some(path) => resolve_config_path(path)?,
        None => ensure_default_configs()?.projects,
    };
    let config = load_config(&config_path)?;
    Ok((config, config_path))
}

fn load_cli_effective_config(config_override: Option<&Path>) -> Result<(AppConfig, PathBuf)> {
    let (config, path) = load_cli_config(config_override)?;
    let paths = ensure_default_configs()?;
    let workspace = load_active_project_workspace(&paths)?;
    Ok((apply_project_workspace_context(&config, &workspace), path))
}

fn load_cli_context(
    config_override: Option<&Path>,
) -> Result<(AppConfig, ProjectWorkspaceConfig, PathBuf)> {
    let (config, path) = load_cli_config(config_override)?;
    let paths = ensure_default_configs()?;
    let workspace = load_active_project_workspace(&paths)?;
    Ok((config, workspace, path))
}

fn classify_error(error: &anyhow::Error) -> (&'static str, i32) {
    let message = error.to_string().to_lowercase();
    if message.contains("not found")
        || message.contains("missing")
        || message.contains("不存在")
        || message.contains("no such")
    {
        ("missing_resource", 3)
    } else if message.contains("unsupported")
        || message.contains("not implemented")
        || message.contains("not configured")
        || message.contains("precondition")
        || message.contains("only available")
        || message.contains("empty directory")
    {
        ("unsupported_operation", 4)
    } else if message.contains("invalid")
        || message.contains("already exists")
        || message.contains("duplicate")
        || message.contains("required")
        || message.contains("at least one")
        || message.contains("choose only one")
        || message.contains("must be")
        || message.contains("failed to parse")
    {
        ("invalid_arguments", 2)
    } else {
        ("internal_error", 1)
    }
}

fn emit_parse_error(error: &clap::Error, json_mode: bool) {
    if json_mode {
        let _ = print_json_error("invalid_arguments", &error.to_string());
    } else {
        eprint!("{error}");
    }
}

fn emit_cli_error(error: &anyhow::Error, json_mode: bool) {
    if json_mode {
        let (code, _) = classify_error(error);
        let _ = print_json_error(code, &error.to_string());
    } else {
        eprintln!("{error}");
    }
}

fn show_info(config: &AppConfig, config_path: &std::path::Path, json_mode: bool) -> Result<()> {
    let paths = ensure_default_configs()?;
    let workspace_config = load_workspace_config(&paths.workspace)?;
    let active_workspace = active_project_workspace_key(&workspace_config);
    let jenkins_profiles = config
        .defaults
        .jenkins_profiles
        .iter()
        .map(|(key, profile)| JenkinsProfileInfo {
            key: key.clone(),
            base_url: profile.base_url.clone(),
            username: profile.username.clone(),
            password_env: profile.password_env.clone(),
            has_password: profile
                .password
                .as_ref()
                .is_some_and(|value| !value.trim().is_empty())
                || std::env::var_os(&profile.password_env).is_some_and(|value| !value.is_empty()),
        })
        .collect();
    let has_gitlab_token = config
        .defaults
        .gitlab_token
        .as_ref()
        .is_some_and(|value| !value.trim().is_empty())
        || std::env::var_os(&config.defaults.gitlab_token_env)
            .is_some_and(|value| !value.is_empty());
    let info = AppInfo {
        name: "rDevTool".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        config_dir: default_config_dir().display().to_string(),
        config_path: config_path.display().to_string(),
        workspace_path: default_workspace_path().display().to_string(),
        workspaces_path: default_project_workspaces_dir().display().to_string(),
        active_workspace,
        storage_path: storage::default_storage_path().display().to_string(),
        navigation_file_path: navigation_file_path().to_string(),
        project_count: config.projects.len(),
        jenkins_profiles,
        gitlab_token_env: config.defaults.gitlab_token_env.clone(),
        has_gitlab_token,
    };

    if json_mode {
        return print_json_command("info", &info);
    }

    println!("app              : {}", info.name);
    println!("version          : {}", info.version);
    println!("config dir       : {}", info.config_dir);
    println!("config path      : {}", info.config_path);
    println!("workspace path   : {}", info.workspace_path);
    println!("workspaces path  : {}", info.workspaces_path);
    println!("active workspace : {}", info.active_workspace);
    println!("storage path     : {}", info.storage_path);
    println!("navigation path  : {}", info.navigation_file_path);
    println!("project count    : {}", info.project_count);
    println!("jenkins profiles : {}", info.jenkins_profiles.len());
    for profile in &info.jenkins_profiles {
        println!(
            "  {} -> {} ({}, env {}, has pass {})",
            profile.key,
            profile.base_url,
            profile.username,
            profile.password_env,
            profile.has_password
        );
    }
    println!("gitlab env       : {}", info.gitlab_token_env);
    println!("has gitlab token : {}", info.has_gitlab_token);
    Ok(())
}

fn run_capabilities(json_mode: bool) -> Result<()> {
    let value = capabilities();
    if json_mode {
        return print_json_command("capabilities", &value);
    }
    print_agent_capabilities(&value);
    Ok(())
}

fn run_doctor(config_override: Option<&Path>, json_mode: bool) -> Result<()> {
    let report = build_doctor_report(config_override)?;
    if json_mode {
        return print_json_command("doctor", &report);
    }
    print_doctor_report(&report);
    Ok(())
}

fn run_context(
    config: &AppConfig,
    workspace: &ProjectWorkspaceConfig,
    project: Option<String>,
    query: Option<String>,
    limit: usize,
    json_mode: bool,
) -> Result<()> {
    let storage = Storage::new_default().map_err(anyhow::Error::msg)?;
    let value = context_for_workspace(
        config,
        &storage,
        Some(workspace),
        project.as_deref(),
        query.as_deref(),
        limit,
    )?;
    if json_mode {
        return print_json_command("context", &value);
    }
    print_agent_context(&value);
    Ok(())
}

fn build_doctor_report(config_override: Option<&Path>) -> Result<DoctorReport> {
    let paths = ensure_default_configs()?;
    let mut checks = Vec::new();
    let mut active_workspace = None;
    let mut config_for_workspace = None;
    let mut known_workspace_keys = BTreeSet::new();

    let config_result = load_cli_config(config_override);
    let config_path = config_result
        .as_ref()
        .map(|(_, path)| path.clone())
        .unwrap_or_else(|_| paths.projects.clone());

    let doctor_paths = DoctorPaths {
        config_dir: paths.dir.display().to_string(),
        projects: config_path.display().to_string(),
        workspace: paths.workspace.display().to_string(),
        workspaces_dir: paths.project_workspaces.display().to_string(),
        navigation: navigation_file_path(),
        proxy: default_proxy_path().display().to_string(),
        web_actions: default_web_actions_path().display().to_string(),
        storage: storage::default_storage_path().display().to_string(),
    };

    match config_result {
        Ok((config, _)) => {
            push_check(
                &mut checks,
                DoctorStatus::Ok,
                "projects_config",
                format!("loaded {} projects", config.projects.len()),
                Some(config_path.display().to_string()),
            );
            check_project_config(&mut checks, &config);
            config_for_workspace = Some(config);
        }
        Err(error) => {
            push_check(
                &mut checks,
                DoctorStatus::Error,
                "projects_config",
                "failed to load projects config",
                Some(error.to_string()),
            );
        }
    }

    match load_workspace_config(&paths.workspace) {
        Ok(workspace_config) => {
            let active_key = active_project_workspace_key(&workspace_config);
            push_check(
                &mut checks,
                DoctorStatus::Ok,
                "workspace_preferences",
                format!("active workspace is {active_key}"),
                Some(paths.workspace.display().to_string()),
            );
            match load_project_workspaces(&paths.project_workspaces) {
                Ok(workspaces) => {
                    known_workspace_keys = workspaces
                        .iter()
                        .map(|workspace| workspace.key.clone())
                        .collect();
                    push_check(
                        &mut checks,
                        DoctorStatus::Ok,
                        "workspace_catalog",
                        format!("loaded {} workspaces", workspaces.len()),
                        Some(paths.project_workspaces.display().to_string()),
                    );
                }
                Err(error) => push_check(
                    &mut checks,
                    DoctorStatus::Error,
                    "workspace_catalog",
                    "failed to load workspaces",
                    Some(error.to_string()),
                ),
            }
            match load_active_project_workspace(&paths) {
                Ok(workspace) => {
                    if let Some(config) = &config_for_workspace {
                        check_workspace_scope(&mut checks, &workspace, config);
                        active_workspace = Some(project_workspace_cli_info(
                            workspace.clone(),
                            config,
                            &active_key,
                        ));
                    }
                    check_navigation_config(&mut checks, &workspace);
                }
                Err(error) => push_check(
                    &mut checks,
                    DoctorStatus::Error,
                    "active_workspace",
                    "failed to load active workspace",
                    Some(error.to_string()),
                ),
            }
        }
        Err(error) => push_check(
            &mut checks,
            DoctorStatus::Error,
            "workspace_preferences",
            "failed to load workspace preferences",
            Some(error.to_string()),
        ),
    }

    check_proxy_config(&mut checks, &known_workspace_keys);
    check_storage(&mut checks);
    check_web_actions(&mut checks);

    let error_count = checks
        .iter()
        .filter(|check| check.status == DoctorStatus::Error)
        .count();
    let warning_count = checks
        .iter()
        .filter(|check| check.status == DoctorStatus::Warning)
        .count();
    let status = if error_count > 0 {
        DoctorStatus::Error
    } else if warning_count > 0 {
        DoctorStatus::Warning
    } else {
        DoctorStatus::Ok
    };

    Ok(DoctorReport {
        status,
        error_count,
        warning_count,
        paths: doctor_paths,
        active_workspace,
        checks,
    })
}

fn check_project_config(checks: &mut Vec<DoctorCheck>, config: &AppConfig) {
    let mut seen = BTreeSet::new();
    let mut duplicates = Vec::new();
    let mut missing_repos = Vec::new();

    for project in &config.projects {
        if !seen.insert(project.key.clone()) {
            duplicates.push(project.key.clone());
        }
        if let Some(path) = &project.repo_path {
            if !path.exists() {
                missing_repos.push(format!("{} -> {}", project.key, path.display()));
            }
        }
    }

    if duplicates.is_empty() {
        push_check(
            checks,
            DoctorStatus::Ok,
            "project_keys",
            "project keys are unique",
            None,
        );
    } else {
        push_check(
            checks,
            DoctorStatus::Error,
            "project_keys",
            "duplicate project keys found",
            Some(duplicates.join(", ")),
        );
    }

    if missing_repos.is_empty() {
        push_check(
            checks,
            DoctorStatus::Ok,
            "project_repo_paths",
            "configured repo paths exist",
            None,
        );
    } else {
        push_check(
            checks,
            DoctorStatus::Warning,
            "project_repo_paths",
            format!("{} repo paths do not exist", missing_repos.len()),
            Some(missing_repos.join("; ")),
        );
    }
}

fn check_workspace_scope(
    checks: &mut Vec<DoctorCheck>,
    workspace: &ProjectWorkspaceConfig,
    config: &AppConfig,
) {
    if workspace.include_all_projects {
        push_check(
            checks,
            DoctorStatus::Ok,
            "workspace_projects",
            "active workspace includes all projects",
            Some(workspace.key.clone()),
        );
        return;
    }

    let project_keys = config
        .projects
        .iter()
        .map(|project| project.key.as_str())
        .collect::<BTreeSet<_>>();
    let missing = workspace
        .projects
        .iter()
        .filter(|key| !project_keys.contains(key.as_str()))
        .cloned()
        .collect::<Vec<_>>();

    if missing.is_empty() {
        push_check(
            checks,
            DoctorStatus::Ok,
            "workspace_projects",
            format!(
                "active workspace references {} projects",
                workspace.projects.len()
            ),
            Some(workspace.key.clone()),
        );
    } else {
        push_check(
            checks,
            DoctorStatus::Warning,
            "workspace_projects",
            "active workspace references missing projects",
            Some(missing.join(", ")),
        );
    }
}

fn check_navigation_config(checks: &mut Vec<DoctorCheck>, workspace: &ProjectWorkspaceConfig) {
    match list_navigation_entries_for_workspace(workspace, 2000) {
        Ok(entries) if entries.is_empty() => push_check(
            checks,
            DoctorStatus::Warning,
            "navigation",
            "navigation has no entries in active workspace",
            Some(navigation_file_path()),
        ),
        Ok(entries) => push_check(
            checks,
            DoctorStatus::Ok,
            "navigation",
            format!(
                "loaded {} navigation entries for active workspace",
                entries.len()
            ),
            Some(navigation_file_path()),
        ),
        Err(error) => push_check(
            checks,
            DoctorStatus::Error,
            "navigation",
            "failed to load navigation entries",
            Some(error.to_string()),
        ),
    }
}

fn check_proxy_config(checks: &mut Vec<DoctorCheck>, known_workspace_keys: &BTreeSet<String>) {
    let proxy_path = match ensure_proxy_config() {
        Ok(path) => path,
        Err(error) => {
            push_check(
                checks,
                DoctorStatus::Error,
                "proxy_config",
                "failed to ensure proxy config",
                Some(error.to_string()),
            );
            return;
        }
    };

    let proxy_config = match load_proxy_config(&proxy_path) {
        Ok(config) => config,
        Err(error) => {
            push_check(
                checks,
                DoctorStatus::Error,
                "proxy_config",
                "failed to load proxy config",
                Some(error.to_string()),
            );
            return;
        }
    };

    let mut validation_errors = Vec::new();
    let mut workspace_warnings = Vec::new();
    let mut listen_addrs = BTreeSet::new();
    let mut duplicate_addrs = Vec::new();
    let mut unavailable_addrs = Vec::new();

    for profile in &proxy_config.profiles {
        if let Err(error) = validate_proxy_profile(profile) {
            validation_errors.push(format!("profile {}: {error}", profile.id));
        }
        if let Some(workspace_key) = &profile.workspace_key {
            if !known_workspace_keys.is_empty() && !known_workspace_keys.contains(workspace_key) {
                workspace_warnings.push(format!("{} -> {}", profile.id, workspace_key));
            }
        }
        let listen_addr = profile.listen_addr();
        if !listen_addrs.insert(listen_addr.clone()) {
            duplicate_addrs.push(listen_addr.clone());
        }
        if TcpListener::bind(&listen_addr).is_err() {
            unavailable_addrs.push(listen_addr);
        }
    }

    for rule in &proxy_config.rules {
        if let Err(error) = validate_proxy_rule(rule) {
            validation_errors.push(format!("rule {}: {error}", rule.id));
        }
    }

    if validation_errors.is_empty() {
        push_check(
            checks,
            DoctorStatus::Ok,
            "proxy_config",
            format!(
                "loaded {} profiles and {} rules",
                proxy_config.profiles.len(),
                proxy_config.rules.len()
            ),
            Some(proxy_path.display().to_string()),
        );
    } else {
        push_check(
            checks,
            DoctorStatus::Error,
            "proxy_config",
            "proxy config contains invalid profiles or rules",
            Some(validation_errors.join("; ")),
        );
    }

    if workspace_warnings.is_empty() {
        push_check(
            checks,
            DoctorStatus::Ok,
            "proxy_workspaces",
            "proxy workspace references are valid",
            None,
        );
    } else {
        push_check(
            checks,
            DoctorStatus::Warning,
            "proxy_workspaces",
            "proxy profiles reference missing workspaces",
            Some(workspace_warnings.join("; ")),
        );
    }

    if duplicate_addrs.is_empty() && unavailable_addrs.is_empty() {
        push_check(
            checks,
            DoctorStatus::Ok,
            "proxy_ports",
            "proxy listen ports look available",
            None,
        );
    } else {
        let detail = [
            (!duplicate_addrs.is_empty())
                .then(|| format!("duplicate: {}", duplicate_addrs.join(", "))),
            (!unavailable_addrs.is_empty()).then(|| {
                format!(
                    "unavailable or already running: {}",
                    unavailable_addrs.join(", ")
                )
            }),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join("; ");
        push_check(
            checks,
            DoctorStatus::Warning,
            "proxy_ports",
            "some proxy listen addresses need attention",
            Some(detail),
        );
    }
}

fn check_storage(checks: &mut Vec<DoctorCheck>) {
    match Storage::new_default() {
        Ok(_) => push_check(
            checks,
            DoctorStatus::Ok,
            "storage",
            "storage database is available",
            Some(storage::default_storage_path().display().to_string()),
        ),
        Err(error) => push_check(
            checks,
            DoctorStatus::Error,
            "storage",
            "failed to open storage database",
            Some(error),
        ),
    }
}

fn check_web_actions(checks: &mut Vec<DoctorCheck>) {
    let path = default_web_actions_path();
    if path.exists() {
        match fs::read_to_string(&path) {
            Ok(_) => push_check(
                checks,
                DoctorStatus::Ok,
                "web_actions",
                "web actions config is readable",
                Some(path.display().to_string()),
            ),
            Err(error) => push_check(
                checks,
                DoctorStatus::Warning,
                "web_actions",
                "web actions config exists but is not readable",
                Some(error.to_string()),
            ),
        }
    } else {
        push_check(
            checks,
            DoctorStatus::Ok,
            "web_actions",
            "web actions config is optional and not initialized",
            Some(path.display().to_string()),
        );
    }
}

fn push_check(
    checks: &mut Vec<DoctorCheck>,
    status: DoctorStatus,
    code: &str,
    message: impl Into<String>,
    detail: Option<String>,
) {
    checks.push(DoctorCheck {
        status,
        code: code.to_string(),
        message: message.into(),
        detail,
    });
}

fn run_app(command: AppCommands, json_mode: bool) -> Result<()> {
    match command {
        AppCommands::Preferences => {
            let info = load_workspace_preference_info()?;
            if json_mode {
                return print_json_command("app.preferences", &info);
            }
            print_workspace_preferences(&info);
            Ok(())
        }
        AppCommands::SetPreferences {
            style_mode,
            default_page,
            enabled_pages,
            clear_enabled_pages,
        } => {
            let paths = ensure_default_configs()?;
            let mut config = load_workspace_config(&paths.workspace)?;
            if let Some(style_mode) = style_mode {
                config.app.style_mode = normalize_cli_style_mode(&style_mode)?;
            }
            if let Some(default_page) = default_page {
                config.app.default_page = normalize_cli_page(Some(default_page));
            }
            if clear_enabled_pages {
                config.app.enabled_pages.clear();
            } else if !enabled_pages.is_empty() {
                config.app.enabled_pages = normalize_cli_page_list(enabled_pages);
            }
            save_workspace_config(&paths.workspace, &config)?;
            let info = workspace_preference_info(paths.workspace, config);
            if json_mode {
                return print_json_command("app.set-preferences", &info);
            }
            print_workspace_preferences(&info);
            Ok(())
        }
    }
}

fn run_workspace(
    command: WorkspaceCommands,
    config_override: Option<&Path>,
    json_mode: bool,
) -> Result<()> {
    match command {
        WorkspaceCommands::List => {
            let (config, _) = load_cli_config(config_override)?;
            let paths = ensure_default_configs()?;
            let workspace_config = load_workspace_config(&paths.workspace)?;
            let active_key = active_project_workspace_key(&workspace_config);
            let workspaces = load_project_workspaces(&paths.project_workspaces)?
                .into_iter()
                .map(|workspace| project_workspace_cli_info(workspace, &config, &active_key))
                .collect::<Vec<_>>();
            if json_mode {
                return print_json_command("workspace.list", &workspaces);
            }
            for workspace in workspaces {
                let marker = if workspace.active { "*" } else { " " };
                println!(
                    "{} {:<20} {:<18} {}",
                    marker, workspace.key, workspace.project_count, workspace.name
                );
            }
            Ok(())
        }
        WorkspaceCommands::Show { workspace } => {
            let (config, _) = load_cli_config(config_override)?;
            let paths = ensure_default_configs()?;
            let workspace_config = load_workspace_config(&paths.workspace)?;
            let active_key = active_project_workspace_key(&workspace_config);
            let key = workspace.unwrap_or_else(|| active_key.clone());
            let workspace = load_project_workspace_by_key(&paths.project_workspaces, &key)?;
            let info = project_workspace_cli_info(workspace, &config, &active_key);
            if json_mode {
                return print_json_command("workspace.show", &info);
            }
            print_project_workspace(&info);
            Ok(())
        }
        WorkspaceCommands::Create {
            key,
            name,
            description,
            root_dir,
            independent_dir,
            empty,
            no_switch,
        } => {
            let (config, _) = load_cli_config(config_override)?;
            let paths = ensure_default_configs()?;
            let copy_from = if empty {
                None
            } else {
                Some(load_active_project_workspace(&paths)?)
            };
            let root_dir = match (root_dir, independent_dir) {
                (Some(root_dir), _) => Some(normalize_cli_path_buf(root_dir)?),
                (None, true) => Some(default_project_workspace_root_dir(&key)),
                (None, false) => None,
            };
            let workspace = create_project_workspace(
                &paths,
                CreateProjectWorkspaceRequest {
                    name: name.unwrap_or_else(|| key.clone()),
                    key,
                    description,
                    workspace_type: None,
                    root_dir,
                    copy_from,
                    activate: !no_switch,
                },
            )?;
            let active_key =
                active_project_workspace_key(&load_workspace_config(&paths.workspace)?);
            let info = project_workspace_cli_info(workspace, &config, &active_key);
            if json_mode {
                return print_json_command("workspace.create", &info);
            }
            print_project_workspace(&info);
            Ok(())
        }
        WorkspaceCommands::InitDemand {
            name,
            key,
            demand_id,
            description,
            workspace_type,
            requirement_dir,
            repo_path,
            project,
            branch,
            root_dir,
            requirement_category,
            requirement_short_label,
            requirement_entry_name,
            no_switch,
        } => {
            let (config, _) = load_cli_config(config_override)?;
            let paths = ensure_default_configs()?;
            let result = init_demand_workspace(
                &paths,
                &config,
                InitDemandWorkspaceRequest {
                    key,
                    demand_id,
                    name,
                    description,
                    workspace_type,
                    requirement_dir,
                    repo_path,
                    project,
                    branch,
                    root_dir,
                    requirement_category: Some(requirement_category),
                    requirement_short_label: Some(requirement_short_label),
                    requirement_entry_name: Some(requirement_entry_name),
                    activate: !no_switch,
                },
            )?;
            let active_key =
                active_project_workspace_key(&load_workspace_config(&paths.workspace)?);
            let info = init_demand_workspace_cli_info(result, &config, &active_key);
            if json_mode {
                return print_json_command("workspace.init-demand", &info);
            }
            print_project_workspace(&info.workspace);
            println!(
                "project       : {} ({})",
                info.project.name, info.project.key
            );
            println!("requirement   : {}", info.requirement_entry.path);
            if let Some(expected) = &info.branch.expected {
                let marker = if info.branch.matches == Some(true) {
                    "matched"
                } else {
                    "mismatch"
                };
                println!(
                    "branch        : {} -> {} ({})",
                    info.branch.current.as_deref().unwrap_or("-"),
                    expected,
                    marker
                );
            }
            for warning in &info.warnings {
                println!("warning       : {}", warning);
            }
            Ok(())
        }
        WorkspaceCommands::Use { workspace } => {
            let (config, _) = load_cli_config(config_override)?;
            let paths = ensure_default_configs()?;
            let workspace = load_project_workspace_by_key(&paths.project_workspaces, &workspace)?;
            let mut app_workspace = load_workspace_config(&paths.workspace)?;
            app_workspace.app.active_workspace = Some(workspace.key.clone());
            save_workspace_config(&paths.workspace, &app_workspace)?;
            let info = project_workspace_cli_info(
                workspace,
                &config,
                &app_workspace
                    .app
                    .active_workspace
                    .unwrap_or_else(|| SYSTEM_PROJECT_WORKSPACE_KEY.to_string()),
            );
            if json_mode {
                return print_json_command("workspace.use", &info);
            }
            print_project_workspace(&info);
            Ok(())
        }
        WorkspaceCommands::Scope {
            workspace,
            name,
            description,
            clear_description,
            all_projects,
            clear_projects,
            projects,
            all_navigation,
            clear_navigation,
            navigation_categories,
            navigation_entries,
            proxy_profiles,
            clear_proxy_profiles,
            root_dir,
            clear_root_dir,
            project_instances,
            clear_project_instances,
        } => run_workspace_scope(
            config_override,
            workspace,
            WorkspaceScopeUpdate {
                name,
                description,
                clear_description,
                all_projects,
                clear_projects,
                projects,
                all_navigation,
                clear_navigation,
                navigation_categories,
                navigation_entries,
                proxy_profiles,
                clear_proxy_profiles,
                root_dir,
                clear_root_dir,
                project_instances,
                clear_project_instances,
            },
            json_mode,
        ),
    }
}

fn project_workspace_cli_info(
    workspace: ProjectWorkspaceConfig,
    config: &AppConfig,
    active_key: &str,
) -> ProjectWorkspaceCliInfo {
    let workspace_kind = if workspace.is_system() {
        "global"
    } else if workspace.root_dir.is_some() {
        "directory"
    } else {
        "scope"
    }
    .to_string();
    let resource_count = workspace
        .resource_categories
        .iter()
        .map(|category| category.entries.len())
        .sum();
    ProjectWorkspaceCliInfo {
        active: workspace.key == active_key,
        system: workspace.is_system(),
        workspace_kind,
        workspace_type: workspace.workspace_type.clone(),
        metadata: workspace.metadata.clone(),
        root_dir: workspace
            .root_dir
            .as_ref()
            .map(|path| path.display().to_string()),
        project_count: workspace.project_count_for(config),
        resource_count,
        key: workspace.key,
        name: workspace.name,
        description: workspace.description,
        include_all_projects: workspace.include_all_projects,
        include_all_navigation: workspace.include_all_navigation,
        projects: workspace.projects,
        navigation_categories: workspace.navigation_categories,
        navigation_entries: workspace.navigation_entries,
        project_instances: workspace
            .project_instances
            .into_iter()
            .map(|instance| ProjectWorkspaceProjectInstanceCliInfo {
                project: instance.project,
                path: instance.path.display().to_string(),
                managed: instance.managed,
            })
            .collect(),
        resource_categories: workspace
            .resource_categories
            .into_iter()
            .map(|category| ProjectWorkspaceResourceCategoryCliInfo {
                title: category.title,
                short_label: category.short_label,
                entries: category
                    .entries
                    .into_iter()
                    .map(|entry| ProjectWorkspaceResourceEntryCliInfo {
                        target: workspace_resource_entry_target(&entry),
                        name: entry.name,
                        kind: entry.kind,
                        note: entry.note,
                    })
                    .collect(),
            })
            .collect(),
    }
}

fn init_demand_workspace_cli_info(
    result: InitDemandWorkspaceResult,
    config: &AppConfig,
    active_key: &str,
) -> InitDemandWorkspaceCliInfo {
    InitDemandWorkspaceCliInfo {
        workspace: project_workspace_cli_info(result.workspace, config, active_key),
        project: result.project,
        requirement_entry: result.requirement_entry,
        branch: result.branch,
        metadata: result.metadata,
        warnings: result.warnings,
    }
}

fn print_project_workspace(value: &ProjectWorkspaceCliInfo) {
    println!("workspace     : {}", value.name);
    println!("key           : {}", value.key);
    println!("active        : {}", value.active);
    println!("system        : {}", value.system);
    println!("kind          : {}", value.workspace_kind);
    println!("type          : {}", value.workspace_type);
    if !value.metadata.is_empty() {
        println!("metadata      :");
        for (key, metadata_value) in &value.metadata {
            println!("  - {} = {}", key, metadata_value);
        }
    }
    if let Some(root_dir) = &value.root_dir {
        println!("root dir      : {}", root_dir);
    }
    println!(
        "projects      : {}",
        if value.include_all_projects {
            "all".to_string()
        } else {
            value.projects.join(", ")
        }
    );
    println!("project count : {}", value.project_count);
    println!("resource count: {}", value.resource_count);
    println!(
        "navigation    : {}",
        if value.include_all_navigation {
            "all".to_string()
        } else {
            [
                value.navigation_categories.join(", "),
                value.navigation_entries.join(", "),
            ]
            .into_iter()
            .filter(|value| !value.trim().is_empty())
            .collect::<Vec<_>>()
            .join(" | ")
        }
    );
    if !value.project_instances.is_empty() {
        println!("instances     :");
        for instance in &value.project_instances {
            let marker = if instance.managed { "managed" } else { "bound" };
            println!("  - {} -> {} ({})", instance.project, instance.path, marker);
        }
    }
    if !value.resource_categories.is_empty() {
        println!("resources     :");
        for category in &value.resource_categories {
            for entry in &category.entries {
                let kind = entry.kind.as_deref().unwrap_or("url");
                println!(
                    "  - {}/{} [{}] {}",
                    category.title, entry.name, kind, entry.target
                );
            }
        }
    }
    if let Some(description) = &value.description {
        println!("description   : {}", description);
    }
}

fn workspace_resource_entry_target(entry: &ProjectWorkspaceResourceEntryConfig) -> String {
    entry
        .url
        .trim()
        .to_string()
        .is_empty()
        .then(|| {
            entry
                .path
                .clone()
                .or_else(|| entry.script.clone())
                .or_else(|| entry.bundle_id.clone())
                .or_else(|| entry.app_name.clone())
                .unwrap_or_default()
        })
        .unwrap_or_else(|| entry.url.clone())
}

fn run_workspace_scope(
    config_override: Option<&Path>,
    workspace_key: Option<String>,
    update: WorkspaceScopeUpdate,
    json_mode: bool,
) -> Result<()> {
    let (config, _) = load_cli_config(config_override)?;
    let paths = ensure_default_configs()?;
    let app_workspace = load_workspace_config(&paths.workspace)?;
    let active_key = active_project_workspace_key(&app_workspace);
    let key = workspace_key.unwrap_or_else(|| active_key.clone());
    let mut workspace = load_project_workspace_by_key(&paths.project_workspaces, &key)?;

    if workspace.is_system() && update.has_changes() {
        anyhow::bail!("system workspace is global and cannot be scoped");
    }

    let should_save_workspace = update.has_workspace_changes();

    if update.clear_root_dir && update.root_dir.is_some() {
        anyhow::bail!("choose only one of --root-dir or --clear-root-dir");
    }
    if update.clear_project_instances && !update.project_instances.is_empty() {
        anyhow::bail!("choose only one of --project-instance or --clear-project-instances");
    }

    if let Some(name) = update.name {
        workspace.name = require_non_empty_cli_value("workspace name", &name)?;
    }
    if update.clear_description {
        workspace.description = None;
    } else if let Some(description) = update.description {
        workspace.description = optional_cli_text(description);
    }

    if update.all_projects && (!update.projects.is_empty() || update.clear_projects) {
        anyhow::bail!("choose only one of --all-projects, --project, or --clear-projects");
    }
    if update.all_projects {
        workspace.include_all_projects = true;
        workspace.projects.clear();
    } else if update.clear_projects || !update.projects.is_empty() {
        let projects = normalize_cli_strings(update.projects);
        validate_workspace_projects(&config, &projects)?;
        workspace.include_all_projects = false;
        workspace.projects = projects;
    }

    if update.all_navigation
        && (!update.navigation_categories.is_empty()
            || !update.navigation_entries.is_empty()
            || update.clear_navigation)
    {
        anyhow::bail!(
            "choose only one of --all-navigation, --navigation-category/--navigation-entry, or --clear-navigation"
        );
    }
    if update.all_navigation {
        workspace.include_all_navigation = true;
        workspace.navigation_categories.clear();
        workspace.navigation_entries.clear();
    } else if update.clear_navigation
        || !update.navigation_categories.is_empty()
        || !update.navigation_entries.is_empty()
    {
        let categories = normalize_cli_strings(update.navigation_categories);
        let entries = normalize_cli_strings(update.navigation_entries);
        validate_workspace_navigation_refs(&categories, &entries)?;
        workspace.include_all_navigation = false;
        workspace.navigation_categories = categories;
        workspace.navigation_entries = entries;
    }

    if update.clear_root_dir {
        workspace.root_dir = None;
    } else if let Some(root_dir) = update.root_dir {
        workspace.root_dir = Some(normalize_cli_path_buf(root_dir)?);
    }

    if update.clear_project_instances {
        workspace.project_instances.clear();
    } else if !update.project_instances.is_empty() {
        let instances = parse_workspace_project_instances(update.project_instances)?;
        let instance_projects = instances
            .iter()
            .map(|instance| instance.project.clone())
            .collect::<Vec<_>>();
        validate_workspace_projects(&config, &instance_projects)?;
        for instance in instances {
            if !workspace.include_all_projects
                && !workspace
                    .projects
                    .iter()
                    .any(|project| project == &instance.project)
            {
                workspace.projects.push(instance.project.clone());
            }
            workspace
                .project_instances
                .retain(|current| current.project != instance.project);
            workspace.project_instances.push(instance);
        }
    }

    workspace = workspace.normalized();
    if should_save_workspace {
        let path = paths
            .project_workspaces
            .join(format!("{}.toml", workspace.key));
        save_project_workspace_config(&path, &workspace)?;
    }

    if update.clear_proxy_profiles && !update.proxy_profiles.is_empty() {
        anyhow::bail!("choose only one of --proxy-profile or --clear-proxy-profiles");
    }
    if update.clear_proxy_profiles || !update.proxy_profiles.is_empty() {
        save_workspace_proxy_scope(
            &workspace,
            update.proxy_profiles,
            update.clear_proxy_profiles,
        )?;
    }

    let info = WorkspaceScopeCliInfo {
        proxy_profiles: proxy_profiles_for_workspace(&workspace)?,
        workspace: project_workspace_cli_info(workspace, &config, &active_key),
    };
    if json_mode {
        return print_json_command("workspace.scope", &info);
    }
    print_project_workspace(&info.workspace);
    println!("proxy profiles: {}", info.proxy_profiles.join(", "));
    Ok(())
}

impl WorkspaceScopeUpdate {
    fn has_changes(&self) -> bool {
        self.has_workspace_changes() || self.clear_proxy_profiles || !self.proxy_profiles.is_empty()
    }

    fn has_workspace_changes(&self) -> bool {
        self.name.is_some()
            || self.description.is_some()
            || self.clear_description
            || self.all_projects
            || self.clear_projects
            || !self.projects.is_empty()
            || self.all_navigation
            || self.clear_navigation
            || !self.navigation_categories.is_empty()
            || !self.navigation_entries.is_empty()
            || self.root_dir.is_some()
            || self.clear_root_dir
            || !self.project_instances.is_empty()
            || self.clear_project_instances
    }
}

fn save_workspace_proxy_scope(
    workspace: &ProjectWorkspaceConfig,
    proxy_profiles: Vec<String>,
    clear_proxy_profiles: bool,
) -> Result<()> {
    if workspace.is_system() {
        anyhow::bail!("system workspace cannot own proxy profiles");
    }
    let proxy_path = ensure_proxy_config()?;
    let mut proxy_config = load_proxy_config(&proxy_path)?;
    let selected = if clear_proxy_profiles {
        BTreeSet::new()
    } else {
        let selected = normalize_cli_strings(proxy_profiles)
            .into_iter()
            .collect::<BTreeSet<_>>();
        validate_proxy_profile_refs(&proxy_config, &selected)?;
        selected
    };
    for profile in &mut proxy_config.profiles {
        if selected.contains(&profile.id) || selected.contains(&profile.name) {
            profile.workspace_key = Some(workspace.key.clone());
        } else if profile.workspace_key.as_deref() == Some(workspace.key.as_str()) {
            profile.workspace_key = None;
        }
    }
    save_proxy_config(&proxy_path, &proxy_config)?;
    Ok(())
}

fn proxy_profiles_for_workspace(workspace: &ProjectWorkspaceConfig) -> Result<Vec<String>> {
    let proxy_path = ensure_proxy_config()?;
    let proxy_config = load_proxy_config(&proxy_path)?;
    if workspace.is_system() {
        return Ok(proxy_config
            .profiles
            .into_iter()
            .map(|profile| profile.id)
            .collect());
    }
    Ok(proxy_config
        .profiles
        .into_iter()
        .filter(|profile| profile.workspace_key.as_deref() == Some(workspace.key.as_str()))
        .map(|profile| profile.id)
        .collect())
}

fn load_workspace_preference_info() -> Result<WorkspacePreferenceInfo> {
    let paths = ensure_default_configs()?;
    let config = load_workspace_config(&paths.workspace)?;
    Ok(workspace_preference_info(paths.workspace, config))
}

fn workspace_preference_info(
    workspace_path: PathBuf,
    config: rdevtool_core::config::WorkspaceConfig,
) -> WorkspacePreferenceInfo {
    let active_workspace = active_project_workspace_key(&config);
    WorkspacePreferenceInfo {
        workspace_path: workspace_path.display().to_string(),
        style_mode: config.app.style_mode,
        default_page: config.app.default_page,
        enabled_pages: config.app.enabled_pages,
        active_workspace,
    }
}

fn normalize_cli_style_mode(value: &str) -> Result<String> {
    let trimmed = value.trim();
    match trimmed {
        "light" | "mono" => Ok(trimmed.to_string()),
        _ => anyhow::bail!("style mode must be light or mono"),
    }
}

fn require_non_empty_cli_value(label: &str, value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() {
        anyhow::bail!("{label} is required");
    }
    Ok(value.to_string())
}

fn optional_cli_text(value: String) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn normalize_cli_strings(values: Vec<String>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut normalized = Vec::new();
    for value in values {
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        if seen.insert(value.to_string()) {
            normalized.push(value.to_string());
        }
    }
    normalized
}

fn parse_workspace_project_instances(
    values: Vec<String>,
) -> Result<Vec<ProjectWorkspaceProjectInstanceConfig>> {
    let mut instances = Vec::new();
    for value in values {
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        let (project, path) = value
            .split_once('=')
            .ok_or_else(|| anyhow::anyhow!("project instance must use project=/path format"))?;
        let project = require_non_empty_cli_value("project instance project", project)?;
        let path = require_non_empty_cli_value("project instance path", path)?;
        instances.push(ProjectWorkspaceProjectInstanceConfig {
            project,
            path: normalize_cli_path_buf(PathBuf::from(path))?,
            managed: true,
        });
    }
    Ok(instances)
}

fn validate_workspace_projects(config: &AppConfig, projects: &[String]) -> Result<()> {
    let known = config
        .projects
        .iter()
        .map(|project| project.key.as_str())
        .collect::<BTreeSet<_>>();
    let missing = projects
        .iter()
        .filter(|key| !known.contains(key.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        anyhow::bail!(
            "workspace references unknown projects: {}",
            missing.join(", ")
        );
    }
    Ok(())
}

fn validate_workspace_navigation_refs(categories: &[String], entries: &[String]) -> Result<()> {
    let data = load_navigation_editor_data()?;
    let known_categories = data
        .categories
        .iter()
        .map(|category| category.title.as_str())
        .collect::<BTreeSet<_>>();
    let mut known_entries = BTreeSet::new();
    for category in &data.categories {
        for entry in &category.entries {
            known_entries.insert(entry.name.as_str().to_string());
            known_entries.insert(format!("{}/{}", category.title, entry.name));
        }
    }

    let missing_categories = categories
        .iter()
        .filter(|category| !known_categories.contains(category.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    let missing_entries = entries
        .iter()
        .filter(|entry| !known_entries.contains(entry.as_str()))
        .cloned()
        .collect::<Vec<_>>();

    if !missing_categories.is_empty() || !missing_entries.is_empty() {
        let detail = [
            (!missing_categories.is_empty())
                .then(|| format!("categories: {}", missing_categories.join(", "))),
            (!missing_entries.is_empty())
                .then(|| format!("entries: {}", missing_entries.join(", "))),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join("; ");
        anyhow::bail!("workspace references unknown navigation items: {detail}");
    }
    Ok(())
}

fn validate_proxy_profile_refs(config: &ProxyConfig, requested: &BTreeSet<String>) -> Result<()> {
    let known = config
        .profiles
        .iter()
        .flat_map(|profile| [profile.id.clone(), profile.name.clone()])
        .collect::<BTreeSet<_>>();
    let missing = requested
        .iter()
        .filter(|value| !known.contains(*value))
        .cloned()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        anyhow::bail!("unknown proxy profiles: {}", missing.join(", "));
    }
    Ok(())
}

fn normalize_cli_page(value: Option<String>) -> Option<String> {
    let value = value?;
    let trimmed = value.trim();
    match trimmed {
        "navigation" => Some("projects".to_string()),
        "deploy" => Some("build".to_string()),
        "overview" | "projects" | "merge" | "build" | "proxy" => Some(trimmed.to_string()),
        _ => None,
    }
}

fn normalize_cli_page_list(values: Vec<String>) -> Vec<String> {
    let mut pages = Vec::new();
    for value in values {
        let Some(page) = normalize_cli_page(Some(value)) else {
            continue;
        };
        if !pages.contains(&page) {
            pages.push(page);
        }
    }
    pages
}

fn list_projects(config: &AppConfig, json_mode: bool) -> Result<()> {
    list_projects_command(config, json_mode, "list")
}

fn list_projects_command(config: &AppConfig, json_mode: bool, command_name: &str) -> Result<()> {
    let projects = core::project_summaries(config);
    if json_mode {
        return print_json_command(command_name, &projects);
    }
    for project in projects {
        println!("{:<20} {}", project.key, project.name);
    }
    Ok(())
}

fn show_project(config: &AppConfig, key: &str, json_mode: bool) -> Result<()> {
    show_project_command(config, key, json_mode, "show")
}

fn show_project_command(
    config: &AppConfig,
    key: &str,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    let project = core::project_detail(config, key)?;
    if json_mode {
        return print_json_command(command_name, &project);
    }
    println!("project     : {}", project.name);
    println!("key         : {}", project.key);
    println!(
        "repo path   : {}",
        project
            .repo_path
            .unwrap_or_else(|| "<unconfigured>".to_string())
    );
    println!("git url     : {}", project.git_url);
    if !project.deploy_targets.is_empty() {
        println!("build targets:");
        for target in project.deploy_targets {
            println!("  {} ({}) -> {}", target.label, target.key, target.job_name);
        }
    }
    if let Some(current_branch) = project.current_branch {
        println!("branch      : {}", current_branch);
    }
    Ok(())
}

fn show_branch(config: &AppConfig, key: &str, json_mode: bool) -> Result<()> {
    show_branch_command(config, key, json_mode, "branch")
}

fn show_branch_command(
    config: &AppConfig,
    key: &str,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    let branch = core::branch_hint(config, key)?;
    if json_mode {
        return print_json_command(command_name, &json!({ "project": key, "branch": branch }));
    }
    println!("{branch}");
    Ok(())
}

fn show_branches(config: &AppConfig, key: &str, json_mode: bool) -> Result<()> {
    show_branches_command(config, key, json_mode, "branches")
}

fn show_branches_command(
    config: &AppConfig,
    key: &str,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    let branches = core::available_branches(config, key)?;
    if json_mode {
        return print_json_command(
            command_name,
            &json!({ "project": key, "branches": branches }),
        );
    }
    for branch in branches {
        println!("{branch}");
    }
    Ok(())
}

fn show_envs(config: &AppConfig, key: &str, target: Option<String>, json_mode: bool) -> Result<()> {
    show_envs_command(config, key, target, json_mode, "envs")
}

fn show_envs_command(
    config: &AppConfig,
    key: &str,
    target: Option<String>,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    let meta = core::deploy_target_meta(config, key, target.as_deref())?;
    let envs = meta
        .params
        .iter()
        .find(|param| {
            param.kind == "select"
                && matches!(param.key.as_str(), "ENV_PROFILE" | "projectEnv" | "env")
        })
        .map(|param| param.options.clone())
        .unwrap_or_default();
    if json_mode {
        return print_json_command(
            command_name,
            &json!({
                "project": key,
                "target": meta.selected_target,
                "envs": envs,
            }),
        );
    }
    for env in envs {
        println!("{env}");
    }
    Ok(())
}

fn show_options(
    config: &AppConfig,
    key: &str,
    target: Option<String>,
    json_mode: bool,
) -> Result<()> {
    show_options_command(config, key, target, json_mode, "options")
}

fn show_options_command(
    config: &AppConfig,
    key: &str,
    target: Option<String>,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    let options = core::deploy_target_meta(config, key, target.as_deref())?;
    if json_mode {
        return print_json_command(command_name, &options);
    }
    print_deploy_options(&options);
    Ok(())
}

fn run_project_config_command(
    command: ProjectCommands,
    config_override: Option<&Path>,
    json_mode: bool,
) -> Result<()> {
    match command {
        ProjectCommands::Add {
            key,
            name,
            category,
            repo_path,
            git_url,
        } => add_project_config_command(
            key,
            name,
            category,
            repo_path,
            git_url,
            config_override,
            json_mode,
        ),
        ProjectCommands::Update {
            project,
            name,
            category,
            repo_path,
            clear_repo_path,
            git_url,
        } => update_project_config_command(
            project,
            name,
            category,
            repo_path,
            clear_repo_path,
            git_url,
            config_override,
            json_mode,
        ),
        ProjectCommands::Delete { project } => {
            delete_project_config_command(project, config_override, json_mode)
        }
        ProjectCommands::SetCommand {
            project,
            kind,
            command,
            cwd,
            output_dir,
            env,
            clear_env,
            clear,
        } => set_project_command_config_command(
            project,
            kind,
            command,
            cwd,
            output_dir,
            env,
            clear_env,
            clear,
            config_override,
            json_mode,
        ),
        ProjectCommands::TargetAdd {
            project,
            key,
            label,
            adapter,
            action_kind,
            profile,
            job,
        } => add_project_target_config_command(
            project,
            key,
            label,
            adapter,
            action_kind,
            profile,
            job,
            config_override,
            json_mode,
        ),
        ProjectCommands::TargetUpdate {
            project,
            target,
            label,
            adapter,
            action_kind,
            profile,
            job,
        } => update_project_target_config_command(
            project,
            target,
            label,
            adapter,
            action_kind,
            profile,
            job,
            config_override,
            json_mode,
        ),
        ProjectCommands::TargetDelete { project, target } => {
            delete_project_target_config_command(project, target, config_override, json_mode)
        }
        ProjectCommands::TargetParamAdd {
            project,
            target,
            key,
            label,
            kind,
            default,
            options,
            required,
            true_value,
            false_value,
        } => add_project_target_param_config_command(
            project,
            target,
            key,
            label,
            kind,
            default,
            options,
            required,
            true_value,
            false_value,
            config_override,
            json_mode,
        ),
        ProjectCommands::TargetParamUpdate {
            project,
            target,
            param,
            label,
            kind,
            default,
            clear_default,
            options,
            clear_options,
            required,
            optional,
            true_value,
            clear_true_value,
            false_value,
            clear_false_value,
        } => update_project_target_param_config_command(
            project,
            target,
            param,
            label,
            kind,
            default,
            clear_default,
            options,
            clear_options,
            required,
            optional,
            true_value,
            clear_true_value,
            false_value,
            clear_false_value,
            config_override,
            json_mode,
        ),
        ProjectCommands::TargetParamDelete {
            project,
            target,
            param,
        } => delete_project_target_param_config_command(
            project,
            target,
            param,
            config_override,
            json_mode,
        ),
        _ => anyhow::bail!("unsupported project config command"),
    }
}

fn add_project_config_command(
    key: String,
    name: String,
    category: Option<String>,
    repo_path: Option<PathBuf>,
    git_url: Option<String>,
    config_override: Option<&Path>,
    json_mode: bool,
) -> Result<()> {
    let (mut config, config_path) = load_cli_config(config_override)?;
    let key = validate_cli_config_key("project", &key)?;
    if config.projects.iter().any(|project| project.key == key) {
        anyhow::bail!("project key already exists: {key}");
    }
    let name = require_non_empty_cli_value("project name", &name)?;
    let category = normalize_project_category(category);
    let repo_path = repo_path.map(normalize_cli_path_buf).transpose()?;
    let git_url = git_url
        .map(|value| value.trim().to_string())
        .unwrap_or_default();

    config.projects.push(ProjectConfig {
        key: key.clone(),
        name,
        category,
        repo_path,
        git_url,
        deploy_targets: Vec::new(),
        jobs: Jobs::default(),
        dev: None,
        build: None,
        focus: ProjectFocusConfig::default(),
        branch_rules: BranchRules::empty(),
        debug_profiles: Vec::new(),
    });

    save_config(&config_path, &config)?;
    print_project_config_result(&config, &config_path, &key, json_mode, "projects.add")
}

fn update_project_config_command(
    project: String,
    name: Option<String>,
    category: Option<String>,
    repo_path: Option<PathBuf>,
    clear_repo_path: bool,
    git_url: Option<String>,
    config_override: Option<&Path>,
    json_mode: bool,
) -> Result<()> {
    if clear_repo_path && repo_path.is_some() {
        anyhow::bail!("choose only one of --repo-path or --clear-repo-path");
    }

    let (mut config, config_path) = load_cli_config(config_override)?;
    let repo_path = repo_path.map(normalize_cli_path_buf).transpose()?;
    let project_config = find_project_config_mut(&mut config, &project)?;
    let project_key = project_config.key.clone();

    if let Some(name) = name {
        project_config.name = require_non_empty_cli_value("project name", &name)?;
    }
    if category.is_some() {
        project_config.category = normalize_project_category(category);
    }
    if clear_repo_path {
        project_config.repo_path = None;
    }
    if let Some(repo_path) = repo_path {
        project_config.repo_path = Some(repo_path);
    }
    if let Some(git_url) = git_url {
        project_config.git_url = git_url.trim().to_string();
    }

    save_config(&config_path, &config)?;
    print_project_config_result(
        &config,
        &config_path,
        &project_key,
        json_mode,
        "projects.update",
    )
}

fn delete_project_config_command(
    project: String,
    config_override: Option<&Path>,
    json_mode: bool,
) -> Result<()> {
    let (mut config, config_path) = load_cli_config(config_override)?;
    let original_len = config.projects.len();
    config.projects.retain(|item| item.key != project);
    if config.projects.len() == original_len {
        anyhow::bail!("project {project} not found");
    }

    save_config(&config_path, &config)?;
    if json_mode {
        return print_json_command(
            "projects.delete",
            &json!({
                "configPath": config_path.display().to_string(),
                "deletedProject": project,
                "projects": core::project_summaries(&config),
            }),
        );
    }
    println!("deleted project: {project}");
    println!("config path    : {}", config_path.display());
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn set_project_command_config_command(
    project: String,
    kind: ProjectCommandKind,
    command: Option<String>,
    cwd: Option<PathBuf>,
    output_dir: Option<PathBuf>,
    env: Vec<String>,
    clear_env: bool,
    clear: bool,
    config_override: Option<&Path>,
    json_mode: bool,
) -> Result<()> {
    if clear
        && (command.is_some()
            || cwd.is_some()
            || output_dir.is_some()
            || clear_env
            || !env.is_empty())
    {
        anyhow::bail!("choose only --clear or command update flags");
    }
    if !clear
        && command.is_none()
        && cwd.is_none()
        && output_dir.is_none()
        && !clear_env
        && env.is_empty()
    {
        anyhow::bail!("at least one command update flag is required");
    }

    let (mut config, config_path) = load_cli_config(config_override)?;
    let cwd = cwd.map(normalize_cli_path_buf).transpose()?;
    let output_dir = output_dir.map(normalize_cli_path_buf).transpose()?;
    let env_patch = parse_key_value_map(&env)?;
    let project_config = find_project_config_mut(&mut config, &project)?;
    let project_key = project_config.key.clone();
    let command_slot = match kind {
        ProjectCommandKind::Dev => &mut project_config.dev,
        ProjectCommandKind::Build => &mut project_config.build,
    };

    if clear {
        *command_slot = None;
    } else {
        let mut next = command_slot.take().unwrap_or_default();
        if let Some(command) = command {
            next.command = require_non_empty_cli_value("command", &command)?;
        }
        if let Some(cwd) = cwd {
            next.cwd = Some(cwd);
        }
        if let Some(output_dir) = output_dir {
            next.output_dir = Some(output_dir);
        }
        if clear_env {
            next.env.clear();
        }
        for (key, value) in env_patch {
            next.env.insert(key, value);
        }
        if next.command.trim().is_empty() {
            anyhow::bail!("command is required unless --clear is used");
        }
        *command_slot = Some(next);
    }

    save_config(&config_path, &config)?;
    print_project_config_result(
        &config,
        &config_path,
        &project_key,
        json_mode,
        "projects.set-command",
    )
}

fn add_project_target_config_command(
    project: String,
    key: String,
    label: String,
    adapter: Option<BuildAdapterArg>,
    action_kind: Option<BuildActionKindArg>,
    profile: Option<String>,
    job: Option<String>,
    config_override: Option<&Path>,
    json_mode: bool,
) -> Result<()> {
    let (mut config, config_path) = load_cli_config(config_override)?;
    let project_config = find_project_config_mut(&mut config, &project)?;
    let project_key = project_config.key.clone();
    let key = validate_cli_config_key("build target", &key)?;
    if project_config
        .deploy_targets
        .iter()
        .any(|target| target.key == key)
    {
        anyhow::bail!("build target key already exists for project {project_key}: {key}");
    }
    let label = require_non_empty_cli_value("build target label", &label)?;
    let adapter = adapter
        .map(Into::into)
        .unwrap_or(BuildTargetAdapter::Jenkins);
    let profile = profile.unwrap_or_default();
    let profile = if adapter == BuildTargetAdapter::Jenkins {
        require_non_empty_cli_value("jenkins profile", &profile)?
    } else {
        profile.trim().to_string()
    };
    let job = job.unwrap_or_default();
    let job = if adapter == BuildTargetAdapter::Jenkins {
        require_non_empty_cli_value("job name", &job)?
    } else {
        job.trim().to_string()
    };
    let action_kind = action_kind
        .map(Into::into)
        .unwrap_or_else(|| default_action_kind_for_adapter(&adapter));

    project_config.deploy_targets.push(DeployTargetConfig {
        key: key.clone(),
        label,
        adapter,
        action_kind,
        jenkins_profile: profile,
        job_name: job.clone(),
        params: Vec::new(),
    });
    if !job.is_empty() {
        sync_legacy_project_job(project_config, &key, &job);
    }

    save_config(&config_path, &config)?;
    print_project_config_result(
        &config,
        &config_path,
        &project_key,
        json_mode,
        "projects.target-add",
    )
}

fn update_project_target_config_command(
    project: String,
    target: String,
    label: Option<String>,
    adapter: Option<BuildAdapterArg>,
    action_kind: Option<BuildActionKindArg>,
    profile: Option<String>,
    job: Option<String>,
    config_override: Option<&Path>,
    json_mode: bool,
) -> Result<()> {
    if label.is_none()
        && adapter.is_none()
        && action_kind.is_none()
        && profile.is_none()
        && job.is_none()
    {
        anyhow::bail!("at least one build target update flag is required");
    }

    let (mut config, config_path) = load_cli_config(config_override)?;
    let project_config = find_project_config_mut(&mut config, &project)?;
    let project_key = project_config.key.clone();
    let target_config = project_config
        .deploy_targets
        .iter_mut()
        .find(|item| item.key == target)
        .ok_or_else(|| {
            anyhow::anyhow!("build target {target} not found for project {project_key}")
        })?;

    if let Some(label) = label {
        target_config.label = require_non_empty_cli_value("build target label", &label)?;
    }
    if let Some(adapter) = adapter {
        target_config.adapter = adapter.into();
    }
    if let Some(action_kind) = action_kind {
        target_config.action_kind = action_kind.into();
    }
    if let Some(profile) = profile {
        target_config.jenkins_profile = require_non_empty_cli_value("jenkins profile", &profile)?;
    }
    if let Some(job) = job {
        target_config.job_name = require_non_empty_cli_value("job name", &job)?;
    }
    let target_key = target_config.key.clone();
    let job_name = target_config.job_name.clone();
    sync_legacy_project_job(project_config, &target_key, &job_name);

    save_config(&config_path, &config)?;
    print_project_config_result(
        &config,
        &config_path,
        &project_key,
        json_mode,
        "projects.target-update",
    )
}

fn delete_project_target_config_command(
    project: String,
    target: String,
    config_override: Option<&Path>,
    json_mode: bool,
) -> Result<()> {
    let (mut config, config_path) = load_cli_config(config_override)?;
    let project_config = find_project_config_mut(&mut config, &project)?;
    let project_key = project_config.key.clone();
    let original_len = project_config.deploy_targets.len();
    project_config
        .deploy_targets
        .retain(|item| item.key != target);
    if project_config.deploy_targets.len() == original_len {
        anyhow::bail!("build target {target} not found for project {project_key}");
    }
    clear_legacy_project_job(project_config, &target);

    save_config(&config_path, &config)?;
    print_project_config_result(
        &config,
        &config_path,
        &project_key,
        json_mode,
        "projects.target-delete",
    )
}

#[allow(clippy::too_many_arguments)]
fn add_project_target_param_config_command(
    project: String,
    target: String,
    key: String,
    label: String,
    kind: DeployParamKindArg,
    default: Option<String>,
    options: Vec<String>,
    required: bool,
    true_value: Option<String>,
    false_value: Option<String>,
    config_override: Option<&Path>,
    json_mode: bool,
) -> Result<()> {
    let (mut config, config_path) = load_cli_config(config_override)?;
    let project_config = find_project_config_mut(&mut config, &project)?;
    let project_key = project_config.key.clone();
    let key = validate_cli_config_key("build param", &key)?;
    let target_key = {
        let target_config = find_project_target_config_mut(project_config, &target)?;
        if target_config.params.iter().any(|param| param.key == key) {
            anyhow::bail!(
                "build param key already exists for project {project_key} target {}: {key}",
                target_config.key
            );
        }

        target_config.params.push(DeployParamConfig {
            key: key.clone(),
            label: require_non_empty_cli_value("build param label", &label)?,
            kind: kind.into(),
            default: default.and_then(optional_cli_text),
            options: normalize_cli_strings(options),
            required,
            true_value: true_value.and_then(optional_cli_text),
            false_value: false_value.and_then(optional_cli_text),
        });
        target_config.key.clone()
    };
    sync_legacy_project_job_params(project_config, &target_key);

    save_config(&config_path, &config)?;
    print_project_config_result(
        &config,
        &config_path,
        &project_key,
        json_mode,
        "projects.target-param-add",
    )
}

#[allow(clippy::too_many_arguments)]
fn update_project_target_param_config_command(
    project: String,
    target: String,
    param: String,
    label: Option<String>,
    kind: Option<DeployParamKindArg>,
    default: Option<String>,
    clear_default: bool,
    options: Vec<String>,
    clear_options: bool,
    required: bool,
    optional: bool,
    true_value: Option<String>,
    clear_true_value: bool,
    false_value: Option<String>,
    clear_false_value: bool,
    config_override: Option<&Path>,
    json_mode: bool,
) -> Result<()> {
    if default.is_some() && clear_default {
        anyhow::bail!("choose only one of --default or --clear-default");
    }
    if !options.is_empty() && clear_options {
        anyhow::bail!("choose only one of --option or --clear-options");
    }
    if required && optional {
        anyhow::bail!("choose only one of --required or --optional");
    }
    if true_value.is_some() && clear_true_value {
        anyhow::bail!("choose only one of --true-value or --clear-true-value");
    }
    if false_value.is_some() && clear_false_value {
        anyhow::bail!("choose only one of --false-value or --clear-false-value");
    }
    if label.is_none()
        && kind.is_none()
        && default.is_none()
        && !clear_default
        && options.is_empty()
        && !clear_options
        && !required
        && !optional
        && true_value.is_none()
        && !clear_true_value
        && false_value.is_none()
        && !clear_false_value
    {
        anyhow::bail!("at least one build param update flag is required");
    }

    let (mut config, config_path) = load_cli_config(config_override)?;
    let project_config = find_project_config_mut(&mut config, &project)?;
    let project_key = project_config.key.clone();
    let target_key = {
        let target_config = find_project_target_config_mut(project_config, &target)?;
        let target_key = target_config.key.clone();
        let param_config = target_config
            .params
            .iter_mut()
            .find(|item| item.key == param)
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "build param {param} not found for project {project_key} target {target_key}"
                )
            })?;

        if let Some(label) = label {
            param_config.label = require_non_empty_cli_value("build param label", &label)?;
        }
        if let Some(kind) = kind {
            param_config.kind = kind.into();
        }
        if let Some(default) = default {
            param_config.default = optional_cli_text(default);
        }
        if clear_default {
            param_config.default = None;
        }
        if !options.is_empty() {
            param_config.options = normalize_cli_strings(options);
        }
        if clear_options {
            param_config.options.clear();
        }
        if required {
            param_config.required = true;
        }
        if optional {
            param_config.required = false;
        }
        if let Some(true_value) = true_value {
            param_config.true_value = optional_cli_text(true_value);
        }
        if clear_true_value {
            param_config.true_value = None;
        }
        if let Some(false_value) = false_value {
            param_config.false_value = optional_cli_text(false_value);
        }
        if clear_false_value {
            param_config.false_value = None;
        }
        target_key
    };
    sync_legacy_project_job_params(project_config, &target_key);

    save_config(&config_path, &config)?;
    print_project_config_result(
        &config,
        &config_path,
        &project_key,
        json_mode,
        "projects.target-param-update",
    )
}

fn delete_project_target_param_config_command(
    project: String,
    target: String,
    param: String,
    config_override: Option<&Path>,
    json_mode: bool,
) -> Result<()> {
    let (mut config, config_path) = load_cli_config(config_override)?;
    let project_config = find_project_config_mut(&mut config, &project)?;
    let project_key = project_config.key.clone();
    let target_key = {
        let target_config = find_project_target_config_mut(project_config, &target)?;
        let target_key = target_config.key.clone();
        let original_len = target_config.params.len();
        target_config.params.retain(|item| item.key != param);
        if target_config.params.len() == original_len {
            anyhow::bail!(
                "build param {param} not found for project {project_key} target {target_key}"
            );
        }
        target_key
    };
    sync_legacy_project_job_params(project_config, &target_key);

    save_config(&config_path, &config)?;
    print_project_config_result(
        &config,
        &config_path,
        &project_key,
        json_mode,
        "projects.target-param-delete",
    )
}

fn print_project_config_result(
    config: &AppConfig,
    config_path: &Path,
    project: &str,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    let project = core::project_detail(config, project)?;
    if json_mode {
        return print_json_command(
            command_name,
            &json!({
                "configPath": config_path.display().to_string(),
                "project": project,
            }),
        );
    }
    println!("project    : {} ({})", project.name, project.key);
    println!("config path: {}", config_path.display());
    Ok(())
}

fn find_project_config_mut<'a>(
    config: &'a mut AppConfig,
    project: &str,
) -> Result<&'a mut ProjectConfig> {
    config
        .projects
        .iter_mut()
        .find(|item| item.key == project)
        .ok_or_else(|| anyhow::anyhow!("project {project} not found"))
}

fn find_project_target_config_mut<'a>(
    project: &'a mut ProjectConfig,
    target: &str,
) -> Result<&'a mut DeployTargetConfig> {
    let project_key = project.key.clone();
    project
        .deploy_targets
        .iter_mut()
        .find(|item| item.key == target)
        .ok_or_else(|| anyhow::anyhow!("build target {target} not found for project {project_key}"))
}

fn validate_cli_config_key(kind: &str, value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() {
        anyhow::bail!("{kind} key is required");
    }
    if value.chars().any(char::is_whitespace) {
        anyhow::bail!("{kind} key must not contain whitespace");
    }
    Ok(value.to_string())
}

fn normalize_project_category(category: Option<String>) -> String {
    category
        .and_then(optional_cli_text)
        .unwrap_or_else(|| "Workspace".to_string())
}

fn sync_legacy_project_job(project: &mut ProjectConfig, target_key: &str, job_name: &str) {
    match target_key {
        "standard" => {
            project.jobs.standard.name = job_name.to_string();
        }
        "variant" => {
            let job = project.jobs.variant.get_or_insert_with(JobConfig::default);
            job.name = job_name.to_string();
        }
        _ => {}
    }
}

fn sync_legacy_project_job_params(project: &mut ProjectConfig, target_key: &str) {
    let Some(target) = project
        .deploy_targets
        .iter()
        .find(|target| target.key == target_key)
    else {
        return;
    };
    let params = target
        .params
        .iter()
        .map(|param| param.key.clone())
        .collect::<Vec<_>>();
    let default_params = target
        .params
        .iter()
        .filter_map(|param| {
            param
                .default
                .as_ref()
                .map(|value| (param.key.clone(), value.clone()))
        })
        .collect::<BTreeMap<_, _>>();

    match target_key {
        "standard" => {
            project.jobs.standard.params = params;
            project.jobs.standard.default_params = default_params;
        }
        "variant" => {
            let job = project.jobs.variant.get_or_insert_with(JobConfig::default);
            job.params = params;
            job.default_params = default_params;
        }
        _ => {}
    }
}

fn clear_legacy_project_job(project: &mut ProjectConfig, target_key: &str) {
    match target_key {
        "standard" => project.jobs.standard = JobConfig::default(),
        "variant" => project.jobs.variant = None,
        _ => {}
    }
}

fn run_projects(config: &AppConfig, command: ProjectCommands, json_mode: bool) -> Result<()> {
    match command {
        ProjectCommands::List => list_projects_command(config, json_mode, "projects.list"),
        ProjectCommands::Show { project } => {
            show_project_command(config, &project, json_mode, "projects.show")
        }
        ProjectCommands::Branch { project } => {
            show_branch_command(config, &project, json_mode, "projects.branch")
        }
        ProjectCommands::Branches { project } => {
            show_branches_command(config, &project, json_mode, "projects.branches")
        }
        ProjectCommands::Envs { project, target } => {
            show_envs_command(config, &project, target, json_mode, "projects.envs")
        }
        ProjectCommands::Options { project, target } => {
            show_options_command(config, &project, target, json_mode, "projects.options")
        }
        _ => anyhow::bail!("unsupported project read command"),
    }
}

fn plan_deploy(
    config: &AppConfig,
    project: String,
    target: Option<String>,
    env: Option<String>,
    branch: Option<String>,
    extra_params: Vec<String>,
    json_mode: bool,
) -> Result<()> {
    plan_deploy_command(
        config,
        project,
        target,
        env,
        branch,
        extra_params,
        json_mode,
        "plan",
    )
}

fn plan_deploy_command(
    config: &AppConfig,
    project: String,
    target: Option<String>,
    env: Option<String>,
    branch: Option<String>,
    extra_params: Vec<String>,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    let request = DeployRequest {
        project,
        target,
        variant: false,
        env,
        branch,
        extra_params: parse_extra_params_args(extra_params)?,
        params: BTreeMap::new(),
    };
    let plan = core::build_plan(config, &request)?;
    if json_mode {
        return print_json_command(command_name, &plan);
    }
    print_plan(&plan);
    Ok(())
}

fn trigger_deploy(
    config: &AppConfig,
    project: String,
    target: Option<String>,
    env: Option<String>,
    branch: Option<String>,
    extra_params: Vec<String>,
    json_mode: bool,
) -> Result<()> {
    trigger_deploy_command(
        config,
        project,
        target,
        env,
        branch,
        extra_params,
        json_mode,
        "trigger",
    )
}

fn trigger_deploy_command(
    config: &AppConfig,
    project: String,
    target: Option<String>,
    env: Option<String>,
    branch: Option<String>,
    extra_params: Vec<String>,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    let request = DeployRequest {
        project,
        target,
        variant: false,
        env,
        branch,
        extra_params: parse_extra_params_args(extra_params)?,
        params: BTreeMap::new(),
    };
    let result = core::trigger_deploy(config, &request)?;
    if json_mode {
        return print_json_command(command_name, &result);
    }
    print_plan(&result.plan);
    println!("triggered     : yes");
    println!("http status   : {}", result.status);
    if let Some(queue_url) = result.queue_url {
        println!("queue url     : {queue_url}");
    } else {
        println!("queue url     : <missing location header>");
    }
    if let Some(build_url) = result.build_url {
        println!("build url     : {build_url}");
    } else {
        println!("build url     : <not available>");
    }
    println!("build state   : {}", result.state_label);
    println!("detail        : {}", result.detail);
    Ok(())
}

fn show_status(
    config: &AppConfig,
    queue_url: Option<String>,
    build_url: Option<String>,
    json_mode: bool,
) -> Result<()> {
    show_status_command(config, queue_url, build_url, json_mode, "status")
}

fn show_status_command(
    config: &AppConfig,
    queue_url: Option<String>,
    build_url: Option<String>,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    let status = core::refresh_deploy_status(
        config,
        &StatusRequest {
            queue_url,
            build_url,
            project: None,
        },
    )?;
    if json_mode {
        return print_json_command(command_name, &status);
    }
    print_status(&status);
    Ok(())
}

fn run_deploy(config: &AppConfig, command: DeployCommands, json_mode: bool) -> Result<()> {
    match command {
        DeployCommands::Targets { project, target } => {
            show_options_command(config, &project, target, json_mode, "deploy.targets")
        }
        DeployCommands::Plan {
            project,
            target,
            env,
            branch,
            extra_params,
        } => plan_deploy_command(
            config,
            project,
            target,
            env,
            branch,
            extra_params,
            json_mode,
            "deploy.plan",
        ),
        DeployCommands::Trigger {
            project,
            target,
            env,
            branch,
            extra_params,
        } => trigger_deploy_command(
            config,
            project,
            target,
            env,
            branch,
            extra_params,
            json_mode,
            "deploy.trigger",
        ),
        DeployCommands::Status {
            queue_url,
            build_url,
        } => show_status_command(config, queue_url, build_url, json_mode, "deploy.status"),
        DeployCommands::History { project, limit } => {
            let storage = Storage::new_default().map_err(anyhow::Error::msg)?;
            let items = storage
                .list_deploy_history_filtered(project.as_deref(), limit)
                .map_err(anyhow::Error::msg)?;
            if json_mode {
                print_json_command("deploy.history", &items)
            } else {
                for item in items {
                    println!(
                        "{:<16} {:<8} {:<16} {}",
                        item.project_key, item.mode, item.state_label, item.updated_at
                    );
                }
                Ok(())
            }
        }
    }
}

fn run_build(config: &AppConfig, command: BuildCommands, json_mode: bool) -> Result<()> {
    match command {
        BuildCommands::Targets { project, target } => {
            show_options_command(config, &project, target, json_mode, "build.targets")
        }
        BuildCommands::Plan {
            project,
            target,
            env,
            branch,
            extra_params,
        } => plan_deploy_command(
            config,
            project,
            target,
            env,
            branch,
            extra_params,
            json_mode,
            "build.plan",
        ),
        BuildCommands::Run {
            project,
            target,
            env,
            branch,
            extra_params,
        }
        | BuildCommands::Trigger {
            project,
            target,
            env,
            branch,
            extra_params,
        } => trigger_deploy_command(
            config,
            project,
            target,
            env,
            branch,
            extra_params,
            json_mode,
            "build.run",
        ),
        BuildCommands::Status {
            queue_url,
            build_url,
        } => show_status_command(config, queue_url, build_url, json_mode, "build.status"),
        BuildCommands::History { project, limit } => {
            let storage = Storage::new_default().map_err(anyhow::Error::msg)?;
            let items = storage
                .list_deploy_history_filtered(project.as_deref(), limit)
                .map_err(anyhow::Error::msg)?;
            if json_mode {
                print_json_command("build.history", &items)
            } else {
                for item in items {
                    println!(
                        "{:<16} {:<8} {:<16} {}",
                        item.project_key, item.mode, item.state_label, item.updated_at
                    );
                }
                Ok(())
            }
        }
    }
}

fn show_merge_overview(
    config: &AppConfig,
    project: &str,
    source: &str,
    target: &str,
    json_mode: bool,
) -> Result<()> {
    show_merge_overview_command(config, project, source, target, json_mode, "merge-overview")
}

fn show_merge_overview_command(
    config: &AppConfig,
    project: &str,
    source: &str,
    target: &str,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    let overview = core::branch_commit_overview(config, project, source, target)?;
    if json_mode {
        return print_json_command(command_name, &overview);
    }
    print_merge_overview(&overview);
    Ok(())
}

fn migrate_projects_config(input: &Path, output: &Path, json_mode: bool) -> Result<()> {
    let content = fs::read_to_string(input)?;
    let mut value: toml::Value = toml::from_str(&content)?;
    let table = value
        .as_table_mut()
        .ok_or_else(|| anyhow::anyhow!("projects config root must be a TOML table"))?;

    if let Some(defaults) = table
        .get_mut("defaults")
        .and_then(toml::Value::as_table_mut)
    {
        let base_url = take_string(defaults, "jenkins_base_url").unwrap_or_default();
        let username = take_string(defaults, "jenkins_username").unwrap_or_default();
        let password = defaults.remove("jenkins_password");
        let password_env = take_string(defaults, "jenkins_password_env")
            .unwrap_or_else(|| "JENKINS_PASSWORD".to_string());
        let fallback = defaults.remove("jenkins_password_fallback_file");

        let profiles = defaults
            .entry("jenkins_profiles".to_string())
            .or_insert_with(|| toml::Value::Table(toml::map::Map::new()));
        let profiles_table = profiles
            .as_table_mut()
            .ok_or_else(|| anyhow::anyhow!("defaults.jenkins_profiles must be a TOML table"))?;
        let mut profile = toml::map::Map::new();
        profile.insert("base_url".to_string(), toml::Value::String(base_url));
        profile.insert("username".to_string(), toml::Value::String(username));
        profile.insert(
            "password_env".to_string(),
            toml::Value::String(password_env),
        );
        if let Some(value) = password {
            profile.insert("password".to_string(), value);
        }
        if let Some(value) = fallback {
            profile.insert("password_fallback_file".to_string(), value);
        }
        profiles_table.insert("default".to_string(), toml::Value::Table(profile));
    }

    if let Some(projects) = table
        .get_mut("projects")
        .and_then(toml::Value::as_array_mut)
    {
        for project in projects {
            let Some(project_table) = project.as_table_mut() else {
                continue;
            };
            let category = project_table
                .get("category")
                .and_then(toml::Value::as_str)
                .unwrap_or("Workspace");
            if category != "Workspace" {
                remove_local_deploy_targets(project_table);
                continue;
            }
            let Some(jobs) = project_table.remove("jobs") else {
                remove_local_deploy_targets(project_table);
                continue;
            };
            let Some(jobs_table) = jobs.as_table() else {
                continue;
            };
            let mut deploy_targets = Vec::new();
            for (key, job) in jobs_table {
                let Some(job_table) = job.as_table() else {
                    continue;
                };
                let Some(job_name) = job_table.get("name").and_then(toml::Value::as_str) else {
                    continue;
                };
                let default_params = job_table
                    .get("default_params")
                    .and_then(toml::Value::as_table);
                let mut target = toml::map::Map::new();
                target.insert("key".to_string(), toml::Value::String(key.clone()));
                target.insert(
                    "label".to_string(),
                    toml::Value::String(match key.as_str() {
                        "standard" => "标准".to_string(),
                        "variant" => "Variant".to_string(),
                        _ => key.clone(),
                    }),
                );
                target.insert(
                    "jenkins_profile".to_string(),
                    toml::Value::String("default".to_string()),
                );
                target.insert(
                    "job_name".to_string(),
                    toml::Value::String(job_name.to_string()),
                );

                let params = job_table
                    .get("params")
                    .and_then(toml::Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(toml::Value::as_str)
                            .map(|param| migrated_param(param, key, default_params))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                target.insert("params".to_string(), toml::Value::Array(params));
                deploy_targets.push(toml::Value::Table(target));
            }
            project_table.insert(
                "deploy_targets".to_string(),
                toml::Value::Array(deploy_targets),
            );
        }
    }

    let migrated = toml::to_string_pretty(&value)?;
    fs::write(output, migrated)?;
    if json_mode {
        return print_json_command(
            "migrate-config",
            &json!({
                "input": input.display().to_string(),
                "output": output.display().to_string(),
            }),
        );
    }
    println!("migrated      : {}", output.display());
    Ok(())
}

fn remove_local_deploy_targets(project_table: &mut toml::map::Map<String, toml::Value>) {
    let Some(targets) = project_table
        .get_mut("deploy_targets")
        .and_then(toml::Value::as_array_mut)
    else {
        return;
    };
    targets.retain(|target| {
        target
            .as_table()
            .and_then(|table| table.get("job_name"))
            .and_then(toml::Value::as_str)
            .is_none_or(|job_name| !job_name.starts_with("local/"))
    });
}

fn take_string(table: &mut toml::map::Map<String, toml::Value>, key: &str) -> Option<String> {
    table
        .remove(key)
        .and_then(|value| value.as_str().map(ToString::to_string))
}

fn migrated_param(
    key: &str,
    target: &str,
    defaults: Option<&toml::map::Map<String, toml::Value>>,
) -> toml::Value {
    let mut param = toml::map::Map::new();
    param.insert("key".to_string(), toml::Value::String(key.to_string()));
    param.insert("label".to_string(), toml::Value::String(param_label(key)));
    param.insert(
        "type".to_string(),
        toml::Value::String(param_kind(key).to_string()),
    );
    if let Some(default) = defaults
        .and_then(|values| values.get(key))
        .and_then(toml::Value::as_str)
    {
        param.insert(
            "default".to_string(),
            toml::Value::String(default.to_string()),
        );
    }
    if matches!(key, "ENV_PROFILE" | "projectEnv" | "env") {
        let options = env_options_for_param(key, target)
            .into_iter()
            .map(toml::Value::String)
            .collect();
        param.insert("options".to_string(), toml::Value::Array(options));
        param.insert("required".to_string(), toml::Value::Boolean(true));
    }
    if matches!(key, "BRANCH" | "branch" | "Branch") {
        param.insert("required".to_string(), toml::Value::Boolean(true));
    }
    if matches!(key, "IS_BUILD_ADMIN" | "IS_BUILD_MOBILE" | "IS_GRAY") {
        param
            .entry("default".to_string())
            .or_insert_with(|| toml::Value::String("否".to_string()));
        param.insert(
            "true_value".to_string(),
            toml::Value::String("是".to_string()),
        );
        param.insert(
            "false_value".to_string(),
            toml::Value::String("否".to_string()),
        );
    }
    toml::Value::Table(param)
}

fn param_kind(key: &str) -> &'static str {
    match key {
        "ENV_PROFILE" | "projectEnv" | "env" => "select",
        "BRANCH" | "branch" | "Branch" => "branch",
        "IS_BUILD_ADMIN" | "IS_BUILD_MOBILE" | "IS_GRAY" => "boolean",
        _ => "text",
    }
}

fn param_label(key: &str) -> String {
    match key {
        "ENV_PROFILE" | "projectEnv" | "env" => "环境",
        "BRANCH" | "branch" | "Branch" => "分支",
        "IS_BUILD_ADMIN" => "管理端",
        "IS_BUILD_MOBILE" => "移动端",
        "IS_GRAY" => "灰度发布",
        _ => key,
    }
    .to_string()
}

fn env_options_for_param(key: &str, target: &str) -> Vec<String> {
    match key {
        "projectEnv" => vec!["sit", "uat", "pre", "prod"],
        "env" => vec![
            "sit1", "sit2", "sit3", "uat", "uat1", "uat2", "uat3", "dc1", "dc2", "pre", "prod",
        ],
        "ENV_PROFILE" if target == "variant" => {
            vec!["sit1", "sit2", "sit3", "uat1", "uat2", "uat3", "dc1", "dc2"]
        }
        _ => vec![
            "sit1", "sit2", "sit3", "uat1", "uat2", "uat3", "dc1", "dc2", "pre", "pro",
        ],
    }
    .into_iter()
    .map(ToString::to_string)
    .collect()
}

fn run_merge(
    config: &AppConfig,
    project: String,
    source: String,
    target: String,
    json_mode: bool,
) -> Result<()> {
    run_merge_command(config, project, source, target, json_mode, "merge")
}

fn run_merge_command(
    config: &AppConfig,
    project: String,
    source: String,
    target: String,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    let result = core::execute_merge(
        config,
        &MergeRequest {
            project,
            source_branch: source,
            target_branch: target,
        },
    )?;
    if json_mode {
        return print_json_command(command_name, &result);
    }
    print_merge_result(&result);
    Ok(())
}

fn run_branch_sync(
    config: &AppConfig,
    project: String,
    source_branch: String,
    target_branches: Vec<String>,
    json_mode: bool,
) -> Result<()> {
    run_branch_sync_command(
        config,
        project,
        source_branch,
        target_branches,
        json_mode,
        "sync-branches",
    )
}

fn run_branch_sync_command(
    config: &AppConfig,
    project: String,
    source_branch: String,
    target_branches: Vec<String>,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    if target_branches.is_empty() {
        anyhow::bail!("at least one --target is required");
    }

    let result = execute_branch_sync(
        config,
        &BranchSyncRequest {
            project,
            source_branch,
            target_branches,
        },
    )?;
    if json_mode {
        return print_json_command(command_name, &result);
    }
    print_branch_task_result(&result);
    Ok(())
}

fn run_git(config: &AppConfig, command: GitCommands, json_mode: bool) -> Result<()> {
    match command {
        GitCommands::Current { project } => {
            show_branch_command(config, &project, json_mode, "git.current")
        }
        GitCommands::Branches { project } => {
            show_branches_command(config, &project, json_mode, "git.branches")
        }
        GitCommands::Overview {
            project,
            source,
            target,
        } => show_merge_overview_command(
            config,
            &project,
            &source,
            &target,
            json_mode,
            "git.overview",
        ),
        GitCommands::Merge {
            project,
            source,
            target,
        } => run_merge_command(config, project, source, target, json_mode, "git.merge"),
        GitCommands::MergeMany {
            project,
            source_branch,
            target_branches,
        } => run_branch_sync_command(
            config,
            project,
            source_branch,
            target_branches,
            json_mode,
            "git.merge-many",
        ),
        GitCommands::Create {
            projects,
            source_branch,
            target_branch,
        } => run_branch_create_command(
            config,
            projects,
            source_branch,
            target_branch,
            json_mode,
            "git.create",
        ),
        GitCommands::CloneBranch {
            project,
            source_branch,
            destination,
        } => run_branch_checkout_command(
            config,
            project,
            source_branch,
            destination,
            json_mode,
            "git.clone",
        ),
        GitCommands::Switch {
            project,
            target_branch,
        } => run_branch_switch_command(config, project, target_branch, json_mode, "git.switch"),
        GitCommands::PushStatus { project } => {
            run_push_status_command(config, project, json_mode, "git.push-status")
        }
        GitCommands::Push { project, message } => {
            run_push_branch_command(config, project, message, json_mode, "git.push")
        }
        GitCommands::History { project, limit } => {
            let storage = Storage::new_default().map_err(anyhow::Error::msg)?;
            let items = storage
                .list_merge_history_filtered(project.as_deref(), limit)
                .map_err(anyhow::Error::msg)?;
            if json_mode {
                print_json_command("git.history", &items)
            } else {
                for item in items {
                    println!(
                        "{:<16} {:<24} <- {:<24} {}",
                        item.project_key, item.target_branch, item.source_branch, item.created_at
                    );
                }
                Ok(())
            }
        }
    }
}

fn run_branch_create(
    config: &AppConfig,
    projects: Vec<String>,
    source_branch: String,
    target_branch: String,
    json_mode: bool,
) -> Result<()> {
    run_branch_create_command(
        config,
        projects,
        source_branch,
        target_branch,
        json_mode,
        "create-branch",
    )
}

fn run_branch_create_command(
    config: &AppConfig,
    projects: Vec<String>,
    source_branch: String,
    target_branch: String,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    if projects.is_empty() {
        anyhow::bail!("at least one --project is required");
    }

    let result = execute_branch_create(
        config,
        &BranchCreateRequest {
            projects,
            source_branch,
            target_branch,
        },
    )?;
    if json_mode {
        return print_json_command(command_name, &result);
    }
    print_branch_task_result(&result);
    Ok(())
}

fn run_branch_checkout(
    config: &AppConfig,
    project: String,
    source_branch: String,
    destination: PathBuf,
    json_mode: bool,
) -> Result<()> {
    run_branch_checkout_command(
        config,
        project,
        source_branch,
        destination,
        json_mode,
        "checkout-branch",
    )
}

fn run_branch_checkout_command(
    config: &AppConfig,
    project: String,
    source_branch: String,
    destination: PathBuf,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    let destination = normalize_cli_path(destination)?;
    let result = checkout_branch_to_directory(
        config,
        &BranchCheckoutRequest {
            project,
            source_branch,
            destination_dir: destination,
        },
    )?;
    if json_mode {
        return print_json_command(command_name, &result);
    }
    print_branch_task_result(&result);
    Ok(())
}

fn run_branch_switch(
    config: &AppConfig,
    project: String,
    target_branch: String,
    json_mode: bool,
) -> Result<()> {
    run_branch_switch_command(config, project, target_branch, json_mode, "switch-branch")
}

fn run_branch_switch_command(
    config: &AppConfig,
    project: String,
    target_branch: String,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    let result = execute_branch_switch(
        config,
        &BranchSwitchRequest {
            project,
            target_branch,
            repo_path: None,
        },
    )?;
    if json_mode {
        return print_json_command(command_name, &result);
    }
    print_branch_task_result(&result);
    Ok(())
}

fn run_push_status(config: &AppConfig, project: String, json_mode: bool) -> Result<()> {
    run_push_status_command(config, project, json_mode, "push-status")
}

fn run_push_status_command(
    config: &AppConfig,
    project: String,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    let status = branch_push_status(config, &project, None)?;
    if json_mode {
        return print_json_command(command_name, &status);
    }
    print_push_status(&status);
    Ok(())
}

fn run_push_branch(
    config: &AppConfig,
    project: String,
    message: Option<String>,
    json_mode: bool,
) -> Result<()> {
    run_push_branch_command(config, project, message, json_mode, "push-branch")
}

fn run_push_branch_command(
    config: &AppConfig,
    project: String,
    message: Option<String>,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    let commit_before_push = message
        .as_deref()
        .map(str::trim)
        .is_some_and(|value| !value.is_empty());
    let result = execute_branch_push(
        config,
        &BranchPushRequest {
            project,
            repo_path: None,
            commit_before_push,
            commit_message: message,
        },
    )?;
    if json_mode {
        return print_json_command(command_name, &result);
    }
    print_branch_task_result(&result);
    Ok(())
}

fn run_notes(command: NoteCommands, json_mode: bool) -> Result<()> {
    let storage = Storage::new_default().map_err(anyhow::Error::msg)?;
    match command {
        NoteCommands::List { limit } => {
            let notes = storage
                .search_notes(None, limit)
                .map_err(anyhow::Error::msg)?;
            if json_mode {
                print_json_command("notes.list", &notes)
            } else {
                print_note_summaries(&notes);
                Ok(())
            }
        }
        NoteCommands::Search { query, limit } => {
            let notes = storage
                .search_notes(Some(&query), limit)
                .map_err(anyhow::Error::msg)?;
            if json_mode {
                print_json_command("notes.search", &notes)
            } else {
                print_note_summaries(&notes);
                Ok(())
            }
        }
        NoteCommands::Get { id } => {
            let note = storage.get_note(&id).map_err(anyhow::Error::msg)?;
            if json_mode {
                print_json_command("notes.get", &note)
            } else {
                println!("id      : {}", note.id);
                println!("title   : {}", note.title);
                println!("tags    : {}", note.tags.join(", "));
                println!("pinned  : {}", note.is_pinned);
                println!("updated : {}", note.updated_at);
                println!("content :\n{}", note.content);
                Ok(())
            }
        }
        NoteCommands::Create { title } => {
            let note = storage
                .create_note(title.as_deref())
                .map_err(anyhow::Error::msg)?;
            if json_mode {
                print_json_command("notes.create", &note)
            } else {
                println!("created note: {} {}", note.id, note.title);
                Ok(())
            }
        }
        NoteCommands::Save {
            id,
            title,
            content,
            file,
            stdin,
            tags,
            pinned,
        } => {
            let content = resolve_note_content(content, file, stdin)?;
            let note = storage
                .save_note(SaveNoteRequest {
                    id,
                    title,
                    content,
                    tags,
                    is_pinned: pinned,
                })
                .map_err(anyhow::Error::msg)?;
            if json_mode {
                print_json_command("notes.save", &note)
            } else {
                println!("saved note: {} {}", note.id, note.title);
                Ok(())
            }
        }
        NoteCommands::Delete { id } => {
            storage.delete_note(&id).map_err(anyhow::Error::msg)?;
            if json_mode {
                print_json_command("notes.delete", &json!({ "deleted": true, "id": id }))
            } else {
                println!("deleted note: {id}");
                Ok(())
            }
        }
    }
}

fn run_navigation(command: NavigationCommands, json_mode: bool) -> Result<()> {
    match command {
        NavigationCommands::Path => {
            let path = navigation_file_path();
            if json_mode {
                print_json_command("navigation.path", &json!({ "path": path }))
            } else {
                println!("{path}");
                Ok(())
            }
        }
        NavigationCommands::List { limit } => {
            let paths = ensure_default_configs()?;
            let workspace = load_active_project_workspace(&paths)?;
            let entries = list_navigation_entries_for_workspace(&workspace, limit)?;
            if json_mode {
                print_json_command("navigation.list", &entries)
            } else {
                print_navigation_entries(&entries);
                Ok(())
            }
        }
        NavigationCommands::Search { query, limit } => {
            let paths = ensure_default_configs()?;
            let workspace = load_active_project_workspace(&paths)?;
            let entries = search_navigation_entries_for_workspace(&workspace, Some(&query), limit)?;
            if json_mode {
                print_json_command("navigation.search", &entries)
            } else {
                print_navigation_entries(&entries);
                Ok(())
            }
        }
        NavigationCommands::Open {
            name,
            category,
            query,
        } => {
            let paths = ensure_default_configs()?;
            let workspace = load_active_project_workspace(&paths)?;
            let (matched_category, entry) = find_navigation_entry_for_workspace(
                &workspace,
                name.as_deref(),
                category.as_deref(),
                query.as_deref(),
            )?;
            let result = open_navigation_entry(&entry)?;
            if json_mode {
                print_json_command(
                    "navigation.open",
                    &json!({
                        "category": {
                            "title": matched_category.title,
                            "shortLabel": matched_category.short_label
                        },
                        "entry": entry,
                        "result": result,
                    }),
                )
            } else {
                println!("{}", result.detail);
                println!("target: {}", result.url);
                Ok(())
            }
        }
        NavigationCommands::Add {
            category,
            name,
            kind,
            url,
            path,
            bundle_id,
            app_name,
            script,
            cwd,
            browser,
            browser_profile,
            runtime_profile,
            note,
            short_label,
            workspace,
        } => {
            let input = NavigationEntryCliInput {
                category,
                name,
                kind: Some(kind),
                new_name: None,
                url,
                path,
                bundle_id,
                app_name,
                script,
                cwd,
                browser,
                browser_profile,
                runtime_profile,
                note,
                short_label,
            };
            if let Some(workspace) = workspace {
                let workspace = add_workspace_navigation_entry(&workspace, input)?;
                if json_mode {
                    print_json_command("navigation.add", &workspace)
                } else {
                    print_navigation_entries(&list_navigation_entries_for_workspace(
                        &workspace, 24,
                    )?);
                    Ok(())
                }
            } else {
                let data = add_navigation_entry(input)?;
                if json_mode {
                    print_json_command("navigation.add", &data)
                } else {
                    print_navigation_entries(&list_navigation_entries_for_workspace(
                        &load_active_project_workspace(&ensure_default_configs()?)?,
                        24,
                    )?);
                    Ok(())
                }
            }
        }
        NavigationCommands::Update {
            category,
            name,
            new_name,
            kind,
            url,
            path,
            bundle_id,
            app_name,
            script,
            cwd,
            browser,
            browser_profile,
            runtime_profile,
            note,
            workspace,
        } => {
            let input = NavigationEntryCliInput {
                category,
                name,
                kind,
                new_name,
                url,
                path,
                bundle_id,
                app_name,
                script,
                cwd,
                browser,
                browser_profile,
                runtime_profile,
                note,
                short_label: None,
            };
            if let Some(workspace) = workspace {
                let workspace = update_workspace_navigation_entry(&workspace, input)?;
                if json_mode {
                    print_json_command("navigation.update", &workspace)
                } else {
                    println!("updated workspace navigation entry");
                    Ok(())
                }
            } else {
                let data = update_navigation_entry(input)?;
                if json_mode {
                    print_json_command("navigation.update", &data)
                } else {
                    println!("updated navigation entry");
                    Ok(())
                }
            }
        }
        NavigationCommands::Delete {
            category,
            name,
            workspace,
        } => {
            if let Some(workspace) = workspace {
                let workspace = delete_workspace_navigation_entry(&workspace, &category, &name)?;
                if json_mode {
                    print_json_command("navigation.delete", &workspace)
                } else {
                    println!("deleted workspace navigation entry: {category}/{name}");
                    Ok(())
                }
            } else {
                let data = delete_navigation_entry(&category, &name)?;
                if json_mode {
                    print_json_command("navigation.delete", &data)
                } else {
                    println!("deleted navigation entry: {category}/{name}");
                    Ok(())
                }
            }
        }
    }
}

struct NavigationEntryCliInput {
    category: String,
    name: String,
    kind: Option<String>,
    new_name: Option<String>,
    url: Option<String>,
    path: Option<String>,
    bundle_id: Option<String>,
    app_name: Option<String>,
    script: Option<String>,
    cwd: Option<String>,
    browser: Option<String>,
    browser_profile: Option<String>,
    runtime_profile: Option<String>,
    note: Option<String>,
    short_label: Option<String>,
}

fn add_navigation_entry(
    mut input: NavigationEntryCliInput,
) -> Result<rdevtool_core::navigation::NavigationData> {
    let mut data = load_navigation_editor_data()?;
    let category_title = require_non_empty_cli_value("navigation category", &input.category)?;
    let short_label = input.short_label.take().and_then(optional_cli_text);
    let entry = navigation_editor_entry_from_cli(input, None)?;
    let category = match data
        .categories
        .iter_mut()
        .find(|category| category.title == category_title)
    {
        Some(category) => category,
        None => {
            data.categories.push(NavigationEditorCategory {
                title: category_title.clone(),
                short_label: category_title.clone(),
                entries: Vec::new(),
            });
            data.categories
                .last_mut()
                .ok_or_else(|| anyhow::anyhow!("failed to create navigation category"))?
        }
    };
    if let Some(short_label) = short_label {
        category.short_label = short_label;
    }
    if category.entries.iter().any(|item| item.name == entry.name) {
        anyhow::bail!(
            "navigation entry already exists: {}/{}",
            category_title,
            entry.name
        );
    }
    category.entries.push(entry);
    save_navigation_editor_data(data)
}

fn update_navigation_entry(
    input: NavigationEntryCliInput,
) -> Result<rdevtool_core::navigation::NavigationData> {
    let mut data = load_navigation_editor_data()?;
    let category_title = require_non_empty_cli_value("navigation category", &input.category)?;
    let entry_name = require_non_empty_cli_value("navigation entry", &input.name)?;
    let category = data
        .categories
        .iter_mut()
        .find(|category| category.title == category_title)
        .ok_or_else(|| anyhow::anyhow!("navigation category not found: {category_title}"))?;
    let index = category
        .entries
        .iter()
        .position(|entry| entry.name == entry_name)
        .ok_or_else(|| {
            anyhow::anyhow!("navigation entry not found: {category_title}/{entry_name}")
        })?;
    let current = category.entries[index].clone();
    let next = navigation_editor_entry_from_cli(input, Some(current))?;
    if next.name != entry_name
        && category
            .entries
            .iter()
            .enumerate()
            .any(|(item_index, item)| item_index != index && item.name == next.name)
    {
        anyhow::bail!(
            "navigation entry already exists: {}/{}",
            category_title,
            next.name
        );
    }
    category.entries[index] = next;
    save_navigation_editor_data(data)
}

fn delete_navigation_entry(
    category_title: &str,
    entry_name: &str,
) -> Result<rdevtool_core::navigation::NavigationData> {
    let mut data = load_navigation_editor_data()?;
    let category_title = require_non_empty_cli_value("navigation category", category_title)?;
    let entry_name = require_non_empty_cli_value("navigation entry", entry_name)?;
    let category = data
        .categories
        .iter_mut()
        .find(|category| category.title == category_title)
        .ok_or_else(|| anyhow::anyhow!("navigation category not found: {category_title}"))?;
    let original_len = category.entries.len();
    category.entries.retain(|entry| entry.name != entry_name);
    if category.entries.len() == original_len {
        anyhow::bail!("navigation entry not found: {category_title}/{entry_name}");
    }
    save_navigation_editor_data(data)
}

fn add_workspace_navigation_entry(
    workspace_key: &str,
    mut input: NavigationEntryCliInput,
) -> Result<ProjectWorkspaceConfig> {
    let paths = ensure_default_configs()?;
    let mut workspace = load_project_workspace_by_key(&paths.project_workspaces, workspace_key)?;
    ensure_workspace_can_own_resources(&workspace)?;
    let category_title = require_non_empty_cli_value("navigation category", &input.category)?;
    let short_label = input.short_label.take().and_then(optional_cli_text);
    let entry = workspace_resource_entry_from_editor(
        navigation_editor_entry_from_cli(input, None)?,
        workspace.root_dir.as_deref(),
    )?;
    let category = workspace_resource_category_mut(&mut workspace, &category_title, short_label);
    if category.entries.iter().any(|item| item.name == entry.name) {
        anyhow::bail!(
            "workspace navigation entry already exists: {}/{}",
            category_title,
            entry.name
        );
    }
    category.entries.push(entry);
    save_project_workspace(&paths.project_workspaces, workspace)
}

fn update_workspace_navigation_entry(
    workspace_key: &str,
    input: NavigationEntryCliInput,
) -> Result<ProjectWorkspaceConfig> {
    let paths = ensure_default_configs()?;
    let mut workspace = load_project_workspace_by_key(&paths.project_workspaces, workspace_key)?;
    ensure_workspace_can_own_resources(&workspace)?;
    let category_title = require_non_empty_cli_value("navigation category", &input.category)?;
    let entry_name = require_non_empty_cli_value("navigation entry", &input.name)?;
    let root_dir = workspace.root_dir.clone();
    let category = workspace
        .resource_categories
        .iter_mut()
        .find(|category| category.title == category_title)
        .ok_or_else(|| {
            anyhow::anyhow!("workspace navigation category not found: {category_title}")
        })?;
    let index = category
        .entries
        .iter()
        .position(|entry| entry.name == entry_name)
        .ok_or_else(|| {
            anyhow::anyhow!("workspace navigation entry not found: {category_title}/{entry_name}")
        })?;
    let current = navigation_editor_entry_from_workspace_resource(&category.entries[index]);
    let next = workspace_resource_entry_from_editor(
        navigation_editor_entry_from_cli(input, Some(current))?,
        root_dir.as_deref(),
    )?;
    if next.name != entry_name
        && category
            .entries
            .iter()
            .enumerate()
            .any(|(item_index, item)| item_index != index && item.name == next.name)
    {
        anyhow::bail!(
            "workspace navigation entry already exists: {}/{}",
            category_title,
            next.name
        );
    }
    category.entries[index] = next;
    save_project_workspace(&paths.project_workspaces, workspace)
}

fn delete_workspace_navigation_entry(
    workspace_key: &str,
    category_title: &str,
    entry_name: &str,
) -> Result<ProjectWorkspaceConfig> {
    let paths = ensure_default_configs()?;
    let mut workspace = load_project_workspace_by_key(&paths.project_workspaces, workspace_key)?;
    ensure_workspace_can_own_resources(&workspace)?;
    let category_title = require_non_empty_cli_value("navigation category", category_title)?;
    let entry_name = require_non_empty_cli_value("navigation entry", entry_name)?;
    let category = workspace
        .resource_categories
        .iter_mut()
        .find(|category| category.title == category_title)
        .ok_or_else(|| {
            anyhow::anyhow!("workspace navigation category not found: {category_title}")
        })?;
    let original_len = category.entries.len();
    category.entries.retain(|entry| entry.name != entry_name);
    if category.entries.len() == original_len {
        anyhow::bail!("workspace navigation entry not found: {category_title}/{entry_name}");
    }
    workspace
        .resource_categories
        .retain(|category| !category.entries.is_empty());
    save_project_workspace(&paths.project_workspaces, workspace)
}

fn workspace_resource_category_mut<'a>(
    workspace: &'a mut ProjectWorkspaceConfig,
    category_title: &str,
    short_label: Option<String>,
) -> &'a mut ProjectWorkspaceResourceCategoryConfig {
    if let Some(index) = workspace
        .resource_categories
        .iter()
        .position(|category| category.title == category_title)
    {
        if let Some(short_label) = short_label {
            workspace.resource_categories[index].short_label = Some(short_label);
        }
        return &mut workspace.resource_categories[index];
    }

    workspace
        .resource_categories
        .push(ProjectWorkspaceResourceCategoryConfig {
            title: category_title.to_string(),
            short_label: Some(short_label.unwrap_or_else(|| category_title.to_string())),
            entries: Vec::new(),
        });
    workspace
        .resource_categories
        .last_mut()
        .expect("workspace resource category was just pushed")
}

fn workspace_resource_entry_from_editor(
    entry: NavigationEditorEntry,
    root_dir: Option<&Path>,
) -> Result<ProjectWorkspaceResourceEntryConfig> {
    let entry = ProjectWorkspaceResourceEntryConfig {
        name: entry.name,
        kind: Some(entry.kind),
        url: entry.url.unwrap_or_default(),
        browser: entry.browser,
        browser_profile: entry.browser_profile,
        runtime_profile: entry.runtime_profile,
        bundle_id: entry.bundle_id,
        app_name: entry.app_name,
        script: entry.script,
        path: entry.path,
        cwd: entry.cwd,
        note: entry.note,
    };
    validate_workspace_resource_entry(&entry, root_dir)?;
    Ok(entry)
}

fn navigation_editor_entry_from_workspace_resource(
    entry: &ProjectWorkspaceResourceEntryConfig,
) -> NavigationEditorEntry {
    NavigationEditorEntry {
        name: entry.name.clone(),
        kind: entry.kind.clone().unwrap_or_else(|| "url".to_string()),
        url: optional_cli_text(entry.url.clone()),
        browser: entry.browser.clone(),
        browser_profile: entry.browser_profile.clone(),
        runtime_profile: entry.runtime_profile.clone(),
        bundle_id: entry.bundle_id.clone(),
        app_name: entry.app_name.clone(),
        script: entry.script.clone(),
        path: entry.path.clone(),
        cwd: entry.cwd.clone(),
        note: entry.note.clone(),
    }
}

fn ensure_workspace_can_own_resources(workspace: &ProjectWorkspaceConfig) -> Result<()> {
    if workspace.is_system() {
        anyhow::bail!("system workspace cannot own dynamic navigation entries");
    }
    Ok(())
}

fn save_project_workspace(
    dir: &Path,
    workspace: ProjectWorkspaceConfig,
) -> Result<ProjectWorkspaceConfig> {
    let workspace = workspace.normalized();
    let path = dir.join(format!("{}.toml", workspace.key));
    save_project_workspace_config(&path, &workspace)?;
    Ok(workspace)
}

fn navigation_editor_entry_from_cli(
    input: NavigationEntryCliInput,
    current: Option<NavigationEditorEntry>,
) -> Result<NavigationEditorEntry> {
    let mut entry = current.unwrap_or_else(|| NavigationEditorEntry {
        name: String::new(),
        kind: "url".to_string(),
        url: None,
        browser: None,
        browser_profile: None,
        runtime_profile: None,
        bundle_id: None,
        app_name: None,
        script: None,
        path: None,
        cwd: None,
        note: None,
    });

    entry.name = match input.new_name {
        Some(name) => require_non_empty_cli_value("navigation entry name", &name)?,
        None if entry.name.is_empty() => {
            require_non_empty_cli_value("navigation entry name", &input.name)?
        }
        None => entry.name,
    };
    if let Some(kind) = input.kind {
        entry.kind = require_non_empty_cli_value("navigation entry kind", &kind)?;
    }
    apply_optional_cli_text(&mut entry.url, input.url);
    apply_optional_cli_text(&mut entry.path, input.path);
    apply_optional_cli_text(&mut entry.bundle_id, input.bundle_id);
    apply_optional_cli_text(&mut entry.app_name, input.app_name);
    apply_optional_cli_text(&mut entry.script, input.script);
    apply_optional_cli_text(&mut entry.cwd, input.cwd);
    apply_optional_cli_text(&mut entry.browser, input.browser);
    apply_optional_cli_text(&mut entry.browser_profile, input.browser_profile);
    apply_optional_cli_text(&mut entry.runtime_profile, input.runtime_profile);
    apply_optional_cli_text(&mut entry.note, input.note);
    Ok(entry)
}

fn apply_optional_cli_text(target: &mut Option<String>, value: Option<String>) {
    if let Some(value) = value {
        *target = optional_cli_text(value);
    }
}

fn run_proxy(
    command: ProxyCommands,
    config_override: Option<&Path>,
    json_mode: bool,
) -> Result<()> {
    match command {
        ProxyCommands::Path => {
            let path = ensure_proxy_config()?;
            if json_mode {
                print_json_command("proxy.path", &json!({ "path": path.display().to_string() }))
            } else {
                println!("{}", path.display());
                Ok(())
            }
        }
        ProxyCommands::List => {
            let info = load_proxy_cli_info(config_override)?;
            if json_mode {
                print_json_command("proxy.list", &info)
            } else {
                print_proxy_profiles(&info);
                Ok(())
            }
        }
        ProxyCommands::Show { profile } => {
            let mut info = load_proxy_cli_info(config_override)?;
            let Some(selected) = info
                .profiles
                .iter()
                .find(|item| item.id == profile || item.name == profile)
                .cloned()
            else {
                anyhow::bail!("proxy profile not found: {profile}");
            };
            let profile_id = selected.id.clone();
            info.profiles = vec![selected];
            info.rules.retain(|rule| rule.profile_id == profile_id);
            if json_mode {
                print_json_command("proxy.show", &info)
            } else {
                print_proxy_profiles(&info);
                Ok(())
            }
        }
        ProxyCommands::Add {
            id,
            name,
            listen_host,
            listen_port,
            upstream_base_url,
            upstream_proxy,
            workspace,
            global,
        } => {
            let profile = ProxyProfile {
                id: id.unwrap_or_default(),
                workspace_key: resolve_proxy_workspace_key(workspace, global)?,
                name,
                listen_host,
                listen_port,
                upstream_base_url: upstream_base_url.unwrap_or_default(),
                upstream_proxy: upstream_proxy.unwrap_or_default(),
                capture_body: true,
                max_body_bytes: 4096,
            };
            validate_proxy_profile(&profile)?;
            let path = ensure_proxy_config()?;
            upsert_proxy_profile(&path, profile)?;
            let info = load_proxy_cli_info(config_override)?;
            if json_mode {
                print_json_command("proxy.add", &info)
            } else {
                print_proxy_profiles(&info);
                Ok(())
            }
        }
        ProxyCommands::Update {
            profile,
            name,
            listen_host,
            listen_port,
            upstream_base_url,
            upstream_proxy,
            workspace,
            clear_workspace,
        } => {
            let path = ensure_proxy_config()?;
            let mut profile = find_proxy_profile(&load_proxy_config(&path)?, &profile)?;
            if let Some(name) = name {
                profile.name = name;
            }
            if let Some(listen_host) = listen_host {
                profile.listen_host = listen_host;
            }
            if let Some(listen_port) = listen_port {
                profile.listen_port = listen_port;
            }
            if let Some(upstream_base_url) = upstream_base_url {
                profile.upstream_base_url = upstream_base_url;
            }
            if let Some(upstream_proxy) = upstream_proxy {
                profile.upstream_proxy = upstream_proxy;
            }
            if clear_workspace && workspace.is_some() {
                anyhow::bail!("choose only one of --workspace or --clear-workspace");
            }
            if clear_workspace {
                profile.workspace_key = None;
            } else if workspace.is_some() {
                profile.workspace_key = resolve_proxy_workspace_key(workspace, false)?;
            }
            validate_proxy_profile(&profile)?;
            upsert_proxy_profile(&path, profile)?;
            let info = load_proxy_cli_info(config_override)?;
            if json_mode {
                print_json_command("proxy.update", &info)
            } else {
                print_proxy_profiles(&info);
                Ok(())
            }
        }
        ProxyCommands::Delete { profile } => {
            let path = ensure_proxy_config()?;
            let profile = find_proxy_profile(&load_proxy_config(&path)?, &profile)?;
            core_delete_proxy_profile(&path, &profile.id)?;
            let info = load_proxy_cli_info(config_override)?;
            if json_mode {
                print_json_command("proxy.delete", &info)
            } else {
                print_proxy_profiles(&info);
                Ok(())
            }
        }
        ProxyCommands::Export { profile, output } => {
            let path = ensure_proxy_config()?;
            let profile = find_proxy_profile(&load_proxy_config(&path)?, &profile)?;
            let pack = export_proxy_profile_pack(&path, &profile.id)?;
            if let Some(output) = output {
                let output = if output.is_absolute() {
                    output
                } else {
                    std::env::current_dir()?.join(output)
                };
                if let Some(parent) = output.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::write(&output, serde_json::to_string_pretty(&pack)?)?;
                let value = json!({
                    "path": output.display().to_string(),
                    "pack": pack,
                });
                if json_mode {
                    print_json_command("proxy.export", &value)
                } else {
                    println!("{}", output.display());
                    Ok(())
                }
            } else if json_mode {
                print_json_command("proxy.export", &pack)
            } else {
                print_json(&pack)
            }
        }
        ProxyCommands::Import {
            file,
            workspace,
            global,
        } => {
            let path = ensure_proxy_config()?;
            let before = load_proxy_config(&path)?
                .profiles
                .into_iter()
                .map(|profile| profile.id)
                .collect::<BTreeSet<_>>();
            let content = fs::read_to_string(&file).map_err(|error| {
                anyhow::anyhow!("failed to read proxy pack {}: {error}", file.display())
            })?;
            let mut pack: ProxyProfilePack = serde_json::from_str(&content).map_err(|error| {
                anyhow::anyhow!("failed to parse proxy pack {}: {error}", file.display())
            })?;
            let workspace_key = resolve_proxy_workspace_key(workspace, global)?;
            for profile in &mut pack.profiles {
                profile.workspace_key = workspace_key.clone();
            }
            let mut proxy_config = import_proxy_profile_pack(&path, pack)?;
            let imported_ids = proxy_config
                .profiles
                .iter()
                .filter(|profile| !before.contains(&profile.id))
                .map(|profile| profile.id.clone())
                .collect::<BTreeSet<_>>();
            if !imported_ids.is_empty() {
                for profile in &mut proxy_config.profiles {
                    if imported_ids.contains(&profile.id) {
                        profile.workspace_key = workspace_key.clone();
                    }
                }
                save_proxy_config(&path, &proxy_config)?;
            }
            let info = load_proxy_cli_info(config_override)?;
            if json_mode {
                print_json_command("proxy.import", &info)
            } else {
                print_proxy_profiles(&info);
                Ok(())
            }
        }
        ProxyCommands::RuleList { profile } => {
            let mut info = load_proxy_cli_info(config_override)?;
            if let Some(profile) = profile {
                let profile = find_proxy_profile_in_info(&info, &profile)?;
                info.profiles = vec![profile.clone()];
                info.rules.retain(|rule| rule.profile_id == profile.id);
            }
            if json_mode {
                print_json_command("proxy.rule-list", &info)
            } else {
                print_proxy_profiles(&info);
                print_proxy_rules(&info.rules);
                Ok(())
            }
        }
        ProxyCommands::RuleShow { rule } => {
            let mut info = load_proxy_cli_info(config_override)?;
            let selected = find_proxy_rule_in_info(&info, &rule)?;
            let profile_id = selected.profile_id.clone();
            info.profiles.retain(|profile| profile.id == profile_id);
            info.rules = vec![selected];
            if json_mode {
                print_json_command("proxy.rule-show", &info)
            } else {
                print_proxy_profiles(&info);
                print_proxy_rules(&info.rules);
                Ok(())
            }
        }
        ProxyCommands::RuleAdd {
            profile,
            id,
            name,
            priority,
            disabled,
            method,
            url_contains,
            path_prefix,
            header_name,
            header_contains,
            action,
            target_base_url,
            rewrite_prefix,
            request_headers,
            response_headers,
            outbound_mode,
            outbound_proxy,
            status,
            content_type,
            body,
            headers,
            delay_ms,
        } => {
            let path = ensure_proxy_config()?;
            let config = load_proxy_config(&path)?;
            let profile = find_proxy_profile(&config, &profile)?;
            let rule = build_proxy_rule_from_patch(
                None,
                ProxyRuleCliPatch {
                    profile: Some(profile.id),
                    id,
                    name: Some(name),
                    priority: Some(priority),
                    enabled: Some(!disabled),
                    method,
                    url_contains,
                    path_prefix,
                    header_name,
                    header_contains,
                    action: Some(action),
                    target_base_url,
                    rewrite_prefix,
                    request_headers,
                    response_headers,
                    outbound_mode,
                    outbound_proxy,
                    status,
                    content_type,
                    body,
                    headers,
                    delay_ms,
                },
            )?;
            validate_proxy_rule(&rule)?;
            upsert_proxy_rule(&path, rule)?;
            let info = load_proxy_cli_info(config_override)?;
            if json_mode {
                print_json_command("proxy.rule-add", &info)
            } else {
                print_proxy_profiles(&info);
                print_proxy_rules(&info.rules);
                Ok(())
            }
        }
        ProxyCommands::RuleUpdate {
            rule,
            profile,
            name,
            priority,
            enable,
            disable,
            method,
            url_contains,
            path_prefix,
            header_name,
            header_contains,
            action,
            target_base_url,
            rewrite_prefix,
            request_headers,
            response_headers,
            outbound_mode,
            outbound_proxy,
            status,
            content_type,
            body,
            headers,
            delay_ms,
        } => {
            if enable && disable {
                anyhow::bail!("choose only one of --enable or --disable");
            }
            let path = ensure_proxy_config()?;
            let config = load_proxy_config(&path)?;
            let current = find_proxy_rule(&config, &rule)?;
            let profile = profile
                .map(|profile| find_proxy_profile(&config, &profile).map(|profile| profile.id))
                .transpose()?;
            let rule = build_proxy_rule_from_patch(
                Some(current),
                ProxyRuleCliPatch {
                    profile,
                    id: None,
                    name,
                    priority,
                    enabled: enable.then_some(true).or_else(|| disable.then_some(false)),
                    method,
                    url_contains,
                    path_prefix,
                    header_name,
                    header_contains,
                    action,
                    target_base_url,
                    rewrite_prefix,
                    request_headers,
                    response_headers,
                    outbound_mode,
                    outbound_proxy,
                    status,
                    content_type,
                    body,
                    headers,
                    delay_ms,
                },
            )?;
            validate_proxy_rule(&rule)?;
            upsert_proxy_rule(&path, rule)?;
            let info = load_proxy_cli_info(config_override)?;
            if json_mode {
                print_json_command("proxy.rule-update", &info)
            } else {
                print_proxy_profiles(&info);
                print_proxy_rules(&info.rules);
                Ok(())
            }
        }
        ProxyCommands::RuleDelete { rule } => {
            let path = ensure_proxy_config()?;
            let rule = find_proxy_rule(&load_proxy_config(&path)?, &rule)?;
            core_delete_proxy_rule(&path, &rule.id)?;
            let info = load_proxy_cli_info(config_override)?;
            if json_mode {
                print_json_command("proxy.rule-delete", &info)
            } else {
                print_proxy_profiles(&info);
                print_proxy_rules(&info.rules);
                Ok(())
            }
        }
        ProxyCommands::Diagnose {
            profile,
            method,
            url,
            headers,
        } => {
            let info = load_proxy_cli_info(config_override)?;
            let selected_profile = select_proxy_profile_for_diagnosis(&info, profile.as_deref())?;
            let header_map = parse_key_value_map(&headers)?;
            let diagnosis = diagnose_proxy_request(
                &ProxyConfig {
                    profiles: info.profiles.clone(),
                    rules: info.rules.clone(),
                },
                &selected_profile.id,
                &method,
                &url,
                &header_map,
            )?;
            if json_mode {
                print_json_command("proxy.diagnose", &diagnosis)
            } else {
                print_proxy_diagnosis(&diagnosis);
                Ok(())
            }
        }
        ProxyCommands::BindRuntime {
            profile,
            runtime_profile,
            label,
            project,
            debug_profile,
            create_debug_profile,
            debug_profile_label,
            network_proxy,
            node_hook,
        } => {
            let (mut config, config_path) = load_cli_config(config_override)?;
            let proxy_path = ensure_proxy_config()?;
            let proxy_config = load_proxy_config(&proxy_path)?;
            let result = bind_proxy_runtime_profile(
                &mut config,
                &proxy_config,
                BindProxyRuntimeRequest {
                    proxy_profile: profile,
                    runtime_profile_key: runtime_profile,
                    runtime_profile_label: label,
                    project,
                    debug_profile,
                    create_debug_profile,
                    debug_profile_label,
                    enable_network_proxy: network_proxy,
                    node_hook,
                },
            )?;
            save_config(&config_path, &config)?;
            if json_mode {
                print_json_command("proxy.bind-runtime", &result)
            } else {
                println!(
                    "runtime      : {} ({})",
                    result.runtime_profile.label, result.runtime_profile.key
                );
                println!("proxy        : {}", result.runtime_profile.proxy_url);
                if let Some(debug_profile) = &result.project_debug_profile {
                    println!(
                        "project      : {} ({})",
                        debug_profile.project_name, debug_profile.project_key
                    );
                    println!(
                        "debug profile: {} ({})",
                        debug_profile.debug_profile_label, debug_profile.debug_profile_key
                    );
                }
                Ok(())
            }
        }
    }
}

fn run_runtime(config: &AppConfig, command: RuntimeCommands, json_mode: bool) -> Result<()> {
    match command {
        RuntimeCommands::Profiles => {
            let info = runtime_profiles(config);
            if json_mode {
                print_json_command("runtime.profiles", &info)
            } else {
                print_runtime_profiles(&info);
                Ok(())
            }
        }
        RuntimeCommands::ProfileShow { key } => {
            let profile =
                runtime_profile_show(config, &key).map_err(|error| anyhow::anyhow!(error))?;
            if json_mode {
                print_json_command("runtime.profile-show", &profile)
            } else {
                print_runtime_profile(&profile);
                Ok(())
            }
        }
        RuntimeCommands::Inspect {
            project,
            debug_profile,
        } => {
            let proxy_config = load_proxy_config(&default_proxy_path())?;
            let response =
                inspect_project_runtime(config, &proxy_config, &project, debug_profile.as_deref())
                    .map_err(|error| anyhow::anyhow!(error))?;
            if json_mode {
                print_json_command("runtime.inspect", &response)
            } else {
                print_runtime_inspect(&response);
                Ok(())
            }
        }
        RuntimeCommands::Preflight {
            project,
            debug_profile,
        } => {
            let response = project_runtime_preflight(config, &project, debug_profile.as_deref())
                .map_err(|error| anyhow::anyhow!(error))?;
            if json_mode {
                print_json_command("runtime.preflight", &response)
            } else {
                print_runtime_preflight(&response);
                Ok(())
            }
        }
        RuntimeCommands::Start {
            project,
            debug_profile,
            env,
        } => {
            let env_overrides = parse_key_value_map(&env)?;
            let response = start_project_runtime_detached(
                config,
                &project,
                debug_profile.as_deref(),
                &env_overrides,
            )
            .map_err(|error| anyhow::anyhow!(error))?;
            if json_mode {
                print_json_command("runtime.start", &response)
            } else {
                print_runtime_start(&response);
                Ok(())
            }
        }
        RuntimeCommands::Focus {
            project,
            debug_profile,
            url,
        } => {
            let response =
                focus_project_runtime(config, &project, debug_profile.as_deref(), url.as_deref())
                    .map_err(|error| anyhow::anyhow!(error))?;
            if json_mode {
                print_json_command("runtime.focus", &response)
            } else {
                print_runtime_focus(&response);
                Ok(())
            }
        }
        RuntimeCommands::Log {
            project,
            kind,
            max_lines,
            clear,
        } => {
            let kind = ProjectRuntimeLogKind::from(kind);
            let response = if clear {
                clear_project_runtime_log(config, &project, kind)
            } else {
                read_project_runtime_log(config, &project, kind, max_lines)
            }
            .map_err(|error| anyhow::anyhow!(error))?;
            if json_mode {
                print_json_command("runtime.log", &response)
            } else {
                print_runtime_log(&response);
                Ok(())
            }
        }
    }
}

fn print_runtime_profiles(info: &RuntimeProfilesResponse) {
    if info.profiles.is_empty() {
        println!("no runtime profiles configured");
        return;
    }
    for profile in &info.profiles {
        let mut parts = vec![profile.key.clone(), profile.label.clone()];
        if !profile.proxy_url.trim().is_empty() {
            parts.push(format!("browser proxy {}", profile.proxy_url));
        }
        if profile.network_proxy.enabled {
            parts.push(format!("network proxy {}", profile.network_proxy.proxy_url));
        }
        if profile.web_actions_enabled {
            parts.push(format!("cdp {}", profile.web_actions_port));
        }
        println!("{}", parts.join(" | "));
    }
}

fn print_runtime_profile(profile: &RuntimeProfileSummary) {
    println!("{} ({})", profile.label, profile.key);
    if let Some(browser) = profile.browser.as_ref() {
        println!("browser: {}", browser);
    }
    if let Some(profile_name) = profile.browser_profile.as_ref() {
        println!("browser profile: {}", profile_name);
    }
    if !profile.proxy_url.trim().is_empty() {
        println!("browser proxy: {}", profile.proxy_url);
    }
    if profile.network_proxy.enabled {
        println!("network proxy: {}", profile.network_proxy.proxy_url);
    }
    println!(
        "web actions: {}",
        if profile.web_actions_enabled {
            format!("enabled on {}", profile.web_actions_port)
        } else {
            "disabled".to_string()
        }
    );
}

fn print_runtime_preflight(response: &ProjectRuntimePreflightResponse) {
    println!(
        "{} ({}) - {}: {}",
        response.project_name, response.project_key, response.status_label, response.summary
    );
    if let Some(profile) = response.debug_profile_key.as_ref() {
        println!("debug profile: {}", profile);
    }
    if let Some(profile) = response.runtime_profile_key.as_ref() {
        println!("runtime profile: {}", profile);
    }
    for check in &response.checks {
        println!(
            "[{}] {} / {}: {}",
            check.status_label, check.category, check.title, check.detail
        );
        if let Some(action) = check.action.as_ref() {
            println!("  action: {}", action);
        }
    }
}

fn print_runtime_inspect(response: &ProjectRuntimeInspectResponse) {
    println!(
        "{} ({}) - {}: {}",
        response.project_name, response.project_key, response.status_label, response.summary
    );
    if let Some(path) = response.repo_path.as_ref() {
        println!("project path: {}", path);
    }
    if let Some(profile) = response.debug_profile_key.as_ref() {
        println!("debug profile: {}", profile);
    }
    if let Some(profile) = response.runtime_profile_key.as_ref() {
        println!("runtime profile: {}", profile);
    }
    if !response.local_files.is_empty() {
        println!("local files:");
        for file in &response.local_files {
            println!(
                "  [{}] {} ({}) - {}",
                file.status_label, file.path, file.mode, file.detail
            );
        }
    }
    if !response.proxies.is_empty() {
        println!("proxies:");
        for proxy in &response.proxies {
            let url = proxy.url.as_deref().unwrap_or("-");
            println!(
                "  [{}] {} {} - {}",
                proxy.status_label, proxy.label, url, proxy.detail
            );
        }
    }
    if !response.env_preview.is_empty() {
        println!("env preview:");
        for item in &response.env_preview {
            println!("  {}={} ({})", item.key, item.value, item.source);
        }
    }
    if !response.handoff.risks.is_empty() {
        println!("risks:");
        for risk in &response.handoff.risks {
            println!("  {}", risk);
        }
    }
}

fn print_runtime_start(response: &ProjectRuntimeStartResponse) {
    println!(
        "{} ({}) - {}: {}",
        response.project_name, response.project_key, response.status_label, response.detail
    );
    println!("command: {}", response.command);
    println!("cwd: {}", response.cwd);
    if let Some(pid) = response.pid {
        println!("pid: {}", pid);
    }
    if let Some(code) = response.exit_code {
        println!("exit code: {}", code);
    }
    println!("log: {}", response.log_path);
}

fn print_runtime_focus(response: &ProjectRuntimeFocusResponse) {
    println!(
        "{} ({}) - {}",
        response.project_name, response.project_key, response.detail
    );
    if let Some(url) = response.url.as_ref() {
        println!("url: {}", url);
    }
    if let Some(bundle_id) = response.bundle_id.as_ref() {
        println!("bundle: {}", bundle_id);
    }
}

fn print_runtime_log(response: &ProjectRuntimeLogResponse) {
    println!("log: {}", response.path);
    println!(
        "ready: {} - {}",
        response.ready_summary.status_label,
        response
            .ready_summary
            .detail
            .as_deref()
            .unwrap_or("no detail")
    );
    if let Some(run_id) = response.session_summary.run_id.as_ref() {
        println!("session: {}", run_id);
    }
    if response.truncated {
        println!("... truncated ...");
    }
    for line in &response.lines {
        println!("{}", line);
    }
}

fn run_web_actions(command: WebActionCommands, json_mode: bool) -> Result<()> {
    match command {
        WebActionCommands::Path => {
            let path = default_web_actions_path();
            if json_mode {
                print_json_command(
                    "web-actions.path",
                    &json!({ "path": path.display().to_string() }),
                )
            } else {
                println!("{}", path.display());
                Ok(())
            }
        }
        WebActionCommands::List { scope, url } => {
            let response = list_web_actions(scope.as_deref(), url.as_deref())?;
            if json_mode {
                print_json_command("web-actions.list", &response)
            } else {
                print_web_action_list(&response);
                Ok(())
            }
        }
        WebActionCommands::Targets => {
            let targets = list_web_action_targets()?;
            if json_mode {
                print_json_command("web-actions.targets", &targets)
            } else {
                print_web_action_targets(&targets);
                Ok(())
            }
        }
        WebActionCommands::Open { url } => {
            let target = open_web_action_target(&url)?;
            if json_mode {
                print_json_command("web-actions.open", &target)
            } else {
                print_web_action_targets(&[target]);
                Ok(())
            }
        }
        WebActionCommands::Run {
            action,
            target,
            scope,
            url,
            params,
            context_params,
        } => {
            let result = run_web_action(WebActionRunRequest {
                action_key: action,
                target_id: target,
                scope,
                url,
                params: parse_key_value_map(&params)?,
                context_params: parse_key_value_map(&context_params)?,
            })?;
            if json_mode {
                print_json_command("web-actions.run", &result)
            } else {
                print_web_action_result(&result);
                Ok(())
            }
        }
        WebActionCommands::Script {
            target,
            script,
            file,
            stdin,
            params,
        } => {
            let result = run_web_action_script(WebActionScriptRunRequest {
                target_id: target,
                script: resolve_web_action_script_content(script, file, stdin)?,
                params: parse_key_value_map(&params)?,
            })?;
            if json_mode {
                print_json_command("web-actions.script", &result)
            } else {
                print_web_action_result(&result);
                Ok(())
            }
        }
    }
}

fn print_web_action_list(response: &WebActionListResponse) {
    println!("config: {}", response.config_path);
    for action in &response.actions {
        let kind = format!("{:?}", action.kind).to_ascii_lowercase();
        let matches = if action.match_patterns.is_empty() {
            "-".to_string()
        } else {
            action.match_patterns.join(", ")
        };
        println!(
            "{:<24} {:<8} {} ({})",
            action.key, kind, action.name, matches
        );
    }
}

fn print_web_action_targets(targets: &[WebActionTarget]) {
    for target in targets {
        println!("{:<40} {} -> {}", target.id, target.title, target.url);
    }
}

fn print_web_action_result(result: &WebActionRunResult) {
    println!("action : {}", result.action_key);
    println!("target : {}", result.target_id);
    println!("title  : {}", result.title);
    println!("url    : {}", result.url);
    println!("success: {}", result.success);
    if let Some(error) = &result.error {
        println!("error  : {error}");
    } else if !result.result_text.trim().is_empty() {
        println!("{}", result.result_text);
    }
}

fn resolve_web_action_script_content(
    script: Option<String>,
    file: Option<PathBuf>,
    stdin: bool,
) -> Result<String> {
    let mut modes = 0usize;
    if script.is_some() {
        modes += 1;
    }
    if file.is_some() {
        modes += 1;
    }
    if stdin {
        modes += 1;
    }
    if modes > 1 {
        anyhow::bail!("choose only one of --script, --file, or --stdin");
    }
    if let Some(script) = script {
        return Ok(script);
    }
    if let Some(file) = file {
        return fs::read_to_string(&file).map_err(|error| {
            anyhow::anyhow!(
                "failed to read web action script {}: {error}",
                file.display()
            )
        });
    }
    if stdin {
        let mut buffer = String::new();
        io::stdin().read_to_string(&mut buffer).map_err(|error| {
            anyhow::anyhow!("failed to read web action script from stdin: {error}")
        })?;
        return Ok(buffer);
    }
    anyhow::bail!("temporary script is required; use --script, --file, or --stdin")
}

fn load_proxy_cli_info(config_override: Option<&Path>) -> Result<ProxyCliInfo> {
    let (config, _) = load_cli_config(config_override)?;
    let paths = ensure_default_configs()?;
    let app_workspace = load_workspace_config(&paths.workspace)?;
    let active_key = active_project_workspace_key(&app_workspace);
    let workspace = load_active_project_workspace(&paths)?;
    let path = ensure_proxy_config()?;
    let proxy_config = filter_proxy_config_for_workspace(load_proxy_config(&path)?, &workspace);

    Ok(ProxyCliInfo {
        path: path.display().to_string(),
        workspace: project_workspace_cli_info(workspace, &config, &active_key),
        profiles: proxy_config.profiles,
        rules: proxy_config.rules,
    })
}

fn resolve_proxy_workspace_key(workspace: Option<String>, global: bool) -> Result<Option<String>> {
    if global && workspace.is_some() {
        anyhow::bail!("choose only one of --workspace or --global");
    }
    if global {
        return Ok(None);
    }
    let paths = ensure_default_configs()?;
    if let Some(workspace) = workspace {
        let workspace = load_project_workspace_by_key(&paths.project_workspaces, &workspace)?;
        return Ok((!workspace.is_system()).then_some(workspace.key));
    }
    let workspace = load_active_project_workspace(&paths)?;
    Ok((!workspace.is_system()).then_some(workspace.key))
}

fn find_proxy_profile(config: &ProxyConfig, profile: &str) -> Result<ProxyProfile> {
    config
        .profiles
        .iter()
        .find(|item| item.id == profile || item.name == profile)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("proxy profile not found: {profile}"))
}

fn find_proxy_profile_in_info(info: &ProxyCliInfo, profile: &str) -> Result<ProxyProfile> {
    info.profiles
        .iter()
        .find(|item| item.id == profile || item.name == profile)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("proxy profile not visible in active workspace: {profile}"))
}

fn select_proxy_profile_for_diagnosis(
    info: &ProxyCliInfo,
    profile: Option<&str>,
) -> Result<ProxyProfile> {
    if let Some(profile) = profile.map(str::trim).filter(|value| !value.is_empty()) {
        return find_proxy_profile_in_info(info, profile);
    }
    match info.profiles.as_slice() {
        [profile] => Ok(profile.clone()),
        [] => anyhow::bail!("no proxy profile visible in active workspace"),
        _ => anyhow::bail!("multiple proxy profiles visible; pass --profile"),
    }
}

fn find_proxy_rule(config: &ProxyConfig, rule: &str) -> Result<ProxyRule> {
    config
        .rules
        .iter()
        .find(|item| item.id == rule || item.name == rule)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("proxy rule not found: {rule}"))
}

fn find_proxy_rule_in_info(info: &ProxyCliInfo, rule: &str) -> Result<ProxyRule> {
    info.rules
        .iter()
        .find(|item| item.id == rule || item.name == rule)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("proxy rule not visible in active workspace: {rule}"))
}

fn build_proxy_rule_from_patch(
    current: Option<ProxyRule>,
    patch: ProxyRuleCliPatch,
) -> Result<ProxyRule> {
    let current_action = current.as_ref().map(|rule| rule.action.clone());
    let mut rule = current.unwrap_or_else(|| ProxyRule {
        id: String::new(),
        profile_id: String::new(),
        enabled: true,
        name: String::new(),
        priority: 0,
        method: String::new(),
        url_contains: String::new(),
        path_prefix: String::new(),
        header_name: String::new(),
        header_contains: String::new(),
        action: ProxyRuleAction::default(),
    });

    let has_action_changes = patch.has_action_changes();
    let next_action = if has_action_changes {
        Some(build_proxy_rule_action(current_action, &patch)?)
    } else {
        None
    };

    if let Some(id) = patch.id {
        rule.id = id;
    }
    if let Some(profile) = patch.profile {
        rule.profile_id = profile;
    }
    if let Some(name) = patch.name {
        rule.name = name;
    }
    if let Some(priority) = patch.priority {
        rule.priority = priority;
    }
    if let Some(enabled) = patch.enabled {
        rule.enabled = enabled;
    }
    apply_cli_string(&mut rule.method, patch.method);
    apply_cli_string(&mut rule.url_contains, patch.url_contains);
    apply_cli_string(&mut rule.path_prefix, patch.path_prefix);
    apply_cli_string(&mut rule.header_name, patch.header_name);
    apply_cli_string(&mut rule.header_contains, patch.header_contains);

    if let Some(action) = next_action {
        rule.action = action;
    }

    Ok(rule)
}

impl ProxyRuleCliPatch {
    fn has_action_changes(&self) -> bool {
        self.action.is_some()
            || self.target_base_url.is_some()
            || self.rewrite_prefix.is_some()
            || !self.request_headers.is_empty()
            || !self.response_headers.is_empty()
            || self.outbound_mode.is_some()
            || self.outbound_proxy.is_some()
            || self.status.is_some()
            || self.content_type.is_some()
            || self.body.is_some()
            || !self.headers.is_empty()
            || self.delay_ms.is_some()
    }
}

fn build_proxy_rule_action(
    current: Option<ProxyRuleAction>,
    patch: &ProxyRuleCliPatch,
) -> Result<ProxyRuleAction> {
    let action_kind = patch
        .action
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_else(|| match &current {
            Some(ProxyRuleAction::Mock { .. }) => "mock".to_string(),
            Some(ProxyRuleAction::Block { .. }) => "block".to_string(),
            Some(ProxyRuleAction::Forward { .. }) | None => "forward".to_string(),
        });

    match action_kind.as_str() {
        "forward" => {
            let (
                mut target_base_url,
                mut rewrite_prefix,
                mut request_headers,
                mut response_headers,
                mut outbound_mode,
                mut outbound_proxy,
                mut delay_ms,
            ) = match current {
                Some(ProxyRuleAction::Forward {
                    target_base_url,
                    rewrite_prefix,
                    request_headers,
                    response_headers,
                    outbound_mode,
                    outbound_proxy,
                    delay_ms,
                }) => (
                    target_base_url,
                    rewrite_prefix,
                    request_headers,
                    response_headers,
                    outbound_mode,
                    outbound_proxy,
                    delay_ms,
                ),
                _ => (
                    String::new(),
                    String::new(),
                    BTreeMap::new(),
                    BTreeMap::new(),
                    ProxyOutboundMode::Inherit,
                    String::new(),
                    0,
                ),
            };
            apply_cli_string(&mut target_base_url, patch.target_base_url.clone());
            apply_cli_string(&mut rewrite_prefix, patch.rewrite_prefix.clone());
            if !patch.request_headers.is_empty() {
                request_headers = parse_key_value_map(&patch.request_headers)?;
            }
            if !patch.response_headers.is_empty() {
                response_headers = parse_key_value_map(&patch.response_headers)?;
            }
            if let Some(value) = patch.outbound_mode.as_deref() {
                outbound_mode = parse_proxy_outbound_mode(value)?;
            }
            apply_cli_string(&mut outbound_proxy, patch.outbound_proxy.clone());
            if let Some(value) = patch.delay_ms {
                delay_ms = value;
            }
            Ok(ProxyRuleAction::Forward {
                target_base_url,
                rewrite_prefix,
                request_headers,
                response_headers,
                outbound_mode,
                outbound_proxy,
                delay_ms,
            })
        }
        "mock" => {
            let (mut status, mut content_type, mut body, mut headers, mut delay_ms) = match current
            {
                Some(ProxyRuleAction::Mock {
                    status,
                    content_type,
                    body,
                    headers,
                    delay_ms,
                }) => (status, content_type, body, headers, delay_ms),
                _ => (
                    200,
                    "application/json; charset=utf-8".to_string(),
                    String::new(),
                    BTreeMap::new(),
                    0,
                ),
            };
            if let Some(value) = patch.status {
                status = value;
            }
            apply_cli_string(&mut content_type, patch.content_type.clone());
            apply_cli_string(&mut body, patch.body.clone());
            if !patch.headers.is_empty() {
                headers = parse_key_value_map(&patch.headers)?;
            }
            if let Some(value) = patch.delay_ms {
                delay_ms = value;
            }
            Ok(ProxyRuleAction::Mock {
                status,
                content_type,
                body,
                headers,
                delay_ms,
            })
        }
        "block" => {
            let (mut status, mut body, mut delay_ms) = match current {
                Some(ProxyRuleAction::Block {
                    status,
                    body,
                    delay_ms,
                }) => (status, body, delay_ms),
                _ => (403, String::new(), 0),
            };
            if let Some(value) = patch.status {
                status = value;
            }
            apply_cli_string(&mut body, patch.body.clone());
            if let Some(value) = patch.delay_ms {
                delay_ms = value;
            }
            Ok(ProxyRuleAction::Block {
                status,
                body,
                delay_ms,
            })
        }
        value => anyhow::bail!("unsupported proxy rule action: {value}"),
    }
}

fn apply_cli_string(target: &mut String, value: Option<String>) {
    if let Some(value) = value {
        *target = value.trim().to_string();
    }
}

fn parse_proxy_outbound_mode(value: &str) -> Result<ProxyOutboundMode> {
    match value.trim().to_ascii_lowercase().as_str() {
        "inherit" => Ok(ProxyOutboundMode::Inherit),
        "direct" => Ok(ProxyOutboundMode::Direct),
        "proxy" => Ok(ProxyOutboundMode::Proxy),
        _ => anyhow::bail!("outbound mode must be inherit, direct, or proxy"),
    }
}

fn parse_key_value_map(values: &[String]) -> Result<BTreeMap<String, String>> {
    let mut parsed = BTreeMap::new();
    for value in values {
        let (key, item_value) = value
            .split_once('=')
            .ok_or_else(|| anyhow::anyhow!("expected key=value: {value}"))?;
        let key = key.trim();
        if key.is_empty() {
            anyhow::bail!("key is required");
        }
        parsed.insert(key.to_string(), item_value.trim().to_string());
    }
    Ok(parsed)
}

fn filter_proxy_config_for_workspace(
    mut config: ProxyConfig,
    workspace: &ProjectWorkspaceConfig,
) -> ProxyConfig {
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

fn print_proxy_profiles(info: &ProxyCliInfo) {
    println!(
        "workspace : {} ({})",
        info.workspace.name, info.workspace.key
    );
    println!("path      : {}", info.path);
    println!("profiles  : {}", info.profiles.len());
    for profile in &info.profiles {
        println!(
            "  {:<18} {:<20} {}",
            profile.id,
            profile.name,
            profile.listen_url()
        );
    }
    println!("rules     : {}", info.rules.len());
}

fn print_proxy_rules(rules: &[ProxyRule]) {
    for rule in rules {
        println!(
            "  {:<18} {:<20} {:<8} {}",
            rule.id,
            rule.name,
            proxy_rule_action_label(&rule.action),
            if rule.enabled { "enabled" } else { "disabled" }
        );
    }
}

fn print_proxy_diagnosis(diagnosis: &ProxyRequestDiagnosis) {
    println!("{} - {}", diagnosis.status_label, diagnosis.summary);
    println!(
        "profile: {} ({}) {} listening={}",
        diagnosis.profile.name,
        diagnosis.profile.id,
        diagnosis.profile.listen_url,
        diagnosis.profile.listening
    );
    println!(
        "request: {} {}",
        diagnosis.request.method, diagnosis.request.path
    );
    if let Some(rule) = diagnosis.matched_rule.as_ref() {
        println!(
            "matched: {} ({}) action={} priority={}",
            rule.name, rule.id, rule.action, rule.priority
        );
    }
    if !diagnosis.warnings.is_empty() {
        println!("warnings:");
        for warning in &diagnosis.warnings {
            println!("  {}: {}", warning.key, warning.detail);
            if let Some(action) = warning.action.as_ref() {
                println!("    action: {}", action);
            }
        }
    }
    println!("rules:");
    for decision in &diagnosis.decisions {
        println!(
            "  {} [{}] priority={} matched={}",
            decision.rule_name, decision.action, decision.priority, decision.matched
        );
        for reason in decision.reasons.iter().filter(|reason| !reason.matched) {
            println!("    - {}: {}", reason.key, reason.detail);
        }
    }
}

fn proxy_rule_action_label(action: &ProxyRuleAction) -> &'static str {
    match action {
        ProxyRuleAction::Forward { .. } => "forward",
        ProxyRuleAction::Mock { .. } => "mock",
        ProxyRuleAction::Block { .. } => "block",
    }
}

fn active_workspace_project_filter_cli() -> Result<Option<BTreeSet<String>>> {
    let paths = ensure_default_configs()?;
    let workspace = load_active_project_workspace(&paths)?;
    if workspace.include_all_projects {
        return Ok(None);
    }
    Ok(Some(workspace.projects.into_iter().collect()))
}

fn list_deploy_history_for_workspace(
    storage: &Storage,
    project: Option<&str>,
    limit: usize,
) -> Result<Vec<DeployHistoryEntry>> {
    let filter = active_workspace_project_filter_cli()?;
    if let Some(project) = project {
        if filter
            .as_ref()
            .is_some_and(|project_keys| !project_keys.contains(project))
        {
            return Ok(Vec::new());
        }
        return storage
            .list_deploy_history_filtered(Some(project), limit)
            .map_err(anyhow::Error::msg);
    }
    match filter {
        None => storage
            .list_deploy_history_filtered(None, limit)
            .map_err(anyhow::Error::msg),
        Some(project_keys) if project_keys.is_empty() => Ok(Vec::new()),
        Some(project_keys) => Ok(storage
            .list_all_deploy_history()
            .map_err(anyhow::Error::msg)?
            .into_iter()
            .filter(|entry| project_keys.contains(&entry.project_key))
            .take(limit)
            .collect()),
    }
}

fn list_merge_history_for_workspace(
    storage: &Storage,
    project: Option<&str>,
    limit: usize,
) -> Result<Vec<MergeHistoryEntry>> {
    let filter = active_workspace_project_filter_cli()?;
    if let Some(project) = project {
        if filter
            .as_ref()
            .is_some_and(|project_keys| !project_keys.contains(project))
        {
            return Ok(Vec::new());
        }
        return storage
            .list_merge_history_filtered(Some(project), limit)
            .map_err(anyhow::Error::msg);
    }
    match filter {
        None => storage
            .list_merge_history_filtered(None, limit)
            .map_err(anyhow::Error::msg),
        Some(project_keys) if project_keys.is_empty() => Ok(Vec::new()),
        Some(project_keys) => Ok(storage
            .list_all_merge_history()
            .map_err(anyhow::Error::msg)?
            .into_iter()
            .filter(|entry| project_keys.contains(&entry.project_key))
            .take(limit)
            .collect()),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryReplayPreview {
    action: ReplayAction,
    preview: serde_json::Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryReplayRun {
    action: ReplayAction,
    result: serde_json::Value,
}

fn find_history_replay_action(storage: &Storage, id: &str) -> Result<ReplayAction> {
    let (kind, history_key) = replay_kind_and_history_key(id).ok_or_else(|| {
        anyhow::anyhow!("replay id must look like build:<historyKey> or merge:<historyKey>")
    })?;
    match kind {
        "build" | "deploy" => list_deploy_history_for_workspace(storage, None, 20)?
            .into_iter()
            .find(|entry| entry.history_key == history_key)
            .and_then(|entry| build_replay_action(&entry))
            .ok_or_else(|| anyhow::anyhow!("build replay action not found: {id}")),
        "merge" => list_merge_history_for_workspace(storage, None, 20)?
            .into_iter()
            .find(|entry| entry.history_key == history_key)
            .and_then(|entry| merge_replay_action(&entry))
            .ok_or_else(|| anyhow::anyhow!("merge replay action not found: {id}")),
        other => anyhow::bail!("unsupported replay kind: {other}"),
    }
}

fn preview_history_replay(config: &AppConfig, action: &ReplayAction) -> Result<serde_json::Value> {
    match action.kind.as_str() {
        "build" => {
            let request: DeployRequest = serde_json::from_value(action.request.clone())?;
            serde_json::to_value(core::build_plan(config, &request)?).map_err(anyhow::Error::from)
        }
        "merge" => {
            let request: MergeRequest = serde_json::from_value(action.request.clone())?;
            serde_json::to_value(core::branch_commit_overview(
                config,
                &request.project,
                &request.source_branch,
                &request.target_branch,
            )?)
            .map_err(anyhow::Error::from)
        }
        other => anyhow::bail!("unsupported replay kind: {other}"),
    }
}

fn run_history_replay(config: &AppConfig, action: &ReplayAction) -> Result<serde_json::Value> {
    match action.kind.as_str() {
        "build" => {
            let request: DeployRequest = serde_json::from_value(action.request.clone())?;
            serde_json::to_value(core::trigger_deploy(config, &request)?)
                .map_err(anyhow::Error::from)
        }
        "merge" => {
            let request: MergeRequest = serde_json::from_value(action.request.clone())?;
            serde_json::to_value(core::execute_merge(config, &request)?)
                .map_err(anyhow::Error::from)
        }
        other => anyhow::bail!("unsupported replay kind: {other}"),
    }
}

fn run_history(config: &AppConfig, command: HistoryCommands, json_mode: bool) -> Result<()> {
    let storage = Storage::new_default().map_err(anyhow::Error::msg)?;
    match command {
        HistoryCommands::Build { project, limit } => {
            let items = list_deploy_history_for_workspace(&storage, project.as_deref(), limit)?;
            if json_mode {
                print_json_command("history.build", &items)
            } else {
                print_build_history_items(items);
                Ok(())
            }
        }
        HistoryCommands::Deploy { project, limit } => {
            let items = list_deploy_history_for_workspace(&storage, project.as_deref(), limit)?;
            if json_mode {
                print_json_command("history.deploy", &items)
            } else {
                print_build_history_items(items);
                Ok(())
            }
        }
        HistoryCommands::Merge { project, limit } => {
            let items = list_merge_history_for_workspace(&storage, project.as_deref(), limit)?;
            if json_mode {
                print_json_command("history.merge", &items)
            } else {
                for item in items {
                    println!(
                        "{:<16} {:<24} <- {:<24} {}",
                        item.project_key, item.target_branch, item.source_branch, item.created_at
                    );
                }
                Ok(())
            }
        }
        HistoryCommands::ReplayPlan { id } => {
            let action = find_history_replay_action(&storage, &id)?;
            let preview = preview_history_replay(config, &action)?;
            let value = HistoryReplayPreview { action, preview };
            if json_mode {
                print_json_command("history.replay-plan", &value)
            } else {
                print_history_replay_preview(&value);
                Ok(())
            }
        }
        HistoryCommands::ReplayRun { id } => {
            let action = find_history_replay_action(&storage, &id)?;
            let result = run_history_replay(config, &action)?;
            let value = HistoryReplayRun { action, result };
            if json_mode {
                print_json_command("history.replay-run", &value)
            } else {
                print_history_replay_run(&value);
                Ok(())
            }
        }
    }
}

fn print_build_history_items(items: Vec<DeployHistoryEntry>) {
    for item in items {
        println!(
            "{:<16} {:<8} {:<16} {}",
            item.project_key, item.mode, item.state_label, item.updated_at
        );
    }
}

fn print_history_replay_preview(value: &HistoryReplayPreview) {
    println!("action       : {}", value.action.label);
    println!("id           : {}", value.action.id);
    println!("risk         : {}", value.action.risk_level);
    println!("preview cmd  : {}", value.action.preview_command.display);
    println!("run cmd      : {}", value.action.run_command.display);
}

fn print_history_replay_run(value: &HistoryReplayRun) {
    println!("action       : {}", value.action.label);
    println!("id           : {}", value.action.id);
    println!("risk         : {}", value.action.risk_level);
    println!("result       : done");
}

fn run_agent(
    context_input: Option<&(AppConfig, ProjectWorkspaceConfig, PathBuf)>,
    command: AgentCommands,
    json_mode: bool,
) -> Result<()> {
    match command {
        AgentCommands::Capabilities => {
            let value = capabilities();
            if json_mode {
                print_json_command("agent.capabilities", &value)
            } else {
                print_agent_capabilities(&value);
                Ok(())
            }
        }
        AgentCommands::Context {
            project,
            query,
            limit,
        } => {
            let (config, workspace, _) = context_input
                .ok_or_else(|| anyhow::anyhow!("config is required for agent context"))?;
            let storage = Storage::new_default().map_err(anyhow::Error::msg)?;
            let value = context_for_workspace(
                config,
                &storage,
                Some(workspace),
                project.as_deref(),
                query.as_deref(),
                limit,
            )?;
            if json_mode {
                print_json_command("agent.context", &value)
            } else {
                print_agent_context(&value);
                Ok(())
            }
        }
    }
}

fn print_json<T: Serialize>(value: &T) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

fn print_json_command<T: Serialize>(command: &str, value: &T) -> Result<()> {
    print_json(&json!({
        "ok": true,
        "command": command,
        "data": value,
    }))
}

fn print_json_error(code: &str, message: &str) -> Result<()> {
    print_json(&json!({
        "ok": false,
        "error": {
            "code": code,
            "message": message,
        }
    }))
}

fn normalize_cli_path(path: PathBuf) -> Result<String> {
    let normalized = if path.is_absolute() {
        path
    } else {
        std::env::current_dir()?.join(path)
    };
    Ok(normalized.display().to_string())
}

fn normalize_cli_path_buf(path: PathBuf) -> Result<PathBuf> {
    if path.is_absolute() {
        Ok(path)
    } else {
        Ok(std::env::current_dir()?.join(path))
    }
}

fn resolve_note_content(
    content: Option<String>,
    file: Option<PathBuf>,
    stdin: bool,
) -> Result<String> {
    let mut modes = 0usize;
    if content.is_some() {
        modes += 1;
    }
    if file.is_some() {
        modes += 1;
    }
    if stdin {
        modes += 1;
    }

    if modes > 1 {
        anyhow::bail!("choose only one of --content, --file, or --stdin");
    }

    if let Some(content) = content {
        return Ok(content);
    }

    if let Some(file) = file {
        return fs::read_to_string(&file).map_err(|error| {
            anyhow::anyhow!("failed to read note file {}: {error}", file.display())
        });
    }

    if stdin {
        let mut buffer = String::new();
        io::stdin()
            .read_to_string(&mut buffer)
            .map_err(|error| anyhow::anyhow!("failed to read note content from stdin: {error}"))?;
        return Ok(buffer);
    }

    Ok(String::new())
}

fn print_note_summaries(notes: &[storage::NoteSummary]) {
    for note in notes {
        println!("{:<36} {}", note.id, note.title);
    }
}

fn print_navigation_entries(entries: &[NavigationIndexEntry]) {
    for entry in entries {
        println!(
            "[{}] {} -> {}",
            entry.category_short_label, entry.name, entry.target_label
        );
    }
}

fn print_agent_capabilities(value: &AgentCapabilities) {
    println!("app          : {}", value.app_name);
    println!("version      : {}", value.app_version);
    println!("storage path : {}", value.storage_path);
    println!("features:");
    for feature in &value.features {
        println!("  - {feature}");
    }
    println!("commands:");
    for command in &value.commands {
        println!("  - {command}");
    }
}

fn print_agent_context(value: &AgentContext) {
    println!("app          : {}", value.app.app_name);
    println!("version      : {}", value.app.app_version);
    println!("storage path : {}", value.app.storage_path);
    if let Some(workspace) = &value.workspace {
        println!("workspace    : {} ({})", workspace.name, workspace.key);
    }
    println!("projects     : {}", value.projects.len());
    println!("notes        : {}", value.notes.len());
    println!("build hist   : {}", value.build_history.len());
    println!("merge hist   : {}", value.merge_history.len());
    println!("replayable   : {}", value.replay_actions.len());
    println!("navigation   : {}", value.navigation.len());
    if let Some(project) = &value.project {
        println!("project      : {}", project.detail.name);
        if let Some(branch) = &project.suggested_branch {
            println!("branch hint  : {branch}");
        }
    }
}

fn print_doctor_report(value: &DoctorReport) {
    println!("status        : {}", doctor_status_label(value.status));
    println!("warnings      : {}", value.warning_count);
    println!("errors        : {}", value.error_count);
    println!("config dir    : {}", value.paths.config_dir);
    println!("projects      : {}", value.paths.projects);
    println!("workspace     : {}", value.paths.workspace);
    println!("workspaces dir: {}", value.paths.workspaces_dir);
    println!("navigation    : {}", value.paths.navigation);
    println!("proxy         : {}", value.paths.proxy);
    println!("web actions   : {}", value.paths.web_actions);
    println!("storage       : {}", value.paths.storage);
    if let Some(workspace) = &value.active_workspace {
        println!("active scope  : {} ({})", workspace.name, workspace.key);
    }
    println!("checks:");
    for check in &value.checks {
        println!(
            "  [{}] {:<20} {}",
            doctor_status_label(check.status),
            check.code,
            check.message
        );
        if let Some(detail) = &check.detail {
            println!("      {detail}");
        }
    }
}

fn doctor_status_label(status: DoctorStatus) -> &'static str {
    match status {
        DoctorStatus::Ok => "ok",
        DoctorStatus::Warning => "warn",
        DoctorStatus::Error => "error",
    }
}

fn print_workspace_preferences(value: &WorkspacePreferenceInfo) {
    println!("workspace path : {}", value.workspace_path);
    println!("active scope   : {}", value.active_workspace);
    println!("style mode     : {}", value.style_mode);
    println!(
        "default page   : {}",
        value.default_page.as_deref().unwrap_or("<default>")
    );
    println!(
        "enabled pages  : {}",
        if value.enabled_pages.is_empty() {
            "<default>".to_string()
        } else {
            value.enabled_pages.join(", ")
        }
    );
}

fn print_plan(plan: &core::DeployPlan) {
    println!("project       : {}", plan.project_name);
    println!("job kind      : {}", plan.job_kind);
    println!("adapter       : {}", plan.adapter);
    println!("action        : {}", plan.action_kind);
    if plan.adapter == "jenkins" {
        println!("jenkins job   : {}", plan.job_name);
        println!("jenkins base  : {}", plan.jenkins_base_url);
        println!("trigger url   : {}", plan.trigger_url);
    } else {
        println!("command       : {}", plan.command.as_deref().unwrap_or(""));
        println!("cwd           : {}", plan.cwd.as_deref().unwrap_or(""));
        if let Some(output_dir) = &plan.output_dir {
            println!("output dir    : {output_dir}");
        }
    }
    println!("parameters:");
    for (key, value) in &plan.params {
        println!("  {key} = {value}");
    }
}

fn print_status(status: &BuildStatusResponse) {
    println!("build state   : {}", status.state_label);
    if let Some(queue_url) = &status.queue_url {
        println!("queue url     : {queue_url}");
    }
    if let Some(build_url) = &status.build_url {
        println!("build url     : {build_url}");
    }
    println!("detail        : {}", status.detail);
}

fn print_deploy_options(options: &DeployTargetMeta) {
    println!("target        : {}", options.selected_target);
    println!("parameters:");
    for param in &options.params {
        println!(
            "  {} ({}) default={}",
            param.key, param.kind, param.default_value
        );
    }
}

fn print_merge_overview(overview: &BranchCommitOverview) {
    println!("source:");
    print_commit("  ", overview.source.as_ref());
    println!("target:");
    print_commit("  ", overview.target.as_ref());
}

fn print_merge_result(result: &MergeResponse) {
    println!("project       : {}", result.project_name);
    println!("target        : {}", result.target_branch);
    println!("source        : {}", result.source_branch);
    println!(
        "mode          : {}",
        if result.remote {
            "gitlab-api"
        } else {
            "local-worktree"
        }
    );
    println!("summary       : {}", result.summary);
    if let Some(sha) = &result.merged_commit {
        println!("merge commit  : {sha}");
    }
    println!("detail        : {}", result.detail);
}

fn print_push_status(status: &BranchPushStatus) {
    println!("project       : {}", status.project_name);
    println!("repo path     : {}", status.repo_path);
    println!("branch        : {}", status.current_branch);
    if let Some(upstream) = &status.upstream_branch {
        println!("upstream      : {upstream}");
    }
    println!("ahead         : {}", status.ahead);
    println!("behind        : {}", status.behind);
    println!("clean         : {}", status.clean);
    println!("staged        : {}", status.staged_count);
    println!("unstaged      : {}", status.unstaged_count);
    println!("untracked     : {}", status.untracked_count);
    println!("conflicted    : {}", status.conflicted_count);
    println!("files         : {}", status.files.len());
    if let Some(commit) = &status.latest_commit {
        println!("latest commit : {} {}", commit.short_hash, commit.subject);
    }
}

fn print_branch_task_result(result: &BranchTaskResponse) {
    println!("task          : {}", result.task_kind);
    println!("summary       : {}", result.summary);
    println!("detail        : {}", result.detail);
    println!("items         : {}", result.items.len());
    for item in &result.items {
        println!(
            "  - {:<18} {:<8} {}",
            item.project_key, item.status_label, item.summary
        );
        if let Some(target_branch) = &item.target_branch {
            println!("    target     : {target_branch}");
        }
        if let Some(output_path) = &item.output_path {
            println!("    output     : {output_path}");
        }
        if !item.detail.is_empty() {
            println!("    detail     : {}", item.detail);
        }
    }
}

fn print_commit(prefix: &str, commit: Option<&core::BranchCommitInfo>) {
    if let Some(commit) = commit {
        println!("{prefix}hash   : {}", commit.short_hash);
        println!("{prefix}date   : {}", commit.committed_at);
        println!("{prefix}subject: {}", commit.subject);
    } else {
        println!("{prefix}<missing>");
    }
}
