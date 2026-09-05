use rdevtool_core::config::{
    AppConfig, ProjectAuthHelperConfig, ProjectAuthHelperItemConfig, ProjectCommandConfig,
    ProjectConfig, ProjectDebugProfileConfig, ProjectLocalProxyConfig,
    ProjectLocalProxyRouteConfig, ProjectReadyConfig, RuntimeProfileConfig, default_config_dir,
};
use rdevtool_core::navigation::{NavigationEntry, open_in_current_chrome};
pub use rdevtool_core::runtime::{
    ProjectRuntimeLaunchOptions, ProjectRuntimeLogKind, ProjectRuntimeLogResponse,
    ProjectRuntimeLogSessionSummary, ProjectRuntimePreflightResponse,
    ProjectRuntimeReadyProbeSummary, ProjectRuntimeReadySummary,
};
use rdevtool_core::runtime::{
    adopt_project_runtime_with_options as core_adopt_project_runtime,
    clear_project_runtime_log as core_clear_project_runtime_log,
    detect_external_project_runtime_for_project_with_options, project_runtime_candidate_cwds,
    project_runtime_preflight_for_project_with_options,
    read_project_runtime_log as core_read_project_runtime_log,
    start_project_runtime_detached_with_options as core_start_project_runtime,
};
use rdevtool_core::runtime_daemon::{self, RuntimeDaemonPhase, RuntimeDaemonStatus};
use rdevtool_core::web_actions::{
    WebActionRunRequest, open_web_action_navigation_target, run_web_action_navigation,
};
use serde::Serialize;
use serde_json::json;
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeSnapshot {
    pub key: String,
    pub name: String,
    pub category: String,
    pub repo_path: Option<String>,
    pub command: Option<String>,
    pub cwd: Option<String>,
    pub focus_url: Option<String>,
    pub ready_url: Option<String>,
    pub status_key: String,
    pub status_label: String,
    pub detail: String,
    pub pid: Option<u32>,
    pub started_at_ms: Option<u64>,
    pub log_path: Option<String>,
    pub build_command: Option<String>,
    pub build_cwd: Option<String>,
    pub build_output_dir: Option<String>,
    pub build_status_key: String,
    pub build_status_label: String,
    pub build_detail: String,
    pub build_pid: Option<u32>,
    pub build_started_at_ms: Option<u64>,
    pub build_log_path: Option<String>,
    pub updated_at_ms: u64,
    pub can_start: bool,
    pub can_stop: bool,
    pub can_adopt: bool,
    pub can_build: bool,
    pub can_stop_build: bool,
    pub can_open_build_output: bool,
    pub can_focus_runtime: bool,
    pub debug_profiles: Vec<ProjectDebugProfileSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDebugProfileSummary {
    pub key: String,
    pub label: String,
    pub command: Option<String>,
    pub cwd: Option<String>,
    pub expected_port: Option<u16>,
    pub focus_url: Option<String>,
    pub ready_probe: Option<ProjectRuntimeReadyProbeSummary>,
    pub env: BTreeMap<String, String>,
    pub env_count: usize,
    pub local_file_count: usize,
    pub browser: Option<String>,
    pub browser_profile: Option<String>,
    pub browser_user_data_dir: Option<String>,
    pub browser_args: Vec<String>,
    pub network_proxy: ProjectNetworkProxySummary,
    pub local_proxy: ProjectLocalProxySummary,
    pub runtime_profile: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectNetworkProxySummary {
    pub enabled: bool,
    pub proxy_url: String,
    pub inject_env: bool,
    pub node_hook: bool,
    pub no_proxy: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLocalProxySummary {
    pub enabled: bool,
    pub listen: String,
    pub frontend_url: String,
    pub upstream_proxy: String,
    pub routes: Vec<ProjectLocalProxyRouteSummary>,
    pub auth_helper: ProjectAuthHelperSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLocalProxyRouteSummary {
    pub enabled: bool,
    pub match_prefix: String,
    pub target: String,
    pub rewrite_prefix: String,
    pub headers_text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAuthHelperSummary {
    pub enabled: bool,
    pub path: String,
    pub redirect_path: String,
    pub items: Vec<ProjectAuthHelperItemSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAuthHelperItemSummary {
    pub enabled: bool,
    pub storage: String,
    pub key: String,
    pub from_json_path: String,
    pub value: String,
    pub cookie_path: String,
    pub cookie_max_age_seconds: Option<i64>,
    pub cookie_same_site: String,
}

#[derive(Clone, Default)]
pub struct ProjectRuntimeState {
    inner: Arc<ProjectRuntimeRegistry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStartedRuntimeSummary {
    pub count: usize,
    pub project_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStartedRuntimeShutdownReport {
    pub requested: usize,
    pub stopped: usize,
    pub skipped: usize,
    pub failures: Vec<String>,
}

#[derive(Default)]
struct ProjectRuntimeRegistry {
    state: Mutex<ProjectRuntimeStore>,
}

#[derive(Default)]
struct ProjectRuntimeStore {
    running_builds: HashMap<String, RunningProjectProcess>,
    last_build_results: HashMap<String, ProjectTaskLastState>,
    app_started_runtimes: HashMap<String, AppStartedRuntimeSession>,
    external_runtime_cache: HashMap<ExternalRuntimeCacheKey, ExternalRuntimeCacheEntry>,
}

impl ProjectRuntimeStore {
    fn build_parts(
        &mut self,
    ) -> (
        &mut HashMap<String, RunningProjectProcess>,
        &mut HashMap<String, ProjectTaskLastState>,
    ) {
        (&mut self.running_builds, &mut self.last_build_results)
    }
}

struct RunningProjectProcess {
    child: Child,
    pid: u32,
    started_at_ms: u64,
}

#[derive(Clone)]
struct AppStartedRuntimeSession {
    status_key: String,
    project_key: String,
    project_name: String,
    cwd: PathBuf,
    run_id: String,
}

#[derive(Clone)]
struct ProjectTaskLastState {
    status_key: String,
    status_label: String,
    detail: String,
    updated_at_ms: u64,
}

#[derive(Clone)]
struct ExternalRuntimeCacheEntry {
    checked_at_ms: u64,
    detection: Option<rdevtool_core::runtime::ProjectRuntimeExternalDetection>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct ExternalRuntimeCacheKey {
    project_key: String,
    canonical_cwd: PathBuf,
    command: String,
    focus_url: String,
}

#[derive(Clone)]
struct ResolvedProjectCommand {
    command: String,
    cwd: PathBuf,
    env: HashMap<String, String>,
}

#[derive(Clone)]
struct TaskDisplayConfig {
    configured: bool,
    command: Option<String>,
    cwd: Option<String>,
    output_dir: Option<String>,
}

struct RuntimeDisplayConfig {
    repo_path: Option<String>,
    dev: TaskDisplayConfig,
    build: TaskDisplayConfig,
}

enum ProjectFocusTarget {
    Url(String),
    AppBundle(String),
}

struct TaskSnapshotState {
    status_key: String,
    status_label: String,
    detail: String,
    ready_url: Option<String>,
    pid: Option<u32>,
    started_at_ms: Option<u64>,
    updated_at_ms: u64,
    is_running: bool,
    is_available: bool,
    can_stop: bool,
    can_adopt: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ProjectCommandKind {
    Dev,
    Build,
}

impl Drop for ProjectRuntimeRegistry {
    fn drop(&mut self) {
        if let Ok(mut store) = self.state.lock() {
            shutdown_runtime_store(&mut store);
        }
    }
}

impl ProjectRuntimeState {
    pub fn list(&self, config: &AppConfig) -> Result<Vec<ProjectRuntimeSnapshot>, String> {
        let daemon_statuses = runtime_daemon::list().map_err(|error| error.to_string())?;
        self.list_with_daemon_statuses(config, &daemon_statuses)
    }

    pub fn list_with_daemon_statuses(
        &self,
        config: &AppConfig,
        daemon_statuses: &[RuntimeDaemonStatus],
    ) -> Result<Vec<ProjectRuntimeSnapshot>, String> {
        let mut store = self
            .inner
            .state
            .lock()
            .map_err(|_| "project runtime lock poisoned".to_string())?;
        config
            .projects
            .iter()
            .map(|project| {
                snapshot_for_project_with_daemon_statuses(&mut store, project, daemon_statuses)
            })
            .collect()
    }

    pub fn list_selected(
        &self,
        config: &AppConfig,
        project_keys: &[String],
    ) -> Result<Vec<ProjectRuntimeSnapshot>, String> {
        let daemon_statuses = runtime_daemon::list().map_err(|error| error.to_string())?;
        let mut store = self
            .inner
            .state
            .lock()
            .map_err(|_| "project runtime lock poisoned".to_string())?;

        let mut snapshots = Vec::new();
        for project_key in project_keys {
            clear_external_runtime_cache_for_project(
                &mut store.external_runtime_cache,
                project_key,
            );
            let project = config
                .find_project(project_key)
                .map_err(|error| error.to_string())?;
            snapshots.push(snapshot_for_project_with_daemon_statuses(
                &mut store,
                project,
                &daemon_statuses,
            )?);
        }
        Ok(snapshots)
    }

    pub fn preflight_with_options(
        &self,
        config: &AppConfig,
        project_key: &str,
        options: &ProjectRuntimeLaunchOptions,
    ) -> Result<ProjectRuntimePreflightResponse, String> {
        let project = config
            .find_project(project_key)
            .map_err(|error| error.to_string())?;
        Ok(project_runtime_preflight_for_project_with_options(
            config, project, options,
        ))
    }

    pub fn start(
        &self,
        config: &AppConfig,
        project_key: &str,
        debug_profile_key: Option<&str>,
        env_overrides: Option<&BTreeMap<String, String>>,
    ) -> Result<ProjectRuntimeSnapshot, String> {
        let options = ProjectRuntimeLaunchOptions {
            debug_profile: optional_owned(debug_profile_key),
            env: env_overrides.cloned().unwrap_or_default(),
            ..ProjectRuntimeLaunchOptions::default()
        };
        self.start_with_options(config, project_key, &options)
    }

    pub fn start_with_options(
        &self,
        config: &AppConfig,
        project_key: &str,
        options: &ProjectRuntimeLaunchOptions,
    ) -> Result<ProjectRuntimeSnapshot, String> {
        log_project_runtime_event(format!("start requested key={}", project_key));
        let project = config
            .find_project(project_key)
            .map_err(|error| error.to_string())?;
        let response = core_start_project_runtime(config, project_key, options)?;
        log_project_runtime_event(format!(
            "daemon start key={} pid={} cwd={} command={} debug_profile={} env_overrides={}",
            project.key,
            response
                .pid
                .map(|pid| pid.to_string())
                .unwrap_or_else(|| "-".to_string()),
            response.cwd,
            response.command,
            response.debug_profile_key.as_deref().unwrap_or("default"),
            options.env.len()
        ));

        if response.running && should_watch_project_ready(project) {
            let debug_profile = selected_debug_profile(project, options.debug_profile.as_deref())?;
            let runtime_profile = resolve_runtime_profile(
                config,
                debug_profile.as_ref(),
                options.runtime_profile.as_deref(),
            )?;
            spawn_ready_focus_watcher(project.clone(), debug_profile, runtime_profile);
        }

        let mut store = self
            .inner
            .state
            .lock()
            .map_err(|_| "project runtime lock poisoned".to_string())?;
        if response.started_new && response.running {
            let status_key = runtime_daemon::runtime_status_key(&project.key, &response.cwd);
            store.app_started_runtimes.insert(
                status_key.clone(),
                AppStartedRuntimeSession {
                    status_key,
                    project_key: project.key.clone(),
                    project_name: project.name.clone(),
                    cwd: PathBuf::from(&response.cwd),
                    run_id: response.run_id,
                },
            );
        }
        snapshot_for_project(&mut store, project)
    }

    pub fn adopt_with_options(
        &self,
        config: &AppConfig,
        project_key: &str,
        pid: u32,
        options: &ProjectRuntimeLaunchOptions,
    ) -> Result<ProjectRuntimeSnapshot, String> {
        let project = config
            .find_project(project_key)
            .map_err(|error| error.to_string())?;
        let response = core_adopt_project_runtime(config, project_key, pid, options)?;
        log_project_runtime_event(format!(
            "external runtime adopted key={} pid={} pgid={} cwd={}",
            project.key, response.pid, response.pgid, response.canonical_cwd
        ));
        let mut store = self
            .inner
            .state
            .lock()
            .map_err(|_| "project runtime lock poisoned".to_string())?;
        snapshot_for_project(&mut store, project)
    }

    pub fn run_build(
        &self,
        config: &AppConfig,
        project_key: &str,
    ) -> Result<ProjectRuntimeSnapshot, String> {
        log_project_runtime_event(format!("build requested key={}", project_key));
        let project = config
            .find_project(project_key)
            .map_err(|error| error.to_string())?;
        let resolved = resolve_project_command(project, ProjectCommandKind::Build)?;
        let launch_resolved = resolved.clone();
        log_project_runtime_event(format!(
            "build resolved key={} cwd={} command={}",
            project.key,
            resolved.cwd.display(),
            resolved.command
        ));

        let mut store = self
            .inner
            .state
            .lock()
            .map_err(|_| "project runtime lock poisoned".to_string())?;
        let already_running = {
            let (running, last_results) = store.build_parts();
            build_running_state(running, last_results, project)?.is_some()
        };
        if already_running {
            return snapshot_for_project(&mut store, project);
        }

        {
            let (running, last_results) = store.build_parts();
            launch_build_command(running, last_results, project, launch_resolved)?;
        }

        if let Some(process) = store.running_builds.get(&project.key) {
            log_project_runtime_event(format!(
                "build launched key={} pid={} cwd={} command={}",
                project.key,
                process.pid,
                resolved.cwd.display(),
                resolved.command
            ));
        }

        snapshot_for_project(&mut store, project)
    }

    pub fn run_build_command(
        &self,
        config: &AppConfig,
        project_key: &str,
        command: String,
        cwd: PathBuf,
        env: BTreeMap<String, String>,
    ) -> Result<ProjectRuntimeSnapshot, String> {
        log_project_runtime_event(format!("build target requested key={}", project_key));
        let project = config
            .find_project(project_key)
            .map_err(|error| error.to_string())?;
        let command = command.trim().to_string();
        if command.is_empty() {
            return Err("构建命令不能为空".to_string());
        }
        if !cwd.exists() {
            return Err(format!("打包目录不存在: {}", cwd.display()));
        }
        if !cwd.is_dir() {
            return Err(format!("打包目录不是文件夹: {}", cwd.display()));
        }
        let resolved = ResolvedProjectCommand {
            command,
            cwd,
            env: env.into_iter().collect(),
        };
        let launch_resolved = resolved.clone();
        log_project_runtime_event(format!(
            "build target resolved key={} cwd={} command={}",
            project.key,
            resolved.cwd.display(),
            resolved.command
        ));

        let mut store = self
            .inner
            .state
            .lock()
            .map_err(|_| "project runtime lock poisoned".to_string())?;
        let already_running = {
            let (running, last_results) = store.build_parts();
            build_running_state(running, last_results, project)?.is_some()
        };
        if already_running {
            return snapshot_for_project(&mut store, project);
        }

        {
            let (running, last_results) = store.build_parts();
            launch_build_command(running, last_results, project, launch_resolved)?;
        }

        if let Some(process) = store.running_builds.get(&project.key) {
            log_project_runtime_event(format!(
                "build target launched key={} pid={} cwd={} command={}",
                project.key,
                process.pid,
                resolved.cwd.display(),
                resolved.command
            ));
        }

        snapshot_for_project(&mut store, project)
    }

    pub fn stop(
        &self,
        config: &AppConfig,
        project_key: &str,
    ) -> Result<ProjectRuntimeSnapshot, String> {
        let project = config
            .find_project(project_key)
            .map_err(|error| error.to_string())?;
        let cwd = runtime_daemon_status_for_project_context(project)?
            .filter(|status| status.running)
            .map(|status| PathBuf::from(status.canonical_cwd))
            .map(Ok)
            .unwrap_or_else(|| project_runtime_daemon_cwd(project))?;
        let stopped =
            runtime_daemon::stop(&project.key, &cwd).map_err(|error| error.to_string())?;
        log_project_runtime_event(format!(
            "daemon stop key={} cwd={} managed={} running={}",
            project.key,
            cwd.display(),
            stopped.managed,
            stopped.running
        ));

        let mut store = self
            .inner
            .state
            .lock()
            .map_err(|_| "project runtime lock poisoned".to_string())?;
        store.app_started_runtimes.remove(&stopped.status_key);
        clear_external_runtime_cache_for_project(&mut store.external_runtime_cache, &project.key);
        snapshot_for_project(&mut store, project)
    }

    pub fn stop_build(
        &self,
        config: &AppConfig,
        project_key: &str,
    ) -> Result<ProjectRuntimeSnapshot, String> {
        let project = config
            .find_project(project_key)
            .map_err(|error| error.to_string())?;

        let mut store = self
            .inner
            .state
            .lock()
            .map_err(|_| "project runtime lock poisoned".to_string())?;
        {
            let (running, last_results) = store.build_parts();
            let _ = build_running_state(running, last_results, project)?;
        }

        if let Some(mut process) = store.running_builds.remove(&project.key) {
            log_project_runtime_event(format!(
                "build stop requested key={} pid={}",
                project.key, process.pid
            ));
            terminate_running_project_process(&mut process)?;
            store.last_build_results.insert(
                project.key.clone(),
                ProjectTaskLastState {
                    status_key: "stopped".to_string(),
                    status_label: "已中止".to_string(),
                    detail: "已中止打包任务".to_string(),
                    updated_at_ms: now_ms(),
                },
            );
        }

        snapshot_for_project(&mut store, project)
    }

    pub fn shutdown_all(&self) {
        if let Ok(mut store) = self.inner.state.lock() {
            shutdown_runtime_store(&mut store);
        }
    }

    pub fn app_started_runtime_summary(&self) -> AppStartedRuntimeSummary {
        let sessions = self.app_started_runtime_sessions();
        let mut active = Vec::new();
        let mut stale_keys = Vec::new();
        for session in sessions {
            match runtime_daemon::status(&session.project_key, &session.cwd) {
                Ok(status) if app_owns_runtime_status(&session, &status) => active.push(session),
                Ok(_) => stale_keys.push(session.status_key),
                Err(_) => active.push(session),
            }
        }
        self.remove_app_started_runtime_sessions(&stale_keys);
        let count = active.len();
        let mut project_names = active
            .into_iter()
            .map(|session| session.project_name)
            .collect::<Vec<_>>();
        project_names.sort();
        project_names.dedup();
        AppStartedRuntimeSummary {
            count,
            project_names,
        }
    }

    pub fn shutdown_app_started_runtimes(&self) -> AppStartedRuntimeShutdownReport {
        let sessions = self.app_started_runtime_sessions();
        let mut report = AppStartedRuntimeShutdownReport {
            requested: sessions.len(),
            stopped: 0,
            skipped: 0,
            failures: Vec::new(),
        };
        let mut completed_keys = Vec::new();

        for session in sessions {
            let current = match runtime_daemon::status(&session.project_key, &session.cwd) {
                Ok(status) => status,
                Err(error) => {
                    report.failures.push(format!(
                        "{}：读取运行状态失败（{}）",
                        session.project_name, error
                    ));
                    continue;
                }
            };
            if !app_owns_runtime_status(&session, &current) {
                report.skipped += 1;
                completed_keys.push(session.status_key);
                continue;
            }
            match runtime_daemon::stop(&session.project_key, &session.cwd) {
                Ok(_) => {
                    report.stopped += 1;
                    completed_keys.push(session.status_key);
                }
                Err(error) => report
                    .failures
                    .push(format!("{}：停止失败（{}）", session.project_name, error)),
            }
        }

        self.remove_app_started_runtime_sessions(&completed_keys);
        report
    }

    fn app_started_runtime_sessions(&self) -> Vec<AppStartedRuntimeSession> {
        self.inner
            .state
            .lock()
            .map(|store| store.app_started_runtimes.values().cloned().collect())
            .unwrap_or_default()
    }

    fn remove_app_started_runtime_sessions(&self, status_keys: &[String]) {
        if status_keys.is_empty() {
            return;
        }
        if let Ok(mut store) = self.inner.state.lock() {
            for status_key in status_keys {
                store.app_started_runtimes.remove(status_key);
            }
        }
    }

    pub fn open_build_output(
        &self,
        config: &AppConfig,
        project_key: &str,
        output_dir_override: Option<&str>,
    ) -> Result<ProjectRuntimeSnapshot, String> {
        let project = config
            .find_project(project_key)
            .map_err(|error| error.to_string())?;
        let output_dir = output_dir_override
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .or_else(|| resolve_build_output_dir(project))
            .ok_or_else(|| {
                "未找到产物目录，请配置 target artifact.output_dir 或 [projects.build].output_dir"
                    .to_string()
            })?;
        log_project_runtime_event(format!(
            "open build output key={} dir={}",
            project.key,
            output_dir.display()
        ));

        if !output_dir.exists() {
            return Err(format!("产物目录不存在: {}", output_dir.display()));
        }
        if !output_dir.is_dir() {
            return Err(format!("产物目录不是文件夹: {}", output_dir.display()));
        }

        open_path(&output_dir)?;

        let mut store = self
            .inner
            .state
            .lock()
            .map_err(|_| "project runtime lock poisoned".to_string())?;
        snapshot_for_project(&mut store, project)
    }

    pub fn focus_runtime(
        &self,
        config: &AppConfig,
        project_key: &str,
        debug_profile_key: Option<&str>,
    ) -> Result<ProjectRuntimeSnapshot, String> {
        self.focus_runtime_with_profile_and_url(config, project_key, debug_profile_key, None, None)
    }

    pub fn focus_runtime_with_profile(
        &self,
        config: &AppConfig,
        project_key: &str,
        debug_profile_key: Option<&str>,
        runtime_profile_key: Option<&str>,
    ) -> Result<ProjectRuntimeSnapshot, String> {
        self.focus_runtime_with_profile_and_url(
            config,
            project_key,
            debug_profile_key,
            runtime_profile_key,
            None,
        )
    }

    pub fn focus_runtime_with_profile_and_url(
        &self,
        config: &AppConfig,
        project_key: &str,
        debug_profile_key: Option<&str>,
        runtime_profile_key: Option<&str>,
        url_override: Option<&str>,
    ) -> Result<ProjectRuntimeSnapshot, String> {
        let project = config
            .find_project(project_key)
            .map_err(|error| error.to_string())?;
        let debug_profile = selected_debug_profile(project, debug_profile_key)?;
        let runtime_profile =
            resolve_runtime_profile(config, debug_profile.as_ref(), runtime_profile_key)?;

        let override_target = url_override
            .map(str::trim)
            .filter(|value| value.starts_with("http://") || value.starts_with("https://"))
            .map(|value| ProjectFocusTarget::Url(value.to_string()));
        match override_target.or_else(|| preferred_runtime_focus_target(project)) {
            Some(ProjectFocusTarget::AppBundle(bundle_id)) => {
                log_project_runtime_event(format!(
                    "focus runtime key={} bundle_id={}",
                    project.key, bundle_id
                ));
                focus_app_bundle(&bundle_id)?;
            }
            Some(ProjectFocusTarget::Url(url)) => {
                log_project_runtime_event(format!("focus runtime key={} url={}", project.key, url));
                open_focus_url(&url, debug_profile.as_ref(), runtime_profile.as_ref())
                    .map_err(|error| format!("打开项目页面失败: {}", error))?;
            }
            None => return Err("当前项目未配置可唤起目标，且未识别到启动地址".to_string()),
        }

        let mut store = self
            .inner
            .state
            .lock()
            .map_err(|_| "project runtime lock poisoned".to_string())?;
        snapshot_for_project(&mut store, project)
    }

    pub fn read_log(
        &self,
        config: &AppConfig,
        project_key: &str,
        kind: ProjectRuntimeLogKind,
        max_lines: usize,
    ) -> Result<ProjectRuntimeLogResponse, String> {
        core_read_project_runtime_log(config, project_key, kind, max_lines)
    }

    pub fn clear_log(
        &self,
        config: &AppConfig,
        project_key: &str,
        kind: ProjectRuntimeLogKind,
    ) -> Result<ProjectRuntimeLogResponse, String> {
        core_clear_project_runtime_log(config, project_key, kind)
    }
}

fn preferred_runtime_focus_target(project: &ProjectConfig) -> Option<ProjectFocusTarget> {
    match resolve_focus_target(project) {
        bundle @ Some(ProjectFocusTarget::AppBundle(_)) => bundle,
        configured => ready_focus_target(project).or(configured),
    }
}

fn app_owns_runtime_status(
    session: &AppStartedRuntimeSession,
    status: &RuntimeDaemonStatus,
) -> bool {
    status.running
        && status.managed
        && status.status_key == session.status_key
        && status.state.as_ref().is_some_and(|state| {
            state.run_id == session.run_id
                && state.project_key == session.project_key
                && Path::new(&state.canonical_cwd) == session.cwd
        })
}

fn snapshot_for_project(
    store: &mut ProjectRuntimeStore,
    project: &ProjectConfig,
) -> Result<ProjectRuntimeSnapshot, String> {
    let daemon_statuses = runtime_daemon::list().map_err(|error| error.to_string())?;
    snapshot_for_project_with_daemon_statuses(store, project, &daemon_statuses)
}

fn snapshot_for_project_with_daemon_statuses(
    store: &mut ProjectRuntimeStore,
    project: &ProjectConfig,
    daemon_statuses: &[RuntimeDaemonStatus],
) -> Result<ProjectRuntimeSnapshot, String> {
    let display = runtime_display_config(project);
    let build_output_dir = resolve_build_output_dir(project);
    let dev_state = runtime_daemon_task_state_with_daemon_statuses(
        project,
        &display.dev,
        &mut store.external_runtime_cache,
        daemon_statuses,
    )?;
    let can_focus_runtime = resolve_focus_target(project).is_some()
        || focus_target_from_ready_url(&dev_state.ready_url).is_some();
    let build_state = {
        let (running, last_results) = store.build_parts();
        build_task_state_for_project(running, last_results, project, &display.build)?
    };
    let can_open_build_output = build_state.status_key == "succeeded"
        && build_output_dir
            .as_ref()
            .is_some_and(|path| path.exists() && path.is_dir());
    let log_path = display.dev.command.as_ref().map(|_| {
        task_log_path(project, ProjectCommandKind::Dev)
            .display()
            .to_string()
    });
    let build_log_path = if display.build.command.is_some()
        || build_state.is_running
        || matches!(
            build_state.status_key.as_str(),
            "succeeded" | "failed" | "stopped"
        ) {
        Some(
            task_log_path(project, ProjectCommandKind::Build)
                .display()
                .to_string(),
        )
    } else {
        None
    };

    Ok(ProjectRuntimeSnapshot {
        key: project.key.clone(),
        name: project.name.clone(),
        category: project.category_label().to_string(),
        repo_path: display.repo_path,
        command: display.dev.command,
        cwd: display.dev.cwd,
        focus_url: project
            .focus
            .url
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string),
        ready_url: dev_state.ready_url,
        status_key: dev_state.status_key,
        status_label: dev_state.status_label,
        detail: dev_state.detail,
        pid: dev_state.pid,
        started_at_ms: dev_state.started_at_ms,
        log_path,
        build_command: display.build.command,
        build_cwd: display.build.cwd,
        build_output_dir: display.build.output_dir,
        build_status_key: build_state.status_key,
        build_status_label: build_state.status_label,
        build_detail: build_state.detail,
        build_pid: build_state.pid,
        build_started_at_ms: build_state.started_at_ms,
        build_log_path,
        updated_at_ms: dev_state.updated_at_ms.max(build_state.updated_at_ms),
        can_start: dev_state.is_available && !dev_state.is_running,
        can_stop: dev_state.can_stop,
        can_adopt: dev_state.can_adopt,
        can_build: build_state.is_available && !build_state.is_running,
        can_stop_build: build_state.can_stop,
        can_open_build_output,
        can_focus_runtime,
        debug_profiles: project
            .debug_profiles
            .iter()
            .map(|profile| ProjectDebugProfileSummary {
                key: profile.key.clone(),
                label: profile.label.clone(),
                command: profile.command.clone(),
                cwd: profile.cwd.as_ref().map(|path| path.display().to_string()),
                expected_port: profile.expected_port,
                focus_url: profile.focus_url.clone(),
                ready_probe: profile.ready_probe.as_ref().map(|probe| {
                    ProjectRuntimeReadyProbeSummary {
                        url: probe.url.clone(),
                        path: probe.path.clone(),
                        expected_statuses: probe.expected_statuses.clone(),
                        timeout_ms: probe.timeout_ms,
                    }
                }),
                runtime_profile: profile.runtime_profile.clone(),
                env: profile.env.clone(),
                env_count: profile.env.len(),
                local_file_count: profile
                    .local_files
                    .iter()
                    .filter(|item| item.enabled)
                    .count(),
                browser: profile.browser.clone(),
                browser_profile: profile.browser_profile.clone(),
                browser_user_data_dir: profile
                    .browser_user_data_dir
                    .as_ref()
                    .map(|path| path.display().to_string()),
                browser_args: profile.browser_args.clone(),
                network_proxy: ProjectNetworkProxySummary {
                    enabled: profile.network_proxy.enabled,
                    proxy_url: profile.network_proxy.proxy_url.clone(),
                    inject_env: profile.network_proxy.inject_env,
                    node_hook: profile.network_proxy.node_hook,
                    no_proxy: profile.network_proxy.no_proxy.clone(),
                },
                local_proxy: local_proxy_summary(&profile.local_proxy),
            })
            .collect(),
    })
}

fn local_proxy_summary(proxy: &ProjectLocalProxyConfig) -> ProjectLocalProxySummary {
    ProjectLocalProxySummary {
        enabled: proxy.enabled,
        listen: proxy.listen.clone(),
        frontend_url: proxy.frontend_url.clone(),
        upstream_proxy: proxy.upstream_proxy.clone(),
        routes: proxy.routes.iter().map(local_proxy_route_summary).collect(),
        auth_helper: auth_helper_summary(&proxy.auth_helper),
    }
}

fn local_proxy_route_summary(
    route: &ProjectLocalProxyRouteConfig,
) -> ProjectLocalProxyRouteSummary {
    ProjectLocalProxyRouteSummary {
        enabled: route.enabled,
        match_prefix: route.match_prefix.clone(),
        target: route.target.clone(),
        rewrite_prefix: route.rewrite_prefix.clone(),
        headers_text: map_to_editor_text(&route.headers),
    }
}

fn auth_helper_summary(helper: &ProjectAuthHelperConfig) -> ProjectAuthHelperSummary {
    ProjectAuthHelperSummary {
        enabled: helper.enabled,
        path: helper.path.clone(),
        redirect_path: helper.redirect_path.clone(),
        items: helper.items.iter().map(auth_helper_item_summary).collect(),
    }
}

fn auth_helper_item_summary(item: &ProjectAuthHelperItemConfig) -> ProjectAuthHelperItemSummary {
    ProjectAuthHelperItemSummary {
        enabled: item.enabled,
        storage: item.storage.clone(),
        key: item.key.clone(),
        from_json_path: item.from_json_path.clone(),
        value: item.value.clone(),
        cookie_path: item.cookie_path.clone(),
        cookie_max_age_seconds: item.cookie_max_age_seconds,
        cookie_same_site: item.cookie_same_site.clone(),
    }
}

fn map_to_editor_text(values: &BTreeMap<String, String>) -> String {
    values
        .iter()
        .map(|(key, value)| format!("{}={}", key, value))
        .collect::<Vec<_>>()
        .join("\n")
}

fn project_runtime_daemon_cwd(project: &ProjectConfig) -> Result<PathBuf, String> {
    let command = project
        .dev
        .as_ref()
        .ok_or_else(|| ProjectCommandKind::Dev.missing_config_message().to_string())?;
    resolve_command_cwd(project, command, ProjectCommandKind::Dev)
}

fn runtime_daemon_status_for_project_context(
    project: &ProjectConfig,
) -> Result<Option<RuntimeDaemonStatus>, String> {
    let candidates = project_runtime_candidate_cwds(project)?;
    runtime_daemon_status_for_project_candidates(project, &candidates)
}

fn runtime_daemon_status_for_project_candidates(
    project: &ProjectConfig,
    candidates: &[PathBuf],
) -> Result<Option<RuntimeDaemonStatus>, String> {
    runtime_daemon::list()
        .map_err(|error| error.to_string())
        .map(|statuses| {
            statuses.into_iter().find(|status| {
                status.project_key == project.key
                    && candidates
                        .iter()
                        .any(|cwd| Path::new(&status.canonical_cwd) == cwd)
            })
        })
}

#[cfg(test)]
fn runtime_daemon_task_state(
    project: &ProjectConfig,
    display: &TaskDisplayConfig,
    external_runtime_cache: &mut HashMap<ExternalRuntimeCacheKey, ExternalRuntimeCacheEntry>,
) -> Result<TaskSnapshotState, String> {
    let daemon_statuses = runtime_daemon::list().map_err(|error| error.to_string())?;
    runtime_daemon_task_state_with_daemon_statuses(
        project,
        display,
        external_runtime_cache,
        &daemon_statuses,
    )
}

fn runtime_daemon_task_state_with_daemon_statuses(
    project: &ProjectConfig,
    display: &TaskDisplayConfig,
    external_runtime_cache: &mut HashMap<ExternalRuntimeCacheKey, ExternalRuntimeCacheEntry>,
    daemon_statuses: &[RuntimeDaemonStatus],
) -> Result<TaskSnapshotState, String> {
    let candidate_cwds = match project_runtime_candidate_cwds(project) {
        Ok(candidates) => candidates,
        Err(error) => {
            let detail = if display.configured {
                error
            } else {
                ProjectCommandKind::Dev.missing_config_message().to_string()
            };
            return Ok(unavailable_task_state(display, detail));
        }
    };
    let latest_status = daemon_statuses.iter().find(|status| {
        status.project_key == project.key
            && candidate_cwds
                .iter()
                .any(|cwd| Path::new(&status.canonical_cwd) == cwd)
    });
    let cwd = latest_status
        .as_ref()
        .map(|status| PathBuf::from(&status.canonical_cwd))
        .or_else(|| project_runtime_daemon_cwd(project).ok());
    let Some(cwd) = cwd else {
        return Ok(unavailable_task_state(
            display,
            ProjectCommandKind::Dev.missing_config_message().to_string(),
        ));
    };
    let status = match latest_status {
        Some(status) => status.clone(),
        None => runtime_daemon::status(&project.key, &cwd).map_err(|error| error.to_string())?,
    };
    if !status.running {
        let now = now_ms();
        let cache_key = external_runtime_cache_key(project, display, &cwd);
        let cached = external_runtime_cache
            .get(&cache_key)
            .filter(|entry| {
                let ttl = if entry.detection.is_some() {
                    600
                } else {
                    5_000
                };
                now.saturating_sub(entry.checked_at_ms) < ttl
            })
            .cloned();
        let detection = match cached {
            Some(entry) => entry.detection,
            None => {
                let options = ProjectRuntimeLaunchOptions::default();
                let detection =
                    detect_external_project_runtime_for_project_with_options(project, &options)
                        .ok()
                        .flatten();
                external_runtime_cache.insert(
                    cache_key,
                    ExternalRuntimeCacheEntry {
                        checked_at_ms: now,
                        detection: detection.clone(),
                    },
                );
                detection
            }
        };
        if let Some(external) = detection {
            return Ok(external_dev_task_state(external));
        }
    }
    if status.state.is_none() {
        return match resolve_project_command(project, ProjectCommandKind::Dev) {
            Ok(_) => Ok(idle_dev_task_state()),
            Err(error) => Ok(unavailable_task_state(display, error)),
        };
    }
    Ok(runtime_daemon_status_to_task_state(&status))
}

fn external_runtime_cache_key(
    project: &ProjectConfig,
    display: &TaskDisplayConfig,
    cwd: &Path,
) -> ExternalRuntimeCacheKey {
    ExternalRuntimeCacheKey {
        project_key: project.key.clone(),
        canonical_cwd: cwd.canonicalize().unwrap_or_else(|_| cwd.to_path_buf()),
        command: display.command.clone().unwrap_or_default(),
        focus_url: project.focus.url.clone().unwrap_or_default(),
    }
}

fn clear_external_runtime_cache_for_project(
    cache: &mut HashMap<ExternalRuntimeCacheKey, ExternalRuntimeCacheEntry>,
    project_key: &str,
) {
    cache.retain(|key, _| key.project_key != project_key);
}

fn unavailable_task_state(display: &TaskDisplayConfig, detail: String) -> TaskSnapshotState {
    TaskSnapshotState {
        status_key: if display.configured {
            "invalidConfig".to_string()
        } else {
            "notConfigured".to_string()
        },
        status_label: if display.configured {
            "配置无效".to_string()
        } else {
            "未配置".to_string()
        },
        detail,
        ready_url: None,
        pid: None,
        started_at_ms: None,
        updated_at_ms: now_ms(),
        is_running: false,
        is_available: false,
        can_stop: false,
        can_adopt: false,
    }
}

fn idle_dev_task_state() -> TaskSnapshotState {
    TaskSnapshotState {
        status_key: "idle".to_string(),
        status_label: "未启动".to_string(),
        detail: "dev 服务未启动".to_string(),
        ready_url: None,
        pid: None,
        started_at_ms: None,
        updated_at_ms: now_ms(),
        is_running: false,
        is_available: true,
        can_stop: false,
        can_adopt: false,
    }
}

fn external_dev_task_state(
    external: rdevtool_core::runtime::ProjectRuntimeExternalDetection,
) -> TaskSnapshotState {
    TaskSnapshotState {
        status_key: "external".to_string(),
        status_label: "运行中（外部）".to_string(),
        detail: format!(
            "检测到 PID {} 正在监听端口 {}，认领后可由 rDevTool 管理",
            external.process.pid, external.expected_port
        ),
        ready_url: external.ready_url,
        pid: Some(external.process.pid),
        started_at_ms: None,
        updated_at_ms: now_ms(),
        is_running: true,
        is_available: true,
        can_stop: false,
        can_adopt: true,
    }
}

fn runtime_daemon_status_to_task_state(status: &RuntimeDaemonStatus) -> TaskSnapshotState {
    let state = status
        .state
        .as_ref()
        .expect("daemon status mapping requires persisted state");
    let active_phase = matches!(
        state.phase,
        RuntimeDaemonPhase::Starting | RuntimeDaemonPhase::Running | RuntimeDaemonPhase::Stopping
    );
    let ownership_lost = !status.managed && (status.running || active_phase);
    let is_running = status.running || (status.managed && active_phase);

    let updated_at_ms = state
        .exit
        .as_ref()
        .map(|exit| exit.exited_at_ms)
        .unwrap_or(state.started_at_ms);
    let (status_key, status_label, detail) = if ownership_lost {
        (
            "lost".to_string(),
            "状态失联".to_string(),
            if status.running {
                "检测到 dev 进程仍在，但 Runtime Daemon 所有权校验失败；不可从 App 停止".to_string()
            } else {
                "Runtime Daemon 留有活动状态，但守护进程已失联；不可从 App 停止".to_string()
            },
        )
    } else {
        match &state.phase {
            RuntimeDaemonPhase::Starting => (
                "starting".to_string(),
                "启动中".to_string(),
                "正在启动受管 dev 服务".to_string(),
            ),
            RuntimeDaemonPhase::Running => (
                "running".to_string(),
                "运行中（受管）".to_string(),
                state
                    .ready_url
                    .clone()
                    .unwrap_or_else(|| "共享 Runtime Daemon 正在托管此进程组".to_string()),
            ),
            RuntimeDaemonPhase::Stopping => (
                "stopping".to_string(),
                "停止中".to_string(),
                "正在停止项目及其子进程".to_string(),
            ),
            RuntimeDaemonPhase::Exited => (
                "stopped".to_string(),
                "未启动".to_string(),
                state
                    .exit
                    .as_ref()
                    .map(|exit| exit.reason.clone())
                    .unwrap_or_else(|| "dev 服务已退出".to_string()),
            ),
            RuntimeDaemonPhase::Failed => (
                "failed".to_string(),
                "启动失败".to_string(),
                state
                    .exit
                    .as_ref()
                    .map(|exit| exit.reason.clone())
                    .unwrap_or_else(|| status.detail.clone()),
            ),
        }
    };

    TaskSnapshotState {
        status_key,
        status_label,
        detail,
        ready_url: state.ready_url.clone(),
        pid: is_running.then_some(state.worker_pid).flatten(),
        started_at_ms: Some(state.started_at_ms),
        updated_at_ms,
        is_running,
        is_available: true,
        can_stop: is_running && status.managed,
        can_adopt: false,
    }
}

fn build_task_state_for_project(
    running: &mut HashMap<String, RunningProjectProcess>,
    last_results: &mut HashMap<String, ProjectTaskLastState>,
    project: &ProjectConfig,
    display: &TaskDisplayConfig,
) -> Result<TaskSnapshotState, String> {
    let mut updated_at_ms = now_ms();

    if let Some(running_state) = build_running_state(running, last_results, project)? {
        return Ok(running_state);
    }

    let last_state = last_results.get(&project.key).cloned();
    if let Some(last) = last_state.as_ref() {
        updated_at_ms = last.updated_at_ms;
    }

    match resolve_project_command(project, ProjectCommandKind::Build) {
        Ok(_) => {
            if let Some(last) = last_state {
                return Ok(TaskSnapshotState {
                    status_key: last.status_key,
                    status_label: last.status_label,
                    detail: last.detail,
                    ready_url: None,
                    pid: None,
                    started_at_ms: None,
                    updated_at_ms,
                    is_running: false,
                    is_available: true,
                    can_stop: false,
                    can_adopt: false,
                });
            }

            Ok(TaskSnapshotState {
                status_key: "stopped".to_string(),
                status_label: "待打包".to_string(),
                detail: "配置已就绪，可执行打包任务".to_string(),
                ready_url: None,
                pid: None,
                started_at_ms: None,
                updated_at_ms,
                is_running: false,
                is_available: true,
                can_stop: false,
                can_adopt: false,
            })
        }
        Err(error) => Ok(TaskSnapshotState {
            status_key: if display.configured {
                "invalidConfig".to_string()
            } else {
                "notConfigured".to_string()
            },
            status_label: if display.configured {
                "配置无效".to_string()
            } else {
                "未配置".to_string()
            },
            detail: error,
            ready_url: None,
            pid: None,
            started_at_ms: None,
            updated_at_ms,
            is_running: false,
            is_available: false,
            can_stop: false,
            can_adopt: false,
        }),
    }
}

fn build_running_state(
    running: &mut HashMap<String, RunningProjectProcess>,
    last_results: &mut HashMap<String, ProjectTaskLastState>,
    project: &ProjectConfig,
) -> Result<Option<TaskSnapshotState>, String> {
    let mut remove_exited = None;

    if let Some(process) = running.get_mut(&project.key) {
        match process
            .child
            .try_wait()
            .map_err(|error| error.to_string())?
        {
            Some(status) => remove_exited = Some(status.code()),
            None => {
                return Ok(Some(running_build_task_state(
                    process.pid,
                    process.started_at_ms,
                )));
            }
        }
    }

    if let Some(code) = remove_exited {
        running.remove(&project.key);
        last_results.insert(project.key.clone(), build_finished_state(code));
    }

    Ok(None)
}

fn running_build_task_state(pid: u32, started_at_ms: u64) -> TaskSnapshotState {
    TaskSnapshotState {
        status_key: "running".to_string(),
        status_label: "打包中".to_string(),
        detail: "打包任务正在运行".to_string(),
        ready_url: None,
        pid: Some(pid),
        started_at_ms: Some(started_at_ms),
        updated_at_ms: now_ms(),
        is_running: true,
        is_available: true,
        can_stop: true,
        can_adopt: false,
    }
}

fn launch_build_command(
    running: &mut HashMap<String, RunningProjectProcess>,
    last_results: &mut HashMap<String, ProjectTaskLastState>,
    project: &ProjectConfig,
    resolved: ResolvedProjectCommand,
) -> Result<(), String> {
    let mut log_file = open_task_log(project, &resolved, ProjectCommandKind::Build)?;
    let stdout = log_file
        .try_clone()
        .map_err(|error| format!("创建日志输出失败: {}", error))?;
    let stderr = log_file
        .try_clone()
        .map_err(|error| format!("创建日志输出失败: {}", error))?;
    let mut command = Command::new("/bin/zsh");
    command
        .arg("-lc")
        .arg(&resolved.command)
        .current_dir(&resolved.cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));

    scrub_launcher_env(&mut command);

    for (key, value) in &resolved.env {
        command.env(key, value);
    }

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("执行打包 {} 失败: {}", project.name, error))?;
    let pid = child.id();
    let started_at_ms = now_ms();

    thread::sleep(Duration::from_millis(240));
    match child.try_wait().map_err(|error| error.to_string())? {
        Some(status) => {
            let _ = writeln!(log_file, "[{}] exited quickly status={}", now_ms(), status);
            last_results.insert(project.key.clone(), build_quick_exit_state(status.code()));
        }
        None => {
            let _ = writeln!(log_file, "[{}] running pid={}", now_ms(), pid);
            running.insert(
                project.key.clone(),
                RunningProjectProcess {
                    child,
                    pid,
                    started_at_ms,
                },
            );
            last_results.remove(&project.key);
        }
    }

    Ok(())
}

fn open_task_log(
    project: &ProjectConfig,
    resolved: &ResolvedProjectCommand,
    kind: ProjectCommandKind,
) -> Result<File, String> {
    let path = task_log_path(project, kind);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("创建日志目录失败: {}", error))?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("打开运行日志失败: {}", error))?;
    let started_at_ms = now_ms();
    let run_id = format!(
        "{}-{}-{}",
        sanitize_log_name(&project.key),
        kind.log_file_suffix(),
        started_at_ms
    );
    writeln!(
        file,
        "\n[{}] {} key={} cwd={} command={}",
        started_at_ms,
        kind.log_label(),
        project.key,
        resolved.cwd.display(),
        resolved.command
    )
    .map_err(|error| format!("写入运行日志失败: {}", error))?;
    writeln!(
        file,
        "{}",
        json!({
            "rdevtool": "runtimeSession",
            "version": 1,
            "runId": run_id,
            "projectKey": &project.key,
            "kind": kind.log_file_suffix(),
            "startedAtMs": started_at_ms,
            "cwd": resolved.cwd.display().to_string(),
            "command": &resolved.command,
        })
    )
    .map_err(|error| format!("写入运行日志失败: {}", error))?;
    Ok(file)
}

fn task_log_path(project: &ProjectConfig, kind: ProjectCommandKind) -> PathBuf {
    default_config_dir().join("runtime-logs").join(format!(
        "{}-{}.log",
        sanitize_log_name(&project.key),
        kind.log_file_suffix()
    ))
}

fn sanitize_log_name(value: &str) -> String {
    let normalized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if normalized.is_empty() {
        "project".to_string()
    } else {
        normalized
    }
}

fn tail_log_lines(
    path: &Path,
    max_lines: usize,
) -> Result<(Vec<String>, bool, ProjectRuntimeLogSessionSummary), String> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok((Vec::new(), false, ProjectRuntimeLogSessionSummary::empty(0)));
        }
        Err(error) => return Err(format!("读取运行日志失败: {}", error)),
    };
    let reader = BufReader::new(file);
    let mut lines = VecDeque::with_capacity(max_lines.saturating_add(1));
    let mut total = 0usize;
    let mut session_summary = ProjectRuntimeLogSessionSummary::empty(0);
    for line in reader.lines() {
        total += 1;
        let line = line.map_err(|error| format!("读取运行日志失败: {}", error))?;
        if let Some(mut next_session) = parse_runtime_session_marker(&line) {
            next_session.total_line_count = total;
            session_summary = next_session;
        } else {
            if session_summary.active {
                session_summary.current_line_count += 1;
                if session_summary.pid.is_none() {
                    session_summary.pid = parse_running_pid(&line);
                }
                if is_runtime_session_end_line(&line) {
                    session_summary.active = false;
                }
            }
            session_summary.total_line_count = total;
        }
        if lines.len() == max_lines {
            lines.pop_front();
        }
        lines.push_back(line);
    }
    session_summary.total_line_count = total;
    Ok((
        lines.into_iter().collect(),
        total > max_lines,
        session_summary,
    ))
}

fn parse_runtime_session_marker(line: &str) -> Option<ProjectRuntimeLogSessionSummary> {
    let value = serde_json::from_str::<serde_json::Value>(line).ok()?;
    if value.get("rdevtool")?.as_str()? != "runtimeSession" {
        return None;
    }
    Some(ProjectRuntimeLogSessionSummary {
        active: true,
        run_id: value
            .get("runId")
            .and_then(|item| item.as_str())
            .map(ToString::to_string),
        project_key: value
            .get("projectKey")
            .and_then(|item| item.as_str())
            .map(ToString::to_string),
        kind: value
            .get("kind")
            .and_then(|item| item.as_str())
            .map(ToString::to_string),
        started_at_ms: value.get("startedAtMs").and_then(|item| item.as_u64()),
        cwd: value
            .get("cwd")
            .and_then(|item| item.as_str())
            .map(ToString::to_string),
        command: value
            .get("command")
            .and_then(|item| item.as_str())
            .map(ToString::to_string),
        pid: None,
        current_line_count: 0,
        total_line_count: 0,
    })
}

fn parse_running_pid(line: &str) -> Option<u32> {
    let (_, suffix) = line.split_once("running pid=")?;
    suffix
        .split_whitespace()
        .next()
        .and_then(|value| value.parse::<u32>().ok())
}

fn is_runtime_session_end_line(line: &str) -> bool {
    line.contains("exited quickly status=")
}

fn runtime_ready_summary_from_file(
    project: &ProjectConfig,
    kind: ProjectCommandKind,
) -> Result<ProjectRuntimeReadySummary, String> {
    if kind != ProjectCommandKind::Dev || !project.focus.ready.enabled {
        return Ok(ProjectRuntimeReadySummary::disabled());
    }
    let path = task_log_path(project, kind);
    let (lines, _, _) = tail_log_lines(&path, 500)?;
    Ok(runtime_ready_summary(project, kind, &lines))
}

fn runtime_ready_summary(
    project: &ProjectConfig,
    kind: ProjectCommandKind,
    lines: &[String],
) -> ProjectRuntimeReadySummary {
    if kind != ProjectCommandKind::Dev || !project.focus.ready.enabled {
        return ProjectRuntimeReadySummary::disabled();
    }

    let ready = &project.focus.ready;
    let mut summary = ProjectRuntimeReadySummary::pending();
    let start_index = latest_task_start_index(lines, kind);
    let recent_lines = &lines[start_index..];
    let mut saw_success_marker = false;
    let mut failure_detail = None;

    for line in recent_lines {
        if let Some(url) = extract_ready_url(line, ready) {
            if line.to_ascii_lowercase().contains("network") {
                summary.network_url = Some(url.clone());
            } else {
                summary.local_url = Some(url.clone());
            }
            if summary.url.is_none() || line.to_ascii_lowercase().contains("local") {
                summary.url = Some(url);
            }
            summary.ready = true;
            saw_success_marker = true;
            continue;
        }

        if contains_any_marker(
            line,
            &ready.success_markers,
            default_ready_success_markers(),
        ) {
            saw_success_marker = true;
        }

        if !summary.ready {
            if let Some(marker) = matched_marker(
                line,
                &ready.failure_markers,
                default_ready_failure_markers(),
            ) {
                failure_detail = Some(format!("检测到启动异常: {}", marker));
            }
        }
    }

    if summary.ready || saw_success_marker {
        summary.ready = true;
        summary.failed = false;
        summary.status_key = "ready".to_string();
        summary.status_label = "已启动".to_string();
        if summary.url.is_none() {
            summary.url = project
                .focus
                .url
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string);
        }
        summary.detail = summary
            .url
            .as_ref()
            .map(|url| format!("检测到可访问地址 {}", url))
            .or_else(|| Some("检测到启动成功标记".to_string()));
        return summary;
    }

    if let Some(detail) = failure_detail {
        summary.failed = true;
        summary.status_key = "failed".to_string();
        summary.status_label = "启动异常".to_string();
        summary.detail = Some(detail);
    }

    summary
}

fn latest_task_start_index(lines: &[String], kind: ProjectCommandKind) -> usize {
    lines
        .iter()
        .rposition(|line| line.contains(kind.log_label()) && line.contains(" key="))
        .unwrap_or(0)
}

fn extract_ready_url(line: &str, ready: &ProjectReadyConfig) -> Option<String> {
    ready
        .url_patterns
        .iter()
        .find_map(|pattern| extract_url_with_pattern(line, pattern))
}

fn extract_url_with_pattern(line: &str, pattern: &str) -> Option<String> {
    let trimmed_pattern = pattern.trim();
    if trimmed_pattern.is_empty() {
        return None;
    }
    let Some((prefix, suffix)) = trimmed_pattern.split_once("{url}") else {
        return line
            .contains(trimmed_pattern)
            .then(|| extract_first_http_url(line))
            .flatten();
    };

    let prefix = prefix.trim();
    let suffix = suffix.trim();
    let start = if prefix.is_empty() {
        0
    } else {
        line.find(prefix)? + prefix.len()
    };
    let mut value = &line[start..];
    if !suffix.is_empty() {
        let suffix_start = value.find(suffix)?;
        value = &value[..suffix_start];
    }
    extract_first_http_url(value)
}

fn extract_first_http_url(value: &str) -> Option<String> {
    value.split_whitespace().find_map(|token| {
        let token = token.trim_matches(|ch: char| {
            matches!(
                ch,
                ',' | ';' | ')' | '(' | '"' | '\'' | '<' | '>' | '。' | '，'
            )
        });
        if token.starts_with("http://") || token.starts_with("https://") {
            Some(token.to_string())
        } else {
            None
        }
    })
}

fn contains_any_marker(line: &str, markers: &[String], fallback: Vec<String>) -> bool {
    matched_marker(line, markers, fallback).is_some()
}

fn matched_marker(line: &str, markers: &[String], fallback: Vec<String>) -> Option<String> {
    let normalized_line = line.to_ascii_lowercase();
    let source = if markers.is_empty() {
        fallback
    } else {
        markers.to_vec()
    };
    source.into_iter().find(|marker| {
        let marker = marker.trim();
        !marker.is_empty() && normalized_line.contains(&marker.to_ascii_lowercase())
    })
}

fn default_ready_success_markers() -> Vec<String> {
    Vec::new()
}

fn default_ready_failure_markers() -> Vec<String> {
    vec![
        "Failed to compile".to_string(),
        "Compilation failed".to_string(),
        "EADDRINUSE".to_string(),
    ]
}

fn shutdown_runtime_store(store: &mut ProjectRuntimeStore) {
    for (_, mut process) in store.running_builds.drain() {
        let _ = terminate_running_project_process(&mut process);
    }
}

fn should_auto_focus_when_ready(project: &ProjectConfig) -> bool {
    project.focus.auto_on_start
        && project.focus.ready.enabled
        && project
            .focus
            .auto_open_mode
            .trim()
            .eq_ignore_ascii_case("ready")
}

fn should_watch_project_ready(project: &ProjectConfig) -> bool {
    project.focus.ready.enabled
        && (should_auto_focus_when_ready(project) || !project.focus.after_ready_actions.is_empty())
}

fn spawn_ready_focus_watcher(
    project: ProjectConfig,
    debug_profile: Option<ProjectDebugProfileConfig>,
    runtime_profile: Option<RuntimeProfileConfig>,
) {
    thread::spawn(move || {
        let timeout_ms = project.focus.ready.timeout_ms.clamp(1_000, 600_000);
        let deadline = now_ms().saturating_add(timeout_ms);
        loop {
            match runtime_ready_summary_from_file(&project, ProjectCommandKind::Dev) {
                Ok(summary) if summary.ready => {
                    let url = summary.url.or_else(|| {
                        debug_profile
                            .as_ref()
                            .and_then(|profile| profile.focus_url.as_deref())
                            .or(project.focus.url.as_deref())
                            .as_deref()
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .map(ToString::to_string)
                    });
                    if let Some(url) = url {
                        log_project_runtime_event(format!(
                            "auto focus ready key={} url={}",
                            project.key, url
                        ));
                        if should_auto_focus_when_ready(&project) {
                            if let Err(error) = open_focus_url(
                                &url,
                                debug_profile.as_ref(),
                                runtime_profile.as_ref(),
                            ) {
                                eprintln!("failed to auto focus ready project: {}", error);
                            }
                        }
                        if let Err(error) = run_project_after_ready_actions(
                            &project,
                            &url,
                            debug_profile.as_ref(),
                            runtime_profile.as_ref(),
                        ) {
                            eprintln!("failed to run after-ready project actions: {}", error);
                        }
                    }
                    break;
                }
                Ok(summary) if summary.failed => {
                    log_project_runtime_event(format!(
                        "auto focus skipped key={} reason={}",
                        project.key,
                        summary
                            .detail
                            .unwrap_or_else(|| "ready check failed".to_string())
                    ));
                    break;
                }
                Ok(_) => {}
                Err(error) => {
                    eprintln!("failed to inspect project ready log: {}", error);
                }
            }

            if now_ms() >= deadline {
                log_project_runtime_event(format!("auto focus timeout key={}", project.key));
                break;
            }
            thread::sleep(Duration::from_millis(700));
        }
    });
}

fn run_project_after_ready_actions(
    project: &ProjectConfig,
    url: &str,
    debug_profile: Option<&ProjectDebugProfileConfig>,
    runtime_profile: Option<&RuntimeProfileConfig>,
) -> Result<(), String> {
    let action_keys = project
        .focus
        .after_ready_actions
        .iter()
        .map(|key| key.trim())
        .filter(|key| !key.is_empty())
        .collect::<Vec<_>>();
    if action_keys.is_empty() {
        return Ok(());
    }

    append_project_task_log(
        project,
        ProjectCommandKind::Dev,
        format!(
            "after-ready actions start count={} url={}",
            action_keys.len(),
            url
        ),
    );
    let entry = project_ready_navigation_entry(project, url, debug_profile, runtime_profile);
    let runtime_profiles = runtime_profile.cloned().into_iter().collect::<Vec<_>>();
    let target = match open_web_action_navigation_target(&entry, &runtime_profiles) {
        Ok(target) => target,
        Err(error) => {
            let message = format!("after-ready open target failed: {}", error);
            append_project_task_log(project, ProjectCommandKind::Dev, &message);
            return Err(message);
        }
    };

    for action_key in action_keys {
        let request = WebActionRunRequest {
            action_key: action_key.to_string(),
            target_id: Some(target.id.clone()),
            scope: Some(format!("project:{}", project.key)),
            url: Some(url.to_string()),
            params: BTreeMap::new(),
            context_params: project_web_action_context_params(
                project,
                url,
                debug_profile,
                runtime_profile,
            ),
        };
        match run_web_action_navigation(&entry, &runtime_profiles, request) {
            Ok(result) if result.success => append_project_task_log(
                project,
                ProjectCommandKind::Dev,
                format!(
                    "after-ready action {} success target={} url={}",
                    action_key, result.target_id, result.url
                ),
            ),
            Ok(result) => append_project_task_log(
                project,
                ProjectCommandKind::Dev,
                format!(
                    "after-ready action {} failed target={} error={}",
                    action_key,
                    result.target_id,
                    result.error.unwrap_or_else(|| result.result_text)
                ),
            ),
            Err(error) => append_project_task_log(
                project,
                ProjectCommandKind::Dev,
                format!("after-ready action {} error={}", action_key, error),
            ),
        }
    }

    Ok(())
}

fn project_web_action_context_params(
    project: &ProjectConfig,
    url: &str,
    debug_profile: Option<&ProjectDebugProfileConfig>,
    runtime_profile: Option<&RuntimeProfileConfig>,
) -> BTreeMap<String, String> {
    let mut params = BTreeMap::new();
    insert_context_param(&mut params, "project.key", &project.key);
    insert_context_param(&mut params, "project.name", &project.name);
    insert_context_param(&mut params, "project.category", &project.category);
    if let Some(path) = &project.repo_path {
        insert_context_param(&mut params, "project.repoPath", path.display().to_string());
        insert_context_param(&mut params, "project.repo_path", path.display().to_string());
    }
    if let Some(url) = debug_profile
        .and_then(|profile| optional_trimmed(profile.focus_url.as_deref()))
        .or_else(|| optional_trimmed(project.focus.url.as_deref()))
    {
        insert_context_param(&mut params, "project.focusUrl", url);
        insert_context_param(&mut params, "project.focus_url", url);
    }
    insert_context_param(&mut params, "project.readyUrl", url);
    insert_context_param(&mut params, "project.ready_url", url);
    insert_context_param(&mut params, "context.url", url);

    if let Some(profile) = debug_profile {
        insert_context_param(&mut params, "debugProfile.key", &profile.key);
        insert_context_param(&mut params, "debug_profile.key", &profile.key);
        insert_context_param(&mut params, "debugProfile.label", &profile.label);
        insert_context_param(&mut params, "debug_profile.label", &profile.label);
        if let Some(runtime_profile) = optional_trimmed(profile.runtime_profile.as_deref()) {
            insert_context_param(&mut params, "debugProfile.runtimeProfile", runtime_profile);
            insert_context_param(
                &mut params,
                "debug_profile.runtime_profile",
                runtime_profile,
            );
        }
        for (key, value) in &profile.env {
            insert_context_param(&mut params, format!("debugProfile.env.{}", key), value);
            insert_context_param(&mut params, format!("debug_profile.env.{}", key), value);
        }
    }

    if let Some(profile) = runtime_profile {
        insert_context_param(&mut params, "runtimeProfile.key", &profile.key);
        insert_context_param(&mut params, "runtime_profile.key", &profile.key);
        insert_context_param(&mut params, "runtimeProfile.label", &profile.label);
        insert_context_param(&mut params, "runtime_profile.label", &profile.label);
        insert_context_param(
            &mut params,
            "runtimeProfile.webActionsPort",
            profile.web_actions_port.to_string(),
        );
        insert_context_param(
            &mut params,
            "runtime_profile.web_actions_port",
            profile.web_actions_port.to_string(),
        );
        if let Some(proxy_url) = optional_trimmed(Some(profile.proxy_url.as_str())) {
            insert_context_param(&mut params, "runtimeProfile.proxyUrl", proxy_url);
            insert_context_param(&mut params, "runtime_profile.proxy_url", proxy_url);
        }
    }

    params
}

fn insert_context_param(
    params: &mut BTreeMap<String, String>,
    key: impl Into<String>,
    value: impl AsRef<str>,
) {
    let value = value.as_ref().trim();
    if !value.is_empty() {
        params.insert(key.into(), value.to_string());
    }
}

fn project_ready_navigation_entry(
    project: &ProjectConfig,
    url: &str,
    debug_profile: Option<&ProjectDebugProfileConfig>,
    runtime_profile: Option<&RuntimeProfileConfig>,
) -> NavigationEntry {
    NavigationEntry {
        name: project.name.clone(),
        kind: "url".to_string(),
        target_label: project.category_label().to_string(),
        url: Some(url.to_string()),
        browser: debug_profile
            .and_then(|profile| optional_trimmed(profile.browser.as_deref()))
            .map(ToString::to_string),
        browser_profile: debug_profile
            .and_then(|profile| optional_trimmed(profile.browser_profile.as_deref()))
            .map(ToString::to_string),
        runtime_profile: debug_profile
            .and_then(|profile| optional_trimmed(profile.runtime_profile.as_deref()))
            .map(ToString::to_string)
            .or_else(|| runtime_profile.map(|profile| profile.key.clone())),
        bundle_id: None,
        app_name: None,
        script: None,
        tool: None,
        tool_key: None,
        tool_action: None,
        path: None,
        cwd: project
            .repo_path
            .as_ref()
            .map(|path| path.display().to_string()),
        note: Some("项目 ready 后动作".to_string()),
    }
}

fn append_project_task_log(
    project: &ProjectConfig,
    kind: ProjectCommandKind,
    message: impl AsRef<str>,
) {
    let path = task_log_path(project, kind);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "[{}] {}", now_ms(), message.as_ref());
    }
    log_project_runtime_event(format!("key={} {}", project.key, message.as_ref()));
}

