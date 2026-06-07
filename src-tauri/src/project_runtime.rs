use rdevtool_core::config::{
    AppConfig, ProjectCommandConfig, ProjectConfig, ProjectDebugProfileConfig, default_config_dir,
};
use rdevtool_core::navigation::open_in_current_chrome;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Component, Path, PathBuf};
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
    pub env: BTreeMap<String, String>,
    pub env_count: usize,
    pub local_file_count: usize,
    pub browser: Option<String>,
    pub browser_profile: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProjectRuntimeLogKind {
    Dev,
    Build,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeLogResponse {
    pub path: String,
    pub lines: Vec<String>,
    pub truncated: bool,
}

#[derive(Clone, Default)]
pub struct ProjectRuntimeState {
    inner: Arc<ProjectRuntimeRegistry>,
}

#[derive(Default)]
struct ProjectRuntimeRegistry {
    state: Mutex<ProjectRuntimeStore>,
}

#[derive(Default)]
struct ProjectRuntimeStore {
    running: HashMap<String, RunningProjectProcess>,
    last_results: HashMap<String, ProjectTaskLastState>,
    running_builds: HashMap<String, RunningProjectProcess>,
    last_build_results: HashMap<String, ProjectTaskLastState>,
}

impl ProjectRuntimeStore {
    fn dev_parts(
        &mut self,
    ) -> (
        &mut HashMap<String, RunningProjectProcess>,
        &mut HashMap<String, ProjectTaskLastState>,
    ) {
        (&mut self.running, &mut self.last_results)
    }

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
struct ProjectTaskLastState {
    status_key: String,
    status_label: String,
    detail: String,
    updated_at_ms: u64,
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
    pid: Option<u32>,
    started_at_ms: Option<u64>,
    updated_at_ms: u64,
    is_running: bool,
    is_available: bool,
}

#[derive(Clone, Copy)]
enum ProjectCommandKind {
    Dev,
    Build,
}

impl ProjectRuntimeLogKind {
    fn command_kind(&self) -> ProjectCommandKind {
        match self {
            Self::Dev => ProjectCommandKind::Dev,
            Self::Build => ProjectCommandKind::Build,
        }
    }
}

impl Drop for ProjectRuntimeRegistry {
    fn drop(&mut self) {
        if let Ok(mut store) = self.state.lock() {
            for (_, mut process) in store.running.drain() {
                let _ = terminate_process(&mut process.child, process.pid);
            }
            for (_, mut process) in store.running_builds.drain() {
                let _ = terminate_process(&mut process.child, process.pid);
            }
        }
    }
}

impl ProjectRuntimeState {
    pub fn list(&self, config: &AppConfig) -> Result<Vec<ProjectRuntimeSnapshot>, String> {
        let mut store = self
            .inner
            .state
            .lock()
            .map_err(|_| "project runtime lock poisoned".to_string())?;
        config
            .projects
            .iter()
            .map(|project| snapshot_for_project(&mut store, project))
            .collect()
    }

    pub fn list_selected(
        &self,
        config: &AppConfig,
        project_keys: &[String],
    ) -> Result<Vec<ProjectRuntimeSnapshot>, String> {
        let mut store = self
            .inner
            .state
            .lock()
            .map_err(|_| "project runtime lock poisoned".to_string())?;

        let mut snapshots = Vec::new();
        for project_key in project_keys {
            let project = config
                .find_project(project_key)
                .map_err(|error| error.to_string())?;
            snapshots.push(snapshot_for_project(&mut store, project)?);
        }
        Ok(snapshots)
    }

    pub fn start(
        &self,
        config: &AppConfig,
        project_key: &str,
        debug_profile_key: Option<&str>,
        env_overrides: Option<&BTreeMap<String, String>>,
    ) -> Result<ProjectRuntimeSnapshot, String> {
        log_project_runtime_event(format!("start requested key={}", project_key));
        let project = config
            .find_project(project_key)
            .map_err(|error| error.to_string())?;
        let debug_profile = selected_debug_profile(project, debug_profile_key)?;
        if let Some(profile) = debug_profile.as_ref() {
            apply_debug_profile_local_files(project, profile)?;
        }
        let mut resolved = resolve_project_command(project, ProjectCommandKind::Dev)?;
        if let Some(env_overrides) = env_overrides {
            for (key, value) in env_overrides {
                resolved.env.insert(key.clone(), value.clone());
            }
        } else if let Some(profile) = debug_profile.as_ref() {
            for (key, value) in &profile.env {
                resolved.env.insert(key.clone(), value.clone());
            }
        }
        let launch_resolved = resolved.clone();
        log_project_runtime_event(format!(
            "start resolved key={} cwd={} command={} debug_profile={} env_overrides={}",
            project.key,
            resolved.cwd.display(),
            resolved.command,
            debug_profile
                .as_ref()
                .map(|profile| profile.key.as_str())
                .unwrap_or("default"),
            env_overrides.map(|values| values.len()).unwrap_or(0)
        ));

        let mut store = self
            .inner
            .state
            .lock()
            .map_err(|_| "project runtime lock poisoned".to_string())?;
        let already_running = {
            let (running, last_results) = store.dev_parts();
            task_running_state(running, last_results, project, ProjectCommandKind::Dev)?.is_some()
        };
        if already_running {
            return snapshot_for_project(&mut store, project);
        }

        {
            let (running, last_results) = store.dev_parts();
            launch_project_command(
                running,
                last_results,
                project,
                launch_resolved,
                ProjectCommandKind::Dev,
            )?;
        }

        if let Some(process) = store.running.get(&project.key) {
            log_project_runtime_event(format!(
                "start launched key={} pid={} cwd={} command={}",
                project.key,
                process.pid,
                resolved.cwd.display(),
                resolved.command
            ));
        }

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
            task_running_state(running, last_results, project, ProjectCommandKind::Build)?.is_some()
        };
        if already_running {
            return snapshot_for_project(&mut store, project);
        }

        {
            let (running, last_results) = store.build_parts();
            launch_project_command(
                running,
                last_results,
                project,
                launch_resolved,
                ProjectCommandKind::Build,
            )?;
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

    pub fn stop(
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
            let (running, last_results) = store.dev_parts();
            let _ = task_running_state(running, last_results, project, ProjectCommandKind::Dev)?;
        }

        if let Some(mut process) = store.running.remove(&project.key) {
            log_project_runtime_event(format!(
                "stop requested key={} pid={}",
                project.key, process.pid
            ));
            terminate_process(&mut process.child, process.pid)?;
            store.last_results.insert(
                project.key.clone(),
                ProjectTaskLastState {
                    status_key: "stopped".to_string(),
                    status_label: "未启动".to_string(),
                    detail: "已停止 dev 服务".to_string(),
                    updated_at_ms: now_ms(),
                },
            );
        }

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
            let _ = task_running_state(running, last_results, project, ProjectCommandKind::Build)?;
        }

        if let Some(mut process) = store.running_builds.remove(&project.key) {
            log_project_runtime_event(format!(
                "build stop requested key={} pid={}",
                project.key, process.pid
            ));
            terminate_process(&mut process.child, process.pid)?;
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

    pub fn open_build_output(
        &self,
        config: &AppConfig,
        project_key: &str,
    ) -> Result<ProjectRuntimeSnapshot, String> {
        let project = config
            .find_project(project_key)
            .map_err(|error| error.to_string())?;
        let output_dir = resolve_build_output_dir(project)
            .ok_or_else(|| "未找到产物目录，请在 [projects.build] 下配置 output_dir".to_string())?;
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
    ) -> Result<ProjectRuntimeSnapshot, String> {
        let project = config
            .find_project(project_key)
            .map_err(|error| error.to_string())?;

        match resolve_focus_target(project) {
            Some(ProjectFocusTarget::AppBundle(bundle_id)) => {
                log_project_runtime_event(format!(
                    "focus runtime key={} bundle_id={}",
                    project.key, bundle_id
                ));
                focus_app_bundle(&bundle_id)?;
            }
            Some(ProjectFocusTarget::Url(url)) => {
                log_project_runtime_event(format!("focus runtime key={} url={}", project.key, url));
                open_in_current_chrome(&url)
                    .map_err(|error| format!("打开项目页面失败: {}", error))?;
            }
            None => return Err("当前项目未配置可唤起目标".to_string()),
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
        let project = config
            .find_project(project_key)
            .map_err(|error| error.to_string())?;
        let path = task_log_path(project, kind.command_kind());
        let normalized_limit = max_lines.clamp(20, 500);
        let (lines, truncated) = tail_log_lines(&path, normalized_limit)?;
        Ok(ProjectRuntimeLogResponse {
            path: path.display().to_string(),
            lines,
            truncated,
        })
    }
}

fn snapshot_for_project(
    store: &mut ProjectRuntimeStore,
    project: &ProjectConfig,
) -> Result<ProjectRuntimeSnapshot, String> {
    let display = runtime_display_config(project);
    let build_output_dir = resolve_build_output_dir(project);
    let can_focus_runtime = resolve_focus_target(project).is_some();
    let dev_state = {
        let (running, last_results) = store.dev_parts();
        task_state_for_project(
            running,
            last_results,
            project,
            &display.dev,
            ProjectCommandKind::Dev,
        )?
    };
    let build_state = {
        let (running, last_results) = store.build_parts();
        task_state_for_project(
            running,
            last_results,
            project,
            &display.build,
            ProjectCommandKind::Build,
        )?
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
    let build_log_path = display.build.command.as_ref().map(|_| {
        task_log_path(project, ProjectCommandKind::Build)
            .display()
            .to_string()
    });

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
        can_stop: dev_state.is_running,
        can_build: build_state.is_available && !build_state.is_running,
        can_stop_build: build_state.is_running,
        can_open_build_output,
        can_focus_runtime,
        debug_profiles: project
            .debug_profiles
            .iter()
            .map(|profile| ProjectDebugProfileSummary {
                key: profile.key.clone(),
                label: profile.label.clone(),
                env: profile.env.clone(),
                env_count: profile.env.len(),
                local_file_count: profile
                    .local_files
                    .iter()
                    .filter(|item| item.enabled)
                    .count(),
                browser: profile.browser.clone(),
                browser_profile: profile.browser_profile.clone(),
            })
            .collect(),
    })
}

fn task_state_for_project(
    running: &mut HashMap<String, RunningProjectProcess>,
    last_results: &mut HashMap<String, ProjectTaskLastState>,
    project: &ProjectConfig,
    display: &TaskDisplayConfig,
    kind: ProjectCommandKind,
) -> Result<TaskSnapshotState, String> {
    let mut updated_at_ms = now_ms();

    if let Some(running_state) = task_running_state(running, last_results, project, kind)? {
        return Ok(running_state);
    }

    let last_state = last_results.get(&project.key).cloned();
    if let Some(last) = last_state.as_ref() {
        updated_at_ms = last.updated_at_ms;
    }

    match resolve_project_command(project, kind) {
        Ok(_) => {
            if let Some(last) = last_state {
                return Ok(TaskSnapshotState {
                    status_key: last.status_key,
                    status_label: last.status_label,
                    detail: last.detail,
                    pid: None,
                    started_at_ms: None,
                    updated_at_ms,
                    is_running: false,
                    is_available: true,
                });
            }

            let (status_key, status_label, detail) = kind.idle_state();
            Ok(TaskSnapshotState {
                status_key: status_key.to_string(),
                status_label: status_label.to_string(),
                detail: detail.to_string(),
                pid: None,
                started_at_ms: None,
                updated_at_ms,
                is_running: false,
                is_available: true,
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
            pid: None,
            started_at_ms: None,
            updated_at_ms,
            is_running: false,
            is_available: false,
        }),
    }
}

fn task_running_state(
    running: &mut HashMap<String, RunningProjectProcess>,
    last_results: &mut HashMap<String, ProjectTaskLastState>,
    project: &ProjectConfig,
    kind: ProjectCommandKind,
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
                let (status_key, status_label, detail) = kind.running_state();
                return Ok(Some(TaskSnapshotState {
                    status_key: status_key.to_string(),
                    status_label: status_label.to_string(),
                    detail: detail.to_string(),
                    pid: Some(process.pid),
                    started_at_ms: Some(process.started_at_ms),
                    updated_at_ms: now_ms(),
                    is_running: true,
                    is_available: true,
                }));
            }
        }
    }

    if let Some(code) = remove_exited {
        running.remove(&project.key);
        last_results.insert(project.key.clone(), kind.finished_state(code));
    }

    Ok(None)
}

fn launch_project_command(
    running: &mut HashMap<String, RunningProjectProcess>,
    last_results: &mut HashMap<String, ProjectTaskLastState>,
    project: &ProjectConfig,
    resolved: ResolvedProjectCommand,
    kind: ProjectCommandKind,
) -> Result<(), String> {
    let mut log_file = open_task_log(project, &resolved, kind)?;
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
        .map_err(|error| format!("{} {} 失败: {}", kind.action_label(), project.name, error))?;
    let pid = child.id();
    let started_at_ms = now_ms();

    thread::sleep(Duration::from_millis(240));
    match child.try_wait().map_err(|error| error.to_string())? {
        Some(status) => {
            let _ = writeln!(log_file, "[{}] exited quickly status={}", now_ms(), status);
            last_results.insert(project.key.clone(), kind.quick_exit_state(status.code()));
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
    writeln!(
        file,
        "\n[{}] {} key={} cwd={} command={}",
        now_ms(),
        kind.log_label(),
        project.key,
        resolved.cwd.display(),
        resolved.command
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

fn tail_log_lines(path: &Path, max_lines: usize) -> Result<(Vec<String>, bool), String> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok((Vec::new(), false));
        }
        Err(error) => return Err(format!("读取运行日志失败: {}", error)),
    };
    let reader = BufReader::new(file);
    let mut lines = VecDeque::with_capacity(max_lines.saturating_add(1));
    let mut total = 0usize;
    for line in reader.lines() {
        total += 1;
        let line = line.map_err(|error| format!("读取运行日志失败: {}", error))?;
        if lines.len() == max_lines {
            lines.pop_front();
        }
        lines.push_back(line);
    }
    Ok((lines.into_iter().collect(), total > max_lines))
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
        .ok_or_else(|| format!("调试档案不存在: {}", profile_key))
}

fn apply_debug_profile_local_files(
    project: &ProjectConfig,
    profile: &ProjectDebugProfileConfig,
) -> Result<(), String> {
    if profile.local_files.is_empty() {
        return Ok(());
    }
    let repo_path = project
        .repo_path
        .as_ref()
        .ok_or_else(|| "调试档案写入本地文件需要项目配置 repo_path".to_string())?;
    if !repo_path.exists() || !repo_path.is_dir() {
        return Err(format!(
            "项目目录不存在，无法应用调试档案: {}",
            repo_path.display()
        ));
    }
    let git_checked = repo_path.join(".git").exists();
    for local_file in profile.local_files.iter().filter(|item| item.enabled) {
        let (target_path, relative_path) =
            resolve_debug_local_file_path(repo_path, &local_file.path)?;
        if git_checked {
            ensure_debug_local_file_git_safe(repo_path, &relative_path)?;
        }
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("创建本地调试文件目录失败: {}", error))?;
        }
        match local_file.mode.trim() {
            "" | "overwrite" => {
                fs::write(&target_path, &local_file.content)
                    .map_err(|error| format!("写入本地调试文件失败: {}", error))?;
            }
            "append_block" => {
                write_debug_append_block(
                    &target_path,
                    &profile.key,
                    &relative_path,
                    &local_file.content,
                )?;
            }
            other => {
                return Err(format!(
                    "本地调试文件 {} 使用了不支持的写入方式: {}",
                    relative_path, other
                ));
            }
        }
        log_project_runtime_event(format!(
            "debug profile applied project={} profile={} file={} mode={}",
            project.key, profile.key, relative_path, local_file.mode
        ));
    }
    Ok(())
}

