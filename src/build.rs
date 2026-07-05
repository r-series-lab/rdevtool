use crate::config::{
    AppConfig, BuildActionKind, BuildTargetAdapter, DeployTargetConfig, JenkinsProfileConfig,
    ProjectConfig,
};
use crate::credentials;
use crate::jenkins;
use anyhow::{Context, Result, bail};
use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildAdapterPlan {
    pub adapter: String,
    pub action_kind: String,
    pub job_name: String,
    pub trigger_url: String,
    pub jenkins_base_url: String,
    pub command: Option<String>,
    pub cwd: Option<String>,
    pub output_dir: Option<String>,
}

pub struct BuildAdapterExecution<'a> {
    pub trigger_url: &'a str,
    pub params: &'a BTreeMap<String, String>,
    pub command: Option<&'a str>,
    pub cwd: Option<&'a str>,
    pub output_dir: Option<&'a str>,
}

#[derive(Debug, Clone)]
pub struct BuildAdapterRunResult {
    pub status: u16,
    pub queue_url: Option<String>,
    pub build_url: Option<String>,
    pub state_key: String,
    pub state_label: String,
    pub detail: String,
}

#[derive(Debug, Clone)]
struct LocalCommandPlan {
    command: String,
    cwd: PathBuf,
    output_dir: Option<PathBuf>,
}

pub fn adapter_key(adapter: &BuildTargetAdapter) -> &'static str {
    match adapter {
        BuildTargetAdapter::Jenkins => "jenkins",
        BuildTargetAdapter::LocalCommand => "local_command",
        BuildTargetAdapter::RSeriesPackage => "r_series_package",
    }
}

pub fn action_kind_key(action_kind: &BuildActionKind) -> &'static str {
    match action_kind {
        BuildActionKind::Build => "build",
        BuildActionKind::Deploy => "deploy",
        BuildActionKind::Package => "package",
        BuildActionKind::Release => "release",
    }
}

pub fn plan_adapter(
    config: &AppConfig,
    project: &ProjectConfig,
    target: &DeployTargetConfig,
    params: &BTreeMap<String, String>,
) -> Result<BuildAdapterPlan> {
    match target.adapter {
        BuildTargetAdapter::Jenkins => {
            let profile = selected_jenkins_profile(config, target)?;
            Ok(BuildAdapterPlan {
                adapter: adapter_key(&target.adapter).to_string(),
                action_kind: action_kind_key(&target.action_kind).to_string(),
                job_name: target.job_name.clone(),
                trigger_url: build_jenkins_trigger_url(&profile.base_url, &target.job_name),
                jenkins_base_url: profile.base_url.clone(),
                command: None,
                cwd: None,
                output_dir: None,
            })
        }
        BuildTargetAdapter::LocalCommand | BuildTargetAdapter::RSeriesPackage => {
            let local = resolve_local_command_plan(project, target, params)?;
            Ok(BuildAdapterPlan {
                adapter: adapter_key(&target.adapter).to_string(),
                action_kind: action_kind_key(&target.action_kind).to_string(),
                job_name: local.command.clone(),
                trigger_url: String::new(),
                jenkins_base_url: String::new(),
                command: Some(local.command),
                cwd: Some(local.cwd.display().to_string()),
                output_dir: local.output_dir.map(|path| path.display().to_string()),
            })
        }
    }
}

pub fn trigger_adapter(
    config: &AppConfig,
    project: &ProjectConfig,
    target: &DeployTargetConfig,
    execution: BuildAdapterExecution<'_>,
) -> Result<BuildAdapterRunResult> {
    match target.adapter {
        BuildTargetAdapter::Jenkins => {
            let profile = selected_jenkins_profile(config, target)?;
            let password = credentials::load_jenkins_profile_password(profile)
                .or_else(|_| credentials::load_jenkins_password(&config.defaults))?;
            let result = jenkins::trigger_build(
                &profile.base_url,
                &profile.username,
                &password,
                execution.trigger_url,
                execution.params,
            )?;
            Ok(BuildAdapterRunResult {
                status: result.status,
                queue_url: result.queue_url,
                build_url: result.build_url,
                state_key: jenkins_state_key(result.state).to_string(),
                state_label: result.state.label().to_string(),
                detail: result.detail,
            })
        }
        BuildTargetAdapter::LocalCommand | BuildTargetAdapter::RSeriesPackage => {
            run_local_command(project, target, execution)
        }
    }
}

pub fn local_execution_env(
    project: &ProjectConfig,
    target: &DeployTargetConfig,
    params: &BTreeMap<String, String>,
    command: &str,
    cwd: &str,
    output_dir: Option<&str>,
) -> BTreeMap<String, String> {
    let plan = LocalCommandPlan {
        command: command.to_string(),
        cwd: PathBuf::from(cwd),
        output_dir: output_dir.map(PathBuf::from),
    };
    local_command_env(project, target, &plan, params)
}