fn scrub_launcher_env(command: &mut Command) {
    let inherited_keys = std::env::vars().map(|(key, _)| key).collect::<Vec<_>>();
    for key in inherited_keys {
        if should_strip_inherited_env(&key) {
            command.env_remove(key);
        }
    }
}

fn should_strip_inherited_env(key: &str) -> bool {
    key == "OUT_DIR"
        || key.starts_with("TAURI_")
        || key == "CARGO_MANIFEST_DIR"
        || key == "CARGO_MANIFEST_PATH"
        || key.starts_with("CARGO_PKG_")
}

fn resolve_project_command(
    project: &ProjectConfig,
    kind: ProjectCommandKind,
) -> Result<ResolvedProjectCommand, String> {
    let Some(command_config) = project_command_config(project, kind) else {
        return Err(kind.missing_config_message().to_string());
    };

    let command = command_config.command.trim().to_string();
    if command.is_empty() {
        return Err(format!(
            "{}为空，请在 {} 下配置 command",
            kind.command_label(),
            kind.config_block()
        ));
    }

    let cwd = resolve_command_cwd(project, command_config, kind)?;
    if !cwd.exists() {
        return Err(format!("{}不存在: {}", kind.cwd_label(), cwd.display()));
    }
    if !cwd.is_dir() {
        return Err(format!("{}不是文件夹: {}", kind.cwd_label(), cwd.display()));
    }

    Ok(ResolvedProjectCommand {
        command,
        cwd,
        env: command_config
            .env
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect(),
    })
}

