use rdevtool_core::config::{
    apply_project_workspace_context, ensure_default_configs, load_project_workspace_by_key,
};
use rdevtool_core::operation::{OperationEventOrigin, OperationEventState, operation_event_id};
use rdevtool_core::workspace_lifecycle::{
    WorkspaceArchiveBlocker, WorkspaceArchivePlan,
    archive_project_workspace as core_archive_project_workspace,
    plan_project_workspace_archive as core_plan_project_workspace_archive,
    restore_project_workspace as core_restore_project_workspace,
};
use tauri::{AppHandle, Emitter};

use crate::{
    AppState, ProjectWorkspaceState, WORKSPACE_STATE_CHANGED_EVENT, WorkspaceStateChangedPayload,
    project_workspace_state, record_lifecycle_operation_event, refresh_tray_menu, unix_time_ms,
};

#[tauri::command]
pub(crate) async fn plan_project_workspace_archive(
    state: tauri::State<'_, AppState>,
    workspace_key: String,
) -> Result<WorkspaceArchivePlan, String> {
    let config_state = state.config_state.clone();
    let runtime = state.project_runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let config = config_state.load()?;
        let mut plan = core_plan_project_workspace_archive(&paths, &config, &workspace_key)
            .map_err(|error| error.to_string())?;
        append_app_runtime_blockers(&runtime, &paths, &config, &workspace_key, &mut plan)?;
        Ok(plan)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn archive_project_workspace(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    workspace_key: String,
    reason: Option<String>,
    stop_running: bool,
) -> Result<ProjectWorkspaceState, String> {
    let config_state = state.config_state.clone();
    let runtime = state.project_runtime.clone();
    let storage = state.storage.clone();
    let changed_workspace_key = workspace_key.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let config = config_state.load()?;
        let mut plan = core_plan_project_workspace_archive(&paths, &config, &workspace_key)
            .map_err(|error| error.to_string())?;
        append_app_runtime_blockers(&runtime, &paths, &config, &workspace_key, &mut plan)?;
        stop_or_reject_app_runtime_blockers(
            &runtime,
            &paths,
            &config,
            &workspace_key,
            &plan,
            stop_running,
        )?;

        let lifecycle =
            core_archive_project_workspace(&paths, &config, &workspace_key, reason, stop_running)
                .map_err(|error| error.to_string())?;
        let summary = if lifecycle.changed {
            format!("已归档工作区：{}", lifecycle.workspace.name)
        } else {
            format!("工作区已归档：{}", lifecycle.workspace.name)
        };
        record_lifecycle_operation_event(
            &storage,
            operation_event_id(None, OperationEventOrigin::App, "workspace-archive"),
            OperationEventOrigin::App,
            &lifecycle.workspace.key,
            "workspace",
            "archive",
            OperationEventState::Success,
            "归档工作区",
            &summary,
            "",
            None,
            None,
            serde_json::to_value(&lifecycle).ok(),
        );
        project_workspace_state(&config)
    })
    .await
    .map_err(|error| error.to_string())?;

    if result.is_ok() {
        notify_workspace_lifecycle_changed(&app, changed_workspace_key);
    }
    result
}

#[tauri::command]
pub(crate) async fn restore_project_workspace(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    workspace_key: String,
) -> Result<ProjectWorkspaceState, String> {
    let config_state = state.config_state.clone();
    let storage = state.storage.clone();
    let changed_workspace_key = workspace_key.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let paths = ensure_default_configs().map_err(|error| error.to_string())?;
        let config = config_state.load()?;
        let lifecycle = core_restore_project_workspace(&paths, &workspace_key)
            .map_err(|error| error.to_string())?;
        let summary = if lifecycle.changed {
            format!("已恢复工作区：{}", lifecycle.workspace.name)
        } else {
            format!("工作区未归档：{}", lifecycle.workspace.name)
        };
        record_lifecycle_operation_event(
            &storage,
            operation_event_id(None, OperationEventOrigin::App, "workspace-restore"),
            OperationEventOrigin::App,
            &lifecycle.workspace.key,
            "workspace",
            "restore",
            OperationEventState::Success,
            "恢复工作区",
            &summary,
            "",
            None,
            None,
            serde_json::to_value(&lifecycle).ok(),
        );
        project_workspace_state(&config)
    })
    .await
    .map_err(|error| error.to_string())?;

    if result.is_ok() {
        notify_workspace_lifecycle_changed(&app, changed_workspace_key);
    }
    result
}

