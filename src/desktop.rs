use anyhow::{Result, anyhow};
use eframe::egui::{self, Align2, Color32, ComboBox, FontId, RichText, Sense, Stroke, TextFormat};
use rdevtool_core::config::{AppConfig, JobConfig, ProjectConfig};
use rdevtool_core::core::{DeployPlan, DeployRequest, build_plan};
use rdevtool_core::{credentials, git, gitlab, jenkins};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, TryRecvError};
use std::thread;
use std::time::{Duration, Instant};
use tray_icon::menu::{Menu, MenuEvent, MenuId, MenuItem, PredefinedMenuItem};
use tray_icon::{Icon, TrayIcon, TrayIconBuilder};

const PAPER: Color32 = Color32::from_rgb(244, 239, 232);
const PANEL: Color32 = Color32::from_rgb(253, 249, 244);
const PANEL_SOFT: Color32 = Color32::from_rgb(248, 243, 236);
const PANEL_RAISED: Color32 = Color32::from_rgb(255, 252, 248);
const INK: Color32 = Color32::from_rgb(38, 42, 49);
const MUTED: Color32 = Color32::from_rgb(114, 119, 126);
const ACCENT: Color32 = Color32::from_rgb(179, 103, 74);
const ACCENT_SOFT: Color32 = Color32::from_rgb(243, 230, 221);
const SUCCESS: Color32 = Color32::from_rgb(75, 132, 103);
const ERROR: Color32 = Color32::from_rgb(186, 93, 93);
const BORDER: Color32 = Color32::from_rgb(221, 213, 203);
const AUTO_REFRESH_INTERVAL: Duration = Duration::from_secs(5);
const BRANCH_RESULT_LIMIT: usize = 200;
const NAVIGATION_PREVIEW_LIMIT: usize = 5;
const INPUT_HEIGHT: f32 = 32.0;
const PRIMARY_ACTION_HEIGHT: f32 = 36.0;
const MERGE_TARGET_PRIORITY_KEYWORDS: [&str; 4] = ["master", "env", "variant", "pre"];

fn is_ephemeral_branch(name: &str) -> bool {
    name.trim().starts_with("yc-merge-")
}

pub fn run(config: AppConfig) -> Result<()> {
    let native_options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([600.0, 600.0])
            .with_min_inner_size([600.0, 520.0])
            .with_icon(create_window_icon())
            .with_title("rDevTool"),
        ..Default::default()
    };

    eframe::run_native(
        "rDevTool",
        native_options,
        Box::new(move |cc| {
            apply_theme(&cc.egui_ctx);
            Ok(Box::new(DesktopApp::new(config.clone())))
        }),
    )
    .map_err(|error| anyhow!("failed to launch desktop app: {error}"))?;

    Ok(())
}

fn apply_theme(ctx: &egui::Context) {
    apply_cjk_font(ctx);

    let mut visuals = egui::Visuals::light();
    visuals.override_text_color = Some(INK);
    visuals.panel_fill = PAPER;
    visuals.widgets.noninteractive.bg_fill = PANEL_RAISED;
    visuals.widgets.noninteractive.bg_stroke = Stroke::new(1.0, BORDER);
    visuals.widgets.inactive.bg_fill = PANEL_RAISED;
    visuals.widgets.inactive.bg_stroke = Stroke::new(1.0, BORDER);
    visuals.widgets.hovered.bg_fill = PANEL_SOFT;
    visuals.widgets.hovered.bg_stroke = Stroke::new(1.0, ACCENT);
    visuals.widgets.active.bg_fill = ACCENT_SOFT;
    visuals.widgets.active.bg_stroke = Stroke::new(1.0, ACCENT);
    visuals.selection.bg_fill = ACCENT_SOFT;
    visuals.selection.stroke = Stroke::new(1.0, ACCENT);
    visuals.faint_bg_color = PANEL_SOFT;
    visuals.extreme_bg_color = PANEL_RAISED;
    ctx.set_visuals(visuals);

    let mut style = (*ctx.style()).clone();
    style.spacing.item_spacing = egui::vec2(7.0, 7.0);
    style.spacing.button_padding = egui::vec2(10.0, 7.0);
    style.spacing.window_margin = egui::Margin::same(12);
    style
        .text_styles
        .insert(egui::TextStyle::Heading, egui::FontId::proportional(21.0));
    style
        .text_styles
        .insert(egui::TextStyle::Body, egui::FontId::proportional(13.5));
    style
        .text_styles
        .insert(egui::TextStyle::Button, egui::FontId::proportional(12.8));
    style
        .text_styles
        .insert(egui::TextStyle::Small, egui::FontId::proportional(11.5));
    style.visuals.window_corner_radius = 18.0.into();
    style.visuals.menu_corner_radius = 16.0.into();
    style.visuals.widgets.inactive.corner_radius = 12.0.into();
    style.visuals.widgets.hovered.corner_radius = 12.0.into();
    style.visuals.widgets.active.corner_radius = 12.0.into();
    ctx.set_style(style);
}

fn apply_cjk_font(ctx: &egui::Context) {
    let font_path = "/System/Library/Fonts/Supplemental/Arial Unicode.ttf";
    let Ok(bytes) = fs::read(font_path) else {
        return;
    };

    let mut fonts = egui::FontDefinitions::default();
    fonts.font_data.insert(
        "cjk-ui".to_string(),
        egui::FontData::from_owned(bytes).into(),
    );

    if let Some(family) = fonts.families.get_mut(&egui::FontFamily::Proportional) {
        family.insert(0, "cjk-ui".to_string());
    }
    if let Some(family) = fonts.families.get_mut(&egui::FontFamily::Monospace) {
        family.insert(0, "cjk-ui".to_string());
    }

    ctx.set_fonts(fonts);
}

struct DesktopApp {
    config: AppConfig,
    active_menu: PrimaryMenu,
    sidebar_collapsed: bool,
    selected: usize,
    status: String,
    navigation_categories: Vec<NavCategory>,
    navigation_query: String,
    navigation_category_filter: String,
    last_result: Option<DeployResultView>,
    merge_result: Option<MergeResultView>,
    env_overrides: BTreeMap<String, String>,
    branch_overrides: BTreeMap<String, String>,
    merge_target_overrides: BTreeMap<String, String>,
    merge_source_overrides: BTreeMap<String, String>,
    branch_queries: BTreeMap<String, String>,
    merge_target_queries: BTreeMap<String, String>,
    merge_source_queries: BTreeMap<String, String>,
    branch_recents: BTreeMap<String, Vec<String>>,
    deploy_param_overrides: BTreeMap<String, BTreeMap<String, String>>,
    variant_overrides: BTreeMap<String, bool>,
    branch_options: BTreeMap<String, Vec<String>>,
    state_path: PathBuf,
    saved_state: PersistedState,
    async_rx: Option<Receiver<AsyncEvent>>,
    pending_action: Option<PendingAction>,
    tray_runtime: Option<TrayRuntime>,
    quit_requested: bool,
    last_auto_refresh_at: Option<Instant>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PrimaryMenu {
    ProjectDeploy,
    BranchMerge,
    PageNavigation,
}

#[derive(Clone, Copy)]
enum NavIconKind {
    Deploy,
    Merge,
    Navigate,
}

#[derive(Clone)]
struct NavCategory {
    title: String,
    entries: Vec<NavEntry>,
}

#[derive(Clone)]
struct NavEntry {
    name: String,
    url: String,
    note: Option<String>,
}

#[derive(Clone)]
struct NavigationMatch {
    category: String,
    entry: NavEntry,
}

#[derive(Clone)]
struct DeployResultView {
    success: bool,
    queue_url: Option<String>,
    build_url: Option<String>,
    trigger_state: Option<jenkins::TriggerState>,
    summary: String,
    detail: String,
    http_status: Option<u16>,
    project_name: Option<String>,
    job_name: Option<String>,
    selected_params: Vec<(String, String)>,
}

#[derive(Clone)]
struct MergeResultView {
    success: bool,
    summary: String,
    detail: String,
    project_key: String,
    project_name: String,
    target_branch: String,
    source_branch: String,
    merged_commit: Option<String>,
    latest_commit: Option<git::BranchCommitSummary>,
    pushed: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PendingAction {
    BranchSync,
    Trigger,
    Refresh,
    Merge,
    MergeCreate,
    Push,
    Navigate,
}

impl PendingAction {
    fn label(self) -> &'static str {
        match self {
            PendingAction::BranchSync => "同步分支中",
            PendingAction::Trigger => "正在触发部署",
            PendingAction::Refresh => "正在刷新状态",
            PendingAction::Merge => "正在执行分支合并",
            PendingAction::MergeCreate => "正在执行分支创建",
            PendingAction::Push => "正在推送目标分支",
            PendingAction::Navigate => "正在打开页面",
        }
    }
}

enum AsyncEvent {
    BranchesLoaded {
        project_key: String,
        project_name: String,
        result: std::result::Result<Vec<String>, String>,
    },
    TriggerFinished {
        plan: DeployPlan,
        result: std::result::Result<jenkins::TriggerResult, String>,
    },
    RefreshFinished {
        previous: DeployResultView,
        result: std::result::Result<jenkins::StatusResult, String>,
    },
    MergeFinished {
        project_key: String,
        project_name: String,
        target_branch: String,
        source_branch: String,
        merged_remote: bool,
        result: std::result::Result<git::WorktreeMergeResult, String>,
    },
    PushFinished {
        project_key: String,
        project_name: String,
        target_branch: String,
        result: std::result::Result<String, String>,
    },
    NavigationFinished {
        entry_name: String,
        result: std::result::Result<(), String>,
    },
}

struct TrayRuntime {
    _tray_icon: TrayIcon,
    show_id: MenuId,
    hide_id: MenuId,
    quit_id: MenuId,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
struct PersistedState {
    selected_project_key: Option<String>,
    sidebar_collapsed: bool,
    navigation_category_filter: Option<String>,
    env_overrides: BTreeMap<String, String>,
    branch_overrides: BTreeMap<String, String>,
    merge_target_overrides: BTreeMap<String, String>,
    merge_source_overrides: BTreeMap<String, String>,
    branch_recents: BTreeMap<String, Vec<String>>,
    deploy_param_overrides: BTreeMap<String, BTreeMap<String, String>>,
    variant_overrides: BTreeMap<String, bool>,
    branch_options: BTreeMap<String, Vec<String>>,
}

impl PersistedState {
    fn load(path: &PathBuf) -> Self {
        fs::read_to_string(path)
            .ok()
            .and_then(|content| toml::from_str(&content).ok())
            .unwrap_or_default()
    }

    fn save(&self, path: &PathBuf) {
        if let Ok(content) = toml::to_string_pretty(self) {
            let _ = fs::write(path, content);
        }
    }
}

impl DesktopApp {
    fn new(config: AppConfig) -> Self {
        let state_path = std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(".rdevtool-state.toml");
        let persisted = PersistedState::load(&state_path);
        let selected = persisted
            .selected_project_key
            .as_ref()
            .and_then(|key| {
                config
                    .projects
                    .iter()
                    .position(|project| &project.key == key)
            })
            .unwrap_or(0);

        let tray_runtime = match build_tray_runtime() {
            Ok(runtime) => Some(runtime),
            Err(error) => {
                eprintln!("tray disabled: {error}");
                None
            }
        };
        let navigation_categories = load_navigation_categories().unwrap_or_default();
        let navigation_category_filter = persisted
            .navigation_category_filter
            .clone()
            .filter(|saved| {
                navigation_categories
                    .iter()
                    .any(|item| item.title == *saved)
            })
            .or_else(|| preferred_navigation_category(&navigation_categories))
            .unwrap_or_default();

        Self {
            config,
            active_menu: PrimaryMenu::ProjectDeploy,
            sidebar_collapsed: persisted.sidebar_collapsed,
            selected,
            status: "就绪".to_string(),
            navigation_categories,
            navigation_query: String::new(),
            navigation_category_filter,
            last_result: None,
            merge_result: None,
            env_overrides: persisted.env_overrides.clone(),
            branch_overrides: persisted.branch_overrides.clone(),
            merge_target_overrides: persisted.merge_target_overrides.clone(),
            merge_source_overrides: persisted.merge_source_overrides.clone(),
            branch_queries: BTreeMap::new(),
            merge_target_queries: BTreeMap::new(),
            merge_source_queries: BTreeMap::new(),
            branch_recents: persisted.branch_recents.clone(),
            deploy_param_overrides: persisted.deploy_param_overrides.clone(),
            variant_overrides: persisted.variant_overrides.clone(),
            branch_options: persisted.branch_options.clone(),
            state_path,
            saved_state: persisted,
            async_rx: None,
            pending_action: None,
            tray_runtime,
            quit_requested: false,
            last_auto_refresh_at: None,
        }
    }

    fn capture_state(&self) -> PersistedState {
        PersistedState {
            selected_project_key: Some(self.selected_project().key.clone()),
            sidebar_collapsed: self.sidebar_collapsed,
            navigation_category_filter: Some(self.navigation_category_filter.clone()),
            env_overrides: self.env_overrides.clone(),
            branch_overrides: self.branch_overrides.clone(),
            merge_target_overrides: self.merge_target_overrides.clone(),
            merge_source_overrides: self.merge_source_overrides.clone(),
            branch_recents: self.branch_recents.clone(),
            deploy_param_overrides: self.deploy_param_overrides.clone(),
            variant_overrides: self.variant_overrides.clone(),
            branch_options: self.branch_options.clone(),
        }
    }

