use crate::config::default_config_dir;
use crate::proxy::{
    ProxyDashboard, ProxyEvent, ProxyProfile, ProxyProfileRuntimeStatus, ProxyRuntimeState,
    load_proxy_config, validate_proxy_profile,
};
use anyhow::{Context, Result, anyhow, bail};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const DAEMON_MARKER: &str = "--rdevtool-proxy-daemon";
const STATE_SCHEMA_VERSION: u16 = 1;
// Bump when daemon state or runtime behavior requires a managed restart.
const DAEMON_PROTOCOL_VERSION: u16 = 2;
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const START_TIMEOUT: Duration = Duration::from_secs(5);
const STOP_TIMEOUT: Duration = Duration::from_secs(3);
const POLL_INTERVAL: Duration = Duration::from_millis(80);
const MAX_PERSISTED_EVENTS: usize = 500;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyDaemonState {
    pub schema_version: u16,
    #[serde(default)]
    pub protocol_version: u16,
    #[serde(default)]
    pub app_version: String,
    pub pid: u32,
    pub profile_id: String,
    pub config_path: String,
    pub listen_url: String,
    pub started_at: String,
    pub executable: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyDaemonStatus {
    pub profile_id: String,
    pub profile_name: String,
    pub config_path: String,
    pub listen_url: String,
    pub running: bool,
    pub managed: bool,
    pub version_compatible: bool,
    pub protocol_version: Option<u16>,
    pub app_version: Option<String>,
    pub pid: Option<u32>,
    pub started_at: Option<String>,
    pub owner: Option<String>,
    pub state_path: String,
    pub detail: String,
}

#[derive(Debug, Clone)]
pub(crate) struct ProxyDaemonArtifactStateObservation {
    pub state: ProxyDaemonState,
    pub ownership_verified: bool,
    pub active: bool,
    pub version_compatible: bool,
}

#[derive(Clone, Default)]
pub struct ProxyDaemonRuntime;

impl ProxyDaemonRuntime {
    pub fn dashboard(&self, path: &Path) -> Result<ProxyDashboard> {
        let config = load_proxy_config(path)?;
        Ok(ProxyDashboard {
            config_path: path.display().to_string(),
            statuses: self.statuses_for_profiles(path, &config.profiles),
            events: self.events(path, None),
            config,
        })
    }

    pub fn start_profile(
        &self,
        path: PathBuf,
        profile_id: String,
    ) -> Result<ProxyProfileRuntimeStatus> {
        daemon_status_to_runtime(proxy_daemon_start(&path, &profile_id)?)
    }

    pub fn ensure_profile_running(
        &self,
        path: PathBuf,
        profile_id: String,
    ) -> Result<ProxyProfileRuntimeStatus> {
        let status = proxy_daemon_status(&path, &profile_id)?;
        if status.running && status.managed {
            return daemon_status_to_runtime(status);
        }
        self.start_profile(path, profile_id)
    }

    pub fn stop_profile_result(&self, path: &Path, profile_id: &str) -> Result<ProxyDaemonStatus> {
        proxy_daemon_stop(path, profile_id)
    }

    pub fn stop_profile(&self, path: &Path, profile_id: &str) -> bool {
        self.stop_profile_result(path, profile_id)
            .map(|status| !status.running)
            .unwrap_or(false)
    }

    pub fn statuses_for_profiles(
        &self,
        path: &Path,
        profiles: &[ProxyProfile],
    ) -> Vec<ProxyProfileRuntimeStatus> {
        profiles
            .iter()
            .map(|profile| {
                proxy_daemon_status_for_profile(path, profile)
                    .and_then(daemon_status_to_runtime)
                    .unwrap_or_else(|_| ProxyProfileRuntimeStatus {
                        profile_id: profile.id.clone(),
                        running: false,
                        listen_url: profile.listen_url(),
                        started_at: None,
                    })
            })
            .collect()
    }

    pub fn events(&self, path: &Path, profile_id: Option<&str>) -> Vec<ProxyEvent> {
        read_persisted_proxy_events(path, profile_id).unwrap_or_default()
    }

    pub fn clear_events(&self, path: &Path, profile_id: Option<&str>) {
        let _ = clear_persisted_proxy_events(path, profile_id);
    }
}

pub fn run_proxy_daemon_from_args(args: &[OsString]) -> Option<Result<()>> {
    if args.get(1).and_then(|value| value.to_str()) != Some(DAEMON_MARKER) {
        return None;
    }
    Some(parse_proxy_daemon_args(args).and_then(|request| {
        run_proxy_daemon_serve(
            &request.config_path,
            &request.profile_id,
            &request.state_path,
        )
    }))
}

pub fn proxy_daemon_start(config_path: &Path, profile_id: &str) -> Result<ProxyDaemonStatus> {
    let config_path = normalized_config_path(config_path);
    let profile = proxy_profile(&config_path, profile_id)?;
    validate_proxy_profile(&profile)?;
    let state_path = proxy_daemon_state_path(&config_path, &profile.id);
    let _guard = DaemonOperationLock::acquire(&state_path)?;

    let current = proxy_daemon_status_for_profile(&config_path, &profile)?;
    if current.managed {
        if current.running && current.version_compatible {
            return Ok(current);
        }
        stop_managed_daemon(&current, &state_path)?;
    } else if current.running {
        bail!(
            "proxy port is already owned by an unmanaged process: {}{}",
            profile.listen_url(),
            current
                .owner
                .as_ref()
                .map(|owner| format!(" ({owner})"))
                .unwrap_or_default()
        );
    }

    remove_file_if_exists(&proxy_daemon_stop_path(&state_path))?;
    remove_file_if_exists(&state_path)?;
    let executable = std::env::current_exe().context("failed to locate rDevTool executable")?;
    let log_path = proxy_daemon_log_path(&state_path);
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .with_context(|| format!("failed to open proxy daemon log: {}", log_path.display()))?;
    let stderr = stdout.try_clone()?;
    let mut command = Command::new(&executable);
    command
        .arg(DAEMON_MARKER)
        .arg("--config-path")
        .arg(&config_path)
        .arg("--profile-id")
        .arg(&profile.id)
        .arg("--state-path")
        .arg(&state_path)
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
            "failed to start proxy daemon with executable {}",
            executable.display()
        )
    })?;

    let started = Instant::now();
    loop {
        if let Some(exit) = child.try_wait()? {
            bail!(
                "proxy daemon exited before becoming ready: {} (log {})",
                exit,
                log_path.display()
            );
        }
        let status = proxy_daemon_status_for_profile(&config_path, &profile)?;
        if status.running && status.managed && status.pid == Some(child.id()) {
            reap_child_in_background(child);
            return Ok(status);
        }
        if started.elapsed() >= START_TIMEOUT {
            let _ = request_daemon_stop(&state_path, child.id());
            let _ = terminate_managed_process(child.id(), &state_path);
            bail!(
                "proxy daemon did not become ready within {} ms (log {})",
                START_TIMEOUT.as_millis(),
                log_path.display()
            );
        }
        thread::sleep(POLL_INTERVAL);
    }
}

