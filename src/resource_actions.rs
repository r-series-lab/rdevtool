use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, atomic::AtomicBool};

use anyhow::{Context, Result, anyhow, bail};
use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::config::{
    AppConfig, BuildActionKind, BuildTargetAdapter, ProjectConfig, default_config_dir,
};
use crate::config_store::write_config_text_atomic;
use crate::operation::OperationEventOrigin;
use crate::storage::Storage;

#[path = "resource_actions/process.rs"]
mod process;
#[path = "resource_actions/schema.rs"]
mod schema;

use process::{resolve_runner_cwd, run_process_action};
pub use schema::*;

const RESOURCE_ACTIONS_TEMPLATE: &str = include_str!("../actions.template.toml");
pub(super) const RESOURCE_ACTION_SCHEMA_VERSION: u32 = 1;
pub(super) const RESOURCE_ACTION_RESULT_SCHEMA_VERSION: u32 = 1;
pub(super) const DEFAULT_ACTION_TIMEOUT_SECONDS: u64 = 900;
const MAX_ACTION_TIMEOUT_SECONDS: u64 = 86_400;
const RESOURCE_ACTION_PLAN_SCHEMA_VERSION: u32 = 1;
const RESOURCE_ACTION_PLAN_NAMESPACE: &str = "resource-action-plan";
const MAX_ACTION_PLAN_TTL_SECONDS: u64 = 86_400;
const MAX_ACTION_PLAN_EVIDENCE_BYTES: usize = 128 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum ResourceActionOperationPhase {
    Run,
    Plan,
    Apply,
}

#[derive(Debug, Clone)]
pub(super) struct ResourceActionOperationContext {
    pub phase: ResourceActionOperationPhase,
    pub operation_id: Option<String>,
    pub plan_id: Option<String>,
    pub plan_evidence: Option<ResourceActionStructuredResult>,
}

impl ResourceActionOperationContext {
    fn run(operation_id: Option<String>) -> Self {
        Self {
            phase: ResourceActionOperationPhase::Run,
            operation_id,
            plan_id: None,
            plan_evidence: None,
        }
    }

    fn plan(operation_id: Option<String>) -> Self {
        Self {
            phase: ResourceActionOperationPhase::Plan,
            operation_id,
            plan_id: None,
            plan_evidence: None,
        }
    }

    fn apply(plan: &ResourceActionPlan, operation_id: Option<String>) -> Self {
        Self {
            phase: ResourceActionOperationPhase::Apply,
            operation_id,
            plan_id: Some(plan.plan_id.clone()),
            plan_evidence: Some(plan.plan_result.clone()),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct ResourceActionExecutionContext {
    pub rdevtool_cli_path: Option<PathBuf>,
    pub rdevtool_cli_error: Option<String>,
    pub config_path: Option<PathBuf>,
    pub workspace_key: Option<String>,
    pub operation_origin: Option<OperationEventOrigin>,
    pub operation_storage: Option<Storage>,
    pub cancellation_flag: Option<Arc<AtomicBool>>,
    pub progress_reporter: Option<ResourceActionProgressReporter>,
}

#[derive(Clone)]
pub struct ResourceActionProgressReporter {
    callback: Arc<dyn Fn(ResourceActionProgressEvent) + Send + Sync>,
}

impl ResourceActionProgressReporter {
    pub fn new(callback: impl Fn(ResourceActionProgressEvent) + Send + Sync + 'static) -> Self {
        Self {
            callback: Arc::new(callback),
        }
    }

    fn report(&self, event: ResourceActionProgressEvent) {
        (self.callback)(event);
    }
}

impl std::fmt::Debug for ResourceActionProgressReporter {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("ResourceActionProgressReporter(..)")
    }
}

pub fn default_resource_actions_path() -> PathBuf {
    default_config_dir().join("actions.toml")
}

pub fn ensure_resource_actions_at(path: &Path) -> Result<PathBuf> {
    if path.exists() {
        return Ok(path.to_path_buf());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "failed to create resource action directory: {}",
                parent.display()
            )
        })?;
    }
    write_config_text_atomic(path, RESOURCE_ACTIONS_TEMPLATE).with_context(|| {
        format!(
            "failed to create resource action config: {}",
            path.display()
        )
    })?;
    Ok(path.to_path_buf())
}

pub fn load_resource_actions_from_path(path: &Path) -> Result<ResourceActionFile> {
    let path = ensure_resource_actions_at(path)?;
    let content = fs::read_to_string(&path)
        .with_context(|| format!("failed to read resource action config: {}", path.display()))?;
    let config: ResourceActionFile = toml::from_str(&content)
        .with_context(|| format!("failed to parse resource action config: {}", path.display()))?;
    validate_resource_action_file(&config)?;
    Ok(config)
}