    fn persist_if_needed(&mut self) {
        let snapshot = self.capture_state();
        if snapshot != self.saved_state {
            snapshot.save(&self.state_path);
            self.saved_state = snapshot;
        }
    }

    fn is_busy(&self) -> bool {
        self.pending_action.is_some()
    }

    fn should_auto_refresh(&self) -> bool {
        if self.is_busy() {
            return false;
        }

        let Some(view) = self.last_result.as_ref() else {
            return false;
        };

        let has_target = view.queue_url.is_some() || view.build_url.is_some();
        let running = matches!(
            view.trigger_state,
            Some(
                jenkins::TriggerState::Accepted
                    | jenkins::TriggerState::Queued
                    | jenkins::TriggerState::Running
            )
        );
        has_target && running
    }

    fn selected_project(&self) -> &ProjectConfig {
        &self.config.projects[self.selected]
    }

    fn project_key(&self) -> String {
        self.selected_project().key.clone()
    }

    fn uses_variant(&self) -> bool {
        self.variant_overrides
            .get(self.selected_project().key.as_str())
            .copied()
            .unwrap_or(false)
    }

    fn deploy_scope_key(&self, project_key: &str, use_variant: bool) -> String {
        format!(
            "{project_key}:{}",
            if use_variant { "variant" } else { "standard" }
        )
    }

    fn current_extra_params(&self) -> BTreeMap<String, String> {
        let project = self.selected_project();
        let use_variant = self.uses_variant();
        let Some(job) = selected_job(project, use_variant) else {
            return BTreeMap::new();
        };

        job.params
            .iter()
            .filter(|key: &&String| {
                matches!(
                    key.as_str(),
                    "IS_BUILD_ADMIN" | "IS_BUILD_MOBILE" | "IS_GRAY"
                )
            })
            .filter_map(|key| {
                let actual_default = job
                    .default_params
                    .get(key)
                    .map(String::as_str)
                    .unwrap_or("否");
                let preferred_default = preferred_deploy_param_default(job, key);
                let current = self.deploy_param_value(
                    self.selected_project().key.as_str(),
                    use_variant,
                    key,
                    &preferred_default,
                );

                if current.trim().is_empty() || current == actual_default {
                    None
                } else {
                    Some((key.clone(), current))
                }
            })
            .collect()
    }

    fn deploy_param_value(
        &self,
        project_key: &str,
        use_variant: bool,
        key: &str,
        default_value: &str,
    ) -> String {
        let scope = self.deploy_scope_key(project_key, use_variant);
        self.deploy_param_overrides
            .get(&scope)
            .and_then(|values| values.get(key))
            .cloned()
            .unwrap_or_else(|| default_value.to_string())
    }

    fn set_deploy_param_override(
        &mut self,
        project_key: &str,
        use_variant: bool,
        key: &str,
        value: &str,
        default_value: &str,
    ) {
        let scope = self.deploy_scope_key(project_key, use_variant);
        let normalized = value.trim();
        let default_normalized = default_value.trim();

        if normalized.is_empty() || normalized == default_normalized {
            if let Some(values) = self.deploy_param_overrides.get_mut(&scope) {
                values.remove(key);
                if values.is_empty() {
                    self.deploy_param_overrides.remove(&scope);
                }
            }
            return;
        }

        self.deploy_param_overrides
            .entry(scope)
            .or_default()
            .insert(key.to_string(), normalized.to_string());
    }

    fn env_value(&self) -> String {
        if let Some(value) = self
            .env_overrides
            .get(self.selected_project().key.as_str())
            .cloned()
        {
            return value;
        }

        self.current_plan()
            .ok()
            .and_then(|plan| plan.params.get(env_param_key(&plan)).cloned())
            .unwrap_or_default()
    }

    fn branch_value(&self) -> String {
        if let Some(value) = self
            .branch_overrides
            .get(self.selected_project().key.as_str())
            .cloned()
        {
            return value;
        }

        self.current_plan()
            .ok()
            .and_then(|plan| {
                plan.params
                    .iter()
                    .find(|(key, _)| matches!(key.as_str(), "BRANCH" | "branch" | "Branch"))
                    .map(|(_, value)| value.clone())
            })
            .unwrap_or_default()
    }

    fn branch_query(&self) -> String {
        self.branch_queries
            .get(self.selected_project().key.as_str())
            .cloned()
            .unwrap_or_default()
    }

    fn merge_target_value(&self) -> String {
        self.merge_target_overrides
            .get(self.selected_project().key.as_str())
            .cloned()
            .unwrap_or_default()
    }

    fn merge_source_value(&self) -> String {
        self.merge_source_overrides
            .get(self.selected_project().key.as_str())
            .cloned()
            .unwrap_or_default()
    }

    fn merge_target_query(&self) -> String {
        self.merge_target_queries
            .get(self.selected_project().key.as_str())
            .cloned()
            .unwrap_or_default()
    }

    fn merge_source_query(&self) -> String {
        self.merge_source_queries
            .get(self.selected_project().key.as_str())
            .cloned()
            .unwrap_or_default()
    }

    fn current_plan(&self) -> Result<DeployPlan> {
        build_plan(
            &self.config,
            &DeployRequest {
                project: self.selected_project().key.clone(),
                target: None,
                variant: self.uses_variant(),
                env: self
                    .env_overrides
                    .get(self.selected_project().key.as_str())
                    .cloned(),
                branch: self
                    .branch_overrides
                    .get(self.selected_project().key.as_str())
                    .cloned(),
                extra_params: self.current_extra_params(),
                params: Default::default(),
            },
        )
    }

    fn env_options(&self) -> Vec<String> {
        let project = self.selected_project();
        if let Some(job) = selected_job(project, self.uses_variant()) {
            if job.params.iter().any(|key| key == "projectEnv") {
                return vec!["sit", "uat", "pre", "prod"]
                    .into_iter()
                    .map(ToString::to_string)
                    .collect();
            }
            if job.params.iter().any(|key| key == "env") {
                return vec![
                    "sit1", "sit2", "sit3", "uat", "uat1", "uat2", "uat3", "dc1", "dc2", "pre",
                    "prod",
                ]
                .into_iter()
                .map(ToString::to_string)
                .collect();
            }
            if job.params.iter().any(|key| key == "ENV_PROFILE") {
                if self.uses_variant() {
                    return vec!["sit1", "sit2", "sit3", "uat1", "uat2", "uat3", "dc1", "dc2"]
                        .into_iter()
                        .map(ToString::to_string)
                        .collect();
                }
                return vec![
                    "sit1", "sit2", "sit3", "uat1", "uat2", "uat3", "dc1", "dc2", "pre", "pro",
                ]
                .into_iter()
                .map(ToString::to_string)
                .collect();
            }
        }
        Vec::new()
    }

    fn branch_options_for_current(&self) -> Vec<String> {
        self.branch_options
            .get(self.selected_project().key.as_str())
            .cloned()
            .unwrap_or_default()
    }

    fn branch_presets_for_current(&self) -> Vec<String> {
        let project_key = self.selected_project().key.as_str();
        let options = self.branch_options_for_current();
        let mut presets = self
            .branch_recents
            .get(project_key)
            .cloned()
            .unwrap_or_default();
        presets.retain(|item| !item.trim().is_empty() && !is_ephemeral_branch(item));
        presets.truncate(3);

        if presets.is_empty() {
            push_unique(&mut presets, self.branch_value());
            for branch in ["master", "main", "develop", "dev", "release"] {
                if options.iter().any(|option| option == branch) {
                    push_unique(&mut presets, branch.to_string());
                }
                if presets.len() >= 3 {
                    break;
                }
            }
        }

        presets.truncate(3);
        presets
    }

    fn remember_branch_for_project(&mut self, project_key: &str, branch: &str) {
        let normalized = branch.trim();
        if normalized.is_empty() || is_ephemeral_branch(normalized) {
            return;
        }

        let recents = self
            .branch_recents
            .entry(project_key.to_string())
            .or_default();
        if recents.first().map(String::as_str) == Some(normalized) {
            return;
        }

        recents.retain(|item| item != normalized);
        recents.insert(0, normalized.to_string());
        recents.truncate(3);
    }

    fn load_branches(&mut self, ctx: egui::Context) {
        if self.is_busy() {
            return;
        }

        let project = self.selected_project().clone();
        let (tx, rx) = mpsc::channel();
        self.async_rx = Some(rx);
        self.pending_action = Some(PendingAction::BranchSync);
        self.status = PendingAction::BranchSync.label().to_string();

        thread::spawn(move || {
            let result = git::available_branches(project.repo_path.as_deref(), &project.git_url)
                .map_err(|error| error.to_string());
            let _ = tx.send(AsyncEvent::BranchesLoaded {
                project_key: project.key,
                project_name: project.name,
                result,
            });
            ctx.request_repaint();
        });
    }

    fn trigger_merge(&mut self, ctx: egui::Context) {
        if self.is_busy() {
            return;
        }

        let project = self.selected_project().clone();
        let target_branch = self
            .merge_target_overrides
            .get(project.key.as_str())
            .cloned()
            .unwrap_or_default();
        let source_branch = self
            .merge_source_overrides
            .get(project.key.as_str())
            .cloned()
            .unwrap_or_default();

        if target_branch.trim().is_empty() || source_branch.trim().is_empty() {
            self.status = "请选择目标分支和源分支".to_string();
            self.merge_result = Some(MergeResultView {
                success: false,
                summary: "分支合并参数不完整".to_string(),
                detail: "目标分支和源分支不能为空".to_string(),
                project_key: project.key,
                project_name: project.name,
                target_branch,
                source_branch,
                merged_commit: None,
                latest_commit: None,
                pushed: false,
            });
            return;
        }

        if target_branch.trim() == source_branch.trim() {
            self.status = "分支选择不合法".to_string();
            self.merge_result = Some(MergeResultView {
                success: false,
                summary: "分支合并参数不合法".to_string(),
                detail: "目标分支和源分支不能相同".to_string(),
                project_key: project.key,
                project_name: project.name,
                target_branch,
                source_branch,
                merged_commit: None,
                latest_commit: None,
                pushed: false,
            });
            return;
        }

        let repo_path = project.repo_path.clone();
        let defaults = self.config.defaults.clone();
        let target_exists = self
            .branch_options_for_current()
            .iter()
            .any(|branch| branch == target_branch.trim());
        let (tx, rx) = mpsc::channel();
        self.async_rx = Some(rx);
        self.pending_action = Some(if target_exists {
            PendingAction::Merge
        } else {
            PendingAction::MergeCreate
        });
        self.status = self
            .pending_action
            .map(PendingAction::label)
            .unwrap_or_default()
            .to_string();
        self.merge_result = None;

        thread::spawn(move || {
            // Prefer GitLab API merge to guarantee remote-latest base, then
            // fall back to local worktree merge only when API token is missing.
            let mut merged_remote = false;
            let result = match credentials::load_gitlab_token(&defaults) {
                Ok(token) => gitlab::merge_branches_via_api(
                    &project.git_url,
                    defaults.gitlab_api_base_url.as_deref(),
                    &token,
                    &source_branch,
                    &target_branch,
                )
                .and_then(|api_result| {
                    merged_remote = true;
                    let mut detail = api_result.detail;
                    if let Some(repo) = repo_path.as_ref() {
                        match git::sync_local_branch_with_remote(repo.as_path(), &target_branch) {
                            Ok(sync_note) => {
                                detail.push_str("\n");
                                detail.push_str(&sync_note);
                            }
                            Err(sync_error) => {
                                detail.push_str("\n本地分支同步失败：");
                                detail.push_str(&sync_error.to_string());
                            }
                        }
                    }
                    Ok(git::WorktreeMergeResult {
                        target_branch: api_result.target_branch,
                        source_branch: api_result.source_branch,
                        merged_commit: api_result.merge_commit_sha,
                        created_target_branch: api_result.created_target_branch,
                        detail,
                    })
                })
                .map_err(|error| error.to_string()),
                Err(token_error) => {
                    if let Some(repo) = repo_path.as_ref() {
                        git::merge_branches_with_worktree(
                            repo.as_path(),
                            &target_branch,
                            &source_branch,
                        )
                        .map_err(|error| {
                            format!(
                                "GitLab API token 不可用（{}），且本地合并失败：{}",
                                token_error, error
                            )
                        })
                    } else {
                        Err(format!(
                            "GitLab API token 不可用（{}），且当前项目未配置本地 repo_path，无法执行本地合并",
                            token_error
                        ))
                    }
                }
            };
            let _ = tx.send(AsyncEvent::MergeFinished {
                project_key: project.key,
                project_name: project.name,
                target_branch,
                source_branch,
                merged_remote,
                result,
            });
            ctx.request_repaint();
        });
    }

