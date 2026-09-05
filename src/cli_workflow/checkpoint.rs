use anyhow::Result;
use rdevtool_core::storage::Storage;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{PromotePlan, timestamp};

const PROMOTE_EXECUTION_NAMESPACE: &str = "workflow-promote-execution";

#[derive(Debug, Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PromoteStageState {
    Pending,
    Running,
    Completed,
    Failed,
    Blocked,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoteStageCheckpoint {
    pub key: String,
    pub state: PromoteStageState,
    pub attempts: u32,
    pub updated_at: String,
    pub error: Option<String>,
    pub result: Option<Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoteExecution {
    pub plan_hash: String,
    pub workspace_key: String,
    pub status: String,
    pub success: bool,
    pub updated_at: String,
    pub stages: Vec<PromoteStageCheckpoint>,
}

pub(super) fn load_execution(storage: &Storage, plan: &PromotePlan) -> Result<PromoteExecution> {
    match storage
        .get_json(PROMOTE_EXECUTION_NAMESPACE, &plan.plan_hash)
        .map_err(anyhow::Error::msg)?
    {
        Some(value) => serde_json::from_value(value).map_err(anyhow::Error::from),
        None => Ok(PromoteExecution {
            plan_hash: plan.plan_hash.clone(),
            workspace_key: plan.workspace_key.clone(),
            status: "pending".to_string(),
            success: false,
            updated_at: timestamp(),
            stages: plan
                .stages
                .iter()
                .map(|stage| PromoteStageCheckpoint {
                    key: stage.key.clone(),
                    state: PromoteStageState::Pending,
                    attempts: 0,
                    updated_at: timestamp(),
                    error: None,
                    result: None,
                })
                .collect(),
        }),
    }
}

pub(super) fn begin_stage(
    storage: &Storage,
    execution: &mut PromoteExecution,
    key: &str,
) -> Result<bool> {
    let stage = stage_mut(execution, key)?;
    match stage.state {
        PromoteStageState::Completed => return Ok(false),
        PromoteStageState::Running => {
            anyhow::bail!(
                "promote stage {key} has an unresolved running attempt; inspect its history before retrying"
            )
        }
        PromoteStageState::Blocked => {
            anyhow::bail!(
                "promote stage {key} is blocked after an ambiguous side effect; it will not be retried automatically"
            )
        }
        PromoteStageState::Pending | PromoteStageState::Failed => {}
    }
    stage.state = PromoteStageState::Running;
    stage.attempts += 1;
    stage.updated_at = timestamp();
    stage.error = None;
    execution.status = "running".to_string();
    execution.success = false;
    execution.updated_at = timestamp();
    save_execution(storage, execution)?;
    Ok(true)
}

pub(super) fn complete_stage(
    storage: &Storage,
    execution: &mut PromoteExecution,
    key: &str,
    result: Value,
) -> Result<()> {
    let stage = stage_mut(execution, key)?;
    stage.state = PromoteStageState::Completed;
    stage.updated_at = timestamp();
    stage.error = None;
    stage.result = Some(result);
    execution.updated_at = timestamp();
    save_execution(storage, execution)
}

pub(super) fn fail_stage(
    storage: &Storage,
    execution: &mut PromoteExecution,
    key: &str,
    error: anyhow::Error,
    blocked: bool,
) -> Result<()> {
    let message = error.to_string();
    let stage = stage_mut(execution, key)?;
    stage.state = if blocked {
        PromoteStageState::Blocked
    } else {
        PromoteStageState::Failed
    };
    stage.updated_at = timestamp();
    stage.error = Some(message.clone());
    execution.status = if blocked {
        "blocked".to_string()
    } else {
        "failed".to_string()
    };
    execution.success = false;
    execution.updated_at = timestamp();
    save_execution(storage, execution)?;
    Err(anyhow::anyhow!(
        "promote stage {key} {}: {message}",
        if blocked { "blocked" } else { "failed" }
    ))
}

pub(super) fn save_execution(storage: &Storage, execution: &PromoteExecution) -> Result<()> {
    storage
        .set_json(
            PROMOTE_EXECUTION_NAMESPACE,
            &execution.plan_hash,
            &serde_json::to_value(execution)?,
        )
        .map_err(anyhow::Error::msg)
}

pub(super) fn stage_mut<'a>(
    execution: &'a mut PromoteExecution,
    key: &str,
) -> Result<&'a mut PromoteStageCheckpoint> {
    execution
        .stages
        .iter_mut()
        .find(|stage| stage.key == key)
        .ok_or_else(|| anyhow::anyhow!("promote stage not found: {key}"))
}
