use anyhow::{Context, Result, anyhow, bail};
use chrono::Utc;
use reqwest::blocking::Client;
use reqwest::{Method, StatusCode, Url};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use std::thread;
use std::time::{Duration, Instant};
use uuid::Uuid;

use crate::config::default_config_dir;

const MAX_PROXY_EVENTS: usize = 500;
const DEFAULT_PROXY_PORT: u16 = 8787;
const DEFAULT_CAPTURE_BYTES: usize = 4096;
const PROXY_READ_TIMEOUT: Duration = Duration::from_secs(60);
const PROXY_WRITE_TIMEOUT: Duration = Duration::from_secs(60);

fn default_profile_id() -> String {
    "default".to_string()
}

fn default_profile_name() -> String {
    "默认代理".to_string()
}

fn default_listen_host() -> String {
    "127.0.0.1".to_string()
}

fn default_listen_port() -> u16 {
    DEFAULT_PROXY_PORT
}

fn default_true() -> bool {
    true
}

fn default_capture_bytes() -> usize {
    DEFAULT_CAPTURE_BYTES
}

fn default_mock_status() -> u16 {
    200
}

fn default_block_status() -> u16 {
    403
}

fn default_content_type() -> String {
    "application/json; charset=utf-8".to_string()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyConfig {
    #[serde(default)]
    pub profiles: Vec<ProxyProfile>,
    #[serde(default)]
    pub rules: Vec<ProxyRule>,
}

impl Default for ProxyConfig {
    fn default() -> Self {
        Self {
            profiles: vec![ProxyProfile::default()],
            rules: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyProfile {
    #[serde(default = "default_profile_id")]
    pub id: String,
    #[serde(default = "default_profile_name")]
    pub name: String,
    #[serde(default = "default_listen_host")]
    pub listen_host: String,
    #[serde(default = "default_listen_port")]
    pub listen_port: u16,
    #[serde(default)]
    pub upstream_base_url: String,
    #[serde(default)]
    pub upstream_proxy: String,
    #[serde(default = "default_true")]
    pub capture_body: bool,
    #[serde(default = "default_capture_bytes")]
    pub max_body_bytes: usize,
}

impl Default for ProxyProfile {
    fn default() -> Self {
        Self {
            id: default_profile_id(),
            name: default_profile_name(),
            listen_host: default_listen_host(),
            listen_port: default_listen_port(),
            upstream_base_url: String::new(),
            upstream_proxy: String::new(),
            capture_body: true,
            max_body_bytes: DEFAULT_CAPTURE_BYTES,
        }
    }
}

impl ProxyProfile {
    pub fn listen_addr(&self) -> String {
        format!("{}:{}", self.listen_host, self.listen_port)
    }

    pub fn listen_url(&self) -> String {
        format!("http://{}", self.listen_addr())
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyRule {
    #[serde(default)]
    pub id: String,
    #[serde(default = "default_profile_id")]
    pub profile_id: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub method: String,
    #[serde(default)]
    pub url_contains: String,
    #[serde(default)]
    pub path_prefix: String,
    #[serde(default)]
    pub header_name: String,
    #[serde(default)]
    pub header_contains: String,
    #[serde(default)]
    pub action: ProxyRuleAction,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ProxyRuleAction {
    Forward {
        #[serde(default)]
        target_base_url: String,
        #[serde(default)]
        rewrite_prefix: String,
        #[serde(default)]
        request_headers: BTreeMap<String, String>,
        #[serde(default)]
        response_headers: BTreeMap<String, String>,
        #[serde(default)]
        delay_ms: u64,
    },
    Mock {
        #[serde(default = "default_mock_status")]
        status: u16,
        #[serde(default = "default_content_type")]
        content_type: String,
        #[serde(default)]
        body: String,
        #[serde(default)]
        headers: BTreeMap<String, String>,
        #[serde(default)]
        delay_ms: u64,
    },
    Block {
        #[serde(default = "default_block_status")]
        status: u16,
        #[serde(default)]
        body: String,
        #[serde(default)]
        delay_ms: u64,
    },
}

impl Default for ProxyRuleAction {
    fn default() -> Self {
        Self::Forward {
            target_base_url: String::new(),
            rewrite_prefix: String::new(),
            request_headers: BTreeMap::new(),
            response_headers: BTreeMap::new(),
            delay_ms: 0,
        }
    }
}

impl ProxyRuleAction {
    fn label(&self) -> &'static str {
        match self {
            ProxyRuleAction::Forward { .. } => "forward",
            ProxyRuleAction::Mock { .. } => "mock",
            ProxyRuleAction::Block { .. } => "block",
        }
    }

    fn delay_ms(&self) -> u64 {
        match self {
            ProxyRuleAction::Forward { delay_ms, .. }
            | ProxyRuleAction::Mock { delay_ms, .. }
            | ProxyRuleAction::Block { delay_ms, .. } => *delay_ms,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyProfileRuntimeStatus {
    pub profile_id: String,
    pub running: bool,
    pub listen_url: String,
    pub started_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyEvent {
    pub id: String,
    pub profile_id: String,
    pub profile_name: String,
    pub started_at: String,
    pub duration_ms: u128,
    pub method: String,
    pub url: String,
    pub path: String,
    pub status: Option<u16>,
    pub action: String,
    pub matched_rule_id: Option<String>,
    pub matched_rule_name: Option<String>,
    pub request_bytes: usize,
    pub response_bytes: usize,
    pub request_headers: BTreeMap<String, String>,
    pub response_headers: BTreeMap<String, String>,
    pub request_body_preview: String,
    pub response_body_preview: String,
    pub request_body_truncated: bool,
    pub response_body_truncated: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyDashboard {
    pub config_path: String,
    pub config: ProxyConfig,
    pub statuses: Vec<ProxyProfileRuntimeStatus>,
    pub events: Vec<ProxyEvent>,
}

#[derive(Clone, Default)]
pub struct ProxyRuntimeState {
    inner: Arc<Mutex<ProxyRuntimeInner>>,
}

#[derive(Default)]
struct ProxyRuntimeInner {
    servers: HashMap<String, ProxyServerHandle>,
    events: VecDeque<ProxyEvent>,
}

struct ProxyServerHandle {
    stop: Arc<AtomicBool>,
    listen_url: String,
    started_at: String,
}

pub fn default_proxy_path() -> PathBuf {
    default_config_dir().join("proxy.toml")
}

pub fn ensure_proxy_config() -> Result<PathBuf> {
    let path = default_proxy_path();
    if !path.exists() {
        save_proxy_config(&path, &ProxyConfig::default())?;
    }
    Ok(path)
}

pub fn load_proxy_config(path: &Path) -> Result<ProxyConfig> {
    if !path.exists() {
        return Ok(ProxyConfig::default());
    }
    let content = fs::read_to_string(path)
        .with_context(|| format!("failed to read proxy config: {}", path.display()))?;
    let mut config: ProxyConfig = toml::from_str(&content)
        .with_context(|| format!("failed to parse proxy config: {}", path.display()))?;
    normalize_proxy_config(&mut config);
    Ok(config)
}

pub fn save_proxy_config(path: &Path, config: &ProxyConfig) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create proxy config dir: {}", parent.display()))?;
    }
    let mut normalized = config.clone();
    normalize_proxy_config(&mut normalized);
    let content = toml::to_string_pretty(&normalized)
        .with_context(|| format!("failed to serialize proxy config: {}", path.display()))?;
    fs::write(path, content)
        .with_context(|| format!("failed to write proxy config: {}", path.display()))?;
    Ok(())
}

pub fn upsert_proxy_profile(path: &Path, profile: ProxyProfile) -> Result<ProxyConfig> {
    let mut config = load_proxy_config(path)?;
    let mut profile = profile;
    normalize_profile(&mut profile);
    if let Some(current) = config
        .profiles
        .iter_mut()
        .find(|item| item.id == profile.id)
    {
        *current = profile;
    } else {
        config.profiles.push(profile);
    }
    save_proxy_config(path, &config)?;
    load_proxy_config(path)
}

pub fn delete_proxy_profile(path: &Path, profile_id: &str) -> Result<ProxyConfig> {
    let mut config = load_proxy_config(path)?;
    config.profiles.retain(|profile| profile.id != profile_id);
    config.rules.retain(|rule| rule.profile_id != profile_id);
    if config.profiles.is_empty() {
        config.profiles.push(ProxyProfile::default());
    }
    save_proxy_config(path, &config)?;
    load_proxy_config(path)
}

pub fn upsert_proxy_rule(path: &Path, rule: ProxyRule) -> Result<ProxyConfig> {
    let mut config = load_proxy_config(path)?;
    let mut rule = rule;
    normalize_rule(&mut rule);
    if let Some(current) = config.rules.iter_mut().find(|item| item.id == rule.id) {
        *current = rule;
    } else {
        config.rules.push(rule);
    }
    save_proxy_config(path, &config)?;
    load_proxy_config(path)
}

pub fn delete_proxy_rule(path: &Path, rule_id: &str) -> Result<ProxyConfig> {
    let mut config = load_proxy_config(path)?;
    config.rules.retain(|rule| rule.id != rule_id);
    save_proxy_config(path, &config)?;
    load_proxy_config(path)
}

fn normalize_proxy_config(config: &mut ProxyConfig) {
    if config.profiles.is_empty() {
        config.profiles.push(ProxyProfile::default());
    }
    for profile in &mut config.profiles {
        normalize_profile(profile);
    }
    let profile_ids: Vec<String> = config
        .profiles
        .iter()
        .map(|profile| profile.id.clone())
        .collect();
    let fallback_profile_id = profile_ids
        .first()
        .cloned()
        .unwrap_or_else(default_profile_id);
    for rule in &mut config.rules {
        normalize_rule(rule);
        if !profile_ids.contains(&rule.profile_id) {
            rule.profile_id = fallback_profile_id.clone();
        }
    }
    config.rules.sort_by(|left, right| {
        left.priority
            .cmp(&right.priority)
            .then_with(|| left.name.cmp(&right.name))
            .then_with(|| left.id.cmp(&right.id))
    });
}

fn normalize_profile(profile: &mut ProxyProfile) {
    if profile.id.trim().is_empty() {
        profile.id = Uuid::new_v4().to_string();
    } else {
        profile.id = profile.id.trim().to_string();
    }
    if profile.name.trim().is_empty() {
        profile.name = "未命名代理".to_string();
    } else {
        profile.name = profile.name.trim().to_string();
    }
    if profile.listen_host.trim().is_empty() {
        profile.listen_host = default_listen_host();
    } else {
        profile.listen_host = profile.listen_host.trim().to_string();
    }
    if profile.listen_port == 0 {
        profile.listen_port = default_listen_port();
    }
    profile.upstream_base_url = profile.upstream_base_url.trim().to_string();
    profile.upstream_proxy = profile.upstream_proxy.trim().to_string();
    profile.max_body_bytes = profile.max_body_bytes.clamp(512, 128 * 1024);
}

fn normalize_rule(rule: &mut ProxyRule) {
    if rule.id.trim().is_empty() {
        rule.id = Uuid::new_v4().to_string();
    } else {
        rule.id = rule.id.trim().to_string();
    }
    if rule.profile_id.trim().is_empty() {
        rule.profile_id = default_profile_id();
    } else {
        rule.profile_id = rule.profile_id.trim().to_string();
    }
    if rule.name.trim().is_empty() {
        rule.name = "未命名规则".to_string();
    } else {
        rule.name = rule.name.trim().to_string();
    }
    rule.method = rule.method.trim().to_ascii_uppercase();
    rule.url_contains = rule.url_contains.trim().to_string();
    rule.path_prefix = rule.path_prefix.trim().to_string();
    rule.header_name = rule.header_name.trim().to_ascii_lowercase();
    rule.header_contains = rule.header_contains.trim().to_string();
}

impl ProxyRuntimeState {
    pub fn dashboard(&self, path: &Path) -> Result<ProxyDashboard> {
        let config = load_proxy_config(path)?;
        Ok(ProxyDashboard {
            config_path: path.display().to_string(),
            statuses: self.statuses_for_profiles(&config.profiles),
            events: self.events(None),
            config,
        })
    }

    pub fn start_profile(
        &self,
        path: PathBuf,
        profile_id: String,
    ) -> Result<ProxyProfileRuntimeStatus> {
        let config = load_proxy_config(&path)?;
        let profile = config
            .profiles
            .iter()
            .find(|item| item.id == profile_id)
            .cloned()
            .ok_or_else(|| anyhow!("proxy profile not found: {}", profile_id))?;
        let listener = TcpListener::bind(profile.listen_addr())
            .with_context(|| format!("failed to listen on {}", profile.listen_addr()))?;
        listener
            .set_nonblocking(true)
            .context("failed to configure proxy listener")?;

        self.stop_profile(&profile.id);

        let stop = Arc::new(AtomicBool::new(false));
        let started_at = Utc::now().to_rfc3339();
        let listen_url = profile.listen_url();
        {
            let mut inner = self.inner.lock().expect("proxy runtime poisoned");
            inner.servers.insert(
                profile.id.clone(),
                ProxyServerHandle {
                    stop: stop.clone(),
                    listen_url: listen_url.clone(),
                    started_at: started_at.clone(),
                },
            );
        }

        let runtime = self.clone();
        let thread_profile_id = profile.id.clone();
        thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let runtime = runtime.clone();
                        let path = path.clone();
                        let profile_id = thread_profile_id.clone();
                        thread::spawn(move || {
                            if let Err(error) =
                                handle_proxy_connection(stream, path, profile_id, runtime.clone())
                            {
                                eprintln!("proxy connection failed: {error:#}");
                            }
                        });
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(40));
                    }
                    Err(error) => {
                        eprintln!("proxy listener failed: {error:#}");
                        thread::sleep(Duration::from_millis(120));
                    }
                }
            }
        });

        Ok(ProxyProfileRuntimeStatus {
            profile_id: profile.id,
            running: true,
            listen_url,
            started_at: Some(started_at),
        })
    }

    pub fn stop_profile(&self, profile_id: &str) -> bool {
        let handle = {
            let mut inner = self.inner.lock().expect("proxy runtime poisoned");
            inner.servers.remove(profile_id)
        };
        if let Some(handle) = handle {
            handle.stop.store(true, Ordering::Relaxed);
            true
        } else {
            false
        }
    }

    pub fn statuses_for_profiles(
        &self,
        profiles: &[ProxyProfile],
    ) -> Vec<ProxyProfileRuntimeStatus> {
        let inner = self.inner.lock().expect("proxy runtime poisoned");
        profiles
            .iter()
            .map(|profile| {
                if let Some(handle) = inner.servers.get(&profile.id) {
                    ProxyProfileRuntimeStatus {
                        profile_id: profile.id.clone(),
                        running: true,
                        listen_url: handle.listen_url.clone(),
                        started_at: Some(handle.started_at.clone()),
                    }
                } else {
                    ProxyProfileRuntimeStatus {
                        profile_id: profile.id.clone(),
                        running: false,
                        listen_url: profile.listen_url(),
                        started_at: None,
                    }
                }
            })
            .collect()
    }

    pub fn events(&self, profile_id: Option<&str>) -> Vec<ProxyEvent> {
        let inner = self.inner.lock().expect("proxy runtime poisoned");
        inner
            .events
            .iter()
            .rev()
            .filter(|event| profile_id.is_none_or(|value| event.profile_id == value))
            .cloned()
            .collect()
    }

    pub fn clear_events(&self, profile_id: Option<&str>) {
        let mut inner = self.inner.lock().expect("proxy runtime poisoned");
        if let Some(profile_id) = profile_id {
            inner.events.retain(|event| event.profile_id != profile_id);
        } else {
            inner.events.clear();
        }
    }

    fn push_event(&self, event: ProxyEvent) {
        let mut inner = self.inner.lock().expect("proxy runtime poisoned");
        inner.events.push_back(event);
        while inner.events.len() > MAX_PROXY_EVENTS {
            inner.events.pop_front();
        }
    }
}

fn handle_proxy_connection(
    mut stream: TcpStream,
    config_path: PathBuf,
    profile_id: String,
    runtime: ProxyRuntimeState,
) -> Result<()> {
    stream.set_read_timeout(Some(PROXY_READ_TIMEOUT)).ok();
    stream.set_write_timeout(Some(PROXY_WRITE_TIMEOUT)).ok();

    let config = load_proxy_config(&config_path)?;
    let profile = config
        .profiles
        .iter()
        .find(|item| item.id == profile_id)
        .cloned()
        .ok_or_else(|| anyhow!("proxy profile not found: {}", profile_id))?;
    let profile_rules: Vec<ProxyRule> = config
        .rules
        .into_iter()
        .filter(|rule| rule.profile_id == profile.id && rule.enabled)
        .collect();

    let reader_stream = stream.try_clone().context("failed to clone proxy stream")?;
    let mut reader = BufReader::new(reader_stream);
    let mut first_line = String::new();
    if reader.read_line(&mut first_line)? == 0 {
        return Ok(());
    }
    let first_line = first_line.trim_end_matches(['\r', '\n']);
    let parts: Vec<&str> = first_line.split_whitespace().collect();
    if parts.len() < 3 {
        send_simple_response(
            &mut stream,
            400,
            "text/plain; charset=utf-8",
            b"Bad request",
            &BTreeMap::new(),
        )?;
        return Ok(());
    }

    let method = parts[0].to_ascii_uppercase();
    let target = parts[1].to_string();
    if method == "CONNECT" {
        return handle_connect_tunnel(stream, profile, target, runtime);
    }

    let headers = read_headers(&mut reader)?;
    let content_length = header_value(&headers, "content-length")
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or(0);
    let mut body = vec![0; content_length];
    if content_length > 0 {
        reader.read_exact(&mut body)?;
    }

    let started_at = Utc::now().to_rfc3339();
    let started = Instant::now();
    let target_url = match resolve_target_url(&target, &headers, &profile) {
        Ok(value) => value,
        Err(error) => {
            let response_body = format!("Proxy target error: {error}");
            send_simple_response(
                &mut stream,
                502,
                "text/plain; charset=utf-8",
                response_body.as_bytes(),
                &BTreeMap::new(),
            )?;
            runtime.push_event(build_event(ProxyEventInput {
                profile: &profile,
                started_at,
                duration_ms: started.elapsed().as_millis(),
                method,
                url: target,
                path: String::new(),
                status: Some(502),
                action: "error".to_string(),
                matched_rule: None,
                request_bytes: body.len(),
                response_bytes: response_body.len(),
                request_headers: headers_to_map(&headers),
                response_headers: BTreeMap::new(),
                request_body: &body,
                response_body: response_body.as_bytes(),
                error: Some(error.to_string()),
            }));
            return Ok(());
        }
    };
    let path = target_url.path().to_string()
        + target_url
            .query()
            .map(|query| format!("?{query}"))
            .as_deref()
            .unwrap_or("");
    let matched_rule = profile_rules
        .iter()
        .find(|rule| rule_matches(rule, &method, target_url.as_str(), &target_url, &headers));

    if let Some(rule) = matched_rule {
        if rule.action.delay_ms() > 0 {
            thread::sleep(Duration::from_millis(rule.action.delay_ms()));
        }
        match &rule.action {
            ProxyRuleAction::Mock {
                status,
                content_type,
                body: response_body,
                headers: response_headers,
                ..
            } => {
                let status = normalize_status(*status, 200);
                send_simple_response(
                    &mut stream,
                    status,
                    content_type,
                    response_body.as_bytes(),
                    response_headers,
                )?;
                runtime.push_event(build_event(ProxyEventInput {
                    profile: &profile,
                    started_at,
                    duration_ms: started.elapsed().as_millis(),
                    method,
                    url: target_url.to_string(),
                    path,
                    status: Some(status),
                    action: rule.action.label().to_string(),
                    matched_rule: Some(rule),
                    request_bytes: body.len(),
                    response_bytes: response_body.len(),
                    request_headers: headers_to_map(&headers),
                    response_headers: response_headers.clone(),
                    request_body: &body,
                    response_body: response_body.as_bytes(),
                    error: None,
                }));
                return Ok(());
            }
            ProxyRuleAction::Block {
                status,
                body: response_body,
                ..
            } => {
                let status = normalize_status(*status, 403);
                send_simple_response(
                    &mut stream,
                    status,
                    "text/plain; charset=utf-8",
                    response_body.as_bytes(),
                    &BTreeMap::new(),
                )?;
                runtime.push_event(build_event(ProxyEventInput {
                    profile: &profile,
                    started_at,
                    duration_ms: started.elapsed().as_millis(),
                    method,
                    url: target_url.to_string(),
                    path,
                    status: Some(status),
                    action: rule.action.label().to_string(),
                    matched_rule: Some(rule),
                    request_bytes: body.len(),
                    response_bytes: response_body.len(),
                    request_headers: headers_to_map(&headers),
                    response_headers: BTreeMap::new(),
                    request_body: &body,
                    response_body: response_body.as_bytes(),
                    error: None,
                }));
                return Ok(());
            }
            ProxyRuleAction::Forward { .. } => {}
        }
    }

    let forward_rule = matched_rule.cloned();
    match forward_http_request(
        &profile,
        forward_rule.as_ref(),
        &method,
        &target_url,
        &headers,
        body.clone(),
    ) {
        Ok(response) => {
            write_forward_response(&mut stream, &response)?;
            runtime.push_event(build_event(ProxyEventInput {
                profile: &profile,
                started_at,
                duration_ms: started.elapsed().as_millis(),
                method,
                url: response.url,
                path,
                status: Some(response.status),
                action: forward_rule
                    .as_ref()
                    .map(|rule| rule.action.label().to_string())
                    .unwrap_or_else(|| "forward".to_string()),
                matched_rule: forward_rule.as_ref(),
                request_bytes: body.len(),
                response_bytes: response.body.len(),
                request_headers: headers_to_map(&headers),
                response_headers: response.headers.clone(),
                request_body: &body,
                response_body: &response.body,
                error: None,
            }));
        }
        Err(error) => {
            let response_body = format!("Proxy request failed: {error}");
            send_simple_response(
                &mut stream,
                502,
                "text/plain; charset=utf-8",
                response_body.as_bytes(),
                &BTreeMap::new(),
            )?;
            runtime.push_event(build_event(ProxyEventInput {
                profile: &profile,
                started_at,
                duration_ms: started.elapsed().as_millis(),
                method,
                url: target_url.to_string(),
                path,
                status: Some(502),
                action: "error".to_string(),
                matched_rule: forward_rule.as_ref(),
                request_bytes: body.len(),
                response_bytes: response_body.len(),
                request_headers: headers_to_map(&headers),
                response_headers: BTreeMap::new(),
                request_body: &body,
                response_body: response_body.as_bytes(),
                error: Some(error.to_string()),
            }));
        }
    }

    let _ = stream.shutdown(Shutdown::Both);
    Ok(())
}

fn handle_connect_tunnel(
    mut stream: TcpStream,
    profile: ProxyProfile,
    target: String,
    runtime: ProxyRuntimeState,
) -> Result<()> {
    let started_at = Utc::now().to_rfc3339();
    let started = Instant::now();
    let request_bytes = Arc::new(AtomicU64::new(0));
    let response_bytes = Arc::new(AtomicU64::new(0));
    let mut request_headers = BTreeMap::new();
    request_headers.insert("target".to_string(), target.clone());

    match TcpStream::connect(&target) {
        Ok(mut upstream) => {
            stream.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")?;
            stream.flush()?;
            upstream.set_read_timeout(Some(PROXY_READ_TIMEOUT)).ok();
            upstream.set_write_timeout(Some(PROXY_WRITE_TIMEOUT)).ok();

            let mut downstream_reader = stream.try_clone()?;
            let mut upstream_writer = upstream.try_clone()?;
            let to_upstream_bytes = request_bytes.clone();
            let upstream_thread = thread::spawn(move || {
                copy_tunnel(
                    &mut downstream_reader,
                    &mut upstream_writer,
                    &to_upstream_bytes,
                );
            });
            copy_tunnel(&mut upstream, &mut stream, &response_bytes);
            let _ = upstream_thread.join();
            runtime.push_event(ProxyEvent {
                id: Uuid::new_v4().to_string(),
                profile_id: profile.id,
                profile_name: profile.name,
                started_at,
                duration_ms: started.elapsed().as_millis(),
                method: "CONNECT".to_string(),
                url: target.clone(),
                path: target,
                status: Some(200),
                action: "tunnel".to_string(),
                matched_rule_id: None,
                matched_rule_name: None,
                request_bytes: request_bytes.load(Ordering::Relaxed) as usize,
                response_bytes: response_bytes.load(Ordering::Relaxed) as usize,
                request_headers,
                response_headers: BTreeMap::new(),
                request_body_preview: String::new(),
                response_body_preview: String::new(),
                request_body_truncated: false,
                response_body_truncated: false,
                error: None,
            });
        }
        Err(error) => {
            let body = format!("CONNECT failed: {error}");
            send_simple_response(
                &mut stream,
                502,
                "text/plain; charset=utf-8",
                body.as_bytes(),
                &BTreeMap::new(),
            )?;
            runtime.push_event(ProxyEvent {
                id: Uuid::new_v4().to_string(),
                profile_id: profile.id,
                profile_name: profile.name,
                started_at,
                duration_ms: started.elapsed().as_millis(),
                method: "CONNECT".to_string(),
                url: target.clone(),
                path: target,
                status: Some(502),
                action: "tunnel".to_string(),
                matched_rule_id: None,
                matched_rule_name: None,
                request_bytes: 0,
                response_bytes: body.len(),
                request_headers,
                response_headers: BTreeMap::new(),
                request_body_preview: String::new(),
                response_body_preview: body,
                request_body_truncated: false,
                response_body_truncated: false,
                error: Some(error.to_string()),
            });
        }
    }

    Ok(())
}

fn copy_tunnel(reader: &mut TcpStream, writer: &mut TcpStream, counter: &AtomicU64) {
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => {
                if writer.write_all(&buffer[..n]).is_err() {
                    break;
                }
                counter.fetch_add(n as u64, Ordering::Relaxed);
            }
            Err(_) => break,
        }
    }
    let _ = writer.shutdown(Shutdown::Write);
}

fn read_headers(reader: &mut BufReader<TcpStream>) -> Result<Vec<(String, String)>> {
    let mut headers = Vec::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            break;
        }
        let line = line.trim_end_matches(['\r', '\n']);
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            headers.push((name.trim().to_string(), value.trim().to_string()));
        }
    }
    Ok(headers)
}

