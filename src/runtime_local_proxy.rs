use crate::config::{ProjectDebugProfileConfig, ProjectLocalProxyConfig, default_config_dir};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

const LOCAL_PROXY_SCRIPT_FILENAME: &str = "rdevtool-local-proxy.cjs";

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

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLocalProxySpec {
    pub project_key: String,
    pub profile_key: String,
    pub config: ProjectLocalProxyConfig,
    pub log_path: String,
}

pub(crate) struct RunningLocalProxy {
    pub child: Child,
    pub pid: u32,
    pub pgid: Option<u32>,
    pub config_path: PathBuf,
}

pub fn local_proxy_spec(
    project_key: &str,
    profile: &ProjectDebugProfileConfig,
) -> Option<RuntimeLocalProxySpec> {
    profile.local_proxy.enabled.then(|| RuntimeLocalProxySpec {
        project_key: project_key.to_string(),
        profile_key: profile.key.clone(),
        config: profile.local_proxy.clone(),
        log_path: local_proxy_log_path(project_key, &profile.key)
            .display()
            .to_string(),
    })
}

pub fn validate_local_proxy_spec(spec: &RuntimeLocalProxySpec) -> Result<(), String> {
    let (host, port) = parse_listen(&spec.config.listen)?;
    if spec.config.frontend_url.trim().is_empty() {
        return Err("本地 API 代理缺少 frontend_url".to_string());
    }
    if spec.config.routes.iter().any(|route| {
        route.enabled && (route.match_prefix.trim().is_empty() || route.target.trim().is_empty())
    }) {
        return Err("本地 API 代理存在缺少 match_prefix 或 target 的启用路由".to_string());
    }
    TcpListener::bind((host.as_str(), port))
        .map_err(|error| format!("本地 API 代理端口 {} 不可用: {}", spec.config.listen, error))?;
    Ok(())
}

pub(crate) fn spawn_local_proxy(
    spec: &RuntimeLocalProxySpec,
    run_id: &str,
    runtime_dir: &Path,
) -> Result<RunningLocalProxy, String> {
    let script_path = ensure_local_proxy_script(runtime_dir)?;
    let config_path = write_local_proxy_config(spec, run_id, runtime_dir)?;
    let mut log_file = open_local_proxy_log(spec)?;
    let stdout = log_file
        .try_clone()
        .map_err(|error| format!("创建本地代理日志失败: {error}"))?;
    let stderr = log_file
        .try_clone()
        .map_err(|error| format!("创建本地代理日志失败: {error}"))?;
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
    let child = command
        .spawn()
        .map_err(|error| format!("启动本地 API 代理失败: {error}"))?;
    let pid = child.id();
    let _ = writeln!(
        log_file,
        "[{}] local proxy spawned pid={} listen={}",
        now_ms(),
        pid,
        spec.config.listen
    );
    Ok(RunningLocalProxy {
        child,
        pid,
        pgid: cfg!(unix).then_some(pid),
        config_path,
    })
}

pub(crate) fn remove_local_proxy_artifacts(process: &RunningLocalProxy) {
    let _ = fs::remove_file(&process.config_path);
}

fn ensure_local_proxy_script(runtime_dir: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(runtime_dir)
        .map_err(|error| format!("创建 runtime daemon 目录失败: {error}"))?;
    let script_path = runtime_dir.join(LOCAL_PROXY_SCRIPT_FILENAME);
    let needs_write = fs::read_to_string(&script_path)
        .map(|content| content != LOCAL_PROXY_SCRIPT)
        .unwrap_or(true);
    if needs_write {
        fs::write(&script_path, LOCAL_PROXY_SCRIPT)
            .map_err(|error| format!("写入本地 API 代理脚本失败: {error}"))?;
    }
    Ok(script_path)
}

fn write_local_proxy_config(
    spec: &RuntimeLocalProxySpec,
    run_id: &str,
    runtime_dir: &Path,
) -> Result<PathBuf, String> {
    let config_path = runtime_dir.join(format!("local-proxy-{}.json", safe_name(run_id)));
    let content = serde_json::to_vec_pretty(&json!({
        "project_key": &spec.project_key,
        "profile_key": &spec.profile_key,
        "proxy": &spec.config,
    }))
    .map_err(|error| format!("生成本地代理配置失败: {error}"))?;
    fs::write(&config_path, content).map_err(|error| format!("写入本地代理配置失败: {error}"))?;
    restrict_file_permissions(&config_path)?;
    Ok(config_path)
}

fn open_local_proxy_log(spec: &RuntimeLocalProxySpec) -> Result<File, String> {
    let path = Path::new(&spec.log_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建日志目录失败: {error}"))?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("打开本地代理日志失败: {error}"))?;
    writeln!(
        file,
        "\n[{}] local proxy start key={} profile={} listen={} frontend={} upstream={}",
        now_ms(),
        spec.project_key,
        spec.profile_key,
        spec.config.listen,
        spec.config.frontend_url,
        spec.config.upstream_proxy
    )
    .map_err(|error| format!("写入本地代理日志失败: {error}"))?;
    Ok(file)
}

fn parse_listen(value: &str) -> Result<(String, u16), String> {
    let value = value.trim();
    let (host, port) = if let Some(rest) = value.strip_prefix('[') {
        let (host, port) = rest
            .split_once("]:")
            .ok_or_else(|| format!("无效的本地代理监听地址: {value}"))?;
        (host.to_string(), port)
    } else if let Some((host, port)) = value.rsplit_once(':') {
        (host.to_string(), port)
    } else {
        ("127.0.0.1".to_string(), value)
    };
    let host = if host.trim().is_empty() {
        "127.0.0.1".to_string()
    } else {
        host
    };
    let port = port
        .parse::<u16>()
        .map_err(|_| format!("无效的本地代理监听端口: {value}"))?;
    Ok((host, port))
}

fn local_proxy_log_path(project_key: &str, profile_key: &str) -> PathBuf {
    default_config_dir().join("runtime-logs").join(format!(
        "{}-{}-local-proxy.log",
        safe_name(project_key),
        safe_name(profile_key)
    ))
}

fn safe_name(value: &str) -> String {
    let value = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    let value = value.trim_matches('-');
    if value.is_empty() {
        "runtime".to_string()
    } else {
        value.to_string()
    }
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

fn restrict_file_permissions(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("限制本地代理配置权限失败: {error}"))?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::{RuntimeLocalProxySpec, parse_listen, validate_local_proxy_spec};
    use crate::config::ProjectLocalProxyConfig;
    use std::net::TcpListener;

    #[test]
    fn parses_ipv4_and_ipv6_listen_addresses() {
        assert_eq!(
            parse_listen("127.0.0.1:3000").unwrap(),
            ("127.0.0.1".to_string(), 3000)
        );
        assert_eq!(
            parse_listen("[::1]:3001").unwrap(),
            ("::1".to_string(), 3001)
        );
    }

    #[test]
    fn validation_rejects_an_owned_port() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let listen = listener.local_addr().unwrap().to_string();
        let spec = RuntimeLocalProxySpec {
            project_key: "sample".to_string(),
            profile_key: "debug".to_string(),
            config: ProjectLocalProxyConfig {
                enabled: true,
                listen,
                frontend_url: "http://127.0.0.1:5173".to_string(),
                ..ProjectLocalProxyConfig::default()
            },
            log_path: "/tmp/rdevtool-local-proxy-test.log".to_string(),
        };
        assert!(validate_local_proxy_spec(&spec).is_err());
    }
}
