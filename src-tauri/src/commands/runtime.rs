use rdevtool_core::proxy::{default_proxy_path, load_proxy_config};
use rdevtool_core::runtime as core_runtime;

use crate::project_runtime::{
    ProjectRuntimeLogKind, ProjectRuntimeLogResponse, ProjectRuntimePreflightResponse,
    ProjectRuntimeSnapshot,
};
use crate::{AppState, apply_active_workspace_context, optional_editor_string};

#[tauri::command]
pub(crate) async fn list_project_runtimes(
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
pub(crate) async fn list_selected_project_runtimes(
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
pub(crate) async fn preflight_project_runtime(
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
pub(crate) async fn get_project_runtime_context(
    state: tauri::State<'_, AppState>,
    project: String,
    debug_profile: Option<String>,
    runtime_profile: Option<String>,
) -> Result<core_runtime::ProjectRuntimeContextSnapshot, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        let config = apply_active_workspace_context(&config)?;
        core_runtime::project_runtime_context_snapshot(
            &config,
            &project,
            &core_runtime::ProjectRuntimeLaunchOptions {
                debug_profile: optional_editor_string(debug_profile),
                runtime_profile: optional_editor_string(runtime_profile),
                ..core_runtime::ProjectRuntimeLaunchOptions::default()
            },
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn inspect_project_runtime(
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
pub(crate) async fn read_project_runtime_log(
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
