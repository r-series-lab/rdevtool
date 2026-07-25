use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::config::ProjectWorkspaceConfig;
use crate::core::{BranchTaskResponse, BuildTriggerResponse, DeployRequest};
use crate::link::LinkExecutionReport;
use crate::storage::{SaveDeployHistoryRequest, Storage};

pub const OPERATION_EVENT_STORAGE_NAMESPACE: &str = "operation-events";
pub const OPERATION_EVENT_STORAGE_KEY: &str = "history";
pub const OPERATION_EVENT_HISTORY_LIMIT: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OperationEventOrigin {
    App,
    Cli,
    Tray,
}

impl OperationEventOrigin {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::App => "app",
            Self::Cli => "cli",
            Self::Tray => "tray",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OperationEventState {
    Running,
    Success,
    Failed,
    Info,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationEvent {
    pub version: u32,
    pub id: String,
    pub origin: OperationEventOrigin,
    pub workspace_key: String,
    pub domain: String,
    pub action: String,
    pub state: OperationEventState,
    pub title: String,
    pub summary: String,
    pub detail: String,
    pub project_key: Option<String>,
    pub project_name: Option<String>,
    #[serde(default)]
    pub related_history_keys: Vec<String>,
    pub payload: Option<Value>,
    pub created_at: String,
    pub updated_at: String,
}

pub fn operation_event_id(
    preferred_id: Option<&str>,
    origin: OperationEventOrigin,
    action: &str,
) -> String {
    preferred_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| {
            format!(
                "operation-{}-{}-{}",
                origin.as_str(),
                normalized_event_segment(action),
                Uuid::new_v4()
            )
        })
}

#[allow(clippy::too_many_arguments)]
pub fn branch_task_operation_event(
    id: String,
    origin: OperationEventOrigin,
    workspace_key: String,
    title: &str,
    action: &str,
    fallback_project_key: Option<&str>,
    response: Option<&BranchTaskResponse>,
    error: Option<&str>,
    related_history_keys: Vec<String>,
) -> OperationEvent {
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let item = response.and_then(|response| response.items.first());
    let success = response.is_some_and(|response| response.success);
    let summary = response
        .map(|response| response.summary.clone())
        .unwrap_or_else(|| format!("{title}失败"));
    let detail = response
        .map(|response| response.detail.clone())
        .or_else(|| error.map(ToOwned::to_owned))
        .unwrap_or_default();

    OperationEvent {
        version: 1,
        id,
        origin,
        workspace_key,
        domain: "git".to_string(),
        action: response
            .map(|response| response.task_kind.trim())
            .filter(|value| !value.is_empty())
            .unwrap_or(action)
            .to_string(),
        state: if success {
            OperationEventState::Success
        } else {
            OperationEventState::Failed
        },
        title: title.to_string(),
        summary,
        detail,
        project_key: item
            .map(|item| item.project_key.clone())
            .or_else(|| fallback_project_key.map(ToOwned::to_owned)),
        project_name: item.map(|item| item.project_name.clone()),
        related_history_keys,
        payload: response.and_then(|response| serde_json::to_value(response).ok()),
        created_at: now.clone(),
        updated_at: now,
    }
}

pub fn build_history_request(
    workspace: &ProjectWorkspaceConfig,
    result: &BuildTriggerResponse,
    fallback_history_key: &str,
) -> SaveDeployHistoryRequest {
    let params = &result.plan.params;
    SaveDeployHistoryRequest {
        history_key: result
            .queue_url
            .as_deref()
            .or(result.build_url.as_deref())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| fallback_history_key.to_string()),
        workspace_key: Some(workspace.key.clone()),
        project_instance_path: workspace
            .project_instance_path(&result.plan.project_key)
            .map(|path| path.display().to_string()),
        project_key: result.plan.project_key.clone(),
        project_name: result.plan.project_name.clone(),
        mode: result.plan.job_kind.clone(),
        env: params
            .get("ENV_PROFILE")
            .or_else(|| params.get("projectEnv"))
            .or_else(|| params.get("env"))
            .cloned(),
        branch: params
            .get("BRANCH")
            .or_else(|| params.get("branch"))
            .or_else(|| params.get("Branch"))
            .cloned(),
        state_key: result.state_key.clone(),
        state_label: result.state_label.clone(),
        detail: result.detail.clone(),
        queue_url: result.queue_url.clone(),
        build_url: result.build_url.clone(),
        params: serde_json::to_value(params).unwrap_or_else(|_| Value::Object(Default::default())),
    }
}

