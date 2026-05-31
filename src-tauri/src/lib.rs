use project_runtime::{
    ProjectRuntimeLogKind, ProjectRuntimeLogResponse, ProjectRuntimeSnapshot,
    ProjectRuntimeState,
};
use rdevtool_core::config::{
    AppConfig, BranchRules, DeployParamConfig, DeployParamKind, DeployTargetConfig, Jobs,
    ProjectCommandConfig, ProjectConfig, ProjectFocusConfig, default_config_dir,
    default_projects_path, default_workspace_path, ensure_default_configs, load_config,
    load_workspace_config, save_config, save_workspace_config,
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
    NavigationData, NavigationEntry, NavigationOpenResult, load_navigation_data,
    navigation_file_path, open_navigation_entry,
};
use rdevtool_core::storage::{
    DeployHistoryEntry, MergeHistoryEntry, SaveDeployHistoryRequest, SaveMergeHistoryRequest,
    Storage, default_storage_path,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{
    Arc, RwLock,
    atomic::{AtomicBool, Ordering},
};
use std::time::SystemTime;
use tauri::{
    AppHandle, Manager, WindowEvent,
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
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
const TRAY_SHOW_ID: &str = "tray_show_main";
const TRAY_QUIT_ID: &str = "tray_quit";

fn should_use_tray() -> bool {
    !cfg!(debug_assertions)
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
    }
}

fn load_project_config_editor_state(path: &Path) -> Result<ProjectConfigEditorState, String> {
    let config = load_config(path).map_err(|error| error.to_string())?;
    Ok(ProjectConfigEditorState {
        config_path: path.display().to_string(),
        jenkins_profiles: config.defaults.jenkins_profiles.keys().cloned().collect(),
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
        };
        project.branch_rules = BranchRules {
            source_keywords: normalize_keyword_list(request.branch_rules.source_keywords),
            target_keywords: normalize_keyword_list(request.branch_rules.target_keywords),
        };
        project.dev = apply_editor_command(project.dev.take(), request.dev);
        project.build = apply_editor_command(project.build.take(), request.build);

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
            branch_rules: BranchRules::default(),
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
async fn open_page_navigation_entry(
    entry: NavigationEntry,
) -> Result<NavigationOpenResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        open_navigation_entry(&entry).map_err(|error| error.to_string())
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
    state: tauri::State<'_, AppState>,
    project: String,
) -> Result<ProjectRuntimeSnapshot, String> {
    let runtime = state.project_runtime.clone();
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        runtime.start(&config, &project)
    })
    .await
    .map_err(|error| error.to_string())?
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
    state: tauri::State<'_, AppState>,
    project: String,
) -> Result<ProjectRuntimeSnapshot, String> {
    let runtime = state.project_runtime.clone();
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        runtime.run_build(&config, &project)
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
    state: tauri::State<'_, AppState>,
    project: String,
) -> Result<ProjectRuntimeSnapshot, String> {
    let runtime = state.project_runtime.clone();
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        runtime.open_build_output(&config, &project)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn focus_project_runtime(
    state: tauri::State<'_, AppState>,
    project: String,
) -> Result<ProjectRuntimeSnapshot, String> {
    let runtime = state.project_runtime.clone();
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        runtime.focus_runtime(&config, &project)
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

fn build_tray<R: tauri::Runtime>(
    app: &AppHandle<R>,
    is_quitting: Arc<AtomicBool>,
) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, TRAY_SHOW_ID, "显示主窗口", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, TRAY_QUIT_ID, "退出", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show_item, &separator, &quit_item])?;

    let mut tray_builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .tooltip("rDevTool")
        .show_menu_on_left_click(false)
        .on_menu_event({
            let is_quitting = is_quitting.clone();
            move |app, event| match event.id().as_ref() {
                TRAY_SHOW_ID => show_main_window(app),
                TRAY_QUIT_ID => {
                    is_quitting.store(true, Ordering::Relaxed);
                    app.exit(0);
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
            if should_use_tray() {
                build_tray(app.handle(), tray_quitting.clone()).map_err(std::io::Error::other)?;
            }
            app.manage(AppState {
                storage,
                project_runtime: ProjectRuntimeState::default(),
                config_state: AppConfigState::default(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            get_workspace_app_preferences,
            save_workspace_app_preferences,
            get_project_config_editor,
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
            open_page_navigation_entry,
            storage_get_json,
            storage_set_json,
            storage_delete_json,
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
            focus_project_runtime,
            read_project_runtime_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