pub fn proxy_daemon_stop(config_path: &Path, profile_id: &str) -> Result<ProxyDaemonStatus> {
    let config_path = normalized_config_path(config_path);
    let profile = proxy_profile(&config_path, profile_id)?;
    let state_path = proxy_daemon_state_path(&config_path, &profile.id);
    let _guard = DaemonOperationLock::acquire(&state_path)?;
    let current = proxy_daemon_status_for_profile(&config_path, &profile)?;
    if !current.running && current.pid.is_none() {
        return Ok(current);
    }
    if !current.managed {
        bail!(
            "refusing to stop unmanaged listener on {}{}",
            current.listen_url,
            current
                .owner
                .as_ref()
                .map(|owner| format!(" ({owner})"))
                .unwrap_or_default()
        );
    }
    stop_managed_daemon(&current, &state_path)?;
    proxy_daemon_status_for_profile(&config_path, &profile)
}

pub fn proxy_daemon_restart(config_path: &Path, profile_id: &str) -> Result<ProxyDaemonStatus> {
    let _ = proxy_daemon_stop(config_path, profile_id)?;
    proxy_daemon_start(config_path, profile_id)
}

pub fn proxy_daemon_status(config_path: &Path, profile_id: &str) -> Result<ProxyDaemonStatus> {
    let config_path = normalized_config_path(config_path);
    let profile = proxy_profile(&config_path, profile_id)?;
    proxy_daemon_status_for_profile(&config_path, &profile)
}

