use clap::ValueEnum;
use rdevtool_core::core::{BuildStatusResponse, BuildTriggerResponse, DeployPlan};
use rdevtool_core::storage::DeployHistoryEntry;
use serde::Serialize;
use serde_json::{Map, Value, json};

use crate::ProjectWorkspaceCliInfo;

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum BuildStatusField {
    State,
    Url,
    Commit,
    QueueUrl,
    BuildUrl,
    Detail,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompactWorkspace {
    key: String,
    name: String,
    active: bool,
    system: bool,
    archived: bool,
    kind: String,
    workspace_type: String,
    project_count: usize,
    root_dir: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompactBuildExecution {
    operation_id: String,
    plan_hash: String,
    effective: CompactBuildEffective,
    queue_url: Option<String>,
    build_url: Option<String>,
    state: String,
    state_label: String,
    history_key: String,
    commit: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CompactBuildEffective {
    target: String,
    env: Option<String>,
    branch: Option<String>,
    params: std::collections::BTreeMap<String, String>,
}

pub(crate) fn compact_workspaces(workspaces: &[ProjectWorkspaceCliInfo]) -> Vec<CompactWorkspace> {
    workspaces
        .iter()
        .map(|workspace| CompactWorkspace {
            key: workspace.key.clone(),
            name: workspace.name.clone(),
            active: workspace.active,
            system: workspace.system,
            archived: workspace.archived,
            kind: workspace.workspace_kind.clone(),
            workspace_type: workspace.workspace_type.clone(),
            project_count: workspace.project_count,
            root_dir: workspace.root_dir.clone(),
        })
        .collect()
}

pub(crate) fn compact_build_execution(
    trigger: &BuildTriggerResponse,
    operation_id: &str,
    history_key: &str,
    final_status: Option<&BuildStatusResponse>,
) -> CompactBuildExecution {
    let status = final_status.map(|status| {
        (
            status
                .queue_url
                .clone()
                .or_else(|| trigger.queue_url.clone()),
            status
                .build_url
                .clone()
                .or_else(|| trigger.build_url.clone()),
            status.state_key.clone(),
            status.state_label.clone(),
            status.commit.clone(),
        )
    });
    let (queue_url, build_url, state, state_label, status_commit) = status.unwrap_or_else(|| {
        (
            trigger.queue_url.clone(),
            trigger.build_url.clone(),
            trigger.state_key.clone(),
            trigger.state_label.clone(),
            None,
        )
    });
    let plan_commit = trigger
        .plan
        .observed
        .commit
        .as_ref()
        .map(|commit| commit.short_hash.clone());

    CompactBuildExecution {
        operation_id: operation_id.to_string(),
        plan_hash: effective_plan_hash(&trigger.plan),
        effective: CompactBuildEffective {
            target: trigger.plan.effective.target.clone(),
            env: trigger.plan.effective.env.clone(),
            branch: trigger.plan.effective.branch.clone(),
            params: trigger.plan.effective.params.clone(),
        },
        queue_url,
        build_url,
        state,
        state_label,
        history_key: history_key.to_string(),
        commit: status_commit.or(plan_commit),
    }
}

pub(crate) fn project_build_status(
    status: &BuildStatusResponse,
    fields: &[BuildStatusField],
) -> Value {
    let selected = if fields.is_empty() {
        vec![
            BuildStatusField::State,
            BuildStatusField::Url,
            BuildStatusField::Commit,
        ]
    } else {
        fields.to_vec()
    };
    let mut output = Map::new();
    for field in selected {
        match field {
            BuildStatusField::State => {
                output.insert("state".to_string(), json!(status.state_key));
            }
            BuildStatusField::Url => {
                output.insert(
                    "url".to_string(),
                    json!(status.build_url.as_ref().or(status.queue_url.as_ref())),
                );
            }
            BuildStatusField::Commit => {
                output.insert("commit".to_string(), json!(status.commit));
            }
            BuildStatusField::QueueUrl => {
                output.insert("queueUrl".to_string(), json!(status.queue_url));
            }
            BuildStatusField::BuildUrl => {
                output.insert("buildUrl".to_string(), json!(status.build_url));
            }
            BuildStatusField::Detail => {
                output.insert("detail".to_string(), json!(status.detail));
            }
        }
    }
    Value::Object(output)
}

pub(crate) fn filter_build_history(
    items: Vec<DeployHistoryEntry>,
    env: Option<&str>,
    latest: bool,
    limit: usize,
) -> Vec<DeployHistoryEntry> {
    let env = env.map(str::trim).filter(|value| !value.is_empty());
    items
        .into_iter()
        .filter(|item| env.is_none_or(|env| item.env.eq_ignore_ascii_case(env)))
        .take(if latest { 1 } else { limit.clamp(1, 500) })
        .collect()
}

fn effective_plan_hash(plan: &DeployPlan) -> String {
    let payload = json!({
        "projectKey": plan.project_key,
        "adapter": plan.adapter,
        "actionKind": plan.action_kind,
        "jobKind": plan.job_kind,
        "jobName": plan.job_name,
        "triggerUrl": plan.trigger_url,
        "params": plan.params,
        "command": plan.command,
        "cwd": plan.cwd,
        "outputDir": plan.output_dir,
    });
    let bytes = serde_json::to_vec(&payload).unwrap_or_default();
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("plan-{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::filter_build_history;
    use rdevtool_core::storage::DeployHistoryEntry;
    use serde_json::Value;

    fn history(env: &str, key: &str) -> DeployHistoryEntry {
        DeployHistoryEntry {
            history_key: key.to_string(),
            workspace_key: None,
            project_instance_path: None,
            project_key: "demo".to_string(),
            project_name: "Demo".to_string(),
            mode: "standard".to_string(),
            env: env.to_string(),
            branch: String::new(),
            state_key: "success".to_string(),
            state_label: "成功".to_string(),
            detail: String::new(),
            queue_url: None,
            build_url: None,
            params: Value::Null,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn filters_history_before_applying_latest() {
        let items = vec![
            history("uat", "newest"),
            history("dc2", "wanted"),
            history("dc2", "older"),
        ];
        let filtered = filter_build_history(items, Some("dc2"), true, 12);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].history_key, "wanted");
    }
}