pub fn resource_action_catalog_from_path(path: &Path) -> Result<ResourceActionCatalog> {
    let config = load_resource_actions_from_path(path)?;
    Ok(ResourceActionCatalog {
        config_path: path.display().to_string(),
        schema_version: config.schema_version,
        actions: config
            .actions
            .into_iter()
            .map(|action| ResourceActionSummary {
                key: action.key,
                name: action.name,
                description: action.description,
                effect: action.effect,
                execution_mode: action.execution.mode,
                runner_kind: action.runner.kind,
                param_count: action.params.len(),
            })
            .collect(),
    })
}

pub fn resource_action_view_from_path(
    path: &Path,
    key: &str,
    app_config: &AppConfig,
) -> Result<ResourceActionView> {
    resource_action_view_from_path_with_context(
        path,
        key,
        app_config,
        &ResourceActionExecutionContext::default(),
    )
}

pub fn resource_action_view_from_path_with_context(
    path: &Path,
    key: &str,
    app_config: &AppConfig,
    execution_context: &ResourceActionExecutionContext,
) -> Result<ResourceActionView> {
    let config = load_resource_actions_from_path(path)?;
    let action = find_action(&config, key)?;
    action_view(path, action, app_config, execution_context)
}

pub fn run_resource_action_from_path(
    path: &Path,
    request: ResourceActionRunRequest,
    app_config: &AppConfig,
) -> Result<ResourceActionRunResult> {
    run_resource_action_from_path_with_context(
        path,
        request,
        app_config,
        &ResourceActionExecutionContext::default(),
    )
}

pub fn run_resource_action_from_path_with_context(
    path: &Path,
    request: ResourceActionRunRequest,
    app_config: &AppConfig,
    execution_context: &ResourceActionExecutionContext,
) -> Result<ResourceActionRunResult> {
    let config = load_resource_actions_from_path(path)?;
    let action = find_action(&config, &request.key)?;
    let operation_id = request.operation_id.clone();
    let params = resolve_action_params(action, &request.params, app_config)?;
    if action.execution.mode == ResourceActionExecutionMode::PlanApply
        && !resolved_params_are_dry_run(action, &params)
    {
        bail!(
            "resource action {} requires plan/apply; create a plan before applying it",
            action.key
        );
    }
    run_process_action(
        path,
        action,
        params,
        execution_context,
        &ResourceActionOperationContext::run(operation_id),
    )
}

pub fn validate_resource_action_request_from_path(
    path: &Path,
    request: &ResourceActionRunRequest,
    app_config: &AppConfig,
) -> Result<BTreeMap<String, Value>> {
    let config = load_resource_actions_from_path(path)?;
    let action = find_action(&config, &request.key)?;
    resolve_action_params(action, &request.params, app_config)
}

pub fn plan_resource_action_from_path_with_context(
    path: &Path,
    request: ResourceActionRunRequest,
    app_config: &AppConfig,
    execution_context: &ResourceActionExecutionContext,
) -> Result<ResourceActionPlan> {
    let storage = Storage::new_default().map_err(anyhow::Error::msg)?;
    plan_resource_action_from_path_with_storage(
        &storage,
        path,
        request,
        app_config,
        execution_context,
    )
}

pub fn get_resource_action_plan(plan_id: &str) -> Result<ResourceActionPlan> {
    let storage = Storage::new_default().map_err(anyhow::Error::msg)?;
    load_resource_action_plan(&storage, plan_id)
}

pub fn apply_resource_action_plan_from_path_with_context(
    path: &Path,
    request: ResourceActionApplyRequest,
    app_config: &AppConfig,
    execution_context: &ResourceActionExecutionContext,
) -> Result<ResourceActionRunResult> {
    let storage = Storage::new_default().map_err(anyhow::Error::msg)?;
    apply_resource_action_plan_from_path_with_storage(
        &storage,
        path,
        request,
        app_config,
        execution_context,
    )
}