pub fn build_operation_event(
    id: String,
    origin: OperationEventOrigin,
    workspace_key: String,
    title: &str,
    action: &str,
    history: &SaveDeployHistoryRequest,
) -> OperationEvent {
    let now = event_timestamp();
    OperationEvent {
        version: 1,
        id,
        origin,
        workspace_key,
        domain: "build".to_string(),
        action: action.to_string(),
        state: build_operation_state(&history.state_key),
        title: title.to_string(),
        summary: build_operation_summary(&history.state_label, &history.detail),
        detail: history.detail.clone(),
        project_key: Some(history.project_key.clone()),
        project_name: Some(history.project_name.clone()),
        related_history_keys: vec![history.history_key.clone()],
        payload: serde_json::to_value(history).ok(),
        created_at: now.clone(),
        updated_at: now,
    }
}

#[allow(clippy::too_many_arguments)]
pub fn failed_build_operation_event(
    id: String,
    origin: OperationEventOrigin,
    workspace_key: String,
    title: &str,
    action: &str,
    project_name: Option<&str>,
    request: &DeployRequest,
    error: &str,
) -> OperationEvent {
    let project_key = request.project.trim();
    let project_name = project_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(project_key);
    let mode = request
        .target
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(action);
    let mut params = request.params.clone();
    params.extend(request.extra_params.clone());
    let payload = json!({
        "historyKey": id,
        "workspaceKey": workspace_key,
        "projectKey": project_key,
        "projectName": project_name,
        "mode": mode,
        "env": request.env,
        "branch": request.branch,
        "stateKey": "failed",
        "stateLabel": "失败",
        "detail": error,
        "queueUrl": null,
        "buildUrl": null,
        "params": params,
        "replayRequest": request,
    });
    lifecycle_operation_event(
        id,
        origin,
        workspace_key,
        "build",
        action,
        OperationEventState::Failed,
        title,
        &format!("{title}失败"),
        error,
        Some(project_key),
        Some(project_name),
        Some(payload),
    )
}

#[allow(clippy::too_many_arguments)]
pub fn lifecycle_operation_event(
    id: String,
    origin: OperationEventOrigin,
    workspace_key: String,
    domain: &str,
    action: &str,
    state: OperationEventState,
    title: &str,
    summary: &str,
    detail: &str,
    project_key: Option<&str>,
    project_name: Option<&str>,
    payload: Option<Value>,
) -> OperationEvent {
    let now = event_timestamp();
    OperationEvent {
        version: 1,
        id,
        origin,
        workspace_key,
        domain: domain.to_string(),
        action: action.to_string(),
        state,
        title: title.to_string(),
        summary: summary.to_string(),
        detail: detail.to_string(),
        project_key: project_key.map(ToOwned::to_owned),
        project_name: project_name.map(ToOwned::to_owned),
        related_history_keys: Vec::new(),
        payload,
        created_at: now.clone(),
        updated_at: now,
    }
}