pub(crate) fn append_persisted_proxy_event(config_path: &Path, event: &ProxyEvent) -> Result<()> {
    let path = proxy_events_path(config_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let line = format!("{}\n", serde_json::to_string(event)?);
    let mut file = OpenOptions::new().create(true).append(true).open(&path)?;
    file.write_all(line.as_bytes())?;
    if file.metadata()?.len() > 4 * 1024 * 1024 {
        let events = read_persisted_proxy_events(config_path, None)?;
        write_proxy_events(
            &path,
            events.into_iter().rev().collect::<Vec<_>>().as_slice(),
        )?;
    }
    Ok(())
}

fn read_persisted_proxy_events(
    config_path: &Path,
    profile_id: Option<&str>,
) -> Result<Vec<ProxyEvent>> {
    let path = proxy_events_path(config_path);
    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    Ok(content
        .lines()
        .rev()
        .filter_map(|line| serde_json::from_str::<ProxyEvent>(line).ok())
        .filter(|event| profile_id.is_none_or(|profile_id| event.profile_id == profile_id))
        .take(MAX_PERSISTED_EVENTS)
        .collect())
}

pub(crate) fn clear_persisted_proxy_events(
    config_path: &Path,
    profile_id: Option<&str>,
) -> Result<()> {
    let path = proxy_events_path(config_path);
    let Some(profile_id) = profile_id else {
        return remove_file_if_exists(&path);
    };
    let retained = read_persisted_proxy_events(config_path, None)?
        .into_iter()
        .filter(|event| event.profile_id != profile_id)
        .rev()
        .collect::<Vec<_>>();
    write_proxy_events(&path, &retained)
}

fn write_proxy_events(path: &Path, events: &[ProxyEvent]) -> Result<()> {
    if events.is_empty() {
        return remove_file_if_exists(path);
    }
    let content = events
        .iter()
        .map(serde_json::to_string)
        .collect::<std::result::Result<Vec<_>, _>>()?
        .join("\n");
    write_text_atomic(path, format!("{content}\n").as_bytes())
}

fn daemon_status_to_runtime(status: ProxyDaemonStatus) -> Result<ProxyProfileRuntimeStatus> {
    if !status.running || !status.managed {
        bail!("proxy daemon is not running: {}", status.detail);
    }
    Ok(ProxyProfileRuntimeStatus {
        profile_id: status.profile_id,
        running: true,
        listen_url: status.listen_url,
        started_at: status.started_at,
    })
}

fn run_proxy_daemon_serve(
    config_path: &Path,
    profile_id: &str,
    requested_state_path: &Path,
) -> Result<()> {
    let config_path = normalized_config_path(config_path);
    let profile = proxy_profile(&config_path, profile_id)?;
    validate_proxy_profile(&profile)?;
    let state_path = proxy_daemon_state_path(&config_path, &profile.id);
    if normalized_absolute_path(requested_state_path) != normalized_absolute_path(&state_path) {
        bail!("invalid proxy daemon state path");
    }
    remove_file_if_exists(&proxy_daemon_stop_path(&state_path))?;
    let runtime = ProxyRuntimeState::default();
    let runtime_status = runtime.start_profile(config_path.clone(), profile.id.clone())?;
    let state = ProxyDaemonState {
        schema_version: STATE_SCHEMA_VERSION,
        protocol_version: DAEMON_PROTOCOL_VERSION,
        app_version: APP_VERSION.to_string(),
        pid: std::process::id(),
        profile_id: profile.id.clone(),
        config_path: config_path.display().to_string(),
        listen_url: runtime_status.listen_url,
        started_at: runtime_status
            .started_at
            .unwrap_or_else(|| Utc::now().to_rfc3339()),
        executable: std::env::current_exe()
            .map(|path| path.display().to_string())
            .unwrap_or_default(),
    };
    write_state(&state_path, &state)?;

    loop {
        if proxy_daemon_stop_path(&state_path).exists() {
            break;
        }
        match read_state(&state_path) {
            Ok(current) if current.pid == state.pid => {}
            _ => break,
        }
        thread::sleep(POLL_INTERVAL);
    }
    runtime.stop_profile(&config_path, &profile.id);
    remove_file_if_exists(&state_path)?;
    remove_file_if_exists(&proxy_daemon_stop_path(&state_path))?;
    Ok(())
}

fn proxy_daemon_status_for_profile(
    config_path: &Path,
    profile: &ProxyProfile,
) -> Result<ProxyDaemonStatus> {
    let state_path = proxy_daemon_state_path(config_path, &profile.id);
    let listener_running = proxy_listener_running(profile);
    let state = read_state(&state_path).ok();
    let managed_state = state.as_ref().filter(|state| {
        state.schema_version == STATE_SCHEMA_VERSION
            && state.profile_id == profile.id
            && normalized_absolute_path(Path::new(&state.config_path))
                == normalized_absolute_path(config_path)
            && process_is_alive(state.pid)
            && process_is_managed_daemon(state.pid, &state_path)
    });
    if state.is_some() && managed_state.is_none() {
        let _ = remove_file_if_exists(&state_path);
    }
    let managed = managed_state.is_some();
    let running = listener_running;
    let version_compatible = managed_state
        .map(daemon_state_version_compatible)
        .unwrap_or(!listener_running);
    let owner = if let Some(state) = managed_state {
        process_command(state.pid)
    } else if listener_running {
        listener_owner(profile.listen_port)
    } else {
        None
    };
    let detail = match (running, managed, version_compatible) {
        (true, true, true) => "proxy daemon is listening".to_string(),
        (true, true, false) => {
            "proxy daemon uses an older runtime; start or restart will upgrade it".to_string()
        }
        (true, false, _) => "port is listening but is not owned by rDevTool daemon".to_string(),
        (false, true, _) => {
            "proxy daemon process exists but the configured port is not listening".to_string()
        }
        (false, false, _) => "proxy daemon is stopped".to_string(),
    };
    Ok(ProxyDaemonStatus {
        profile_id: profile.id.clone(),
        profile_name: profile.name.clone(),
        config_path: config_path.display().to_string(),
        listen_url: profile.listen_url(),
        running,
        managed,
        version_compatible,
        protocol_version: managed_state.map(|state| state.protocol_version),
        app_version: managed_state.map(|state| state.app_version.clone()),
        pid: managed_state.map(|state| state.pid),
        started_at: managed_state.map(|state| state.started_at.clone()),
        owner,
        state_path: state_path.display().to_string(),
        detail,
    })
}

fn daemon_state_version_compatible(state: &ProxyDaemonState) -> bool {
    state.protocol_version == DAEMON_PROTOCOL_VERSION && state.app_version == APP_VERSION
}

fn stop_managed_daemon(current: &ProxyDaemonStatus, state_path: &Path) -> Result<()> {
    let pid = current
        .pid
        .ok_or_else(|| anyhow!("managed proxy state does not contain a PID"))?;
    if !process_is_managed_daemon(pid, state_path) {
        remove_file_if_exists(state_path)?;
        bail!("proxy daemon PID {} no longer belongs to rDevTool", pid);
    }
    request_daemon_stop(state_path, pid)?;
    let started = Instant::now();
    while process_is_alive(pid) && started.elapsed() < STOP_TIMEOUT {
        thread::sleep(POLL_INTERVAL);
    }
    if process_is_alive(pid) {
        terminate_managed_process(pid, state_path)?;
    }
    remove_file_if_exists(state_path)?;
    remove_file_if_exists(&proxy_daemon_stop_path(state_path))?;
    Ok(())
}

struct ProxyDaemonServeRequest {
    config_path: PathBuf,
    profile_id: String,
    state_path: PathBuf,
}

fn parse_proxy_daemon_args(args: &[OsString]) -> Result<ProxyDaemonServeRequest> {
    let mut config_path = None;
    let mut profile_id = None;
    let mut state_path = None;
    let mut index = 2;
    while index < args.len() {
        let key = args[index]
            .to_str()
            .ok_or_else(|| anyhow!("proxy daemon argument is not UTF-8"))?;
        let value = args
            .get(index + 1)
            .ok_or_else(|| anyhow!("missing value for proxy daemon argument {key}"))?;
        match key {
            "--config-path" => config_path = Some(PathBuf::from(value)),
            "--profile-id" => profile_id = value.to_str().map(ToString::to_string),
            "--state-path" => state_path = Some(PathBuf::from(value)),
            _ => bail!("unknown proxy daemon argument: {key}"),
        }
        index += 2;
    }
    Ok(ProxyDaemonServeRequest {
        config_path: config_path.ok_or_else(|| anyhow!("missing --config-path"))?,
        profile_id: profile_id.ok_or_else(|| anyhow!("missing --profile-id"))?,
        state_path: state_path.ok_or_else(|| anyhow!("missing --state-path"))?,
    })
}

fn proxy_profile(config_path: &Path, profile_id: &str) -> Result<ProxyProfile> {
    load_proxy_config(config_path)?
        .profiles
        .into_iter()
        .find(|profile| profile.id == profile_id || profile.name == profile_id)
        .ok_or_else(|| anyhow!("proxy profile not found: {profile_id}"))
}

fn proxy_listener_running(profile: &ProxyProfile) -> bool {
    profile
        .listen_addr()
        .to_socket_addrs()
        .ok()
        .and_then(|mut addresses| addresses.next())
        .is_some_and(|address| {
            TcpStream::connect_timeout(&address, Duration::from_millis(180)).is_ok()
        })
}

fn proxy_daemon_state_path(config_path: &Path, profile_id: &str) -> PathBuf {
    proxy_daemon_state_path_in(&proxy_runtime_dir(), config_path, profile_id)
}

pub(crate) fn proxy_daemon_state_path_in(
    runtime_dir: &Path,
    config_path: &Path,
    profile_id: &str,
) -> PathBuf {
    runtime_dir.join(format!(
        "proxy-{:016x}.json",
        runtime_key_hash(config_path, profile_id)
    ))
}

fn proxy_events_path(config_path: &Path) -> PathBuf {
    proxy_runtime_dir().join(format!(
        "events-{:016x}.jsonl",
        runtime_key_hash(config_path, "events")
    ))
}

fn proxy_runtime_dir() -> PathBuf {
    default_config_dir().join("proxy-runtime")
}

fn proxy_daemon_stop_path(state_path: &Path) -> PathBuf {
    state_path.with_extension("stop")
}

fn proxy_daemon_lock_path(state_path: &Path) -> PathBuf {
    state_path.with_extension("lock")
}

fn proxy_daemon_log_path(state_path: &Path) -> PathBuf {
    state_path.with_extension("log")
}

pub(crate) fn inspect_proxy_daemon_artifact_state(
    state_path: &Path,
) -> Result<ProxyDaemonArtifactStateObservation> {
    let state = read_state(state_path)?;
    let expected_name = proxy_daemon_state_path_in(
        state_path.parent().unwrap_or_else(|| Path::new(".")),
        Path::new(&state.config_path),
        &state.profile_id,
    )
    .file_name()
    .map(|value| value.to_os_string());
    let ownership_verified = state.schema_version == STATE_SCHEMA_VERSION
        && !state.profile_id.trim().is_empty()
        && !state.config_path.trim().is_empty()
        && expected_name.as_deref() == state_path.file_name();
    let active = ownership_verified
        && process_is_alive(state.pid)
        && process_is_managed_daemon(state.pid, state_path);
    let version_compatible = daemon_state_version_compatible(&state);
    Ok(ProxyDaemonArtifactStateObservation {
        state,
        ownership_verified,
        active,
        version_compatible,
    })
}

fn runtime_key_hash(config_path: &Path, profile_id: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    normalized_absolute_path(config_path).hash(&mut hasher);
    profile_id.hash(&mut hasher);
    hasher.finish()
}

fn normalized_config_path(path: &Path) -> PathBuf {
    path.canonicalize()
        .unwrap_or_else(|_| normalized_absolute_path(path))
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

fn write_state(path: &Path, state: &ProxyDaemonState) -> Result<()> {
    write_text_atomic(path, serde_json::to_vec_pretty(state)?.as_slice())
}

fn read_state(path: &Path) -> Result<ProxyDaemonState> {
    let content = fs::read(path)?;
    Ok(serde_json::from_slice(&content)?)
}

fn write_text_atomic(path: &Path, content: &[u8]) -> Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let temporary = path.with_extension(format!("tmp-{}", std::process::id()));
    fs::write(&temporary, content)?;
    fs::rename(&temporary, path)?;
    Ok(())
}

fn request_daemon_stop(state_path: &Path, pid: u32) -> Result<()> {
    write_text_atomic(
        &proxy_daemon_stop_path(state_path),
        pid.to_string().as_bytes(),
    )
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
        let output = Command::new("ps")
            .args(["-p", &pid.to_string(), "-o", "stat="])
            .output();
        output.is_ok_and(|output| {
            output.status.success()
                && unix_process_status_is_alive(String::from_utf8_lossy(&output.stdout).as_ref())
        })
    }
    #[cfg(windows)]
    {
        Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .output()
            .is_ok_and(|output| String::from_utf8_lossy(&output.stdout).contains(&pid.to_string()))
    }
}