fn plan_resource_action_from_path_with_storage(
    storage: &Storage,
    path: &Path,
    request: ResourceActionRunRequest,
    app_config: &AppConfig,
    execution_context: &ResourceActionExecutionContext,
) -> Result<ResourceActionPlan> {
    let config = load_resource_actions_from_path(path)?;
    let action = find_action(&config, &request.key)?;
    require_plan_apply_action(action)?;
    let operation_id = request.operation_id.clone();
    let params = resolve_action_params(action, &request.params, app_config)?;
    let plan_id = format!("action-plan-{}", Uuid::new_v4());
    let result = run_process_action(
        path,
        action,
        params.clone(),
        execution_context,
        &ResourceActionOperationContext::plan(operation_id),
    )?;
    if !result.success {
        bail!(
            "{}",
            resource_action_failure_message(&result, "plan failed")
        );
    }
    let plan_result = result
        .structured_result
        .clone()
        .context("resource action plan did not return a structured result")?;
    if plan_result.items.is_empty() {
        bail!("resource action plan must identify at least one target item");
    }
    let evidence_bytes = serde_json::to_vec(&plan_result)?.len();
    if evidence_bytes > MAX_ACTION_PLAN_EVIDENCE_BYTES {
        bail!(
            "resource action plan evidence is too large: {evidence_bytes} bytes (max {MAX_ACTION_PLAN_EVIDENCE_BYTES})"
        );
    }

    let created_at = Utc::now();
    let plan = ResourceActionPlan {
        schema_version: RESOURCE_ACTION_PLAN_SCHEMA_VERSION,
        plan_id: plan_id.clone(),
        action_key: action.key.clone(),
        action_name: action.name.clone(),
        effect: action.effect,
        workspace_key: execution_context.workspace_key.clone(),
        config_path: normalized_config_path(path),
        config_fingerprint: action_config_fingerprint(action)?,
        params_fingerprint: action_params_fingerprint(action, &params, &plan_id)?,
        effective_params: non_secret_effective_params(action, &params),
        secret_params: action
            .params
            .iter()
            .filter(|param| {
                param.kind == ResourceActionParamKind::Secret && params.contains_key(&param.key)
            })
            .map(|param| param.key.clone())
            .collect(),
        plan_operation_id: result.operation_id,
        plan_result,
        created_at: created_at.to_rfc3339(),
        expires_at: (created_at + Duration::seconds(action.execution.plan_ttl_seconds as i64))
            .to_rfc3339(),
        consumed_at: None,
    };
    storage
        .set_json(
            RESOURCE_ACTION_PLAN_NAMESPACE,
            &plan_id,
            &serde_json::to_value(&plan)?,
        )
        .map_err(anyhow::Error::msg)?;
    Ok(plan)
}

fn apply_resource_action_plan_from_path_with_storage(
    storage: &Storage,
    path: &Path,
    request: ResourceActionApplyRequest,
    app_config: &AppConfig,
    execution_context: &ResourceActionExecutionContext,
) -> Result<ResourceActionRunResult> {
    let stored_plan = load_resource_action_plan(storage, &request.plan_id)?;
    let config = load_resource_actions_from_path(path)?;
    let action = find_action(&config, &stored_plan.action_key)?;
    require_plan_apply_action(action)?;

    let operation_id = request.operation_id.clone();
    let mut requested_params = stored_plan.effective_params.clone();
    requested_params.extend(request.params);
    let params = resolve_action_params(action, &requested_params, app_config)?;
    let expected_config_path = normalized_config_path(path);
    let expected_config_fingerprint = action_config_fingerprint(action)?;
    let expected_params_fingerprint =
        action_params_fingerprint(action, &params, &stored_plan.plan_id)?;
    let expected_workspace_key = execution_context.workspace_key.clone();
    let consumed_at = Utc::now().to_rfc3339();
    let plan_id = stored_plan.plan_id.clone();
    let missing_plan_id = plan_id.clone();

    let claimed = storage
        .update_json(RESOURCE_ACTION_PLAN_NAMESPACE, &plan_id, move |stored| {
            let stored = stored
                .ok_or_else(|| format!("resource action plan not found: {missing_plan_id}"))?;
            let mut plan: ResourceActionPlan =
                serde_json::from_value(stored).map_err(|error| error.to_string())?;
            validate_plan_for_apply(
                &plan,
                &expected_config_path,
                &expected_config_fingerprint,
                &expected_params_fingerprint,
                expected_workspace_key.as_deref(),
            )
            .map_err(|error| error.to_string())?;
            plan.consumed_at = Some(consumed_at);
            serde_json::to_value(plan).map_err(|error| error.to_string())
        })
        .map_err(anyhow::Error::msg)?;
    let claimed: ResourceActionPlan = serde_json::from_value(claimed)?;

    run_process_action(
        path,
        action,
        params,
        execution_context,
        &ResourceActionOperationContext::apply(&claimed, operation_id),
    )
}

