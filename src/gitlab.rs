use crate::git;
use anyhow::{Context, Result, anyhow, bail};
use chrono::{DateTime, Local};
use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
use reqwest::Url;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::error::Error;
use std::fmt;
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct ApiMergeResult {
    pub source_branch: String,
    pub target_branch: String,
    pub merge_commit_sha: String,
    pub created_target_branch: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MergeFailureKind {
    Conflict,
    Unauthorized,
    Forbidden,
    PipelineBlocked,
    DiscussionBlocked,
    ApprovalBlocked,
    Blocked,
}

impl MergeFailureKind {
    pub fn status_key(self) -> &'static str {
        match self {
            Self::Conflict => "merge_conflict",
            Self::Unauthorized => "gitlab_auth_failed",
            Self::Forbidden => "gitlab_forbidden",
            Self::PipelineBlocked => "merge_pipeline_blocked",
            Self::DiscussionBlocked => "merge_discussion_blocked",
            Self::ApprovalBlocked => "merge_approval_blocked",
            Self::Blocked => "merge_blocked",
        }
    }

    pub fn summary(self) -> &'static str {
        match self {
            Self::Conflict => "存在合并冲突",
            Self::Unauthorized => "GitLab 身份验证失败",
            Self::Forbidden => "GitLab 权限不足",
            Self::PipelineBlocked => "流水线阻止合并",
            Self::DiscussionBlocked => "讨论未解决",
            Self::ApprovalBlocked => "审批条件未满足",
            Self::Blocked => "GitLab 暂不可合并",
        }
    }
}

#[derive(Debug)]
pub struct MergeFailure {
    pub kind: MergeFailureKind,
    detail: String,
}

impl MergeFailure {
    pub(crate) fn new(kind: MergeFailureKind, detail: impl Into<String>) -> Self {
        Self {
            kind,
            detail: detail.into(),
        }
    }
}

impl fmt::Display for MergeFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.detail)
    }
}

impl Error for MergeFailure {}

fn merge_failure_kind_from_status(status: &str) -> MergeFailureKind {
    match status.trim().to_ascii_lowercase().as_str() {
        "cannot_be_merged" | "conflict" | "has_conflicts" => MergeFailureKind::Conflict,
        "ci_must_pass" | "ci_still_running" | "pipeline_blocked" => {
            MergeFailureKind::PipelineBlocked
        }
        "discussions_not_resolved" => MergeFailureKind::DiscussionBlocked,
        "not_approved" | "approval_required" => MergeFailureKind::ApprovalBlocked,
        _ => MergeFailureKind::Blocked,
    }
}

#[derive(Debug, Deserialize)]
struct MergeRequest {
    iid: u64,
    #[serde(default)]
    web_url: Option<String>,
    #[serde(default)]
    merge_commit_sha: Option<String>,
    #[serde(default)]
    sha: Option<String>,
    #[serde(default)]
    state: Option<String>,
    #[serde(default)]
    detailed_merge_status: Option<String>,
    #[serde(default)]
    merge_status: Option<String>,
    #[serde(default)]
    has_conflicts: bool,
}

#[derive(Debug, Deserialize)]
struct CompareResponse {
    #[serde(default)]
    commits: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct BranchResponse {
    #[serde(default)]
    name: String,
    commit: BranchCommit,
}

#[derive(Debug, Deserialize)]
struct BranchCommit {
    id: String,
    #[serde(default)]
    short_id: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    committed_date: Option<String>,
}

#[derive(Debug, Serialize)]
struct CreateBranchPayload<'a> {
    branch: &'a str,
    r#ref: &'a str,
}

#[derive(Debug, Serialize)]
struct CreateMergeRequestPayload<'a> {
    source_branch: &'a str,
    target_branch: &'a str,
    title: String,
    remove_source_branch: bool,
    squash: bool,
}

