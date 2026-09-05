use std::cell::RefCell;

use anyhow::Result;
use rdevtool_core::config::{
    ConfigPaths, ProjectWorkspaceConfig, active_project_workspace_key,
    load_active_project_workspace, load_project_workspace_by_key, load_workspace_config,
};

thread_local! {
    static COMMAND_WORKSPACE_KEY: RefCell<Option<String>> = const { RefCell::new(None) };
}

pub struct CommandWorkspaceGuard {
    previous: Option<String>,
}

impl Drop for CommandWorkspaceGuard {
    fn drop(&mut self) {
        COMMAND_WORKSPACE_KEY.with(|slot| {
            slot.replace(self.previous.take());
        });
    }
}

pub fn install(workspace: Option<String>) -> Result<CommandWorkspaceGuard> {
    let workspace = workspace
        .map(|value| value.trim().to_string())
        .map(|value| {
            if value.is_empty() {
                anyhow::bail!("--workspace requires a non-empty workspace key");
            }
            Ok(value)
        })
        .transpose()?;
    let previous = COMMAND_WORKSPACE_KEY.with(|slot| slot.replace(workspace));
    Ok(CommandWorkspaceGuard { previous })
}

pub fn workspace_key() -> Option<String> {
    COMMAND_WORKSPACE_KEY.with(|slot| slot.borrow().clone())
}

pub fn load_workspace(paths: &ConfigPaths) -> Result<ProjectWorkspaceConfig> {
    let workspace = match workspace_key() {
        Some(key) => load_project_workspace_by_key(&paths.project_workspaces, &key),
        None => load_active_project_workspace(paths),
    }?;
    if workspace.is_archived() {
        anyhow::bail!(
            "project workspace is archived: {}; restore it before running workspace operations",
            workspace.key
        );
    }
    Ok(workspace)
}

pub fn resolve_workspace_key(paths: &ConfigPaths, explicit: Option<String>) -> Result<String> {
    if let Some(explicit) = explicit {
        let explicit = explicit.trim();
        if !explicit.is_empty() {
            return Ok(explicit.to_string());
        }
    }
    if let Some(key) = workspace_key() {
        return Ok(key);
    }
    Ok(active_project_workspace_key(&load_workspace_config(
        &paths.workspace,
    )?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rdevtool_core::config::{ProjectWorkspaceArchiveConfig, save_project_workspace_config};
    use std::fs;
    use uuid::Uuid;

    #[test]
    fn command_workspace_scope_is_nested_and_restored() {
        assert_eq!(workspace_key(), None);
        {
            let _outer = install(Some("feature-a".to_string())).expect("install outer scope");
            assert_eq!(workspace_key().as_deref(), Some("feature-a"));
            {
                let _inner = install(Some("feature-b".to_string())).expect("install inner scope");
                assert_eq!(workspace_key().as_deref(), Some("feature-b"));
            }
            assert_eq!(workspace_key().as_deref(), Some("feature-a"));
        }
        assert_eq!(workspace_key(), None);
    }

    #[test]
    fn command_workspace_scope_rejects_empty_keys() {
        assert!(install(Some("   ".to_string())).is_err());
        assert_eq!(workspace_key(), None);
    }

    #[test]
    fn archived_workspace_cannot_be_used_as_command_scope() {
        let dir = std::env::temp_dir().join(format!("rdevtool-cli-scope-{}", Uuid::new_v4()));
        let paths = ConfigPaths {
            projects: dir.join("projects.toml"),
            workspace: dir.join("workspace.toml"),
            project_workspaces: dir.join("project-workspaces"),
            dir: dir.clone(),
        };
        fs::create_dir_all(&paths.project_workspaces).expect("create workspace directory");
        let workspace = ProjectWorkspaceConfig {
            key: "feature-a".to_string(),
            name: "Feature A".to_string(),
            archive: Some(ProjectWorkspaceArchiveConfig {
                archived_at: "2026-07-28T08:00:00Z".to_string(),
                reason: None,
            }),
            ..ProjectWorkspaceConfig::default()
        };
        save_project_workspace_config(&paths.project_workspaces.join("feature-a.toml"), &workspace)
            .expect("save archived workspace");

        let _scope = install(Some("feature-a".to_string())).expect("install workspace scope");
        let error = load_workspace(&paths).expect_err("archived workspace scope must fail");

        assert!(error.to_string().contains("restore it"));
        fs::remove_dir_all(dir).expect("remove test directory");
    }
}
