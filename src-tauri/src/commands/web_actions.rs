use rdevtool_core::navigation::NavigationEntry;
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

use crate::{
    AppState, active_workspace_proxy_path, apply_active_workspace_context,
    prepare_rdev_proxy_runtime_profile,
};

#[tauri::command]
pub(crate) async fn list_web_actions(
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
pub(crate) async fn open_web_action_target(url: String) -> Result<WebActionTarget, String> {
    tauri::async_runtime::spawn_blocking(move || {
        core_open_web_action_target(&url).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn open_web_action_navigation_target(
    state: tauri::State<'_, AppState>,
    entry: NavigationEntry,
) -> Result<WebActionTarget, String> {
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
        core_open_web_action_navigation_target(&entry, &config.defaults.runtime_profiles)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn list_web_action_targets() -> Result<Vec<WebActionTarget>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        core_list_web_action_targets().map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn list_web_action_navigation_targets(
    state: tauri::State<'_, AppState>,
    entry: NavigationEntry,
) -> Result<Vec<WebActionTarget>, String> {
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
        core_list_web_action_navigation_targets(&entry, &config.defaults.runtime_profiles)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn run_web_action(
    request: WebActionRunRequest,
) -> Result<WebActionRunResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        core_run_web_action(request).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn run_web_action_navigation(
    state: tauri::State<'_, AppState>,
    entry: NavigationEntry,
    request: WebActionRunRequest,
) -> Result<WebActionRunResult, String> {
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
        core_run_web_action_navigation(&entry, &config.defaults.runtime_profiles, request)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn run_web_action_script(
    request: WebActionScriptRunRequest,
) -> Result<WebActionRunResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        core_run_web_action_script(request).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn run_web_action_navigation_script(
    state: tauri::State<'_, AppState>,
    entry: NavigationEntry,
    request: WebActionScriptRunRequest,
) -> Result<WebActionRunResult, String> {
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
        core_run_web_action_navigation_script(&entry, &config.defaults.runtime_profiles, request)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}
