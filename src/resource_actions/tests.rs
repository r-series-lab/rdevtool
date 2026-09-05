use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;
use uuid::Uuid;

use super::*;
use crate::config::{
    BranchRules, DeployTargetConfig, Jobs, ProjectCommandConfig, ProjectFocusConfig,
};
use crate::operation::{OperationEventOrigin, OperationEventState, list_operation_events};

fn action_file(action: ResourceActionConfig) -> ResourceActionFile {
    ResourceActionFile {
        schema_version: RESOURCE_ACTION_SCHEMA_VERSION,
        actions: vec![action],
    }
}

fn process_action(params: Vec<ResourceActionParamConfig>) -> ResourceActionConfig {
    ResourceActionConfig {
        key: "echo".to_string(),
        name: "Echo".to_string(),
        description: None,
        effect: ResourceActionEffect::Read,
        execution: ResourceActionExecutionConfig::default(),
        runner: ResourceActionRunnerConfig {
            kind: ResourceActionRunnerKind::Process,
            program: "/bin/sh".to_string(),
            args: vec!["-c".to_string(), "cat".to_string()],
            cwd: Some("/tmp".to_string()),
            input: ResourceActionInputMode::JsonStdin,
            output: ResourceActionOutputMode::Text,
            timeout_seconds: Some(5),
            env: BTreeMap::new(),
        },
        params,
    }
}

fn empty_config() -> AppConfig {
    toml::from_str("projects = []\n[defaults]\n").expect("empty app config")
}

fn project(key: &str, target: &str) -> ProjectConfig {
    ProjectConfig {
        key: key.to_string(),
        name: key.to_uppercase(),
        category: "test".to_string(),
        repo_path: None,
        git_url: String::new(),
        dev: Some(ProjectCommandConfig::default()),
        build: Some(ProjectCommandConfig::default()),
        focus: ProjectFocusConfig::default(),
        debug_profiles: Vec::new(),
        branch_rules: BranchRules::empty(),
        deploy_targets: vec![DeployTargetConfig {
            key: target.to_string(),
            label: target.to_string(),
            adapter: BuildTargetAdapter::Jenkins,
            action_kind: BuildActionKind::Deploy,
            jenkins_profile: "default".to_string(),
            job_name: key.to_string(),
            artifact: None,
            params: Vec::new(),
        }],
        jobs: Jobs::default(),
    }
}

#[test]
fn rejects_duplicate_action_keys() {
    let action = process_action(Vec::new());
    let file = ResourceActionFile {
        schema_version: RESOURCE_ACTION_SCHEMA_VERSION,
        actions: vec![action.clone(), action],
    };
    let error = validate_resource_action_file(&file).expect_err("duplicate should fail");
    assert!(error.to_string().contains("duplicate resource action key"));
}

#[test]
fn parses_preview_deploy_example() {
    let file: ResourceActionFile =
        toml::from_str(include_str!("../../examples/resource-actions/actions.toml"))
            .expect("parse preview deploy example");

    validate_resource_action_file(&file).expect("validate preview deploy example");
    let action = file.actions.first().expect("example action");
    assert_eq!(action.key, "preview-deploy");
    assert_eq!(action.runner.program, "/bin/zsh");
    assert_eq!(
        action.runner.output,
        ResourceActionOutputMode::StructuredJson
    );
    assert!(
        action
            .params
            .iter()
            .any(|param| param.kind == ResourceActionParamKind::ProjectMulti)
    );
    let branch_override = action
        .params
        .iter()
        .find(|param| param.key == "branchOverride")
        .expect("example shared branch override");
    assert_eq!(branch_override.kind, ResourceActionParamKind::Branch);
    assert!(!branch_override.required);
    let plan_only = action
        .params
        .iter()
        .find(|param| param.key == "planOnly")
        .expect("example plan-only parameter");
    assert_eq!(plan_only.role, Some(ResourceActionParamRole::DryRun));
}