pub fn link_operation_event(
    id: String,
    origin: OperationEventOrigin,
    workspace_key: String,
    action: &str,
    link_key: &str,
    source_id: Option<&str>,
    report: Option<&LinkExecutionReport>,
    error: Option<&str>,
) -> OperationEvent {
    let stopping = action.trim() == "stop";
    let action_label = if stopping { "停止" } else { "启动" };
    let title = format!("{action_label}联调链路");
    let Some(report) = report else {
        return lifecycle_operation_event(
            id,
            origin,
            workspace_key,
            "link",
            action,
            OperationEventState::Failed,
            &title,
            &format!("联调链路{action_label}失败"),
            error.unwrap_or_default(),
            None,
            None,
            Some(json!({
                "linkKey": link_key,
                "mode": action,
                "sourceId": source_id,
            })),
        );
    };

    let failed_steps = report
        .steps
        .iter()
        .filter(|step| step.status == "failed")
        .collect::<Vec<_>>();
    let skipped_count = report
        .steps
        .iter()
        .filter(|step| step.status == "skipped")
        .count();
    let completed_count = report
        .steps
        .len()
        .saturating_sub(failed_steps.len() + skipped_count);
    let state = if !failed_steps.is_empty() {
        OperationEventState::Failed
    } else if report.steps.is_empty() {
        OperationEventState::Info
    } else {
        OperationEventState::Success
    };
    let summary = format!(
        "{} · 完成 {} / 失败 {} / 跳过 {}",
        report.name,
        completed_count,
        failed_steps.len(),
        skipped_count
    );
    let mut detail_lines = failed_steps
        .iter()
        .map(|step| format!("{}：{}", step.label, step.summary))
        .collect::<Vec<_>>();
    detail_lines.extend(
        report
            .warnings
            .iter()
            .map(|warning| format!("警告：{warning}")),
    );
    let detail = if detail_lines.is_empty() {
        format!("联调链路已{action_label}")
    } else {
        detail_lines.join("\n")
    };
    let resolved_source_id = report
        .plan
        .source_context
        .as_ref()
        .map(|context| context.link_source_id.as_str())
        .or(source_id);
    let payload = json!({
        "linkKey": report.key,
        "linkName": report.name,
        "mode": report.mode,
        "sourceId": resolved_source_id,
        "stepCount": report.steps.len(),
        "completedCount": completed_count,
        "failedCount": failed_steps.len(),
        "skippedCount": skipped_count,
        "failedSteps": failed_steps.iter().map(|step| json!({
            "id": step.id,
            "type": step.step_type,
            "label": step.label,
            "summary": step.summary,
            "risks": step.risks,
        })).collect::<Vec<_>>(),
        "diagnosticSteps": report.steps.iter().map(|step| json!({
            "id": step.id,
            "type": step.step_type,
            "label": step.label,
            "status": step.status,
            "summary": step.summary,
            "risks": step.risks,
        })).collect::<Vec<_>>(),
        "warnings": report.warnings,
    });

    lifecycle_operation_event(
        id,
        origin,
        report.plan.workspace_key.clone().unwrap_or(workspace_key),
        "link",
        action,
        state,
        &title,
        &summary,
        &detail,
        report.plan.project.as_deref(),
        None,
        Some(payload),
    )
}

#[allow(clippy::too_many_arguments)]
pub fn failed_operation_event(
    id: String,
    origin: OperationEventOrigin,
    workspace_key: String,
    domain: &str,
    action: &str,
    title: &str,
    project_key: Option<&str>,
    error: &str,
) -> OperationEvent {
    lifecycle_operation_event(
        id,
        origin,
        workspace_key,
        domain,
        action,
        OperationEventState::Failed,
        title,
        &format!("{title}失败"),
        error,
        project_key,
        None,
        None,
    )
}

pub fn update_build_operation_event_from_history(
    storage: &Storage,
    history: &SaveDeployHistoryRequest,
) -> Result<bool, String> {
    let Some(mut event) = list_operation_events(storage)?.into_iter().find(|event| {
        event.domain == "build"
            && event
                .related_history_keys
                .iter()
                .any(|key| key == &history.history_key)
    }) else {
        return Ok(false);
    };
    event.state = build_operation_state(&history.state_key);
    event.summary = build_operation_summary(&history.state_label, &history.detail);
    event.detail = history.detail.clone();
    event.project_key = Some(history.project_key.clone());
    event.project_name = Some(history.project_name.clone());
    event.payload = serde_json::to_value(history).ok();
    event.updated_at = event_timestamp();
    save_operation_event(storage, &event)?;
    Ok(true)
}