fn header_value(headers: &[(String, String)], name: &str) -> Option<String> {
    headers
        .iter()
        .find(|(header_name, _)| header_name.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.clone())
}

fn headers_to_map(headers: &[(String, String)]) -> BTreeMap<String, String> {
    headers
        .iter()
        .map(|(name, value)| (name.clone(), value.clone()))
        .collect()
}

fn resolve_target_url(
    target: &str,
    headers: &[(String, String)],
    profile: &ProxyProfile,
) -> Result<Url> {
    if target.starts_with("http://") || target.starts_with("https://") {
        return Url::parse(target).with_context(|| format!("invalid target url: {target}"));
    }

    if !profile.upstream_base_url.is_empty() {
        let base = Url::parse(&profile.upstream_base_url)
            .with_context(|| format!("invalid upstream base url: {}", profile.upstream_base_url))?;
        return join_base_url(base, target);
    }

    let host = header_value(headers, "host").ok_or_else(|| {
        anyhow!("relative request target requires Host header or profile upstream base URL")
    })?;
    let target = if target.starts_with('/') {
        format!("http://{host}{target}")
    } else {
        format!("http://{host}/{target}")
    };
    Url::parse(&target).with_context(|| format!("invalid request target: {target}"))
}

fn join_base_url(mut base: Url, target: &str) -> Result<Url> {
    if target.starts_with('/') {
        base.set_path(target);
        base.set_query(None);
        Ok(base)
    } else {
        base.join(target)
            .with_context(|| format!("failed to join upstream URL with {target}"))
    }
}

