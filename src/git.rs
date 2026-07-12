use anyhow::{Context, Result};
use chrono::{DateTime, Local, Utc};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn is_ephemeral_branch(name: &str) -> bool {
    name.trim().starts_with("yc-merge-")
}

#[derive(Debug, Clone)]
pub struct WorktreeMergeResult {
    pub target_branch: String,
    pub source_branch: String,
    pub merged_commit: String,
    pub created_target_branch: bool,
    pub detail: String,
}

#[derive(Debug, Clone)]
pub struct BranchCommitSummary {
    pub short_hash: String,
    pub subject: String,
    pub committed_at: String,
}

#[derive(Debug, Clone)]
pub struct BranchActivity {
    pub name: String,
    pub updated_at: String,
    pub updated_ts: i64,
}

#[derive(Debug, Clone)]
pub struct BranchCheckoutResult {
    pub output_path: PathBuf,
    pub detail: String,
}

#[derive(Debug, Clone)]
pub struct BranchSwitchResult {
    pub previous_branch: String,
    pub current_branch: String,
    pub created_tracking_branch: bool,
    pub already_current: bool,
    pub detail: String,
}

#[derive(Debug, Clone)]
pub struct WorkingTreeFileStatus {
    pub path: String,
    pub code: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
    pub conflicted: bool,
}

#[derive(Debug, Clone)]
pub struct WorkingTreeStatus {
    pub current_branch: String,
    pub upstream_branch: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub detached: bool,
    pub staged_count: usize,
    pub unstaged_count: usize,
    pub untracked_count: usize,
    pub conflicted_count: usize,
    pub files: Vec<WorkingTreeFileStatus>,
    pub clean: bool,
}

#[derive(Debug, Clone)]
pub struct BranchPushResult {
    pub current_branch: String,
    pub upstream_branch: Option<String>,
    pub committed: bool,
    pub commit: Option<BranchCommitSummary>,
    pub detail: String,
    pub status_before_push: WorkingTreeStatus,
}

#[derive(Debug, Clone)]
pub struct GitWorktreeSummary {
    pub path: PathBuf,
    pub branch: Option<String>,
    pub detached: bool,
    pub bare: bool,
}