pub fn refresh_jenkins_status(
    config: &AppConfig,
    queue_url: Option<&str>,
    build_url: Option<&str>,
) -> Result<jenkins::StatusResult> {
    let profile = default_jenkins_profile(config)?;
    let password = credentials::load_jenkins_profile_password(profile)
        .or_else(|_| credentials::load_jenkins_password(&config.defaults))?;
    jenkins::refresh_status(
        &profile.base_url,
        &profile.username,
        &password,
        queue_url,
        build_url,
    )
}

fn selected_jenkins_profile<'a>(
    config: &'a AppConfig,
    target: &DeployTargetConfig,
) -> Result<&'a JenkinsProfileConfig> {
    config
        .defaults
        .jenkins_profiles
        .get(&target.jenkins_profile)
        .with_context(|| format!("jenkins profile {} not found", target.jenkins_profile))
}

fn default_jenkins_profile(config: &AppConfig) -> Result<&JenkinsProfileConfig> {
    if let Some(profile) = config.defaults.jenkins_profiles.get("default") {
        return Ok(profile);
    }
    config
        .defaults
        .jenkins_profiles
        .values()
        .next()
        .with_context(|| "no Jenkins profile configured")
}

fn build_jenkins_trigger_url(base_url: &str, job_name: &str) -> String {
    let encoded_path = job_name
        .split('/')
        .map(|segment| format!("job/{}", utf8_percent_encode(segment, NON_ALPHANUMERIC)))
        .collect::<Vec<_>>()
        .join("/");

    format!(
        "{}/{}/buildWithParameters",
        base_url.trim_end_matches('/'),
        encoded_path
    )
}

fn resolve_local_command_plan(
    project: &ProjectConfig,
    target: &DeployTargetConfig,
    params: &BTreeMap<String, String>,
) -> Result<LocalCommandPlan> {
    let base_dir = project_base_dir(project)?;
    let build_config = project.build.as_ref();

    let command = param_value(
        params,
        &["build_command", "command", "BUILD_COMMAND", "COMMAND"],
    )
    .or_else(|| non_empty_text(&target.job_name))
    .or_else(|| build_config.and_then(|config| non_empty_text(&config.command)))
    .unwrap_or_else(|| "npm run build".to_string());

    let cwd = if let Some(value) = param_value(params, &["build_cwd", "cwd", "BUILD_CWD", "CWD"]) {
        resolve_path(&base_dir, Path::new(&value))
    } else if let Some(cwd) = build_config.and_then(|config| config.cwd.as_ref()) {
        resolve_path(&base_dir, cwd)
    } else {
        base_dir
    };

    let output_dir = if let Some(value) = param_value(
        params,
        &[
            "build_output_dir",
            "output_dir",
            "outputDir",
            "BUILD_OUTPUT_DIR",
            "OUTPUT_DIR",
        ],
    ) {
        Some(resolve_path(&cwd, Path::new(&value)))
    } else {
        build_config
            .and_then(|config| config.output_dir.as_ref())
            .map(|path| resolve_path(&cwd, path))
    };

    Ok(LocalCommandPlan {
        command,
        cwd,
        output_dir,
    })
}

fn run_local_command(
    project: &ProjectConfig,
    target: &DeployTargetConfig,
    execution: BuildAdapterExecution<'_>,
) -> Result<BuildAdapterRunResult> {
    let mut plan = resolve_local_command_plan(project, target, execution.params)?;
    if let Some(command) = execution.command.and_then(non_empty_text) {
        plan.command = command;
    }
    if let Some(cwd) = execution.cwd.and_then(non_empty_text) {
        plan.cwd = PathBuf::from(cwd);
    }
    if let Some(output_dir) = execution.output_dir.and_then(non_empty_text) {
        plan.output_dir = Some(PathBuf::from(output_dir));
    }

    if !plan.cwd.exists() {
        bail!("build cwd does not exist: {}", plan.cwd.display());
    }
    if !plan.cwd.is_dir() {
        bail!("build cwd is not a directory: {}", plan.cwd.display());
    }

    let mut command = shell_command(&plan.command);
    command.current_dir(&plan.cwd).envs(local_command_env(
        project,
        target,
        &plan,
        execution.params,
    ));
    strip_inherited_tauri_build_env(&mut command);

    let output = command.output().with_context(|| {
        format!(
            "failed to run build command in {}: {}",
            plan.cwd.display(),
            plan.command
        )
    })?;

    let exit_code = output.status.code().unwrap_or(1);
    let success = output.status.success();
    Ok(BuildAdapterRunResult {
        status: normalized_exit_status(exit_code),
        queue_url: None,
        build_url: None,
        state_key: if success { "success" } else { "failure" }.to_string(),
        state_label: if success {
            "构建成功"
        } else {
            "构建失败"
        }
        .to_string(),
        detail: local_command_detail(&plan, exit_code, &output.stdout, &output.stderr),
    })
}

fn shell_command(command: &str) -> Command {
    if cfg!(target_os = "windows") {
        let mut child = Command::new("cmd");
        child.args(["/C", command]);
        child
    } else {
        let mut child = Command::new("sh");
        child.args(["-lc", command]);
        child
    }
}