fn rule_matches(
    rule: &ProxyRule,
    method: &str,
    full_url: &str,
    url: &Url,
    headers: &[(String, String)],
) -> bool {
    if !rule.method.is_empty() && rule.method != method {
        return false;
    }
    if !rule.url_contains.is_empty() && !full_url.contains(&rule.url_contains) {
        return false;
    }
    if !rule.path_prefix.is_empty() && !url.path().starts_with(&rule.path_prefix) {
        return false;
    }
    if !rule.header_name.is_empty() {
        let Some(value) = header_value(headers, &rule.header_name) else {
            return false;
        };
        if !rule.header_contains.is_empty() && !value.contains(&rule.header_contains) {
            return false;
        }
    }
    true
}

struct ForwardResponse {
    url: String,
    status: u16,
    headers: BTreeMap<String, String>,
    body: Vec<u8>,
}

fn forward_http_request(
    profile: &ProxyProfile,
    rule: Option<&ProxyRule>,
    method: &str,
    target_url: &Url,
    headers: &[(String, String)],
    body: Vec<u8>,
) -> Result<ForwardResponse> {
    let destination = rewrite_destination_url(target_url, rule)?;
    let mut builder = Client::builder()
        .timeout(Duration::from_secs(90))
        .redirect(reqwest::redirect::Policy::none());
    if !profile.upstream_proxy.is_empty() {
        builder = builder.proxy(
            reqwest::Proxy::all(&profile.upstream_proxy)
                .with_context(|| format!("invalid upstream proxy: {}", profile.upstream_proxy))?,
        );
    }
    let client = builder
        .build()
        .context("failed to build proxy HTTP client")?;
    let req_method = Method::from_bytes(method.as_bytes()).unwrap_or(Method::GET);
    let mut request = client.request(req_method, destination.clone());

    for (name, value) in headers {
        if should_forward_header(name) {
            request = request.header(name, value);
        }
    }

    if let Some(ProxyRule {
        action: ProxyRuleAction::Forward {
            request_headers, ..
        },
        ..
    }) = rule
    {
        for (name, value) in request_headers {
            if !name.trim().is_empty() {
                request = request.header(name, value);
            }
        }
    }

    if !body.is_empty() {
        request = request.body(body);
    }

    let response = request.send().context("upstream request failed")?;
    let status = response.status().as_u16();
    let mut response_headers = BTreeMap::new();
    for (name, value) in response.headers() {
        if should_forward_response_header(name.as_str()) {
            response_headers.insert(
                name.to_string(),
                value.to_str().unwrap_or_default().to_string(),
            );
        }
    }
    if let Some(ProxyRule {
        action:
            ProxyRuleAction::Forward {
                response_headers: extra_headers,
                ..
            },
        ..
    }) = rule
    {
        for (name, value) in extra_headers {
            if !name.trim().is_empty() {
                response_headers.insert(name.clone(), value.clone());
            }
        }
    }
    let body = response
        .bytes()
        .context("failed to read upstream response")?
        .to_vec();
    Ok(ForwardResponse {
        url: destination.to_string(),
        status,
        headers: response_headers,
        body,
    })
}

