use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime, State};

use rdevtool_core::proxy_daemon::proxy_daemon_status;
use rdevtool_core::runtime_daemon::{RuntimeProcessIdentity, listening_processes};

use crate::{AppState, apply_active_workspace_context, proxy_path_for_source_id};

pub(crate) const ACTIVE_SESSIONS_CHANGED_EVENT: &str = "rdevtool://active-sessions-changed";

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveSessionsChangedPayload {
    revision: u64,
    workspace_key: String,
    domain: String,
    action: String,
}

pub(crate) fn notify_active_sessions_changed<R: Runtime>(
    app: &AppHandle<R>,
    workspace_key: &str,
    domain: &str,
    action: &str,
) {
    let _ = app.emit(
        ACTIVE_SESSIONS_CHANGED_EVENT,
        ActiveSessionsChangedPayload {
            revision: unix_time_ms(),
            workspace_key: workspace_key.to_string(),
            domain: domain.to_string(),
            action: action.to_string(),
        },
    );
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActiveSessionPortProcess {
    pid: u32,
    ppid: u32,
    pgid: u32,
    name: String,
    command: String,
    cwd: String,
    started_at: String,
    matches_expected_pid: bool,
    matches_expected_directory: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActiveSessionPortInspection {
    port: u16,
    inspected_at_ms: u64,
    platform_supported: bool,
    listening: bool,
    ownership_key: String,
    ownership_verified: bool,
    expected_pid: Option<u32>,
    expected_directory_path: Option<String>,
    listeners: Vec<ActiveSessionPortProcess>,
}

fn normalized_path(value: &str) -> Option<PathBuf> {
    let path = value.trim();
    if path.is_empty() {
        return None;
    }
    Some(fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path)))
}

fn directory_matches(expected: &str, observed: &str) -> bool {
    let Some(expected) = normalized_path(expected) else {
        return false;
    };
    let Some(observed) = normalized_path(observed) else {
        return false;
    };
    observed == expected
        || (expected.components().count() >= 3 && observed.starts_with(expected.as_path()))
}

fn process_name(command: &str) -> String {
    command
        .split_whitespace()
        .next()
        .and_then(|value| Path::new(value).file_name())
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown")
        .to_string()
}

fn redact_process_command(command: &str) -> String {
    let normalized = command.to_ascii_lowercase();
    let contains_sensitive_argument = [
        "password",
        "passwd",
        "secret",
        "token",
        "authorization",
        "credential",
        "cookie",
        "api-key",
        "apikey",
        "private-key",
        "bearer",
    ]
    .iter()
    .any(|marker| normalized.contains(marker));
    let contains_credential_url = normalized.contains("://") && normalized.contains('@');
    if contains_sensitive_argument || contains_credential_url {
        return format!("{} [arguments redacted]", process_name(command));
    }
    command.to_string()
}

fn ownership_for(
    listeners: &[ActiveSessionPortProcess],
    expected_pid: Option<u32>,
    expected_directory_path: Option<&str>,
    platform_supported: bool,
) -> (&'static str, bool) {
    if !platform_supported {
        return ("unsupported", false);
    }
    if listeners.is_empty() {
        return ("notListening", false);
    }
    if listeners
        .iter()
        .any(|listener| listener.matches_expected_pid)
    {
        return ("expectedPid", true);
    }
    if listeners
        .iter()
        .any(|listener| listener.matches_expected_directory)
    {
        return ("expectedDirectory", false);
    }
    if expected_pid.is_some() || expected_directory_path.is_some() {
        return ("mismatch", false);
    }
    ("unverified", false)
}

fn inspect_port(
    port: u16,
    expected_pid: Option<u32>,
    expected_directory_path: Option<String>,
) -> Result<ActiveSessionPortInspection, String> {
    let platform_supported = cfg!(unix);
    let listeners = listening_processes(port).map_err(|error| error.to_string())?;
    let listeners = listeners
        .into_iter()
        .map(|process: RuntimeProcessIdentity| {
            let matches_expected_pid = expected_pid == Some(process.pid);
            let matches_expected_directory = expected_directory_path
                .as_deref()
                .is_some_and(|expected| directory_matches(expected, &process.canonical_cwd));
            let name = process_name(&process.command);
            let command = redact_process_command(&process.command);
            ActiveSessionPortProcess {
                pid: process.pid,
                ppid: process.ppid,
                pgid: process.pgid,
                name,
                command,
                cwd: process.canonical_cwd,
                started_at: process.started_at,
                matches_expected_pid,
                matches_expected_directory,
            }
        })
        .collect::<Vec<_>>();
    let (ownership_key, ownership_verified) = ownership_for(
        &listeners,
        expected_pid,
        expected_directory_path.as_deref(),
        platform_supported,
    );
    Ok(ActiveSessionPortInspection {
        port,
        inspected_at_ms: unix_time_ms(),
        platform_supported,
        listening: !listeners.is_empty(),
        ownership_key: ownership_key.to_string(),
        ownership_verified,
        expected_pid,
        expected_directory_path,
        listeners,
    })
}