fn load_resource_action_plan(storage: &Storage, plan_id: &str) -> Result<ResourceActionPlan> {
    let plan_id = plan_id.trim();
    if plan_id.is_empty() {
        bail!("resource action plan id is required");
    }
    let value = storage
        .get_json(RESOURCE_ACTION_PLAN_NAMESPACE, plan_id)
        .map_err(anyhow::Error::msg)?
        .with_context(|| format!("resource action plan not found: {plan_id}"))?;
    let plan: ResourceActionPlan = serde_json::from_value(value)?;
    if plan.schema_version != RESOURCE_ACTION_PLAN_SCHEMA_VERSION {
        bail!(
            "unsupported resource action plan schema version: {}",
            plan.schema_version
        );
    }
    Ok(plan)
}

fn validate_plan_for_apply(
    plan: &ResourceActionPlan,
    config_path: &str,
    config_fingerprint: &str,
    params_fingerprint: &str,
    workspace_key: Option<&str>,
) -> Result<()> {
    if plan.consumed_at.is_some() {
        bail!(
            "resource action plan has already been consumed: {}",
            plan.plan_id
        );
    }
    let expires_at = DateTime::parse_from_rfc3339(&plan.expires_at)
        .context("resource action plan has an invalid expiration timestamp")?;
    if Utc::now() >= expires_at {
        bail!("resource action plan has expired: {}", plan.plan_id);
    }
    if plan.workspace_key.as_deref() != workspace_key {
        bail!(
            "resource action plan belongs to workspace {}; switch to that workspace before applying it",
            plan.workspace_key.as_deref().unwrap_or("system")
        );
    }
    if plan.config_path != config_path {
        bail!("resource action plan config source has changed; create a new plan");
    }
    if plan.config_fingerprint != config_fingerprint {
        bail!("resource action config changed after planning; create a new plan");
    }
    if plan.params_fingerprint != params_fingerprint {
        bail!("resource action parameters changed after planning; create a new plan");
    }
    Ok(())
}

fn require_plan_apply_action(action: &ResourceActionConfig) -> Result<()> {
    if action.execution.mode != ResourceActionExecutionMode::PlanApply {
        bail!(
            "resource action {} uses direct execution and does not support plan/apply",
            action.key
        );
    }
    Ok(())
}

fn resolved_params_are_dry_run(
    action: &ResourceActionConfig,
    params: &BTreeMap<String, Value>,
) -> bool {
    action.params.iter().any(|param| {
        param.role == Some(ResourceActionParamRole::DryRun)
            && params.get(&param.key).and_then(Value::as_bool) == Some(true)
    })
}

fn non_secret_effective_params(
    action: &ResourceActionConfig,
    params: &BTreeMap<String, Value>,
) -> BTreeMap<String, Value> {
    let secret_keys = action
        .params
        .iter()
        .filter(|param| param.kind == ResourceActionParamKind::Secret)
        .map(|param| param.key.as_str())
        .collect::<BTreeSet<_>>();
    params
        .iter()
        .filter(|(key, _)| !secret_keys.contains(key.as_str()))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}

fn action_config_fingerprint(action: &ResourceActionConfig) -> Result<String> {
    Ok(sha256_hex(&serde_json::to_vec(action)?))
}

fn action_params_fingerprint(
    action: &ResourceActionConfig,
    params: &BTreeMap<String, Value>,
    plan_id: &str,
) -> Result<String> {
    let secret_keys = action
        .params
        .iter()
        .filter(|param| param.kind == ResourceActionParamKind::Secret)
        .map(|param| param.key.as_str())
        .collect::<BTreeSet<_>>();
    let material = params
        .iter()
        .map(|(key, value)| {
            if secret_keys.contains(key.as_str()) {
                let secret_material = serde_json::to_vec(&(plan_id, key, value))?;
                Ok((
                    key.clone(),
                    Value::String(format!("secret:{}", sha256_hex(&secret_material))),
                ))
            } else {
                Ok((key.clone(), value.clone()))
            }
        })
        .collect::<Result<BTreeMap<_, _>>>()?;
    Ok(sha256_hex(&serde_json::to_vec(&material)?))
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!("sha256:{digest:x}")
}

fn normalized_config_path(path: &Path) -> String {
    fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .display()
        .to_string()
}

fn resource_action_failure_message(result: &ResourceActionRunResult, fallback: &str) -> String {
    result
        .structured_result
        .as_ref()
        .and_then(|structured| structured.summary.clone())
        .or_else(|| (!result.stderr.trim().is_empty()).then(|| result.stderr.trim().to_string()))
        .unwrap_or_else(|| format!("resource action {} {fallback}", result.key))
}