#[cfg(unix)]
#[test]
fn action_result_boolean_helper_preserves_false_and_applies_defaults() {
    let root = std::env::temp_dir().join(format!("rdevtool-action-bool-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).expect("create boolean helper fixture directory");
    let payload = root.join("payload.json");
    std::fs::write(&payload, r#"{"params":{"enabled":true,"disabled":false}}"#)
        .expect("write boolean helper payload");
    let helper =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("examples/resource-actions/action-result.zsh");

    let output = std::process::Command::new("/bin/zsh")
        .args([
            "-c",
            r#"source "$1"
printf '%s|%s|%s|%s' \
  "$(rdev_action_param_bool "$2" enabled false)" \
  "$(rdev_action_param_bool "$2" disabled true)" \
  "$(rdev_action_param_bool "$2" missing true)" \
  "$(rdev_action_param_bool "$2" missing false)""#,
            "rdevtool-action-bool-test",
        ])
        .arg(&helper)
        .arg(&payload)
        .output()
        .expect("run boolean parameter helper");

    let _ = std::fs::remove_dir_all(root);
    assert!(
        output.status.success(),
        "helper failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        String::from_utf8_lossy(&output.stdout),
        "true|false|true|false"
    );
}

#[test]
fn validates_numeric_text_and_multi_value_constraints() {
    let file: ResourceActionFile = toml::from_str(
        r#"
schema_version = 1

[[actions]]
key = "constrained"
name = "Constrained"
effect = "read"

[actions.runner]
type = "process"
program = "/bin/sh"
args = ["-c", "cat"]

[[actions.params]]
key = "port"
label = "Port"
type = "number"
required = true
min = 1
max = 65535
step = 1

[[actions.params]]
key = "label"
label = "Label"
type = "text"
min_length = 2
max_length = 4

[[actions.params]]
key = "targets"
label = "Targets"
type = "multi_select"
options = ["a", "b", "c"]
min_items = 1
max_items = 2
"#,
    )
    .expect("parse constrained action");
    validate_resource_action_file(&file).expect("valid constraints");
    let action = file.actions.first().expect("action");
    let config = empty_config();

    resolve_action_params(
        action,
        &BTreeMap::from([
            ("port".to_string(), serde_json::json!(1420)),
            ("label".to_string(), serde_json::json!("端口")),
            ("targets".to_string(), serde_json::json!(["a", "b"])),
        ]),
        &config,
    )
    .expect("values satisfy constraints");

    let step_error = resolve_action_params(
        action,
        &BTreeMap::from([("port".to_string(), serde_json::json!(1.5))]),
        &config,
    )
    .expect_err("fractional port should fail step validation");
    assert!(step_error.to_string().contains("invalid parameter port"));

    let item_error = resolve_action_params(
        action,
        &BTreeMap::from([
            ("port".to_string(), serde_json::json!(1420)),
            ("targets".to_string(), serde_json::json!(["a", "b", "c"])),
        ]),
        &config,
    )
    .expect_err("too many selections should fail");
    assert!(item_error.to_string().contains("invalid parameter targets"));
}

#[test]
fn rejects_constraints_on_incompatible_parameter_kinds() {
    let file: ResourceActionFile = toml::from_str(
        r#"
schema_version = 1

[[actions]]
key = "invalid"
name = "Invalid"

[actions.runner]
type = "process"
program = "/bin/sh"

[[actions.params]]
key = "name"
label = "Name"
type = "text"
min = 1
"#,
    )
    .expect("parse invalid constraints");

    let error = validate_resource_action_file(&file).expect_err("numeric constraint on text");
    assert!(
        error
            .to_string()
            .contains("numeric constraints require a number parameter")
    );
}

#[test]
fn plan_apply_requires_structured_output_and_a_bounded_positive_ttl() {
    let mut action = process_action(Vec::new());
    action.execution.mode = ResourceActionExecutionMode::PlanApply;
    let output_error =
        validate_resource_action_file(&action_file(action.clone())).expect_err("text plan output");
    assert!(
        output_error
            .to_string()
            .contains("requires structured_json")
    );

    action.runner.output = ResourceActionOutputMode::StructuredJson;
    action.execution.plan_ttl_seconds = 0;
    let ttl_error = validate_resource_action_file(&action_file(action)).expect_err("zero plan ttl");
    assert!(ttl_error.to_string().contains("plan_ttl_seconds"));
}

#[test]
fn resolves_project_options_with_deploy_target_filter() {
    let param = ResourceActionParamConfig {
        key: "projects".to_string(),
        label: "Projects".to_string(),
        kind: ResourceActionParamKind::ProjectMulti,
        description: None,
        placeholder: None,
        default: None,
        required: true,
        min: None,
        max: None,
        step: None,
        min_length: None,
        max_length: None,
        min_items: None,
        max_items: None,
        role: None,
        options: Vec::new(),
        source: Some(ResourceActionOptionSourceConfig {
            kind: ResourceActionOptionSourceKind::Projects,
            deploy_target: Some("preview".to_string()),
            adapter: Some("jenkins".to_string()),
            action_kind: None,
        }),
    };
    let mut config = empty_config();
    config.projects = vec![project("alpha", "preview"), project("beta", "production")];

    let options = resolved_options(&param, &config).expect("resolve options");

    assert_eq!(
        options,
        vec![ResourceActionOption {
            value: "alpha".to_string(),
            label: "ALPHA".to_string(),
        }]
    );
}

#[test]
fn process_runner_receives_json_and_redacts_secret_output() {
    let action = process_action(vec![ResourceActionParamConfig {
        key: "token".to_string(),
        label: "Token".to_string(),
        kind: ResourceActionParamKind::Secret,
        description: None,
        placeholder: None,
        default: None,
        required: true,
        min: None,
        max: None,
        step: None,
        min_length: None,
        max_length: None,
        min_items: None,
        max_items: None,
        role: None,
        options: Vec::new(),
        source: None,
    }]);
    validate_resource_action_file(&action_file(action.clone())).expect("valid action");
    let params = BTreeMap::from([("token".to_string(), Value::String("top-secret".to_string()))]);

    let result = run_process_action(
        Path::new("/tmp/actions.toml"),
        &action,
        params,
        &ResourceActionExecutionContext::default(),
        &ResourceActionOperationContext::run(None),
    )
    .expect("run action");

    assert!(result.success);
    assert!(result.stdout.contains("\"token\":\"***\""));
    assert!(result.stdout.contains("\"phase\":\"run\""));
    assert!(!result.stdout.contains("top-secret"));
}

#[test]
fn process_runner_persists_a_redacted_operation_event() {
    let root = std::env::temp_dir().join(format!("rdevtool-action-history-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).expect("create operation fixture directory");
    let storage = Storage::new(root.join("storage.sqlite3")).expect("open operation storage");
    let action = process_action(vec![ResourceActionParamConfig {
        key: "token".to_string(),
        label: "Token".to_string(),
        kind: ResourceActionParamKind::Secret,
        description: None,
        placeholder: None,
        default: None,
        required: true,
        min: None,
        max: None,
        step: None,
        min_length: None,
        max_length: None,
        min_items: None,
        max_items: None,
        role: None,
        options: Vec::new(),
        source: None,
    }]);
    let context = ResourceActionExecutionContext {
        workspace_key: Some("feature-a".to_string()),
        operation_origin: Some(OperationEventOrigin::Cli),
        operation_storage: Some(storage.clone()),
        ..ResourceActionExecutionContext::default()
    };

    let result = run_process_action(
        Path::new("/tmp/actions.toml"),
        &action,
        BTreeMap::from([("token".to_string(), Value::String("top-secret".to_string()))]),
        &context,
        &ResourceActionOperationContext::run(Some("action-persist-test".to_string())),
    )
    .expect("run persisted action");

    let events = list_operation_events(&storage).expect("list operation events");
    let event = events.first().expect("resource action operation event");
    let payload = event.payload.as_ref().expect("operation payload");
    assert_eq!(result.operation_id, "action-persist-test");
    assert_eq!(event.id, result.operation_id);
    assert_eq!(event.workspace_key, "feature-a");
    assert_eq!(event.domain, "action");
    assert_eq!(event.action, "run");
    assert_eq!(event.state, OperationEventState::Success);
    assert_eq!(
        payload["providedSecretParams"],
        serde_json::json!(["token"])
    );
    assert!(payload["params"].get("token").is_none());
    assert!(!payload.to_string().contains("top-secret"));

    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn process_runner_timeout_stops_descendants() {
    let marker = std::env::temp_dir().join(format!("rdevtool-action-timeout-{}", Uuid::new_v4()));
    let mut action = process_action(Vec::new());
    action.runner.timeout_seconds = Some(1);
    action.runner.args = vec![
        "-c".to_string(),
        format!("(sleep 2; printf orphan > '{}') & wait", marker.display()),
    ];

    let started = Instant::now();
    let result = run_process_action(
        Path::new("/tmp/actions.toml"),
        &action,
        BTreeMap::new(),
        &ResourceActionExecutionContext::default(),
        &ResourceActionOperationContext::run(None),
    )
    .expect("timed out action should return a result");

    assert!(result.timed_out);
    assert!(!result.success);
    assert!(started.elapsed() < Duration::from_secs(2));
    thread::sleep(Duration::from_millis(1_100));
    assert!(!marker.exists());
}

#[test]
fn process_runner_cancellation_stops_descendants() {
    let root = std::env::temp_dir().join(format!("rdevtool-action-cancel-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).expect("create cancellation fixture directory");
    let marker = root.join("descendant-finished");
    let mut action = process_action(Vec::new());
    action.runner.args = vec![
        "-c".to_string(),
        format!("(sleep 1; touch '{}') & wait", marker.display()),
    ];
    action.runner.timeout_seconds = Some(10);
    let cancellation_flag = Arc::new(AtomicBool::new(false));
    let trigger = cancellation_flag.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(120));
        trigger.store(true, Ordering::SeqCst);
    });
    let context = ResourceActionExecutionContext {
        cancellation_flag: Some(cancellation_flag),
        operation_origin: Some(OperationEventOrigin::App),
        operation_storage: Some(
            crate::storage::Storage::new(root.join("storage.sqlite"))
                .expect("create cancellation history storage"),
        ),
        ..ResourceActionExecutionContext::default()
    };
    let started = Instant::now();

    let result = run_process_action(
        Path::new("/tmp/actions.toml"),
        &action,
        BTreeMap::new(),
        &context,
        &ResourceActionOperationContext::run(Some("action-cancel-test".to_string())),
    )
    .expect("cancelled action should return a result");

    assert!(result.cancelled);
    assert!(!result.timed_out);
    assert!(!result.success);
    let event = list_operation_events(context.operation_storage.as_ref().unwrap())
        .expect("read cancellation event")
        .into_iter()
        .next()
        .expect("persisted cancellation event");
    assert_eq!(event.state, OperationEventState::Failed);
    assert_eq!(
        event.payload.unwrap()["error"]["code"],
        "resource_action_cancelled"
    );
    assert!(started.elapsed() < Duration::from_secs(2));
    thread::sleep(Duration::from_millis(1_100));
    assert!(!marker.exists());
}

#[test]
fn process_runner_streams_output_but_suppresses_it_when_secrets_are_present() {
    let events = Arc::new(Mutex::new(Vec::<ResourceActionProgressEvent>::new()));
    let captured = events.clone();
    let reporter = ResourceActionProgressReporter::new(move |event| {
        captured.lock().expect("lock progress events").push(event);
    });
    let mut action = process_action(Vec::new());
    action.runner.args = vec![
        "-c".to_string(),
        "printf 'stdout progress'; printf 'stderr progress' >&2".to_string(),
    ];
    let context = ResourceActionExecutionContext {
        progress_reporter: Some(reporter),
        ..ResourceActionExecutionContext::default()
    };

    run_process_action(
        Path::new("/tmp/actions.toml"),
        &action,
        BTreeMap::new(),
        &context,
        &ResourceActionOperationContext::run(Some("action-progress-test".to_string())),
    )
    .expect("run streaming action");

    let streamed = events.lock().expect("lock streamed events").clone();
    assert!(streamed.iter().any(|event| {
        event.stream == ResourceActionProgressStream::Stdout
            && event.chunk.contains("stdout progress")
    }));
    assert!(streamed.iter().any(|event| {
        event.stream == ResourceActionProgressStream::Stderr
            && event.chunk.contains("stderr progress")
    }));

    let secret_events = Arc::new(Mutex::new(Vec::<ResourceActionProgressEvent>::new()));
    let captured = secret_events.clone();
    let reporter = ResourceActionProgressReporter::new(move |event| {
        captured
            .lock()
            .expect("lock secret progress events")
            .push(event);
    });
    let mut secret_action = process_action(vec![ResourceActionParamConfig {
        key: "token".to_string(),
        label: "Token".to_string(),
        kind: ResourceActionParamKind::Secret,
        required: true,
        default: None,
        role: None,
        options: Vec::new(),
        source: None,
        description: None,
        placeholder: None,
        min: None,
        max: None,
        step: None,
        min_length: None,
        max_length: None,
        min_items: None,
        max_items: None,
    }]);
    secret_action.runner.args = vec!["-c".to_string(), "printf 'top-secret' >&2".to_string()];
    let context = ResourceActionExecutionContext {
        progress_reporter: Some(reporter),
        ..ResourceActionExecutionContext::default()
    };
    let result = run_process_action(
        Path::new("/tmp/actions.toml"),
        &secret_action,
        BTreeMap::from([("token".to_string(), Value::String("top-secret".to_string()))]),
        &context,
        &ResourceActionOperationContext::run(Some("action-secret-progress-test".to_string())),
    )
    .expect("run secret streaming action");

    let streamed = secret_events
        .lock()
        .expect("lock suppressed events")
        .clone();
    assert_eq!(streamed.len(), 1);
    assert!(streamed[0].output_suppressed);
    assert_eq!(streamed[0].stream, ResourceActionProgressStream::System);
    assert!(
        !serde_json::to_string(&streamed)
            .unwrap()
            .contains("top-secret")
    );
    assert_eq!(result.stderr, "***");
}

#[test]
fn process_runner_resolves_cli_alias_and_injects_execution_context() {
    let mut action = process_action(Vec::new());
    action.runner.program = process::RDEVTOOL_PROGRAM_ALIAS.to_string();
    action.runner.args = vec![
        "-c".to_string(),
        "printf '%s|%s|%s' \"$RDEVTOOL_CLI\" \"$RDEVTOOL_CONFIG_PATH\" \"$RDEVTOOL_WORKSPACE_KEY\""
            .to_string(),
    ];
    let context = ResourceActionExecutionContext {
        rdevtool_cli_path: Some(PathBuf::from("/bin/sh")),
        rdevtool_cli_error: None,
        config_path: Some(PathBuf::from("/tmp/projects.toml")),
        workspace_key: Some("feature-a".to_string()),
        operation_origin: None,
        operation_storage: None,
        cancellation_flag: None,
        progress_reporter: None,
    };

    let result = run_process_action(
        Path::new("/tmp/actions.toml"),
        &action,
        BTreeMap::new(),
        &context,
        &ResourceActionOperationContext::run(None),
    )
    .expect("run action through resolved CLI alias");

    assert!(result.success);
    assert_eq!(result.stdout, "/bin/sh|/tmp/projects.toml|feature-a");
}

#[test]
fn structured_result_is_parsed_and_retry_values_stay_within_the_original_input() {
    let mut action = process_action(vec![ResourceActionParamConfig {
        key: "projects".to_string(),
        label: "Projects".to_string(),
        kind: ResourceActionParamKind::ProjectMulti,
        description: None,
        placeholder: None,
        default: None,
        required: true,
        min: None,
        max: None,
        step: None,
        min_length: None,
        max_length: None,
        min_items: None,
        max_items: None,
        role: None,
        options: Vec::new(),
        source: None,
    }]);
    action.runner.output = ResourceActionOutputMode::StructuredJson;
    action.runner.args = vec![
        "-c".to_string(),
        "cat >/dev/null; printf '%s' '{\"schemaVersion\":1,\"summary\":\"Checked 2 projects\",\"items\":[{\"key\":\"alpha\",\"label\":\"Alpha\",\"status\":\"success\"},{\"key\":\"beta\",\"label\":\"Beta\",\"status\":\"failed\",\"parameters\":[{\"key\":\"env\",\"label\":\"Environment\",\"value\":\"pre\"}]}],\"retry\":{\"param\":\"projects\",\"values\":[\"beta\"]}}'".to_string(),
    ];
    let params = BTreeMap::from([("projects".to_string(), serde_json::json!(["alpha", "beta"]))]);

    let result = run_process_action(
        Path::new("/tmp/actions.toml"),
        &action,
        params,
        &ResourceActionExecutionContext::default(),
        &ResourceActionOperationContext::run(None),
    )
    .expect("run structured action");

    assert!(!result.success, "a failed structured item fails the action");
    let structured = result.structured_result.expect("structured result");
    assert_eq!(structured.items.len(), 2);
    assert_eq!(structured.retry.expect("retry").values, vec!["beta"]);
}

#[test]
fn structured_result_rejects_retry_values_outside_the_original_input() {
    let mut action = process_action(vec![ResourceActionParamConfig {
        key: "projects".to_string(),
        label: "Projects".to_string(),
        kind: ResourceActionParamKind::ProjectMulti,
        description: None,
        placeholder: None,
        default: None,
        required: true,
        min: None,
        max: None,
        step: None,
        min_length: None,
        max_length: None,
        min_items: None,
        max_items: None,
        role: None,
        options: Vec::new(),
        source: None,
    }]);
    action.runner.output = ResourceActionOutputMode::StructuredJson;
    action.runner.args = vec![
        "-c".to_string(),
        "cat >/dev/null; printf '%s' '{\"schemaVersion\":1,\"items\":[],\"retry\":{\"param\":\"projects\",\"values\":[\"gamma\"]}}'".to_string(),
    ];
    let params = BTreeMap::from([("projects".to_string(), serde_json::json!(["alpha"]))]);

    let result = run_process_action(
        Path::new("/tmp/actions.toml"),
        &action,
        params,
        &ResourceActionExecutionContext::default(),
        &ResourceActionOperationContext::run(None),
    )
    .expect("protocol failures return an inspectable action result");

    assert!(!result.success);
    assert!(result.structured_result.is_none());
    assert!(
        result
            .stderr
            .contains("retry value was not part of the original input: gamma")
    );
}

#[test]
fn plan_apply_persists_evidence_replays_params_and_consumes_once() {
    let root = std::env::temp_dir().join(format!("rdevtool-action-plan-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).expect("create plan fixture directory");
    let actions_path = root.join("actions.toml");
    std::fs::write(
        &actions_path,
        r#"
schema_version = 1

[[actions]]
key = "release-port"
name = "Release port"
effect = "destructive"

[actions.execution]
mode = "plan_apply"
plan_ttl_seconds = 300

[actions.runner]
type = "process"
program = "/bin/sh"
args = ["-c", "input=$(cat); if printf '%s' \"$input\" | grep -q '\"phase\":\"plan\"'; then printf '%s' '{\"schemaVersion\":1,\"summary\":\"listener found\",\"items\":[{\"key\":\"pid-42\",\"label\":\"server (PID 42)\",\"status\":\"warning\",\"parameters\":[{\"key\":\"pid\",\"label\":\"PID\",\"value\":\"42\"}]}]}'; elif printf '%s' \"$input\" | grep -q '\"phase\":\"apply\"' && printf '%s' \"$input\" | grep -q '\"planEvidence\"'; then printf '%s' '{\"schemaVersion\":1,\"summary\":\"released\",\"items\":[{\"key\":\"pid-42\",\"label\":\"server (PID 42)\",\"status\":\"success\"}]}'; else exit 9; fi"]
output = "structured_json"

[[actions.params]]
key = "port"
label = "Port"
type = "number"
required = true
min = 1
max = 65535
step = 1
"#,
    )
    .expect("write plan fixture");
    let storage = Storage::new(root.join("storage.sqlite3")).expect("open temp storage");
    let config = empty_config();
    let context = ResourceActionExecutionContext {
        workspace_key: Some("feature-a".to_string()),
        ..ResourceActionExecutionContext::default()
    };

    let plan = plan_resource_action_from_path_with_storage(
        &storage,
        &actions_path,
        ResourceActionRunRequest {
            key: "release-port".to_string(),
            params: BTreeMap::from([("port".to_string(), serde_json::json!(1420))]),
            operation_id: None,
        },
        &config,
        &context,
    )
    .expect("create action plan");

    assert_eq!(plan.workspace_key.as_deref(), Some("feature-a"));
    assert_eq!(
        plan.effective_params.get("port"),
        Some(&serde_json::json!(1420))
    );
    assert_eq!(plan.plan_result.items[0].key, "pid-42");
    assert!(plan.consumed_at.is_none());

    let result = apply_resource_action_plan_from_path_with_storage(
        &storage,
        &actions_path,
        ResourceActionApplyRequest {
            plan_id: plan.plan_id.clone(),
            params: BTreeMap::new(),
            operation_id: None,
        },
        &config,
        &context,
    )
    .expect("apply action plan");
    assert!(result.success);
    assert_eq!(
        result
            .structured_result
            .expect("apply result")
            .summary
            .as_deref(),
        Some("released")
    );

    let replay_error = apply_resource_action_plan_from_path_with_storage(
        &storage,
        &actions_path,
        ResourceActionApplyRequest {
            plan_id: plan.plan_id,
            params: BTreeMap::new(),
            operation_id: None,
        },
        &config,
        &context,
    )
    .expect_err("consumed plan must not replay");
    assert!(replay_error.to_string().contains("already been consumed"));

    let workspace_plan = plan_resource_action_from_path_with_storage(
        &storage,
        &actions_path,
        ResourceActionRunRequest {
            key: "release-port".to_string(),
            params: BTreeMap::from([("port".to_string(), serde_json::json!(1421))]),
            operation_id: None,
        },
        &config,
        &context,
    )
    .expect("create workspace-bound plan");
    let wrong_workspace = ResourceActionExecutionContext {
        workspace_key: Some("feature-b".to_string()),
        ..ResourceActionExecutionContext::default()
    };
    let workspace_error = apply_resource_action_plan_from_path_with_storage(
        &storage,
        &actions_path,
        ResourceActionApplyRequest {
            plan_id: workspace_plan.plan_id.clone(),
            params: BTreeMap::new(),
            operation_id: None,
        },
        &config,
        &wrong_workspace,
    )
    .expect_err("wrong workspace must fail");
    assert!(
        workspace_error
            .to_string()
            .contains("belongs to workspace feature-a")
    );
    apply_resource_action_plan_from_path_with_storage(
        &storage,
        &actions_path,
        ResourceActionApplyRequest {
            plan_id: workspace_plan.plan_id,
            params: BTreeMap::new(),
            operation_id: None,
        },
        &config,
        &context,
    )
    .expect("workspace validation failure must not consume the plan");

    let mut expired_plan = plan_resource_action_from_path_with_storage(
        &storage,
        &actions_path,
        ResourceActionRunRequest {
            key: "release-port".to_string(),
            params: BTreeMap::from([("port".to_string(), serde_json::json!(1422))]),
            operation_id: None,
        },
        &config,
        &context,
    )
    .expect("create plan to expire");
    expired_plan.expires_at = "2000-01-01T00:00:00Z".to_string();
    storage
        .set_json(
            RESOURCE_ACTION_PLAN_NAMESPACE,
            &expired_plan.plan_id,
            &serde_json::to_value(&expired_plan).expect("serialize expired plan"),
        )
        .expect("persist expired plan");
    let expiration_error = apply_resource_action_plan_from_path_with_storage(
        &storage,
        &actions_path,
        ResourceActionApplyRequest {
            plan_id: expired_plan.plan_id,
            params: BTreeMap::new(),
            operation_id: None,
        },
        &config,
        &context,
    )
    .expect_err("expired plan must fail");
    assert!(expiration_error.to_string().contains("has expired"));

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn plan_storage_never_persists_secret_values_and_apply_requires_the_same_secret() {
    let root = std::env::temp_dir().join(format!("rdevtool-action-secret-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).expect("create secret fixture directory");
    let actions_path = root.join("actions.toml");
    std::fs::write(
        &actions_path,
        r#"
schema_version = 1

[[actions]]
key = "secret-action"
name = "Secret action"
effect = "remote_write"

[actions.execution]
mode = "plan_apply"

[actions.runner]
type = "process"
program = "/bin/sh"
args = ["-c", "cat >/dev/null; printf '%s' '{\"schemaVersion\":1,\"items\":[{\"key\":\"target\",\"label\":\"Target\",\"status\":\"success\"}]}'"]
output = "structured_json"

[[actions.params]]
key = "token"
label = "Token"
type = "secret"
required = true
"#,
    )
    .expect("write secret fixture");
    let storage = Storage::new(root.join("storage.sqlite3")).expect("open temp storage");
    let config = empty_config();
    let context = ResourceActionExecutionContext::default();
    let token = "do-not-persist-this-token";
    let plan = plan_resource_action_from_path_with_storage(
        &storage,
        &actions_path,
        ResourceActionRunRequest {
            key: "secret-action".to_string(),
            params: BTreeMap::from([("token".to_string(), serde_json::json!(token))]),
            operation_id: None,
        },
        &config,
        &context,
    )
    .expect("create secret action plan");

    let stored = storage
        .get_json(RESOURCE_ACTION_PLAN_NAMESPACE, &plan.plan_id)
        .expect("read stored plan")
        .expect("stored plan exists");
    assert!(!stored.to_string().contains(token));
    assert!(plan.effective_params.is_empty());
    assert_eq!(plan.secret_params, vec!["token"]);

    let missing_secret = apply_resource_action_plan_from_path_with_storage(
        &storage,
        &actions_path,
        ResourceActionApplyRequest {
            plan_id: plan.plan_id.clone(),
            params: BTreeMap::new(),
            operation_id: None,
        },
        &config,
        &context,
    )
    .expect_err("secret must be supplied again");
    assert!(
        missing_secret
            .to_string()
            .contains("required parameter is missing")
    );

    let wrong_secret = apply_resource_action_plan_from_path_with_storage(
        &storage,
        &actions_path,
        ResourceActionApplyRequest {
            plan_id: plan.plan_id.clone(),
            params: BTreeMap::from([("token".to_string(), serde_json::json!("wrong"))]),
            operation_id: None,
        },
        &config,
        &context,
    )
    .expect_err("secret fingerprint mismatch must fail");
    assert!(wrong_secret.to_string().contains("parameters changed"));

    let result = apply_resource_action_plan_from_path_with_storage(
        &storage,
        &actions_path,
        ResourceActionApplyRequest {
            plan_id: plan.plan_id,
            params: BTreeMap::from([("token".to_string(), serde_json::json!(token))]),
            operation_id: None,
        },
        &config,
        &context,
    )
    .expect("apply with matching secret");
    assert!(result.success);

    let _ = std::fs::remove_dir_all(root);
}