    fn trigger_push_merge_target(&mut self, ctx: egui::Context) {
        if self.is_busy() {
            return;
        }

        let Some(merge) = self.merge_result.clone() else {
            return;
        };

        let project = match self.config.find_project(&merge.project_key) {
            Ok(project) => project.clone(),
            Err(error) => {
                self.status = "项目配置缺失".to_string();
                if let Some(view) = self.merge_result.as_mut() {
                    view.success = false;
                    view.summary = "无法推送目标分支".to_string();
                    view.detail = error.to_string();
                }
                return;
            }
        };

        let Some(repo_path) = project.repo_path.clone() else {
            self.status = "仓库路径未配置".to_string();
            if let Some(view) = self.merge_result.as_mut() {
                view.success = false;
                view.summary = "无法推送目标分支".to_string();
                view.detail = "当前项目未配置本地 repo_path，无法执行 push".to_string();
            }
            return;
        };

        let target_branch = merge.target_branch.clone();
        let project_key = project.key.clone();
        let project_name = project.name.clone();
        let (tx, rx) = mpsc::channel();
        self.async_rx = Some(rx);
        self.pending_action = Some(PendingAction::Push);
        self.status = PendingAction::Push.label().to_string();

        thread::spawn(move || {
            let result = git::push_branch(repo_path.as_path(), &target_branch)
                .map_err(|error| error.to_string());
            let _ = tx.send(AsyncEvent::PushFinished {
                project_key,
                project_name,
                target_branch,
                result,
            });
            ctx.request_repaint();
        });
    }

    fn open_navigation_entry(&mut self, ctx: egui::Context, entry: NavEntry) {
        if self.is_busy() {
            return;
        }

        let (tx, rx) = mpsc::channel();
        self.async_rx = Some(rx);
        self.pending_action = Some(PendingAction::Navigate);
        self.status = format!("正在打开 {}", entry.name);

        thread::spawn(move || {
            let result = open_in_current_chrome(&entry.url).map_err(|error| error.to_string());
            let _ = tx.send(AsyncEvent::NavigationFinished {
                entry_name: entry.name,
                result,
            });
            ctx.request_repaint();
        });
    }

    fn trigger(&mut self, ctx: egui::Context) {
        if self.is_busy() {
            return;
        }

        let plan = match self.current_plan() {
            Ok(plan) => plan,
            Err(error) => {
                self.status = "部署预览异常".to_string();
                self.last_result = Some(DeployResultView {
                    success: false,
                    queue_url: None,
                    build_url: None,
                    trigger_state: None,
                    summary: "无法生成部署计划".to_string(),
                    detail: error.to_string(),
                    http_status: None,
                    project_name: Some(self.selected_project().name.clone()),
                    job_name: None,
                    selected_params: Vec::new(),
                });
                return;
            }
        };

        let defaults = self.config.defaults.clone();
        let (tx, rx) = mpsc::channel();
        self.async_rx = Some(rx);
        self.pending_action = Some(PendingAction::Trigger);
        self.status = PendingAction::Trigger.label().to_string();
        self.last_auto_refresh_at = Some(Instant::now());

        thread::spawn(move || {
            let result = credentials::load_jenkins_password(&defaults)
                .map_err(|error| error.to_string())
                .and_then(|password| {
                    jenkins::trigger_build(
                        &defaults.jenkins_base_url,
                        &defaults.jenkins_username,
                        &password,
                        &plan.trigger_url,
                        &plan.params,
                    )
                    .map_err(|error| error.to_string())
                });
            let _ = tx.send(AsyncEvent::TriggerFinished { plan, result });
            ctx.request_repaint();
        });
    }

    fn refresh_last_result(&mut self, ctx: egui::Context) {
        if self.is_busy() {
            return;
        }

        let Some(view) = self.last_result.as_ref() else {
            return;
        };

        let previous = view.clone();
        let defaults = self.config.defaults.clone();
        let (tx, rx) = mpsc::channel();
        self.async_rx = Some(rx);
        self.pending_action = Some(PendingAction::Refresh);
        self.status = PendingAction::Refresh.label().to_string();
        self.last_auto_refresh_at = Some(Instant::now());

        thread::spawn(move || {
            let result = credentials::load_jenkins_password(&defaults)
                .map_err(|error| error.to_string())
                .and_then(|password| {
                    jenkins::refresh_status(
                        &defaults.jenkins_base_url,
                        &defaults.jenkins_username,
                        &password,
                        previous.queue_url.as_deref(),
                        previous.build_url.as_deref(),
                    )
                    .map_err(|error| error.to_string())
                });
            let _ = tx.send(AsyncEvent::RefreshFinished { previous, result });
            ctx.request_repaint();
        });
    }

    fn poll_async_events(&mut self) {
        let mut messages = Vec::new();
        let mut disconnected = false;

        if let Some(rx) = self.async_rx.as_ref() {
            loop {
                match rx.try_recv() {
                    Ok(message) => messages.push(message),
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => {
                        disconnected = true;
                        break;
                    }
                }
            }
        }

        for message in messages {
            self.handle_async_event(message);
        }

        if disconnected && self.is_busy() {
            self.pending_action = None;
            self.async_rx = None;
            self.status = "后台任务中断".to_string();
            self.last_auto_refresh_at = None;
        }
    }

    fn handle_async_event(&mut self, event: AsyncEvent) {
        self.pending_action = None;
        self.async_rx = None;

        match event {
            AsyncEvent::BranchesLoaded {
                project_key,
                project_name,
                result,
            } => match result {
                Ok(branches) => {
                    let count = branches.len();
                    self.branch_options.insert(project_key, branches);
                    self.status = format!("已同步 {} 个分支", count);
                }
                Err(error) => {
                    self.status = "分支同步失败".to_string();
                    self.last_result = Some(DeployResultView {
                        success: false,
                        queue_url: None,
                        build_url: None,
                        trigger_state: None,
                        summary: "远程分支拉取失败".to_string(),
                        detail: error,
                        http_status: None,
                        project_name: Some(project_name),
                        job_name: None,
                        selected_params: Vec::new(),
                    });
                }
            },
            AsyncEvent::TriggerFinished { plan, result } => match result {
                Ok(result) => {
                    let is_positive = result.state.is_positive();
                    self.status = result.state.label().to_string();
                    self.last_result = Some(DeployResultView {
                        success: is_positive,
                        queue_url: result.queue_url.clone(),
                        build_url: result.build_url.clone(),
                        trigger_state: Some(result.state),
                        summary: result.state.label().to_string(),
                        detail: result.detail,
                        http_status: Some(result.status),
                        project_name: Some(plan.project_name),
                        job_name: Some(plan.job_name),
                        selected_params: plan
                            .params
                            .iter()
                            .filter(|(_, value)| !value.trim().is_empty())
                            .map(|(key, value)| (key.clone(), value.clone()))
                            .collect(),
                    });
                    self.last_auto_refresh_at = Some(Instant::now());
                }
                Err(error) => {
                    self.status = "触发失败".to_string();
                    self.last_result = Some(DeployResultView {
                        success: false,
                        queue_url: None,
                        build_url: None,
                        trigger_state: None,
                        summary: "部署请求失败".to_string(),
                        detail: error,
                        http_status: None,
                        project_name: Some(plan.project_name),
                        job_name: Some(plan.job_name),
                        selected_params: plan
                            .params
                            .iter()
                            .filter(|(_, value)| !value.trim().is_empty())
                            .map(|(key, value)| (key.clone(), value.clone()))
                            .collect(),
                    });
                    self.last_auto_refresh_at = None;
                }
            },
            AsyncEvent::RefreshFinished { previous, result } => match result {
                Ok(result) => {
                    self.status = result.state.label().to_string();
                    self.last_result = Some(DeployResultView {
                        success: result.state.is_positive(),
                        queue_url: result.queue_url.clone(),
                        build_url: result.build_url.clone(),
                        trigger_state: Some(result.state),
                        summary: result.state.label().to_string(),
                        detail: result.detail,
                        http_status: previous.http_status,
                        project_name: previous.project_name.clone(),
                        job_name: previous.job_name.clone(),
                        selected_params: previous.selected_params.clone(),
                    });
                    self.last_auto_refresh_at = Some(Instant::now());
                }
                Err(error) => {
                    self.status = "刷新失败".to_string();
                    self.last_result = Some(DeployResultView {
                        success: false,
                        queue_url: previous.queue_url.clone(),
                        build_url: previous.build_url.clone(),
                        trigger_state: previous.trigger_state,
                        summary: "刷新构建状态失败".to_string(),
                        detail: error,
                        http_status: previous.http_status,
                        project_name: previous.project_name.clone(),
                        job_name: previous.job_name.clone(),
                        selected_params: previous.selected_params.clone(),
                    });
                    self.last_auto_refresh_at = None;
                }
            },
            AsyncEvent::MergeFinished {
                project_key,
                project_name,
                target_branch,
                source_branch,
                merged_remote,
                result,
            } => match result {
                Ok(result) => {
                    let latest_commit =
                        self.config
                            .find_project(&project_key)
                            .ok()
                            .and_then(|project| {
                                project.repo_path.as_ref().and_then(|repo| {
                                    git::latest_branch_commit(repo, &result.target_branch).ok()
                                })
                            });
                    self.status = if merged_remote {
                        "分支远端合并完成".to_string()
                    } else {
                        "分支合并完成".to_string()
                    };
                    self.merge_result = Some(MergeResultView {
                        success: true,
                        summary: if result.created_target_branch {
                            "目标分支不存在，已从源分支创建并推送".to_string()
                        } else if merged_remote {
                            "已通过 GitLab API 合并并推送".to_string()
                        } else {
                            "已完成本地合并".to_string()
                        },
                        detail: result.detail,
                        project_key,
                        project_name,
                        target_branch: result.target_branch,
                        source_branch: result.source_branch,
                        merged_commit: Some(result.merged_commit),
                        latest_commit,
                        pushed: merged_remote,
                    });
                }
                Err(error) => {
                    self.status = "分支合并失败".to_string();
                    self.merge_result = Some(MergeResultView {
                        success: false,
                        summary: "合并执行失败".to_string(),
                        detail: error,
                        project_key,
                        project_name,
                        target_branch,
                        source_branch,
                        merged_commit: None,
                        latest_commit: None,
                        pushed: false,
                    });
                }
            },
            AsyncEvent::PushFinished {
                project_key,
                project_name,
                target_branch,
                result,
            } => match result {
                Ok(output) => {
                    self.status = "目标分支已推送".to_string();
                    let latest_commit =
                        self.config
                            .find_project(&project_key)
                            .ok()
                            .and_then(|project| {
                                project.repo_path.as_ref().and_then(|repo| {
                                    git::latest_branch_commit(repo, &target_branch).ok()
                                })
                            });
                    if let Some(view) = self.merge_result.as_mut() {
                        view.success = true;
                        view.summary = "已推送目标分支".to_string();
                        view.detail = output;
                        view.project_key = project_key;
                        view.project_name = project_name;
                        view.target_branch = target_branch;
                        view.latest_commit = latest_commit;
                        view.pushed = true;
                    }
                }
                Err(error) => {
                    self.status = "推送失败".to_string();
                    if let Some(view) = self.merge_result.as_mut() {
                        view.success = false;
                        view.summary = "推送目标分支失败".to_string();
                        view.detail = error;
                        view.project_key = project_key;
                        view.project_name = project_name;
                        view.target_branch = target_branch;
                    }
                }
            },
            AsyncEvent::NavigationFinished { entry_name, result } => match result {
                Ok(()) => {
                    self.status = format!("已打开 {}", entry_name);
                }
                Err(error) => {
                    self.status = format!("打开 {} 失败: {}", entry_name, error);
                }
            },
        }
    }

    fn process_tray_events(&mut self, ctx: &egui::Context) {
        let Some(tray) = self.tray_runtime.as_ref() else {
            return;
        };

        while let Ok(event) = MenuEvent::receiver().try_recv() {
            if event.id == tray.show_id {
                ctx.send_viewport_cmd(egui::ViewportCommand::Visible(true));
                ctx.send_viewport_cmd(egui::ViewportCommand::Focus);
                self.status = "已显示主窗口".to_string();
            } else if event.id == tray.hide_id {
                ctx.send_viewport_cmd(egui::ViewportCommand::Visible(false));
                self.status = "已隐藏到托盘".to_string();
            } else if event.id == tray.quit_id {
                self.quit_requested = true;
                self.status = "正在退出".to_string();
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            }
        }
    }
}

impl eframe::App for DesktopApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.poll_async_events();
        self.process_tray_events(ctx);

        if self.tray_runtime.is_some()
            && ctx.input(|input| input.viewport().close_requested())
            && !self.quit_requested
        {
            ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
            ctx.send_viewport_cmd(egui::ViewportCommand::Visible(false));
            self.status = "已最小化到托盘".to_string();
        }

        if self.should_auto_refresh() {
            let due = self
                .last_auto_refresh_at
                .map(|stamp| stamp.elapsed() >= AUTO_REFRESH_INTERVAL)
                .unwrap_or(true);
            if due {
                self.refresh_last_result(ctx.clone());
            }
            ctx.request_repaint_after(Duration::from_millis(300));
        }

        if self.is_busy() {
            ctx.request_repaint_after(Duration::from_millis(120));
        }