fn append_app_runtime_blockers(
    runtime: &crate::project_runtime::ProjectRuntimeState,
    paths: &rdevtool_core::config::ConfigPaths,
    config: &rdevtool_core::config::AppConfig,
    workspace_key: &str,
    plan: &mut WorkspaceArchivePlan,
) -> Result<(), String> {
    let workspace = load_project_workspace_by_key(&paths.project_workspaces, workspace_key)
        .map_err(|error| error.to_string())?;
    if workspace.is_archived() {
        return Ok(());
    }
    let effective_config = apply_project_workspace_context(config, &workspace);
    for snapshot in runtime.list(&effective_config)? {
        if snapshot.build_pid.is_some() {
            plan.blockers.push(WorkspaceArchiveBlocker {
                kind: "build".to_string(),
                id: snapshot.key.clone(),
                label: format!("本地打包：{}", snapshot.name),
                managed: true,
                detail: snapshot.build_detail,
            });
        }
        if snapshot.status_key == "external" {
            plan.blockers.push(WorkspaceArchiveBlocker {
                kind: "runtime".to_string(),
                id: format!("external:{}", snapshot.key),
                label: format!("外部运行进程：{}", snapshot.name),
                managed: false,
                detail: snapshot.detail,
            });
        }
    }
    dedupe_blockers(&mut plan.blockers);
    plan.can_archive = plan.blockers.is_empty();
    Ok(())
}

fn stop_or_reject_app_runtime_blockers(
    runtime: &crate::project_runtime::ProjectRuntimeState,
    paths: &rdevtool_core::config::ConfigPaths,
    config: &rdevtool_core::config::AppConfig,
    workspace_key: &str,
    plan: &WorkspaceArchivePlan,
    stop_running: bool,
) -> Result<(), String> {
    if plan.blockers.is_empty() {
        return Ok(());
    }
    if !stop_running {
        return Err(format!(
            "工作区仍有 {} 个运行项，请停止后归档，或选择“停止并归档”",
            plan.blockers.len()
        ));
    }
    if let Some(blocker) = plan.blockers.iter().find(|blocker| !blocker.managed) {
        return Err(format!(
            "{}不是 rDevTool 受管进程，请先处理后再归档",
            blocker.label
        ));
    }

    let workspace = load_project_workspace_by_key(&paths.project_workspaces, workspace_key)
        .map_err(|error| error.to_string())?;
    let effective_config = apply_project_workspace_context(config, &workspace);
    for blocker in plan
        .blockers
        .iter()
        .filter(|blocker| blocker.kind == "build")
    {
        runtime.stop_build(&effective_config, &blocker.id)?;
    }
    Ok(())
}

fn dedupe_blockers(blockers: &mut Vec<WorkspaceArchiveBlocker>) {
    blockers.sort_by(|left, right| {
        left.kind
            .cmp(&right.kind)
            .then_with(|| left.id.cmp(&right.id))
    });
    blockers.dedup_by(|left, right| left.kind == right.kind && left.id == right.id);
}

fn notify_workspace_lifecycle_changed(app: &AppHandle, workspace_key: String) {
    let _ = app.emit(
        WORKSPACE_STATE_CHANGED_EVENT,
        WorkspaceStateChangedPayload {
            revision: unix_time_ms(),
            origin: "internal".to_string(),
            scopes: vec!["workspace".to_string(), "projectWorkspaces".to_string()],
            project_workspace_keys: vec![workspace_key],
            project_workspaces_unknown: false,
        },
    );
    refresh_tray_menu(app);
}