fn selected_debug_profile(
    project: &ProjectConfig,
    profile_key: Option<&str>,
) -> Result<Option<ProjectDebugProfileConfig>, String> {
    let Some(profile_key) = profile_key.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    project
        .debug_profiles
        .iter()
        .find(|profile| profile.key == profile_key)
        .cloned()
        .map(Some)
        .ok_or_else(|| format!("启动档案不存在: {}", profile_key))
}

fn resolve_runtime_profile(
    config: &AppConfig,
    debug_profile: Option<&ProjectDebugProfileConfig>,
    explicit_runtime_profile_key: Option<&str>,
) -> Result<Option<RuntimeProfileConfig>, String> {
    let runtime_profile_key = optional_trimmed(explicit_runtime_profile_key).or_else(|| {
        debug_profile.and_then(|profile| optional_trimmed(profile.runtime_profile.as_deref()))
    });
    let Some(runtime_profile_key) = runtime_profile_key else {
        return Ok(None);
    };
    config
        .defaults
        .runtime_profiles
        .iter()
        .find(|runtime_profile| runtime_profile.key == runtime_profile_key)
        .cloned()
        .map(Some)
        .ok_or_else(|| format!("运行环境不存在: {}", runtime_profile_key))
}

fn open_focus_url(
    url: &str,
    profile: Option<&ProjectDebugProfileConfig>,
    runtime_profile: Option<&RuntimeProfileConfig>,
) -> Result<(), String> {
    if !debug_profile_has_browser_config(profile, runtime_profile) {
        open_in_current_chrome(url)
            .map(|_| ())
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    let browser = profile
        .and_then(|profile| optional_trimmed(profile.browser.as_deref()))
        .or_else(|| {
            runtime_profile
                .and_then(|runtime_profile| optional_trimmed(runtime_profile.browser.as_deref()))
        });
    let browser_profile = profile
        .and_then(|profile| optional_trimmed(profile.browser_profile.as_deref()))
        .or_else(|| {
            runtime_profile.and_then(|runtime_profile| {
                optional_trimmed(runtime_profile.browser_profile.as_deref())
            })
        });
    let browser_user_data_dir = profile
        .and_then(|profile| profile.browser_user_data_dir.as_ref())
        .map(Clone::clone)
        .or_else(|| runtime_profile_browser_user_data_dir(runtime_profile));
    let mut browser_args = runtime_profile
        .map(runtime_profile_browser_args)
        .unwrap_or_default();
    browser_args.extend(profile.into_iter().flat_map(|profile| {
        profile
            .browser_args
            .iter()
            .filter_map(|arg| normalize_browser_arg(arg))
    }));

    let browser_args = browser_args
        .iter()
        .filter_map(|arg| normalize_browser_arg(arg))
        .collect::<Vec<_>>();

    let has_chromium_args =
        browser_profile.is_some() || browser_user_data_dir.is_some() || !browser_args.is_empty();
    if !has_chromium_args {
        match browser.map(normalize_browser_choice) {
            None | Some(ProjectBrowserChoice::CurrentChrome) => {
                open_in_current_chrome(url)
                    .map(|_| ())
                    .map_err(|error| error.to_string())?;
            }
            Some(ProjectBrowserChoice::System) => open_system_browser(url)?,
            Some(ProjectBrowserChoice::App(app_name)) => open_browser_app(app_name, url)?,
        }
        return Ok(());
    }

    let app_name = match browser.map(normalize_browser_choice) {
        Some(ProjectBrowserChoice::App(app_name)) => app_name.to_string(),
        _ => "Google Chrome".to_string(),
    };
    open_chromium_browser_instance(
        &app_name,
        browser_profile,
        browser_user_data_dir.as_ref(),
        &browser_args,
        url,
    )
}

fn debug_profile_has_browser_config(
    profile: Option<&ProjectDebugProfileConfig>,
    runtime_profile: Option<&RuntimeProfileConfig>,
) -> bool {
    profile.is_some_and(|profile| {
        optional_trimmed(profile.browser.as_deref()).is_some()
            || optional_trimmed(profile.browser_profile.as_deref()).is_some()
            || profile.browser_user_data_dir.is_some()
            || profile
                .browser_args
                .iter()
                .any(|arg| !arg.trim().is_empty())
    }) || runtime_profile.is_some_and(|runtime_profile| {
        optional_trimmed(runtime_profile.browser.as_deref()).is_some()
            || optional_trimmed(runtime_profile.browser_profile.as_deref()).is_some()
            || runtime_profile.browser_user_data_dir.is_some()
            || !runtime_profile.proxy_url.trim().is_empty()
            || !runtime_profile.proxy_bypass.trim().is_empty()
            || runtime_profile
                .host_resolver_rules
                .iter()
                .any(|rule| !rule.trim().is_empty())
            || runtime_profile
                .browser_args
                .iter()
                .any(|arg| !arg.trim().is_empty())
    })
}

enum ProjectBrowserChoice<'a> {
    CurrentChrome,
    System,
    App(&'a str),
}

fn normalize_browser_choice(value: &str) -> ProjectBrowserChoice<'_> {
    match value.trim().to_ascii_lowercase().as_str() {
        "" | "current_chrome" | "current chrome" | "chrome_current" | "chrome-current" => {
            ProjectBrowserChoice::CurrentChrome
        }
        "system" | "default" | "system_default" | "default_browser" => ProjectBrowserChoice::System,
        _ => ProjectBrowserChoice::App(value.trim()),
    }
}