fn build_operation_state(state_key: &str) -> OperationEventState {
    match state_key.trim().to_ascii_lowercase().as_str() {
        "accepted" | "queued" | "running" => OperationEventState::Running,
        "success" | "succeeded" => OperationEventState::Success,
        "failure" | "failed" | "error" | "cancelled" | "canceled" | "aborted" => {
            OperationEventState::Failed
        }
        _ => OperationEventState::Info,
    }
}

fn build_operation_summary(state_label: &str, detail: &str) -> String {
    let state_label = state_label.trim();
    let detail = detail.trim();
    match (state_label.is_empty(), detail.is_empty()) {
        (false, false) => format!("{state_label} · {detail}"),
        (false, true) => state_label.to_string(),
        (true, false) => detail.to_string(),
        (true, true) => "构建状态已更新".to_string(),
    }
}

pub fn save_operation_event(storage: &Storage, event: &OperationEvent) -> Result<(), String> {
    let value = serde_json::to_value(event).map_err(|error| error.to_string())?;
    storage
        .prepend_json_array(
            OPERATION_EVENT_STORAGE_NAMESPACE,
            OPERATION_EVENT_STORAGE_KEY,
            value,
            OPERATION_EVENT_HISTORY_LIMIT,
        )
        .map(|_| ())
}

pub fn list_operation_events(storage: &Storage) -> Result<Vec<OperationEvent>, String> {
    let stored = storage.get_json(
        OPERATION_EVENT_STORAGE_NAMESPACE,
        OPERATION_EVENT_STORAGE_KEY,
    )?;
    Ok(stored
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|value| serde_json::from_value(value).ok())
        .collect())
}

fn normalized_event_segment(value: &str) -> String {
    let normalized = value
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();
    let normalized = normalized.trim_matches('-');
    if normalized.is_empty() {
        "action".to_string()
    } else {
        normalized.to_string()
    }
}