#[derive(Debug, Serialize)]
struct AcceptMergeRequestPayload {
    merge_when_pipeline_succeeds: bool,
    should_remove_source_branch: bool,
    squash: bool,
}

pub fn merge_branches_via_api(
    project_git_url: &str,
    api_base_override: Option<&str>,
    token: &str,
    source_branch: &str,
    target_branch: &str,
) -> Result<ApiMergeResult> {
    let source_branch = source_branch.trim();
    let target_branch = target_branch.trim();
    if source_branch.is_empty() || target_branch.is_empty() {
        bail!("源分支和目标分支不能为空");
    }
    if source_branch == target_branch {
        bail!("源分支和目标分支不能相同");
    }

    let token = token.trim();
    if token.is_empty() {
        bail!("GitLab token 为空");
    }

    let api_base = match api_base_override
        .map(str::trim)
        .filter(|raw| !raw.is_empty())
    {
        Some(raw) => raw.trim_end_matches('/').to_string(),
        None => derive_gitlab_api_base(project_git_url)?,
    };
    let project_path = project_path_from_git_url(project_git_url)?;
    let encoded_project = encode_project_path(&project_path);

    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .context("failed to build GitLab HTTP client")?;

    let source_head =
        find_branch_head_sha(&client, &api_base, &encoded_project, token, source_branch)?
            .ok_or_else(|| anyhow!("源分支不存在：{source_branch}"))?;
    let target_head =
        find_branch_head_sha(&client, &api_base, &encoded_project, token, target_branch)?;
    if target_head.is_none() {
        let created_head = create_branch_from_ref(
            &client,
            &api_base,
            &encoded_project,
            token,
            target_branch,
            source_branch,
        )?;
        let merge_commit_sha = if created_head.trim().is_empty() {
            source_head
        } else {
            created_head
        };
        return Ok(ApiMergeResult {
            source_branch: source_branch.to_string(),
            target_branch: target_branch.to_string(),
            merge_commit_sha,
            created_target_branch: true,
            detail: format!(
                "目标分支 {target_branch} 不存在，已从源分支 {source_branch} 创建并推送"
            ),
        });
    }

    if !has_unmerged_commits(
        &client,
        &api_base,
        &encoded_project,
        token,
        source_branch,
        target_branch,
    )? {
        let target_head =
            get_branch_head_sha(&client, &api_base, &encoded_project, token, target_branch)?;
        return Ok(ApiMergeResult {
            source_branch: source_branch.to_string(),
            target_branch: target_branch.to_string(),
            merge_commit_sha: target_head,
            created_target_branch: false,
            detail: format!(
                "源分支 {source_branch} 的改动已包含在目标分支 {target_branch}，无需重复合并"
            ),
        });
    }

    let existing = find_open_merge_request(
        &client,
        &api_base,
        &encoded_project,
        token,
        source_branch,
        target_branch,
    )?;

    let mut detail_lines = Vec::new();
    let mr = if let Some(mr) = existing {
        detail_lines.push(format!("复用已存在 MR !{}", mr.iid));
        mr
    } else {
        let created = create_merge_request(
            &client,
            &api_base,
            &encoded_project,
            token,
            source_branch,
            target_branch,
        )?;
        detail_lines.push(format!("创建 MR !{}", created.iid));
        created
    };

    let merged = accept_merge_request(&client, &api_base, &encoded_project, token, mr.iid)?;
    let merge_commit_sha = merged
        .merge_commit_sha
        .clone()
        .or(merged.sha.clone())
        .or(mr.merge_commit_sha.clone())
        .unwrap_or_else(|| "<missing-merge-commit-sha>".to_string());

    detail_lines.push(format!("已通过 GitLab API 合并到 {target_branch}"));
    if let Some(status) = merged.detailed_merge_status.as_ref() {
        detail_lines.push(format!("MR 状态: {status}"));
    } else if let Some(state) = merged.state.as_ref() {
        detail_lines.push(format!("MR 状态: {state}"));
    }
    if let Some(url) = merged.web_url.as_ref().or(mr.web_url.as_ref()) {
        detail_lines.push(format!("MR 链接: {url}"));
    }

    Ok(ApiMergeResult {
        source_branch: source_branch.to_string(),
        target_branch: target_branch.to_string(),
        merge_commit_sha,
        created_target_branch: false,
        detail: detail_lines.join("\n"),
    })
}

