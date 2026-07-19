use anyhow::{Context, Result, anyhow, bail};
use chrono::Utc;
use reqwest::blocking::Client;
use reqwest::{Method, StatusCode, Url};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, Shutdown, TcpListener, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use std::thread;
use std::time::{Duration, Instant};
use uuid::Uuid;

use crate::config::default_config_dir;
use crate::config_store::write_config_text_atomic;

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
    #[serde(default)]
    pub workspace_key: Option<String>,
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
            workspace_key: None,
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

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProxyOutboundMode {
    Inherit,
    Direct,
    Proxy,
}

fn default_outbound_mode() -> ProxyOutboundMode {
    ProxyOutboundMode::Inherit
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ProxyRuleAction {
    Forward {
        #[serde(default, rename = "targetBaseUrl", alias = "target_base_url")]
        target_base_url: String,
        #[serde(default, rename = "rewritePrefix", alias = "rewrite_prefix")]
        rewrite_prefix: String,
        #[serde(default, rename = "requestHeaders", alias = "request_headers")]
        request_headers: BTreeMap<String, String>,
        #[serde(default, rename = "responseHeaders", alias = "response_headers")]
        response_headers: BTreeMap<String, String>,
        #[serde(
            default = "default_outbound_mode",
            rename = "outboundMode",
            alias = "outbound_mode"
        )]
        outbound_mode: ProxyOutboundMode,
        #[serde(default, rename = "outboundProxy", alias = "outbound_proxy")]
        outbound_proxy: String,
        #[serde(default, rename = "delayMs", alias = "delay_ms")]
        delay_ms: u64,
    },
    Mock {
        #[serde(default = "default_mock_status")]
        status: u16,
        #[serde(
            default = "default_content_type",
            rename = "contentType",
            alias = "content_type"
        )]
        content_type: String,
        #[serde(default)]
        body: String,
        #[serde(default)]
        headers: BTreeMap<String, String>,
        #[serde(default, rename = "delayMs", alias = "delay_ms")]
        delay_ms: u64,
    },
    Block {
        #[serde(default = "default_block_status")]
        status: u16,
        #[serde(default)]
        body: String,
        #[serde(default, rename = "delayMs", alias = "delay_ms")]
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
            outbound_mode: default_outbound_mode(),
            outbound_proxy: String::new(),
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

#[derive(Debug, Clone, Deserialize, Serialize)]
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyRequestDiagnosis {
    pub profile: ProxyRequestDiagnosisProfile,
    pub request: ProxyRequestDiagnosisRequest,
    pub status_key: String,
    pub status_label: String,
    pub summary: String,
    pub matched_rule: Option<ProxyRuleDiagnosisSummary>,
    pub decisions: Vec<ProxyRuleDiagnosisDecision>,
    pub warnings: Vec<ProxyRequestDiagnosisWarning>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyRequestDiagnosisProfile {
    pub id: String,
    pub name: String,
    pub listen_url: String,
    pub listening: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyRequestDiagnosisRequest {
    pub method: String,
    pub url: String,
    pub path: String,
    pub header_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyRuleDiagnosisSummary {
    pub id: String,
    pub name: String,
    pub priority: i32,
    pub action: String,
    pub path_prefix: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyRuleDiagnosisDecision {
    pub rule_id: String,
    pub rule_name: String,
    pub enabled: bool,
    pub priority: i32,
    pub action: String,
    pub matched: bool,
    pub reasons: Vec<ProxyRuleDiagnosisReason>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyRuleDiagnosisReason {
    pub key: String,
    pub matched: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyRequestDiagnosisWarning {
    pub key: String,
    pub detail: String,
    pub action: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyProfilePack {
    pub schema_version: u16,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub exported_at: String,
    pub profiles: Vec<ProxyProfile>,
    pub rules: Vec<ProxyRule>,
}

#[derive(Clone, Default)]
pub struct ProxyRuntimeState {
    inner: Arc<Mutex<ProxyRuntimeInner>>,
}

#[derive(Default)]
struct ProxyRuntimeInner {
    servers: HashMap<ProxyRuntimeKey, ProxyServerHandle>,
    events: VecDeque<ScopedProxyEvent>,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct ProxyRuntimeKey {
    config_path: PathBuf,
    profile_id: String,
}

struct ScopedProxyEvent {
    config_path: PathBuf,
    event: ProxyEvent,
}

struct ProxyServerHandle {
    stop: Arc<AtomicBool>,
    listen_url: String,
    started_at: String,
}

fn proxy_runtime_key(path: &Path, profile_id: &str) -> ProxyRuntimeKey {
    ProxyRuntimeKey {
        config_path: proxy_runtime_config_path(path),
        profile_id: profile_id.to_string(),
    }
}

fn proxy_runtime_config_path(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
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
    write_config_text_atomic(path, content)
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

pub fn export_proxy_profile_pack(path: &Path, profile_id: &str) -> Result<ProxyProfilePack> {
    let config = load_proxy_config(path)?;
    let profile = config
        .profiles
        .iter()
        .find(|item| item.id == profile_id)
        .cloned()
        .ok_or_else(|| anyhow!("proxy profile not found: {}", profile_id))?;
    let rules = config
        .rules
        .into_iter()
        .filter(|rule| rule.profile_id == profile.id)
        .collect::<Vec<_>>();
    Ok(ProxyProfilePack {
        schema_version: 1,
        name: profile.name.clone(),
        description: format!("rDevTool proxy profile: {}", profile.name),
        exported_at: Utc::now().to_rfc3339(),
        profiles: vec![profile],
        rules,
    })
}

pub fn import_proxy_profile_pack(path: &Path, pack: ProxyProfilePack) -> Result<ProxyConfig> {
    if pack.schema_version != 1 {
        bail!(
            "unsupported proxy pack schema version: {}",
            pack.schema_version
        );
    }
    if pack.profiles.is_empty() {
        bail!("proxy pack does not contain a profile");
    }

    let mut config = load_proxy_config(path)?;
    let occupied_ports = config
        .profiles
        .iter()
        .map(|profile| profile.listen_port)
        .collect::<Vec<_>>();
    let first_profile = pack.profiles[0].clone();
    let old_profile_id = first_profile.id.clone();
    let new_profile_id = Uuid::new_v4().to_string();

    let mut profile = first_profile;
    profile.id = new_profile_id.clone();
    profile.name = imported_profile_name(&config, &profile.name);
    profile.listen_port = next_available_proxy_port(profile.listen_port, &occupied_ports);
    normalize_profile(&mut profile);
    config.profiles.push(profile);

    for mut rule in pack
        .rules
        .into_iter()
        .filter(|rule| rule.profile_id == old_profile_id)
    {
        rule.id = Uuid::new_v4().to_string();
        rule.profile_id = new_profile_id.clone();
        normalize_rule(&mut rule);
        config.rules.push(rule);
    }

    save_proxy_config(path, &config)?;
    load_proxy_config(path)
}

pub fn diagnose_proxy_request(
    config: &ProxyConfig,
    profile: &str,
    method: &str,
    raw_url: &str,
    headers: &BTreeMap<String, String>,
) -> Result<ProxyRequestDiagnosis> {
    let mut config = config.clone();
    normalize_proxy_config(&mut config);
    let profile = config
        .profiles
        .iter()
        .find(|item| item.id == profile || item.name == profile)
        .cloned()
        .ok_or_else(|| anyhow!("proxy profile not found: {}", profile))?;
    let method = method.trim().to_ascii_uppercase();
    if method.is_empty() {
        bail!("request method is required");
    }
    let target_url = diagnosis_target_url(&profile, raw_url)?;
    let request_headers = headers
        .iter()
        .map(|(name, value)| (name.clone(), value.clone()))
        .collect::<Vec<_>>();
    let profile_rules = config
        .rules
        .iter()
        .filter(|rule| rule.profile_id == profile.id)
        .cloned()
        .collect::<Vec<_>>();
    let decisions = profile_rules
        .iter()
        .map(|rule| diagnose_rule_match(rule, &method, &target_url, &request_headers))
        .collect::<Vec<_>>();
    let matched_index = decisions
        .iter()
        .position(|decision| decision.enabled && decision.matched);
    let matched_rule = matched_index.and_then(|index| profile_rules.get(index));
    let listening = proxy_profile_port_listening(&profile);
    let warnings = proxy_diagnosis_warnings(
        &profile,
        listening,
        matched_index,
        &profile_rules,
        &decisions,
    );
    let status_key = if matched_rule.is_some() && listening {
        "matched"
    } else if matched_rule.is_some() {
        "matchedNotListening"
    } else {
        "notMatched"
    };
    let status_label = match status_key {
        "matched" => "已命中",
        "matchedNotListening" => "规则命中但端口未监听",
        _ => "未命中",
    }
    .to_string();
    let summary = match matched_rule {
        Some(rule) if listening => format!("请求会命中规则 {}", rule.name),
        Some(rule) => format!("请求会命中规则 {}，但代理端口当前未监听", rule.name),
        None => "没有启用规则会处理这个请求".to_string(),
    };
    let path = target_url.path().to_string()
        + target_url
            .query()
            .map(|query| format!("?{query}"))
            .as_deref()
            .unwrap_or("");

    Ok(ProxyRequestDiagnosis {
        profile: ProxyRequestDiagnosisProfile {
            id: profile.id.clone(),
            name: profile.name.clone(),
            listen_url: profile.listen_url(),
            listening,
        },
        request: ProxyRequestDiagnosisRequest {
            method,
            url: target_url.to_string(),
            path,
            header_count: headers.len(),
        },
        status_key: status_key.to_string(),
        status_label,
        summary,
        matched_rule: matched_rule.map(proxy_rule_diagnosis_summary),
        decisions,
        warnings,
    })
}

fn imported_profile_name(config: &ProxyConfig, base_name: &str) -> String {
    let base = {
        let trimmed = base_name.trim();
        if trimmed.is_empty() {
            "导入代理"
        } else {
            trimmed
        }
    };
    let mut candidate = base.to_string();
    let mut index = 2;
    while config
        .profiles
        .iter()
        .any(|profile| profile.name == candidate)
    {
        candidate = format!("{base} ({index})");
        index += 1;
    }
    candidate
}

fn next_available_proxy_port(preferred_port: u16, occupied_ports: &[u16]) -> u16 {
    let start = if preferred_port == 0 {
        DEFAULT_PROXY_PORT
    } else {
        preferred_port
    };
    for port in start..=u16::MAX {
        if !occupied_ports.contains(&port) {
            return port;
        }
    }
    DEFAULT_PROXY_PORT
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
    profile.workspace_key = profile
        .workspace_key
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
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
    if let ProxyRuleAction::Forward {
        target_base_url,
        rewrite_prefix,
        outbound_proxy,
        ..
    } = &mut rule.action
    {
        *target_base_url = target_base_url.trim().to_string();
        *rewrite_prefix = rewrite_prefix.trim().to_string();
        *outbound_proxy = outbound_proxy.trim().to_string();
    }
}

impl ProxyRuntimeState {
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

        self.stop_profile(&path, &profile.id);

        let stop = Arc::new(AtomicBool::new(false));
        let started_at = Utc::now().to_rfc3339();
        let listen_url = profile.listen_url();
        let runtime_key = proxy_runtime_key(&path, &profile.id);
        {
            let mut inner = self.inner.lock().expect("proxy runtime poisoned");
            inner.servers.insert(
                runtime_key,
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

    pub fn ensure_profile_running(
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
        {
            let inner = self.inner.lock().expect("proxy runtime poisoned");
            if let Some(handle) = inner.servers.get(&proxy_runtime_key(&path, &profile.id)) {
                return Ok(ProxyProfileRuntimeStatus {
                    profile_id: profile.id,
                    running: true,
                    listen_url: handle.listen_url.clone(),
                    started_at: Some(handle.started_at.clone()),
                });
            }
        }
        self.start_profile(path, profile.id)
    }

    pub fn stop_profile(&self, path: &Path, profile_id: &str) -> bool {
        let handle = {
            let mut inner = self.inner.lock().expect("proxy runtime poisoned");
            inner.servers.remove(&proxy_runtime_key(path, profile_id))
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
        path: &Path,
        profiles: &[ProxyProfile],
    ) -> Vec<ProxyProfileRuntimeStatus> {
        let inner = self.inner.lock().expect("proxy runtime poisoned");
        profiles
            .iter()
            .map(|profile| {
                if let Some(handle) = inner.servers.get(&proxy_runtime_key(path, &profile.id)) {
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

    pub fn events(&self, path: &Path, profile_id: Option<&str>) -> Vec<ProxyEvent> {
        let config_path = proxy_runtime_config_path(path);
        let inner = self.inner.lock().expect("proxy runtime poisoned");
        inner
            .events
            .iter()
            .rev()
            .filter(|item| {
                item.config_path == config_path
                    && profile_id.is_none_or(|value| item.event.profile_id == value)
            })
            .map(|item| item.event.clone())
            .collect()
    }

    pub fn clear_events(&self, path: &Path, profile_id: Option<&str>) {
        let config_path = proxy_runtime_config_path(path);
        let mut inner = self.inner.lock().expect("proxy runtime poisoned");
        if let Some(profile_id) = profile_id {
            inner.events.retain(|item| {
                item.config_path != config_path || item.event.profile_id != profile_id
            });
        } else {
            inner.events.retain(|item| item.config_path != config_path);
        }
        let _ = crate::proxy_daemon::clear_persisted_proxy_events(path, profile_id);
    }

    fn push_event(&self, path: &Path, event: ProxyEvent) {
        let _ = crate::proxy_daemon::append_persisted_proxy_event(path, &event);
        let mut inner = self.inner.lock().expect("proxy runtime poisoned");
        inner.events.push_back(ScopedProxyEvent {
            config_path: proxy_runtime_config_path(path),
            event,
        });
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
    let headers = read_headers(&mut reader)?;
    if method == "CONNECT" {
        return handle_connect_tunnel(
            stream,
            profile,
            profile_rules,
            target,
            headers,
            config_path,
            runtime,
        );
    }

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
            runtime.push_event(
                &config_path,
                build_event(ProxyEventInput {
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
                }),
            );
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
                runtime.push_event(
                    &config_path,
                    build_event(ProxyEventInput {
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
                    }),
                );
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
                runtime.push_event(
                    &config_path,
                    build_event(ProxyEventInput {
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
                    }),
                );
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
            runtime.push_event(
                &config_path,
                build_event(ProxyEventInput {
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
                }),
            );
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
            runtime.push_event(
                &config_path,
                build_event(ProxyEventInput {
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
                }),
            );
        }
    }

    let _ = stream.shutdown(Shutdown::Both);
    Ok(())
}

fn handle_connect_tunnel(
    mut stream: TcpStream,
    profile: ProxyProfile,
    profile_rules: Vec<ProxyRule>,
    target: String,
    headers: Vec<(String, String)>,
    config_path: PathBuf,
    runtime: ProxyRuntimeState,
) -> Result<()> {
    let started_at = Utc::now().to_rfc3339();
    let started = Instant::now();
    let request_bytes = Arc::new(AtomicU64::new(0));
    let response_bytes = Arc::new(AtomicU64::new(0));
    let mut request_headers = headers_to_map(&headers);
    request_headers.insert(":authority".to_string(), target.clone());
    let target_url = Url::parse(&format!("https://{target}/")).ok();
    let matched_rule = target_url.as_ref().and_then(|url| {
        profile_rules
            .iter()
            .find(|rule| rule_matches(rule, "CONNECT", url.as_str(), url, &headers))
    });

    if let Some(rule) = matched_rule {
        if rule.action.delay_ms() > 0 {
            thread::sleep(Duration::from_millis(rule.action.delay_ms()));
        }
        match &rule.action {
            ProxyRuleAction::Mock {
                status,
                content_type,
                body,
                headers: response_headers,
                ..
            } => {
                let status = normalize_status(*status, 200);
                send_simple_response(
                    &mut stream,
                    status,
                    content_type,
                    body.as_bytes(),
                    response_headers,
                )?;
                runtime.push_event(
                    &config_path,
                    ProxyEvent {
                        id: Uuid::new_v4().to_string(),
                        profile_id: profile.id,
                        profile_name: profile.name,
                        started_at,
                        duration_ms: started.elapsed().as_millis(),
                        method: "CONNECT".to_string(),
                        url: target.clone(),
                        path: target,
                        status: Some(status),
                        action: rule.action.label().to_string(),
                        matched_rule_id: Some(rule.id.clone()),
                        matched_rule_name: Some(rule.name.clone()),
                        request_bytes: 0,
                        response_bytes: body.len(),
                        request_headers,
                        response_headers: response_headers.clone(),
                        request_body_preview: String::new(),
                        response_body_preview: body.clone(),
                        request_body_truncated: false,
                        response_body_truncated: false,
                        error: None,
                    },
                );
                return Ok(());
            }
            ProxyRuleAction::Block { status, body, .. } => {
                let status = normalize_status(*status, 403);
                send_simple_response(
                    &mut stream,
                    status,
                    "text/plain; charset=utf-8",
                    body.as_bytes(),
                    &BTreeMap::new(),
                )?;
                runtime.push_event(
                    &config_path,
                    ProxyEvent {
                        id: Uuid::new_v4().to_string(),
                        profile_id: profile.id,
                        profile_name: profile.name,
                        started_at,
                        duration_ms: started.elapsed().as_millis(),
                        method: "CONNECT".to_string(),
                        url: target.clone(),
                        path: target,
                        status: Some(status),
                        action: rule.action.label().to_string(),
                        matched_rule_id: Some(rule.id.clone()),
                        matched_rule_name: Some(rule.name.clone()),
                        request_bytes: 0,
                        response_bytes: body.len(),
                        request_headers,
                        response_headers: BTreeMap::new(),
                        request_body_preview: String::new(),
                        response_body_preview: body.clone(),
                        request_body_truncated: false,
                        response_body_truncated: false,
                        error: None,
                    },
                );
                return Ok(());
            }
            ProxyRuleAction::Forward { .. } => {}
        }
    }

    let outbound_proxy = outbound_proxy_for_request(&profile, matched_rule);
    match connect_tunnel_stream(&target, outbound_proxy.as_deref()) {
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
            runtime.push_event(
                &config_path,
                ProxyEvent {
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
                    matched_rule_id: matched_rule.map(|rule| rule.id.clone()),
                    matched_rule_name: matched_rule.map(|rule| rule.name.clone()),
                    request_bytes: request_bytes.load(Ordering::Relaxed) as usize,
                    response_bytes: response_bytes.load(Ordering::Relaxed) as usize,
                    request_headers,
                    response_headers: BTreeMap::new(),
                    request_body_preview: String::new(),
                    response_body_preview: String::new(),
                    request_body_truncated: false,
                    response_body_truncated: false,
                    error: None,
                },
            );
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
            runtime.push_event(
                &config_path,
                ProxyEvent {
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
                    matched_rule_id: matched_rule.map(|rule| rule.id.clone()),
                    matched_rule_name: matched_rule.map(|rule| rule.name.clone()),
                    request_bytes: 0,
                    response_bytes: body.len(),
                    request_headers,
                    response_headers: BTreeMap::new(),
                    request_body_preview: String::new(),
                    response_body_preview: body,
                    request_body_truncated: false,
                    response_body_truncated: false,
                    error: Some(error.to_string()),
                },
            );
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

fn connect_tunnel_stream(target: &str, outbound_proxy: Option<&str>) -> Result<TcpStream> {
    let Some(outbound_proxy) = outbound_proxy
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return TcpStream::connect(target).with_context(|| format!("connect failed: {target}"));
    };

    let proxy_url = Url::parse(outbound_proxy)
        .with_context(|| format!("invalid tunnel upstream proxy: {outbound_proxy}"))?;
    match proxy_url.scheme() {
        "http" => connect_http_proxy_tunnel(&proxy_url, target),
        "socks5" | "socks5h" => connect_socks5_tunnel(&proxy_url, target),
        "https" => bail!("CONNECT through https upstream proxy is not supported yet"),
        scheme => bail!("unsupported tunnel upstream proxy scheme: {scheme}"),
    }
}

fn proxy_host_port(proxy_url: &Url, default_port: u16) -> Result<String> {
    let host = proxy_url
        .host_str()
        .ok_or_else(|| anyhow!("upstream proxy host is empty"))?;
    let port = proxy_url.port().unwrap_or(default_port);
    Ok(format!("{host}:{port}"))
}

fn connect_http_proxy_tunnel(proxy_url: &Url, target: &str) -> Result<TcpStream> {
    let proxy_addr = proxy_host_port(proxy_url, 80)?;
    let mut stream = TcpStream::connect(&proxy_addr)
        .with_context(|| format!("connect upstream proxy failed: {proxy_addr}"))?;
    stream.set_read_timeout(Some(PROXY_READ_TIMEOUT)).ok();
    stream.set_write_timeout(Some(PROXY_WRITE_TIMEOUT)).ok();

    write!(
        stream,
        "CONNECT {target} HTTP/1.1\r\nHost: {target}\r\nProxy-Connection: Keep-Alive\r\n"
    )?;
    if !proxy_url.username().is_empty() {
        let credentials = format!(
            "{}:{}",
            proxy_url.username(),
            proxy_url.password().unwrap_or_default()
        );
        write!(
            stream,
            "Proxy-Authorization: Basic {}\r\n",
            base64_encode(credentials.as_bytes())
        )?;
    }
    write!(stream, "\r\n")?;
    stream.flush()?;
    read_http_connect_response(&mut stream)?;
    Ok(stream)
}

fn read_http_connect_response(stream: &mut TcpStream) -> Result<()> {
    let mut response = Vec::new();
    let mut byte = [0_u8; 1];
    while response.len() < 16 * 1024 {
        stream.read_exact(&mut byte)?;
        response.push(byte[0]);
        if response.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    let response_text = String::from_utf8_lossy(&response);
    let status_line = response_text.lines().next().unwrap_or_default();
    if status_line.split_whitespace().nth(1) == Some("200") {
        return Ok(());
    }
    bail!("upstream proxy CONNECT failed: {status_line}");
}

fn target_host_port(target: &str) -> Result<(String, u16)> {
    let url = Url::parse(&format!("https://{target}"))
        .with_context(|| format!("invalid CONNECT target: {target}"))?;
    let host = url
        .host_str()
        .ok_or_else(|| anyhow!("CONNECT target host is empty: {target}"))?
        .to_string();
    let port = url.port_or_known_default().unwrap_or(443);
    Ok((host, port))
}

fn connect_socks5_tunnel(proxy_url: &Url, target: &str) -> Result<TcpStream> {
    let proxy_addr = proxy_host_port(proxy_url, 1080)?;
    let mut stream = TcpStream::connect(&proxy_addr)
        .with_context(|| format!("connect SOCKS5 proxy failed: {proxy_addr}"))?;
    stream.set_read_timeout(Some(PROXY_READ_TIMEOUT)).ok();
    stream.set_write_timeout(Some(PROXY_WRITE_TIMEOUT)).ok();

    let username = proxy_url.username();
    let password = proxy_url.password().unwrap_or_default();
    if username.is_empty() {
        stream.write_all(&[0x05, 0x01, 0x00])?;
    } else {
        stream.write_all(&[0x05, 0x02, 0x00, 0x02])?;
    }
    let mut method_response = [0_u8; 2];
    stream.read_exact(&mut method_response)?;
    if method_response[0] != 0x05 {
        bail!("invalid SOCKS5 handshake response");
    }
    match method_response[1] {
        0x00 => {}
        0x02 => {
            if username.len() > 255 || password.len() > 255 {
                bail!("SOCKS5 username/password is too long");
            }
            let mut auth = Vec::with_capacity(3 + username.len() + password.len());
            auth.push(0x01);
            auth.push(username.len() as u8);
            auth.extend_from_slice(username.as_bytes());
            auth.push(password.len() as u8);
            auth.extend_from_slice(password.as_bytes());
            stream.write_all(&auth)?;
            let mut auth_response = [0_u8; 2];
            stream.read_exact(&mut auth_response)?;
            if auth_response != [0x01, 0x00] {
                bail!("SOCKS5 authentication failed");
            }
        }
        0xff => bail!("SOCKS5 proxy has no acceptable auth method"),
        method => bail!("unsupported SOCKS5 auth method: {method}"),
    }

    let (host, port) = target_host_port(target)?;
    let mut request = vec![0x05, 0x01, 0x00];
    if let Ok(ip) = host.parse::<IpAddr>() {
        match ip {
            IpAddr::V4(value) => {
                request.push(0x01);
                request.extend_from_slice(&value.octets());
            }
            IpAddr::V6(value) => {
                request.push(0x04);
                request.extend_from_slice(&value.octets());
            }
        }
    } else {
        if host.len() > 255 {
            bail!("SOCKS5 target host is too long: {host}");
        }
        request.push(0x03);
        request.push(host.len() as u8);
        request.extend_from_slice(host.as_bytes());
    }
    request.extend_from_slice(&port.to_be_bytes());
    stream.write_all(&request)?;

    let mut response_head = [0_u8; 4];
    stream.read_exact(&mut response_head)?;
    if response_head[0] != 0x05 {
        bail!("invalid SOCKS5 connect response");
    }
    if response_head[1] != 0x00 {
        bail!("SOCKS5 connect failed: {}", response_head[1]);
    }
    let address_len = match response_head[3] {
        0x01 => 4,
        0x03 => {
            let mut len = [0_u8; 1];
            stream.read_exact(&mut len)?;
            len[0] as usize
        }
        0x04 => 16,
        atyp => bail!("invalid SOCKS5 address type: {atyp}"),
    };
    let mut skip = vec![0_u8; address_len + 2];
    stream.read_exact(&mut skip)?;
    Ok(stream)
}

fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        output.push(TABLE[(b0 >> 2) as usize] as char);
        output.push(TABLE[(((b0 & 0b0000_0011) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            output.push(TABLE[(((b1 & 0b0000_1111) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            output.push('=');
        }
        if chunk.len() > 2 {
            output.push(TABLE[(b2 & 0b0011_1111) as usize] as char);
        } else {
            output.push('=');
        }
    }
    output
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

fn diagnosis_target_url(profile: &ProxyProfile, raw_url: &str) -> Result<Url> {
    let raw_url = raw_url.trim();
    if raw_url.is_empty() {
        bail!("request URL or path is required");
    }
    if raw_url.starts_with("http://") || raw_url.starts_with("https://") {
        return Url::parse(raw_url).with_context(|| format!("invalid request URL: {raw_url}"));
    }
    let path = if raw_url.starts_with('/') {
        raw_url.to_string()
    } else {
        format!("/{raw_url}")
    };
    let base = if profile.upstream_base_url.trim().is_empty() {
        "http://rdevtool.local"
    } else {
        profile.upstream_base_url.trim()
    };
    Url::parse(base)
        .with_context(|| format!("invalid profile upstream URL: {base}"))?
        .join(&path)
        .with_context(|| format!("invalid request path: {raw_url}"))
}

fn diagnose_rule_match(
    rule: &ProxyRule,
    method: &str,
    url: &Url,
    headers: &[(String, String)],
) -> ProxyRuleDiagnosisDecision {
    let mut reasons = Vec::new();
    if !rule.enabled {
        reasons.push(ProxyRuleDiagnosisReason {
            key: "enabled".to_string(),
            matched: false,
            detail: "规则已停用".to_string(),
        });
    }
    reasons.push(match_rule_reason(
        "method",
        rule.method.is_empty() || rule.method == method,
        if rule.method.is_empty() {
            "未限制 method".to_string()
        } else {
            format!("需要 {}，当前 {}", rule.method, method)
        },
    ));
    reasons.push(match_rule_reason(
        "urlContains",
        rule.url_contains.is_empty() || url.as_str().contains(&rule.url_contains),
        if rule.url_contains.is_empty() {
            "未限制 URL 包含内容".to_string()
        } else {
            format!("需要 URL 包含 {}", rule.url_contains)
        },
    ));
    reasons.push(match_rule_reason(
        "pathPrefix",
        rule.path_prefix.is_empty() || url.path().starts_with(&rule.path_prefix),
        if rule.path_prefix.is_empty() {
            "未限制 pathPrefix".to_string()
        } else {
            format!("需要路径以 {} 开头，当前 {}", rule.path_prefix, url.path())
        },
    ));
    if !rule.header_name.is_empty() {
        let value = header_value(headers, &rule.header_name);
        let matched = value.as_ref().is_some_and(|value| {
            rule.header_contains.is_empty() || value.contains(&rule.header_contains)
        });
        reasons.push(match_rule_reason(
            "header",
            matched,
            match value {
                Some(value) if rule.header_contains.is_empty() => {
                    format!("找到请求头 {}={}", rule.header_name, value)
                }
                Some(value) => format!(
                    "请求头 {} 需要包含 {}，当前 {}",
                    rule.header_name, rule.header_contains, value
                ),
                None => format!("缺少请求头 {}", rule.header_name),
            },
        ));
    } else {
        reasons.push(match_rule_reason(
            "header",
            true,
            "未限制请求头".to_string(),
        ));
    }
    let matched = rule.enabled && reasons.iter().all(|reason| reason.matched);
    ProxyRuleDiagnosisDecision {
        rule_id: rule.id.clone(),
        rule_name: rule.name.clone(),
        enabled: rule.enabled,
        priority: rule.priority,
        action: rule.action.label().to_string(),
        matched,
        reasons,
    }
}

fn match_rule_reason(key: &str, matched: bool, detail: String) -> ProxyRuleDiagnosisReason {
    ProxyRuleDiagnosisReason {
        key: key.to_string(),
        matched,
        detail,
    }
}

fn proxy_rule_diagnosis_summary(rule: &ProxyRule) -> ProxyRuleDiagnosisSummary {
    ProxyRuleDiagnosisSummary {
        id: rule.id.clone(),
        name: rule.name.clone(),
        priority: rule.priority,
        action: rule.action.label().to_string(),
        path_prefix: rule.path_prefix.clone(),
    }
}

fn proxy_diagnosis_warnings(
    profile: &ProxyProfile,
    listening: bool,
    matched_index: Option<usize>,
    rules: &[ProxyRule],
    decisions: &[ProxyRuleDiagnosisDecision],
) -> Vec<ProxyRequestDiagnosisWarning> {
    let mut warnings = Vec::new();
    if !listening {
        warnings.push(ProxyRequestDiagnosisWarning {
            key: "profileNotListening".to_string(),
            detail: format!("{} 当前没有监听", profile.listen_url()),
            action: Some("先启动该代理 profile，再验证请求是否进入代理。".to_string()),
        });
    }
    if rules.iter().all(|rule| !rule.enabled) {
        warnings.push(ProxyRequestDiagnosisWarning {
            key: "noEnabledRules".to_string(),
            detail: "该 profile 没有启用中的规则".to_string(),
            action: Some("启用至少一条规则，或创建新的转发/Mock/阻断规则。".to_string()),
        });
    }
    if matched_index.is_none() && rules.iter().any(|rule| rule.enabled) {
        warnings.push(ProxyRequestDiagnosisWarning {
            key: "noRuleMatched".to_string(),
            detail: "请求进入该 profile 后会走默认转发，不会命中规则动作".to_string(),
            action: Some("检查 pathPrefix、method、urlContains 和 header 条件。".to_string()),
        });
    }
    if let Some(index) = matched_index {
        if let Some(selected) = rules.get(index) {
            let selected_prefix_len = selected.path_prefix.len();
            let shadowed = rules
                .iter()
                .enumerate()
                .skip(index + 1)
                .filter(|(_, rule)| rule.enabled && rule.path_prefix.len() > selected_prefix_len)
                .filter_map(|(rule_index, rule)| {
                    decisions
                        .get(rule_index)
                        .filter(|decision| decision.matched)
                        .map(|_| rule.name.clone())
                })
                .collect::<Vec<_>>();
            if !shadowed.is_empty() {
                warnings.push(ProxyRequestDiagnosisWarning {
                    key: "specificRuleShadowed".to_string(),
                    detail: format!(
                        "更具体的规则也能命中，但排序在 {} 之后：{}",
                        selected.name,
                        shadowed.join(", ")
                    ),
                    action: Some("把更具体的 pathPrefix 规则设置为更小的 priority。".to_string()),
                });
            }
        }
    }
    warnings
}

fn proxy_profile_port_listening(profile: &ProxyProfile) -> bool {
    let address = format!("{}:{}", profile.listen_host, profile.listen_port);
    address
        .to_socket_addrs()
        .ok()
        .and_then(|mut addresses| addresses.next())
        .is_some_and(|address| {
            TcpStream::connect_timeout(&address, Duration::from_millis(180)).is_ok()
        })
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
    if let Some(upstream_proxy) = outbound_proxy_for_request(profile, rule) {
        builder = builder.proxy(
            reqwest::Proxy::all(&upstream_proxy)
                .with_context(|| format!("invalid upstream proxy: {upstream_proxy}"))?,
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

fn outbound_proxy_for_request(profile: &ProxyProfile, rule: Option<&ProxyRule>) -> Option<String> {
    let mode_and_proxy = rule.and_then(|rule| {
        let ProxyRuleAction::Forward {
            outbound_mode,
            outbound_proxy,
            ..
        } = &rule.action
        else {
            return None;
        };
        Some((*outbound_mode, outbound_proxy.trim()))
    });

    let proxy = match mode_and_proxy {
        Some((ProxyOutboundMode::Direct, _)) => return None,
        Some((ProxyOutboundMode::Proxy, outbound_proxy)) => outbound_proxy,
        Some((ProxyOutboundMode::Inherit, _)) | None => profile.upstream_proxy.trim(),
    };

    (!proxy.is_empty()).then(|| proxy.to_string())
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
            target_base_url,
            outbound_mode,
            outbound_proxy,
            ..
        } => {
            if !target_base_url.trim().is_empty() {
                Url::parse(target_base_url.trim())
                    .with_context(|| format!("重写目标无效：{target_base_url}"))?;
            }
            if *outbound_mode == ProxyOutboundMode::Proxy {
                if outbound_proxy.trim().is_empty() {
                    bail!("指定上游代理时，代理地址不能为空");
                }
                reqwest::Proxy::all(outbound_proxy.trim())
                    .with_context(|| format!("上游代理无效：{outbound_proxy}"))?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_status_is_scoped_by_config_path() {
        let runtime = ProxyRuntimeState::default();
        let profile = ProxyProfile::default();
        let first_path = PathBuf::from("/tmp/rdevtool-proxy-first.toml");
        let second_path = PathBuf::from("/tmp/rdevtool-proxy-second.toml");
        runtime
            .inner
            .lock()
            .expect("proxy runtime poisoned")
            .servers
            .insert(
                proxy_runtime_key(&first_path, &profile.id),
                ProxyServerHandle {
                    stop: Arc::new(AtomicBool::new(false)),
                    listen_url: profile.listen_url(),
                    started_at: "2026-01-01T00:00:00Z".to_string(),
                },
            );

        let first_status =
            runtime.statuses_for_profiles(&first_path, std::slice::from_ref(&profile));
        let second_status =
            runtime.statuses_for_profiles(&second_path, std::slice::from_ref(&profile));

        assert!(first_status[0].running);
        assert!(!second_status[0].running);
    }
}