fn event_timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationStatus {
    pub key: String,
    pub label: String,
    pub success: bool,
    pub terminal: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationEvidence {
    pub kind: String,
    pub source: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationRisk {
    pub code: String,
    pub severity: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedArtifact {
    pub kind: String,
    pub path: String,
    pub ownership: String,
    pub lifecycle: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendedAction {
    pub command: String,
    pub reason: String,
    pub risk: String,
}

#[cfg(test)]
mod operation_event_tests {
    use super::*;
    use crate::core::{
        BranchTaskItemResult, BranchTaskResponse, BuildPlanEffective, BuildPlanObserved,
        BuildPlanRequested, DeployPlan,
    };
    use crate::link::{LinkExecutionStepReport, LinkPlan};
    use std::collections::BTreeMap;
    use std::fs;

    #[test]
    fn branch_event_round_trips_through_shared_storage() {
        let path = std::env::temp_dir().join(format!(
            "rdevtool-operation-event-{}-{}.sqlite",
            std::process::id(),
            Uuid::new_v4()
        ));
        let storage = Storage::new(path.clone()).expect("create operation event storage");
        let response = BranchTaskResponse {
            task_kind: "push".to_string(),
            success: false,
            summary: "成功 0 / 失败 1".to_string(),
            detail: "批量任务包含失败项".to_string(),
            items: vec![BranchTaskItemResult {
                project_key: "admin".to_string(),
                project_name: "管理端".to_string(),
                source_branch: "feature/demo".to_string(),
                target_branch: None,
                output_path: None,
                checkout_mode: None,
                fallback_reason: None,
                success: false,
                status_key: "push_failed".to_string(),
                status_label: "失败".to_string(),
                summary: "推送失败".to_string(),
                detail: "remote rejected".to_string(),
                remote: false,
                commit: None,
            }],
        };
        let event = branch_task_operation_event(
            "activity-1".to_string(),
            OperationEventOrigin::Cli,
            "feature-a".to_string(),
            "提交推送",
            "push",
            None,
            Some(&response),
            None,
            vec!["activity-1".to_string()],
        );

        save_operation_event(&storage, &event).expect("save operation event");
        let events = list_operation_events(&storage).expect("list operation events");

        assert_eq!(events, vec![event]);
        assert_eq!(events[0].state, OperationEventState::Failed);
        assert_eq!(events[0].payload.as_ref().unwrap()["taskKind"], "push");

        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(format!("{}-wal", path.display()));
        let _ = fs::remove_file(format!("{}-shm", path.display()));
    }

    #[test]
    fn failed_build_event_keeps_the_exact_replay_request() {
        let request = DeployRequest {
            project: "admin".to_string(),
            target: Some("vke".to_string()),
            variant: false,
            env: Some("dc2".to_string()),
            branch: Some("feature/a".to_string()),
            extra_params: BTreeMap::from([("IS_GRAY".to_string(), "false".to_string())]),
            params: BTreeMap::from([("ENV_PROFILE".to_string(), "dc2".to_string())]),
        };
        let event = failed_build_operation_event(
            "activity-build-failed-1".to_string(),
            OperationEventOrigin::Cli,
            "feature-a".to_string(),
            "触发部署",
            "deploy",
            Some("管理端"),
            &request,
            "目标分支不存在",
        );

        assert_eq!(event.state, OperationEventState::Failed);
        assert_eq!(event.project_name.as_deref(), Some("管理端"));
        let payload = event.payload.expect("failed build payload");
        assert_eq!(payload["mode"], "vke");
        assert_eq!(payload["params"]["IS_GRAY"], "false");
        assert_eq!(payload["replayRequest"]["project"], "admin");
        assert_eq!(payload["replayRequest"]["target"], "vke");
        assert_eq!(payload["replayRequest"]["branch"], "feature/a");
    }

    #[test]
    fn build_event_updates_in_place_when_history_reaches_a_terminal_state() {
        let path = std::env::temp_dir().join(format!(
            "rdevtool-build-operation-event-{}-{}.sqlite",
            std::process::id(),
            Uuid::new_v4()
        ));
        let storage = Storage::new(path.clone()).expect("create operation event storage");
        let workspace = ProjectWorkspaceConfig {
            key: "feature-a".to_string(),
            name: "Feature A".to_string(),
            projects: vec!["admin".to_string()],
            ..ProjectWorkspaceConfig::default()
        };
        let result = BuildTriggerResponse {
            plan: DeployPlan {
                project_key: "admin".to_string(),
                project_name: "管理端".to_string(),
                adapter: "jenkins".to_string(),
                action_kind: "deploy".to_string(),
                job_kind: "vke".to_string(),
                job_name: "admin-vke".to_string(),
                trigger_url: "http://jenkins/job/admin/build".to_string(),
                params: BTreeMap::from([
                    ("ENV_PROFILE".to_string(), "dc2".to_string()),
                    ("BRANCH".to_string(), "feature/a".to_string()),
                ]),
                jenkins_base_url: "http://jenkins".to_string(),
                command: None,
                cwd: None,
                output_dir: None,
                requested: BuildPlanRequested {
                    project: "admin".to_string(),
                    target: Some("vke".to_string()),
                    env: Some("dc2".to_string()),
                    branch: Some("feature/a".to_string()),
                    params: BTreeMap::new(),
                },
                effective: BuildPlanEffective {
                    target: "vke".to_string(),
                    env: Some("dc2".to_string()),
                    branch: Some("feature/a".to_string()),
                    params: BTreeMap::from([
                        ("ENV_PROFILE".to_string(), "dc2".to_string()),
                        ("BRANCH".to_string(), "feature/a".to_string()),
                    ]),
                },
                observed: BuildPlanObserved {
                    repo_path: None,
                    commit: None,
                    commit_source: None,
                    changed_paths: Vec::new(),
                    change_sources: Vec::new(),
                },
                ignored_inputs: Vec::new(),
                status: OperationStatus {
                    key: "ready".to_string(),
                    label: "可以触发".to_string(),
                    success: true,
                    terminal: true,
                    detail: "构建参数已完整解析。".to_string(),
                },
                evidence: Vec::new(),
                risks: Vec::new(),
                recommended_actions: Vec::new(),
            },
            status: 201,
            queue_url: Some("http://jenkins/queue/item/42/".to_string()),
            build_url: None,
            state_key: "queued".to_string(),
            state_label: "排队中".to_string(),
            detail: "等待执行".to_string(),
        };
        let history = build_history_request(&workspace, &result, "activity-build-1");
        let event = build_operation_event(
            "activity-build-1".to_string(),
            OperationEventOrigin::App,
            workspace.key.clone(),
            "触发部署",
            "deploy",
            &history,
        );
        save_operation_event(&storage, &event).expect("save running build event");

        let mut completed = history;
        completed.state_key = "success".to_string();
        completed.state_label = "构建成功".to_string();
        completed.detail = "构建 #42 当前结果：SUCCESS".to_string();
        completed.build_url = Some("http://jenkins/job/admin/42/".to_string());
        assert!(
            update_build_operation_event_from_history(&storage, &completed)
                .expect("update build event")
        );

        let events = list_operation_events(&storage).expect("list operation events");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id, "activity-build-1");
        assert_eq!(events[0].state, OperationEventState::Success);
        assert_eq!(events[0].created_at, event.created_at);
        assert_eq!(events[0].payload.as_ref().unwrap()["stateKey"], "success");

        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(format!("{}-wal", path.display()));
        let _ = fs::remove_file(format!("{}-shm", path.display()));
    }

    #[test]
    fn lifecycle_event_preserves_domain_state_and_payload() {
        let event = lifecycle_operation_event(
            "activity-runtime-1".to_string(),
            OperationEventOrigin::Tray,
            "feature-a".to_string(),
            "runtime",
            "start",
            OperationEventState::Success,
            "dev 服务已启动",
            "管理端 · 已启动",
            "Runtime Daemon 正在运行",
            Some("admin"),
            Some("管理端"),
            Some(serde_json::json!({ "statusKey": "running" })),
        );

        assert_eq!(event.domain, "runtime");
        assert_eq!(event.action, "start");
        assert_eq!(event.state, OperationEventState::Success);
        assert_eq!(event.project_key.as_deref(), Some("admin"));
        assert_eq!(event.payload.as_ref().unwrap()["statusKey"], "running");
    }

    #[test]
    fn link_event_keeps_compact_failure_evidence() {
        let report = LinkExecutionReport {
            key: "cooperation-debug".to_string(),
            name: "合作渠道联调".to_string(),
            mode: "run".to_string(),
            plan: LinkPlan {
                key: "cooperation-debug".to_string(),
                name: "合作渠道联调".to_string(),
                kind: None,
                ui_profile: "default".to_string(),
                schema_version: 1,
                workspace_key: Some("feature-a".to_string()),
                project: Some("admin".to_string()),
                source_context: None,
                steps: Vec::new(),
                warnings: Vec::new(),
            },
            steps: vec![LinkExecutionStepReport {
                id: "proxy".to_string(),
                step_type: "proxy.start".to_string(),
                label: "启动代理".to_string(),
                status: "failed".to_string(),
                summary: "端口已被占用".to_string(),
                detail: None,
                risks: vec!["127.0.0.1:8791 已占用".to_string()],
            }],
            warnings: vec!["代理配置需要检查".to_string()],
        };
        let event = link_operation_event(
            "activity-link-1".to_string(),
            OperationEventOrigin::Tray,
            "fallback".to_string(),
            "run",
            &report.key,
            None,
            Some(&report),
            None,
        );

        assert_eq!(event.domain, "link");
        assert_eq!(event.state, OperationEventState::Failed);
        assert_eq!(event.workspace_key, "feature-a");
        assert_eq!(event.project_key.as_deref(), Some("admin"));
        assert!(event.detail.contains("端口已被占用"));
        assert_eq!(event.payload.as_ref().unwrap()["failedCount"], 1);
        assert_eq!(
            event.payload.as_ref().unwrap()["diagnosticSteps"][0]["status"],
            "failed"
        );
        assert!(event.payload.as_ref().unwrap().get("plan").is_none());
    }
}
