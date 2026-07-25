mod desktop;
mod tui;

use anyhow::Result;
use clap::{Args, Parser, Subcommand, ValueEnum, error::ErrorKind};
use rdevtool_core::agent::{
    AgentCapabilities, AgentContext, AgentContextOptions, AgentContextPreset, AgentContextSection,
    capabilities, context_for_workspace, context_for_workspace_with_options_and_paths,
};
use rdevtool_core::artifacts::{
    ManagedArtifactCleanupPlanResponse, ManagedArtifactCleanupQuery,
    ManagedArtifactInventoryResponse, ManagedArtifactQuery, managed_artifact_cleanup_plan,
    managed_artifact_inventory,
};
use rdevtool_core::config::{
    AppConfig, BranchRules, BuildActionKind, BuildArtifactConfig, BuildTargetAdapter, ConfigPaths,
    CreateProjectWorkspaceRequest, DeployParamConfig, DeployParamKind, DeployTargetConfig,
    JobConfig, Jobs, ProjectConfig, ProjectDebugProfileConfig, ProjectDebugReadyProbeConfig,
    ProjectFocusConfig, ProjectWorkspaceConfig, ProjectWorkspaceProjectInstanceConfig,
    ProjectWorkspaceResourceCategoryConfig, ProjectWorkspaceResourceEntryConfig,
    SYSTEM_PROJECT_WORKSPACE_KEY, active_project_workspace_key, apply_project_workspace_context,
    create_project_workspace, default_config_dir, default_project_workspace_root_dir,
    default_project_workspaces_dir, default_projects_path, default_workspace_path,
    ensure_default_configs, load_active_project_workspace, load_config,
    load_project_workspace_by_key, load_project_workspaces, load_workspace_config,
    resolve_config_path, save_config, save_project_workspace_config, save_workspace_config,
};
use rdevtool_core::config_sources::{
    CopyConfigSourceRequest, compare_config_sources, config_sources_file_path, copy_config_source,
    list_config_sources, preferred_config_source_id_for_scope, resolve_config_source,
    save_config_source_preference,
};
use rdevtool_core::core::{
    self, BranchCheckoutRequest, BranchCommitOverview, BranchCreateRequest, BranchFileDiffRequest,
    BranchFileDiffResponse, BranchPushRequest, BranchPushStatus, BranchSwitchRequest,
    BranchSyncRequest, BranchTaskResponse, BuildStatusResponse, BuildTriggerResponse,
    DeployRequest, DeployTargetMeta, MergeRequest, MergeResponse, StatusRequest, branch_file_diff,
    branch_push_status, checkout_branch_to_directory, execute_branch_create, execute_branch_push,
    execute_branch_switch, execute_branch_sync, parse_extra_params_args, plan_branch_sync,
};
use rdevtool_core::link::{
    LinkConfig, LinkExecutionReport, LinkExecutionStepReport, LinkStepConfig,
    LinkWorkspaceAttachRequest, attach_link_to_workspace, delete_link as core_delete_link,
    get_link, link_proxy_check_status, links_file_path, list_link_summaries,
    plan_link as core_plan_link, upsert_link,
};
use rdevtool_core::navigation::{
    NavigationEditorCategory, NavigationEditorEntry, NavigationIndexEntry,
    find_navigation_entry_for_workspace, list_navigation_entries_for_workspace,
    load_navigation_editor_data, navigation_file_path, open_navigation_entry,
    save_navigation_editor_data, search_navigation_entries_for_workspace,
    validate_workspace_resource_entry,
};
use rdevtool_core::operation::{
    ManagedArtifact, OPERATION_EVENT_HISTORY_LIMIT, OperationEvent, OperationEventOrigin,
    OperationEventState, OperationEvidence, OperationRisk, OperationStatus, RecommendedAction,
    branch_task_operation_event, build_history_request, build_operation_event,
    failed_build_operation_event, lifecycle_operation_event, link_operation_event,
    list_operation_events, operation_event_id, save_operation_event,
    update_build_operation_event_from_history,
};
use rdevtool_core::proxy::{
    PROXY_VERIFY_ID_HEADER, ProxyConfig, ProxyEvent, ProxyOutboundMode, ProxyProfile,
    ProxyProfilePack, ProxyRequestDiagnosis, ProxyRule, ProxyRuleAction, default_proxy_path,
    delete_proxy_profile as core_delete_proxy_profile, delete_proxy_rule as core_delete_proxy_rule,
    diagnose_proxy_request, ensure_proxy_config, export_proxy_profile_pack,
    import_proxy_profile_pack, load_proxy_config, save_proxy_config, upsert_proxy_profile,
    upsert_proxy_rule, validate_proxy_profile, validate_proxy_rule,
};
use rdevtool_core::proxy_daemon::{
    ProxyDaemonRuntime, ProxyDaemonStatus, proxy_daemon_restart, proxy_daemon_start,
    proxy_daemon_status, proxy_daemon_stop,
};
use rdevtool_core::replay::{
    ReplayAction, build_replay_action, merge_replay_action, replay_kind_and_history_key,
};
use rdevtool_core::runtime::{
    ProjectRuntimeFocusResponse, ProjectRuntimeInspectResponse, ProjectRuntimeLaunchOptions,
    ProjectRuntimeLogKind, ProjectRuntimeLogResponse, ProjectRuntimePreflightResponse,
    ProjectRuntimeStartResponse, ProjectRuntimeWaitOptions, ProjectRuntimeWaitResponse,
    ProjectRuntimeWaitUntil, RuntimeProfileSummary, RuntimeProfilesResponse,
    adopt_project_runtime_with_options, clear_project_runtime_log,
    inspect_project_runtime_with_options, project_runtime_candidate_cwds,
    project_runtime_preflight_with_options, read_project_runtime_log_with_selection,
    runtime_profile_show, runtime_profiles, start_project_runtime_detached_with_options,
    wait_project_runtime,
};
use rdevtool_core::runtime_daemon::{
    RuntimeDaemonAdoptResponse, RuntimeDaemonDiagnosis, RuntimeDaemonStatus,
    diagnose as diagnose_runtime_daemon, find as find_runtime_daemon, list as list_runtime_daemons,
    status as runtime_daemon_status, stop as stop_runtime_daemon,
};
use rdevtool_core::runtime_link::{BindProxyRuntimeRequest, bind_proxy_runtime_profile};
use rdevtool_core::storage::{
    self, DeployHistoryEntry, HistoryCommitInfo, MergeHistoryEntry, SaveDeployHistoryRequest,
    SaveMergeHistoryRequest, SaveNoteRequest, Storage,
};
use rdevtool_core::web_actions::{
    WebActionListResponse, WebActionRunRequest, WebActionRunResult, WebActionScriptRunRequest,
    WebActionTarget, default_web_actions_path, list_web_action_targets, list_web_actions,
    open_web_action_target, run_web_action, run_web_action_script,
};
use rdevtool_core::workspace_init::{
    InitDemandWorkspaceAction, InitDemandWorkspaceBranch, InitDemandWorkspaceCopyMode,
    InitDemandWorkspaceEffective, InitDemandWorkspaceObserved, InitDemandWorkspaceProject,
    InitDemandWorkspaceRequest, InitDemandWorkspaceRequested, InitDemandWorkspaceRequirementEntry,
    InitDemandWorkspaceResult, init_demand_workspace,
};
use rdevtool_core::workspace_instance::{
    WorkspaceProjectInstanceValidation, validate_workspace_project_instance,
};
use rdevtool_core::workspace_resources::{
    WorkspaceOperationWorklogEvent, WorkspaceResourceStatus, append_workspace_operation_worklog,
    append_workspace_worklog, initialize_workspace_resources, read_workspace_worklog,
    set_workspace_worklog_auto_record, workspace_resource_status,
};
use serde::Serialize;
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{self, Read};
use std::net::TcpListener;
use std::path::{Path, PathBuf};

const BRANCH_WORKFLOW_STORAGE_NAMESPACE: &str = "branch-workflow";
const BRANCH_WORKFLOW_HISTORY_KEY: &str = "history";
const BRANCH_WORKFLOW_HISTORY_LIMIT: usize = 200;

#[derive(Debug)]
struct CliReportedFailure {
    code: &'static str,
    message: String,
}

impl std::fmt::Display for CliReportedFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for CliReportedFailure {}

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
        #[arg(long = "project")]
        projects: Vec<String>,
        #[arg(long = "source")]
        source_branch: String,
        #[arg(long = "target")]
        target_branches: Vec<String>,
        #[arg(long, visible_alias = "dry-run")]
        plan: bool,
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
    Link {
        #[command(subcommand)]
        command: LinkCommands,
    },
    ConfigSource {
        #[command(subcommand)]
        command: ConfigSourceCommands,
    },
    Proxy {
        #[arg(long, global = true)]
        source: Option<String>,
        #[command(subcommand)]
        command: ProxyCommands,
    },
    Runtime {
        #[command(subcommand)]
        command: RuntimeCommands,
    },
    Artifacts {
        #[command(subcommand)]
        command: ArtifactCommands,
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
        resource_dir: Option<PathBuf>,
        #[arg(long)]
        worklog_file: Option<PathBuf>,
        #[arg(long)]
        no_worklog: bool,
        #[arg(long)]
        no_auto_worklog: bool,
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
        repo_path: Option<PathBuf>,
        #[arg(long)]
        project: Option<String>,
        #[arg(long)]
        branch: Option<String>,
        #[arg(long)]
        root_dir: Option<PathBuf>,
        #[arg(long)]
        instance_dir: Option<PathBuf>,
        #[arg(long, value_enum, default_value_t = WorkspaceCopyModeArg::Existing)]
        copy_mode: WorkspaceCopyModeArg,
        #[arg(long)]
        resource_dir: Option<PathBuf>,
        #[arg(long)]
        worklog_file: Option<PathBuf>,
        #[arg(long)]
        no_worklog: bool,
        #[arg(long)]
        no_auto_worklog: bool,
        #[arg(long, default_value = "需求资料")]
        requirement_category: String,
        #[arg(long, default_value = "需求")]
        requirement_short_label: String,
        #[arg(long, default_value = "需求目录")]
        requirement_entry_name: String,
        #[arg(long)]
        no_switch: bool,
        #[arg(long)]
        allow_remote_mismatch: bool,
        #[arg(long)]
        dry_run: bool,
    },
    ResourcesInit {
        workspace: Option<String>,
        #[arg(long)]
        resource_dir: Option<PathBuf>,
        #[arg(long)]
        worklog_file: Option<PathBuf>,
        #[arg(long)]
        no_worklog: bool,
    },
    WorklogAppend {
        workspace: Option<String>,
        #[arg(long, default_value = "记录")]
        kind: String,
        #[arg(long)]
        summary: String,
        #[arg(long)]
        detail: Option<String>,
    },
    WorklogShow {
        workspace: Option<String>,
        #[arg(long, default_value_t = 80)]
        lines: usize,
    },
    WorklogAuto {
        workspace: Option<String>,
        #[arg(long, action = clap::ArgAction::Set)]
        enabled: bool,
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
        #[arg(long)]
        allow_remote_mismatch: bool,
    },
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum WorkspaceCopyModeArg {
    Existing,
    Worktree,
    Clone,
}

impl From<WorkspaceCopyModeArg> for InitDemandWorkspaceCopyMode {
    fn from(value: WorkspaceCopyModeArg) -> Self {
        match value {
            WorkspaceCopyModeArg::Existing => InitDemandWorkspaceCopyMode::Existing,
            WorkspaceCopyModeArg::Worktree => InitDemandWorkspaceCopyMode::Worktree,
            WorkspaceCopyModeArg::Clone => InitDemandWorkspaceCopyMode::Clone,
        }
    }
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
        #[arg(long)]
        output_dir: Option<PathBuf>,
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
        #[arg(long)]
        output_dir: Option<PathBuf>,
        #[arg(long)]
        clear_output_dir: bool,
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
        #[arg(long = "impact-path")]
        impact_paths: Vec<String>,
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
        #[arg(long = "impact-path")]
        impact_paths: Vec<String>,
        #[arg(long)]
        clear_impact_paths: bool,
    },
    #[command(visible_alias = "build-param-delete")]
    TargetParamDelete {
        project: String,
        target: String,
        param: String,
    },
    DebugProfileList {
        project: String,
    },
    DebugProfileShow {
        project: String,
        profile: String,
    },
    DebugProfileAdd {
        project: String,
        #[arg(long)]
        key: String,
        #[arg(long)]
        label: Option<String>,
        #[arg(long)]
        command: Option<String>,
        #[arg(long)]
        cwd: Option<PathBuf>,
        #[arg(long = "expect-port")]
        expected_port: Option<u16>,
        #[arg(long = "focus-url")]
        focus_url: Option<String>,
        #[arg(long = "ready-probe-url")]
        ready_probe_url: Option<String>,
        #[arg(long = "ready-probe-path")]
        ready_probe_path: Option<String>,
        #[arg(long = "ready-expect-status")]
        ready_expected_statuses: Vec<u16>,
        #[arg(long = "ready-timeout-ms")]
        ready_timeout_ms: Option<u64>,
        #[arg(long = "runtime-profile")]
        runtime_profile: Option<String>,
        #[arg(long = "env")]
        env: Vec<String>,
    },
    DebugProfileUpdate {
        project: String,
        profile: String,
        #[arg(long)]
        label: Option<String>,
        #[arg(long)]
        command: Option<String>,
        #[arg(long)]
        clear_command: bool,
        #[arg(long)]
        cwd: Option<PathBuf>,
        #[arg(long)]
        clear_cwd: bool,
        #[arg(long = "expect-port")]
        expected_port: Option<u16>,
        #[arg(long)]
        clear_expect_port: bool,
        #[arg(long = "focus-url")]
        focus_url: Option<String>,
        #[arg(long)]
        clear_focus_url: bool,
        #[arg(long = "ready-probe-url")]
        ready_probe_url: Option<String>,
        #[arg(long = "ready-probe-path")]
        ready_probe_path: Option<String>,
        #[arg(long = "ready-expect-status")]
        ready_expected_statuses: Vec<u16>,
        #[arg(long = "ready-timeout-ms")]
        ready_timeout_ms: Option<u64>,
        #[arg(long)]
        clear_ready_probe: bool,
        #[arg(long = "runtime-profile")]
        runtime_profile: Option<String>,
        #[arg(long)]
        clear_runtime_profile: bool,
        #[arg(long = "env")]
        env: Vec<String>,
        #[arg(long)]
        clear_env: bool,
    },
    DebugProfileDelete {
        project: String,
        profile: String,
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
                | ProjectCommands::DebugProfileAdd { .. }
                | ProjectCommands::DebugProfileUpdate { .. }
                | ProjectCommands::DebugProfileDelete { .. }
        )
    }

    fn json_command_name(&self) -> &'static str {
        match self {
            Self::List => "projects.list",
            Self::Add { .. } => "projects.add",
            Self::Update { .. } => "projects.update",
            Self::Delete { .. } => "projects.delete",
            Self::SetCommand { .. } => "projects.set-command",
            Self::TargetAdd { .. } => "projects.target-add",
            Self::TargetUpdate { .. } => "projects.target-update",
            Self::TargetDelete { .. } => "projects.target-delete",
            Self::TargetParamAdd { .. } => "projects.target-param-add",
            Self::TargetParamUpdate { .. } => "projects.target-param-update",
            Self::TargetParamDelete { .. } => "projects.target-param-delete",
            Self::DebugProfileList { .. } => "projects.debug-profile-list",
            Self::DebugProfileShow { .. } => "projects.debug-profile-show",
            Self::DebugProfileAdd { .. } => "projects.debug-profile-add",
            Self::DebugProfileUpdate { .. } => "projects.debug-profile-update",
            Self::DebugProfileDelete { .. } => "projects.debug-profile-delete",
            Self::Show { .. } => "projects.show",
            Self::Branch { .. } => "projects.branch",
            Self::Branches { .. } => "projects.branches",
            Self::Envs { .. } => "projects.envs",
            Self::Options { .. } => "projects.options",
        }
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
        #[command(flatten)]
        follow: BuildFollowOptions,
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
        #[command(flatten)]
        follow: BuildFollowOptions,
    },
    Status {
        #[arg(long)]
        queue_url: Option<String>,
        #[arg(long)]
        build_url: Option<String>,
        #[command(flatten)]
        follow: BuildFollowOptions,
    },
    History {
        #[arg(long)]
        project: Option<String>,
        #[arg(long, default_value_t = 20)]
        limit: usize,
    },
}

