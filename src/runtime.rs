use crate::config::{
    AppConfig, ProjectCommandConfig, ProjectConfig, ProjectDebugLocalFileConfig,
    ProjectDebugProfileConfig, ProjectNetworkProxyConfig, ProjectReadyConfig, RuntimeProfileConfig,
    default_config_dir,
};
use crate::navigation::{
    NavigationEntry, NavigationOpenResult, open_navigation_entry_with_runtime_profiles,
};
use crate::proxy::{ProxyConfig, ProxyProfile};
use crate::runtime_daemon::{
    RuntimeDaemonAdoptRequest, RuntimeDaemonAdoptResponse, RuntimeDaemonPhase,
    RuntimeDaemonReadyConfig, RuntimeDaemonStartRequest, RuntimeProcessIdentity,
    adopt as adopt_runtime_daemon, listening_process, start_with_result as start_runtime_daemon,
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
use std::time::Duration;

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
    pub ready_summary: ProjectRuntimeReadySummary,
    pub session_summary: ProjectRuntimeLogSessionSummary,
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
    pub checks: Vec<ProjectRuntimePreflightCheck>,
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
    pub env_preview: Vec<ProjectRuntimeEnvPreview>,
    pub local_files: Vec<ProjectRuntimeLocalFileInspect>,
    pub proxies: Vec<ProjectRuntimeProxyInspect>,
    pub checks: Vec<ProjectRuntimePreflightCheck>,
    pub handoff: ProjectRuntimeHandoff,
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
    preflight_focus_checks(project, &mut checks);

    let (status_key, status_label, summary) = summarize_preflight(&checks);
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
    let mut resolved = resolve_project_command(project, RuntimeTaskKind::Dev)?;
    apply_command_override(
        &mut resolved,
        debug_profile.as_ref(),
        options.command.as_deref(),
    );
    if let Some(profile) = debug_profile.as_ref() {
        for (key, value) in &profile.env {
            resolved.env.insert(key.clone(), value.clone());
        }
    }
    let proxy_applied = apply_network_proxy_env(
        &mut resolved,
        debug_profile.as_ref(),
        runtime_profile.as_ref(),
    )?;
    for (key, value) in &options.env {
        let key = key.trim();
        if !key.is_empty() {
            resolved.env.insert(key.to_string(), value.clone());
        }
    }
    let expected_port = resolve_expected_port(project, debug_profile.as_ref(), options, &resolved);
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
            fallback_url: project
                .focus
                .url
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string),
        },
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
    let mut resolved = resolve_project_command(project, RuntimeTaskKind::Dev)?;
    apply_command_override(
        &mut resolved,
        debug_profile.as_ref(),
        options.command.as_deref(),
    );
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
        ready_url: project
            .focus
            .url
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string),
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
        .or_else(|| {
            project
                .focus
                .url
                .as_deref()
                .and_then(|value| optional_trimmed(Some(value)))
                .map(ToString::to_string)
        });
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
    let project = config
        .find_project(project_key)
        .map_err(|error| error.to_string())?;
    let task_kind = RuntimeTaskKind::from(kind);
    let path = project_task_log_path(project, kind);
    let normalized_limit = max_lines.clamp(20, 500);
    let (lines, truncated, session_summary) = tail_log_lines(&path, normalized_limit)?;
    let ready_summary = project_runtime_ready_summary(project, task_kind, &lines);
    Ok(ProjectRuntimeLogResponse {
        path: path.display().to_string(),
        lines,
        truncated,
        ready_summary,
        session_summary,
    })
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

fn resolve_project_command(
    project: &ProjectConfig,
    kind: RuntimeTaskKind,
) -> Result<ResolvedProjectCommand, String> {
    let Some(command_config) = project_command_config(project, kind) else {
        return Err(kind.missing_config_message().to_string());
    };
    let command = command_config.command.trim().to_string();
    if command.is_empty() {
        return Err(format!(
            "{}为空，请在 {} 下配置 command",
            kind.command_label(),
            kind.config_block()
        ));
    }
    let cwd = resolve_command_cwd(project, command_config, kind)?;
    if !cwd.exists() {
        return Err(format!("{}不存在: {}", kind.cwd_label(), cwd.display()));
    }
    if !cwd.is_dir() {
        return Err(format!("{}不是文件夹: {}", kind.cwd_label(), cwd.display()));
    }
    Ok(ResolvedProjectCommand {
        command,
        cwd,
        env: command_config.env.clone(),
    })
}