#[cfg(unix)]
fn unix_process_status_is_alive(status: &str) -> bool {
    let status = status.trim();
    !status.is_empty() && !status.starts_with('Z')
}

fn reap_child_in_background(mut child: Child) {
    let _ = thread::Builder::new()
        .name(format!("rdevtool-proxy-reaper-{}", child.id()))
        .spawn(move || {
            let _ = child.wait();
        });
}

fn process_is_managed_daemon(pid: u32, state_path: &Path) -> bool {
    process_command(pid).is_some_and(|command| {
        command.contains(DAEMON_MARKER) && command.contains(&state_path.display().to_string())
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
    #[cfg(windows)]
    {
        let _ = pid;
        None
    }
}

fn listener_owner(port: u16) -> Option<String> {
    #[cfg(unix)]
    {
        let output = Command::new("lsof")
            .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-Fpc"])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let pid = text.lines().find_map(|line| line.strip_prefix('p'))?;
        let process = text
            .lines()
            .find_map(|line| line.strip_prefix('c'))
            .unwrap_or("unknown");
        Some(format!("{process} (PID {pid})"))
    }
    #[cfg(windows)]
    {
        let _ = port;
        None
    }
}

fn terminate_managed_process(pid: u32, state_path: &Path) -> Result<()> {
    if !process_is_managed_daemon(pid, state_path) {
        bail!("refusing to terminate unmanaged PID {pid}");
    }
    #[cfg(unix)]
    {
        let status = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status()?;
        if !status.success() {
            bail!("failed to terminate proxy daemon PID {pid}");
        }
    }
    #[cfg(windows)]
    {
        let status = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T"])
            .status()?;
        if !status.success() {
            bail!("failed to terminate proxy daemon PID {pid}");
        }
    }
    Ok(())
}

struct DaemonOperationLock {
    path: PathBuf,
}

impl DaemonOperationLock {
    fn acquire(state_path: &Path) -> Result<Self> {
        let path = proxy_daemon_lock_path(state_path);
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
                bail!("another proxy daemon operation is already in progress")
            }
            Err(error) => Err(error.into()),
        }
    }
}