fn rewrite_destination_url(target_url: &Url, rule: Option<&ProxyRule>) -> Result<Url> {
    let Some(rule) = rule else {
        return Ok(target_url.clone());
    };
    let ProxyRuleAction::Forward {
        target_base_url,
        rewrite_prefix,
        ..
    } = &rule.action
    else {
        return Ok(target_url.clone());
    };

    let mut next_path = target_url.path().to_string();
    if !rule.path_prefix.is_empty()
        && !rewrite_prefix.is_empty()
        && next_path.starts_with(&rule.path_prefix)
    {
        let suffix = next_path.trim_start_matches(&rule.path_prefix);
        next_path = format!(
            "{}{}",
            rewrite_prefix.trim_end_matches('/'),
            if suffix.starts_with('/') {
                suffix.to_string()
            } else if suffix.is_empty() {
                String::new()
            } else {
                format!("/{suffix}")
            }
        );
        if next_path.is_empty() {
            next_path = "/".to_string();
        }
    }

    let mut destination = if target_base_url.trim().is_empty() {
        target_url.clone()
    } else {
        let mut base = Url::parse(target_base_url.trim())
            .with_context(|| format!("invalid rewrite target base URL: {target_base_url}"))?;
        let base_path = base.path().trim_end_matches('/');
        let relative_path = next_path.trim_start_matches('/');
        let combined_path = if base_path.is_empty() || base_path == "/" {
            format!("/{relative_path}")
        } else if relative_path.is_empty() {
            base_path.to_string()
        } else {
            format!("{base_path}/{relative_path}")
        };
        base.set_path(&combined_path);
        base
    };
    destination.set_query(target_url.query());
    Ok(destination)
}

