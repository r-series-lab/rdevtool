use rdevtool_core::config::{
    AppConfig, ProjectAuthHelperConfig, ProjectAuthHelperItemConfig, ProjectCommandConfig,
    ProjectConfig, ProjectDebugProfileConfig, ProjectLocalProxyConfig,
    ProjectLocalProxyRouteConfig, ProjectReadyConfig, RuntimeProfileConfig, default_config_dir,
};
use rdevtool_core::navigation::{NavigationEntry, open_in_current_chrome};
pub use rdevtool_core::runtime::{
    ProjectRuntimeLogKind, ProjectRuntimeLogResponse, ProjectRuntimeLogSessionSummary,
    ProjectRuntimePreflightResponse, ProjectRuntimeReadySummary,
};
use rdevtool_core::runtime::{
    clear_project_runtime_log as core_clear_project_runtime_log,
    project_runtime_preflight_for_project,
    read_project_runtime_log as core_read_project_runtime_log,
};
use rdevtool_core::web_actions::{
    WebActionRunRequest, open_web_action_navigation_target, run_web_action_navigation,
};
use serde::Serialize;
use serde_json::json;
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeSnapshot {
    pub key: String,
    pub name: String,
    pub category: String,
    pub repo_path: Option<String>,
    pub command: Option<String>,
    pub cwd: Option<String>,
    pub focus_url: Option<String>,
    pub ready_url: Option<String>,
    pub status_key: String,
    pub status_label: String,
    pub detail: String,
    pub pid: Option<u32>,
    pub started_at_ms: Option<u64>,
    pub log_path: Option<String>,
    pub build_command: Option<String>,
    pub build_cwd: Option<String>,
    pub build_output_dir: Option<String>,
    pub build_status_key: String,
    pub build_status_label: String,
    pub build_detail: String,
    pub build_pid: Option<u32>,
    pub build_started_at_ms: Option<u64>,
    pub build_log_path: Option<String>,
    pub updated_at_ms: u64,
    pub can_start: bool,
    pub can_stop: bool,
    pub can_build: bool,
    pub can_stop_build: bool,
    pub can_open_build_output: bool,
    pub can_focus_runtime: bool,
    pub debug_profiles: Vec<ProjectDebugProfileSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDebugProfileSummary {
    pub key: String,
    pub label: String,
    pub env: BTreeMap<String, String>,
    pub env_count: usize,
    pub local_file_count: usize,
    pub browser: Option<String>,
    pub browser_profile: Option<String>,
    pub browser_user_data_dir: Option<String>,
    pub browser_args: Vec<String>,
    pub network_proxy: ProjectNetworkProxySummary,
    pub local_proxy: ProjectLocalProxySummary,
    pub runtime_profile: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectNetworkProxySummary {
    pub enabled: bool,
    pub proxy_url: String,
    pub inject_env: bool,
    pub node_hook: bool,
    pub no_proxy: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLocalProxySummary {
    pub enabled: bool,
    pub listen: String,
    pub frontend_url: String,
    pub upstream_proxy: String,
    pub routes: Vec<ProjectLocalProxyRouteSummary>,
    pub auth_helper: ProjectAuthHelperSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLocalProxyRouteSummary {
    pub enabled: bool,
    pub match_prefix: String,
    pub target: String,
    pub rewrite_prefix: String,
    pub headers_text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAuthHelperSummary {
    pub enabled: bool,
    pub path: String,
    pub redirect_path: String,
    pub items: Vec<ProjectAuthHelperItemSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAuthHelperItemSummary {
    pub enabled: bool,
    pub storage: String,
    pub key: String,
    pub from_json_path: String,
    pub value: String,
    pub cookie_path: String,
    pub cookie_max_age_seconds: Option<i64>,
    pub cookie_same_site: String,
}

#[derive(Clone, Default)]
pub struct ProjectRuntimeState {
    inner: Arc<ProjectRuntimeRegistry>,
}

#[derive(Default)]
struct ProjectRuntimeRegistry {
    state: Mutex<ProjectRuntimeStore>,
}

#[derive(Default)]
struct ProjectRuntimeStore {
    running: HashMap<String, RunningProjectProcess>,
    last_results: HashMap<String, ProjectTaskLastState>,
    running_builds: HashMap<String, RunningProjectProcess>,
    last_build_results: HashMap<String, ProjectTaskLastState>,
}

impl ProjectRuntimeStore {
    fn dev_parts(
        &mut self,
    ) -> (
        &mut HashMap<String, RunningProjectProcess>,
        &mut HashMap<String, ProjectTaskLastState>,
    ) {
        (&mut self.running, &mut self.last_results)
    }

    fn build_parts(
        &mut self,
    ) -> (
        &mut HashMap<String, RunningProjectProcess>,
        &mut HashMap<String, ProjectTaskLastState>,
    ) {
        (&mut self.running_builds, &mut self.last_build_results)
    }
}

struct RunningProjectProcess {
    child: Child,
    pid: u32,
    started_at_ms: u64,
    local_proxy: Option<RunningLocalProxyProcess>,
}

struct RunningLocalProxyProcess {
    child: Child,
    pid: u32,
    listen: String,
}

#[derive(Clone)]
struct ProjectTaskLastState {
    status_key: String,
    status_label: String,
    detail: String,
    updated_at_ms: u64,
}

#[derive(Clone)]
struct ResolvedProjectCommand {
    command: String,
    cwd: PathBuf,
    env: HashMap<String, String>,
}

#[derive(Clone)]
struct TaskDisplayConfig {
    configured: bool,
    command: Option<String>,
    cwd: Option<String>,
    output_dir: Option<String>,
}

struct RuntimeDisplayConfig {
    repo_path: Option<String>,
    dev: TaskDisplayConfig,
    build: TaskDisplayConfig,
}

enum ProjectFocusTarget {
    Url(String),
    AppBundle(String),
}

struct TaskSnapshotState {
    status_key: String,
    status_label: String,
    detail: String,
    ready_url: Option<String>,
    pid: Option<u32>,
    started_at_ms: Option<u64>,
    updated_at_ms: u64,
    is_running: bool,
    is_available: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ProjectCommandKind {
    Dev,
    Build,
}

const NODE_PROXY_HOOK_FILENAME: &str = "rdevtool-node-proxy-hook.cjs";
const LOCAL_PROXY_SCRIPT_FILENAME: &str = "rdevtool-local-proxy.cjs";
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

const LOCAL_PROXY_SCRIPT: &str = r#"'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');
const { URL } = require('url');

const configPath = process.argv[2];
if (!configPath) {
  throw new Error('missing local proxy config path');
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const proxyConfig = config.proxy || {};
const routes = (proxyConfig.routes || [])
  .filter((route) => route && route.enabled !== false && route.match_prefix && route.target);
const frontendUrl = new URL(proxyConfig.frontend_url || 'http://127.0.0.1:3001');
const upstreamProxy = parseOptionalUrl(proxyConfig.upstream_proxy);
const authHelper = proxyConfig.auth_helper || {};
const helperPath = ensurePath(authHelper.path || '/__auth-helper');
const listen = parseListen(proxyConfig.listen || '127.0.0.1:3000');

function parseOptionalUrl(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  return new URL(text);
}

function parseListen(value) {
  const text = String(value || '').trim();
  if (text.startsWith('[')) {
    const end = text.indexOf(']');
    const host = text.slice(1, end);
    const port = Number(text.slice(end + 2));
    return { host, port };
  }
  const splitAt = text.lastIndexOf(':');
  if (splitAt < 0) {
    return { host: '127.0.0.1', port: Number(text) };
  }
  const host = text.slice(0, splitAt) || '127.0.0.1';
  const port = Number(text.slice(splitAt + 1));
  return { host, port };
}

function ensurePath(value) {
  const text = String(value || '').trim();
  if (!text) return '/';
  return text.startsWith('/') ? text : `/${text}`;
}

function pickRoute(pathname) {
  return routes.find((route) => pathname.startsWith(route.match_prefix));
}

function appendPath(basePath, nextPath) {
  const base = basePath && basePath !== '/' ? basePath.replace(/\/+$/, '') : '';
  const next = ensurePath(nextPath).replace(/\/{2,}/g, '/');
  return `${base}${next}` || '/';
}

function routeTargetUrl(route, requestUrl) {
  const target = new URL(route.target);
  const suffix = requestUrl.pathname.slice(route.match_prefix.length);
  const mappedPath = route.rewrite_prefix
    ? `${ensurePath(route.rewrite_prefix)}${suffix}`
    : requestUrl.pathname;
  target.pathname = appendPath(target.pathname, mappedPath);
  target.search = requestUrl.search;
  return target;
}

function frontendTargetUrl(rawUrl) {
  const target = new URL(rawUrl || '/', frontendUrl);
  target.protocol = frontendUrl.protocol;
  target.hostname = frontendUrl.hostname;
  target.port = frontendUrl.port;
  if (frontendUrl.pathname && frontendUrl.pathname !== '/') {
    target.pathname = appendPath(frontendUrl.pathname, target.pathname);
  }
  return target;
}

function prepareHeaders(req, target, extraHeaders) {
  const headers = Object.assign({}, req.headers);
  delete headers.host;
  delete headers.connection;
  delete headers['accept-encoding'];
  Object.assign(headers, extraHeaders || {});
  headers.host = target.host;
  return headers;
}

function proxyHttpRequest(req, res, target, extraHeaders, useUpstreamProxy) {
  const viaProxy = useUpstreamProxy && upstreamProxy && target.protocol === 'http:';
  const headers = prepareHeaders(req, target, extraHeaders);
  const transport = viaProxy ? http : target.protocol === 'https:' ? https : http;
  const options = viaProxy
    ? {
        protocol: 'http:',
        hostname: upstreamProxy.hostname,
        port: upstreamProxy.port || 80,
        method: req.method,
        path: target.href,
        headers,
      }
    : {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        method: req.method,
        path: `${target.pathname}${target.search}`,
        headers,
      };

  const proxyReq = transport.request(options, (proxyRes) => {
    const responseHeaders = Object.assign({}, proxyRes.headers);
    delete responseHeaders['content-encoding'];
    res.writeHead(proxyRes.statusCode || 502, responseHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (error) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    }
    res.end(`local proxy request failed: ${error.message}`);
  });

  req.pipe(proxyReq);
}

function rawHeaderBlock(headers) {
  return Object.entries(headers)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
    .join('\r\n');
}

function proxyUpgrade(req, socket, head, target) {
  if (target.protocol !== 'http:') {
    socket.destroy();
    return;
  }

  const headers = prepareHeaders(req, target, {});
  headers.connection = 'Upgrade';
  headers.upgrade = req.headers.upgrade || 'websocket';
  const requestHead = [
    `${req.method} ${target.pathname}${target.search} HTTP/${req.httpVersion}`,
    rawHeaderBlock(headers),
    '',
    '',
  ].join('\r\n');
  const targetSocket = net.connect(target.port || 80, target.hostname, () => {
    targetSocket.write(requestHead);
    if (head && head.length > 0) {
      targetSocket.write(head);
    }
    socket.pipe(targetSocket);
    targetSocket.pipe(socket);
  });
  targetSocket.on('error', () => socket.destroy());
  socket.on('error', () => targetSocket.destroy());
}

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function serveAuthHelper(_req, res) {
  const payload = JSON.stringify(authHelper);
  const title = `${config.project_key || 'project'} / ${config.profile_key || 'debug'} Auth Helper`;
  const rows = (authHelper.items || [])
    .filter((item) => item && item.enabled !== false)
    .map((item) => `<li><code>${htmlEscape(item.storage || 'localStorage')}.${htmlEscape(item.key || '')}</code> ${htmlEscape(item.from_json_path || item.value || '')}</li>`)
    .join('');
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${htmlEscape(title)}</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f7f5; color: #202124; }
    main { max-width: 760px; margin: 40px auto; padding: 0 20px; }
    textarea { box-sizing: border-box; width: 100%; min-height: 260px; padding: 12px; border: 1px solid #d7d7d2; border-radius: 8px; font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; background: #fff; }
    button { height: 36px; padding: 0 14px; border: 0; border-radius: 6px; background: #1a73e8; color: #fff; font-weight: 600; cursor: pointer; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .row { display: flex; gap: 10px; align-items: center; margin: 12px 0; }
    .status { min-height: 22px; color: #166534; }
    .error { color: #b91c1c; }
    ul { padding-left: 18px; color: #5f6368; }
  </style>
</head>
<body>
  <main>
    <h2>${htmlEscape(title)}</h2>
    <ul>${rows || '<li>未配置写入项</li>'}</ul>
    <textarea id="payload" spellcheck="false" placeholder="粘贴登录返回 JSON；固定 value 的写入项可留空"></textarea>
    <div class="row">
      <button id="apply" type="button">写入并跳转</button>
      <span id="status" class="status"></span>
    </div>
  </main>
  <script>
    const AUTH_HELPER = ${payload};
    function getByPath(source, path) {
      const text = String(path || '').trim().replace(/^\\$\\.?/, '');
      if (!text) return source;
      return text.split('.').filter(Boolean).reduce((value, key) => value == null ? undefined : value[key], source);
    }
    function stringifyValue(value) {
      if (value == null) return '';
      if (typeof value === 'string') return value;
      return JSON.stringify(value);
    }
    function setCookie(item, value) {
      let cookie = encodeURIComponent(item.key) + '=' + encodeURIComponent(value);
      cookie += '; Path=' + (item.cookie_path || '/');
      if (Number.isFinite(Number(item.cookie_max_age_seconds))) cookie += '; Max-Age=' + Number(item.cookie_max_age_seconds);
      if (item.cookie_same_site) cookie += '; SameSite=' + item.cookie_same_site;
      if (location.protocol === 'https:') cookie += '; Secure';
      document.cookie = cookie;
    }
    document.getElementById('apply').addEventListener('click', () => {
      const status = document.getElementById('status');
      status.className = 'status';
      try {
        const text = document.getElementById('payload').value.trim();
        const data = text ? JSON.parse(text) : {};
        const misses = [];
        for (const item of AUTH_HELPER.items || []) {
          if (!item || item.enabled === false) continue;
          const raw = item.value !== undefined && item.value !== '' ? item.value : getByPath(data, item.from_json_path);
          if (raw === undefined || raw === null || raw === '') {
            misses.push(item.key);
            continue;
          }
          const value = stringifyValue(raw);
          if (item.storage === 'sessionStorage') sessionStorage.setItem(item.key, value);
          else if (item.storage === 'cookie') setCookie(item, value);
          else localStorage.setItem(item.key, value);
        }
        if (misses.length) throw new Error('缺少字段: ' + misses.join(', '));
        status.textContent = '写入完成，正在跳转...';
        setTimeout(() => { location.href = AUTH_HELPER.redirect_path || '/#/'; }, 400);
      } catch (error) {
        status.className = 'status error';
        status.textContent = error.message || String(error);
      }
    });
  </script>
</body>
</html>`;
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (authHelper.enabled && requestUrl.pathname === helperPath) {
    serveAuthHelper(req, res);
    return;
  }

  const route = pickRoute(requestUrl.pathname);
  if (route) {
    proxyHttpRequest(req, res, routeTargetUrl(route, requestUrl), route.headers || {}, true);
    return;
  }

  proxyHttpRequest(req, res, frontendTargetUrl(req.url || '/'), {}, false);
});

server.on('upgrade', (req, socket, head) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const route = pickRoute(requestUrl.pathname);
  const target = route ? routeTargetUrl(route, requestUrl) : frontendTargetUrl(req.url || '/');
  proxyUpgrade(req, socket, head, target);
});

server.listen(listen.port, listen.host, () => {
  console.log(`rdevtool local proxy listening on ${listen.host}:${listen.port}`);
});
"#;

impl Drop for ProjectRuntimeRegistry {
    fn drop(&mut self) {
        if let Ok(mut store) = self.state.lock() {
            shutdown_runtime_store(&mut store);
        }
    }
}

impl ProjectRuntimeState {
    pub fn list(&self, config: &AppConfig) -> Result<Vec<ProjectRuntimeSnapshot>, String> {
        let mut store = self
            .inner
            .state
            .lock()
            .map_err(|_| "project runtime lock poisoned".to_string())?;
        config
            .projects
            .iter()
            .map(|project| snapshot_for_project(&mut store, project))
            .collect()
    }

    pub fn list_selected(
        &self,
        config: &AppConfig,
        project_keys: &[String],
    ) -> Result<Vec<ProjectRuntimeSnapshot>, String> {
        let mut store = self
            .inner
            .state
            .lock()
            .map_err(|_| "project runtime lock poisoned".to_string())?;

        let mut snapshots = Vec::new();
        for project_key in project_keys {
            let project = config
                .find_project(project_key)
                .map_err(|error| error.to_string())?;
            snapshots.push(snapshot_for_project(&mut store, project)?);
        }
        Ok(snapshots)
    }

    pub fn preflight(
        &self,
        config: &AppConfig,
        project_key: &str,
        debug_profile_key: Option<&str>,
    ) -> Result<ProjectRuntimePreflightResponse, String> {
        let project = config
            .find_project(project_key)
            .map_err(|error| error.to_string())?;
        Ok(project_runtime_preflight_for_project(
            config,
            project,
            debug_profile_key,
        ))
    }

    pub fn start(
        &self,
        config: &AppConfig,
        project_key: &str,
        debug_profile_key: Option<&str>,
        env_overrides: Option<&BTreeMap<String, String>>,
    ) -> Result<ProjectRuntimeSnapshot, String> {
        log_project_runtime_event(format!("start requested key={}", project_key));
        let project = config
            .find_project(project_key)
            .map_err(|error| error.to_string())?;
        let debug_profile = selected_debug_profile(project, debug_profile_key)?;
        let inherited_runtime_profile = debug_profile
            .as_ref()
            .map(|profile| selected_runtime_profile(config, profile))
            .transpose()?
            .flatten();
        if let Some(profile) = debug_profile.as_ref() {
            apply_debug_profile_local_files(project, profile)?;
        }
        let mut resolved = resolve_project_command(project, ProjectCommandKind::Dev)?;
        if let Some(profile) = debug_profile.as_ref() {
            for (key, value) in &profile.env {
                resolved.env.insert(key.clone(), value.clone());
            }
            apply_network_proxy_env(&mut resolved, profile, inherited_runtime_profile.as_ref())?;
        }
        if let Some(env_overrides) = env_overrides {
            for (key, value) in env_overrides {
                resolved.env.insert(key.clone(), value.clone());
            }
        }
        let launch_resolved = resolved.clone();
        log_project_runtime_event(format!(
            "start resolved key={} cwd={} command={} debug_profile={} env_overrides={}",
            project.key,
            resolved.cwd.display(),
            resolved.command,
            debug_profile
                .as_ref()
                .map(|profile| profile.key.as_str())
                .unwrap_or("default"),
            env_overrides.map(|values| values.len()).unwrap_or(0)
        ));

        let mut store = self
            .inner
            .state
            .lock()
            .map_err(|_| "project runtime lock poisoned".to_string())?;
        let already_running = {
            let (running, last_results) = store.dev_parts();
            task_running_state(running, last_results, project, ProjectCommandKind::Dev)?.is_some()
        };
        if already_running {
            return snapshot_for_project(&mut store, project);
        }

        let local_proxy = debug_profile
            .as_ref()
            .filter(|profile| profile.local_proxy.enabled)
            .map(|profile| start_local_proxy(project, profile))
            .transpose()?;

        {
            let (running, last_results) = store.dev_parts();
            launch_project_command(
                running,
                last_results,
                project,
                launch_resolved,
                ProjectCommandKind::Dev,
                local_proxy,
            )?;
        }

        if let Some(process) = store.running.get(&project.key) {
            log_project_runtime_event(format!(
                "start launched key={} pid={} cwd={} command={}",
                project.key,
                process.pid,
                resolved.cwd.display(),
                resolved.command
            ));
        }
        let launched = store.running.contains_key(&project.key);
        if launched && should_watch_project_ready(project) {
            spawn_ready_focus_watcher(
                project.clone(),
                debug_profile.clone(),
                inherited_runtime_profile.clone(),
            );
        }

        snapshot_for_project(&mut store, project)
    }

    pub fn run_build(
        &self,
        config: &AppConfig,
        project_key: &str,
    ) -> Result<ProjectRuntimeSnapshot, String> {
        log_project_runtime_event(format!("build requested key={}", project_key));
        let project = config
            .find_project(project_key)
            .map_err(|error| error.to_string())?;
        let resolved = resolve_project_command(project, ProjectCommandKind::Build)?;
        let launch_resolved = resolved.clone();
        log_project_runtime_event(format!(
            "build resolved key={} cwd={} command={}",
            project.key,
            resolved.cwd.display(),
            resolved.command
        ));

        let mut store = self
            .inner
            .state
            .lock()
            .map_err(|_| "project runtime lock poisoned".to_string())?;
        let already_running = {
            let (running, last_results) = store.build_parts();
            task_running_state(running, last_results, project, ProjectCommandKind::Build)?.is_some()
        };
        if already_running {
            return snapshot_for_project(&mut store, project);
        }

        {
            let (running, last_results) = store.build_parts();
            launch_project_command(
                running,
                last_results,
                project,
                launch_resolved,
                ProjectCommandKind::Build,
                None,
            )?;
        }

        if let Some(process) = store.running_builds.get(&project.key) {
            log_project_runtime_event(format!(
                "build launched key={} pid={} cwd={} command={}",
                project.key,
                process.pid,
                resolved.cwd.display(),
                resolved.command
            ));
        }

        snapshot_for_project(&mut store, project)
    }

    pub fn run_build_command(
        &self,
        config: &AppConfig,
        project_key: &str,
        command: String,
        cwd: PathBuf,
        env: BTreeMap<String, String>,
    ) -> Result<ProjectRuntimeSnapshot, String> {
        log_project_runtime_event(format!("build target requested key={}", project_key));
        let project = config
            .find_project(project_key)
            .map_err(|error| error.to_string())?;
        let command = command.trim().to_string();
        if command.is_empty() {
            return Err("构建命令不能为空".to_string());
        }
        if !cwd.exists() {
            return Err(format!("打包目录不存在: {}", cwd.display()));
        }
        if !cwd.is_dir() {
            return Err(format!("打包目录不是文件夹: {}", cwd.display()));
        }
        let resolved = ResolvedProjectCommand {
            command,
            cwd,
            env: env.into_iter().collect(),
        };
        let launch_resolved = resolved.clone();
        log_project_runtime_event(format!(
            "build target resolved key={} cwd={} command={}",
            project.key,
            resolved.cwd.display(),
            resolved.command
        ));

        let mut store = self
            .inner
            .state
            .lock()
            .map_err(|_| "project runtime lock poisoned".to_string())?;
        let already_running = {
            let (running, last_results) = store.build_parts();
            task_running_state(running, last_results, project, ProjectCommandKind::Build)?.is_some()
        };
        if already_running {
            return snapshot_for_project(&mut store, project);
        }

        {
            let (running, last_results) = store.build_parts();
            launch_project_command(
                running,
                last_results,
                project,
                launch_resolved,
                ProjectCommandKind::Build,
                None,
            )?;
        }

        if let Some(process) = store.running_builds.get(&project.key) {
            log_project_runtime_event(format!(
                "build target launched key={} pid={} cwd={} command={}",
                project.key,
                process.pid,
                resolved.cwd.display(),
                resolved.command
            ));
        }

        snapshot_for_project(&mut store, project)
    }

    pub fn stop(
        &self,
        config: &AppConfig,
        project_key: &str,
    ) -> Result<ProjectRuntimeSnapshot, String> {
        let project = config
            .find_project(project_key)
            .map_err(|error| error.to_string())?;

        let mut store = self
            .inner
            .state
            .lock()
            .map_err(|_| "project runtime lock poisoned".to_string())?;
        {
            let (running, last_results) = store.dev_parts();
            let _ = task_running_state(running, last_results, project, ProjectCommandKind::Dev)?;
        }

        if let Some(mut process) = store.running.remove(&project.key) {
            log_project_runtime_event(format!(
                "stop requested key={} pid={}",
                project.key, process.pid
            ));
            terminate_running_project_process(&mut process)?;
            store.last_results.insert(
                project.key.clone(),
                ProjectTaskLastState {
                    status_key: "stopped".to_string(),
                    status_label: "未启动".to_string(),
                    detail: "已停止 dev 服务".to_string(),
                    updated_at_ms: now_ms(),
                },
            );
        }

        snapshot_for_project(&mut store, project)
    }

    pub fn stop_build(
        &self,
        config: &AppConfig,
        project_key: &str,
    ) -> Result<ProjectRuntimeSnapshot, String> {
        let project = config
            .find_project(project_key)
            .map_err(|error| error.to_string())?;

        let mut store = self
            .inner
            .state
            .lock()
            .map_err(|_| "project runtime lock poisoned".to_string())?;
        {
            let (running, last_results) = store.build_parts();
            let _ = task_running_state(running, last_results, project, ProjectCommandKind::Build)?;
        }

        if let Some(mut process) = store.running_builds.remove(&project.key) {
            log_project_runtime_event(format!(
                "build stop requested key={} pid={}",
                project.key, process.pid
            ));
            terminate_running_project_process(&mut process)?;
            store.last_build_results.insert(
                project.key.clone(),
                ProjectTaskLastState {
                    status_key: "stopped".to_string(),
                    status_label: "已中止".to_string(),
                    detail: "已中止打包任务".to_string(),
                    updated_at_ms: now_ms(),
                },
            );
        }

        snapshot_for_project(&mut store, project)
    }

    pub fn shutdown_all(&self) {
        if let Ok(mut store) = self.inner.state.lock() {
            shutdown_runtime_store(&mut store);
        }
    }

    pub fn open_build_output(
        &self,
        config: &AppConfig,
        project_key: &str,
    ) -> Result<ProjectRuntimeSnapshot, String> {
        let project = config
            .find_project(project_key)
            .map_err(|error| error.to_string())?;
        let output_dir = resolve_build_output_dir(project)
            .ok_or_else(|| "未找到产物目录，请在 [projects.build] 下配置 output_dir".to_string())?;
        log_project_runtime_event(format!(
            "open build output key={} dir={}",
            project.key,
            output_dir.display()
        ));

        if !output_dir.exists() {
            return Err(format!("产物目录不存在: {}", output_dir.display()));
        }
        if !output_dir.is_dir() {
            return Err(format!("产物目录不是文件夹: {}", output_dir.display()));
        }

        open_path(&output_dir)?;

        let mut store = self
            .inner
            .state
            .lock()
            .map_err(|_| "project runtime lock poisoned".to_string())?;
        snapshot_for_project(&mut store, project)
    }

    pub fn focus_runtime(
        &self,
        config: &AppConfig,
        project_key: &str,
        debug_profile_key: Option<&str>,
    ) -> Result<ProjectRuntimeSnapshot, String> {
        let project = config
            .find_project(project_key)
            .map_err(|error| error.to_string())?;
        let debug_profile = selected_debug_profile(project, debug_profile_key)?;
        let inherited_runtime_profile = debug_profile
            .as_ref()
            .map(|profile| selected_runtime_profile(config, profile))
            .transpose()?
            .flatten();

        match resolve_focus_target(project) {
            Some(ProjectFocusTarget::AppBundle(bundle_id)) => {
                log_project_runtime_event(format!(
                    "focus runtime key={} bundle_id={}",
                    project.key, bundle_id
                ));
                focus_app_bundle(&bundle_id)?;
            }
            Some(ProjectFocusTarget::Url(url)) => {
                log_project_runtime_event(format!("focus runtime key={} url={}", project.key, url));
                open_focus_url(
                    &url,
                    debug_profile.as_ref(),
                    inherited_runtime_profile.as_ref(),
                )
                .map_err(|error| format!("打开项目页面失败: {}", error))?;
            }
            None => return Err("当前项目未配置可唤起目标".to_string()),
        }

        let mut store = self
            .inner
            .state
            .lock()
            .map_err(|_| "project runtime lock poisoned".to_string())?;
        snapshot_for_project(&mut store, project)
    }

    pub fn read_log(
        &self,
        config: &AppConfig,
        project_key: &str,
        kind: ProjectRuntimeLogKind,
        max_lines: usize,
    ) -> Result<ProjectRuntimeLogResponse, String> {
        core_read_project_runtime_log(config, project_key, kind, max_lines)
    }

    pub fn clear_log(
        &self,
        config: &AppConfig,
        project_key: &str,
        kind: ProjectRuntimeLogKind,
    ) -> Result<ProjectRuntimeLogResponse, String> {
        core_clear_project_runtime_log(config, project_key, kind)
    }
}

fn snapshot_for_project(
    store: &mut ProjectRuntimeStore,
    project: &ProjectConfig,
) -> Result<ProjectRuntimeSnapshot, String> {
    let display = runtime_display_config(project);
    let build_output_dir = resolve_build_output_dir(project);
    let can_focus_runtime = resolve_focus_target(project).is_some();
    let dev_state = {
        let (running, last_results) = store.dev_parts();
        task_state_for_project(
            running,
            last_results,
            project,
            &display.dev,
            ProjectCommandKind::Dev,
        )?
    };
    let build_state = {
        let (running, last_results) = store.build_parts();
        task_state_for_project(
            running,
            last_results,
            project,
            &display.build,
            ProjectCommandKind::Build,
        )?
    };
    let can_open_build_output = build_state.status_key == "succeeded"
        && build_output_dir
            .as_ref()
            .is_some_and(|path| path.exists() && path.is_dir());
    let log_path = display.dev.command.as_ref().map(|_| {
        task_log_path(project, ProjectCommandKind::Dev)
            .display()
            .to_string()
    });
    let build_log_path = if display.build.command.is_some()
        || build_state.is_running
        || matches!(
            build_state.status_key.as_str(),
            "succeeded" | "failed" | "stopped"
        ) {
        Some(
            task_log_path(project, ProjectCommandKind::Build)
                .display()
                .to_string(),
        )
    } else {
        None
    };

    Ok(ProjectRuntimeSnapshot {
        key: project.key.clone(),
        name: project.name.clone(),
        category: project.category_label().to_string(),
        repo_path: display.repo_path,
        command: display.dev.command,
        cwd: display.dev.cwd,
        focus_url: project
            .focus
            .url
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string),
        ready_url: dev_state.ready_url,
        status_key: dev_state.status_key,
        status_label: dev_state.status_label,
        detail: dev_state.detail,
        pid: dev_state.pid,
        started_at_ms: dev_state.started_at_ms,
        log_path,
        build_command: display.build.command,
        build_cwd: display.build.cwd,
        build_output_dir: display.build.output_dir,
        build_status_key: build_state.status_key,
        build_status_label: build_state.status_label,
        build_detail: build_state.detail,
        build_pid: build_state.pid,
        build_started_at_ms: build_state.started_at_ms,
        build_log_path,
        updated_at_ms: dev_state.updated_at_ms.max(build_state.updated_at_ms),
        can_start: dev_state.is_available && !dev_state.is_running,
        can_stop: dev_state.is_running,
        can_build: build_state.is_available && !build_state.is_running,
        can_stop_build: build_state.is_running,
        can_open_build_output,
        can_focus_runtime,
        debug_profiles: project
            .debug_profiles
            .iter()
            .map(|profile| ProjectDebugProfileSummary {
                key: profile.key.clone(),
                label: profile.label.clone(),
                runtime_profile: profile.runtime_profile.clone(),
                env: profile.env.clone(),
                env_count: profile.env.len(),
                local_file_count: profile
                    .local_files
                    .iter()
                    .filter(|item| item.enabled)
                    .count(),
                browser: profile.browser.clone(),
                browser_profile: profile.browser_profile.clone(),
                browser_user_data_dir: profile
                    .browser_user_data_dir
                    .as_ref()
                    .map(|path| path.display().to_string()),
                browser_args: profile.browser_args.clone(),
                network_proxy: ProjectNetworkProxySummary {
                    enabled: profile.network_proxy.enabled,
                    proxy_url: profile.network_proxy.proxy_url.clone(),
                    inject_env: profile.network_proxy.inject_env,
                    node_hook: profile.network_proxy.node_hook,
                    no_proxy: profile.network_proxy.no_proxy.clone(),
                },
                local_proxy: local_proxy_summary(&profile.local_proxy),
            })
            .collect(),
    })
}

fn local_proxy_summary(proxy: &ProjectLocalProxyConfig) -> ProjectLocalProxySummary {
    ProjectLocalProxySummary {
        enabled: proxy.enabled,
        listen: proxy.listen.clone(),
        frontend_url: proxy.frontend_url.clone(),
        upstream_proxy: proxy.upstream_proxy.clone(),
        routes: proxy.routes.iter().map(local_proxy_route_summary).collect(),
        auth_helper: auth_helper_summary(&proxy.auth_helper),
    }
}

fn local_proxy_route_summary(
    route: &ProjectLocalProxyRouteConfig,
) -> ProjectLocalProxyRouteSummary {
    ProjectLocalProxyRouteSummary {
        enabled: route.enabled,
        match_prefix: route.match_prefix.clone(),
        target: route.target.clone(),
        rewrite_prefix: route.rewrite_prefix.clone(),
        headers_text: map_to_editor_text(&route.headers),
    }
}

fn auth_helper_summary(helper: &ProjectAuthHelperConfig) -> ProjectAuthHelperSummary {
    ProjectAuthHelperSummary {
        enabled: helper.enabled,
        path: helper.path.clone(),
        redirect_path: helper.redirect_path.clone(),
        items: helper.items.iter().map(auth_helper_item_summary).collect(),
    }
}

fn auth_helper_item_summary(item: &ProjectAuthHelperItemConfig) -> ProjectAuthHelperItemSummary {
    ProjectAuthHelperItemSummary {
        enabled: item.enabled,
        storage: item.storage.clone(),
        key: item.key.clone(),
        from_json_path: item.from_json_path.clone(),
        value: item.value.clone(),
        cookie_path: item.cookie_path.clone(),
        cookie_max_age_seconds: item.cookie_max_age_seconds,
        cookie_same_site: item.cookie_same_site.clone(),
    }
}

fn map_to_editor_text(values: &BTreeMap<String, String>) -> String {
    values
        .iter()
        .map(|(key, value)| format!("{}={}", key, value))
        .collect::<Vec<_>>()
        .join("\n")
}

fn task_state_for_project(
    running: &mut HashMap<String, RunningProjectProcess>,
    last_results: &mut HashMap<String, ProjectTaskLastState>,
    project: &ProjectConfig,
    display: &TaskDisplayConfig,
    kind: ProjectCommandKind,
) -> Result<TaskSnapshotState, String> {
    let mut updated_at_ms = now_ms();

    if let Some(running_state) = task_running_state(running, last_results, project, kind)? {
        return Ok(running_state);
    }

    let last_state = last_results.get(&project.key).cloned();
    if let Some(last) = last_state.as_ref() {
        updated_at_ms = last.updated_at_ms;
    }

    match resolve_project_command(project, kind) {
        Ok(_) => {
            if let Some(last) = last_state {
                return Ok(TaskSnapshotState {
                    status_key: last.status_key,
                    status_label: last.status_label,
                    detail: last.detail,
                    ready_url: None,
                    pid: None,
                    started_at_ms: None,
                    updated_at_ms,
                    is_running: false,
                    is_available: true,
                });
            }

            let (status_key, status_label, detail) = kind.idle_state();
            Ok(TaskSnapshotState {
                status_key: status_key.to_string(),
                status_label: status_label.to_string(),
                detail: detail.to_string(),
                ready_url: None,
                pid: None,
                started_at_ms: None,
                updated_at_ms,
                is_running: false,
                is_available: true,
            })
        }
        Err(error) => Ok(TaskSnapshotState {
            status_key: if display.configured {
                "invalidConfig".to_string()
            } else {
                "notConfigured".to_string()
            },
            status_label: if display.configured {
                "配置无效".to_string()
            } else {
                "未配置".to_string()
            },
            detail: error,
            ready_url: None,
            pid: None,
            started_at_ms: None,
            updated_at_ms,
            is_running: false,
            is_available: false,
        }),
    }
}

fn task_running_state(
    running: &mut HashMap<String, RunningProjectProcess>,
    last_results: &mut HashMap<String, ProjectTaskLastState>,
    project: &ProjectConfig,
    kind: ProjectCommandKind,
) -> Result<Option<TaskSnapshotState>, String> {
    let mut remove_exited = None;

    if let Some(process) = running.get_mut(&project.key) {
        match process
            .child
            .try_wait()
            .map_err(|error| error.to_string())?
        {
            Some(status) => remove_exited = Some(status.code()),
            None => {
                let (mut status_key, mut status_label, mut detail) = kind.running_state();
                let ready_summary = runtime_ready_summary_from_file(project, kind)?;
                let ready_url = ready_summary.url.clone();
                if ready_summary.ready {
                    status_key = "running";
                    status_label = "已启动";
                    detail = ready_summary
                        .url
                        .as_deref()
                        .or(ready_summary.detail.as_deref())
                        .unwrap_or("dev 服务已启动");
                } else if ready_summary.failed {
                    status_key = "failed";
                    status_label = "启动异常";
                    detail = ready_summary.detail.as_deref().unwrap_or("检测到启动异常");
                }
                return Ok(Some(TaskSnapshotState {
                    status_key: status_key.to_string(),
                    status_label: status_label.to_string(),
                    detail: detail.to_string(),
                    ready_url,
                    pid: Some(process.pid),
                    started_at_ms: Some(process.started_at_ms),
                    updated_at_ms: now_ms(),
                    is_running: true,
                    is_available: true,
                }));
            }
        }
    }

    if let Some(code) = remove_exited {
        if let Some(mut process) = running.remove(&project.key) {
            terminate_local_proxy(&mut process.local_proxy);
        }
        last_results.insert(project.key.clone(), kind.finished_state(code));
    }

    Ok(None)
}

fn launch_project_command(
    running: &mut HashMap<String, RunningProjectProcess>,
    last_results: &mut HashMap<String, ProjectTaskLastState>,
    project: &ProjectConfig,
    resolved: ResolvedProjectCommand,
    kind: ProjectCommandKind,
    local_proxy: Option<RunningLocalProxyProcess>,
) -> Result<(), String> {
    let mut local_proxy = local_proxy;
    let mut log_file = open_task_log(project, &resolved, kind)?;
    let stdout = log_file
        .try_clone()
        .map_err(|error| format!("创建日志输出失败: {}", error))?;
    let stderr = log_file
        .try_clone()
        .map_err(|error| format!("创建日志输出失败: {}", error))?;
    let mut command = Command::new("/bin/zsh");
    command
        .arg("-lc")
        .arg(&resolved.command)
        .current_dir(&resolved.cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));

    scrub_launcher_env(&mut command);

    for (key, value) in &resolved.env {
        command.env(key, value);
    }

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            terminate_local_proxy(&mut local_proxy);
            return Err(format!(
                "{} {} 失败: {}",
                kind.action_label(),
                project.name,
                error
            ));
        }
    };
    let pid = child.id();
    let started_at_ms = now_ms();

    thread::sleep(Duration::from_millis(240));
    match child.try_wait().map_err(|error| error.to_string())? {
        Some(status) => {
            let _ = writeln!(log_file, "[{}] exited quickly status={}", now_ms(), status);
            terminate_local_proxy(&mut local_proxy);
            last_results.insert(project.key.clone(), kind.quick_exit_state(status.code()));
        }
        None => {
            let _ = writeln!(log_file, "[{}] running pid={}", now_ms(), pid);
            running.insert(
                project.key.clone(),
                RunningProjectProcess {
                    child,
                    pid,
                    started_at_ms,
                    local_proxy,
                },
            );
            last_results.remove(&project.key);
        }
    }

    Ok(())
}

fn start_local_proxy(
    project: &ProjectConfig,
    profile: &ProjectDebugProfileConfig,
) -> Result<RunningLocalProxyProcess, String> {
    let proxy = &profile.local_proxy;
    let script_path = ensure_local_proxy_script()?;
    let config_path = write_local_proxy_config(project, profile)?;
    let mut log_file = open_local_proxy_log(project, profile)?;
    let stdout = log_file
        .try_clone()
        .map_err(|error| format!("创建本地代理日志失败: {}", error))?;
    let stderr = log_file
        .try_clone()
        .map_err(|error| format!("创建本地代理日志失败: {}", error))?;
    let mut command = Command::new("node");
    command
        .arg(&script_path)
        .arg(&config_path)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));

    scrub_launcher_env(&mut command);

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("启动本地 API 代理失败: {}", error))?;
    let pid = child.id();
    thread::sleep(Duration::from_millis(180));
    match child.try_wait().map_err(|error| error.to_string())? {
        Some(status) => {
            let _ = writeln!(
                log_file,
                "[{}] local proxy exited quickly status={}",
                now_ms(),
                status
            );
            Err(format!("本地 API 代理启动后立即退出: {}", status))
        }
        None => {
            let _ = writeln!(
                log_file,
                "[{}] local proxy running pid={} listen={}",
                now_ms(),
                pid,
                proxy.listen
            );
            log_project_runtime_event(format!(
                "local proxy launched key={} profile={} pid={} listen={}",
                project.key, profile.key, pid, proxy.listen
            ));
            Ok(RunningLocalProxyProcess {
                child,
                pid,
                listen: proxy.listen.clone(),
            })
        }
    }
}

fn ensure_local_proxy_script() -> Result<PathBuf, String> {
    let script_path = std::env::temp_dir().join(LOCAL_PROXY_SCRIPT_FILENAME);
    let needs_write = fs::read_to_string(&script_path)
        .map(|content| content != LOCAL_PROXY_SCRIPT)
        .unwrap_or(true);
    if needs_write {
        fs::write(&script_path, LOCAL_PROXY_SCRIPT)
            .map_err(|error| format!("写入本地 API 代理脚本失败: {}", error))?;
    }
    Ok(script_path)
}

fn write_local_proxy_config(
    project: &ProjectConfig,
    profile: &ProjectDebugProfileConfig,
) -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("rdevtool-local-proxy");
    fs::create_dir_all(&dir).map_err(|error| format!("创建本地代理配置目录失败: {}", error))?;
    let config_path = dir.join(format!(
        "{}-{}.json",
        sanitize_log_name(&project.key),
        sanitize_log_name(&profile.key)
    ));
    let payload = json!({
        "project_key": &project.key,
        "profile_key": &profile.key,
        "proxy": &profile.local_proxy,
    });
    let content = serde_json::to_vec_pretty(&payload)
        .map_err(|error| format!("生成本地代理配置失败: {}", error))?;
    fs::write(&config_path, content).map_err(|error| format!("写入本地代理配置失败: {}", error))?;
    Ok(config_path)
}

fn open_local_proxy_log(
    project: &ProjectConfig,
    profile: &ProjectDebugProfileConfig,
) -> Result<File, String> {
    let path = default_config_dir().join("runtime-logs").join(format!(
        "{}-{}-local-proxy.log",
        sanitize_log_name(&project.key),
        sanitize_log_name(&profile.key)
    ));
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("创建日志目录失败: {}", error))?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("打开本地代理日志失败: {}", error))?;
    writeln!(
        file,
        "\n[{}] local proxy start key={} profile={} listen={} frontend={} upstream={}",
        now_ms(),
        project.key,
        profile.key,
        profile.local_proxy.listen,
        profile.local_proxy.frontend_url,
        profile.local_proxy.upstream_proxy
    )
    .map_err(|error| format!("写入本地代理日志失败: {}", error))?;
    Ok(file)
}

fn open_task_log(
    project: &ProjectConfig,
    resolved: &ResolvedProjectCommand,
    kind: ProjectCommandKind,
) -> Result<File, String> {
    let path = task_log_path(project, kind);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("创建日志目录失败: {}", error))?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("打开运行日志失败: {}", error))?;
    let started_at_ms = now_ms();
    let run_id = format!(
        "{}-{}-{}",
        sanitize_log_name(&project.key),
        kind.log_file_suffix(),
        started_at_ms
    );
    writeln!(
        file,
        "\n[{}] {} key={} cwd={} command={}",
        started_at_ms,
        kind.log_label(),
        project.key,
        resolved.cwd.display(),
        resolved.command
    )
    .map_err(|error| format!("写入运行日志失败: {}", error))?;
    writeln!(
        file,
        "{}",
        json!({
            "rdevtool": "runtimeSession",
            "version": 1,
            "runId": run_id,
            "projectKey": &project.key,
            "kind": kind.log_file_suffix(),
            "startedAtMs": started_at_ms,
            "cwd": resolved.cwd.display().to_string(),
            "command": &resolved.command,
        })
    )
    .map_err(|error| format!("写入运行日志失败: {}", error))?;
    Ok(file)
}

fn task_log_path(project: &ProjectConfig, kind: ProjectCommandKind) -> PathBuf {
    default_config_dir().join("runtime-logs").join(format!(
        "{}-{}.log",
        sanitize_log_name(&project.key),
        kind.log_file_suffix()
    ))
}

fn sanitize_log_name(value: &str) -> String {
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

fn runtime_ready_summary_from_file(
    project: &ProjectConfig,
    kind: ProjectCommandKind,
) -> Result<ProjectRuntimeReadySummary, String> {
    if kind != ProjectCommandKind::Dev || !project.focus.ready.enabled {
        return Ok(ProjectRuntimeReadySummary::disabled());
    }
    let path = task_log_path(project, kind);
    let (lines, _, _) = tail_log_lines(&path, 500)?;
    Ok(runtime_ready_summary(project, kind, &lines))
}

fn runtime_ready_summary(
    project: &ProjectConfig,
    kind: ProjectCommandKind,
    lines: &[String],
) -> ProjectRuntimeReadySummary {
    if kind != ProjectCommandKind::Dev || !project.focus.ready.enabled {
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

fn latest_task_start_index(lines: &[String], kind: ProjectCommandKind) -> usize {
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

fn shutdown_runtime_store(store: &mut ProjectRuntimeStore) {
    for (_, mut process) in store.running.drain() {
        let _ = terminate_running_project_process(&mut process);
    }
    for (_, mut process) in store.running_builds.drain() {
        let _ = terminate_running_project_process(&mut process);
    }
}

fn should_auto_focus_when_ready(project: &ProjectConfig) -> bool {
    project.focus.auto_on_start
        && project.focus.ready.enabled
        && project
            .focus
            .auto_open_mode
            .trim()
            .eq_ignore_ascii_case("ready")
}

fn should_watch_project_ready(project: &ProjectConfig) -> bool {
    project.focus.ready.enabled
        && (should_auto_focus_when_ready(project) || !project.focus.after_ready_actions.is_empty())
}

fn spawn_ready_focus_watcher(
    project: ProjectConfig,
    debug_profile: Option<ProjectDebugProfileConfig>,
    runtime_profile: Option<RuntimeProfileConfig>,
) {
    thread::spawn(move || {
        let timeout_ms = project.focus.ready.timeout_ms.clamp(1_000, 600_000);
        let deadline = now_ms().saturating_add(timeout_ms);
        loop {
            match runtime_ready_summary_from_file(&project, ProjectCommandKind::Dev) {
                Ok(summary) if summary.ready => {
                    let url = summary.url.or_else(|| {
                        project
                            .focus
                            .url
                            .as_deref()
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .map(ToString::to_string)
                    });
                    if let Some(url) = url {
                        log_project_runtime_event(format!(
                            "auto focus ready key={} url={}",
                            project.key, url
                        ));
                        if should_auto_focus_when_ready(&project) {
                            if let Err(error) = open_focus_url(
                                &url,
                                debug_profile.as_ref(),
                                runtime_profile.as_ref(),
                            ) {
                                eprintln!("failed to auto focus ready project: {}", error);
                            }
                        }
                        if let Err(error) = run_project_after_ready_actions(
                            &project,
                            &url,
                            debug_profile.as_ref(),
                            runtime_profile.as_ref(),
                        ) {
                            eprintln!("failed to run after-ready project actions: {}", error);
                        }
                    }
                    break;
                }
                Ok(summary) if summary.failed => {
                    log_project_runtime_event(format!(
                        "auto focus skipped key={} reason={}",
                        project.key,
                        summary
                            .detail
                            .unwrap_or_else(|| "ready check failed".to_string())
                    ));
                    break;
                }
                Ok(_) => {}
                Err(error) => {
                    eprintln!("failed to inspect project ready log: {}", error);
                }
            }

            if now_ms() >= deadline {
                log_project_runtime_event(format!("auto focus timeout key={}", project.key));
                break;
            }
            thread::sleep(Duration::from_millis(700));
        }
    });
}

fn run_project_after_ready_actions(
    project: &ProjectConfig,
    url: &str,
    debug_profile: Option<&ProjectDebugProfileConfig>,
    runtime_profile: Option<&RuntimeProfileConfig>,
) -> Result<(), String> {
    let action_keys = project
        .focus
        .after_ready_actions
        .iter()
        .map(|key| key.trim())
        .filter(|key| !key.is_empty())
        .collect::<Vec<_>>();
    if action_keys.is_empty() {
        return Ok(());
    }

    append_project_task_log(
        project,
        ProjectCommandKind::Dev,
        format!(
            "after-ready actions start count={} url={}",
            action_keys.len(),
            url
        ),
    );
    let entry = project_ready_navigation_entry(project, url, debug_profile, runtime_profile);
    let runtime_profiles = runtime_profile.cloned().into_iter().collect::<Vec<_>>();
    let target = match open_web_action_navigation_target(&entry, &runtime_profiles) {
        Ok(target) => target,
        Err(error) => {
            let message = format!("after-ready open target failed: {}", error);
            append_project_task_log(project, ProjectCommandKind::Dev, &message);
            return Err(message);
        }
    };

    for action_key in action_keys {
        let request = WebActionRunRequest {
            action_key: action_key.to_string(),
            target_id: Some(target.id.clone()),
            scope: Some(format!("project:{}", project.key)),
            url: Some(url.to_string()),
            params: BTreeMap::new(),
            context_params: project_web_action_context_params(
                project,
                url,
                debug_profile,
                runtime_profile,
            ),
        };
        match run_web_action_navigation(&entry, &runtime_profiles, request) {
            Ok(result) if result.success => append_project_task_log(
                project,
                ProjectCommandKind::Dev,
                format!(
                    "after-ready action {} success target={} url={}",
                    action_key, result.target_id, result.url
                ),
            ),
            Ok(result) => append_project_task_log(
                project,
                ProjectCommandKind::Dev,
                format!(
                    "after-ready action {} failed target={} error={}",
                    action_key,
                    result.target_id,
                    result.error.unwrap_or_else(|| result.result_text)
                ),
            ),
            Err(error) => append_project_task_log(
                project,
                ProjectCommandKind::Dev,
                format!("after-ready action {} error={}", action_key, error),
            ),
        }
    }

    Ok(())
}

fn project_web_action_context_params(
    project: &ProjectConfig,
    url: &str,
    debug_profile: Option<&ProjectDebugProfileConfig>,
    runtime_profile: Option<&RuntimeProfileConfig>,
) -> BTreeMap<String, String> {
    let mut params = BTreeMap::new();
    insert_context_param(&mut params, "project.key", &project.key);
    insert_context_param(&mut params, "project.name", &project.name);
    insert_context_param(&mut params, "project.category", &project.category);
    if let Some(path) = &project.repo_path {
        insert_context_param(&mut params, "project.repoPath", path.display().to_string());
        insert_context_param(&mut params, "project.repo_path", path.display().to_string());
    }
    if let Some(url) = optional_trimmed(project.focus.url.as_deref()) {
        insert_context_param(&mut params, "project.focusUrl", url);
        insert_context_param(&mut params, "project.focus_url", url);
    }
    insert_context_param(&mut params, "project.readyUrl", url);
    insert_context_param(&mut params, "project.ready_url", url);
    insert_context_param(&mut params, "context.url", url);

    if let Some(profile) = debug_profile {
        insert_context_param(&mut params, "debugProfile.key", &profile.key);
        insert_context_param(&mut params, "debug_profile.key", &profile.key);
        insert_context_param(&mut params, "debugProfile.label", &profile.label);
        insert_context_param(&mut params, "debug_profile.label", &profile.label);
        if let Some(runtime_profile) = optional_trimmed(profile.runtime_profile.as_deref()) {
            insert_context_param(&mut params, "debugProfile.runtimeProfile", runtime_profile);
            insert_context_param(
                &mut params,
                "debug_profile.runtime_profile",
                runtime_profile,
            );
        }
        for (key, value) in &profile.env {
            insert_context_param(&mut params, format!("debugProfile.env.{}", key), value);
            insert_context_param(&mut params, format!("debug_profile.env.{}", key), value);
        }
    }

    if let Some(profile) = runtime_profile {
        insert_context_param(&mut params, "runtimeProfile.key", &profile.key);
        insert_context_param(&mut params, "runtime_profile.key", &profile.key);
        insert_context_param(&mut params, "runtimeProfile.label", &profile.label);
        insert_context_param(&mut params, "runtime_profile.label", &profile.label);
        insert_context_param(
            &mut params,
            "runtimeProfile.webActionsPort",
            profile.web_actions_port.to_string(),
        );
        insert_context_param(
            &mut params,
            "runtime_profile.web_actions_port",
            profile.web_actions_port.to_string(),
        );
        if let Some(proxy_url) = optional_trimmed(Some(profile.proxy_url.as_str())) {
            insert_context_param(&mut params, "runtimeProfile.proxyUrl", proxy_url);
            insert_context_param(&mut params, "runtime_profile.proxy_url", proxy_url);
        }
    }

    params
}

fn insert_context_param(
    params: &mut BTreeMap<String, String>,
    key: impl Into<String>,
    value: impl AsRef<str>,
) {
    let value = value.as_ref().trim();
    if !value.is_empty() {
        params.insert(key.into(), value.to_string());
    }
}

fn project_ready_navigation_entry(
    project: &ProjectConfig,
    url: &str,
    debug_profile: Option<&ProjectDebugProfileConfig>,
    runtime_profile: Option<&RuntimeProfileConfig>,
) -> NavigationEntry {
    NavigationEntry {
        name: project.name.clone(),
        kind: "url".to_string(),
        target_label: project.category_label().to_string(),
        url: Some(url.to_string()),
        browser: debug_profile
            .and_then(|profile| optional_trimmed(profile.browser.as_deref()))
            .map(ToString::to_string),
        browser_profile: debug_profile
            .and_then(|profile| optional_trimmed(profile.browser_profile.as_deref()))
            .map(ToString::to_string),
        runtime_profile: debug_profile
            .and_then(|profile| optional_trimmed(profile.runtime_profile.as_deref()))
            .map(ToString::to_string)
            .or_else(|| runtime_profile.map(|profile| profile.key.clone())),
        bundle_id: None,
        app_name: None,
        script: None,
        path: None,
        cwd: project
            .repo_path
            .as_ref()
            .map(|path| path.display().to_string()),
        note: Some("项目 ready 后动作".to_string()),
    }
}

fn append_project_task_log(
    project: &ProjectConfig,
    kind: ProjectCommandKind,
    message: impl AsRef<str>,
) {
    let path = task_log_path(project, kind);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "[{}] {}", now_ms(), message.as_ref());
    }
    log_project_runtime_event(format!("key={} {}", project.key, message.as_ref()));
}

fn scrub_launcher_env(command: &mut Command) {
    let inherited_keys = std::env::vars().map(|(key, _)| key).collect::<Vec<_>>();
    for key in inherited_keys {
        if should_strip_inherited_env(&key) {
            command.env_remove(key);
        }
    }
}

fn should_strip_inherited_env(key: &str) -> bool {
    key == "OUT_DIR"
        || key.starts_with("TAURI_")
        || key == "CARGO_MANIFEST_DIR"
        || key == "CARGO_MANIFEST_PATH"
        || key.starts_with("CARGO_PKG_")
}

fn resolve_project_command(
    project: &ProjectConfig,
    kind: ProjectCommandKind,
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
        env: command_config
            .env
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect(),
    })
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

fn selected_runtime_profile(
    config: &AppConfig,
    profile: &ProjectDebugProfileConfig,
) -> Result<Option<RuntimeProfileConfig>, String> {
    let Some(runtime_profile_key) = profile
        .runtime_profile
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
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

fn apply_network_proxy_env(
    resolved: &mut ResolvedProjectCommand,
    profile: &ProjectDebugProfileConfig,
    runtime_profile: Option<&RuntimeProfileConfig>,
) -> Result<(), String> {
    let proxy = if profile.network_proxy.enabled {
        &profile.network_proxy
    } else if let Some(runtime_profile) = runtime_profile {
        &runtime_profile.network_proxy
    } else {
        &profile.network_proxy
    };
    if !proxy.enabled {
        return Ok(());
    }

    let proxy_url = proxy.proxy_url.trim();
    if proxy_url.is_empty() {
        return Err(format!("调试档案 {} 的代理地址为空", profile.key));
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
        if !proxy_url.to_lowercase().starts_with("http://") {
            return Err(format!(
                "调试档案 {} 的 Node Hook 当前只支持 http:// 代理",
                profile.key
            ));
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

    Ok(())
}

fn normalize_network_proxy_no_proxy(value: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        "localhost,127.0.0.1,::1".to_string()
    } else {
        value.to_string()
    }
}

fn open_focus_url(
    url: &str,
    profile: Option<&ProjectDebugProfileConfig>,
    runtime_profile: Option<&RuntimeProfileConfig>,
) -> Result<(), String> {
    if !debug_profile_has_browser_config(profile, runtime_profile) {
        open_in_current_chrome(url)
            .map(|_| ())
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    let browser = profile
        .and_then(|profile| optional_trimmed(profile.browser.as_deref()))
        .or_else(|| {
            runtime_profile
                .and_then(|runtime_profile| optional_trimmed(runtime_profile.browser.as_deref()))
        });
    let browser_profile = profile
        .and_then(|profile| optional_trimmed(profile.browser_profile.as_deref()))
        .or_else(|| {
            runtime_profile.and_then(|runtime_profile| {
                optional_trimmed(runtime_profile.browser_profile.as_deref())
            })
        });
    let browser_user_data_dir = profile
        .and_then(|profile| profile.browser_user_data_dir.as_ref())
        .map(Clone::clone)
        .or_else(|| runtime_profile_browser_user_data_dir(runtime_profile));
    let mut browser_args = runtime_profile
        .map(runtime_profile_browser_args)
        .unwrap_or_default();
    browser_args.extend(profile.into_iter().flat_map(|profile| {
        profile
            .browser_args
            .iter()
            .filter_map(|arg| normalize_browser_arg(arg))
    }));

    let browser_args = browser_args
        .iter()
        .filter_map(|arg| normalize_browser_arg(arg))
        .collect::<Vec<_>>();

    let has_chromium_args =
        browser_profile.is_some() || browser_user_data_dir.is_some() || !browser_args.is_empty();
    if !has_chromium_args {
        match browser.map(normalize_browser_choice) {
            None | Some(ProjectBrowserChoice::CurrentChrome) => {
                open_in_current_chrome(url)
                    .map(|_| ())
                    .map_err(|error| error.to_string())?;
            }
            Some(ProjectBrowserChoice::System) => open_system_browser(url)?,
            Some(ProjectBrowserChoice::App(app_name)) => open_browser_app(app_name, url)?,
        }
        return Ok(());
    }

    let app_name = match browser.map(normalize_browser_choice) {
        Some(ProjectBrowserChoice::App(app_name)) => app_name.to_string(),
        _ => "Google Chrome".to_string(),
    };
    open_chromium_browser_instance(
        &app_name,
        browser_profile,
        browser_user_data_dir.as_ref(),
        &browser_args,
        url,
    )
}

fn debug_profile_has_browser_config(
    profile: Option<&ProjectDebugProfileConfig>,
    runtime_profile: Option<&RuntimeProfileConfig>,
) -> bool {
    profile.is_some_and(|profile| {
        optional_trimmed(profile.browser.as_deref()).is_some()
            || optional_trimmed(profile.browser_profile.as_deref()).is_some()
            || profile.browser_user_data_dir.is_some()
            || profile
                .browser_args
                .iter()
                .any(|arg| !arg.trim().is_empty())
    }) || runtime_profile.is_some_and(|runtime_profile| {
        optional_trimmed(runtime_profile.browser.as_deref()).is_some()
            || optional_trimmed(runtime_profile.browser_profile.as_deref()).is_some()
            || runtime_profile.browser_user_data_dir.is_some()
            || !runtime_profile.proxy_url.trim().is_empty()
            || !runtime_profile.proxy_bypass.trim().is_empty()
            || runtime_profile
                .host_resolver_rules
                .iter()
                .any(|rule| !rule.trim().is_empty())
            || runtime_profile
                .browser_args
                .iter()
                .any(|arg| !arg.trim().is_empty())
    })
}

enum ProjectBrowserChoice<'a> {
    CurrentChrome,
    System,
    App(&'a str),
}

fn normalize_browser_choice(value: &str) -> ProjectBrowserChoice<'_> {
    match value.trim().to_ascii_lowercase().as_str() {
        "" | "current_chrome" | "current chrome" | "chrome_current" | "chrome-current" => {
            ProjectBrowserChoice::CurrentChrome
        }
        "system" | "default" | "system_default" | "default_browser" => ProjectBrowserChoice::System,
        _ => ProjectBrowserChoice::App(value.trim()),
    }
}

fn optional_trimmed(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn normalize_browser_arg(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    let Some((key, raw_value)) = value.split_once('=') else {
        return Some(value.to_string());
    };
    let raw_value = raw_value.trim();
    if raw_value.len() >= 2 && raw_value.starts_with('"') && raw_value.ends_with('"') {
        return Some(format!(
            "{}={}",
            key.trim(),
            &raw_value[1..raw_value.len() - 1]
        ));
    }
    Some(value.to_string())
}

fn runtime_profile_browser_args(profile: &RuntimeProfileConfig) -> Vec<String> {
    let mut args = Vec::new();
    if profile.web_actions_enabled {
        args.push(format!(
            "--remote-debugging-port={}",
            profile.web_actions_port
        ));
    }
    let proxy_url = profile.proxy_url.trim();
    if !proxy_url.is_empty() {
        args.push(format!("--proxy-server={proxy_url}"));
    }
    let proxy_bypass = profile.proxy_bypass.trim();
    if !proxy_bypass.is_empty() {
        args.push(format!("--proxy-bypass-list={proxy_bypass}"));
    }
    let host_resolver_rules = profile
        .host_resolver_rules
        .iter()
        .map(|rule| rule.trim())
        .filter(|rule| !rule.is_empty())
        .collect::<Vec<_>>();
    if !host_resolver_rules.is_empty() {
        args.push(format!(
            "--host-resolver-rules={}",
            host_resolver_rules.join(", ")
        ));
    }
    args.extend(profile.browser_args.iter().filter_map(|arg| {
        let arg = normalize_browser_arg(arg)?;
        if profile.web_actions_enabled
            && arg
                .to_ascii_lowercase()
                .starts_with("--remote-debugging-port")
        {
            None
        } else {
            Some(arg)
        }
    }));
    args
}

fn runtime_profile_browser_user_data_dir(
    profile: Option<&RuntimeProfileConfig>,
) -> Option<PathBuf> {
    profile.and_then(|profile| {
        profile
            .web_actions_user_data_dir
            .clone()
            .or_else(|| profile.browser_user_data_dir.clone())
            .or_else(|| {
                profile
                    .web_actions_enabled
                    .then(|| default_config_dir().join("chrome-cdp-profile"))
            })
    })
}

fn open_system_browser(url: &str) -> Result<(), String> {
    let status = Command::new("open")
        .arg(url)
        .status()
        .map_err(|error| format!("调用系统浏览器失败: {}", error))?;
    if !status.success() {
        return Err("系统浏览器打开失败".to_string());
    }
    Ok(())
}

fn open_browser_app(app_name: &str, url: &str) -> Result<(), String> {
    let status = Command::new("open")
        .arg("-a")
        .arg(app_name)
        .arg(url)
        .status()
        .map_err(|error| format!("调用浏览器失败: {}", error))?;
    if !status.success() {
        return Err(format!("{} 打开失败", app_name));
    }
    Ok(())
}

fn open_chromium_browser_instance(
    app_name: &str,
    browser_profile: Option<&str>,
    browser_user_data_dir: Option<&PathBuf>,
    browser_args: &[String],
    url: &str,
) -> Result<(), String> {
    let mut command = Command::new("open");
    command.arg("-na").arg(app_name).arg("--args");
    if let Some(profile) = browser_profile {
        command.arg(format!("--profile-directory={profile}"));
    }
    if let Some(user_data_dir) = browser_user_data_dir {
        command.arg(format!("--user-data-dir={}", user_data_dir.display()));
    }
    for arg in browser_args {
        command.arg(arg);
    }
    command.arg(url);

    let status = command
        .status()
        .map_err(|error| format!("启动浏览器实例失败: {}", error))?;
    if !status.success() {
        return Err(format!("{} 浏览器实例启动失败", app_name));
    }
    Ok(())
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
) -> Result<(), String> {
    if profile.local_files.is_empty() {
        return Ok(());
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
    for local_file in profile.local_files.iter().filter(|item| item.enabled) {
        let (target_path, relative_path) =
            resolve_debug_local_file_path(repo_path, &local_file.path)?;
        if git_checked {
            ensure_debug_local_file_git_safe(repo_path, &relative_path)?;
        }
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("创建本地调试文件目录失败: {}", error))?;
        }
        match local_file.mode.trim() {
            "" | "overwrite" => {
                fs::write(&target_path, &local_file.content)
                    .map_err(|error| format!("写入本地调试文件失败: {}", error))?;
            }
            "append_block" => {
                write_debug_append_block(
                    &target_path,
                    &profile.key,
                    &relative_path,
                    &local_file.content,
                )?;
            }
            other => {
                return Err(format!(
                    "本地调试文件 {} 使用了不支持的写入方式: {}",
                    relative_path, other
                ));
            }
        }
        log_project_runtime_event(format!(
            "debug profile applied project={} profile={} file={} mode={}",
            project.key, profile.key, relative_path, local_file.mode
        ));
    }
    Ok(())
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

fn resolve_command_cwd(
    project: &ProjectConfig,
    command_config: &ProjectCommandConfig,
    kind: ProjectCommandKind,
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

fn runtime_display_config(project: &ProjectConfig) -> RuntimeDisplayConfig {
    RuntimeDisplayConfig {
        repo_path: project
            .repo_path
            .as_ref()
            .map(|path| path.display().to_string()),
        dev: task_display_config(project, ProjectCommandKind::Dev),
        build: task_display_config(project, ProjectCommandKind::Build),
    }
}

fn resolve_focus_target(project: &ProjectConfig) -> Option<ProjectFocusTarget> {
    let bundle_id = project
        .focus
        .bundle_id
        .as_deref()
        .map(str::trim)
        .unwrap_or("");
    if !bundle_id.is_empty() {
        return Some(ProjectFocusTarget::AppBundle(bundle_id.to_string()));
    }

    let url = project.focus.url.as_deref().map(str::trim).unwrap_or("");
    if url.starts_with("http://") || url.starts_with("https://") {
        return Some(ProjectFocusTarget::Url(url.to_string()));
    }

    None
}

fn task_display_config(project: &ProjectConfig, kind: ProjectCommandKind) -> TaskDisplayConfig {
    let Some(command_config) = project_command_config(project, kind) else {
        return TaskDisplayConfig {
            configured: false,
            command: None,
            cwd: None,
            output_dir: None,
        };
    };

    let command = Some(command_config.command.trim().to_string()).filter(|value| !value.is_empty());
    let cwd = match command_config.cwd.as_ref() {
        Some(path) if path.is_absolute() => Some(path.display().to_string()),
        Some(path) => project
            .repo_path
            .as_ref()
            .map(|repo_path| repo_path.join(path))
            .map(|value| value.display().to_string()),
        None => project
            .repo_path
            .as_ref()
            .map(|path| path.display().to_string()),
    };
    let output_dir = if matches!(kind, ProjectCommandKind::Build) {
        resolve_build_output_dir(project).map(|path| path.display().to_string())
    } else {
        None
    };

    TaskDisplayConfig {
        configured: true,
        command,
        cwd,
        output_dir,
    }
}

fn resolve_build_output_dir(project: &ProjectConfig) -> Option<PathBuf> {
    let command_config = project.build.as_ref()?;
    let base_dir = resolve_command_cwd(project, command_config, ProjectCommandKind::Build).ok()?;

    if let Some(output_dir) = command_config.output_dir.as_ref() {
        return Some(resolve_relative_path(&base_dir, output_dir));
    }

    find_default_build_output_dir(&base_dir)
}

fn resolve_relative_path(base_dir: &Path, target: &Path) -> PathBuf {
    if target.is_absolute() {
        target.to_path_buf()
    } else {
        base_dir.join(target)
    }
}

fn find_default_build_output_dir(base_dir: &Path) -> Option<PathBuf> {
    [
        "dist",
        "build",
        "out",
        "src-tauri/target/release/bundle",
        "target/release/bundle",
    ]
    .into_iter()
    .map(|relative| base_dir.join(relative))
    .find(|candidate| candidate.exists() && candidate.is_dir())
}

fn project_command_config(
    project: &ProjectConfig,
    kind: ProjectCommandKind,
) -> Option<&ProjectCommandConfig> {
    match kind {
        ProjectCommandKind::Dev => project.dev.as_ref(),
        ProjectCommandKind::Build => project.build.as_ref(),
    }
}

impl ProjectCommandKind {
    fn action_label(self) -> &'static str {
        match self {
            Self::Dev => "启动",
            Self::Build => "执行打包",
        }
    }

    fn config_block(self) -> &'static str {
        match self {
            Self::Dev => "[projects.dev]",
            Self::Build => "[projects.build]",
        }
    }

    fn command_label(self) -> &'static str {
        match self {
            Self::Dev => "启动命令",
            Self::Build => "打包命令",
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

    fn idle_state(self) -> (&'static str, &'static str, &'static str) {
        match self {
            Self::Dev => ("stopped", "未启动", "配置已就绪，可启动 dev 服务"),
            Self::Build => ("stopped", "待打包", "配置已就绪，可执行打包任务"),
        }
    }

    fn running_state(self) -> (&'static str, &'static str, &'static str) {
        match self {
            Self::Dev => ("running", "运行中", "dev 服务正在运行"),
            Self::Build => ("running", "打包中", "打包任务正在运行"),
        }
    }

    fn quick_exit_state(self, code: Option<i32>) -> ProjectTaskLastState {
        match self {
            Self::Dev => dev_exit_state(code, true),
            Self::Build => {
                if code == Some(0) {
                    ProjectTaskLastState {
                        status_key: "succeeded".to_string(),
                        status_label: "已打包".to_string(),
                        detail: "打包任务已完成".to_string(),
                        updated_at_ms: now_ms(),
                    }
                } else {
                    ProjectTaskLastState {
                        status_key: "failed".to_string(),
                        status_label: "失败".to_string(),
                        detail: match code {
                            Some(value) => format!("打包命令已失败，退出码 {}", value),
                            None => "打包命令已退出".to_string(),
                        },
                        updated_at_ms: now_ms(),
                    }
                }
            }
        }
    }

    fn finished_state(self, code: Option<i32>) -> ProjectTaskLastState {
        match self {
            Self::Dev => dev_exit_state(code, false),
            Self::Build => {
                if code == Some(0) {
                    ProjectTaskLastState {
                        status_key: "succeeded".to_string(),
                        status_label: "已打包".to_string(),
                        detail: "最近一次打包任务已完成".to_string(),
                        updated_at_ms: now_ms(),
                    }
                } else {
                    ProjectTaskLastState {
                        status_key: "failed".to_string(),
                        status_label: "失败".to_string(),
                        detail: match code {
                            Some(value) => format!("最近一次打包任务失败，退出码 {}", value),
                            None => "最近一次打包任务已退出".to_string(),
                        },
                        updated_at_ms: now_ms(),
                    }
                }
            }
        }
    }
}

fn dev_exit_state(code: Option<i32>, quick_exit: bool) -> ProjectTaskLastState {
    if code == Some(0) {
        return ProjectTaskLastState {
            status_key: "stopped".to_string(),
            status_label: "未启动".to_string(),
            detail: if quick_exit {
                "启动命令已正常退出".to_string()
            } else {
                "dev 服务已正常退出".to_string()
            },
            updated_at_ms: now_ms(),
        };
    }

    ProjectTaskLastState {
        status_key: "exited".to_string(),
        status_label: "已退出".to_string(),
        detail: match (quick_exit, code) {
            (true, Some(value)) => format!("启动命令很快退出，退出码 {}", value),
            (true, None) => "启动命令已退出".to_string(),
            (false, Some(value)) => format!("最近一次 dev 服务已退出，退出码 {}", value),
            (false, None) => "最近一次 dev 服务已退出".to_string(),
        },
        updated_at_ms: now_ms(),
    }
}

fn open_path(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(path);
        command
    };

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.arg("/C").arg("start").arg("").arg(path);
        command
    };

    let status = command
        .status()
        .map_err(|error| format!("打开目录失败: {}", error))?;
    if !status.success() {
        return Err(format!("打开目录失败，退出码 {:?}", status.code()));
    }

    Ok(())
}

fn focus_app_bundle(bundle_id: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let status = Command::new("open")
            .arg("-b")
            .arg(bundle_id)
            .status()
            .map_err(|error| format!("唤起应用失败: {}", error))?;

        if !status.success() {
            return Err(format!("唤起应用失败，退出码 {:?}", status.code()));
        }

        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        let _ = bundle_id;
        return Err("当前平台暂不支持按 bundle_id 唤起应用".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let _ = bundle_id;
        return Err("当前平台暂不支持按 bundle_id 唤起应用".to_string());
    }
}

fn terminate_process(child: &mut Child, _pid: u32) -> Result<(), String> {
    #[cfg(unix)]
    {
        let status = Command::new("kill")
            .arg("-TERM")
            .arg(format!("-{}", _pid))
            .status()
            .map_err(|error| format!("发送停止信号失败: {}", error))?;
        if !status.success() {
            child
                .kill()
                .map_err(|error| format!("停止进程失败: {}", error))?;
        }
    }

    #[cfg(not(unix))]
    {
        child
            .kill()
            .map_err(|error| format!("停止进程失败: {}", error))?;
    }

    child
        .wait()
        .map_err(|error| format!("等待进程退出失败: {}", error))?;
    Ok(())
}

fn terminate_running_project_process(process: &mut RunningProjectProcess) -> Result<(), String> {
    terminate_local_proxy(&mut process.local_proxy);
    terminate_process(&mut process.child, process.pid)
}

fn terminate_local_proxy(local_proxy: &mut Option<RunningLocalProxyProcess>) {
    if let Some(proxy) = local_proxy.as_mut() {
        log_project_runtime_event(format!(
            "local proxy stopping pid={} listen={}",
            proxy.pid, proxy.listen
        ));
        let _ = terminate_process(&mut proxy.child, proxy.pid);
    }
    *local_proxy = None;
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn log_project_runtime_event(message: String) {
    let path = default_config_dir().join("project-runtime.log");
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "[{}] {}", now_ms(), message);
    }
}

#[cfg(test)]
mod tests {
    use super::should_strip_inherited_env;

    #[test]
    fn strips_tauri_and_manifest_metadata_from_launcher_env() {
        assert!(should_strip_inherited_env("TAURI_CONFIG"));
        assert!(should_strip_inherited_env("CARGO_MANIFEST_DIR"));
        assert!(should_strip_inherited_env("CARGO_MANIFEST_PATH"));
        assert!(should_strip_inherited_env("CARGO_PKG_NAME"));
        assert!(should_strip_inherited_env("OUT_DIR"));
    }

    #[test]
    fn keeps_general_runtime_env_available() {
        assert!(!should_strip_inherited_env("PATH"));
        assert!(!should_strip_inherited_env("HOME"));
        assert!(!should_strip_inherited_env("RUSTUP_HOME"));
        assert!(!should_strip_inherited_env("CARGO_HOME"));
    }
}