pub fn branch_commit_summary(
    project_git_url: &str,
    api_base_override: Option<&str>,
    token: &str,
    branch: &str,
) -> Result<Option<git::BranchCommitSummary>> {
    let branch = branch.trim();
    if branch.is_empty() {
        return Ok(None);
    }

    let token = token.trim();
    if token.is_empty() {
        bail!("GitLab token 为空");
    }

    let api_base = match api_base_override
        .map(str::trim)
        .filter(|raw| !raw.is_empty())
    {
        Some(raw) => raw.trim_end_matches('/').to_string(),
        None => derive_gitlab_api_base(project_git_url)?,
    };
    let project_path = project_path_from_git_url(project_git_url)?;
    let encoded_project = encode_project_path(&project_path);
    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .context("failed to build GitLab HTTP client")?;

    let response = find_branch_response(&client, &api_base, &encoded_project, token, branch)?;
    Ok(response.map(|item| branch_commit_summary_from_response(&item)))
}

pub fn available_branch_activity(
    project_git_url: &str,
    api_base_override: Option<&str>,
    token: &str,
) -> Result<Vec<git::BranchActivity>> {
    available_branch_activity_with_timeout(
        project_git_url,
        api_base_override,
        token,
        Duration::from_secs(20),
    )
}

pub fn available_branch_activity_with_timeout(
    project_git_url: &str,
    api_base_override: Option<&str>,
    token: &str,
    total_timeout: Duration,
) -> Result<Vec<git::BranchActivity>> {
    let started = Instant::now();
    let token = token.trim();
    if token.is_empty() {
        bail!("GitLab token 为空");
    }

    let api_base = match api_base_override
        .map(str::trim)
        .filter(|raw| !raw.is_empty())
    {
        Some(raw) => raw.trim_end_matches('/').to_string(),
        None => derive_gitlab_api_base(project_git_url)?,
    };
    let project_path = project_path_from_git_url(project_git_url)?;
    let encoded_project = encode_project_path(&project_path);
    let client = Client::builder()
        .connect_timeout(total_timeout.min(Duration::from_secs(4)))
        .build()
        .context("failed to build GitLab HTTP client")?;

    let url = format!("{api_base}/projects/{encoded_project}/repository/branches");
    let mut page = 1;
    let mut branches = Vec::new();

    loop {
        let remaining = total_timeout.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            bail!(
                "GitLab branch listing timed out after {}ms",
                total_timeout.as_millis()
            );
        }
        let page_value = page.to_string();
        let response = client
            .get(&url)
            .header("PRIVATE-TOKEN", token)
            .query(&[("per_page", "100"), ("page", page_value.as_str())])
            .timeout(remaining)
            .send()
            .with_context(|| format!("failed to query GitLab branches: {url}"))?;

        let http_status = response.status();
        let next_page = response
            .headers()
            .get("x-next-page")
            .and_then(|value| value.to_str().ok())
            .map(str::trim)
            .unwrap_or_default()
            .to_string();
        let body = response
            .text()
            .context("failed to read GitLab branch list response")?;
        if !http_status.is_success() {
            bail!("读取分支列表失败: HTTP {http_status} {body}");
        }

        let parsed = serde_json::from_str::<Vec<BranchResponse>>(&body)
            .with_context(|| format!("failed to parse GitLab branch list response: {body}"))?;
        for item in parsed {
            let name = item.name.trim();
            if name.is_empty() || name == "HEAD" || name.starts_with("yc-merge-") {
                continue;
            }
            branches.push(branch_activity_from_response(item));
        }

        if next_page.is_empty() {
            break;
        }

        page = next_page.parse::<u32>().unwrap_or(page + 1);
    }

    branches.sort_by(|a, b| {
        b.updated_ts
            .cmp(&a.updated_ts)
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(branches)
}

fn find_open_merge_request(
    client: &Client,
    api_base: &str,
    encoded_project: &str,
    token: &str,
    source_branch: &str,
    target_branch: &str,
) -> Result<Option<MergeRequest>> {
    let url = format!("{api_base}/projects/{encoded_project}/merge_requests");
    let response = client
        .get(&url)
        .header("PRIVATE-TOKEN", token)
        .query(&[
            ("state", "opened"),
            ("source_branch", source_branch),
            ("target_branch", target_branch),
            ("per_page", "1"),
        ])
        .send()
        .with_context(|| format!("failed to query merge requests: {url}"))?;

    let status = response.status();
    let body = response
        .text()
        .context("failed to read GitLab merge request list response")?;
    if !status.is_success() {
        bail!("查询 MR 失败: HTTP {status} {body}");
    }

    let mut list: Vec<MergeRequest> = serde_json::from_str(&body)
        .with_context(|| format!("failed to parse GitLab merge request list: {body}"))?;
    Ok(list.drain(..).next())
}

fn create_merge_request(
    client: &Client,
    api_base: &str,
    encoded_project: &str,
    token: &str,
    source_branch: &str,
    target_branch: &str,
) -> Result<MergeRequest> {
    let url = format!("{api_base}/projects/{encoded_project}/merge_requests");
    let payload = CreateMergeRequestPayload {
        source_branch,
        target_branch,
        title: format!("Auto merge {source_branch} -> {target_branch}"),
        remove_source_branch: false,
        squash: false,
    };
    let response = client
        .post(&url)
        .header("PRIVATE-TOKEN", token)
        .json(&payload)
        .send()
        .with_context(|| format!("failed to create merge request: {url}"))?;

    let status = response.status();
    let body = response
        .text()
        .context("failed to read GitLab create merge request response")?;
    if !status.is_success() {
        bail!("创建 MR 失败: HTTP {status} {body}");
    }

    serde_json::from_str::<MergeRequest>(&body)
        .with_context(|| format!("failed to parse GitLab create merge request response: {body}"))
}

fn accept_merge_request(
    client: &Client,
    api_base: &str,
    encoded_project: &str,
    token: &str,
    iid: u64,
) -> Result<MergeRequest> {
    let url = format!("{api_base}/projects/{encoded_project}/merge_requests/{iid}/merge");
    let payload = AcceptMergeRequestPayload {
        merge_when_pipeline_succeeds: false,
        should_remove_source_branch: false,
        squash: false,
    };

    for attempt in 0..8 {
        let response = client
            .put(&url)
            .header("PRIVATE-TOKEN", token)
            .json(&payload)
            .send()
            .with_context(|| format!("failed to accept merge request: {url}"))?;

        let http_status = response.status();
        let body = response
            .text()
            .context("failed to read GitLab accept merge request response")?;

        if http_status.is_success() {
            let parsed = serde_json::from_str::<MergeRequest>(&body).with_context(|| {
                format!("failed to parse GitLab accept merge request response: {body}")
            })?;
            if parsed
                .state
                .as_deref()
                .map(|state| state.eq_ignore_ascii_case("merged"))
                == Some(true)
            {
                return Ok(parsed);
            }
            if let Some(status) = parsed.detailed_merge_status.as_deref() {
                if status.eq_ignore_ascii_case("merged") {
                    return Ok(parsed);
                }
            }
        } else if matches!(http_status.as_u16(), 405 | 422) {
            let snapshot = get_merge_request(client, api_base, encoded_project, token, iid)?;
            if snapshot
                .state
                .as_deref()
                .map(|state| state.eq_ignore_ascii_case("merged"))
                == Some(true)
            {
                return Ok(snapshot);
            }

            let merge_status = snapshot
                .detailed_merge_status
                .as_deref()
                .or(snapshot.merge_status.as_deref())
                .unwrap_or("unknown");
            let mr_hint = snapshot
                .web_url
                .as_deref()
                .map(|url| format!("（MR !{}: {}）", iid, url))
                .unwrap_or_else(|| format!("（MR !{}）", iid));
            if snapshot.has_conflicts || merge_status.eq_ignore_ascii_case("cannot_be_merged") {
                return Err(MergeFailure::new(
                    MergeFailureKind::Conflict,
                    format!("合并 MR 失败: {merge_status}（存在合并冲突）{mr_hint}"),
                )
                .into());
            }

            if attempt < 7 {
                thread::sleep(Duration::from_millis(800));
                continue;
            }

            return Err(MergeFailure::new(
                merge_failure_kind_from_status(merge_status),
                format!("合并 MR 失败: {merge_status}{mr_hint}"),
            )
            .into());
        } else {
            let kind = match http_status.as_u16() {
                401 => Some(MergeFailureKind::Unauthorized),
                403 => Some(MergeFailureKind::Forbidden),
                _ => None,
            };
            if let Some(kind) = kind {
                return Err(MergeFailure::new(
                    kind,
                    format!("合并 MR 失败: HTTP {http_status} {body}（MR !{iid}）"),
                )
                .into());
            }
            bail!("合并 MR 失败: HTTP {http_status} {body}");
        }

        if attempt < 7 {
            thread::sleep(Duration::from_millis(500));
            continue;
        }
    }

    bail!("合并 MR 超时：GitLab 长时间未返回 merged 状态")
}

fn get_merge_request(
    client: &Client,
    api_base: &str,
    encoded_project: &str,
    token: &str,
    iid: u64,
) -> Result<MergeRequest> {
    let url = format!("{api_base}/projects/{encoded_project}/merge_requests/{iid}");
    let response = client
        .get(&url)
        .header("PRIVATE-TOKEN", token)
        .send()
        .with_context(|| format!("failed to fetch merge request: {url}"))?;

    let http_status = response.status();
    let body = response
        .text()
        .context("failed to read GitLab merge request detail response")?;
    if !http_status.is_success() {
        bail!("读取 MR 详情失败: HTTP {http_status} {body}");
    }

    serde_json::from_str::<MergeRequest>(&body)
        .with_context(|| format!("failed to parse GitLab merge request detail response: {body}"))
}

fn derive_gitlab_api_base(project_git_url: &str) -> Result<String> {
    let parsed = Url::parse(project_git_url)
        .with_context(|| format!("invalid git url: {project_git_url}"))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| anyhow!("missing host in git url: {project_git_url}"))?;
    let scheme = parsed.scheme();
    let port = parsed.port().map(|p| format!(":{p}")).unwrap_or_default();

    let first_segment = parsed
        .path_segments()
        .and_then(|mut segments| segments.next().map(str::trim).map(str::to_string))
        .filter(|segment| !segment.is_empty())
        .unwrap_or_else(|| "gitlab".to_string());

    Ok(format!("{scheme}://{host}{port}/{first_segment}/api/v4"))
}