        let sidebar_width = if self.sidebar_collapsed { 64.0 } else { 132.0 };
        egui::SidePanel::left("primary_nav")
            .resizable(false)
            .exact_width(sidebar_width)
            .show_separator_line(false)
            .frame(egui::Frame::default().fill(PAPER))
            .show(ctx, |ui| {
                ui.add_space(10.0);
                egui::Frame::group(ui.style())
                    .fill(PANEL_SOFT)
                    .stroke(Stroke::new(1.0, BORDER))
                    .corner_radius(22)
                    .inner_margin(egui::Margin::same(10))
                    .show(ui, |ui| {
                        let toggle_height = 30.0;
                        ui.vertical(|ui| {
                            ui.vertical_centered(|ui| {
                                brand_mark(ui, self.sidebar_collapsed);
                            });
                            ui.add_space(14.0);

                            let nav_region_height =
                                (ui.available_height() - toggle_height - 12.0).max(140.0);

                            ui.allocate_ui_with_layout(
                                egui::vec2(ui.available_width(), nav_region_height),
                                egui::Layout::top_down(egui::Align::Center),
                                |ui| {
                                    if self.sidebar_collapsed {
                                        if primary_nav_compact_button(
                                            ui,
                                            NavIconKind::Deploy,
                                            "项目部署",
                                            self.active_menu == PrimaryMenu::ProjectDeploy,
                                        )
                                        .clicked()
                                        {
                                            self.active_menu = PrimaryMenu::ProjectDeploy;
                                        }
                                        ui.add_space(8.0);

                                        if primary_nav_compact_button(
                                            ui,
                                            NavIconKind::Merge,
                                            "分支",
                                            self.active_menu == PrimaryMenu::BranchMerge,
                                        )
                                        .clicked()
                                        {
                                            self.active_menu = PrimaryMenu::BranchMerge;
                                        }
                                        ui.add_space(8.0);

                                        if primary_nav_compact_button(
                                            ui,
                                            NavIconKind::Navigate,
                                            "页面导航",
                                            self.active_menu == PrimaryMenu::PageNavigation,
                                        )
                                        .clicked()
                                        {
                                            self.active_menu = PrimaryMenu::PageNavigation;
                                        }
                                    } else {
                                        if primary_nav_button(
                                            ui,
                                            "项目部署",
                                            NavIconKind::Deploy,
                                            self.active_menu == PrimaryMenu::ProjectDeploy,
                                        )
                                        .clicked()
                                        {
                                            self.active_menu = PrimaryMenu::ProjectDeploy;
                                        }
                                        ui.add_space(8.0);

                                        if primary_nav_button(
                                            ui,
                                            "分支",
                                            NavIconKind::Merge,
                                            self.active_menu == PrimaryMenu::BranchMerge,
                                        )
                                        .clicked()
                                        {
                                            self.active_menu = PrimaryMenu::BranchMerge;
                                        }
                                        ui.add_space(8.0);

                                        if primary_nav_button(
                                            ui,
                                            "页面导航",
                                            NavIconKind::Navigate,
                                            self.active_menu == PrimaryMenu::PageNavigation,
                                        )
                                        .clicked()
                                        {
                                            self.active_menu = PrimaryMenu::PageNavigation;
                                        }
                                    }
                                },
                            );

                            ui.add_space(10.0);
                            ui.vertical_centered(|ui| {
                                if sidebar_toggle_button(ui, self.sidebar_collapsed).clicked() {
                                    self.sidebar_collapsed = !self.sidebar_collapsed;
                                }
                            });
                        });
                    });
            });

        egui::CentralPanel::default()
            .frame(egui::Frame::default().fill(PAPER))
            .show(ctx, |ui| {
                let content_width = ui.available_width();
                match self.active_menu {
                    PrimaryMenu::ProjectDeploy => {
                        let panel_width = centered_panel_width(content_width, 600.0);
                        centered_panel(ui, panel_width, |ui| {
                            panel_card(ui, "部署配置", |ui| {
                                render_deploy_form(self, ui, panel_width, ctx);
                            });

                            ui.add_space(10.0);

                            let refresh_clicked = result_card(
                                ui,
                                &self.last_result,
                                self.is_busy(),
                                self.pending_action,
                            );

                            if refresh_clicked {
                                self.refresh_last_result(ctx.clone());
                            }
                        });
                    }
                    PrimaryMenu::BranchMerge => {
                        render_merge_page(self, ui, content_width, ctx);
                    }
                    PrimaryMenu::PageNavigation => {
                        render_navigation_page(self, ui, content_width, ctx);
                    }
                }

                self.persist_if_needed();
            });
    }
}

fn build_tray_runtime() -> Result<TrayRuntime> {
    let menu = Menu::new();
    let show_item = MenuItem::new("显示主窗口", true, None);
    let hide_item = MenuItem::new("隐藏窗口", true, None);
    let quit_item = MenuItem::new("退出", true, None);
    let separator = PredefinedMenuItem::separator();

    let show_id = show_item.id().clone();
    let hide_id = hide_item.id().clone();
    let quit_id = quit_item.id().clone();

    menu.append(&show_item)
        .map_err(|error| anyhow!("failed to append tray menu item: {error}"))?;
    menu.append(&hide_item)
        .map_err(|error| anyhow!("failed to append tray menu item: {error}"))?;
    menu.append(&separator)
        .map_err(|error| anyhow!("failed to append tray menu separator: {error}"))?;
    menu.append(&quit_item)
        .map_err(|error| anyhow!("failed to append tray menu item: {error}"))?;

    let icon = create_tray_icon()?;
    let tray_icon = TrayIconBuilder::new()
        .with_tooltip("项目部署")
        .with_menu(Box::new(menu))
        .with_icon(icon)
        .build()
        .map_err(|error| anyhow!("failed to build tray icon: {error}"))?;

    Ok(TrayRuntime {
        _tray_icon: tray_icon,
        show_id,
        hide_id,
        quit_id,
    })
}

fn create_window_icon() -> Arc<egui::IconData> {
    let width = 64;
    let height = 64;
    Arc::new(egui::IconData {
        rgba: create_brand_icon_rgba(width, height),
        width,
        height,
    })
}

fn create_tray_icon() -> Result<Icon> {
    let width: u32 = 32;
    let height: u32 = 32;
    let rgba = create_brand_icon_rgba(width, height);

    Icon::from_rgba(rgba, width, height)
        .map_err(|error| anyhow!("failed to create tray icon from rgba: {error}"))
}

fn create_brand_icon_rgba(width: u32, height: u32) -> Vec<u8> {
    let mut rgba = vec![0u8; (width * height * 4) as usize];
    let samples = 4;

    for y in 0..height {
        for x in 0..width {
            let mut alpha_acc = 0.0;
            let mut color_acc = [0.0f32; 3];

            for sy in 0..samples {
                for sx in 0..samples {
                    let fx = (x as f32 + (sx as f32 + 0.5) / samples as f32) / width as f32;
                    let fy = (y as f32 + (sy as f32 + 0.5) / samples as f32) / height as f32;
                    let sample = sample_brand_icon(fx, fy);
                    alpha_acc += sample[3];
                    color_acc[0] += sample[0] * sample[3];
                    color_acc[1] += sample[1] * sample[3];
                    color_acc[2] += sample[2] * sample[3];
                }
            }

            let count = (samples * samples) as f32;
            let alpha = (alpha_acc / count).clamp(0.0, 1.0);
            let idx = ((y * width + x) * 4) as usize;
            if alpha <= 0.0 {
                continue;
            }

            rgba[idx] = (color_acc[0] / alpha_acc.max(1e-6)).round() as u8;
            rgba[idx + 1] = (color_acc[1] / alpha_acc.max(1e-6)).round() as u8;
            rgba[idx + 2] = (color_acc[2] / alpha_acc.max(1e-6)).round() as u8;
            rgba[idx + 3] = (alpha * 255.0).round() as u8;
        }
    }

    rgba
}

fn sample_brand_icon(x: f32, y: f32) -> [f32; 4] {
    if !inside_rounded_rect(x, y, 0.08, 0.08, 0.92, 0.92, 0.20) {
        return [0.0, 0.0, 0.0, 0.0];
    }

    let mut base = lerp_rgb(
        [108.0, 71.0, 57.0],
        [201.0, 120.0, 84.0],
        y * 0.82 + x * 0.18,
    );
    let glow = ((0.24 - x).powi(2) + (0.20 - y).powi(2)).sqrt();
    let glow_strength = ((0.22 - glow) / 0.22).clamp(0.0, 1.0) * 0.18;
    base = mix_rgb(base, [246.0, 214.0, 190.0], glow_strength);

    if inside_segment_capsule(x, y, 0.33, 0.24, 0.74, 0.14, 0.045) {
        base = mix_rgb(base, [255.0, 236.0, 220.0], 0.10);
    }

    let mut color = base;
    if inside_r_shadow(x, y) {
        color = mix_rgb(color, [76.0, 48.0, 38.0], 0.14);
    }
    if inside_r_letter(x, y) {
        color = [252.0, 246.0, 239.0];
    }

    [color[0], color[1], color[2], 1.0]
}

fn inside_r_letter(x: f32, y: f32) -> bool {
    let stem = inside_rounded_rect(x, y, 0.24, 0.20, 0.40, 0.82, 0.06);
    let bowl_outer = inside_rounded_rect(x, y, 0.30, 0.18, 0.76, 0.58, 0.17);
    let bowl_inner = inside_rounded_rect(x, y, 0.42, 0.30, 0.62, 0.46, 0.08);
    let bowl = bowl_outer && !bowl_inner;
    let leg = inside_segment_capsule(x, y, 0.46, 0.50, 0.74, 0.82, 0.075);
    stem || bowl || leg
}

fn inside_r_shadow(x: f32, y: f32) -> bool {
    inside_r_letter(x - 0.018, y - 0.018)
}

fn inside_rounded_rect(x: f32, y: f32, x0: f32, y0: f32, x1: f32, y1: f32, radius: f32) -> bool {
    let cx = (x0 + x1) * 0.5;
    let cy = (y0 + y1) * 0.5;
    let hw = (x1 - x0) * 0.5;
    let hh = (y1 - y0) * 0.5;
    let qx = (x - cx).abs() - (hw - radius);
    let qy = (y - cy).abs() - (hh - radius);
    let ox = qx.max(0.0);
    let oy = qy.max(0.0);
    let outside = (ox * ox + oy * oy).sqrt();
    let inside = qx.max(qy).min(0.0);
    outside + inside <= radius
}

fn inside_segment_capsule(x: f32, y: f32, ax: f32, ay: f32, bx: f32, by: f32, radius: f32) -> bool {
    let pax = x - ax;
    let pay = y - ay;
    let bax = bx - ax;
    let bay = by - ay;
    let h = ((pax * bax + pay * bay) / (bax * bax + bay * bay)).clamp(0.0, 1.0);
    let dx = pax - bax * h;
    let dy = pay - bay * h;
    (dx * dx + dy * dy).sqrt() <= radius
}

fn lerp_rgb(a: [f32; 3], b: [f32; 3], t: f32) -> [f32; 3] {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ]
}

fn mix_rgb(base: [f32; 3], top: [f32; 3], amount: f32) -> [f32; 3] {
    lerp_rgb(base, top, amount.clamp(0.0, 1.0))
}

fn load_navigation_categories() -> Result<Vec<NavCategory>> {
    let path =
        std::env::var("RDEVTOOL_NAVIGATION_MD").unwrap_or_else(|_| "navigation.md".to_string());
    let content = fs::read_to_string(path)
        .map_err(|error| anyhow!("failed to read navigation file: {error}"))?;

    let mut categories = Vec::new();
    let mut current_title: Option<String> = None;
    let mut current_entries: Vec<NavEntry> = Vec::new();

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if let Some(title) = line.strip_prefix("## ") {
            if let Some(title) = current_title.take() {
                if !current_entries.is_empty() {
                    categories.push(NavCategory {
                        title,
                        entries: std::mem::take(&mut current_entries),
                    });
                }
            }
            current_title = Some(title.trim().to_string());
            continue;
        }

        if !line.starts_with('|') {
            continue;
        }

        let cells = line
            .trim_matches('|')
            .split('|')
            .map(|cell| cell.trim().trim_matches('`').to_string())
            .collect::<Vec<_>>();

        if cells.is_empty() || is_markdown_separator_row(&cells) || is_markdown_header_row(&cells) {
            continue;
        }

        if let Some(entry) = parse_nav_entry(&cells) {
            current_entries.push(entry);
        }
    }

    if let Some(title) = current_title.take() {
        if !current_entries.is_empty() {
            categories.push(NavCategory {
                title,
                entries: current_entries,
            });
        }
    }

    Ok(categories)
}

fn parse_nav_entry(cells: &[String]) -> Option<NavEntry> {
    let url_idx = cells.iter().position(|cell| is_http_url(cell))?;
    let url = cells.get(url_idx)?.trim().to_string();

    let name = cells[..url_idx]
        .iter()
        .filter(|cell| !cell.is_empty() && cell.as_str() != "-")
        .cloned()
        .collect::<Vec<_>>()
        .join(" / ");
    let note = cells[url_idx + 1..]
        .iter()
        .filter(|cell| !cell.is_empty() && cell.as_str() != "-")
        .cloned()
        .collect::<Vec<_>>()
        .join(" / ");

    Some(NavEntry {
        name: if name.is_empty() {
            "打开入口".to_string()
        } else {
            name
        },
        url,
        note: if note.is_empty() { None } else { Some(note) },
    })
}