fn find_action<'a>(config: &'a ResourceActionFile, key: &str) -> Result<&'a ResourceActionConfig> {
    let key = key.trim();
    if key.is_empty() {
        bail!("resource action key is required");
    }
    config
        .actions
        .iter()
        .find(|action| action.key == key)
        .with_context(|| format!("resource action not found: {key}"))
}

fn validate_resource_action_file(config: &ResourceActionFile) -> Result<()> {
    if config.schema_version != RESOURCE_ACTION_SCHEMA_VERSION {
        bail!(
            "unsupported resource action schema version: {} (expected {})",
            config.schema_version,
            RESOURCE_ACTION_SCHEMA_VERSION
        );
    }
    let mut action_keys = BTreeSet::new();
    for action in &config.actions {
        validate_identifier("resource action key", &action.key)?;
        require_text("resource action name", &action.name)?;
        if !action_keys.insert(action.key.trim()) {
            bail!("duplicate resource action key: {}", action.key.trim());
        }
        validate_execution(action)?;
        validate_runner(&action.runner, &action.key)?;
        let mut param_keys = BTreeSet::new();
        let mut param_roles = BTreeSet::new();
        for param in &action.params {
            validate_identifier("resource action parameter key", &param.key)?;
            require_text("resource action parameter label", &param.label)?;
            if !param_keys.insert(param.key.trim()) {
                bail!(
                    "duplicate parameter key for resource action {}: {}",
                    action.key,
                    param.key.trim()
                );
            }
            if let Some(role) = param.role
                && !param_roles.insert(format!("{role:?}"))
            {
                bail!(
                    "duplicate parameter role for resource action {}: {role:?}",
                    action.key
                );
            }
            validate_param_config(action, param)?;
        }
    }
    Ok(())
}

fn validate_execution(action: &ResourceActionConfig) -> Result<()> {
    if action.execution.plan_ttl_seconds == 0
        || action.execution.plan_ttl_seconds > MAX_ACTION_PLAN_TTL_SECONDS
    {
        bail!(
            "resource action {} plan_ttl_seconds must be between 1 and {MAX_ACTION_PLAN_TTL_SECONDS}",
            action.key
        );
    }
    if action.execution.mode == ResourceActionExecutionMode::PlanApply
        && action.runner.output != ResourceActionOutputMode::StructuredJson
    {
        bail!(
            "resource action {} plan_apply execution requires structured_json output",
            action.key
        );
    }
    Ok(())
}

fn validate_runner(runner: &ResourceActionRunnerConfig, action_key: &str) -> Result<()> {
    require_text("resource action runner program", &runner.program)?;
    reject_nul("resource action runner program", &runner.program)?;
    for arg in &runner.args {
        reject_nul("resource action runner argument", arg)?;
    }
    for (key, value) in &runner.env {
        validate_identifier("resource action runner env key", key)?;
        if is_reserved_action_env(key) {
            bail!("resource action {action_key} cannot override reserved environment key: {key}");
        }
        reject_nul("resource action runner env value", value)?;
    }
    let timeout = runner
        .timeout_seconds
        .unwrap_or(DEFAULT_ACTION_TIMEOUT_SECONDS);
    if timeout == 0 || timeout > MAX_ACTION_TIMEOUT_SECONDS {
        bail!(
            "resource action {action_key} timeout_seconds must be between 1 and {MAX_ACTION_TIMEOUT_SECONDS}"
        );
    }
    Ok(())
}

fn is_reserved_action_env(key: &str) -> bool {
    matches!(
        key,
        "RDEVTOOL_ACTION_KEY"
            | "RDEVTOOL_ACTION_RUN_ID"
            | "RDEVTOOL_ACTION_INPUT"
            | "RDEVTOOL_CLI"
            | "RDEVTOOL_CLI_PATH"
            | "RDEVTOOL_CONFIG_PATH"
            | "RDEVTOOL_WORKSPACE_KEY"
    )
}