fn should_forward_header(name: &str) -> bool {
    !matches!(
        name.to_ascii_lowercase().as_str(),
        "host"
            | "connection"
            | "proxy-connection"
            | "keep-alive"
            | "transfer-encoding"
            | "upgrade"
            | "content-length"
    )
}

fn should_forward_response_header(name: &str) -> bool {
    !matches!(
        name.to_ascii_lowercase().as_str(),
        "connection" | "keep-alive" | "transfer-encoding" | "upgrade" | "content-length"
    )
}

fn write_forward_response(stream: &mut TcpStream, response: &ForwardResponse) -> Result<()> {
    send_simple_response(
        stream,
        response.status,
        response
            .headers
            .get("content-type")
            .or_else(|| response.headers.get("Content-Type"))
            .map(String::as_str)
            .unwrap_or("application/octet-stream"),
        &response.body,
        &response.headers,
    )
}

fn send_simple_response(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &[u8],
    headers: &BTreeMap<String, String>,
) -> Result<()> {
    let status = normalize_status(status, 200);
    let reason = StatusCode::from_u16(status)
        .ok()
        .and_then(|value| value.canonical_reason())
        .unwrap_or("OK");
    write!(stream, "HTTP/1.1 {status} {reason}\r\n")?;
    write!(stream, "Content-Length: {}\r\n", body.len())?;
    if !content_type.is_empty() {
        write!(stream, "Content-Type: {content_type}\r\n")?;
    }
    for (name, value) in headers {
        if should_forward_response_header(name) && !name.eq_ignore_ascii_case("content-type") {
            write!(stream, "{name}: {value}\r\n")?;
        }
    }
    write!(stream, "Connection: close\r\n\r\n")?;
    stream.write_all(body)?;
    stream.flush()?;
    Ok(())
}

