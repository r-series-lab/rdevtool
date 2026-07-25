use crate::config::{
    AppConfig, ProjectCommandConfig, ProjectConfig, ProjectDebugLocalFileConfig,
    ProjectDebugProfileConfig, ProjectDebugReadyProbeConfig, ProjectNetworkProxyConfig,
    ProjectReadyConfig, RuntimeProfileConfig, default_config_dir,
};
use crate::navigation::{
    NavigationEntry, NavigationOpenResult, open_navigation_entry_with_runtime_profiles,
};
use crate::operation::{
    ManagedArtifact, OperationEvidence, OperationRisk, OperationStatus, RecommendedAction,
};
use crate::proxy::{ProxyConfig, ProxyProfile};
use crate::runtime_daemon::{
    RuntimeDaemonAdoptRequest, RuntimeDaemonAdoptResponse, RuntimeDaemonHttpReadyConfig,
    RuntimeDaemonPhase, RuntimeDaemonReadyConfig, RuntimeDaemonStartRequest,
    RuntimeProcessIdentity, adopt as adopt_runtime_daemon, find as find_runtime_daemon,
    list as list_runtime_daemons, listening_process, start_with_result as start_runtime_daemon,
};
use crate::runtime_local_proxy::local_proxy_spec;
use crate::web_actions::list_web_actions;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader};
use std::net::{TcpListener, TcpStream, ToSocketAddrs};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const NODE_PROXY_HOOK_FILENAME: &str = "rdevtool-node-proxy-hook.cjs";
const NODE_PROXY_HOOK: &str = r#"'use strict';

const http = require('http');
const { URL } = require('url');

const proxyRaw = process.env.RDEVTOOL_NETWORK_PROXY_URL || process.env.HTTP_PROXY || process.env.http_proxy || '';
let proxyUrl = null;
try {
  proxyUrl = proxyRaw ? new URL(proxyRaw) : null;
} catch (_) {
  proxyUrl = null;
}