fn resolve_debug_local_file_path(
    repo_path: &Path,
    file_path: &Path,
) -> Result<(PathBuf, String), String> {
    if file_path.as_os_str().is_empty() {
        return Err("本地调试文件路径不能为空".to_string());
    }
    if file_path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(format!(
            "本地调试文件路径不能包含 ..: {}",
            file_path.display()
        ));
    }
    let target_path = if file_path.is_absolute() {
        if !file_path.starts_with(repo_path) {
            return Err(format!(
                "本地调试文件必须位于项目目录内: {}",
                file_path.display()
            ));
        }
        file_path.to_path_buf()
    } else {
        repo_path.join(file_path)
    };
    let relative_path = target_path
        .strip_prefix(repo_path)
        .map_err(|_| format!("本地调试文件必须位于项目目录内: {}", target_path.display()))?
        .to_string_lossy()
        .replace('\\', "/");
    Ok((target_path, relative_path))
}

fn ensure_debug_local_file_git_safe(repo_path: &Path, relative_path: &str) -> Result<(), String> {
    let tracked = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("ls-files")
        .arg("--error-unmatch")
        .arg("--")
        .arg(relative_path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| format!("检查本地调试文件 Git 状态失败: {}", error))?
        .success();
    if tracked {
        return Err(format!(
            "{} 已被 git 跟踪，拒绝用调试档案覆盖；请改用被 .gitignore 忽略的本地配置文件",
            relative_path
        ));
    }

    let ignored_status = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("check-ignore")
        .arg("-q")
        .arg("--")
        .arg(relative_path)
        .status()
        .map_err(|error| format!("检查本地调试文件 .gitignore 状态失败: {}", error))?;
    if !ignored_status.success() {
        return Err(format!(
            "{} 当前没有被 .gitignore 忽略；为避免误提交，请先加入 .gitignore 后再应用调试档案",
            relative_path
        ));
    }
    Ok(())
}