fn optional_trimmed(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn optional_owned(value: Option<&str>) -> Option<String> {
    optional_trimmed(value).map(ToString::to_string)
}

fn normalize_browser_arg(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    let Some((key, raw_value)) = value.split_once('=') else {
        return Some(value.to_string());
    };
    let raw_value = raw_value.trim();
    if raw_value.len() >= 2 && raw_value.starts_with('"') && raw_value.ends_with('"') {
        return Some(format!(
            "{}={}",
            key.trim(),
            &raw_value[1..raw_value.len() - 1]
        ));
    }
    Some(value.to_string())
}

fn runtime_profile_browser_args(profile: &RuntimeProfileConfig) -> Vec<String> {
    let mut args = Vec::new();
    if profile.web_actions_enabled {
        args.push(format!(
            "--remote-debugging-port={}",
            profile.web_actions_port
        ));
    }
    let proxy_url = profile.proxy_url.trim();
    if !proxy_url.is_empty() {
        args.push(format!("--proxy-server={proxy_url}"));
    }
    let proxy_bypass = profile.proxy_bypass.trim();
    if !proxy_bypass.is_empty() {
        args.push(format!("--proxy-bypass-list={proxy_bypass}"));
    }
    let host_resolver_rules = profile
        .host_resolver_rules
        .iter()
        .map(|rule| rule.trim())
        .filter(|rule| !rule.is_empty())
        .collect::<Vec<_>>();
    if !host_resolver_rules.is_empty() {
        args.push(format!(
            "--host-resolver-rules={}",
            host_resolver_rules.join(", ")
        ));
    }
    args.extend(profile.browser_args.iter().filter_map(|arg| {
        let arg = normalize_browser_arg(arg)?;
        if profile.web_actions_enabled
            && arg
                .to_ascii_lowercase()
                .starts_with("--remote-debugging-port")
        {
            None
        } else {
            Some(arg)
        }
    }));
    args
}

fn runtime_profile_browser_user_data_dir(
    profile: Option<&RuntimeProfileConfig>,
) -> Option<PathBuf> {
    profile.and_then(|profile| {
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
}

fn open_system_browser(url: &str) -> Result<(), String> {
    let status = Command::new("open")
        .arg(url)
        .status()
        .map_err(|error| format!("调用系统浏览器失败: {}", error))?;
    if !status.success() {
        return Err("系统浏览器打开失败".to_string());
    }
    Ok(())
}

fn open_browser_app(app_name: &str, url: &str) -> Result<(), String> {
    let status = Command::new("open")
        .arg("-a")
        .arg(app_name)
        .arg(url)
        .status()
        .map_err(|error| format!("调用浏览器失败: {}", error))?;
    if !status.success() {
        return Err(format!("{} 打开失败", app_name));
    }
    Ok(())
}

fn open_chromium_browser_instance(
    app_name: &str,
    browser_profile: Option<&str>,
    browser_user_data_dir: Option<&PathBuf>,
    browser_args: &[String],
    url: &str,
) -> Result<(), String> {
    let mut command = Command::new("open");
    command.arg("-na").arg(app_name).arg("--args");
    if let Some(profile) = browser_profile {
        command.arg(format!("--profile-directory={profile}"));
    }
    if let Some(user_data_dir) = browser_user_data_dir {
        command.arg(format!("--user-data-dir={}", user_data_dir.display()));
    }
    for arg in browser_args {
        command.arg(arg);
    }
    command.arg(url);

    let status = command
        .status()
        .map_err(|error| format!("启动浏览器实例失败: {}", error))?;
    if !status.success() {
        return Err(format!("{} 浏览器实例启动失败", app_name));
    }
    Ok(())
}

fn resolve_command_cwd(
    project: &ProjectConfig,
    command_config: &ProjectCommandConfig,
    kind: ProjectCommandKind,
) -> Result<PathBuf, String> {
    if let Some(cwd) = command_config.cwd.as_ref() {
        if cwd.is_absolute() {
            return Ok(cwd.clone());
        }

        let Some(repo_path) = project.repo_path.as_ref() else {
            return Err(format!(
                "{} 使用相对路径时，项目必须配置 repo_path",
                kind.config_block()
            ));
        };
        return Ok(repo_path.join(cwd));
    }

    project
        .repo_path
        .clone()
        .ok_or_else(|| format!("缺少 repo_path，无法确定{}", kind.cwd_label()))
}

fn runtime_display_config(project: &ProjectConfig) -> RuntimeDisplayConfig {
    RuntimeDisplayConfig {
        repo_path: project
            .repo_path
            .as_ref()
            .map(|path| path.display().to_string()),
        dev: task_display_config(project, ProjectCommandKind::Dev),
        build: task_display_config(project, ProjectCommandKind::Build),
    }
}

fn resolve_focus_target(project: &ProjectConfig) -> Option<ProjectFocusTarget> {
    let bundle_id = project
        .focus
        .bundle_id
        .as_deref()
        .map(str::trim)
        .unwrap_or("");
    if !bundle_id.is_empty() {
        return Some(ProjectFocusTarget::AppBundle(bundle_id.to_string()));
    }

    let url = project.focus.url.as_deref().map(str::trim).unwrap_or("");
    if url.starts_with("http://") || url.starts_with("https://") {
        return Some(ProjectFocusTarget::Url(url.to_string()));
    }

    None
}

fn ready_focus_target(project: &ProjectConfig) -> Option<ProjectFocusTarget> {
    runtime_ready_summary_from_file(project, ProjectCommandKind::Dev)
        .ok()
        .and_then(|summary| focus_target_from_ready_url(&summary.url))
}

fn focus_target_from_ready_url(url: &Option<String>) -> Option<ProjectFocusTarget> {
    url.as_deref()
        .map(str::trim)
        .filter(|value| value.starts_with("http://") || value.starts_with("https://"))
        .map(|value| ProjectFocusTarget::Url(value.to_string()))
}

fn task_display_config(project: &ProjectConfig, kind: ProjectCommandKind) -> TaskDisplayConfig {
    let Some(command_config) = project_command_config(project, kind) else {
        return TaskDisplayConfig {
            configured: false,
            command: None,
            cwd: None,
            output_dir: None,
        };
    };

    let command = Some(command_config.command.trim().to_string()).filter(|value| !value.is_empty());
    let cwd = match command_config.cwd.as_ref() {
        Some(path) if path.is_absolute() => Some(path.display().to_string()),
        Some(path) => project
            .repo_path
            .as_ref()
            .map(|repo_path| repo_path.join(path))
            .map(|value| value.display().to_string()),
        None => project
            .repo_path
            .as_ref()
            .map(|path| path.display().to_string()),
    };
    let output_dir = if matches!(kind, ProjectCommandKind::Build) {
        resolve_build_output_dir(project).map(|path| path.display().to_string())
    } else {
        None
    };

    TaskDisplayConfig {
        configured: true,
        command,
        cwd,
        output_dir,
    }
}

fn resolve_build_output_dir(project: &ProjectConfig) -> Option<PathBuf> {
    let command_config = project.build.as_ref()?;
    let base_dir = resolve_command_cwd(project, command_config, ProjectCommandKind::Build).ok()?;

    if let Some(output_dir) = command_config.output_dir.as_ref() {
        return Some(resolve_relative_path(&base_dir, output_dir));
    }

    find_default_build_output_dir(&base_dir)
}

fn resolve_relative_path(base_dir: &Path, target: &Path) -> PathBuf {
    if target.is_absolute() {
        target.to_path_buf()
    } else {
        base_dir.join(target)
    }
}

fn find_default_build_output_dir(base_dir: &Path) -> Option<PathBuf> {
    [
        "dist",
        "build",
        "out",
        "src-tauri/target/release/bundle",
        "target/release/bundle",
    ]
    .into_iter()
    .map(|relative| base_dir.join(relative))
    .find(|candidate| candidate.exists() && candidate.is_dir())
}

fn project_command_config(
    project: &ProjectConfig,
    kind: ProjectCommandKind,
) -> Option<&ProjectCommandConfig> {
    match kind {
        ProjectCommandKind::Dev => project.dev.as_ref(),
        ProjectCommandKind::Build => project.build.as_ref(),
    }
}

impl ProjectCommandKind {
    fn config_block(self) -> &'static str {
        match self {
            Self::Dev => "[projects.dev]",
            Self::Build => "[projects.build]",
        }
    }

    fn command_label(self) -> &'static str {
        match self {
            Self::Dev => "启动命令",
            Self::Build => "打包命令",
        }
    }

    fn cwd_label(self) -> &'static str {
        match self {
            Self::Dev => "启动目录",
            Self::Build => "打包目录",
        }
    }

    fn log_label(self) -> &'static str {
        match self {
            Self::Dev => "dev start",
            Self::Build => "build start",
        }
    }

    fn log_file_suffix(self) -> &'static str {
        match self {
            Self::Dev => "dev",
            Self::Build => "build",
        }
    }

    fn missing_config_message(self) -> &'static str {
        match self {
            Self::Dev => "在 projects.toml 里为该项目添加 [projects.dev] 并配置 command",
            Self::Build => "在 projects.toml 里为该项目添加可选的 [projects.build] 并配置 command",
        }
    }
}

