use anyhow::{Context, Result, anyhow, bail};
use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use tungstenite::{Message, connect};

use crate::config::{RuntimeProfileConfig, default_config_dir};
use crate::config_store::write_config_text_atomic;
use crate::navigation::{NavigationEntry, runtime_profile_browser_args};

const DEFAULT_CDP_PORT: u16 = 9223;
const DEFAULT_WEB_ACTIONS_TEMPLATE: &str = r#"[browser]
port = 9223

[[actions]]
key = "page-info"
name = "读取页面信息"
scope = ""
match = ["http://*", "https://*"]
run_manually = true
script = """
return {
  title: document.title,
  url: location.href,
  readyState: document.readyState
};
"""

[[actions]]
key = "baidu-search"
name = "百度搜索"
scope = "url:baidu"
match = ["https://www.baidu.com/*", "http://www.baidu.com/*"]
run_manually = true
script = """
const input = document.querySelector('#kw');
if (!input) {
  throw new Error('未找到百度搜索框 #kw');
}
input.value = params.keyword || '';
input.dispatchEvent(new Event('input', { bubbles: true }));
const submit = document.querySelector('#su');
if (!submit) {
  throw new Error('未找到百度搜索按钮 #su');
}
submit.click();
return { ok: true, keyword: params.keyword || '' };
"""

[actions.params.keyword]
label = "关键词"
default = "rDevTool"

[[actions]]
key = "current-page-request"
name = "请求当前页面"
scope = ""
match = ["http://*", "https://*"]
run_manually = true
kind = "request"

[actions.request]
method = "GET"
url = "."
headers = { accept = "text/html,application/json" }
timeout_ms = 15000
"#;

pub fn default_web_actions_path() -> PathBuf {
    default_config_dir().join("web_actions.toml")
}