fn validate_param_config(
    action: &ResourceActionConfig,
    param: &ResourceActionParamConfig,
) -> Result<()> {
    validate_param_constraints(action, param)?;
    if param.role == Some(ResourceActionParamRole::DryRun)
        && param.kind != ResourceActionParamKind::Boolean
    {
        bail!(
            "dry_run parameter role requires a boolean parameter for resource action {}: {}",
            action.key,
            param.key
        );
    }
    if param.kind == ResourceActionParamKind::Secret && param.default.is_some() {
        bail!(
            "secret parameter {} for resource action {} cannot define a default",
            param.key,
            action.key
        );
    }
    let options = static_options(param)?;
    if param.kind == ResourceActionParamKind::Select && options.is_empty() && param.source.is_none()
    {
        bail!(
            "select parameter {} for resource action {} requires options or a source",
            param.key,
            action.key
        );
    }
    if let Some(default) = &param.default {
        validate_param_value(param, default, &options, false).map_err(|error| {
            anyhow!(
                "invalid default for resource action {} parameter {}: {error}",
                action.key,
                param.key
            )
        })?;
    }
    if let Some(source) = &param.source {
        if let Some(target) = &source.deploy_target {
            require_text("resource action project source deploy_target", target)?;
        }
        if let Some(adapter) = source.adapter.as_deref()
            && !matches!(adapter, "jenkins" | "local_command" | "r_series_package")
        {
            bail!("unsupported resource action project source adapter: {adapter}");
        }
        if let Some(action_kind) = source.action_kind.as_deref()
            && !matches!(action_kind, "build" | "deploy" | "package" | "release")
        {
            bail!("unsupported resource action project source action_kind: {action_kind}");
        }
    }
    Ok(())
}

fn validate_param_constraints(
    action: &ResourceActionConfig,
    param: &ResourceActionParamConfig,
) -> Result<()> {
    let numeric = param.kind == ResourceActionParamKind::Number;
    let textual = matches!(
        param.kind,
        ResourceActionParamKind::Text
            | ResourceActionParamKind::Textarea
            | ResourceActionParamKind::Branch
            | ResourceActionParamKind::File
            | ResourceActionParamKind::Directory
            | ResourceActionParamKind::Secret
            | ResourceActionParamKind::Hidden
    );
    let multiple = matches!(
        param.kind,
        ResourceActionParamKind::MultiSelect | ResourceActionParamKind::ProjectMulti
    );

    if !numeric && (param.min.is_some() || param.max.is_some() || param.step.is_some()) {
        bail!(
            "numeric constraints require a number parameter for resource action {}: {}",
            action.key,
            param.key
        );
    }
    if !textual && (param.min_length.is_some() || param.max_length.is_some()) {
        bail!(
            "length constraints require a text-like parameter for resource action {}: {}",
            action.key,
            param.key
        );
    }
    if !multiple && (param.min_items.is_some() || param.max_items.is_some()) {
        bail!(
            "item constraints require a multi-select parameter for resource action {}: {}",
            action.key,
            param.key
        );
    }

    for (label, value) in [("min", param.min), ("max", param.max)] {
        if value.is_some_and(|value| !value.is_finite()) {
            bail!(
                "resource action {} parameter {} {label} must be finite",
                action.key,
                param.key
            );
        }
    }
    if let (Some(min), Some(max)) = (param.min, param.max)
        && min > max
    {
        bail!(
            "resource action {} parameter {} min cannot exceed max",
            action.key,
            param.key
        );
    }
    if param
        .step
        .is_some_and(|step| !step.is_finite() || step <= 0.0)
    {
        bail!(
            "resource action {} parameter {} step must be a positive finite number",
            action.key,
            param.key
        );
    }
    if let (Some(min), Some(max)) = (param.min_length, param.max_length)
        && min > max
    {
        bail!(
            "resource action {} parameter {} min_length cannot exceed max_length",
            action.key,
            param.key
        );
    }
    if let (Some(min), Some(max)) = (param.min_items, param.max_items)
        && min > max
    {
        bail!(
            "resource action {} parameter {} min_items cannot exceed max_items",
            action.key,
            param.key
        );
    }
    Ok(())
}

fn validate_identifier(label: &str, value: &str) -> Result<()> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        bail!("{label} is required");
    }
    if value != trimmed {
        bail!("{label} cannot have leading or trailing whitespace: {value}");
    }
    if trimmed
        .chars()
        .any(|ch| ch.is_control() || ch.is_whitespace())
    {
        bail!("{label} cannot contain whitespace or control characters: {trimmed}");
    }
    Ok(())
}

fn require_text<'a>(label: &str, value: &'a str) -> Result<&'a str> {
    let value = value.trim();
    if value.is_empty() {
        bail!("{label} is required");
    }
    Ok(value)
}

fn reject_nul(label: &str, value: &str) -> Result<()> {
    if value.contains('\0') {
        bail!("{label} cannot contain NUL characters");
    }
    Ok(())
}