impl Drop for DaemonOperationLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        APP_VERSION, DAEMON_PROTOCOL_VERSION, ProxyDaemonState, daemon_state_version_compatible,
        normalized_config_path, parse_proxy_daemon_args, proxy_daemon_state_path,
        proxy_daemon_status, proxy_daemon_stop, runtime_key_hash, write_state,
    };
    use crate::proxy::{ProxyConfig, ProxyProfile, save_proxy_config};
    use chrono::Utc;
    use std::ffi::OsString;
    use std::fs;
    use std::net::TcpListener;
    use std::path::{Path, PathBuf};
    #[cfg(unix)]
    use std::process::Command;
    #[cfg(unix)]
    use std::thread;
    #[cfg(unix)]
    use std::time::{Duration, Instant};

    fn temporary_proxy_config(profile: ProxyProfile) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "rdevtool-proxy-daemon-test-{}.toml",
            uuid::Uuid::new_v4()
        ));
        save_proxy_config(
            &path,
            &ProxyConfig {
                profiles: vec![profile],
                rules: Vec::new(),
            },
        )
        .unwrap();
        path
    }

    fn remove_test_files(config_path: &Path, profile_id: &str) {
        let state_path = proxy_daemon_state_path(config_path, profile_id);
        let _ = fs::remove_file(config_path);
        let _ = fs::remove_file(config_path.with_extension("toml.bak"));
        let _ = fs::remove_file(&state_path);
        let _ = fs::remove_file(state_path.with_extension("stop"));
        let _ = fs::remove_file(state_path.with_extension("lock"));
        let _ = fs::remove_file(state_path.with_extension("log"));
    }

    #[test]
    fn runtime_key_is_scoped_by_config_and_profile() {
        assert_ne!(
            runtime_key_hash(Path::new("/tmp/a.toml"), "proxy"),
            runtime_key_hash(Path::new("/tmp/b.toml"), "proxy")
        );
        assert_ne!(
            runtime_key_hash(Path::new("/tmp/a.toml"), "proxy-a"),
            runtime_key_hash(Path::new("/tmp/a.toml"), "proxy-b")
        );
    }

    #[test]
    fn parses_hidden_daemon_arguments_without_shell_splitting() {
        let args = vec![
            OsString::from("rdevtool"),
            OsString::from("--rdevtool-proxy-daemon"),
            OsString::from("--config-path"),
            OsString::from("/tmp/config with spaces.toml"),
            OsString::from("--profile-id"),
            OsString::from("profile-a"),
            OsString::from("--state-path"),
            OsString::from("/tmp/state with spaces.json"),
        ];
        let request = parse_proxy_daemon_args(&args).unwrap();
        assert_eq!(
            request.config_path,
            Path::new("/tmp/config with spaces.toml")
        );
        assert_eq!(request.profile_id, "profile-a");
    }

    #[test]
    fn reports_external_listener_and_refuses_to_stop_it() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let profile = ProxyProfile {
            id: format!("external-listener-{}", uuid::Uuid::new_v4()),
            name: "External listener".to_string(),
            listen_port: port,
            ..ProxyProfile::default()
        };
        let config_path = temporary_proxy_config(profile.clone());

        let status = proxy_daemon_status(&config_path, &profile.id).unwrap();
        assert!(status.running);
        assert!(!status.managed);
        assert!(!status.version_compatible);
        let error = proxy_daemon_stop(&config_path, &profile.id).unwrap_err();
        assert!(
            error
                .to_string()
                .contains("refusing to stop unmanaged listener")
        );

        drop(listener);
        remove_test_files(&config_path, &profile.id);
    }

    #[test]
    fn removes_stale_state_that_does_not_belong_to_a_daemon() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let profile = ProxyProfile {
            id: format!("stale-state-{}", uuid::Uuid::new_v4()),
            name: "Stale state".to_string(),
            listen_port: port,
            ..ProxyProfile::default()
        };
        let config_path = temporary_proxy_config(profile.clone());
        let normalized_config_path = normalized_config_path(&config_path);
        let state_path = proxy_daemon_state_path(&normalized_config_path, &profile.id);
        write_state(
            &state_path,
            &ProxyDaemonState {
                schema_version: 1,
                protocol_version: DAEMON_PROTOCOL_VERSION,
                app_version: APP_VERSION.to_string(),
                pid: std::process::id(),
                profile_id: profile.id.clone(),
                config_path: normalized_config_path.display().to_string(),
                listen_url: profile.listen_url(),
                started_at: Utc::now().to_rfc3339(),
                executable: std::env::current_exe().unwrap().display().to_string(),
            },
        )
        .unwrap();

        let status = proxy_daemon_status(&config_path, &profile.id).unwrap();
        assert!(!status.running);
        assert!(!status.managed);
        assert!(!state_path.exists());

        remove_test_files(&config_path, &profile.id);
    }

    #[test]
    fn detects_daemon_runtime_version_mismatches() {
        let current = ProxyDaemonState {
            schema_version: 1,
            protocol_version: DAEMON_PROTOCOL_VERSION,
            app_version: APP_VERSION.to_string(),
            pid: 1,
            profile_id: "proxy".to_string(),
            config_path: "/tmp/proxy.toml".to_string(),
            listen_url: "http://127.0.0.1:8787".to_string(),
            started_at: Utc::now().to_rfc3339(),
            executable: "/tmp/rdevtool".to_string(),
        };
        assert!(daemon_state_version_compatible(&current));
        assert!(!daemon_state_version_compatible(&ProxyDaemonState {
            protocol_version: 0,
            ..current
        }));
    }

    #[cfg(unix)]
    #[test]
    fn background_reaper_collects_exited_children() {
        let child = Command::new("sh").args(["-c", "exit 0"]).spawn().unwrap();
        let pid = child.id();
        super::reap_child_in_background(child);

        let started = Instant::now();
        while super::process_is_alive(pid) && started.elapsed() < Duration::from_secs(2) {
            thread::sleep(Duration::from_millis(20));
        }

        assert!(!super::process_is_alive(pid));
    }

    #[cfg(unix)]
    #[test]
    fn zombie_process_status_is_treated_as_stopped() {
        assert!(super::unix_process_status_is_alive("S+"));
        assert!(super::unix_process_status_is_alive("R"));
        assert!(!super::unix_process_status_is_alive("Z"));
        assert!(!super::unix_process_status_is_alive("Z+"));
        assert!(!super::unix_process_status_is_alive(" "));
    }
}