fn build_quick_exit_state(code: Option<i32>) -> ProjectTaskLastState {
    if code == Some(0) {
        return ProjectTaskLastState {
            status_key: "succeeded".to_string(),
            status_label: "已打包".to_string(),
            detail: "打包任务已完成".to_string(),
            updated_at_ms: now_ms(),
        };
    }

    ProjectTaskLastState {
        status_key: "failed".to_string(),
        status_label: "失败".to_string(),
        detail: match code {
            Some(value) => format!("打包命令已失败，退出码 {}", value),
            None => "打包命令已退出".to_string(),
        },
        updated_at_ms: now_ms(),
    }
}

fn build_finished_state(code: Option<i32>) -> ProjectTaskLastState {
    if code == Some(0) {
        return ProjectTaskLastState {
            status_key: "succeeded".to_string(),
            status_label: "已打包".to_string(),
            detail: "最近一次打包任务已完成".to_string(),
            updated_at_ms: now_ms(),
        };
    }

    ProjectTaskLastState {
        status_key: "failed".to_string(),
        status_label: "失败".to_string(),
        detail: match code {
            Some(value) => format!("最近一次打包任务失败，退出码 {}", value),
            None => "最近一次打包任务已退出".to_string(),
        },
        updated_at_ms: now_ms(),
    }
}