fn normalize_status(value: u16, fallback: u16) -> u16 {
    if StatusCode::from_u16(value).is_ok() {
        value
    } else {
        fallback
    }
}

struct ProxyEventInput<'a> {
    profile: &'a ProxyProfile,
    started_at: String,
    duration_ms: u128,
    method: String,
    url: String,
    path: String,
    status: Option<u16>,
    action: String,
    matched_rule: Option<&'a ProxyRule>,
    request_bytes: usize,
    response_bytes: usize,
    request_headers: BTreeMap<String, String>,
    response_headers: BTreeMap<String, String>,
    request_body: &'a [u8],
    response_body: &'a [u8],
    error: Option<String>,
}

fn build_event(input: ProxyEventInput<'_>) -> ProxyEvent {
    let (request_body_preview, request_body_truncated) =
        body_preview(input.profile, input.request_body);
    let (response_body_preview, response_body_truncated) =
        body_preview(input.profile, input.response_body);
    ProxyEvent {
        id: Uuid::new_v4().to_string(),
        profile_id: input.profile.id.clone(),
        profile_name: input.profile.name.clone(),
        started_at: input.started_at,
        duration_ms: input.duration_ms,
        method: input.method,
        url: input.url,
        path: input.path,
        status: input.status,
        action: input.action,
        matched_rule_id: input.matched_rule.map(|rule| rule.id.clone()),
        matched_rule_name: input.matched_rule.map(|rule| rule.name.clone()),
        request_bytes: input.request_bytes,
        response_bytes: input.response_bytes,
        request_headers: input.request_headers,
        response_headers: input.response_headers,
        request_body_preview,
        response_body_preview,
        request_body_truncated,
        response_body_truncated,
        error: input.error,
    }
}