fn selected_navigation_entries(
    categories: &[NavCategory],
    selected_category: &str,
    limit: usize,
) -> Vec<NavEntry> {
    categories
        .iter()
        .find(|category| category.title == selected_category)
        .map(|category| category.entries.iter().take(limit).cloned().collect())
        .unwrap_or_default()
}

fn preferred_navigation_category(categories: &[NavCategory]) -> Option<String> {
    categories.first().map(|category| category.title.clone())
}

fn split_navigation_categories(categories: &[NavCategory]) -> (Vec<String>, Vec<String>) {
    let mut titles = categories
        .iter()
        .map(|category| category.title.clone())
        .collect::<Vec<_>>();
    titles.sort();
    (titles, Vec::new())
}

fn navigation_category_label(category: &str) -> String {
    let trimmed = category.trim();
    if trimmed.is_empty() {
        return "分类".to_string();
    }

    let acronym: String = trimmed
        .chars()
        .filter(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit())
        .take(6)
        .collect();
    if !acronym.is_empty() {
        return acronym;
    }

    let ascii_words = trimmed
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|part| !part.is_empty())
        .take(2)
        .collect::<Vec<_>>();
    if !ascii_words.is_empty() {
        let label = ascii_words.join(" ");
        if label.chars().count() <= 8 {
            return label;
        }
        return label.chars().take(8).collect();
    }

    trimmed.chars().take(4).collect()
}

fn filtered_navigation_results(categories: &[NavCategory], query: &str) -> Vec<NavigationMatch> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Vec::new();
    }

    let mut matches = Vec::new();
    for category in categories {
        for entry in &category.entries {
            let note = entry.note.as_deref().unwrap_or("");
            let searchable =
                format!("{} {} {} {}", category.title, entry.name, entry.url, note).to_lowercase();
            if searchable.contains(&query) {
                matches.push(NavigationMatch {
                    category: category.title.clone(),
                    entry: entry.clone(),
                });
            }
        }
    }
    matches.truncate(36);
    matches
}

fn navigation_focus_card(
    app: &mut DesktopApp,
    ui: &mut egui::Ui,
    ctx: &egui::Context,
    selected_category: &str,
    entries: &[NavEntry],
) {
    egui::Frame::group(ui.style())
        .fill(Color32::from_rgb(250, 247, 241))
        .stroke(Stroke::new(1.0, BORDER))
        .corner_radius(12)
        .inner_margin(egui::Margin::same(10))
        .show(ui, |ui| {
            ui.horizontal_wrapped(|ui| {
                ui.label(RichText::new(selected_category).strong().size(15.0));
                pill(
                    ui,
                    &format!("{} 个入口", entries.len()),
                    Color32::from_rgb(239, 244, 252),
                    Color32::from_rgb(83, 107, 147),
                );
            });
            ui.add_space(6.0);

            if entries.is_empty() {
                ui.label(RichText::new("当前分类暂无入口").small().color(MUTED));
                return;
            }

            navigation_result_grid(
                app,
                ui,
                ctx,
                &entries
                    .iter()
                    .cloned()
                    .map(|entry| NavigationMatch {
                        category: selected_category.to_string(),
                        entry,
                    })
                    .collect::<Vec<_>>(),
            );
        });
}

fn navigation_search_results_card(
    app: &mut DesktopApp,
    ui: &mut egui::Ui,
    ctx: &egui::Context,
    results: &[NavigationMatch],
) {
    egui::Frame::group(ui.style())
        .fill(Color32::from_rgb(250, 247, 241))
        .stroke(Stroke::new(1.0, BORDER))
        .corner_radius(12)
        .inner_margin(egui::Margin::same(10))
        .show(ui, |ui| {
            ui.horizontal_wrapped(|ui| {
                ui.label(RichText::new("搜索结果").strong().size(15.0));
                pill(
                    ui,
                    &format!("{} 条匹配", results.len()),
                    Color32::from_rgb(239, 244, 252),
                    Color32::from_rgb(83, 107, 147),
                );
            });
            ui.add_space(6.0);

            if results.is_empty() {
                ui.label(RichText::new("没有找到匹配入口").small().color(MUTED));
                return;
            }

            egui::ScrollArea::vertical()
                .max_height(420.0)
                .show(ui, |ui| {
                    navigation_result_grid(app, ui, ctx, results);
                });
        });
}

fn navigation_result_grid(
    app: &mut DesktopApp,
    ui: &mut egui::Ui,
    ctx: &egui::Context,
    results: &[NavigationMatch],
) {
    let available_width = ui.available_width().max(180.0);
    let preferred = 176.0;
    let gap = 8.0;
    let columns = ((available_width + gap) / (preferred + gap))
        .floor()
        .max(1.0) as usize;
    let card_width = ((available_width - gap * (columns.saturating_sub(1)) as f32)
        / columns as f32)
        .clamp(156.0, 220.0);

    ui.horizontal_wrapped(|ui| {
        ui.spacing_mut().item_spacing = egui::vec2(8.0, 8.0);
        for result in results {
            let response = navigation_entry_card(ui, &result.category, &result.entry, card_width);
            if response.clicked() {
                app.open_navigation_entry(ctx.clone(), result.entry.clone());
            }
            if response.hovered() {
                response.on_hover_text(&result.entry.url);
            }
        }
    });
}

fn navigation_entry_card(
    ui: &mut egui::Ui,
    category: &str,
    entry: &NavEntry,
    card_width: f32,
) -> egui::Response {
    let mut job = egui::text::LayoutJob::default();
    job.append(
        &compact_link_text(&entry.name, 22),
        0.0,
        TextFormat {
            font_id: FontId::proportional(13.5),
            color: INK,
            ..Default::default()
        },
    );
    job.append(
        "\n",
        0.0,
        TextFormat {
            font_id: FontId::proportional(4.0),
            color: INK,
            ..Default::default()
        },
    );
    job.append(
        &compact_link_text(category, 20),
        0.0,
        TextFormat {
            font_id: FontId::proportional(11.0),
            color: Color32::from_rgb(83, 107, 147),
            ..Default::default()
        },
    );

    if let Some(note) = entry.note.as_deref() {
        if !note.is_empty() {
            job.append(
                "\n",
                0.0,
                TextFormat {
                    font_id: FontId::proportional(3.0),
                    color: INK,
                    ..Default::default()
                },
            );
            job.append(
                &compact_link_text(note, 18),
                0.0,
                TextFormat {
                    font_id: FontId::proportional(10.5),
                    color: MUTED,
                    ..Default::default()
                },
            );
        }
    }

    ui.add_sized(
        [card_width, 74.0],
        egui::Button::new(job)
            .fill(Color32::from_rgb(252, 249, 244))
            .stroke(Stroke::new(1.0, Color32::from_rgb(232, 223, 212)))
            .corner_radius(12),
    )
}

fn is_http_url(value: &str) -> bool {
    let value = value.trim().trim_matches('`');
    value.starts_with("http://") || value.starts_with("https://")
}

fn is_markdown_separator_row(cells: &[String]) -> bool {
    cells.iter().all(|cell| {
        let trimmed = cell.trim();
        !trimmed.is_empty() && trimmed.chars().all(|ch| matches!(ch, '-' | ':' | ' '))
    })
}

fn is_markdown_header_row(cells: &[String]) -> bool {
    cells.iter().any(|cell| {
        matches!(
            cell.as_str(),
            "平台名称" | "平台" | "环境" | "系统" | "项目" | "地址" | "备注"
        )
    })
}

fn open_in_current_chrome(url: &str) -> Result<()> {
    let script = [
        "on run argv",
        "set targetUrl to item 1 of argv",
        "tell application \"Google Chrome\"",
        "activate",
        "if (count of windows) = 0 then",
        "make new window",
        "end if",
        "set URL of active tab of front window to targetUrl",
        "end tell",
        "end run",
    ];

    let mut command = std::process::Command::new("osascript");
    for line in script {
        command.arg("-e").arg(line);
    }
    command.arg("--").arg(url);

    let output = command
        .output()
        .map_err(|error| anyhow!("failed to call osascript: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("failed to open Chrome tab: {}", stderr.trim());
    }

    Ok(())
}

fn render_deploy_form(
    app: &mut DesktopApp,
    ui: &mut egui::Ui,
    panel_width: f32,
    ctx: &egui::Context,
) {
    let busy = app.is_busy();
    let previous = app.selected;
    let field_width = (panel_width - 36.0).clamp(260.0, 620.0);
    let control_width = field_width.min(560.0);

    compact_field(ui, "项目", |ui| {
        ComboBox::from_id_salt("project_select")
            .selected_text(format!(
                "{} ({})",
                app.selected_project().name,
                app.selected_project().key
            ))
            .width(control_width)
            .show_ui(ui, |ui| {
                for (index, project) in app.config.projects.iter().enumerate() {
                    ui.selectable_value(
                        &mut app.selected,
                        index,
                        format!("{} ({})", project.name, project.key),
                    );
                }
            });
    });

    if previous != app.selected {
        app.status = "已切换项目".to_string();
    }

    let project = app.selected_project().clone();
    let project_key = app.project_key();
    let mut use_variant = app.uses_variant();
    let has_variant = project.jobs.variant.is_some();

    app.variant_overrides
        .insert(project_key.clone(), use_variant);

    if job_has_param(&project, use_variant, &["ENV_PROFILE", "projectEnv", "env"]) {
        let env_options = app.env_options();
        let mut env_value = app.env_value();
        compact_field(ui, "环境", |ui| {
            ComboBox::from_id_salt("env_select")
                .selected_text(if env_value.is_empty() {
                    "请选择环境".to_string()
                } else {
                    env_value.clone()
                })
                .width(control_width)
                .show_ui(ui, |ui| {
                    for option in &env_options {
                        ui.selectable_value(&mut env_value, option.clone(), option.clone());
                    }
                });
        });
        if env_value.is_empty() {
            app.env_overrides.remove(&project_key);
        } else {
            app.env_overrides.insert(project_key.clone(), env_value);
        }
    }

    compact_field(ui, "模式", |ui| {
        ui.horizontal_wrapped(|ui| {
            if mode_button(ui, "标准", !use_variant, true).clicked() {
                use_variant = false;
            }
            if mode_button(ui, "Variant", use_variant, has_variant).clicked() && has_variant {
                use_variant = true;
            }
        });
    });
    app.variant_overrides
        .insert(project_key.clone(), use_variant);

    if let Some(job) = selected_job(&project, use_variant) {
        let has_deploy_option_params = job.params.iter().any(|param: &String| {
            matches!(
                param.as_str(),
                "IS_BUILD_ADMIN" | "IS_BUILD_MOBILE" | "IS_GRAY"
            )
        });
        if has_deploy_option_params {
            let has_admin_param = job.params.iter().any(|param| param == "IS_BUILD_ADMIN");
            let has_mobile_param = job.params.iter().any(|param| param == "IS_BUILD_MOBILE");
            let show_gray = job.params.iter().any(|param| param == "IS_GRAY");
            let admin_preferred_default = preferred_deploy_param_default(job, "IS_BUILD_ADMIN");
            let mobile_preferred_default = preferred_deploy_param_default(job, "IS_BUILD_MOBILE");
            let gray_preferred_default = preferred_deploy_param_default(job, "IS_GRAY");
            let mut build_admin = app.deploy_param_value(
                &project_key,
                use_variant,
                "IS_BUILD_ADMIN",
                &admin_preferred_default,
            ) == "是";
            let mut build_mobile = app.deploy_param_value(
                &project_key,
                use_variant,
                "IS_BUILD_MOBILE",
                &mobile_preferred_default,
            ) == "是";
            let mut is_gray = app.deploy_param_value(
                &project_key,
                use_variant,
                "IS_GRAY",
                &gray_preferred_default,
            ) == "是";

            let inline_two_blocks =
                (has_admin_param || has_mobile_param) && show_gray && control_width >= 420.0;

            if inline_two_blocks {
                ui.horizontal_top(|ui| {
                    let block_width = ((control_width - 12.0) / 2.0).max(170.0);
                    ui.allocate_ui_with_layout(
                        egui::vec2(block_width, 0.0),
                        egui::Layout::top_down(egui::Align::Min),
                        |ui| {
                            compact_field(ui, "构建内容", |ui| {
                                ui.horizontal_wrapped(|ui| {
                                    if has_admin_param
                                        && mode_button(ui, "管理端", build_admin, true).clicked()
                                    {
                                        build_admin = !build_admin;
                                    }
                                    if has_mobile_param
                                        && mode_button(ui, "移动端", build_mobile, true).clicked()
                                    {
                                        build_mobile = !build_mobile;
                                    }
                                });
                            });
                        },
                    );
                    ui.add_space(12.0);
                    ui.allocate_ui_with_layout(
                        egui::vec2(block_width, 0.0),
                        egui::Layout::top_down(egui::Align::Min),
                        |ui| {
                            compact_field(ui, "灰度发布", |ui| {
                                ui.horizontal(|ui| {
                                    if mode_button(ui, "关闭", !is_gray, true).clicked() {
                                        is_gray = false;
                                    }
                                    if mode_button(ui, "开启", is_gray, true).clicked() {
                                        is_gray = true;
                                    }
                                });
                            });
                        },
                    );
                });
            } else {
                if has_admin_param || has_mobile_param {
                    compact_field(ui, "构建内容", |ui| {
                        ui.horizontal_wrapped(|ui| {
                            if has_admin_param
                                && mode_button(ui, "管理端", build_admin, true).clicked()
                            {
                                build_admin = !build_admin;
                            }
                            if has_mobile_param
                                && mode_button(ui, "移动端", build_mobile, true).clicked()
                            {
                                build_mobile = !build_mobile;
                            }
                        });
                    });
                }

                if show_gray {
                    compact_field(ui, "灰度发布", |ui| {
                        ui.horizontal(|ui| {
                            if mode_button(ui, "关闭", !is_gray, true).clicked() {
                                is_gray = false;
                            }
                            if mode_button(ui, "开启", is_gray, true).clicked() {
                                is_gray = true;
                            }
                        });
                    });
                }
            }

            if has_admin_param {
                app.set_deploy_param_override(
                    &project_key,
                    use_variant,
                    "IS_BUILD_ADMIN",
                    if build_admin { "是" } else { "否" },
                    &admin_preferred_default,
                );
            }
            if has_mobile_param {
                app.set_deploy_param_override(
                    &project_key,
                    use_variant,
                    "IS_BUILD_MOBILE",
                    if build_mobile { "是" } else { "否" },
                    &mobile_preferred_default,
                );
            }
            if show_gray {
                app.set_deploy_param_override(
                    &project_key,
                    use_variant,
                    "IS_GRAY",
                    if is_gray { "是" } else { "否" },
                    &gray_preferred_default,
                );
            }
        }
    }

    if job_has_param(&project, use_variant, &["BRANCH", "branch", "Branch"]) {
        let mut branch_value = app.branch_value();
        let initial_branch_value = branch_value.clone();
        let mut branch_query = app.branch_query();
        let presets = app.branch_presets_for_current();
        let branch_options = filter_branch_options(
            app.branch_options_for_current(),
            &branch_query,
            BRANCH_RESULT_LIMIT,
        );

        compact_field(ui, "分支", |ui| {
            let sync_clicked = searchable_branch_picker(
                ui,
                "branch_select",
                &mut branch_value,
                &mut branch_query,
                &presets,
                &branch_options,
                control_width,
                !busy,
            );
            if sync_clicked {
                app.load_branches(ctx.clone());
            }
        });

        if branch_value.is_empty() {
            app.branch_overrides.remove(&project_key);
        } else {
            app.branch_overrides
                .insert(project_key.clone(), branch_value.clone());
        }
        if branch_value != initial_branch_value {
            app.remember_branch_for_project(&project_key, &branch_value);
        }
        app.branch_queries.insert(project_key.clone(), branch_query);

        if project.repo_path.is_some() {
            ui.label(
                RichText::new("默认优先使用本地当前分支。")
                    .small()
                    .color(MUTED),
            );
        } else {
            ui.label(
                RichText::new("当前未配置本地仓库，建议先同步分支。")
                    .small()
                    .color(MUTED),
            );
        }
    }

    ui.add_space(4.0);
    ui.separator();
    ui.add_space(4.0);

    match app.current_plan() {
        Ok(plan) => {
            let mode_text = if plan.job_kind == "variant" {
                "Variant"
            } else {
                "标准"
            };
            let env = find_param_value(&plan, &["ENV_PROFILE", "projectEnv", "env"]);
            let branch = find_param_value(&plan, &["BRANCH", "branch", "Branch"]);
            let mut details = vec![format!("环境 {env}")];
            let admin = find_param_value(&plan, &["IS_BUILD_ADMIN"]);
            let mobile = find_param_value(&plan, &["IS_BUILD_MOBILE"]);
            let gray = find_param_value(&plan, &["IS_GRAY"]);
            if admin == "是" {
                details.push("管理端".to_string());
            }
            if mobile == "是" {
                details.push("移动端".to_string());
            }
            if gray == "是" {
                details.push("灰度".to_string());
            }
            if !branch.is_empty() {
                details.push(format!("分支 {branch}"));
            }
            let summary = format!(
                "{} / {} / {}",
                plan.project_name,
                mode_text,
                details.join(" / ")
            );
            ui.label(RichText::new(summary).small().color(MUTED));
        }
        Err(error) => {
            ui.colored_label(ERROR, format!("部署预览异常: {error}"));
        }
    }

    ui.add_space(8.0);
    egui::Frame::group(ui.style())
        .fill(Color32::from_rgb(249, 244, 237))
        .stroke(Stroke::new(1.0, BORDER))
        .corner_radius(14)
        .inner_margin(egui::Margin::symmetric(10, 8))
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                let action_text = if busy { "处理中" } else { "开始部署" };
                if ui
                    .add_enabled(
                        !busy,
                        egui::Button::new(RichText::new(action_text).color(PANEL).strong())
                            .fill(ACCENT)
                            .stroke(Stroke::new(1.0, ACCENT))
                            .corner_radius(12)
                            .min_size(egui::vec2(126.0, PRIMARY_ACTION_HEIGHT)),
                    )
                    .clicked()
                {
                    app.trigger(ctx.clone());
                }

                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if busy {
                        busy_indicator_chip(
                            ui,
                            app.pending_action
                                .map(PendingAction::label)
                                .unwrap_or("处理中"),
                        );
                    }
                });
            });
        });
}

