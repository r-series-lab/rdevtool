use anyhow::{Context, Result, bail};
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, LOCATION};
use reqwest::{StatusCode, Url};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::thread;
use std::time::Duration;

const CRUMB_MAX_ATTEMPTS: usize = 3;
const CRUMB_RETRY_BASE_DELAY: Duration = Duration::from_millis(250);

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
    pub commit: Option<String>,
}

#[derive(Debug)]
pub struct JenkinsCrumbError {
    pub retryable: bool,
    pub attempts: usize,
    pub side_effect_occurred: bool,
    message: String,
}

impl std::fmt::Display for JenkinsCrumbError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "{} (retryable={}, attempts={}, sideEffectOccurred={})",
            self.message, self.retryable, self.attempts, self.side_effect_occurred
        )
    }
}

impl std::error::Error for JenkinsCrumbError {}

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
    #[serde(default)]
    actions: Vec<BuildActionResponse>,
}

#[derive(Debug, Deserialize)]
struct BuildActionResponse {
    #[serde(rename = "lastBuiltRevision")]
    last_built_revision: Option<BuildRevisionResponse>,
}

#[derive(Debug, Deserialize)]
struct BuildRevisionResponse {
    #[serde(rename = "SHA1")]
    sha1: Option<String>,
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
            Ok((state, detail, build_url, _commit)) => (state, detail, build_url),
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
        let (state, detail, build_url, commit) =
            inspect_build(client, base_url, username, password, &normalized, 0)?;
        return Ok(StatusResult {
            queue_url: queue_url.map(ToString::to_string),
            build_url,
            state,
            detail,
            commit,
        });
    }

    if let Some(queue_url) = queue_url {
        let normalized = normalize_jenkins_url(base_url, queue_url);
        let (state, detail, build_url, commit) =
            inspect_queue_and_build(client, base_url, username, password, &normalized)?;
        return Ok(StatusResult {
            queue_url: Some(normalized),
            build_url,
            state,
            detail,
            commit,
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
    fetch_crumb_with_policy(
        client,
        base_url,
        username,
        password,
        CRUMB_MAX_ATTEMPTS,
        CRUMB_RETRY_BASE_DELAY,
    )
}

fn fetch_crumb_with_policy(
    client: &Client,
    base_url: &str,
    username: &str,
    password: &str,
    max_attempts: usize,
    base_delay: Duration,
) -> Result<CrumbResponse> {
    let url = format!("{}/crumbIssuer/api/json", base_url.trim_end_matches('/'));
    let max_attempts = max_attempts.max(1);
    for attempt in 1..=max_attempts {
        let response = client.get(&url).basic_auth(username, Some(password)).send();
        let response = match response {
            Ok(response) => response,
            Err(error) => {
                let retryable = error.is_timeout();
                if retryable && attempt < max_attempts {
                    thread::sleep(crumb_retry_delay(base_delay, attempt));
                    continue;
                }
                return Err(anyhow::Error::new(JenkinsCrumbError {
                    retryable,
                    attempts: attempt,
                    side_effect_occurred: false,
                    message: format!("failed to request Jenkins crumb: {url}: {error}"),
                }));
            }
        };

        let status = response.status();
        if !status.is_success() {
            let retryable = is_retryable_crumb_status(status);
            if retryable && attempt < max_attempts {
                thread::sleep(crumb_retry_delay(base_delay, attempt));
                continue;
            }
            return Err(anyhow::Error::new(JenkinsCrumbError {
                retryable,
                attempts: attempt,
                side_effect_occurred: false,
                message: format!("failed to request Jenkins crumb: HTTP {status}"),
            }));
        }

        return response.json::<CrumbResponse>().map_err(|error| {
            anyhow::Error::new(JenkinsCrumbError {
                retryable: false,
                attempts: attempt,
                side_effect_occurred: false,
                message: format!("failed to parse Jenkins crumb response: {error}"),
            })
        });
    }

    unreachable!("crumb request loop always returns")
}

fn is_retryable_crumb_status(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::BAD_GATEWAY | StatusCode::SERVICE_UNAVAILABLE | StatusCode::GATEWAY_TIMEOUT
    )
}

fn crumb_retry_delay(base_delay: Duration, completed_attempt: usize) -> Duration {
    let exponent = completed_attempt.saturating_sub(1).min(16) as u32;
    base_delay.saturating_mul(2u32.saturating_pow(exponent))
}

fn inspect_queue_and_build(
    client: &Client,
    base_url: &str,
    username: &str,
    password: &str,
    queue_url: &str,
) -> Result<(TriggerState, String, Option<String>, Option<String>)> {
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
    Ok((TriggerState::Queued, detail, None, None))
}

fn inspect_build(
    client: &Client,
    base_url: &str,
    username: &str,
    password: &str,
    build_url: &str,
    build_number: u64,
) -> Result<(TriggerState, String, Option<String>, Option<String>)> {
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
    let commit = build.actions.iter().find_map(|action| {
        action
            .last_built_revision
            .as_ref()
            .and_then(|revision| revision.sha1.as_ref())
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    });

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
            commit,
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
        commit,
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

#[cfg(test)]
mod tests {
    use super::{
        JenkinsCrumbError, crumb_retry_delay, fetch_crumb_with_policy, is_retryable_crumb_status,
        trigger_build_with_client,
    };
    use reqwest::{StatusCode, blocking::Client};
    use std::collections::BTreeMap;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    use std::thread;
    use std::time::Duration;

    fn spawn_server(
        responses: Vec<(u16, &'static str, Option<&'static str>)>,
    ) -> (String, Arc<AtomicUsize>, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let address = listener.local_addr().expect("test server address");
        let requests = Arc::new(AtomicUsize::new(0));
        let request_count = Arc::clone(&requests);
        let handle = thread::spawn(move || {
            for (status, body, location) in responses {
                let (mut stream, _) = listener.accept().expect("accept test request");
                let mut buffer = [0u8; 4096];
                let _ = stream.read(&mut buffer);
                request_count.fetch_add(1, Ordering::SeqCst);
                let location = location
                    .map(|value| format!("Location: {value}\r\n"))
                    .unwrap_or_default();
                let response = format!(
                    "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{location}Connection: close\r\n\r\n{body}",
                    body.len()
                );
                stream
                    .write_all(response.as_bytes())
                    .expect("write test response");
            }
        });
        (format!("http://{address}"), requests, handle)
    }

    #[test]
    fn retries_transient_crumb_failures_three_total_attempts() {
        let body = r#"{"crumbRequestField":"Jenkins-Crumb","crumb":"ok"}"#;
        let (base_url, requests, handle) =
            spawn_server(vec![(502, "", None), (503, "", None), (200, body, None)]);
        let client = Client::builder()
            .timeout(Duration::from_secs(1))
            .build()
            .expect("build client");
        let crumb =
            fetch_crumb_with_policy(&client, &base_url, "user", "password", 3, Duration::ZERO)
                .expect("third crumb request succeeds");
        handle.join().expect("join test server");

        assert_eq!(crumb.crumb, "ok");
        assert_eq!(requests.load(Ordering::SeqCst), 3);
    }

    #[test]
    fn reports_non_retryable_crumb_failure_without_side_effects() {
        let (base_url, requests, handle) = spawn_server(vec![(401, "", None)]);
        let client = Client::builder().build().expect("build client");
        let error =
            fetch_crumb_with_policy(&client, &base_url, "user", "password", 3, Duration::ZERO)
                .expect_err("unauthorized crumb must fail");
        handle.join().expect("join test server");
        let error = error
            .downcast_ref::<JenkinsCrumbError>()
            .expect("typed crumb error");

        assert!(!error.retryable);
        assert_eq!(error.attempts, 1);
        assert!(!error.side_effect_occurred);
        assert_eq!(requests.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn never_retries_an_ambiguous_trigger_post() {
        let crumb = r#"{"crumbRequestField":"Jenkins-Crumb","crumb":"ok"}"#;
        let (base_url, requests, handle) = spawn_server(vec![(200, crumb, None), (502, "", None)]);
        let client = Client::builder().build().expect("build client");
        let result = trigger_build_with_client(
            &client,
            &base_url,
            "user",
            "password",
            &format!("{base_url}/job/demo/buildWithParameters"),
            &BTreeMap::new(),
        );
        handle.join().expect("join test server");

        assert!(result.is_err());
        assert_eq!(requests.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn crumb_retry_policy_is_bounded_and_exponential() {
        assert!(is_retryable_crumb_status(StatusCode::BAD_GATEWAY));
        assert!(!is_retryable_crumb_status(StatusCode::UNAUTHORIZED));
        assert_eq!(
            crumb_retry_delay(Duration::from_millis(250), 1),
            Duration::from_millis(250)
        );
        assert_eq!(
            crumb_retry_delay(Duration::from_millis(250), 2),
            Duration::from_millis(500)
        );
    }
}