fn body_preview(profile: &ProxyProfile, bytes: &[u8]) -> (String, bool) {
    if !profile.capture_body || bytes.is_empty() {
        return (String::new(), false);
    }
    let max_bytes = profile.max_body_bytes.min(bytes.len());
    let preview = String::from_utf8_lossy(&bytes[..max_bytes]).to_string();
    (preview, bytes.len() > max_bytes)
}

pub fn validate_proxy_profile(profile: &ProxyProfile) -> Result<()> {
    if profile.listen_host.trim().is_empty() {
        bail!("监听地址不能为空");
    }
    if profile.listen_port == 0 {
        bail!("监听端口必须大于 0");
    }
    if !profile.upstream_base_url.trim().is_empty() {
        Url::parse(profile.upstream_base_url.trim())
            .with_context(|| format!("上游地址无效：{}", profile.upstream_base_url))?;
    }
    if !profile.upstream_proxy.trim().is_empty() {
        reqwest::Proxy::all(profile.upstream_proxy.trim())
            .with_context(|| format!("上游代理无效：{}", profile.upstream_proxy))?;
    }
    Ok(())
}

pub fn validate_proxy_rule(rule: &ProxyRule) -> Result<()> {
    if rule.name.trim().is_empty() {
        bail!("规则名称不能为空");
    }
    if rule.method.trim().is_empty()
        && rule.url_contains.trim().is_empty()
        && rule.path_prefix.trim().is_empty()
        && rule.header_name.trim().is_empty()
    {
        bail!("规则至少需要一个匹配条件");
    }
    match &rule.action {
        ProxyRuleAction::Forward {
            target_base_url, ..
        } => {
            if !target_base_url.trim().is_empty() {
                Url::parse(target_base_url.trim())
                    .with_context(|| format!("重写目标无效：{target_base_url}"))?;
            }
        }
        ProxyRuleAction::Mock { status, .. } | ProxyRuleAction::Block { status, .. } => {
            if StatusCode::from_u16(*status).is_err() {
                bail!("状态码无效：{}", status);
            }
        }
    }
    Ok(())
}
