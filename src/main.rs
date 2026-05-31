mod desktop;
mod tui;

use anyhow::Result;
use clap::{Parser, Subcommand, error::ErrorKind};
use rdevtool_core::agent::{AgentCapabilities, AgentContext, capabilities, context};
use rdevtool_core::config::{
    AppConfig, default_config_dir, default_projects_path, default_workspace_path,
    ensure_default_configs, load_config, load_workspace_config, resolve_config_path,
    save_workspace_config,
};
use rdevtool_core::core::{
    self, BranchCheckoutRequest, BranchCommitOverview, BranchCreateRequest, BranchPushRequest,
    BranchPushStatus, BranchSwitchRequest, BranchSyncRequest, BranchTaskResponse,
    BuildStatusResponse, DeployRequest, DeployTargetMeta, MergeRequest, MergeResponse,
    StatusRequest, branch_push_status, checkout_branch_to_directory, execute_branch_create,
    execute_branch_push, execute_branch_switch, execute_branch_sync, parse_extra_params_args,
};
use rdevtool_core::navigation::{
    NavigationIndexEntry, find_navigation_entry, list_navigation_entries, navigation_file_path,
    open_navigation_entry, search_navigation_entries,
};
use rdevtool_core::storage::{self, SaveNoteRequest, Storage};
use serde::Serialize;
use serde_json::json;
use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Read};
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
enum ProjectCommands {
    List,
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
                let _ = error.print();
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
        Commands::Context {
            project,
            query,
            limit,
        } => {
            let (config, _) = load_cli_config(config_override)?;
            run_context(&config, project, query, limit, json)
        }
        Commands::App { command } => run_app(command, json),
        Commands::Projects { command } => {
            let (config, _) = load_cli_config(config_override)?;
            run_projects(&config, command, json)
        }
        Commands::List => {
            let (config, _) = load_cli_config(config_override)?;
            list_projects(&config, json)
        }
        Commands::Tui => {
            let (config, _) = load_cli_config(config_override)?;
            tui::run(&config)
        }
        Commands::Show { project } => {
            let (config, _) = load_cli_config(config_override)?;
            show_project(&config, &project, json)
        }
        Commands::Branch { project } => {
            let (config, _) = load_cli_config(config_override)?;
            show_branch(&config, &project, json)
        }
        Commands::Branches { project } => {
            let (config, _) = load_cli_config(config_override)?;
            show_branches(&config, &project, json)
        }
        Commands::Envs { project, target } => {
            let (config, _) = load_cli_config(config_override)?;
            show_envs(&config, &project, target, json)
        }
        Commands::Options { project, target } => {
            let (config, _) = load_cli_config(config_override)?;
            show_options(&config, &project, target, json)
        }
        Commands::Plan {
            project,
            target,
            env,
            branch,
            extra_params,
        } => {
            let (config, _) = load_cli_config(config_override)?;
            plan_deploy(&config, project, target, env, branch, extra_params, json)
        }
        Commands::Trigger {
            project,
            target,
            env,
            branch,
            extra_params,
        } => {
            let (config, _) = load_cli_config(config_override)?;
            trigger_deploy(&config, project, target, env, branch, extra_params, json)
        }
        Commands::Status {
            queue_url,
            build_url,
        } => {
            let (config, _) = load_cli_config(config_override)?;
            show_status(&config, queue_url, build_url, json)
        }
        Commands::Deploy { command } => {
            let (config, _) = load_cli_config(config_override)?;
            run_deploy(&config, command, json)
        }
        Commands::Git { command } => {
            let (config, _) = load_cli_config(config_override)?;
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
            let (config, _) = load_cli_config(config_override)?;
            show_merge_overview(&config, &project, &source, &target, json)
        }
        Commands::Merge {
            project,
            source,
            target,
        } => {
            let (config, _) = load_cli_config(config_override)?;
            run_merge(&config, project, source, target, json)
        }
        Commands::SyncBranches {
            project,
            source_branch,
            target_branches,
        } => {
            let (config, _) = load_cli_config(config_override)?;
            run_branch_sync(&config, project, source_branch, target_branches, json)
        }
        Commands::CreateBranch {
            projects,
            source_branch,
            target_branch,
        } => {
            let (config, _) = load_cli_config(config_override)?;
            run_branch_create(&config, projects, source_branch, target_branch, json)
        }
        Commands::CheckoutBranch {
            project,
            source_branch,
            destination,
        } => {
            let (config, _) = load_cli_config(config_override)?;
            run_branch_checkout(&config, project, source_branch, destination, json)
        }
        Commands::SwitchBranch {
            project,
            target_branch,
        } => {
            let (config, _) = load_cli_config(config_override)?;
            run_branch_switch(&config, project, target_branch, json)
        }
        Commands::PushStatus { project } => {
            let (config, _) = load_cli_config(config_override)?;
            run_push_status(&config, project, json)
        }
        Commands::PushBranch { project, message } => {
            let (config, _) = load_cli_config(config_override)?;
            run_push_branch(&config, project, message, json)
        }
        Commands::Navigation { command } => run_navigation(command, json),
        Commands::Notes { command } => run_notes(command, json),
        Commands::History { command } => run_history(command, json),
        Commands::Agent { command } => {
            let config = match &command {
                AgentCommands::Capabilities => None,
                AgentCommands::Context { .. } => Some(load_cli_config(config_override)?.0),
            };
            run_agent(config.as_ref(), command, json)
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
}

fn load_cli_config(config_override: Option<&Path>) -> Result<(AppConfig, PathBuf)> {
    let config_path = match config_override {
        Some(path) => resolve_config_path(path)?,
        None => ensure_default_configs()?.projects,
    };
    let config = load_config(&config_path)?;
    Ok((config, config_path))
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
        || message.contains("not configured")
        || message.contains("precondition")
        || message.contains("only available")
        || message.contains("empty directory")
    {
        ("unsupported_operation", 4)
    } else if message.contains("invalid")
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

fn run_context(
    config: &AppConfig,
    project: Option<String>,
    query: Option<String>,
    limit: usize,
    json_mode: bool,
) -> Result<()> {
    let storage = Storage::new_default().map_err(anyhow::Error::msg)?;
    let value = context(
        config,
        &storage,
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

fn load_workspace_preference_info() -> Result<WorkspacePreferenceInfo> {
    let paths = ensure_default_configs()?;
    let config = load_workspace_config(&paths.workspace)?;
    Ok(workspace_preference_info(paths.workspace, config))
}

fn workspace_preference_info(
    workspace_path: PathBuf,
    config: rdevtool_core::config::WorkspaceConfig,
) -> WorkspacePreferenceInfo {
    WorkspacePreferenceInfo {
        workspace_path: workspace_path.display().to_string(),
        style_mode: config.app.style_mode,
        default_page: config.app.default_page,
        enabled_pages: config.app.enabled_pages,
    }
}

fn normalize_cli_style_mode(value: &str) -> Result<String> {
    let trimmed = value.trim();
    match trimmed {
        "light" | "mono" => Ok(trimmed.to_string()),
        _ => anyhow::bail!("style mode must be light or mono"),
    }
}

fn normalize_cli_page(value: Option<String>) -> Option<String> {
    let value = value?;
    let trimmed = value.trim();
    match trimmed {
        "navigation" => Some("projects".to_string()),
        "projects" | "merge" | "deploy" => Some(trimmed.to_string()),
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
        println!("deploy targets:");
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
    let status = branch_push_status(config, &project)?;
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
            let entries = list_navigation_entries(limit)?;
            if json_mode {
                print_json_command("navigation.list", &entries)
            } else {
                print_navigation_entries(&entries);
                Ok(())
            }
        }
        NavigationCommands::Search { query, limit } => {
            let entries = search_navigation_entries(Some(&query), limit)?;
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
            let (matched_category, entry) =
                find_navigation_entry(name.as_deref(), category.as_deref(), query.as_deref())?;
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
    }
}

fn run_history(command: HistoryCommands, json_mode: bool) -> Result<()> {
    let storage = Storage::new_default().map_err(anyhow::Error::msg)?;
    match command {
        HistoryCommands::Deploy { project, limit } => {
            let items = storage
                .list_deploy_history_filtered(project.as_deref(), limit)
                .map_err(anyhow::Error::msg)?;
            if json_mode {
                print_json_command("history.deploy", &items)
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
        HistoryCommands::Merge { project, limit } => {
            let items = storage
                .list_merge_history_filtered(project.as_deref(), limit)
                .map_err(anyhow::Error::msg)?;
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
    }
}

fn run_agent(config: Option<&AppConfig>, command: AgentCommands, json_mode: bool) -> Result<()> {
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
            let config =
                config.ok_or_else(|| anyhow::anyhow!("config is required for agent context"))?;
            let storage = Storage::new_default().map_err(anyhow::Error::msg)?;
            let value = context(
                config,
                &storage,
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
    println!("projects     : {}", value.projects.len());
    println!("notes        : {}", value.notes.len());
    println!("deploy hist  : {}", value.deploy_history.len());
    println!("merge hist   : {}", value.merge_history.len());
    println!("navigation   : {}", value.navigation.len());
    if let Some(project) = &value.project {
        println!("project      : {}", project.detail.name);
        if let Some(branch) = &project.suggested_branch {
            println!("branch hint  : {branch}");
        }
    }
}

fn print_workspace_preferences(value: &WorkspacePreferenceInfo) {
    println!("workspace path : {}", value.workspace_path);
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
    println!("jenkins job   : {}", plan.job_name);
    println!("jenkins base  : {}", plan.jenkins_base_url);
    println!("trigger url   : {}", plan.trigger_url);
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