fn has_unmerged_commits(
    client: &Client,
    api_base: &str,
    encoded_project: &str,
    token: &str,
    source_branch: &str,
    target_branch: &str,
) -> Result<bool> {
    let source = utf8_percent_encode(source_branch, NON_ALPHANUMERIC).to_string();
    let target = utf8_percent_encode(target_branch, NON_ALPHANUMERIC).to_string();
    let url = format!(
        "{api_base}/projects/{encoded_project}/repository/compare?from={target}&to={source}"
    );
    let response = client
        .get(&url)
        .header("PRIVATE-TOKEN", token)
        .send()
        .with_context(|| format!("failed to compare branches: {url}"))?;

    let http_status = response.status();
    let body = response
        .text()
        .context("failed to read GitLab compare response")?;
    if !http_status.is_success() {
        bail!("比较分支失败: HTTP {http_status} {body}");
    }

    let compare = serde_json::from_str::<CompareResponse>(&body)
        .with_context(|| format!("failed to parse compare response: {body}"))?;
    Ok(!compare.commits.is_empty())
}

fn branch_commit_summary_from_response(response: &BranchResponse) -> git::BranchCommitSummary {
    let subject = response
        .commit
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            response
                .commit
                .message
                .as_deref()
                .and_then(|value| value.lines().next())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
        .unwrap_or_else(|| response.commit.id.chars().take(8).collect());
    let short_hash = response
        .commit
        .short_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| response.commit.id.chars().take(8).collect());
    let committed_at = normalize_gitlab_commit_date(
        response
            .commit
            .committed_date
            .as_deref()
            .unwrap_or_default(),
    );

    git::BranchCommitSummary {
        short_hash,
        subject,
        committed_at,
    }
}

