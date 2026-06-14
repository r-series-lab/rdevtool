use anyhow::{Context, Result, anyhow, bail};
use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;
use tungstenite::{Message, connect};

use crate::config::{RuntimeProfileConfig, default_config_dir};
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

#[derive(Debug, Clone, Deserialize, Serialize)]
struct WebActionConfig {
    key: String,
    name: String,
    #[serde(default)]
    scope: String,
    #[serde(default, rename = "match")]
    match_patterns: Vec<String>,
    #[serde(default = "default_true")]
    run_manually: bool,
    script: String,
    #[serde(default)]
    params: BTreeMap<String, WebActionParamConfig>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct WebActionParamConfig {
    #[serde(default)]
    label: String,
    #[serde(default)]
    default: String,
}

fn default_true() -> bool {
    true
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
    pub scope: String,
    pub match_patterns: Vec<String>,
    pub run_manually: bool,
    pub params: Vec<WebActionParamSummary>,
    pub script: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebActionParamSummary {
    pub key: String,
    pub label: String,
    pub default_value: String,
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
    let browser =
        effective_browser_for_navigation_entry(&config.browser, entry, runtime_profiles)?;
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
    let browser =
        effective_browser_for_navigation_entry(&config.browser, entry, runtime_profiles)?;
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
    let browser =
        effective_browser_for_navigation_entry(&config.browser, entry, runtime_profiles)?;
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
    let result = evaluate_action_script(ws_url, &action.script, &request.params)?;
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
    let browser =
        effective_browser_for_navigation_entry(&config.browser, entry, runtime_profiles)?;
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
    fs::write(&path, DEFAULT_WEB_ACTIONS_TEMPLATE)
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
    WebActionSummary {
        key: action.key,
        name: action.name,
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
            })
            .collect(),
        script: action.script,
    }
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
    for arg in browser.browser_args.iter().filter(|arg| !is_managed_browser_arg(arg)) {
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
    normalized.starts_with("--remote-debugging-port")
        || normalized.starts_with("--user-data-dir")
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
            let path = PathBuf::from(format!(
                "/Applications/{alias}.app/Contents/MacOS/{alias}"
            ));
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
    }

    #[test]
    fn matches_scope_and_url_patterns() {
        let action = WebActionConfig {
            key: "baidu-search".to_string(),
            name: "百度搜索".to_string(),
            scope: "url:baidu".to_string(),
            match_patterns: vec!["https://www.baidu.com/*".to_string()],
            run_manually: true,
            script: "return true;".to_string(),
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
        })
        .unwrap();

        assert!(result.success, "{:?}", result.error);
        assert!(result.url.starts_with("http"));
        assert!(result.result_text.contains("readyState"));
    }
}
