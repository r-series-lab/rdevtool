use std::collections::BTreeMap;

use rdevtool_core::proxy::{default_proxy_path, load_proxy_config};
use rdevtool_core::runtime as core_runtime;

use crate::project_runtime::{
    ProjectRuntimeLogKind, ProjectRuntimeLogResponse, ProjectRuntimePreflightResponse,
    ProjectRuntimeSnapshot,
};
use crate::{
    AppState, apply_active_workspace_context, apply_workspace_context, ensure_default_configs,
    load_active_project_workspace, normalize_runtime_env_overrides, optional_editor_string,
    resolve_workspace_capability_source,
};

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
    runtime_profile: Option<String>,
    command: Option<String>,
    expected_port: Option<u16>,
    env_overrides: Option<BTreeMap<String, String>>,
) -> Result<ProjectRuntimePreflightResponse, String> {
    let runtime = state.project_runtime.clone();
    let proxy_runtime = state.proxy_runtime.clone();
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let config = config_state.load()?;
        let config = apply_active_workspace_context(&config)?;
        let launch_options = core_runtime::ProjectRuntimeLaunchOptions {
            debug_profile: optional_editor_string(debug_profile),
            runtime_profile: optional_editor_string(runtime_profile),
            command: optional_editor_string(command),
            expected_port,
            env: normalize_runtime_env_overrides(env_overrides),
        };
        let mut response = runtime.preflight_with_options(&config, &project, &launch_options)?;
        let bound_proxy_profile_id = response
            .runtime_profile_key
            .as_deref()
            .and_then(|runtime_profile_key| {
                config
                    .defaults
                    .runtime_profiles
                    .iter()
                    .find(|profile| profile.key == runtime_profile_key)
            })
            .and_then(|profile| profile.rdev_proxy_profile_id.clone());
        if let Some(profile_id) = bound_proxy_profile_id {
            let proxy_observation = (|| {
                let paths = ensure_default_configs().map_err(|error| error.to_string())?;
                let workspace =
                    load_active_project_workspace(&paths).map_err(|error| error.to_string())?;
                let source = resolve_workspace_capability_source(&paths, &workspace, "proxy")?;
                let path = crate::proxy_path_for_config_source(&source)?;
                let dashboard = proxy_runtime
                    .dashboard(&path)
                    .map_err(|error| error.to_string())?;
                Ok::<_, String>((source, dashboard))
            })();
            match proxy_observation {
                Ok((source, dashboard)) => {
                    crate::runtime_preflight::enrich_bound_proxy_preflight(
                        &mut response,
                        &source.id,
                        &source.name,
                        &profile_id,
                        &dashboard,
                    );
                    core_runtime::enrich_project_runtime_preflight_proxy_topology(
                        &config,
                        &dashboard.config,
                        &project,
                        &launch_options,
                        &mut response,
                    )?;
                }
                Err(error) => {
                    crate::runtime_preflight::mark_bound_proxy_preflight_unavailable(
                        &mut response,
                        format!("读取工作区代理状态失败: {error}"),
                    );
                }
            }
        }
        Ok(response)
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
    command: Option<String>,
    expected_port: Option<u16>,
    env_overrides: Option<BTreeMap<String, String>>,
) -> Result<core_runtime::ProjectRuntimeContextSnapshot, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let workspace = load_active_project_workspace(&paths).map_err(|error| error.to_string())?;
        let source = resolve_workspace_capability_source(&paths, &workspace, "runtime")?;
        let project_instance = workspace
            .project_instances
            .iter()
            .find(|instance| instance.project == project)
            .map(|instance| (instance.path.display().to_string(), instance.managed));
        let config = config_state.load()?;
        let config = apply_workspace_context(&config, &workspace, &paths)?;
        let mut snapshot = core_runtime::project_runtime_context_snapshot(
            &config,
            &project,
            &core_runtime::ProjectRuntimeLaunchOptions {
                debug_profile: optional_editor_string(debug_profile),
                runtime_profile: optional_editor_string(runtime_profile),
                command: optional_editor_string(command),
                expected_port,
                env: normalize_runtime_env_overrides(env_overrides),
            },
        )?;
        let runtime_config_path = source.files.runtime_overrides.clone();
        let runtime_profile_scope = if source.is_default {
            "global"
        } else if runtime_config_path
            .as_deref()
            .is_some_and(|path| std::path::Path::new(path).exists())
        {
            "workspaceOverride"
        } else {
            "inherited"
        };
        let workspace_key = workspace.key.clone();
        let workspace_name = workspace.name.clone();
        let workspace_system = workspace.is_system();
        if project_instance.is_some()
            && let Some(target) = snapshot.effective.target.as_mut()
        {
            target.cwd_source = format!("workspaceProjectInstance.{}", target.cwd_source);
        }
        snapshot.workspace = Some(core_runtime::ProjectRuntimeWorkspaceContext {
            key: workspace_key,
            name: workspace_name,
            system: workspace_system,
            project_instance_path: project_instance.as_ref().map(|(path, _)| path.clone()),
            project_instance_managed: project_instance
                .as_ref()
                .is_some_and(|(_, managed)| *managed),
            runtime_config_source_id: source.id,
            runtime_config_source_name: source.name,
            runtime_config_source_kind: source.kind,
            runtime_config_path,
            runtime_profile_scope: runtime_profile_scope.to_string(),
        });
        Ok(snapshot)
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