fn git_command() -> Command {
    let command = Command::new("git");
    #[cfg(target_os = "windows")]
    let mut command = command;
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

pub fn current_branch(repo_path: &Path) -> Result<String> {
    let output = git_command()
        .args(["-C"])
        .arg(repo_path)
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .with_context(|| format!("failed to run git in {}", repo_path.display()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!(
            "failed to read git branch for {}: {}",
            repo_path.display(),
            stderr.trim()
        );
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn working_tree_status(repo_path: &Path) -> Result<WorkingTreeStatus> {
    let output = run_git_capture(
        repo_path,
        &[
            "status",
            "--porcelain=v1",
            "--branch",
            "--untracked-files=all",
        ],
    )?;
    parse_working_tree_status(&output)
}

pub fn list_worktrees(repo_path: &Path) -> Result<Vec<GitWorktreeSummary>> {
    let output = run_git_capture(repo_path, &["worktree", "list", "--porcelain"])?;
    let mut items = Vec::new();
    let mut path: Option<PathBuf> = None;
    let mut branch: Option<String> = None;
    let mut detached = false;
    let mut bare = false;

    for line in output.lines().chain(std::iter::once("")) {
        let line = line.trim();
        if line.is_empty() {
            if let Some(path) = path.take() {
                items.push(GitWorktreeSummary {
                    path,
                    branch: branch.take(),
                    detached,
                    bare,
                });
            }
            detached = false;
            bare = false;
            continue;
        }

        if let Some(value) = line.strip_prefix("worktree ") {
            path = Some(PathBuf::from(value.trim()));
        } else if let Some(value) = line.strip_prefix("branch ") {
            branch = Some(
                value
                    .trim()
                    .strip_prefix("refs/heads/")
                    .unwrap_or(value.trim())
                    .to_string(),
            );
        } else if line == "detached" {
            detached = true;
        } else if line == "bare" {
            bare = true;
        }
    }

    Ok(items)
}

pub fn push_current_branch(
    repo_path: &Path,
    commit_before_push: bool,
    commit_message: Option<&str>,
) -> Result<BranchPushResult> {
    let status_before_push = working_tree_status(repo_path)?;
    if status_before_push.detached || status_before_push.current_branch.is_empty() {
        anyhow::bail!("当前仓库处于 detached HEAD，无法执行推送");
    }
    if status_before_push.conflicted_count > 0 {
        anyhow::bail!("当前工作副本存在冲突，请先处理冲突后再推送");
    }

    let current_branch = status_before_push.current_branch.clone();
    let remote_name = preferred_remote_name(repo_path)?;
    let has_local_changes = !status_before_push.clean;
    let mut detail_parts = Vec::new();
    let mut committed = false;
    let mut commit = None;

    if commit_before_push && has_local_changes {
        let commit_message = commit_message
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .context("提交说明不能为空")?;
        let add_output = run_git_capture(repo_path, &["add", "-A"])?;
        if !add_output.trim().is_empty() {
            detail_parts.push(format!("git add -A:\n{}", add_output.trim()));
        }

        let commit_output = run_git_capture(repo_path, &["commit", "-m", commit_message])?;
        if !commit_output.trim().is_empty() {
            detail_parts.push(format!("git commit:\n{}", commit_output.trim()));
        }
        committed = true;
        commit = Some(latest_branch_commit(repo_path, &current_branch)?);
    }

    let push_output = run_git_capture(repo_path, &["push", "-u", &remote_name, &current_branch])?;
    if !push_output.trim().is_empty() {
        detail_parts.push(format!("git push:\n{}", push_output.trim()));
    }

    Ok(BranchPushResult {
        current_branch: current_branch.clone(),
        upstream_branch: Some(format!("{remote_name}/{current_branch}")),
        committed,
        commit,
        detail: if detail_parts.is_empty() {
            format!("已推送当前分支 {current_branch}")
        } else {
            detail_parts.join("\n\n")
        },
        status_before_push,
    })
}

pub fn available_branches(repo_path: Option<&Path>, git_url: &str) -> Result<Vec<String>> {
    if let Some(path) = repo_path {
        let local = available_branch_activity(path).map(branch_names);
        let remote = remote_branches(git_url);

        return match (local, remote) {
            (Ok(local_items), Ok(remote_items)) => {
                Ok(merge_branch_lists(local_items, remote_items))
            }
            (Ok(local_items), Err(_)) => Ok(local_items),
            (Err(_), Ok(remote_items)) => Ok(remote_items),
            (Err(local_err), Err(remote_err)) => Err(anyhow::anyhow!(
                "failed to load branches from local repo and remote url: {local_err}; {remote_err}"
            )),
        };
    }

    remote_branches(git_url)
}

pub fn available_branch_activity(repo_path: &Path) -> Result<Vec<BranchActivity>> {
    // Keep the local repo in sync so the branch picker reflects recent remote activity.
    let _ = run_git_capture(repo_path, &["fetch", "--all", "--prune"]);

    let output = git_command()
        .args(["-C"])
        .arg(repo_path)
        .args([
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname:short)|%(committerdate:unix)|%(committerdate:iso8601-strict)",
            "refs/heads",
            "refs/remotes",
        ])
        .output()
        .with_context(|| {
            format!(
                "failed to list branches by activity in {}",
                repo_path.display()
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!(
            "failed to list branches by activity for {}: {}",
            repo_path.display(),
            stderr.trim()
        );
    }

    let mut branches = BTreeMap::<String, BranchActivity>::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let mut parts = line.splitn(3, '|');
        let raw_name = parts.next().unwrap_or_default().trim();
        let raw_ts = parts.next().unwrap_or_default().trim();
        let raw_date = parts.next().unwrap_or_default().trim();

        let normalized = trim_remote_prefix(raw_name).to_string();
        if normalized.is_empty() || normalized == "HEAD" || is_ephemeral_branch(&normalized) {
            continue;
        }

        let updated_ts = raw_ts.parse::<i64>().unwrap_or(0);
        let candidate = BranchActivity {
            name: normalized.clone(),
            updated_at: format_branch_activity_date(raw_date, updated_ts),
            updated_ts,
        };

        branches
            .entry(normalized)
            .and_modify(|current| {
                if candidate.updated_ts > current.updated_ts {
                    *current = candidate.clone();
                }
            })
            .or_insert(candidate);
    }

    let mut ordered = branches.into_values().collect::<Vec<_>>();
    ordered.sort_by(|a, b| {
        b.updated_ts
            .cmp(&a.updated_ts)
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(ordered)
}

fn merge_branch_lists(primary: Vec<String>, secondary: Vec<String>) -> Vec<String> {
    let mut merged = Vec::new();
    let mut seen = BTreeSet::new();

    for name in primary.into_iter().chain(secondary.into_iter()) {
        let normalized = name.trim();
        if normalized.is_empty() || normalized == "HEAD" || is_ephemeral_branch(normalized) {
            continue;
        }
        if seen.insert(normalized.to_string()) {
            merged.push(normalized.to_string());
        }
    }

    merged
}

fn parse_working_tree_status(output: &str) -> Result<WorkingTreeStatus> {
    let mut current_branch = String::new();
    let mut upstream_branch = None;
    let mut ahead = 0usize;
    let mut behind = 0usize;
    let mut detached = false;
    let mut files = Vec::new();
    let mut staged_count = 0usize;
    let mut unstaged_count = 0usize;
    let mut untracked_count = 0usize;
    let mut conflicted_count = 0usize;

    for line in output.lines() {
        if let Some(header) = line.strip_prefix("## ") {
            let (branch, upstream, header_ahead, header_behind, is_detached) =
                parse_status_header(header);
            current_branch = branch;
            upstream_branch = upstream;
            ahead = header_ahead;
            behind = header_behind;
            detached = is_detached;
            continue;
        }

        if line.len() < 3 {
            continue;
        }

        let code = line[..2].to_string();
        let path = line[3..].trim().to_string();
        let staged_code = code.chars().next().unwrap_or(' ');
        let unstaged_code = code.chars().nth(1).unwrap_or(' ');
        let untracked = staged_code == '?' && unstaged_code == '?';
        let conflicted = matches!(
            (staged_code, unstaged_code),
            ('U', _) | (_, 'U') | ('A', 'A') | ('D', 'D')
        );
        let staged = !conflicted && !untracked && staged_code != ' ';
        let unstaged = !conflicted && !untracked && unstaged_code != ' ';

        if staged {
            staged_count += 1;
        }
        if unstaged {
            unstaged_count += 1;
        }
        if untracked {
            untracked_count += 1;
        }
        if conflicted {
            conflicted_count += 1;
        }

        files.push(WorkingTreeFileStatus {
            path,
            code,
            staged,
            unstaged,
            untracked,
            conflicted,
        });
    }

    Ok(WorkingTreeStatus {
        current_branch,
        upstream_branch,
        ahead,
        behind,
        detached,
        staged_count,
        unstaged_count,
        untracked_count,
        conflicted_count,
        clean: files.is_empty(),
        files,
    })
}

fn parse_status_header(header: &str) -> (String, Option<String>, usize, usize, bool) {
    let header = header.trim();
    if header == "HEAD" || header.starts_with("HEAD ") {
        return ("HEAD".to_string(), None, 0, 0, true);
    }

    let (branch_part, rest) = header
        .split_once("...")
        .map(|(branch, tail)| (branch.trim(), Some(tail.trim())))
        .unwrap_or((header, None));

    let mut upstream_branch = None;
    let mut ahead = 0usize;
    let mut behind = 0usize;

    if let Some(rest) = rest {
        let (upstream, meta) = rest
            .split_once(" [")
            .map(|(left, right)| (left.trim(), Some(right.trim_end_matches(']'))))
            .unwrap_or((rest, None));

        if !upstream.is_empty() {
            upstream_branch = Some(upstream.to_string());
        }

        if let Some(meta) = meta {
            for part in meta.split(',') {
                let part = part.trim();
                if let Some(value) = part.strip_prefix("ahead ") {
                    ahead = value.parse::<usize>().unwrap_or(0);
                } else if let Some(value) = part.strip_prefix("behind ") {
                    behind = value.parse::<usize>().unwrap_or(0);
                }
            }
        }
    }

    (
        branch_part.to_string(),
        upstream_branch,
        ahead,
        behind,
        false,
    )
}

fn trim_remote_prefix(value: &str) -> &str {
    value
        .split_once('/')
        .map(|(_, branch)| branch)
        .unwrap_or(value)
}

pub fn remote_branches(git_url: &str) -> Result<Vec<String>> {
    let output = git_command()
        .args(["ls-remote", "--heads", git_url])
        .output()
        .with_context(|| format!("failed to query remote branches from {git_url}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!(
            "failed to query remote branches from {}: {}",
            git_url,
            stderr.trim()
        );
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.split_once("refs/heads/").map(|(_, branch)| branch))
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToString::to_string)
        .collect())
}

fn branch_names(items: Vec<BranchActivity>) -> Vec<String> {
    items.into_iter().map(|item| item.name).collect()
}

fn format_branch_activity_date(raw_date: &str, updated_ts: i64) -> String {
    if let Ok(parsed) = DateTime::parse_from_rfc3339(raw_date) {
        return parsed
            .with_timezone(&Local)
            .format("%Y-%m-%d %H:%M")
            .to_string();
    }

    if updated_ts > 0 {
        if let Some(parsed) = DateTime::<Utc>::from_timestamp(updated_ts, 0) {
            return parsed
                .with_timezone(&Local)
                .format("%Y-%m-%d %H:%M")
                .to_string();
        }
    }

    String::new()
}

pub fn merge_branches_with_worktree(
    repo_path: &Path,
    target_branch: &str,
    source_branch: &str,
) -> Result<WorktreeMergeResult> {
    let target_branch = target_branch.trim();
    let source_branch = source_branch.trim();

    if target_branch.is_empty() || source_branch.is_empty() {
        anyhow::bail!("目标分支和源分支不能为空");
    }
    if target_branch == source_branch {
        anyhow::bail!("目标分支和源分支不能相同");
    }

    ensure_target_not_checked_out(repo_path, target_branch)?;
    run_git_capture(repo_path, &["fetch", "--all", "--prune"])
        .with_context(|| "failed to fetch all remote branches".to_string())?;

    let remote_name = preferred_remote_name(repo_path)?;
    // For merge safety we only operate on remote refs, so the base always
    // matches the latest fetched remote state instead of stale local branches.
    let source_ref = resolve_remote_branch_ref(repo_path, source_branch).with_context(|| {
        format!("源分支不存在远端 {remote_name}/{source_branch}，请先推送源分支后再合并")
    })?;
    let target_ref = match resolve_remote_branch_ref(repo_path, target_branch) {
        Ok(target_ref) => target_ref,
        Err(_) => {
            return create_target_branch_from_source(
                repo_path,
                target_branch,
                source_branch,
                &source_ref,
            );
        }
    };

    let suffix = format!(
        "{}-{}",
        sanitize_branch_name(target_branch),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    let temp_branch = format!("yc-merge-{suffix}");
    let temp_worktree = std::env::temp_dir().join(format!("rdevtool-merge-{suffix}"));
    let temp_worktree_str = temp_worktree.to_string_lossy().to_string();

    let mut trace = Vec::new();
    let mut merged_commit = String::new();
    let mut operation_error: Option<anyhow::Error> = None;

    let add_output = run_git_capture(
        repo_path,
        &[
            "worktree",
            "add",
            "-B",
            &temp_branch,
            &temp_worktree_str,
            &target_ref,
        ],
    );
    match add_output {
        Ok(output) => trace.push(format!("worktree add:\n{}", output.trim())),
        Err(error) => {
            operation_error = Some(error);
        }
    }

    if operation_error.is_none() {
        let merge_output = run_git_capture(
            temp_worktree.as_path(),
            &["merge", "--no-ff", "--no-edit", &source_ref],
        );
        match merge_output {
            Ok(output) => trace.push(format!("merge:\n{}", output.trim())),
            Err(error) => {
                let _ = run_git_capture(temp_worktree.as_path(), &["merge", "--abort"]);
                operation_error = Some(error);
            }
        }
    }

    if operation_error.is_none() {
        match run_git_capture(repo_path, &["rev-parse", &temp_branch]) {
            Ok(output) => {
                merged_commit = output.trim().to_string();
                trace.push(format!("merged commit: {}", merged_commit));
            }
            Err(error) => operation_error = Some(error),
        }
    }

    if operation_error.is_none() {
        let update_output =
            run_git_capture(repo_path, &["branch", "-f", target_branch, &temp_branch]);
        match update_output {
            Ok(output) => trace.push(format!("update target branch:\n{}", output.trim())),
            Err(error) => operation_error = Some(error),
        }
    }

    let cleanup_note = cleanup_worktree(repo_path, temp_worktree.as_path(), &temp_branch);
    if !cleanup_note.is_empty() {
        trace.push(cleanup_note);
    }

    if let Some(error) = operation_error {
        let mut detail = String::new();
        if !trace.is_empty() {
            detail.push_str(&trace.join("\n\n"));
            detail.push_str("\n\n");
        }
        detail.push_str(&error.to_string());
        anyhow::bail!(detail);
    }

    Ok(WorktreeMergeResult {
        target_branch: target_branch.to_string(),
        source_branch: source_branch.to_string(),
        merged_commit,
        created_target_branch: false,
        detail: trace.join("\n\n"),
    })
}

pub fn create_remote_branch_from_source(
    repo_path: &Path,
    target_branch: &str,
    source_branch: &str,
) -> Result<WorktreeMergeResult> {
    let target_branch = target_branch.trim();
    let source_branch = source_branch.trim();

    if target_branch.is_empty() || source_branch.is_empty() {
        anyhow::bail!("目标分支和源分支不能为空");
    }
    if target_branch == source_branch {
        anyhow::bail!("目标分支和源分支不能相同");
    }

    run_git_capture(repo_path, &["fetch", "--all", "--prune"])
        .with_context(|| "failed to fetch all remote branches".to_string())?;
    let remote_name = preferred_remote_name(repo_path)?;
    let source_ref = resolve_remote_branch_ref(repo_path, source_branch).with_context(|| {
        format!("源分支不存在远端 {remote_name}/{source_branch}，无法创建目标分支")
    })?;
    if resolve_remote_branch_ref(repo_path, target_branch).is_ok() {
        anyhow::bail!("目标分支已存在：{remote_name}/{target_branch}");
    }

    create_target_branch_from_source(repo_path, target_branch, source_branch, &source_ref)
}

pub fn clone_branch_to_directory(
    git_url: &str,
    branch: &str,
    destination_path: &Path,
) -> Result<BranchCheckoutResult> {
    let branch = branch.trim();
    if git_url.trim().is_empty() {
        anyhow::bail!("项目未配置 git_url，无法克隆分支");
    }
    if branch.is_empty() {
        anyhow::bail!("源分支不能为空");
    }
    let output_path = ensure_checkout_destination(destination_path)?;

    let output = git_command()
        .args(["clone", "--branch", branch, "--single-branch"])
        .arg(git_url)
        .arg(output_path)
        .output()
        .with_context(|| {
            format!(
                "failed to clone branch {branch} into {}",
                output_path.display()
            )
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        let mut message = format!("git clone 分支失败：{branch}");
        if !stdout.is_empty() {
            message.push_str("\nstdout:\n");
            message.push_str(&stdout);
        }
        if !stderr.is_empty() {
            message.push_str("\nstderr:\n");
            message.push_str(&stderr);
        }
        anyhow::bail!(message);
    }

    let detail = [stdout, stderr]
        .into_iter()
        .filter(|item| !item.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    Ok(BranchCheckoutResult {
        output_path: output_path.to_path_buf(),
        detail: if detail.is_empty() {
            format!("已克隆 {branch} 到本地目录")
        } else {
            detail
        },
    })
}

pub fn add_worktree_from_branch(
    repo_path: &Path,
    branch: &str,
    destination_path: &Path,
) -> Result<BranchCheckoutResult> {
    let branch = branch.trim();
    if branch.is_empty() {
        anyhow::bail!("源分支不能为空");
    }
    let output_path = ensure_checkout_destination(destination_path)?;

    run_git_capture(repo_path, &["fetch", "--all", "--prune"])?;
    let local_ref = format!("refs/heads/{branch}");
    let local_exists = verify_ref(repo_path, &local_ref)?;
    let remote_name = preferred_remote_name(repo_path)?;
    let remote_ref = resolve_remote_branch_ref(repo_path, branch).ok();
    let branch_checked_out = list_worktrees(repo_path)
        .map(|items| {
            items
                .into_iter()
                .any(|item| item.branch.as_deref() == Some(branch))
        })
        .unwrap_or(false);

    let output = if !branch_checked_out && local_exists {
        run_git_capture_owned(
            repo_path,
            vec![
                "worktree".to_string(),
                "add".to_string(),
                output_path.display().to_string(),
                branch.to_string(),
            ],
        )?
    } else if !branch_checked_out {
        let remote_ref = remote_ref
            .as_deref()
            .with_context(|| format!("远端分支不存在：{remote_name}/{branch}"))?;
        run_git_capture_owned(
            repo_path,
            vec![
                "worktree".to_string(),
                "add".to_string(),
                "--track".to_string(),
                "-b".to_string(),
                branch.to_string(),
                output_path.display().to_string(),
                remote_ref.to_string(),
            ],
        )?
    } else {
        let source_ref = remote_ref
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(local_ref.as_str());
        run_git_capture_owned(
            repo_path,
            vec![
                "worktree".to_string(),
                "add".to_string(),
                "--detach".to_string(),
                output_path.display().to_string(),
                source_ref.to_string(),
            ],
        )?
    };

    let mut detail = if output.trim().is_empty() {
        format!("已创建工作区副本 {branch}")
    } else {
        output.trim().to_string()
    };
    if branch_checked_out {
        detail.push_str("\n\n源分支已被其他工作副本占用，本次以 detached HEAD 创建副本。");
    }

    Ok(BranchCheckoutResult {
        output_path: output_path.to_path_buf(),
        detail,
    })
}

fn ensure_checkout_destination(destination_path: &Path) -> Result<&Path> {
    let output_path = destination_path;
    if output_path.as_os_str().is_empty() {
        anyhow::bail!("目标目录不能为空");
    }

    if output_path.exists() {
        if !output_path.is_dir() {
            anyhow::bail!("目标目录不是文件夹：{}", output_path.display());
        }
        let has_entries = fs::read_dir(output_path)
            .with_context(|| {
                format!(
                    "failed to inspect target directory {}",
                    output_path.display()
                )
            })?
            .next()
            .transpose()
            .with_context(|| {
                format!(
                    "failed to inspect target directory {}",
                    output_path.display()
                )
            })?
            .is_some();
        if has_entries {
            anyhow::bail!("目标目录不是空目录：{}", output_path.display());
        }
    } else if let Some(parent) = output_path.parent() {
        if !parent.exists() || !parent.is_dir() {
            anyhow::bail!("目标目录的父路径不存在：{}", parent.display());
        }
    }

    Ok(output_path)
}

fn create_target_branch_from_source(
    repo_path: &Path,
    target_branch: &str,
    source_branch: &str,
    source_ref: &str,
) -> Result<WorktreeMergeResult> {
    let mut trace = Vec::new();

    let branch_output = run_git_capture(repo_path, &["branch", "-f", target_branch, source_ref])?;
    if !branch_output.trim().is_empty() {
        trace.push(format!(
            "create local target branch:\n{}",
            branch_output.trim()
        ));
    } else {
        trace.push(format!(
            "create local target branch:\n已将 {target_branch} 指向 {source_ref}"
        ));
    }

    let merged_commit = run_git_capture(repo_path, &["rev-parse", target_branch])?
        .trim()
        .to_string();
    trace.push(format!(
        "target branch head: {}（from {source_ref}）",
        merged_commit
    ));

    let remote_name = preferred_remote_name(repo_path)?;
    let push_output = run_git_capture(repo_path, &["push", "-u", &remote_name, target_branch])?;
    if !push_output.trim().is_empty() {
        trace.push(format!("push target branch:\n{}", push_output.trim()));
    }

    Ok(WorktreeMergeResult {
        target_branch: target_branch.to_string(),
        source_branch: source_branch.to_string(),
        merged_commit,
        created_target_branch: true,
        detail: trace.join("\n\n"),
    })
}

pub fn latest_branch_commit(repo_path: &Path, branch: &str) -> Result<BranchCommitSummary> {
    let branch_ref = resolve_branch_ref(repo_path, branch)
        .with_context(|| format!("无法定位分支最新提交：{branch}"))?;
    latest_commit_for_ref(repo_path, branch, &branch_ref)
}

pub fn latest_remote_branch_commit(repo_path: &Path, branch: &str) -> Result<BranchCommitSummary> {
    run_git_capture(repo_path, &["fetch", "--all", "--prune"])?;
    let remote_name = preferred_remote_name(repo_path)?;
    let branch_ref = resolve_remote_branch_ref(repo_path, branch)
        .with_context(|| format!("无法定位远端分支最新提交：{remote_name}/{branch}"))?;
    latest_commit_for_ref(repo_path, branch, &branch_ref)
}

pub fn try_latest_remote_branch_commit(
    repo_path: &Path,
    branch: &str,
) -> Result<Option<BranchCommitSummary>> {
    run_git_capture(repo_path, &["fetch", "--all", "--prune"])?;
    let remote_name = preferred_remote_name(repo_path)?;
    let branch_ref = format!("refs/remotes/{remote_name}/{branch}");
    if !verify_ref(repo_path, &branch_ref)? {
        return Ok(None);
    }
    Ok(Some(latest_commit_for_ref(repo_path, branch, &branch_ref)?))
}

pub fn push_branch(repo_path: &Path, branch: &str) -> Result<String> {
    let branch = branch.trim();
    if branch.is_empty() {
        anyhow::bail!("待推送分支不能为空");
    }

    let remote_name = preferred_remote_name(repo_path)?;
    run_git_capture(repo_path, &["push", &remote_name, branch])
        .map_err(|error| anyhow::anyhow!("推送远端分支失败：{branch}\n{error:#}"))
}

pub fn sync_local_branch_with_remote(repo_path: &Path, branch: &str) -> Result<String> {
    let branch = branch.trim();
    if branch.is_empty() {
        anyhow::bail!("待同步分支不能为空");
    }

    run_git_capture(repo_path, &["fetch", "--all", "--prune"])?;
    let remote_name = preferred_remote_name(repo_path)?;
    let remote_ref = resolve_remote_branch_ref(repo_path, branch)
        .with_context(|| format!("远端分支不存在：{remote_name}/{branch}"))?;
    run_git_capture(repo_path, &["branch", "-f", branch, &remote_ref])?;
    Ok(format!("已同步本地 {branch} -> {remote_ref}"))
}

pub fn switch_branch(repo_path: &Path, target_branch: &str) -> Result<BranchSwitchResult> {
    let target_branch = target_branch.trim();
    if target_branch.is_empty() {
        anyhow::bail!("目标分支不能为空");
    }

    let status_before = working_tree_status(repo_path)?;
    let previous_branch = if status_before.detached || status_before.current_branch.is_empty() {
        "detached HEAD".to_string()
    } else {
        status_before.current_branch.clone()
    };

    if status_before.conflicted_count > 0 {
        anyhow::bail!("当前工作副本存在冲突，请先处理冲突后再切换分支");
    }
    if !status_before.clean {
        anyhow::bail!(
            "当前工作副本存在未提交改动，请先提交、暂存或清理后再切换分支（已暂存 {}，未暂存 {}，未跟踪 {}）",
            status_before.staged_count,
            status_before.unstaged_count,
            status_before.untracked_count
        );
    }
    if !status_before.detached && status_before.current_branch == target_branch {
        return Ok(BranchSwitchResult {
            previous_branch,
            current_branch: target_branch.to_string(),
            created_tracking_branch: false,
            already_current: true,
            detail: format!("当前已在分支 {target_branch}"),
        });
    }

    let local_ref = format!("refs/heads/{target_branch}");
    let mut detail_parts = Vec::new();
    let created_tracking_branch = if verify_ref(repo_path, &local_ref)? {
        let output = run_git_capture(repo_path, &["switch", target_branch])?;
        if !output.trim().is_empty() {
            detail_parts.push(format!("git switch:\n{}", output.trim()));
        }
        false
    } else {
        let fetch_output = run_git_capture(repo_path, &["fetch", "--all", "--prune"])?;
        if !fetch_output.trim().is_empty() {
            detail_parts.push(format!("git fetch:\n{}", fetch_output.trim()));
        }
        let remote_name = preferred_remote_name(repo_path)?;
        let remote_ref = format!("refs/remotes/{remote_name}/{target_branch}");
        if !verify_ref(repo_path, &remote_ref)? {
            anyhow::bail!("目标分支不存在：{target_branch}");
        }
        let remote_branch = format!("{remote_name}/{target_branch}");
        let output = run_git_capture(repo_path, &["switch", "--track", &remote_branch])?;
        if !output.trim().is_empty() {
            detail_parts.push(format!("git switch --track:\n{}", output.trim()));
        }
        true
    };

    let status_after = working_tree_status(repo_path)?;
    let current_branch = status_after.current_branch;
    let mut detail = if created_tracking_branch {
        format!("已从远端跟踪分支切换到 {current_branch}")
    } else {
        format!("已切换到本地分支 {current_branch}")
    };
    if !detail_parts.is_empty() {
        detail.push_str("\n\n");
        detail.push_str(&detail_parts.join("\n\n"));
    }

    Ok(BranchSwitchResult {
        previous_branch,
        current_branch,
        created_tracking_branch,
        already_current: false,
        detail,
    })
}

fn cleanup_worktree(repo_path: &Path, worktree_path: &Path, temp_branch: &str) -> String {
    let mut notes = Vec::new();
    let worktree_output = run_git_capture(
        repo_path,
        &[
            "worktree",
            "remove",
            "--force",
            worktree_path.to_string_lossy().as_ref(),
        ],
    );
    if let Err(error) = worktree_output {
        notes.push(format!("cleanup worktree failed: {error}"));
    }

    let branch_output = run_git_capture(repo_path, &["branch", "-D", temp_branch]);
    if let Err(error) = branch_output {
        notes.push(format!("cleanup temp branch failed: {error}"));
    }

    notes.join("\n")
}

fn ensure_target_not_checked_out(repo_path: &Path, target_branch: &str) -> Result<()> {
    let output = run_git_capture(repo_path, &["worktree", "list", "--porcelain"])
        .context("failed to inspect existing worktrees")?;
    let target_ref = format!("refs/heads/{target_branch}");
    for line in output.lines() {
        if line.trim() == format!("branch {target_ref}") {
            anyhow::bail!("目标分支 {target_branch} 当前已在某个工作目录被检出，请先切换后再合并");
        }
    }
    Ok(())
}

fn resolve_branch_ref(repo_path: &Path, branch: &str) -> Result<String> {
    let local_ref = format!("refs/heads/{branch}");
    if verify_ref(repo_path, &local_ref)? {
        return Ok(local_ref);
    }

    let remote_name = preferred_remote_name(repo_path)?;
    let remote_ref = format!("refs/remotes/{remote_name}/{branch}");
    if verify_ref(repo_path, &remote_ref)? {
        return Ok(remote_ref);
    }

    anyhow::bail!("branch not found: {branch}")
}

fn resolve_remote_branch_ref(repo_path: &Path, branch: &str) -> Result<String> {
    let remote_name = preferred_remote_name(repo_path)?;
    let remote_ref = format!("refs/remotes/{remote_name}/{branch}");
    if verify_ref(repo_path, &remote_ref)? {
        return Ok(remote_ref);
    }

    anyhow::bail!("remote branch not found: {remote_name}/{branch}")
}

fn preferred_remote_name(repo_path: &Path) -> Result<String> {
    if let Ok(upstream) = run_git_capture(
        repo_path,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    ) {
        let upstream = upstream.trim();
        if let Some((remote, _)) = upstream.split_once('/') {
            let remote = remote.trim();
            if !remote.is_empty() && remote != "HEAD" {
                return Ok(remote.to_string());
            }
        }
    }

    let remotes = run_git_capture(repo_path, &["remote"])?;
    let names = remotes
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();

    if names.is_empty() {
        anyhow::bail!("未配置 git remote");
    }

    if names.len() == 1 {
        return Ok(names[0].clone());
    }

    if names.iter().any(|name| name == "origin") {
        return Ok("origin".to_string());
    }

    Ok(names[0].clone())
}

fn latest_commit_for_ref(
    repo_path: &Path,
    branch: &str,
    branch_ref: &str,
) -> Result<BranchCommitSummary> {
    let output = run_git_capture(
        repo_path,
        &["log", "-1", "--pretty=format:%h%n%ci%n%s", branch_ref],
    )?;
    let mut lines = output.lines();
    let short_hash = lines.next().unwrap_or("").trim().to_string();
    let committed_at = lines.next().unwrap_or("").trim().to_string();
    let subject = lines.collect::<Vec<_>>().join(" ").trim().to_string();
    if short_hash.is_empty() {
        anyhow::bail!("未读取到分支最新提交：{branch}");
    }
    Ok(BranchCommitSummary {
        short_hash,
        subject,
        committed_at,
    })
}

fn verify_ref(repo_path: &Path, full_ref: &str) -> Result<bool> {
    let output = git_command()
        .args(["-C"])
        .arg(repo_path)
        .args(["rev-parse", "--verify", "--quiet", full_ref])
        .output()
        .with_context(|| format!("failed to verify ref {full_ref} in {}", repo_path.display()))?;
    Ok(output.status.success())
}

fn run_git_capture(repo_path: &Path, args: &[&str]) -> Result<String> {
    let output = git_command()
        .args(["-C"])
        .arg(repo_path)
        .args(args)
        .output()
        .with_context(|| format!("failed to run git in {}", repo_path.display()))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        let mut message = format!("git {} failed", args.join(" "));
        if !stdout.trim().is_empty() {
            message.push_str("\nstdout:\n");
            message.push_str(stdout.trim());
        }
        if !stderr.trim().is_empty() {
            message.push_str("\nstderr:\n");
            message.push_str(stderr.trim());
        }
        anyhow::bail!(message);
    }

    let combined = if stderr.trim().is_empty() {
        stdout
    } else if stdout.trim().is_empty() {
        stderr
    } else {
        format!("{stdout}\n{stderr}")
    };
    Ok(combined)
}

fn run_git_capture_owned(repo_path: &Path, args: Vec<String>) -> Result<String> {
    let borrowed = args.iter().map(String::as_str).collect::<Vec<_>>();
    run_git_capture(repo_path, &borrowed)
}

fn sanitize_branch_name(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
            out.push(ch);
        } else {
            out.push('-');
        }
    }
    while out.contains("--") {
        out = out.replace("--", "-");
    }
    out.trim_matches('-').to_string()
}
