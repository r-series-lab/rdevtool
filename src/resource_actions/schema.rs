use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::RESOURCE_ACTION_SCHEMA_VERSION;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ResourceActionFile {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub actions: Vec<ResourceActionConfig>,
}

fn default_schema_version() -> u32 {
    RESOURCE_ACTION_SCHEMA_VERSION
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ResourceActionConfig {
    pub key: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub effect: ResourceActionEffect,
    #[serde(default)]
    pub execution: ResourceActionExecutionConfig,
    pub runner: ResourceActionRunnerConfig,
    #[serde(default)]
    pub params: Vec<ResourceActionParamConfig>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ResourceActionExecutionConfig {
    #[serde(default)]
    pub mode: ResourceActionExecutionMode,
    #[serde(default = "default_plan_ttl_seconds")]
    pub plan_ttl_seconds: u64,
}

impl Default for ResourceActionExecutionConfig {
    fn default() -> Self {
        Self {
            mode: ResourceActionExecutionMode::Direct,
            plan_ttl_seconds: default_plan_ttl_seconds(),
        }
    }
}

fn default_plan_ttl_seconds() -> u64 {
    300
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResourceActionExecutionMode {
    #[default]
    Direct,
    PlanApply,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResourceActionEffect {
    Read,
    #[default]
    LocalWrite,
    RemoteWrite,
    Destructive,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ResourceActionRunnerConfig {
    #[serde(rename = "type")]
    pub kind: ResourceActionRunnerKind,
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub input: ResourceActionInputMode,
    #[serde(default)]
    pub output: ResourceActionOutputMode,
    #[serde(default)]
    pub timeout_seconds: Option<u64>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResourceActionRunnerKind {
    Process,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResourceActionInputMode {
    #[default]
    JsonStdin,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResourceActionOutputMode {
    #[default]
    Text,
    StructuredJson,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ResourceActionParamConfig {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub kind: ResourceActionParamKind,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub placeholder: Option<String>,
    #[serde(default)]
    pub default: Option<Value>,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub min: Option<f64>,
    #[serde(default)]
    pub max: Option<f64>,
    #[serde(default)]
    pub step: Option<f64>,
    #[serde(default)]
    pub min_length: Option<usize>,
    #[serde(default)]
    pub max_length: Option<usize>,
    #[serde(default)]
    pub min_items: Option<usize>,
    #[serde(default)]
    pub max_items: Option<usize>,
    #[serde(default)]
    pub role: Option<ResourceActionParamRole>,
    #[serde(default)]
    pub options: Vec<ResourceActionOptionConfig>,
    #[serde(default)]
    pub source: Option<ResourceActionOptionSourceConfig>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResourceActionParamKind {
    Text,
    Textarea,
    Number,
    Select,
    MultiSelect,
    Boolean,
    Branch,
    Project,
    ProjectMulti,
    File,
    Directory,
    Secret,
    Hidden,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResourceActionParamRole {
    DryRun,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum ResourceActionOptionConfig {
    Simple(String),
    Detailed { value: String, label: String },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ResourceActionOptionSourceConfig {
    #[serde(rename = "type")]
    pub kind: ResourceActionOptionSourceKind,
    #[serde(default)]
    pub deploy_target: Option<String>,
    #[serde(default)]
    pub adapter: Option<String>,
    #[serde(default)]
    pub action_kind: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResourceActionOptionSourceKind {
    Projects,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceActionOption {
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceActionParamView {
    pub key: String,
    pub label: String,
    pub kind: ResourceActionParamKind,
    pub description: Option<String>,
    pub placeholder: Option<String>,
    pub default_value: Option<Value>,
    pub required: bool,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub step: Option<f64>,
    pub min_length: Option<usize>,
    pub max_length: Option<usize>,
    pub min_items: Option<usize>,
    pub max_items: Option<usize>,
    pub role: Option<ResourceActionParamRole>,
    pub options: Vec<ResourceActionOption>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceActionRunnerView {
    pub kind: ResourceActionRunnerKind,
    pub program: String,
    pub configured_program: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub input: ResourceActionInputMode,
    pub output: ResourceActionOutputMode,
    pub timeout_seconds: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceActionView {
    pub config_path: String,
    pub key: String,
    pub name: String,
    pub description: Option<String>,
    pub effect: ResourceActionEffect,
    pub execution: ResourceActionExecutionConfig,
    pub runner: ResourceActionRunnerView,
    pub params: Vec<ResourceActionParamView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceActionSummary {
    pub key: String,
    pub name: String,
    pub description: Option<String>,
    pub effect: ResourceActionEffect,
    pub execution_mode: ResourceActionExecutionMode,
    pub runner_kind: ResourceActionRunnerKind,
    pub param_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceActionCatalog {
    pub config_path: String,
    pub schema_version: u32,
    pub actions: Vec<ResourceActionSummary>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceActionRunRequest {
    pub key: String,
    #[serde(default)]
    pub params: BTreeMap<String, Value>,
    #[serde(default)]
    pub operation_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceActionApplyRequest {
    pub plan_id: String,
    #[serde(default)]
    pub params: BTreeMap<String, Value>,
    #[serde(default)]
    pub operation_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceActionPlan {
    pub schema_version: u32,
    pub plan_id: String,
    pub action_key: String,
    pub action_name: String,
    pub effect: ResourceActionEffect,
    pub workspace_key: Option<String>,
    pub config_path: String,
    pub config_fingerprint: String,
    pub params_fingerprint: String,
    pub effective_params: BTreeMap<String, Value>,
    pub secret_params: Vec<String>,
    pub plan_operation_id: String,
    pub plan_result: ResourceActionStructuredResult,
    pub created_at: String,
    pub expires_at: String,
    pub consumed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceActionRunResult {
    pub operation_id: String,
    pub key: String,
    pub name: String,
    pub success: bool,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub cancelled: bool,
    pub stdout: String,
    pub stderr: String,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
    pub structured_result: Option<ResourceActionStructuredResult>,
    pub started_at: String,
    pub finished_at: String,
    pub duration_ms: u128,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResourceActionProgressStream {
    Stdout,
    Stderr,
    System,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceActionProgressEvent {
    pub operation_id: String,
    pub sequence: u64,
    pub stream: ResourceActionProgressStream,
    pub chunk: String,
    pub output_suppressed: bool,
    pub occurred_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceActionStructuredResult {
    pub schema_version: u32,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub items: Vec<ResourceActionResultItem>,
    #[serde(default)]
    pub retry: Option<ResourceActionRetry>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceActionResultItem {
    pub key: String,
    pub label: String,
    pub status: ResourceActionResultStatus,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub detail: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub parameters: Vec<ResourceActionResultParameter>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResourceActionResultStatus {
    Success,
    Warning,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceActionResultParameter {
    pub key: String,
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceActionRetry {
    pub param: String,
    pub values: Vec<String>,
}
