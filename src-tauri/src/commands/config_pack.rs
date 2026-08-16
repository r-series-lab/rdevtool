use std::path::Path;

use rdevtool_core::config_pack::{
    ConfigPackApplyResult, ConfigPackExportRequest, ConfigPackExportResult, ConfigPackImportPlan,
    ConfigPackImportRequest, ConfigPackInspection, ConfigPackInventory, ConfigPackRollbackResult,
    ConfigPackTransactionHistory, apply_config_pack_import, config_pack_inventory,
    export_config_pack, inspect_config_pack, list_config_pack_import_transactions,
    plan_config_pack_import, rollback_config_pack_import,
};
use tauri::{AppHandle, Emitter};

use crate::{AppState, WORKSPACE_STATE_CHANGED_EVENT, WorkspaceStateChangedPayload, unix_time_ms};

#[tauri::command]
pub(crate) async fn get_config_pack_inventory() -> Result<ConfigPackInventory, String> {
    tauri::async_runtime::spawn_blocking(|| {
        config_pack_inventory().map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn export_config_pack_file(
    request: ConfigPackExportRequest,
) -> Result<ConfigPackExportResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        export_config_pack(request).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn inspect_config_pack_file(path: String) -> Result<ConfigPackInspection, String> {
    tauri::async_runtime::spawn_blocking(move || {
        inspect_config_pack(Path::new(&path)).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn plan_config_pack_import_file(
    request: ConfigPackImportRequest,
) -> Result<ConfigPackImportPlan, String> {
    tauri::async_runtime::spawn_blocking(move || {
        plan_config_pack_import(request).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn apply_config_pack_import_plan(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    plan_hash: String,
) -> Result<ConfigPackApplyResult, String> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        apply_config_pack_import(&plan_hash).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    state.config_state.invalidate()?;
    emit_configuration_changed(&app, "config-pack-import")?;
    Ok(result)
}

#[tauri::command]
pub(crate) async fn list_config_pack_import_history() -> Result<ConfigPackTransactionHistory, String>
{
    tauri::async_runtime::spawn_blocking(|| {
        list_config_pack_import_transactions().map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn rollback_config_pack_import_transaction(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    transaction_id: String,
) -> Result<ConfigPackRollbackResult, String> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        rollback_config_pack_import(&transaction_id).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    state.config_state.invalidate()?;
    emit_configuration_changed(&app, "config-pack-rollback")?;
    Ok(result)
}

fn emit_configuration_changed(app: &AppHandle, origin: &str) -> Result<(), String> {
    app.emit(
        WORKSPACE_STATE_CHANGED_EVENT,
        WorkspaceStateChangedPayload {
            revision: unix_time_ms(),
            origin: origin.to_string(),
            scopes: vec![
                "projects".to_string(),
                "workspace".to_string(),
                "config-sources".to_string(),
            ],
            project_workspace_keys: Vec::new(),
            project_workspaces_unknown: true,
        },
    )
    .map_err(|error| error.to_string())
}
