use anyhow::{Context, Result, bail};
use reqwest::Url;
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, LOCATION};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::thread;
use std::time::Duration;

#[derive(Debug, Deserialize)]
struct CrumbResponse {
    #[serde(rename = "crumbRequestField")]
    crumb_request_field: String,
    crumb: String,
}

#[derive(Debug)]
pub struct TriggerResult {
    pub status: u16,
    pub queue_url: Option<String>,
    pub build_url: Option<String>,
    pub state: TriggerState,
    pub detail: String,
}

#[derive(Debug)]
pub struct StatusResult {
    pub queue_url: Option<String>,
    pub build_url: Option<String>,
    pub state: TriggerState,
    pub detail: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TriggerState {
    Accepted,
    Queued,
    Running,
    Success,
    Failure,
    Cancelled,
}

impl TriggerState {
    pub fn label(self) -> &'static str {
        match self {
            TriggerState::Accepted => "已触发",
            TriggerState::Queued => "排队中",
            TriggerState::Running => "构建中",
            TriggerState::Success => "构建成功",
            TriggerState::Failure => "构建失败",
            TriggerState::Cancelled => "已取消",
        }
    }

    pub fn is_positive(self) -> bool {
        matches!(
            self,
            TriggerState::Accepted
                | TriggerState::Queued
                | TriggerState::Running
                | TriggerState::Success
        )
    }
}

#[derive(Debug, Deserialize)]
struct QueueItemResponse {
    #[serde(default)]
    cancelled: bool,
    why: Option<String>,
    executable: Option<QueueExecutable>,
}

#[derive(Debug, Deserialize)]
struct QueueExecutable {
    number: u64,
    url: String,
}

#[derive(Debug, Deserialize)]
struct BuildResponse {
    #[serde(default)]
    building: bool,
    number: Option<u64>,
    result: Option<String>,
    url: Option<String>,
}

pub fn trigger_build(
    base_url: &str,
    username: &str,
    password: &str,
    trigger_url: &str,
    params: &BTreeMap<String, String>,
) -> Result<TriggerResult> {
    let client = build_client()?;
    trigger_build_with_client(&client, base_url, username, password, trigger_url, params)
}

pub fn refresh_status(
    base_url: &str,
    username: &str,
    password: &str,
    queue_url: Option<&str>,
    build_url: Option<&str>,
) -> Result<StatusResult> {
    let client = build_client()?;
    refresh_status_with_client(&client, base_url, username, password, queue_url, build_url)
}

fn build_client() -> Result<Client> {
    Client::builder()
        .cookie_store(true)
        .timeout(Duration::from_secs(20))
        .build()
        .context("failed to build Jenkins HTTP client")
}

fn trigger_build_with_client(
    client: &Client,
    base_url: &str,
    username: &str,
    password: &str,
    trigger_url: &str,
    params: &BTreeMap<String, String>,
) -> Result<TriggerResult> {
    let crumb = fetch_crumb(client, base_url, username, password)?;
    let mut headers = HeaderMap::new();
    let crumb_name = HeaderName::from_bytes(crumb.crumb_request_field.as_bytes())
        .with_context(|| format!("invalid crumb header: {}", crumb.crumb_request_field))?;
    let crumb_value =
        HeaderValue::from_str(&crumb.crumb).context("invalid crumb header value from Jenkins")?;
    headers.insert(crumb_name, crumb_value);

    let response = client
        .post(trigger_url)
        .basic_auth(username, Some(password))
        .headers(headers)
        .form(params)
        .send()
        .with_context(|| format!("failed to trigger Jenkins build: {trigger_url}"))?;

    let status = response.status().as_u16();
    let queue_url = response
        .headers()
        .get(LOCATION)
        .and_then(|value| value.to_str().ok())
        .map(|value| normalize_jenkins_url(base_url, value));

    if !(200..=399).contains(&status) {
        bail!("jenkins returned unexpected status: {status}");
    }

    let (state, detail, build_url) = if let Some(queue_url_ref) = queue_url.as_ref() {
        match inspect_queue_and_build(client, base_url, username, password, queue_url_ref) {
            Ok((state, detail, build_url)) => (state, detail, build_url),
            Err(error) => (
                TriggerState::Accepted,
                format!("已触发，但暂时无法读取队列状态：{error}"),
                None,
            ),
        }
    } else {
        (
            TriggerState::Accepted,
            "Jenkins 未返回队列地址".to_string(),
            None,
        )
    };

    Ok(TriggerResult {
        status,
        queue_url,
        build_url,
        state,
        detail,
    })
}

fn refresh_status_with_client(
    client: &Client,
    base_url: &str,
    username: &str,
    password: &str,
    queue_url: Option<&str>,
    build_url: Option<&str>,
) -> Result<StatusResult> {
    if let Some(build_url) = build_url {
        let normalized = normalize_jenkins_url(base_url, build_url);
        let (state, detail, build_url) =
            inspect_build(client, base_url, username, password, &normalized, 0)?;
        return Ok(StatusResult {
            queue_url: queue_url.map(ToString::to_string),
            build_url,
            state,
            detail,
        });
    }

    if let Some(queue_url) = queue_url {
        let normalized = normalize_jenkins_url(base_url, queue_url);
        let (state, detail, build_url) =
            inspect_queue_and_build(client, base_url, username, password, &normalized)?;
        return Ok(StatusResult {
            queue_url: Some(normalized),
            build_url,
            state,
            detail,
        });
    }

    bail!("没有可刷新的 Jenkins 队列或构建地址")
}

