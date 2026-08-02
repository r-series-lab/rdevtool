use std::collections::{BTreeMap, BTreeSet};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::config::{AppConfig, DeployParamKind};
use crate::core::DeployRequest;
use crate::storage::{DeployHistoryEntry, MergeHistoryEntry};

#[derive(Debug, Clone, Deserialize, Serialize)]
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

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayCommand {
    pub executable: String,
    pub args: Vec<String>,
    pub display: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaySource {
    pub history_key: String,
    pub created_at: String,
    pub updated_at: Option<String>,
}

#[derive(Debug)]
pub struct ReplayBranchConflict {
    pub structured_branch: Option<String>,
    pub raw_branches: BTreeMap<String, String>,
    pub alternative_commands: Vec<String>,
}

impl std::fmt::Display for ReplayBranchConflict {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let structured = self.structured_branch.as_deref().unwrap_or("<empty>");
        let raw = self
            .raw_branches
            .iter()
            .map(|(key, value)| format!("{key}={value}"))
            .collect::<Vec<_>>()
            .join(", ");
        write!(
            formatter,
            "历史回放分支冲突：structured branch={structured}，raw params=[{raw}]。一次性替代命令：{}",
            self.alternative_commands.join(" | ")
        )
    }
}

impl std::error::Error for ReplayBranchConflict {}

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

#[cfg(test)]
mod history_identity_tests {
    use super::replay_kind_and_history_key;

    #[test]
    fn replay_ids_accept_short_and_legacy_url_history_keys() {
        assert_eq!(
            replay_kind_and_history_key("build:build-0123456789ab"),
            Some(("build", "build-0123456789ab"))
        );
        assert_eq!(
            replay_kind_and_history_key("build:http://jenkins/queue/item/42/"),
            Some(("build", "http://jenkins/queue/item/42/"))
        );
    }
}

pub fn normalize_build_replay_request(
    config: &AppConfig,
    request: &mut DeployRequest,
) -> Result<()> {
    let project = config.find_project(&request.project)?;
    let target_key = request
        .target
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("standard");
    let target = project
        .deploy_targets
        .iter()
        .find(|target| target.key == target_key)
        .with_context(|| {
            format!(
                "deploy target {target_key} not found for replay project {}",
                project.key
            )
        })?;
    let typed_branch_key = target
        .params
        .iter()
        .find(|param| param.kind == DeployParamKind::Branch)
        .map(|param| param.key.as_str());
    let structured_branch = request
        .branch
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let raw_branches = request
        .params
        .iter()
        .chain(request.extra_params.iter())
        .filter(|(key, value)| {
            is_replay_branch_key(key, typed_branch_key) && !value.trim().is_empty()
        })
        .map(|(key, value)| (key.clone(), value.trim().to_string()))
        .collect::<BTreeMap<_, _>>();
    let values = structured_branch
        .iter()
        .chain(raw_branches.values())
        .cloned()
        .collect::<BTreeSet<_>>();

    if values.len() > 1 {
        let branch_key = typed_branch_key
            .map(ToOwned::to_owned)
            .or_else(|| {
                raw_branches
                    .keys()
                    .find(|key| key.as_str() == "BRANCH")
                    .cloned()
            })
            .or_else(|| raw_branches.keys().next().cloned())
            .unwrap_or_else(|| "BRANCH".to_string());
        let alternative_commands = values
            .iter()
            .map(|value| replay_build_run_command(request, &branch_key, value, typed_branch_key))
            .collect();
        return Err(anyhow::Error::new(ReplayBranchConflict {
            structured_branch,
            raw_branches,
            alternative_commands,
        }));
    }

    let Some(branch) = values.into_iter().next() else {
        return Ok(());
    };
    request
        .params
        .retain(|key, _| !is_replay_branch_key(key, typed_branch_key));
    request
        .extra_params
        .retain(|key, _| !is_replay_branch_key(key, typed_branch_key));

    if typed_branch_key.is_some() {
        request.branch = Some(branch);
    } else {
        let raw_key = raw_branches
            .keys()
            .find(|key| key.as_str() == "BRANCH")
            .cloned()
            .or_else(|| raw_branches.keys().next().cloned())
            .unwrap_or_else(|| "BRANCH".to_string());
        request.params.insert(raw_key, branch);
        request.branch = None;
    }
    Ok(())
}