fn write_debug_append_block(
    target_path: &Path,
    profile_key: &str,
    relative_path: &str,
    content: &str,
) -> Result<(), String> {
    let existing = match fs::read_to_string(target_path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(format!("读取本地调试文件失败: {}", error)),
    };
    let start_marker = format!("# >>> rDevTool:{}:{}\n", profile_key, relative_path);
    let end_marker = format!("# <<< rDevTool:{}:{}\n", profile_key, relative_path);
    let block = format!(
        "{}{}\n{}",
        start_marker,
        content.trim_end_matches('\n'),
        end_marker
    );
    let next = if let (Some(start), Some(end)) = (
        existing.find(&start_marker),
        existing
            .find(&end_marker)
            .map(|index| index + end_marker.len()),
    ) {
        format!("{}{}{}", &existing[..start], block, &existing[end..])
    } else if existing.trim().is_empty() {
        block
    } else {
        format!("{}\n\n{}", existing.trim_end_matches('\n'), block)
    };
    fs::write(target_path, next).map_err(|error| format!("写入本地调试文件失败: {}", error))
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
    fn action_label(self) -> &'static str {
        match self {
            Self::Dev => "启动",
            Self::Build => "执行打包",
        }
    }

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

    fn idle_state(self) -> (&'static str, &'static str, &'static str) {
        match self {
            Self::Dev => ("stopped", "未启动", "配置已就绪，可启动 dev 服务"),
            Self::Build => ("stopped", "待打包", "配置已就绪，可执行打包任务"),
        }
    }

    fn running_state(self) -> (&'static str, &'static str, &'static str) {
        match self {
            Self::Dev => ("running", "运行中", "dev 服务正在运行"),
            Self::Build => ("running", "打包中", "打包任务正在运行"),
        }
    }

    fn quick_exit_state(self, code: Option<i32>) -> ProjectTaskLastState {
        match self {
            Self::Dev => ProjectTaskLastState {
                status_key: "exited".to_string(),
                status_label: "已退出".to_string(),
                detail: match code {
                    Some(value) => format!("启动命令很快退出，退出码 {}", value),
                    None => "启动命令已退出".to_string(),
                },
                updated_at_ms: now_ms(),
            },
            Self::Build => {
                if code == Some(0) {
                    ProjectTaskLastState {
                        status_key: "succeeded".to_string(),
                        status_label: "已打包".to_string(),
                        detail: "打包任务已完成".to_string(),
                        updated_at_ms: now_ms(),
                    }
                } else {
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
            }
        }
    }

    fn finished_state(self, code: Option<i32>) -> ProjectTaskLastState {
        match self {
            Self::Dev => ProjectTaskLastState {
                status_key: "exited".to_string(),
                status_label: "已退出".to_string(),
                detail: match code {
                    Some(value) => format!("最近一次 dev 服务已退出，退出码 {}", value),
                    None => "最近一次 dev 服务已退出".to_string(),
                },
                updated_at_ms: now_ms(),
            },
            Self::Build => {
                if code == Some(0) {
                    ProjectTaskLastState {
                        status_key: "succeeded".to_string(),
                        status_label: "已打包".to_string(),
                        detail: "最近一次打包任务已完成".to_string(),
                        updated_at_ms: now_ms(),
                    }
                } else {
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
            }
        }
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
    use super::should_strip_inherited_env;

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