fn fetch_crumb(
    client: &Client,
    base_url: &str,
    username: &str,
    password: &str,
) -> Result<CrumbResponse> {
    let url = format!("{}/crumbIssuer/api/json", base_url.trim_end_matches('/'));
    let response = client
        .get(&url)
        .basic_auth(username, Some(password))
        .send()
        .with_context(|| format!("failed to request Jenkins crumb: {url}"))?;

    if !response.status().is_success() {
        bail!(
            "failed to request Jenkins crumb: HTTP {}",
            response.status()
        );
    }

    response
        .json::<CrumbResponse>()
        .context("failed to parse Jenkins crumb response")
}

fn inspect_queue_and_build(
    client: &Client,
    base_url: &str,
    username: &str,
    password: &str,
    queue_url: &str,
) -> Result<(TriggerState, String, Option<String>)> {
    let queue_api = api_json_url(queue_url);
    let mut last_why = String::new();

    for _ in 0..8 {
        let queue = client
            .get(&queue_api)
            .basic_auth(username, Some(password))
            .send()
            .with_context(|| format!("failed to inspect Jenkins queue item: {queue_api}"))?
            .json::<QueueItemResponse>()
            .context("failed to parse Jenkins queue item response")?;

        if queue.cancelled {
            return Ok((
                TriggerState::Cancelled,
                queue
                    .why
                    .unwrap_or_else(|| "队列任务已被 Jenkins 取消".to_string()),
                None,
            ));
        }

        if let Some(executable) = queue.executable {
            let build_url = normalize_jenkins_url(base_url, &executable.url);
            return inspect_build(
                client,
                base_url,
                username,
                password,
                &build_url,
                executable.number,
            );
        }

        if let Some(why) = queue.why {
            last_why = why;
        }

        thread::sleep(Duration::from_millis(1000));
    }

    let detail = if last_why.is_empty() {
        "已进入 Jenkins 队列，等待执行".to_string()
    } else {
        last_why
    };
    Ok((TriggerState::Queued, detail, None))
}

fn inspect_build(
    client: &Client,
    base_url: &str,
    username: &str,
    password: &str,
    build_url: &str,
    build_number: u64,
) -> Result<(TriggerState, String, Option<String>)> {
    let build_api = api_json_url(build_url);
    let build = client
        .get(&build_api)
        .basic_auth(username, Some(password))
        .send()
        .with_context(|| format!("failed to inspect Jenkins build: {build_api}"))?
        .json::<BuildResponse>()
        .context("failed to parse Jenkins build response")?;
    let resolved_build_number = if build_number == 0 {
        build.number.or_else(|| extract_build_number(build_url))
    } else {
        Some(build_number)
    };

    if build.building {
        let detail = resolved_build_number
            .map(|number| format!("构建已开始，编号 #{number}"))
            .unwrap_or_else(|| "构建已开始".to_string());
        return Ok((
            TriggerState::Running,
            detail,
            build
                .url
                .map(|url| normalize_jenkins_url(base_url, &url))
                .or_else(|| Some(build_url.to_string())),
        ));
    }

    let state = match build.result.as_deref() {
        Some("SUCCESS") => TriggerState::Success,
        Some("FAILURE" | "ABORTED" | "UNSTABLE" | "NOT_BUILT") => TriggerState::Failure,
        _ => TriggerState::Running,
    };

    let detail = match build.result.as_deref() {
        Some(result) => resolved_build_number
            .map(|number| format!("构建 #{number} 当前结果：{result}"))
            .unwrap_or_else(|| format!("构建当前结果：{result}")),
        None => resolved_build_number
            .map(|number| format!("构建 #{number} 已创建，等待状态回写"))
            .unwrap_or_else(|| "构建已创建，等待状态回写".to_string()),
    };

    Ok((
        state,
        detail,
        build
            .url
            .map(|url| normalize_jenkins_url(base_url, &url))
            .or_else(|| Some(build_url.to_string())),
    ))
}

fn api_json_url(base: &str) -> String {
    format!("{}/api/json", base.trim_end_matches('/'))
}

fn extract_build_number(build_url: &str) -> Option<u64> {
    if let Ok(parsed) = Url::parse(build_url) {
        return parsed
            .path_segments()?
            .rev()
            .find_map(|segment| segment.parse::<u64>().ok());
    }

    build_url
        .trim_end_matches('/')
        .rsplit('/')
        .find_map(|segment| segment.parse::<u64>().ok())
}

fn normalize_jenkins_url(base_url: &str, raw_url: &str) -> String {
    let Ok(base) = Url::parse(base_url) else {
        return raw_url.to_string();
    };

    if let Ok(mut parsed) = Url::parse(raw_url) {
        if matches!(
            parsed.host_str(),
            Some("0.0.0.0") | Some("127.0.0.1") | Some("localhost")
        ) {
            let _ = parsed.set_scheme(base.scheme());
            let _ = parsed.set_host(base.host_str());
            let _ = parsed.set_port(base.port());
        }
        return parsed.to_string();
    }

    base.join(raw_url.trim_start_matches('/'))
        .map(|url| url.to_string())
        .unwrap_or_else(|_| raw_url.to_string())
}
