use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use serde::Serialize;

use crate::config::{ProjectConfig, ProjectWorkspaceProjectInstanceConfig};
use crate::git;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceProjectInstanceValidation {
    pub project_key: String,
    pub requested_path: String,
    pub effective_path: String,
    pub repository_root: String,
    pub configured_remote: Option<String>,
    pub observed_remotes: Vec<String>,
    pub remote_matches: Option<bool>,
    pub remote_mismatch_allowed: bool,
}

pub fn validate_workspace_project_instance(
    project: &ProjectConfig,
    instance: &ProjectWorkspaceProjectInstanceConfig,
    allow_remote_mismatch: bool,
) -> Result<WorkspaceProjectInstanceValidation> {
    let requested_path = instance.path.display().to_string();
    let metadata = fs::metadata(&instance.path).with_context(|| {
        format!(
            "project instance path does not exist for {}: {}",
            project.key,
            instance.path.display()
        )
    })?;
    if !metadata.is_dir() {
        bail!(
            "project instance path must be a directory for {}: {}",
            project.key,
            instance.path.display()
        );
    }

    let effective_path = fs::canonicalize(&instance.path).with_context(|| {
        format!(
            "failed to resolve project instance path for {}: {}",
            project.key,
            instance.path.display()
        )
    })?;
    let repository_root = git::repository_root(&effective_path).with_context(|| {
        format!(
            "project instance path is not a Git repository for {}: {}",
            project.key,
            effective_path.display()
        )
    })?;
    let repository_root = fs::canonicalize(&repository_root).with_context(|| {
        format!(
            "failed to resolve Git repository root for {}: {}",
            project.key,
            repository_root.display()
        )
    })?;
    if effective_path != repository_root {
        bail!(
            "project instance path must be the Git repository root for {}: requested {}, root {}",
            project.key,
            effective_path.display(),
            repository_root.display()
        );
    }

    let observed_remotes = git::remote_urls(&effective_path).with_context(|| {
        format!(
            "failed to inspect Git remotes for project instance {} at {}",
            project.key,
            effective_path.display()
        )
    })?;
    let configured_remote = normalized_optional_remote(&project.git_url);
    let normalized_observed = observed_remotes
        .iter()
        .filter_map(|value| normalized_optional_remote(value))
        .collect::<Vec<_>>();
    let remote_matches = configured_remote.as_ref().map(|expected| {
        normalized_observed
            .iter()
            .any(|observed| observed == expected)
    });
    if remote_matches == Some(false) && !allow_remote_mismatch {
        let observed = if observed_remotes.is_empty() {
            "<none>".to_string()
        } else {
            observed_remotes.join(", ")
        };
        bail!(
            "project instance remote mismatch for {}: configured {}, observed {}; use --allow-remote-mismatch only when this binding is intentional",
            project.key,
            project.git_url.trim(),
            observed
        );
    }

    Ok(WorkspaceProjectInstanceValidation {
        project_key: project.key.clone(),
        requested_path,
        effective_path: effective_path.display().to_string(),
        repository_root: repository_root.display().to_string(),
        configured_remote,
        observed_remotes,
        remote_matches,
        remote_mismatch_allowed: remote_matches == Some(false) && allow_remote_mismatch,
    })
}

fn normalized_optional_remote(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| normalize_git_remote(value))
}

fn normalize_git_remote(value: &str) -> String {
    let value = value.trim().trim_end_matches('/').trim_end_matches(".git");
    if let Ok(url) = reqwest::Url::parse(value) {
        if url.scheme() == "file" {
            return url
                .to_file_path()
                .unwrap_or_else(|_| PathBuf::from(url.path()))
                .display()
                .to_string();
        }
        if let Some(host) = url.host_str() {
            let default_port = match url.scheme() {
                "http" => Some(80),
                "https" => Some(443),
                "ssh" => Some(22),
                _ => None,
            };
            let authority = match url.port().filter(|port| Some(*port) != default_port) {
                Some(port) => format!("{}:{}", host.to_ascii_lowercase(), port),
                None => host.to_ascii_lowercase(),
            };
            return format!(
                "{}/{}",
                authority,
                url.path().trim_start_matches('/').trim_end_matches(".git")
            )
            .trim_end_matches('/')
            .to_string();
        }
    }
    if !value.starts_with('/')
        && let Some((authority, path)) = value.split_once(':')
        && !authority.contains('/')
    {
        let host = authority
            .rsplit_once('@')
            .map(|(_, host)| host)
            .unwrap_or(authority);
        return format!(
            "{}/{}",
            host.to_ascii_lowercase(),
            path.trim_start_matches('/').trim_end_matches(".git")
        )
        .trim_end_matches('/')
        .to_string();
    }
    Path::new(value).display().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{BranchRules, Jobs, ProjectFocusConfig};
    use std::process::Command;
    use uuid::Uuid;

    fn project(git_url: &str) -> ProjectConfig {
        ProjectConfig {
            key: "sample".to_string(),
            name: "Sample".to_string(),
            category: "Workspace".to_string(),
            repo_path: None,
            git_url: git_url.to_string(),
            deploy_targets: Vec::new(),
            jobs: Jobs::default(),
            dev: None,
            build: None,
            focus: ProjectFocusConfig::default(),
            branch_rules: BranchRules::default(),
            debug_profiles: Vec::new(),
        }
    }

    fn git(repo: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(args)
            .status()
            .expect("run git");
        assert!(status.success(), "git command failed: {args:?}");
    }

    #[test]
    fn normalizes_ssh_and_https_git_remotes_to_the_same_identity() {
        assert_eq!(
            normalize_git_remote("git@example.com:team/project.git"),
            normalize_git_remote("https://example.com/team/project.git")
        );
    }

    #[test]
    fn keeps_distinct_repository_paths_distinct() {
        assert_ne!(
            normalize_git_remote("https://example.com/team/project-a.git"),
            normalize_git_remote("https://example.com/team/project-b.git")
        );
        assert_ne!(
            normalize_git_remote("http://example.com:8181/team/project.git"),
            normalize_git_remote("http://example.com:8282/team/project.git")
        );
        assert_eq!(
            normalize_git_remote("https://example.com:443/team/project.git"),
            normalize_git_remote("https://example.com/team/project.git")
        );
    }

    #[test]
    fn validates_repository_root_and_normalized_remote_identity() {
        let root =
            std::env::temp_dir().join(format!("rdevtool-workspace-instance-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create repo");
        git(&root, &["init"]);
        git(&root, &["symbolic-ref", "HEAD", "refs/heads/main"]);
        git(
            &root,
            &[
                "remote",
                "add",
                "origin",
                "git@example.com:team/project.git",
            ],
        );
        let instance = ProjectWorkspaceProjectInstanceConfig {
            project: "sample".to_string(),
            path: root.clone(),
            managed: false,
        };

        let validation = validate_workspace_project_instance(
            &project("https://example.com/team/project.git"),
            &instance,
            false,
        )
        .expect("matching remote should validate");
        assert_eq!(validation.remote_matches, Some(true));

        let mismatch = validate_workspace_project_instance(
            &project("https://example.com/team/other.git"),
            &instance,
            false,
        );
        assert!(mismatch.is_err());
        let allowed = validate_workspace_project_instance(
            &project("https://example.com/team/other.git"),
            &instance,
            true,
        )
        .expect("explicit remote mismatch should be allowed");
        assert_eq!(allowed.remote_matches, Some(false));
        assert!(allowed.remote_mismatch_allowed);
        let _ = fs::remove_dir_all(root);
    }
}
