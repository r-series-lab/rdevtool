use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::{Value, json};

use crate::storage::{DeployHistoryEntry, MergeHistoryEntry};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayAction {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub project_key: String,
    pub project_name: String,
    pub risk_level: String,
    pub preview_command: ReplayCommand,
    pub run_command: ReplayCommand,
    pub request: Value,
    pub source: ReplaySource,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayCommand {
    pub executable: String,
    pub args: Vec<String>,
    pub display: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaySource {
    pub history_key: String,
    pub created_at: String,
    pub updated_at: Option<String>,
}

pub fn replay_actions_from_history(
    build_history: &[DeployHistoryEntry],
    merge_history: &[MergeHistoryEntry],
    limit: usize,
) -> Vec<ReplayAction> {
    build_history
        .iter()
        .filter_map(build_replay_action)
        .chain(merge_history.iter().filter_map(merge_replay_action))
        .take(limit)
        .collect()
}

pub fn build_replay_action(entry: &DeployHistoryEntry) -> Option<ReplayAction> {
    let project_key = non_empty(&entry.project_key)?;
    let target = non_empty(&entry.mode)?;
    let mut request = json!({
        "project": project_key,
        "target": target,
        "variant": false,
        "params": params_to_map(&entry.params),
    });
    if let Some(env) = non_empty(&entry.env) {
        request["env"] = json!(env);
    }
    if let Some(branch) = non_empty(&entry.branch) {
        request["branch"] = json!(branch);
    }

    let mut preview_args = vec![
        "--json".to_string(),
        "history".to_string(),
        "replay-plan".to_string(),
        format!("build:{}", entry.history_key),
    ];
    let mut run_args = preview_args.clone();
    run_args[2] = "replay-run".to_string();
    let preview_command = replay_command(std::mem::take(&mut preview_args));
    let run_command = replay_command(run_args);
    let label = compact_join(
        "构建/部署",
        [
            Some(entry.project_name.as_str()),
            Some(target),
            non_empty(&entry.env),
            non_empty(&entry.branch),
        ],
    );

    Some(ReplayAction {
        id: format!("build:{}", entry.history_key),
        kind: "build".to_string(),
        label,
        project_key: project_key.to_string(),
        project_name: entry.project_name.clone(),
        risk_level: "high".to_string(),
        preview_command,
        run_command,
        request,
        source: ReplaySource {
            history_key: entry.history_key.clone(),
            created_at: entry.created_at.clone(),
            updated_at: Some(entry.updated_at.clone()),
        },
    })
}

pub fn merge_replay_action(entry: &MergeHistoryEntry) -> Option<ReplayAction> {
    let project_key = non_empty(&entry.project_key)?;
    let source_branch = non_empty(&entry.source_branch)?;
    let target_branch = non_empty(&entry.target_branch)?;
    let request = json!({
        "project": project_key,
        "sourceBranch": source_branch,
        "targetBranch": target_branch,
    });
    let preview_command = replay_command(vec![
        "--json".to_string(),
        "history".to_string(),
        "replay-plan".to_string(),
        format!("merge:{}", entry.history_key),
    ]);
    let run_command = replay_command(vec![
        "--json".to_string(),
        "history".to_string(),
        "replay-run".to_string(),
        format!("merge:{}", entry.history_key),
    ]);
    let label = compact_join(
        "分支合并",
        [
            Some(entry.project_name.as_str()),
            Some(source_branch),
            Some(target_branch),
            Some(if entry.success {
                "上次成功"
            } else {
                "上次失败"
            }),
        ],
    );

    Some(ReplayAction {
        id: format!("merge:{}", entry.history_key),
        kind: "merge".to_string(),
        label,
        project_key: project_key.to_string(),
        project_name: entry.project_name.clone(),
        risk_level: "high".to_string(),
        preview_command,
        run_command,
        request,
        source: ReplaySource {
            history_key: entry.history_key.clone(),
            created_at: entry.created_at.clone(),
            updated_at: None,
        },
    })
}

pub fn replay_kind_and_history_key(id: &str) -> Option<(&str, &str)> {
    let (kind, history_key) = id.split_once(':')?;
    let kind = kind.trim();
    let history_key = history_key.trim();
    if kind.is_empty() || history_key.is_empty() {
        return None;
    }
    Some((kind, history_key))
}

fn replay_command(args: Vec<String>) -> ReplayCommand {
    let executable = "rdevtool".to_string();
    ReplayCommand {
        display: command_display(&executable, &args),
        executable,
        args,
    }
}

fn params_to_map(value: &Value) -> BTreeMap<String, String> {
    let Some(values) = value.as_object() else {
        return BTreeMap::new();
    };
    values
        .iter()
        .map(|(key, value)| (key.clone(), json_value_to_string(value)))
        .collect()
}

fn json_value_to_string(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        Value::Null => String::new(),
        Value::Bool(_) | Value::Number(_) => value.to_string(),
        _ => serde_json::to_string(value).unwrap_or_default(),
    }
}

fn non_empty(value: &str) -> Option<&str> {
    let value = value.trim();
    (!value.is_empty()).then_some(value)
}

fn compact_join<'a>(prefix: &str, parts: impl IntoIterator<Item = Option<&'a str>>) -> String {
    let mut values = vec![prefix.to_string()];
    values.extend(
        parts
            .into_iter()
            .flatten()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string),
    );
    values.join(" · ")
}

fn command_display(executable: &str, args: &[String]) -> String {
    std::iter::once(executable)
        .chain(args.iter().map(String::as_str))
        .map(shell_quote)
        .collect::<Vec<_>>()
        .join(" ")
}

fn shell_quote(value: &str) -> String {
    if value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '/' | ':' | '='))
    {
        return value.to_string();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}
