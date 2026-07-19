use crate::config::default_config_dir;
use crate::runtime_local_proxy::{
    RunningLocalProxy, RuntimeLocalProxySpec, remove_local_proxy_artifacts, spawn_local_proxy,
    validate_local_proxy_spec,
};
use anyhow::{Context, Result, anyhow, bail};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const DAEMON_MARKER: &str = "--rdevtool-runtime-daemon";
const STATE_SCHEMA_VERSION: u16 = 2;
const DAEMON_PROTOCOL_VERSION: u16 = 2;
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const START_TIMEOUT: Duration = Duration::from_secs(6);
const START_STABILITY: Duration = Duration::from_millis(240);
const STOP_TIMEOUT: Duration = Duration::from_secs(3);
const STOP_REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const POLL_INTERVAL: Duration = Duration::from_millis(80);

#[derive(Debug, Clone)]
pub struct RuntimeDaemonStartRequest {
    pub project_key: String,
    pub project_name: String,
    pub cwd: PathBuf,
    pub command: String,
    pub env: BTreeMap<String, String>,
    pub debug_profile: Option<String>,
    pub runtime_profile: Option<String>,
    pub expected_port: Option<u16>,
    pub ready: RuntimeDaemonReadyConfig,
    pub log_path: PathBuf,
    pub local_proxy: Option<RuntimeLocalProxySpec>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDaemonReadyConfig {
    pub enabled: bool,
    pub url_patterns: Vec<String>,
    pub success_markers: Vec<String>,
    pub fallback_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeDaemonPhase {
    Starting,
    Running,
    Stopping,
    Exited,
    Failed,
}

impl RuntimeDaemonPhase {
    fn active(&self) -> bool {
        matches!(self, Self::Starting | Self::Running | Self::Stopping)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDaemonExit {
    pub code: Option<i32>,
    pub signal: Option<i32>,
    pub reason: String,
    pub exited_at_ms: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDaemonState {
    pub schema_version: u16,
    pub protocol_version: u16,
    pub app_version: String,
    pub run_id: String,
    pub status_key: String,
    pub project_key: String,
    pub project_name: String,
    pub canonical_cwd: String,
    pub command: String,
    pub debug_profile: Option<String>,
    pub runtime_profile: Option<String>,
    pub expected_port: Option<u16>,
    pub ready_url: Option<String>,
    pub daemon_pid: u32,
    pub worker_pid: Option<u32>,
    pub worker_pgid: Option<u32>,
    #[serde(default)]
    pub adopted: bool,
    #[serde(default)]
    pub adopted_process: Option<RuntimeProcessIdentity>,
    pub local_proxy_pid: Option<u32>,
    pub local_proxy_pgid: Option<u32>,
    pub started_at: String,
    pub started_at_ms: u64,
    pub log_path: String,
    pub phase: RuntimeDaemonPhase,
    pub exit: Option<RuntimeDaemonExit>,
    pub executable: String,
    pub request_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDaemonStatus {
    pub status_key: String,
    pub phase_key: String,
    pub project_key: String,
    pub canonical_cwd: String,
    pub state_path: String,
    pub running: bool,
    pub managed: bool,
    pub version_compatible: bool,
    pub daemon_alive: bool,
    pub worker_group_alive: bool,
    pub local_proxy_group_alive: bool,
    pub detail: String,
    pub state: Option<RuntimeDaemonState>,
}

#[derive(Debug, Clone)]
pub struct RuntimeDaemonStartResult {
    pub status: RuntimeDaemonStatus,
    pub started_new: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDaemonDiagnosis {
    pub healthy: bool,
    pub status: RuntimeDaemonStatus,
    pub issues: Vec<String>,
    pub process_command: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDaemonAdoptResponse {
    pub supported: bool,
    pub status_key: String,
    pub project_key: String,
    pub canonical_cwd: String,
    pub pid: u32,
    pub pgid: u32,
    pub command: String,
    pub detail: String,
    pub status: RuntimeDaemonStatus,
}

#[derive(Debug, Clone)]
pub struct RuntimeDaemonAdoptRequest {
    pub project_key: String,
    pub project_name: String,
    pub cwd: PathBuf,
    pub pid: u32,
    pub expected_command: String,
    pub expected_port: Option<u16>,
    pub ready_url: Option<String>,
    pub log_path: PathBuf,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeProcessIdentity {
    pub pid: u32,
    pub ppid: u32,
    pub pgid: u32,
    pub canonical_cwd: String,
    pub command: String,
    pub started_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredRuntimeDaemonRequest {
    schema_version: u16,
    protocol_version: u16,
    app_version: String,
    run_id: String,
    control_token: String,
    status_key: String,
    project_key: String,
    project_name: String,
    canonical_cwd: String,
    command: String,
    env: BTreeMap<String, String>,
    debug_profile: Option<String>,
    runtime_profile: Option<String>,
    expected_port: Option<u16>,
    ready: RuntimeDaemonReadyConfig,
    log_path: String,
    local_proxy: Option<RuntimeLocalProxySpec>,
    #[serde(default)]
    adopted_process: Option<RuntimeProcessIdentity>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeDaemonStopRequest {
    schema_version: u16,
    protocol_version: u16,
    app_version: String,
    run_id: String,
    control_token: String,
    status_key: String,
    project_key: String,
    canonical_cwd: String,
    daemon_pid: u32,
}

struct RuntimeDaemonServeArgs {
    request_path: PathBuf,
    state_path: PathBuf,
    run_id: String,
}

pub fn run_runtime_daemon_from_args(args: &[OsString]) -> Option<Result<()>> {
    if args.get(1).and_then(|value| value.to_str()) != Some(DAEMON_MARKER) {
        return None;
    }
    Some(parse_runtime_daemon_args(args).and_then(run_runtime_daemon_serve))
}

pub fn start(request: RuntimeDaemonStartRequest) -> Result<RuntimeDaemonStatus> {
    start_with_result(request).map(|result| result.status)
}

pub fn start_with_result(request: RuntimeDaemonStartRequest) -> Result<RuntimeDaemonStartResult> {
    let request = prepare_stored_request(request)?;
    let state_path = runtime_daemon_state_path(&request.project_key, &request.canonical_cwd);
    let _guard = RuntimeDaemonOperationLock::acquire(&state_path)?;
    let current = status_for_state_path(&state_path, &request.project_key, &request.canonical_cwd)?;
    if current.running {
        if !current.managed {
            bail!(
                "runtime process group is alive without a verified daemon: {}",
                current.detail
            );
        }
        if current.version_compatible {
            return Ok(RuntimeDaemonStartResult {
                status: current,
                started_new: false,
            });
        }
        stop_managed_daemon(&current)?;
    }
    launch_stored_request(request)
}

fn launch_stored_request(request: StoredRuntimeDaemonRequest) -> Result<RuntimeDaemonStartResult> {
    let state_path = runtime_daemon_state_path(&request.project_key, &request.canonical_cwd);
    if let Some(local_proxy) = request.local_proxy.as_ref() {
        validate_local_proxy_spec(local_proxy).map_err(anyhow::Error::msg)?;
    }
    remove_file_if_exists(&runtime_daemon_stop_path(&state_path))?;
    let request_path = runtime_daemon_request_path(&state_path, &request.run_id);
    remove_old_request_files(&state_path, Some(&request_path))?;
    write_json_atomic(&request_path, &request)?;

    let executable = std::env::current_exe().context("failed to locate rDevTool executable")?;
    let daemon_log_path = runtime_daemon_log_path(&state_path);
    if let Some(parent) = daemon_log_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&daemon_log_path)
        .with_context(|| {
            format!(
                "failed to open runtime daemon log: {}",
                daemon_log_path.display()
            )
        })?;
    let stderr = stdout.try_clone()?;
    let mut command = Command::new(&executable);
    command
        .arg(DAEMON_MARKER)
        .arg("--request-path")
        .arg(&request_path)
        .arg("--state-path")
        .arg(&state_path)
        .arg("--run-id")
        .arg(&request.run_id)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn().with_context(|| {
        format!(
            "failed to start runtime daemon with executable {}",
            executable.display()
        )
    })?;

    let started = Instant::now();
    loop {
        if let Ok(state) = read_state(&state_path)
            && state.run_id == request.run_id
            && state.daemon_pid == child.id()
        {
            let status = status_from_state(state, &state_path);
            if status
                .state
                .as_ref()
                .is_some_and(|state| state.phase != RuntimeDaemonPhase::Starting)
            {
                return Ok(RuntimeDaemonStartResult {
                    status,
                    started_new: true,
                });
            }
        }
        if let Some(exit) = child.try_wait()? {
            if let Ok(state) = read_state(&state_path)
                && state.run_id == request.run_id
            {
                return Ok(RuntimeDaemonStartResult {
                    status: status_from_state(state, &state_path),
                    started_new: true,
                });
            }
            bail!(
                "runtime daemon exited before publishing state: {} (log {})",
                exit,
                daemon_log_path.display()
            );
        }
        if started.elapsed() >= START_TIMEOUT {
            if let Ok(state) = read_state(&state_path) {
                let _ = write_stop_request(&state, &request);
            } else {
                let _ = child.kill();
            }
            bail!(
                "runtime daemon did not become ready within {} ms (log {})",
                START_TIMEOUT.as_millis(),
                daemon_log_path.display()
            );
        }
        thread::sleep(POLL_INTERVAL);
    }
}

pub fn status(project_key: &str, cwd: &Path) -> Result<RuntimeDaemonStatus> {
    let canonical_cwd = canonical_cwd_for_lookup(cwd)?;
    let state_path = runtime_daemon_state_path(project_key, &canonical_cwd);
    status_for_state_path(&state_path, project_key, &canonical_cwd)
}

pub fn list() -> Result<Vec<RuntimeDaemonStatus>> {
    let runtime_dir = runtime_daemon_dir();
    let entries = match fs::read_dir(&runtime_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let mut statuses = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !name.starts_with("runtime-") || !name.ends_with(".state.json") {
            continue;
        }
        let Ok(state) = read_state(&path) else {
            continue;
        };
        statuses.push(status_from_state(state, &path));
    }
    statuses.sort_by(|left, right| {
        let left_started = left
            .state
            .as_ref()
            .map(|state| state.started_at_ms)
            .unwrap_or_default();
        let right_started = right
            .state
            .as_ref()
            .map(|state| state.started_at_ms)
            .unwrap_or_default();
        right_started.cmp(&left_started)
    });
    Ok(statuses)
}

pub fn stop(project_key: &str, cwd: &Path) -> Result<RuntimeDaemonStatus> {
    let canonical_cwd = canonical_cwd_for_lookup(cwd)?;
    let state_path = runtime_daemon_state_path(project_key, &canonical_cwd);
    let _guard = RuntimeDaemonOperationLock::acquire(&state_path)?;
    let current = status_for_state_path(&state_path, project_key, &canonical_cwd)?;
    if !current.running {
        return Ok(current);
    }
    if !current.managed {
        bail!("refusing to stop an unverified runtime process group");
    }
    stop_managed_daemon(&current)
}

pub fn restart(request: RuntimeDaemonStartRequest) -> Result<RuntimeDaemonStatus> {
    let _ = stop(&request.project_key, &request.cwd)?;
    start(request)
}

pub fn diagnose(project_key: &str, cwd: &Path) -> Result<RuntimeDaemonDiagnosis> {
    let status = status(project_key, cwd)?;
    let mut issues = Vec::new();
    let process_command = status
        .state
        .as_ref()
        .filter(|_| status.daemon_alive)
        .and_then(|state| process_command(state.daemon_pid));
    if let Some(state) = status.state.as_ref() {
        if state.schema_version != STATE_SCHEMA_VERSION {
            issues.push(format!(
                "state schema {} is not supported by schema {}",
                state.schema_version, STATE_SCHEMA_VERSION
            ));
        }
        if !status.version_compatible {
            issues.push(format!(
                "daemon version is incompatible: protocol={} appVersion={}",
                state.protocol_version, state.app_version
            ));
        }
        if state.phase.active() && !status.managed {
            issues.push("active state is not owned by a verified runtime daemon".to_string());
        }
        if !status.daemon_alive && (status.worker_group_alive || status.local_proxy_group_alive) {
            issues.push("a supervised process group outlived the runtime daemon".to_string());
        }
        if state.expected_port.is_some_and(|port| {
            state.phase == RuntimeDaemonPhase::Running && !tcp_port_listening(port)
        }) {
            issues.push(
                "runtime is marked running but the expected port is not listening".to_string(),
            );
        }
    }
    Ok(RuntimeDaemonDiagnosis {
        healthy: issues.is_empty(),
        status,
        issues,
        process_command,
    })
}

pub fn adopt(request: RuntimeDaemonAdoptRequest) -> Result<RuntimeDaemonAdoptResponse> {
    let project_key = request.project_key.trim().to_string();
    if project_key.is_empty() {
        bail!("runtime daemon project key cannot be empty");
    }
    let canonical_cwd = canonicalize_cwd(&request.cwd)?;
    let identity = inspect_process_identity(request.pid)?;
    validate_adoptable_process(
        &identity,
        &canonical_cwd,
        &request.expected_command,
        request.expected_port,
    )?;
    let status_key = runtime_status_key(&project_key, &canonical_cwd);
    let state_path = runtime_daemon_state_path(&project_key, &canonical_cwd);
    let _guard = RuntimeDaemonOperationLock::acquire(&state_path)?;
    let current = status_for_state_path(&state_path, &project_key, &canonical_cwd)?;
    if current.running {
        if current.managed
            && current
                .state
                .as_ref()
                .and_then(|state| state.adopted_process.as_ref())
                == Some(&identity)
        {
            return Ok(RuntimeDaemonAdoptResponse {
                supported: true,
                status_key,
                project_key,
                canonical_cwd,
                pid: identity.pid,
                pgid: identity.pgid,
                command: identity.command.clone(),
                detail: "external runtime is already adopted and supervised".to_string(),
                status: current,
            });
        }
        bail!(
            "another runtime is already active for this project: {}",
            current.detail
        );
    }

    let run_id = uuid::Uuid::new_v4().to_string();
    let log_path = normalized_absolute_path(&request.log_path)
        .to_string_lossy()
        .to_string();
    let stored = StoredRuntimeDaemonRequest {
        schema_version: STATE_SCHEMA_VERSION,
        protocol_version: DAEMON_PROTOCOL_VERSION,
        app_version: APP_VERSION.to_string(),
        run_id,
        control_token: uuid::Uuid::new_v4().to_string(),
        status_key: status_key.clone(),
        project_key: project_key.clone(),
        project_name: request.project_name,
        canonical_cwd: canonical_cwd.clone(),
        command: identity.command.clone(),
        env: BTreeMap::new(),
        debug_profile: None,
        runtime_profile: None,
        expected_port: request.expected_port,
        ready: RuntimeDaemonReadyConfig {
            enabled: request.expected_port.is_some() || request.ready_url.is_some(),
            url_patterns: Vec::new(),
            success_markers: Vec::new(),
            fallback_url: request.ready_url.or_else(|| {
                request
                    .expected_port
                    .map(|port| format!("http://127.0.0.1:{port}"))
            }),
        },
        log_path,
        local_proxy: None,
        adopted_process: Some(identity.clone()),
    };
    let result = launch_stored_request(stored)?;
    if !result.status.running {
        bail!("external runtime exited before adoption completed");
    }
    Ok(RuntimeDaemonAdoptResponse {
        supported: true,
        status_key,
        project_key,
        canonical_cwd,
        pid: identity.pid,
        pgid: identity.pgid,
        command: identity.command,
        detail: "external runtime was adopted and will be restored after the app restarts"
            .to_string(),
        status: result.status,
    })
}

pub fn runtime_status_key(project_key: &str, canonical_cwd: &str) -> String {
    format!("{}::{}", project_key.trim(), canonical_cwd)
}

fn prepare_stored_request(
    request: RuntimeDaemonStartRequest,
) -> Result<StoredRuntimeDaemonRequest> {
    let project_key = request.project_key.trim().to_string();
    if project_key.is_empty() {
        bail!("runtime daemon project key cannot be empty");
    }
    if request.command.trim().is_empty() {
        bail!("runtime daemon command cannot be empty");
    }
    let canonical_cwd = canonicalize_cwd(&request.cwd)?;
    let status_key = runtime_status_key(&project_key, &canonical_cwd);
    let run_id = uuid::Uuid::new_v4().to_string();
    let log_path = normalized_absolute_path(&request.log_path)
        .to_string_lossy()
        .to_string();
    Ok(StoredRuntimeDaemonRequest {
        schema_version: STATE_SCHEMA_VERSION,
        protocol_version: DAEMON_PROTOCOL_VERSION,
        app_version: APP_VERSION.to_string(),
        run_id,
        control_token: uuid::Uuid::new_v4().to_string(),
        status_key,
        project_key,
        project_name: request.project_name,
        canonical_cwd,
        command: request.command,
        env: request.env,
        debug_profile: request.debug_profile,
        runtime_profile: request.runtime_profile,
        expected_port: request.expected_port,
        ready: request.ready,
        log_path,
        local_proxy: request.local_proxy,
        adopted_process: None,
    })
}

fn run_runtime_daemon_serve(args: RuntimeDaemonServeArgs) -> Result<()> {
    let request: StoredRuntimeDaemonRequest = read_json(&args.request_path)
        .with_context(|| format!("failed to read request {}", args.request_path.display()))?;
    validate_serve_request(&request, &args)?;
    let mut state = RuntimeDaemonState {
        schema_version: STATE_SCHEMA_VERSION,
        protocol_version: DAEMON_PROTOCOL_VERSION,
        app_version: APP_VERSION.to_string(),
        run_id: request.run_id.clone(),
        status_key: request.status_key.clone(),
        project_key: request.project_key.clone(),
        project_name: request.project_name.clone(),
        canonical_cwd: request.canonical_cwd.clone(),
        command: request.command.clone(),
        debug_profile: request.debug_profile.clone(),
        runtime_profile: request.runtime_profile.clone(),
        expected_port: request.expected_port,
        ready_url: None,
        daemon_pid: std::process::id(),
        worker_pid: None,
        worker_pgid: None,
        adopted: request.adopted_process.is_some(),
        adopted_process: request.adopted_process.clone(),
        local_proxy_pid: None,
        local_proxy_pgid: None,
        started_at: Utc::now().to_rfc3339(),
        started_at_ms: now_ms(),
        log_path: request.log_path.clone(),
        phase: RuntimeDaemonPhase::Starting,
        exit: None,
        executable: std::env::current_exe()
            .map(|path| path.display().to_string())
            .unwrap_or_default(),
        request_path: args.request_path.display().to_string(),
    };
    remove_file_if_exists(&runtime_daemon_stop_path(&args.state_path))?;
    write_state(&args.state_path, &state)?;

    let mut local_proxy = match request.local_proxy.as_ref() {
        Some(spec) => match spawn_local_proxy(spec, &request.run_id, &runtime_daemon_dir()) {
            Ok(process) => {
                state.local_proxy_pid = Some(process.pid);
                state.local_proxy_pgid = process.pgid;
                write_state(&args.state_path, &state)?;
                Some(process)
            }
            Err(error) => {
                finish_failed(&mut state, &args.state_path, error)?;
                cleanup_runtime_files(&args, None)?;
                return Ok(());
            }
        },
        None => None,
    };

    let adopted_process = request.adopted_process.clone();
    let (mut worker, log_offset) = if let Some(identity) = adopted_process.as_ref() {
        if let Err(error) = verify_process_identity(identity) {
            let _ = terminate_groups(None, local_proxy.as_mut());
            finish_failed(&mut state, &args.state_path, error.to_string())?;
            cleanup_runtime_files(&args, local_proxy.as_ref())?;
            return Ok(());
        }
        (
            None,
            fs::metadata(&request.log_path)
                .map(|metadata| metadata.len())
                .unwrap_or_default(),
        )
    } else {
        match spawn_worker(&request) {
            Ok((worker, log_offset)) => (Some(worker), log_offset),
            Err(error) => {
                let _ = terminate_groups(None, local_proxy.as_mut());
                finish_failed(&mut state, &args.state_path, error.to_string())?;
                cleanup_runtime_files(&args, local_proxy.as_ref())?;
                return Ok(());
            }
        }
    };
    state.worker_pid = adopted_process
        .as_ref()
        .map(|identity| identity.pid)
        .or_else(|| worker.as_ref().map(Child::id));
    state.worker_pgid = worker
        .as_ref()
        .and_then(|worker| cfg!(unix).then_some(worker.id()));
    write_state(&args.state_path, &state)?;

    let startup = Instant::now();
    let mut worker_exit = None;
    let mut local_proxy_exit = None;
    let mut ready_tracker = ReadyTracker::new(log_offset);
    let mut adopted_identity_valid = true;
    let mut last_adopted_identity_check = Instant::now();
    loop {
        if let Some(stop_request) = take_stop_request(&args.state_path)?
            && validate_stop_request(&stop_request, &request, &state).is_ok()
        {
            state.phase = RuntimeDaemonPhase::Stopping;
            write_state(&args.state_path, &state)?;
            let stop_result = if let Some(identity) = adopted_process.as_ref() {
                terminate_adopted_process_tree(identity).and_then(|worker_escalated| {
                    terminate_groups(None, local_proxy.as_mut())
                        .map(|proxy_escalated| worker_escalated || proxy_escalated)
                })
            } else {
                terminate_groups(worker.as_mut(), local_proxy.as_mut())
            };
            let escalated = match stop_result {
                Ok(escalated) => escalated,
                Err(error) => {
                    state.phase = RuntimeDaemonPhase::Failed;
                    state.exit = Some(RuntimeDaemonExit {
                        code: None,
                        signal: None,
                        reason: format!("validated stop was refused: {error}"),
                        exited_at_ms: now_ms(),
                    });
                    write_state(&args.state_path, &state)?;
                    break;
                }
            };
            state.phase = RuntimeDaemonPhase::Exited;
            state.exit = Some(RuntimeDaemonExit {
                code: worker_exit.as_ref().and_then(ExitStatus::code),
                signal: None,
                reason: if escalated {
                    if adopted_process.is_some() {
                        "adopted process tree stopped after TERM timeout and escalation".to_string()
                    } else {
                        "stopped after TERM timeout; process group was killed".to_string()
                    }
                } else if adopted_process.is_some() {
                    "adopted process tree stopped by validated daemon request".to_string()
                } else {
                    "stopped by validated daemon request".to_string()
                },
                exited_at_ms: now_ms(),
            });
            write_state(&args.state_path, &state)?;
            break;
        }

        if let Some(worker) = worker.as_mut()
            && worker_exit.is_none()
        {
            worker_exit = worker.try_wait()?;
        }
        if let Some(proxy) = local_proxy.as_mut()
            && local_proxy_exit.is_none()
        {
            local_proxy_exit = proxy.child.try_wait()?;
        }

        if let Some(identity) = adopted_process.as_ref()
            && adopted_identity_valid
            && last_adopted_identity_check.elapsed() >= Duration::from_secs(1)
        {
            adopted_identity_valid = process_identity_matches(identity);
            last_adopted_identity_check = Instant::now();
        }
        let worker_alive = match adopted_process.as_ref() {
            Some(identity) => adopted_identity_valid && process_is_alive(identity.pid),
            None => {
                state.worker_pgid.is_some_and(process_group_is_alive)
                    || worker.as_ref().is_some_and(|worker| {
                        worker_exit.is_none() && process_is_alive(worker.id())
                    })
            }
        };
        let local_proxy_alive = match local_proxy.as_ref() {
            Some(proxy) => {
                proxy.pgid.is_some_and(process_group_is_alive)
                    || (local_proxy_exit.is_none() && process_is_alive(proxy.pid))
            }
            None => true,
        };

        if let Some(url) = ready_tracker
            .poll(Path::new(&request.log_path), &request.ready)
            .ok()
            .flatten()
        {
            if state.ready_url.as_deref() != Some(url.as_str()) {
                state.ready_url = Some(url);
                write_state(&args.state_path, &state)?;
            }
        } else if state.ready_url.is_none()
            && request.ready.enabled
            && request.expected_port.is_some_and(tcp_port_listening)
        {
            state.ready_url = request.ready.fallback_url.clone().or_else(|| {
                request
                    .expected_port
                    .map(|port| format!("http://127.0.0.1:{port}"))
            });
            write_state(&args.state_path, &state)?;
        }

        if !local_proxy_alive {
            if let Some(identity) = adopted_process.as_ref() {
                let _ = terminate_adopted_process_tree(identity);
                let _ = terminate_groups(None, local_proxy.as_mut());
            } else {
                let _ = terminate_groups(worker.as_mut(), local_proxy.as_mut());
            }
            state.phase = RuntimeDaemonPhase::Failed;
            state.exit = Some(exit_record(
                local_proxy_exit.as_ref(),
                "supervised local proxy process group exited",
            ));
            write_state(&args.state_path, &state)?;
            break;
        }

        if !worker_alive {
            let _ = terminate_groups(None, local_proxy.as_mut());
            let reason =
                if adopted_process.is_some() && process_is_alive(state.worker_pid.unwrap_or(0)) {
                    "adopted runtime identity changed; supervision was detached without signaling"
                } else if adopted_process.is_some() {
                    "adopted runtime process tree exited"
                } else {
                    "worker process group exited"
                };
            let exit = exit_record(worker_exit.as_ref(), reason);
            state.phase = if adopted_process.is_some()
                && process_is_alive(state.worker_pid.unwrap_or(0))
                || exit.code.is_some_and(|code| code != 0)
            {
                RuntimeDaemonPhase::Failed
            } else {
                RuntimeDaemonPhase::Exited
            };
            state.exit = Some(exit);
            write_state(&args.state_path, &state)?;
            break;
        }

        if state.phase == RuntimeDaemonPhase::Starting && startup.elapsed() >= START_STABILITY {
            state.phase = RuntimeDaemonPhase::Running;
            write_state(&args.state_path, &state)?;
        }
        thread::sleep(POLL_INTERVAL);
    }

    cleanup_runtime_files(&args, local_proxy.as_ref())?;
    Ok(())
}

fn spawn_worker(request: &StoredRuntimeDaemonRequest) -> Result<(Child, u64)> {
    let log_path = Path::new(&request.log_path);
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .with_context(|| format!("failed to open runtime log: {}", log_path.display()))?;
    writeln!(
        log_file,
        "\n[{}] dev start key={} cwd={} command={}",
        now_ms(),
        request.project_key,
        request.canonical_cwd,
        request.command
    )?;
    writeln!(
        log_file,
        "{}",
        serde_json::json!({
            "rdevtool": "runtimeSession",
            "version": 1,
            "runId": request.run_id,
            "projectKey": request.project_key,
            "kind": "dev",
            "startedAtMs": now_ms(),
            "cwd": request.canonical_cwd,
            "command": request.command,
        })
    )?;
    let log_offset = log_file.metadata()?.len();
    let stdout = log_file.try_clone()?;
    let stderr = log_file.try_clone()?;
    let mut command = Command::new("/bin/zsh");
    command
        .arg("-lc")
        .arg(&request.command)
        .current_dir(&request.canonical_cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    scrub_launcher_env(&mut command);
    for (key, value) in &request.env {
        command.env(key, value);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let child = command.spawn().with_context(|| {
        format!(
            "failed to start {} in {}",
            request.command, request.canonical_cwd
        )
    })?;
    Ok((child, log_offset))
}

fn validate_serve_request(
    request: &StoredRuntimeDaemonRequest,
    args: &RuntimeDaemonServeArgs,
) -> Result<()> {
    if request.schema_version != STATE_SCHEMA_VERSION
        || request.protocol_version != DAEMON_PROTOCOL_VERSION
        || request.app_version != APP_VERSION
    {
        bail!("runtime daemon request version is incompatible");
    }
    if request.run_id != args.run_id {
        bail!("runtime daemon run ID does not match request");
    }
    let canonical_cwd = canonicalize_cwd(Path::new(&request.canonical_cwd))?;
    if canonical_cwd != request.canonical_cwd {
        bail!("runtime daemon request cwd is not canonical");
    }
    if request.status_key != runtime_status_key(&request.project_key, &canonical_cwd) {
        bail!("runtime daemon request status key is invalid");
    }
    let expected_state_path = runtime_daemon_state_path(&request.project_key, &canonical_cwd);
    if normalized_absolute_path(&args.state_path) != normalized_absolute_path(&expected_state_path)
    {
        bail!("invalid runtime daemon state path");
    }
    let expected_request_path = runtime_daemon_request_path(&expected_state_path, &request.run_id);
    if normalized_absolute_path(&args.request_path)
        != normalized_absolute_path(&expected_request_path)
    {
        bail!("invalid runtime daemon request path");
    }
    if let Some(identity) = request.adopted_process.as_ref() {
        if identity.canonical_cwd != request.canonical_cwd
            || identity.command != request.command
            || request.local_proxy.is_some()
        {
            bail!("adopted runtime request identity is inconsistent");
        }
        verify_process_identity(identity)?;
    }
    Ok(())
}

fn validate_stop_request(
    stop: &RuntimeDaemonStopRequest,
    request: &StoredRuntimeDaemonRequest,
    state: &RuntimeDaemonState,
) -> Result<()> {
    if stop.schema_version != STATE_SCHEMA_VERSION
        || stop.protocol_version != DAEMON_PROTOCOL_VERSION
        || stop.app_version != APP_VERSION
        || stop.run_id != request.run_id
        || stop.control_token != request.control_token
        || stop.status_key != request.status_key
        || stop.project_key != request.project_key
        || stop.canonical_cwd != request.canonical_cwd
        || stop.daemon_pid != state.daemon_pid
        || state.daemon_pid != std::process::id()
    {
        bail!("runtime daemon stop request validation failed");
    }
    Ok(())
}

fn status_for_state_path(
    state_path: &Path,
    project_key: &str,
    canonical_cwd: &str,
) -> Result<RuntimeDaemonStatus> {
    match read_state(state_path) {
        Ok(state) => {
            if state.project_key != project_key || state.canonical_cwd != canonical_cwd {
                bail!("runtime daemon state identity does not match requested project and cwd");
            }
            Ok(status_from_state(state, state_path))
        }
        Err(error)
            if error
                .downcast_ref::<std::io::Error>()
                .is_some_and(|error| error.kind() == std::io::ErrorKind::NotFound) =>
        {
            Ok(RuntimeDaemonStatus {
                status_key: runtime_status_key(project_key, canonical_cwd),
                phase_key: "stopped".to_string(),
                project_key: project_key.to_string(),
                canonical_cwd: canonical_cwd.to_string(),
                state_path: state_path.display().to_string(),
                running: false,
                managed: false,
                version_compatible: true,
                daemon_alive: false,
                worker_group_alive: false,
                local_proxy_group_alive: false,
                detail: "runtime daemon has no persisted state".to_string(),
                state: None,
            })
        }
        Err(error) => Err(error),
    }
}

fn status_from_state(state: RuntimeDaemonState, state_path: &Path) -> RuntimeDaemonStatus {
    let daemon_alive = process_is_alive(state.daemon_pid);
    let managed = daemon_alive && process_is_managed_daemon(&state, state_path);
    let worker_group_alive = state
        .adopted_process
        .as_ref()
        .is_some_and(process_identity_matches)
        || state.worker_pgid.is_some_and(process_group_is_alive);
    let local_proxy_group_alive = state.local_proxy_pgid.is_some_and(process_group_is_alive);
    let running =
        worker_group_alive || local_proxy_group_alive || (managed && state.phase.active());
    let version_compatible = state.schema_version == STATE_SCHEMA_VERSION
        && state.protocol_version == DAEMON_PROTOCOL_VERSION
        && state.app_version == APP_VERSION;
    let phase_key = if running && !managed {
        "lost"
    } else {
        match &state.phase {
            RuntimeDaemonPhase::Starting => "starting",
            RuntimeDaemonPhase::Running => "running",
            RuntimeDaemonPhase::Stopping => "stopping",
            RuntimeDaemonPhase::Exited => "stopped",
            RuntimeDaemonPhase::Failed => "failed",
        }
    };
    let detail = match (
        &state.phase,
        running,
        managed,
        worker_group_alive,
        local_proxy_group_alive,
    ) {
        (RuntimeDaemonPhase::Starting, true, true, _, _) if state.adopted => {
            "runtime daemon is attaching to the external project process".to_string()
        }
        (RuntimeDaemonPhase::Starting, true, true, _, _) => {
            "runtime daemon is starting supervised process groups".to_string()
        }
        (RuntimeDaemonPhase::Running, true, true, true, _) if state.adopted => {
            "runtime daemon is supervising an adopted external process tree".to_string()
        }
        (RuntimeDaemonPhase::Running, true, true, true, _) => {
            "runtime daemon is supervising the project process group".to_string()
        }
        (RuntimeDaemonPhase::Stopping, _, true, _, _) => {
            "runtime daemon is stopping supervised process groups".to_string()
        }
        (RuntimeDaemonPhase::Exited, false, _, _, _) => {
            "runtime process groups exited and final state is persisted".to_string()
        }
        (RuntimeDaemonPhase::Failed, false, _, _, _) => {
            "runtime process groups failed and final state is persisted".to_string()
        }
        (_, true, false, _, _) => {
            "runtime process group is alive but its daemon ownership cannot be verified".to_string()
        }
        (_, _, _, false, true) => {
            "local proxy process group is alive without the project process group".to_string()
        }
        _ => "runtime daemon state is inconsistent with current processes".to_string(),
    };
    RuntimeDaemonStatus {
        status_key: state.status_key.clone(),
        phase_key: phase_key.to_string(),
        project_key: state.project_key.clone(),
        canonical_cwd: state.canonical_cwd.clone(),
        state_path: state_path.display().to_string(),
        running,
        managed,
        version_compatible,
        daemon_alive,
        worker_group_alive,
        local_proxy_group_alive,
        detail,
        state: Some(state),
    }
}

fn stop_managed_daemon(current: &RuntimeDaemonStatus) -> Result<RuntimeDaemonStatus> {
    let state = current
        .state
        .as_ref()
        .ok_or_else(|| anyhow!("managed runtime status does not contain state"))?;
    let state_path = Path::new(&current.state_path);
    if !process_is_managed_daemon(state, state_path) {
        bail!(
            "runtime daemon PID {} no longer belongs to this state",
            state.daemon_pid
        );
    }
    if state.protocol_version != DAEMON_PROTOCOL_VERSION {
        bail!("cannot safely stop a runtime daemon with an incompatible protocol");
    }
    let request: StoredRuntimeDaemonRequest = read_json(Path::new(&state.request_path))?;
    write_stop_request(state, &request)?;
    let started = Instant::now();
    loop {
        let next = status_for_state_path(state_path, &current.project_key, &current.canonical_cwd)?;
        if !next.running
            && next.state.as_ref().is_some_and(|state| {
                matches!(
                    state.phase,
                    RuntimeDaemonPhase::Exited | RuntimeDaemonPhase::Failed
                )
            })
        {
            return Ok(next);
        }
        if started.elapsed() >= STOP_REQUEST_TIMEOUT {
            bail!(
                "runtime daemon did not finish stopping within {} ms",
                STOP_REQUEST_TIMEOUT.as_millis()
            );
        }
        thread::sleep(POLL_INTERVAL);
    }
}

fn write_stop_request(
    state: &RuntimeDaemonState,
    request: &StoredRuntimeDaemonRequest,
) -> Result<()> {
    let stop = RuntimeDaemonStopRequest {
        schema_version: request.schema_version,
        protocol_version: request.protocol_version,
        app_version: request.app_version.clone(),
        run_id: state.run_id.clone(),
        control_token: request.control_token.clone(),
        status_key: state.status_key.clone(),
        project_key: state.project_key.clone(),
        canonical_cwd: state.canonical_cwd.clone(),
        daemon_pid: state.daemon_pid,
    };
    write_json_atomic(
        &runtime_daemon_stop_path(&Path::new(&state.request_path).with_file_name(
            runtime_daemon_state_file_name(&state.project_key, &state.canonical_cwd),
        )),
        &stop,
    )
}

fn take_stop_request(state_path: &Path) -> Result<Option<RuntimeDaemonStopRequest>> {
    let path = runtime_daemon_stop_path(state_path);
    let request = match read_json(&path) {
        Ok(request) => Some(request),
        Err(error)
            if error
                .downcast_ref::<std::io::Error>()
                .is_some_and(|error| error.kind() == std::io::ErrorKind::NotFound) =>
        {
            None
        }
        Err(_) => None,
    };
    if path.exists() {
        remove_file_if_exists(&path)?;
    }
    Ok(request)
}

fn terminate_groups(
    mut worker: Option<&mut Child>,
    mut local_proxy: Option<&mut RunningLocalProxy>,
) -> Result<bool> {
    let worker_pgid = worker.as_ref().map(|child| child.id());
    let proxy_pgid = local_proxy.as_ref().and_then(|proxy| proxy.pgid);
    #[cfg(unix)]
    {
        if let Some(pgid) = worker_pgid.filter(|pgid| process_group_is_alive(*pgid)) {
            send_group_signal(pgid, "TERM")?;
        }
        if let Some(pgid) = proxy_pgid.filter(|pgid| process_group_is_alive(*pgid)) {
            send_group_signal(pgid, "TERM")?;
        }
        let started = Instant::now();
        while started.elapsed() < STOP_TIMEOUT {
            if let Some(child) = worker.as_mut() {
                reap_exited_child(Some(&mut **child));
            }
            if let Some(proxy) = local_proxy.as_mut() {
                reap_exited_child(Some(&mut proxy.child));
            }
            if !worker_pgid.is_some_and(process_group_is_alive)
                && !proxy_pgid.is_some_and(process_group_is_alive)
            {
                break;
            }
            thread::sleep(POLL_INTERVAL);
        }
        let escalated = worker_pgid.is_some_and(process_group_is_alive)
            || proxy_pgid.is_some_and(process_group_is_alive);
        if let Some(pgid) = worker_pgid.filter(|pgid| process_group_is_alive(*pgid)) {
            send_group_signal(pgid, "KILL")?;
        }
        if let Some(pgid) = proxy_pgid.filter(|pgid| process_group_is_alive(*pgid)) {
            send_group_signal(pgid, "KILL")?;
        }
        reap_child(worker);
        if let Some(proxy) = local_proxy {
            reap_child(Some(&mut proxy.child));
        }
        Ok(escalated)
    }
    #[cfg(not(unix))]
    {
        if let Some(child) = worker.as_deref_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Some(proxy) = local_proxy.as_deref_mut() {
            let _ = proxy.child.kill();
            let _ = proxy.child.wait();
        }
        let _ = (worker_pgid, proxy_pgid);
        Ok(false)
    }
}

fn terminate_adopted_process_tree(root: &RuntimeProcessIdentity) -> Result<bool> {
    verify_process_identity(root)?;
    #[cfg(unix)]
    {
        let mut processes = descendant_process_identities(root.pid)?;
        processes.push(root.clone());
        for process in processes.iter().rev() {
            if process_identity_matches(process) {
                send_process_signal(process.pid, "TERM")?;
            }
        }
        let started = Instant::now();
        while started.elapsed() < STOP_TIMEOUT {
            if !processes.iter().any(process_identity_matches) {
                return Ok(false);
            }
            thread::sleep(POLL_INTERVAL);
        }
        let escalated = processes.iter().any(process_identity_matches);
        for process in processes.iter().rev() {
            if process_identity_matches(process) {
                send_process_signal(process.pid, "KILL")?;
            }
        }
        Ok(escalated)
    }
    #[cfg(not(unix))]
    {
        let _ = root;
        bail!("external runtime adoption is currently supported on Unix systems")
    }
}

#[cfg(unix)]
fn descendant_process_identities(root_pid: u32) -> Result<Vec<RuntimeProcessIdentity>> {
    let output = Command::new("ps")
        .args(["-axo", "pid=", "-o", "ppid="])
        .output()
        .context("failed to inspect process tree")?;
    if !output.status.success() {
        bail!("failed to inspect process tree");
    }
    let pairs = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            Some((
                fields.next()?.parse::<u32>().ok()?,
                fields.next()?.parse::<u32>().ok()?,
            ))
        })
        .collect::<Vec<_>>();
    let mut frontier = vec![root_pid];
    let mut descendants = Vec::new();
    while let Some(parent) = frontier.pop() {
        for (pid, _) in pairs.iter().filter(|(_, ppid)| *ppid == parent) {
            if descendants
                .iter()
                .any(|identity: &RuntimeProcessIdentity| identity.pid == *pid)
            {
                continue;
            }
            if let Ok(identity) = inspect_process_identity(*pid) {
                frontier.push(*pid);
                descendants.push(identity);
            }
        }
    }
    Ok(descendants)
}

#[cfg(unix)]
fn send_process_signal(pid: u32, signal: &str) -> Result<()> {
    if pid <= 1 || pid == std::process::id() {
        bail!("refusing to signal unsafe process PID {pid}");
    }
    let status = Command::new("kill")
        .arg(format!("-{signal}"))
        .arg(pid.to_string())
        .status()?;
    if !status.success() && process_is_alive(pid) {
        bail!("failed to send {signal} to process PID {pid}");
    }
    Ok(())
}

#[cfg(unix)]
fn send_group_signal(pgid: u32, signal: &str) -> Result<()> {
    if pgid <= 1 || pgid == std::process::id() {
        bail!("refusing to signal unsafe process group {pgid}");
    }
    let status = Command::new("kill")
        .arg(format!("-{signal}"))
        .arg(format!("-{pgid}"))
        .status()?;
    if !status.success() && process_group_is_alive(pgid) {
        bail!("failed to send {signal} to process group {pgid}");
    }
    Ok(())
}

fn reap_child(child: Option<&mut Child>) {
    let Some(child) = child else {
        return;
    };
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(1) {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => thread::sleep(POLL_INTERVAL),
            Err(_) => return,
        }
    }
}

fn reap_exited_child(child: Option<&mut Child>) {
    if let Some(child) = child {
        let _ = child.try_wait();
    }
}

fn finish_failed(state: &mut RuntimeDaemonState, state_path: &Path, reason: String) -> Result<()> {
    state.phase = RuntimeDaemonPhase::Failed;
    state.exit = Some(RuntimeDaemonExit {
        code: None,
        signal: None,
        reason,
        exited_at_ms: now_ms(),
    });
    write_state(state_path, state)
}

fn exit_record(status: Option<&ExitStatus>, reason: &str) -> RuntimeDaemonExit {
    #[cfg(unix)]
    let signal = {
        use std::os::unix::process::ExitStatusExt;
        status.and_then(ExitStatusExt::signal)
    };
    #[cfg(not(unix))]
    let signal = None;
    RuntimeDaemonExit {
        code: status.and_then(ExitStatus::code),
        signal,
        reason: reason.to_string(),
        exited_at_ms: now_ms(),
    }
}

fn cleanup_runtime_files(
    args: &RuntimeDaemonServeArgs,
    local_proxy: Option<&RunningLocalProxy>,
) -> Result<()> {
    if let Some(local_proxy) = local_proxy {
        remove_local_proxy_artifacts(local_proxy);
    }
    remove_file_if_exists(&runtime_daemon_stop_path(&args.state_path))?;
    remove_file_if_exists(&args.request_path)?;
    Ok(())
}

struct ReadyTracker {
    offset: u64,
    pending: String,
}

impl ReadyTracker {
    fn new(offset: u64) -> Self {
        Self {
            offset,
            pending: String::new(),
        }
    }

    fn poll(&mut self, path: &Path, ready: &RuntimeDaemonReadyConfig) -> Result<Option<String>> {
        if !ready.enabled {
            return Ok(None);
        }
        let mut file = match File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        let length = file.metadata()?.len();
        if length < self.offset {
            self.offset = 0;
            self.pending.clear();
        }
        file.seek(SeekFrom::Start(self.offset))?;
        let mut content = Vec::new();
        file.read_to_end(&mut content)?;
        self.offset += content.len() as u64;
        if content.is_empty() {
            return Ok(None);
        }
        let content = String::from_utf8_lossy(&content);
        self.pending.push_str(&content);
        let mut lines = self
            .pending
            .split('\n')
            .map(str::to_string)
            .collect::<Vec<_>>();
        self.pending = if self.pending.ends_with('\n') {
            String::new()
        } else {
            lines.pop().unwrap_or_default()
        };
        for line in lines {
            if let Some(url) = ready
                .url_patterns
                .iter()
                .find_map(|pattern| extract_url_with_pattern(&line, pattern))
            {
                return Ok(Some(url));
            }
            if marker_matches(&line, &ready.success_markers)
                && let Some(url) = ready.fallback_url.as_ref()
            {
                return Ok(Some(url.clone()));
            }
        }
        Ok(None)
    }
}

fn extract_url_with_pattern(line: &str, pattern: &str) -> Option<String> {
    let pattern = pattern.trim();
    if pattern.is_empty() {
        return None;
    }
    let Some((prefix, suffix)) = pattern.split_once("{url}") else {
        return line
            .contains(pattern)
            .then(|| extract_first_http_url(line))
            .flatten();
    };
    let prefix = prefix.trim();
    let suffix = suffix.trim();
    let start = if prefix.is_empty() {
        0
    } else {
        line.find(prefix)? + prefix.len()
    };
    let mut value = &line[start..];
    if !suffix.is_empty() {
        value = &value[..value.find(suffix)?];
    }
    extract_first_http_url(value)
}

fn extract_first_http_url(value: &str) -> Option<String> {
    value.split_whitespace().find_map(|token| {
        let token = token.trim_matches(|ch: char| {
            matches!(
                ch,
                ',' | ';' | ')' | '(' | '"' | '\'' | '<' | '>' | '。' | '，'
            )
        });
        (token.starts_with("http://") || token.starts_with("https://")).then(|| token.to_string())
    })
}

fn marker_matches(line: &str, markers: &[String]) -> bool {
    let line = line.to_ascii_lowercase();
    markers.iter().any(|marker| {
        let marker = marker.trim();
        !marker.is_empty() && line.contains(&marker.to_ascii_lowercase())
    })
}

fn parse_runtime_daemon_args(args: &[OsString]) -> Result<RuntimeDaemonServeArgs> {
    let mut request_path = None;
    let mut state_path = None;
    let mut run_id = None;
    let mut index = 2;
    while index < args.len() {
        let key = args[index]
            .to_str()
            .ok_or_else(|| anyhow!("runtime daemon argument is not UTF-8"))?;
        let value = args
            .get(index + 1)
            .ok_or_else(|| anyhow!("missing value for runtime daemon argument {key}"))?;
        match key {
            "--request-path" => request_path = Some(PathBuf::from(value)),
            "--state-path" => state_path = Some(PathBuf::from(value)),
            "--run-id" => run_id = value.to_str().map(ToString::to_string),
            _ => bail!("unknown runtime daemon argument: {key}"),
        }
        index += 2;
    }
    Ok(RuntimeDaemonServeArgs {
        request_path: request_path.ok_or_else(|| anyhow!("missing --request-path"))?,
        state_path: state_path.ok_or_else(|| anyhow!("missing --state-path"))?,
        run_id: run_id.ok_or_else(|| anyhow!("missing --run-id"))?,
    })
}

fn runtime_daemon_state_path(project_key: &str, canonical_cwd: &str) -> PathBuf {
    runtime_daemon_dir().join(runtime_daemon_state_file_name(project_key, canonical_cwd))
}

fn runtime_daemon_state_file_name(project_key: &str, canonical_cwd: &str) -> String {
    format!(
        "runtime-{:016x}.state.json",
        stable_runtime_hash(project_key, canonical_cwd)
    )
}

fn runtime_daemon_request_path(state_path: &Path, run_id: &str) -> PathBuf {
    state_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(format!(
            "runtime-{:016x}-{}.request.json",
            stable_runtime_hash(
                state_path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default(),
                run_id
            ),
            run_id
        ))
}

fn runtime_daemon_stop_path(state_path: &Path) -> PathBuf {
    state_path.with_extension("stop.json")
}

fn runtime_daemon_lock_path(state_path: &Path) -> PathBuf {
    state_path.with_extension("lock")
}

fn runtime_daemon_log_path(state_path: &Path) -> PathBuf {
    state_path.with_extension("daemon.log")
}

fn runtime_daemon_dir() -> PathBuf {
    default_config_dir().join("runtime-daemon")
}

fn stable_runtime_hash(project_key: &str, canonical_cwd: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in project_key
        .as_bytes()
        .iter()
        .copied()
        .chain(std::iter::once(0))
        .chain(canonical_cwd.as_bytes().iter().copied())
    {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn canonicalize_cwd(path: &Path) -> Result<String> {
    let canonical = path
        .canonicalize()
        .with_context(|| format!("failed to canonicalize runtime cwd: {}", path.display()))?;
    canonical
        .to_str()
        .map(ToString::to_string)
        .ok_or_else(|| anyhow!("runtime cwd is not valid UTF-8: {}", canonical.display()))
}

fn canonical_cwd_for_lookup(path: &Path) -> Result<String> {
    match canonicalize_cwd(path) {
        Ok(path) => Ok(path),
        Err(_) => normalized_absolute_path(path)
            .to_str()
            .map(ToString::to_string)
            .ok_or_else(|| anyhow!("runtime cwd is not valid UTF-8: {}", path.display())),
    }
}

fn normalized_absolute_path(path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    }
}

fn write_state(path: &Path, state: &RuntimeDaemonState) -> Result<()> {
    write_json_atomic(path, state)
}

fn read_state(path: &Path) -> Result<RuntimeDaemonState> {
    read_json(path)
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T> {
    let content = fs::read(path)?;
    Ok(serde_json::from_slice(&content)?)
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let content = serde_json::to_vec_pretty(value)?;
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(
        ".runtime-{}-{}.tmp",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    fs::write(&temporary, content)?;
    restrict_file_permissions(&temporary)?;
    fs::rename(&temporary, path)?;
    Ok(())
}

fn restrict_file_permissions(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

fn remove_old_request_files(state_path: &Path, keep: Option<&Path>) -> Result<()> {
    let Some(parent) = state_path.parent() else {
        return Ok(());
    };
    let entries = match fs::read_dir(parent) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if keep.is_some_and(|keep| keep == path) {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if name.ends_with(".request.json")
            && let Ok(request) = read_json::<StoredRuntimeDaemonRequest>(&path)
            && runtime_daemon_state_path(&request.project_key, &request.canonical_cwd) == state_path
        {
            remove_file_if_exists(&path)?;
        }
    }
    Ok(())
}

fn remove_file_if_exists(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn process_is_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        Command::new("kill")
            .args(["-0", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    }
    #[cfg(windows)]
    {
        Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .output()
            .is_ok_and(|output| String::from_utf8_lossy(&output.stdout).contains(&pid.to_string()))
    }
}

pub fn inspect_process_identity(pid: u32) -> Result<RuntimeProcessIdentity> {
    if pid <= 1 {
        bail!("refusing to inspect unsafe process PID {pid}");
    }
    #[cfg(unix)]
    {
        let process = Command::new("ps")
            .args([
                "-ww",
                "-p",
                &pid.to_string(),
                "-o",
                "ppid=",
                "-o",
                "pgid=",
                "-o",
                "command=",
            ])
            .output()
            .with_context(|| format!("failed to inspect process PID {pid}"))?;
        if !process.status.success() {
            bail!("process PID {pid} is not running");
        }
        let process = String::from_utf8_lossy(&process.stdout);
        let line = process.trim();
        let ppid = line
            .split_whitespace()
            .next()
            .ok_or_else(|| anyhow!("process PID {pid} has no parent PID"))?
            .parse::<u32>()
            .with_context(|| format!("process PID {pid} has an invalid parent PID"))?;
        let remaining = line
            .trim_start()
            .strip_prefix(&ppid.to_string())
            .ok_or_else(|| anyhow!("process PID {pid} metadata is malformed"))?
            .trim_start();
        let pgid_text = remaining
            .split_whitespace()
            .next()
            .ok_or_else(|| anyhow!("process PID {pid} has no process group"))?;
        let pgid = pgid_text
            .parse::<u32>()
            .with_context(|| format!("process PID {pid} has an invalid process group"))?;
        let command = remaining
            .strip_prefix(pgid_text)
            .unwrap_or_default()
            .trim()
            .to_string();
        if command.is_empty() {
            bail!("process PID {pid} has no visible command");
        }
        let started = Command::new("ps")
            .args(["-ww", "-p", &pid.to_string(), "-o", "lstart="])
            .output()
            .with_context(|| format!("failed to inspect start time for PID {pid}"))?;
        let started_at = String::from_utf8_lossy(&started.stdout).trim().to_string();
        if !started.status.success() || started_at.is_empty() {
            bail!("process PID {pid} has no stable start time");
        }
        let cwd = Command::new("lsof")
            .args(["-a", "-p", &pid.to_string(), "-d", "cwd", "-Fn"])
            .output()
            .with_context(|| format!("failed to inspect cwd for PID {pid}"))?;
        let cwd_output = String::from_utf8_lossy(&cwd.stdout);
        let cwd = cwd_output
            .lines()
            .find_map(|line| line.strip_prefix('n'))
            .filter(|value| !value.is_empty())
            .ok_or_else(|| anyhow!("process PID {pid} has no visible cwd"))?;
        let canonical_cwd = canonicalize_cwd(Path::new(cwd))?;
        Ok(RuntimeProcessIdentity {
            pid,
            ppid,
            pgid,
            canonical_cwd,
            command,
            started_at,
        })
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        bail!("external runtime adoption is currently supported on Unix systems")
    }
}

pub fn listening_process(port: u16) -> Result<Option<RuntimeProcessIdentity>> {
    #[cfg(unix)]
    {
        let output = Command::new("lsof")
            .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-Fp"])
            .output()
            .with_context(|| format!("failed to inspect listener on port {port}"))?;
        if !output.status.success() && output.stdout.is_empty() {
            return Ok(None);
        }
        let mut pids = String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| line.strip_prefix('p'))
            .filter_map(|value| value.parse::<u32>().ok())
            .collect::<Vec<_>>();
        pids.sort_unstable();
        pids.dedup();
        match pids.as_slice() {
            [] => Ok(None),
            [pid] => inspect_process_identity(*pid).map(Some),
            _ => bail!(
                "multiple processes are listening on port {port}: {}",
                pids.iter()
                    .map(u32::to_string)
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        }
    }
    #[cfg(not(unix))]
    {
        let _ = port;
        Ok(None)
    }
}

fn validate_adoptable_process(
    identity: &RuntimeProcessIdentity,
    canonical_cwd: &str,
    expected_command: &str,
    expected_port: Option<u16>,
) -> Result<()> {
    if identity.pid == std::process::id()
        || identity.command.contains(DAEMON_MARKER)
        || identity.command.contains("--rdevtool-runtime-local-proxy")
    {
        bail!("refusing to adopt an rDevTool control process");
    }
    if identity.canonical_cwd != canonical_cwd {
        bail!(
            "process PID {} belongs to cwd {}, expected {}",
            identity.pid,
            identity.canonical_cwd,
            canonical_cwd
        );
    }
    if let Some(port) = expected_port {
        let listener = listening_process(port)?
            .ok_or_else(|| anyhow!("expected port {port} is not listening"))?;
        if listener != *identity {
            bail!(
                "port {port} belongs to PID {}, not PID {}",
                listener.pid,
                identity.pid
            );
        }
    } else if !commands_are_compatible(expected_command, &identity.command) {
        bail!(
            "process PID {} command does not match the configured runtime command",
            identity.pid
        );
    }
    verify_process_identity(identity)
}

fn commands_are_compatible(expected: &str, actual: &str) -> bool {
    let expected = expected.to_ascii_lowercase();
    let actual = actual.to_ascii_lowercase();
    const MARKERS: [&str; 12] = [
        "vite",
        "webpack",
        "next",
        "nuxt",
        "rspack",
        "rsbuild",
        "angular",
        "react-scripts",
        "vue-cli",
        "parcel",
        "astro",
        "remix",
    ];
    MARKERS
        .iter()
        .any(|marker| expected.contains(marker) && actual.contains(marker))
}

fn verify_process_identity(identity: &RuntimeProcessIdentity) -> Result<()> {
    let current = inspect_process_identity(identity.pid)?;
    if &current != identity {
        bail!(
            "process PID {} identity changed; refusing to supervise or signal it",
            identity.pid
        );
    }
    Ok(())
}

fn process_identity_matches(identity: &RuntimeProcessIdentity) -> bool {
    inspect_process_identity(identity.pid).is_ok_and(|current| current == *identity)
}

fn process_group_is_alive(pgid: u32) -> bool {
    #[cfg(unix)]
    {
        if pgid <= 1 {
            return false;
        }
        Command::new("kill")
            .arg("-0")
            .arg(format!("-{pgid}"))
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    }
    #[cfg(not(unix))]
    {
        process_is_alive(pgid)
    }
}

fn process_is_managed_daemon(state: &RuntimeDaemonState, state_path: &Path) -> bool {
    process_command(state.daemon_pid).is_some_and(|command| {
        command.contains(DAEMON_MARKER)
            && command.contains(&state_path.display().to_string())
            && command.contains(&state.run_id)
    })
}

fn process_command(pid: u32) -> Option<String> {
    #[cfg(unix)]
    {
        let output = Command::new("ps")
            .args(["-ww", "-p", &pid.to_string(), "-o", "command="])
            .output()
            .ok()?;
        output
            .status
            .success()
            .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
            .filter(|value| !value.is_empty())
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        None
    }
}

fn tcp_port_listening(port: u16) -> bool {
    ("127.0.0.1", port)
        .to_socket_addrs()
        .ok()
        .and_then(|mut addresses| addresses.next())
        .is_some_and(|address| {
            TcpStream::connect_timeout(&address, Duration::from_millis(120)).is_ok()
        })
}

fn scrub_launcher_env(command: &mut Command) {
    for (key, _) in std::env::vars() {
        if key == "OUT_DIR"
            || key.starts_with("TAURI_")
            || key == "CARGO_MANIFEST_DIR"
            || key == "CARGO_MANIFEST_PATH"
            || key.starts_with("CARGO_PKG_")
        {
            command.env_remove(key);
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

struct RuntimeDaemonOperationLock {
    path: PathBuf,
}

impl RuntimeDaemonOperationLock {
    fn acquire(state_path: &Path) -> Result<Self> {
        let path = runtime_daemon_lock_path(state_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                writeln!(file, "{}", std::process::id())?;
                Ok(Self { path })
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let stale = fs::metadata(&path)
                    .and_then(|metadata| metadata.modified())
                    .ok()
                    .and_then(|modified| modified.elapsed().ok())
                    .is_some_and(|age| age > Duration::from_secs(15));
                if stale {
                    remove_file_if_exists(&path)?;
                    return Self::acquire(state_path);
                }
                bail!("another runtime daemon operation is already in progress")
            }
            Err(error) => Err(error.into()),
        }
    }
}

impl Drop for RuntimeDaemonOperationLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        APP_VERSION, DAEMON_MARKER, DAEMON_PROTOCOL_VERSION, ReadyTracker,
        RuntimeDaemonAdoptRequest, RuntimeDaemonPhase, RuntimeDaemonReadyConfig,
        RuntimeDaemonServeArgs, RuntimeDaemonStartRequest, RuntimeDaemonStopRequest,
        STATE_SCHEMA_VERSION, STOP_TIMEOUT, adopt, diagnose, extract_url_with_pattern,
        inspect_process_identity, list, listening_process, parse_runtime_daemon_args,
        prepare_stored_request, process_group_is_alive, process_is_alive, read_state,
        remove_file_if_exists, run_runtime_daemon_serve, runtime_daemon_lock_path,
        runtime_daemon_log_path, runtime_daemon_request_path, runtime_daemon_state_path,
        runtime_daemon_stop_path, runtime_status_key, stable_runtime_hash, status, stop,
        terminate_adopted_process_tree, terminate_groups, write_json_atomic,
    };
    use crate::config::ProjectLocalProxyConfig;
    use crate::runtime_local_proxy::RuntimeLocalProxySpec;
    use std::collections::BTreeMap;
    use std::ffi::OsString;
    use std::fs;
    use std::net::TcpListener;
    use std::path::Path;
    use std::process::{Command, Stdio};
    use std::thread;
    use std::time::{Duration, Instant};

    const TEST_REQUEST_ENV: &str = "RDEVTOOL_RUNTIME_DAEMON_TEST_REQUEST";
    const TEST_STATE_ENV: &str = "RDEVTOOL_RUNTIME_DAEMON_TEST_STATE";
    const TEST_RUN_ID_ENV: &str = "RDEVTOOL_RUNTIME_DAEMON_TEST_RUN_ID";

    #[test]
    fn status_identity_contains_project_and_canonical_cwd() {
        let key = runtime_status_key("web", "/tmp/worktree/web");
        assert_eq!(key, "web::/tmp/worktree/web");
        assert_ne!(
            stable_runtime_hash("web", "/tmp/a"),
            stable_runtime_hash("web", "/tmp/b")
        );
        assert_ne!(
            stable_runtime_hash("web", "/tmp/a"),
            stable_runtime_hash("api", "/tmp/a")
        );
    }

    #[test]
    fn parses_hidden_daemon_arguments_without_shell_splitting() {
        let args = vec![
            OsString::from("rdevtool"),
            OsString::from("--rdevtool-runtime-daemon"),
            OsString::from("--request-path"),
            OsString::from("/tmp/request with spaces.json"),
            OsString::from("--state-path"),
            OsString::from("/tmp/state with spaces.json"),
            OsString::from("--run-id"),
            OsString::from("run-a"),
        ];
        let request = parse_runtime_daemon_args(&args).unwrap();
        assert_eq!(
            request.request_path,
            Path::new("/tmp/request with spaces.json")
        );
        assert_eq!(request.run_id, "run-a");
    }

    #[test]
    fn start_request_canonicalizes_cwd_and_scopes_state_path() {
        let cwd = std::env::temp_dir().join(format!(
            "rdevtool-runtime-daemon-cwd-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&cwd).unwrap();
        let stored = prepare_stored_request(RuntimeDaemonStartRequest {
            project_key: "sample".to_string(),
            project_name: "Sample".to_string(),
            cwd: cwd.clone(),
            command: "sleep 1".to_string(),
            env: BTreeMap::new(),
            debug_profile: Some("debug".to_string()),
            runtime_profile: Some("node".to_string()),
            expected_port: Some(5173),
            ready: RuntimeDaemonReadyConfig {
                enabled: true,
                url_patterns: vec!["Local: {url}".to_string()],
                success_markers: Vec::new(),
                fallback_url: None,
            },
            log_path: cwd.join("runtime.log"),
            local_proxy: None,
        })
        .unwrap();
        assert_eq!(
            stored.canonical_cwd,
            cwd.canonicalize().unwrap().display().to_string()
        );
        assert_eq!(
            stored.status_key,
            runtime_status_key("sample", &stored.canonical_cwd)
        );
        assert!(
            runtime_daemon_state_path("sample", &stored.canonical_cwd)
                .file_name()
                .unwrap()
                .to_string_lossy()
                .ends_with(".state.json")
        );
        fs::remove_dir_all(cwd).unwrap();
    }

    #[test]
    fn ready_tracker_extracts_urls_from_configured_pattern() {
        assert_eq!(
            extract_url_with_pattern("  Local: http://localhost:5173/", "Local: {url}"),
            Some("http://localhost:5173/".to_string())
        );
        let tracker = ReadyTracker::new(0);
        assert_eq!(tracker.offset, 0);
    }

    #[test]
    fn adopt_rejects_a_process_that_is_not_running() {
        let error = adopt(RuntimeDaemonAdoptRequest {
            project_key: "sample".to_string(),
            project_name: "Sample".to_string(),
            cwd: Path::new("/tmp").to_path_buf(),
            pid: u32::MAX,
            expected_command: "vite".to_string(),
            expected_port: None,
            ready_url: None,
            log_path: Path::new("/tmp/runtime.log").to_path_buf(),
        })
        .unwrap_err();
        assert!(error.to_string().contains("is not running"));
    }

    #[cfg(unix)]
    #[test]
    fn refuses_to_signal_an_adopted_process_when_its_fingerprint_does_not_match() {
        let cwd = std::env::temp_dir().join(format!(
            "rdevtool-runtime-adopt-mismatch-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&cwd).unwrap();
        let mut child = Command::new("sleep")
            .arg("30")
            .current_dir(&cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let mut identity = inspect_process_identity(child.id()).unwrap();
        identity.command.push_str(" --different");
        let error = terminate_adopted_process_tree(&identity).unwrap_err();
        assert!(error.to_string().contains("identity changed"));
        assert!(process_is_alive(child.id()));
        let _ = child.kill();
        let _ = child.wait();
        let _ = fs::remove_dir_all(cwd);
    }

    #[cfg(unix)]
    #[test]
    fn supervises_and_stops_an_adopted_external_process_without_signaling_its_group() {
        let cwd = std::env::temp_dir().join(format!(
            "rdevtool-runtime-adopt-e2e-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&cwd).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        let mut external = Command::new("python3");
        external
            .args([
                "-m",
                "http.server",
                &port.to_string(),
                "--bind",
                "127.0.0.1",
            ])
            .current_dir(&cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut external = external.spawn().unwrap();
        let external_pid = external.id();
        let started = Instant::now();
        let identity = loop {
            if let Some(identity) = listening_process(port).unwrap() {
                break identity;
            }
            assert!(started.elapsed() < Duration::from_secs(5));
            thread::sleep(Duration::from_millis(50));
        };
        assert_eq!(identity.pid, external_pid);
        assert_eq!(inspect_process_identity(external_pid).unwrap(), identity);

        let project_key = format!("adopt-e2e-{}", uuid::Uuid::new_v4());
        let mut request = prepare_stored_request(RuntimeDaemonStartRequest {
            project_key: project_key.clone(),
            project_name: "Adopt E2E".to_string(),
            cwd: cwd.clone(),
            command: format!("python3 -m http.server {port}"),
            env: BTreeMap::new(),
            debug_profile: None,
            runtime_profile: None,
            expected_port: Some(port),
            ready: RuntimeDaemonReadyConfig {
                enabled: true,
                url_patterns: Vec::new(),
                success_markers: Vec::new(),
                fallback_url: Some(format!("http://127.0.0.1:{port}")),
            },
            log_path: cwd.join("dev.log"),
            local_proxy: None,
        })
        .unwrap();
        request.command = identity.command.clone();
        request.adopted_process = Some(identity.clone());
        let state_path = runtime_daemon_state_path(&project_key, &request.canonical_cwd);
        let request_path = runtime_daemon_request_path(&state_path, &request.run_id);
        write_json_atomic(&request_path, &request).unwrap();

        let mut daemon = Command::new(std::env::current_exe().unwrap());
        daemon
            .arg("--exact")
            .arg("runtime_daemon::tests::runtime_daemon_subprocess_entry")
            .arg("--nocapture")
            .arg("--test-threads=1")
            .arg(format!("--skip={DAEMON_MARKER}"))
            .arg(format!("--skip={}", state_path.display()))
            .arg(format!("--skip={}", request.run_id))
            .env(TEST_REQUEST_ENV, &request_path)
            .env(TEST_STATE_ENV, &state_path)
            .env(TEST_RUN_ID_ENV, &request.run_id)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut daemon = daemon.spawn().unwrap();

        let started = Instant::now();
        loop {
            let current = status(&project_key, &cwd).unwrap();
            if current
                .state
                .as_ref()
                .is_some_and(|state| state.phase == RuntimeDaemonPhase::Running)
            {
                assert!(current.running);
                assert!(current.managed);
                assert!(current.worker_group_alive);
                let state = current.state.unwrap();
                assert!(state.adopted);
                assert_eq!(state.adopted_process, Some(identity.clone()));
                assert_eq!(state.worker_pid, Some(external_pid));
                assert_eq!(state.worker_pgid, None);
                break;
            }
            assert!(started.elapsed() < Duration::from_secs(6));
            thread::sleep(Duration::from_millis(50));
        }

        let stopped = stop(&project_key, &cwd).unwrap();
        assert!(!stopped.running);
        let wait_started = Instant::now();
        loop {
            if external.try_wait().unwrap().is_some() {
                break;
            }
            assert!(wait_started.elapsed() < Duration::from_secs(3));
            thread::sleep(Duration::from_millis(50));
        }
        let wait_started = Instant::now();
        while daemon.try_wait().unwrap().is_none() {
            assert!(wait_started.elapsed() < Duration::from_secs(3));
            thread::sleep(Duration::from_millis(50));
        }

        let _ = remove_file_if_exists(&state_path);
        let _ = remove_file_if_exists(&runtime_daemon_stop_path(&state_path));
        let _ = remove_file_if_exists(&runtime_daemon_lock_path(&state_path));
        let _ = remove_file_if_exists(&runtime_daemon_log_path(&state_path));
        let _ = remove_file_if_exists(&request_path);
        let _ = fs::remove_dir_all(cwd);
    }

    #[test]
    fn diagnose_treats_a_never_started_runtime_as_healthy_and_stopped() {
        let project_key = format!("never-started-{}", uuid::Uuid::new_v4());
        let response = diagnose(&project_key, Path::new("/tmp")).unwrap();
        assert!(response.healthy);
        assert!(response.issues.is_empty());
        assert_eq!(response.status.phase_key, "stopped");
        assert!(!response.status.running);
    }

    #[test]
    fn active_phase_classification_is_stable() {
        assert!(RuntimeDaemonPhase::Starting.active());
        assert!(RuntimeDaemonPhase::Running.active());
        assert!(!RuntimeDaemonPhase::Exited.active());
    }

    #[test]
    fn runtime_daemon_subprocess_entry() {
        let Some(request_path) = std::env::var_os(TEST_REQUEST_ENV) else {
            return;
        };
        let state_path = std::env::var_os(TEST_STATE_ENV).expect("missing daemon test state path");
        let run_id = std::env::var(TEST_RUN_ID_ENV).expect("missing daemon test run ID");
        run_runtime_daemon_serve(RuntimeDaemonServeArgs {
            request_path: request_path.into(),
            state_path: state_path.into(),
            run_id,
        })
        .unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn escalates_from_term_to_kill_for_a_stubborn_process_group() {
        use std::os::unix::process::CommandExt;

        let mut command = Command::new("/bin/zsh");
        command
            .arg("-c")
            .arg("trap '' TERM; while true; do sleep 1; done")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        let mut child = command.spawn().unwrap();
        let pgid = child.id();
        thread::sleep(Duration::from_millis(150));
        let started = Instant::now();
        assert!(terminate_groups(Some(&mut child), None).unwrap());
        assert!(started.elapsed() >= STOP_TIMEOUT);
        assert!(!process_group_is_alive(pgid));
    }

    #[cfg(unix)]
    #[test]
    fn supervises_orphaned_worker_group_and_local_proxy_until_validated_stop() {
        let cwd = std::env::temp_dir().join(format!(
            "rdevtool-runtime-daemon-e2e-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&cwd).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let proxy_listen = listener.local_addr().unwrap().to_string();
        drop(listener);
        let project_key = format!("daemon-e2e-{}", uuid::Uuid::new_v4());
        let request = prepare_stored_request(RuntimeDaemonStartRequest {
            project_key: project_key.clone(),
            project_name: "Daemon E2E".to_string(),
            cwd: cwd.clone(),
            command: "sleep 30 &!".to_string(),
            env: BTreeMap::new(),
            debug_profile: Some("debug".to_string()),
            runtime_profile: None,
            expected_port: None,
            ready: RuntimeDaemonReadyConfig {
                enabled: false,
                url_patterns: Vec::new(),
                success_markers: Vec::new(),
                fallback_url: None,
            },
            log_path: cwd.join("dev.log"),
            local_proxy: Some(RuntimeLocalProxySpec {
                project_key: project_key.clone(),
                profile_key: "debug".to_string(),
                config: ProjectLocalProxyConfig {
                    enabled: true,
                    listen: proxy_listen,
                    frontend_url: "http://127.0.0.1:9".to_string(),
                    ..ProjectLocalProxyConfig::default()
                },
                log_path: cwd.join("local-proxy.log").display().to_string(),
            }),
        })
        .unwrap();
        let state_path = runtime_daemon_state_path(&project_key, &request.canonical_cwd);
        let request_path = runtime_daemon_request_path(&state_path, &request.run_id);
        write_json_atomic(&request_path, &request).unwrap();

        let mut daemon = Command::new(std::env::current_exe().unwrap());
        daemon
            .arg("--exact")
            .arg("runtime_daemon::tests::runtime_daemon_subprocess_entry")
            .arg("--nocapture")
            .arg("--test-threads=1")
            .arg(format!("--skip={DAEMON_MARKER}"))
            .arg(format!("--skip={}", state_path.display()))
            .arg(format!("--skip={}", request.run_id))
            .env(TEST_REQUEST_ENV, &request_path)
            .env(TEST_STATE_ENV, &state_path)
            .env(TEST_RUN_ID_ENV, &request.run_id)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut daemon = daemon.spawn().unwrap();

        let started = Instant::now();
        let running_state = loop {
            if let Ok(state) = read_state(&state_path) {
                if state.phase == RuntimeDaemonPhase::Running {
                    break state;
                }
                if state.phase == RuntimeDaemonPhase::Failed {
                    panic!("daemon startup failed: {:?}", state.exit);
                }
            }
            assert!(started.elapsed() < Duration::from_secs(6));
            thread::sleep(Duration::from_millis(50));
        };

        thread::sleep(Duration::from_millis(200));
        let worker_pid = running_state.worker_pid.unwrap();
        let worker_pgid = running_state.worker_pgid.unwrap();
        let proxy_pgid = running_state.local_proxy_pgid.unwrap();
        assert!(!process_is_alive(worker_pid));
        assert!(process_group_is_alive(worker_pgid));
        let persisted = status(&project_key, &cwd).unwrap();
        assert!(persisted.running);
        assert!(persisted.managed);
        assert!(persisted.worker_group_alive);
        assert!(persisted.local_proxy_group_alive);
        assert!(diagnose(&project_key, &cwd).unwrap().healthy);
        assert!(
            list()
                .unwrap()
                .iter()
                .any(|item| item.status_key == running_state.status_key)
        );

        write_json_atomic(
            &runtime_daemon_stop_path(&state_path),
            &RuntimeDaemonStopRequest {
                schema_version: STATE_SCHEMA_VERSION,
                protocol_version: DAEMON_PROTOCOL_VERSION,
                app_version: APP_VERSION.to_string(),
                run_id: running_state.run_id.clone(),
                control_token: "invalid-control-token".to_string(),
                status_key: running_state.status_key.clone(),
                project_key: project_key.clone(),
                canonical_cwd: running_state.canonical_cwd.clone(),
                daemon_pid: running_state.daemon_pid,
            },
        )
        .unwrap();
        thread::sleep(Duration::from_millis(200));
        let after_invalid_stop = status(&project_key, &cwd).unwrap();
        assert!(after_invalid_stop.running);
        assert!(after_invalid_stop.worker_group_alive);
        assert!(after_invalid_stop.local_proxy_group_alive);

        let stop_started = Instant::now();
        let stopped = stop(&project_key, &cwd).unwrap();
        assert!(stop_started.elapsed() < Duration::from_secs(3));
        assert!(!stopped.running);
        assert!(!process_group_is_alive(worker_pgid));
        assert!(!process_group_is_alive(proxy_pgid));
        assert!(
            stopped
                .state
                .as_ref()
                .and_then(|state| state.exit.as_ref())
                .is_some_and(|exit| exit.reason.contains("validated daemon request"))
        );

        let wait_started = Instant::now();
        while daemon.try_wait().unwrap().is_none() {
            assert!(wait_started.elapsed() < Duration::from_secs(3));
            thread::sleep(Duration::from_millis(50));
        }
        let _ = remove_file_if_exists(&state_path);
        let _ = remove_file_if_exists(&runtime_daemon_stop_path(&state_path));
        let _ = remove_file_if_exists(&runtime_daemon_lock_path(&state_path));
        let _ = remove_file_if_exists(&runtime_daemon_log_path(&state_path));
        let _ = remove_file_if_exists(&request_path);
        let _ = fs::remove_dir_all(cwd);
    }
}