fn open_path(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(path);
        command
    };

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.arg("/C").arg("start").arg("").arg(path);
        command
    };

    let status = command
        .status()
        .map_err(|error| format!("打开目录失败: {}", error))?;
    if !status.success() {
        return Err(format!("打开目录失败，退出码 {:?}", status.code()));
    }

    Ok(())
}

fn focus_app_bundle(bundle_id: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let status = Command::new("open")
            .arg("-b")
            .arg(bundle_id)
            .status()
            .map_err(|error| format!("唤起应用失败: {}", error))?;

        if !status.success() {
            return Err(format!("唤起应用失败，退出码 {:?}", status.code()));
        }

        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        let _ = bundle_id;
        return Err("当前平台暂不支持按 bundle_id 唤起应用".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let _ = bundle_id;
        return Err("当前平台暂不支持按 bundle_id 唤起应用".to_string());
    }
}

fn terminate_process(child: &mut Child, _pid: u32) -> Result<(), String> {
    #[cfg(unix)]
    {
        let status = Command::new("kill")
            .arg("-TERM")
            .arg(format!("-{}", _pid))
            .status()
            .map_err(|error| format!("发送停止信号失败: {}", error))?;
        if !status.success() {
            child
                .kill()
                .map_err(|error| format!("停止进程失败: {}", error))?;
        }
    }

    #[cfg(not(unix))]
    {
        child
            .kill()
            .map_err(|error| format!("停止进程失败: {}", error))?;
    }

    child
        .wait()
        .map_err(|error| format!("等待进程退出失败: {}", error))?;
    Ok(())
}