fn render_merge_page(
    app: &mut DesktopApp,
    ui: &mut egui::Ui,
    content_width: f32,
    ctx: &egui::Context,
) {
    let panel_width = centered_panel_width(content_width, 600.0);
    centered_panel(ui, panel_width, |ui| {
        panel_card(ui, "分支", |ui| {
            render_merge_form(app, ui, panel_width, ctx);
        });
        ui.add_space(10.0);
        merge_result_card(ui, app, ctx);
    });
}

fn render_navigation_page(
    app: &mut DesktopApp,
    ui: &mut egui::Ui,
    content_width: f32,
    ctx: &egui::Context,
) {
    if app.navigation_category_filter.is_empty() {
        if let Some(category) = preferred_navigation_category(&app.navigation_categories) {
            app.navigation_category_filter = category;
        }
    }

    let query_active = !app.navigation_query.trim().is_empty();
    let panel_width = centered_panel_width(content_width, 600.0);
    let search_width = (panel_width - 110.0).clamp(220.0, 460.0);
    let (common_categories, other_categories) =
        split_navigation_categories(&app.navigation_categories);
    let selected_category = app.navigation_category_filter.clone();
    let selected_entries = selected_navigation_entries(
        &app.navigation_categories,
        &selected_category,
        NAVIGATION_PREVIEW_LIMIT + 3,
    );
    let search_results = if query_active {
        filtered_navigation_results(&app.navigation_categories, &app.navigation_query)
    } else {
        Vec::new()
    };

    centered_panel(ui, panel_width, |ui| {
        panel_card(ui, "页面导航", |ui| {
            ui.horizontal(|ui| {
                ui.add_sized(
                    [search_width, INPUT_HEIGHT],
                    egui::TextEdit::singleline(&mut app.navigation_query)
                        .hint_text("搜索平台、系统、环境、地址"),
                );

                if ui
                    .add_enabled(
                        query_active,
                        egui::Button::new(RichText::new("清空").small().color(INK))
                            .fill(PANEL)
                            .stroke(Stroke::new(1.0, BORDER))
                            .corner_radius(10)
                            .min_size(egui::vec2(56.0, INPUT_HEIGHT)),
                    )
                    .clicked()
                {
                    app.navigation_query.clear();
                }

                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if app.is_busy() && app.pending_action == Some(PendingAction::Navigate) {
                        busy_indicator_chip(ui, PendingAction::Navigate.label());
                    }
                });
            });
            ui.add_space(8.0);

            egui::Frame::group(ui.style())
                .fill(Color32::from_rgb(249, 244, 237))
                .stroke(Stroke::new(1.0, BORDER))
                .corner_radius(12)
                .inner_margin(egui::Margin::symmetric(6, 6))
                .show(ui, |ui| {
                    let first_row = common_categories
                        .iter()
                        .take(4)
                        .cloned()
                        .collect::<Vec<_>>();
                    let second_row = common_categories
                        .iter()
                        .skip(4)
                        .cloned()
                        .collect::<Vec<_>>();

                    ui.vertical_centered(|ui| {
                        // Keep category controls in a compact fixed-width grid area,
                        // so the right side of this block does not look empty.
                        let grid_width = 344.0;
                        ui.allocate_ui_with_layout(
                            egui::vec2(grid_width, 0.0),
                            egui::Layout::top_down(egui::Align::Center),
                            |ui| {
                                ui.horizontal(|ui| {
                                    ui.spacing_mut().item_spacing = egui::vec2(6.0, 6.0);
                                    for category in &first_row {
                                        if navigation_category_chip(
                                            ui,
                                            category,
                                            app.navigation_category_filter == *category,
                                        )
                                        .on_hover_text(category.as_str())
                                        .clicked()
                                        {
                                            app.navigation_category_filter = category.clone();
                                        }
                                    }
                                });

                                if !second_row.is_empty() || !other_categories.is_empty() {
                                    ui.add_space(6.0);
                                    ui.horizontal(|ui| {
                                        ui.spacing_mut().item_spacing = egui::vec2(6.0, 6.0);
                                        for category in &second_row {
                                            if navigation_category_chip(
                                                ui,
                                                category,
                                                app.navigation_category_filter == *category,
                                            )
                                            .on_hover_text(category.as_str())
                                            .clicked()
                                            {
                                                app.navigation_category_filter = category.clone();
                                            }
                                        }

                                        if !other_categories.is_empty() {
                                            let more_label = other_categories
                                                .iter()
                                                .find(|category| {
                                                    app.navigation_category_filter == **category
                                                })
                                                .map(|category| navigation_category_label(category))
                                                .unwrap_or("更多".to_string());
                                            ComboBox::from_id_salt("navigation_more_category")
                                                .selected_text(more_label)
                                                .width(82.0)
                                                .show_ui(ui, |ui| {
                                                    for category in other_categories {
                                                        if ui
                                                            .selectable_label(
                                                                app.navigation_category_filter
                                                                    == category,
                                                                &category,
                                                            )
                                                            .clicked()
                                                        {
                                                            app.navigation_category_filter =
                                                                category.clone();
                                                            ui.close_menu();
                                                        }
                                                    }
                                                });
                                        }
                                    });
                                }
                            },
                        );
                    });
                });
            ui.add_space(8.0);

            if query_active {
                navigation_search_results_card(app, ui, ctx, &search_results);
            } else {
                navigation_focus_card(app, ui, ctx, &selected_category, &selected_entries);
            }
        });
    });
}

fn render_merge_form(
    app: &mut DesktopApp,
    ui: &mut egui::Ui,
    panel_width: f32,
    ctx: &egui::Context,
) {
    let busy = app.is_busy();
    let previous = app.selected;
    let field_width = (panel_width - 40.0).clamp(260.0, 720.0);
    let control_width = field_width.min(560.0);

    compact_field(ui, "项目", |ui| {
        ComboBox::from_id_salt("merge_project_select")
            .selected_text(format!(
                "{} ({})",
                app.selected_project().name,
                app.selected_project().key
            ))
            .width(control_width)
            .show_ui(ui, |ui| {
                for (index, project) in app.config.projects.iter().enumerate() {
                    ui.selectable_value(
                        &mut app.selected,
                        index,
                        format!("{} ({})", project.name, project.key),
                    );
                }
            });
    });

    if previous != app.selected {
        app.status = "已切换项目".to_string();
    }

    let project_key = app.project_key();
    let presets = app.branch_presets_for_current();
    let options = app.branch_options_for_current();

    let mut source = app.merge_source_value();
    let mut source_query = app.merge_source_query();
    let source_options = filter_branch_options(options, &source_query, BRANCH_RESULT_LIMIT);

    compact_field(ui, "源分支", |ui| {
        let sync_clicked = searchable_branch_picker(
            ui,
            "merge_source_select",
            &mut source,
            &mut source_query,
            &presets,
            &source_options,
            control_width,
            !busy,
        );
        if sync_clicked {
            app.load_branches(ctx.clone());
        }
    });
    if source.is_empty() {
        app.merge_source_overrides.remove(&project_key);
    } else {
        app.merge_source_overrides
            .insert(project_key.clone(), source.clone());
        app.remember_branch_for_project(&project_key, &source);
    }
    app.merge_source_queries
        .insert(project_key.clone(), source_query);

    let mut target = app.merge_target_value();
    let mut target_query = app.merge_target_query();
    let target_options = prioritize_merge_target_options(
        filter_branch_options(
            app.branch_options_for_current(),
            &target_query,
            BRANCH_RESULT_LIMIT,
        ),
        BRANCH_RESULT_LIMIT,
    );
    let target_presets = merge_target_presets(&target_options);

    compact_field(ui, "目标分支", |ui| {
        let sync_clicked = searchable_branch_picker(
            ui,
            "merge_target_select",
            &mut target,
            &mut target_query,
            &target_presets,
            &target_options,
            control_width,
            !busy,
        );
        if sync_clicked {
            app.load_branches(ctx.clone());
        }
    });
    if target.is_empty() {
        app.merge_target_overrides.remove(&project_key);
    } else {
        app.merge_target_overrides
            .insert(project_key.clone(), target.clone());
        app.remember_branch_for_project(&project_key, &target);
    }
    app.merge_target_queries
        .insert(project_key.clone(), target_query);

    ui.add_space(4.0);
    ui.separator();
    ui.add_space(6.0);

    let merge_summary = if target.is_empty() || source.is_empty() {
        format!("{} / 请选择目标分支和源分支", app.selected_project().name)
    } else {
        format!("{} / {} <- {}", app.selected_project().name, target, source)
    };
    ui.label(RichText::new(merge_summary).small().color(MUTED));

    ui.add_space(8.0);
    egui::Frame::group(ui.style())
        .fill(Color32::from_rgb(249, 244, 237))
        .stroke(Stroke::new(1.0, BORDER))
        .corner_radius(14)
        .inner_margin(egui::Margin::symmetric(10, 8))
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                if ui
                    .add_enabled(
                        !busy,
                        egui::Button::new(RichText::new("执行合并").color(PANEL).strong())
                            .fill(ACCENT)
                            .stroke(Stroke::new(1.0, ACCENT))
                            .corner_radius(12)
                            .min_size(egui::vec2(126.0, PRIMARY_ACTION_HEIGHT)),
                    )
                    .clicked()
                {
                    app.trigger_merge(ctx.clone());
                }

                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if busy
                        && matches!(
                            app.pending_action,
                            Some(PendingAction::Merge | PendingAction::MergeCreate)
                        )
                    {
                        busy_indicator_chip(
                            ui,
                            app.pending_action
                                .map(PendingAction::label)
                                .unwrap_or("正在执行分支合并"),
                        );
                    }
                });
            });
        });
}

