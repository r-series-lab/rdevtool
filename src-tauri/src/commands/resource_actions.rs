use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{
    Arc, LazyLock, Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use std::time::{SystemTime, UNIX_EPOCH};

use rdevtool_core::cli_locator::resolve_rdevtool_cli;
use rdevtool_core::config::{
    active_project_workspace_key, default_projects_path, default_workspace_path,
    load_workspace_config,
};
use rdevtool_core::operation::OperationEventOrigin;
use rdevtool_core::resource_actions::{
    ResourceActionApplyRequest, ResourceActionCatalog, ResourceActionExecutionContext,
    ResourceActionPlan, ResourceActionProgressReporter, ResourceActionRunRequest,
    ResourceActionRunResult, ResourceActionView,
    apply_resource_action_plan_from_path_with_context as core_apply_resource_action_plan,
    get_resource_action_plan as core_get_resource_action_plan,
    plan_resource_action_from_path_with_context as core_plan_resource_action,
    resource_action_catalog_from_path as core_resource_action_catalog_from_path,
    resource_action_view_from_path_with_context as core_resource_action_view_from_path,
    run_resource_action_from_path_with_context as core_run_resource_action_from_path,
};
use rdevtool_core::storage::Storage;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::{
    AppState, active_sessions::notify_active_sessions_changed, apply_active_workspace_context,
    core_resolve_config_source, load_config_source_workspaces,
};

pub(crate) const RESOURCE_ACTION_PROGRESS_EVENT: &str = "rdevtool://resource-action-progress";
const MAX_RUNNING_ACTION_LOG_CHARS: usize = 16 * 1024;

static RUNNING_RESOURCE_ACTIONS: LazyLock<Mutex<BTreeMap<String, RunningResourceAction>>> =
    LazyLock::new(|| Mutex::new(BTreeMap::new()));
static RESOURCE_ACTION_OPERATION_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct ResourceActionRegistration {
    operation_id: String,
    cancellation_flag: Arc<AtomicBool>,
    on_finished: Option<Arc<dyn Fn() + Send + Sync>>,
}

struct RunningResourceAction {
    cancellation_flag: Arc<AtomicBool>,
    phase: String,
    action_key: String,
    action_name: String,
    workspace_key: String,
    started_at_ms: u64,
    log_tail: String,
    output_suppressed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunningResourceActionSnapshot {
    operation_id: String,
    phase: String,
    action_key: String,
    action_name: String,
    workspace_key: String,
    started_at_ms: u64,
    cancellation_requested: bool,
    log_tail: String,
    output_suppressed: bool,
}

impl Drop for ResourceActionRegistration {
    fn drop(&mut self) {
        let Ok(mut running) = RUNNING_RESOURCE_ACTIONS.lock() else {
            return;
        };
        let removed = if running
            .get(&self.operation_id)
            .is_some_and(|entry| Arc::ptr_eq(&entry.cancellation_flag, &self.cancellation_flag))
        {
            running.remove(&self.operation_id);
            true
        } else {
            false
        };
        drop(running);
        if removed {
            if let Some(on_finished) = &self.on_finished {
                on_finished();
            }
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CancelResourceActionResponse {
    operation_id: String,
    accepted: bool,
}

fn resource_actions_path(source_id: Option<&str>) -> Result<PathBuf, String> {
    let workspaces = load_config_source_workspaces()?;
    let source =
        core_resolve_config_source(source_id, &workspaces).map_err(|error| error.to_string())?;
    Ok(PathBuf::from(source.files.actions))
}

#[tauri::command]
pub(crate) async fn plan_resource_action(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    source_id: Option<String>,
    action_name: Option<String>,
    mut request: ResourceActionRunRequest,
) -> Result<ResourceActionPlan, String> {
    let config_state = state.config_state.clone();
    let operation_storage = state.storage.clone();
    let operation_id = ensure_request_operation_id(&mut request.operation_id);
    let workspace_key = current_resource_action_workspace_key();
    let (cancellation_flag, registration) = register_resource_action(
        &operation_id,
        "plan",
        &request.key,
        resource_action_display_name(action_name.as_deref(), &request.key),
        &workspace_key,
        Some(resource_action_finished_notifier(
            app.clone(),
            workspace_key.clone(),
        )),
    )?;
    notify_active_sessions_changed(&app, &workspace_key, "action", "start");
    tauri::async_runtime::spawn_blocking(move || {
        let _registration = registration;
        let path = resource_actions_path(source_id.as_deref())?;
        let config = apply_active_workspace_context(&config_state.load()?)?;
        let execution_context = resource_action_execution_context(
            Some(operation_storage),
            Some(cancellation_flag),
            Some(resource_action_progress_reporter(
                app,
                workspace_key.clone(),
            )),
            Some(workspace_key),
        );
        core_plan_resource_action(&path, request, &config, &execution_context)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn get_resource_action_plan(
    plan_id: String,
) -> Result<ResourceActionPlan, String> {
    tauri::async_runtime::spawn_blocking(move || {
        core_get_resource_action_plan(&plan_id).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn apply_resource_action_plan(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    source_id: Option<String>,
    action_name: Option<String>,
    mut request: ResourceActionApplyRequest,
) -> Result<ResourceActionRunResult, String> {
    let config_state = state.config_state.clone();
    let operation_storage = state.storage.clone();
    let operation_id = ensure_request_operation_id(&mut request.operation_id);
    let workspace_key = current_resource_action_workspace_key();
    let (cancellation_flag, registration) = register_resource_action(
        &operation_id,
        "apply",
        &request.plan_id,
        resource_action_display_name(action_name.as_deref(), "按计划执行 Action"),
        &workspace_key,
        Some(resource_action_finished_notifier(
            app.clone(),
            workspace_key.clone(),
        )),
    )?;
    notify_active_sessions_changed(&app, &workspace_key, "action", "start");
    tauri::async_runtime::spawn_blocking(move || {
        let _registration = registration;
        let path = resource_actions_path(source_id.as_deref())?;
        let config = apply_active_workspace_context(&config_state.load()?)?;
        let execution_context = resource_action_execution_context(
            Some(operation_storage),
            Some(cancellation_flag),
            Some(resource_action_progress_reporter(
                app,
                workspace_key.clone(),
            )),
            Some(workspace_key),
        );
        core_apply_resource_action_plan(&path, request, &config, &execution_context)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn resource_action_execution_context(
    operation_storage: Option<Storage>,
    cancellation_flag: Option<Arc<AtomicBool>>,
    progress_reporter: Option<ResourceActionProgressReporter>,
    workspace_key: Option<String>,
) -> ResourceActionExecutionContext {
    let (rdevtool_cli_path, rdevtool_cli_error) = match resolve_rdevtool_cli() {
        Ok(cli) => (Some(cli.path), None),
        Err(error) => (None, Some(error.to_string())),
    };
    ResourceActionExecutionContext {
        rdevtool_cli_path,
        rdevtool_cli_error,
        config_path: Some(default_projects_path()),
        workspace_key,
        operation_origin: operation_storage
            .as_ref()
            .map(|_| OperationEventOrigin::App),
        operation_storage,
        cancellation_flag,
        progress_reporter,
    }
}

fn current_resource_action_workspace_key() -> String {
    load_workspace_config(&default_workspace_path())
        .ok()
        .map(|workspace| active_project_workspace_key(&workspace))
        .unwrap_or_else(|| "system".to_string())
}

fn ensure_request_operation_id(operation_id: &mut Option<String>) -> String {
    let resolved = operation_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_millis())
                .unwrap_or_default();
            let sequence = RESOURCE_ACTION_OPERATION_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            format!("action-app-{timestamp}-{sequence}")
        });
    *operation_id = Some(resolved.clone());
    resolved
}

fn resource_action_display_name<'a>(name: Option<&'a str>, fallback: &'a str) -> &'a str {
    name.map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
}

fn register_resource_action(
    operation_id: &str,
    phase: &str,
    action_key: &str,
    action_name: &str,
    workspace_key: &str,
    on_finished: Option<Arc<dyn Fn() + Send + Sync>>,
) -> Result<(Arc<AtomicBool>, ResourceActionRegistration), String> {
    let cancellation_flag = Arc::new(AtomicBool::new(false));
    let mut running = RUNNING_RESOURCE_ACTIONS
        .lock()
        .map_err(|_| "resource Action registry is unavailable".to_string())?;
    if running.contains_key(operation_id) {
        return Err(format!(
            "resource Action operation is already running: {operation_id}"
        ));
    }
    running.insert(
        operation_id.to_string(),
        RunningResourceAction {
            cancellation_flag: cancellation_flag.clone(),
            phase: phase.to_string(),
            action_key: action_key.to_string(),
            action_name: action_name.to_string(),
            workspace_key: workspace_key.to_string(),
            started_at_ms: unix_time_ms(),
            log_tail: String::new(),
            output_suppressed: false,
        },
    );
    Ok((
        cancellation_flag.clone(),
        ResourceActionRegistration {
            operation_id: operation_id.to_string(),
            cancellation_flag,
            on_finished,
        },
    ))
}

fn resource_action_progress_reporter(
    app: AppHandle,
    workspace_key: String,
) -> ResourceActionProgressReporter {
    ResourceActionProgressReporter::new(move |event| {
        record_resource_action_progress(&event);
        let _ = app.emit(RESOURCE_ACTION_PROGRESS_EVENT, event);
        notify_active_sessions_changed(&app, &workspace_key, "action", "progress");
    })
}

fn record_resource_action_progress(
    event: &rdevtool_core::resource_actions::ResourceActionProgressEvent,
) {
    let Ok(mut running) = RUNNING_RESOURCE_ACTIONS.lock() else {
        return;
    };
    let Some(entry) = running.get_mut(&event.operation_id) else {
        return;
    };
    if event.output_suppressed {
        entry.output_suppressed = true;
        return;
    }
    entry.log_tail.push_str(&event.chunk);
    if entry.log_tail.len() > MAX_RUNNING_ACTION_LOG_CHARS {
        let mut start = entry.log_tail.len() - MAX_RUNNING_ACTION_LOG_CHARS;
        while start < entry.log_tail.len() && !entry.log_tail.is_char_boundary(start) {
            start += 1;
        }
        entry.log_tail = entry.log_tail[start..].to_string();
    }
}

fn resource_action_finished_notifier(
    app: AppHandle,
    workspace_key: String,
) -> Arc<dyn Fn() + Send + Sync> {
    Arc::new(move || {
        notify_active_sessions_changed(&app, &workspace_key, "action", "stop");
    })
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

#[tauri::command]
pub(crate) fn list_running_resource_actions() -> Result<Vec<RunningResourceActionSnapshot>, String>
{
    let running = RUNNING_RESOURCE_ACTIONS
        .lock()
        .map_err(|_| "resource Action registry is unavailable".to_string())?;
    let mut snapshots = running
        .iter()
        .map(|(operation_id, entry)| RunningResourceActionSnapshot {
            operation_id: operation_id.clone(),
            phase: entry.phase.clone(),
            action_key: entry.action_key.clone(),
            action_name: entry.action_name.clone(),
            workspace_key: entry.workspace_key.clone(),
            started_at_ms: entry.started_at_ms,
            cancellation_requested: entry.cancellation_flag.load(Ordering::SeqCst),
            log_tail: entry.log_tail.clone(),
            output_suppressed: entry.output_suppressed,
        })
        .collect::<Vec<_>>();
    snapshots.sort_by_key(|snapshot| snapshot.started_at_ms);
    Ok(snapshots)
}

#[tauri::command]
pub(crate) fn cancel_resource_action(
    app: AppHandle,
    operation_id: String,
) -> Result<CancelResourceActionResponse, String> {
    let operation_id = operation_id.trim().to_string();
    if operation_id.is_empty() {
        return Err("resource Action operation id is required".to_string());
    }
    let workspace_key = {
        let running = RUNNING_RESOURCE_ACTIONS
            .lock()
            .map_err(|_| "resource Action registry is unavailable".to_string())?;
        running.get(&operation_id).map(|entry| {
            entry.cancellation_flag.store(true, Ordering::SeqCst);
            entry.workspace_key.clone()
        })
    };
    let accepted = workspace_key.is_some();
    if let Some(workspace_key) = workspace_key {
        notify_active_sessions_changed(&app, &workspace_key, "action", "cancel");
    }
    Ok(CancelResourceActionResponse {
        operation_id,
        accepted,
    })
}

#[tauri::command]
pub(crate) async fn list_resource_actions(
    source_id: Option<String>,
) -> Result<ResourceActionCatalog, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = resource_actions_path(source_id.as_deref())?;
        core_resource_action_catalog_from_path(&path).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn get_resource_action(
    state: tauri::State<'_, AppState>,
    source_id: Option<String>,
    key: String,
) -> Result<ResourceActionView, String> {
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = resource_actions_path(source_id.as_deref())?;
        let config = apply_active_workspace_context(&config_state.load()?)?;
        let execution_context = resource_action_execution_context(None, None, None, None);
        core_resource_action_view_from_path(&path, &key, &config, &execution_context)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn run_resource_action(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    source_id: Option<String>,
    action_name: Option<String>,
    mut request: ResourceActionRunRequest,
) -> Result<ResourceActionRunResult, String> {
    let config_state = state.config_state.clone();
    let operation_storage = state.storage.clone();
    let operation_id = ensure_request_operation_id(&mut request.operation_id);
    let workspace_key = current_resource_action_workspace_key();
    let (cancellation_flag, registration) = register_resource_action(
        &operation_id,
        "run",
        &request.key,
        resource_action_display_name(action_name.as_deref(), &request.key),
        &workspace_key,
        Some(resource_action_finished_notifier(
            app.clone(),
            workspace_key.clone(),
        )),
    )?;
    notify_active_sessions_changed(&app, &workspace_key, "action", "start");
    tauri::async_runtime::spawn_blocking(move || {
        let _registration = registration;
        let path = resource_actions_path(source_id.as_deref())?;
        let config = apply_active_workspace_context(&config_state.load()?)?;
        let execution_context = resource_action_execution_context(
            Some(operation_storage),
            Some(cancellation_flag),
            Some(resource_action_progress_reporter(
                app,
                workspace_key.clone(),
            )),
            Some(workspace_key),
        );
        core_run_resource_action_from_path(&path, request, &config, &execution_context)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn running_action_registry_cancels_and_cleans_up_by_operation_id() {
        let operation_id = format!(
            "action-registry-test-{}",
            RESOURCE_ACTION_OPERATION_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        let (flag, registration) = register_resource_action(
            &operation_id,
            "run",
            "test-action",
            "Test Action",
            "test-workspace",
            None,
        )
        .expect("register resource Action");

        assert!(
            register_resource_action(
                &operation_id,
                "run",
                "test-action",
                "Test Action",
                "test-workspace",
                None,
            )
            .is_err()
        );
        let snapshot = list_running_resource_actions()
            .expect("list running Actions")
            .into_iter()
            .find(|snapshot| snapshot.operation_id == operation_id)
            .expect("registered Action snapshot");
        assert_eq!(snapshot.action_name, "Test Action");

        flag.store(true, Ordering::SeqCst);
        assert!(flag.load(Ordering::SeqCst));

        drop(registration);
        assert!(
            list_running_resource_actions()
                .expect("list completed Actions")
                .into_iter()
                .all(|snapshot| snapshot.operation_id != operation_id)
        );
    }
}