fn strip_inherited_tauri_build_env(command: &mut Command) {
    for (key, _) in std::env::vars() {
        if key == "OUT_DIR"
            || key.starts_with("TAURI_")
            || key.starts_with("CARGO_MANIFEST_")
            || key.starts_with("CARGO_PKG_")
        {
            command.env_remove(key);
        }
    }
}

fn local_command_env(
    project: &ProjectConfig,
    target: &DeployTargetConfig,
    plan: &LocalCommandPlan,
    params: &BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    let mut env = project
        .build
        .as_ref()
        .map(|config| config.env.clone())
        .unwrap_or_default();

    for (key, value) in params {
        env.insert(
            format!("RDEVTOOL_PARAM_{}", env_key_fragment(key)),
            value.clone(),
        );
    }
    env.insert("RDEVTOOL_PROJECT_KEY".to_string(), project.key.clone());
    env.insert("RDEVTOOL_PROJECT_NAME".to_string(), project.name.clone());
    env.insert(
        "RDEVTOOL_BUILD_ADAPTER".to_string(),
        adapter_key(&target.adapter).to_string(),
    );
    env.insert(
        "RDEVTOOL_BUILD_ACTION".to_string(),
        action_kind_key(&target.action_kind).to_string(),
    );
    env.insert("RDEVTOOL_BUILD_COMMAND".to_string(), plan.command.clone());
    env.insert(
        "RDEVTOOL_BUILD_CWD".to_string(),
        plan.cwd.display().to_string(),
    );

    if let Some(output_dir) = &plan.output_dir {
        env.insert(
            "RDEVTOOL_BUILD_OUTPUT_DIR".to_string(),
            output_dir.display().to_string(),
        );
    }
    if let Some(platform) = param_value(params, &["platform", "PLATFORM", "system", "SYSTEM"]) {
        env.insert("RDEVTOOL_BUILD_PLATFORM".to_string(), platform);
    }
    if let Some(profile) = param_value(params, &["profile", "PROFILE", "env", "ENV_PROFILE"]) {
        env.insert("RDEVTOOL_BUILD_PROFILE".to_string(), profile);
    }
    if let Some(channel) = param_value(params, &["channel", "CHANNEL"]) {
        env.insert("RDEVTOOL_BUILD_CHANNEL".to_string(), channel);
    }

    env
}

fn local_command_detail(
    plan: &LocalCommandPlan,
    exit_code: i32,
    stdout: &[u8],
    stderr: &[u8],
) -> String {
    let mut lines = vec![
        format!("命令：{}", plan.command),
        format!("目录：{}", plan.cwd.display()),
        format!("退出码：{exit_code}"),
    ];
    if let Some(output_dir) = &plan.output_dir {
        lines.push(format!("产物目录：{}", output_dir.display()));
    }

    let stdout = tail_text(stdout, 2400);
    let stderr = tail_text(stderr, 2400);
    if !stdout.is_empty() {
        lines.push(format!("stdout:\n{stdout}"));
    }
    if !stderr.is_empty() {
        lines.push(format!("stderr:\n{stderr}"));
    }
    lines.join("\n")
}

fn tail_text(bytes: &[u8], limit: usize) -> String {
    let text = String::from_utf8_lossy(bytes).trim().to_string();
    let char_count = text.chars().count();
    if char_count <= limit {
        return text;
    }
    let tail = text
        .chars()
        .skip(char_count.saturating_sub(limit))
        .collect::<String>();
    format!("...{tail}")
}

fn project_base_dir(project: &ProjectConfig) -> Result<PathBuf> {
    if let Some(repo_path) = &project.repo_path {
        return Ok(repo_path.clone());
    }
    std::env::current_dir().context("failed to resolve current directory")
}

fn resolve_path(base: &Path, target: &Path) -> PathBuf {
    if target.is_absolute() {
        target.to_path_buf()
    } else {
        base.join(target)
    }
}

fn param_value(params: &BTreeMap<String, String>, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = params.get(*key).and_then(|value| non_empty_text(value)) {
            return Some(value);
        }
    }
    params
        .iter()
        .find(|(key, _)| keys.iter().any(|target| key.eq_ignore_ascii_case(target)))
        .and_then(|(_, value)| non_empty_text(value))
}

fn non_empty_text(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn env_key_fragment(key: &str) -> String {
    key.chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect()
}

fn normalized_exit_status(exit_code: i32) -> u16 {
    u16::try_from(exit_code).unwrap_or(u16::MAX)
}

fn jenkins_state_key(state: jenkins::TriggerState) -> &'static str {
    match state {
        jenkins::TriggerState::Accepted => "accepted",
        jenkins::TriggerState::Queued => "queued",
        jenkins::TriggerState::Running => "running",
        jenkins::TriggerState::Success => "success",
        jenkins::TriggerState::Failure => "failure",
        jenkins::TriggerState::Cancelled => "cancelled",
    }
}
