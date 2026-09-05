use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use anyhow::Result;
use serde::Serialize;

use crate::config::{AppConfig, ProjectWorkspaceConfig, apply_project_workspace_context};
use crate::git;

#[derive(Debug, Clone, Default)]
pub struct WorkspaceReviewRequest {
    pub bases: BTreeMap<String, String>,
    pub allowed_paths: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceReviewResponse {
    pub schema_version: u16,
    pub workspace_key: String,
    pub requested: WorkspaceReviewRequested,
    pub summary: WorkspaceReviewSummary,
    pub items: Vec<WorkspaceReviewItem>,
    pub status: WorkspaceReviewStatus,
    pub risks: Vec<WorkspaceReviewRisk>,
    pub recommended_actions: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceReviewRequested {
    pub bases: BTreeMap<String, String>,
    pub allowed_paths: BTreeMap<String, Vec<String>>,
    pub remote_refs_refreshed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceReviewSummary {
    pub project_count: usize,
    pub repository_observed_count: usize,
    pub comparable_count: usize,
    pub clean_count: usize,
    pub detached_project_count: usize,
    pub path_scope_checked_count: usize,
    pub conflicted_project_count: usize,
    pub diff_check_failure_count: usize,
    pub unexpected_path_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceReviewItem {
    pub project_key: String,
    pub project_name: String,
    pub configured_repo_path: Option<String>,
    pub effective_repo_path: Option<String>,
    pub path_source: String,
    pub instance_managed: bool,
    pub repository_observed: bool,
    pub current_branch: Option<String>,
    pub detached: bool,
    pub head_commit: Option<String>,
    pub upstream_branch: Option<String>,
    pub base_ref: Option<String>,
    pub base_commit: Option<String>,
    pub comparable: bool,
    pub ahead: Option<usize>,
    pub behind: Option<usize>,
    pub clean: bool,
    pub staged_count: usize,
    pub unstaged_count: usize,
    pub untracked_count: usize,
    pub conflicted_count: usize,
    pub changed_files: Vec<String>,
    pub path_allowlist_applied: bool,
    pub allowed_paths: Vec<String>,
    pub unexpected_files: Vec<String>,
    pub diff_check_passed: Option<bool>,
    pub diff_check_output: Option<String>,
    pub status_key: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceReviewStatus {
    pub success: bool,
    pub key: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceReviewRisk {
    pub code: String,
    pub severity: String,
    pub project_key: String,
    pub summary: String,
}

pub fn review_workspace(
    config: &AppConfig,
    workspace: &ProjectWorkspaceConfig,
    request: WorkspaceReviewRequest,
) -> WorkspaceReviewResponse {
    let effective_config = apply_project_workspace_context(config, workspace);
    let mut items = Vec::new();
    let mut risks = Vec::new();

    for project in &effective_config.projects {
        let configured_project = config.projects.iter().find(|item| item.key == project.key);
        let instance = workspace
            .project_instances
            .iter()
            .find(|instance| instance.project == project.key);
        let configured_repo_path = configured_project
            .and_then(|item| item.repo_path.as_ref())
            .map(|path| path.display().to_string());
        let effective_repo_path = project
            .repo_path
            .as_ref()
            .map(|path| path.display().to_string());
        let path_allowlist_applied = request.allowed_paths.contains_key(&project.key);
        let allowed_paths = request
            .allowed_paths
            .get(&project.key)
            .cloned()
            .unwrap_or_default();
        let mut item = WorkspaceReviewItem {
            project_key: project.key.clone(),
            project_name: project.name.clone(),
            configured_repo_path,
            effective_repo_path: effective_repo_path.clone(),
            path_source: if instance.is_some() {
                "workspaceProjectInstance"
            } else {
                "projectConfiguration"
            }
            .to_string(),
            instance_managed: instance.is_some_and(|instance| instance.managed),
            repository_observed: false,
            current_branch: None,
            detached: false,
            head_commit: None,
            upstream_branch: None,
            base_ref: request.bases.get(&project.key).cloned(),
            base_commit: None,
            comparable: false,
            ahead: None,
            behind: None,
            clean: false,
            staged_count: 0,
            unstaged_count: 0,
            untracked_count: 0,
            conflicted_count: 0,
            changed_files: Vec::new(),
            path_allowlist_applied,
            allowed_paths,
            unexpected_files: Vec::new(),
            diff_check_passed: None,
            diff_check_output: None,
            status_key: "unavailable".to_string(),
            warnings: Vec::new(),
        };

        let Some(repo_path) = project.repo_path.as_deref() else {
            push_risk(
                &mut risks,
                &project.key,
                "repositoryPathMissing",
                "error",
                "项目没有可用的仓库路径",
            );
            item.warnings.push("项目没有可用的仓库路径".to_string());
            items.push(item);
            continue;
        };

        if !repo_path.exists() {
            push_risk(
                &mut risks,
                &project.key,
                "repositoryMissing",
                "error",
                "有效工作副本目录不存在",
            );
            item.status_key = "missing".to_string();
            item.warnings.push("有效工作副本目录不存在".to_string());
            items.push(item);
            continue;
        }

        match review_repository(repo_path, &mut item) {
            Ok(()) => {}
            Err(error) => {
                let detail = error.to_string();
                item.warnings.push(detail.clone());
                push_risk(
                    &mut risks,
                    &project.key,
                    "repositoryReviewFailed",
                    "error",
                    &detail,
                );
            }
        }

        if item.base_ref.is_none() {
            item.base_ref = item.upstream_branch.clone();
        }
        if let Some(base_ref) = item.base_ref.clone() {
            match review_against_base(repo_path, &base_ref, &mut item) {
                Ok(()) => {}
                Err(error) => {
                    let detail = error.to_string();
                    item.warnings.push(detail.clone());
                    push_risk(
                        &mut risks,
                        &project.key,
                        "baseComparisonFailed",
                        "error",
                        &detail,
                    );
                }
            }
        } else {
            item.warnings
                .push("未指定基线且当前分支没有 upstream，无法比较".to_string());
            push_risk(
                &mut risks,
                &project.key,
                "baseNotConfigured",
                "warning",
                "未指定基线且当前分支没有 upstream",
            );
        }

        item.unexpected_files = unexpected_files(
            &item.changed_files,
            &item.allowed_paths,
            item.path_allowlist_applied,
        );
        if !item.unexpected_files.is_empty() {
            push_risk(
                &mut risks,
                &project.key,
                "unexpectedPaths",
                "error",
                "存在白名单之外的改动文件",
            );
        }
        if item.conflicted_count > 0 {
            push_risk(
                &mut risks,
                &project.key,
                "mergeConflicts",
                "error",
                "工作副本存在冲突文件",
            );
        }
        if item.detached {
            push_risk(
                &mut risks,
                &project.key,
                "detachedHead",
                "error",
                "工作副本处于 detached HEAD，无法确认需求分支身份",
            );
        }
        if item.diff_check_passed == Some(false) {
            push_risk(
                &mut risks,
                &project.key,
                "diffCheckFailed",
                "error",
                "git diff --check 未通过",
            );
        }
        item.status_key = if item.repository_observed
            && !item.detached
            && item.comparable
            && item.conflicted_count == 0
            && item.diff_check_passed == Some(true)
            && item.unexpected_files.is_empty()
        {
            "ready"
        } else {
            "needsAttention"
        }
        .to_string();
        items.push(item);
    }

    let summary = WorkspaceReviewSummary {
        project_count: items.len(),
        repository_observed_count: items.iter().filter(|item| item.repository_observed).count(),
        comparable_count: items.iter().filter(|item| item.comparable).count(),
        clean_count: items.iter().filter(|item| item.clean).count(),
        detached_project_count: items.iter().filter(|item| item.detached).count(),
        path_scope_checked_count: items
            .iter()
            .filter(|item| item.path_allowlist_applied)
            .count(),
        conflicted_project_count: items
            .iter()
            .filter(|item| item.conflicted_count > 0)
            .count(),
        diff_check_failure_count: items
            .iter()
            .filter(|item| item.diff_check_passed == Some(false))
            .count(),
        unexpected_path_count: items.iter().map(|item| item.unexpected_files.len()).sum(),
    };
    let success = !items.is_empty() && items.iter().all(|item| item.status_key == "ready");
    let all_path_scopes_checked = items.iter().all(|item| item.path_allowlist_applied);
    let status = WorkspaceReviewStatus {
        success,
        key: if success { "ready" } else { "needsAttention" }.to_string(),
        summary: if success && all_path_scopes_checked {
            "所有项目均可与基线比较，且冲突、差异检查和路径范围检查通过"
        } else if success {
            "所有项目均可与基线比较，且冲突和差异检查通过；未配置白名单的项目未执行路径范围约束"
        } else {
            "至少一个项目需要进一步处理"
        }
        .to_string(),
    };
    let recommended_actions = if success {
        vec!["继续进行人工代码审查或按项目约定执行测试".to_string()]
    } else {
        vec!["根据 risks 处理基线、冲突、空白错误或范围外改动后重新执行 review".to_string()]
    };

    WorkspaceReviewResponse {
        schema_version: 1,
        workspace_key: workspace.key.clone(),
        requested: WorkspaceReviewRequested {
            bases: request.bases,
            allowed_paths: request.allowed_paths,
            remote_refs_refreshed: false,
        },
        summary,
        items,
        status,
        risks,
        recommended_actions,
    }
}

fn review_repository(repo_path: &Path, item: &mut WorkspaceReviewItem) -> Result<()> {
    let tree_status = git::working_tree_status(repo_path)?;
    item.current_branch = (!tree_status.detached && !tree_status.current_branch.is_empty())
        .then_some(tree_status.current_branch);
    item.head_commit = Some(git::revision_commit(repo_path, "HEAD")?);
    item.upstream_branch = tree_status.upstream_branch;
    item.detached = tree_status.detached;
    item.clean = tree_status.clean;
    item.staged_count = tree_status.staged_count;
    item.unstaged_count = tree_status.unstaged_count;
    item.untracked_count = tree_status.untracked_count;
    item.conflicted_count = tree_status.conflicted_count;
    item.changed_files = tree_status
        .files
        .into_iter()
        .map(|file| file.path)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    item.repository_observed = true;
    Ok(())
}

fn review_against_base(
    repo_path: &Path,
    base_ref: &str,
    item: &mut WorkspaceReviewItem,
) -> Result<()> {
    item.base_commit = Some(git::revision_commit(repo_path, base_ref)?);
    let (ahead, behind) = git::revision_ahead_behind(repo_path, base_ref, "HEAD")?;
    item.ahead = Some(ahead);
    item.behind = Some(behind);
    item.comparable = true;
    item.changed_files
        .extend(git::revision_changed_paths(repo_path, base_ref)?);
    item.changed_files.sort();
    item.changed_files.dedup();
    let diff_check = git::revision_diff_check(repo_path, base_ref)?;
    item.diff_check_passed = Some(diff_check.success);
    item.diff_check_output = (!diff_check.output.is_empty()).then_some(diff_check.output);
    Ok(())
}

fn unexpected_files(
    changed_files: &[String],
    allowed_paths: &[String],
    path_allowlist_applied: bool,
) -> Vec<String> {
    if !path_allowlist_applied {
        return Vec::new();
    }
    changed_files
        .iter()
        .filter(|path| {
            !allowed_paths
                .iter()
                .any(|pattern| path_matches(path, pattern))
        })
        .cloned()
        .collect()
}

fn path_matches(path: &str, pattern: &str) -> bool {
    let pattern = pattern.trim().trim_start_matches("./");
    if pattern.is_empty() {
        return false;
    }
    if let Some(prefix) = pattern.strip_suffix("/**") {
        return path == prefix || path.starts_with(&format!("{prefix}/"));
    }
    if pattern.ends_with('/') {
        return path.starts_with(pattern);
    }
    path == pattern
}

fn push_risk(
    risks: &mut Vec<WorkspaceReviewRisk>,
    project_key: &str,
    code: &str,
    severity: &str,
    summary: &str,
) {
    risks.push(WorkspaceReviewRisk {
        code: code.to_string(),
        severity: severity.to_string(),
        project_key: project_key.to_string(),
        summary: summary.to_string(),
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ProjectWorkspaceProjectInstanceConfig;
    use std::fs;
    use std::process::Command;
    use uuid::Uuid;

    fn run_git(repo: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(["-C"])
            .arg(repo)
            .args(args)
            .output()
            .expect("run git command");
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    struct ReviewFixture {
        root: std::path::PathBuf,
        instance_repo: std::path::PathBuf,
        config: AppConfig,
        workspace: ProjectWorkspaceConfig,
    }

    impl Drop for ReviewFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn review_fixture() -> ReviewFixture {
        let root =
            std::env::temp_dir().join(format!("rdevtool-workspace-review-{}", Uuid::new_v4()));
        let configured_repo = root.join("configured");
        let instance_repo = root.join("instance");
        fs::create_dir_all(&configured_repo).expect("create configured path");
        fs::create_dir_all(instance_repo.join("src")).expect("create instance path");
        run_git(&instance_repo, &["init"]);
        run_git(
            &instance_repo,
            &["config", "user.email", "rdevtool-test@example.com"],
        );
        run_git(&instance_repo, &["config", "user.name", "rDevTool Test"]);
        fs::write(instance_repo.join("src/app.rs"), "fn main() {}\n").expect("write source");
        run_git(&instance_repo, &["add", "src/app.rs"]);
        run_git(&instance_repo, &["commit", "-m", "initial"]);
        run_git(&instance_repo, &["branch", "-M", "main"]);
        run_git(&instance_repo, &["checkout", "-b", "feature-a"]);

        let config: AppConfig = toml::from_str(&format!(
            r#"
[defaults]

[[projects]]
key = "sample"
name = "Sample"
repo_path = "{}"
git_url = ""
"#,
            configured_repo.display()
        ))
        .expect("parse config");
        let workspace = ProjectWorkspaceConfig {
            key: "feature-a".to_string(),
            name: "Feature A".to_string(),
            description: None,
            archive: None,
            workspace_type: "business".to_string(),
            metadata: BTreeMap::new(),
            root_dir: Some(root.clone()),
            resource_dir: None,
            worklog_file: None,
            worklog_auto_record: false,
            include_all_projects: false,
            include_all_navigation: false,
            projects: vec!["sample".to_string()],
            navigation_categories: Vec::new(),
            navigation_entries: Vec::new(),
            project_instances: vec![ProjectWorkspaceProjectInstanceConfig {
                project: "sample".to_string(),
                path: instance_repo.clone(),
                managed: true,
            }],
            resource_categories: Vec::new(),
        };

        ReviewFixture {
            root,
            instance_repo,
            config,
            workspace,
        }
    }

    #[test]
    fn reviews_effective_instance_against_explicit_base_and_path_allowlist() {
        let fixture = review_fixture();
        fs::write(fixture.instance_repo.join("src/app.rs"), "fn main() {  }\n")
            .expect("change source");
        let response = review_workspace(
            &fixture.config,
            &fixture.workspace,
            WorkspaceReviewRequest {
                bases: BTreeMap::from([("sample".to_string(), "main".to_string())]),
                allowed_paths: BTreeMap::from([("sample".to_string(), vec!["src/**".to_string()])]),
            },
        );

        assert!(response.status.success);
        assert_eq!(response.items.len(), 1);
        let item = &response.items[0];
        assert_eq!(item.path_source, "workspaceProjectInstance");
        assert_eq!(
            item.effective_repo_path.as_deref(),
            Some(fixture.instance_repo.to_string_lossy().as_ref())
        );
        assert!(item.repository_observed);
        assert!(!item.detached);
        assert!(item.comparable);
        assert_eq!(item.ahead, Some(0));
        assert_eq!(item.behind, Some(0));
        assert_eq!(item.changed_files, vec!["src/app.rs"]);
        assert!(item.path_allowlist_applied);
        assert!(item.unexpected_files.is_empty());
        assert_eq!(item.diff_check_passed, Some(true));
        assert_eq!(response.summary.repository_observed_count, 1);
        assert_eq!(response.summary.path_scope_checked_count, 1);
    }

    #[test]
    fn reports_files_outside_an_explicit_path_allowlist() {
        let fixture = review_fixture();
        fs::write(fixture.instance_repo.join("src/app.rs"), "fn main() {  }\n")
            .expect("change source");

        let response = review_workspace(
            &fixture.config,
            &fixture.workspace,
            WorkspaceReviewRequest {
                bases: BTreeMap::from([("sample".to_string(), "main".to_string())]),
                allowed_paths: BTreeMap::from([(
                    "sample".to_string(),
                    vec!["docs/**".to_string()],
                )]),
            },
        );

        assert!(!response.status.success);
        assert_eq!(response.items[0].unexpected_files, vec!["src/app.rs"]);
        assert!(
            response
                .risks
                .iter()
                .any(|risk| risk.code == "unexpectedPaths")
        );
    }

    #[test]
    fn distinguishes_an_absent_allowlist_from_an_explicit_empty_allowlist() {
        let fixture = review_fixture();
        fs::write(fixture.instance_repo.join("src/app.rs"), "fn main() {  }\n")
            .expect("change source");

        let without_allowlist = review_workspace(
            &fixture.config,
            &fixture.workspace,
            WorkspaceReviewRequest {
                bases: BTreeMap::from([("sample".to_string(), "main".to_string())]),
                allowed_paths: BTreeMap::new(),
            },
        );
        assert!(without_allowlist.status.success);
        assert!(!without_allowlist.items[0].path_allowlist_applied);
        assert!(without_allowlist.items[0].unexpected_files.is_empty());

        let with_empty_allowlist = review_workspace(
            &fixture.config,
            &fixture.workspace,
            WorkspaceReviewRequest {
                bases: BTreeMap::from([("sample".to_string(), "main".to_string())]),
                allowed_paths: BTreeMap::from([("sample".to_string(), Vec::new())]),
            },
        );
        assert!(!with_empty_allowlist.status.success);
        assert!(with_empty_allowlist.items[0].path_allowlist_applied);
        assert_eq!(
            with_empty_allowlist.items[0].unexpected_files,
            vec!["src/app.rs"]
        );
    }

    #[test]
    fn reports_missing_base_and_diff_check_failures() {
        let fixture = review_fixture();
        fs::write(
            fixture.instance_repo.join("src/app.rs"),
            "fn main() {}\n// trailing whitespace   \n",
        )
        .expect("change source");

        let without_base = review_workspace(
            &fixture.config,
            &fixture.workspace,
            WorkspaceReviewRequest::default(),
        );
        assert!(!without_base.status.success);
        assert!(!without_base.items[0].comparable);
        assert_eq!(without_base.items[0].diff_check_passed, None);
        assert!(
            without_base
                .risks
                .iter()
                .any(|risk| risk.code == "baseNotConfigured")
        );

        let with_base = review_workspace(
            &fixture.config,
            &fixture.workspace,
            WorkspaceReviewRequest {
                bases: BTreeMap::from([("sample".to_string(), "main".to_string())]),
                allowed_paths: BTreeMap::new(),
            },
        );
        assert_eq!(with_base.items[0].diff_check_passed, Some(false));
        assert!(
            with_base
                .risks
                .iter()
                .any(|risk| risk.code == "diffCheckFailed")
        );
    }

    #[test]
    fn treats_detached_head_as_needing_attention() {
        let fixture = review_fixture();
        run_git(&fixture.instance_repo, &["checkout", "--detach"]);

        let response = review_workspace(
            &fixture.config,
            &fixture.workspace,
            WorkspaceReviewRequest {
                bases: BTreeMap::from([("sample".to_string(), "main".to_string())]),
                allowed_paths: BTreeMap::new(),
            },
        );

        assert!(!response.status.success);
        assert!(response.items[0].repository_observed);
        assert!(response.items[0].detached);
        assert_eq!(response.items[0].current_branch, None);
        assert!(
            response
                .risks
                .iter()
                .any(|risk| risk.code == "detachedHead")
        );
        assert_eq!(response.summary.detached_project_count, 1);
    }

    #[test]
    fn repository_observation_failure_cannot_be_ready() {
        let fixture = review_fixture();
        fs::remove_dir_all(fixture.instance_repo.join(".git")).expect("remove temporary git data");

        let response = review_workspace(
            &fixture.config,
            &fixture.workspace,
            WorkspaceReviewRequest::default(),
        );

        assert!(!response.status.success);
        assert!(!response.items[0].repository_observed);
        assert_eq!(response.items[0].status_key, "needsAttention");
        assert!(
            response
                .risks
                .iter()
                .any(|risk| risk.code == "repositoryReviewFailed")
        );
    }
}
