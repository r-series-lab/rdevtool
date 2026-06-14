use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

const APP_CONFIG_DIR_NAME: &str = "rDevTool";
const DEFAULT_PROJECTS_TEMPLATE: &str = include_str!("../projects.template.toml");
const DEFAULT_WORKSPACE_TEMPLATE: &str = include_str!("../workspace.template.toml");

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AppConfig {
    pub defaults: Defaults,
    pub projects: Vec<ProjectConfig>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct WorkspaceConfig {
    #[serde(default)]
    pub app: WorkspaceAppConfig,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct WorkspaceAppConfig {
    #[serde(default = "default_workspace_style_mode")]
    pub style_mode: String,
    #[serde(default)]
    pub default_page: Option<String>,
    #[serde(default = "default_workspace_enabled_pages")]
    pub enabled_pages: Vec<String>,
}

fn default_workspace_style_mode() -> String {
    "light".to_string()
}

fn default_workspace_enabled_pages() -> Vec<String> {
    vec![
        "projects".to_string(),
        "merge".to_string(),
        "deploy".to_string(),
    ]
}

impl Default for WorkspaceAppConfig {
    fn default() -> Self {
        Self {
            style_mode: default_workspace_style_mode(),
            default_page: None,
            enabled_pages: default_workspace_enabled_pages(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ConfigPaths {
    pub dir: PathBuf,
    pub projects: PathBuf,
    pub workspace: PathBuf,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Defaults {
    #[serde(default)]
    pub jenkins_profiles: BTreeMap<String, JenkinsProfileConfig>,
    #[serde(default)]
    pub jenkins_base_url: String,
    #[serde(default)]
    pub jenkins_username: String,
    #[serde(default)]
    pub jenkins_password: Option<String>,
    #[serde(default = "default_jenkins_password_env")]
    pub jenkins_password_env: String,
    #[serde(default)]
    pub jenkins_password_fallback_file: Option<PathBuf>,
    #[serde(default)]
    pub gitlab_api_base_url: Option<String>,
    #[serde(default = "default_gitlab_token_env")]
    pub gitlab_token_env: String,
    #[serde(default)]
    pub gitlab_token: Option<String>,
    #[serde(default = "empty_branch_rules")]
    pub branch_rules: BranchRules,
    #[serde(default)]
    pub runtime_profiles: Vec<RuntimeProfileConfig>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct JenkinsProfileConfig {
    pub base_url: String,
    pub username: String,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default = "default_jenkins_password_env")]
    pub password_env: String,
    #[serde(default)]
    pub password_fallback_file: Option<PathBuf>,
}

fn default_jenkins_password_env() -> String {
    "JENKINS_PASSWORD".to_string()
}

fn default_gitlab_token_env() -> String {
    "GITLAB_TOKEN".to_string()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProjectConfig {
    pub key: String,
    pub name: String,
    #[serde(default = "default_project_category")]
    pub category: String,
    #[serde(default)]
    pub repo_path: Option<PathBuf>,
    #[serde(default)]
    pub git_url: String,
    #[serde(default)]
    pub deploy_targets: Vec<DeployTargetConfig>,
    #[serde(default)]
    pub jobs: Jobs,
    #[serde(default)]
    pub dev: Option<ProjectCommandConfig>,
    #[serde(default)]
    pub build: Option<ProjectCommandConfig>,
    #[serde(default)]
    pub focus: ProjectFocusConfig,
    #[serde(default = "empty_branch_rules")]
    pub branch_rules: BranchRules,
    #[serde(default)]
    pub debug_profiles: Vec<ProjectDebugProfileConfig>,
}

fn default_project_category() -> String {
    "Workspace".to_string()
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct ProjectCommandConfig {
    pub command: String,
    #[serde(default)]
    pub cwd: Option<PathBuf>,
    #[serde(default)]
    pub output_dir: Option<PathBuf>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct ProjectFocusConfig {
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub bundle_id: Option<String>,
    #[serde(default)]
    pub auto_on_start: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct ProjectDebugProfileConfig {
    pub key: String,
    pub label: String,
    #[serde(default)]
    pub runtime_profile: Option<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub local_files: Vec<ProjectDebugLocalFileConfig>,
    #[serde(default)]
    pub browser: Option<String>,
    #[serde(default)]
    pub browser_profile: Option<String>,
    #[serde(default)]
    pub browser_user_data_dir: Option<PathBuf>,
    #[serde(default)]
    pub browser_args: Vec<String>,
    #[serde(default)]
    pub network_proxy: ProjectNetworkProxyConfig,
    #[serde(default)]
    pub local_proxy: ProjectLocalProxyConfig,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct RuntimeProfileConfig {
    pub key: String,
    pub label: String,
    #[serde(default)]
    pub browser: Option<String>,
    #[serde(default)]
    pub browser_profile: Option<String>,
    #[serde(default)]
    pub browser_user_data_dir: Option<PathBuf>,
    #[serde(default)]
    pub web_actions_enabled: bool,
    #[serde(default = "default_runtime_profile_web_actions_port")]
    pub web_actions_port: u16,
    #[serde(default)]
    pub web_actions_user_data_dir: Option<PathBuf>,
    #[serde(default)]
    pub browser_args: Vec<String>,
    #[serde(default)]
    pub proxy_url: String,
    #[serde(default)]
    pub proxy_bypass: String,
    #[serde(default)]
    pub host_resolver_rules: Vec<String>,
    #[serde(default)]
    pub network_proxy: ProjectNetworkProxyConfig,
}

fn default_runtime_profile_web_actions_port() -> u16 {
    9223
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProjectNetworkProxyConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub proxy_url: String,
    #[serde(default = "default_true")]
    pub inject_env: bool,
    #[serde(default)]
    pub node_hook: bool,
    #[serde(default = "default_network_proxy_no_proxy")]
    pub no_proxy: String,
}

impl Default for ProjectNetworkProxyConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            proxy_url: String::new(),
            inject_env: true,
            node_hook: false,
            no_proxy: default_network_proxy_no_proxy(),
        }
    }
}

fn default_network_proxy_no_proxy() -> String {
    "localhost,127.0.0.1,::1".to_string()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProjectLocalProxyConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_local_proxy_listen")]
    pub listen: String,
    #[serde(default)]
    pub frontend_url: String,
    #[serde(default)]
    pub upstream_proxy: String,
    #[serde(default)]
    pub routes: Vec<ProjectLocalProxyRouteConfig>,
    #[serde(default)]
    pub auth_helper: ProjectAuthHelperConfig,
}

impl Default for ProjectLocalProxyConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            listen: default_local_proxy_listen(),
            frontend_url: String::new(),
            upstream_proxy: String::new(),
            routes: Vec::new(),
            auth_helper: ProjectAuthHelperConfig::default(),
        }
    }
}

fn default_local_proxy_listen() -> String {
    "127.0.0.1:3000".to_string()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProjectLocalProxyRouteConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub match_prefix: String,
    pub target: String,
    #[serde(default)]
    pub rewrite_prefix: String,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProjectAuthHelperConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_auth_helper_path")]
    pub path: String,
    #[serde(default = "default_auth_helper_redirect_path")]
    pub redirect_path: String,
    #[serde(default)]
    pub items: Vec<ProjectAuthHelperItemConfig>,
}

impl Default for ProjectAuthHelperConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            path: default_auth_helper_path(),
            redirect_path: default_auth_helper_redirect_path(),
            items: Vec::new(),
        }
    }
}

fn default_auth_helper_path() -> String {
    "/__auth-helper".to_string()
}

fn default_auth_helper_redirect_path() -> String {
    "/#/".to_string()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProjectAuthHelperItemConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_auth_helper_storage")]
    pub storage: String,
    pub key: String,
    #[serde(default)]
    pub from_json_path: String,
    #[serde(default)]
    pub value: String,
    #[serde(default = "default_auth_helper_cookie_path")]
    pub cookie_path: String,
    #[serde(default)]
    pub cookie_max_age_seconds: Option<i64>,
    #[serde(default)]
    pub cookie_same_site: String,
}

fn default_auth_helper_storage() -> String {
    "localStorage".to_string()
}

fn default_auth_helper_cookie_path() -> String {
    "/".to_string()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProjectDebugLocalFileConfig {
    pub path: PathBuf,
    #[serde(default = "default_debug_local_file_mode")]
    pub mode: String,
    #[serde(default)]
    pub content: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_debug_local_file_mode() -> String {
    "overwrite".to_string()
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BranchRules {
    #[serde(default = "default_source_branch_keywords")]
    pub source_keywords: Vec<String>,
    #[serde(default = "default_target_branch_keywords")]
    pub target_keywords: Vec<String>,
}

impl Default for BranchRules {
    fn default() -> Self {
        Self {
            source_keywords: default_source_branch_keywords(),
            target_keywords: default_target_branch_keywords(),
        }
    }
}

impl BranchRules {
    pub fn empty() -> Self {
        Self {
            source_keywords: Vec::new(),
            target_keywords: Vec::new(),
        }
    }
}

fn empty_branch_rules() -> BranchRules {
    BranchRules::empty()
}

fn default_source_branch_keywords() -> Vec<String> {
    vec!["release".to_string(), "feature".to_string()]
}

fn default_target_branch_keywords() -> Vec<String> {
    vec![
        "variant".to_string(),
        "pre".to_string(),
        "master".to_string(),
        "release".to_string(),
    ]
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DeployTargetConfig {
    pub key: String,
    pub label: String,
    pub jenkins_profile: String,
    pub job_name: String,
    #[serde(default)]
    pub params: Vec<DeployParamConfig>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DeployParamConfig {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub kind: DeployParamKind,
    #[serde(default)]
    pub default: Option<String>,
    #[serde(default)]
    pub options: Vec<String>,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub true_value: Option<String>,
    #[serde(default)]
    pub false_value: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeployParamKind {
    Select,
    Boolean,
    Branch,
    Text,
    Hidden,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct Jobs {
    #[serde(default)]
    pub standard: JobConfig,
    #[serde(default)]
    pub variant: Option<JobConfig>,
}

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
pub struct JobConfig {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub params: Vec<String>,
    #[serde(default)]
    pub default_params: BTreeMap<String, String>,
}

pub fn load_config(path: &Path) -> Result<AppConfig> {
    let content = fs::read_to_string(path)
        .with_context(|| format!("failed to read config: {}", path.display()))?;
    let config: AppConfig = toml::from_str(&content)
        .with_context(|| format!("failed to parse config: {}", path.display()))?;
    Ok(config)
}

pub fn save_config(path: &Path, config: &AppConfig) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create config directory: {}", parent.display()))?;
    }

    let content = toml::to_string_pretty(config)
        .with_context(|| format!("failed to serialize config: {}", path.display()))?;
    fs::write(path, content)
        .with_context(|| format!("failed to write config: {}", path.display()))?;
    Ok(())
}

pub fn load_workspace_config(path: &Path) -> Result<WorkspaceConfig> {
    let content = fs::read_to_string(path)
        .with_context(|| format!("failed to read workspace config: {}", path.display()))?;
    let config: WorkspaceConfig = toml::from_str(&content)
        .with_context(|| format!("failed to parse workspace config: {}", path.display()))?;
    Ok(config)
}

pub fn save_workspace_config(path: &Path, config: &WorkspaceConfig) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "failed to create workspace config directory: {}",
                parent.display()
            )
        })?;
    }

    let content = toml::to_string_pretty(config)
        .with_context(|| format!("failed to serialize workspace config: {}", path.display()))?;
    fs::write(path, content)
        .with_context(|| format!("failed to write workspace config: {}", path.display()))?;
    Ok(())
}

pub fn default_config_dir() -> PathBuf {
    let Some(home) = std::env::var_os("HOME") else {
        return PathBuf::from(".rdevtool");
    };
    let home = PathBuf::from(home);
    if cfg!(target_os = "macos") {
        home.join("Library")
            .join("Application Support")
            .join(APP_CONFIG_DIR_NAME)
    } else {
        home.join(".config").join(APP_CONFIG_DIR_NAME)
    }
}

pub fn default_projects_path() -> PathBuf {
    default_config_dir().join("projects.toml")
}

pub fn default_workspace_path() -> PathBuf {
    default_config_dir().join("workspace.toml")
}

pub fn legacy_projects_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("projects.toml")
}

pub fn ensure_default_configs() -> Result<ConfigPaths> {
    let dir = default_config_dir();
    fs::create_dir_all(&dir)
        .with_context(|| format!("failed to create config directory: {}", dir.display()))?;

    let projects = default_projects_path();
    let legacy = legacy_projects_path();
    if !projects.exists() {
        if legacy.exists() {
            fs::copy(&legacy, &projects).with_context(|| {
                format!(
                    "failed to migrate legacy config from {} to {}",
                    legacy.display(),
                    projects.display()
                )
            })?;
        } else {
            fs::write(&projects, DEFAULT_PROJECTS_TEMPLATE).with_context(|| {
                format!(
                    "failed to write default projects config: {}",
                    projects.display()
                )
            })?;
        }
    } else if legacy.exists() && is_starter_projects_config(&projects) {
        fs::copy(&legacy, &projects).with_context(|| {
            format!(
                "failed to replace starter config from {} to {}",
                legacy.display(),
                projects.display()
            )
        })?;
    }

    let workspace = default_workspace_path();
    if !workspace.exists() {
        fs::write(&workspace, DEFAULT_WORKSPACE_TEMPLATE).with_context(|| {
            format!(
                "failed to write default workspace config: {}",
                workspace.display()
            )
        })?;
    }

    Ok(ConfigPaths {
        dir,
        projects,
        workspace,
    })
}

fn is_starter_projects_config(path: &Path) -> bool {
    let Ok(content) = fs::read_to_string(path) else {
        return false;
    };
    let Ok(config) = toml::from_str::<AppConfig>(&content) else {
        return false;
    };
    config.projects.len() == 1
        && config
            .projects
            .first()
            .is_some_and(|item| item.key == "example-web")
}

pub fn resolve_config_path(requested: &Path) -> Result<PathBuf> {
    if requested.exists() {
        return Ok(requested.to_path_buf());
    }

    let fallback = PathBuf::from("projects.example.toml");
    if fallback.exists() {
        return Ok(fallback);
    }

    bail!(
        "config not found: {} (and fallback projects.example.toml is missing)",
        requested.display()
    );
}

impl AppConfig {
    pub fn find_project(&self, key: &str) -> Result<&ProjectConfig> {
        self.projects
            .iter()
            .find(|project| project.key == key)
            .with_context(|| format!("project not found: {key}"))
    }

    pub fn branch_rules_for_project(&self, key: &str) -> Result<BranchRules> {
        let project = self.find_project(key)?;
        Ok(BranchRules {
            source_keywords: if project.branch_rules.source_keywords.is_empty() {
                self.defaults.branch_rules.source_keywords.clone()
            } else {
                project.branch_rules.source_keywords.clone()
            },
            target_keywords: if project.branch_rules.target_keywords.is_empty() {
                self.defaults.branch_rules.target_keywords.clone()
            } else {
                project.branch_rules.target_keywords.clone()
            },
        })
    }
}

impl ProjectConfig {
    pub fn category_label(&self) -> &str {
        let value = self.category.trim();
        if value.is_empty() { "Workspace" } else { value }
    }

    pub fn supports_deploy(&self) -> bool {
        !self.deploy_targets.is_empty()
    }

    pub fn supports_branch(&self) -> bool {
        self.repo_path.is_some() && !self.git_url.trim().is_empty()
    }
}
