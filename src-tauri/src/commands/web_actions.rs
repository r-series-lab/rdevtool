use std::collections::{BTreeMap, BTreeSet};
use std::thread;

use rdevtool_core::config::AppConfig;
use rdevtool_core::navigation::NavigationEntry;
use rdevtool_core::runtime_daemon;
use rdevtool_core::web_actions::{
    ControlledBrowserObservation, ControlledBrowserPage, WebActionListResponse,
    WebActionRunRequest, WebActionRunResult, WebActionScriptRunRequest, WebActionTarget,
    configured_web_actions_browser_port,
    inspect_controlled_browser as core_inspect_controlled_browser,
    list_web_action_navigation_targets as core_list_web_action_navigation_targets,
    list_web_action_targets as core_list_web_action_targets,
    list_web_actions as core_list_web_actions,
    open_web_action_navigation_target as core_open_web_action_navigation_target,
    open_web_action_target as core_open_web_action_target, run_web_action as core_run_web_action,
    run_web_action_navigation as core_run_web_action_navigation,
    run_web_action_navigation_script as core_run_web_action_navigation_script,
    run_web_action_script as core_run_web_action_script,
};

use crate::{
    AppState, active_history_workspace, active_sessions::notify_active_sessions_changed,
    active_workspace_proxy_path, apply_active_workspace_context,
    prepare_rdev_proxy_runtime_profile,
};

const MAX_CONTROLLED_BROWSER_PORTS: usize = 8;

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlledBrowserProjectReference {
    key: String,
    name: String,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlledBrowserSessionSnapshot {
    id: String,
    port: u16,
    endpoint: String,
    browser_name: String,
    browser_version: Option<String>,
    protocol_version: Option<String>,
    page_count: usize,
    pages: Vec<ControlledBrowserPage>,
    runtime_profile_keys: Vec<String>,
    active_projects: Vec<ControlledBrowserProjectReference>,
    configured_projects: Vec<ControlledBrowserProjectReference>,
}

#[derive(Debug, Clone, Default)]
struct ControlledBrowserBinding {
    runtime_profile_keys: BTreeSet<String>,
    active_projects: BTreeMap<String, String>,
    configured_projects: BTreeMap<String, String>,
}

fn controlled_browser_bindings(config: &AppConfig) -> BTreeMap<u16, ControlledBrowserBinding> {
    let mut bindings: BTreeMap<u16, ControlledBrowserBinding> = BTreeMap::new();
    let default_port = configured_web_actions_browser_port().unwrap_or(9223);
    bindings.entry(default_port).or_default();

    let profile_ports = config
        .defaults
        .runtime_profiles
        .iter()
        .filter(|profile| profile.web_actions_enabled && profile.web_actions_port > 0)
        .map(|profile| (profile.key.clone(), profile.web_actions_port))
        .collect::<BTreeMap<_, _>>();

    for (profile_key, port) in &profile_ports {
        bindings
            .entry(*port)
            .or_default()
            .runtime_profile_keys
            .insert(profile_key.clone());
    }

    for project in &config.projects {
        for profile_key in project
            .debug_profiles
            .iter()
            .filter_map(|profile| profile.runtime_profile.as_ref())
        {
            let Some(port) = profile_ports.get(profile_key) else {
                continue;
            };
            bindings
                .entry(*port)
                .or_default()
                .configured_projects
                .insert(project.key.clone(), project.name.clone());
        }
    }

    for status in runtime_daemon::list().unwrap_or_default() {
        if !status.running {
            continue;
        }
        let Some(state) = status.state else {
            continue;
        };
        let runtime_profile = state.runtime_profile.clone().or_else(|| {
            let debug_profile = state.debug_profile.as_deref()?;
            config
                .projects
                .iter()
                .find(|project| project.key == state.project_key)
                .and_then(|project| {
                    project
                        .debug_profiles
                        .iter()
                        .find(|profile| profile.key == debug_profile)
                })
                .and_then(|profile| profile.runtime_profile.clone())
        });
        let Some(port) = runtime_profile
            .as_ref()
            .and_then(|profile_key| profile_ports.get(profile_key))
        else {
            continue;
        };
        bindings
            .entry(*port)
            .or_default()
            .active_projects
            .insert(state.project_key, state.project_name);
    }

    bindings
        .into_iter()
        .take(MAX_CONTROLLED_BROWSER_PORTS)
        .collect()
}

fn project_references(
    projects: BTreeMap<String, String>,
) -> Vec<ControlledBrowserProjectReference> {
    projects
        .into_iter()
        .map(|(key, name)| ControlledBrowserProjectReference { key, name })
        .collect()
}

fn browser_snapshot(
    binding: ControlledBrowserBinding,
    observation: ControlledBrowserObservation,
) -> ControlledBrowserSessionSnapshot {
    ControlledBrowserSessionSnapshot {
        id: format!("browser:{}", observation.port),
        port: observation.port,
        endpoint: observation.endpoint,
        browser_name: observation.browser_name,
        browser_version: observation.browser_version,
        protocol_version: observation.protocol_version,
        page_count: observation.page_count,
        pages: observation.pages,
        runtime_profile_keys: binding.runtime_profile_keys.into_iter().collect(),
        active_projects: project_references(binding.active_projects),
        configured_projects: project_references(binding.configured_projects),
    }
}

fn notify_browser_changed(app: &tauri::AppHandle, action: &str) {
    let workspace_key = active_history_workspace()
        .map(|workspace| workspace.key)
        .unwrap_or_else(|_| "system".to_string());
    notify_active_sessions_changed(app, &workspace_key, "browser", action);
}

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
pub(crate) async fn open_web_action_target(
    app: tauri::AppHandle,
    url: String,
) -> Result<WebActionTarget, String> {
    let target = tauri::async_runtime::spawn_blocking(move || {
        core_open_web_action_target(&url).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    notify_browser_changed(&app, "open");
    Ok(target)
}

#[tauri::command]
pub(crate) async fn open_web_action_navigation_target(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    entry: NavigationEntry,
) -> Result<WebActionTarget, String> {
    let config_state = state.config_state.clone();
    let proxy_runtime = state.proxy_runtime.clone();
    let target = tauri::async_runtime::spawn_blocking(move || {
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
    .map_err(|error| error.to_string())??;
    notify_browser_changed(&app, "open");
    Ok(target)
}

#[tauri::command]
pub(crate) async fn list_controlled_browser_sessions(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ControlledBrowserSessionSnapshot>, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = apply_active_workspace_context(&config_state.load()?)?;
        let bindings = controlled_browser_bindings(&config);
        let mut snapshots = thread::scope(|scope| {
            let handles = bindings
                .into_iter()
                .map(|(port, binding)| {
                    scope.spawn(move || {
                        core_inspect_controlled_browser(port)
                            .ok()
                            .flatten()
                            .map(|observation| browser_snapshot(binding, observation))
                    })
                })
                .collect::<Vec<_>>();
            handles
                .into_iter()
                .filter_map(|handle| handle.join().ok().flatten())
                .collect::<Vec<_>>()
        });
        snapshots.sort_by_key(|snapshot| snapshot.port);
        Ok(snapshots)
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
