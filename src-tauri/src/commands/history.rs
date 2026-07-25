use rdevtool_core::operation::OperationEvent;
use rdevtool_core::storage::{
    BuildHistoryEntry, DeployHistoryEntry, MergeHistoryEntry, SaveBuildHistoryRequest,
    SaveDeployHistoryRequest, SaveMergeHistoryRequest,
};

use crate::{
    AppState, clear_build_history_by_active_workspace,
    clear_deploy_history_by_active_workspace, clear_merge_history_by_active_workspace,
    filter_build_history_by_active_workspace, filter_deploy_history_by_active_workspace,
    filter_merge_history_by_active_workspace, filter_operation_events_by_active_workspace,
    history_scope_for_save, merge_history_worklog_event, record_workspace_operation,
    save_build_history_record,
};

#[tauri::command]
pub(crate) async fn list_build_history(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<BuildHistoryEntry>, String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || filter_build_history_by_active_workspace(&storage))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn save_build_history(
    state: tauri::State<'_, AppState>,
    mut request: SaveBuildHistoryRequest,
) -> Result<(), String> {
    let requested_workspace_key = request.workspace_key.clone();
    let (workspace_key, project_instance_path) = history_scope_for_save(
        &request.project_key,
        requested_workspace_key.as_deref(),
    )?;
    request.workspace_key = Some(workspace_key);
    request.project_instance_path = project_instance_path.or(request.project_instance_path);
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || save_build_history_record(&storage, request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn clear_build_history(
    state: tauri::State<'_, AppState>,
) -> Result<usize, String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || clear_build_history_by_active_workspace(&storage))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn list_deploy_history(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DeployHistoryEntry>, String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || {
        filter_deploy_history_by_active_workspace(&storage)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn save_deploy_history(
    state: tauri::State<'_, AppState>,
    mut request: SaveDeployHistoryRequest,
) -> Result<(), String> {
    let requested_workspace_key = request.workspace_key.clone();
    let (workspace_key, project_instance_path) = history_scope_for_save(
        &request.project_key,
        requested_workspace_key.as_deref(),
    )?;
    request.workspace_key = Some(workspace_key);
    request.project_instance_path = project_instance_path.or(request.project_instance_path);
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || save_build_history_record(&storage, request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn clear_deploy_history(
    state: tauri::State<'_, AppState>,
) -> Result<usize, String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || clear_deploy_history_by_active_workspace(&storage))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn list_merge_history(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<MergeHistoryEntry>, String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || filter_merge_history_by_active_workspace(&storage))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn list_operation_event_history(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<OperationEvent>, String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || {
        filter_operation_events_by_active_workspace(&storage)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn save_merge_history(
    state: tauri::State<'_, AppState>,
    mut request: SaveMergeHistoryRequest,
) -> Result<(), String> {
    let requested_workspace_key = request.workspace_key.clone();
    let (workspace_key, project_instance_path) = history_scope_for_save(
        &request.project_key,
        requested_workspace_key.as_deref(),
    )?;
    request.workspace_key = Some(workspace_key);
    request.project_instance_path = project_instance_path.or(request.project_instance_path);
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let event = merge_history_worklog_event(&request);
        let workspace_key = request.workspace_key.clone().unwrap_or_default();
        storage.save_merge_history(request)?;
        record_workspace_operation(&workspace_key, event);
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn clear_merge_history(
    state: tauri::State<'_, AppState>,
) -> Result<usize, String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || clear_merge_history_by_active_workspace(&storage))
        .await
        .map_err(|error| error.to_string())?
}