if (proxyUrl && proxyUrl.protocol === 'http:') {
  const originalRequest = http.request;
  const originalGet = http.get;
  const noProxy = (process.env.RDEVTOOL_NETWORK_PROXY_NO_PROXY || process.env.NO_PROXY || process.env.no_proxy || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  function stripPort(hostname) {
    return String(hostname || '').replace(/^\[/, '').replace(/\]$/, '').replace(/:\d+$/, '').toLowerCase();
  }

  function shouldBypass(hostname) {
    const host = stripPort(hostname);
    if (!host) return false;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    return noProxy.some((rule) => {
      if (rule === '*') return true;
      const normalized = rule.replace(/^\./, '');
      return host === normalized || host.endsWith(`.${normalized}`);
    });
  }

  function optionsToUrl(options) {
    const protocol = options.protocol || 'http:';
    const host = options.hostname || options.host || 'localhost';
    const port = options.port && !String(host).includes(':') ? `:${options.port}` : '';
    const path = options.path || `${options.pathname || '/'}${options.search || ''}`;
    return new URL(path, `${protocol}//${host}${port}`);
  }

  function normalizeArgs(args) {
    const parts = Array.prototype.slice.call(args);
    const callback = typeof parts[parts.length - 1] === 'function' ? parts.pop() : undefined;
    let url;
    let options = {};

    if (typeof parts[0] === 'string' || parts[0] instanceof URL) {
      url = new URL(parts[0].toString());
      options = Object.assign({}, parts[1] || {});
    } else {
      options = Object.assign({}, parts[0] || {});
      url = optionsToUrl(options);
    }

    return { url, options, callback };
  }

  function applyProxyAuth(headers) {
    if (!proxyUrl.username && !proxyUrl.password) return headers;
    const username = decodeURIComponent(proxyUrl.username || '');
    const password = decodeURIComponent(proxyUrl.password || '');
    return Object.assign({}, headers, {
      'Proxy-Authorization': `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
    });
  }

  function requestWithProxy() {
    const normalized = normalizeArgs(arguments);
    if (normalized.url.protocol !== 'http:' || shouldBypass(normalized.url.hostname)) {
      return originalRequest.apply(http, arguments);
    }

    const headers = Object.assign({}, normalized.options.headers || {});
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'host') {
        delete headers[key];
      }
    }
    headers.Host = normalized.url.host;

    const proxyOptions = Object.assign({}, normalized.options, {
      protocol: 'http:',
      hostname: proxyUrl.hostname,
      host: proxyUrl.hostname,
      port: proxyUrl.port || 80,
      path: normalized.url.href,
      headers: applyProxyAuth(headers),
    });
    delete proxyOptions.href;
    delete proxyOptions.origin;

    return originalRequest.call(http, proxyOptions, normalized.callback);
  }

  http.request = requestWithProxy;
  http.get = function getWithProxy() {
    const req = requestWithProxy.apply(http, arguments);
    req.end();
    return req;
  };
}
"#;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeProfilesResponse {
    pub profiles: Vec<RuntimeProfileSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeProfileSummary {
    pub key: String,
    pub label: String,
    pub browser: Option<String>,
    pub browser_profile: Option<String>,
    pub browser_user_data_dir: Option<String>,
    pub web_actions_enabled: bool,
    pub web_actions_port: u16,
    pub web_actions_user_data_dir: Option<String>,
    pub browser_args: Vec<String>,
    pub proxy_url: String,
    pub rdev_proxy_profile_id: Option<String>,
    pub proxy_bypass: String,
    pub host_resolver_rules: Vec<String>,
    pub network_proxy: RuntimeNetworkProxySummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeNetworkProxySummary {
    pub enabled: bool,
    pub proxy_url: String,
    pub inject_env: bool,
    pub node_hook: bool,
    pub no_proxy: String,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProjectRuntimeLogKind {
    Dev,
    Build,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeLogResponse {
    pub path: String,
    pub lines: Vec<String>,
    pub truncated: bool,
    pub selection: String,
    pub requested_run_id: Option<String>,
    pub effective_run_id: Option<String>,
    pub ready_summary: ProjectRuntimeReadySummary,
    pub session_summary: ProjectRuntimeLogSessionSummary,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProjectRuntimeWaitUntil {
    ProcessStarted,
    ListenerReady,
    HttpVerified,
}

impl ProjectRuntimeWaitUntil {
    pub fn key(self) -> &'static str {
        match self {
            Self::ProcessStarted => "processStarted",
            Self::ListenerReady => "listenerReady",
            Self::HttpVerified => "httpVerified",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ProjectRuntimeWaitOptions {
    pub run_id: Option<String>,
    pub until: ProjectRuntimeWaitUntil,
    pub timeout_ms: Option<u64>,
    pub poll_interval_ms: u64,
    pub probe_url: Option<String>,
    pub probe_path: Option<String>,
    pub expected_statuses: Vec<u16>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeWaitRequestSummary {
    pub run_id: Option<String>,
    pub until: String,
    pub timeout_ms: Option<u64>,
    pub probe_url: Option<String>,
    pub probe_path: Option<String>,
    pub expected_statuses: Vec<u16>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeWaitEffectiveSummary {
    pub run_id: Option<String>,
    pub debug_profile_key: Option<String>,
    pub until: String,
    pub timeout_ms: u64,
    pub poll_interval_ms: u64,
    pub probe_url: Option<String>,
    pub expected_statuses: Vec<u16>,
    pub default_status_range: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeWaitObservedSummary {
    pub daemon_phase: Option<String>,
    pub process_started: bool,
    pub listener_ready: bool,
    pub http_verified: bool,
    pub expected_port: Option<u16>,
    pub http_status: Option<u16>,
    pub http_error: Option<String>,
    pub ready_detection: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeWaitResponse {
    pub schema_version: u16,
    pub project_key: String,
    pub requested: ProjectRuntimeWaitRequestSummary,
    pub effective: ProjectRuntimeWaitEffectiveSummary,
    pub observed: ProjectRuntimeWaitObservedSummary,
    pub status: OperationStatus,
    pub evidence: Vec<OperationEvidence>,
    pub risks: Vec<OperationRisk>,
    pub managed_artifacts: Vec<ManagedArtifact>,
    pub recommended_actions: Vec<RecommendedAction>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimePreflightResponse {
    pub project_key: String,
    pub project_name: String,
    pub debug_profile_key: Option<String>,
    pub debug_profile_label: Option<String>,
    pub runtime_profile_key: Option<String>,
    pub runtime_profile_label: Option<String>,
    pub status_key: String,
    pub status_label: String,
    pub summary: String,
    pub target: Option<ProjectRuntimeTargetSummary>,
    pub checks: Vec<ProjectRuntimePreflightCheck>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeTargetSummary {
    pub command: String,
    pub command_source: String,
    pub cwd: String,
    pub cwd_source: String,
    pub expected_port: Option<u16>,
    pub expected_port_source: Option<String>,
    pub focus_url: Option<String>,
    pub focus_url_source: Option<String>,
    pub ready_probe: Option<ProjectRuntimeReadyProbeSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeContextRequest {
    pub project_key: String,
    pub debug_profile_key: Option<String>,
    pub runtime_profile_key: Option<String>,
    pub command: Option<String>,
    pub expected_port: Option<u16>,
    pub env_keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeContextEffective {
    pub debug_profile_key: Option<String>,
    pub debug_profile_label: Option<String>,
    pub runtime_profile_key: Option<String>,
    pub runtime_profile_label: Option<String>,
    pub target: Option<ProjectRuntimeTargetSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeSessionObservation {
    pub run_id: Option<String>,
    pub phase: String,
    pub running: bool,
    pub managed: bool,
    pub adopted: bool,
    pub cwd: String,
    pub expected_port: Option<u16>,
    pub ready_url: Option<String>,
    pub ready_probe: Option<ProjectRuntimeReadyProbeSummary>,
    pub daemon_pid: Option<u32>,
    pub worker_pid: Option<u32>,
    pub started_at_ms: Option<u64>,
    pub log_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeContextObserved {
    pub available: bool,
    pub sessions: Vec<ProjectRuntimeSessionObservation>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeContextSnapshot {
    pub schema_version: u16,
    pub requested: ProjectRuntimeContextRequest,
    pub effective: ProjectRuntimeContextEffective,
    pub observed: ProjectRuntimeContextObserved,
    pub status: OperationStatus,
    pub evidence: Vec<OperationEvidence>,
    pub risks: Vec<OperationRisk>,
    pub managed_artifacts: Vec<ManagedArtifact>,
    pub recommended_actions: Vec<RecommendedAction>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimePreflightCheck {
    pub key: String,
    pub title: String,
    pub category: String,
    pub status_key: String,
    pub status_label: String,
    pub detail: String,
    pub action: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeInspectResponse {
    pub project_key: String,
    pub project_name: String,
    pub repo_path: Option<String>,
    pub debug_profile_key: Option<String>,
    pub debug_profile_label: Option<String>,
    pub runtime_profile_key: Option<String>,
    pub runtime_profile_label: Option<String>,
    pub status_key: String,
    pub status_label: String,
    pub summary: String,
    pub target: Option<ProjectRuntimeTargetSummary>,
    pub environment: ProjectRuntimeEnvironmentInspect,
    pub env_preview: Vec<ProjectRuntimeEnvPreview>,
    pub local_files: Vec<ProjectRuntimeLocalFileInspect>,
    pub proxies: Vec<ProjectRuntimeProxyInspect>,
    pub checks: Vec<ProjectRuntimePreflightCheck>,
    pub handoff: ProjectRuntimeHandoff,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeEnvironmentInspect {
    pub status_key: String,
    pub cwd: Option<String>,
    pub package_json: Option<ProjectRuntimePackageInspect>,
    pub node_version: Option<ProjectRuntimeNodeVersionInspect>,
    pub dev: ProjectRuntimeDevEnvironmentInspect,
    pub port: ProjectRuntimePortInspect,
    pub vite_config: Option<ProjectRuntimeViteConfigInspect>,
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimePackageInspect {
    pub path: String,
    pub name: Option<String>,
    pub package_manager: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeNodeVersionInspect {
    pub value: String,
    pub source: String,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeDevEnvironmentInspect {
    pub configured_command: Option<String>,
    pub script_name: Option<String>,
    pub script_command: Option<String>,
    pub package_manager: Option<String>,
    pub vite: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimePortInspect {
    pub effective_port: Option<u16>,
    pub source: Option<String>,
    pub confidence: String,
    pub suggested_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeViteConfigInspect {
    pub path: String,
    pub evaluated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeEnvPreview {
    pub key: String,
    pub value: String,
    pub source: String,
    pub masked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeLocalFileInspect {
    pub path: String,
    pub absolute_path: Option<String>,
    pub mode: String,
    pub enabled: bool,
    pub git_tracked: Option<bool>,
    pub git_ignored: Option<bool>,
    pub status_key: String,
    pub status_label: String,
    pub detail: String,
    pub action: Option<String>,
    pub content_preview: String,
    pub content_truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeProxyInspect {
    pub key: String,
    pub kind: String,
    pub label: String,
    pub enabled: bool,
    pub url: Option<String>,
    pub profile_id: Option<String>,
    pub listening: Option<bool>,
    pub status_key: String,
    pub status_label: String,
    pub detail: String,
    pub action: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeHandoff {
    pub project_path: Option<String>,
    pub workspace_sensitive: bool,
    pub debug_profile: Option<String>,
    pub runtime_profile: Option<String>,
    pub local_files: Vec<String>,
    pub proxy_urls: Vec<String>,
    pub verify_urls: Vec<String>,
    pub risks: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeLogSessionSummary {
    pub active: bool,
    pub run_id: Option<String>,
    pub project_key: Option<String>,
    pub kind: Option<String>,
    pub started_at_ms: Option<u64>,
    pub cwd: Option<String>,
    pub command: Option<String>,
    pub pid: Option<u32>,
    pub current_line_count: usize,
    pub total_line_count: usize,
}

impl ProjectRuntimeLogSessionSummary {
    pub fn empty(total_line_count: usize) -> Self {
        Self {
            active: false,
            run_id: None,
            project_key: None,
            kind: None,
            started_at_ms: None,
            cwd: None,
            command: None,
            pid: None,
            current_line_count: 0,
            total_line_count,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeReadySummary {
    pub enabled: bool,
    pub ready: bool,
    pub failed: bool,
    pub status_key: String,
    pub status_label: String,
    pub detail: Option<String>,
    pub url: Option<String>,
    pub local_url: Option<String>,
    pub network_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeStartResponse {
    pub project_key: String,
    pub project_name: String,
    pub debug_profile_key: Option<String>,
    pub runtime_profile_key: Option<String>,
    pub command: String,
    pub cwd: String,
    pub focus_url: Option<String>,
    pub ready_probe: Option<ProjectRuntimeReadyProbeSummary>,
    pub pid: Option<u32>,
    pub started_at_ms: u64,
    pub log_path: String,
    pub detached: bool,
    pub running: bool,
    pub run_id: String,
    pub started_new: bool,
    pub exit_code: Option<i32>,
    pub status_key: String,
    pub status_label: String,
    pub detail: String,
    pub env_keys: Vec<String>,
    pub local_files_applied: usize,
    pub network_proxy_enabled: bool,
    pub node_hook_enabled: bool,
}

#[derive(Debug, Clone, Default)]
pub struct ProjectRuntimeLaunchOptions {
    pub debug_profile: Option<String>,
    pub runtime_profile: Option<String>,
    pub command: Option<String>,
    pub expected_port: Option<u16>,
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeReadyProbeSummary {
    pub url: Option<String>,
    pub path: Option<String>,
    pub expected_statuses: Vec<u16>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeExternalDetection {
    pub process: RuntimeProcessIdentity,
    pub expected_port: u16,
    pub ready_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeFocusResponse {
    pub project_key: String,
    pub project_name: String,
    pub debug_profile_key: Option<String>,
    pub runtime_profile_key: Option<String>,
    pub url: Option<String>,
    pub bundle_id: Option<String>,
    pub opened: bool,
    pub detail: String,
    pub ready_summary: ProjectRuntimeReadySummary,
    pub navigation: Option<NavigationOpenResult>,
}

#[derive(Clone)]
struct ResolvedProjectCommand {
    command: String,
    cwd: PathBuf,
    env: BTreeMap<String, String>,
}

struct RuntimeNetworkProxyApplied {
    enabled: bool,
    node_hook: bool,
}

impl ProjectRuntimeReadySummary {
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            ready: false,
            failed: false,
            status_key: "disabled".to_string(),
            status_label: "未启用".to_string(),
            detail: None,
            url: None,
            local_url: None,
            network_url: None,
        }
    }

    pub fn pending() -> Self {
        Self {
            enabled: true,
            ready: false,
            failed: false,
            status_key: "pending".to_string(),
            status_label: "等待启动完成".to_string(),
            detail: None,
            url: None,
            local_url: None,
            network_url: None,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RuntimeTaskKind {
    Dev,
    Build,
}

impl From<ProjectRuntimeLogKind> for RuntimeTaskKind {
    fn from(value: ProjectRuntimeLogKind) -> Self {
        match value {
            ProjectRuntimeLogKind::Dev => Self::Dev,
            ProjectRuntimeLogKind::Build => Self::Build,
        }
    }
}

pub fn runtime_profiles(config: &AppConfig) -> RuntimeProfilesResponse {
    RuntimeProfilesResponse {
        profiles: config
            .defaults
            .runtime_profiles
            .iter()
            .map(runtime_profile_summary)
            .collect(),
    }
}

pub fn runtime_profile_show(
    config: &AppConfig,
    key: &str,
) -> Result<RuntimeProfileSummary, String> {
    let normalized = key.trim();
    config
        .defaults
        .runtime_profiles
        .iter()
        .find(|profile| profile.key == normalized)
        .map(runtime_profile_summary)
        .ok_or_else(|| format!("runtime profile not found: {}", key))
}

pub fn project_runtime_context_snapshot(
    config: &AppConfig,
    project_key: &str,
    options: &ProjectRuntimeLaunchOptions,
) -> Result<ProjectRuntimeContextSnapshot, String> {
    let project = config
        .find_project(project_key)
        .map_err(|error| error.to_string())?;
    let requested_debug_profile_key = optional_owned(options.debug_profile.as_deref());
    let requested_runtime_profile_key = optional_owned(options.runtime_profile.as_deref());
    let requested = ProjectRuntimeContextRequest {
        project_key: project.key.clone(),
        debug_profile_key: requested_debug_profile_key.clone(),
        runtime_profile_key: requested_runtime_profile_key.clone(),
        command: optional_owned(options.command.as_deref()),
        expected_port: options.expected_port,
        env_keys: options.env.keys().cloned().collect(),
    };

    let mut risks = Vec::new();
    let debug_profile = match selected_debug_profile(project, options.debug_profile.as_deref()) {
        Ok(profile) => profile,
        Err(error) => {
            risks.push(OperationRisk {
                code: "debugProfileNotFound".to_string(),
                severity: "error".to_string(),
                detail: error,
            });
            None
        }
    };
    let runtime_profile = match resolve_runtime_profile(
        config,
        debug_profile.as_ref(),
        options.runtime_profile.as_deref(),
    ) {
        Ok(profile) => profile,
        Err(error) => {
            risks.push(OperationRisk {
                code: "runtimeProfileNotFound".to_string(),
                severity: "error".to_string(),
                detail: error,
            });
            None
        }
    };
    let target = if risks.is_empty() {
        match resolve_runtime_target_summary(project, debug_profile.as_ref(), options) {
            Ok(target) => Some(target),
            Err(error) => {
                risks.push(OperationRisk {
                    code: "runtimeTargetInvalid".to_string(),
                    severity: "error".to_string(),
                    detail: error,
                });
                None
            }
        }
    } else {
        None
    };
    let effective_runtime_profile_key = runtime_profile.as_ref().map(|profile| profile.key.clone());
    let effective = ProjectRuntimeContextEffective {
        debug_profile_key: debug_profile.as_ref().map(|profile| profile.key.clone()),
        debug_profile_label: debug_profile.as_ref().map(|profile| profile.label.clone()),
        runtime_profile_key: effective_runtime_profile_key,
        runtime_profile_label: runtime_profile
            .as_ref()
            .map(|profile| profile.label.clone()),
        target: target.clone(),
    };

    let target_cwd = target.as_ref().map(|target| {
        PathBuf::from(&target.cwd)
            .canonicalize()
            .unwrap_or_else(|_| PathBuf::from(&target.cwd))
            .display()
            .to_string()
    });
    let candidate_cwds = if target_cwd.is_none() {
        project_runtime_candidate_cwds(project)
            .unwrap_or_default()
            .into_iter()
            .map(|path| path.display().to_string())
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    let (observed_available, daemon_statuses) = match list_runtime_daemons() {
        Ok(statuses) => (
            true,
            statuses
                .into_iter()
                .filter(|status| status.project_key == project.key)
                .filter(|status| {
                    target_cwd
                        .as_deref()
                        .is_some_and(|cwd| status.canonical_cwd == cwd)
                        || (target_cwd.is_none()
                            && candidate_cwds
                                .iter()
                                .any(|cwd| cwd == &status.canonical_cwd))
                })
                .take(5)
                .collect::<Vec<_>>(),
        ),
        Err(error) => {
            risks.push(OperationRisk {
                code: "runtimeObservationFailed".to_string(),
                severity: "error".to_string(),
                detail: format!("读取 runtime daemon 状态失败: {error}"),
            });
            (false, Vec::new())
        }
    };
    let sessions = daemon_statuses
        .iter()
        .map(|status| {
            let state = status.state.as_ref();
            ProjectRuntimeSessionObservation {
                run_id: state.map(|state| state.run_id.clone()),
                phase: status.phase_key.clone(),
                running: status.running,
                managed: status.managed,
                adopted: state.is_some_and(|state| state.adopted),
                cwd: status.canonical_cwd.clone(),
                expected_port: state.and_then(|state| state.expected_port),
                ready_url: state.and_then(|state| state.ready_url.clone()),
                ready_probe: state.and_then(|state| {
                    state
                        .ready_probe
                        .as_ref()
                        .map(|probe| ProjectRuntimeReadyProbeSummary {
                            url: probe.url.clone(),
                            path: probe.path.clone(),
                            expected_statuses: probe.expected_statuses.clone(),
                            timeout_ms: probe.timeout_ms,
                        })
                }),
                daemon_pid: state.map(|state| state.daemon_pid),
                worker_pid: state.and_then(|state| state.worker_pid),
                started_at_ms: state.map(|state| state.started_at_ms),
                log_path: state.map(|state| state.log_path.clone()),
            }
        })
        .collect::<Vec<_>>();
    let running_sessions = sessions
        .iter()
        .filter(|session| session.running)
        .collect::<Vec<_>>();
    if running_sessions.iter().any(|session| !session.managed) {
        risks.push(OperationRisk {
            code: "unmanagedRuntime".to_string(),
            severity: "error".to_string(),
            detail: "目标目录存在未受 rDevTool 管理的运行进程，不能安全执行生命周期操作。"
                .to_string(),
        });
    }
    if running_sessions.len() > 1 {
        risks.push(OperationRisk {
            code: "ambiguousRuntimeSessions".to_string(),
            severity: "error".to_string(),
            detail: format!(
                "目标匹配到 {} 个活动运行会话，需要按 runId 收窄。",
                running_sessions.len()
            ),
        });
    }

    let has_error = risks.iter().any(|risk| risk.severity == "error");
    let (status_key, status_label, status_detail) = if has_error {
        (
            "blocked",
            "运行上下文有阻塞",
            risks
                .iter()
                .find(|risk| risk.severity == "error")
                .map(|risk| risk.detail.clone())
                .unwrap_or_else(|| "运行上下文无法安全使用".to_string()),
        )
    } else if let Some(session) = running_sessions.first() {
        (
            "running",
            "运行中",
            format!(
                "已观测到受管运行会话 {}，phase={}",
                session.run_id.as_deref().unwrap_or("<unknown>"),
                session.phase
            ),
        )
    } else {
        (
            "configured",
            "目标已解析",
            if sessions.is_empty() {
                "Runtime Target 已解析，当前未观测到运行会话。".to_string()
            } else {
                format!(
                    "Runtime Target 已解析，最近会话 phase={}。",
                    sessions[0].phase
                )
            },
        )
    };
    let status = operation_status(status_key, status_label, !has_error, status_detail);

    let mut evidence = Vec::new();
    if let Some(target) = target.as_ref() {
        evidence.push(OperationEvidence {
            kind: "configuration".to_string(),
            source: "runtimeTargetResolver".to_string(),
            detail: format!(
                "cwd={} commandSource={} expectedPort={}",
                target.cwd,
                target.command_source,
                target
                    .expected_port
                    .map(|port| port.to_string())
                    .unwrap_or_else(|| "<none>".to_string())
            ),
        });
    }
    evidence.extend(sessions.iter().map(|session| OperationEvidence {
        kind: "process".to_string(),
        source: "runtimeDaemon".to_string(),
        detail: format!(
            "runId={} phase={} running={} managed={} cwd={}",
            session.run_id.as_deref().unwrap_or("<unknown>"),
            session.phase,
            session.running,
            session.managed,
            session.cwd
        ),
    }));
    let managed_artifacts = daemon_statuses
        .iter()
        .flat_map(|daemon_status| {
            let mut artifacts = vec![ManagedArtifact {
                kind: "runtimeState".to_string(),
                path: daemon_status.state_path.clone(),
                ownership: "rdevtool".to_string(),
                lifecycle: "runtimeSession".to_string(),
            }];
            if let Some(log_path) = daemon_status
                .state
                .as_ref()
                .map(|state| state.log_path.clone())
            {
                artifacts.push(ManagedArtifact {
                    kind: "runtimeLog".to_string(),
                    path: log_path,
                    ownership: "rdevtool".to_string(),
                    lifecycle: "runtimeSession".to_string(),
                });
            }
            artifacts
        })
        .collect();
    let recommended_actions = runtime_context_recommended_actions(
        &project.key,
        debug_profile.as_ref().map(|profile| profile.key.as_str()),
        runtime_profile.as_ref().map(|profile| profile.key.as_str()),
        running_sessions
            .first()
            .and_then(|session| session.run_id.as_deref()),
        target.as_ref(),
    );

    Ok(ProjectRuntimeContextSnapshot {
        schema_version: 1,
        requested,
        effective,
        observed: ProjectRuntimeContextObserved {
            available: observed_available,
            sessions,
        },
        status,
        evidence,
        risks,
        managed_artifacts,
        recommended_actions,
    })
}

fn runtime_context_recommended_actions(
    project_key: &str,
    debug_profile_key: Option<&str>,
    runtime_profile_key: Option<&str>,
    run_id: Option<&str>,
    target: Option<&ProjectRuntimeTargetSummary>,
) -> Vec<RecommendedAction> {
    let profile_args = debug_profile_key
        .map(|key| format!(" --debug-profile {key}"))
        .unwrap_or_default()
        + &runtime_profile_key
            .map(|key| format!(" --runtime-profile {key}"))
            .unwrap_or_default();
    if let Some(run_id) = run_id {
        let mut actions = vec![RecommendedAction {
            command: format!(
                "rdevtool --json runtime status --project {project_key} --run-id {run_id}"
            ),
            reason: "复核当前会话的 daemon 与进程状态".to_string(),
            risk: "readOnly".to_string(),
        }];
        if target.is_some_and(|target| {
            target.expected_port.is_some()
                || target.focus_url.is_some()
                || target.ready_probe.is_some()
        }) {
            actions.push(RecommendedAction {
                command: format!(
                    "rdevtool --json runtime wait --project {project_key} --run-id {run_id} --until http-verified"
                ),
                reason: "验证当前运行会话的页面或 HTTP 服务可访问".to_string(),
                risk: "readOnly".to_string(),
            });
        }
        return actions;
    }
    vec![RecommendedAction {
        command: format!("rdevtool --json runtime preflight --project {project_key}{profile_args}"),
        reason: "在启动前执行目标目录、命令、端口和代理检查".to_string(),
        risk: "readOnly".to_string(),
    }]
}

pub fn project_runtime_preflight(
    config: &AppConfig,
    project_key: &str,
    debug_profile_key: Option<&str>,
) -> Result<ProjectRuntimePreflightResponse, String> {
    let options = ProjectRuntimeLaunchOptions {
        debug_profile: optional_owned(debug_profile_key),
        ..ProjectRuntimeLaunchOptions::default()
    };
    project_runtime_preflight_with_options(config, project_key, &options)
}

pub fn project_runtime_preflight_with_options(
    config: &AppConfig,
    project_key: &str,
    options: &ProjectRuntimeLaunchOptions,
) -> Result<ProjectRuntimePreflightResponse, String> {
    let project = config
        .find_project(project_key)
        .map_err(|error| error.to_string())?;
    Ok(project_runtime_preflight_for_project_with_options(
        config, project, options,
    ))
}

pub fn project_runtime_preflight_for_project(
    config: &AppConfig,
    project: &ProjectConfig,
    debug_profile_key: Option<&str>,
) -> ProjectRuntimePreflightResponse {
    let options = ProjectRuntimeLaunchOptions {
        debug_profile: optional_owned(debug_profile_key),
        ..ProjectRuntimeLaunchOptions::default()
    };
    project_runtime_preflight_for_project_with_options(config, project, &options)
}

pub fn project_runtime_preflight_for_project_with_options(
    config: &AppConfig,
    project: &ProjectConfig,
    options: &ProjectRuntimeLaunchOptions,
) -> ProjectRuntimePreflightResponse {
    let requested_debug_profile_key = optional_trimmed(options.debug_profile.as_deref());
    let debug_profile = requested_debug_profile_key.and_then(|key| {
        project
            .debug_profiles
            .iter()
            .find(|profile| profile.key == key)
            .cloned()
    });
    let runtime_profile_key = optional_trimmed(options.runtime_profile.as_deref())
        .or_else(|| {
            debug_profile
                .as_ref()
                .and_then(|profile| optional_trimmed(profile.runtime_profile.as_deref()))
        })
        .map(ToString::to_string);
    let runtime_profile = runtime_profile_key.as_ref().and_then(|key| {
        config
            .defaults
            .runtime_profiles
            .iter()
            .find(|profile| profile.key == *key)
    });
    let mut checks = Vec::new();

    if let Some(key) = requested_debug_profile_key {
        if let Some(profile) = debug_profile.as_ref() {
            checks.push(preflight_check(
                "debugProfile",
                "调试档案",
                "context",
                "ok",
                format!("使用 {} ({})", profile.label, profile.key),
                None,
            ));
        } else {
            checks.push(preflight_check(
                "debugProfile",
                "调试档案",
                "context",
                "error",
                format!("调试档案不存在: {}", key),
                Some("重新选择一个可用调试档案，或在运行配置里创建。"),
            ));
        }
    } else {
        checks.push(preflight_check(
            "debugProfile",
            "调试档案",
            "context",
            "info",
            "使用项目默认启动配置",
            Some("需要 Node 版本、代理或受控浏览器时，建议选择调试档案。"),
        ));
    }

    preflight_command_checks(project, debug_profile.as_ref(), options, &mut checks);
    preflight_local_file_checks(project, debug_profile.as_ref(), &mut checks);
    preflight_proxy_checks(debug_profile.as_ref(), runtime_profile, &mut checks);
    preflight_runtime_profile_checks(runtime_profile_key.as_deref(), runtime_profile, &mut checks);
    preflight_expected_port_check(project, debug_profile.as_ref(), options, &mut checks);
    preflight_focus_checks(project, debug_profile.as_ref(), &mut checks);

    let (status_key, status_label, summary) = summarize_preflight(&checks);
    let target = resolve_runtime_target_summary(project, debug_profile.as_ref(), options).ok();
    ProjectRuntimePreflightResponse {
        project_key: project.key.clone(),
        project_name: project.name.clone(),
        debug_profile_key: debug_profile.as_ref().map(|profile| profile.key.clone()),
        debug_profile_label: debug_profile.as_ref().map(|profile| profile.label.clone()),
        runtime_profile_key,
        runtime_profile_label: runtime_profile.map(|profile| profile.label.clone()),
        status_key,
        status_label,
        summary,
        target,
        checks,
    }
}

pub fn inspect_project_runtime(
    config: &AppConfig,
    proxy_config: &ProxyConfig,
    project_key: &str,
    debug_profile_key: Option<&str>,
) -> Result<ProjectRuntimeInspectResponse, String> {
    let options = ProjectRuntimeLaunchOptions {
        debug_profile: optional_owned(debug_profile_key),
        ..ProjectRuntimeLaunchOptions::default()
    };
    inspect_project_runtime_with_options(config, proxy_config, project_key, &options)
}

pub fn inspect_project_runtime_with_options(
    config: &AppConfig,
    proxy_config: &ProxyConfig,
    project_key: &str,
    options: &ProjectRuntimeLaunchOptions,
) -> Result<ProjectRuntimeInspectResponse, String> {
    let project = config
        .find_project(project_key)
        .map_err(|error| error.to_string())?;
    let debug_profile = selected_debug_profile(project, options.debug_profile.as_deref())?;
    let runtime_profile = resolve_runtime_profile(
        config,
        debug_profile.as_ref(),
        options.runtime_profile.as_deref(),
    )?;
    let environment = inspect_project_environment(project, debug_profile.as_ref(), options);
    let target = resolve_runtime_target_summary(project, debug_profile.as_ref(), options).ok();
    let mut checks =
        project_runtime_preflight_for_project_with_options(config, project, options).checks;
    let mut env_preview =
        inspect_runtime_env(project, debug_profile.as_ref(), runtime_profile.as_ref());
    apply_env_preview_overrides(&mut env_preview, &options.env, "launch override");
    let local_files = inspect_runtime_local_files(project, debug_profile.as_ref());
    let proxies = inspect_runtime_proxies(
        debug_profile.as_ref(),
        runtime_profile.as_ref(),
        proxy_config,
    );
    checks.extend(local_files.iter().map(local_file_inspect_check));
    checks.extend(proxies.iter().map(proxy_inspect_check));
    if debug_profile
        .as_ref()
        .is_some_and(|profile| profile.local_proxy.enabled)
    {
        checks.push(preflight_check(
            "debugLocalProxy.daemon",
            "本地 API 代理",
            "proxy",
            "ok",
            "debug profile localProxy 将由共享 runtime daemon 启动并监督",
            None,
        ));
    }
    let (status_key, status_label, summary) = summarize_preflight(&checks);
    let handoff = build_runtime_handoff(
        project,
        debug_profile.as_ref(),
        runtime_profile.as_ref(),
        &local_files,
        &proxies,
        &checks,
    );

    Ok(ProjectRuntimeInspectResponse {
        project_key: project.key.clone(),
        project_name: project.name.clone(),
        repo_path: project
            .repo_path
            .as_ref()
            .map(|path| path.display().to_string()),
        debug_profile_key: debug_profile.as_ref().map(|profile| profile.key.clone()),
        debug_profile_label: debug_profile.as_ref().map(|profile| profile.label.clone()),
        runtime_profile_key: runtime_profile.as_ref().map(|profile| profile.key.clone()),
        runtime_profile_label: runtime_profile
            .as_ref()
            .map(|profile| profile.label.clone()),
        status_key,
        status_label,
        summary,
        target,
        environment,
        env_preview,
        local_files,
        proxies,
        checks,
        handoff,
    })
}

pub fn start_project_runtime_detached(
    config: &AppConfig,
    project_key: &str,
    debug_profile_key: Option<&str>,
    env_overrides: &BTreeMap<String, String>,
) -> Result<ProjectRuntimeStartResponse, String> {
    let options = ProjectRuntimeLaunchOptions {
        debug_profile: optional_owned(debug_profile_key),
        env: env_overrides.clone(),
        ..ProjectRuntimeLaunchOptions::default()
    };
    start_project_runtime_detached_with_options(config, project_key, &options)
}

pub fn start_project_runtime_detached_with_options(
    config: &AppConfig,
    project_key: &str,
    options: &ProjectRuntimeLaunchOptions,
) -> Result<ProjectRuntimeStartResponse, String> {
    let project = config
        .find_project(project_key)
        .map_err(|error| error.to_string())?;
    let debug_profile = selected_debug_profile(project, options.debug_profile.as_deref())?;
    let runtime_profile = resolve_runtime_profile(
        config,
        debug_profile.as_ref(),
        options.runtime_profile.as_deref(),
    )?;
    let mut resolved = resolve_runtime_command(project, debug_profile.as_ref(), options)?;
    let proxy_applied = apply_network_proxy_env(
        &mut resolved,
        debug_profile.as_ref(),
        runtime_profile.as_ref(),
    )?;
    let expected_port = resolve_expected_port(project, debug_profile.as_ref(), options, &resolved);
    let focus_url = effective_project_focus_url(project, debug_profile.as_ref());
    let ready_probe = runtime_ready_probe_summary(
        debug_profile
            .as_ref()
            .and_then(|profile| profile.ready_probe.as_ref()),
    );
    let (vite_command, vite_strict_port) =
        resolved_vite_command_info(&resolved.command, &resolved.cwd);
    resolved.command = apply_vite_strict_port(
        &resolved.command,
        expected_port,
        vite_command,
        vite_strict_port,
    );
    ensure_runtime_expected_port_available(expected_port)?;
    let local_files_applied = debug_profile
        .as_ref()
        .map(|profile| apply_debug_profile_local_files(project, profile))
        .transpose()?
        .unwrap_or(0);

    let log_path = task_log_path(project, RuntimeTaskKind::Dev);
    let mut env_keys = resolved.env.keys().cloned().collect::<Vec<_>>();
    env_keys.sort();
    let daemon_result = start_runtime_daemon(RuntimeDaemonStartRequest {
        project_key: project.key.clone(),
        project_name: project.name.clone(),
        cwd: resolved.cwd.clone(),
        command: resolved.command.clone(),
        env: resolved.env,
        debug_profile: debug_profile.as_ref().map(|profile| profile.key.clone()),
        runtime_profile: runtime_profile.as_ref().map(|profile| profile.key.clone()),
        expected_port,
        ready: RuntimeDaemonReadyConfig {
            enabled: project.focus.ready.enabled,
            url_patterns: project.focus.ready.url_patterns.clone(),
            success_markers: project.focus.ready.success_markers.clone(),
            fallback_url: focus_url.clone(),
        },
        ready_probe: ready_probe
            .as_ref()
            .map(|probe| RuntimeDaemonHttpReadyConfig {
                url: probe.url.clone(),
                path: probe.path.clone(),
                expected_statuses: probe.expected_statuses.clone(),
                timeout_ms: probe.timeout_ms,
            }),
        log_path: log_path.clone(),
        local_proxy: debug_profile
            .as_ref()
            .and_then(|profile| local_proxy_spec(&project.key, profile)),
    })
    .map_err(|error| error.to_string())?;
    let daemon_status = daemon_result.status;
    let state = daemon_status
        .state
        .ok_or_else(|| "runtime daemon started without persisted state".to_string())?;
    let (status_key, status_label) = match state.phase {
        RuntimeDaemonPhase::Starting => ("starting", "启动中"),
        RuntimeDaemonPhase::Running => ("running", "运行中"),
        RuntimeDaemonPhase::Stopping => ("stopping", "停止中"),
        RuntimeDaemonPhase::Exited => ("exited", "已退出"),
        RuntimeDaemonPhase::Failed => ("failed", "启动失败"),
    };
    let detail = state
        .exit
        .as_ref()
        .map(|exit| exit.reason.clone())
        .unwrap_or_else(|| "dev 服务已由共享 runtime daemon 托管".to_string());

    Ok(ProjectRuntimeStartResponse {
        project_key: state.project_key,
        project_name: state.project_name,
        debug_profile_key: state.debug_profile,
        runtime_profile_key: state.runtime_profile,
        command: state.command,
        cwd: state.canonical_cwd,
        focus_url,
        ready_probe,
        pid: daemon_status.running.then_some(state.worker_pid).flatten(),
        started_at_ms: state.started_at_ms,
        log_path: state.log_path,
        detached: true,
        running: daemon_status.running,
        run_id: state.run_id,
        started_new: daemon_result.started_new,
        exit_code: state.exit.as_ref().and_then(|exit| exit.code),
        status_key: status_key.to_string(),
        status_label: status_label.to_string(),
        detail,
        env_keys,
        local_files_applied,
        network_proxy_enabled: proxy_applied.enabled,
        node_hook_enabled: proxy_applied.node_hook,
    })
}

pub fn detect_external_project_runtime_with_options(
    config: &AppConfig,
    project_key: &str,
    options: &ProjectRuntimeLaunchOptions,
) -> Result<Option<ProjectRuntimeExternalDetection>, String> {
    let project = config
        .find_project(project_key)
        .map_err(|error| error.to_string())?;
    detect_external_project_runtime_for_project_with_options(project, options)
}

pub fn detect_external_project_runtime_for_project_with_options(
    project: &ProjectConfig,
    options: &ProjectRuntimeLaunchOptions,
) -> Result<Option<ProjectRuntimeExternalDetection>, String> {
    let resolved = resolve_runtime_adoption_context_for_project(project, options)?;
    let Some(expected_port) = resolved.expected_port else {
        return Ok(None);
    };
    let Some(process) = listening_process(expected_port).map_err(|error| error.to_string())? else {
        return Ok(None);
    };
    let canonical_cwd = resolved
        .cwd
        .canonicalize()
        .map_err(|error| format!("解析项目运行目录失败: {error}"))?;
    if Path::new(&process.canonical_cwd) != canonical_cwd {
        return Ok(None);
    }
    Ok(Some(ProjectRuntimeExternalDetection {
        process,
        expected_port,
        ready_url: resolved.ready_url,
    }))
}

pub fn adopt_project_runtime_with_options(
    config: &AppConfig,
    project_key: &str,
    pid: u32,
    options: &ProjectRuntimeLaunchOptions,
) -> Result<RuntimeDaemonAdoptResponse, String> {
    let resolved = resolve_runtime_adoption_context(config, project_key, options)?;
    adopt_runtime_daemon(RuntimeDaemonAdoptRequest {
        project_key: resolved.project_key,
        project_name: resolved.project_name,
        cwd: resolved.cwd,
        pid,
        expected_command: resolved.command,
        expected_port: resolved.expected_port,
        ready_url: resolved.ready_url,
        log_path: resolved.log_path,
    })
    .map_err(|error| error.to_string())
}

struct ResolvedRuntimeAdoptionContext {
    project_key: String,
    project_name: String,
    cwd: PathBuf,
    command: String,
    expected_port: Option<u16>,
    ready_url: Option<String>,
    log_path: PathBuf,
}

fn resolve_runtime_adoption_context(
    config: &AppConfig,
    project_key: &str,
    options: &ProjectRuntimeLaunchOptions,
) -> Result<ResolvedRuntimeAdoptionContext, String> {
    let project = config
        .find_project(project_key)
        .map_err(|error| error.to_string())?;
    resolve_runtime_adoption_context_for_project(project, options)
}

fn resolve_runtime_adoption_context_for_project(
    project: &ProjectConfig,
    options: &ProjectRuntimeLaunchOptions,
) -> Result<ResolvedRuntimeAdoptionContext, String> {
    let debug_profile = selected_debug_profile(project, options.debug_profile.as_deref())?;
    let mut resolved = resolve_runtime_command(project, debug_profile.as_ref(), options)?;
    let expected_port = resolve_expected_port(project, debug_profile.as_ref(), options, &resolved);
    let (vite_command, vite_strict_port) =
        resolved_vite_command_info(&resolved.command, &resolved.cwd);
    resolved.command = apply_vite_strict_port(
        &resolved.command,
        expected_port,
        vite_command,
        vite_strict_port,
    );
    Ok(ResolvedRuntimeAdoptionContext {
        project_key: project.key.clone(),
        project_name: project.name.clone(),
        cwd: resolved.cwd,
        command: resolved.command,
        expected_port,
        ready_url: effective_project_focus_url(project, debug_profile.as_ref()),
        log_path: task_log_path(project, RuntimeTaskKind::Dev),
    })
}

pub fn focus_project_runtime(
    config: &AppConfig,
    project_key: &str,
    debug_profile_key: Option<&str>,
    url_override: Option<&str>,
) -> Result<ProjectRuntimeFocusResponse, String> {
    focus_project_runtime_with_profile(config, project_key, debug_profile_key, None, url_override)
}

pub fn focus_project_runtime_with_profile(
    config: &AppConfig,
    project_key: &str,
    debug_profile_key: Option<&str>,
    runtime_profile_key: Option<&str>,
    url_override: Option<&str>,
) -> Result<ProjectRuntimeFocusResponse, String> {
    let project = config
        .find_project(project_key)
        .map_err(|error| error.to_string())?;
    let debug_profile = selected_debug_profile(project, debug_profile_key)?;
    let runtime_profile =
        resolve_runtime_profile(config, debug_profile.as_ref(), runtime_profile_key)?;
    let ready_summary =
        project_runtime_ready_summary_from_file(project, ProjectRuntimeLogKind::Dev)?;
    let url = url_override
        .and_then(|value| optional_trimmed(Some(value)))
        .map(ToString::to_string)
        .or_else(|| ready_summary.url.clone())
        .or_else(|| effective_project_focus_url(project, debug_profile.as_ref()));
    if let Some(url) = url.as_ref() {
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Err(format!(
                "focus URL must start with http:// or https://: {}",
                url
            ));
        }
        let (entry, runtime_profiles) = focus_navigation_entry(
            project,
            url,
            debug_profile.as_ref(),
            runtime_profile.as_ref(),
        );
        let navigation = open_navigation_entry_with_runtime_profiles(&entry, &runtime_profiles)
            .map_err(|error| error.to_string())?;
        return Ok(ProjectRuntimeFocusResponse {
            project_key: project.key.clone(),
            project_name: project.name.clone(),
            debug_profile_key: debug_profile.as_ref().map(|profile| profile.key.clone()),
            runtime_profile_key: runtime_profile.as_ref().map(|profile| profile.key.clone()),
            url: Some(url.clone()),
            bundle_id: None,
            opened: true,
            detail: navigation.detail.clone(),
            ready_summary,
            navigation: Some(navigation),
        });
    }

    if let Some(bundle_id) = project
        .focus
        .bundle_id
        .as_deref()
        .and_then(|value| optional_trimmed(Some(value)))
    {
        open_app_bundle(bundle_id)?;
        return Ok(ProjectRuntimeFocusResponse {
            project_key: project.key.clone(),
            project_name: project.name.clone(),
            debug_profile_key: debug_profile.as_ref().map(|profile| profile.key.clone()),
            runtime_profile_key: runtime_profile.as_ref().map(|profile| profile.key.clone()),
            url: None,
            bundle_id: Some(bundle_id.to_string()),
            opened: true,
            detail: format!("opened bundle {}", bundle_id),
            ready_summary,
            navigation: None,
        });
    }

    Err("当前项目未配置可聚焦的 URL 或 Bundle ID".to_string())
}

pub fn read_project_runtime_log(
    config: &AppConfig,
    project_key: &str,
    kind: ProjectRuntimeLogKind,
    max_lines: usize,
) -> Result<ProjectRuntimeLogResponse, String> {
    read_project_runtime_log_with_selection(config, project_key, kind, max_lines, false, None)
}

pub fn read_project_runtime_log_with_selection(
    config: &AppConfig,
    project_key: &str,
    kind: ProjectRuntimeLogKind,
    max_lines: usize,
    current_only: bool,
    run_id: Option<&str>,
) -> Result<ProjectRuntimeLogResponse, String> {
    let project = config
        .find_project(project_key)
        .map_err(|error| error.to_string())?;
    let task_kind = RuntimeTaskKind::from(kind);
    let path = project_task_log_path(project, kind);
    let normalized_limit = max_lines.clamp(20, 500);
    let requested_run_id = run_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let (lines, truncated, session_summary, selection) =
        if current_only || requested_run_id.is_some() {
            let (lines, truncated, session_summary) =
                tail_runtime_session_lines(&path, normalized_limit, requested_run_id.as_deref())?;
            let selection = if requested_run_id.is_some() {
                "runId"
            } else {
                "current"
            };
            (lines, truncated, session_summary, selection)
        } else {
            let (lines, truncated, session_summary) = tail_log_lines(&path, normalized_limit)?;
            (lines, truncated, session_summary, "tail")
        };
    let ready_summary = project_runtime_ready_summary(project, task_kind, &lines);
    Ok(ProjectRuntimeLogResponse {
        path: path.display().to_string(),
        lines,
        truncated,
        selection: selection.to_string(),
        requested_run_id,
        effective_run_id: session_summary.run_id.clone(),
        ready_summary,
        session_summary,
    })
}

pub fn wait_project_runtime(
    config: &AppConfig,
    project_key: &str,
    options: &ProjectRuntimeWaitOptions,
) -> Result<ProjectRuntimeWaitResponse, String> {
    let project = config
        .find_project(project_key)
        .map_err(|error| error.to_string())?;
    let requested_run_id = options
        .run_id
        .as_deref()
        .and_then(|value| optional_trimmed(Some(value)))
        .map(ToString::to_string);
    let initial_daemon = find_runtime_daemon(project_key, requested_run_id.as_deref())
        .map_err(|error| error.to_string())?;
    let debug_profile_key = initial_daemon
        .as_ref()
        .and_then(|daemon| daemon.state.as_ref())
        .and_then(|state| state.debug_profile.clone());
    let debug_profile = debug_profile_key.as_deref().and_then(|key| {
        project
            .debug_profiles
            .iter()
            .find(|profile| profile.key == key)
    });
    let persisted_ready_probe = initial_daemon
        .as_ref()
        .and_then(|daemon| daemon.state.as_ref())
        .and_then(|state| state.ready_probe.as_ref());
    let configured_ready_probe = debug_profile.and_then(|profile| profile.ready_probe.as_ref());
    let timeout_ms = options
        .timeout_ms
        .or_else(|| persisted_ready_probe.and_then(|probe| probe.timeout_ms))
        .or_else(|| configured_ready_probe.and_then(|probe| probe.timeout_ms))
        .unwrap_or(180_000)
        .clamp(100, 600_000);
    let poll_interval_ms = options.poll_interval_ms.clamp(50, 5_000);
    let effective_probe_base = optional_owned(options.probe_url.as_deref())
        .or_else(|| persisted_ready_probe.and_then(|probe| optional_owned(probe.url.as_deref())))
        .or_else(|| configured_ready_probe.and_then(|probe| optional_owned(probe.url.as_deref())));
    let effective_probe_path = optional_owned(options.probe_path.as_deref())
        .or_else(|| persisted_ready_probe.and_then(|probe| optional_owned(probe.path.as_deref())))
        .or_else(|| configured_ready_probe.and_then(|probe| optional_owned(probe.path.as_deref())));
    let effective_focus_url = effective_project_focus_url(project, debug_profile);
    let mut expected_statuses = if options.expected_statuses.is_empty() {
        persisted_ready_probe
            .map(|probe| probe.expected_statuses.clone())
            .or_else(|| configured_ready_probe.map(|probe| probe.expected_statuses.clone()))
            .unwrap_or_default()
    } else {
        options.expected_statuses.clone()
    };
    expected_statuses.sort_unstable();
    expected_statuses.dedup();
    if expected_statuses
        .iter()
        .any(|status| !(100..=599).contains(status))
    {
        return Err("HTTP expected status must be between 100 and 599".to_string());
    }
    if let Some(url) = effective_probe_base.as_deref() {
        resolve_runtime_probe_url(Some(url), effective_probe_path.as_deref(), None, None, None)?;
    }

    let requested = ProjectRuntimeWaitRequestSummary {
        run_id: requested_run_id.clone(),
        until: options.until.key().to_string(),
        timeout_ms: options.timeout_ms,
        probe_url: optional_owned(options.probe_url.as_deref()),
        probe_path: optional_owned(options.probe_path.as_deref()),
        expected_statuses: options.expected_statuses.clone(),
    };
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(poll_interval_ms.clamp(250, 2_000)))
        .redirect(reqwest::redirect::Policy::limited(5))
        .no_proxy()
        .build()
        .map_err(|error| format!("failed to create HTTP ready client: {error}"))?;
    let started = Instant::now();
    let mut effective_run_id = requested_run_id.clone();
    let mut effective_probe_url = effective_probe_base.clone();
    let mut observed = ProjectRuntimeWaitObservedSummary {
        daemon_phase: None,
        process_started: false,
        listener_ready: false,
        http_verified: false,
        expected_port: None,
        http_status: None,
        http_error: None,
        ready_detection: Vec::new(),
    };

    let status = loop {
        let daemon = find_runtime_daemon(project_key, effective_run_id.as_deref())
            .map_err(|error| error.to_string())?;
        if let Some(state) = daemon.as_ref().and_then(|daemon| daemon.state.as_ref()) {
            observed.daemon_phase = Some(runtime_daemon_phase_key(&state.phase).to_string());
            observed.expected_port = state.expected_port;
            if effective_run_id.is_none() {
                effective_run_id = Some(state.run_id.clone());
            }
            if effective_run_id.as_deref() != Some(state.run_id.as_str()) {
                break operation_status(
                    "runReplaced",
                    "运行已被替换",
                    false,
                    format!(
                        "等待会话 {}，当前会话为 {}",
                        effective_run_id.as_deref().unwrap_or("<none>"),
                        state.run_id
                    ),
                );
            }

            observed.process_started = matches!(
                state.phase,
                RuntimeDaemonPhase::Starting | RuntimeDaemonPhase::Running
            ) && (state.worker_pid.is_some() || state.adopted);
            observed.listener_ready = state
                .expected_port
                .is_some_and(|port| tcp_port_listening("127.0.0.1", port));
            effective_probe_url = resolve_runtime_probe_url(
                effective_probe_base.as_deref(),
                effective_probe_path.as_deref(),
                state.ready_url.as_deref(),
                effective_focus_url.as_deref(),
                state.expected_port,
            )?;

            if options.until == ProjectRuntimeWaitUntil::HttpVerified
                && let Some(url) = effective_probe_url.as_deref()
            {
                let probe = probe_runtime_http(&client, url, &expected_statuses);
                observed.http_status = probe.status;
                observed.http_error = probe.error;
                observed.http_verified = probe.verified;
            }

            let target_reached = match options.until {
                ProjectRuntimeWaitUntil::ProcessStarted => observed.process_started,
                ProjectRuntimeWaitUntil::ListenerReady => observed.listener_ready,
                ProjectRuntimeWaitUntil::HttpVerified => observed.http_verified,
            };
            if target_reached {
                break operation_status(
                    options.until.key(),
                    runtime_wait_success_label(options.until),
                    true,
                    format!("运行会话 {} 已达到目标状态", state.run_id),
                );
            }
            if matches!(
                state.phase,
                RuntimeDaemonPhase::Exited | RuntimeDaemonPhase::Failed
            ) {
                break operation_status(
                    "runtimeTerminated",
                    "运行已终止",
                    false,
                    state
                        .exit
                        .as_ref()
                        .map(|exit| exit.reason.clone())
                        .unwrap_or_else(|| format!("daemon phase is {:?}", state.phase)),
                );
            }
            if observed.process_started
                && options.until == ProjectRuntimeWaitUntil::ListenerReady
                && state.expected_port.is_none()
            {
                break operation_status(
                    "listenerProbeUnconfigured",
                    "未配置监听端口",
                    false,
                    "当前运行没有 expectedPort，无法验证 listenerReady".to_string(),
                );
            }
            if observed.process_started
                && options.until == ProjectRuntimeWaitUntil::HttpVerified
                && effective_probe_url.is_none()
            {
                break operation_status(
                    "httpProbeUnconfigured",
                    "未配置 HTTP 探测地址",
                    false,
                    "请提供 --probe-url，或配置 ready/focus URL 或 expectedPort".to_string(),
                );
            }
        }

        if started.elapsed() >= Duration::from_millis(timeout_ms) {
            break operation_status(
                "timeout",
                "等待超时",
                false,
                format!("{} ms 内未达到 {}", timeout_ms, options.until.key()),
            );
        }
        thread::sleep(Duration::from_millis(poll_interval_ms));
    };

    if observed.process_started {
        observed.ready_detection.push("process".to_string());
    }
    if observed.listener_ready {
        observed.ready_detection.push("tcpListener".to_string());
    }
    if observed.http_verified {
        observed.ready_detection.push("httpProbe".to_string());
    }
    let evidence = runtime_wait_evidence(
        effective_run_id.as_deref(),
        effective_probe_url.as_deref(),
        &observed,
    );
    let risks = runtime_wait_risks(&status, &observed);
    let recommended_actions = if status.success {
        Vec::new()
    } else {
        vec![
            RecommendedAction {
                command: format!("rdevtool --json runtime log --project {project_key} --current"),
                reason: "检查同一运行会话的启动输出".to_string(),
                risk: "readOnly".to_string(),
            },
            RecommendedAction {
                command: format!("rdevtool --json runtime diagnose --project {project_key}"),
                reason: "检查守护进程、进程组和监听端口状态".to_string(),
                risk: "readOnly".to_string(),
            },
        ]
    };

    Ok(ProjectRuntimeWaitResponse {
        schema_version: 2,
        project_key: project.key.clone(),
        requested,
        effective: ProjectRuntimeWaitEffectiveSummary {
            run_id: effective_run_id,
            debug_profile_key,
            until: options.until.key().to_string(),
            timeout_ms,
            poll_interval_ms,
            probe_url: effective_probe_url,
            expected_statuses: expected_statuses.clone(),
            default_status_range: expected_statuses.is_empty().then(|| "200-399".to_string()),
        },
        observed,
        status,
        evidence,
        risks,
        managed_artifacts: Vec::new(),
        recommended_actions,
    })
}

fn resolve_runtime_probe_url(
    requested_url: Option<&str>,
    requested_path: Option<&str>,
    ready_url: Option<&str>,
    focus_url: Option<&str>,
    expected_port: Option<u16>,
) -> Result<Option<String>, String> {
    let base = requested_url
        .and_then(|value| optional_trimmed(Some(value)))
        .or_else(|| ready_url.and_then(|value| optional_trimmed(Some(value))))
        .or_else(|| focus_url.and_then(|value| optional_trimmed(Some(value))))
        .map(ToString::to_string)
        .or_else(|| expected_port.map(|port| format!("http://127.0.0.1:{port}/")));
    let Some(base) = base else {
        return Ok(None);
    };
    let mut url = reqwest::Url::parse(&base)
        .map_err(|error| format!("invalid HTTP ready probe URL {base}: {error}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(format!(
            "HTTP ready probe URL must use http or https: {base}"
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(
            "HTTP ready probe URL must not contain credentials; use a non-secret readiness endpoint"
                .to_string(),
        );
    }
    if let Some(path) = requested_path.and_then(|value| optional_trimmed(Some(value))) {
        if path.starts_with('/') {
            url.set_path(path);
            url.set_query(None);
            url.set_fragment(None);
        } else {
            url = url
                .join(path)
                .map_err(|error| format!("invalid HTTP ready probe path {path}: {error}"))?;
        }
    }
    Ok(Some(url.to_string()))
}

struct RuntimeHttpProbeObservation {
    verified: bool,
    status: Option<u16>,
    error: Option<String>,
}

fn probe_runtime_http(
    client: &reqwest::blocking::Client,
    url: &str,
    expected_statuses: &[u16],
) -> RuntimeHttpProbeObservation {
    match client.get(url).send() {
        Ok(response) => {
            let status = response.status().as_u16();
            RuntimeHttpProbeObservation {
                verified: runtime_http_status_matches(status, expected_statuses),
                status: Some(status),
                error: None,
            }
        }
        Err(error) => RuntimeHttpProbeObservation {
            verified: false,
            status: None,
            error: Some(error.to_string()),
        },
    }
}

fn runtime_http_status_matches(status: u16, expected_statuses: &[u16]) -> bool {
    if expected_statuses.is_empty() {
        (200..=399).contains(&status)
    } else {
        expected_statuses.contains(&status)
    }
}

fn runtime_daemon_phase_key(phase: &RuntimeDaemonPhase) -> &'static str {
    match phase {
        RuntimeDaemonPhase::Starting => "starting",
        RuntimeDaemonPhase::Running => "running",
        RuntimeDaemonPhase::Stopping => "stopping",
        RuntimeDaemonPhase::Exited => "exited",
        RuntimeDaemonPhase::Failed => "failed",
    }
}

fn runtime_wait_success_label(until: ProjectRuntimeWaitUntil) -> &'static str {
    match until {
        ProjectRuntimeWaitUntil::ProcessStarted => "进程已启动",
        ProjectRuntimeWaitUntil::ListenerReady => "端口已监听",
        ProjectRuntimeWaitUntil::HttpVerified => "HTTP 已验证",
    }
}

fn operation_status(key: &str, label: &str, success: bool, detail: String) -> OperationStatus {
    OperationStatus {
        key: key.to_string(),
        label: label.to_string(),
        success,
        terminal: true,
        detail,
    }
}

fn runtime_wait_evidence(
    run_id: Option<&str>,
    probe_url: Option<&str>,
    observed: &ProjectRuntimeWaitObservedSummary,
) -> Vec<OperationEvidence> {
    let mut evidence = Vec::new();
    if let Some(phase) = observed.daemon_phase.as_deref() {
        evidence.push(OperationEvidence {
            kind: "process".to_string(),
            source: "runtimeDaemon".to_string(),
            detail: format!(
                "runId={} phase={} processStarted={}",
                run_id.unwrap_or("<none>"),
                phase,
                observed.process_started
            ),
        });
    }
    if let Some(port) = observed.expected_port {
        evidence.push(OperationEvidence {
            kind: "listener".to_string(),
            source: "tcpConnect".to_string(),
            detail: format!("127.0.0.1:{port} listening={}", observed.listener_ready),
        });
    }
    if let Some(url) = probe_url {
        evidence.push(OperationEvidence {
            kind: "http".to_string(),
            source: "httpProbe".to_string(),
            detail: match (observed.http_status, observed.http_error.as_deref()) {
                (Some(status), _) => format!(
                    "GET {url} status={status} verified={}",
                    observed.http_verified
                ),
                (None, Some(error)) => format!("GET {url} failed: {error}"),
                _ => format!("GET {url} not attempted"),
            },
        });
    }
    evidence
}

fn runtime_wait_risks(
    status: &OperationStatus,
    observed: &ProjectRuntimeWaitObservedSummary,
) -> Vec<OperationRisk> {
    let mut risks = Vec::new();
    if observed.listener_ready && !observed.http_verified {
        risks.push(OperationRisk {
            code: "listenerWithoutHttpVerification".to_string(),
            severity: "warning".to_string(),
            detail: "TCP 端口已监听，但尚未证明页面或 HTTP 服务可访问".to_string(),
        });
    }
    if status.key == "timeout" {
        risks.push(OperationRisk {
            code: "runtimeWaitTimeout".to_string(),
            severity: "error".to_string(),
            detail: status.detail.clone(),
        });
    }
    risks
}

pub fn clear_project_runtime_log(
    config: &AppConfig,
    project_key: &str,
    kind: ProjectRuntimeLogKind,
) -> Result<ProjectRuntimeLogResponse, String> {
    let project = config
        .find_project(project_key)
        .map_err(|error| error.to_string())?;
    let path = project_task_log_path(project, kind);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建日志目录失败: {}", error))?;
    }
    OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path)
        .map_err(|error| format!("清空运行日志失败: {}", error))?;
    Ok(ProjectRuntimeLogResponse {
        path: path.display().to_string(),
        lines: Vec::new(),
        truncated: false,
        selection: "cleared".to_string(),
        requested_run_id: None,
        effective_run_id: None,
        ready_summary: project_runtime_ready_summary(project, RuntimeTaskKind::from(kind), &[]),
        session_summary: ProjectRuntimeLogSessionSummary::empty(0),
    })
}

pub fn project_task_log_path(project: &ProjectConfig, kind: ProjectRuntimeLogKind) -> PathBuf {
    task_log_path(project, RuntimeTaskKind::from(kind))
}

pub fn project_runtime_ready_summary_from_file(
    project: &ProjectConfig,
    kind: ProjectRuntimeLogKind,
) -> Result<ProjectRuntimeReadySummary, String> {
    let task_kind = RuntimeTaskKind::from(kind);
    if task_kind != RuntimeTaskKind::Dev || !project.focus.ready.enabled {
        return Ok(ProjectRuntimeReadySummary::disabled());
    }
    let path = task_log_path(project, task_kind);
    let (lines, _, _) = tail_log_lines(&path, 500)?;
    Ok(project_runtime_ready_summary(project, task_kind, &lines))
}

fn runtime_profile_summary(profile: &RuntimeProfileConfig) -> RuntimeProfileSummary {
    RuntimeProfileSummary {
        key: profile.key.clone(),
        label: profile.label.clone(),
        browser: profile.browser.clone(),
        browser_profile: profile.browser_profile.clone(),
        browser_user_data_dir: profile
            .browser_user_data_dir
            .as_ref()
            .map(|path| path.display().to_string()),
        web_actions_enabled: profile.web_actions_enabled,
        web_actions_port: profile.web_actions_port,
        web_actions_user_data_dir: profile
            .web_actions_user_data_dir
            .as_ref()
            .map(|path| path.display().to_string()),
        browser_args: profile.browser_args.clone(),
        proxy_url: profile.proxy_url.clone(),
        rdev_proxy_profile_id: profile.rdev_proxy_profile_id.clone(),
        proxy_bypass: profile.proxy_bypass.clone(),
        host_resolver_rules: profile.host_resolver_rules.clone(),
        network_proxy: network_proxy_summary(&profile.network_proxy),
    }
}

fn network_proxy_summary(proxy: &ProjectNetworkProxyConfig) -> RuntimeNetworkProxySummary {
    RuntimeNetworkProxySummary {
        enabled: proxy.enabled,
        proxy_url: proxy.proxy_url.clone(),
        inject_env: proxy.inject_env,
        node_hook: proxy.node_hook,
        no_proxy: proxy.no_proxy.clone(),
    }
}

fn inspect_runtime_env(
    project: &ProjectConfig,
    debug_profile: Option<&ProjectDebugProfileConfig>,
    runtime_profile: Option<&RuntimeProfileConfig>,
) -> Vec<ProjectRuntimeEnvPreview> {
    let mut preview = Vec::new();
    if let Some(command) = project_command_config(project, RuntimeTaskKind::Dev) {
        for (key, value) in &command.env {
            preview.push(env_preview_item(key, value, "project.dev.env"));
        }
    }
    if let Some(profile) = debug_profile {
        for (key, value) in &profile.env {
            preview.push(env_preview_item(
                key,
                value,
                &format!("debugProfile.{}", profile.key),
            ));
        }
    }
    if let Some(proxy) = active_network_proxy(debug_profile, runtime_profile) {
        if proxy.enabled && proxy.inject_env {
            for key in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"] {
                let value = if key == "NO_PROXY" {
                    normalize_network_proxy_no_proxy(&proxy.no_proxy)
                } else {
                    proxy.proxy_url.clone()
                };
                preview.push(env_preview_item(key, &value, "networkProxy"));
            }
        }
        if proxy.enabled && proxy.node_hook {
            preview.push(env_preview_item(
                "NODE_OPTIONS",
                "--require <rdevtool-node-proxy-hook>",
                "networkProxy.nodeHook",
            ));
        }
    }
    preview.sort_by(|left, right| {
        left.key
            .cmp(&right.key)
            .then_with(|| left.source.cmp(&right.source))
    });
    preview
}

fn apply_env_preview_overrides(
    preview: &mut Vec<ProjectRuntimeEnvPreview>,
    overrides: &BTreeMap<String, String>,
    source: &str,
) {
    for (key, value) in overrides {
        let key = key.trim();
        if !key.is_empty() {
            preview.push(env_preview_item(key, value, source));
        }
    }
    preview.sort_by(|left, right| {
        left.key
            .cmp(&right.key)
            .then_with(|| left.source.cmp(&right.source))
    });
}

fn env_preview_item(key: &str, value: &str, source: &str) -> ProjectRuntimeEnvPreview {
    let masked = is_sensitive_env_key(key);
    ProjectRuntimeEnvPreview {
        key: key.to_string(),
        value: if masked {
            mask_sensitive_value(value)
        } else {
            value.to_string()
        },
        source: source.to_string(),
        masked,
    }
}

fn inspect_runtime_local_files(
    project: &ProjectConfig,
    debug_profile: Option<&ProjectDebugProfileConfig>,
) -> Vec<ProjectRuntimeLocalFileInspect> {
    let Some(profile) = debug_profile else {
        return Vec::new();
    };
    profile
        .local_files
        .iter()
        .map(|local_file| inspect_runtime_local_file(project, local_file))
        .collect()
}

fn inspect_runtime_local_file(
    project: &ProjectConfig,
    local_file: &ProjectDebugLocalFileConfig,
) -> ProjectRuntimeLocalFileInspect {
    let path = local_file.path.display().to_string();
    let (content_preview, content_truncated) = preview_text(&local_file.content, 360);
    if !local_file.enabled {
        return ProjectRuntimeLocalFileInspect {
            path,
            absolute_path: None,
            mode: local_file.mode.clone(),
            enabled: false,
            git_tracked: None,
            git_ignored: None,
            status_key: "disabled".to_string(),
            status_label: "未启用".to_string(),
            detail: "该本地覆盖文件不会在启动前写入".to_string(),
            action: None,
            content_preview,
            content_truncated,
        };
    }
    let Some(repo_path) = project.repo_path.as_ref() else {
        return ProjectRuntimeLocalFileInspect {
            path,
            absolute_path: None,
            mode: local_file.mode.clone(),
            enabled: true,
            git_tracked: None,
            git_ignored: None,
            status_key: "error".to_string(),
            status_label: "错误".to_string(),
            detail: "项目没有 repo_path，无法写入本地覆盖文件".to_string(),
            action: Some("先配置项目目录，或使用工作区项目实例。".to_string()),
            content_preview,
            content_truncated,
        };
    };
    match resolve_debug_local_file_path(repo_path, &local_file.path) {
        Ok((target_path, relative_path)) => {
            let git_tracked =
                git_file_status(repo_path, &relative_path, "ls-files", &["--error-unmatch"]);
            let git_ignored = git_file_status(repo_path, &relative_path, "check-ignore", &["-q"]);
            let (status_key, status_label, detail, action) = if git_tracked == Some(true) {
                (
                    "error",
                    "会污染仓库",
                    format!("{} 已被 Git 跟踪，运行时不会覆盖它", relative_path),
                    Some("改用 .gitignore 忽略的本地覆盖文件。".to_string()),
                )
            } else if git_ignored == Some(false) {
                (
                    "warning",
                    "未忽略",
                    format!("{} 当前没有被 .gitignore 忽略", relative_path),
                    Some("先把该本地覆盖文件加入 .gitignore，再启用写入。".to_string()),
                )
            } else {
                (
                    "ok",
                    "安全",
                    format!("{} 可作为本地覆盖文件写入", relative_path),
                    None,
                )
            };
            ProjectRuntimeLocalFileInspect {
                path: relative_path,
                absolute_path: Some(target_path.display().to_string()),
                mode: local_file.mode.clone(),
                enabled: true,
                git_tracked,
                git_ignored,
                status_key: status_key.to_string(),
                status_label: status_label.to_string(),
                detail,
                action,
                content_preview,
                content_truncated,
            }
        }
        Err(error) => ProjectRuntimeLocalFileInspect {
            path,
            absolute_path: None,
            mode: local_file.mode.clone(),
            enabled: true,
            git_tracked: None,
            git_ignored: None,
            status_key: "error".to_string(),
            status_label: "错误".to_string(),
            detail: error,
            action: Some("修正本地覆盖文件路径。".to_string()),
            content_preview,
            content_truncated,
        },
    }
}

fn inspect_runtime_proxies(
    debug_profile: Option<&ProjectDebugProfileConfig>,
    runtime_profile: Option<&RuntimeProfileConfig>,
    proxy_config: &ProxyConfig,
) -> Vec<ProjectRuntimeProxyInspect> {
    let mut proxies = Vec::new();
    if let Some(profile) = runtime_profile {
        if !profile.proxy_url.trim().is_empty() {
            proxies.push(ProjectRuntimeProxyInspect {
                key: "browserProxy".to_string(),
                kind: "browserProxy".to_string(),
                label: "浏览器代理".to_string(),
                enabled: true,
                url: Some(profile.proxy_url.clone()),
                profile_id: None,
                listening: runtime_proxy_url_listening(&profile.proxy_url),
                status_key: "configured".to_string(),
                status_label: "已配置".to_string(),
                detail: format!("浏览器会使用 {}", profile.proxy_url),
                action: None,
            });
        }
        if let Some(profile_id) = profile.rdev_proxy_profile_id.as_ref() {
            proxies.push(inspect_rdev_proxy_profile(proxy_config, profile_id));
        }
    }
    if let Some(proxy) = active_network_proxy(debug_profile, runtime_profile) {
        proxies.push(ProjectRuntimeProxyInspect {
            key: "networkProxy".to_string(),
            kind: "networkProxy".to_string(),
            label: "Node 出网代理".to_string(),
            enabled: proxy.enabled,
            url: (!proxy.proxy_url.trim().is_empty()).then_some(proxy.proxy_url.clone()),
            profile_id: None,
            listening: runtime_proxy_url_listening(&proxy.proxy_url),
            status_key: if proxy.enabled && proxy.proxy_url.trim().is_empty() {
                "error"
            } else if proxy.enabled {
                "configured"
            } else {
                "disabled"
            }
            .to_string(),
            status_label: if proxy.enabled && proxy.proxy_url.trim().is_empty() {
                "错误"
            } else if proxy.enabled {
                "已配置"
            } else {
                "未启用"
            }
            .to_string(),
            detail: if proxy.enabled {
                format!(
                    "注入环境变量: {}，Node hook: {}",
                    proxy.inject_env, proxy.node_hook
                )
            } else {
                "Node 进程不注入代理环境".to_string()
            },
            action: (proxy.enabled && proxy.proxy_url.trim().is_empty())
                .then_some("补充 proxy_url，或关闭 Node 出网代理。".to_string()),
        });
    }
    if let Some(profile) = debug_profile {
        let proxy = &profile.local_proxy;
        if proxy.enabled {
            let listening = local_listen_port_status(&proxy.listen);
            proxies.push(ProjectRuntimeProxyInspect {
                key: "debugLocalProxy".to_string(),
                kind: "debugLocalProxy".to_string(),
                label: "调试档案本地 API 代理".to_string(),
                enabled: true,
                url: Some(format!("http://{}", proxy.listen)),
                profile_id: Some(profile.key.clone()),
                listening,
                status_key: if listening == Some(true) {
                    "running"
                } else {
                    "notListening"
                }
                .to_string(),
                status_label: if listening == Some(true) {
                    "监听中"
                } else {
                    "未监听"
                }
                .to_string(),
                detail: format!("{} 条路由，前端 {}", proxy.routes.len(), proxy.frontend_url),
                action: (listening != Some(true)).then_some(
                    "从 App 启动该调试档案，或改用 rDevTool proxy profile。".to_string(),
                ),
            });
        }
    }
    proxies
}

fn inspect_rdev_proxy_profile(
    proxy_config: &ProxyConfig,
    profile_id: &str,
) -> ProjectRuntimeProxyInspect {
    let proxy_profile = proxy_config
        .profiles
        .iter()
        .find(|profile| profile.id == profile_id || profile.name == profile_id);
    let Some(profile) = proxy_profile else {
        return ProjectRuntimeProxyInspect {
            key: "rdevProxyProfile".to_string(),
            kind: "rdevProxyProfile".to_string(),
            label: "rDevTool 代理 profile".to_string(),
            enabled: false,
            url: None,
            profile_id: Some(profile_id.to_string()),
            listening: None,
            status_key: "error".to_string(),
            status_label: "不存在".to_string(),
            detail: format!("运行配置引用的代理 profile 不存在: {}", profile_id),
            action: Some("重新绑定 runtime profile，或恢复该 proxy profile。".to_string()),
        };
    };
    let listening = proxy_profile_port_status(profile);
    ProjectRuntimeProxyInspect {
        key: "rdevProxyProfile".to_string(),
        kind: "rdevProxyProfile".to_string(),
        label: profile.name.clone(),
        enabled: true,
        url: Some(profile.listen_url()),
        profile_id: Some(profile.id.clone()),
        listening: Some(listening),
        status_key: if listening { "running" } else { "notListening" }.to_string(),
        status_label: if listening { "监听中" } else { "未监听" }.to_string(),
        detail: format!("{} 绑定到运行配置", profile.listen_url()),
        action: (!listening).then_some("启动该 proxy profile 后再验证请求命中。".to_string()),
    }
}

fn local_file_inspect_check(file: &ProjectRuntimeLocalFileInspect) -> ProjectRuntimePreflightCheck {
    preflight_check(
        &format!("localFile.{}", file.path),
        "本地覆盖文件",
        "runtime",
        preflight_status_for_inspect(&file.status_key),
        file.detail.clone(),
        file.action.as_deref(),
    )
}

fn proxy_inspect_check(proxy: &ProjectRuntimeProxyInspect) -> ProjectRuntimePreflightCheck {
    preflight_check(
        &proxy.key,
        &proxy.label,
        "proxy",
        preflight_status_for_inspect(&proxy.status_key),
        proxy.detail.clone(),
        proxy.action.as_deref(),
    )
}

fn build_runtime_handoff(
    project: &ProjectConfig,
    debug_profile: Option<&ProjectDebugProfileConfig>,
    runtime_profile: Option<&RuntimeProfileConfig>,
    local_files: &[ProjectRuntimeLocalFileInspect],
    proxies: &[ProjectRuntimeProxyInspect],
    checks: &[ProjectRuntimePreflightCheck],
) -> ProjectRuntimeHandoff {
    let proxy_urls = proxies
        .iter()
        .filter_map(|proxy| proxy.url.clone())
        .collect::<Vec<_>>();
    let verify_urls = proxy_urls
        .iter()
        .filter(|url| url.starts_with("http://127.0.0.1") || url.starts_with("http://localhost"))
        .cloned()
        .collect::<Vec<_>>();
    let risks = checks
        .iter()
        .filter(|check| {
            matches!(
                check.status_key.as_str(),
                "warning" | "error" | "notListening"
            )
        })
        .map(|check| format!("{}: {}", check.title, check.detail))
        .collect::<Vec<_>>();
    ProjectRuntimeHandoff {
        project_path: project
            .repo_path
            .as_ref()
            .map(|path| path.display().to_string()),
        workspace_sensitive: true,
        debug_profile: debug_profile.map(|profile| profile.key.clone()),
        runtime_profile: runtime_profile.map(|profile| profile.key.clone()),
        local_files: local_files
            .iter()
            .filter(|file| file.enabled)
            .map(|file| file.path.clone())
            .collect(),
        proxy_urls,
        verify_urls,
        risks,
    }
}

fn preflight_status_for_inspect(status_key: &str) -> &'static str {
    match status_key {
        "error" => "error",
        "warning" | "notListening" => "warning",
        "ok" | "running" | "configured" => "ok",
        _ => "info",
    }
}

fn active_network_proxy<'a>(
    debug_profile: Option<&'a ProjectDebugProfileConfig>,
    runtime_profile: Option<&'a RuntimeProfileConfig>,
) -> Option<&'a ProjectNetworkProxyConfig> {
    debug_profile
        .filter(|profile| profile.network_proxy.enabled)
        .map(|profile| &profile.network_proxy)
        .or_else(|| {
            runtime_profile
                .map(|profile| &profile.network_proxy)
                .filter(|proxy| proxy.enabled)
        })
}

fn git_file_status(
    repo_path: &Path,
    relative_path: &str,
    subcommand: &str,
    args: &[&str],
) -> Option<bool> {
    let mut command = Command::new("git");
    command.arg("-C").arg(repo_path).arg(subcommand);
    for arg in args {
        command.arg(arg);
    }
    command.arg("--").arg(relative_path);
    command
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()
        .map(|status| status.success())
}

fn preview_text(value: &str, max_chars: usize) -> (String, bool) {
    let mut preview = String::new();
    let mut truncated = false;
    for (index, ch) in value.chars().enumerate() {
        if index >= max_chars {
            truncated = true;
            break;
        }
        preview.push(ch);
    }
    (preview, truncated)
}

fn is_sensitive_env_key(key: &str) -> bool {
    let key = key.to_ascii_uppercase();
    [
        "TOKEN", "SECRET", "PASSWORD", "PASS", "PRIVATE", "COOKIE", "AUTH",
    ]
    .iter()
    .any(|needle| key.contains(needle))
}

fn mask_sensitive_value(value: &str) -> String {
    if value.is_empty() {
        return String::new();
    }
    if value.chars().count() <= 6 {
        return "******".to_string();
    }
    let prefix = value.chars().take(2).collect::<String>();
    let suffix = value
        .chars()
        .rev()
        .take(2)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>();
    format!("{prefix}******{suffix}")
}

fn runtime_proxy_url_listening(value: &str) -> Option<bool> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    if let Ok(url) = reqwest::Url::parse(value) {
        let host = url.host_str()?;
        let port = url.port_or_known_default()?;
        return Some(tcp_port_listening(host, port));
    }
    local_listen_port_status(value)
}

fn local_listen_port_status(value: &str) -> Option<bool> {
    let (host, port) = parse_listen_host_port(value)?;
    Some(tcp_port_listening(&host, port))
}

fn proxy_profile_port_status(profile: &ProxyProfile) -> bool {
    tcp_port_listening(&profile.listen_host, profile.listen_port)
}

fn tcp_port_listening(host: &str, port: u16) -> bool {
    let address = format!("{}:{}", host.trim(), port);
    address
        .to_socket_addrs()
        .ok()
        .and_then(|mut addresses| addresses.next())
        .is_some_and(|address| {
            TcpStream::connect_timeout(&address, Duration::from_millis(180)).is_ok()
        })
}

fn parse_listen_host_port(value: &str) -> Option<(String, u16)> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    if let Ok(port) = value.parse::<u16>() {
        return Some(("127.0.0.1".to_string(), port));
    }
    let (host, port) = value.rsplit_once(':')?;
    let host = host.trim().trim_start_matches('[').trim_end_matches(']');
    let host = if host.is_empty() { "127.0.0.1" } else { host };
    Some((host.to_string(), port.trim().parse().ok()?))
}

fn selected_debug_profile(
    project: &ProjectConfig,
    profile_key: Option<&str>,
) -> Result<Option<ProjectDebugProfileConfig>, String> {
    let Some(profile_key) = profile_key.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    project
        .debug_profiles
        .iter()
        .find(|profile| profile.key == profile_key)
        .cloned()
        .map(Some)
        .ok_or_else(|| format!("调试档案不存在: {}", profile_key))
}

fn resolve_runtime_profile(
    config: &AppConfig,
    debug_profile: Option<&ProjectDebugProfileConfig>,
    explicit_runtime_profile_key: Option<&str>,
) -> Result<Option<RuntimeProfileConfig>, String> {
    let runtime_profile_key = optional_trimmed(explicit_runtime_profile_key).or_else(|| {
        debug_profile.and_then(|profile| optional_trimmed(profile.runtime_profile.as_deref()))
    });
    let Some(runtime_profile_key) = runtime_profile_key else {
        return Ok(None);
    };
    config
        .defaults
        .runtime_profiles
        .iter()
        .find(|runtime_profile| runtime_profile.key == runtime_profile_key)
        .cloned()
        .map(Some)
        .ok_or_else(|| format!("运行配置不存在: {}", runtime_profile_key))
}

fn resolve_debug_profile_cwd(
    project: &ProjectConfig,
    debug_profile: Option<&ProjectDebugProfileConfig>,
) -> Result<Option<PathBuf>, String> {
    let Some(cwd) = debug_profile.and_then(|profile| profile.cwd.as_ref()) else {
        return Ok(None);
    };
    if cwd.is_absolute() {
        return Ok(Some(cwd.clone()));
    }
    project
        .repo_path
        .as_ref()
        .map(|repo_path| Some(repo_path.join(cwd)))
        .ok_or_else(|| {
            format!(
                "project {} uses a relative debug profile cwd but has no repo_path",
                project.key
            )
        })
}

pub fn project_runtime_candidate_cwds(project: &ProjectConfig) -> Result<Vec<PathBuf>, String> {
    let mut candidates = Vec::new();
    if let Some(command) = project.dev.as_ref()
        && let Ok(cwd) = resolve_command_cwd(project, command, RuntimeTaskKind::Dev)
    {
        candidates.push(cwd);
    }
    for profile in &project.debug_profiles {
        if let Some(cwd) = resolve_debug_profile_cwd(project, Some(profile))? {
            candidates.push(cwd);
        }
    }
    for cwd in &mut candidates {
        *cwd = cwd.canonicalize().unwrap_or_else(|_| cwd.clone());
    }
    candidates.sort();
    candidates.dedup();
    if candidates.is_empty() {
        return Err(format!(
            "project {} has no dev.cwd, debug profile cwd, or repo_path for runtime lookup",
            project.key
        ));
    }
    Ok(candidates)
}

fn resolve_runtime_command(
    project: &ProjectConfig,
    debug_profile: Option<&ProjectDebugProfileConfig>,
    options: &ProjectRuntimeLaunchOptions,
) -> Result<ResolvedProjectCommand, String> {
    let Some(command_config) = project_command_config(project, RuntimeTaskKind::Dev) else {
        return Err(RuntimeTaskKind::Dev.missing_config_message().to_string());
    };
    let command = optional_trimmed(options.command.as_deref())
        .or_else(|| debug_profile.and_then(|profile| optional_trimmed(profile.command.as_deref())))
        .unwrap_or_else(|| command_config.command.trim())
        .to_string();
    if command.is_empty() {
        return Err("启动命令为空，请在 dev 下配置 command".to_string());
    }
    let cwd = match resolve_debug_profile_cwd(project, debug_profile)? {
        Some(cwd) => cwd,
        None => resolve_command_cwd(project, command_config, RuntimeTaskKind::Dev)?,
    };
    if !cwd.exists() {
        return Err(format!("启动目录不存在: {}", cwd.display()));
    }
    if !cwd.is_dir() {
        return Err(format!("启动目录不是文件夹: {}", cwd.display()));
    }
    let mut env = command_config.env.clone();
    if let Some(profile) = debug_profile {
        env.extend(profile.env.clone());
    }
    env.extend(options.env.clone());
    Ok(ResolvedProjectCommand { command, cwd, env })
}

fn effective_project_focus_url(
    project: &ProjectConfig,
    debug_profile: Option<&ProjectDebugProfileConfig>,
) -> Option<String> {
    debug_profile
        .and_then(|profile| optional_trimmed(profile.focus_url.as_deref()))
        .or_else(|| optional_trimmed(project.focus.url.as_deref()))
        .map(ToString::to_string)
}

fn runtime_ready_probe_summary(
    probe: Option<&ProjectDebugReadyProbeConfig>,
) -> Option<ProjectRuntimeReadyProbeSummary> {
    probe.map(|probe| ProjectRuntimeReadyProbeSummary {
        url: optional_owned(probe.url.as_deref()),
        path: optional_owned(probe.path.as_deref()),
        expected_statuses: probe.expected_statuses.clone(),
        timeout_ms: probe.timeout_ms,
    })
}

fn resolve_runtime_target_summary(
    project: &ProjectConfig,
    debug_profile: Option<&ProjectDebugProfileConfig>,
    options: &ProjectRuntimeLaunchOptions,
) -> Result<ProjectRuntimeTargetSummary, String> {
    let resolved = resolve_runtime_command(project, debug_profile, options)?;
    let port = resolve_expected_port_detail(project, debug_profile, options, &resolved);
    let focus_url = effective_project_focus_url(project, debug_profile);
    Ok(ProjectRuntimeTargetSummary {
        command: resolved.command,
        command_source: if optional_trimmed(options.command.as_deref()).is_some() {
            "launchOverride"
        } else if debug_profile
            .and_then(|profile| optional_trimmed(profile.command.as_deref()))
            .is_some()
        {
            "debugProfile"
        } else {
            "projectDev"
        }
        .to_string(),
        cwd: resolved.cwd.display().to_string(),
        cwd_source: if debug_profile
            .and_then(|profile| profile.cwd.as_ref())
            .is_some()
        {
            "debugProfile"
        } else if project
            .dev
            .as_ref()
            .and_then(|dev| dev.cwd.as_ref())
            .is_some()
        {
            "projectDev"
        } else {
            "projectRepo"
        }
        .to_string(),
        expected_port: port.map(|item| item.0),
        expected_port_source: port.map(|item| item.1.to_string()),
        focus_url,
        focus_url_source: if debug_profile
            .and_then(|profile| optional_trimmed(profile.focus_url.as_deref()))
            .is_some()
        {
            Some("debugProfile".to_string())
        } else if optional_trimmed(project.focus.url.as_deref()).is_some() {
            Some("projectFocus".to_string())
        } else {
            None
        },
        ready_probe: runtime_ready_probe_summary(
            debug_profile.and_then(|profile| profile.ready_probe.as_ref()),
        ),
    })
}

fn inspect_project_environment(
    project: &ProjectConfig,
    debug_profile: Option<&ProjectDebugProfileConfig>,
    options: &ProjectRuntimeLaunchOptions,
) -> ProjectRuntimeEnvironmentInspect {
    let mut diagnostics = Vec::new();
    let resolved = match resolve_runtime_command(project, debug_profile, options) {
        Ok(resolved) => Some(resolved),
        Err(error) => {
            diagnostics.push(error);
            None
        }
    };

    let cwd = resolved
        .as_ref()
        .map(|item| item.cwd.clone())
        .or_else(|| project.repo_path.clone());
    if cwd.as_ref().is_some_and(|path| !path.is_dir()) {
        diagnostics.push(format!(
            "工作目录不可用: {}",
            cwd.as_ref().expect("cwd was checked").display()
        ));
    }

    let configured_command = resolved
        .as_ref()
        .map(|item| item.command.clone())
        .or_else(|| {
            optional_trimmed(options.command.as_deref())
                .or_else(|| {
                    debug_profile.and_then(|profile| optional_trimmed(profile.command.as_deref()))
                })
                .or_else(|| {
                    project
                        .dev
                        .as_ref()
                        .and_then(|dev| optional_trimmed(Some(&dev.command)))
                })
                .map(ToString::to_string)
        });
    let script_name = configured_command.as_deref().and_then(package_script_name);
    let script_command = match (configured_command.as_deref(), cwd.as_deref()) {
        (Some(command), Some(cwd)) => package_script_command(command, cwd),
        _ => None,
    };
    let vite = configured_command
        .as_deref()
        .is_some_and(shell_command_contains_vite)
        || script_command
            .as_deref()
            .is_some_and(shell_command_contains_vite);
    let package_manager = configured_command
        .as_deref()
        .and_then(package_script_runner)
        .map(ToString::to_string)
        .or_else(|| cwd.as_deref().and_then(detect_package_manager));
    let package_json = cwd.as_deref().and_then(|cwd| {
        let path = cwd.join("package.json");
        if !path.is_file() {
            return None;
        }
        match fs::read_to_string(&path)
            .map_err(|error| error.to_string())
            .and_then(|content| {
                serde_json::from_str::<serde_json::Value>(&content)
                    .map_err(|error| error.to_string())
            }) {
            Ok(value) => Some(ProjectRuntimePackageInspect {
                path: path.display().to_string(),
                name: value
                    .get("name")
                    .and_then(|value| value.as_str())
                    .map(ToString::to_string),
                package_manager: value
                    .get("packageManager")
                    .and_then(|value| value.as_str())
                    .and_then(|value| value.split('@').next())
                    .map(ToString::to_string)
                    .or_else(|| package_manager.clone()),
            }),
            Err(error) => {
                diagnostics.push(format!("package.json 解析失败: {error}"));
                None
            }
        }
    });
    let empty_env = BTreeMap::new();
    let node_version = detect_node_version(
        cwd.as_deref(),
        configured_command.as_deref().unwrap_or_default(),
        resolved
            .as_ref()
            .map(|item| &item.env)
            .unwrap_or(&empty_env),
    );
    let port_detail = resolved.as_ref().and_then(|resolved| {
        resolve_expected_port_detail(project, debug_profile, options, resolved)
    });
    let vite_config = cwd.as_deref().and_then(find_vite_config);
    let suggested_port = if vite && port_detail.is_none() && vite_config.is_none() {
        Some(5173)
    } else {
        None
    };
    let status_key = if resolved.is_none() {
        "unavailable"
    } else if diagnostics.is_empty() {
        "detected"
    } else {
        "partial"
    };

    ProjectRuntimeEnvironmentInspect {
        status_key: status_key.to_string(),
        cwd: cwd.map(|path| path.display().to_string()),
        package_json,
        node_version,
        dev: ProjectRuntimeDevEnvironmentInspect {
            configured_command,
            script_name,
            script_command,
            package_manager,
            vite,
        },
        port: ProjectRuntimePortInspect {
            effective_port: port_detail.map(|item| item.0),
            source: port_detail.map(|item| item.1.to_string()),
            confidence: if port_detail.is_some() {
                "high"
            } else {
                "unknown"
            }
            .to_string(),
            suggested_port,
        },
        vite_config: vite_config.map(|path| ProjectRuntimeViteConfigInspect {
            path: path.display().to_string(),
            evaluated: false,
        }),
        diagnostics,
    }
}

fn detect_package_manager(cwd: &Path) -> Option<String> {
    [
        ("pnpm-lock.yaml", "pnpm"),
        ("yarn.lock", "yarn"),
        ("bun.lockb", "bun"),
        ("bun.lock", "bun"),
        ("package-lock.json", "npm"),
    ]
    .into_iter()
    .find_map(|(file, manager)| cwd.join(file).is_file().then(|| manager.to_string()))
}

fn find_vite_config(cwd: &Path) -> Option<PathBuf> {
    [
        "vite.config.ts",
        "vite.config.js",
        "vite.config.mts",
        "vite.config.mjs",
        "vite.config.cts",
        "vite.config.cjs",
    ]
    .into_iter()
    .map(|name| cwd.join(name))
    .find(|path| path.is_file())
}

fn resolve_expected_port(
    project: &ProjectConfig,
    debug_profile: Option<&ProjectDebugProfileConfig>,
    options: &ProjectRuntimeLaunchOptions,
    resolved: &ResolvedProjectCommand,
) -> Option<u16> {
    resolve_expected_port_detail(project, debug_profile, options, resolved).map(|item| item.0)
}

fn resolve_expected_port_detail(
    project: &ProjectConfig,
    debug_profile: Option<&ProjectDebugProfileConfig>,
    options: &ProjectRuntimeLaunchOptions,
    resolved: &ResolvedProjectCommand,
) -> Option<(u16, &'static str)> {
    options
        .expected_port
        .map(|port| (port, "launchOverride"))
        .or_else(|| {
            debug_profile
                .and_then(|profile| profile.expected_port)
                .map(|port| (port, "debugProfile"))
        })
        .or_else(|| command_port(&resolved.command).map(|port| (port, "commandArg")))
        .or_else(|| {
            package_script_command(&resolved.command, &resolved.cwd)
                .as_deref()
                .and_then(command_port)
                .map(|port| (port, "packageScript"))
        })
        .or_else(|| {
            resolved
                .env
                .get("PORT")
                .and_then(|value| value.parse().ok())
                .map(|port| (port, "envPort"))
        })
        .or_else(|| {
            debug_profile
                .and_then(|profile| profile.focus_url.as_deref())
                .and_then(local_focus_url_port)
                .map(|port| (port, "debugProfileFocusUrl"))
        })
        .or_else(|| project_local_focus_url_port(project).map(|port| (port, "projectFocusUrl")))
}

fn command_port(command: &str) -> Option<u16> {
    let parts = command.split_whitespace().collect::<Vec<_>>();
    for (index, part) in parts.iter().enumerate() {
        if let Some(value) = part.strip_prefix("--port=") {
            if let Ok(port) = value.trim_matches(['\'', '"']).parse() {
                return Some(port);
            }
        }
        if *part == "--port" {
            if let Some(value) = parts.get(index + 1) {
                if let Ok(port) = value.trim_matches(['\'', '"']).parse() {
                    return Some(port);
                }
            }
        }
    }
    None
}

fn apply_vite_strict_port(
    command: &str,
    expected_port: Option<u16>,
    is_vite: bool,
    strict_port_already_set: bool,
) -> String {
    let command = command.trim();
    if expected_port.is_none()
        || !is_vite
        || strict_port_already_set
        || command_has_strict_port(command)
    {
        return command.to_string();
    }
    if command.contains(" -- ") {
        return format!("{command} --strictPort");
    }
    match package_script_runner(command) {
        Some("npm" | "pnpm") => format!("{command} -- --strictPort"),
        Some(_) => format!("{command} --strictPort"),
        None => format!("{command} --strictPort"),
    }
}

fn resolved_vite_command_info(command: &str, cwd: &Path) -> (bool, bool) {
    if shell_command_contains_vite(command) {
        return (true, command_has_strict_port(command));
    }
    let Some(script_name) = package_script_name(command) else {
        return (false, false);
    };
    let Ok(content) = fs::read_to_string(cwd.join("package.json")) else {
        return (false, false);
    };
    serde_json::from_str::<serde_json::Value>(&content)
        .ok()
        .and_then(|value| {
            value
                .get("scripts")?
                .get(&script_name)?
                .as_str()
                .map(vite_script_info)
        })
        .unwrap_or((false, false))
}

fn package_script_command(command: &str, cwd: &Path) -> Option<String> {
    let script_name = package_script_name(command)?;
    let content = fs::read_to_string(cwd.join("package.json")).ok()?;
    serde_json::from_str::<serde_json::Value>(&content)
        .ok()?
        .get("scripts")?
        .get(script_name)?
        .as_str()
        .map(ToString::to_string)
}

fn vite_script_info(script: &str) -> (bool, bool) {
    (
        shell_command_contains_vite(script),
        command_has_strict_port(script),
    )
}

fn command_has_strict_port(command: &str) -> bool {
    command.split_whitespace().any(|part| {
        let part = part
            .trim_matches(['\'', '"'])
            .split_once('=')
            .map(|(key, _)| key)
            .unwrap_or(part)
            .to_ascii_lowercase();
        part == "--strictport" || part == "--strict-port"
    })
}

fn shell_command_contains_vite(command: &str) -> bool {
    command.split_whitespace().any(|part| {
        let token = part
            .trim_matches(|ch: char| matches!(ch, '\'' | '"' | '(' | ')' | ';' | '&' | '|'))
            .rsplit('/')
            .next()
            .unwrap_or_default()
            .trim_end_matches(".cmd")
            .to_ascii_lowercase();
        token == "vite"
    })
}

fn package_script_runner(command: &str) -> Option<&'static str> {
    command.split_whitespace().find_map(|part| {
        let executable = part
            .trim_matches(|ch: char| matches!(ch, '\'' | '"' | '(' | ')' | ';' | '&' | '|'))
            .rsplit('/')
            .next()?
            .trim_end_matches(".cmd");
        if executable.eq_ignore_ascii_case("npm") {
            Some("npm")
        } else if executable.eq_ignore_ascii_case("pnpm") {
            Some("pnpm")
        } else if executable.eq_ignore_ascii_case("yarn") {
            Some("yarn")
        } else if executable.eq_ignore_ascii_case("bun") {
            Some("bun")
        } else {
            None
        }
    })
}

fn package_script_name(command: &str) -> Option<String> {
    let runner = package_script_runner(command)?;
    let parts = command.split_whitespace().collect::<Vec<_>>();
    let runner_index = parts.iter().position(|part| {
        part.trim_matches(['\'', '"'])
            .rsplit('/')
            .next()
            .is_some_and(|part| part.trim_end_matches(".cmd").eq_ignore_ascii_case(runner))
    })?;
    let mut index = runner_index + 1;
    if parts
        .get(index)
        .is_some_and(|part| matches!(*part, "run" | "run-script"))
    {
        index += 1;
    } else if runner == "npm" {
        return None;
    }
    let script = parts.get(index)?.trim_matches(['\'', '"']);
    if script.is_empty()
        || script.starts_with('-')
        || matches!(
            script,
            "add" | "create" | "dlx" | "exec" | "install" | "remove"
        )
    {
        return None;
    }
    Some(script.to_string())
}

pub fn project_local_focus_url_port(project: &ProjectConfig) -> Option<u16> {
    let url = optional_trimmed(project.focus.url.as_deref())?;
    local_focus_url_port(url)
}

fn local_focus_url_port(url: &str) -> Option<u16> {
    let parsed = reqwest::Url::parse(url).ok()?;
    match parsed.host_str()? {
        "localhost" | "127.0.0.1" | "::1" => parsed.port(),
        _ => None,
    }
}

pub fn ensure_runtime_expected_port_available(expected_port: Option<u16>) -> Result<(), String> {
    let Some(port) = expected_port else {
        return Ok(());
    };
    if port == 0 {
        return Err("预期端口必须在 1-65535 之间".to_string());
    }
    match TcpListener::bind(("127.0.0.1", port)) {
        Ok(listener) => {
            drop(listener);
            Ok(())
        }
        Err(error) => Err(format!(
            "预期端口 {} 已被占用，已取消启动。{} ({})",
            port,
            port_owner_detail(port)
                .map(|detail| format!("占用者：{}", detail))
                .unwrap_or_else(|| "请先停止占用该端口的进程".to_string()),
            error
        )),
    }
}

fn port_owner_detail(port: u16) -> Option<String> {
    #[cfg(unix)]
    {
        let output = Command::new("lsof")
            .args(["-nP", &format!("-iTCP:{}", port), "-sTCP:LISTEN", "-Fpc"])
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
        let cwd_output = Command::new("lsof")
            .args(["-a", "-p", pid, "-d", "cwd", "-Fn"])
            .output()
            .ok();
        let cwd = cwd_output.as_ref().and_then(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .find_map(|line| line.strip_prefix('n').map(ToString::to_string))
        });
        return Some(match cwd {
            Some(cwd) => format!("{} (PID {}, cwd {})", process, pid, cwd),
            None => format!("{} (PID {})", process, pid),
        });
    }

    #[cfg(not(unix))]
    {
        let _ = port;
        None
    }
}

fn apply_network_proxy_env(
    resolved: &mut ResolvedProjectCommand,
    debug_profile: Option<&ProjectDebugProfileConfig>,
    runtime_profile: Option<&RuntimeProfileConfig>,
) -> Result<RuntimeNetworkProxyApplied, String> {
    let proxy = debug_profile
        .filter(|profile| profile.network_proxy.enabled)
        .map(|profile| &profile.network_proxy)
        .or_else(|| {
            runtime_profile
                .map(|profile| &profile.network_proxy)
                .filter(|proxy| proxy.enabled)
        });
    let Some(proxy) = proxy else {
        return Ok(RuntimeNetworkProxyApplied {
            enabled: false,
            node_hook: false,
        });
    };

    let proxy_url = proxy.proxy_url.trim();
    if proxy_url.is_empty() {
        return Err("启用网络代理时 proxy_url 不能为空".to_string());
    }
    let no_proxy = normalize_network_proxy_no_proxy(&proxy.no_proxy);
    if proxy.inject_env {
        for key in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
        ] {
            resolved.env.insert(key.to_string(), proxy_url.to_string());
        }
        resolved
            .env
            .insert("NO_PROXY".to_string(), no_proxy.clone());
        resolved
            .env
            .insert("no_proxy".to_string(), no_proxy.clone());
    }

    if proxy.node_hook {
        if !proxy_url.to_ascii_lowercase().starts_with("http://") {
            return Err("Node Hook 当前只支持 http:// 代理".to_string());
        }
        let hook_path = ensure_node_proxy_hook()?;
        let hook_path = hook_path.display().to_string();
        resolved.env.insert(
            "RDEVTOOL_NETWORK_PROXY_URL".to_string(),
            proxy_url.to_string(),
        );
        resolved
            .env
            .insert("RDEVTOOL_NETWORK_PROXY_NO_PROXY".to_string(), no_proxy);
        let node_options = merge_node_require_option(
            resolved.env.get("NODE_OPTIONS").map(String::as_str),
            &hook_path,
        );
        resolved
            .env
            .insert("NODE_OPTIONS".to_string(), node_options);
    }

    Ok(RuntimeNetworkProxyApplied {
        enabled: true,
        node_hook: proxy.node_hook,
    })
}

fn normalize_network_proxy_no_proxy(value: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        "localhost,127.0.0.1,::1".to_string()
    } else {
        value.to_string()
    }
}

fn ensure_node_proxy_hook() -> Result<PathBuf, String> {
    let hook_path = std::env::temp_dir().join(NODE_PROXY_HOOK_FILENAME);
    let needs_write = fs::read_to_string(&hook_path)
        .map(|content| content != NODE_PROXY_HOOK)
        .unwrap_or(true);
    if needs_write {
        fs::write(&hook_path, NODE_PROXY_HOOK)
            .map_err(|error| format!("写入 Node 代理 Hook 失败: {}", error))?;
    }
    Ok(hook_path)
}

fn merge_node_require_option(existing: Option<&str>, hook_path: &str) -> String {
    let require_option = format!("--require={}", hook_path);
    let existing = existing.map(str::trim).unwrap_or("");
    if existing.is_empty() {
        return require_option;
    }
    if existing.contains(hook_path) {
        return existing.to_string();
    }
    format!("{} {}", require_option, existing)
}

fn apply_debug_profile_local_files(
    project: &ProjectConfig,
    profile: &ProjectDebugProfileConfig,
) -> Result<usize, String> {
    let enabled_files = profile
        .local_files
        .iter()
        .filter(|item| item.enabled)
        .collect::<Vec<_>>();
    if enabled_files.is_empty() {
        return Ok(0);
    }
    let repo_path = project
        .repo_path
        .as_ref()
        .ok_or_else(|| "调试档案写入本地文件需要项目配置 repo_path".to_string())?;
    if !repo_path.exists() || !repo_path.is_dir() {
        return Err(format!(
            "项目目录不存在，无法应用调试档案: {}",
            repo_path.display()
        ));
    }
    let git_checked = repo_path.join(".git").exists();
    for local_file in &enabled_files {
        write_debug_local_file(repo_path, profile, local_file, git_checked)?;
    }
    Ok(enabled_files.len())
}

fn write_debug_local_file(
    repo_path: &Path,
    profile: &ProjectDebugProfileConfig,
    local_file: &ProjectDebugLocalFileConfig,
    git_checked: bool,
) -> Result<(), String> {
    let (target_path, relative_path) = resolve_debug_local_file_path(repo_path, &local_file.path)?;
    if git_checked {
        ensure_debug_local_file_git_safe(repo_path, &relative_path)?;
    }
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建本地调试文件目录失败: {}", error))?;
    }
    match local_file.mode.trim() {
        "" | "overwrite" => fs::write(&target_path, &local_file.content)
            .map_err(|error| format!("写入本地调试文件失败: {}", error)),
        "append_block" => write_debug_append_block(
            &target_path,
            &profile.key,
            &relative_path,
            &local_file.content,
        ),
        other => Err(format!(
            "本地调试文件 {} 使用了不支持的写入方式: {}",
            relative_path, other
        )),
    }
}

fn resolve_debug_local_file_path(
    repo_path: &Path,
    file_path: &Path,
) -> Result<(PathBuf, String), String> {
    if file_path.as_os_str().is_empty() {
        return Err("本地调试文件路径不能为空".to_string());
    }
    if file_path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(format!(
            "本地调试文件路径不能包含 ..: {}",
            file_path.display()
        ));
    }
    let target_path = if file_path.is_absolute() {
        if !file_path.starts_with(repo_path) {
            return Err(format!(
                "本地调试文件必须位于项目目录内: {}",
                file_path.display()
            ));
        }
        file_path.to_path_buf()
    } else {
        repo_path.join(file_path)
    };
    let relative_path = target_path
        .strip_prefix(repo_path)
        .map_err(|_| format!("本地调试文件必须位于项目目录内: {}", target_path.display()))?
        .to_string_lossy()
        .replace('\\', "/");
    Ok((target_path, relative_path))
}

fn ensure_debug_local_file_git_safe(repo_path: &Path, relative_path: &str) -> Result<(), String> {
    let tracked = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("ls-files")
        .arg("--error-unmatch")
        .arg("--")
        .arg(relative_path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| format!("检查本地调试文件 Git 状态失败: {}", error))?
        .success();
    if tracked {
        return Err(format!(
            "{} 已被 git 跟踪，拒绝用调试档案覆盖；请改用被 .gitignore 忽略的本地配置文件",
            relative_path
        ));
    }

    let ignored_status = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("check-ignore")
        .arg("-q")
        .arg("--")
        .arg(relative_path)
        .status()
        .map_err(|error| format!("检查本地调试文件 .gitignore 状态失败: {}", error))?;
    if !ignored_status.success() {
        return Err(format!(
            "{} 当前没有被 .gitignore 忽略；为避免误提交，请先加入 .gitignore 后再应用调试档案",
            relative_path
        ));
    }
    Ok(())
}

fn write_debug_append_block(
    target_path: &Path,
    profile_key: &str,
    relative_path: &str,
    content: &str,
) -> Result<(), String> {
    let existing = match fs::read_to_string(target_path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(format!("读取本地调试文件失败: {}", error)),
    };
    let start_marker = format!("# >>> rDevTool:{}:{}\n", profile_key, relative_path);
    let end_marker = format!("# <<< rDevTool:{}:{}\n", profile_key, relative_path);
    let block = format!(
        "{}{}\n{}",
        start_marker,
        content.trim_end_matches('\n'),
        end_marker
    );
    let next = if let (Some(start), Some(end)) = (
        existing.find(&start_marker),
        existing
            .find(&end_marker)
            .map(|index| index + end_marker.len()),
    ) {
        format!("{}{}{}", &existing[..start], block, &existing[end..])
    } else if existing.trim().is_empty() {
        block
    } else {
        format!("{}\n\n{}", existing.trim_end_matches('\n'), block)
    };
    fs::write(target_path, next).map_err(|error| format!("写入本地调试文件失败: {}", error))
}

fn focus_navigation_entry(
    project: &ProjectConfig,
    url: &str,
    debug_profile: Option<&ProjectDebugProfileConfig>,
    runtime_profile: Option<&RuntimeProfileConfig>,
) -> (NavigationEntry, Vec<RuntimeProfileConfig>) {
    let effective_profile = effective_focus_runtime_profile(debug_profile, runtime_profile);
    let runtime_profile_key = effective_profile
        .as_ref()
        .map(|profile| profile.key.clone());
    let entry = NavigationEntry {
        name: format!("{} runtime", project.name),
        kind: "url".to_string(),
        target_label: url.to_string(),
        url: Some(url.to_string()),
        browser: debug_profile.and_then(|profile| optional_owned(profile.browser.as_deref())),
        browser_profile: debug_profile
            .and_then(|profile| optional_owned(profile.browser_profile.as_deref())),
        runtime_profile: runtime_profile_key,
        bundle_id: None,
        app_name: None,
        script: None,
        tool: None,
        tool_key: None,
        tool_action: None,
        path: None,
        cwd: None,
        note: Some("runtime focus".to_string()),
    };
    (entry, effective_profile.into_iter().collect())
}

fn effective_focus_runtime_profile(
    debug_profile: Option<&ProjectDebugProfileConfig>,
    runtime_profile: Option<&RuntimeProfileConfig>,
) -> Option<RuntimeProfileConfig> {
    let has_debug_browser_config = debug_profile.is_some_and(|profile| {
        optional_trimmed(profile.browser.as_deref()).is_some()
            || optional_trimmed(profile.browser_profile.as_deref()).is_some()
            || profile.browser_user_data_dir.is_some()
            || profile
                .browser_args
                .iter()
                .any(|arg| !arg.trim().is_empty())
    });
    if runtime_profile.is_none() && !has_debug_browser_config {
        return None;
    }
    let mut profile = runtime_profile
        .cloned()
        .unwrap_or_else(|| RuntimeProfileConfig {
            key: "__project_focus".to_string(),
            label: "Project focus".to_string(),
            web_actions_port: 9223,
            ..RuntimeProfileConfig::default()
        });
    profile.key = "__project_focus".to_string();
    profile.label = "Project focus".to_string();
    if let Some(debug_profile) = debug_profile {
        if optional_trimmed(debug_profile.browser.as_deref()).is_some() {
            profile.browser = debug_profile.browser.clone();
        }
        if optional_trimmed(debug_profile.browser_profile.as_deref()).is_some() {
            profile.browser_profile = debug_profile.browser_profile.clone();
        }
        if debug_profile.browser_user_data_dir.is_some() {
            profile.browser_user_data_dir = debug_profile.browser_user_data_dir.clone();
        }
        profile
            .browser_args
            .extend(debug_profile.browser_args.iter().cloned());
    }
    Some(profile)
}

fn open_app_bundle(bundle_id: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let status = Command::new("open")
            .arg("-b")
            .arg(bundle_id)
            .status()
            .map_err(|error| format!("打开应用失败: {}", error))?;
        if status.success() {
            return Ok(());
        }
        return Err(format!("打开应用失败: {}", bundle_id));
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = bundle_id;
        Err("Bundle ID focus is only supported on macOS".to_string())
    }
}

fn preflight_command_checks(
    project: &ProjectConfig,
    debug_profile: Option<&ProjectDebugProfileConfig>,
    options: &ProjectRuntimeLaunchOptions,
    checks: &mut Vec<ProjectRuntimePreflightCheck>,
) {
    let Some(command_config) = project_command_config(project, RuntimeTaskKind::Dev) else {
        checks.push(preflight_check(
            "devCommand",
            "启动命令",
            "runtime",
            "error",
            "未配置 dev 命令",
            Some("在项目配置里补充 dev.command。"),
        ));
        checks.push(preflight_check(
            "devCwd",
            "工作目录",
            "runtime",
            "error",
            "无法确定 dev 工作目录",
            Some("配置 repo_path，或为 dev.cwd 指定绝对路径。"),
        ));
        return;
    };

    let command = optional_trimmed(options.command.as_deref())
        .or_else(|| debug_profile.and_then(|profile| optional_trimmed(profile.command.as_deref())))
        .unwrap_or_else(|| command_config.command.trim());
    if command.is_empty() {
        checks.push(preflight_check(
            "devCommand",
            "启动命令",
            "runtime",
            "error",
            "dev.command 为空",
            Some("补充可执行启动命令，例如 npm run serve。"),
        ));
    } else {
        checks.push(preflight_check(
            "devCommand",
            "启动命令",
            "runtime",
            "ok",
            command,
            None,
        ));
    }

    let cwd_result = resolve_debug_profile_cwd(project, debug_profile).and_then(|cwd| {
        cwd.map_or_else(
            || resolve_command_cwd(project, command_config, RuntimeTaskKind::Dev),
            Ok,
        )
    });
    let cwd = match cwd_result {
        Ok(path) => {
            if path.exists() && path.is_dir() {
                checks.push(preflight_check(
                    "devCwd",
                    "工作目录",
                    "runtime",
                    "ok",
                    path.display().to_string(),
                    None,
                ));
            } else if path.exists() {
                checks.push(preflight_check(
                    "devCwd",
                    "工作目录",
                    "runtime",
                    "error",
                    format!("不是目录: {}", path.display()),
                    Some("修正 dev.cwd 或项目 repo_path。"),
                ));
            } else {
                checks.push(preflight_check(
                    "devCwd",
                    "工作目录",
                    "runtime",
                    "error",
                    format!("目录不存在: {}", path.display()),
                    Some("修正 dev.cwd，或先拉取/创建项目目录。"),
                ));
            }
            Some(path)
        }
        Err(error) => {
            checks.push(preflight_check(
                "devCwd",
                "工作目录",
                "runtime",
                "error",
                error,
                Some("配置 repo_path，或为 dev.cwd 指定绝对路径。"),
            ));
            None
        }
    };

    if command_uses_node_tool(command) {
        let mut env = command_config.env.clone();
        if let Some(profile) = debug_profile {
            env.extend(profile.env.clone());
        }
        env.extend(options.env.clone());
        if let Some(detail) = node_version_hint(cwd.as_deref(), command, &env) {
            checks.push(preflight_check(
                "nodeVersion",
                "Node 版本",
                "runtime",
                "ok",
                detail,
                None,
            ));
        } else {
            checks.push(preflight_check(
                "nodeVersion",
                "Node 版本",
                "runtime",
                "warning",
                "启动命令使用 Node 工具，但没有发现明确版本线索",
                Some("建议在命令中使用 nvm use，或在项目目录放置 .nvmrc。"),
            ));
        }
    }
}

fn preflight_expected_port_check(
    project: &ProjectConfig,
    debug_profile: Option<&ProjectDebugProfileConfig>,
    options: &ProjectRuntimeLaunchOptions,
    checks: &mut Vec<ProjectRuntimePreflightCheck>,
) {
    let Ok(resolved) = resolve_runtime_command(project, debug_profile, options) else {
        return;
    };
    let Some(port) = resolve_expected_port(project, debug_profile, options, &resolved) else {
        return;
    };
    if port == 0 {
        checks.push(preflight_check(
            "devPort",
            "预期端口",
            "runtime",
            "error",
            "预期端口必须在 1-65535 之间",
            Some("修正调试档案或本次启动参数中的预期端口。"),
        ));
        return;
    }
    match TcpListener::bind(("127.0.0.1", port)) {
        Ok(listener) => {
            drop(listener);
            checks.push(preflight_check(
                "devPort",
                "预期端口",
                "runtime",
                "ok",
                format!("端口 {} 可用", port),
                None,
            ));
        }
        Err(_) => checks.push(preflight_check(
            "devPort",
            "预期端口",
            "runtime",
            "error",
            port_owner_detail(port)
                .map(|owner| format!("端口 {} 已被 {} 占用", port, owner))
                .unwrap_or_else(|| format!("端口 {} 已被占用", port)),
            Some("停止占用进程，或为本次启动选择其他预期端口。"),
        )),
    }
}

fn preflight_local_file_checks(
    project: &ProjectConfig,
    debug_profile: Option<&ProjectDebugProfileConfig>,
    checks: &mut Vec<ProjectRuntimePreflightCheck>,
) {
    let Some(profile) = debug_profile else {
        return;
    };
    let enabled_count = profile
        .local_files
        .iter()
        .filter(|item| item.enabled)
        .count();
    if enabled_count == 0 {
        checks.push(preflight_check(
            "localFiles",
            "本地文件",
            "runtime",
            "info",
            "未启用本地文件写入",
            None,
        ));
        return;
    }
    match project.repo_path.as_ref() {
        Some(path) if path.exists() && path.is_dir() => checks.push(preflight_check(
            "localFiles",
            "本地文件",
            "runtime",
            "ok",
            format!("启动前会应用 {} 个本地文件", enabled_count),
            None,
        )),
        Some(path) => checks.push(preflight_check(
            "localFiles",
            "本地文件",
            "runtime",
            "error",
            format!("repo_path 不存在，无法写入本地文件: {}", path.display()),
            Some("修正项目目录或先创建工作区项目副本。"),
        )),
        None => checks.push(preflight_check(
            "localFiles",
            "本地文件",
            "runtime",
            "error",
            "启用了本地文件写入，但项目没有 repo_path",
            Some("配置项目目录，或关闭本地文件写入。"),
        )),
    }
}

fn preflight_proxy_checks(
    debug_profile: Option<&ProjectDebugProfileConfig>,
    runtime_profile: Option<&RuntimeProfileConfig>,
    checks: &mut Vec<ProjectRuntimePreflightCheck>,
) {
    let debug_proxy = debug_profile.map(|profile| &profile.network_proxy);
    let runtime_proxy = runtime_profile.map(|profile| &profile.network_proxy);
    let active_proxy = debug_proxy
        .filter(|proxy| proxy.enabled)
        .or_else(|| runtime_proxy.filter(|proxy| proxy.enabled));
    if let Some(proxy) = active_proxy {
        let proxy_url = proxy.proxy_url.trim();
        if proxy_url.is_empty() {
            checks.push(preflight_check(
                "networkProxy",
                "Node 网络代理",
                "network",
                "error",
                "代理已启用，但 proxy_url 为空",
                Some("补充 proxy_url，或关闭网络代理。"),
            ));
            return;
        }
        if proxy.node_hook && !proxy_url.to_ascii_lowercase().starts_with("http://") {
            checks.push(preflight_check(
                "networkProxy",
                "Node 网络代理",
                "network",
                "error",
                "Node Hook 当前只支持 http:// 代理",
                Some("改用 http:// 本地代理，或关闭 Node Hook。"),
            ));
            return;
        }
        let mut modes = Vec::new();
        if proxy.inject_env {
            modes.push("环境变量");
        }
        if proxy.node_hook {
            modes.push("Node Hook");
        }
        let mode_label = if modes.is_empty() {
            "未注入".to_string()
        } else {
            modes.join(" + ")
        };
        checks.push(preflight_check(
            "networkProxy",
            "Node 网络代理",
            "network",
            "ok",
            format!("{} · {}", proxy_url, mode_label),
            None,
        ));
    } else {
        checks.push(preflight_check(
            "networkProxy",
            "Node 网络代理",
            "network",
            "info",
            "未启用 Node 侧代理注入",
            Some("如果 dev server 代理接口出现 ENOTFOUND，可在调试档案启用网络代理。"),
        ));
    }

    if let Some(profile) = runtime_profile {
        if let Some(proxy_id) = optional_trimmed(profile.rdev_proxy_profile_id.as_deref()) {
            checks.push(preflight_check(
                "runtimeProxy",
                "本地代理服务",
                "network",
                "ok",
                format!("运行配置绑定代理服务 {}", proxy_id),
                None,
            ));
        }
    }
}

fn preflight_runtime_profile_checks(
    runtime_profile_key: Option<&str>,
    runtime_profile: Option<&RuntimeProfileConfig>,
    checks: &mut Vec<ProjectRuntimePreflightCheck>,
) {
    match (runtime_profile_key, runtime_profile) {
        (Some(_), Some(profile)) => {
            if profile.web_actions_enabled {
                checks.push(preflight_check(
                    "webActionsCdp",
                    "网页动作受控浏览器",
                    "webActions",
                    "ok",
                    format!("{} · CDP {}", profile.label, profile.web_actions_port),
                    None,
                ));
            } else {
                checks.push(preflight_check(
                    "webActionsCdp",
                    "网页动作受控浏览器",
                    "webActions",
                    "warning",
                    format!("{} 未开启 Web Actions/CDP", profile.label),
                    Some("在运行配置里开启 Web Actions，项目页面才能稳定出现在受控页面。"),
                ));
            }
        }
        (Some(key), None) => checks.push(preflight_check(
            "webActionsCdp",
            "网页动作受控浏览器",
            "webActions",
            "error",
            format!("运行配置不存在: {}", key),
            Some("重新绑定存在的运行配置，或新建运行配置。"),
        )),
        (None, _) => checks.push(preflight_check(
            "webActionsCdp",
            "网页动作受控浏览器",
            "webActions",
            "warning",
            "调试档案未绑定运行配置",
            Some("绑定开启 Web Actions 的运行配置，可让启动页面被网页动作自动发现。"),
        )),
    }
}

fn preflight_focus_checks(
    project: &ProjectConfig,
    debug_profile: Option<&ProjectDebugProfileConfig>,
    checks: &mut Vec<ProjectRuntimePreflightCheck>,
) {
    let focus_url = effective_project_focus_url(project, debug_profile).unwrap_or_default();
    if focus_url.starts_with("http://") || focus_url.starts_with("https://") {
        checks.push(preflight_check(
            "focusUrl",
            "启动页面",
            "webActions",
            "ok",
            &focus_url,
            None,
        ));
    } else if focus_url.is_empty() {
        checks.push(preflight_check(
            "focusUrl",
            "启动页面",
            "webActions",
            "warning",
            "未配置 focus.url",
            Some("配置项目启动后的页面地址，网页动作才能按项目上下文过滤动作。"),
        ));
    } else {
        checks.push(preflight_check(
            "focusUrl",
            "启动页面",
            "webActions",
            "warning",
            format!("focus URL 不是 HTTP 地址: {}", focus_url),
            Some("网页动作需要 http:// 或 https:// 地址。"),
        ));
    }

    if let Some(probe) = debug_profile.and_then(|profile| profile.ready_probe.as_ref()) {
        let statuses_valid = probe
            .expected_statuses
            .iter()
            .all(|status| (100..=599).contains(status));
        let timeout_valid = probe
            .timeout_ms
            .is_none_or(|timeout| (100..=600_000).contains(&timeout));
        let resolved_url = resolve_runtime_probe_url(
            probe.url.as_deref(),
            probe.path.as_deref(),
            None,
            Some(&focus_url),
            None,
        );
        if statuses_valid && timeout_valid && resolved_url.is_ok() {
            checks.push(preflight_check(
                "readyProbe",
                "HTTP Ready 探测",
                "runtime",
                "ok",
                resolved_url
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "等待运行端口".to_string()),
                None,
            ));
        } else {
            let detail = resolved_url
                .err()
                .or_else(|| (!statuses_valid).then(|| "HTTP 状态码必须在 100-599 之间".to_string()))
                .or_else(|| (!timeout_valid).then(|| "超时必须在 100-600000ms 之间".to_string()))
                .unwrap_or_else(|| "readyProbe 配置无效".to_string());
            checks.push(preflight_check(
                "readyProbe",
                "HTTP Ready 探测",
                "runtime",
                "error",
                detail,
                Some("修正调试档案的 readyProbe 配置。"),
            ));
        }
    }

    let ready = &project.focus.ready;
    if ready.enabled && !ready.url_patterns.is_empty() {
        checks.push(preflight_check(
            "readyDetection",
            "Ready 检测",
            "runtime",
            "ok",
            format!(
                "{}ms · {} 个 URL 模式",
                ready.timeout_ms,
                ready.url_patterns.len()
            ),
            None,
        ));
    } else if ready.enabled {
        checks.push(preflight_check(
            "readyDetection",
            "Ready 检测",
            "runtime",
            "warning",
            "Ready 检测启用，但没有 URL 模式",
            Some("补充 URL 模式，例如 Local: {url}。"),
        ));
    } else {
        checks.push(preflight_check(
            "readyDetection",
            "Ready 检测",
            "runtime",
            "warning",
            "未启用 Ready 检测",
            Some("启用 Ready 检测后，可自动使用真实启动端口打开页面。"),
        ));
    }

    let after_actions = project
        .focus
        .after_ready_actions
        .iter()
        .map(|key| key.trim())
        .filter(|key| !key.is_empty())
        .collect::<Vec<_>>();
    if after_actions.is_empty() {
        checks.push(preflight_check(
            "afterReadyActions",
            "启动后动作",
            "webActions",
            "info",
            "未配置启动后动作",
            Some("可填写网页动作 key，在项目 ready 后自动执行登录、跳转或检查。"),
        ));
        return;
    }

    match list_web_actions(None, None) {
        Ok(actions) => {
            let available = actions
                .actions
                .iter()
                .map(|action| action.key.as_str())
                .collect::<std::collections::BTreeSet<_>>();
            let missing = after_actions
                .iter()
                .filter(|key| !available.contains(**key))
                .copied()
                .collect::<Vec<_>>();
            if missing.is_empty() {
                checks.push(preflight_check(
                    "afterReadyActions",
                    "启动后动作",
                    "webActions",
                    "ok",
                    format!(
                        "{} 个动作: {}",
                        after_actions.len(),
                        after_actions.join(", ")
                    ),
                    None,
                ));
            } else {
                checks.push(preflight_check(
                    "afterReadyActions",
                    "启动后动作",
                    "webActions",
                    "error",
                    format!("动作不存在: {}", missing.join(", ")),
                    Some("检查 web_actions.toml，或修正 focus.after_ready_actions。"),
                ));
            }
        }
        Err(error) => checks.push(preflight_check(
            "afterReadyActions",
            "启动后动作",
            "webActions",
            "error",
            format!("读取网页动作配置失败: {}", error),
            Some("修复 web_actions.toml 后再启动项目。"),
        )),
    }
}

fn command_uses_node_tool(command: &str) -> bool {
    let command = command.to_ascii_lowercase();
    [
        "npm ",
        "npm run",
        "pnpm ",
        "yarn ",
        "node ",
        "vite",
        "webpack",
        "vue-cli-service",
        "react-scripts",
    ]
    .iter()
    .any(|token| command.contains(token))
}

fn node_version_hint(
    cwd: Option<&Path>,
    command: &str,
    env: &BTreeMap<String, String>,
) -> Option<String> {
    detect_node_version(cwd, command, env).map(|detected| match detected.source.as_str() {
        "command" => detected.value,
        "env" => detected.value,
        "nvmrc" | "nodeVersionFile" => format!(
            "{} {}",
            detected
                .path
                .as_deref()
                .and_then(|path| Path::new(path).file_name())
                .and_then(|name| name.to_str())
                .unwrap_or("Node version file"),
            detected.value
        ),
        "packageEngines" => format!("package.json engines.node {}", detected.value),
        _ => detected.value,
    })
}

fn detect_node_version(
    cwd: Option<&Path>,
    command: &str,
    env: &BTreeMap<String, String>,
) -> Option<ProjectRuntimeNodeVersionInspect> {
    let lower_command = command.to_ascii_lowercase();
    if lower_command.contains("nvm use") {
        return Some(ProjectRuntimeNodeVersionInspect {
            value: "命令中包含 nvm use".to_string(),
            source: "command".to_string(),
            path: None,
        });
    }
    if lower_command.contains("volta") {
        return Some(ProjectRuntimeNodeVersionInspect {
            value: "命令中包含 Volta".to_string(),
            source: "command".to_string(),
            path: None,
        });
    }
    for key in ["NODE_VERSION", "npm_config_target"] {
        if let Some(value) = env
            .get(key)
            .map(String::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some(ProjectRuntimeNodeVersionInspect {
                value: format!("{}={}", key, value),
                source: "env".to_string(),
                path: None,
            });
        }
    }
    let cwd = cwd?;
    for file_name in [".nvmrc", ".node-version"] {
        let path = cwd.join(file_name);
        if let Ok(value) = fs::read_to_string(&path) {
            let version = value.trim();
            if !version.is_empty() {
                return Some(ProjectRuntimeNodeVersionInspect {
                    value: version.to_string(),
                    source: if file_name == ".nvmrc" {
                        "nvmrc".to_string()
                    } else {
                        "nodeVersionFile".to_string()
                    },
                    path: Some(path.display().to_string()),
                });
            }
        }
    }
    package_json_node_engine(cwd).map(|value| ProjectRuntimeNodeVersionInspect {
        value,
        source: "packageEngines".to_string(),
        path: Some(cwd.join("package.json").display().to_string()),
    })
}

fn package_json_node_engine(cwd: &Path) -> Option<String> {
    let value = fs::read_to_string(cwd.join("package.json")).ok()?;
    let value = serde_json::from_str::<serde_json::Value>(&value).ok()?;
    value
        .get("engines")
        .and_then(|engines| engines.get("node"))
        .and_then(|node| node.as_str())
        .map(ToString::to_string)
}

fn preflight_check(
    key: impl Into<String>,
    title: impl Into<String>,
    category: impl Into<String>,
    status_key: &'static str,
    detail: impl Into<String>,
    action: Option<&str>,
) -> ProjectRuntimePreflightCheck {
    ProjectRuntimePreflightCheck {
        key: key.into(),
        title: title.into(),
        category: category.into(),
        status_key: status_key.to_string(),
        status_label: preflight_status_label(status_key).to_string(),
        detail: detail.into(),
        action: action.map(ToString::to_string),
    }
}

fn preflight_status_label(status_key: &str) -> &'static str {
    match status_key {
        "ok" => "正常",
        "warning" => "关注",
        "error" => "异常",
        _ => "信息",
    }
}

fn summarize_preflight(checks: &[ProjectRuntimePreflightCheck]) -> (String, String, String) {
    let errors = checks
        .iter()
        .filter(|check| check.status_key == "error")
        .count();
    let warnings = checks
        .iter()
        .filter(|check| check.status_key == "warning")
        .count();
    if errors > 0 {
        return (
            "error".to_string(),
            "需要修复".to_string(),
            format!("{} 个异常 · {} 个关注项", errors, warnings),
        );
    }
    if warnings > 0 {
        return (
            "warning".to_string(),
            "可优化".to_string(),
            format!("{} 个关注项", warnings),
        );
    }
    (
        "ok".to_string(),
        "可启动".to_string(),
        "关键链路正常".to_string(),
    )
}

fn tail_log_lines(
    path: &Path,
    max_lines: usize,
) -> Result<(Vec<String>, bool, ProjectRuntimeLogSessionSummary), String> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok((Vec::new(), false, ProjectRuntimeLogSessionSummary::empty(0)));
        }
        Err(error) => return Err(format!("读取运行日志失败: {}", error)),
    };
    let reader = BufReader::new(file);
    let mut lines = VecDeque::with_capacity(max_lines.saturating_add(1));
    let mut total = 0usize;
    let mut session_summary = ProjectRuntimeLogSessionSummary::empty(0);
    for line in reader.lines() {
        total += 1;
        let line = line.map_err(|error| format!("读取运行日志失败: {}", error))?;
        if let Some(mut next_session) = parse_runtime_session_marker(&line) {
            next_session.total_line_count = total;
            session_summary = next_session;
        } else {
            if session_summary.active {
                session_summary.current_line_count += 1;
                if session_summary.pid.is_none() {
                    session_summary.pid = parse_running_pid(&line);
                }
                if is_runtime_session_end_line(&line) {
                    session_summary.active = false;
                }
            }
            session_summary.total_line_count = total;
        }
        if lines.len() == max_lines {
            lines.pop_front();
        }
        lines.push_back(line);
    }
    session_summary.total_line_count = total;
    Ok((
        lines.into_iter().collect(),
        total > max_lines,
        session_summary,
    ))
}

fn tail_runtime_session_lines(
    path: &Path,
    max_lines: usize,
    requested_run_id: Option<&str>,
) -> Result<(Vec<String>, bool, ProjectRuntimeLogSessionSummary), String> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok((Vec::new(), false, ProjectRuntimeLogSessionSummary::empty(0)));
        }
        Err(error) => return Err(format!("读取运行日志失败: {}", error)),
    };
    let reader = BufReader::new(file);
    let mut selected_lines = VecDeque::with_capacity(max_lines.saturating_add(1));
    let mut selected_line_count = 0usize;
    let mut total_line_count = 0usize;
    let mut selecting = false;
    let mut found = false;
    let mut session_summary = ProjectRuntimeLogSessionSummary::empty(0);

    for line in reader.lines() {
        total_line_count += 1;
        let line = line.map_err(|error| format!("读取运行日志失败: {}", error))?;
        if let Some(mut next_session) = parse_runtime_session_marker(&line) {
            let matches_requested = requested_run_id
                .map(|requested| next_session.run_id.as_deref() == Some(requested))
                .unwrap_or(true);
            if requested_run_id.is_none() {
                selected_lines.clear();
                selected_line_count = 0;
                selecting = true;
                found = true;
                next_session.total_line_count = total_line_count;
                session_summary = next_session;
                push_bounded_log_line(&mut selected_lines, max_lines, line);
            } else if matches_requested {
                selecting = true;
                found = true;
                next_session.total_line_count = total_line_count;
                session_summary = next_session;
                selected_line_count = 0;
                selected_lines.clear();
                push_bounded_log_line(&mut selected_lines, max_lines, line);
            } else if selecting {
                selecting = false;
                session_summary.active = false;
            }
            continue;
        }

        if selecting {
            selected_line_count += 1;
            session_summary.current_line_count += 1;
            if session_summary.pid.is_none() {
                session_summary.pid = parse_running_pid(&line);
            }
            if is_runtime_session_end_line(&line) {
                session_summary.active = false;
                selecting = false;
            }
            push_bounded_log_line(&mut selected_lines, max_lines, line);
        }
    }
    session_summary.total_line_count = total_line_count;
    if let Some(requested_run_id) = requested_run_id
        && !found
    {
        return Err(format!("runtime log session not found: {requested_run_id}"));
    }
    Ok((
        selected_lines.into_iter().collect(),
        selected_line_count.saturating_add(1) > max_lines,
        session_summary,
    ))
}

fn push_bounded_log_line(lines: &mut VecDeque<String>, max_lines: usize, line: String) {
    if lines.len() == max_lines {
        lines.pop_front();
    }
    lines.push_back(line);
}

fn parse_runtime_session_marker(line: &str) -> Option<ProjectRuntimeLogSessionSummary> {
    let value = serde_json::from_str::<serde_json::Value>(line).ok()?;
    if value.get("rdevtool")?.as_str()? != "runtimeSession" {
        return None;
    }
    Some(ProjectRuntimeLogSessionSummary {
        active: true,
        run_id: value
            .get("runId")
            .and_then(|item| item.as_str())
            .map(ToString::to_string),
        project_key: value
            .get("projectKey")
            .and_then(|item| item.as_str())
            .map(ToString::to_string),
        kind: value
            .get("kind")
            .and_then(|item| item.as_str())
            .map(ToString::to_string),
        started_at_ms: value.get("startedAtMs").and_then(|item| item.as_u64()),
        cwd: value
            .get("cwd")
            .and_then(|item| item.as_str())
            .map(ToString::to_string),
        command: value
            .get("command")
            .and_then(|item| item.as_str())
            .map(ToString::to_string),
        pid: None,
        current_line_count: 0,
        total_line_count: 0,
    })
}

fn parse_running_pid(line: &str) -> Option<u32> {
    let (_, suffix) = line.split_once("running pid=")?;
    suffix
        .split_whitespace()
        .next()
        .and_then(|value| value.parse::<u32>().ok())
}

fn is_runtime_session_end_line(line: &str) -> bool {
    line.contains("exited quickly status=")
}

fn project_runtime_ready_summary(
    project: &ProjectConfig,
    kind: RuntimeTaskKind,
    lines: &[String],
) -> ProjectRuntimeReadySummary {
    if kind != RuntimeTaskKind::Dev || !project.focus.ready.enabled {
        return ProjectRuntimeReadySummary::disabled();
    }

    let ready = &project.focus.ready;
    let mut summary = ProjectRuntimeReadySummary::pending();
    let start_index = latest_task_start_index(lines, kind);
    let recent_lines = &lines[start_index..];
    let mut saw_success_marker = false;
    let mut failure_detail = None;

    for line in recent_lines {
        if let Some(url) = extract_ready_url(line, ready) {
            if line.to_ascii_lowercase().contains("network") {
                summary.network_url = Some(url.clone());
            } else {
                summary.local_url = Some(url.clone());
            }
            if summary.url.is_none() || line.to_ascii_lowercase().contains("local") {
                summary.url = Some(url);
            }
            summary.ready = true;
            saw_success_marker = true;
            continue;
        }

        if contains_any_marker(
            line,
            &ready.success_markers,
            default_ready_success_markers(),
        ) {
            saw_success_marker = true;
        }

        if !summary.ready {
            if let Some(marker) = matched_marker(
                line,
                &ready.failure_markers,
                default_ready_failure_markers(),
            ) {
                failure_detail = Some(format!("检测到启动异常: {}", marker));
            }
        }
    }

    if summary.ready || saw_success_marker {
        summary.ready = true;
        summary.failed = false;
        summary.status_key = "ready".to_string();
        summary.status_label = "已启动".to_string();
        if summary.url.is_none() {
            summary.url = project
                .focus
                .url
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string);
        }
        summary.detail = summary
            .url
            .as_ref()
            .map(|url| format!("检测到可访问地址 {}", url))
            .or_else(|| Some("检测到启动成功标记".to_string()));
        return summary;
    }

    if let Some(detail) = failure_detail {
        summary.failed = true;
        summary.status_key = "failed".to_string();
        summary.status_label = "启动异常".to_string();
        summary.detail = Some(detail);
    }

    summary
}

fn latest_task_start_index(lines: &[String], kind: RuntimeTaskKind) -> usize {
    lines
        .iter()
        .rposition(|line| line.contains(kind.log_label()) && line.contains(" key="))
        .unwrap_or(0)
}

fn extract_ready_url(line: &str, ready: &ProjectReadyConfig) -> Option<String> {
    ready
        .url_patterns
        .iter()
        .find_map(|pattern| extract_url_with_pattern(line, pattern))
}

fn extract_url_with_pattern(line: &str, pattern: &str) -> Option<String> {
    let trimmed_pattern = pattern.trim();
    if trimmed_pattern.is_empty() {
        return None;
    }
    let Some((prefix, suffix)) = trimmed_pattern.split_once("{url}") else {
        return line
            .contains(trimmed_pattern)
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
        let suffix_start = value.find(suffix)?;
        value = &value[..suffix_start];
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
        if token.starts_with("http://") || token.starts_with("https://") {
            Some(token.to_string())
        } else {
            None
        }
    })
}

fn contains_any_marker(line: &str, markers: &[String], fallback: Vec<String>) -> bool {
    matched_marker(line, markers, fallback).is_some()
}

fn matched_marker(line: &str, markers: &[String], fallback: Vec<String>) -> Option<String> {
    let normalized_line = line.to_ascii_lowercase();
    let source = if markers.is_empty() {
        fallback
    } else {
        markers.to_vec()
    };
    source.into_iter().find(|marker| {
        let marker = marker.trim();
        !marker.is_empty() && normalized_line.contains(&marker.to_ascii_lowercase())
    })
}

fn default_ready_success_markers() -> Vec<String> {
    Vec::new()
}

fn default_ready_failure_markers() -> Vec<String> {
    vec![
        "Failed to compile".to_string(),
        "Compilation failed".to_string(),
        "EADDRINUSE".to_string(),
    ]
}

fn task_log_path(project: &ProjectConfig, kind: RuntimeTaskKind) -> PathBuf {
    default_config_dir().join("runtime-logs").join(format!(
        "{}-{}.log",
        sanitize_log_name(&project.key),
        kind.log_file_suffix()
    ))
}

pub fn sanitize_log_name(value: &str) -> String {
    let normalized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if normalized.is_empty() {
        "project".to_string()
    } else {
        normalized
    }
}

fn resolve_command_cwd(
    project: &ProjectConfig,
    command_config: &ProjectCommandConfig,
    kind: RuntimeTaskKind,
) -> Result<PathBuf, String> {
    if let Some(cwd) = command_config.cwd.as_ref() {
        if cwd.is_absolute() {
            return Ok(cwd.clone());
        }

        let Some(repo_path) = project.repo_path.as_ref() else {
            return Err(format!(
                "{} 使用相对路径时，项目必须配置 repo_path",
                kind.config_block()
            ));
        };
        return Ok(repo_path.join(cwd));
    }

    project
        .repo_path
        .clone()
        .ok_or_else(|| format!("缺少 repo_path，无法确定{}", kind.cwd_label()))
}

fn project_command_config(
    project: &ProjectConfig,
    kind: RuntimeTaskKind,
) -> Option<&ProjectCommandConfig> {
    match kind {
        RuntimeTaskKind::Dev => project.dev.as_ref(),
        RuntimeTaskKind::Build => project.build.as_ref(),
    }
}

fn optional_trimmed(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn optional_owned(value: Option<&str>) -> Option<String> {
    optional_trimmed(value).map(ToString::to_string)
}

impl RuntimeTaskKind {
    fn config_block(self) -> &'static str {
        match self {
            Self::Dev => "[projects.dev]",
            Self::Build => "[projects.build]",
        }
    }

    fn cwd_label(self) -> &'static str {
        match self {
            Self::Dev => "启动目录",
            Self::Build => "打包目录",
        }
    }

    fn log_label(self) -> &'static str {
        match self {
            Self::Dev => "dev start",
            Self::Build => "build start",
        }
    }

    fn log_file_suffix(self) -> &'static str {
        match self {
            Self::Dev => "dev",
            Self::Build => "build",
        }
    }

    fn missing_config_message(self) -> &'static str {
        match self {
            Self::Dev => "在 projects.toml 里为该项目添加 [projects.dev] 并配置 command",
            Self::Build => "在 projects.toml 里为该项目添加可选的 [projects.build] 并配置 command",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ProjectRuntimeContextEffective, ProjectRuntimeContextObserved,
        ProjectRuntimeContextRequest, ProjectRuntimeContextSnapshot,
        ProjectRuntimeReadyProbeSummary, ProjectRuntimeSessionObservation,
        ProjectRuntimeTargetSummary, apply_vite_strict_port, command_port,
        inspect_project_environment, package_script_name, probe_runtime_http,
        project_runtime_context_snapshot, resolve_runtime_probe_url, resolve_runtime_profile,
        resolve_runtime_target_summary, runtime_http_status_matches, shell_command_contains_vite,
        tail_runtime_session_lines, vite_script_info,
    };
    use crate::config::{AppConfig, ProjectConfig, ProjectDebugProfileConfig};
    use crate::operation::{
        ManagedArtifact, OperationEvidence, OperationStatus, RecommendedAction,
    };
    use crate::runtime::ProjectRuntimeLaunchOptions;
    use serde_json::json;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn parses_common_dev_server_port_arguments() {
        assert_eq!(command_port("vite --port 1420"), Some(1420));
        assert_eq!(command_port("vite --port=5173"), Some(5173));
        assert_eq!(command_port("npm run dev"), None);
    }

    #[test]
    fn detects_package_script_port_and_environment_metadata() {
        let cwd = std::env::temp_dir().join(format!(
            "rdevtool-runtime-environment-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&cwd).unwrap();
        std::fs::write(
            cwd.join("package.json"),
            r#"{
  "name": "demo-web",
  "packageManager": "pnpm@9.1.0",
  "engines": { "node": ">=20" },
  "scripts": { "dev": "vite --port 4173" }
}"#,
        )
        .unwrap();
        let project: ProjectConfig = serde_json::from_value(json!({
            "key": "demo-web",
            "name": "Demo Web",
            "repo_path": cwd,
            "dev": { "command": "pnpm dev" }
        }))
        .unwrap();

        let environment =
            inspect_project_environment(&project, None, &ProjectRuntimeLaunchOptions::default());

        assert_eq!(environment.status_key, "detected");
        assert_eq!(environment.dev.script_name.as_deref(), Some("dev"));
        assert_eq!(
            environment.dev.script_command.as_deref(),
            Some("vite --port 4173")
        );
        assert!(environment.dev.vite);
        assert_eq!(environment.dev.package_manager.as_deref(), Some("pnpm"));
        assert_eq!(environment.port.effective_port, Some(4173));
        assert_eq!(environment.port.source.as_deref(), Some("packageScript"));
        assert_eq!(
            environment
                .node_version
                .as_ref()
                .map(|item| item.source.as_str()),
            Some("packageEngines")
        );

        std::fs::remove_dir_all(project.repo_path.unwrap()).unwrap();
    }

    #[test]
    fn debug_profile_runtime_target_resolves_cwd_focus_and_launch_precedence() {
        let repo =
            std::env::temp_dir().join(format!("rdevtool-runtime-target-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(repo.join("worktrees/feature")).unwrap();
        let project: ProjectConfig = serde_json::from_value(json!({
            "key": "demo-web",
            "name": "Demo Web",
            "repo_path": repo,
            "dev": { "command": "npm run dev" },
            "focus": { "url": "http://127.0.0.1:3000/" }
        }))
        .unwrap();
        let profile = ProjectDebugProfileConfig {
            command: Some("npm run profile".to_string()),
            cwd: Some("worktrees/feature".into()),
            focus_url: Some("http://127.0.0.1:4173/debug".to_string()),
            ..ProjectDebugProfileConfig::default()
        };
        let options = ProjectRuntimeLaunchOptions {
            command: Some("npm run once".to_string()),
            ..ProjectRuntimeLaunchOptions::default()
        };
        let target = resolve_runtime_target_summary(&project, Some(&profile), &options).unwrap();
        assert_eq!(target.command, "npm run once");
        assert_eq!(target.command_source, "launchOverride");
        assert_eq!(target.cwd_source, "debugProfile");
        assert!(target.cwd.ends_with("worktrees/feature"));
        assert_eq!(target.expected_port, Some(4173));
        assert_eq!(
            target.expected_port_source.as_deref(),
            Some("debugProfileFocusUrl")
        );
        assert_eq!(target.focus_url.as_deref(), profile.focus_url.as_deref());

        std::fs::remove_dir_all(project.repo_path.unwrap()).unwrap();
    }

    #[test]
    fn runtime_context_snapshot_keeps_requested_effective_and_observed_separate() {
        let repo =
            std::env::temp_dir().join(format!("rdevtool-runtime-context-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(repo.join("worktrees/feature")).unwrap();
        let project_key = format!("runtime-context-{}", uuid::Uuid::new_v4());
        let config: AppConfig = serde_json::from_value(json!({
            "defaults": {
                "runtime_profiles": [{
                    "key": "browser",
                    "label": "Browser"
                }]
            },
            "projects": [{
                "key": project_key,
                "name": "Runtime Context",
                "git_url": "",
                "repo_path": repo,
                "dev": { "command": "npm run dev" },
                "focus": { "url": "http://127.0.0.1:3000/" },
                "debug_profiles": [{
                    "key": "feature",
                    "label": "Feature",
                    "cwd": "worktrees/feature",
                    "runtime_profile": "browser",
                    "focus_url": "http://127.0.0.1:4173/debug",
                    "ready_probe": {
                        "path": "/health",
                        "expected_statuses": [204]
                    }
                }]
            }]
        }))
        .unwrap();
        let snapshot = project_runtime_context_snapshot(
            &config,
            &project_key,
            &ProjectRuntimeLaunchOptions {
                debug_profile: Some("feature".to_string()),
                ..ProjectRuntimeLaunchOptions::default()
            },
        )
        .unwrap();

        assert_eq!(
            snapshot.requested.debug_profile_key.as_deref(),
            Some("feature")
        );
        assert_eq!(
            snapshot.effective.runtime_profile_key.as_deref(),
            Some("browser")
        );
        let target = snapshot.effective.target.as_ref().unwrap();
        assert!(target.cwd.ends_with("worktrees/feature"));
        assert_eq!(
            target.focus_url.as_deref(),
            Some("http://127.0.0.1:4173/debug")
        );
        assert_eq!(
            target
                .ready_probe
                .as_ref()
                .and_then(|probe| probe.path.as_deref()),
            Some("/health")
        );
        assert!(snapshot.observed.available);
        assert!(snapshot.observed.sessions.is_empty());
        assert_eq!(snapshot.status.key, "configured");
        assert!(snapshot.status.success);
        assert!(!snapshot.evidence.is_empty());
        assert!(!snapshot.recommended_actions.is_empty());

        std::fs::remove_dir_all(repo).unwrap();
    }

    #[test]
    fn runtime_context_snapshot_json_contract_matches_fixture() {
        let ready_probe = ProjectRuntimeReadyProbeSummary {
            url: None,
            path: Some("/health".to_string()),
            expected_statuses: vec![204],
            timeout_ms: Some(90_000),
        };
        let snapshot = ProjectRuntimeContextSnapshot {
            schema_version: 1,
            requested: ProjectRuntimeContextRequest {
                project_key: "demo-web".to_string(),
                debug_profile_key: Some("feature".to_string()),
                runtime_profile_key: Some("browser".to_string()),
                command: None,
                expected_port: None,
                env_keys: vec!["MODE".to_string()],
            },
            effective: ProjectRuntimeContextEffective {
                debug_profile_key: Some("feature".to_string()),
                debug_profile_label: Some("Feature".to_string()),
                runtime_profile_key: Some("browser".to_string()),
                runtime_profile_label: Some("Browser".to_string()),
                target: Some(ProjectRuntimeTargetSummary {
                    command: "npm run dev".to_string(),
                    command_source: "projectDev".to_string(),
                    cwd: "/workspace/demo-web".to_string(),
                    cwd_source: "debugProfile".to_string(),
                    expected_port: Some(4173),
                    expected_port_source: Some("debugProfile".to_string()),
                    focus_url: Some("http://127.0.0.1:4173/debug".to_string()),
                    focus_url_source: Some("debugProfile".to_string()),
                    ready_probe: Some(ready_probe.clone()),
                }),
            },
            observed: ProjectRuntimeContextObserved {
                available: true,
                sessions: vec![ProjectRuntimeSessionObservation {
                    run_id: Some("run-demo-1".to_string()),
                    phase: "ready".to_string(),
                    running: true,
                    managed: true,
                    adopted: false,
                    cwd: "/workspace/demo-web".to_string(),
                    expected_port: Some(4173),
                    ready_url: Some("http://127.0.0.1:4173/health".to_string()),
                    ready_probe: Some(ready_probe),
                    daemon_pid: Some(4100),
                    worker_pid: Some(4200),
                    started_at_ms: Some(1_784_563_200_000),
                    log_path: Some("/workspace/.rdevtool/runtime/demo-web.log".to_string()),
                }],
            },
            status: OperationStatus {
                key: "running".to_string(),
                label: "运行中".to_string(),
                success: true,
                terminal: false,
                detail: "当前目录存在 rDevTool 管理的运行会话。".to_string(),
            },
            evidence: vec![OperationEvidence {
                kind: "config".to_string(),
                source: "debugProfile".to_string(),
                detail: "cwd=/workspace/demo-web".to_string(),
            }],
            risks: vec![],
            managed_artifacts: vec![ManagedArtifact {
                kind: "runtimeLog".to_string(),
                path: "/workspace/.rdevtool/runtime/demo-web.log".to_string(),
                ownership: "rdevtool".to_string(),
                lifecycle: "session".to_string(),
            }],
            recommended_actions: vec![RecommendedAction {
                command: "rdevtool runtime log --project demo-web --current".to_string(),
                reason: "查看当前运行会话日志".to_string(),
                risk: "readOnly".to_string(),
            }],
        };

        let actual = serde_json::to_value(snapshot).expect("serialize runtime context snapshot");
        let expected: serde_json::Value = serde_json::from_str(include_str!(
            "../tests/fixtures/runtime-context-snapshot.json"
        ))
        .expect("parse runtime context contract fixture");
        assert_eq!(actual, expected);
    }

    #[test]
    fn explicit_runtime_profile_takes_priority_over_debug_inheritance() {
        let config: AppConfig = toml::from_str(
            r#"
projects = []

[defaults]

[[defaults.runtime_profiles]]
key = "inherited"
label = "Inherited"

[[defaults.runtime_profiles]]
key = "explicit"
label = "Explicit"
"#,
        )
        .unwrap();
        let debug_profile = ProjectDebugProfileConfig {
            runtime_profile: Some("inherited".to_string()),
            ..ProjectDebugProfileConfig::default()
        };
        let selected = resolve_runtime_profile(&config, Some(&debug_profile), Some("explicit"))
            .unwrap()
            .unwrap();
        assert_eq!(selected.key, "explicit");
    }

    #[test]
    fn vite_strict_port_is_added_once_for_direct_and_npm_commands() {
        assert_eq!(
            apply_vite_strict_port("vite --port 5173", Some(5173), true, false),
            "vite --port 5173 --strictPort"
        );
        assert_eq!(
            apply_vite_strict_port("npm run dev", Some(5173), true, false),
            "npm run dev -- --strictPort"
        );
        assert_eq!(
            apply_vite_strict_port("npm run dev -- --host", Some(5173), true, false),
            "npm run dev -- --host --strictPort"
        );
        assert_eq!(
            apply_vite_strict_port("vite --strictPort --port 5173", Some(5173), true, true),
            "vite --strictPort --port 5173"
        );
        assert_eq!(
            apply_vite_strict_port("npm run dev", Some(5173), true, true),
            "npm run dev"
        );
    }

    #[test]
    fn strict_port_transform_ignores_non_vite_or_unpinned_commands() {
        assert_eq!(
            apply_vite_strict_port("webpack serve", Some(5173), false, false),
            "webpack serve"
        );
        assert_eq!(apply_vite_strict_port("vite", None, true, false), "vite");
    }

    #[test]
    fn recognizes_vite_tokens_and_package_script_names() {
        assert!(shell_command_contains_vite(
            "./node_modules/.bin/vite --host"
        ));
        assert!(!shell_command_contains_vite("vitest run"));
        assert_eq!(package_script_name("npm run dev"), Some("dev".to_string()));
        assert_eq!(package_script_name("pnpm dev"), Some("dev".to_string()));
        assert_eq!(
            package_script_name("source ~/.nvm/nvm.sh && npm run dev"),
            Some("dev".to_string())
        );
        assert_eq!(package_script_name("npm install"), None);
        assert_eq!(vite_script_info("vite --strictPort"), (true, true));
        assert_eq!(vite_script_info("vitest run"), (false, false));
    }

    #[test]
    fn current_runtime_log_selection_excludes_previous_sessions() {
        let path = std::env::temp_dir().join(format!(
            "rdevtool-runtime-log-session-{}.log",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(
            &path,
            [
                "legacy output",
                r#"{"rdevtool":"runtimeSession","runId":"old","projectKey":"sample","kind":"dev"}"#,
                "old session line",
                r#"{"rdevtool":"runtimeSession","runId":"current","projectKey":"sample","kind":"dev"}"#,
                "running pid=4242",
                "current session line",
            ]
            .join("\n"),
        )
        .expect("write runtime log");

        let (current_lines, _, current_summary) =
            tail_runtime_session_lines(&path, 20, None).expect("read current session");
        assert_eq!(current_summary.run_id.as_deref(), Some("current"));
        assert!(
            current_lines
                .iter()
                .any(|line| line == "current session line")
        );
        assert!(!current_lines.iter().any(|line| line == "old session line"));

        let (old_lines, _, old_summary) =
            tail_runtime_session_lines(&path, 20, Some("old")).expect("read old session");
        assert_eq!(old_summary.run_id.as_deref(), Some("old"));
        assert!(old_lines.iter().any(|line| line == "old session line"));
        assert!(!old_lines.iter().any(|line| line == "current session line"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn http_ready_probe_supports_custom_paths_and_statuses() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind HTTP test listener");
        let address = listener.local_addr().expect("read listener address");
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept HTTP request");
            let mut request = [0u8; 1024];
            let size = stream.read(&mut request).expect("read HTTP request");
            let request = String::from_utf8_lossy(&request[..size]);
            assert!(request.starts_with("GET /health HTTP/1.1"));
            stream
                .write_all(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n")
                .expect("write HTTP response");
        });
        let url = resolve_runtime_probe_url(
            Some(&format!("http://{address}/")),
            Some("/health"),
            None,
            None,
            None,
        )
        .expect("resolve probe URL")
        .expect("probe URL");
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .build()
            .expect("build HTTP client");
        let result = probe_runtime_http(&client, &url, &[204]);
        assert!(result.verified);
        assert_eq!(result.status, Some(204));
        server.join().expect("join HTTP server");
        assert!(runtime_http_status_matches(302, &[]));
        assert!(!runtime_http_status_matches(204, &[200]));
    }
}