fn selected_job(project: &ProjectConfig, use_variant: bool) -> Option<&JobConfig> {
    if use_variant {
        project.jobs.variant.as_ref()
    } else {
        Some(&project.jobs.standard)
    }
}

fn preferred_deploy_param_default(job: &JobConfig, key: &str) -> String {
    if key == "IS_BUILD_MOBILE" && job.params.iter().any(|param| param == key) {
        "是".to_string()
    } else {
        job.default_params
            .get(key)
            .cloned()
            .unwrap_or_else(|| "否".to_string())
    }
}

fn job_has_param(project: &ProjectConfig, use_variant: bool, keys: &[&str]) -> bool {
    selected_job(project, use_variant)
        .map(|job| {
            job.params
                .iter()
                .any(|param| keys.iter().any(|key| param == key))
        })
        .unwrap_or(false)
}

fn env_param_key(plan: &DeployPlan) -> &str {
    plan.params
        .keys()
        .find(|key| matches!(key.as_str(), "ENV_PROFILE" | "projectEnv" | "env"))
        .map(String::as_str)
        .unwrap_or("")
}

fn push_unique(values: &mut Vec<String>, value: String) {
    if !value.is_empty() && !values.iter().any(|item| item == &value) {
        values.push(value);
    }
}

fn filter_branch_options(mut options: Vec<String>, query: &str, limit: usize) -> Vec<String> {
    let query = query.trim().to_lowercase();
    if !query.is_empty() {
        options.retain(|branch| branch.to_lowercase().contains(&query));
    }
    options.truncate(limit);
    options
}

fn prioritize_merge_target_options(options: Vec<String>, limit: usize) -> Vec<String> {
    let mut preferred = Vec::new();
    let mut others = Vec::new();

    for branch in options {
        let branch_lower = branch.to_lowercase();
        if MERGE_TARGET_PRIORITY_KEYWORDS
            .iter()
            .any(|keyword| branch_lower.contains(keyword))
        {
            preferred.push(branch);
        } else {
            others.push(branch);
        }
    }

    preferred.extend(others);
    preferred.truncate(limit);
    preferred
}

fn merge_target_presets(options: &[String]) -> Vec<String> {
    let mut presets = Vec::new();
    for branch in options {
        push_unique(&mut presets, branch.clone());
        if presets.len() >= 3 {
            break;
        }
    }
    presets
}

fn find_param_value(plan: &DeployPlan, keys: &[&str]) -> String {
    keys.iter()
        .find_map(|candidate| plan.params.get(*candidate).cloned())
        .unwrap_or_default()
}

fn field_label(ui: &mut egui::Ui, text: &str) {
    ui.label(RichText::new(text).small().color(MUTED));
}

fn compact_field<R>(
    ui: &mut egui::Ui,
    text: &str,
    add_contents: impl FnOnce(&mut egui::Ui) -> R,
) -> R {
    ui.add_space(0.0);
    field_label(ui, text);
    ui.add_space(0.0);
    let response = add_contents(ui);
    ui.add_space(2.0);
    response
}

fn searchable_branch_picker(
    ui: &mut egui::Ui,
    id_source: &str,
    selected: &mut String,
    query: &mut String,
    presets: &[String],
    options: &[String],
    width: f32,
    allow_sync: bool,
) -> bool {
    let popup_id = ui.make_persistent_id((id_source, "popup"));
    let mut sync_clicked = false;
    let button_text = if selected.is_empty() {
        "请选择分支".to_string()
    } else {
        selected.clone()
    };

    let response = ui.add_sized(
        [width, INPUT_HEIGHT],
        egui::Button::new(RichText::new(button_text).color(if selected.is_empty() {
            MUTED
        } else {
            INK
        }))
        .fill(Color32::from_rgb(250, 246, 239))
        .stroke(Stroke::new(1.0, BORDER))
        .corner_radius(12),
    );

    let just_opened = response.clicked();
    if just_opened {
        ui.memory_mut(|mem| mem.toggle_popup(popup_id));
    }

    egui::popup::popup_below_widget(
        ui,
        popup_id,
        &response,
        egui::popup::PopupCloseBehavior::CloseOnClickOutside,
        |ui| {
            egui::Frame::group(ui.style())
                .fill(PANEL)
                .stroke(Stroke::new(1.0, BORDER))
                .corner_radius(16)
                .inner_margin(egui::Margin::same(10))
                .show(ui, |ui| {
                    let popup_width = width.max(260.0);
                    let content_width = (popup_width - 24.0).max(180.0);
                    ui.set_min_width(popup_width);
                    ui.label(RichText::new("检索分支").small().color(MUTED));
                    ui.add_space(4.0);

                    let search_width = (content_width - 66.0).max(114.0);
                    ui.horizontal(|ui| {
                        let search = ui.add_sized(
                            [search_width, INPUT_HEIGHT],
                            egui::TextEdit::singleline(query).hint_text("输入关键字检索分支"),
                        );
                        if just_opened {
                            ui.memory_mut(|mem| mem.request_focus(search.id));
                        }

                        let sync_response = ui.add_enabled(
                            allow_sync,
                            egui::Button::new(RichText::new("同步").small().color(INK))
                                .fill(Color32::from_rgb(250, 246, 239))
                                .stroke(Stroke::new(1.0, BORDER))
                                .corner_radius(10)
                                .min_size(egui::vec2(60.0, INPUT_HEIGHT)),
                        );
                        if sync_response.clicked() {
                            sync_clicked = true;
                        }
                    });
                    ui.add_space(6.0);

                    let mut shown = Vec::new();
                    if query.is_empty() && !presets.is_empty() {
                        branch_section_title(ui, "常用分支");
                        ui.add_space(4.0);
                        for option in presets {
                            if branch_option_row(
                                ui,
                                selected.as_str() == option,
                                option,
                                content_width,
                            )
                            .clicked()
                            {
                                *selected = option.clone();
                                *query = option.clone();
                                ui.close_menu();
                            }
                            shown.push(option.clone());
                        }
                        ui.add_space(6.0);
                    }

                    branch_section_title(
                        ui,
                        if query.is_empty() {
                            "全部分支"
                        } else {
                            "搜索结果"
                        },
                    );
                    ui.add_space(4.0);

                    egui::ScrollArea::vertical()
                        .max_height(220.0)
                        .show(ui, |ui| {
                            let mut has_rows = false;
                            for option in options {
                                if shown.iter().any(|item| item == option) {
                                    continue;
                                }
                                has_rows = true;
                                if branch_option_row(
                                    ui,
                                    selected.as_str() == option,
                                    option,
                                    content_width,
                                )
                                .clicked()
                                {
                                    *selected = option.clone();
                                    *query = option.clone();
                                    ui.close_menu();
                                }
                            }

                            if !has_rows {
                                ui.label(RichText::new("没有匹配分支").small().color(MUTED));
                            }
                        });
                });
        },
    );

    sync_clicked
}

fn mode_button(ui: &mut egui::Ui, text: &str, active: bool, enabled: bool) -> egui::Response {
    let fill = if active { ACCENT } else { PANEL_SOFT };
    let text_color = if active { PANEL_RAISED } else { INK };

    ui.add_enabled(
        enabled,
        egui::Button::new(RichText::new(text).color(text_color).strong())
            .fill(fill)
            .stroke(Stroke::new(1.0, if active { ACCENT } else { BORDER }))
            .min_size(egui::vec2(72.0, 32.0))
            .corner_radius(255),
    )
}

fn pill(ui: &mut egui::Ui, text: &str, fill: Color32, color: Color32) {
    egui::Frame::group(ui.style())
        .fill(fill)
        .stroke(Stroke::new(1.0, fill))
        .corner_radius(255)
        .inner_margin(egui::Margin::symmetric(9, 4))
        .show(ui, |ui| {
            ui.label(RichText::new(text).small().color(color).strong());
        });
}

fn busy_indicator_chip(ui: &mut egui::Ui, text: &str) {
    let t = ui.input(|input| input.time) as f32;
    let pulse = ((t * 3.4).sin() * 0.5 + 0.5).clamp(0.0, 1.0);
    let dot = Color32::from_rgb(
        (184.0 + 24.0 * pulse) as u8,
        (94.0 + 14.0 * pulse) as u8,
        (66.0 + 10.0 * pulse) as u8,
    );

    egui::Frame::group(ui.style())
        .fill(Color32::from_rgb(248, 239, 232))
        .stroke(Stroke::new(1.0, Color32::from_rgb(230, 214, 200)))
        .corner_radius(255)
        .inner_margin(egui::Margin::symmetric(8, 4))
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.label(RichText::new("●").color(dot).strong().size(12.0));
                ui.label(RichText::new(text).small().color(MUTED).strong());
            });
        });
}

fn result_card(
    ui: &mut egui::Ui,
    result: &Option<DeployResultView>,
    busy: bool,
    pending_action: Option<PendingAction>,
) -> bool {
    let mut refresh_clicked = false;

    egui::Frame::group(ui.style())
        .fill(PANEL_RAISED)
        .stroke(Stroke::new(1.0, BORDER))
        .corner_radius(16)
        .inner_margin(egui::Margin::same(12))
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.colored_label(ACCENT, RichText::new("▍").strong());
                ui.label(RichText::new("部署结果").strong().size(15.0));

                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if result.is_some() {
                        let response = ui.add_enabled(
                            !busy,
                            egui::Button::new(RichText::new("刷新状态").small().color(INK))
                                .fill(PANEL_SOFT)
                                .stroke(Stroke::new(1.0, BORDER))
                                .corner_radius(10)
                                .min_size(egui::vec2(72.0, INPUT_HEIGHT)),
                        );
                        if response.clicked() {
                            refresh_clicked = true;
                        }
                    }
                });
            });
            ui.add_space(8.0);

            if busy {
                busy_indicator_chip(
                    ui,
                    pending_action
                        .map(PendingAction::label)
                        .unwrap_or("处理中，请稍候…"),
                );
                ui.add_space(8.0);
            }

            match result {
                Some(view) => {
                    let (fill, tone) = if view.success {
                        (Color32::from_rgb(245, 250, 246), SUCCESS)
                    } else {
                        (Color32::from_rgb(252, 245, 245), ERROR)
                    };

                    egui::Frame::group(ui.style())
                        .fill(fill)
                        .stroke(Stroke::new(1.0, fill.gamma_multiply(0.95)))
                        .corner_radius(12)
                        .inner_margin(egui::Margin::same(10))
                        .show(ui, |ui| {
                            ui.label(RichText::new(&view.summary).strong().color(tone).size(15.0));
                            ui.add_space(2.0);
                            ui.label(RichText::new(&view.detail).color(MUTED));
                        });

                    ui.add_space(8.0);
                    result_block(ui, "项目", view.project_name.as_deref().unwrap_or("-"));
                    result_block(ui, "任务", view.job_name.as_deref().unwrap_or("-"));
                    if let Some(status) = view.http_status {
                        result_block(ui, "HTTP", &status.to_string());
                    }
                    if !view.selected_params.is_empty() {
                        ui.add_space(8.0);
                        ui.label(RichText::new("参数").small().color(MUTED).strong());
                        for (key, value) in &view.selected_params {
                            result_param_row(ui, key, value);
                        }
                    }
                    result_link_block(ui, "队列", view.queue_url.as_deref());
                    result_link_block(ui, "构建", view.build_url.as_deref());
                }
                None => {
                    ui.label(RichText::new("确认参数后开始部署。").color(MUTED));
                }
            }
        });

    refresh_clicked
}

