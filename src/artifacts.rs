use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Result, bail};
use serde::Serialize;

use crate::config::{
    AppConfig, ConfigPaths, ProjectWorkspaceConfig, active_project_workspace_key,
    load_all_project_workspaces, load_project_workspace_by_key, load_workspace_config,
    normalize_project_workspace_key,
};
use crate::git::working_tree_status;
use crate::operation::{
    ManagedArtifact, OperationEvidence, OperationRisk, OperationStatus, RecommendedAction,
};
use crate::proxy::load_proxy_config;
use crate::proxy_daemon::inspect_proxy_daemon_artifact_state;
use crate::runtime_daemon::{RuntimeDaemonStatus, list as list_runtime_daemons};

#[derive(Debug, Clone, Default)]
pub struct ManagedArtifactQuery {
    pub workspace: Option<String>,
    pub all_workspaces: bool,
    pub project: Option<String>,
    pub kinds: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ManagedArtifactCleanupQuery {
    pub inventory: ManagedArtifactQuery,
    pub artifact_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedArtifactInventoryResponse {
    pub schema_version: u16,
    pub requested: ManagedArtifactInventoryRequested,
    pub effective: ManagedArtifactInventoryEffective,
    pub observed: ManagedArtifactInventoryObserved,
    pub status: OperationStatus,
    pub evidence: Vec<OperationEvidence>,
    pub risks: Vec<OperationRisk>,
    pub managed_artifacts: Vec<ManagedArtifact>,
    pub recommended_actions: Vec<RecommendedAction>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedArtifactInventoryRequested {
    pub workspace: Option<String>,
    pub all_workspaces: bool,
    pub project: Option<String>,
    pub kinds: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedArtifactInventoryEffective {
    pub workspace_keys: Vec<String>,
    pub project: Option<String>,
    pub kinds: Vec<String>,
    pub collectors: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedArtifactInventoryObserved {
    pub artifacts: Vec<ManagedArtifactRecord>,
    pub references: Vec<ArtifactReference>,
    pub summary: ManagedArtifactInventorySummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedArtifactInventorySummary {
    pub artifact_count: usize,
    pub existing_count: usize,
    pub missing_count: usize,
    pub active_count: usize,
    pub reference_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedArtifactRecord {
    pub id: String,
    pub source: String,
    pub artifact: ManagedArtifact,
    pub workspace_key: Option<String>,
    pub project_key: Option<String>,
    pub run_id: Option<String>,
    pub scope_path: Option<String>,
    pub exists: bool,
    pub object_type: String,
    pub active: bool,
    pub ownership_verified: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactReference {
    pub kind: String,
    pub path: String,
    pub source: String,
    pub workspace_key: Option<String>,
    pub project_key: Option<String>,
    pub exists: bool,
    pub ownership: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedArtifactCleanupPlanResponse {
    pub schema_version: u16,
    pub requested: ManagedArtifactCleanupRequested,
    pub effective: ManagedArtifactCleanupEffective,
    pub observed: ManagedArtifactCleanupObserved,
    pub status: OperationStatus,
    pub evidence: Vec<OperationEvidence>,
    pub risks: Vec<OperationRisk>,
    pub managed_artifacts: Vec<ManagedArtifact>,
    pub recommended_actions: Vec<RecommendedAction>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedArtifactCleanupRequested {
    pub workspace: Option<String>,
    pub all_workspaces: bool,
    pub project: Option<String>,
    pub kinds: Vec<String>,
    pub artifact_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedArtifactCleanupEffective {
    pub workspace_keys: Vec<String>,
    pub selected_artifact_ids: Vec<String>,
    pub missing_artifact_ids: Vec<String>,
    pub execution_supported: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedArtifactCleanupObserved {
    pub actions: Vec<ManagedArtifactCleanupAction>,
    pub eligible_count: usize,
    pub review_required_count: usize,
    pub blocked_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedArtifactCleanupAction {
    pub artifact_id: String,
    pub kind: String,
    pub path: String,
    pub action: String,
    pub eligibility: String,
    pub destructive: bool,
    pub reason: String,
    pub prerequisites: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedArtifactContextSummary {
    pub schema_version: u16,
    pub requested: ManagedArtifactInventoryRequested,
    pub effective: ManagedArtifactContextEffective,
    pub observed: ManagedArtifactContextObserved,
    pub status: OperationStatus,
    pub evidence: Vec<OperationEvidence>,
    pub risks: Vec<OperationRisk>,
    pub recommended_actions: Vec<RecommendedAction>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedArtifactContextEffective {
    pub workspace_keys: Vec<String>,
    pub project: Option<String>,
    pub kinds: Vec<String>,
    pub collectors: Vec<String>,
    pub execution_supported: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedArtifactContextObserved {
    pub summary: ManagedArtifactContextCounts,
    pub by_kind: Vec<ManagedArtifactKindSummary>,
    pub cleanup_plan: ManagedArtifactEligibilitySummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedArtifactContextCounts {
    pub artifact_count: usize,
    pub managed_count: usize,
    pub ownership_unverified_count: usize,
    pub existing_count: usize,
    pub missing_count: usize,
    pub active_count: usize,
    pub reference_count: usize,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedArtifactKindSummary {
    pub kind: String,
    pub artifact_count: usize,
    pub managed_count: usize,
    pub reference_count: usize,
    pub active_count: usize,
    pub missing_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedArtifactEligibilitySummary {
    pub eligible_count: usize,
    pub review_required_count: usize,
    pub blocked_count: usize,
}

pub fn managed_artifact_inventory(
    config: &AppConfig,
    paths: &ConfigPaths,
    query: &ManagedArtifactQuery,
) -> Result<ManagedArtifactInventoryResponse> {
    let runtime_statuses = list_runtime_daemons()?;
    managed_artifact_inventory_with_runtime_statuses(config, paths, query, runtime_statuses)
}

pub fn managed_artifact_cleanup_plan(
    config: &AppConfig,
    paths: &ConfigPaths,
    query: &ManagedArtifactCleanupQuery,
) -> Result<ManagedArtifactCleanupPlanResponse> {
    let inventory = managed_artifact_inventory(config, paths, &query.inventory)?;
    Ok(managed_artifact_cleanup_plan_from_inventory(
        &inventory, paths, query,
    ))
}

pub fn managed_artifact_context_summary(
    config: &AppConfig,
    paths: &ConfigPaths,
    query: &ManagedArtifactQuery,
) -> Result<ManagedArtifactContextSummary> {
    let inventory = managed_artifact_inventory(config, paths, query)?;
    let cleanup_plan = managed_artifact_cleanup_plan_from_inventory(
        &inventory,
        paths,
        &ManagedArtifactCleanupQuery {
            inventory: query.clone(),
            artifact_ids: Vec::new(),
        },
    );
    let mut by_kind = BTreeMap::<String, ManagedArtifactKindSummary>::new();
    for record in &inventory.observed.artifacts {
        let entry = by_kind
            .entry(record.artifact.kind.clone())
            .or_insert_with(|| ManagedArtifactKindSummary {
                kind: record.artifact.kind.clone(),
                ..ManagedArtifactKindSummary::default()
            });
        entry.artifact_count += 1;
        entry.managed_count += usize::from(record.ownership_verified);
        entry.active_count += usize::from(record.active);
        entry.missing_count += usize::from(!record.exists);
    }
    for reference in &inventory.observed.references {
        let entry =
            by_kind
                .entry(reference.kind.clone())
                .or_insert_with(|| ManagedArtifactKindSummary {
                    kind: reference.kind.clone(),
                    ..ManagedArtifactKindSummary::default()
                });
        entry.reference_count += 1;
    }
    let managed_count = inventory.managed_artifacts.len();
    let ownership_unverified_count = inventory
        .observed
        .artifacts
        .iter()
        .filter(|record| !record.ownership_verified)
        .count();
    let status_key = if cleanup_plan.observed.blocked_count > 0 || ownership_unverified_count > 0 {
        "observedWithRisks"
    } else if cleanup_plan.observed.review_required_count > 0 {
        "reviewRequired"
    } else {
        "observed"
    };
    let mut evidence = inventory.evidence.clone();
    evidence.extend(cleanup_plan.evidence.clone());

    Ok(ManagedArtifactContextSummary {
        schema_version: 1,
        requested: inventory.requested.clone(),
        effective: ManagedArtifactContextEffective {
            workspace_keys: inventory.effective.workspace_keys.clone(),
            project: inventory.effective.project.clone(),
            kinds: inventory.effective.kinds.clone(),
            collectors: inventory.effective.collectors.clone(),
            execution_supported: cleanup_plan.effective.execution_supported,
        },
        observed: ManagedArtifactContextObserved {
            summary: ManagedArtifactContextCounts {
                artifact_count: inventory.observed.summary.artifact_count,
                managed_count,
                ownership_unverified_count,
                existing_count: inventory.observed.summary.existing_count,
                missing_count: inventory.observed.summary.missing_count,
                active_count: inventory.observed.summary.active_count,
                reference_count: inventory.observed.summary.reference_count,
            },
            by_kind: by_kind.into_values().collect(),
            cleanup_plan: ManagedArtifactEligibilitySummary {
                eligible_count: cleanup_plan.observed.eligible_count,
                review_required_count: cleanup_plan.observed.review_required_count,
                blocked_count: cleanup_plan.observed.blocked_count,
            },
        },
        status: OperationStatus {
            key: status_key.to_string(),
            label: "受管产物上下文已生成".to_string(),
            success: true,
            terminal: true,
            detail: format!(
                "只读摘要包含 {managed_count} 条归属可信产物、{} 条非托管引用；清理执行保持关闭",
                inventory.observed.summary.reference_count
            ),
        },
        evidence,
        risks: cleanup_plan.risks.clone(),
        recommended_actions: cleanup_plan.recommended_actions.clone(),
    })
}

fn managed_artifact_cleanup_plan_from_inventory(
    inventory: &ManagedArtifactInventoryResponse,
    paths: &ConfigPaths,
    query: &ManagedArtifactCleanupQuery,
) -> ManagedArtifactCleanupPlanResponse {
    let requested_ids = normalize_values(&query.artifact_ids);
    let available_ids = inventory
        .observed
        .artifacts
        .iter()
        .map(|record| record.id.as_str())
        .collect::<BTreeSet<_>>();
    let missing_artifact_ids = requested_ids
        .iter()
        .filter(|id| !available_ids.contains(id.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    let selected = inventory
        .observed
        .artifacts
        .iter()
        .filter(|record| requested_ids.is_empty() || requested_ids.contains(&record.id))
        .cloned()
        .collect::<Vec<_>>();
    let actions = selected
        .iter()
        .map(|record| cleanup_action(record, &inventory.observed.artifacts, paths))
        .collect::<Vec<_>>();
    let eligible_count = actions
        .iter()
        .filter(|action| action.eligibility == "eligible")
        .count();
    let review_required_count = actions
        .iter()
        .filter(|action| action.eligibility == "reviewRequired")
        .count();
    let blocked_count = actions
        .iter()
        .filter(|action| action.eligibility == "blocked")
        .count();
    let mut risks = inventory.risks.clone();
    if !missing_artifact_ids.is_empty() {
        risks.push(OperationRisk {
            code: "artifact_id_not_found".to_string(),
            severity: "error".to_string(),
            detail: format!(
                "未找到请求的 artifact id：{}",
                missing_artifact_ids.join(", ")
            ),
        });
    }
    if blocked_count > 0 {
        risks.push(OperationRisk {
            code: "cleanup_actions_blocked".to_string(),
            severity: "warning".to_string(),
            detail: format!("{blocked_count} 个候选产物未满足安全清理条件"),
        });
    }
    if review_required_count > 0 {
        risks.push(OperationRisk {
            code: "cleanup_review_required".to_string(),
            severity: "info".to_string(),
            detail: format!("{review_required_count} 个候选产物涉及历史或工作区配置，需要显式复核"),
        });
    }
    let success = missing_artifact_ids.is_empty() && blocked_count == 0;
    let (status_key, status_label, status_detail) =
        cleanup_plan_status(selected.len(), missing_artifact_ids.len(), blocked_count);
    let selected_artifact_ids = selected
        .iter()
        .map(|record| record.id.clone())
        .collect::<Vec<_>>();
    let managed_artifacts = selected
        .into_iter()
        .filter(|record| record.ownership_verified)
        .map(|record| record.artifact)
        .collect::<Vec<_>>();

    ManagedArtifactCleanupPlanResponse {
        schema_version: 1,
        requested: ManagedArtifactCleanupRequested {
            workspace: query.inventory.workspace.clone(),
            all_workspaces: query.inventory.all_workspaces,
            project: query.inventory.project.clone(),
            kinds: query.inventory.kinds.clone(),
            artifact_ids: query.artifact_ids.clone(),
        },
        effective: ManagedArtifactCleanupEffective {
            workspace_keys: inventory.effective.workspace_keys.clone(),
            selected_artifact_ids,
            missing_artifact_ids,
            execution_supported: false,
        },
        observed: ManagedArtifactCleanupObserved {
            actions,
            eligible_count,
            review_required_count,
            blocked_count,
        },
        status: OperationStatus {
            key: status_key.to_string(),
            label: status_label.to_string(),
            success,
            terminal: true,
            detail: status_detail,
        },
        evidence: vec![OperationEvidence {
            kind: "plan".to_string(),
            source: "managedArtifactInventory".to_string(),
            detail: "清理资格来自当前文件状态、Runtime 活跃状态、工作区边界和 Git 工作树检查"
                .to_string(),
        }],
        risks,
        managed_artifacts,
        recommended_actions: vec![RecommendedAction {
            command: artifact_query_command("list", &query.inventory),
            reason: "执行任何人工清理前重新读取当前观测".to_string(),
            risk: "readOnly".to_string(),
        }],
    }
}

fn cleanup_plan_status(
    selected_count: usize,
    missing_count: usize,
    blocked_count: usize,
) -> (&'static str, &'static str, String) {
    if missing_count > 0 {
        (
            "missingArtifacts",
            "部分产物不存在",
            "至少一个显式 artifact id 无法在当前边界内解析".to_string(),
        )
    } else if selected_count == 0 {
        (
            "empty",
            "没有清理候选",
            "当前选择没有匹配的托管产物".to_string(),
        )
    } else if blocked_count > 0 {
        (
            "blocked",
            "清理计划被阻塞",
            format!("{blocked_count} 个候选产物仍在使用、越界或未通过 Git 安全检查"),
        )
    } else {
        (
            "planned",
            "清理计划已生成",
            "仅生成只读计划；当前版本不提供删除执行命令".to_string(),
        )
    }
}

fn managed_artifact_inventory_with_runtime_statuses(
    config: &AppConfig,
    paths: &ConfigPaths,
    query: &ManagedArtifactQuery,
    runtime_statuses: Vec<RuntimeDaemonStatus>,
) -> Result<ManagedArtifactInventoryResponse> {
    let (active_workspace_key, workspaces) = selected_workspaces(paths, query)?;
    let normalized_kinds = normalize_values(&query.kinds)
        .into_iter()
        .map(|kind| kind.to_ascii_lowercase())
        .collect::<Vec<_>>();
    let normalized_project = query
        .project
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let mut artifacts = Vec::new();
    let mut references = Vec::new();
    collect_workspace_artifacts(
        paths,
        &workspaces,
        &active_workspace_key,
        normalized_project.as_deref(),
        &mut artifacts,
        &mut references,
    );
    collect_runtime_artifacts(
        config,
        paths,
        &workspaces,
        query.all_workspaces,
        normalized_project.as_deref(),
        runtime_statuses,
        &mut artifacts,
        &mut references,
    );
    collect_proxy_daemon_artifacts(
        paths,
        &workspaces,
        query.all_workspaces,
        normalized_project.as_deref(),
        &mut artifacts,
        &mut references,
    );
    artifacts.retain(|record| kind_matches(&record.artifact.kind, &normalized_kinds));
    references.retain(|reference| kind_matches(&reference.kind, &normalized_kinds));
    deduplicate_artifacts(&mut artifacts);
    deduplicate_references(&mut references);
    artifacts.sort_by(|left, right| {
        left.artifact
            .kind
            .cmp(&right.artifact.kind)
            .then_with(|| left.artifact.path.cmp(&right.artifact.path))
    });
    references.sort_by(|left, right| {
        left.kind
            .cmp(&right.kind)
            .then_with(|| left.path.cmp(&right.path))
    });
    let existing_count = artifacts.iter().filter(|record| record.exists).count();
    let missing_count = artifacts.len().saturating_sub(existing_count);
    let active_count = artifacts.iter().filter(|record| record.active).count();
    let summary = ManagedArtifactInventorySummary {
        artifact_count: artifacts.len(),
        existing_count,
        missing_count,
        active_count,
        reference_count: references.len(),
    };
    let reference_count = summary.reference_count;
    let mut risks = Vec::new();
    if missing_count > 0 {
        risks.push(OperationRisk {
            code: "managed_artifact_missing".to_string(),
            severity: "warning".to_string(),
            detail: format!("{missing_count} 条托管记录指向当前不存在的路径"),
        });
    }
    let unverified_count = artifacts
        .iter()
        .filter(|record| !record.ownership_verified)
        .count();
    if unverified_count > 0 {
        risks.push(OperationRisk {
            code: "artifact_ownership_unverified".to_string(),
            severity: "warning".to_string(),
            detail: format!("{unverified_count} 条候选记录未通过最终归属验证"),
        });
    }
    if !references.is_empty() {
        risks.push(OperationRisk {
            code: "unmanaged_references_present".to_string(),
            severity: "info".to_string(),
            detail: format!(
                "{} 条路径仅被配置引用，未声明为 rDevTool 托管产物",
                references.len()
            ),
        });
    }
    let managed_artifacts = artifacts
        .iter()
        .filter(|record| record.ownership_verified)
        .map(|record| record.artifact.clone())
        .collect::<Vec<_>>();
    let workspace_keys = workspaces
        .iter()
        .map(|workspace| workspace.key.clone())
        .collect::<Vec<_>>();

    Ok(ManagedArtifactInventoryResponse {
        schema_version: 1,
        requested: ManagedArtifactInventoryRequested {
            workspace: query.workspace.clone(),
            all_workspaces: query.all_workspaces,
            project: query.project.clone(),
            kinds: query.kinds.clone(),
        },
        effective: ManagedArtifactInventoryEffective {
            workspace_keys,
            project: normalized_project,
            kinds: normalized_kinds,
            collectors: vec![
                "workspaceConfig".to_string(),
                "runtimeDaemon".to_string(),
                "proxyDaemon".to_string(),
            ],
        },
        observed: ManagedArtifactInventoryObserved {
            artifacts,
            references,
            summary,
        },
        status: OperationStatus {
            key: "observed".to_string(),
            label: "托管产物已盘点".to_string(),
            success: true,
            terminal: true,
            detail: format!(
                "发现 {} 条托管产物和 {} 条非托管引用",
                managed_artifacts.len(),
                reference_count
            ),
        },
        evidence: vec![
            OperationEvidence {
                kind: "configuration".to_string(),
                source: "workspace.projectInstances.managed".to_string(),
                detail: "只有 managed=true 的工作区项目实例进入托管产物清单".to_string(),
            },
            OperationEvidence {
                kind: "runtime".to_string(),
                source: "runtimeDaemon.state".to_string(),
                detail: "Runtime 产物来自 rDevTool 内部状态目录和已解析 daemon 状态".to_string(),
            },
            OperationEvidence {
                kind: "proxy".to_string(),
                source: "proxyDaemon.state".to_string(),
                detail: "Proxy 产物只从 rDevTool proxy-runtime 内部目录和可验证状态文件收集"
                    .to_string(),
            },
        ],
        risks,
        managed_artifacts,
        recommended_actions: vec![RecommendedAction {
            command: artifact_query_command("cleanup-plan", query),
            reason: "生成只读清理资格和阻塞原因，不执行删除".to_string(),
            risk: "readOnly".to_string(),
        }],
    })
}

fn selected_workspaces(
    paths: &ConfigPaths,
    query: &ManagedArtifactQuery,
) -> Result<(String, Vec<ProjectWorkspaceConfig>)> {
    if query.all_workspaces && query.workspace.is_some() {
        bail!("--workspace and --all-workspaces cannot be used together");
    }
    let workspace_config = load_workspace_config(&paths.workspace)?;
    let active_key = active_project_workspace_key(&workspace_config);
    if query.all_workspaces {
        return Ok((
            active_key,
            load_all_project_workspaces(&paths.project_workspaces)?,
        ));
    }
    let key = query
        .workspace
        .clone()
        .unwrap_or_else(|| active_key.clone());
    Ok((
        active_key,
        vec![load_project_workspace_by_key(
            &paths.project_workspaces,
            &key,
        )?],
    ))
}

fn collect_workspace_artifacts(
    paths: &ConfigPaths,
    workspaces: &[ProjectWorkspaceConfig],
    active_workspace_key: &str,
    project_filter: Option<&str>,
    artifacts: &mut Vec<ManagedArtifactRecord>,
    references: &mut Vec<ArtifactReference>,
) {
    for workspace in workspaces {
        if !workspace.is_system() && project_filter.is_none() {
            let config_path = paths
                .project_workspaces
                .join(format!("{}.toml", workspace.key));
            artifacts.push(artifact_record(
                "workspaceConfig",
                ManagedArtifact {
                    kind: "workspaceConfig".to_string(),
                    path: config_path.display().to_string(),
                    ownership: "rdevtool".to_string(),
                    lifecycle: "workspace".to_string(),
                },
                Some(workspace.key.clone()),
                None,
                None,
                None,
                workspace.key == active_workspace_key,
                true,
                "工作区配置位于 rDevTool 的正式工作区配置目录".to_string(),
            ));
        }
        if let Some(root_dir) = workspace.root_dir.as_ref() {
            references.push(reference(
                "workspaceRoot",
                root_dir,
                "workspaceConfig",
                Some(&workspace.key),
                None,
                "工作区配置未持久化该目录是否由 rDevTool 创建",
            ));
        }
        if let Some(resource_dir) = workspace.resource_dir.as_ref() {
            references.push(reference(
                "resourceDirectory",
                resource_dir,
                "workspaceConfig",
                Some(&workspace.key),
                None,
                "资源目录可能预先存在，当前配置只证明引用关系",
            ));
            if let Some(worklog_file) = workspace.worklog_file.as_ref() {
                references.push(reference(
                    "worklog",
                    &resource_dir.join(worklog_file),
                    "workspaceConfig",
                    Some(&workspace.key),
                    None,
                    "worklog 可能预先存在，当前配置只证明引用关系",
                ));
            }
        }
        for instance in &workspace.project_instances {
            if project_filter.is_some_and(|project| project != instance.project) {
                continue;
            }
            if instance.managed {
                artifacts.push(artifact_record(
                    "workspaceConfig",
                    ManagedArtifact {
                        kind: "workspaceProjectInstance".to_string(),
                        path: instance.path.display().to_string(),
                        ownership: "rdevtool".to_string(),
                        lifecycle: "workspace".to_string(),
                    },
                    Some(workspace.key.clone()),
                    Some(instance.project.clone()),
                    None,
                    Some(instance.path.display().to_string()),
                    false,
                    true,
                    "工作区项目实例显式记录 managed=true".to_string(),
                ));
            } else {
                references.push(reference(
                    "workspaceProjectInstance",
                    &instance.path,
                    "workspaceConfig",
                    Some(&workspace.key),
                    Some(&instance.project),
                    "existing 绑定或普通 scope 不属于 rDevTool",
                ));
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn collect_runtime_artifacts(
    config: &AppConfig,
    paths: &ConfigPaths,
    workspaces: &[ProjectWorkspaceConfig],
    all_workspaces: bool,
    project_filter: Option<&str>,
    statuses: Vec<RuntimeDaemonStatus>,
    artifacts: &mut Vec<ManagedArtifactRecord>,
    references: &mut Vec<ArtifactReference>,
) {
    let runtime_log_root = paths.dir.join("runtime-logs");
    for status in statuses {
        if project_filter.is_some_and(|project| project != status.project_key) {
            continue;
        }
        let Some(workspace_key) = runtime_workspace_scope(&status, workspaces, all_workspaces)
        else {
            continue;
        };
        if !config
            .projects
            .iter()
            .any(|project| project.key == status.project_key)
            && !all_workspaces
        {
            continue;
        }
        let run_id = status.state.as_ref().map(|state| state.run_id.clone());
        artifacts.push(artifact_record(
            "runtimeDaemon",
            ManagedArtifact {
                kind: "runtimeState".to_string(),
                path: status.state_path.clone(),
                ownership: "rdevtool".to_string(),
                lifecycle: "runtimeSession".to_string(),
            },
            workspace_key.clone(),
            Some(status.project_key.clone()),
            run_id.clone(),
            Some(status.canonical_cwd.clone()),
            status.running,
            true,
            format!(
                "daemon phase={} managed={} compatible={}",
                status.phase_key, status.managed, status.version_compatible
            ),
        ));
        let daemon_log_path = Path::new(&status.state_path).with_extension("daemon.log");
        artifacts.push(artifact_record(
            "runtimeDaemon",
            ManagedArtifact {
                kind: "runtimeDaemonLog".to_string(),
                path: daemon_log_path.display().to_string(),
                ownership: "rdevtool".to_string(),
                lifecycle: "runtimeSession".to_string(),
            },
            workspace_key.clone(),
            Some(status.project_key.clone()),
            run_id.clone(),
            Some(status.canonical_cwd.clone()),
            status.running,
            true,
            "daemon 标准输出日志与内部状态文件使用同一受控前缀".to_string(),
        ));
        if let Some(state) = status.state.as_ref() {
            let log_path = PathBuf::from(&state.log_path);
            if path_within(&log_path, &runtime_log_root) {
                artifacts.push(artifact_record(
                    "runtimeDaemon",
                    ManagedArtifact {
                        kind: "runtimeLog".to_string(),
                        path: state.log_path.clone(),
                        ownership: "rdevtool".to_string(),
                        lifecycle: "projectRuntimeHistory".to_string(),
                    },
                    workspace_key,
                    Some(status.project_key.clone()),
                    run_id,
                    Some(status.canonical_cwd.clone()),
                    status.running,
                    true,
                    "项目运行日志位于 rDevTool runtime-logs 目录，可能跨多个会话复用".to_string(),
                ));
            } else {
                references.push(reference(
                    "runtimeLog",
                    &log_path,
                    "runtimeDaemon",
                    workspace_key.as_deref(),
                    Some(&status.project_key),
                    "状态文件引用了 rDevTool runtime-logs 目录之外的日志路径",
                ));
            }
        }
    }
}

fn runtime_workspace_scope(
    status: &RuntimeDaemonStatus,
    workspaces: &[ProjectWorkspaceConfig],
    all_workspaces: bool,
) -> Option<Option<String>> {
    if all_workspaces {
        let workspace_key = workspaces.iter().find_map(|workspace| {
            workspace
                .project_instances
                .iter()
                .find(|instance| {
                    instance.project == status.project_key
                        && path_within(Path::new(&status.canonical_cwd), instance.path.as_path())
                })
                .map(|_| workspace.key.clone())
        });
        return Some(workspace_key);
    }
    let workspace = workspaces.first()?;
    if workspace.is_system() {
        return Some(None);
    }
    if !workspace.allows_project(&status.project_key) {
        return None;
    }
    if let Some(instance) = workspace
        .project_instances
        .iter()
        .find(|instance| instance.project == status.project_key)
    {
        return path_within(Path::new(&status.canonical_cwd), &instance.path)
            .then(|| Some(workspace.key.clone()));
    }
    Some(Some(workspace.key.clone()))
}

#[derive(Debug, Clone)]
struct ProxyArtifactContext {
    workspace_key: Option<String>,
    config_path: Option<String>,
    active: bool,
    ownership_verified: bool,
    detail: String,
}

fn collect_proxy_daemon_artifacts(
    paths: &ConfigPaths,
    workspaces: &[ProjectWorkspaceConfig],
    all_workspaces: bool,
    project_filter: Option<&str>,
    artifacts: &mut Vec<ManagedArtifactRecord>,
    references: &mut Vec<ArtifactReference>,
) {
    if project_filter.is_some() {
        return;
    }
    let runtime_dir = paths.dir.join("proxy-runtime");
    let Ok(entries) = fs::read_dir(&runtime_dir) else {
        return;
    };
    let mut files = entries
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.parent() == Some(runtime_dir.as_path()))
        .collect::<Vec<_>>();
    files.sort();

    let mut contexts = BTreeMap::<String, ProxyArtifactContext>::new();
    for path in &files {
        let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let Some(stem) = file_name
            .strip_prefix("proxy-")
            .and_then(|value| value.strip_suffix(".json"))
        else {
            continue;
        };
        let context = match inspect_proxy_daemon_artifact_state(path) {
            Ok(observation) => {
                let workspace_key = observation
                    .ownership_verified
                    .then(|| {
                        proxy_state_workspace_key(
                            &observation.state.config_path,
                            &observation.state.profile_id,
                            paths,
                            workspaces,
                        )
                    })
                    .flatten();
                ProxyArtifactContext {
                    workspace_key,
                    config_path: Some(observation.state.config_path.clone()),
                    active: observation.active,
                    ownership_verified: observation.ownership_verified,
                    detail: format!(
                        "profile={} pid={} compatible={}",
                        observation.state.profile_id,
                        observation.state.pid,
                        observation.version_compatible
                    ),
                }
            }
            Err(error) => ProxyArtifactContext {
                workspace_key: None,
                config_path: None,
                active: false,
                ownership_verified: false,
                detail: format!("无法验证 Proxy daemon state：{error}"),
            },
        };
        contexts.insert(stem.to_string(), context);
    }

    for path in files {
        let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let Some((kind, lifecycle, stem)) = proxy_artifact_file_kind(file_name) else {
            continue;
        };
        let context = stem.and_then(|stem| contexts.get(stem));
        if !proxy_artifact_in_scope(context, workspaces, all_workspaces, paths) {
            continue;
        }
        if kind == "proxyState"
            && let Some(context) = context
            && let Some(config_path) = context.config_path.as_deref()
        {
            references.push(reference(
                "proxyConfig",
                Path::new(config_path),
                "proxyDaemon",
                context.workspace_key.as_deref(),
                None,
                "Proxy daemon 状态仅证明配置引用关系，不代表配置文件可被清理",
            ));
        }
        let is_event_log = kind == "proxyEventLog";
        let workspace_key = context.and_then(|value| value.workspace_key.clone());
        let ownership_verified = if is_event_log {
            true
        } else {
            context.is_some_and(|value| value.ownership_verified)
        };
        let active = context.is_some_and(|value| value.active);
        let scope_path = context
            .and_then(|value| value.config_path.clone())
            .or_else(|| Some(runtime_dir.display().to_string()));
        let detail = context
            .map(|value| value.detail.clone())
            .unwrap_or_else(|| {
                if is_event_log {
                    "Proxy 请求事件历史位于 rDevTool 内部目录".to_string()
                } else {
                    "缺少可关联的 Proxy daemon state，归属保持未验证".to_string()
                }
            });
        artifacts.push(artifact_record(
            "proxyDaemon",
            ManagedArtifact {
                kind: kind.to_string(),
                path: path.display().to_string(),
                ownership: "rdevtool".to_string(),
                lifecycle: lifecycle.to_string(),
            },
            workspace_key,
            None,
            None,
            scope_path,
            active,
            ownership_verified,
            detail,
        ));
    }
}

fn proxy_artifact_file_kind(file_name: &str) -> Option<(&'static str, &'static str, Option<&str>)> {
    if let Some(stem) = file_name
        .strip_prefix("proxy-")
        .and_then(|value| value.strip_suffix(".json"))
    {
        return Some(("proxyState", "proxySession", Some(stem)));
    }
    if let Some(stem) = file_name
        .strip_prefix("proxy-")
        .and_then(|value| value.strip_suffix(".log"))
    {
        return Some(("proxyDaemonLog", "proxySession", Some(stem)));
    }
    if let Some(stem) = file_name
        .strip_prefix("proxy-")
        .and_then(|value| value.strip_suffix(".stop"))
    {
        return Some(("proxyStopRequest", "proxyControl", Some(stem)));
    }
    if let Some(stem) = file_name
        .strip_prefix("proxy-")
        .and_then(|value| value.strip_suffix(".lock"))
    {
        return Some(("proxyLock", "proxyControl", Some(stem)));
    }
    file_name
        .strip_prefix("events-")
        .and_then(|value| value.strip_suffix(".jsonl"))
        .map(|_| ("proxyEventLog", "proxyHistory", None))
}

fn proxy_state_workspace_key(
    config_path: &str,
    profile_id: &str,
    paths: &ConfigPaths,
    workspaces: &[ProjectWorkspaceConfig],
) -> Option<String> {
    if let Ok(config) = load_proxy_config(Path::new(config_path))
        && let Some(workspace_key) = config
            .profiles
            .iter()
            .find(|profile| profile.id == profile_id)
            .and_then(|profile| profile.workspace_key.clone())
    {
        return Some(workspace_key);
    }
    workspaces.iter().find_map(|workspace| {
        if workspace.is_system() {
            return None;
        }
        let key = normalize_project_workspace_key(&workspace.key)?;
        paths_equal(
            Path::new(config_path),
            &paths
                .dir
                .join("sources")
                .join("workspaces")
                .join(key)
                .join("proxy.toml"),
        )
        .then(|| workspace.key.clone())
    })
}

fn proxy_artifact_in_scope(
    context: Option<&ProxyArtifactContext>,
    workspaces: &[ProjectWorkspaceConfig],
    all_workspaces: bool,
    paths: &ConfigPaths,
) -> bool {
    if all_workspaces {
        return true;
    }
    let Some(workspace) = workspaces.first() else {
        return false;
    };
    if workspace.is_system() {
        return true;
    }
    if context
        .and_then(|value| value.workspace_key.as_deref())
        .is_some_and(|key| key == workspace.key)
    {
        return true;
    }
    let Some(config_path) = context.and_then(|value| value.config_path.as_deref()) else {
        return false;
    };
    let configured_source = workspace
        .metadata
        .get("configSource.proxy")
        .map(String::as_str);
    match configured_source {
        Some("default") | Some("global") => {
            paths_equal(Path::new(config_path), &paths.dir.join("proxy.toml"))
        }
        Some(source) if source == format!("workspace-{}", workspace.key).as_str() => {
            normalize_project_workspace_key(&workspace.key).is_some_and(|key| {
                paths_equal(
                    Path::new(config_path),
                    &paths
                        .dir
                        .join("sources")
                        .join("workspaces")
                        .join(key)
                        .join("proxy.toml"),
                )
            })
        }
        None => normalize_project_workspace_key(&workspace.key).is_some_and(|key| {
            paths_equal(
                Path::new(config_path),
                &paths
                    .dir
                    .join("sources")
                    .join("workspaces")
                    .join(key)
                    .join("proxy.toml"),
            )
        }),
        _ => false,
    }
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    fs::canonicalize(left).unwrap_or_else(|_| left.to_path_buf())
        == fs::canonicalize(right).unwrap_or_else(|_| right.to_path_buf())
}

fn artifact_record(
    source: &str,
    artifact: ManagedArtifact,
    workspace_key: Option<String>,
    project_key: Option<String>,
    run_id: Option<String>,
    scope_path: Option<String>,
    active: bool,
    ownership_verified: bool,
    detail: String,
) -> ManagedArtifactRecord {
    let path = Path::new(&artifact.path);
    let object_type = object_type(path);
    ManagedArtifactRecord {
        id: artifact_id(source, &artifact.kind, &artifact.path),
        source: source.to_string(),
        exists: path.exists(),
        ownership_verified: ownership_verified && object_type != "symlink",
        object_type,
        artifact,
        workspace_key,
        project_key,
        run_id,
        scope_path,
        active,
        detail,
    }
}

fn reference(
    kind: &str,
    path: &Path,
    source: &str,
    workspace_key: Option<&str>,
    project_key: Option<&str>,
    reason: &str,
) -> ArtifactReference {
    ArtifactReference {
        kind: kind.to_string(),
        path: path.display().to_string(),
        source: source.to_string(),
        workspace_key: workspace_key.map(ToString::to_string),
        project_key: project_key.map(ToString::to_string),
        exists: path.exists(),
        ownership: "referenced".to_string(),
        reason: reason.to_string(),
    }
}

fn cleanup_action(
    record: &ManagedArtifactRecord,
    all_records: &[ManagedArtifactRecord],
    paths: &ConfigPaths,
) -> ManagedArtifactCleanupAction {
    let (mut action, mut destructive) = match record.artifact.kind.as_str() {
        "workspaceConfig" => ("deleteWorkspace".to_string(), true),
        "workspaceProjectInstance" => ("removeWorkspaceProjectInstance".to_string(), true),
        "runtimeState" | "runtimeDaemonLog" => ("removeRuntimeSessionMetadata".to_string(), true),
        "runtimeLog" => ("clearRuntimeHistoryLog".to_string(), true),
        "proxyState" | "proxyDaemonLog" | "proxyStopRequest" | "proxyLock" => {
            ("removeProxySessionMetadata".to_string(), true)
        }
        "proxyEventLog" => ("clearProxyEventHistory".to_string(), true),
        _ => ("unsupported".to_string(), false),
    };
    let mut eligibility = "eligible".to_string();
    let mut reason = String::new();
    let mut prerequisites = Vec::new();
    if !record.exists {
        action = "skipMissing".to_string();
        destructive = false;
        reason = "路径当前不存在，无需执行文件删除".to_string();
    } else if record.object_type == "symlink" {
        eligibility = "blocked".to_string();
        reason = "符号链接不进入托管清理范围".to_string();
    } else if !record.ownership_verified {
        eligibility = "blocked".to_string();
        reason = "产物归属尚未验证".to_string();
    } else if record
        .workspace_key
        .as_deref()
        .is_some_and(|workspace_key| {
            load_project_workspace_by_key(&paths.project_workspaces, workspace_key)
                .is_ok_and(|workspace| workspace.is_archived())
        })
    {
        eligibility = "blocked".to_string();
        reason = "产物属于已归档工作区，恢复或永久删除工作区前必须保留".to_string();
        prerequisites.push("如需清理，请先恢复工作区并重新审阅清理计划".to_string());
    } else if record.active {
        eligibility = "blocked".to_string();
        reason = "产物仍被活动会话或当前工作区使用".to_string();
        prerequisites.push("先通过对应的受管命令停止会话或切换工作区".to_string());
    } else if record.exists {
        match record.artifact.kind.as_str() {
            "workspaceConfig" => {
                eligibility = "reviewRequired".to_string();
                reason = "工作区配置删除必须与项目实例、资源引用和当前激活状态协调".to_string();
                prerequisites.push("确认工作区不是当前激活工作区".to_string());
                prerequisites.push("先单独审阅所有 workspaceProjectInstance 计划".to_string());
            }
            "workspaceProjectInstance" => {
                let path = Path::new(&record.artifact.path);
                let workspace_root = record.workspace_key.as_deref().and_then(|workspace_key| {
                    load_project_workspace_by_key(&paths.project_workspaces, workspace_key)
                        .ok()
                        .and_then(|workspace| workspace.root_dir)
                });
                if workspace_root
                    .as_deref()
                    .is_none_or(|root| !is_direct_child(path, root))
                {
                    eligibility = "blocked".to_string();
                    reason = "项目实例不是工作区根目录下经过验证的直属目录".to_string();
                } else if all_records.iter().any(|candidate| {
                    candidate.active
                        && candidate.source == "runtimeDaemon"
                        && candidate
                            .scope_path
                            .as_deref()
                            .is_some_and(|cwd| path_within(Path::new(cwd), path))
                }) {
                    eligibility = "blocked".to_string();
                    reason = "项目实例仍有关联的活动 Runtime 产物".to_string();
                } else {
                    match working_tree_status(path) {
                        Ok(status) if status.clean => {
                            reason = "项目实例归属已验证，位于工作区直属目录且 Git 工作树干净"
                                .to_string();
                            prerequisites.push("再次确认分支不再需要".to_string());
                            prerequisites.push("移除工作区绑定后使用 Git-aware 清理".to_string());
                        }
                        Ok(_) => {
                            eligibility = "blocked".to_string();
                            reason = "Git 工作树存在未提交、未跟踪或冲突文件".to_string();
                        }
                        Err(error) => {
                            eligibility = "blocked".to_string();
                            reason = format!("无法验证 Git 工作树状态：{error}");
                        }
                    }
                }
            }
            "runtimeState" | "runtimeDaemonLog" => {
                reason = "Runtime 会话已停止，可清理对应的内部状态或 daemon 日志".to_string();
                prerequisites.push("重新确认同一 runId 未恢复运行".to_string());
            }
            "runtimeLog" => {
                eligibility = "reviewRequired".to_string();
                reason = "项目运行日志可能跨多个会话复用，清理会丢失历史诊断信息".to_string();
                prerequisites.push("确认不再需要该项目的历史运行日志".to_string());
            }
            "proxyState" | "proxyDaemonLog" | "proxyStopRequest" | "proxyLock" => {
                reason = "Proxy daemon 已停止，可评估对应的内部会话与控制文件".to_string();
                prerequisites.push("重新确认对应代理端口未由同一受管 daemon 恢复监听".to_string());
            }
            "proxyEventLog" => {
                eligibility = "reviewRequired".to_string();
                reason = "Proxy 请求事件日志可能包含仍需保留的联调诊断历史".to_string();
                prerequisites.push("确认不再需要该配置源的代理请求历史".to_string());
            }
            _ => {
                eligibility = "blocked".to_string();
                reason = "当前版本没有该产物类型的安全清理策略".to_string();
            }
        }
    }
    ManagedArtifactCleanupAction {
        artifact_id: record.id.clone(),
        kind: record.artifact.kind.clone(),
        path: record.artifact.path.clone(),
        action,
        eligibility,
        destructive,
        reason,
        prerequisites,
    }
}

fn artifact_query_command(action: &str, query: &ManagedArtifactQuery) -> String {
    let mut parts = vec![
        "rdevtool".to_string(),
        "--json".to_string(),
        "artifacts".to_string(),
        action.to_string(),
    ];
    if query.all_workspaces {
        parts.push("--all-workspaces".to_string());
    } else if let Some(workspace) = query.workspace.as_deref() {
        parts.push("--workspace".to_string());
        parts.push(shell_quote(workspace));
    }
    if let Some(project) = query.project.as_deref() {
        parts.push("--project".to_string());
        parts.push(shell_quote(project));
    }
    for kind in &query.kinds {
        parts.push("--kind".to_string());
        parts.push(shell_quote(kind));
    }
    parts.join(" ")
}

fn shell_quote(value: &str) -> String {
    if value
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || "-._:/".contains(character))
    {
        return value.to_string();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn kind_matches(kind: &str, normalized_kinds: &[String]) -> bool {
    normalized_kinds.is_empty()
        || normalized_kinds
            .iter()
            .any(|expected| expected == &kind.to_ascii_lowercase())
}

fn normalize_values(values: &[String]) -> Vec<String> {
    values
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn object_type(path: &Path) -> String {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => "symlink",
        Ok(metadata) if metadata.is_dir() => "directory",
        Ok(metadata) if metadata.is_file() => "file",
        Ok(_) => "other",
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => "missing",
        Err(_) => "unknown",
    }
    .to_string()
}

fn path_within(path: &Path, root: &Path) -> bool {
    let normalized_path = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let normalized_root = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    normalized_path == normalized_root || normalized_path.starts_with(normalized_root)
}

fn is_direct_child(path: &Path, root: &Path) -> bool {
    let Ok(path) = fs::canonicalize(path) else {
        return false;
    };
    let Ok(root) = fs::canonicalize(root) else {
        return false;
    };
    path.parent() == Some(root.as_path()) && path != root
}

fn artifact_id(source: &str, kind: &str, path: &str) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for value in [source, kind, path] {
        for byte in value.as_bytes().iter().copied().chain(std::iter::once(0)) {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    format!("artifact-{hash:016x}")
}

fn deduplicate_artifacts(artifacts: &mut Vec<ManagedArtifactRecord>) {
    let mut merged = BTreeMap::<(String, String), ManagedArtifactRecord>::new();
    for record in artifacts.drain(..) {
        let key = (record.artifact.kind.clone(), record.artifact.path.clone());
        merged
            .entry(key)
            .and_modify(|current| {
                current.active |= record.active;
                current.exists |= record.exists;
                if current.run_id.is_none() {
                    current.run_id = record.run_id.clone();
                }
                if current.scope_path.is_none() {
                    current.scope_path = record.scope_path.clone();
                }
            })
            .or_insert(record);
    }
    artifacts.extend(merged.into_values());
}

fn deduplicate_references(references: &mut Vec<ArtifactReference>) {
    let mut seen = BTreeSet::new();
    references.retain(|reference| {
        seen.insert((
            reference.kind.clone(),
            reference.path.clone(),
            reference.workspace_key.clone(),
            reference.project_key.clone(),
        ))
    });
}

#[cfg(test)]
mod tests {
    use super::{
        ArtifactReference, ManagedArtifactCleanupQuery, ManagedArtifactInventoryEffective,
        ManagedArtifactInventoryObserved, ManagedArtifactInventoryRequested,
        ManagedArtifactInventoryResponse, ManagedArtifactInventorySummary, ManagedArtifactQuery,
        ManagedArtifactRecord, cleanup_action, cleanup_plan_status, managed_artifact_cleanup_plan,
        managed_artifact_context_summary, managed_artifact_inventory_with_runtime_statuses,
    };
    use crate::config::{
        AppConfig, ConfigPaths, ProjectWorkspaceArchiveConfig, ProjectWorkspaceConfig,
        ProjectWorkspaceProjectInstanceConfig, WorkspaceAppConfig, WorkspaceConfig,
        save_project_workspace_config, save_workspace_config,
    };
    use crate::operation::{
        ManagedArtifact, OperationEvidence, OperationRisk, OperationStatus, RecommendedAction,
    };
    use crate::proxy::{ProxyConfig, ProxyProfile, save_proxy_config};
    use crate::proxy_daemon::{ProxyDaemonState, proxy_daemon_state_path_in};
    use crate::runtime_daemon::RuntimeDaemonStatus;
    use serde_json::json;
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;

    fn test_paths() -> (PathBuf, ConfigPaths) {
        let dir = std::env::temp_dir().join(format!(
            "rdevtool-managed-artifacts-{}",
            uuid::Uuid::new_v4()
        ));
        let paths = ConfigPaths {
            projects: dir.join("projects.toml"),
            workspace: dir.join("workspace.toml"),
            project_workspaces: dir.join("workspaces"),
            dir: dir.clone(),
        };
        fs::create_dir_all(&paths.project_workspaces).unwrap();
        (dir, paths)
    }

    fn empty_config() -> AppConfig {
        serde_json::from_value(json!({
            "defaults": {},
            "projects": []
        }))
        .unwrap()
    }

    fn workspace(
        root: &std::path::Path,
        managed_path: &std::path::Path,
        referenced_path: &std::path::Path,
    ) -> ProjectWorkspaceConfig {
        ProjectWorkspaceConfig {
            key: "feature-a".to_string(),
            name: "Feature A".to_string(),
            description: None,
            archive: None,
            workspace_type: "business".to_string(),
            metadata: BTreeMap::new(),
            root_dir: Some(root.to_path_buf()),
            resource_dir: Some(root.join("resources")),
            worklog_file: Some(PathBuf::from("WORKLOG.md")),
            worklog_auto_record: true,
            include_all_projects: false,
            include_all_navigation: false,
            projects: vec!["demo".to_string(), "existing".to_string()],
            navigation_categories: Vec::new(),
            navigation_entries: Vec::new(),
            project_instances: vec![
                ProjectWorkspaceProjectInstanceConfig {
                    project: "demo".to_string(),
                    path: managed_path.to_path_buf(),
                    managed: true,
                },
                ProjectWorkspaceProjectInstanceConfig {
                    project: "existing".to_string(),
                    path: referenced_path.to_path_buf(),
                    managed: false,
                },
            ],
            resource_categories: Vec::new(),
        }
    }

    #[test]
    fn inventory_keeps_managed_instances_separate_from_references() {
        let (dir, paths) = test_paths();
        let root = dir.join("feature-a");
        let managed_path = root.join("demo");
        let referenced_path = dir.join("existing");
        fs::create_dir_all(&managed_path).unwrap();
        fs::create_dir_all(&referenced_path).unwrap();
        let workspace = workspace(&root, &managed_path, &referenced_path);
        save_project_workspace_config(&paths.project_workspaces.join("feature-a.toml"), &workspace)
            .unwrap();
        save_workspace_config(
            &paths.workspace,
            &WorkspaceConfig {
                app: WorkspaceAppConfig {
                    active_workspace: Some("feature-a".to_string()),
                    ..WorkspaceAppConfig::default()
                },
            },
        )
        .unwrap();

        let response = managed_artifact_inventory_with_runtime_statuses(
            &empty_config(),
            &paths,
            &ManagedArtifactQuery::default(),
            Vec::new(),
        )
        .unwrap();

        assert!(response.observed.artifacts.iter().any(|record| {
            record.artifact.kind == "workspaceProjectInstance"
                && record.artifact.path == managed_path.display().to_string()
        }));
        assert!(
            !response
                .observed
                .artifacts
                .iter()
                .any(|record| { record.artifact.path == referenced_path.display().to_string() })
        );
        assert!(response.observed.references.iter().any(|reference| {
            reference.kind == "workspaceProjectInstance"
                && reference.path == referenced_path.display().to_string()
                && reference.ownership == "referenced"
        }));
        assert!(
            response
                .observed
                .references
                .iter()
                .any(|reference| { reference.kind == "workspaceRoot" })
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn agent_context_summary_is_read_only_and_omits_artifact_paths() {
        let (dir, paths) = test_paths();
        let root = dir.join("feature-a");
        let managed_path = root.join("demo");
        let referenced_path = dir.join("existing");
        fs::create_dir_all(&managed_path).unwrap();
        fs::create_dir_all(&referenced_path).unwrap();
        let workspace = workspace(&root, &managed_path, &referenced_path);
        save_project_workspace_config(&paths.project_workspaces.join("feature-a.toml"), &workspace)
            .unwrap();
        save_workspace_config(
            &paths.workspace,
            &WorkspaceConfig {
                app: WorkspaceAppConfig {
                    active_workspace: Some("feature-a".to_string()),
                    ..WorkspaceAppConfig::default()
                },
            },
        )
        .unwrap();

        let response = managed_artifact_context_summary(
            &empty_config(),
            &paths,
            &ManagedArtifactQuery {
                workspace: Some("feature-a".to_string()),
                project: Some("demo".to_string()),
                ..ManagedArtifactQuery::default()
            },
        )
        .unwrap();
        let json = serde_json::to_string(&response).unwrap();

        assert!(!response.effective.execution_supported);
        assert_eq!(response.observed.summary.artifact_count, 1);
        assert_eq!(response.observed.summary.managed_count, 1);
        assert!(
            response
                .observed
                .by_kind
                .iter()
                .any(|summary| summary.kind == "workspaceProjectInstance")
        );
        assert!(!json.contains(&managed_path.display().to_string()));
        assert!(!json.contains(&referenced_path.display().to_string()));
        assert_eq!(response.recommended_actions.len(), 1);
        assert_eq!(response.recommended_actions[0].risk, "readOnly");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn inventory_json_contract_matches_fixture() {
        let artifact = ManagedArtifact {
            kind: "runtimeState".to_string(),
            path: "/config/runtime-daemon/demo.state.json".to_string(),
            ownership: "rdevtool".to_string(),
            lifecycle: "runtimeSession".to_string(),
        };
        let response = ManagedArtifactInventoryResponse {
            schema_version: 1,
            requested: ManagedArtifactInventoryRequested {
                workspace: Some("feature-a".to_string()),
                all_workspaces: false,
                project: Some("demo".to_string()),
                kinds: vec!["runtimeState".to_string()],
            },
            effective: ManagedArtifactInventoryEffective {
                workspace_keys: vec!["feature-a".to_string()],
                project: Some("demo".to_string()),
                kinds: vec!["runtimestate".to_string()],
                collectors: vec!["workspaceConfig".to_string(), "runtimeDaemon".to_string()],
            },
            observed: ManagedArtifactInventoryObserved {
                artifacts: vec![ManagedArtifactRecord {
                    id: "artifact-demo".to_string(),
                    source: "runtimeDaemon".to_string(),
                    artifact: artifact.clone(),
                    workspace_key: Some("feature-a".to_string()),
                    project_key: Some("demo".to_string()),
                    run_id: Some("run-1".to_string()),
                    scope_path: Some("/workspace/demo".to_string()),
                    exists: true,
                    object_type: "file".to_string(),
                    active: false,
                    ownership_verified: true,
                    detail: "stopped runtime state".to_string(),
                }],
                references: vec![ArtifactReference {
                    kind: "workspaceRoot".to_string(),
                    path: "/workspace".to_string(),
                    source: "workspaceConfig".to_string(),
                    workspace_key: Some("feature-a".to_string()),
                    project_key: None,
                    exists: true,
                    ownership: "referenced".to_string(),
                    reason: "creation ownership is not persisted".to_string(),
                }],
                summary: ManagedArtifactInventorySummary {
                    artifact_count: 1,
                    existing_count: 1,
                    missing_count: 0,
                    active_count: 0,
                    reference_count: 1,
                },
            },
            status: OperationStatus {
                key: "observed".to_string(),
                label: "托管产物已盘点".to_string(),
                success: true,
                terminal: true,
                detail: "发现 1 条托管产物和 1 条非托管引用".to_string(),
            },
            evidence: vec![OperationEvidence {
                kind: "runtime".to_string(),
                source: "runtimeDaemon.state".to_string(),
                detail: "state ownership verified".to_string(),
            }],
            risks: vec![OperationRisk {
                code: "unmanaged_references_present".to_string(),
                severity: "info".to_string(),
                detail: "1 reference is not managed".to_string(),
            }],
            managed_artifacts: vec![artifact],
            recommended_actions: vec![RecommendedAction {
                command: "rdevtool --json artifacts cleanup-plan --workspace feature-a --project demo --kind runtimeState".to_string(),
                reason: "generate a read-only plan".to_string(),
                risk: "readOnly".to_string(),
            }],
        };
        let actual = serde_json::to_value(response).unwrap();
        let expected: serde_json::Value = serde_json::from_str(include_str!(
            "../tests/fixtures/managed-artifact-inventory.json"
        ))
        .unwrap();
        assert_eq!(actual, expected);
    }

    #[test]
    fn cleanup_plan_blocks_active_runtime_metadata() {
        let (dir, paths) = test_paths();
        let state_path = dir.join("runtime-daemon/runtime.state.json");
        fs::create_dir_all(state_path.parent().unwrap()).unwrap();
        fs::write(&state_path, "{}").unwrap();
        let record = super::artifact_record(
            "runtimeDaemon",
            crate::operation::ManagedArtifact {
                kind: "runtimeState".to_string(),
                path: state_path.display().to_string(),
                ownership: "rdevtool".to_string(),
                lifecycle: "runtimeSession".to_string(),
            },
            None,
            Some("demo".to_string()),
            Some("run-1".to_string()),
            Some("/workspace/demo".to_string()),
            true,
            true,
            "running".to_string(),
        );
        let action = cleanup_action(&record, std::slice::from_ref(&record), &paths);
        assert_eq!(action.eligibility, "blocked");
        assert_eq!(action.action, "removeRuntimeSessionMetadata");
        assert!(action.destructive);
        assert!(!action.reason.is_empty());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn missing_explicit_artifact_id_has_priority_over_empty_selection() {
        let (key, _, _) = cleanup_plan_status(0, 1, 0);
        assert_eq!(key, "missingArtifacts");
    }

    #[cfg(unix)]
    #[test]
    fn symlink_candidate_never_has_verified_cleanup_ownership() {
        use std::os::unix::fs::symlink;

        let (dir, paths) = test_paths();
        let target = dir.join("target");
        let link = dir.join("linked-instance");
        fs::create_dir_all(&target).unwrap();
        symlink(&target, &link).unwrap();
        let record = super::artifact_record(
            "workspaceConfig",
            ManagedArtifact {
                kind: "workspaceProjectInstance".to_string(),
                path: link.display().to_string(),
                ownership: "rdevtool".to_string(),
                lifecycle: "workspace".to_string(),
            },
            Some("feature-a".to_string()),
            Some("demo".to_string()),
            None,
            Some(link.display().to_string()),
            false,
            true,
            "managed flag".to_string(),
        );
        assert!(!record.ownership_verified);
        let action = cleanup_action(&record, std::slice::from_ref(&record), &paths);
        assert_eq!(action.eligibility, "blocked");
        assert!(action.reason.contains("符号链接"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn workspace_instance_cleanup_requires_direct_child_and_clean_git() {
        let (dir, paths) = test_paths();
        let root = dir.join("feature-a");
        let instance = root.join("demo");
        fs::create_dir_all(&instance).unwrap();
        let workspace = workspace(&root, &instance, &dir.join("existing"));
        save_project_workspace_config(&paths.project_workspaces.join("feature-a.toml"), &workspace)
            .unwrap();
        let git = |args: &[&str]| {
            let status = Command::new("git")
                .args(args)
                .current_dir(&instance)
                .status()
                .unwrap();
            assert!(status.success(), "git command failed: {args:?}");
        };
        git(&["init"]);
        fs::write(instance.join("README.md"), "demo\n").unwrap();
        git(&["add", "README.md"]);
        git(&[
            "-c",
            "user.name=rDevTool Test",
            "-c",
            "user.email=rdevtool@example.invalid",
            "commit",
            "-m",
            "initial",
        ]);
        let record = super::artifact_record(
            "workspaceConfig",
            ManagedArtifact {
                kind: "workspaceProjectInstance".to_string(),
                path: instance.display().to_string(),
                ownership: "rdevtool".to_string(),
                lifecycle: "workspace".to_string(),
            },
            Some("feature-a".to_string()),
            Some("demo".to_string()),
            None,
            Some(instance.display().to_string()),
            false,
            true,
            "managed".to_string(),
        );
        let clean_action = cleanup_action(&record, std::slice::from_ref(&record), &paths);
        assert_eq!(clean_action.eligibility, "eligible");
        assert_eq!(clean_action.action, "removeWorkspaceProjectInstance");

        fs::write(instance.join("untracked.txt"), "do not delete\n").unwrap();
        let dirty_action = cleanup_action(&record, std::slice::from_ref(&record), &paths);
        assert_eq!(dirty_action.eligibility, "blocked");
        assert!(dirty_action.reason.contains("Git 工作树"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn archived_workspace_artifacts_are_never_cleanup_eligible() {
        let (dir, paths) = test_paths();
        let root = dir.join("feature-a");
        let instance = root.join("demo");
        fs::create_dir_all(&instance).unwrap();
        let mut workspace = workspace(&root, &instance, &dir.join("existing"));
        workspace.archive = Some(ProjectWorkspaceArchiveConfig {
            archived_at: "2026-07-28T08:00:00Z".to_string(),
            reason: Some("shipped".to_string()),
        });
        save_project_workspace_config(&paths.project_workspaces.join("feature-a.toml"), &workspace)
            .unwrap();

        let record = super::artifact_record(
            "workspaceConfig",
            ManagedArtifact {
                kind: "workspaceProjectInstance".to_string(),
                path: instance.display().to_string(),
                ownership: "rdevtool".to_string(),
                lifecycle: "workspace".to_string(),
            },
            Some("feature-a".to_string()),
            Some("demo".to_string()),
            None,
            Some(instance.display().to_string()),
            false,
            true,
            "managed".to_string(),
        );

        let action = cleanup_action(&record, std::slice::from_ref(&record), &paths);
        assert_eq!(action.eligibility, "blocked");
        assert!(action.reason.contains("已归档工作区"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn runtime_status_outside_selected_workspace_instance_is_not_collected() {
        let (dir, paths) = test_paths();
        let root = dir.join("feature-a");
        let managed_path = root.join("demo");
        let other_path = dir.join("other-demo");
        fs::create_dir_all(&managed_path).unwrap();
        fs::create_dir_all(&other_path).unwrap();
        let workspace = workspace(&root, &managed_path, &dir.join("existing"));
        save_project_workspace_config(&paths.project_workspaces.join("feature-a.toml"), &workspace)
            .unwrap();
        save_workspace_config(
            &paths.workspace,
            &WorkspaceConfig {
                app: WorkspaceAppConfig {
                    active_workspace: Some("feature-a".to_string()),
                    ..WorkspaceAppConfig::default()
                },
            },
        )
        .unwrap();
        let status = RuntimeDaemonStatus {
            status_key: "demo".to_string(),
            phase_key: "stopped".to_string(),
            project_key: "demo".to_string(),
            canonical_cwd: other_path.display().to_string(),
            state_path: dir
                .join("runtime-daemon/demo.state.json")
                .display()
                .to_string(),
            running: false,
            managed: false,
            version_compatible: true,
            daemon_alive: false,
            worker_group_alive: false,
            local_proxy_group_alive: false,
            detail: "stopped".to_string(),
            state: None,
        };

        let response = managed_artifact_inventory_with_runtime_statuses(
            &empty_config(),
            &paths,
            &ManagedArtifactQuery::default(),
            vec![status],
        )
        .unwrap();
        assert!(
            !response
                .observed
                .artifacts
                .iter()
                .any(|record| { record.source == "runtimeDaemon" })
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn inventory_collects_verified_proxy_daemon_state_and_log() {
        let (dir, paths) = test_paths();
        let root = dir.join("feature-a");
        let managed_path = root.join("demo");
        fs::create_dir_all(&managed_path).unwrap();
        let workspace = workspace(&root, &managed_path, &dir.join("existing"));
        save_project_workspace_config(&paths.project_workspaces.join("feature-a.toml"), &workspace)
            .unwrap();
        save_workspace_config(
            &paths.workspace,
            &WorkspaceConfig {
                app: WorkspaceAppConfig {
                    active_workspace: Some("feature-a".to_string()),
                    ..WorkspaceAppConfig::default()
                },
            },
        )
        .unwrap();

        let config_path = dir.join("proxy.toml");
        let profile = ProxyProfile {
            id: "feature-proxy".to_string(),
            name: "Feature Proxy".to_string(),
            workspace_key: Some("feature-a".to_string()),
            ..ProxyProfile::default()
        };
        save_proxy_config(
            &config_path,
            &ProxyConfig {
                profiles: vec![profile.clone()],
                rules: Vec::new(),
            },
        )
        .unwrap();
        let runtime_dir = dir.join("proxy-runtime");
        fs::create_dir_all(&runtime_dir).unwrap();
        let state_path = proxy_daemon_state_path_in(&runtime_dir, &config_path, &profile.id);
        fs::write(
            &state_path,
            serde_json::to_vec_pretty(&ProxyDaemonState {
                schema_version: 1,
                protocol_version: 1,
                app_version: env!("CARGO_PKG_VERSION").to_string(),
                pid: std::process::id(),
                profile_id: profile.id.clone(),
                config_path: config_path.display().to_string(),
                listen_url: profile.listen_url(),
                started_at: "test".to_string(),
                executable: "/tmp/rdevtool".to_string(),
            })
            .unwrap(),
        )
        .unwrap();
        fs::write(state_path.with_extension("log"), "proxy log\n").unwrap();

        let response = managed_artifact_inventory_with_runtime_statuses(
            &empty_config(),
            &paths,
            &ManagedArtifactQuery::default(),
            Vec::new(),
        )
        .unwrap();
        let proxy_records = response
            .observed
            .artifacts
            .iter()
            .filter(|record| record.source == "proxyDaemon")
            .collect::<Vec<_>>();
        assert_eq!(proxy_records.len(), 2);
        assert!(proxy_records.iter().all(|record| record.ownership_verified));
        assert!(proxy_records.iter().all(|record| {
            record.workspace_key.as_deref() == Some("feature-a") && !record.active
        }));
        assert!(
            proxy_records
                .iter()
                .any(|record| record.artifact.kind == "proxyState")
        );
        assert!(
            proxy_records
                .iter()
                .any(|record| record.artifact.kind == "proxyDaemonLog")
        );
        assert!(
            response
                .effective
                .collectors
                .contains(&"proxyDaemon".to_string())
        );
        assert!(response.observed.references.iter().any(|reference| {
            reference.kind == "proxyConfig" && reference.path == config_path.display().to_string()
        }));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn proxy_event_history_requires_review_in_cleanup_plan() {
        let (dir, paths) = test_paths();
        let events_path = dir.join("proxy-runtime/events-1234567890abcdef.jsonl");
        fs::create_dir_all(events_path.parent().unwrap()).unwrap();
        fs::write(&events_path, "{}\n").unwrap();
        let record = super::artifact_record(
            "proxyDaemon",
            ManagedArtifact {
                kind: "proxyEventLog".to_string(),
                path: events_path.display().to_string(),
                ownership: "rdevtool".to_string(),
                lifecycle: "proxyHistory".to_string(),
            },
            None,
            None,
            None,
            Some(dir.display().to_string()),
            false,
            true,
            "events".to_string(),
        );

        let action = cleanup_action(&record, std::slice::from_ref(&record), &paths);
        assert_eq!(action.action, "clearProxyEventHistory");
        assert_eq!(action.eligibility, "reviewRequired");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn cleanup_plan_does_not_promote_unverified_proxy_files_to_managed_artifacts() {
        let (dir, paths) = test_paths();
        save_workspace_config(
            &paths.workspace,
            &WorkspaceConfig {
                app: WorkspaceAppConfig {
                    active_workspace: Some("system".to_string()),
                    ..WorkspaceAppConfig::default()
                },
            },
        )
        .unwrap();
        let orphan_log = dir.join("proxy-runtime/proxy-1234567890abcdef.log");
        fs::create_dir_all(orphan_log.parent().unwrap()).unwrap();
        fs::write(&orphan_log, "orphan\n").unwrap();

        let response = managed_artifact_cleanup_plan(
            &empty_config(),
            &paths,
            &ManagedArtifactCleanupQuery {
                inventory: ManagedArtifactQuery {
                    kinds: vec!["proxyDaemonLog".to_string()],
                    ..ManagedArtifactQuery::default()
                },
                artifact_ids: Vec::new(),
            },
        )
        .unwrap();

        assert_eq!(response.observed.blocked_count, 1);
        assert!(response.managed_artifacts.is_empty());
        assert!(!response.effective.execution_supported);
        fs::remove_dir_all(dir).unwrap();
    }
}