fn branch_activity_from_response(response: BranchResponse) -> git::BranchActivity {
    let updated_ts = parse_gitlab_commit_timestamp(
        response
            .commit
            .committed_date
            .as_deref()
            .unwrap_or_default(),
    );
    let commit = branch_commit_summary_from_response(&response);

    git::BranchActivity {
        name: response.name.trim().to_string(),
        updated_at: commit.committed_at.clone(),
        updated_ts,
        commit: Some(commit),
    }
}

fn normalize_gitlab_commit_date(value: &str) -> String {
    let normalized = value.trim().replace('T', " ");
    if normalized.is_empty() {
        return String::new();
    }
    if let Some((prefix, _)) = normalized.split_once('.') {
        return prefix.trim().to_string();
    }
    if let Some(prefix) = normalized.strip_suffix('Z') {
        return prefix.trim().to_string();
    }
    normalized
}

fn parse_gitlab_commit_timestamp(value: &str) -> i64 {
    DateTime::parse_from_rfc3339(value.trim())
        .map(|parsed| parsed.with_timezone(&Local).timestamp())
        .unwrap_or(0)
}

fn find_branch_response(
    client: &Client,
    api_base: &str,
    encoded_project: &str,
    token: &str,
    branch: &str,
) -> Result<Option<BranchResponse>> {
    let encoded_branch = utf8_percent_encode(branch, NON_ALPHANUMERIC).to_string();
    let url = format!("{api_base}/projects/{encoded_project}/repository/branches/{encoded_branch}");
    let response = client
        .get(&url)
        .header("PRIVATE-TOKEN", token)
        .send()
        .with_context(|| format!("failed to fetch branch head: {url}"))?;

    let http_status = response.status();
    let body = response
        .text()
        .context("failed to read GitLab branch response")?;
    if http_status == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !http_status.is_success() {
        bail!("读取分支头失败: HTTP {http_status} {body}");
    }

    let parsed = serde_json::from_str::<BranchResponse>(&body)
        .with_context(|| format!("failed to parse branch response: {body}"))?;
    Ok(Some(parsed))
}