fn merge_result_card(ui: &mut egui::Ui, app: &mut DesktopApp, ctx: &egui::Context) {
    let result = app.merge_result.clone();
    let busy = app.is_busy();
    let pending_action = app.pending_action;
    egui::Frame::group(ui.style())
        .fill(PANEL_RAISED)
        .stroke(Stroke::new(1.0, BORDER))
        .corner_radius(16)
        .inner_margin(egui::Margin::same(12))
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.colored_label(ACCENT, RichText::new("▍").strong());
                ui.label(RichText::new("合并结果").strong().size(15.0));
            });
            ui.add_space(8.0);

            if busy
                && matches!(
                    pending_action,
                    Some(PendingAction::Merge | PendingAction::MergeCreate)
                )
            {
                busy_indicator_chip(
                    ui,
                    pending_action
                        .map(PendingAction::label)
                        .unwrap_or("正在执行分支合并"),
                );
                ui.add_space(8.0);
            }

            match result {
                Some(view) => {
                    let (fill, tone) = if view.success {
                        (Color32::from_rgb(245, 250, 246), SUCCESS)
                    } else {
                        (Color32::from_rgb(252, 245, 245), ERROR)
                    };
                    egui::Frame::group(ui.style())
                        .fill(fill)
                        .stroke(Stroke::new(1.0, fill.gamma_multiply(0.95)))
                        .corner_radius(12)
                        .inner_margin(egui::Margin::same(10))
                        .show(ui, |ui| {
                            ui.label(RichText::new(&view.summary).strong().color(tone).size(15.0));
                            ui.add_space(2.0);
                            ui.label(RichText::new(&view.project_name).color(MUTED));
                        });

                    ui.add_space(8.0);
                    result_block(ui, "目标", &view.target_branch);
                    result_block(ui, "源", &view.source_branch);
                    if let Some(commit) = view.merged_commit.as_deref() {
                        result_block(ui, "提交", &compact_link_text(commit, 24));
                    }
                    if let Some(latest) = &view.latest_commit {
                        result_block(ui, "最新", &latest.short_hash);
                        ui.add_space(2.0);
                        ui.label(RichText::new(&latest.subject).small().color(MUTED));
                    }

                    ui.add_space(8.0);
                    if ui
                        .add_enabled(
                            !busy && view.merged_commit.is_some() && !view.pushed,
                            egui::Button::new(RichText::new("推送目标分支").small().color(INK))
                                .fill(PANEL_SOFT)
                                .stroke(Stroke::new(1.0, BORDER))
                                .corner_radius(10),
                        )
                        .clicked()
                    {
                        app.trigger_push_merge_target(ctx.clone());
                    }
                    if view.pushed {
                        ui.add_space(4.0);
                        ui.label(RichText::new("远端已推送").small().color(SUCCESS));
                    }

                    ui.add_space(8.0);
                    ui.label(RichText::new("日志").small().color(MUTED).strong());
                    egui::ScrollArea::vertical()
                        .max_height(280.0)
                        .show(ui, |ui| {
                            ui.label(RichText::new(&view.detail).small().color(MUTED));
                        });
                }
                None => {
                    ui.label(RichText::new("选择项目、目标分支、源分支后执行合并。").color(MUTED));
                }
            }
        });
}

fn primary_nav_button(
    ui: &mut egui::Ui,
    text: &str,
    icon: NavIconKind,
    active: bool,
) -> egui::Response {
    let desired = egui::vec2(104.0, 40.0);
    let (rect, response) = ui.allocate_exact_size(desired, Sense::click());
    let fill = if active { ACCENT } else { PANEL_RAISED };
    let stroke = Stroke::new(1.0, if active { ACCENT } else { BORDER });
    let text_color = if active { PANEL_RAISED } else { INK };

    ui.painter()
        .rect(rect, 14.0, fill, stroke, egui::StrokeKind::Inside);

    let icon_rect = egui::Rect::from_min_size(
        rect.left_top() + egui::vec2(10.0, 10.0),
        egui::vec2(16.0, 16.0),
    );
    paint_nav_icon(ui.painter(), icon, icon_rect, text_color);
    ui.painter().text(
        rect.left_top() + egui::vec2(34.0, 20.0),
        Align2::LEFT_CENTER,
        text,
        FontId::proportional(12.8),
        text_color,
    );

    response
}

fn brand_mark(ui: &mut egui::Ui, collapsed: bool) {
    let size = if collapsed { 26.0 } else { 28.0 };
    egui::Frame::group(ui.style())
        .fill(ACCENT)
        .stroke(Stroke::new(1.0, ACCENT))
        .corner_radius(12)
        .inner_margin(egui::Margin::same(0))
        .show(ui, |ui| {
            ui.add_sized(
                [size, size],
                egui::Label::new(RichText::new("R").strong().color(PANEL_RAISED).size(15.0)),
            );
        });
}

fn primary_nav_compact_button(
    ui: &mut egui::Ui,
    icon: NavIconKind,
    tooltip: &str,
    active: bool,
) -> egui::Response {
    let desired = egui::vec2(36.0, 36.0);
    let (rect, response) = ui.allocate_exact_size(desired, Sense::click());
    let fill = if active { ACCENT } else { PANEL_RAISED };
    let stroke = Stroke::new(1.0, if active { ACCENT } else { BORDER });
    let icon_color = if active { PANEL_RAISED } else { INK };

    ui.painter()
        .rect(rect, 12.0, fill, stroke, egui::StrokeKind::Inside);
    let icon_rect = egui::Rect::from_center_size(rect.center(), egui::vec2(16.0, 16.0));
    paint_nav_icon(ui.painter(), icon, icon_rect, icon_color);

    response.on_hover_text(tooltip)
}

fn sidebar_toggle_button(ui: &mut egui::Ui, collapsed: bool) -> egui::Response {
    let text = if collapsed { ">" } else { "<" };
    let hint = if collapsed {
        "展开左侧菜单"
    } else {
        "收起左侧菜单"
    };

    ui.add_sized(
        [30.0, 30.0],
        egui::Button::new(RichText::new(text).small().color(INK).strong())
            .fill(PANEL_SOFT)
            .stroke(Stroke::new(1.0, BORDER))
            .corner_radius(10),
    )
    .on_hover_text(hint)
}

fn paint_nav_icon(painter: &egui::Painter, kind: NavIconKind, rect: egui::Rect, color: Color32) {
    let stroke = Stroke::new(1.8, color);
    match kind {
        NavIconKind::Deploy => {
            let box_rect = egui::Rect::from_min_max(
                rect.left_top() + egui::vec2(1.5, 4.5),
                rect.right_bottom() - egui::vec2(3.0, 1.5),
            );
            painter.rect_stroke(box_rect, 4.0, stroke, egui::StrokeKind::Inside);
            painter.line_segment(
                [
                    rect.center_top() + egui::vec2(0.0, 1.5),
                    rect.center() + egui::vec2(0.0, 1.5),
                ],
                stroke,
            );
            painter.line_segment(
                [
                    rect.center() + egui::vec2(-3.0, -1.0),
                    rect.center() + egui::vec2(0.0, -4.0),
                ],
                stroke,
            );
            painter.line_segment(
                [
                    rect.center() + egui::vec2(3.0, -1.0),
                    rect.center() + egui::vec2(0.0, -4.0),
                ],
                stroke,
            );
        }
        NavIconKind::Merge => {
            painter.line_segment(
                [
                    rect.left_top() + egui::vec2(3.0, 3.0),
                    rect.center() + egui::vec2(-1.0, 1.0),
                ],
                stroke,
            );
            painter.line_segment(
                [
                    rect.left_bottom() - egui::vec2(-3.0, 3.0),
                    rect.center() + egui::vec2(-1.0, -1.0),
                ],
                stroke,
            );
            painter.line_segment(
                [
                    rect.center() + egui::vec2(-1.0, 0.0),
                    rect.right_center() - egui::vec2(3.5, 0.0),
                ],
                stroke,
            );
            painter.line_segment(
                [
                    rect.right_center() - egui::vec2(6.0, 3.0),
                    rect.right_center() - egui::vec2(3.0, 0.0),
                ],
                stroke,
            );
            painter.line_segment(
                [
                    rect.right_center() - egui::vec2(6.0, -3.0),
                    rect.right_center() - egui::vec2(3.0, 0.0),
                ],
                stroke,
            );
        }
        NavIconKind::Navigate => {
            painter.circle_stroke(rect.center(), 6.2, stroke);
            painter.line_segment(
                [
                    rect.center() + egui::vec2(-1.0, 2.5),
                    rect.center() + egui::vec2(4.0, -3.5),
                ],
                stroke,
            );
            painter.line_segment(
                [
                    rect.center() + egui::vec2(0.0, -4.0),
                    rect.center() + egui::vec2(4.0, -3.5),
                ],
                stroke,
            );
            painter.line_segment(
                [
                    rect.center() + egui::vec2(3.5, 0.0),
                    rect.center() + egui::vec2(4.0, -3.5),
                ],
                stroke,
            );
        }
    }
}

fn panel_card<R>(
    ui: &mut egui::Ui,
    title: &str,
    add_contents: impl FnOnce(&mut egui::Ui) -> R,
) -> R {
    egui::Frame::group(ui.style())
        .fill(PANEL_RAISED)
        .stroke(Stroke::new(1.0, BORDER))
        .corner_radius(16)
        .inner_margin(egui::Margin::same(12))
        .show(ui, |ui| {
            ui.vertical(|ui| {
                ui.horizontal(|ui| {
                    ui.colored_label(ACCENT, RichText::new("▍").strong());
                    ui.label(RichText::new(title).strong().size(15.0).color(INK));
                });
                ui.add_space(6.0);
                add_contents(ui)
            })
            .inner
        })
        .inner
}

fn centered_panel_width(content_width: f32, max_width: f32) -> f32 {
    (content_width - 8.0).clamp(320.0, max_width)
}

fn centered_panel<R>(
    ui: &mut egui::Ui,
    width: f32,
    add_contents: impl FnOnce(&mut egui::Ui) -> R,
) -> R {
    ui.horizontal(|ui| {
        let gutter = ((ui.available_width() - width) * 0.5).max(0.0);
        if gutter > 0.0 {
            ui.add_space(gutter);
        }
        let inner = ui
            .allocate_ui_with_layout(
                egui::vec2(width, 0.0),
                egui::Layout::top_down(egui::Align::Min),
                add_contents,
            )
            .inner;
        if gutter > 0.0 {
            ui.add_space(gutter);
        }
        inner
    })
    .inner
}

fn branch_section_title(ui: &mut egui::Ui, text: &str) {
    ui.label(RichText::new(text).small().color(MUTED));
}

fn branch_option_row(ui: &mut egui::Ui, selected: bool, text: &str, width: f32) -> egui::Response {
    ui.add_sized(
        [width, 30.0],
        egui::Button::new(
            RichText::new(text)
                .color(if selected { ACCENT } else { INK })
                .strong(),
        )
        .fill(if selected { ACCENT_SOFT } else { PANEL_SOFT })
        .stroke(Stroke::new(1.0, if selected { ACCENT } else { BORDER }))
        .corner_radius(10),
    )
}

fn navigation_category_chip(ui: &mut egui::Ui, category: &str, active: bool) -> egui::Response {
    ui.add(
        egui::Button::new(
            RichText::new(navigation_category_label(category))
                .small()
                .color(if active { PANEL } else { INK })
                .strong(),
        )
        .fill(if active {
            ACCENT
        } else {
            Color32::from_rgb(252, 249, 244)
        })
        .stroke(Stroke::new(1.0, if active { ACCENT } else { BORDER }))
        .corner_radius(255)
        .min_size(egui::vec2(62.0, 26.0)),
    )
}

fn result_block(ui: &mut egui::Ui, label: &str, value: &str) {
    ui.add_space(1.0);
    ui.horizontal(|ui| {
        ui.add_sized(
            [48.0, 18.0],
            egui::Label::new(RichText::new(label).small().color(MUTED)),
        );
        ui.add_space(4.0);
        ui.label(RichText::new(value).color(INK));
    });
    ui.add_space(1.0);
}

fn result_param_row(ui: &mut egui::Ui, key: &str, value: &str) {
    ui.add_space(1.0);
    ui.horizontal(|ui| {
        ui.add_sized(
            [92.0, 18.0],
            egui::Label::new(RichText::new(key).small().color(MUTED)),
        );
        ui.add_space(4.0);
        ui.label(RichText::new(value).small().color(INK));
    });
}

fn result_link_block(ui: &mut egui::Ui, label: &str, value: Option<&str>) {
    ui.add_space(1.0);
    ui.horizontal(|ui| {
        ui.add_sized(
            [48.0, 18.0],
            egui::Label::new(RichText::new(label).small().color(MUTED)),
        );
        ui.add_space(4.0);
        match value {
            Some(link) => {
                ui.hyperlink_to("查看", link);
            }
            None => {
                ui.label(RichText::new("-").color(MUTED));
            }
        }
    });
    if let Some(link) = value {
        ui.add_space(1.0);
        ui.horizontal(|ui| {
            ui.add_space(52.0);
            ui.label(
                RichText::new(compact_link_text(link, 42))
                    .small()
                    .color(MUTED),
            );
        });
    }
    ui.add_space(1.0);
}

fn compact_link_text(value: &str, max_chars: usize) -> String {
    let total = value.chars().count();
    if total <= max_chars {
        return value.to_string();
    }

    let head_len = max_chars / 2 - 2;
    let tail_len = max_chars.saturating_sub(head_len + 3);
    let head: String = value.chars().take(head_len).collect();
    let tail: String = value
        .chars()
        .rev()
        .take(tail_len)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();

    format!("{head}...{tail}")
}