pub fn web_actions_file_path() -> String {
    default_web_actions_path().display().to_string()
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
struct WebActionsFileConfig {
    #[serde(default)]
    browser: WebActionsBrowserConfig,
    #[serde(default)]
    actions: Vec<WebActionConfig>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct WebActionsBrowserConfig {
    #[serde(default = "default_cdp_port")]
    port: u16,
    #[serde(default)]
    chrome_path: Option<PathBuf>,
    #[serde(default)]
    user_data_dir: Option<PathBuf>,
}

#[derive(Debug, Clone)]
struct EffectiveWebActionsBrowserConfig {
    port: u16,
    chrome_path: Option<PathBuf>,
    browser_app: Option<String>,
    browser_profile: Option<String>,
    user_data_dir: Option<PathBuf>,
    browser_args: Vec<String>,
}

impl EffectiveWebActionsBrowserConfig {
    fn from_config(browser: &WebActionsBrowserConfig) -> Self {
        Self {
            port: browser.port,
            chrome_path: browser.chrome_path.clone(),
            browser_app: None,
            browser_profile: None,
            user_data_dir: browser.user_data_dir.clone(),
            browser_args: Vec::new(),
        }
    }
}

impl Default for WebActionsBrowserConfig {
    fn default() -> Self {
        Self {
            port: default_cdp_port(),
            chrome_path: None,
            user_data_dir: None,
        }
    }
}

fn default_cdp_port() -> u16 {
    DEFAULT_CDP_PORT
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WebActionKind {
    Script,
    Request,
}

impl Default for WebActionKind {
    fn default() -> Self {
        Self::Script
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct WebActionConfig {
    key: String,
    name: String,
    #[serde(default)]
    kind: WebActionKind,
    #[serde(default)]
    scope: String,
    #[serde(default, rename = "match")]
    match_patterns: Vec<String>,
    #[serde(default = "default_true")]
    run_manually: bool,
    #[serde(default)]
    script: String,
    #[serde(default)]
    request: WebActionRequestConfig,
    #[serde(default)]
    params: BTreeMap<String, WebActionParamConfig>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct WebActionRequestConfig {
    #[serde(default = "default_request_method")]
    method: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    headers: BTreeMap<String, String>,
    #[serde(default)]
    body: String,
    #[serde(default = "default_request_timeout_ms")]
    timeout_ms: u64,
    #[serde(default = "default_request_max_body_bytes")]
    max_body_bytes: usize,
}

impl Default for WebActionRequestConfig {
    fn default() -> Self {
        Self {
            method: default_request_method(),
            url: String::new(),
            headers: BTreeMap::new(),
            body: String::new(),
            timeout_ms: default_request_timeout_ms(),
            max_body_bytes: default_request_max_body_bytes(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct WebActionParamConfig {
    #[serde(default)]
    label: String,
    #[serde(default)]
    default: String,
    #[serde(default)]
    source: String,
    #[serde(default)]
    source_key: String,
}

fn default_true() -> bool {
    true
}

fn default_request_method() -> String {
    "GET".to_string()
}

fn default_request_timeout_ms() -> u64 {
    30_000
}

fn default_request_max_body_bytes() -> usize {
    64 * 1024
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebActionListResponse {
    pub config_path: String,
    pub actions: Vec<WebActionSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebActionSummary {
    pub key: String,
    pub name: String,
    pub kind: WebActionKind,
    pub scope: String,
    pub match_patterns: Vec<String>,
    pub run_manually: bool,
    pub params: Vec<WebActionParamSummary>,
    pub script: String,
    pub request: Option<WebActionRequestSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebActionRequestSummary {
    pub method: String,
    pub url: String,
    pub headers: BTreeMap<String, String>,
    pub body: String,
    pub timeout_ms: u64,
    pub max_body_bytes: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebActionParamSummary {
    pub key: String,
    pub label: String,
    pub default_value: String,
    pub source: String,
    pub source_key: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebActionRunRequest {
    pub action_key: String,
    #[serde(default)]
    pub target_id: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub params: BTreeMap<String, String>,
    #[serde(default)]
    pub context_params: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebActionScriptRunRequest {
    pub target_id: String,
    #[serde(default)]
    pub script: String,
    #[serde(default)]
    pub params: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebActionRunResult {
    pub action_key: String,
    pub target_id: String,
    pub title: String,
    pub url: String,
    pub success: bool,
    pub result: Option<Value>,
    pub result_text: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebActionTarget {
    pub id: String,
    pub title: String,
    pub url: String,
    #[serde(rename = "type")]
    pub target_type: String,
    #[serde(default)]
    pub web_socket_debugger_url: Option<String>,
}

pub fn list_web_actions(scope: Option<&str>, url: Option<&str>) -> Result<WebActionListResponse> {
    let path = ensure_web_actions_config()?;
    let config = load_web_actions_config()?;
    let actions = config
        .actions
        .into_iter()
        .filter(|action| action_matches_context(action, scope, url))
        .map(web_action_summary)
        .collect();
    Ok(WebActionListResponse {
        config_path: path.display().to_string(),
        actions,
    })
}

pub fn open_web_action_target(url: &str) -> Result<WebActionTarget> {
    let normalized_url = normalize_http_url(url)?;
    let config = load_web_actions_config()?;
    let browser = EffectiveWebActionsBrowserConfig::from_config(&config.browser);
    open_web_action_target_with_browser(&browser, normalized_url)
}

pub fn open_web_action_navigation_target(
    entry: &NavigationEntry,
    runtime_profiles: &[RuntimeProfileConfig],
) -> Result<WebActionTarget> {
    let url = entry
        .url
        .as_deref()
        .ok_or_else(|| anyhow!("网站入口缺少 URL"))?;
    let normalized_url = normalize_http_url(url)?;
    let config = load_web_actions_config()?;
    let browser = effective_browser_for_navigation_entry(&config.browser, entry, runtime_profiles)?;
    open_web_action_target_with_browser(&browser, normalized_url)
}

fn open_web_action_target_with_browser(
    browser: &EffectiveWebActionsBrowserConfig,
    normalized_url: &str,
) -> Result<WebActionTarget> {
    ensure_cdp_browser(browser, Some(normalized_url))?;

    for _ in 0..20 {
        let targets = list_web_action_targets_for_browser(browser)?;
        if let Some(target) = targets
            .iter()
            .find(|target| target.url == normalized_url && target.target_type == "page")
            .cloned()
        {
            return Ok(target);
        }
        thread::sleep(Duration::from_millis(120));
    }

    list_web_action_targets_for_browser(browser)?
        .into_iter()
        .find(|target| target.target_type == "page" && target.url.starts_with("http"))
        .ok_or_else(|| anyhow!("受控 Chrome 未返回可用页面"))
}

fn effective_browser_for_navigation_entry(
    base: &WebActionsBrowserConfig,
    entry: &NavigationEntry,
    runtime_profiles: &[RuntimeProfileConfig],
) -> Result<EffectiveWebActionsBrowserConfig> {
    let runtime_profile =
        resolve_runtime_profile(entry.runtime_profile.as_deref(), runtime_profiles)?;
    let browser_app = entry
        .browser
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            runtime_profile
                .and_then(|profile| profile.browser.as_deref())
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .and_then(controlled_browser_app_name);
    let browser_profile = entry
        .browser_profile
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            runtime_profile
                .and_then(|profile| profile.browser_profile.as_deref())
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .map(ToString::to_string);
    let port = runtime_profile
        .filter(|profile| profile.web_actions_enabled)
        .map(|profile| profile.web_actions_port)
        .unwrap_or(base.port);
    let user_data_dir = runtime_profile
        .and_then(|profile| {
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
        .or_else(|| base.user_data_dir.clone());
    let browser_args = runtime_profile
        .map(runtime_profile_browser_args)
        .unwrap_or_default();

    Ok(EffectiveWebActionsBrowserConfig {
        port,
        chrome_path: base.chrome_path.clone(),
        browser_app,
        browser_profile,
        user_data_dir,
        browser_args,
    })
}

fn resolve_runtime_profile<'a>(
    key: Option<&str>,
    runtime_profiles: &'a [RuntimeProfileConfig],
) -> Result<Option<&'a RuntimeProfileConfig>> {
    let Some(key) = key.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    runtime_profiles
        .iter()
        .find(|profile| profile.key == key)
        .map(Some)
        .ok_or_else(|| anyhow!("运行配置不存在: {}", key))
}

fn controlled_browser_app_name(value: &str) -> Option<String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "" | "current_chrome" | "current chrome" | "chrome_current" | "chrome-current"
        | "system" | "default" | "system_default" | "default_browser" => None,
        _ => Some(value.trim().to_string()),
    }
}

pub fn list_web_action_targets() -> Result<Vec<WebActionTarget>> {
    let config = load_web_actions_config()?;
    let browser = EffectiveWebActionsBrowserConfig::from_config(&config.browser);
    list_web_action_targets_for_browser(&browser)
}

pub fn list_web_action_navigation_targets(
    entry: &NavigationEntry,
    runtime_profiles: &[RuntimeProfileConfig],
) -> Result<Vec<WebActionTarget>> {
    let config = load_web_actions_config()?;
    let browser = effective_browser_for_navigation_entry(&config.browser, entry, runtime_profiles)?;
    list_web_action_targets_for_browser(&browser)
}

fn list_web_action_targets_for_browser(
    browser: &EffectiveWebActionsBrowserConfig,
) -> Result<Vec<WebActionTarget>> {
    match list_cdp_targets(browser.port) {
        Ok(targets) => Ok(targets
            .into_iter()
            .filter(|target| target.target_type == "page")
            .collect()),
        Err(_) => Ok(Vec::new()),
    }
}

pub fn run_web_action(request: WebActionRunRequest) -> Result<WebActionRunResult> {
    let config = load_web_actions_config()?;
    let browser = EffectiveWebActionsBrowserConfig::from_config(&config.browser);
    run_web_action_with_browser(&config, &browser, request)
}

pub fn run_web_action_navigation(
    entry: &NavigationEntry,
    runtime_profiles: &[RuntimeProfileConfig],
    request: WebActionRunRequest,
) -> Result<WebActionRunResult> {
    let config = load_web_actions_config()?;
    let browser = effective_browser_for_navigation_entry(&config.browser, entry, runtime_profiles)?;
    run_web_action_with_browser(&config, &browser, request)
}

fn run_web_action_with_browser(
    config: &WebActionsFileConfig,
    browser: &EffectiveWebActionsBrowserConfig,
    request: WebActionRunRequest,
) -> Result<WebActionRunResult> {
    let action = config
        .actions
        .iter()
        .find(|action| action.key == request.action_key)
        .cloned()
        .ok_or_else(|| anyhow!("网页动作不存在: {}", request.action_key))?;

    match action.kind {
        WebActionKind::Script => run_script_web_action(browser, action, request),
        WebActionKind::Request => run_request_web_action(action, request),
    }
}

fn run_script_web_action(
    browser: &EffectiveWebActionsBrowserConfig,
    action: WebActionConfig,
    request: WebActionRunRequest,
) -> Result<WebActionRunResult> {
    let target = resolve_action_target(browser, &action, &request)?;
    if !action_matches_context(&action, request.scope.as_deref(), Some(&target.url)) {
        bail!(
            "当前页面不匹配动作范围：{} 不在 {:?}",
            target.url,
            action.match_patterns
        );
    }
    let ws_url = target
        .web_socket_debugger_url
        .as_deref()
        .ok_or_else(|| anyhow!("页面缺少 CDP WebSocket 地址"))?;
    let params = resolve_action_params(&action, &request);
    let result = evaluate_action_script(ws_url, &action.script, &params)?;
    Ok(WebActionRunResult {
        action_key: action.key,
        target_id: target.id,
        title: target.title,
        url: target.url,
        success: result.error.is_none(),
        result: result.value,
        result_text: result.text,
        error: result.error,
    })
}

fn run_request_web_action(
    action: WebActionConfig,
    request: WebActionRunRequest,
) -> Result<WebActionRunResult> {
    let context_url = request.url.as_deref();
    if !action_matches_context(&action, request.scope.as_deref(), context_url) {
        bail!(
            "当前页面不匹配动作范围：{} 不在 {:?}",
            context_url.unwrap_or("-"),
            action.match_patterns
        );
    }

    let params = resolve_action_params(&action, &request);
    let result = execute_request_action(&action.request, &params, context_url)?;
    Ok(WebActionRunResult {
        action_key: action.key,
        target_id: request.target_id.unwrap_or_default(),
        title: action.name,
        url: result.url,
        success: result.success,
        result: Some(result.value.clone()),
        result_text: serde_json::to_string_pretty(&result.value)
            .unwrap_or_else(|_| result.value.to_string()),
        error: None,
    })
}

pub fn run_web_action_script(request: WebActionScriptRunRequest) -> Result<WebActionRunResult> {
    let config = load_web_actions_config()?;
    let browser = EffectiveWebActionsBrowserConfig::from_config(&config.browser);
    run_web_action_script_with_browser(&browser, request)
}

pub fn run_web_action_navigation_script(
    entry: &NavigationEntry,
    runtime_profiles: &[RuntimeProfileConfig],
    request: WebActionScriptRunRequest,
) -> Result<WebActionRunResult> {
    let config = load_web_actions_config()?;
    let browser = effective_browser_for_navigation_entry(&config.browser, entry, runtime_profiles)?;
    run_web_action_script_with_browser(&browser, request)
}

fn run_web_action_script_with_browser(
    browser: &EffectiveWebActionsBrowserConfig,
    request: WebActionScriptRunRequest,
) -> Result<WebActionRunResult> {
    let script = request.script.trim();
    if script.is_empty() {
        bail!("临时脚本不能为空");
    }
    let target_id = request.target_id.trim();
    if target_id.is_empty() {
        bail!("未选择受控页面");
    }
    let target = list_cdp_targets(browser.port)
        .context("无法连接受控 Chrome，请先通过“打开页面”创建受控页面")?
        .into_iter()
        .find(|target| target.id == target_id && target.target_type == "page")
        .ok_or_else(|| anyhow!("未找到受控页面: {}", request.target_id))?;
    let ws_url = target
        .web_socket_debugger_url
        .as_deref()
        .ok_or_else(|| anyhow!("页面缺少 CDP WebSocket 地址"))?;
    let result = evaluate_action_script(ws_url, script, &request.params)?;
    Ok(WebActionRunResult {
        action_key: "temporary-script".to_string(),
        target_id: target.id,
        title: target.title,
        url: target.url,
        success: result.error.is_none(),
        result: result.value,
        result_text: result.text,
        error: result.error,
    })
}

fn ensure_web_actions_config() -> Result<PathBuf> {
    let path = default_web_actions_path();
    if path.exists() {
        return Ok(path);
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create config dir: {}", parent.display()))?;
    }
    write_config_text_atomic(&path, DEFAULT_WEB_ACTIONS_TEMPLATE)
        .with_context(|| format!("failed to write web actions config: {}", path.display()))?;
    Ok(path)
}

fn load_web_actions_config() -> Result<WebActionsFileConfig> {
    let path = ensure_web_actions_config()?;
    let content = fs::read_to_string(&path)
        .with_context(|| format!("failed to read web actions config: {}", path.display()))?;
    toml::from_str(&content)
        .with_context(|| format!("failed to parse web actions config: {}", path.display()))
}

fn web_action_summary(action: WebActionConfig) -> WebActionSummary {
    let request = (action.kind == WebActionKind::Request).then(|| WebActionRequestSummary {
        method: action.request.method,
        url: action.request.url,
        headers: action.request.headers,
        body: action.request.body,
        timeout_ms: action.request.timeout_ms,
        max_body_bytes: action.request.max_body_bytes,
    });
    WebActionSummary {
        key: action.key,
        name: action.name,
        kind: action.kind,
        scope: action.scope,
        match_patterns: action.match_patterns,
        run_manually: action.run_manually,
        params: action
            .params
            .into_iter()
            .map(|(key, param)| WebActionParamSummary {
                key,
                label: param.label,
                default_value: param.default,
                source: param.source,
                source_key: param.source_key,
            })
            .collect(),
        script: action.script,
        request,
    }
}

fn resolve_action_params(
    action: &WebActionConfig,
    request: &WebActionRunRequest,
) -> BTreeMap<String, String> {
    let mut params = BTreeMap::new();

    for (key, config) in &action.params {
        let value = request
            .params
            .get(key)
            .cloned()
            .or_else(|| resolve_action_param_source(key, config, &request.context_params))
            .unwrap_or_else(|| config.default.clone());
        params.insert(key.clone(), value);
    }

    for (key, value) in &request.params {
        params.insert(key.clone(), value.clone());
    }

    params
}

fn resolve_action_param_source(
    param_key: &str,
    config: &WebActionParamConfig,
    context_params: &BTreeMap<String, String>,
) -> Option<String> {
    let source = config.source.trim().to_ascii_lowercase();
    let source_key = config
        .source_key
        .trim()
        .is_empty()
        .then_some(param_key)
        .unwrap_or_else(|| config.source_key.trim());

    match source.as_str() {
        "" | "default" | "fixed" | "value" => Some(config.default.clone()),
        "project" => lookup_context_param(context_params, &["project"], source_key),
        "workspace" => lookup_context_param(context_params, &["workspace"], source_key),
        "debug" | "debugprofile" | "debug_profile" | "debug-profile" => lookup_context_param(
            context_params,
            &["debugProfile", "debug_profile"],
            source_key,
        ),
        "runtime" | "runtimeprofile" | "runtime_profile" | "runtime-profile" => {
            lookup_context_param(
                context_params,
                &["runtimeProfile", "runtime_profile"],
                source_key,
            )
        }
        "context" => lookup_context_param(context_params, &[], source_key),
        _ => lookup_context_param(context_params, &[source.as_str()], source_key),
    }
}

fn lookup_context_param(
    context_params: &BTreeMap<String, String>,
    namespaces: &[&str],
    source_key: &str,
) -> Option<String> {
    let key = source_key.trim();
    if key.is_empty() {
        return None;
    }

    let mut candidates = Vec::new();
    candidates.push(key.to_string());
    for namespace in namespaces {
        candidates.push(format!("{}.{}", namespace, key));
    }

    candidates
        .into_iter()
        .find_map(|candidate| context_params.get(&candidate).cloned())
}

fn action_matches_context(
    action: &WebActionConfig,
    scope: Option<&str>,
    url: Option<&str>,
) -> bool {
    let action_scope = action.scope.trim();
    let scope_matches = match scope.map(str::trim).filter(|value| !value.is_empty()) {
        Some(scope) => action_scope.is_empty() || action_scope == scope,
        None => true,
    };
    if !scope_matches {
        return false;
    }

    let Some(url) = url.map(str::trim).filter(|value| !value.is_empty()) else {
        return true;
    };
    action.match_patterns.is_empty()
        || action
            .match_patterns
            .iter()
            .any(|pattern| wildcard_match(pattern.trim(), url))
}

fn wildcard_match(pattern: &str, text: &str) -> bool {
    if pattern.is_empty() {
        return false;
    }
    if pattern == "*" {
        return true;
    }
    if !pattern.contains('*') {
        return pattern == text;
    }

    let starts_with_wildcard = pattern.starts_with('*');
    let ends_with_wildcard = pattern.ends_with('*');
    let parts = pattern
        .split('*')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if parts.is_empty() {
        return true;
    }

    let mut cursor = 0usize;
    for (index, part) in parts.iter().enumerate() {
        let Some(found) = text[cursor..].find(part) else {
            return false;
        };
        if index == 0 && !starts_with_wildcard && found != 0 {
            return false;
        }
        cursor += found + part.len();
    }

    if !ends_with_wildcard {
        if let Some(last) = parts.last() {
            return text.ends_with(last);
        }
    }
    true
}

fn normalize_http_url(url: &str) -> Result<&str> {
    let normalized = url.trim();
    let lower = normalized.to_ascii_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        bail!("网页动作仅支持 http/https 地址");
    }
    Ok(normalized)
}

fn resolve_action_target(
    browser: &EffectiveWebActionsBrowserConfig,
    action: &WebActionConfig,
    request: &WebActionRunRequest,
) -> Result<WebActionTarget> {
    let targets = list_cdp_targets(browser.port)
        .context("无法连接受控 Chrome，请先通过“打开页面”创建受控页面")?;
    if let Some(target_id) = request
        .target_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        return targets
            .into_iter()
            .find(|target| target.id == target_id)
            .ok_or_else(|| anyhow!("未找到受控页面: {}", target_id));
    }

    targets
        .into_iter()
        .find(|target| {
            target.target_type == "page"
                && action_matches_context(action, request.scope.as_deref(), Some(&target.url))
        })
        .ok_or_else(|| anyhow!("未找到匹配网页动作的受控页面"))
}

struct RequestActionExecution {
    url: String,
    success: bool,
    value: Value,
}

fn execute_request_action(
    config: &WebActionRequestConfig,
    params: &BTreeMap<String, String>,
    context_url: Option<&str>,
) -> Result<RequestActionExecution> {
    let method_text = render_template(&config.method, params)
        .trim()
        .to_ascii_uppercase();
    if method_text.is_empty() {
        bail!("请求动作缺少 method");
    }
    let method = reqwest::Method::from_bytes(method_text.as_bytes())
        .with_context(|| format!("请求方法无效: {}", method_text))?;
    let request_url = resolve_request_action_url(&config.url, params, context_url)?;
    let timeout_ms = config.timeout_ms.clamp(1, 300_000);
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .context("failed to build request action HTTP client")?;

    let mut request_headers = BTreeMap::new();
    let mut builder = client.request(method.clone(), request_url.clone());
    for (name, value) in &config.headers {
        let header_name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
            .with_context(|| format!("请求 Header 名无效: {}", name))?;
        let rendered = render_template(value, params);
        if rendered.is_empty() {
            continue;
        }
        let header_value = reqwest::header::HeaderValue::from_str(&rendered)
            .with_context(|| format!("请求 Header 值无效: {}", name))?;
        request_headers.insert(name.clone(), rendered);
        builder = builder.header(header_name, header_value);
    }

    let request_body = render_template(&config.body, params);
    if !request_body.is_empty() {
        builder = builder.body(request_body.clone());
    }

    let started_at = Instant::now();
    let response = builder
        .send()
        .with_context(|| format!("请求动作发送失败: {} {}", method, request_url))?;
    let duration_ms = started_at.elapsed().as_millis() as u64;
    let final_url = response.url().to_string();
    let status = response.status();
    let response_headers = response
        .headers()
        .iter()
        .map(|(name, value)| {
            (
                name.as_str().to_string(),
                value.to_str().unwrap_or("<binary>").to_string(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let bytes = response
        .bytes()
        .context("failed to read request action body")?;
    let response_bytes = bytes.len();
    let max_body_bytes = config.max_body_bytes.max(1);
    let preview_len = response_bytes.min(max_body_bytes);
    let body_preview = String::from_utf8_lossy(&bytes[..preview_len]).to_string();
    let truncated = response_bytes > preview_len;
    let success = status.is_success();
    let value = json!({
        "kind": "request",
        "method": method.as_str(),
        "url": final_url,
        "status": status.as_u16(),
        "success": success,
        "durationMs": duration_ms,
        "requestHeaders": request_headers,
        "requestBodyBytes": request_body.as_bytes().len(),
        "responseHeaders": response_headers,
        "responseBytes": response_bytes,
        "responseBody": body_preview,
        "responseBodyTruncated": truncated
    });

    Ok(RequestActionExecution {
        url: final_url,
        success,
        value,
    })
}

fn resolve_request_action_url(
    value: &str,
    params: &BTreeMap<String, String>,
    context_url: Option<&str>,
) -> Result<String> {
    let rendered = render_template(value, params);
    let trimmed = rendered.trim();
    if trimmed.is_empty() {
        bail!("请求动作缺少 URL");
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Ok(trimmed.to_string());
    }
    let base_url = context_url
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .ok_or_else(|| anyhow!("相对请求 URL 需要当前页面 URL 作为基准"))?;
    let base = reqwest::Url::parse(base_url)
        .with_context(|| format!("当前页面 URL 无效，无法解析相对请求: {}", base_url))?;
    base.join(trimmed)
        .with_context(|| format!("请求 URL 无效: {}", trimmed))
        .map(|url| url.to_string())
}

fn render_template(value: &str, params: &BTreeMap<String, String>) -> String {
    let mut rendered = value.to_string();
    for (key, param_value) in params {
        rendered = rendered.replace(&format!("${{{key}}}"), param_value);
        rendered = rendered.replace(&format!("{{{{{key}}}}}"), param_value);
    }
    rendered
}

fn ensure_cdp_browser(browser: &EffectiveWebActionsBrowserConfig, url: Option<&str>) -> Result<()> {
    if cdp_version(browser.port).is_ok() {
        if let Some(url) = url {
            if !list_cdp_targets(browser.port)?
                .iter()
                .any(|target| target.url == url)
            {
                create_cdp_target(browser.port, url)?;
            }
        }
        return Ok(());
    }

    launch_chrome(browser, url)?;
    for _ in 0..40 {
        if cdp_version(browser.port).is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(150));
    }
    bail!("受控 Chrome 启动超时，CDP 端口 {} 不可用", browser.port)
}

fn cdp_base_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

fn cdp_version(port: u16) -> Result<Value> {
    let client = cdp_http_client()?;
    client
        .get(format!("{}/json/version", cdp_base_url(port)))
        .send()
        .context("failed to query CDP version")?
        .error_for_status()
        .context("CDP version returned error")?
        .json()
        .context("failed to parse CDP version")
}

fn list_cdp_targets(port: u16) -> Result<Vec<WebActionTarget>> {
    let client = cdp_http_client()?;
    client
        .get(format!("{}/json/list", cdp_base_url(port)))
        .send()
        .context("failed to list CDP targets")?
        .error_for_status()
        .context("CDP target list returned error")?
        .json()
        .context("failed to parse CDP targets")
}

fn create_cdp_target(port: u16, url: &str) -> Result<WebActionTarget> {
    let client = cdp_http_client()?;
    let encoded = utf8_percent_encode(url, NON_ALPHANUMERIC).to_string();
    client
        .put(format!("{}/json/new?{}", cdp_base_url(port), encoded))
        .send()
        .context("failed to create CDP target")?
        .error_for_status()
        .context("CDP create target returned error")?
        .json()
        .context("failed to parse created CDP target")
}

fn cdp_http_client() -> Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .context("failed to build CDP HTTP client")
}

fn launch_chrome(browser: &EffectiveWebActionsBrowserConfig, url: Option<&str>) -> Result<()> {
    let chrome_path = resolve_chrome_path(browser)?;
    let user_data_dir = browser
        .user_data_dir
        .clone()
        .unwrap_or_else(|| default_config_dir().join("chrome-cdp-profile"));
    fs::create_dir_all(&user_data_dir).with_context(|| {
        format!(
            "failed to create Chrome profile dir: {}",
            user_data_dir.display()
        )
    })?;

    let mut command = Command::new(chrome_path);
    command
        .arg(format!("--remote-debugging-port={}", browser.port))
        .arg(format!("--user-data-dir={}", user_data_dir.display()))
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--disable-background-mode")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(profile) = browser.browser_profile.as_deref() {
        command.arg(format!("--profile-directory={profile}"));
    }
    for arg in browser
        .browser_args
        .iter()
        .filter(|arg| !is_managed_browser_arg(arg))
    {
        command.arg(arg);
    }
    if let Some(url) = url {
        command.arg(url);
    }
    command
        .spawn()
        .context("failed to launch controlled Chrome")?;
    Ok(())
}

fn is_managed_browser_arg(arg: &&String) -> bool {
    let normalized = arg.trim().to_ascii_lowercase();
    normalized.starts_with("--remote-debugging-port") || normalized.starts_with("--user-data-dir")
}

fn resolve_chrome_path(browser: &EffectiveWebActionsBrowserConfig) -> Result<PathBuf> {
    if let Some(path) = browser.chrome_path.as_ref().filter(|path| path.exists()) {
        return Ok(path.clone());
    }
    if let Some(path) = browser
        .browser_app
        .as_deref()
        .and_then(resolve_browser_app_executable)
    {
        return Ok(path);
    }
    if let Ok(path) = std::env::var("RDEVTOOL_CHROME_PATH") {
        let path = PathBuf::from(path);
        if path.exists() {
            return Ok(path);
        }
    }

    #[cfg(target_os = "macos")]
    {
        let candidates = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ];
        for candidate in candidates {
            let path = PathBuf::from(candidate);
            if path.exists() {
                return Ok(path);
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        for candidate in ["google-chrome", "chromium", "chromium-browser"] {
            if Command::new("which")
                .arg(candidate)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok_and(|status| status.success())
            {
                return Ok(PathBuf::from(candidate));
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        for candidate in [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        ] {
            let path = PathBuf::from(candidate);
            if path.exists() {
                return Ok(path);
            }
        }
    }

    bail!("未找到 Chrome，可在 web_actions.toml 的 [browser].chrome_path 配置路径")
}

fn resolve_browser_app_executable(app_name: &str) -> Option<PathBuf> {
    let app_name = app_name.trim();
    if app_name.is_empty() {
        return None;
    }

    #[cfg(target_os = "macos")]
    {
        let aliases: Vec<&str> = match app_name.to_ascii_lowercase().as_str() {
            "chrome" | "google chrome" => vec!["Google Chrome"],
            "edge" | "microsoft edge" => vec!["Microsoft Edge"],
            "chromium" => vec!["Chromium"],
            "brave" | "brave browser" => vec!["Brave Browser"],
            "arc" => vec!["Arc"],
            _ => vec![app_name],
        };
        for alias in aliases {
            let path = PathBuf::from(format!("/Applications/{alias}.app/Contents/MacOS/{alias}"));
            if path.exists() {
                return Some(path);
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if Command::new("which")
            .arg(app_name)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
        {
            return Some(PathBuf::from(app_name));
        }
    }

    #[cfg(target_os = "windows")]
    {
        let aliases: &[&str] = match app_name.to_ascii_lowercase().as_str() {
            "chrome" | "google chrome" => &[
                r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            ],
            "edge" | "microsoft edge" => &[
                r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
                r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            ],
            _ => &[],
        };
        for alias in aliases {
            let path = PathBuf::from(alias);
            if path.exists() {
                return Some(path);
            }
        }
    }

    None
}

struct EvaluateResult {
    value: Option<Value>,
    text: String,
    error: Option<String>,
}

fn evaluate_action_script(
    ws_url: &str,
    script: &str,
    params: &BTreeMap<String, String>,
) -> Result<EvaluateResult> {
    let params_json = serde_json::to_string(params).context("failed to serialize action params")?;
    let expression = format!(
        "(async () => {{ const params = {}; {} }})()",
        params_json, script
    );
    let (mut socket, _) = connect(ws_url).context("failed to connect CDP WebSocket")?;
    let focus_request = json!({
        "id": 1,
        "method": "Page.bringToFront"
    });
    socket
        .send(Message::Text(focus_request.to_string()))
        .context("failed to focus CDP target")?;
    let request = json!({
        "id": 2,
        "method": "Runtime.evaluate",
        "params": {
            "expression": expression,
            "awaitPromise": true,
            "returnByValue": true,
            "userGesture": true
        }
    });
    socket
        .send(Message::Text(request.to_string()))
        .context("failed to send CDP Runtime.evaluate")?;

    loop {
        let message = socket.read().context("failed to read CDP response")?;
        let Message::Text(text) = message else {
            continue;
        };
        let value: Value = serde_json::from_str(&text).context("failed to parse CDP response")?;
        if value.get("id").and_then(Value::as_i64) != Some(2) {
            continue;
        }
        return parse_evaluate_response(value);
    }
}

fn parse_evaluate_response(response: Value) -> Result<EvaluateResult> {
    if let Some(error) = response.get("error") {
        let text = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("CDP 执行失败")
            .to_string();
        return Ok(EvaluateResult {
            value: None,
            text: text.clone(),
            error: Some(text),
        });
    }
    let result = response
        .get("result")
        .ok_or_else(|| anyhow!("CDP response missing result"))?;
    if let Some(exception) = result.get("exceptionDetails") {
        let text = exception_text(exception);
        return Ok(EvaluateResult {
            value: None,
            text: text.clone(),
            error: Some(text),
        });
    }
    let remote = result
        .get("result")
        .ok_or_else(|| anyhow!("CDP evaluate result missing remote object"))?;
    let value = remote.get("value").cloned();
    let text = value
        .as_ref()
        .map(|value| serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string()))
        .or_else(|| {
            remote
                .get("unserializableValue")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .or_else(|| {
            remote
                .get("description")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .unwrap_or_else(|| "undefined".to_string());
    Ok(EvaluateResult {
        value,
        text,
        error: None,
    })
}

fn exception_text(exception: &Value) -> String {
    exception
        .get("exception")
        .and_then(|value| value.get("description"))
        .and_then(Value::as_str)
        .or_else(|| exception.get("text").and_then(Value::as_str))
        .unwrap_or("网页动作执行异常")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_default_web_actions_template() {
        let config: WebActionsFileConfig = toml::from_str(DEFAULT_WEB_ACTIONS_TEMPLATE).unwrap();
        assert_eq!(config.browser.port, DEFAULT_CDP_PORT);
        assert!(
            config
                .actions
                .iter()
                .any(|action| action.key == "page-info")
        );
        assert!(
            config
                .actions
                .iter()
                .any(|action| action.key == "baidu-search")
        );
        assert!(config.actions.iter().any(|action| {
            action.key == "current-page-request" && action.kind == WebActionKind::Request
        }));
    }

    #[test]
    fn matches_scope_and_url_patterns() {
        let action = WebActionConfig {
            key: "baidu-search".to_string(),
            name: "百度搜索".to_string(),
            kind: WebActionKind::Script,
            scope: "url:baidu".to_string(),
            match_patterns: vec!["https://www.baidu.com/*".to_string()],
            run_manually: true,
            script: "return true;".to_string(),
            request: WebActionRequestConfig::default(),
            params: BTreeMap::new(),
        };

        assert!(action_matches_context(
            &action,
            Some("url:baidu"),
            Some("https://www.baidu.com/")
        ));
        assert!(!action_matches_context(
            &action,
            Some("url:google"),
            Some("https://www.baidu.com/")
        ));
        assert!(!action_matches_context(
            &action,
            Some("url:baidu"),
            Some("https://example.com/")
        ));
    }

    #[test]
    fn resolves_request_action_url_with_params() {
        let mut params = BTreeMap::new();
        params.insert("id".to_string(), "42".to_string());

        let url = resolve_request_action_url(
            "/api/projects/${id}",
            &params,
            Some("https://example.com/workbench/index.html"),
        )
        .unwrap();

        assert_eq!(url, "https://example.com/api/projects/42");
    }

    #[test]
    fn resolves_action_params_from_context_and_overrides() {
        let mut action_params = BTreeMap::new();
        action_params.insert(
            "projectName".to_string(),
            WebActionParamConfig {
                label: "项目名称".to_string(),
                default: "fallback".to_string(),
                source: "project".to_string(),
                source_key: "name".to_string(),
            },
        );
        action_params.insert(
            "env".to_string(),
            WebActionParamConfig {
                label: "环境".to_string(),
                default: "uat1".to_string(),
                source: "debugProfile".to_string(),
                source_key: "env.APP_ENV".to_string(),
            },
        );
        let action = WebActionConfig {
            key: "test".to_string(),
            name: "测试".to_string(),
            kind: WebActionKind::Request,
            scope: String::new(),
            match_patterns: Vec::new(),
            run_manually: true,
            script: String::new(),
            request: WebActionRequestConfig::default(),
            params: action_params,
        };
        let mut request_params = BTreeMap::new();
        request_params.insert("env".to_string(), "pre".to_string());
        let mut context_params = BTreeMap::new();
        context_params.insert("project.name".to_string(), "智能营销".to_string());
        context_params.insert("debugProfile.env.APP_ENV".to_string(), "uat3".to_string());

        let resolved = resolve_action_params(
            &action,
            &WebActionRunRequest {
                action_key: "test".to_string(),
                target_id: None,
                scope: None,
                url: None,
                params: request_params,
                context_params,
            },
        );

        assert_eq!(
            resolved.get("projectName").map(String::as_str),
            Some("智能营销")
        );
        assert_eq!(resolved.get("env").map(String::as_str), Some("pre"));
    }

    #[test]
    fn rejects_empty_temporary_script() {
        let error = run_web_action_script(WebActionScriptRunRequest {
            target_id: "page-1".to_string(),
            script: "  ".to_string(),
            params: BTreeMap::new(),
        })
        .unwrap_err();

        assert!(error.to_string().contains("临时脚本不能为空"));
    }

    #[test]
    #[ignore = "starts a controlled Chrome instance"]
    fn cdp_smoke_opens_page_and_runs_page_info() {
        let target = open_web_action_target("https://www.baidu.com/").unwrap();
        let result = run_web_action(WebActionRunRequest {
            action_key: "page-info".to_string(),
            target_id: Some(target.id),
            scope: None,
            url: None,
            params: BTreeMap::new(),
            context_params: BTreeMap::new(),
        })
        .unwrap();

        assert!(result.success, "{:?}", result.error);
        assert!(result.url.starts_with("http"));
        assert!(result.result_text.contains("readyState"));
    }
}