fn find_branch_head_sha(
    client: &Client,
    api_base: &str,
    encoded_project: &str,
    token: &str,
    branch: &str,
) -> Result<Option<String>> {
    Ok(
        find_branch_response(client, api_base, encoded_project, token, branch)?
            .map(|parsed| parsed.commit.id),
    )
}

fn get_branch_head_sha(
    client: &Client,
    api_base: &str,
    encoded_project: &str,
    token: &str,
    branch: &str,
) -> Result<String> {
    find_branch_head_sha(client, api_base, encoded_project, token, branch)?
        .ok_or_else(|| anyhow!("分支不存在：{branch}"))
}

fn create_branch_from_ref(
    client: &Client,
    api_base: &str,
    encoded_project: &str,
    token: &str,
    branch: &str,
    ref_branch: &str,
) -> Result<String> {
    let url = format!("{api_base}/projects/{encoded_project}/repository/branches");
    let payload = CreateBranchPayload {
        branch,
        r#ref: ref_branch,
    };
    let response = client
        .post(&url)
        .header("PRIVATE-TOKEN", token)
        .query(&payload)
        .send()
        .with_context(|| format!("failed to create branch: {url}"))?;

    let http_status = response.status();
    let body = response
        .text()
        .context("failed to read GitLab branch response")?;
    if !http_status.is_success() {
        bail!("创建目标分支失败: HTTP {http_status} {body}");
    }

    let parsed = serde_json::from_str::<BranchResponse>(&body)
        .with_context(|| format!("failed to parse branch response: {body}"))?;
    Ok(parsed.commit.id)
}