fn terminate_running_project_process(process: &mut RunningProjectProcess) -> Result<(), String> {
    terminate_process(&mut process.child, process.pid)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn log_project_runtime_event(message: String) {
    let path = default_config_dir().join("project-runtime.log");
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "[{}] {}", now_ms(), message);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AppStartedRuntimeSession, app_owns_runtime_status, external_dev_task_state,
        running_build_task_state, runtime_daemon_status_to_task_state, runtime_daemon_task_state,
        runtime_display_config, should_strip_inherited_env,
    };
    use rdevtool_core::config::{
        BranchRules, Jobs, ProjectCommandConfig, ProjectConfig, ProjectFocusConfig,
    };
    use rdevtool_core::runtime::ProjectRuntimeExternalDetection;
    use rdevtool_core::runtime_daemon::{
        RuntimeDaemonExit, RuntimeDaemonPhase, RuntimeDaemonState, RuntimeDaemonStatus,
        RuntimeProcessIdentity,
    };
    use std::{collections::HashMap, path::PathBuf};

    fn project_without_runtime_path(dev: Option<ProjectCommandConfig>) -> ProjectConfig {
        ProjectConfig {
            key: "deploy-only".to_string(),
            name: "Deploy Only".to_string(),
            category: "Workspace".to_string(),
            repo_path: None,
            git_url: String::new(),
            deploy_targets: Vec::new(),
            jobs: Jobs::default(),
            dev,
            build: None,
            focus: ProjectFocusConfig::default(),
            branch_rules: BranchRules::default(),
            debug_profiles: Vec::new(),
        }
    }

    fn daemon_status(
        phase: RuntimeDaemonPhase,
        running: bool,
        managed: bool,
    ) -> RuntimeDaemonStatus {
        let exit = matches!(
            &phase,
            RuntimeDaemonPhase::Exited | RuntimeDaemonPhase::Failed
        )
        .then(|| RuntimeDaemonExit {
            code: Some(1),
            signal: None,
            reason: "test exit".to_string(),
            exited_at_ms: 200,
        });
        RuntimeDaemonStatus {
            status_key: "test-status".to_string(),
            phase_key: match &phase {
                RuntimeDaemonPhase::Starting => "starting",
                RuntimeDaemonPhase::Running => "running",
                RuntimeDaemonPhase::Stopping => "stopping",
                RuntimeDaemonPhase::Exited => "stopped",
                RuntimeDaemonPhase::Failed => "failed",
            }
            .to_string(),
            project_key: "demo".to_string(),
            canonical_cwd: "/tmp/demo".to_string(),
            state_path: "/tmp/demo.state.json".to_string(),
            running,
            managed,
            version_compatible: true,
            daemon_alive: managed,
            worker_group_alive: running,
            local_proxy_group_alive: false,
            detail: "test detail".to_string(),
            state: Some(RuntimeDaemonState {
                schema_version: 1,
                protocol_version: 1,
                app_version: "test".to_string(),
                run_id: "run-1".to_string(),
                status_key: "test-status".to_string(),
                project_key: "demo".to_string(),
                project_name: "Demo".to_string(),
                canonical_cwd: "/tmp/demo".to_string(),
                command: "npm run dev".to_string(),
                debug_profile: None,
                runtime_profile: None,
                expected_port: Some(3000),
                ready_probe: None,
                ready_url: Some("http://localhost:3000".to_string()),
                daemon_pid: 10,
                worker_pid: Some(11),
                worker_pgid: Some(11),
                adopted: false,
                adopted_process: None,
                local_proxy_pid: None,
                local_proxy_pgid: None,
                started_at: "test".to_string(),
                started_at_ms: 100,
                log_path: "/tmp/demo.log".to_string(),
                phase,
                exit,
                executable: "/tmp/rdevtool".to_string(),
                request_path: "/tmp/demo.request.json".to_string(),
            }),
        }
    }

    #[test]
    fn maps_managed_daemon_phases_to_snapshot_states() {
        for (phase, running, expected_key, expected_can_stop) in [
            (RuntimeDaemonPhase::Starting, true, "starting", true),
            (RuntimeDaemonPhase::Running, true, "running", true),
            (RuntimeDaemonPhase::Stopping, true, "stopping", true),
            (RuntimeDaemonPhase::Failed, false, "failed", false),
        ] {
            let state = runtime_daemon_status_to_task_state(&daemon_status(phase, running, true));
            assert_eq!(state.status_key, expected_key);
            assert_eq!(state.can_stop, expected_can_stop);
        }
    }

    #[test]
    fn deploy_only_project_is_reported_as_not_configured_in_runtime_list() {
        let project = project_without_runtime_path(None);
        let display = runtime_display_config(&project);
        let state = runtime_daemon_task_state(&project, &display.dev, &mut HashMap::new()).unwrap();

        assert_eq!(state.status_key, "notConfigured");
        assert_eq!(
            state.detail,
            "在 projects.toml 里为该项目添加 [projects.dev] 并配置 command"
        );
        assert!(!state.is_available);
    }

    #[test]
    fn dev_project_without_any_runtime_path_is_reported_as_invalid_config() {
        let project = project_without_runtime_path(Some(ProjectCommandConfig {
            command: "npm run dev".to_string(),
            ..ProjectCommandConfig::default()
        }));
        let display = runtime_display_config(&project);
        let state = runtime_daemon_task_state(&project, &display.dev, &mut HashMap::new()).unwrap();

        assert_eq!(state.status_key, "invalidConfig");
        assert!(state.detail.contains("has no dev.cwd"));
        assert!(!state.is_available);
    }

    #[test]
    fn maps_external_listener_to_adoptable_non_stoppable_state() {
        let state = external_dev_task_state(ProjectRuntimeExternalDetection {
            process: RuntimeProcessIdentity {
                pid: 42,
                ppid: 7,
                pgid: 7,
                canonical_cwd: "/tmp/demo".to_string(),
                command: "node vite".to_string(),
                started_at: "test".to_string(),
            },
            expected_port: 5173,
            ready_url: Some("http://127.0.0.1:5173".to_string()),
        });
        assert_eq!(state.status_key, "external");
        assert!(state.is_running);
        assert!(state.can_adopt);
        assert!(!state.can_stop);
        assert_eq!(state.pid, Some(42));
    }

    #[test]
    fn marks_unmanaged_runtime_as_lost_and_not_stoppable() {
        let state = runtime_daemon_status_to_task_state(&daemon_status(
            RuntimeDaemonPhase::Running,
            true,
            false,
        ));

        assert_eq!(state.status_key, "lost");
        assert!(state.is_running);
        assert!(!state.can_stop);
    }

    #[test]
    fn marks_stale_active_daemon_state_as_lost_and_not_stoppable() {
        let state = runtime_daemon_status_to_task_state(&daemon_status(
            RuntimeDaemonPhase::Starting,
            false,
            false,
        ));

        assert_eq!(state.status_key, "lost");
        assert!(!state.is_running);
        assert!(!state.can_stop);
    }

    #[test]
    fn running_build_remains_stoppable() {
        let state = running_build_task_state(42, 100);

        assert_eq!(state.status_key, "running");
        assert_eq!(state.pid, Some(42));
        assert!(state.is_running);
        assert!(state.can_stop);
    }

    #[test]
    fn app_exit_ownership_requires_the_same_managed_run() {
        let session = AppStartedRuntimeSession {
            status_key: "test-status".to_string(),
            project_key: "demo".to_string(),
            project_name: "Demo".to_string(),
            cwd: PathBuf::from("/tmp/demo"),
            run_id: "run-1".to_string(),
        };
        let current = daemon_status(RuntimeDaemonPhase::Running, true, true);
        assert!(app_owns_runtime_status(&session, &current));

        let mut replaced = current.clone();
        replaced.state.as_mut().unwrap().run_id = "run-2".to_string();
        assert!(!app_owns_runtime_status(&session, &replaced));

        let unmanaged = daemon_status(RuntimeDaemonPhase::Running, true, false);
        assert!(!app_owns_runtime_status(&session, &unmanaged));
    }

    #[test]
    fn strips_tauri_and_manifest_metadata_from_launcher_env() {
        assert!(should_strip_inherited_env("TAURI_CONFIG"));
        assert!(should_strip_inherited_env("CARGO_MANIFEST_DIR"));
        assert!(should_strip_inherited_env("CARGO_MANIFEST_PATH"));
        assert!(should_strip_inherited_env("CARGO_PKG_NAME"));
        assert!(should_strip_inherited_env("OUT_DIR"));
    }

    #[test]
    fn keeps_general_runtime_env_available() {
        assert!(!should_strip_inherited_env("PATH"));
        assert!(!should_strip_inherited_env("HOME"));
        assert!(!should_strip_inherited_env("RUSTUP_HOME"));
        assert!(!should_strip_inherited_env("CARGO_HOME"));
    }
}