fn is_replay_branch_key(key: &str, typed_branch_key: Option<&str>) -> bool {
    typed_branch_key.is_some_and(|typed| key.eq_ignore_ascii_case(typed))
        || matches!(
            key.trim().to_ascii_lowercase().as_str(),
            "branch" | "git_branch" | "gitbranch"
        )
}

fn replay_build_run_command(
    request: &DeployRequest,
    branch_key: &str,
    branch_value: &str,
    typed_branch_key: Option<&str>,
) -> String {
    let mut args = vec![
        "build".to_string(),
        "run".to_string(),
        request.project.clone(),
    ];
    if let Some(target) = request
        .target
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        args.extend(["--target".to_string(), target.to_string()]);
    }
    if let Some(env) = request
        .env
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        args.extend(["--env".to_string(), env.to_string()]);
    }
    for (key, value) in request.params.iter().chain(request.extra_params.iter()) {
        if !is_replay_branch_key(key, typed_branch_key) {
            args.extend(["--set".to_string(), format!("{key}={value}")]);
        }
    }
    args.extend(["--set".to_string(), format!("{branch_key}={branch_value}")]);
    command_display("rdevtool", &args)
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

#[cfg(test)]
mod tests {
    use super::{ReplayBranchConflict, normalize_build_replay_request};
    use crate::config::AppConfig;
    use crate::core::DeployRequest;
    use std::collections::BTreeMap;

    fn config(branch_param: bool) -> AppConfig {
        let branch_param = if branch_param {
            r#"
[[projects.deploy_targets.params]]
key = "BRANCH"
label = "分支"
type = "branch"
"#
        } else {
            ""
        };
        toml::from_str(&format!(
            r#"
[defaults]

[defaults.jenkins_profiles.default]
base_url = "https://jenkins.example.test"
username = "tester"

[[projects]]
key = "demo"
name = "Demo"

[[projects.deploy_targets]]
key = "vke"
label = "VKE"
jenkins_profile = "default"
job_name = "demo"
{branch_param}
"#
        ))
        .expect("parse replay test config")
    }

    fn replay_request() -> DeployRequest {
        DeployRequest {
            project: "demo".to_string(),
            target: Some("vke".to_string()),
            branch: Some("env-dc2-vke".to_string()),
            params: BTreeMap::from([("BRANCH".to_string(), "env-dc2-vke".to_string())]),
            ..DeployRequest::default()
        }
    }

    #[test]
    fn keeps_raw_branch_when_target_has_no_typed_branch() {
        let mut request = replay_request();
        normalize_build_replay_request(&config(false), &mut request).expect("normalize replay");
        assert_eq!(request.branch, None);
        assert_eq!(
            request.params.get("BRANCH").map(String::as_str),
            Some("env-dc2-vke")
        );
        let plan = crate::core::build_plan(&config(false), &request)
            .expect("raw replay branch remains executable");
        assert_eq!(
            plan.params.get("BRANCH").map(String::as_str),
            Some("env-dc2-vke")
        );
        assert!(
            !plan
                .risks
                .iter()
                .any(|risk| risk.code == "branchNotEffective")
        );
    }

    #[test]
    fn merges_matching_raw_and_typed_branch_into_structured_input() {
        let mut request = replay_request();
        normalize_build_replay_request(&config(true), &mut request).expect("normalize replay");
        assert_eq!(request.branch.as_deref(), Some("env-dc2-vke"));
        assert!(!request.params.contains_key("BRANCH"));
    }

    #[test]
    fn blocks_conflicting_branch_values_with_one_off_commands() {
        let mut request = replay_request();
        request
            .params
            .insert("BRANCH".to_string(), "release".to_string());
        let error = normalize_build_replay_request(&config(true), &mut request)
            .expect_err("conflicting replay must be blocked");
        let conflict = error
            .downcast_ref::<ReplayBranchConflict>()
            .expect("typed replay conflict");
        assert_eq!(conflict.alternative_commands.len(), 2);
        assert!(
            conflict
                .alternative_commands
                .iter()
                .all(|command| command.contains("rdevtool build run demo"))
        );
    }
}