fn project_path_from_git_url(project_git_url: &str) -> Result<String> {
    let parsed = Url::parse(project_git_url)
        .with_context(|| format!("invalid git url: {project_git_url}"))?;
    let segments: Vec<String> = parsed
        .path_segments()
        .ok_or_else(|| anyhow!("invalid git url path: {project_git_url}"))?
        .map(|segment| segment.trim().to_string())
        .filter(|segment| !segment.is_empty())
        .collect();

    if segments.len() < 2 {
        bail!("无法从 git url 提取项目路径: {project_git_url}");
    }

    let project_segments = if segments.first().map(String::as_str) == Some("gitlab") {
        segments[1..].to_vec()
    } else {
        segments
    };

    if project_segments.len() < 2 {
        bail!("无法从 git url 提取 group/project: {project_git_url}");
    }

    let mut project = project_segments.join("/");
    if project.ends_with(".git") {
        project.truncate(project.len() - 4);
    }
    if project.trim().is_empty() {
        bail!("git url 项目路径为空: {project_git_url}");
    }

    Ok(project)
}

fn encode_project_path(project_path: &str) -> String {
    utf8_percent_encode(project_path, NON_ALPHANUMERIC).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn branch_activity_reuses_commit_metadata_from_the_catalog_response() {
        let activity = branch_activity_from_response(BranchResponse {
            name: "feature/demo".to_string(),
            commit: BranchCommit {
                id: "abcdef1234567890".to_string(),
                short_id: Some("abcdef12".to_string()),
                title: Some("fix: visible branch revision".to_string()),
                message: None,
                committed_date: Some("2026-08-10T11:42:06+08:00".to_string()),
            },
        });

        assert_eq!(activity.name, "feature/demo");
        assert_eq!(activity.updated_at, "2026-08-10 11:42:06+08:00");
        assert_eq!(
            activity.commit,
            Some(git::BranchCommitSummary {
                short_hash: "abcdef12".to_string(),
                subject: "fix: visible branch revision".to_string(),
                committed_at: "2026-08-10 11:42:06+08:00".to_string(),
            })
        );
    }

    #[test]
    fn classifies_known_gitlab_merge_statuses() {
        assert_eq!(
            merge_failure_kind_from_status("cannot_be_merged"),
            MergeFailureKind::Conflict
        );
        assert_eq!(
            merge_failure_kind_from_status("ci_must_pass"),
            MergeFailureKind::PipelineBlocked
        );
        assert_eq!(
            merge_failure_kind_from_status("discussions_not_resolved"),
            MergeFailureKind::DiscussionBlocked
        );
        assert_eq!(
            merge_failure_kind_from_status("not_approved"),
            MergeFailureKind::ApprovalBlocked
        );
        assert_eq!(
            merge_failure_kind_from_status("unchecked"),
            MergeFailureKind::Blocked
        );
    }
}