#[derive(Args, Clone, Copy, Debug, Default)]
struct BuildFollowOptions {
    /// Keep polling Jenkins until the build reaches a terminal state.
    #[arg(long)]
    follow: bool,
    /// Delay between status requests while following.
    #[arg(long, requires = "follow", value_parser = clap::value_parser!(u64).range(250..=60_000))]
    poll_interval_ms: Option<u64>,
    /// Maximum time to follow before returning a non-zero timeout error.
    #[arg(long, requires = "follow", value_parser = clap::value_parser!(u64).range(1..=86_400))]
    timeout_secs: Option<u64>,
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
        #[arg(long = "project")]
        projects: Vec<String>,
        #[arg(long = "source")]
        source_branch: String,
        #[arg(long = "target")]
        target_branches: Vec<String>,
        #[arg(long, visible_alias = "dry-run")]
        plan: bool,
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
        #[arg(long)]
        repo_path: Option<String>,
    },
    Diff {
        #[arg(long)]
        project: String,
        #[arg(long)]
        path: String,
        #[arg(long)]
        repo_path: Option<String>,
        #[arg(long)]
        mode: Option<String>,
        #[arg(long)]
        max_bytes: Option<usize>,
        #[arg(long)]
        max_lines: Option<usize>,
    },
    Push {
        #[arg(long)]
        project: String,
        #[arg(long)]
        message: Option<String>,
        #[arg(long)]
        repo_path: Option<String>,
        #[arg(long = "path")]
        selected_paths: Vec<String>,
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
enum HistoryOperationCommands {
    Show { id: String },
}

#[derive(Subcommand)]
enum HistoryCommands {
    Operations {
        #[command(subcommand)]
        command: Option<HistoryOperationCommands>,
        #[arg(long)]
        domain: Option<String>,
        #[arg(long)]
        origin: Option<String>,
        #[arg(long)]
        project: Option<String>,
        #[arg(long, default_value_t = 24)]
        limit: usize,
    },
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
        tool: Option<String>,
        #[arg(long)]
        tool_key: Option<String>,
        #[arg(long)]
        tool_action: Option<String>,
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
        tool: Option<String>,
        #[arg(long)]
        tool_key: Option<String>,
        #[arg(long)]
        tool_action: Option<String>,
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
enum LinkCommands {
    Path,
    List,
    Show {
        key: String,
    },
    Plan {
        key: String,
    },
    Check {
        key: String,
    },
    Run {
        key: String,
    },
    Stop {
        key: String,
    },
    Save {
        #[arg(long)]
        key: String,
        #[arg(long)]
        name: String,
        #[arg(long)]
        workspace: Option<String>,
        #[arg(long)]
        project: Option<String>,
        #[arg(long = "step")]
        steps: Vec<String>,
    },
    Delete {
        key: String,
    },
    Attach {
        key: String,
        #[arg(long)]
        workspace: Option<String>,
        #[arg(long, default_value = "工具")]
        category: String,
        #[arg(long)]
        short_label: Option<String>,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        note: Option<String>,
    },
}

#[derive(Subcommand)]
enum ConfigSourceCommands {
    List,
    Show {
        source: String,
    },
    Compare {
        left: String,
        right: String,
    },
    Copy {
        source: String,
        #[arg(long)]
        id: String,
        #[arg(long)]
        name: String,
        #[arg(long = "base-dir")]
        base_dir: Option<PathBuf>,
    },
    Use {
        source: String,
        #[arg(long, default_value = "resource")]
        capability: String,
    },
}

#[derive(Subcommand)]
enum ProxyCommands {
    Path,
    Source {
        #[arg(long = "set")]
        source_id: Option<String>,
    },
    List,
    Start {
        profile: String,
    },
    Stop {
        profile: String,
    },
    Restart {
        profile: String,
    },
    Status {
        #[arg(long)]
        profile: Option<String>,
    },
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
    Verify {
        #[arg(long)]
        profile: String,
        #[arg(long, default_value = "GET")]
        method: String,
        #[arg(long)]
        url: String,
        #[arg(long = "header")]
        headers: Vec<String>,
        #[arg(long)]
        body: Option<String>,
        #[arg(long = "expect-status")]
        expected_status: Option<u16>,
        #[arg(long = "contains")]
        expected_body_text: Option<String>,
        #[arg(long, default_value_t = 5000)]
        timeout_ms: u64,
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
        #[arg(long = "runtime-profile")]
        runtime_profile: Option<String>,
        #[arg(long)]
        command: Option<String>,
        #[arg(long = "expect-port")]
        expected_port: Option<u16>,
        #[arg(long = "env")]
        env: Vec<String>,
    },
    Preflight {
        #[arg(long)]
        project: String,
        #[arg(long = "debug-profile")]
        debug_profile: Option<String>,
        #[arg(long = "runtime-profile")]
        runtime_profile: Option<String>,
        #[arg(long)]
        command: Option<String>,
        #[arg(long = "expect-port")]
        expected_port: Option<u16>,
        #[arg(long = "env")]
        env: Vec<String>,
    },
    Start {
        #[arg(long)]
        project: String,
        #[arg(long = "debug-profile")]
        debug_profile: Option<String>,
        #[arg(long = "runtime-profile")]
        runtime_profile: Option<String>,
        #[arg(long)]
        command: Option<String>,
        #[arg(long = "expect-port")]
        expected_port: Option<u16>,
        #[arg(long = "env")]
        env: Vec<String>,
    },
    Status {
        #[arg(long)]
        project: String,
        #[arg(long = "run-id")]
        run_id: Option<String>,
    },
    List {
        #[arg(long)]
        running_only: bool,
    },
    Stop {
        #[arg(long)]
        project: String,
        #[arg(long = "run-id")]
        run_id: Option<String>,
    },
    Restart {
        #[arg(long)]
        project: String,
        #[arg(long = "debug-profile")]
        debug_profile: Option<String>,
        #[arg(long = "runtime-profile")]
        runtime_profile: Option<String>,
        #[arg(long)]
        command: Option<String>,
        #[arg(long = "expect-port")]
        expected_port: Option<u16>,
        #[arg(long = "env")]
        env: Vec<String>,
    },
    Adopt {
        #[arg(long)]
        project: String,
        #[arg(long)]
        pid: u32,
        #[arg(long = "debug-profile")]
        debug_profile: Option<String>,
        #[arg(long)]
        command: Option<String>,
        #[arg(long = "expect-port")]
        expected_port: Option<u16>,
    },
    Diagnose {
        #[arg(long)]
        project: String,
        #[arg(long = "run-id")]
        run_id: Option<String>,
    },
    Focus {
        #[arg(long)]
        project: String,
        #[arg(long = "debug-profile")]
        debug_profile: Option<String>,
        #[arg(long = "runtime-profile")]
        runtime_profile: Option<String>,
        #[arg(long)]
        url: Option<String>,
    },
    Wait {
        #[arg(long)]
        project: String,
        #[arg(long = "run-id")]
        run_id: Option<String>,
        #[arg(long, value_enum, default_value = "http-verified")]
        until: RuntimeWaitUntilArg,
        #[arg(long)]
        timeout_ms: Option<u64>,
        #[arg(long, default_value_t = 250)]
        poll_interval_ms: u64,
        #[arg(long = "probe-url")]
        probe_url: Option<String>,
        #[arg(long = "probe-path")]
        probe_path: Option<String>,
        #[arg(long = "expect-status")]
        expected_statuses: Vec<u16>,
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
        #[arg(long)]
        current: bool,
        #[arg(long = "run-id")]
        run_id: Option<String>,
    },
}

impl RuntimeCommands {
    fn json_command_name(&self) -> &'static str {
        match self {
            Self::Profiles => "runtime.profiles",
            Self::ProfileShow { .. } => "runtime.profile-show",
            Self::Inspect { .. } => "runtime.inspect",
            Self::Preflight { .. } => "runtime.preflight",
            Self::Start { .. } => "runtime.start",
            Self::Status { .. } => "runtime.status",
            Self::List { .. } => "runtime.list",
            Self::Stop { .. } => "runtime.stop",
            Self::Restart { .. } => "runtime.restart",
            Self::Adopt { .. } => "runtime.adopt",
            Self::Diagnose { .. } => "runtime.diagnose",
            Self::Focus { .. } => "runtime.focus",
            Self::Wait { .. } => "runtime.wait",
            Self::Log { .. } => "runtime.log",
        }
    }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum RuntimeLogKindArg {
    Dev,
    Build,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum RuntimeWaitUntilArg {
    ProcessStarted,
    ListenerReady,
    HttpVerified,
}

impl From<RuntimeWaitUntilArg> for ProjectRuntimeWaitUntil {
    fn from(value: RuntimeWaitUntilArg) -> Self {
        match value {
            RuntimeWaitUntilArg::ProcessStarted => ProjectRuntimeWaitUntil::ProcessStarted,
            RuntimeWaitUntilArg::ListenerReady => ProjectRuntimeWaitUntil::ListenerReady,
            RuntimeWaitUntilArg::HttpVerified => ProjectRuntimeWaitUntil::HttpVerified,
        }
    }
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
enum ArtifactCommands {
    List {
        #[arg(long)]
        workspace: Option<String>,
        #[arg(long)]
        all_workspaces: bool,
        #[arg(long)]
        project: Option<String>,
        #[arg(long = "kind")]
        kinds: Vec<String>,
    },
    CleanupPlan {
        #[arg(long)]
        workspace: Option<String>,
        #[arg(long)]
        all_workspaces: bool,
        #[arg(long)]
        project: Option<String>,
        #[arg(long = "kind")]
        kinds: Vec<String>,
        #[arg(long = "artifact-id")]
        artifact_ids: Vec<String>,
    },
}

impl ArtifactCommands {
    fn json_command_name(&self) -> &'static str {
        match self {
            Self::List { .. } => "artifacts.list",
            Self::CleanupPlan { .. } => "artifacts.cleanup-plan",
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
        #[arg(long = "for", value_enum)]
        preset: Option<AgentContextPresetArg>,
        #[arg(long)]
        compact: bool,
        #[arg(long, value_enum, value_delimiter = ',')]
        include: Vec<AgentContextSectionArg>,
        #[arg(long)]
        debug_profile: Option<String>,
        #[arg(long)]
        runtime_profile: Option<String>,
    },
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum AgentContextPresetArg {
    Workspace,
    Git,
    Runtime,
    Build,
    WebActions,
    Artifacts,
}

impl From<AgentContextPresetArg> for AgentContextPreset {
    fn from(value: AgentContextPresetArg) -> Self {
        match value {
            AgentContextPresetArg::Workspace => AgentContextPreset::Workspace,
            AgentContextPresetArg::Git => AgentContextPreset::Git,
            AgentContextPresetArg::Runtime => AgentContextPreset::Runtime,
            AgentContextPresetArg::Build => AgentContextPreset::Build,
            AgentContextPresetArg::WebActions => AgentContextPreset::WebActions,
            AgentContextPresetArg::Artifacts => AgentContextPreset::Artifacts,
        }
    }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum AgentContextSectionArg {
    History,
    Notes,
    Navigation,
    Proxy,
    Projects,
    Worklog,
    Artifacts,
}

impl From<AgentContextSectionArg> for AgentContextSection {
    fn from(value: AgentContextSectionArg) -> Self {
        match value {
            AgentContextSectionArg::History => AgentContextSection::History,
            AgentContextSectionArg::Notes => AgentContextSection::Notes,
            AgentContextSectionArg::Navigation => AgentContextSection::Navigation,
            AgentContextSectionArg::Proxy => AgentContextSection::Proxy,
            AgentContextSectionArg::Projects => AgentContextSection::Projects,
            AgentContextSectionArg::Worklog => AgentContextSection::Worklog,
            AgentContextSectionArg::Artifacts => AgentContextSection::Artifacts,
        }
    }
}

fn main() {
    let args: Vec<_> = std::env::args_os().collect();
    if let Some(result) = rdevtool_core::runtime_daemon::run_runtime_daemon_from_args(&args) {
        if let Err(error) = result {
            eprintln!("runtime daemon failed: {error:#}");
            std::process::exit(1);
        }
        return;
    }
    if let Some(result) = rdevtool_core::proxy_daemon::run_proxy_daemon_from_args(&args) {
        if let Err(error) = result {
            eprintln!("proxy daemon failed: {error:#}");
            std::process::exit(1);
        }
        return;
    }
    let json_mode = args.iter().any(|value| value == "--json");

    let exit_code = match Cli::try_parse_from(&args) {
        Ok(cli) => match run_cli(cli) {
            Ok(()) => 0,
            Err(error) => {
                if error.downcast_ref::<CliReportedFailure>().is_none() {
                    emit_cli_error(&error, json_mode);
                }
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
            projects,
            source_branch,
            target_branches,
            plan,
        } => {
            let (config, _) = load_cli_effective_config(config_override)?;
            run_branch_sync(
                &config,
                projects,
                source_branch,
                target_branches,
                plan,
                json,
            )
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
        Commands::Link { command } => run_link(command, config_override, json),
        Commands::ConfigSource { command } => run_config_source(command, json),
        Commands::Proxy { source, command } => {
            run_proxy(command, config_override, source.as_deref(), json)
        }
        Commands::Runtime { command } => {
            let (config, _) = load_cli_effective_config(config_override)?;
            run_runtime(&config, command, json)
        }
        Commands::Artifacts { command } => run_artifacts(command, config_override, json),
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
    config_sources: String,
    proxy_active: Option<String>,
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
    source_id: String,
    source_name: String,
    path: String,
    workspace: ProjectWorkspaceCliInfo,
    profiles: Vec<ProxyProfile>,
    rules: Vec<ProxyRule>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxyStatusResponse {
    source_id: String,
    source_name: String,
    path: String,
    profiles: Vec<ProxyStatusItem>,
    operation: ProxyOperationContract,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxyStatusItem {
    profile_id: String,
    profile_name: String,
    listen_url: String,
    listening: bool,
    managed: bool,
    version_compatible: bool,
    protocol_version: Option<u16>,
    app_version: Option<String>,
    pid: Option<u32>,
    started_at: Option<String>,
    owner: Option<String>,
    ownership: String,
    state_path: String,
    detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxyDiagnoseResponse {
    #[serde(flatten)]
    diagnosis: ProxyRequestDiagnosis,
    operation: ProxyOperationContract,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxyVerifyResponse {
    profile_id: String,
    profile_name: String,
    listen_url: String,
    request_url: String,
    method: String,
    diagnosis: ProxyRequestDiagnosis,
    status: u16,
    content_type: Option<String>,
    body_preview: String,
    body_truncated: bool,
    elapsed_ms: u128,
    expected_status: Option<u16>,
    expected_body_text_provided: bool,
    status_matches: bool,
    body_matches: bool,
    verified: bool,
    operation: ProxyOperationContract,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxyOperationContract {
    schema_version: u16,
    requested: ProxyOperationRequested,
    effective: ProxyOperationEffective,
    observed: ProxyOperationObserved,
    lifecycle: ProxyOperationLifecycle,
    status: OperationStatus,
    evidence: Vec<OperationEvidence>,
    risks: Vec<OperationRisk>,
    managed_artifacts: Vec<ManagedArtifact>,
    recommended_actions: Vec<RecommendedAction>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxyOperationRequested {
    profile: Option<String>,
    method: Option<String>,
    url: Option<String>,
    header_count: usize,
    body_provided: bool,
    expected_status: Option<u16>,
    expected_body_text_provided: bool,
    timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxyOperationEffective {
    source_id: String,
    config_path: String,
    profile_ids: Vec<String>,
    selected_profile_id: Option<String>,
    listen_url: Option<String>,
    method: Option<String>,
    request_url: Option<String>,
    path: Option<String>,
    predicted_rule_id: Option<String>,
    predicted_action: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxyOperationObserved {
    configured_profile_count: usize,
    listening_count: usize,
    managed_listener_count: usize,
    external_listener_count: usize,
    selected_listener: Option<ProxyListenerObservation>,
    response: Option<ProxyResponseObservation>,
    event: Option<ProxyEventObservation>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxyListenerObservation {
    listening: bool,
    managed: bool,
    version_compatible: bool,
    ownership: String,
    pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxyResponseObservation {
    received: bool,
    status: u16,
    elapsed_ms: u128,
    status_matches: bool,
    body_matches: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxyEventObservation {
    captured: bool,
    event_id: Option<String>,
    matched_rule_id: Option<String>,
    matched_rule_name: Option<String>,
    action: Option<String>,
    status: Option<u16>,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxyOperationLifecycle {
    configured: ProxyOperationStage,
    started: ProxyOperationStage,
    matched: ProxyOperationStage,
    verified: ProxyOperationStage,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxyOperationStage {
    state: String,
    confirmed: bool,
    source: String,
    detail: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceScopeCliInfo {
    workspace: ProjectWorkspaceCliInfo,
    proxy_profiles: Vec<String>,
    project_instance_validations: Vec<WorkspaceProjectInstanceValidation>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InitDemandWorkspaceCliInfo {
    schema_version: u32,
    dry_run: bool,
    copy_mode: InitDemandWorkspaceCopyMode,
    requested: InitDemandWorkspaceRequested,
    effective: InitDemandWorkspaceEffective,
    observed: InitDemandWorkspaceObserved,
    status: OperationStatus,
    evidence: Vec<OperationEvidence>,
    risks: Vec<OperationRisk>,
    managed_artifacts: Vec<ManagedArtifact>,
    recommended_actions: Vec<RecommendedAction>,
    planned_actions: Vec<InitDemandWorkspaceAction>,
    workspace: ProjectWorkspaceCliInfo,
    project: InitDemandWorkspaceProject,
    requirement_entry: InitDemandWorkspaceRequirementEntry,
    resources: WorkspaceResourceStatus,
    branch: InitDemandWorkspaceBranch,
    metadata: BTreeMap<String, String>,
    warnings: Vec<String>,
    source_repository_validation: Option<WorkspaceProjectInstanceValidation>,
    project_instance_validation: Option<WorkspaceProjectInstanceValidation>,
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
    allow_remote_mismatch: bool,
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
    resource_dir: Option<String>,
    worklog_file: Option<String>,
    worklog_path: Option<String>,
    worklog_exists: bool,
    worklog_auto_record: bool,
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
    if config_override.is_some() {
        return Ok((config, path));
    }
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
    if let Some(reported) = error.downcast_ref::<CliReportedFailure>() {
        return (reported.code, 1);
    }
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
        || message.contains("已存在")
        || message.contains("冲突")
        || message.contains("不能为空")
        || message.contains("必须")
        || message.contains("非空")
    {
        ("invalid_arguments", 2)
    } else if message.contains("timeout")
        || message.contains("timed out")
        || message.contains("超时")
    {
        ("operation_timeout", 1)
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
    let mut active_workspace_config = None;
    let mut app_workspace_config = None;
    let mut config_source_workspaces = Vec::new();
    let mut config_for_workspace = None;
    let mut known_workspace_keys = BTreeSet::new();

    let config_result = load_cli_config(config_override);
    let config_path = config_result
        .as_ref()
        .map(|(_, path)| path.clone())
        .unwrap_or_else(|_| paths.projects.clone());

    let mut doctor_paths = DoctorPaths {
        config_dir: paths.dir.display().to_string(),
        projects: config_path.display().to_string(),
        workspace: paths.workspace.display().to_string(),
        workspaces_dir: paths.project_workspaces.display().to_string(),
        navigation: navigation_file_path(),
        proxy: default_proxy_path().display().to_string(),
        config_sources: config_sources_file_path().display().to_string(),
        proxy_active: None,
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
            app_workspace_config = Some(workspace_config.clone());
            push_check(
                &mut checks,
                DoctorStatus::Ok,
                "workspace_preferences",
                format!("active workspace is {active_key}"),
                Some(paths.workspace.display().to_string()),
            );
            match load_project_workspaces(&paths.project_workspaces) {
                Ok(workspaces) => {
                    let workspace_count = workspaces.len();
                    known_workspace_keys = workspaces
                        .iter()
                        .map(|workspace| workspace.key.clone())
                        .collect();
                    config_source_workspaces = workspaces;
                    push_check(
                        &mut checks,
                        DoctorStatus::Ok,
                        "workspace_catalog",
                        format!("loaded {} workspaces", workspace_count),
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
                    active_workspace_config = Some(workspace);
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

    let active_proxy_path = check_config_sources(
        &mut checks,
        &config_source_workspaces,
        active_workspace_config.as_ref(),
        app_workspace_config.as_ref(),
    )
    .unwrap_or_else(default_proxy_path);
    doctor_paths.proxy_active = Some(active_proxy_path.display().to_string());
    check_proxy_config(&mut checks, &known_workspace_keys, &active_proxy_path);
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

fn check_config_sources(
    checks: &mut Vec<DoctorCheck>,
    workspaces: &[ProjectWorkspaceConfig],
    active_workspace: Option<&ProjectWorkspaceConfig>,
    app_workspace: Option<&rdevtool_core::config::WorkspaceConfig>,
) -> Option<PathBuf> {
    let sources = match list_config_sources(workspaces) {
        Ok(sources) => sources,
        Err(error) => {
            push_check(
                checks,
                DoctorStatus::Error,
                "config_sources",
                "failed to load config sources",
                Some(error.to_string()),
            );
            return None;
        }
    };
    let capability_summary = ["resource", "link", "proxy", "runtime"]
        .into_iter()
        .map(|capability| {
            let count = sources
                .iter()
                .filter(|source| {
                    source
                        .capabilities
                        .iter()
                        .any(|item| item.eq_ignore_ascii_case(capability))
                })
                .count();
            format!("{capability}={count}")
        })
        .collect::<Vec<_>>()
        .join(", ");
    push_check(
        checks,
        DoctorStatus::Ok,
        "config_sources",
        format!("loaded {} config sources", sources.len()),
        Some(format!(
            "{}; {}",
            config_sources_file_path().display(),
            capability_summary
        )),
    );

    let preferred_source_id = match (active_workspace, app_workspace) {
        (Some(workspace), Some(app_workspace)) => {
            preferred_config_source_id_for_scope(workspace, app_workspace, "proxy")
        }
        _ => "default".to_string(),
    };
    let preferred_normalized = preferred_source_id.replace('_', "-");
    let preferred_source = sources.iter().find(|source| {
        source.id == preferred_source_id || source.id.replace('_', "-") == preferred_normalized
    });
    let source = preferred_source.or_else(|| sources.iter().find(|source| source.is_default))?;
    if preferred_source.is_none() {
        push_check(
            checks,
            DoctorStatus::Warning,
            "proxy_source",
            "preferred proxy config source no longer exists; using default",
            Some(preferred_source_id),
        );
    }
    if !source
        .capabilities
        .iter()
        .any(|capability| capability.eq_ignore_ascii_case("proxy"))
    {
        push_check(
            checks,
            DoctorStatus::Error,
            "proxy_source",
            "active config source does not support proxy",
            Some(format!("{} ({})", source.name, source.id)),
        );
        return None;
    }
    let path = source.files.proxy.as_deref().map(PathBuf::from);
    match &path {
        Some(path) => push_check(
            checks,
            DoctorStatus::Ok,
            "proxy_source",
            format!("active proxy source is {} ({})", source.name, source.id),
            Some(path.display().to_string()),
        ),
        None => push_check(
            checks,
            DoctorStatus::Error,
            "proxy_source",
            "active config source has no proxy file mapping",
            Some(format!("{} ({})", source.name, source.id)),
        ),
    }
    path
}

fn check_proxy_config(
    checks: &mut Vec<DoctorCheck>,
    known_workspace_keys: &BTreeSet<String>,
    proxy_path: &Path,
) {
    if !proxy_path.exists() {
        push_check(
            checks,
            DoctorStatus::Warning,
            "proxy_config",
            "active proxy config has not been initialized",
            Some(proxy_path.display().to_string()),
        );
        return;
    }

    let proxy_config = match load_proxy_config(proxy_path) {
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
    let mut managed_addrs = Vec::new();
    let mut outdated_daemons = Vec::new();
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
            let daemon_status = proxy_daemon_status(&proxy_path, &profile.id).ok();
            if proxy_listener_is_managed(daemon_status.as_ref()) {
                if daemon_status
                    .as_ref()
                    .is_some_and(|status| !status.version_compatible)
                {
                    outdated_daemons.push(format!("{} ({})", profile.id, listen_addr));
                }
                managed_addrs.push(listen_addr);
            } else {
                unavailable_addrs.push(listen_addr);
            }
        }
    }

    if outdated_daemons.is_empty() {
        push_check(
            checks,
            DoctorStatus::Ok,
            "proxy_daemon_versions",
            "running proxy daemons use the current runtime",
            None,
        );
    } else {
        push_check(
            checks,
            DoctorStatus::Warning,
            "proxy_daemon_versions",
            "some proxy daemons will be upgraded on next start or restart",
            Some(outdated_daemons.join(", ")),
        );
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
            "proxy listen ports look available or managed by rDevTool",
            (!managed_addrs.is_empty())
                .then(|| format!("managed by rDevTool: {}", managed_addrs.join(", "))),
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

fn proxy_listener_is_managed(status: Option<&ProxyDaemonStatus>) -> bool {
    status.is_some_and(|status| status.running && status.managed)
}

#[cfg(test)]
mod tests {
    use super::{
        AgentCommands, AgentContextPresetArg, ArtifactCommands, BuildCommands, Cli,
        CliReportedFailure, Commands, ConfigSourceCommands, GitCommands, HistoryCommands,
        HistoryOperationCommands, ProjectCommands, ProjectDebugProfilePatch, ProxyDaemonStatus,
        RuntimeCommands, RuntimeWaitUntilArg, WorkspaceCommands, WorkspaceCopyModeArg,
        add_project_debug_profile, classify_error, cli_branch_task_history_entry_with_id,
        delete_project_debug_profile, finish_branch_task_command, is_terminal_deploy_state,
        proxy_event_confirms_match, proxy_listener_is_managed, proxy_started_stage,
        proxy_verification_confirmed, resolve_project_runtime_lookup_cwd,
        update_project_debug_profile,
    };
    use clap::Parser;
    use rdevtool_core::config::{
        ProjectCommandConfig, ProjectConfig, ProjectDebugLocalFileConfig,
        ProjectDebugProfileConfig, ProjectDebugReadyProbeConfig,
    };
    use rdevtool_core::core::{BranchTaskItemResult, BranchTaskResponse};
    use rdevtool_core::proxy::ProxyEvent;
    use std::collections::BTreeMap;
    use std::path::PathBuf;

    fn daemon_status(running: bool, managed: bool) -> ProxyDaemonStatus {
        ProxyDaemonStatus {
            profile_id: "profile".to_string(),
            profile_name: "Profile".to_string(),
            config_path: "/tmp/proxy.toml".to_string(),
            listen_url: "http://127.0.0.1:8787".to_string(),
            running,
            managed,
            version_compatible: true,
            protocol_version: managed.then_some(1),
            app_version: managed.then(|| "0.1.0".to_string()),
            pid: managed.then_some(42),
            started_at: None,
            owner: None,
            state_path: "/tmp/proxy-state.json".to_string(),
            detail: String::new(),
        }
    }

    #[test]
    fn cli_branch_task_history_preserves_push_result_for_app_activity_sync() {
        let response = BranchTaskResponse {
            task_kind: "push".to_string(),
            success: false,
            summary: "成功 0 / 失败 1".to_string(),
            detail: "批量任务包含失败项".to_string(),
            items: vec![BranchTaskItemResult {
                project_key: "admin".to_string(),
                project_name: "管理端".to_string(),
                source_branch: "feature/demo".to_string(),
                target_branch: None,
                output_path: None,
                checkout_mode: None,
                fallback_reason: None,
                success: false,
                status_key: "push_failed".to_string(),
                status_label: "失败".to_string(),
                summary: "推送失败".to_string(),
                detail: "remote rejected".to_string(),
                remote: false,
                commit: None,
            }],
        };

        let replay = serde_json::json!({
            "command": "execute_branch_push_task",
            "busyText": "正在重新推送分支",
            "request": { "project": "admin" },
        });
        let entry = cli_branch_task_history_entry_with_id(
            "feature-a",
            &response,
            "branch-push-cli-test",
            Some(&replay),
        )
        .expect("create CLI branch history entry");

        assert_eq!(entry["taskKind"], "push");
        assert_eq!(entry["workspaceKey"], "feature-a");
        assert_eq!(entry["items"][0]["detail"], "remote rejected");
        assert_eq!(entry["replay"]["command"], "execute_branch_push_task");
        assert!(
            entry["id"]
                .as_str()
                .unwrap()
                .starts_with("branch-push-cli-")
        );
        assert!(
            entry["createdAt"]
                .as_str()
                .is_some_and(|value| value.ends_with('Z'))
        );
    }

    #[test]
    fn failed_branch_task_command_returns_stable_nonzero_failure() {
        let response = BranchTaskResponse {
            task_kind: "push".to_string(),
            success: false,
            summary: "成功 0 / 失败 1".to_string(),
            detail: "批量任务包含失败项".to_string(),
            items: Vec::new(),
        };

        let error = finish_branch_task_command(
            None,
            None,
            Ok(response),
            false,
            "git.push",
            "branch_task_failed",
        )
        .expect_err("a failed branch response must fail the CLI command");

        assert_eq!(classify_error(&error), ("branch_task_failed", 1));
    }

    fn proxy_event(rule_id: Option<&str>) -> ProxyEvent {
        ProxyEvent {
            id: "event-1".to_string(),
            profile_id: "profile".to_string(),
            profile_name: "Profile".to_string(),
            started_at: "2026-07-21T00:00:00Z".to_string(),
            duration_ms: 1,
            method: "GET".to_string(),
            url: "http://example.test/api".to_string(),
            path: "/api".to_string(),
            status: Some(200),
            action: "mock".to_string(),
            matched_rule_id: rule_id.map(ToString::to_string),
            matched_rule_name: rule_id.map(|_| "Rule".to_string()),
            request_bytes: 0,
            response_bytes: 2,
            request_headers: BTreeMap::new(),
            response_headers: BTreeMap::new(),
            request_body_preview: String::new(),
            response_body_preview: "ok".to_string(),
            request_body_truncated: false,
            response_body_truncated: false,
            error: None,
        }
    }

    #[test]
    fn proxy_lifecycle_requires_managed_listener_event_and_response_evidence() {
        let external = daemon_status(true, false);
        let managed = daemon_status(true, true);
        let mut outdated = daemon_status(true, true);
        outdated.version_compatible = false;
        assert!(!proxy_started_stage(&external).confirmed);
        assert!(proxy_started_stage(&managed).confirmed);
        assert!(!proxy_started_stage(&outdated).confirmed);

        let matched = proxy_event(Some("rule-1"));
        assert!(proxy_event_confirms_match(
            Some(&matched),
            Some("rule-1"),
            "GET"
        ));
        assert!(!proxy_event_confirms_match(
            Some(&matched),
            Some("rule-2"),
            "GET"
        ));
        assert!(!proxy_event_confirms_match(None, Some("rule-1"), "GET"));

        assert!(proxy_verification_confirmed(true, true, true));
        assert!(!proxy_verification_confirmed(false, true, true));
        assert!(!proxy_verification_confirmed(true, false, true));
        assert!(!proxy_verification_confirmed(true, true, false));
    }

    #[test]
    fn terminal_deploy_state_recognizes_completed_results() {
        assert!(is_terminal_deploy_state("success"));
        assert!(is_terminal_deploy_state("failure"));
        assert!(!is_terminal_deploy_state("queued"));
    }

    fn parse_runtime_command(args: &[&str]) -> RuntimeCommands {
        let mut values = vec!["rdevtool", "runtime"];
        values.extend_from_slice(args);
        let cli = Cli::try_parse_from(values).unwrap();
        match cli.command {
            Commands::Runtime { command } => command,
            _ => panic!("expected runtime command"),
        }
    }

    fn parse_artifact_command(args: &[&str]) -> ArtifactCommands {
        let mut values = vec!["rdevtool", "artifacts"];
        values.extend_from_slice(args);
        let cli = Cli::try_parse_from(values).unwrap();
        match cli.command {
            Commands::Artifacts { command } => command,
            _ => panic!("expected artifacts command"),
        }
    }

    fn parse_agent_command(args: &[&str]) -> AgentCommands {
        let mut values = vec!["rdevtool", "agent"];
        values.extend_from_slice(args);
        let cli = Cli::try_parse_from(values).unwrap();
        match cli.command {
            Commands::Agent { command } => command,
            _ => panic!("expected agent command"),
        }
    }

    fn parse_project_command(args: &[&str]) -> ProjectCommands {
        let mut values = vec!["rdevtool", "projects"];
        values.extend_from_slice(args);
        let cli = Cli::try_parse_from(values).unwrap();
        match cli.command {
            Commands::Projects { command } => command,
            _ => panic!("expected projects command"),
        }
    }

    fn parse_build_command(args: &[&str]) -> BuildCommands {
        let mut values = vec!["rdevtool", "build"];
        values.extend_from_slice(args);
        let cli = Cli::try_parse_from(values).unwrap();
        match cli.command {
            Commands::Build { command } => command,
            _ => panic!("expected build command"),
        }
    }

    fn parse_workspace_command(args: &[&str]) -> WorkspaceCommands {
        let mut values = vec!["rdevtool", "workspace"];
        values.extend_from_slice(args);
        let cli = Cli::try_parse_from(values).unwrap();
        match cli.command {
            Commands::Workspace { command } => command,
            _ => panic!("expected workspace command"),
        }
    }

    fn parse_git_command(args: &[&str]) -> GitCommands {
        let mut values = vec!["rdevtool", "git"];
        values.extend_from_slice(args);
        let cli = Cli::try_parse_from(values).unwrap();
        match cli.command {
            Commands::Git { command } => command,
            _ => panic!("expected git command"),
        }
    }

    #[test]
    fn parses_filtered_operation_history_command() {
        let cli = Cli::try_parse_from([
            "rdevtool",
            "--json",
            "history",
            "operations",
            "--domain",
            "git",
            "--origin",
            "cli",
            "--project",
            "demo",
            "--limit",
            "8",
        ])
        .expect("parse operation history command");

        assert!(matches!(
            cli.command,
            Commands::History {
                command: HistoryCommands::Operations {
                    command: None,
                    domain: Some(domain),
                    origin: Some(origin),
                    project: Some(project),
                    limit: 8,
                }
            } if domain == "git" && origin == "cli" && project == "demo"
        ));
    }

    #[test]
    fn parses_operation_history_show_command() {
        let cli = Cli::try_parse_from([
            "rdevtool",
            "history",
            "operations",
            "show",
            "operation-cli-link-run-1",
        ])
        .expect("parse operation history show command");

        assert!(matches!(
            cli.command,
            Commands::History {
                command: HistoryCommands::Operations {
                    command: Some(HistoryOperationCommands::Show { id }),
                    ..
                }
            } if id == "operation-cli-link-run-1"
        ));
    }

    #[test]
    fn parses_build_target_artifact_flags() {
        let add = parse_project_command(&[
            "build-target-add",
            "demo",
            "--key",
            "web",
            "--label",
            "Web",
            "--adapter",
            "local_command",
            "--output-dir",
            "web/dist",
        ]);
        assert!(matches!(
            add,
            ProjectCommands::TargetAdd {
                output_dir: Some(path),
                ..
            } if path == PathBuf::from("web/dist")
        ));

        let update =
            parse_project_command(&["build-target-update", "demo", "web", "--clear-output-dir"]);
        assert!(matches!(
            update,
            ProjectCommands::TargetUpdate {
                clear_output_dir: true,
                ..
            }
        ));
    }

    #[test]
    fn parses_build_param_impact_path_flags() {
        let add = parse_project_command(&[
            "build-param-add",
            "demo",
            "vke",
            "--key",
            "IS_BUILD_MOBILE",
            "--label",
            "移动端",
            "--kind",
            "boolean",
            "--impact-path",
            "mobile/",
            "--impact-path",
            "shared/mobile/",
        ]);
        assert!(matches!(
            add,
            ProjectCommands::TargetParamAdd { impact_paths, .. }
                if impact_paths == vec!["mobile/", "shared/mobile/"]
        ));

        let update = parse_project_command(&[
            "build-param-update",
            "demo",
            "vke",
            "IS_BUILD_MOBILE",
            "--clear-impact-paths",
        ]);
        assert!(matches!(
            update,
            ProjectCommands::TargetParamUpdate {
                clear_impact_paths: true,
                ..
            }
        ));
    }

    #[test]
    fn parses_build_follow_options() {
        let command = parse_build_command(&[
            "run",
            "demo",
            "--follow",
            "--poll-interval-ms",
            "750",
            "--timeout-secs",
            "120",
        ]);
        assert!(matches!(
            command,
            BuildCommands::Run { follow, .. }
                if follow.follow
                    && follow.poll_interval_ms == Some(750)
                    && follow.timeout_secs == Some(120)
        ));
    }

    #[test]
    fn build_follow_tuning_requires_follow() {
        let result = Cli::try_parse_from([
            "rdevtool",
            "build",
            "status",
            "--queue-url",
            "https://jenkins.example/queue/item/1/",
            "--poll-interval-ms",
            "750",
        ]);
        assert!(result.is_err());
    }

    fn runtime_project(repo_path: Option<PathBuf>, cwd: Option<PathBuf>) -> ProjectConfig {
        ProjectConfig {
            key: "sample".to_string(),
            name: "Sample".to_string(),
            category: "Workspace".to_string(),
            repo_path,
            git_url: String::new(),
            deploy_targets: Vec::new(),
            jobs: Default::default(),
            dev: Some(ProjectCommandConfig {
                command: "npm run dev".to_string(),
                cwd,
                ..ProjectCommandConfig::default()
            }),
            build: None,
            focus: Default::default(),
            branch_rules: Default::default(),
            debug_profiles: Vec::new(),
        }
    }

    #[test]
    fn doctor_accepts_only_running_managed_proxy_listeners() {
        assert!(proxy_listener_is_managed(Some(&daemon_status(true, true))));
        assert!(!proxy_listener_is_managed(Some(&daemon_status(
            true, false
        ))));
        assert!(!proxy_listener_is_managed(Some(&daemon_status(
            false, true
        ))));
        assert!(!proxy_listener_is_managed(None));
    }

    #[test]
    fn parses_generic_config_source_commands() {
        let list = Cli::try_parse_from(["rdevtool", "config-source", "list"]).unwrap();
        assert!(matches!(
            list.command,
            Commands::ConfigSource {
                command: ConfigSourceCommands::List
            }
        ));

        let select = Cli::try_parse_from([
            "rdevtool",
            "config-source",
            "use",
            "team-local",
            "--capability",
            "proxy",
        ])
        .unwrap();
        assert!(matches!(
            select.command,
            Commands::ConfigSource {
                command: ConfigSourceCommands::Use { source, capability }
            } if source == "team-local" && capability == "proxy"
        ));

        let compare =
            Cli::try_parse_from(["rdevtool", "config-source", "compare", "default", "team"])
                .unwrap();
        assert!(matches!(
            compare.command,
            Commands::ConfigSource {
                command: ConfigSourceCommands::Compare { left, right }
            } if left == "default" && right == "team"
        ));

        let copy = Cli::try_parse_from([
            "rdevtool",
            "config-source",
            "copy",
            "workspace-demo",
            "--id",
            "team-copy",
            "--name",
            "Team Copy",
            "--base-dir",
            "/tmp/team-copy",
        ])
        .unwrap();
        assert!(matches!(
            copy.command,
            Commands::ConfigSource {
                command: ConfigSourceCommands::Copy {
                    source,
                    id,
                    name,
                    base_dir: Some(base_dir),
                }
            } if source == "workspace-demo"
                && id == "team-copy"
                && name == "Team Copy"
                && base_dir == PathBuf::from("/tmp/team-copy")
        ));
    }

    #[test]
    fn parses_workspace_resource_and_worklog_commands() {
        assert!(matches!(
            parse_workspace_command(&[
                "init-demand",
                "--name",
                "Feature A",
                "--requirement-dir",
                "/tmp/requirement",
                "--project",
                "sample",
                "--branch",
                "feature-a",
                "--root-dir",
                "/tmp/workspace",
                "--instance-dir",
                "/tmp/workspace/sample-copy",
                "--copy-mode",
                "worktree",
                "--dry-run"
            ]),
            WorkspaceCommands::InitDemand {
                repo_path: None,
                project: Some(project),
                instance_dir: Some(instance_dir),
                copy_mode: WorkspaceCopyModeArg::Worktree,
                dry_run: true,
                ..
            } if project == "sample" && instance_dir == PathBuf::from("/tmp/workspace/sample-copy")
        ));
        assert!(matches!(
            parse_workspace_command(&[
                "resources-init",
                "feature-a",
                "--resource-dir",
                "/tmp/feature-a"
            ]),
            WorkspaceCommands::ResourcesInit {
                workspace: Some(workspace),
                resource_dir: Some(resource_dir),
                no_worklog: false,
                ..
            } if workspace == "feature-a" && resource_dir == PathBuf::from("/tmp/feature-a")
        ));
        assert!(matches!(
            parse_workspace_command(&[
                "worklog-append",
                "feature-a",
                "--kind",
                "修复",
                "--summary",
                "修复分支刷新"
            ]),
            WorkspaceCommands::WorklogAppend {
                workspace: Some(workspace),
                kind,
                summary,
                detail: None,
            } if workspace == "feature-a" && kind == "修复" && summary == "修复分支刷新"
        ));
        assert!(matches!(
            parse_workspace_command(&[
                "worklog-auto",
                "feature-a",
                "--enabled",
                "false"
            ]),
            WorkspaceCommands::WorklogAuto {
                workspace: Some(workspace),
                enabled: false,
            } if workspace == "feature-a"
        ));
    }

    #[test]
    fn parses_batch_merge_projects_and_targets() {
        assert!(matches!(
            parse_git_command(&[
                "merge-many",
                "--project",
                "alpha",
                "--project",
                "beta",
                "--source",
                "feature/demo",
                "--target",
                "pre",
                "--target",
                "main",
                "--plan",
            ]),
            GitCommands::MergeMany {
                projects,
                source_branch,
                target_branches,
                plan,
            } if projects == vec!["alpha", "beta"]
                && source_branch == "feature/demo"
                && target_branches == vec!["pre", "main"]
                && plan
        ));
    }

    #[test]
    fn reported_batch_failure_uses_a_nonzero_exit_code_without_reclassification() {
        let error = anyhow::Error::new(CliReportedFailure {
            code: "partial_failure",
            message: "成功 1 / 失败 1".to_string(),
        });

        assert_eq!(classify_error(&error), ("partial_failure", 1));
    }

    #[test]
    fn parses_runtime_lifecycle_commands_with_stable_json_names() {
        let status = parse_runtime_command(&["status", "--project", "sample"]);
        assert_eq!(status.json_command_name(), "runtime.status");
        assert!(matches!(
            status,
            RuntimeCommands::Status { project, .. } if project == "sample"
        ));

        let list = parse_runtime_command(&["list", "--running-only"]);
        assert_eq!(list.json_command_name(), "runtime.list");
        assert!(matches!(list, RuntimeCommands::List { running_only: true }));

        let stop = parse_runtime_command(&["stop", "--project", "sample"]);
        assert_eq!(stop.json_command_name(), "runtime.stop");
        assert!(matches!(
            stop,
            RuntimeCommands::Stop { project, .. } if project == "sample"
        ));

        let adopt = parse_runtime_command(&["adopt", "--project", "sample", "--pid", "4242"]);
        assert_eq!(adopt.json_command_name(), "runtime.adopt");
        assert!(matches!(
            adopt,
            RuntimeCommands::Adopt {
                project,
                pid,
                debug_profile: None,
                command: None,
                expected_port: None,
            } if project == "sample" && pid == 4242
        ));

        let diagnose = parse_runtime_command(&["diagnose", "--project", "sample"]);
        assert_eq!(diagnose.json_command_name(), "runtime.diagnose");
        assert!(matches!(
            diagnose,
            RuntimeCommands::Diagnose { project, .. } if project == "sample"
        ));

        let wait = parse_runtime_command(&[
            "wait",
            "--project",
            "sample",
            "--run-id",
            "run-1",
            "--until",
            "http-verified",
            "--probe-path",
            "/health",
            "--expect-status",
            "204",
        ]);
        assert_eq!(wait.json_command_name(), "runtime.wait");
        assert!(matches!(
            wait,
            RuntimeCommands::Wait {
                project,
                run_id: Some(run_id),
                until: RuntimeWaitUntilArg::HttpVerified,
                probe_path: Some(path),
                expected_statuses,
                ..
            } if project == "sample"
                && run_id == "run-1"
                && path == "/health"
                && expected_statuses == vec![204]
        ));

        let log = parse_runtime_command(&["log", "--project", "sample", "--current"]);
        assert!(matches!(
            log,
            RuntimeCommands::Log {
                project,
                current: true,
                run_id: None,
                ..
            } if project == "sample"
        ));
    }

    #[test]
    fn parses_managed_artifact_read_only_commands() {
        let list = parse_artifact_command(&[
            "list",
            "--workspace",
            "feature-a",
            "--project",
            "demo",
            "--kind",
            "runtimeState",
        ]);
        assert_eq!(list.json_command_name(), "artifacts.list");
        assert!(matches!(
            list,
            ArtifactCommands::List {
                workspace: Some(workspace),
                all_workspaces: false,
                project: Some(project),
                kinds,
            } if workspace == "feature-a"
                && project == "demo"
                && kinds == vec!["runtimeState"]
        ));

        let plan = parse_artifact_command(&[
            "cleanup-plan",
            "--all-workspaces",
            "--artifact-id",
            "artifact-1",
            "--artifact-id",
            "artifact-2",
        ]);
        assert_eq!(plan.json_command_name(), "artifacts.cleanup-plan");
        assert!(matches!(
            plan,
            ArtifactCommands::CleanupPlan {
                workspace: None,
                all_workspaces: true,
                project: None,
                kinds,
                artifact_ids,
            } if kinds.is_empty()
                && artifact_ids == vec!["artifact-1", "artifact-2"]
        ));
    }

    #[test]
    fn parses_managed_artifact_agent_context_preset() {
        let context = parse_agent_command(&[
            "context",
            "--for",
            "artifacts",
            "--compact",
            "--project",
            "demo",
        ]);
        assert!(matches!(
            context,
            AgentCommands::Context {
                project: Some(project),
                preset: Some(AgentContextPresetArg::Artifacts),
                compact: true,
                ..
            } if project == "demo"
        ));
    }

    #[test]
    fn parses_project_debug_profile_commands_with_stable_json_names() {
        let list = parse_project_command(&["debug-profile-list", "sample"]);
        assert_eq!(list.json_command_name(), "projects.debug-profile-list");
        assert!(matches!(
            list,
            ProjectCommands::DebugProfileList { project } if project == "sample"
        ));

        let show = parse_project_command(&["debug-profile-show", "sample", "local"]);
        assert_eq!(show.json_command_name(), "projects.debug-profile-show");
        assert!(matches!(
            show,
            ProjectCommands::DebugProfileShow { project, profile }
                if project == "sample" && profile == "local"
        ));

        let add = parse_project_command(&[
            "debug-profile-add",
            "sample",
            "--key",
            "local",
            "--label",
            "Local dev",
            "--command",
            "npm run dev:local",
            "--cwd",
            "worktrees/local",
            "--expect-port",
            "4173",
            "--focus-url",
            "http://127.0.0.1:4173/debug",
            "--ready-probe-path",
            "/health",
            "--ready-expect-status",
            "204",
            "--ready-timeout-ms",
            "90000",
            "--runtime-profile",
            "browser",
            "--env",
            "MODE=local",
        ]);
        assert_eq!(add.json_command_name(), "projects.debug-profile-add");
        assert!(matches!(
            add,
            ProjectCommands::DebugProfileAdd {
                project,
                key,
                label: Some(label),
                command: Some(command),
                cwd: Some(cwd),
                expected_port: Some(4173),
                focus_url: Some(focus_url),
                ready_probe_path: Some(ready_probe_path),
                ready_expected_statuses,
                ready_timeout_ms: Some(90000),
                runtime_profile: Some(runtime_profile),
                env,
                ..
            } if project == "sample"
                && key == "local"
                && label == "Local dev"
                && command == "npm run dev:local"
                && cwd == PathBuf::from("worktrees/local")
                && focus_url == "http://127.0.0.1:4173/debug"
                && ready_probe_path == "/health"
                && ready_expected_statuses == vec![204]
                && runtime_profile == "browser"
                && env == ["MODE=local"]
        ));

        let update = parse_project_command(&[
            "debug-profile-update",
            "sample",
            "local",
            "--clear-command",
            "--clear-expect-port",
            "--clear-runtime-profile",
            "--clear-env",
        ]);
        assert_eq!(update.json_command_name(), "projects.debug-profile-update");
        assert!(matches!(
            update,
            ProjectCommands::DebugProfileUpdate {
                project,
                profile,
                clear_command: true,
                clear_expect_port: true,
                clear_runtime_profile: true,
                clear_env: true,
                ..
            } if project == "sample" && profile == "local"
        ));

        let delete = parse_project_command(&["debug-profile-delete", "sample", "local"]);
        assert_eq!(delete.json_command_name(), "projects.debug-profile-delete");
        assert!(matches!(
            delete,
            ProjectCommands::DebugProfileDelete { project, profile }
                if project == "sample" && profile == "local"
        ));
    }

    #[test]
    fn classifies_only_project_debug_profile_writes_as_config_writes() {
        assert!(!parse_project_command(&["debug-profile-list", "sample"]).writes_config());
        assert!(!parse_project_command(&["debug-profile-show", "sample", "local"]).writes_config());
        assert!(
            parse_project_command(&["debug-profile-add", "sample", "--key", "local"])
                .writes_config()
        );
        assert!(
            parse_project_command(&[
                "debug-profile-update",
                "sample",
                "local",
                "--label",
                "Local",
            ])
            .writes_config()
        );
        assert!(
            parse_project_command(&["debug-profile-delete", "sample", "local"]).writes_config()
        );
    }

    #[test]
    fn project_debug_profile_helpers_reject_duplicate_and_missing_keys() {
        let mut project = runtime_project(None, None);
        add_project_debug_profile(
            &mut project,
            "local".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            BTreeMap::new(),
        )
        .unwrap();
        let duplicate = add_project_debug_profile(
            &mut project,
            "local".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            BTreeMap::new(),
        )
        .unwrap_err();
        assert!(duplicate.to_string().contains("already exists"));

        let missing_update = update_project_debug_profile(
            &mut project,
            "missing",
            ProjectDebugProfilePatch {
                label: Some("Missing".to_string()),
                ..ProjectDebugProfilePatch::default()
            },
        )
        .unwrap_err();
        assert!(missing_update.to_string().contains("not found"));

        let missing_delete = delete_project_debug_profile(&mut project, "missing").unwrap_err();
        assert!(missing_delete.to_string().contains("not found"));
    }

    #[test]
    fn project_debug_profile_update_preserves_unspecified_nested_fields() {
        let mut project = runtime_project(None, None);
        project.debug_profiles.push(ProjectDebugProfileConfig {
            key: "local".to_string(),
            label: "Local".to_string(),
            command: Some("npm run dev".to_string()),
            cwd: Some(PathBuf::from("worktrees/local")),
            expected_port: Some(5173),
            focus_url: Some("http://127.0.0.1:5173/debug".to_string()),
            ready_probe: Some(ProjectDebugReadyProbeConfig {
                path: Some("/health".to_string()),
                expected_statuses: vec![204],
                timeout_ms: Some(90_000),
                ..ProjectDebugReadyProbeConfig::default()
            }),
            runtime_profile: Some("browser".to_string()),
            env: BTreeMap::from([("OLD".to_string(), "kept".to_string())]),
            local_files: vec![ProjectDebugLocalFileConfig {
                path: PathBuf::from(".env.local"),
                mode: "overwrite".to_string(),
                content: "MODE=local".to_string(),
                enabled: true,
            }],
            browser: Some("chrome".to_string()),
            browser_args: vec!["--guest".to_string()],
            ..ProjectDebugProfileConfig::default()
        });

        update_project_debug_profile(
            &mut project,
            "local",
            ProjectDebugProfilePatch {
                label: Some("Local updated".to_string()),
                command: None,
                clear_command: true,
                env: BTreeMap::from([("NEW".to_string(), "added".to_string())]),
                ..ProjectDebugProfilePatch::default()
            },
        )
        .unwrap();

        let profile = &project.debug_profiles[0];
        assert_eq!(profile.label, "Local updated");
        assert_eq!(profile.command, None);
        assert_eq!(profile.cwd, Some(PathBuf::from("worktrees/local")));
        assert_eq!(profile.expected_port, Some(5173));
        assert_eq!(
            profile.focus_url.as_deref(),
            Some("http://127.0.0.1:5173/debug")
        );
        assert_eq!(
            profile
                .ready_probe
                .as_ref()
                .and_then(|probe| probe.path.as_deref()),
            Some("/health")
        );
        assert_eq!(profile.runtime_profile.as_deref(), Some("browser"));
        assert_eq!(profile.env.get("OLD").map(String::as_str), Some("kept"));
        assert_eq!(profile.env.get("NEW").map(String::as_str), Some("added"));
        assert_eq!(profile.local_files.len(), 1);
        assert_eq!(profile.local_files[0].path, PathBuf::from(".env.local"));
        assert_eq!(profile.browser.as_deref(), Some("chrome"));
        assert_eq!(profile.browser_args, ["--guest"]);

        update_project_debug_profile(
            &mut project,
            "local",
            ProjectDebugProfilePatch {
                clear_expect_port: true,
                clear_runtime_profile: true,
                clear_env: true,
                ..ProjectDebugProfilePatch::default()
            },
        )
        .unwrap();

        let profile = &project.debug_profiles[0];
        assert_eq!(profile.expected_port, None);
        assert_eq!(profile.runtime_profile, None);
        assert!(profile.env.is_empty());
        assert_eq!(profile.local_files.len(), 1);
        assert_eq!(profile.browser.as_deref(), Some("chrome"));
    }

    #[test]
    fn runtime_restart_accepts_the_same_launch_overrides_as_start() {
        let restart = parse_runtime_command(&[
            "restart",
            "--project",
            "sample",
            "--debug-profile",
            "debug",
            "--runtime-profile",
            "browser",
            "--command",
            "npm run dev:local",
            "--expect-port",
            "4173",
            "--env",
            "MODE=local",
            "--env",
            "DEBUG=true",
        ]);
        assert_eq!(restart.json_command_name(), "runtime.restart");
        assert!(matches!(
            restart,
            RuntimeCommands::Restart {
                project,
                debug_profile: Some(debug_profile),
                runtime_profile: Some(runtime_profile),
                command: Some(command),
                expected_port: Some(4173),
                env,
            } if project == "sample"
                && debug_profile == "debug"
                && runtime_profile == "browser"
                && command == "npm run dev:local"
                && env == ["MODE=local", "DEBUG=true"]
        ));
    }

    #[test]
    fn runtime_lookup_cwd_prefers_dev_cwd_and_canonicalizes_it() {
        let repo_path = std::env::current_dir().unwrap();
        let project = runtime_project(Some(repo_path.clone()), Some(PathBuf::from("src")));
        let cwd = resolve_project_runtime_lookup_cwd(&project).unwrap();
        assert_eq!(cwd, repo_path.join("src").canonicalize().unwrap());

        let absolute_dev_cwd = repo_path.join("docs");
        let project = runtime_project(Some(repo_path.clone()), Some(absolute_dev_cwd.clone()));
        let cwd = resolve_project_runtime_lookup_cwd(&project).unwrap();
        assert_eq!(cwd, absolute_dev_cwd.canonicalize().unwrap());
    }

    #[test]
    fn runtime_lookup_cwd_falls_back_to_repo_path() {
        let repo_path = std::env::current_dir().unwrap();
        let project = runtime_project(Some(repo_path.clone()), None);
        let cwd = resolve_project_runtime_lookup_cwd(&project).unwrap();
        assert_eq!(cwd, repo_path.canonicalize().unwrap());

        let project = runtime_project(None, Some(PathBuf::from("src")));
        let error = resolve_project_runtime_lookup_cwd(&project).unwrap_err();
        assert!(error.to_string().contains("relative dev.cwd"));
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
            resource_dir,
            worklog_file,
            no_worklog,
            no_auto_worklog,
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
            let mut workspace = create_project_workspace(
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
            let initializes_resources =
                !no_worklog || resource_dir.is_some() || worklog_file.is_some();
            workspace.worklog_auto_record = !no_auto_worklog && initializes_resources;
            save_project_workspace_config(
                &paths
                    .project_workspaces
                    .join(format!("{}.toml", workspace.key)),
                &workspace,
            )?;
            if initializes_resources {
                let normalized_resource_dir =
                    resource_dir.map(normalize_cli_path_buf).transpose()?;
                (workspace, _) = initialize_workspace_resources(
                    &paths,
                    &workspace.key,
                    normalized_resource_dir,
                    worklog_file,
                    !no_worklog,
                )?;
            }
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
            instance_dir,
            copy_mode,
            resource_dir,
            worklog_file,
            no_worklog,
            no_auto_worklog,
            requirement_category,
            requirement_short_label,
            requirement_entry_name,
            no_switch,
            allow_remote_mismatch,
            dry_run,
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
                    instance_dir,
                    copy_mode: copy_mode.into(),
                    resource_dir: resource_dir.map(normalize_cli_path_buf).transpose()?,
                    worklog_file,
                    create_worklog: !no_worklog,
                    worklog_auto_record: !no_worklog && !no_auto_worklog,
                    requirement_category: Some(requirement_category),
                    requirement_short_label: Some(requirement_short_label),
                    requirement_entry_name: Some(requirement_entry_name),
                    activate: !no_switch,
                    allow_remote_mismatch,
                    dry_run,
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
            println!("resource dir  : {}", info.resources.resource_dir);
            println!("worklog       : {}", info.resources.worklog_path);
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
        WorkspaceCommands::ResourcesInit {
            workspace,
            resource_dir,
            worklog_file,
            no_worklog,
        } => {
            let paths = ensure_default_configs()?;
            let key = resolve_workspace_cli_key(&paths, workspace)?;
            let (_, status) = initialize_workspace_resources(
                &paths,
                &key,
                resource_dir.map(normalize_cli_path_buf).transpose()?,
                worklog_file,
                !no_worklog,
            )?;
            if json_mode {
                return print_json_command("workspace.resources-init", &status);
            }
            print_workspace_resource_status(&status);
            Ok(())
        }
        WorkspaceCommands::WorklogAppend {
            workspace,
            kind,
            summary,
            detail,
        } => {
            let paths = ensure_default_configs()?;
            let key = resolve_workspace_cli_key(&paths, workspace)?;
            let result =
                append_workspace_worklog(&paths, &key, &kind, &summary, detail.as_deref())?;
            if json_mode {
                return print_json_command("workspace.worklog-append", &result);
            }
            println!("workspace     : {}", result.workspace_key);
            println!("worklog       : {}", result.path);
            println!("recorded at   : {}", result.recorded_at);
            println!("entry         : {} · {}", result.kind, result.summary);
            Ok(())
        }
        WorkspaceCommands::WorklogShow { workspace, lines } => {
            let paths = ensure_default_configs()?;
            let key = resolve_workspace_cli_key(&paths, workspace)?;
            let result = read_workspace_worklog(&paths, &key, lines)?;
            if json_mode {
                return print_json_command("workspace.worklog-show", &result);
            }
            println!("worklog       : {}", result.path);
            println!(
                "lines         : {} / {}",
                result.shown_lines, result.total_lines
            );
            if result.exists && !result.content.is_empty() {
                println!();
                println!("{}", result.content);
            }
            Ok(())
        }
        WorkspaceCommands::WorklogAuto { workspace, enabled } => {
            let paths = ensure_default_configs()?;
            let key = resolve_workspace_cli_key(&paths, workspace)?;
            let status = set_workspace_worklog_auto_record(&paths, &key, enabled)?;
            if json_mode {
                return print_json_command("workspace.worklog-auto", &status);
            }
            print_workspace_resource_status(&status);
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
            allow_remote_mismatch,
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
                allow_remote_mismatch,
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
    let resource_status = workspace_resource_status(&workspace);
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
        resource_dir: resource_status
            .as_ref()
            .map(|status| status.resource_dir.clone()),
        worklog_file: resource_status
            .as_ref()
            .map(|status| status.worklog_file.clone()),
        worklog_path: resource_status
            .as_ref()
            .map(|status| status.worklog_path.clone()),
        worklog_exists: resource_status
            .as_ref()
            .is_some_and(|status| status.worklog_exists),
        worklog_auto_record: workspace.worklog_auto_record,
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

fn resolve_workspace_cli_key(paths: &ConfigPaths, workspace: Option<String>) -> Result<String> {
    match workspace.and_then(|value| {
        let value = value.trim().to_string();
        (!value.is_empty()).then_some(value)
    }) {
        Some(key) => Ok(key),
        None => Ok(active_project_workspace_key(&load_workspace_config(
            &paths.workspace,
        )?)),
    }
}

fn record_cli_workspace_operation(event: WorkspaceOperationWorklogEvent) {
    let result = (|| {
        let paths = ensure_default_configs()?;
        let workspace = load_active_project_workspace(&paths)?;
        append_workspace_operation_worklog(&paths, &workspace.key, event)?;
        Ok::<(), anyhow::Error>(())
    })();
    if let Err(error) = result {
        eprintln!("warning: failed to record workspace worklog: {error}");
    }
}

#[allow(clippy::too_many_arguments)]
fn record_cli_lifecycle_operation(
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
    let result = (|| {
        let paths = ensure_default_configs()?;
        let workspace = load_active_project_workspace(&paths)?;
        let storage = Storage::new_default().map_err(anyhow::Error::msg)?;
        let event = lifecycle_operation_event(
            operation_event_id(None, OperationEventOrigin::Cli, action),
            OperationEventOrigin::Cli,
            workspace.key,
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
        save_operation_event(&storage, &event).map_err(anyhow::Error::msg)
    })();
    if let Err(error) = result {
        eprintln!("warning: failed to record {domain} operation event: {error}");
    }
}

fn runtime_operation_payload<T: Serialize>(
    response: Option<&T>,
    project_key: &str,
    options: &ProjectRuntimeLaunchOptions,
) -> serde_json::Value {
    let mut payload = response
        .and_then(|response| serde_json::to_value(response).ok())
        .unwrap_or_else(|| json!({}));
    if !payload.is_object() {
        payload = json!({});
    }
    if let Some(payload) = payload.as_object_mut() {
        payload.insert("projectKey".to_string(), json!(project_key));
        payload.insert(
            "debugProfile".to_string(),
            json!(options.debug_profile.clone()),
        );
        payload.insert("envOverrides".to_string(), json!(options.env.clone()));
        payload.insert(
            "requestedRuntimeProfile".to_string(),
            json!(options.runtime_profile.clone()),
        );
        payload.insert(
            "requestedCommand".to_string(),
            json!(options.command.clone()),
        );
        payload.insert(
            "requestedExpectedPort".to_string(),
            json!(options.expected_port),
        );
    }
    payload
}

fn record_cli_link_operation(action: &str, link_key: &str, result: &Result<LinkExecutionReport>) {
    let record_result = (|| {
        let paths = ensure_default_configs()?;
        let workspace = load_active_project_workspace(&paths)?;
        let storage = Storage::new_default().map_err(anyhow::Error::msg)?;
        let error = result.as_ref().err().map(ToString::to_string);
        let event = link_operation_event(
            operation_event_id(None, OperationEventOrigin::Cli, &format!("link-{action}")),
            OperationEventOrigin::Cli,
            workspace.key,
            action,
            link_key,
            None,
            result.as_ref().ok(),
            error.as_deref(),
        );
        save_operation_event(&storage, &event).map_err(anyhow::Error::msg)
    })();
    if let Err(error) = record_result {
        eprintln!("warning: failed to record link operation event: {error}");
    }
}

fn record_cli_branch_task(action: &str, result: &Result<BranchTaskResponse>) {
    let event = match result {
        Ok(response) => WorkspaceOperationWorklogEvent {
            event_id: None,
            kind: "Git".to_string(),
            summary: format!("{action} · {}", response.summary),
            detail: Some(response.detail.clone()),
            success: response.success,
        },
        Err(error) => WorkspaceOperationWorklogEvent {
            event_id: None,
            kind: "Git".to_string(),
            summary: format!("{action}失败"),
            detail: Some(error.to_string()),
            success: false,
        },
    };
    record_cli_workspace_operation(event);
}

fn record_cli_branch_task_artifacts(
    action_label: &str,
    action_key: &str,
    replay: Option<&serde_json::Value>,
    result: &Result<BranchTaskResponse>,
) {
    let result = (|| {
        let paths = ensure_default_configs()?;
        let workspace = load_active_project_workspace(&paths)?;
        let storage = Storage::new_default().map_err(anyhow::Error::msg)?;
        let event_id = operation_event_id(None, OperationEventOrigin::Cli, action_key);
        let mut related_history_keys = Vec::new();
        if let Ok(response) = result {
            let history_result = if response.task_kind == "sync" {
                storage
                    .save_branch_task_merge_history_for_event(
                        &workspace, response, "cli", &event_id,
                    )
                    .map_err(anyhow::Error::msg)
            } else {
                let entry = cli_branch_task_history_entry_with_id(
                    &workspace.key,
                    response,
                    &event_id,
                    replay,
                )?;
                storage
                    .prepend_json_array(
                        BRANCH_WORKFLOW_STORAGE_NAMESPACE,
                        BRANCH_WORKFLOW_HISTORY_KEY,
                        entry,
                        BRANCH_WORKFLOW_HISTORY_LIMIT,
                    )
                    .map(|_| vec![event_id.clone()])
                    .map_err(anyhow::Error::msg)
            };
            match history_result {
                Ok(history_keys) => related_history_keys = history_keys,
                Err(error) => eprintln!("warning: failed to save branch task history: {error}"),
            }
        }

        let error = result.as_ref().err().map(ToString::to_string);
        let mut event = branch_task_operation_event(
            event_id,
            OperationEventOrigin::Cli,
            workspace.key,
            action_label,
            action_key,
            result
                .as_ref()
                .ok()
                .and_then(|response| response.items.first())
                .map(|item| item.project_key.as_str()),
            result.as_ref().ok(),
            error.as_deref(),
            related_history_keys,
        );
        if let Some(replay) = replay {
            let payload = event.payload.get_or_insert_with(|| json!({}));
            if let Some(payload) = payload.as_object_mut() {
                payload.insert("replay".to_string(), replay.clone());
            }
        }
        save_operation_event(&storage, &event).map_err(anyhow::Error::msg)?;
        Ok::<(), anyhow::Error>(())
    })();
    if let Err(error) = result {
        eprintln!("warning: failed to save branch operation event: {error}");
    }
}

fn cli_branch_task_history_entry_with_id(
    workspace_key: &str,
    response: &BranchTaskResponse,
    event_id: &str,
    replay: Option<&serde_json::Value>,
) -> Result<serde_json::Value> {
    let mut entry = serde_json::to_value(response)?;
    let object = entry
        .as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("branch task history must be a JSON object"))?;
    object.insert("id".to_string(), json!(event_id));
    object.insert("workspaceKey".to_string(), json!(workspace_key));
    object.insert(
        "createdAt".to_string(),
        json!(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
    );
    object.insert(
        "replay".to_string(),
        replay.cloned().unwrap_or(serde_json::Value::Null),
    );
    Ok(entry)
}

fn cli_branch_replay_request(
    command: &str,
    busy_text: &str,
    request: serde_json::Value,
) -> serde_json::Value {
    json!({
        "command": command,
        "busyText": busy_text,
        "request": request,
    })
}

fn finish_branch_task_command(
    action: Option<(&str, &str)>,
    replay: Option<serde_json::Value>,
    result: Result<BranchTaskResponse>,
    json_mode: bool,
    command_name: &str,
    failure_code: &'static str,
) -> Result<()> {
    if let Some((action_label, action_key)) = action {
        record_cli_branch_task_artifacts(action_label, action_key, replay.as_ref(), &result);
        record_cli_branch_task(action_label, &result);
    }

    let response = result?;
    if json_mode {
        print_branch_task_json_command(command_name, &response, failure_code)?;
    } else {
        print_branch_task_result(&response);
    }
    if response.success {
        return Ok(());
    }

    Err(anyhow::Error::new(CliReportedFailure {
        code: failure_code,
        message: response.summary,
    }))
}

fn is_terminal_deploy_state(state_key: &str) -> bool {
    matches!(
        state_key,
        "success"
            | "succeeded"
            | "failure"
            | "failed"
            | "error"
            | "cancelled"
            | "canceled"
            | "aborted"
    )
}

fn deploy_history_worklog_event(
    request: &SaveDeployHistoryRequest,
) -> Option<WorkspaceOperationWorklogEvent> {
    if !is_terminal_deploy_state(&request.state_key) {
        return None;
    }
    let success = matches!(request.state_key.as_str(), "success" | "succeeded");
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

fn build_operation_title(action: &str) -> &'static str {
    match action.trim().to_ascii_lowercase().as_str() {
        "deploy" => "触发部署",
        "package" => "触发产物构建",
        "release" => "触发发布",
        _ => "触发构建",
    }
}

fn persist_cli_deploy_result(result: &BuildTriggerResponse, event_id: &str) -> Result<()> {
    let workspace = active_history_workspace_cli()?;
    let request = build_history_request(&workspace, result, event_id);
    let worklog_event = deploy_history_worklog_event(&request);
    let storage = Storage::new_default().map_err(anyhow::Error::msg)?;
    let event = build_operation_event(
        event_id.to_string(),
        OperationEventOrigin::Cli,
        workspace.key,
        build_operation_title(&result.plan.action_kind),
        &result.plan.action_kind,
        &request,
    );
    storage
        .save_deploy_history(request)
        .map_err(anyhow::Error::msg)?;
    save_operation_event(&storage, &event).map_err(anyhow::Error::msg)?;
    if let Some(event) = worklog_event {
        record_cli_workspace_operation(event);
    }
    Ok(())
}

fn persist_cli_deploy_status(
    status: &BuildStatusResponse,
    requested_queue_url: Option<&str>,
    requested_build_url: Option<&str>,
) -> Result<()> {
    let storage = Storage::new_default().map_err(anyhow::Error::msg)?;
    let workspace = active_history_workspace_cli()?;
    let workspace_key = (!workspace.is_system()).then_some(workspace.key.as_str());
    let Some(request) = storage
        .update_deploy_history_status(
            status,
            requested_queue_url,
            requested_build_url,
            None,
            workspace_key,
        )
        .map_err(anyhow::Error::msg)?
    else {
        return Ok(());
    };
    let worklog_event = deploy_history_worklog_event(&request);
    update_build_operation_event_from_history(&storage, &request).map_err(anyhow::Error::msg)?;
    if let Some(event) = worklog_event {
        record_cli_workspace_operation(event);
    }
    Ok(())
}

fn execute_cli_deploy(config: &AppConfig, request: &DeployRequest) -> Result<BuildTriggerResponse> {
    let project_key = request.project.clone();
    let project_name = config
        .find_project(&project_key)
        .ok()
        .map(|project| project.name.clone());
    let event_id = operation_event_id(None, OperationEventOrigin::Cli, "build");
    let planned_action = core::build_plan(config, request)
        .ok()
        .map(|plan| plan.action_kind);
    match core::trigger_deploy(config, request) {
        Ok(result) => {
            if let Err(error) = persist_cli_deploy_result(&result, &event_id) {
                eprintln!("warning: failed to save deploy history: {error}");
            }
            Ok(result)
        }
        Err(error) => {
            let action = planned_action.as_deref().unwrap_or("build");
            let persistence_result = (|| {
                let workspace = active_history_workspace_cli()?;
                let storage = Storage::new_default().map_err(anyhow::Error::msg)?;
                let event = failed_build_operation_event(
                    event_id.clone(),
                    OperationEventOrigin::Cli,
                    workspace.key,
                    build_operation_title(action),
                    action,
                    project_name.as_deref(),
                    request,
                    &error.to_string(),
                );
                save_operation_event(&storage, &event).map_err(anyhow::Error::msg)
            })();
            if let Err(save_error) = persistence_result {
                eprintln!("warning: failed to save build failure event: {save_error}");
            }
            record_cli_workspace_operation(WorkspaceOperationWorklogEvent {
                event_id: Some(format!("build:{event_id}:failure")),
                kind: "构建".to_string(),
                summary: format!("触发 {project_key} 构建失败"),
                detail: Some(error.to_string()),
                success: false,
            });
            Err(error)
        }
    }
}

fn merge_history_request(
    workspace: &ProjectWorkspaceConfig,
    response: &MergeResponse,
) -> SaveMergeHistoryRequest {
    let commit = |value: &rdevtool_core::core::BranchCommitInfo| HistoryCommitInfo {
        short_hash: value.short_hash.clone(),
        subject: value.subject.clone(),
        committed_at: value.committed_at.clone(),
    };
    SaveMergeHistoryRequest {
        history_key: format!("cli-merge-{}", uuid::Uuid::new_v4()),
        workspace_key: Some(workspace.key.clone()),
        project_instance_path: workspace
            .project_instance_path(&response.project_key)
            .map(|path| path.display().to_string()),
        project_key: response.project_key.clone(),
        project_name: response.project_name.clone(),
        source_branch: response.source_branch.clone(),
        target_branch: response.target_branch.clone(),
        success: response.success,
        remote: response.remote,
        summary: response.summary.clone(),
        detail: response.detail.clone(),
        merged_commit: response.merged_commit.clone(),
        source_commit: response.source_commit.as_ref().map(commit),
        target_commit: response.target_commit.as_ref().map(commit),
    }
}

fn record_cli_merge_result(
    action: &str,
    project: &str,
    source: &str,
    target: &str,
    result: &Result<MergeResponse>,
) {
    if let Ok(response) = result {
        let save_result = (|| {
            let workspace = active_history_workspace_cli()?;
            Storage::new_default()
                .map_err(anyhow::Error::msg)?
                .save_merge_history(merge_history_request(&workspace, response))
                .map_err(anyhow::Error::msg)
        })();
        if let Err(error) = save_result {
            eprintln!("warning: failed to save merge history: {error}");
        }
    }
    let event = match result {
        Ok(response) => WorkspaceOperationWorklogEvent {
            event_id: response.merged_commit.as_ref().map(|commit| {
                format!(
                    "git-merge:{}:{}:{}",
                    response.project_key, response.target_branch, commit
                )
            }),
            kind: "Git".to_string(),
            summary: format!("{action} · {}", response.summary),
            detail: Some(format!(
                "- 项目: `{}`\n- 分支: `{}` → `{}`\n\n{}",
                response.project_key,
                response.source_branch,
                response.target_branch,
                response.detail
            )),
            success: response.success,
        },
        Err(error) => WorkspaceOperationWorklogEvent {
            event_id: None,
            kind: "Git".to_string(),
            summary: format!("{action}失败"),
            detail: Some(format!(
                "- 项目: `{project}`\n- 分支: `{source}` → `{target}`\n\n{error}"
            )),
            success: false,
        },
    };
    record_cli_workspace_operation(event);
}

fn print_workspace_resource_status(value: &WorkspaceResourceStatus) {
    println!(
        "workspace     : {} ({})",
        value.workspace_name, value.workspace_key
    );
    println!("resource dir  : {}", value.resource_dir);
    println!("worklog       : {}", value.worklog_path);
    println!("auto record   : {}", value.auto_record_enabled);
    println!(
        "status        : {}",
        if value.worklog_created {
            "created"
        } else if value.worklog_exists {
            "ready"
        } else {
            "configured"
        }
    );
}

fn init_demand_workspace_cli_info(
    result: InitDemandWorkspaceResult,
    config: &AppConfig,
    active_key: &str,
) -> InitDemandWorkspaceCliInfo {
    InitDemandWorkspaceCliInfo {
        schema_version: result.schema_version,
        dry_run: result.dry_run,
        copy_mode: result.copy_mode,
        requested: result.requested,
        effective: result.effective,
        observed: result.observed,
        status: result.status,
        evidence: result.evidence,
        risks: result.risks,
        managed_artifacts: result.managed_artifacts,
        recommended_actions: result.recommended_actions,
        planned_actions: result.planned_actions,
        workspace: project_workspace_cli_info(result.workspace, config, active_key),
        project: result.project,
        requirement_entry: result.requirement_entry,
        resources: result.resources,
        branch: result.branch,
        metadata: result.metadata,
        warnings: result.warnings,
        source_repository_validation: result.source_repository_validation,
        project_instance_validation: result.project_instance_validation,
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
    if let Some(resource_dir) = &value.resource_dir {
        println!("resource dir  : {}", resource_dir);
    }
    if let Some(worklog_path) = &value.worklog_path {
        println!(
            "worklog       : {} ({})",
            worklog_path,
            if value.worklog_exists {
                "ready"
            } else {
                "missing"
            }
        );
        println!("auto record   : {}", value.worklog_auto_record);
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
                .or_else(|| entry.tool_key.clone())
                .or_else(|| entry.tool.clone())
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
    let mut project_instance_validations = Vec::new();

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
            let project = config.find_project(&instance.project)?;
            project_instance_validations.push(validate_workspace_project_instance(
                project,
                &instance,
                update.allow_remote_mismatch,
            )?);
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
        project_instance_validations,
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
            managed: false,
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
    let catalog = core::branch_catalog(config, key)?;
    if !catalog.status.success {
        anyhow::bail!(catalog.status.detail);
    }
    let branches = catalog
        .branches
        .iter()
        .map(|branch| branch.name.clone())
        .collect::<Vec<_>>();
    if json_mode {
        return print_json_command(
            command_name,
            &json!({
                "project": key,
                "branches": branches,
                "branchOptions": catalog.branches,
                "requested": catalog.requested,
                "effective": catalog.effective,
                "observed": catalog.observed,
                "status": catalog.status,
                "evidence": catalog.evidence,
                "risks": catalog.risks,
                "recommendedActions": catalog.recommended_actions,
            }),
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
    let command_name = command.json_command_name();
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
            output_dir,
        } => add_project_target_config_command(
            project,
            key,
            label,
            adapter,
            action_kind,
            profile,
            job,
            output_dir,
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
            output_dir,
            clear_output_dir,
        } => update_project_target_config_command(
            project,
            target,
            label,
            adapter,
            action_kind,
            profile,
            job,
            output_dir,
            clear_output_dir,
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
            impact_paths,
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
            impact_paths,
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
            impact_paths,
            clear_impact_paths,
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
            impact_paths,
            clear_impact_paths,
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
        ProjectCommands::DebugProfileAdd {
            project,
            key,
            label,
            command,
            cwd,
            expected_port,
            focus_url,
            ready_probe_url,
            ready_probe_path,
            ready_expected_statuses,
            ready_timeout_ms,
            runtime_profile,
            env,
        } => add_project_debug_profile_config_command(
            project,
            key,
            label,
            command,
            cwd,
            expected_port,
            focus_url,
            ready_probe_url,
            ready_probe_path,
            ready_expected_statuses,
            ready_timeout_ms,
            runtime_profile,
            env,
            config_override,
            json_mode,
            command_name,
        ),
        ProjectCommands::DebugProfileUpdate {
            project,
            profile,
            label,
            command,
            clear_command,
            cwd,
            clear_cwd,
            expected_port,
            clear_expect_port,
            focus_url,
            clear_focus_url,
            ready_probe_url,
            ready_probe_path,
            ready_expected_statuses,
            ready_timeout_ms,
            clear_ready_probe,
            runtime_profile,
            clear_runtime_profile,
            env,
            clear_env,
        } => update_project_debug_profile_config_command(
            project,
            profile,
            ProjectDebugProfilePatch {
                label,
                command,
                clear_command,
                cwd,
                clear_cwd,
                expected_port,
                clear_expect_port,
                focus_url,
                clear_focus_url,
                ready_probe_url,
                ready_probe_path,
                ready_expected_statuses,
                ready_timeout_ms,
                clear_ready_probe,
                runtime_profile,
                clear_runtime_profile,
                env: parse_key_value_map(&env)?,
                clear_env,
            },
            config_override,
            json_mode,
            command_name,
        ),
        ProjectCommands::DebugProfileDelete { project, profile } => {
            delete_project_debug_profile_config_command(
                project,
                profile,
                config_override,
                json_mode,
                command_name,
            )
        }
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
    output_dir: Option<PathBuf>,
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
    let artifact = output_dir
        .map(normalize_cli_path_buf)
        .transpose()?
        .map(|output_dir| BuildArtifactConfig {
            output_dir: Some(output_dir),
        });

    project_config.deploy_targets.push(DeployTargetConfig {
        key: key.clone(),
        label,
        adapter,
        action_kind,
        jenkins_profile: profile,
        job_name: job.clone(),
        artifact,
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
    output_dir: Option<PathBuf>,
    clear_output_dir: bool,
    config_override: Option<&Path>,
    json_mode: bool,
) -> Result<()> {
    if label.is_none()
        && adapter.is_none()
        && action_kind.is_none()
        && profile.is_none()
        && job.is_none()
        && output_dir.is_none()
        && !clear_output_dir
    {
        anyhow::bail!("at least one build target update flag is required");
    }
    if output_dir.is_some() && clear_output_dir {
        anyhow::bail!("choose only one of --output-dir or --clear-output-dir");
    }

    let output_dir = output_dir.map(normalize_cli_path_buf).transpose()?;

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
    if clear_output_dir {
        target_config.artifact = None;
    } else if let Some(output_dir) = output_dir {
        target_config.artifact = Some(BuildArtifactConfig {
            output_dir: Some(output_dir),
        });
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
    impact_paths: Vec<String>,
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
            impact_paths: normalize_cli_strings(impact_paths),
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
    impact_paths: Vec<String>,
    clear_impact_paths: bool,
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
    if !impact_paths.is_empty() && clear_impact_paths {
        anyhow::bail!("choose only one of --impact-path or --clear-impact-paths");
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
        && impact_paths.is_empty()
        && !clear_impact_paths
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
        if !impact_paths.is_empty() {
            param_config.impact_paths = normalize_cli_strings(impact_paths);
        }
        if clear_impact_paths {
            param_config.impact_paths.clear();
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

#[derive(Default)]
struct ProjectDebugProfilePatch {
    label: Option<String>,
    command: Option<String>,
    clear_command: bool,
    cwd: Option<PathBuf>,
    clear_cwd: bool,
    expected_port: Option<u16>,
    clear_expect_port: bool,
    focus_url: Option<String>,
    clear_focus_url: bool,
    ready_probe_url: Option<String>,
    ready_probe_path: Option<String>,
    ready_expected_statuses: Vec<u16>,
    ready_timeout_ms: Option<u64>,
    clear_ready_probe: bool,
    runtime_profile: Option<String>,
    clear_runtime_profile: bool,
    env: BTreeMap<String, String>,
    clear_env: bool,
}

fn list_project_debug_profiles(
    config: &AppConfig,
    project: &str,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    let project = find_project_config(config, project)?;
    if json_mode {
        return print_json_command(
            command_name,
            &json!({
                "project": project.key,
                "profiles": project.debug_profiles,
            }),
        );
    }
    for profile in &project.debug_profiles {
        println!("{:<20} {}", profile.key, profile.label);
    }
    Ok(())
}

fn show_project_debug_profile(
    config: &AppConfig,
    project: &str,
    profile: &str,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    let project = find_project_config(config, project)?;
    let profile = find_project_debug_profile(project, profile)?;
    if json_mode {
        return print_json_command(
            command_name,
            &json!({
                "project": project.key,
                "profile": profile,
            }),
        );
    }
    print_project_debug_profile(profile);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn add_project_debug_profile_config_command(
    project: String,
    key: String,
    label: Option<String>,
    command: Option<String>,
    cwd: Option<PathBuf>,
    expected_port: Option<u16>,
    focus_url: Option<String>,
    ready_probe_url: Option<String>,
    ready_probe_path: Option<String>,
    ready_expected_statuses: Vec<u16>,
    ready_timeout_ms: Option<u64>,
    runtime_profile: Option<String>,
    env: Vec<String>,
    config_override: Option<&Path>,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    let (mut config, config_path) = load_cli_config(config_override)?;
    let env = parse_key_value_map(&env)?;
    let project_config = find_project_config_mut(&mut config, &project)?;
    let project_key = project_config.key.clone();
    let profile_key = add_project_debug_profile(
        project_config,
        key,
        label,
        command,
        cwd,
        expected_port,
        focus_url,
        build_debug_ready_probe(
            ready_probe_url,
            ready_probe_path,
            ready_expected_statuses,
            ready_timeout_ms,
        )?,
        runtime_profile,
        env,
    )?;

    save_config(&config_path, &config)?;
    print_project_debug_profile_config_result(
        &config,
        &config_path,
        &project_key,
        &profile_key,
        json_mode,
        command_name,
    )
}

fn update_project_debug_profile_config_command(
    project: String,
    profile: String,
    patch: ProjectDebugProfilePatch,
    config_override: Option<&Path>,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    let (mut config, config_path) = load_cli_config(config_override)?;
    let project_config = find_project_config_mut(&mut config, &project)?;
    let project_key = project_config.key.clone();
    let profile_key = update_project_debug_profile(project_config, &profile, patch)?;

    save_config(&config_path, &config)?;
    print_project_debug_profile_config_result(
        &config,
        &config_path,
        &project_key,
        &profile_key,
        json_mode,
        command_name,
    )
}

fn delete_project_debug_profile_config_command(
    project: String,
    profile: String,
    config_override: Option<&Path>,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    let (mut config, config_path) = load_cli_config(config_override)?;
    let project_config = find_project_config_mut(&mut config, &project)?;
    let project_key = project_config.key.clone();
    let deleted_profile = delete_project_debug_profile(project_config, &profile)?;

    save_config(&config_path, &config)?;
    if json_mode {
        return print_json_command(
            command_name,
            &json!({
                "configPath": config_path.display().to_string(),
                "project": project_key,
                "deletedProfile": deleted_profile,
            }),
        );
    }
    println!("deleted debug profile: {}", deleted_profile.key);
    println!("project              : {project_key}");
    println!("config path          : {}", config_path.display());
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn add_project_debug_profile(
    project: &mut ProjectConfig,
    key: String,
    label: Option<String>,
    command: Option<String>,
    cwd: Option<PathBuf>,
    expected_port: Option<u16>,
    focus_url: Option<String>,
    ready_probe: Option<ProjectDebugReadyProbeConfig>,
    runtime_profile: Option<String>,
    env: BTreeMap<String, String>,
) -> Result<String> {
    let key = validate_cli_config_key("debug profile", &key)?;
    if project
        .debug_profiles
        .iter()
        .any(|profile| profile.key == key)
    {
        anyhow::bail!(
            "debug profile key already exists for project {}: {key}",
            project.key
        );
    }
    let label = label
        .map(|value| require_non_empty_cli_value("debug profile label", &value))
        .transpose()?
        .unwrap_or_else(|| key.clone());
    let command = normalize_debug_profile_optional_value("debug profile command", command)?;
    let cwd = normalize_debug_profile_cwd(cwd)?;
    let expected_port = validate_debug_profile_expected_port(expected_port)?;
    let focus_url = validate_debug_profile_url("focus URL", focus_url)?;
    let runtime_profile =
        normalize_debug_profile_optional_value("runtime profile", runtime_profile)?;

    project.debug_profiles.push(ProjectDebugProfileConfig {
        key: key.clone(),
        label,
        command,
        cwd,
        expected_port,
        focus_url,
        ready_probe,
        runtime_profile,
        env,
        ..ProjectDebugProfileConfig::default()
    });
    Ok(key)
}

fn update_project_debug_profile(
    project: &mut ProjectConfig,
    profile: &str,
    patch: ProjectDebugProfilePatch,
) -> Result<String> {
    if patch.command.is_some() && patch.clear_command {
        anyhow::bail!("choose only one of --command or --clear-command");
    }
    if patch.cwd.is_some() && patch.clear_cwd {
        anyhow::bail!("choose only one of --cwd or --clear-cwd");
    }
    if patch.expected_port.is_some() && patch.clear_expect_port {
        anyhow::bail!("choose only one of --expect-port or --clear-expect-port");
    }
    if patch.runtime_profile.is_some() && patch.clear_runtime_profile {
        anyhow::bail!("choose only one of --runtime-profile or --clear-runtime-profile");
    }
    if patch.focus_url.is_some() && patch.clear_focus_url {
        anyhow::bail!("choose only one of --focus-url or --clear-focus-url");
    }
    let ready_probe_changed = patch.ready_probe_url.is_some()
        || patch.ready_probe_path.is_some()
        || !patch.ready_expected_statuses.is_empty()
        || patch.ready_timeout_ms.is_some();
    if ready_probe_changed && patch.clear_ready_probe {
        anyhow::bail!("ready probe flags cannot be combined with --clear-ready-probe");
    }
    if patch.label.is_none()
        && patch.command.is_none()
        && !patch.clear_command
        && patch.cwd.is_none()
        && !patch.clear_cwd
        && patch.expected_port.is_none()
        && !patch.clear_expect_port
        && patch.focus_url.is_none()
        && !patch.clear_focus_url
        && !ready_probe_changed
        && !patch.clear_ready_probe
        && patch.runtime_profile.is_none()
        && !patch.clear_runtime_profile
        && patch.env.is_empty()
        && !patch.clear_env
    {
        anyhow::bail!("at least one debug profile update flag is required");
    }

    let label = patch
        .label
        .map(|value| require_non_empty_cli_value("debug profile label", &value))
        .transpose()?;
    let command = normalize_debug_profile_optional_value("debug profile command", patch.command)?;
    let cwd = normalize_debug_profile_cwd(patch.cwd)?;
    let expected_port = validate_debug_profile_expected_port(patch.expected_port)?;
    let focus_url = validate_debug_profile_url("focus URL", patch.focus_url)?;
    let ready_probe = ready_probe_changed
        .then(|| {
            build_debug_ready_probe(
                patch.ready_probe_url,
                patch.ready_probe_path,
                patch.ready_expected_statuses,
                patch.ready_timeout_ms,
            )
        })
        .transpose()?
        .flatten();
    let runtime_profile =
        normalize_debug_profile_optional_value("runtime profile", patch.runtime_profile)?;
    let profile_key = validate_cli_config_key("debug profile", profile)?;
    let project_key = project.key.clone();
    let profile = project
        .debug_profiles
        .iter_mut()
        .find(|item| item.key == profile_key)
        .ok_or_else(|| {
            anyhow::anyhow!("debug profile {profile_key} not found for project {project_key}")
        })?;

    if let Some(label) = label {
        profile.label = label;
    }
    if let Some(command) = command {
        profile.command = Some(command);
    }
    if patch.clear_command {
        profile.command = None;
    }
    if let Some(cwd) = cwd {
        profile.cwd = Some(cwd);
    }
    if patch.clear_cwd {
        profile.cwd = None;
    }
    if let Some(expected_port) = expected_port {
        profile.expected_port = Some(expected_port);
    }
    if patch.clear_expect_port {
        profile.expected_port = None;
    }
    if let Some(focus_url) = focus_url {
        profile.focus_url = Some(focus_url);
    }
    if patch.clear_focus_url {
        profile.focus_url = None;
    }
    if ready_probe_changed {
        profile.ready_probe = ready_probe;
    }
    if patch.clear_ready_probe {
        profile.ready_probe = None;
    }
    if let Some(runtime_profile) = runtime_profile {
        profile.runtime_profile = Some(runtime_profile);
    }
    if patch.clear_runtime_profile {
        profile.runtime_profile = None;
    }
    if patch.clear_env {
        profile.env.clear();
    }
    profile.env.extend(patch.env);

    Ok(profile.key.clone())
}

fn delete_project_debug_profile(
    project: &mut ProjectConfig,
    profile: &str,
) -> Result<ProjectDebugProfileConfig> {
    let profile = validate_cli_config_key("debug profile", profile)?;
    let index = project
        .debug_profiles
        .iter()
        .position(|item| item.key == profile)
        .ok_or_else(|| {
            anyhow::anyhow!(
                "debug profile {profile} not found for project {}",
                project.key
            )
        })?;
    Ok(project.debug_profiles.remove(index))
}

fn normalize_debug_profile_optional_value(
    label: &str,
    value: Option<String>,
) -> Result<Option<String>> {
    value
        .map(|value| require_non_empty_cli_value(label, &value))
        .transpose()
}

fn validate_debug_profile_expected_port(value: Option<u16>) -> Result<Option<u16>> {
    if value == Some(0) {
        anyhow::bail!("debug profile expected port must be between 1 and 65535");
    }
    Ok(value)
}

fn normalize_debug_profile_cwd(value: Option<PathBuf>) -> Result<Option<PathBuf>> {
    value
        .map(|path| {
            if path.as_os_str().is_empty() {
                anyhow::bail!("debug profile cwd cannot be empty");
            }
            Ok(path)
        })
        .transpose()
}

fn validate_debug_profile_url(label: &str, value: Option<String>) -> Result<Option<String>> {
    let value = normalize_debug_profile_optional_value(label, value)?;
    if let Some(value) = value.as_deref() {
        let url = reqwest::Url::parse(value)
            .map_err(|error| anyhow::anyhow!("invalid {label}: {error}"))?;
        if !matches!(url.scheme(), "http" | "https") {
            anyhow::bail!("{label} must use http or https");
        }
        if !url.username().is_empty() || url.password().is_some() {
            anyhow::bail!("{label} must not contain credentials");
        }
    }
    Ok(value)
}

fn build_debug_ready_probe(
    url: Option<String>,
    path: Option<String>,
    mut expected_statuses: Vec<u16>,
    timeout_ms: Option<u64>,
) -> Result<Option<ProjectDebugReadyProbeConfig>> {
    let url = validate_debug_profile_url("ready probe URL", url)?;
    let path = normalize_debug_profile_optional_value("ready probe path", path)?;
    if expected_statuses
        .iter()
        .any(|status| !(100..=599).contains(status))
    {
        anyhow::bail!("ready probe expected status must be between 100 and 599");
    }
    if timeout_ms.is_some_and(|timeout| !(100..=600_000).contains(&timeout)) {
        anyhow::bail!("ready probe timeout must be between 100 and 600000 ms");
    }
    expected_statuses.sort_unstable();
    expected_statuses.dedup();
    if url.is_none() && path.is_none() && expected_statuses.is_empty() && timeout_ms.is_none() {
        return Ok(None);
    }
    Ok(Some(ProjectDebugReadyProbeConfig {
        url,
        path,
        expected_statuses,
        timeout_ms,
    }))
}

fn print_project_debug_profile_config_result(
    config: &AppConfig,
    config_path: &Path,
    project: &str,
    profile: &str,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    let project = find_project_config(config, project)?;
    let profile = find_project_debug_profile(project, profile)?;
    if json_mode {
        return print_json_command(
            command_name,
            &json!({
                "configPath": config_path.display().to_string(),
                "project": project.key,
                "profile": profile,
            }),
        );
    }
    print_project_debug_profile(profile);
    println!("project     : {}", project.key);
    println!("config path : {}", config_path.display());
    Ok(())
}

fn print_project_debug_profile(profile: &ProjectDebugProfileConfig) {
    println!("profile         : {}", profile.key);
    println!("label           : {}", profile.label);
    println!(
        "command         : {}",
        profile.command.as_deref().unwrap_or("<project default>")
    );
    println!(
        "cwd             : {}",
        profile
            .cwd
            .as_ref()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|| "<project default>".to_string())
    );
    println!(
        "expected port   : {}",
        profile
            .expected_port
            .map(|port| port.to_string())
            .unwrap_or_else(|| "<auto>".to_string())
    );
    println!(
        "runtime profile : {}",
        profile.runtime_profile.as_deref().unwrap_or("<none>")
    );
    println!(
        "focus URL       : {}",
        profile.focus_url.as_deref().unwrap_or("<project default>")
    );
    if let Some(probe) = profile.ready_probe.as_ref() {
        println!(
            "ready probe    : url={} path={} statuses={} timeout={}ms",
            probe.url.as_deref().unwrap_or("<focus/ready URL>"),
            probe.path.as_deref().unwrap_or("<none>"),
            if probe.expected_statuses.is_empty() {
                "200-399".to_string()
            } else {
                probe
                    .expected_statuses
                    .iter()
                    .map(u16::to_string)
                    .collect::<Vec<_>>()
                    .join(",")
            },
            probe
                .timeout_ms
                .map(|value| value.to_string())
                .unwrap_or_else(|| "180000".to_string())
        );
    }
    if !profile.env.is_empty() {
        println!("environment:");
        for (key, value) in &profile.env {
            println!("  {key}={value}");
        }
    }
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

fn find_project_config<'a>(config: &'a AppConfig, project: &str) -> Result<&'a ProjectConfig> {
    config
        .projects
        .iter()
        .find(|item| item.key == project)
        .ok_or_else(|| anyhow::anyhow!("project {project} not found"))
}

fn find_project_debug_profile<'a>(
    project: &'a ProjectConfig,
    profile: &str,
) -> Result<&'a ProjectDebugProfileConfig> {
    project
        .debug_profiles
        .iter()
        .find(|item| item.key == profile)
        .ok_or_else(|| {
            anyhow::anyhow!(
                "debug profile {profile} not found for project {}",
                project.key
            )
        })
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
    let command_name = command.json_command_name();
    match command {
        ProjectCommands::List => list_projects_command(config, json_mode, command_name),
        ProjectCommands::Show { project } => {
            show_project_command(config, &project, json_mode, command_name)
        }
        ProjectCommands::Branch { project } => {
            show_branch_command(config, &project, json_mode, command_name)
        }
        ProjectCommands::Branches { project } => {
            show_branches_command(config, &project, json_mode, command_name)
        }
        ProjectCommands::Envs { project, target } => {
            show_envs_command(config, &project, target, json_mode, command_name)
        }
        ProjectCommands::Options { project, target } => {
            show_options_command(config, &project, target, json_mode, command_name)
        }
        ProjectCommands::DebugProfileList { project } => {
            list_project_debug_profiles(config, &project, json_mode, command_name)
        }
        ProjectCommands::DebugProfileShow { project, profile } => {
            show_project_debug_profile(config, &project, &profile, json_mode, command_name)
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
    let plan = core::build_plan_refreshed(config, &request)?;
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
    let result = execute_cli_deploy(config, &request)?;
    if json_mode {
        return print_json_command(command_name, &result);
    }
    print_trigger_result(&result);
    Ok(())
}

const DEFAULT_BUILD_FOLLOW_POLL_INTERVAL_MS: u64 = 3_000;
const DEFAULT_BUILD_FOLLOW_TIMEOUT_SECS: u64 = 5 * 60;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildFollowResponse {
    trigger: BuildTriggerResponse,
    final_status: BuildStatusResponse,
    polls: usize,
    elapsed_ms: u64,
}

struct BuildFollowOutcome {
    status: BuildStatusResponse,
    polls: usize,
    elapsed_ms: u64,
}

impl BuildFollowOptions {
    fn poll_interval(self) -> std::time::Duration {
        std::time::Duration::from_millis(
            self.poll_interval_ms
                .unwrap_or(DEFAULT_BUILD_FOLLOW_POLL_INTERVAL_MS),
        )
    }

    fn timeout(self) -> std::time::Duration {
        std::time::Duration::from_secs(
            self.timeout_secs
                .unwrap_or(DEFAULT_BUILD_FOLLOW_TIMEOUT_SECS),
        )
    }
}

fn trigger_build_command_with_follow(
    config: &AppConfig,
    project: String,
    target: Option<String>,
    env: Option<String>,
    branch: Option<String>,
    extra_params: Vec<String>,
    follow: BuildFollowOptions,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    if !follow.follow {
        return trigger_deploy_command(
            config,
            project,
            target,
            env,
            branch,
            extra_params,
            json_mode,
            command_name,
        );
    }

    let request = DeployRequest {
        project,
        target,
        variant: false,
        env,
        branch,
        extra_params: parse_extra_params_args(extra_params)?,
        params: BTreeMap::new(),
    };
    let trigger = execute_cli_deploy(config, &request)?;
    if !json_mode {
        print_trigger_result(&trigger);
    }

    let outcome = if is_terminal_deploy_state(&trigger.state_key) {
        BuildFollowOutcome {
            status: build_status_from_trigger(&trigger),
            polls: 0,
            elapsed_ms: 0,
        }
    } else {
        follow_build_status(
            config,
            trigger.queue_url.clone(),
            trigger.build_url.clone(),
            follow,
            json_mode,
        )?
    };

    if json_mode {
        return print_json_command(
            command_name,
            &BuildFollowResponse {
                trigger,
                final_status: outcome.status,
                polls: outcome.polls,
                elapsed_ms: outcome.elapsed_ms,
            },
        );
    }
    println!("follow polls  : {}", outcome.polls);
    println!("follow elapsed: {}ms", outcome.elapsed_ms);
    Ok(())
}

fn show_build_status_command(
    config: &AppConfig,
    queue_url: Option<String>,
    build_url: Option<String>,
    follow: BuildFollowOptions,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    if !follow.follow {
        return show_status_command(config, queue_url, build_url, json_mode, command_name);
    }

    let outcome = follow_build_status(config, queue_url, build_url, follow, json_mode)?;
    if json_mode {
        return print_json_command(command_name, &outcome.status);
    }
    println!("follow polls  : {}", outcome.polls);
    println!("follow elapsed: {}ms", outcome.elapsed_ms);
    Ok(())
}

fn follow_build_status(
    config: &AppConfig,
    mut queue_url: Option<String>,
    mut build_url: Option<String>,
    options: BuildFollowOptions,
    json_mode: bool,
) -> Result<BuildFollowOutcome> {
    if queue_url.is_none() && build_url.is_none() {
        anyhow::bail!("没有可跟踪的 Jenkins 队列或构建地址");
    }

    let started = std::time::Instant::now();
    let timeout = options.timeout();
    let poll_interval = options.poll_interval();
    let mut polls = 0usize;
    let mut last_status: Option<BuildStatusResponse> = None;

    loop {
        if started.elapsed() >= timeout {
            return Err(build_follow_timeout_error(
                polls,
                started.elapsed(),
                last_status.as_ref(),
            ));
        }

        let requested_queue_url = queue_url.clone();
        let requested_build_url = build_url.clone();
        let status = core::refresh_deploy_status(
            config,
            &StatusRequest {
                queue_url,
                build_url,
                project: None,
            },
        )?;
        polls += 1;
        if let Err(error) = persist_cli_deploy_status(
            &status,
            requested_queue_url.as_deref(),
            requested_build_url.as_deref(),
        ) {
            eprintln!("warning: failed to update deploy history: {error}");
        }
        if !json_mode {
            print_status(&status);
        }

        queue_url = status.queue_url.clone().or(requested_queue_url);
        build_url = status.build_url.clone().or(requested_build_url);
        if is_terminal_deploy_state(&status.state_key) {
            return Ok(BuildFollowOutcome {
                status,
                polls,
                elapsed_ms: elapsed_millis(started.elapsed()),
            });
        }
        last_status = Some(status);

        let remaining = timeout.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            return Err(build_follow_timeout_error(
                polls,
                started.elapsed(),
                last_status.as_ref(),
            ));
        }
        std::thread::sleep(poll_interval.min(remaining));
    }
}

fn build_status_from_trigger(trigger: &BuildTriggerResponse) -> BuildStatusResponse {
    BuildStatusResponse {
        queue_url: trigger.queue_url.clone(),
        build_url: trigger.build_url.clone(),
        state_key: trigger.state_key.clone(),
        state_label: trigger.state_label.clone(),
        detail: trigger.detail.clone(),
    }
}

fn build_follow_timeout_error(
    polls: usize,
    elapsed: std::time::Duration,
    last_status: Option<&BuildStatusResponse>,
) -> anyhow::Error {
    let state = last_status
        .map(|status| status.state_label.as_str())
        .unwrap_or("尚未获取状态");
    anyhow::anyhow!(
        "构建状态跟踪超时（{}ms，轮询 {polls} 次，最后状态：{state}）",
        elapsed_millis(elapsed)
    )
}

fn elapsed_millis(duration: std::time::Duration) -> u64 {
    duration.as_millis().min(u64::MAX as u128) as u64
}

fn print_trigger_result(result: &BuildTriggerResponse) {
    print_plan(&result.plan);
    println!("triggered     : yes");
    println!("http status   : {}", result.status);
    if let Some(queue_url) = &result.queue_url {
        println!("queue url     : {queue_url}");
    } else {
        println!("queue url     : <missing location header>");
    }
    if let Some(build_url) = &result.build_url {
        println!("build url     : {build_url}");
    } else {
        println!("build url     : <not available>");
    }
    println!("build state   : {}", result.state_label);
    println!("detail        : {}", result.detail);
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
    let requested_queue_url = queue_url.clone();
    let requested_build_url = build_url.clone();
    let status = core::refresh_deploy_status(
        config,
        &StatusRequest {
            queue_url,
            build_url,
            project: None,
        },
    )?;
    if let Err(error) = persist_cli_deploy_status(
        &status,
        requested_queue_url.as_deref(),
        requested_build_url.as_deref(),
    ) {
        eprintln!("warning: failed to update deploy history: {error}");
    }
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
            follow,
        }
        | BuildCommands::Trigger {
            project,
            target,
            env,
            branch,
            extra_params,
            follow,
        } => trigger_build_command_with_follow(
            config,
            project,
            target,
            env,
            branch,
            extra_params,
            follow,
            json_mode,
            "build.run",
        ),
        BuildCommands::Status {
            queue_url,
            build_url,
            follow,
        } => show_build_status_command(
            config,
            queue_url,
            build_url,
            follow,
            json_mode,
            "build.status",
        ),
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
            project: project.clone(),
            source_branch: source.clone(),
            target_branch: target.clone(),
        },
    );
    record_cli_merge_result("合并分支", &project, &source, &target, &result);
    let result = result?;
    if json_mode {
        return print_json_command(command_name, &result);
    }
    print_merge_result(&result);
    Ok(())
}

fn run_branch_sync(
    config: &AppConfig,
    projects: Vec<String>,
    source_branch: String,
    target_branches: Vec<String>,
    plan: bool,
    json_mode: bool,
) -> Result<()> {
    run_branch_sync_command(
        config,
        projects,
        source_branch,
        target_branches,
        plan,
        json_mode,
        "sync-branches",
    )
}

fn run_branch_sync_command(
    config: &AppConfig,
    projects: Vec<String>,
    source_branch: String,
    target_branches: Vec<String>,
    plan: bool,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    if target_branches.is_empty() {
        anyhow::bail!("at least one --target is required");
    }
    if projects.is_empty() {
        anyhow::bail!("at least one --project is required");
    }

    let request = BranchSyncRequest {
        project: String::new(),
        projects,
        source_branch,
        target_branches,
    };
    let result = if plan {
        plan_branch_sync(config, &request)
    } else {
        execute_branch_sync(config, &request)
    };
    if plan {
        finish_branch_task_command(
            None,
            None,
            result,
            json_mode,
            command_name,
            "preflight_failed",
        )
    } else {
        let replay = cli_branch_replay_request(
            "execute_branch_sync_task",
            "正在重新合并分支",
            json!({
                "project": request.project,
                "projects": request.projects,
                "sourceBranch": request.source_branch,
                "targetBranches": request.target_branches,
            }),
        );
        finish_branch_task_command(
            Some(("批量合并分支", "sync")),
            Some(replay),
            result,
            json_mode,
            command_name,
            "partial_failure",
        )
    }
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
            projects,
            source_branch,
            target_branches,
            plan,
        } => run_branch_sync_command(
            config,
            projects,
            source_branch,
            target_branches,
            plan,
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
        GitCommands::PushStatus { project, repo_path } => {
            run_push_status_command(config, project, repo_path, json_mode, "git.push-status")
        }
        GitCommands::Diff {
            project,
            path,
            repo_path,
            mode,
            max_bytes,
            max_lines,
        } => run_branch_file_diff_command(
            config, project, path, repo_path, mode, max_bytes, max_lines, json_mode, "git.diff",
        ),
        GitCommands::Push {
            project,
            message,
            repo_path,
            selected_paths,
        } => run_push_branch_command(
            config,
            project,
            message,
            repo_path,
            selected_paths,
            json_mode,
            "git.push",
        ),
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

    let request = BranchCreateRequest {
        projects,
        source_branch,
        target_branch,
    };
    let result = execute_branch_create(config, &request);
    let replay = cli_branch_replay_request(
        "execute_branch_create_task",
        "正在重新创建分支",
        json!({
            "projects": request.projects,
            "sourceBranch": request.source_branch,
            "targetBranch": request.target_branch,
        }),
    );
    finish_branch_task_command(
        Some(("创建分支", "create")),
        Some(replay),
        result,
        json_mode,
        command_name,
        "branch_task_failed",
    )
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
    let request = BranchCheckoutRequest {
        project,
        source_branch,
        destination_dir: destination,
    };
    let result = checkout_branch_to_directory(config, &request);
    let replay = cli_branch_replay_request(
        "checkout_branch_to_directory_task",
        "正在重新创建工作副本",
        json!({
            "project": request.project,
            "sourceBranch": request.source_branch,
            "destinationDir": request.destination_dir,
        }),
    );
    finish_branch_task_command(
        Some(("创建工作副本", "checkout")),
        Some(replay),
        result,
        json_mode,
        command_name,
        "branch_task_failed",
    )
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
    let request = BranchSwitchRequest {
        project,
        target_branch,
        repo_path: None,
    };
    let result = execute_branch_switch(config, &request);
    let replay = cli_branch_replay_request(
        "execute_branch_switch_task",
        "正在重新切换分支",
        json!({
            "project": request.project,
            "targetBranch": request.target_branch,
            "repoPath": request.repo_path,
        }),
    );
    finish_branch_task_command(
        Some(("切换分支", "switch")),
        Some(replay),
        result,
        json_mode,
        command_name,
        "branch_task_failed",
    )
}

fn run_push_status(config: &AppConfig, project: String, json_mode: bool) -> Result<()> {
    run_push_status_command(config, project, None, json_mode, "push-status")
}

fn run_push_status_command(
    config: &AppConfig,
    project: String,
    repo_path: Option<String>,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    let status = branch_push_status(config, &project, repo_path.as_deref())?;
    if json_mode {
        return print_json_command(command_name, &status);
    }
    print_push_status(&status);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn run_branch_file_diff_command(
    config: &AppConfig,
    project: String,
    path: String,
    repo_path: Option<String>,
    mode: Option<String>,
    max_bytes: Option<usize>,
    max_lines: Option<usize>,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    let response = branch_file_diff(
        config,
        &BranchFileDiffRequest {
            project,
            repo_path,
            path,
            mode,
            max_bytes,
            max_lines,
        },
    )?;
    if json_mode {
        return print_json_command(command_name, &response);
    }
    print_branch_file_diff(&response);
    Ok(())
}

fn run_push_branch(
    config: &AppConfig,
    project: String,
    message: Option<String>,
    json_mode: bool,
) -> Result<()> {
    run_push_branch_command(
        config,
        project,
        message,
        None,
        Vec::new(),
        json_mode,
        "push-branch",
    )
}

fn run_push_branch_command(
    config: &AppConfig,
    project: String,
    message: Option<String>,
    repo_path: Option<String>,
    selected_paths: Vec<String>,
    json_mode: bool,
    command_name: &str,
) -> Result<()> {
    let commit_before_push = message
        .as_deref()
        .map(str::trim)
        .is_some_and(|value| !value.is_empty());
    let request = BranchPushRequest {
        project,
        repo_path,
        commit_before_push,
        commit_message: message,
        selected_paths,
    };
    let result = execute_branch_push(config, &request);
    let mut replay = cli_branch_replay_request(
        "execute_branch_push_task",
        if request.commit_before_push {
            "正在重新提交并推送"
        } else {
            "正在重新推送分支"
        },
        json!({
            "project": request.project,
            "repoPath": request.repo_path,
            "commitBeforePush": request.commit_before_push,
            "commitMessage": request.commit_message,
            "selectedPaths": request.selected_paths,
        }),
    );
    if let Some(replay) = replay.as_object_mut() {
        replay.insert(
            "refreshPushStatusProject".to_string(),
            json!(request.project),
        );
        replay.insert(
            "clearPushCommitMessageOnSuccess".to_string(),
            json!(request.commit_before_push),
        );
    }
    finish_branch_task_command(
        Some(("提交推送", "push")),
        Some(replay),
        result,
        json_mode,
        command_name,
        "branch_task_failed",
    )
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
            tool,
            tool_key,
            tool_action,
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
                tool,
                tool_key,
                tool_action,
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
            tool,
            tool_key,
            tool_action,
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
                tool,
                tool_key,
                tool_action,
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

fn run_link(command: LinkCommands, config_override: Option<&Path>, json_mode: bool) -> Result<()> {
    match command {
        LinkCommands::Path => {
            let path = links_file_path();
            if json_mode {
                print_json_command("link.path", &json!({ "path": path }))
            } else {
                println!("{path}");
                Ok(())
            }
        }
        LinkCommands::List => {
            let (config, workspaces, proxy_config) = load_link_cli_context(config_override)?;
            let summaries = list_link_summaries(&config, &workspaces, &proxy_config)?;
            if json_mode {
                print_json_command("link.list", &summaries)
            } else {
                print_link_summaries(&summaries);
                Ok(())
            }
        }
        LinkCommands::Show { key } => {
            let (config, workspaces, proxy_config) = load_link_cli_context(config_override)?;
            let link = get_link(&key)?;
            let plan = core_plan_link(&key, &config, &workspaces, &proxy_config)?;
            if json_mode {
                print_json_command("link.show", &json!({ "link": link, "plan": plan }))
            } else {
                println!("{} {}", link.key, link.name);
                if let Some(workspace_key) = link.workspace_key.as_deref() {
                    println!("workspace: {workspace_key}");
                }
                if let Some(project) = link.project.as_deref() {
                    println!("project  : {project}");
                }
                print_link_plan(&plan);
                Ok(())
            }
        }
        LinkCommands::Plan { key } => {
            let (config, workspaces, proxy_config) = load_link_cli_context(config_override)?;
            let plan = core_plan_link(&key, &config, &workspaces, &proxy_config)?;
            if json_mode {
                print_json_command("link.plan", &plan)
            } else {
                print_link_plan(&plan);
                Ok(())
            }
        }
        LinkCommands::Check { key } => {
            let report = execute_link_cli(&key, "check", config_override)?;
            if json_mode {
                print_json_command("link.check", &report)
            } else {
                print_link_execution_report(&report);
                Ok(())
            }
        }
        LinkCommands::Run { key } => {
            let result = execute_link_cli(&key, "run", config_override);
            record_cli_link_operation("run", &key, &result);
            let report = result?;
            if json_mode {
                print_json_command("link.run", &report)
            } else {
                print_link_execution_report(&report);
                Ok(())
            }
        }
        LinkCommands::Stop { key } => {
            let result = execute_link_cli(&key, "stop", config_override);
            record_cli_link_operation("stop", &key, &result);
            let report = result?;
            if json_mode {
                print_json_command("link.stop", &report)
            } else {
                print_link_execution_report(&report);
                Ok(())
            }
        }
        LinkCommands::Save {
            key,
            name,
            workspace,
            project,
            steps,
        } => {
            let link = LinkConfig {
                key,
                name,
                kind: None,
                ui_profile: None,
                schema_version: None,
                workspace_key: workspace,
                project,
                steps: steps
                    .iter()
                    .enumerate()
                    .map(|(index, value)| parse_link_step_cli_arg(value, index))
                    .collect::<Result<Vec<_>>>()?,
            };
            let link = upsert_link(link)?;
            let (config, workspaces, proxy_config) = load_link_cli_context(config_override)?;
            let plan = core_plan_link(&link.key, &config, &workspaces, &proxy_config)?;
            if json_mode {
                print_json_command("link.save", &json!({ "link": link, "plan": plan }))
            } else {
                println!("saved link: {} {}", link.key, link.name);
                print_link_plan(&plan);
                Ok(())
            }
        }
        LinkCommands::Delete { key } => {
            let deleted = core_delete_link(&key)?;
            if json_mode {
                print_json_command("link.delete", &json!({ "key": key, "deleted": deleted }))
            } else {
                println!(
                    "{} link: {}",
                    if deleted { "deleted" } else { "missing" },
                    key
                );
                Ok(())
            }
        }
        LinkCommands::Attach {
            key,
            workspace,
            category,
            short_label,
            name,
            note,
        } => {
            let paths = ensure_default_configs()?;
            let workspace_key = match workspace {
                Some(value) => value,
                None => load_active_project_workspace(&paths)?.key,
            };
            let result = attach_link_to_workspace(
                &paths.project_workspaces,
                LinkWorkspaceAttachRequest {
                    workspace_key,
                    link_key: key.clone(),
                    category: Some(category),
                    short_label,
                    name,
                    note,
                },
            )?;
            let (config, workspaces, proxy_config) = load_link_cli_context(config_override)?;
            let plan = core_plan_link(&key, &config, &workspaces, &proxy_config)?;
            if json_mode {
                print_json_command("link.attach", &json!({ "result": result, "plan": plan }))
            } else {
                println!(
                    "{} workspace tool entry: {}/{} -> {}",
                    if result.created { "created" } else { "updated" },
                    result.category,
                    result.entry_name,
                    result.link_key
                );
                print_link_plan(&plan);
                Ok(())
            }
        }
    }
}

fn parse_link_step_cli_arg(value: &str, index: usize) -> Result<LinkStepConfig> {
    let value = value.trim();
    if value.is_empty() {
        anyhow::bail!("link step cannot be empty");
    }

    let mut step = LinkStepConfig {
        id: format!("step-{}", index + 1),
        ..LinkStepConfig::default()
    };
    let rest = if value.contains(':') && !value.split(':').next().unwrap_or("").contains('=') {
        let mut parts = value.splitn(3, ':');
        if let Some(id) = parts.next().map(str::trim).filter(|item| !item.is_empty()) {
            step.id = id.to_string();
        }
        if let Some(step_type) = parts.next().map(str::trim).filter(|item| !item.is_empty()) {
            step.step_type = step_type.to_string();
        }
        parts.next().unwrap_or("")
    } else {
        value
    };

    for pair in rest.split(',') {
        let pair = pair.trim();
        if pair.is_empty() {
            continue;
        }
        let Some((key, value)) = pair.split_once('=') else {
            anyhow::bail!("invalid link step segment: {pair}");
        };
        let key = key.trim();
        let value = value.trim();
        match key {
            "id" => step.id = value.to_string(),
            "type" | "stepType" | "step_type" => step.step_type = value.to_string(),
            "label" => step.label = Some(value.to_string()),
            "project" => step.project = Some(value.to_string()),
            "path" => step.path = Some(value.to_string()),
            "profile" => step.profile = Some(value.to_string()),
            "debugProfile" | "debug_profile" | "debug-profile" => {
                step.debug_profile = Some(value.to_string())
            }
            "runtimeProfile" | "runtime_profile" | "runtime-profile" => {
                step.runtime_profile = Some(value.to_string())
            }
            "command" => step.command = Some(value.to_string()),
            "expectedPort" | "expected_port" | "expected-port" => {
                step.expected_port =
                    Some(value.parse().map_err(|_| {
                        anyhow::anyhow!("invalid expected port in link step: {value}")
                    })?)
            }
            key if key.starts_with("env.") => {
                step.env.insert(
                    key.trim_start_matches("env.").to_string(),
                    value.to_string(),
                );
            }
            "note" => step.note = Some(value.to_string()),
            other => {
                step.extra
                    .insert(other.to_string(), toml::Value::String(value.to_string()));
            }
        }
    }

    if step.step_type.trim().is_empty() {
        anyhow::bail!("link step requires type: {}", value);
    }
    Ok(step)
}

fn load_link_cli_context(
    config_override: Option<&Path>,
) -> Result<(AppConfig, Vec<ProjectWorkspaceConfig>, ProxyConfig)> {
    let (config, _) = load_cli_effective_config(config_override)?;
    let paths = ensure_default_configs()?;
    let workspaces = load_project_workspaces(&paths.project_workspaces)?;
    let proxy_config = load_proxy_config(&default_proxy_path())?;
    Ok((config, workspaces, proxy_config))
}

fn execute_link_cli(
    key: &str,
    mode: &str,
    config_override: Option<&Path>,
) -> Result<LinkExecutionReport> {
    let (config, workspaces, proxy_config) = load_link_cli_context(config_override)?;
    let link = get_link(key)?;
    let plan = core_plan_link(&link.key, &config, &workspaces, &proxy_config)?;
    let mut warnings = plan.warnings.clone();
    let mut indices = (0..link.steps.len()).collect::<Vec<_>>();
    if mode == "stop" {
        indices.reverse();
    }

    let mut steps = Vec::new();
    for index in indices {
        let step = &link.steps[index];
        let report = execute_link_step_cli(
            mode,
            &config,
            &proxy_config,
            &link,
            step,
            plan.steps.get(index),
            index,
        );
        for risk in &report.risks {
            if report.status == "skipped" || report.status == "failed" {
                push_unique_warning(&mut warnings, risk.clone());
            }
        }
        steps.push(report);
    }

    Ok(LinkExecutionReport {
        key: plan.key.clone(),
        name: plan.name.clone(),
        mode: mode.to_string(),
        plan,
        steps,
        warnings,
    })
}

fn execute_link_step_cli(
    mode: &str,
    config: &AppConfig,
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
        "check" => check_link_step_cli(
            config,
            proxy_config,
            link,
            step,
            id,
            step_type,
            label,
            planned_summary,
            planned_runtime.as_ref(),
        ),
        "run" => run_link_step_cli(
            config,
            proxy_config,
            link,
            step,
            id,
            step_type,
            label,
            planned_summary,
        ),
        "stop" => stop_link_step_cli(
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

fn check_link_step_cli(
    config: &AppConfig,
    proxy_config: &ProxyConfig,
    link: &LinkConfig,
    step: &LinkStepConfig,
    id: String,
    step_type: String,
    label: String,
    planned_summary: String,
    planned_runtime: Option<&rdevtool_core::runtime::ProjectRuntimeContextSnapshot>,
) -> LinkExecutionStepReport {
    match step_type.as_str() {
        "localFile.ensure" => {
            let project_key = link_step_project(link, step);
            let path = optional_trimmed(step.path.as_deref());
            let mut risks = Vec::new();
            let detail = match (project_key.as_deref(), path.as_deref()) {
                (Some(project_key), Some(path)) => match config.find_project(project_key) {
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
            .and_then(|profile_key| find_proxy_profile_cli(proxy_config, &profile_key))
        {
            Some(profile) => {
                let runtime_status = proxy_daemon_status(&default_proxy_path(), &profile.id).ok();
                let listening = runtime_status.as_ref().is_some_and(|status| status.running);
                let managed = runtime_status.as_ref().is_some_and(|status| status.managed);
                let status = link_proxy_check_status(&step_type, listening, managed);
                let risks = if status == "blocked" {
                    if listening {
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
                        _ if listening => {
                            format!("代理端口已被外部进程占用 {}", profile.listen_url())
                        }
                        _ => format!("代理尚未启动，期望监听 {}", profile.listen_url()),
                    },
                    detail: Some(json!({
                        "profileId": profile.id,
                        "profileName": profile.name,
                        "listenUrl": profile.listen_url(),
                        "listening": listening,
                        "managed": managed,
                        "runtimeStatus": runtime_status
                    })),
                    risks,
                }
            }
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
            match project_runtime_preflight_with_options(config, &project_key, &options) {
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
                .map(|url| format!("已解析打开页面 {url}；CLI 检查模式不执行打开动作。"))
                .unwrap_or_else(|| "打开页面步骤已识别，CLI 检查模式不执行打开动作。".to_string()),
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
            risks: vec!["该步骤类型尚未接入 CLI 检查器。".to_string()],
        },
    }
}

fn run_link_step_cli(
    config: &AppConfig,
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
            summary: "本地覆盖文件不会由 Link CLI 直接写入；启动 runtime 时由调试配置应用。"
                .to_string(),
            detail: Some(json!({
                "project": link_step_project(link, step),
                "path": optional_trimmed(step.path.as_deref())
            })),
            risks: Vec::new(),
        },
        "proxy.start" => {
            let Some(profile) = link_step_proxy_profile(step)
                .and_then(|profile_key| find_proxy_profile_cli(proxy_config, &profile_key))
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
            match proxy_daemon_start(&default_proxy_path(), &profile.id) {
                Ok(status) => LinkExecutionStepReport {
                    id,
                    step_type,
                    label,
                    status: "started".to_string(),
                    summary: format!("代理已由共享守护进程启动：{}", status.listen_url),
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
            match start_project_runtime_detached_with_options(config, &project_key, &options) {
                Ok(response) => LinkExecutionStepReport {
                    id,
                    step_type,
                    label,
                    status: "started".to_string(),
                    summary: format!("{}：{}", response.status_label, response.detail),
                    detail: Some(json!(response)),
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
        "runtime.focus" => LinkExecutionStepReport {
            id,
            step_type,
            label,
            status: "skipped".to_string(),
            summary: "CLI Link run 暂不打开浏览器页面；可使用 runtime focus 或 App 查看。"
                .to_string(),
            detail: None,
            risks: vec!["打开页面动作未在 Link CLI 中执行。".to_string()],
        },
        _ => LinkExecutionStepReport {
            id,
            step_type,
            label,
            status: "skipped".to_string(),
            summary: planned_summary,
            detail: None,
            risks: vec!["该步骤类型尚未接入 CLI 执行器。".to_string()],
        },
    }
}

fn stop_link_step_cli(
    proxy_config: &ProxyConfig,
    link: &LinkConfig,
    step: &LinkStepConfig,
    id: String,
    step_type: String,
    label: String,
    planned_summary: String,
) -> LinkExecutionStepReport {
    match step_type.as_str() {
        "proxy.start" => {
            let Some(profile) = link_step_proxy_profile(step)
                .and_then(|profile_key| find_proxy_profile_cli(proxy_config, &profile_key))
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
            match proxy_daemon_stop(&default_proxy_path(), &profile.id) {
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
        "runtime.start" => LinkExecutionStepReport {
            id,
            step_type,
            label,
            status: "skipped".to_string(),
            summary: "CLI detached runtime 暂无 Link stop 所有权语义，未执行停止。".to_string(),
            detail: Some(json!({
                "project": link_step_project(link, step),
                "debugProfile": optional_trimmed(step.debug_profile.as_deref())
            })),
            risks: vec![
                "请在 App 中停止 Link，或用运行日志定位后手动停止明确归属的进程。".to_string(),
            ],
        },
        "localFile.ensure" => LinkExecutionStepReport {
            id,
            step_type,
            label,
            status: "skipped".to_string(),
            summary: "本地覆盖文件不会在 Link stop 中自动删除。".to_string(),
            detail: Some(json!({
                "project": link_step_project(link, step),
                "path": optional_trimmed(step.path.as_deref())
            })),
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
    optional_trimmed(step.project.as_deref()).or_else(|| optional_trimmed(link.project.as_deref()))
}

fn link_step_proxy_profile(step: &LinkStepConfig) -> Option<String> {
    optional_trimmed(step.profile.as_deref())
}

fn link_step_runtime_launch_options(step: &LinkStepConfig) -> ProjectRuntimeLaunchOptions {
    ProjectRuntimeLaunchOptions {
        debug_profile: optional_trimmed(step.debug_profile.as_deref()),
        runtime_profile: optional_trimmed(step.runtime_profile.as_deref()),
        command: optional_trimmed(step.command.as_deref()),
        expected_port: step.expected_port,
        env: step.env.clone(),
    }
}

fn optional_trimmed(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn find_proxy_profile_cli<'a>(config: &'a ProxyConfig, key: &str) -> Option<&'a ProxyProfile> {
    config
        .profiles
        .iter()
        .find(|profile| profile.id == key || profile.name == key)
}

fn push_unique_warning(warnings: &mut Vec<String>, warning: String) {
    if !warnings.iter().any(|item| item == &warning) {
        warnings.push(warning);
    }
}

fn print_link_summaries(summaries: &[rdevtool_core::link::LinkSummary]) {
    if summaries.is_empty() {
        println!("no links configured");
        return;
    }
    for link in summaries {
        let proxy = if link.proxy_profiles.is_empty() {
            String::new()
        } else {
            format!(
                " · proxy {}",
                link.proxy_profiles
                    .iter()
                    .map(|profile| format!("{}({})", profile.name, profile.listen_url))
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        };
        let warning = if link.warnings.is_empty() {
            String::new()
        } else {
            format!(" · {} warning(s)", link.warnings.len())
        };
        println!(
            "{} {} · {} step(s){}{}",
            link.key, link.name, link.step_count, proxy, warning
        );
    }
}

fn print_link_plan(plan: &rdevtool_core::link::LinkPlan) {
    println!("{} {}", plan.key, plan.name);
    if let Some(workspace_key) = plan.workspace_key.as_deref() {
        println!("workspace: {workspace_key}");
    }
    if let Some(project) = plan.project.as_deref() {
        println!("project  : {project}");
    }
    if !plan.warnings.is_empty() {
        println!("warnings :");
        for warning in &plan.warnings {
            println!("  - {warning}");
        }
    }
    if plan.steps.is_empty() {
        println!("steps    : none");
        return;
    }
    println!("steps    :");
    for step in &plan.steps {
        println!(
            "  - {} [{}] {} - {}",
            step.id, step.status, step.label, step.summary
        );
        for risk in &step.risks {
            println!("    risk: {risk}");
        }
    }
}

fn print_link_execution_report(report: &LinkExecutionReport) {
    println!("{} {} · {}", report.key, report.name, report.mode);
    if !report.warnings.is_empty() {
        println!("warnings :");
        for warning in &report.warnings {
            println!("  - {warning}");
        }
    }
    if report.steps.is_empty() {
        println!("steps    : none");
        return;
    }
    println!("steps    :");
    for step in &report.steps {
        println!(
            "  - {} [{}] {} - {}",
            step.id, step.status, step.label, step.summary
        );
        for risk in &step.risks {
            println!("    risk: {risk}");
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
    tool: Option<String>,
    tool_key: Option<String>,
    tool_action: Option<String>,
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
        tool: entry.tool,
        tool_key: entry.tool_key,
        tool_action: entry.tool_action,
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
        tool: entry.tool.clone(),
        tool_key: entry.tool_key.clone(),
        tool_action: entry.tool_action.clone(),
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
        tool: None,
        tool_key: None,
        tool_action: None,
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
    apply_optional_cli_text(&mut entry.tool, input.tool);
    apply_optional_cli_text(&mut entry.tool_key, input.tool_key);
    apply_optional_cli_text(&mut entry.tool_action, input.tool_action);
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

fn run_config_source(command: ConfigSourceCommands, json_mode: bool) -> Result<()> {
    let paths = ensure_default_configs()?;
    let app_workspace = load_workspace_config(&paths.workspace)?;
    let workspace_key = active_project_workspace_key(&app_workspace);
    let workspace = load_project_workspace_by_key(&paths.project_workspaces, &workspace_key)?;
    let workspaces = load_project_workspaces(&paths.project_workspaces)?;
    match command {
        ConfigSourceCommands::List => {
            let sources = list_config_sources(&workspaces)?;
            let preferences = ["resource", "link", "proxy", "runtime"]
                .into_iter()
                .map(|capability| {
                    (
                        capability,
                        preferred_config_source_id_for_scope(
                            &workspace,
                            &app_workspace,
                            capability,
                        ),
                    )
                })
                .collect::<BTreeMap<_, _>>();
            if json_mode {
                print_json_command(
                    "config-source.list",
                    &json!({
                        "workspaceKey": workspace_key,
                        "preferences": preferences,
                        "sources": sources,
                    }),
                )
            } else {
                println!("workspace   : {workspace_key}");
                for (capability, source_id) in preferences {
                    println!("{capability:<12}: {source_id}");
                }
                println!("sources:");
                for source in sources {
                    println!("  {:<28} {:<18} {}", source.id, source.kind, source.name);
                }
                Ok(())
            }
        }
        ConfigSourceCommands::Show { source } => {
            let source = resolve_config_source(Some(&source), &workspaces)?;
            if json_mode {
                print_json_command("config-source.show", &source)
            } else {
                println!("source      : {} ({})", source.name, source.id);
                println!("kind        : {}", source.kind);
                println!("base dir    : {}", source.base_dir);
                println!("capabilities: {}", source.capabilities.join(", "));
                println!("navigation  : {}", source.files.navigation);
                println!("links       : {}", source.files.links);
                if let Some(path) = &source.files.proxy {
                    println!("proxy       : {path}");
                }
                if let Some(path) = &source.files.runtime_overrides {
                    println!("runtime     : {path}");
                }
                Ok(())
            }
        }
        ConfigSourceCommands::Compare { left, right } => {
            let comparison = compare_config_sources(&workspaces, &left, &right)?;
            if json_mode {
                print_json_command("config-source.compare", &comparison)
            } else {
                println!(
                    "left        : {} ({})",
                    comparison.left.name, comparison.left.id
                );
                println!(
                    "right       : {} ({})",
                    comparison.right.name, comparison.right.id
                );
                println!("identical   : {}", comparison.identical);
                for file in comparison.files {
                    println!("{:<16}: {:<20} {}", file.key, file.status, file.summary);
                }
                Ok(())
            }
        }
        ConfigSourceCommands::Copy {
            source,
            id,
            name,
            base_dir,
        } => {
            let source_id = source.clone();
            let target_id = id.clone();
            let result = match copy_config_source(
                &workspaces,
                CopyConfigSourceRequest {
                    source_id: source,
                    id,
                    name,
                    base_dir: base_dir.map(|path| path.display().to_string()),
                },
            ) {
                Ok(result) => {
                    record_cli_workspace_operation(WorkspaceOperationWorklogEvent {
                        event_id: None,
                        kind: "配置".to_string(),
                        summary: format!("复制配置源 {source_id} → {target_id}"),
                        detail: Some(format!(
                            "- 已复制文件: {}\n- 缺失文件: {}",
                            result.copied_count, result.missing_count
                        )),
                        success: true,
                    });
                    result
                }
                Err(error) => {
                    record_cli_workspace_operation(WorkspaceOperationWorklogEvent {
                        event_id: None,
                        kind: "配置".to_string(),
                        summary: format!("复制配置源 {source_id} → {target_id} 失败"),
                        detail: Some(error.to_string()),
                        success: false,
                    });
                    return Err(error);
                }
            };
            if json_mode {
                print_json_command("config-source.copy", &result)
            } else {
                println!(
                    "source      : {} ({})",
                    result.source.name, result.source.id
                );
                println!(
                    "target      : {} ({})",
                    result.target.name, result.target.id
                );
                println!("base dir    : {}", result.target.base_dir);
                println!("copied      : {}", result.copied_count);
                println!("missing     : {}", result.missing_count);
                Ok(())
            }
        }
        ConfigSourceCommands::Use { source, capability } => {
            let capability = capability.trim().to_ascii_lowercase();
            if !matches!(
                capability.as_str(),
                "resource" | "link" | "proxy" | "runtime"
            ) {
                anyhow::bail!("unsupported config source capability: {capability}");
            }
            let source =
                match save_config_source_preference(&paths, &workspace_key, &capability, &source) {
                    Ok(source) => {
                        record_cli_workspace_operation(WorkspaceOperationWorklogEvent {
                            event_id: None,
                            kind: "配置".to_string(),
                            summary: format!("切换 {capability} 配置源"),
                            detail: Some(format!("- 配置源: `{}`", source.id)),
                            success: true,
                        });
                        source
                    }
                    Err(error) => {
                        record_cli_workspace_operation(WorkspaceOperationWorklogEvent {
                            event_id: None,
                            kind: "配置".to_string(),
                            summary: format!("切换 {capability} 配置源失败"),
                            detail: Some(error.to_string()),
                            success: false,
                        });
                        return Err(error);
                    }
                };
            if json_mode {
                print_json_command(
                    "config-source.use",
                    &json!({
                        "workspaceKey": workspace_key,
                        "capability": capability,
                        "source": source,
                    }),
                )
            } else {
                println!("workspace   : {workspace_key}");
                println!("capability  : {capability}");
                println!("source      : {} ({})", source.name, source.id);
                Ok(())
            }
        }
    }
}

fn run_proxy_lifecycle_action(
    info: ProxyCliInfo,
    requested_profile: &str,
    action: &str,
    json_command: &str,
    json_mode: bool,
) -> Result<()> {
    let event_source_id = info.source_id.clone();
    let action_label = match action {
        "start" => "启动代理服务",
        "stop" => "停止代理服务",
        "restart" => "重启代理服务",
        _ => "操作代理服务",
    };
    let result = (|| {
        let selected = info
            .profiles
            .iter()
            .find(|item| item.id == requested_profile || item.name == requested_profile)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("proxy profile not found: {requested_profile}"))?;
        match action {
            "start" => {
                proxy_daemon_start(Path::new(&info.path), &selected.id)?;
            }
            "stop" => {
                proxy_daemon_stop(Path::new(&info.path), &selected.id)?;
            }
            "restart" => {
                proxy_daemon_restart(Path::new(&info.path), &selected.id)?;
            }
            _ => anyhow::bail!("unsupported proxy lifecycle action: {action}"),
        }
        let response = proxy_status_response(&info, Some(&selected.id))?;
        Ok::<_, anyhow::Error>((selected, response))
    })();

    let (selected, response) = match result {
        Ok(result) => result,
        Err(error) => {
            record_cli_lifecycle_operation(
                "proxy",
                action,
                OperationEventState::Failed,
                action_label,
                &format!("{action_label}失败"),
                &error.to_string(),
                None,
                None,
                Some(json!({
                    "profileId": requested_profile,
                    "sourceId": event_source_id.clone(),
                })),
            );
            return Err(error);
        }
    };
    let status = response.profiles.first();
    let expected_running = action != "stop";
    let state_matches = status.is_some_and(|status| status.listening == expected_running);
    let state = if state_matches {
        OperationEventState::Success
    } else {
        OperationEventState::Failed
    };
    let completed_label = match action {
        "start" => "已启动",
        "stop" => "已停止",
        "restart" => "已重启",
        _ => "已完成",
    };
    let title = match action {
        "start" => "代理服务已启动",
        "stop" => "代理服务已停止",
        "restart" => "代理服务已重启",
        _ => action_label,
    };
    let detail = status
        .map(|status| status.detail.as_str())
        .unwrap_or("代理状态已更新");
    let mut event_payload = serde_json::to_value(&response).unwrap_or_else(|_| json!({}));
    if let Some(payload) = event_payload.as_object_mut() {
        payload.insert("profileId".to_string(), json!(selected.id.clone()));
        payload.insert("profileName".to_string(), json!(selected.name.clone()));
        payload.insert("sourceId".to_string(), json!(event_source_id));
    }
    record_cli_lifecycle_operation(
        "proxy",
        action,
        state,
        title,
        &format!("{} · {completed_label}", selected.name),
        detail,
        None,
        None,
        Some(event_payload),
    );

    if json_mode {
        print_json_command(json_command, &response)
    } else {
        print_proxy_status(&response);
        Ok(())
    }
}

fn run_proxy(
    command: ProxyCommands,
    config_override: Option<&Path>,
    source_id: Option<&str>,
    json_mode: bool,
) -> Result<()> {
    let initial_info = load_proxy_cli_info(config_override, source_id)?;
    let proxy_path = PathBuf::from(&initial_info.path);
    match command {
        ProxyCommands::Path => {
            if json_mode {
                print_json_command(
                    "proxy.path",
                    &json!({
                        "sourceId": initial_info.source_id,
                        "sourceName": initial_info.source_name,
                        "path": initial_info.path,
                    }),
                )
            } else {
                println!("{}", initial_info.path);
                Ok(())
            }
        }
        ProxyCommands::Source { source_id } => {
            if let Some(source_id) = source_id {
                save_proxy_source_preference_for_active_workspace(&source_id)?;
            }
            let info = load_proxy_cli_info(config_override, None)?;
            if json_mode {
                print_json_command(
                    "proxy.source",
                    &json!({
                        "sourceId": info.source_id,
                        "sourceName": info.source_name,
                        "path": info.path,
                        "workspace": info.workspace,
                    }),
                )
            } else {
                println!("source    : {} ({})", info.source_name, info.source_id);
                println!("path      : {}", info.path);
                Ok(())
            }
        }
        ProxyCommands::List => {
            let info = initial_info;
            if json_mode {
                print_json_command("proxy.list", &info)
            } else {
                print_proxy_profiles(&info);
                Ok(())
            }
        }
        ProxyCommands::Start { profile } => {
            run_proxy_lifecycle_action(initial_info, &profile, "start", "proxy.start", json_mode)
        }
        ProxyCommands::Stop { profile } => {
            run_proxy_lifecycle_action(initial_info, &profile, "stop", "proxy.stop", json_mode)
        }
        ProxyCommands::Restart { profile } => run_proxy_lifecycle_action(
            initial_info,
            &profile,
            "restart",
            "proxy.restart",
            json_mode,
        ),
        ProxyCommands::Status { profile } => {
            let info = initial_info;
            let response = proxy_status_response(&info, profile.as_deref())?;
            if json_mode {
                print_json_command("proxy.status", &response)
            } else {
                print_proxy_status(&response);
                Ok(())
            }
        }
        ProxyCommands::Show { profile } => {
            let mut info = initial_info;
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
            upsert_proxy_profile(&proxy_path, profile)?;
            let info = load_proxy_cli_info(config_override, source_id)?;
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
            let mut profile = find_proxy_profile(&load_proxy_config(&proxy_path)?, &profile)?;
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
            upsert_proxy_profile(&proxy_path, profile)?;
            let info = load_proxy_cli_info(config_override, source_id)?;
            if json_mode {
                print_json_command("proxy.update", &info)
            } else {
                print_proxy_profiles(&info);
                Ok(())
            }
        }
        ProxyCommands::Delete { profile } => {
            let profile = find_proxy_profile(&load_proxy_config(&proxy_path)?, &profile)?;
            core_delete_proxy_profile(&proxy_path, &profile.id)?;
            let info = load_proxy_cli_info(config_override, source_id)?;
            if json_mode {
                print_json_command("proxy.delete", &info)
            } else {
                print_proxy_profiles(&info);
                Ok(())
            }
        }
        ProxyCommands::Export { profile, output } => {
            let profile = find_proxy_profile(&load_proxy_config(&proxy_path)?, &profile)?;
            let pack = export_proxy_profile_pack(&proxy_path, &profile.id)?;
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
            let before = load_proxy_config(&proxy_path)?
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
            let mut proxy_config = import_proxy_profile_pack(&proxy_path, pack)?;
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
                save_proxy_config(&proxy_path, &proxy_config)?;
            }
            let info = load_proxy_cli_info(config_override, source_id)?;
            if json_mode {
                print_json_command("proxy.import", &info)
            } else {
                print_proxy_profiles(&info);
                Ok(())
            }
        }
        ProxyCommands::RuleList { profile } => {
            let mut info = initial_info;
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
            let mut info = initial_info;
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
            let config = load_proxy_config(&proxy_path)?;
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
            upsert_proxy_rule(&proxy_path, rule)?;
            let info = load_proxy_cli_info(config_override, source_id)?;
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
            let config = load_proxy_config(&proxy_path)?;
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
            upsert_proxy_rule(&proxy_path, rule)?;
            let info = load_proxy_cli_info(config_override, source_id)?;
            if json_mode {
                print_json_command("proxy.rule-update", &info)
            } else {
                print_proxy_profiles(&info);
                print_proxy_rules(&info.rules);
                Ok(())
            }
        }
        ProxyCommands::RuleDelete { rule } => {
            let rule = find_proxy_rule(&load_proxy_config(&proxy_path)?, &rule)?;
            core_delete_proxy_rule(&proxy_path, &rule.id)?;
            let info = load_proxy_cli_info(config_override, source_id)?;
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
            let info = initial_info;
            let requested_profile = profile.clone();
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
            let daemon_status = proxy_daemon_status(Path::new(&info.path), &selected_profile.id)?;
            let operation = proxy_diagnose_operation(
                &info,
                requested_profile,
                &method,
                &url,
                header_map.len(),
                &diagnosis,
                &daemon_status,
            );
            let response = ProxyDiagnoseResponse {
                diagnosis,
                operation,
            };
            if json_mode {
                print_json_command("proxy.diagnose", &response)
            } else {
                print_proxy_diagnosis(&response.diagnosis);
                print_proxy_operation_lifecycle(&response.operation);
                Ok(())
            }
        }
        ProxyCommands::Verify {
            profile,
            method,
            url,
            headers,
            body,
            expected_status,
            expected_body_text,
            timeout_ms,
        } => {
            let info = initial_info;
            let response = verify_proxy_request(
                &info,
                &profile,
                &method,
                &url,
                &parse_key_value_map(&headers)?,
                body.as_deref(),
                expected_status,
                expected_body_text.as_deref(),
                timeout_ms,
            )?;
            if json_mode {
                print_json_command("proxy.verify", &response)
            } else {
                print_proxy_verify(&response);
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeRestartResponse {
    stopped: RuntimeDaemonStatus,
    started: ProjectRuntimeStartResponse,
}

fn resolve_runtime_lookup_cwd(config: &AppConfig, project_key: &str) -> Result<PathBuf> {
    let project = config.find_project(project_key)?;
    resolve_project_runtime_lookup_cwd(project)
}

fn selected_runtime_daemon_status(
    config: &AppConfig,
    project_key: &str,
    run_id: Option<&str>,
    require_unambiguous_running: bool,
) -> Result<RuntimeDaemonStatus> {
    let project = config.find_project(project_key)?;
    if let Some(run_id) = run_id {
        return find_runtime_daemon(project_key, Some(run_id))?.ok_or_else(|| {
            anyhow::anyhow!("runtime session not found for project {project_key}: {run_id}")
        });
    }
    let candidate_cwds = project_runtime_candidate_cwds(project).map_err(anyhow::Error::msg)?;
    let candidate_statuses = list_runtime_daemons()?
        .into_iter()
        .filter(|status| {
            status.project_key == project_key
                && candidate_cwds
                    .iter()
                    .any(|cwd| Path::new(&status.canonical_cwd) == cwd)
        })
        .collect::<Vec<_>>();
    if require_unambiguous_running && run_id.is_none() {
        let running = candidate_statuses
            .iter()
            .filter(|status| status.running)
            .cloned()
            .collect::<Vec<_>>();
        if running.len() > 1 {
            anyhow::bail!(
                "project {project_key} has multiple running sessions; select one with --run-id"
            );
        }
        if let Some(status) = running.into_iter().next() {
            return Ok(status);
        }
    }
    if let Some(status) = candidate_statuses.into_iter().next() {
        return Ok(status);
    }
    let cwd = resolve_runtime_lookup_cwd(config, project_key)?;
    Ok(runtime_daemon_status(project_key, &cwd)?)
}

fn resolve_project_runtime_lookup_cwd(project: &ProjectConfig) -> Result<PathBuf> {
    let cwd = match project
        .dev
        .as_ref()
        .and_then(|command| command.cwd.as_ref())
    {
        Some(cwd) if cwd.is_absolute() => cwd.clone(),
        Some(cwd) => {
            let repo_path = project.repo_path.as_ref().ok_or_else(|| {
                anyhow::anyhow!(
                    "project {} uses a relative dev.cwd but has no repo_path",
                    project.key
                )
            })?;
            repo_path.join(cwd)
        }
        None => project.repo_path.clone().ok_or_else(|| {
            anyhow::anyhow!(
                "project {} has no dev.cwd or repo_path for runtime lookup",
                project.key
            )
        })?,
    };
    let absolute = if cwd.is_absolute() {
        cwd
    } else {
        std::env::current_dir()?.join(cwd)
    };
    Ok(fs::canonicalize(&absolute).unwrap_or(absolute))
}

fn run_runtime(config: &AppConfig, command: RuntimeCommands, json_mode: bool) -> Result<()> {
    let json_command = command.json_command_name();
    match command {
        RuntimeCommands::Profiles => {
            let info = runtime_profiles(config);
            if json_mode {
                print_json_command(json_command, &info)
            } else {
                print_runtime_profiles(&info);
                Ok(())
            }
        }
        RuntimeCommands::ProfileShow { key } => {
            let profile =
                runtime_profile_show(config, &key).map_err(|error| anyhow::anyhow!(error))?;
            if json_mode {
                print_json_command(json_command, &profile)
            } else {
                print_runtime_profile(&profile);
                Ok(())
            }
        }
        RuntimeCommands::Inspect {
            project,
            debug_profile,
            runtime_profile,
            command,
            expected_port,
            env,
        } => {
            let proxy_config = load_proxy_config(&default_proxy_path())?;
            let options = ProjectRuntimeLaunchOptions {
                debug_profile,
                runtime_profile,
                command,
                expected_port,
                env: parse_key_value_map(&env)?,
            };
            let response =
                inspect_project_runtime_with_options(config, &proxy_config, &project, &options)
                    .map_err(|error| anyhow::anyhow!(error))?;
            if json_mode {
                print_json_command(json_command, &response)
            } else {
                print_runtime_inspect(&response);
                Ok(())
            }
        }
        RuntimeCommands::Preflight {
            project,
            debug_profile,
            runtime_profile,
            command,
            expected_port,
            env,
        } => {
            let options = ProjectRuntimeLaunchOptions {
                debug_profile,
                runtime_profile,
                command,
                expected_port,
                env: parse_key_value_map(&env)?,
            };
            let response = project_runtime_preflight_with_options(config, &project, &options)
                .map_err(|error| anyhow::anyhow!(error))?;
            if json_mode {
                print_json_command(json_command, &response)
            } else {
                print_runtime_preflight(&response);
                Ok(())
            }
        }
        RuntimeCommands::Start {
            project,
            debug_profile,
            runtime_profile,
            command,
            expected_port,
            env,
        } => {
            let configured_project_name = config
                .find_project(&project)
                .ok()
                .map(|project| project.name.clone());
            let options = ProjectRuntimeLaunchOptions {
                debug_profile,
                runtime_profile,
                command,
                expected_port,
                env: parse_key_value_map(&env)?,
            };
            let response =
                match start_project_runtime_detached_with_options(config, &project, &options) {
                    Ok(response) => {
                        record_cli_workspace_operation(WorkspaceOperationWorklogEvent {
                            event_id: Some(format!(
                                "runtime-start:{}:{}",
                                project, response.run_id
                            )),
                            kind: "运行".to_string(),
                            summary: format!(
                                "启动 {} · {}",
                                response.project_name, response.status_label
                            ),
                            detail: Some(format!(
                                "- 项目: `{}`\n- 命令: `{}`\n- 目录: `{}`\n\n{}",
                                response.project_key,
                                response.command,
                                response.cwd,
                                response.detail
                            )),
                            success: response.running,
                        });
                        record_cli_lifecycle_operation(
                            "runtime",
                            "start",
                            if response.running {
                                OperationEventState::Success
                            } else {
                                OperationEventState::Failed
                            },
                            if response.running {
                                "dev 服务已启动"
                            } else {
                                "dev 服务启动失败"
                            },
                            &format!("{} · {}", response.project_name, response.status_label),
                            &response.detail,
                            Some(&response.project_key),
                            Some(&response.project_name),
                            Some(runtime_operation_payload(
                                Some(&response),
                                &project,
                                &options,
                            )),
                        );
                        response
                    }
                    Err(error) => {
                        record_cli_workspace_operation(WorkspaceOperationWorklogEvent {
                            event_id: None,
                            kind: "运行".to_string(),
                            summary: format!("启动 {project} 失败"),
                            detail: Some(error.clone()),
                            success: false,
                        });
                        record_cli_lifecycle_operation(
                            "runtime",
                            "start",
                            OperationEventState::Failed,
                            "启动 dev 服务",
                            "dev 服务启动失败",
                            &error,
                            Some(&project),
                            configured_project_name.as_deref(),
                            Some(runtime_operation_payload::<serde_json::Value>(
                                None, &project, &options,
                            )),
                        );
                        return Err(anyhow::anyhow!(error));
                    }
                };
            if json_mode {
                print_json_command(json_command, &response)
            } else {
                print_runtime_start(&response);
                Ok(())
            }
        }
        RuntimeCommands::Status { project, run_id } => {
            let response =
                selected_runtime_daemon_status(config, &project, run_id.as_deref(), false)?;
            if json_mode {
                print_json_command(json_command, &response)
            } else {
                print_runtime_daemon_status(&response);
                Ok(())
            }
        }
        RuntimeCommands::List { running_only } => {
            let mut response = list_runtime_daemons()?;
            if running_only {
                response.retain(|status| status.running);
            }
            if json_mode {
                print_json_command(json_command, &response)
            } else {
                print_runtime_daemon_list(&response);
                Ok(())
            }
        }
        RuntimeCommands::Stop { project, run_id } => {
            let configured_project_name = config
                .find_project(&project)
                .ok()
                .map(|project| project.name.clone());
            let selected =
                selected_runtime_daemon_status(config, &project, run_id.as_deref(), true)?;
            let response = match stop_runtime_daemon(&project, Path::new(&selected.canonical_cwd)) {
                Ok(response) => {
                    record_cli_workspace_operation(WorkspaceOperationWorklogEvent {
                        event_id: None,
                        kind: "运行".to_string(),
                        summary: format!("停止 {project} · {}", response.status_key),
                        detail: Some(response.detail.clone()),
                        success: !response.running,
                    });
                    record_cli_lifecycle_operation(
                        "runtime",
                        "stop",
                        if response.running {
                            OperationEventState::Failed
                        } else {
                            OperationEventState::Success
                        },
                        if response.running {
                            "dev 服务停止失败"
                        } else {
                            "dev 服务已停止"
                        },
                        &format!(
                            "{} · {}",
                            configured_project_name.as_deref().unwrap_or(&project),
                            response.status_key
                        ),
                        &response.detail,
                        Some(&project),
                        configured_project_name.as_deref(),
                        serde_json::to_value(&response).ok(),
                    );
                    response
                }
                Err(error) => {
                    record_cli_workspace_operation(WorkspaceOperationWorklogEvent {
                        event_id: None,
                        kind: "运行".to_string(),
                        summary: format!("停止 {project} 失败"),
                        detail: Some(error.to_string()),
                        success: false,
                    });
                    record_cli_lifecycle_operation(
                        "runtime",
                        "stop",
                        OperationEventState::Failed,
                        "停止 dev 服务",
                        "dev 服务停止失败",
                        &error.to_string(),
                        Some(&project),
                        configured_project_name.as_deref(),
                        Some(json!({ "projectKey": project.clone() })),
                    );
                    return Err(error);
                }
            };
            if json_mode {
                print_json_command(json_command, &response)
            } else {
                print_runtime_daemon_status(&response);
                Ok(())
            }
        }
        RuntimeCommands::Restart {
            project,
            debug_profile,
            runtime_profile,
            command,
            expected_port,
            env,
        } => {
            let configured_project_name = config
                .find_project(&project)
                .ok()
                .map(|project| project.name.clone());
            let options = ProjectRuntimeLaunchOptions {
                debug_profile,
                runtime_profile,
                command,
                expected_port,
                env: parse_key_value_map(&env)?,
            };
            let selected = selected_runtime_daemon_status(config, &project, None, true)?;
            let stopped = match stop_runtime_daemon(&project, Path::new(&selected.canonical_cwd)) {
                Ok(stopped) => stopped,
                Err(error) => {
                    record_cli_workspace_operation(WorkspaceOperationWorklogEvent {
                        event_id: None,
                        kind: "运行".to_string(),
                        summary: format!("重启 {project} 失败"),
                        detail: Some(error.to_string()),
                        success: false,
                    });
                    record_cli_lifecycle_operation(
                        "runtime",
                        "restart",
                        OperationEventState::Failed,
                        "重启 dev 服务",
                        "dev 服务重启失败",
                        &error.to_string(),
                        Some(&project),
                        configured_project_name.as_deref(),
                        Some(json!({ "projectKey": project.clone() })),
                    );
                    return Err(error);
                }
            };
            let started =
                match start_project_runtime_detached_with_options(config, &project, &options) {
                    Ok(started) => started,
                    Err(error) => {
                        record_cli_workspace_operation(WorkspaceOperationWorklogEvent {
                            event_id: None,
                            kind: "运行".to_string(),
                            summary: format!("重启 {project} 失败"),
                            detail: Some(error.clone()),
                            success: false,
                        });
                        record_cli_lifecycle_operation(
                            "runtime",
                            "restart",
                            OperationEventState::Failed,
                            "重启 dev 服务",
                            "dev 服务重启失败",
                            &error,
                            Some(&project),
                            configured_project_name.as_deref(),
                            Some(json!({ "projectKey": project.clone() })),
                        );
                        return Err(anyhow::anyhow!(error));
                    }
                };
            record_cli_workspace_operation(WorkspaceOperationWorklogEvent {
                event_id: Some(format!("runtime-restart:{}:{}", project, started.run_id)),
                kind: "运行".to_string(),
                summary: format!("重启 {} · {}", started.project_name, started.status_label),
                detail: Some(started.detail.clone()),
                success: started.running,
            });
            let response = RuntimeRestartResponse { stopped, started };
            record_cli_lifecycle_operation(
                "runtime",
                "restart",
                if response.started.running {
                    OperationEventState::Success
                } else {
                    OperationEventState::Failed
                },
                if response.started.running {
                    "dev 服务已重启"
                } else {
                    "dev 服务重启失败"
                },
                &format!(
                    "{} · {}",
                    response.started.project_name, response.started.status_label
                ),
                &response.started.detail,
                Some(&response.started.project_key),
                Some(&response.started.project_name),
                serde_json::to_value(&response).ok(),
            );
            if json_mode {
                print_json_command(json_command, &response)
            } else {
                println!("stop:");
                print_runtime_daemon_status(&response.stopped);
                println!();
                println!("start:");
                print_runtime_start(&response.started);
                Ok(())
            }
        }
        RuntimeCommands::Adopt {
            project,
            pid,
            debug_profile,
            command,
            expected_port,
        } => {
            let configured_project_name = config
                .find_project(&project)
                .ok()
                .map(|project| project.name.clone());
            let response = adopt_project_runtime_with_options(
                config,
                &project,
                pid,
                &ProjectRuntimeLaunchOptions {
                    debug_profile,
                    command,
                    expected_port,
                    ..ProjectRuntimeLaunchOptions::default()
                },
            );
            match &response {
                Ok(response) => {
                    record_cli_workspace_operation(WorkspaceOperationWorklogEvent {
                        event_id: None,
                        kind: "运行".to_string(),
                        summary: format!("认领 {project} 进程 · {}", response.status_key),
                        detail: Some(response.detail.clone()),
                        success: response.supported,
                    });
                    record_cli_lifecycle_operation(
                        "runtime",
                        "adopt",
                        if response.supported {
                            OperationEventState::Success
                        } else {
                            OperationEventState::Failed
                        },
                        if response.supported {
                            "已认领外部 dev 服务"
                        } else {
                            "外部 dev 服务认领失败"
                        },
                        &format!(
                            "{} · {}",
                            configured_project_name.as_deref().unwrap_or(&project),
                            response.status_key
                        ),
                        &response.detail,
                        Some(&project),
                        configured_project_name.as_deref(),
                        serde_json::to_value(response).ok(),
                    );
                }
                Err(error) => {
                    record_cli_workspace_operation(WorkspaceOperationWorklogEvent {
                        event_id: None,
                        kind: "运行".to_string(),
                        summary: format!("认领 {project} 进程失败"),
                        detail: Some(error.clone()),
                        success: false,
                    });
                    record_cli_lifecycle_operation(
                        "runtime",
                        "adopt",
                        OperationEventState::Failed,
                        "认领外部 dev 服务",
                        "外部 dev 服务认领失败",
                        error,
                        Some(&project),
                        configured_project_name.as_deref(),
                        Some(json!({ "projectKey": project.clone(), "pid": pid })),
                    );
                }
            }
            let response = response.map_err(anyhow::Error::msg)?;
            if json_mode {
                print_json_command(json_command, &response)
            } else {
                print_runtime_daemon_adopt(&response);
                Ok(())
            }
        }
        RuntimeCommands::Diagnose { project, run_id } => {
            let selected =
                selected_runtime_daemon_status(config, &project, run_id.as_deref(), false)?;
            let response = diagnose_runtime_daemon(&project, Path::new(&selected.canonical_cwd))?;
            if json_mode {
                print_json_command(json_command, &response)
            } else {
                print_runtime_diagnosis(&response);
                Ok(())
            }
        }
        RuntimeCommands::Focus {
            project,
            debug_profile,
            runtime_profile,
            url,
        } => {
            let response = rdevtool_core::runtime::focus_project_runtime_with_profile(
                config,
                &project,
                debug_profile.as_deref(),
                runtime_profile.as_deref(),
                url.as_deref(),
            )
            .map_err(|error| anyhow::anyhow!(error))?;
            if json_mode {
                print_json_command(json_command, &response)
            } else {
                print_runtime_focus(&response);
                Ok(())
            }
        }
        RuntimeCommands::Wait {
            project,
            run_id,
            until,
            timeout_ms,
            poll_interval_ms,
            probe_url,
            probe_path,
            expected_statuses,
        } => {
            let response = wait_project_runtime(
                config,
                &project,
                &ProjectRuntimeWaitOptions {
                    run_id,
                    until: until.into(),
                    timeout_ms,
                    poll_interval_ms,
                    probe_url,
                    probe_path,
                    expected_statuses,
                },
            )
            .map_err(anyhow::Error::msg)?;
            if json_mode {
                print_json_command(json_command, &response)
            } else {
                print_runtime_wait(&response);
                Ok(())
            }
        }
        RuntimeCommands::Log {
            project,
            kind,
            max_lines,
            clear,
            current,
            run_id,
        } => {
            if clear && (current || run_id.is_some()) {
                anyhow::bail!("--clear cannot be combined with --current or --run-id");
            }
            if current && run_id.is_some() {
                anyhow::bail!("choose only one of --current or --run-id");
            }
            let kind = ProjectRuntimeLogKind::from(kind);
            let response = if clear {
                clear_project_runtime_log(config, &project, kind)
            } else {
                read_project_runtime_log_with_selection(
                    config,
                    &project,
                    kind,
                    max_lines,
                    current,
                    run_id.as_deref(),
                )
            }
            .map_err(|error| anyhow::anyhow!(error))?;
            if json_mode {
                print_json_command(json_command, &response)
            } else {
                print_runtime_log(&response);
                Ok(())
            }
        }
    }
}

fn run_artifacts(
    command: ArtifactCommands,
    config_override: Option<&Path>,
    json_mode: bool,
) -> Result<()> {
    let json_command = command.json_command_name();
    let (config, _) = load_cli_config(config_override)?;
    let paths = ensure_default_configs()?;
    match command {
        ArtifactCommands::List {
            workspace,
            all_workspaces,
            project,
            kinds,
        } => {
            let response = managed_artifact_inventory(
                &config,
                &paths,
                &ManagedArtifactQuery {
                    workspace,
                    all_workspaces,
                    project,
                    kinds,
                },
            )?;
            if json_mode {
                print_json_command(json_command, &response)
            } else {
                print_managed_artifact_inventory(&response);
                Ok(())
            }
        }
        ArtifactCommands::CleanupPlan {
            workspace,
            all_workspaces,
            project,
            kinds,
            artifact_ids,
        } => {
            let response = managed_artifact_cleanup_plan(
                &config,
                &paths,
                &ManagedArtifactCleanupQuery {
                    inventory: ManagedArtifactQuery {
                        workspace,
                        all_workspaces,
                        project,
                        kinds,
                    },
                    artifact_ids,
                },
            )?;
            if json_mode {
                print_json_command(json_command, &response)
            } else {
                print_managed_artifact_cleanup_plan(&response);
                Ok(())
            }
        }
    }
}

fn print_managed_artifact_inventory(response: &ManagedArtifactInventoryResponse) {
    println!("{}", response.status.label);
    println!(
        "workspace : {}",
        response.effective.workspace_keys.join(", ")
    );
    println!(
        "artifacts : {} (existing {}, missing {}, active {})",
        response.observed.summary.artifact_count,
        response.observed.summary.existing_count,
        response.observed.summary.missing_count,
        response.observed.summary.active_count,
    );
    for record in &response.observed.artifacts {
        println!(
            "- {} {:<24} {:<9} {}",
            record.id,
            record.artifact.kind,
            if record.active {
                "active"
            } else {
                &record.object_type
            },
            record.artifact.path,
        );
    }
    if !response.observed.references.is_empty() {
        println!("references: {}", response.observed.references.len());
        for reference in &response.observed.references {
            println!("- {:<24} {}", reference.kind, reference.path);
        }
    }
}

fn print_managed_artifact_cleanup_plan(response: &ManagedArtifactCleanupPlanResponse) {
    println!("{}", response.status.label);
    println!("execution : unsupported (plan only)");
    println!(
        "actions   : {} eligible, {} review, {} blocked",
        response.observed.eligible_count,
        response.observed.review_required_count,
        response.observed.blocked_count,
    );
    for action in &response.observed.actions {
        println!(
            "- {:<14} {:<28} {}",
            action.eligibility, action.action, action.path
        );
        println!("  {}", action.reason);
    }
}

fn print_runtime_daemon_status(status: &RuntimeDaemonStatus) {
    println!("project   : {}", status.project_key);
    println!("cwd       : {}", status.canonical_cwd);
    println!("status    : {}", status.phase_key);
    println!("managed   : {}", status.managed);
    println!("compatible: {}", status.version_compatible);
    if let Some(state) = status.state.as_ref() {
        println!("phase     : {:?}", state.phase);
        println!("daemon pid: {}", state.daemon_pid);
        if let Some(pid) = state.worker_pid {
            println!("worker pid: {pid}");
        }
        if let Some(url) = state.ready_url.as_deref() {
            println!("ready url : {url}");
        }
    }
    println!("detail    : {}", status.detail);
}

fn print_runtime_daemon_list(statuses: &[RuntimeDaemonStatus]) {
    if statuses.is_empty() {
        println!("no runtime daemon states found");
        return;
    }
    for status in statuses {
        println!(
            "{}  {}  managed={}  {}",
            status.project_key, status.phase_key, status.managed, status.canonical_cwd
        );
    }
}

fn print_runtime_daemon_adopt(response: &RuntimeDaemonAdoptResponse) {
    println!("project  : {}", response.project_key);
    println!("cwd      : {}", response.canonical_cwd);
    println!("pid      : {}", response.pid);
    println!("pgid     : {}", response.pgid);
    println!("command  : {}", response.command);
    println!("supported: {}", response.supported);
    println!("detail   : {}", response.detail);
    print_runtime_daemon_status(&response.status);
}

fn print_runtime_diagnosis(response: &RuntimeDaemonDiagnosis) {
    print_runtime_daemon_status(&response.status);
    println!("healthy   : {}", response.healthy);
    if !response.issues.is_empty() {
        println!("issues:");
        for issue in &response.issues {
            println!("- {issue}");
        }
    }
    if let Some(command) = response.process_command.as_deref() {
        println!("process command: {command}");
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
    if let Some(target) = response.target.as_ref() {
        println!("target cwd: {} ({})", target.cwd, target.cwd_source);
        println!(
            "target command: {} ({})",
            target.command, target.command_source
        );
        if let Some(url) = target.focus_url.as_deref() {
            println!("target focus: {}", url);
        }
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
    if let Some(target) = response.target.as_ref() {
        println!("effective target: {} · {}", target.cwd, target.command);
        if let Some(url) = target.focus_url.as_deref() {
            println!("effective focus: {}", url);
        }
    }
    println!(
        "environment: {}{}",
        response.environment.status_key,
        response
            .environment
            .cwd
            .as_deref()
            .map(|cwd| format!(" · {cwd}"))
            .unwrap_or_default()
    );
    if let Some(command) = response.environment.dev.configured_command.as_ref() {
        println!("dev command: {}", command);
    }
    if let Some(port) = response.environment.port.effective_port {
        println!(
            "dev port: {} ({})",
            port,
            response
                .environment
                .port
                .source
                .as_deref()
                .unwrap_or("detected")
        );
    } else if let Some(port) = response.environment.port.suggested_port {
        println!("suggested port: {}", port);
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
    if let Some(url) = response.focus_url.as_deref() {
        println!("focus: {}", url);
    }
    if let Some(probe) = response.ready_probe.as_ref() {
        println!(
            "ready probe: url={} path={} timeout={}ms",
            probe.url.as_deref().unwrap_or("<focus/ready URL>"),
            probe.path.as_deref().unwrap_or("<none>"),
            probe.timeout_ms.unwrap_or(180_000)
        );
    }
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
    println!("selection: {}", response.selection);
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

fn print_runtime_wait(response: &ProjectRuntimeWaitResponse) {
    println!(
        "{} - {}: {}",
        response.project_key, response.status.label, response.status.detail
    );
    if let Some(run_id) = response.effective.run_id.as_deref() {
        println!("run id: {}", run_id);
    }
    println!("process started: {}", response.observed.process_started);
    println!("listener ready: {}", response.observed.listener_ready);
    println!("http verified: {}", response.observed.http_verified);
    if let Some(url) = response.effective.probe_url.as_deref() {
        println!("probe url: {}", url);
    }
    if let Some(status) = response.observed.http_status {
        println!("http status: {}", status);
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

fn save_proxy_source_preference_for_active_workspace(source_id: &str) -> Result<()> {
    let paths = ensure_default_configs()?;
    let app_workspace = load_workspace_config(&paths.workspace)?;
    let workspace_key = active_project_workspace_key(&app_workspace);
    save_config_source_preference(&paths, &workspace_key, "proxy", source_id)?;
    Ok(())
}

fn load_proxy_cli_info(
    config_override: Option<&Path>,
    requested_source_id: Option<&str>,
) -> Result<ProxyCliInfo> {
    let (config, _) = load_cli_config(config_override)?;
    let paths = ensure_default_configs()?;
    let app_workspace = load_workspace_config(&paths.workspace)?;
    let active_key = active_project_workspace_key(&app_workspace);
    let workspace = load_active_project_workspace(&paths)?;
    let workspaces = load_project_workspaces(&paths.project_workspaces)?;
    let source_id = requested_source_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| {
            preferred_config_source_id_for_scope(&workspace, &app_workspace, "proxy")
        });
    let source = resolve_config_source(Some(&source_id), &workspaces)?;
    if !source
        .capabilities
        .iter()
        .any(|capability| capability == "proxy")
    {
        anyhow::bail!("config source does not support proxy: {}", source.id);
    }
    let path = source
        .files
        .proxy
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| anyhow::anyhow!("config source has no proxy file: {}", source.id))?;
    if !path.exists() {
        save_proxy_config(&path, &ProxyConfig::default())?;
    }
    let proxy_config = load_proxy_config(&path)?;
    let proxy_config = if source.is_default {
        filter_proxy_config_for_workspace(proxy_config, &workspace)
    } else {
        proxy_config
    };

    Ok(ProxyCliInfo {
        source_id: source.id,
        source_name: source.name,
        path: path.display().to_string(),
        workspace: project_workspace_cli_info(workspace, &config, &active_key),
        profiles: proxy_config.profiles,
        rules: proxy_config.rules,
    })
}

fn proxy_status_response(
    info: &ProxyCliInfo,
    profile: Option<&str>,
) -> Result<ProxyStatusResponse> {
    let profiles = match profile.map(str::trim).filter(|value| !value.is_empty()) {
        Some(profile) => vec![
            info.profiles
                .iter()
                .find(|item| item.id == profile || item.name == profile)
                .ok_or_else(|| anyhow::anyhow!("proxy profile not found: {profile}"))?,
        ],
        None => info.profiles.iter().collect(),
    };
    let statuses = profiles
        .iter()
        .map(|profile| proxy_daemon_status(Path::new(&info.path), &profile.id))
        .collect::<Result<Vec<_>>>()?;
    let items = profiles
        .iter()
        .zip(statuses.iter())
        .map(|(profile, status)| ProxyStatusItem {
            profile_id: profile.id.clone(),
            profile_name: profile.name.clone(),
            listen_url: profile.listen_url(),
            listening: status.running,
            managed: status.managed,
            version_compatible: status.version_compatible,
            protocol_version: status.protocol_version,
            app_version: status.app_version.clone(),
            pid: status.pid,
            started_at: status.started_at.clone(),
            owner: status.owner.clone(),
            ownership: proxy_listener_ownership(status),
            state_path: status.state_path.clone(),
            detail: status.detail.clone(),
        })
        .collect::<Vec<_>>();
    let operation = proxy_status_operation(info, profile, &statuses);
    Ok(ProxyStatusResponse {
        source_id: info.source_id.clone(),
        source_name: info.source_name.clone(),
        path: info.path.clone(),
        profiles: items,
        operation,
    })
}

fn proxy_status_operation(
    info: &ProxyCliInfo,
    requested_profile: Option<&str>,
    statuses: &[ProxyDaemonStatus],
) -> ProxyOperationContract {
    let configured_count = statuses.len();
    let listening_count = statuses.iter().filter(|status| status.running).count();
    let managed_listener_count = statuses
        .iter()
        .filter(|status| status.running && status.managed)
        .count();
    let compatible_managed_listener_count = statuses
        .iter()
        .filter(|status| status.running && status.managed && status.version_compatible)
        .count();
    let external_listener_count = statuses
        .iter()
        .filter(|status| status.running && !status.managed)
        .count();
    let mut risks = Vec::new();
    let mut recommended_actions = Vec::new();
    for status in statuses {
        if status.running && !status.managed {
            risks.push(OperationRisk {
                code: "proxy_listener_unmanaged".to_string(),
                severity: "warning".to_string(),
                detail: format!("{} 正在监听，但不属于 rDevTool daemon", status.profile_name),
            });
        } else if status.managed && !status.running {
            risks.push(OperationRisk {
                code: "proxy_daemon_not_listening".to_string(),
                severity: "warning".to_string(),
                detail: format!("{} 的 daemon 存在，但配置端口未监听", status.profile_name),
            });
        }
        if status.managed && !status.version_compatible {
            risks.push(OperationRisk {
                code: "proxy_daemon_upgrade_required".to_string(),
                severity: "warning".to_string(),
                detail: format!("{} 使用了不兼容的 daemon 版本", status.profile_name),
            });
            recommended_actions.push(RecommendedAction {
                command: format!(
                    "rdevtool --json proxy restart {}",
                    proxy_shell_quote(&status.profile_id)
                ),
                reason: "受控重启并升级该 rDevTool Proxy daemon".to_string(),
                risk: "processRestart".to_string(),
            });
        } else if !status.running {
            recommended_actions.push(RecommendedAction {
                command: format!(
                    "rdevtool --json proxy start {}",
                    proxy_shell_quote(&status.profile_id)
                ),
                reason: "启动配置的 Proxy daemon 后再进行请求诊断".to_string(),
                risk: "processStart".to_string(),
            });
        }
    }
    recommended_actions.truncate(4);
    let started = if compatible_managed_listener_count == configured_count && configured_count > 0 {
        proxy_stage(
            "confirmed",
            true,
            "daemonState+tcpListener",
            "所有选中 profile 均由兼容性可识别的 rDevTool daemon 监听",
        )
    } else if compatible_managed_listener_count > 0 {
        proxy_stage(
            "partial",
            false,
            "daemonState+tcpListener",
            "只有部分选中 profile 由 rDevTool daemon 监听",
        )
    } else {
        proxy_stage(
            "notConfirmed",
            false,
            "daemonState+tcpListener",
            "没有选中 profile 同时满足 rDevTool 归属和端口监听",
        )
    };
    ProxyOperationContract {
        schema_version: 1,
        requested: ProxyOperationRequested {
            profile: requested_profile.map(ToString::to_string),
            ..ProxyOperationRequested::default()
        },
        effective: ProxyOperationEffective {
            source_id: info.source_id.clone(),
            config_path: info.path.clone(),
            profile_ids: statuses
                .iter()
                .map(|status| status.profile_id.clone())
                .collect(),
            selected_profile_id: (statuses.len() == 1).then(|| statuses[0].profile_id.clone()),
            listen_url: (statuses.len() == 1).then(|| statuses[0].listen_url.clone()),
            ..ProxyOperationEffective::default()
        },
        observed: ProxyOperationObserved {
            configured_profile_count: configured_count,
            listening_count,
            managed_listener_count,
            external_listener_count,
            selected_listener: (statuses.len() == 1)
                .then(|| proxy_listener_observation(&statuses[0])),
            response: None,
            event: None,
        },
        lifecycle: ProxyOperationLifecycle {
            configured: proxy_stage(
                "confirmed",
                true,
                "proxyConfig",
                "选中的 Proxy profile 已从有效配置源解析",
            ),
            started,
            matched: proxy_stage(
                "notEvaluated",
                false,
                "none",
                "status 不执行规则匹配或真实请求",
            ),
            verified: proxy_stage("notEvaluated", false, "none", "status 不发送验证请求"),
        },
        status: OperationStatus {
            key: if risks.is_empty() {
                "observed".to_string()
            } else {
                "observedWithRisks".to_string()
            },
            label: "Proxy 状态已观测".to_string(),
            success: true,
            terminal: true,
            detail: format!(
                "{configured_count} 个 profile 已配置，{managed_listener_count} 个由 rDevTool daemon 监听，{external_listener_count} 个端口由外部进程监听"
            ),
        },
        evidence: vec![
            OperationEvidence {
                kind: "configuration".to_string(),
                source: "proxyConfig".to_string(),
                detail: "profile、监听地址和配置来源来自有效 Proxy 配置".to_string(),
            },
            OperationEvidence {
                kind: "listener".to_string(),
                source: "daemonState+tcpListener".to_string(),
                detail: "started 仅在 daemon 归属与 TCP 监听同时成立时确认".to_string(),
            },
        ],
        risks,
        managed_artifacts: proxy_daemon_managed_artifacts(statuses),
        recommended_actions,
    }
}

fn proxy_diagnose_operation(
    info: &ProxyCliInfo,
    requested_profile: Option<String>,
    requested_method: &str,
    requested_url: &str,
    requested_header_count: usize,
    diagnosis: &ProxyRequestDiagnosis,
    daemon_status: &ProxyDaemonStatus,
) -> ProxyOperationContract {
    let predicted_match = diagnosis.matched_rule.is_some();
    let mut risks = diagnosis
        .warnings
        .iter()
        .map(|warning| OperationRisk {
            code: warning.key.clone(),
            severity: "warning".to_string(),
            detail: warning.detail.clone(),
        })
        .collect::<Vec<_>>();
    if daemon_status.running && !daemon_status.managed {
        risks.push(OperationRisk {
            code: "proxy_listener_unmanaged".to_string(),
            severity: "warning".to_string(),
            detail: "配置端口正在监听，但无法证明属于 rDevTool Proxy daemon".to_string(),
        });
    }
    if predicted_match {
        risks.push(OperationRisk {
            code: "proxy_match_predicted_only".to_string(),
            severity: "info".to_string(),
            detail: "规则命中来自静态配置推演，尚未观察到真实代理事件".to_string(),
        });
    }
    let verify_reason = if requested_header_count > 0 {
        "发送真实请求并关联 Proxy 事件；执行时需补回本次诊断使用的非敏感请求头"
    } else {
        "发送真实请求并关联 Proxy 事件，确认实际规则命中与响应"
    };
    let recommended_actions =
        if daemon_status.running && daemon_status.managed && daemon_status.version_compatible {
            vec![RecommendedAction {
                command: format!(
                    "rdevtool --json proxy verify --profile {} --method {} --url {}",
                    proxy_shell_quote(&diagnosis.profile.id),
                    proxy_shell_quote(&diagnosis.request.method),
                    proxy_shell_quote(&diagnosis.request.path)
                ),
                reason: verify_reason.to_string(),
                risk: "networkRequest".to_string(),
            }]
        } else {
            vec![RecommendedAction {
                command: format!(
                    "rdevtool --json proxy status --profile {}",
                    proxy_shell_quote(&diagnosis.profile.id)
                ),
                reason: "先确认 listener 归属、daemon 版本和 started 阶段".to_string(),
                risk: "readOnly".to_string(),
            }]
        };
    ProxyOperationContract {
        schema_version: 1,
        requested: ProxyOperationRequested {
            profile: requested_profile,
            method: Some(requested_method.to_string()),
            url: Some(requested_url.to_string()),
            header_count: requested_header_count,
            ..ProxyOperationRequested::default()
        },
        effective: ProxyOperationEffective {
            source_id: info.source_id.clone(),
            config_path: info.path.clone(),
            profile_ids: vec![diagnosis.profile.id.clone()],
            selected_profile_id: Some(diagnosis.profile.id.clone()),
            listen_url: Some(diagnosis.profile.listen_url.clone()),
            method: Some(diagnosis.request.method.clone()),
            request_url: Some(diagnosis.request.url.clone()),
            path: Some(diagnosis.request.path.clone()),
            predicted_rule_id: diagnosis.matched_rule.as_ref().map(|rule| rule.id.clone()),
            predicted_action: diagnosis
                .matched_rule
                .as_ref()
                .map(|rule| rule.action.clone()),
        },
        observed: ProxyOperationObserved {
            configured_profile_count: 1,
            listening_count: usize::from(daemon_status.running),
            managed_listener_count: usize::from(daemon_status.running && daemon_status.managed),
            external_listener_count: usize::from(daemon_status.running && !daemon_status.managed),
            selected_listener: Some(proxy_listener_observation(daemon_status)),
            response: None,
            event: None,
        },
        lifecycle: ProxyOperationLifecycle {
            configured: proxy_stage(
                "confirmed",
                true,
                "proxyConfig",
                "profile 与规则已从有效配置源解析",
            ),
            started: proxy_started_stage(daemon_status),
            matched: if predicted_match {
                proxy_stage(
                    "predicted",
                    false,
                    "ruleEvaluation",
                    "静态规则推演预测会命中；未观察真实请求事件",
                )
            } else {
                proxy_stage(
                    "notConfirmed",
                    false,
                    "ruleEvaluation",
                    "静态规则推演未找到显式规则命中",
                )
            },
            verified: proxy_stage("notEvaluated", false, "none", "diagnose 不发送真实请求"),
        },
        status: OperationStatus {
            key: "diagnosed".to_string(),
            label: "Proxy 规则诊断已完成".to_string(),
            success: true,
            terminal: true,
            detail: if predicted_match {
                "已完成静态规则推演；matched 尚未由 Proxy 事件确认".to_string()
            } else {
                "静态规则推演未命中显式规则；尚未发送真实请求".to_string()
            },
        },
        evidence: vec![
            OperationEvidence {
                kind: "configuration".to_string(),
                source: "proxyConfig.ruleEvaluation".to_string(),
                detail: "effective 中的 predictedRuleId 只代表配置推演".to_string(),
            },
            OperationEvidence {
                kind: "listener".to_string(),
                source: "daemonState+tcpListener".to_string(),
                detail: "started 需要 rDevTool daemon 归属和 TCP 监听同时成立".to_string(),
            },
        ],
        risks,
        managed_artifacts: proxy_daemon_managed_artifacts(std::slice::from_ref(daemon_status)),
        recommended_actions,
    }
}

#[allow(clippy::too_many_arguments)]
fn verify_proxy_request(
    info: &ProxyCliInfo,
    profile_key: &str,
    method: &str,
    raw_url: &str,
    headers: &BTreeMap<String, String>,
    body: Option<&str>,
    expected_status: Option<u16>,
    expected_body_text: Option<&str>,
    timeout_ms: u64,
) -> Result<ProxyVerifyResponse> {
    let requested_method = method.to_string();
    let profile = info
        .profiles
        .iter()
        .find(|profile| profile.id == profile_key || profile.name == profile_key)
        .ok_or_else(|| anyhow::anyhow!("proxy profile not found: {profile_key}"))?;
    let daemon_status = proxy_daemon_status(Path::new(&info.path), &profile.id)?;
    let diagnosis = diagnose_proxy_request(
        &ProxyConfig {
            profiles: info.profiles.clone(),
            rules: info.rules.clone(),
        },
        &profile.id,
        method,
        raw_url,
        headers,
    )?;
    let request_url = proxy_local_request_url(profile, raw_url)?;
    let method = reqwest::Method::from_bytes(method.trim().to_ascii_uppercase().as_bytes())?;
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms.max(1)))
        .build()?;
    let mut request = client.request(method.clone(), &request_url);
    for (key, value) in headers {
        if !key.eq_ignore_ascii_case(PROXY_VERIFY_ID_HEADER) {
            request = request.header(key, value);
        }
    }
    let verification_id = (daemon_status.managed && daemon_status.version_compatible)
        .then(|| uuid::Uuid::new_v4().to_string());
    if let Some(verification_id) = verification_id.as_ref() {
        request = request.header(PROXY_VERIFY_ID_HEADER, verification_id);
    }
    if let Some(body) = body {
        request = request.body(body.to_string());
    }
    let started = std::time::Instant::now();
    let response = request.send().map_err(|error| {
        anyhow::anyhow!(
            "proxy verify request failed for {}: {}",
            profile.listen_url(),
            error
        )
    })?;
    let elapsed_ms = started.elapsed().as_millis();
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(ToString::to_string);
    let response_body = response.text()?;
    let body_matches = expected_body_text
        .map(|expected| response_body.contains(expected))
        .unwrap_or(true);
    let status_matches = expected_status
        .map(|expected| expected == status)
        .unwrap_or(true);
    let (body_preview, body_truncated) =
        proxy_body_preview(&response_body, content_type.as_deref());
    let observed_event = verification_id.as_deref().and_then(|verification_id| {
        wait_for_proxy_verify_event(
            Path::new(&info.path),
            &profile.id,
            verification_id,
            timeout_ms,
        )
    });
    let verified = status_matches && body_matches;
    let operation = proxy_verify_operation(
        info,
        profile_key,
        &requested_method,
        profile,
        raw_url,
        headers.len(),
        body.is_some(),
        expected_status,
        expected_body_text.is_some(),
        timeout_ms,
        &diagnosis,
        &daemon_status,
        &request_url,
        status,
        elapsed_ms,
        status_matches,
        body_matches,
        verified,
        observed_event.as_ref(),
    );

    Ok(ProxyVerifyResponse {
        profile_id: profile.id.clone(),
        profile_name: profile.name.clone(),
        listen_url: profile.listen_url(),
        request_url,
        method: method.to_string(),
        diagnosis,
        status,
        content_type,
        body_preview,
        body_truncated,
        elapsed_ms,
        expected_status,
        expected_body_text_provided: expected_body_text.is_some(),
        status_matches,
        body_matches,
        verified,
        operation,
    })
}

#[allow(clippy::too_many_arguments)]
fn proxy_verify_operation(
    info: &ProxyCliInfo,
    requested_profile: &str,
    requested_method: &str,
    profile: &ProxyProfile,
    requested_url: &str,
    header_count: usize,
    body_provided: bool,
    expected_status: Option<u16>,
    expected_body_text_provided: bool,
    timeout_ms: u64,
    diagnosis: &ProxyRequestDiagnosis,
    daemon_status: &ProxyDaemonStatus,
    request_url: &str,
    response_status: u16,
    elapsed_ms: u128,
    status_matches: bool,
    body_matches: bool,
    response_verified: bool,
    event: Option<&ProxyEvent>,
) -> ProxyOperationContract {
    let predicted_rule_id = diagnosis.matched_rule.as_ref().map(|rule| rule.id.as_str());
    let event_matches_prediction =
        proxy_event_confirms_match(event, predicted_rule_id, &diagnosis.request.method);
    let started_confirmed =
        daemon_status.running && daemon_status.managed && daemon_status.version_compatible;
    let strictly_verified = proxy_verification_confirmed(
        started_confirmed,
        event_matches_prediction,
        response_verified,
    );
    let mut risks = Vec::new();
    if !started_confirmed {
        risks.push(OperationRisk {
            code: if daemon_status.running {
                "proxy_listener_unmanaged".to_string()
            } else {
                "proxy_not_started".to_string()
            },
            severity: "error".to_string(),
            detail: "无法确认请求目标是已启动的 rDevTool Proxy daemon".to_string(),
        });
    }
    if event.is_none() {
        risks.push(OperationRisk {
            code: "proxy_event_not_observed".to_string(),
            severity: "error".to_string(),
            detail: "HTTP 请求已返回，但没有捕获到带本次验证标记的 Proxy 事件".to_string(),
        });
    } else if !event_matches_prediction {
        risks.push(OperationRisk {
            code: "proxy_rule_observation_mismatch".to_string(),
            severity: "error".to_string(),
            detail: "实际 Proxy 事件与静态规则推演结果不一致".to_string(),
        });
    }
    if !status_matches {
        risks.push(OperationRisk {
            code: "proxy_status_assertion_failed".to_string(),
            severity: "error".to_string(),
            detail: format!("实际 HTTP 状态码 {response_status} 不符合预期"),
        });
    }
    if !body_matches {
        risks.push(OperationRisk {
            code: "proxy_body_assertion_failed".to_string(),
            severity: "error".to_string(),
            detail: "响应正文不包含预期文本".to_string(),
        });
    }
    if let Some(error) = event.and_then(|event| event.error.as_ref()) {
        risks.push(OperationRisk {
            code: "proxy_event_error".to_string(),
            severity: "error".to_string(),
            detail: error.clone(),
        });
    }
    let matched_stage = match event {
        Some(event) if event_matches_prediction => proxy_stage(
            "confirmed",
            true,
            "proxyEvent",
            if event.matched_rule_id.is_some() {
                "本次验证请求已进入静态推演选中的规则"
            } else {
                "本次验证请求已进入 Proxy，并按预测走默认转发"
            },
        ),
        Some(_) => proxy_stage(
            "notConfirmed",
            false,
            "proxyEvent",
            "捕获到本次请求事件，但实际规则与静态推演不一致",
        ),
        None => proxy_stage(
            "notConfirmed",
            false,
            "proxyEvent",
            "没有捕获到可关联本次请求的 Proxy 事件",
        ),
    };
    let mut recommended_actions = Vec::new();
    if !strictly_verified {
        recommended_actions.push(RecommendedAction {
            command: format!(
                "rdevtool --json proxy diagnose --profile {} --method {} --url {}",
                proxy_shell_quote(&profile.id),
                proxy_shell_quote(&diagnosis.request.method),
                proxy_shell_quote(&diagnosis.request.path)
            ),
            reason: "重新读取规则推演、listener 归属和阻塞原因".to_string(),
            risk: "readOnly".to_string(),
        });
    }
    ProxyOperationContract {
        schema_version: 1,
        requested: ProxyOperationRequested {
            profile: Some(requested_profile.to_string()),
            method: Some(requested_method.to_string()),
            url: Some(requested_url.to_string()),
            header_count,
            body_provided,
            expected_status,
            expected_body_text_provided,
            timeout_ms: Some(timeout_ms),
        },
        effective: ProxyOperationEffective {
            source_id: info.source_id.clone(),
            config_path: info.path.clone(),
            profile_ids: vec![profile.id.clone()],
            selected_profile_id: Some(profile.id.clone()),
            listen_url: Some(profile.listen_url()),
            method: Some(diagnosis.request.method.clone()),
            request_url: Some(request_url.to_string()),
            path: Some(diagnosis.request.path.clone()),
            predicted_rule_id: diagnosis.matched_rule.as_ref().map(|rule| rule.id.clone()),
            predicted_action: diagnosis
                .matched_rule
                .as_ref()
                .map(|rule| rule.action.clone()),
        },
        observed: ProxyOperationObserved {
            configured_profile_count: 1,
            listening_count: usize::from(daemon_status.running),
            managed_listener_count: usize::from(started_confirmed),
            external_listener_count: usize::from(daemon_status.running && !daemon_status.managed),
            selected_listener: Some(proxy_listener_observation(daemon_status)),
            response: Some(ProxyResponseObservation {
                received: true,
                status: response_status,
                elapsed_ms,
                status_matches,
                body_matches,
            }),
            event: Some(proxy_event_observation(event)),
        },
        lifecycle: ProxyOperationLifecycle {
            configured: proxy_stage(
                "confirmed",
                true,
                "proxyConfig",
                "profile、请求地址和规则已解析",
            ),
            started: proxy_started_stage(daemon_status),
            matched: matched_stage,
            verified: if strictly_verified {
                proxy_stage(
                    "confirmed",
                    true,
                    "proxyEvent+httpResponse",
                    "Proxy 事件、实际规则和 HTTP 断言均已确认",
                )
            } else {
                proxy_stage(
                    "notConfirmed",
                    false,
                    "proxyEvent+httpResponse",
                    "至少一项 Proxy 归属、事件关联、规则命中或 HTTP 断言未确认",
                )
            },
        },
        status: OperationStatus {
            key: if strictly_verified {
                "verified".to_string()
            } else {
                "verificationFailed".to_string()
            },
            label: if strictly_verified {
                "Proxy 请求已验证".to_string()
            } else {
                "Proxy 请求未完成严格验证".to_string()
            },
            success: strictly_verified,
            terminal: true,
            detail: if strictly_verified {
                "configured、started、matched、verified 四个阶段均有对应证据".to_string()
            } else {
                "保留 legacy verified 作为 HTTP 断言结果；严格结果以 operation.lifecycle.verified 为准"
                    .to_string()
            },
        },
        evidence: vec![
            OperationEvidence {
                kind: "listener".to_string(),
                source: "daemonState+tcpListener".to_string(),
                detail: "started 来自 rDevTool daemon 身份与端口监听的联合观测".to_string(),
            },
            OperationEvidence {
                kind: "match".to_string(),
                source: "proxyEvent.verificationId".to_string(),
                detail: "matched 来自带单次随机标记的真实 Proxy 事件，而非静态推演".to_string(),
            },
            OperationEvidence {
                kind: "response".to_string(),
                source: "httpResponse".to_string(),
                detail: "verified 同时要求事件规则一致和 HTTP 状态/正文断言通过".to_string(),
            },
        ],
        risks,
        managed_artifacts: proxy_daemon_managed_artifacts(std::slice::from_ref(daemon_status)),
        recommended_actions,
    }
}

fn wait_for_proxy_verify_event(
    config_path: &Path,
    profile_id: &str,
    verification_id: &str,
    request_timeout_ms: u64,
) -> Option<ProxyEvent> {
    let runtime = ProxyDaemonRuntime;
    let timeout = std::time::Duration::from_millis(request_timeout_ms.clamp(100, 1_000));
    let started = std::time::Instant::now();
    loop {
        if let Some(event) = runtime
            .events(config_path, Some(profile_id))
            .into_iter()
            .find(|event| {
                event.request_headers.iter().any(|(name, value)| {
                    name.eq_ignore_ascii_case(PROXY_VERIFY_ID_HEADER) && value == verification_id
                })
            })
        {
            return Some(event);
        }
        if started.elapsed() >= timeout {
            return None;
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
}

fn proxy_event_observation(event: Option<&ProxyEvent>) -> ProxyEventObservation {
    ProxyEventObservation {
        captured: event.is_some(),
        event_id: event.map(|event| event.id.clone()),
        matched_rule_id: event.and_then(|event| event.matched_rule_id.clone()),
        matched_rule_name: event.and_then(|event| event.matched_rule_name.clone()),
        action: event.map(|event| event.action.clone()),
        status: event.and_then(|event| event.status),
        error: event.and_then(|event| event.error.clone()),
    }
}

fn proxy_event_confirms_match(
    event: Option<&ProxyEvent>,
    predicted_rule_id: Option<&str>,
    method: &str,
) -> bool {
    event.is_some_and(|event| {
        event.matched_rule_id.as_deref() == predicted_rule_id
            && event.method.eq_ignore_ascii_case(method)
    })
}

fn proxy_verification_confirmed(
    started_confirmed: bool,
    event_match_confirmed: bool,
    response_verified: bool,
) -> bool {
    started_confirmed && event_match_confirmed && response_verified
}

fn proxy_stage(state: &str, confirmed: bool, source: &str, detail: &str) -> ProxyOperationStage {
    ProxyOperationStage {
        state: state.to_string(),
        confirmed,
        source: source.to_string(),
        detail: detail.to_string(),
    }
}

fn proxy_started_stage(status: &ProxyDaemonStatus) -> ProxyOperationStage {
    if status.running && status.managed && status.version_compatible {
        proxy_stage(
            "confirmed",
            true,
            "daemonState+tcpListener",
            "rDevTool daemon 归属与配置端口监听均已确认",
        )
    } else if status.running && status.managed {
        proxy_stage(
            "notConfirmed",
            false,
            "daemonState+tcpListener",
            "rDevTool daemon 正在监听，但协议版本不兼容；需受控重启后再验证",
        )
    } else if status.running {
        proxy_stage(
            "notConfirmed",
            false,
            "tcpListener",
            "端口正在监听，但 listener 不属于 rDevTool daemon",
        )
    } else if status.managed {
        proxy_stage(
            "notConfirmed",
            false,
            "daemonState+tcpListener",
            "daemon 状态存在，但配置端口没有监听",
        )
    } else {
        proxy_stage("notConfirmed", false, "tcpListener", "配置端口没有监听")
    }
}

fn proxy_listener_ownership(status: &ProxyDaemonStatus) -> String {
    if status.managed {
        "rdevtool-daemon".to_string()
    } else if status.running {
        "external".to_string()
    } else {
        "none".to_string()
    }
}

fn proxy_listener_observation(status: &ProxyDaemonStatus) -> ProxyListenerObservation {
    ProxyListenerObservation {
        listening: status.running,
        managed: status.managed,
        version_compatible: status.version_compatible,
        ownership: proxy_listener_ownership(status),
        pid: status.pid,
    }
}

fn proxy_daemon_managed_artifacts(statuses: &[ProxyDaemonStatus]) -> Vec<ManagedArtifact> {
    statuses
        .iter()
        .filter(|status| status.managed)
        .map(|status| ManagedArtifact {
            kind: "proxyState".to_string(),
            path: status.state_path.clone(),
            ownership: "rdevtool".to_string(),
            lifecycle: "proxySession".to_string(),
        })
        .collect()
}

fn proxy_shell_quote(value: &str) -> String {
    if !value.is_empty()
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-._/:".contains(character))
    {
        return value.to_string();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn proxy_local_request_url(profile: &ProxyProfile, raw_url: &str) -> Result<String> {
    let path = if raw_url.starts_with("http://") || raw_url.starts_with("https://") {
        let parsed = reqwest::Url::parse(raw_url)?;
        match parsed.query() {
            Some(query) => format!("{}?{}", parsed.path(), query),
            None => parsed.path().to_string(),
        }
    } else if raw_url.starts_with('/') {
        raw_url.to_string()
    } else {
        format!("/{raw_url}")
    };
    let host = match profile.listen_host.trim() {
        "" | "0.0.0.0" | "::" | "[::]" => "127.0.0.1".to_string(),
        value if value.contains(':') && !value.starts_with('[') => format!("[{value}]"),
        value => value.to_string(),
    };
    Ok(format!("http://{}:{}{}", host, profile.listen_port, path))
}

fn proxy_body_preview(body: &str, content_type: Option<&str>) -> (String, bool) {
    const MAX_CHARS: usize = 2048;
    let redacted = serde_json::from_str::<serde_json::Value>(body)
        .map(|mut value| {
            redact_sensitive_json(&mut value);
            serde_json::to_string(&value).unwrap_or_else(|_| "<json response>".to_string())
        })
        .unwrap_or_else(|_| redact_sensitive_text(body, content_type));
    let truncated = redacted.chars().count() > MAX_CHARS;
    let preview = redacted.chars().take(MAX_CHARS).collect::<String>();
    (preview, truncated)
}

fn redact_sensitive_text(body: &str, content_type: Option<&str>) -> String {
    if content_type.is_some_and(|value| {
        !value.starts_with("text/")
            && !value.contains("json")
            && !value.contains("xml")
            && !value.contains("javascript")
    }) {
        return "<non-text response>".to_string();
    }
    body.lines()
        .map(|line| {
            for separator in [':', '='] {
                if let Some((key, _)) = line.split_once(separator) {
                    if is_sensitive_output_key(key.trim()) {
                        return format!("{}{} <redacted>", key.trim(), separator);
                    }
                }
            }
            line.to_string()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn redact_sensitive_json(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, value) in map {
                if is_sensitive_output_key(key) {
                    *value = serde_json::Value::String("<redacted>".to_string());
                } else {
                    redact_sensitive_json(value);
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                redact_sensitive_json(item);
            }
        }
        _ => {}
    }
}

fn is_sensitive_output_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    [
        "password",
        "secret",
        "token",
        "authorization",
        "cookie",
        "private_key",
        "privatekey",
    ]
    .iter()
    .any(|marker| key.contains(marker))
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
    println!("source    : {} ({})", info.source_name, info.source_id);
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

fn print_proxy_status(response: &ProxyStatusResponse) {
    println!(
        "source    : {} ({})",
        response.source_name, response.source_id
    );
    println!("path      : {}", response.path);
    for profile in &response.profiles {
        println!(
            "{:<20} {:<10} {}{}{}",
            profile.profile_name,
            if profile.listening {
                "listening"
            } else {
                "stopped"
            },
            profile.listen_url,
            profile
                .owner
                .as_ref()
                .map(|owner| format!(" · {}", owner))
                .unwrap_or_default(),
            if profile.managed && !profile.version_compatible {
                " · managed · upgrade available"
            } else if profile.managed {
                " · managed"
            } else {
                ""
            }
        );
    }
    print_proxy_operation_lifecycle(&response.operation);
}

fn print_proxy_verify(response: &ProxyVerifyResponse) {
    println!(
        "{} {} -> {} ({} ms)",
        response.method, response.request_url, response.status, response.elapsed_ms
    );
    println!(
        "profile: {} ({}) {}",
        response.profile_name, response.profile_id, response.listen_url
    );
    println!(
        "matched: {}",
        response
            .diagnosis
            .matched_rule
            .as_ref()
            .map(|rule| format!("{} ({})", rule.name, rule.id))
            .unwrap_or_else(|| "no explicit rule".to_string())
    );
    println!(
        "verified: {} (status={}, body={})",
        response.verified, response.status_matches, response.body_matches
    );
    print_proxy_operation_lifecycle(&response.operation);
    if !response.body_preview.is_empty() {
        println!("body: {}", response.body_preview);
    }
}

fn print_proxy_operation_lifecycle(operation: &ProxyOperationContract) {
    println!(
        "lifecycle: configured={} started={} matched={} verified={}",
        operation.lifecycle.configured.state,
        operation.lifecycle.started.state,
        operation.lifecycle.matched.state,
        operation.lifecycle.verified.state
    );
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

fn active_history_workspace_cli() -> Result<ProjectWorkspaceConfig> {
    let paths = ensure_default_configs()?;
    load_active_project_workspace(&paths)
}

fn list_deploy_history_for_workspace(
    storage: &Storage,
    project: Option<&str>,
    limit: usize,
) -> Result<Vec<DeployHistoryEntry>> {
    let workspace = active_history_workspace_cli()?;
    if workspace.is_system() {
        return storage
            .list_deploy_history_filtered(project, limit)
            .map_err(anyhow::Error::msg);
    }
    if project.is_some_and(|project| !workspace.allows_project(project)) {
        return Ok(Vec::new());
    }
    Ok(storage
        .list_all_deploy_history()
        .map_err(anyhow::Error::msg)?
        .into_iter()
        .filter(|entry| entry.workspace_key.as_deref() == Some(workspace.key.as_str()))
        .filter(|entry| project.is_none_or(|key| entry.project_key == key))
        .take(limit)
        .collect())
}

fn list_merge_history_for_workspace(
    storage: &Storage,
    project: Option<&str>,
    limit: usize,
) -> Result<Vec<MergeHistoryEntry>> {
    let workspace = active_history_workspace_cli()?;
    if workspace.is_system() {
        return storage
            .list_merge_history_filtered(project, limit)
            .map_err(anyhow::Error::msg);
    }
    if project.is_some_and(|project| !workspace.allows_project(project)) {
        return Ok(Vec::new());
    }
    Ok(storage
        .list_all_merge_history()
        .map_err(anyhow::Error::msg)?
        .into_iter()
        .filter(|entry| entry.workspace_key.as_deref() == Some(workspace.key.as_str()))
        .filter(|entry| project.is_none_or(|key| entry.project_key == key))
        .take(limit)
        .collect())
}

fn list_operation_events_for_workspace(
    storage: &Storage,
    domain: Option<&str>,
    origin: Option<&str>,
    project: Option<&str>,
    limit: usize,
) -> Result<Vec<OperationEvent>> {
    let workspace = active_history_workspace_cli()?;
    if !workspace.is_system() && project.is_some_and(|project| !workspace.allows_project(project)) {
        return Ok(Vec::new());
    }
    Ok(list_operation_events(storage)
        .map_err(anyhow::Error::msg)?
        .into_iter()
        .filter(|event| workspace.is_system() || event.workspace_key == workspace.key)
        .filter(|event| domain.is_none_or(|domain| event.domain.eq_ignore_ascii_case(domain)))
        .filter(|event| {
            origin.is_none_or(|origin| event.origin.as_str().eq_ignore_ascii_case(origin))
        })
        .filter(|event| project.is_none_or(|project| event.project_key.as_deref() == Some(project)))
        .take(limit.clamp(1, 500))
        .collect())
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
            serde_json::to_value(execute_cli_deploy(config, &request)?).map_err(anyhow::Error::from)
        }
        "merge" => {
            let request: MergeRequest = serde_json::from_value(action.request.clone())?;
            let result = core::execute_merge(config, &request);
            record_cli_merge_result(
                "重播合并",
                &request.project,
                &request.source_branch,
                &request.target_branch,
                &result,
            );
            serde_json::to_value(result?).map_err(anyhow::Error::from)
        }
        other => anyhow::bail!("unsupported replay kind: {other}"),
    }
}

fn run_history(config: &AppConfig, command: HistoryCommands, json_mode: bool) -> Result<()> {
    let storage = Storage::new_default().map_err(anyhow::Error::msg)?;
    match command {
        HistoryCommands::Operations {
            command,
            domain,
            origin,
            project,
            limit,
        } => {
            if let Some(HistoryOperationCommands::Show { id }) = command {
                let item = list_operation_events_for_workspace(
                    &storage,
                    None,
                    None,
                    None,
                    OPERATION_EVENT_HISTORY_LIMIT,
                )?
                .into_iter()
                .find(|item| item.id == id)
                .ok_or_else(|| anyhow::anyhow!("operation event not found: {id}"))?;
                if json_mode {
                    return print_json_command("history.operations.show", &item);
                }
                println!("ID: {}", item.id);
                println!("来源: {}", item.origin.as_str());
                println!("领域: {} / {}", item.domain, item.action);
                println!("状态: {:?}", item.state);
                println!("标题: {}", item.title);
                println!("摘要: {}", item.summary);
                if !item.detail.trim().is_empty() {
                    println!("详情: {}", item.detail);
                }
                println!("工作区: {}", item.workspace_key);
                if let Some(project) = item.project_key.as_deref() {
                    println!("项目: {project}");
                }
                println!("创建时间: {}", item.created_at);
                println!("更新时间: {}", item.updated_at);
                if let Some(payload) = item.payload.as_ref() {
                    println!("诊断数据:\n{}", serde_json::to_string_pretty(payload)?);
                }
                return Ok(());
            }
            let items = list_operation_events_for_workspace(
                &storage,
                domain.as_deref(),
                origin.as_deref(),
                project.as_deref(),
                limit,
            )?;
            if json_mode {
                print_json_command("history.operations", &items)
            } else {
                for item in items {
                    let state = match item.state {
                        OperationEventState::Running => "进行中",
                        OperationEventState::Success => "成功",
                        OperationEventState::Failed => "失败",
                        OperationEventState::Info => "信息",
                    };
                    println!(
                        "{:<24} {:<6} {:<12} {}",
                        item.updated_at, state, item.title, item.summary
                    );
                }
                Ok(())
            }
        }
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
            preset,
            compact,
            include,
            debug_profile,
            runtime_profile,
        } => {
            let (config, workspace, _) = context_input
                .ok_or_else(|| anyhow::anyhow!("config is required for agent context"))?;
            let storage = Storage::new_default().map_err(anyhow::Error::msg)?;
            let paths = ensure_default_configs()?;
            let value = context_for_workspace_with_options_and_paths(
                config,
                &storage,
                Some(workspace),
                project.as_deref(),
                query.as_deref(),
                limit,
                &AgentContextOptions {
                    preset: preset.map(Into::into),
                    compact,
                    includes: include.into_iter().map(Into::into).collect(),
                    debug_profile,
                    runtime_profile,
                },
                &paths,
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

fn print_branch_task_json_command(
    command: &str,
    value: &BranchTaskResponse,
    error_code: &str,
) -> Result<()> {
    if value.success {
        return print_json_command(command, value);
    }
    print_json(&json!({
        "ok": false,
        "command": command,
        "data": value,
        "error": {
            "code": error_code,
            "message": value.summary,
        },
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
    println!(
        "preset       : {}",
        value.preset.as_deref().unwrap_or("full")
    );
    println!("compact      : {}", value.compact);
    println!("sections     : {}", value.included_sections.join(", "));
    if let Some(workspace) = &value.workspace {
        println!("workspace    : {} ({})", workspace.name, workspace.key);
        if let Some(resource_dir) = &workspace.resource_dir {
            println!("resource dir : {resource_dir}");
        }
        if let Some(worklog) = &workspace.worklog {
            println!("worklog      : {}", worklog.path);
            println!("auto record  : {}", workspace.worklog_auto_record);
        }
    }
    println!("projects     : {}", value.projects.len());
    println!("notes        : {}", value.notes.len());
    println!("build hist   : {}", value.build_history.len());
    println!("merge hist   : {}", value.merge_history.len());
    println!("replayable   : {}", value.replay_actions.len());
    println!("navigation   : {}", value.navigation.len());
    if let Some(proxy) = value.proxy.as_ref() {
        println!(
            "proxy config : {} debug / {} runtime bindings (observed={})",
            proxy.debug_profiles.len(),
            proxy.runtime_profiles.len(),
            proxy.observed
        );
    }
    if let Some(project) = &value.project {
        println!("project      : {}", project.detail.name);
        if let Some(branch) = &project.suggested_branch {
            println!("branch hint  : {branch}");
        }
    }
    if let Some(artifacts) = &value.artifacts {
        println!(
            "artifacts     : {} managed / {} observed / {} references",
            artifacts.observed.summary.managed_count,
            artifacts.observed.summary.artifact_count,
            artifacts.observed.summary.reference_count
        );
        println!(
            "cleanup plan  : {} eligible / {} review / {} blocked (execution={})",
            artifacts.observed.cleanup_plan.eligible_count,
            artifacts.observed.cleanup_plan.review_required_count,
            artifacts.observed.cleanup_plan.blocked_count,
            artifacts.effective.execution_supported
        );
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
    println!("proxy default : {}", value.paths.proxy);
    println!("config sources: {}", value.paths.config_sources);
    if let Some(proxy_active) = &value.paths.proxy_active {
        println!("proxy active  : {proxy_active}");
    }
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
    println!(
        "requested     : target={} env={} branch={}",
        plan.requested.target.as_deref().unwrap_or("<default>"),
        plan.requested.env.as_deref().unwrap_or("<default>"),
        plan.requested.branch.as_deref().unwrap_or("<default>")
    );
    println!(
        "effective     : target={} env={} branch={}",
        plan.effective.target,
        plan.effective.env.as_deref().unwrap_or("<none>"),
        plan.effective.branch.as_deref().unwrap_or("<none>")
    );
    println!(
        "plan status   : {} ({})",
        plan.status.label, plan.status.key
    );
    println!("plan detail   : {}", plan.status.detail);
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
    if let Some(commit) = &plan.observed.commit {
        println!("commit        : {}", commit.short_hash);
        println!(
            "commit source : {}",
            plan.observed
                .commit_source
                .as_deref()
                .unwrap_or("repository")
        );
        println!("commit subject: {}", commit.subject);
    } else {
        println!("commit        : <unavailable>");
    }
    if !plan.observed.changed_paths.is_empty() {
        println!("changed paths : {}", plan.observed.changed_paths.len());
        for path in plan.observed.changed_paths.iter().take(12) {
            println!("  - {path}");
        }
        if plan.observed.changed_paths.len() > 12 {
            println!("  - ... {} more", plan.observed.changed_paths.len() - 12);
        }
    }
    println!("parameters:");
    for (key, value) in &plan.params {
        let value = if is_sensitive_output_key(key) {
            "<redacted>"
        } else {
            value
        };
        println!("  {key} = {value}");
    }
    if !plan.ignored_inputs.is_empty() {
        println!("ignored inputs:");
        for input in &plan.ignored_inputs {
            let value = if is_sensitive_output_key(&input.key) {
                "<redacted>"
            } else {
                input.value.as_str()
            };
            println!("  - {} = {} ({})", input.key, value, input.reason);
        }
    }
    if !plan.risks.is_empty() {
        println!("risks:");
        for risk in &plan.risks {
            println!("  - [{}] {}: {}", risk.severity, risk.code, risk.detail);
        }
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

fn print_branch_file_diff(response: &BranchFileDiffResponse) {
    println!("project       : {}", response.project_name);
    println!("repo path     : {}", response.repo_path);
    println!("file          : {}", response.path);
    println!("mode          : {}", response.mode);
    println!("binary        : {}", response.binary);
    println!("truncated     : {}", response.truncated);
    for warning in &response.warnings {
        println!("warning       : {warning}");
    }
    if !response.diff.is_empty() {
        println!("{}", response.diff);
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