fn apply_command_override(
    resolved: &mut ResolvedProjectCommand,
    debug_profile: Option<&ProjectDebugProfileConfig>,
    launch_override: Option<&str>,
) {
    if let Some(command) = optional_trimmed(launch_override)
        .or_else(|| debug_profile.and_then(|profile| optional_trimmed(profile.command.as_deref())))
    {
        resolved.command = command.to_string();
    }
}

fn resolve_expected_port(
    project: &ProjectConfig,
    debug_profile: Option<&ProjectDebugProfileConfig>,
    options: &ProjectRuntimeLaunchOptions,
    resolved: &ResolvedProjectCommand,
) -> Option<u16> {
    options
        .expected_port
        .or_else(|| debug_profile.and_then(|profile| profile.expected_port))
        .or_else(|| command_port(&resolved.command))
        .or_else(|| {
            resolved
                .env
                .get("PORT")
                .and_then(|value| value.parse().ok())
        })
        .or_else(|| project_local_focus_url_port(project))
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

    let cwd = match resolve_command_cwd(project, command_config, RuntimeTaskKind::Dev) {
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
    let Ok(mut resolved) = resolve_project_command(project, RuntimeTaskKind::Dev) else {
        return;
    };
    apply_command_override(&mut resolved, debug_profile, options.command.as_deref());
    resolved.env.extend(options.env.clone());
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

fn preflight_focus_checks(project: &ProjectConfig, checks: &mut Vec<ProjectRuntimePreflightCheck>) {
    let focus_url = project.focus.url.as_deref().map(str::trim).unwrap_or("");
    if focus_url.starts_with("http://") || focus_url.starts_with("https://") {
        checks.push(preflight_check(
            "focusUrl",
            "启动页面",
            "webActions",
            "ok",
            focus_url,
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
            format!("focus.url 不是 HTTP 地址: {}", focus_url),
            Some("网页动作需要 http:// 或 https:// 地址。"),
        ));
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
    let lower_command = command.to_ascii_lowercase();
    if lower_command.contains("nvm use") {
        return Some("命令中包含 nvm use".to_string());
    }
    if lower_command.contains("volta") {
        return Some("命令中包含 Volta".to_string());
    }
    for key in ["NODE_VERSION", "npm_config_target"] {
        if let Some(value) = env
            .get(key)
            .map(String::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some(format!("环境变量 {}={}", key, value));
        }
    }
    let cwd = cwd?;
    for file_name in [".nvmrc", ".node-version"] {
        let path = cwd.join(file_name);
        if let Ok(value) = fs::read_to_string(&path) {
            let version = value.trim();
            if !version.is_empty() {
                return Some(format!("{} {}", file_name, version));
            }
        }
    }
    package_json_node_engine(cwd).map(|value| format!("package.json engines.node {}", value))
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
    fn command_label(self) -> &'static str {
        match self {
            Self::Dev => "启动命令",
            Self::Build => "打包命令",
        }
    }

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
        ResolvedProjectCommand, apply_command_override, apply_vite_strict_port, command_port,
        package_script_name, resolve_runtime_profile, shell_command_contains_vite,
        vite_script_info,
    };
    use crate::config::{AppConfig, ProjectDebugProfileConfig};
    use std::collections::BTreeMap;
    use std::path::PathBuf;

    #[test]
    fn parses_common_dev_server_port_arguments() {
        assert_eq!(command_port("vite --port 1420"), Some(1420));
        assert_eq!(command_port("vite --port=5173"), Some(5173));
        assert_eq!(command_port("npm run dev"), None);
    }

    #[test]
    fn launch_command_override_takes_priority_over_debug_profile() {
        let profile = ProjectDebugProfileConfig {
            command: Some("npm run profile".to_string()),
            ..ProjectDebugProfileConfig::default()
        };
        let mut resolved = ResolvedProjectCommand {
            command: "npm run dev".to_string(),
            cwd: PathBuf::from("."),
            env: BTreeMap::new(),
        };
        apply_command_override(&mut resolved, Some(&profile), Some("npm run once"));
        assert_eq!(resolved.command, "npm run once");
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
}