fn action_view(
    config_path: &Path,
    action: &ResourceActionConfig,
    app_config: &AppConfig,
    execution_context: &ResourceActionExecutionContext,
) -> Result<ResourceActionView> {
    let cwd = resolve_runner_cwd(config_path, action.runner.cwd.as_deref())?;
    let program = process::resolve_runner_program(&cwd, &action.runner.program, execution_context)?;
    let params = action
        .params
        .iter()
        .map(|param| {
            Ok(ResourceActionParamView {
                key: param.key.clone(),
                label: param.label.clone(),
                kind: param.kind,
                description: param.description.clone(),
                placeholder: param.placeholder.clone(),
                default_value: param.default.clone(),
                required: param.required,
                min: param.min,
                max: param.max,
                step: param.step,
                min_length: param.min_length,
                max_length: param.max_length,
                min_items: param.min_items,
                max_items: param.max_items,
                role: param.role,
                options: resolved_options(param, app_config)?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(ResourceActionView {
        config_path: config_path.display().to_string(),
        key: action.key.clone(),
        name: action.name.clone(),
        description: action.description.clone(),
        effect: action.effect,
        execution: action.execution.clone(),
        runner: ResourceActionRunnerView {
            kind: action.runner.kind,
            program: program.display().to_string(),
            configured_program: action.runner.program.clone(),
            args: action.runner.args.clone(),
            cwd: cwd.display().to_string(),
            input: action.runner.input,
            output: action.runner.output,
            timeout_seconds: action
                .runner
                .timeout_seconds
                .unwrap_or(DEFAULT_ACTION_TIMEOUT_SECONDS),
        },
        params,
    })
}

fn static_options(param: &ResourceActionParamConfig) -> Result<Vec<ResourceActionOption>> {
    let mut values = BTreeSet::new();
    param
        .options
        .iter()
        .map(|option| {
            let (value, label) = match option {
                ResourceActionOptionConfig::Simple(value) => (value, value),
                ResourceActionOptionConfig::Detailed { value, label } => (value, label),
            };
            let value = require_text("resource action option value", value)?.to_string();
            let label = require_text("resource action option label", label)?.to_string();
            if !values.insert(value.clone()) {
                bail!("duplicate resource action option value: {value}");
            }
            Ok(ResourceActionOption { value, label })
        })
        .collect()
}

fn resolved_options(
    param: &ResourceActionParamConfig,
    app_config: &AppConfig,
) -> Result<Vec<ResourceActionOption>> {
    let mut options = static_options(param)?;
    let source = param.source.as_ref().or_else(|| {
        matches!(
            param.kind,
            ResourceActionParamKind::Project | ResourceActionParamKind::ProjectMulti
        )
        .then_some(&DEFAULT_PROJECT_OPTION_SOURCE)
    });
    if let Some(source) = source {
        match source.kind {
            ResourceActionOptionSourceKind::Projects => {
                options.extend(
                    app_config
                        .projects
                        .iter()
                        .filter(|project| project_matches_source(project, source))
                        .map(|project| ResourceActionOption {
                            value: project.key.clone(),
                            label: project.name.clone(),
                        }),
                );
            }
        }
    }
    let mut seen = BTreeSet::new();
    options.retain(|option| seen.insert(option.value.clone()));
    Ok(options)
}

const DEFAULT_PROJECT_OPTION_SOURCE: ResourceActionOptionSourceConfig =
    ResourceActionOptionSourceConfig {
        kind: ResourceActionOptionSourceKind::Projects,
        deploy_target: None,
        adapter: None,
        action_kind: None,
    };

fn project_matches_source(
    project: &ProjectConfig,
    source: &ResourceActionOptionSourceConfig,
) -> bool {
    if source.deploy_target.is_none() && source.adapter.is_none() && source.action_kind.is_none() {
        return true;
    }
    project.deploy_targets.iter().any(|target| {
        source
            .deploy_target
            .as_deref()
            .is_none_or(|value| target.key == value)
            && source
                .adapter
                .as_deref()
                .is_none_or(|value| build_target_adapter_key(&target.adapter) == value)
            && source
                .action_kind
                .as_deref()
                .is_none_or(|value| build_action_kind_key(&target.action_kind) == value)
    })
}

fn build_target_adapter_key(value: &BuildTargetAdapter) -> &'static str {
    match value {
        BuildTargetAdapter::Jenkins => "jenkins",
        BuildTargetAdapter::LocalCommand => "local_command",
        BuildTargetAdapter::RSeriesPackage => "r_series_package",
    }
}

fn build_action_kind_key(value: &BuildActionKind) -> &'static str {
    match value {
        BuildActionKind::Build => "build",
        BuildActionKind::Deploy => "deploy",
        BuildActionKind::Package => "package",
        BuildActionKind::Release => "release",
    }
}

fn resolve_action_params(
    action: &ResourceActionConfig,
    requested: &BTreeMap<String, Value>,
    app_config: &AppConfig,
) -> Result<BTreeMap<String, Value>> {
    let known = action
        .params
        .iter()
        .map(|param| param.key.as_str())
        .collect::<BTreeSet<_>>();
    for key in requested.keys() {
        if !known.contains(key.as_str()) {
            bail!(
                "unknown parameter for resource action {}: {key}",
                action.key
            );
        }
    }

    let mut resolved = BTreeMap::new();
    for param in &action.params {
        let options = resolved_options(param, app_config)?;
        let requested_value = if param.kind == ResourceActionParamKind::Hidden {
            None
        } else {
            requested.get(&param.key)
        };
        let value = requested_value
            .cloned()
            .or_else(|| param.default.clone())
            .or_else(|| {
                (param.kind == ResourceActionParamKind::Boolean).then_some(Value::Bool(false))
            });
        let Some(value) = value else {
            if param.required {
                bail!(
                    "required parameter is missing for resource action {}: {}",
                    action.key,
                    param.key
                );
            }
            continue;
        };
        validate_param_value(param, &value, &options, param.required).map_err(|error| {
            anyhow!(
                "invalid parameter {} for resource action {}: {error}",
                param.key,
                action.key
            )
        })?;
        resolved.insert(param.key.clone(), value);
    }
    Ok(resolved)
}

fn validate_param_value(
    param: &ResourceActionParamConfig,
    value: &Value,
    options: &[ResourceActionOption],
    enforce_required: bool,
) -> Result<()> {
    let option_values = options
        .iter()
        .map(|option| option.value.as_str())
        .collect::<BTreeSet<_>>();
    match param.kind {
        ResourceActionParamKind::Text
        | ResourceActionParamKind::Textarea
        | ResourceActionParamKind::Branch
        | ResourceActionParamKind::File
        | ResourceActionParamKind::Directory
        | ResourceActionParamKind::Secret
        | ResourceActionParamKind::Hidden => {
            let text = value.as_str().ok_or_else(|| anyhow!("expected a string"))?;
            if enforce_required && text.trim().is_empty() {
                bail!("value is required");
            }
            if !enforce_required && text.trim().is_empty() {
                return Ok(());
            }
            let length = text.chars().count();
            if let Some(min) = param.min_length
                && length < min
            {
                bail!("value must contain at least {min} characters");
            }
            if let Some(max) = param.max_length
                && length > max
            {
                bail!("value must contain at most {max} characters");
            }
        }
        ResourceActionParamKind::Number => {
            let number = value.as_f64().ok_or_else(|| anyhow!("expected a number"))?;
            if let Some(min) = param.min
                && number < min
            {
                bail!("value cannot be less than {min}");
            }
            if let Some(max) = param.max
                && number > max
            {
                bail!("value cannot be greater than {max}");
            }
            if let Some(step) = param.step {
                let base = param.min.unwrap_or(0.0);
                let steps = (number - base) / step;
                let tolerance = 1e-9 * steps.abs().max(1.0);
                if (steps - steps.round()).abs() > tolerance {
                    bail!("value must align with step {step} from base {base}");
                }
            }
        }
        ResourceActionParamKind::Boolean => {
            if !value.is_boolean() {
                bail!("expected a boolean");
            }
        }
        ResourceActionParamKind::Select | ResourceActionParamKind::Project => {
            let selected = value
                .as_str()
                .ok_or_else(|| anyhow!("expected a string option"))?;
            if enforce_required && selected.trim().is_empty() {
                bail!("value is required");
            }
            if !selected.is_empty()
                && !option_values.is_empty()
                && !option_values.contains(selected)
            {
                bail!("value is not one of the configured options: {selected}");
            }
        }
        ResourceActionParamKind::MultiSelect | ResourceActionParamKind::ProjectMulti => {
            let selected = value
                .as_array()
                .ok_or_else(|| anyhow!("expected an array of string options"))?;
            if enforce_required && selected.is_empty() {
                bail!("at least one value is required");
            }
            if !enforce_required && selected.is_empty() {
                return Ok(());
            }
            if let Some(min) = param.min_items
                && selected.len() < min
            {
                bail!("at least {min} values are required");
            }
            if let Some(max) = param.max_items
                && selected.len() > max
            {
                bail!("at most {max} values are allowed");
            }
            for item in selected {
                let item = item
                    .as_str()
                    .ok_or_else(|| anyhow!("expected an array of string options"))?;
                if !option_values.is_empty() && !option_values.contains(item) {
                    bail!("value is not one of the configured options: {item}");
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "resource_actions/tests.rs"]
mod tests;