#[tauri::command]
pub(crate) async fn inspect_active_session_port(
    state: State<'_, AppState>,
    port: u16,
    project_key: Option<String>,
    proxy_source_id: Option<String>,
    proxy_profile_id: Option<String>,
) -> Result<ActiveSessionPortInspection, String> {
    if port == 0 {
        return Err("端口必须在 1-65535 之间".to_string());
    }
    let runtime = state.project_runtime.clone();
    let config_state = state.config_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let project_key = project_key
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let proxy_source_id = proxy_source_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let proxy_profile_id = proxy_profile_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let expected = if let Some(project_key) = project_key {
            let config = apply_active_workspace_context(&config_state.load()?)?;
            runtime
                .list_selected(&config, &[project_key.to_string()])?
                .into_iter()
                .next()
                .map(|snapshot| (snapshot.pid, snapshot.cwd.or(snapshot.repo_path)))
        } else if let (Some(source_id), Some(profile_id)) = (proxy_source_id, proxy_profile_id) {
            let (_, path) = proxy_path_for_source_id(Some(source_id.to_string()))?;
            let status =
                proxy_daemon_status(&path, profile_id).map_err(|error| error.to_string())?;
            Some((status.managed.then_some(status.pid).flatten(), None))
        } else {
            None
        };
        let (expected_pid, expected_directory_path) = expected.unwrap_or((None, None));
        inspect_port(port, expected_pid, expected_directory_path)
    })
    .await
    .map_err(|error| error.to_string())?
}

pub(crate) fn tray_active_session_change(kind: &str) -> Option<(&'static str, &'static str)> {
    match kind {
        "project.runtime.start" => Some(("runtime", "start")),
        "project.runtime.stop" => Some(("runtime", "stop")),
        "project.build.run" => Some(("build", "start")),
        "proxy.start" => Some(("proxy", "start")),
        "proxy.stop" => Some(("proxy", "stop")),
        "link.run" => Some(("link", "run")),
        "link.stop" => Some(("link", "stop")),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ActiveSessionPortProcess, directory_matches, ownership_for, redact_process_command,
        tray_active_session_change,
    };

    #[test]
    fn maps_only_tray_actions_that_change_active_sessions() {
        assert_eq!(
            tray_active_session_change("project.runtime.start"),
            Some(("runtime", "start"))
        );
        assert_eq!(
            tray_active_session_change("proxy.stop"),
            Some(("proxy", "stop"))
        );
        assert_eq!(tray_active_session_change("project.runtime.focus"), None);
        assert_eq!(tray_active_session_change("project.build.openOutput"), None);
    }

    fn listener(pid: u32, matches_pid: bool, matches_directory: bool) -> ActiveSessionPortProcess {
        ActiveSessionPortProcess {
            pid,
            ppid: 1,
            pgid: pid,
            name: "node".to_string(),
            command: "node server.js".to_string(),
            cwd: "/tmp/project".to_string(),
            started_at: "today".to_string(),
            matches_expected_pid: matches_pid,
            matches_expected_directory: matches_directory,
        }
    }

    #[test]
    fn classifies_listener_ownership_conservatively() {
        assert_eq!(
            ownership_for(
                &[listener(42, true, true)],
                Some(42),
                Some("/tmp/project"),
                true
            ),
            ("expectedPid", true)
        );
        assert_eq!(
            ownership_for(
                &[listener(43, false, true)],
                Some(42),
                Some("/tmp/project"),
                true
            ),
            ("expectedDirectory", false)
        );
        assert_eq!(
            ownership_for(
                &[listener(43, false, false)],
                Some(42),
                Some("/tmp/project"),
                true
            ),
            ("mismatch", false)
        );
    }

    #[test]
    fn directory_match_accepts_project_children_but_not_siblings() {
        assert!(directory_matches("/tmp/project", "/tmp/project/apps/web"));
        assert!(!directory_matches("/tmp/project", "/tmp/project-copy"));
    }

    #[test]
    fn redacts_process_commands_with_sensitive_arguments() {
        assert_eq!(
            redact_process_command("node server.js --token very-secret"),
            "node [arguments redacted]"
        );
        assert_eq!(
            redact_process_command("node server.js --port 1420"),
            "node server.js --port 1420"
        );
    }
}
