use std::sync::atomic::{AtomicU64, Ordering};

use rdevtool_core::pinned_actions::{
    TrayPinnedActionsMutation, TrayReplayAction, list_tray_pinned_actions,
    remove_tray_pinned_actions as core_remove_tray_pinned_actions, replace_tray_pinned_actions,
    upsert_tray_pinned_action as core_upsert_tray_pinned_action,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::{
    AppConfigState, AppState, WorkspacePinnedActionsPatch, schedule_tray_menu_refresh,
    unix_time_ms, workspace_pinned_actions_patches,
};

pub(crate) const TRAY_PINNED_ACTIONS_CHANGED_EVENT: &str = "rdevtool://tray-pinned-actions-changed";

static TRAY_PINNED_ACTIONS_REVISION: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrayPinnedActionsSnapshot {
    revision: u64,
    actions: Vec<TrayReplayAction>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrayPinnedActionsChangedPayload {
    revision: u64,
    mutation: String,
    dedupe_keys: Vec<String>,
    actions: Vec<TrayReplayAction>,
    workspace_patches: Vec<WorkspacePinnedActionsPatch>,
    requires_overview_refresh: bool,
}

fn current_snapshot(actions: Vec<TrayReplayAction>) -> TrayPinnedActionsSnapshot {
    TrayPinnedActionsSnapshot {
        revision: TRAY_PINNED_ACTIONS_REVISION.load(Ordering::Acquire),
        actions,
    }
}

fn finish_mutation(
    app: &AppHandle,
    refresh_revision: std::sync::Arc<AtomicU64>,
    mutation_key: &str,
    mutation: TrayPinnedActionsMutation,
    workspace_patches: Result<Vec<WorkspacePinnedActionsPatch>, String>,
) -> TrayPinnedActionsSnapshot {
    if !mutation.changed {
        return current_snapshot(mutation.actions);
    }
    let revision = TRAY_PINNED_ACTIONS_REVISION.fetch_add(1, Ordering::AcqRel) + 1;
    let snapshot = TrayPinnedActionsSnapshot {
        revision,
        actions: mutation.actions,
    };
    let payload = TrayPinnedActionsChangedPayload {
        revision,
        mutation: mutation_key.to_string(),
        dedupe_keys: mutation.dedupe_keys,
        actions: snapshot.actions.clone(),
        workspace_patches: workspace_patches.as_ref().cloned().unwrap_or_default(),
        requires_overview_refresh: workspace_patches.is_err(),
    };
    if let Err(error) = workspace_patches {
        eprintln!("[tray-pinned-actions] failed to build workspace patches: {error}");
    }
    if let Err(error) = app.emit(TRAY_PINNED_ACTIONS_CHANGED_EVENT, payload) {
        eprintln!("[tray-pinned-actions] failed to emit change: {error}");
    }
    schedule_tray_menu_refresh(app.clone(), refresh_revision);
    snapshot
}

fn build_workspace_patches(
    config_state: &AppConfigState,
    storage: &rdevtool_core::storage::Storage,
    mutation: &TrayPinnedActionsMutation,
) -> Result<Vec<WorkspacePinnedActionsPatch>, String> {
    if !mutation.changed {
        return Ok(Vec::new());
    }
    let config = config_state.load()?;
    workspace_pinned_actions_patches(&config, storage, &mutation.actions)
}

#[tauri::command]
pub(crate) async fn get_tray_pinned_actions(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<TrayReplayAction>, String> {
    let storage = state.storage.clone();
    tauri::async_runtime::spawn_blocking(move || list_tray_pinned_actions(&storage))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn get_tray_pinned_actions_snapshot(
    state: tauri::State<'_, AppState>,
) -> Result<TrayPinnedActionsSnapshot, String> {
    let storage = state.storage.clone();
    let actions = tauri::async_runtime::spawn_blocking(move || list_tray_pinned_actions(&storage))
        .await
        .map_err(|error| error.to_string())??;
    Ok(current_snapshot(actions))
}

#[tauri::command]
pub(crate) async fn set_tray_pinned_actions(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    actions: Vec<TrayReplayAction>,
) -> Result<(), String> {
    let storage = state.storage.clone();
    let config_state = state.config_state.clone();
    let refresh_revision = state.tray_menu_refresh_revision.clone();
    let (mutation, workspace_patches) = tauri::async_runtime::spawn_blocking(move || {
        let mutation = replace_tray_pinned_actions(&storage, actions, unix_time_ms())?;
        let workspace_patches = build_workspace_patches(&config_state, &storage, &mutation);
        Ok::<_, String>((mutation, workspace_patches))
    })
    .await
    .map_err(|error| error.to_string())??;
    finish_mutation(
        &app,
        refresh_revision,
        "replace",
        mutation,
        workspace_patches,
    );
    Ok(())
}

#[tauri::command]
pub(crate) async fn upsert_tray_pinned_action(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    action: TrayReplayAction,
) -> Result<TrayPinnedActionsSnapshot, String> {
    let storage = state.storage.clone();
    let config_state = state.config_state.clone();
    let refresh_revision = state.tray_menu_refresh_revision.clone();
    let (mutation, workspace_patches) = tauri::async_runtime::spawn_blocking(move || {
        let mutation = core_upsert_tray_pinned_action(&storage, action, unix_time_ms())?;
        let workspace_patches = build_workspace_patches(&config_state, &storage, &mutation);
        Ok::<_, String>((mutation, workspace_patches))
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(finish_mutation(
        &app,
        refresh_revision,
        "upsert",
        mutation,
        workspace_patches,
    ))
}

#[tauri::command]
pub(crate) async fn remove_tray_pinned_actions(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    dedupe_keys: Vec<String>,
) -> Result<TrayPinnedActionsSnapshot, String> {
    let storage = state.storage.clone();
    let config_state = state.config_state.clone();
    let refresh_revision = state.tray_menu_refresh_revision.clone();
    let (mutation, workspace_patches) = tauri::async_runtime::spawn_blocking(move || {
        let mutation = core_remove_tray_pinned_actions(&storage, dedupe_keys, unix_time_ms())?;
        let workspace_patches = build_workspace_patches(&config_state, &storage, &mutation);
        Ok::<_, String>((mutation, workspace_patches))
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(finish_mutation(
        &app,
        refresh_revision,
        "remove",
        mutation,
        workspace_patches,
    ))
}
