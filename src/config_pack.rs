use anyhow::{Context, Result, bail};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value as JsonValue};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use uuid::Uuid;
use zip::write::FileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::config::{
    AppConfig, ConfigPaths, Defaults, ProjectConfig, ProjectWorkspaceConfig, WorkspaceAppConfig,
    WorkspaceConfig, ensure_default_configs, load_all_project_workspaces, load_config,
    load_workspace_config, normalize_project_workspace_key,
};
use crate::config_sources::{
    ConfigSource, list_config_sources, resolve_config_source_from_sources,
};
use crate::config_store::{with_config_file_locks, write_config_text_atomic};

pub const CONFIG_PACK_FORMAT: &str = "rdevtool.config-pack";
pub const CONFIG_PACK_SCHEMA_VERSION: u16 = 1;
const MANIFEST_ENTRY: &str = "manifest.json";
const README_ENTRY: &str = "README.txt";
const PROJECTS_ENTRY: &str = "modules/projects.json";
const WORKSPACES_ENTRY: &str = "modules/workspaces.json";
const SOURCES_ENTRY: &str = "modules/config-sources.json";
const MAX_PACK_SIZE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ENTRY_SIZE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_ENTRY_COUNT: usize = 64;
const PLAN_TTL_HOURS: i64 = 24;
const MAX_TRANSACTION_HISTORY: usize = 100;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPackManifest {
    pub format: String,
    pub schema_version: u16,
    pub pack_id: String,
    pub name: String,
    pub created_at: String,
    pub producer: ConfigPackProducer,
    pub modules: Vec<ConfigPackModuleManifest>,
    pub security: ConfigPackSecuritySummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPackProducer {
    pub app: String,
    pub version: String,
    pub platform: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPackModuleManifest {
    pub key: String,
    pub schema_version: u16,
    pub file: String,
    pub item_count: usize,
    pub sha256: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPackSecuritySummary {
    pub sensitive_values_removed: usize,
    #[serde(default)]
    pub required_environment: Vec<String>,
    #[serde(default)]
    pub portable_path_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPackProjectsModule {
    pub schema_version: u16,
    pub defaults: Defaults,
    pub projects: Vec<ProjectConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPackWorkspacesModule {
    pub schema_version: u16,
    #[serde(default)]
    pub preferences: Option<WorkspaceAppConfig>,
    pub workspaces: Vec<ProjectWorkspaceConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPackSourcesModule {
    pub schema_version: u16,
    pub sources: Vec<ConfigPackSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPackSource {
    pub source_id: String,
    pub source_name: String,
    pub capabilities: Vec<String>,
    pub files: BTreeMap<String, JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPackExportRequest {
    pub output_path: PathBuf,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default = "default_true")]
    pub include_projects: bool,
    #[serde(default = "default_true")]
    pub include_workspaces: bool,
    #[serde(default)]
    pub include_preferences: bool,
    #[serde(default)]
    pub include_config_sources: bool,
    #[serde(default = "default_true")]
    pub include_dependencies: bool,
    #[serde(default)]
    pub project_keys: Vec<String>,
    #[serde(default)]
    pub workspace_keys: Vec<String>,
    #[serde(default)]
    pub config_source_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPackExportResult {
    pub output_path: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub manifest: ConfigPackManifest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPackInspection {
    pub path: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub valid: bool,
    pub manifest: ConfigPackManifest,
    pub project_keys: Vec<String>,
    pub workspace_keys: Vec<String>,
    pub config_source_ids: Vec<String>,
    pub issues: Vec<ConfigPackIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPackInventory {
    pub projects: Vec<ConfigPackInventoryItem>,
    pub workspaces: Vec<ConfigPackInventoryItem>,
    pub config_sources: Vec<ConfigPackInventoryItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPackInventoryItem {
    pub key: String,
    pub name: String,
    pub detail: String,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConfigPackConflictStrategy {
    Add,
    #[default]
    Merge,
    Replace,
    Skip,
}

impl ConfigPackConflictStrategy {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Add => "add",
            Self::Merge => "merge",
            Self::Replace => "replace",
            Self::Skip => "skip",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPackImportRequest {
    pub pack_path: PathBuf,
    #[serde(default)]
    pub strategy: ConfigPackConflictStrategy,
    #[serde(default)]
    pub project_root_mappings: BTreeMap<String, String>,
    #[serde(default)]
    pub workspace_root_mappings: BTreeMap<String, String>,
    #[serde(default)]
    pub config_source_mappings: BTreeMap<String, String>,
    #[serde(default)]
    pub require_secrets: bool,
    #[serde(default)]
    pub included_operation_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPackImportPlan {
    pub plan_hash: String,
    pub created_at: String,
    pub expires_at: String,
    pub pack_name: String,
    pub pack_path: String,
    pub pack_sha256: String,
    pub strategy: ConfigPackConflictStrategy,
    pub operations: Vec<ConfigPackOperation>,
    pub issues: Vec<ConfigPackIssue>,
    pub required_mappings: Vec<ConfigPackRequiredMapping>,
    pub required_environment: Vec<String>,
    pub blocker_count: usize,
    pub change_count: usize,
    pub skip_count: usize,
    pub excluded_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPackOperation {
    pub id: String,
    pub module: String,
    pub key: String,
    pub action: String,
    pub target: String,
    pub summary: String,
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPackIssue {
    pub severity: String,
    pub code: String,
    pub module: String,
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPackRequiredMapping {
    pub kind: String,
    pub key: String,
    pub placeholder: String,
    pub suggested_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPackApplyResult {
    pub plan_hash: String,
    pub transaction_id: String,
    pub backup_dir: String,
    pub changed_paths: Vec<String>,
    pub applied_count: usize,
    pub skipped_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPackRollbackResult {
    pub transaction_id: String,
    pub restored_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPackTransactionHistory {
    pub transactions: Vec<ConfigPackTransactionSummary>,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPackTransactionSummary {
    pub transaction_id: String,
    pub created_at: String,
    pub pack_name: String,
    pub pack_path: String,
    pub pack_sha256: String,
    pub plan_hash: String,
    pub changed_paths: Vec<String>,
    pub applied_count: usize,
    pub skipped_count: usize,
    pub rolled_back_at: Option<String>,
    pub can_rollback: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredImportPlan {
    plan_hash: String,
    created_at: String,
    expires_at: String,
    request: ConfigPackImportRequest,
    pack_sha256: String,
    destination_state_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigPackTransaction {
    transaction_id: String,
    created_at: String,
    plan_hash: String,
    #[serde(default)]
    pack_name: String,
    #[serde(default)]
    pack_path: String,
    #[serde(default)]
    pack_sha256: String,
    #[serde(default)]
    applied_count: usize,
    #[serde(default)]
    skipped_count: usize,
    files: Vec<ConfigPackTransactionFile>,
    #[serde(default)]
    rolled_back_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigPackTransactionFile {
    target_path: String,
    backup_file: Option<String>,
    existed: bool,
    #[serde(default)]
    applied_sha256: Option<String>,
}

#[derive(Debug)]
struct PackArchiveData {
    manifest: ConfigPackManifest,
    projects: Option<ConfigPackProjectsModule>,
    workspaces: Option<ConfigPackWorkspacesModule>,
    sources: Option<ConfigPackSourcesModule>,
    sha256: String,
    size_bytes: u64,
}

#[derive(Debug)]
struct PreparedImport {
    plan: ConfigPackImportPlan,
    destination_state_sha256: String,
    writes: Vec<PreparedWrite>,
}

#[derive(Debug)]
struct PreparedWrite {
    path: PathBuf,
    content: Vec<u8>,
}

#[derive(Default)]
struct ExportSecurityState {
    sensitive_values_removed: usize,
    required_environment: BTreeSet<String>,
    portable_path_count: usize,
}

pub fn config_pack_inventory() -> Result<ConfigPackInventory> {
    let paths = ensure_default_configs()?;
    config_pack_inventory_with_paths(&paths)
}

pub fn config_pack_inventory_with_paths(paths: &ConfigPaths) -> Result<ConfigPackInventory> {
    let config = load_config(&paths.projects)?;
    let workspaces = load_all_project_workspaces(&paths.project_workspaces)?;
    let sources = list_config_sources(&workspaces)?;
    Ok(ConfigPackInventory {
        projects: config
            .projects
            .into_iter()
            .map(|project| ConfigPackInventoryItem {
                key: project.key,
                name: project.name,
                detail: project.category,
            })
            .collect(),
        workspaces: workspaces
            .iter()
            .filter(|workspace| !workspace.is_system())
            .map(|workspace| ConfigPackInventoryItem {
                key: workspace.key.clone(),
                name: workspace.name.clone(),
                detail: workspace.workspace_type.clone(),
            })
            .collect(),
        config_sources: sources
            .into_iter()
            .map(|source| ConfigPackInventoryItem {
                key: source.id,
                name: source.name,
                detail: source.capabilities.join(", "),
            })
            .collect(),
    })
}

pub fn export_config_pack(request: ConfigPackExportRequest) -> Result<ConfigPackExportResult> {
    let paths = ensure_default_configs()?;
    export_config_pack_with_paths(&paths, request)
}

pub fn export_config_pack_with_paths(
    paths: &ConfigPaths,
    request: ConfigPackExportRequest,
) -> Result<ConfigPackExportResult> {
    if !request.include_projects
        && !request.include_workspaces
        && !request.include_preferences
        && !request.include_config_sources
    {
        bail!("at least one configuration module must be selected");
    }
    let config = load_config(&paths.projects)?;
    let workspace_config = load_workspace_config(&paths.workspace)?;
    let all_workspaces = load_all_project_workspaces(&paths.project_workspaces)?;
    let selected_workspace_keys = normalized_selection(&request.workspace_keys);
    let selected_project_keys = normalized_selection(&request.project_keys);
    let selected_workspaces = all_workspaces
        .iter()
        .filter(|workspace| {
            request.include_workspaces
                && !workspace.is_system()
                && (selected_workspace_keys.is_empty()
                    || selected_workspace_keys.contains(&workspace.key))
        })
        .cloned()
        .collect::<Vec<_>>();

    validate_requested_keys(
        "workspace",
        &selected_workspace_keys,
        all_workspaces
            .iter()
            .map(|workspace| workspace.key.as_str()),
    )?;

    let mut effective_project_keys = selected_project_keys.clone();
    if request.include_dependencies {
        for workspace in &selected_workspaces {
            effective_project_keys.extend(workspace.projects.iter().cloned());
            effective_project_keys.extend(
                workspace
                    .project_instances
                    .iter()
                    .map(|instance| instance.project.clone()),
            );
        }
    }
    let selected_projects = config
        .projects
        .iter()
        .filter(|project| {
            request.include_projects
                && (effective_project_keys.is_empty()
                    || effective_project_keys.contains(&project.key))
        })
        .cloned()
        .collect::<Vec<_>>();
    validate_requested_keys(
        "project",
        &selected_project_keys,
        config.projects.iter().map(|project| project.key.as_str()),
    )?;
    if request.include_projects && request.include_dependencies {
        validate_requested_keys(
            "workspace project dependency",
            &effective_project_keys,
            config.projects.iter().map(|project| project.key.as_str()),
        )?;
    }

    let mut security = ExportSecurityState::default();
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let project_roots = config
        .projects
        .iter()
        .filter_map(|project| {
            project
                .repo_path
                .clone()
                .map(|path| (path, format!("${{PROJECT_ROOT:{}}}", project.key)))
        })
        .collect::<Vec<_>>();

    let mut module_entries = Vec::<(ConfigPackModuleManifest, Vec<u8>)>::new();
    if request.include_projects {
        let mut defaults = config.defaults.clone();
        sanitize_defaults(&mut defaults, &mut security);
        let projects = selected_projects
            .into_iter()
            .map(|project| {
                portable_typed_value(
                    project,
                    &project_roots,
                    home.as_deref(),
                    "projects",
                    &mut security,
                )
            })
            .collect::<Result<Vec<_>>>()?;
        let module = ConfigPackProjectsModule {
            schema_version: CONFIG_PACK_SCHEMA_VERSION,
            defaults,
            projects,
        };
        push_module_entry(
            &mut module_entries,
            "projects",
            PROJECTS_ENTRY,
            module.projects.len(),
            &module,
        )?;
    }

    if request.include_workspaces || request.include_preferences {
        let workspaces = selected_workspaces
            .into_iter()
            .map(|workspace| {
                let workspace_root = workspace
                    .root_dir
                    .clone()
                    .map(|path| (path, format!("${{WORKSPACE_ROOT:{}}}", workspace.key)));
                let mut roots = project_roots.clone();
                if let Some(root) = workspace_root {
                    roots.push(root);
                }
                portable_typed_value(
                    workspace,
                    &roots,
                    home.as_deref(),
                    "workspaces",
                    &mut security,
                )
            })
            .collect::<Result<Vec<_>>>()?;
        let mut preferences = request
            .include_preferences
            .then_some(workspace_config.app.clone());
        if let Some(preferences) = &mut preferences {
            preferences.active_workspace = None;
        }
        let module = ConfigPackWorkspacesModule {
            schema_version: CONFIG_PACK_SCHEMA_VERSION,
            preferences,
            workspaces,
        };
        let item_count = module.workspaces.len() + usize::from(module.preferences.is_some());
        push_module_entry(
            &mut module_entries,
            "workspaces",
            WORKSPACES_ENTRY,
            item_count,
            &module,
        )?;
    }

    if request.include_config_sources {
        let sources = list_config_sources(&all_workspaces)?;
        let requested_sources = if request.config_source_ids.is_empty() {
            BTreeSet::from(["default".to_string()])
        } else {
            normalized_selection(&request.config_source_ids)
        };
        let mut packed_sources = Vec::new();
        for source_id in requested_sources {
            let source = resolve_config_source_from_sources(Some(&source_id), &sources)?;
            packed_sources.push(export_config_source(
                &source,
                home.as_deref(),
                &mut security,
            )?);
        }
        let module = ConfigPackSourcesModule {
            schema_version: CONFIG_PACK_SCHEMA_VERSION,
            sources: packed_sources,
        };
        push_module_entry(
            &mut module_entries,
            "config_sources",
            SOURCES_ENTRY,
            module.sources.len(),
            &module,
        )?;
    }

    let manifest = ConfigPackManifest {
        format: CONFIG_PACK_FORMAT.to_string(),
        schema_version: CONFIG_PACK_SCHEMA_VERSION,
        pack_id: Uuid::new_v4().to_string(),
        name: request
            .name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("rDevTool configuration")
            .to_string(),
        created_at: Utc::now().to_rfc3339(),
        producer: ConfigPackProducer {
            app: "rDevTool".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            platform: std::env::consts::OS.to_string(),
        },
        modules: module_entries
            .iter()
            .map(|(manifest, _)| manifest.clone())
            .collect(),
        security: ConfigPackSecuritySummary {
            sensitive_values_removed: security.sensitive_values_removed,
            required_environment: security.required_environment.into_iter().collect(),
            portable_path_count: security.portable_path_count,
        },
    };

    write_pack_archive(&request.output_path, &manifest, &module_entries)?;
    let bytes = fs::read(&request.output_path).with_context(|| {
        format!(
            "failed to read exported pack: {}",
            request.output_path.display()
        )
    })?;
    Ok(ConfigPackExportResult {
        output_path: request.output_path.display().to_string(),
        size_bytes: bytes.len() as u64,
        sha256: sha256(&bytes),
        manifest,
    })
}

pub fn inspect_config_pack(path: &Path) -> Result<ConfigPackInspection> {
    let archive = read_pack_archive(path)?;
    let mut issues = Vec::new();
    if archive.manifest.schema_version > CONFIG_PACK_SCHEMA_VERSION {
        issues.push(ConfigPackIssue {
            severity: "error".to_string(),
            code: "unsupported_schema".to_string(),
            module: "manifest".to_string(),
            path: "schemaVersion".to_string(),
            message: format!(
                "pack schema {} is newer than supported schema {}",
                archive.manifest.schema_version, CONFIG_PACK_SCHEMA_VERSION
            ),
        });
    }
    for module in archive.manifest.modules.iter().filter(|module| {
        matches!(
            module.key.as_str(),
            "projects" | "workspaces" | "config_sources"
        ) && module.schema_version > CONFIG_PACK_SCHEMA_VERSION
    }) {
        issues.push(ConfigPackIssue {
            severity: "error".to_string(),
            code: "unsupported_module_schema".to_string(),
            module: module.key.clone(),
            path: module.file.clone(),
            message: format!(
                "module {} schema {} is newer than supported schema {}",
                module.key, module.schema_version, CONFIG_PACK_SCHEMA_VERSION
            ),
        });
    }
    for module in archive.manifest.modules.iter().filter(|module| {
        !matches!(
            module.key.as_str(),
            "projects" | "workspaces" | "config_sources"
        )
    }) {
        issues.push(ConfigPackIssue {
            severity: "warning".to_string(),
            code: "unsupported_module".to_string(),
            module: module.key.clone(),
            path: module.file.clone(),
            message: format!(
                "module {} is preserved in the pack but is not supported by this version",
                module.key
            ),
        });
    }
    let project_keys = archive
        .projects
        .as_ref()
        .map(|module| {
            module
                .projects
                .iter()
                .map(|item| item.key.clone())
                .collect()
        })
        .unwrap_or_default();
    let workspace_keys = archive
        .workspaces
        .as_ref()
        .map(|module| {
            module
                .workspaces
                .iter()
                .map(|item| item.key.clone())
                .collect()
        })
        .unwrap_or_default();
    let config_source_ids = archive
        .sources
        .as_ref()
        .map(|module| {
            module
                .sources
                .iter()
                .map(|item| item.source_id.clone())
                .collect()
        })
        .unwrap_or_default();
    Ok(ConfigPackInspection {
        path: path.display().to_string(),
        size_bytes: archive.size_bytes,
        sha256: archive.sha256,
        valid: issues.iter().all(|issue| issue.severity != "error"),
        manifest: archive.manifest,
        project_keys,
        workspace_keys,
        config_source_ids,
        issues,
    })
}

pub fn plan_config_pack_import(request: ConfigPackImportRequest) -> Result<ConfigPackImportPlan> {
    let paths = ensure_default_configs()?;
    plan_config_pack_import_with_paths(&paths, request)
}

pub fn plan_config_pack_import_with_paths(
    paths: &ConfigPaths,
    mut request: ConfigPackImportRequest,
) -> Result<ConfigPackImportPlan> {
    request.pack_path = fs::canonicalize(&request.pack_path).with_context(|| {
        format!(
            "failed to resolve configuration pack: {}",
            request.pack_path.display()
        )
    })?;
    let prepared = prepare_import(paths, &request)?;
    persist_import_plan(paths, &request, &prepared)?;
    Ok(prepared.plan)
}

pub fn apply_config_pack_import(plan_hash: &str) -> Result<ConfigPackApplyResult> {
    let paths = ensure_default_configs()?;
    apply_config_pack_import_with_paths(&paths, plan_hash)
}

pub fn apply_config_pack_import_with_paths(
    paths: &ConfigPaths,
    plan_hash: &str,
) -> Result<ConfigPackApplyResult> {
    let stored = load_stored_plan(paths, plan_hash)?;
    let expires_at = DateTime::parse_from_rfc3339(&stored.expires_at)
        .context("invalid import plan expiry")?
        .with_timezone(&Utc);
    if Utc::now() > expires_at {
        bail!("import plan expired; create a new plan");
    }
    let prepared = prepare_import(paths, &stored.request)?;
    if prepared.plan.plan_hash != stored.plan_hash
        || prepared.plan.pack_sha256 != stored.pack_sha256
        || prepared.destination_state_sha256 != stored.destination_state_sha256
    {
        bail!("configuration or pack changed after planning; create a new import plan");
    }
    if prepared.plan.blocker_count > 0 {
        bail!("import plan has blockers and cannot be applied");
    }
    if prepared.plan.change_count == 0 {
        bail!("import plan contains no selected changes");
    }

    let plan_suffix = stored
        .plan_hash
        .strip_prefix("rdtpack-")
        .unwrap_or(&stored.plan_hash);
    let transaction_id = format!(
        "{}-{}-{}",
        Utc::now().format("%Y%m%dT%H%M%SZ"),
        &plan_suffix[..12.min(plan_suffix.len())],
        &Uuid::new_v4().simple().to_string()[..8],
    );
    let backup_dir = transaction_dir(paths, &transaction_id);
    fs::create_dir_all(&backup_dir)
        .with_context(|| format!("failed to create transaction dir: {}", backup_dir.display()))?;
    let mut transaction = ConfigPackTransaction {
        transaction_id: transaction_id.clone(),
        created_at: Utc::now().to_rfc3339(),
        plan_hash: stored.plan_hash.clone(),
        pack_name: prepared.plan.pack_name.clone(),
        pack_path: prepared.plan.pack_path.clone(),
        pack_sha256: prepared.plan.pack_sha256.clone(),
        applied_count: prepared.plan.change_count,
        skipped_count: prepared.plan.skip_count + prepared.plan.excluded_count,
        files: Vec::new(),
        rolled_back_at: None,
    };
    let lock_paths = prepared
        .writes
        .iter()
        .map(|write| write.path.clone())
        .collect::<Vec<_>>();
    let state_paths = lock_paths.iter().cloned().collect::<BTreeSet<_>>();
    with_config_file_locks(lock_paths, || {
        if destination_state_hash(&state_paths)? != stored.destination_state_sha256 {
            bail!("configuration changed while acquiring the import lock; create a new plan");
        }

        let mut originals = Vec::<(PathBuf, Option<Vec<u8>>)>::new();
        for (index, write) in prepared.writes.iter().enumerate() {
            let original = if write.path.exists() {
                Some(fs::read(&write.path).with_context(|| {
                    format!("failed to snapshot config: {}", write.path.display())
                })?)
            } else {
                None
            };
            let backup_file = original
                .as_ref()
                .map(|bytes| -> Result<String> {
                    let name = format!("{index:03}.bak");
                    write_config_text_atomic(&backup_dir.join(&name), bytes)?;
                    Ok(name)
                })
                .transpose()?;
            transaction.files.push(ConfigPackTransactionFile {
                target_path: write.path.display().to_string(),
                backup_file,
                existed: original.is_some(),
                applied_sha256: Some(sha256(&write.content)),
            });
            originals.push((write.path.clone(), original));
        }
        write_transaction_manifest(&backup_dir, &transaction)?;

        let write_result = (|| -> Result<()> {
            for write in &prepared.writes {
                write_config_text_atomic(&write.path, &write.content)?;
            }
            Ok(())
        })();
        if let Err(error) = write_result {
            if let Err(restore_error) = restore_originals(&originals) {
                bail!(
                    "failed to apply configuration pack ({error:#}); failed to restore original files ({restore_error:#})"
                );
            }
            return Err(error)
                .context("failed to apply configuration pack; original files restored");
        }
        Ok(())
    })?;

    Ok(ConfigPackApplyResult {
        plan_hash: stored.plan_hash,
        transaction_id,
        backup_dir: backup_dir.display().to_string(),
        changed_paths: prepared
            .writes
            .iter()
            .map(|write| write.path.display().to_string())
            .collect(),
        applied_count: prepared.plan.change_count,
        skipped_count: prepared.plan.skip_count + prepared.plan.excluded_count,
    })
}

pub fn list_config_pack_import_transactions() -> Result<ConfigPackTransactionHistory> {
    let paths = ensure_default_configs()?;
    list_config_pack_import_transactions_with_paths(&paths)
}

pub fn list_config_pack_import_transactions_with_paths(
    paths: &ConfigPaths,
) -> Result<ConfigPackTransactionHistory> {
    let root = transactions_dir(paths);
    if !root.exists() {
        return Ok(ConfigPackTransactionHistory {
            transactions: Vec::new(),
            issues: Vec::new(),
        });
    }

    let mut transactions = Vec::new();
    let mut issues = Vec::new();
    for entry in fs::read_dir(&root)? {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                issues.push(format!("failed to read transaction entry: {error}"));
                continue;
            }
        };
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(error) => {
                issues.push(format!(
                    "failed to inspect transaction entry {}: {error}",
                    entry.path().display()
                ));
                continue;
            }
        };
        if !file_type.is_dir() {
            continue;
        }
        let manifest_path = entry.path().join("transaction.json");
        let transaction = match fs::read(&manifest_path)
            .with_context(|| format!("failed to read transaction: {}", manifest_path.display()))
            .and_then(|bytes| {
                serde_json::from_slice::<ConfigPackTransaction>(&bytes)
                    .context("failed to parse transaction manifest")
            }) {
            Ok(transaction) => transaction,
            Err(error) => {
                issues.push(format!("{}: {error:#}", manifest_path.display()));
                continue;
            }
        };
        transactions.push(ConfigPackTransactionSummary {
            transaction_id: transaction.transaction_id,
            created_at: transaction.created_at,
            pack_name: transaction.pack_name,
            pack_path: transaction.pack_path,
            pack_sha256: transaction.pack_sha256,
            plan_hash: transaction.plan_hash,
            changed_paths: transaction
                .files
                .iter()
                .map(|item| item.target_path.clone())
                .collect(),
            applied_count: if transaction.applied_count == 0 {
                transaction.files.len()
            } else {
                transaction.applied_count
            },
            skipped_count: transaction.skipped_count,
            can_rollback: transaction.rolled_back_at.is_none(),
            rolled_back_at: transaction.rolled_back_at,
        });
    }
    transactions.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| right.transaction_id.cmp(&left.transaction_id))
    });
    transactions.truncate(MAX_TRANSACTION_HISTORY);
    Ok(ConfigPackTransactionHistory {
        transactions,
        issues,
    })
}

pub fn rollback_config_pack_import(transaction_id: &str) -> Result<ConfigPackRollbackResult> {
    let paths = ensure_default_configs()?;
    rollback_config_pack_import_with_paths(&paths, transaction_id)
}

pub fn rollback_config_pack_import_with_paths(
    paths: &ConfigPaths,
    transaction_id: &str,
) -> Result<ConfigPackRollbackResult> {
    validate_transaction_id(transaction_id)?;
    let dir = transaction_dir(paths, transaction_id);
    let manifest_path = dir.join("transaction.json");
    let mut transaction: ConfigPackTransaction =
        serde_json::from_slice(&fs::read(&manifest_path).with_context(|| {
            format!("failed to read transaction: {}", manifest_path.display())
        })?)?;
    if transaction.rolled_back_at.is_some() {
        bail!("transaction already rolled back: {transaction_id}");
    }
    let target_paths = transaction
        .files
        .iter()
        .map(|item| PathBuf::from(&item.target_path))
        .collect::<Vec<_>>();
    with_config_file_locks(target_paths.clone(), || {
        for item in &transaction.files {
            let Some(expected_sha256) = &item.applied_sha256 else {
                continue;
            };
            let target = PathBuf::from(&item.target_path);
            let matches_applied_state = target
                .exists()
                .then(|| fs::read(&target).map(|bytes| sha256(&bytes)))
                .transpose()?
                .as_ref()
                == Some(expected_sha256);
            if !matches_applied_state {
                bail!(
                    "configuration changed after import; rollback refused for {}",
                    target.display()
                );
            }
        }
        let before_rollback = target_paths
            .iter()
            .map(|target| {
                let content = if target.exists() {
                    Some(fs::read(target).with_context(|| {
                        format!("failed to snapshot rollback target: {}", target.display())
                    })?)
                } else {
                    None
                };
                Ok((target.clone(), content))
            })
            .collect::<Result<Vec<_>>>()?;
        let restore_result = (|| -> Result<()> {
            for item in &transaction.files {
                let target = PathBuf::from(&item.target_path);
                match &item.backup_file {
                    Some(file) => {
                        let content = fs::read(dir.join(file))?;
                        write_config_text_atomic(&target, content)?;
                    }
                    None if !item.existed => {
                        if target.exists() {
                            fs::remove_file(&target)?;
                        }
                    }
                    None => bail!("transaction backup is incomplete: {}", target.display()),
                }
            }
            Ok(())
        })();
        if let Err(error) = restore_result {
            if let Err(recovery_error) = restore_originals(&before_rollback) {
                bail!(
                    "failed to roll back transaction ({error:#}); failed to restore pre-rollback state ({recovery_error:#})"
                );
            }
            return Err(error).context("failed to roll back transaction; current state restored");
        }
        Ok(())
    })?;
    transaction.rolled_back_at = Some(Utc::now().to_rfc3339());
    write_transaction_manifest(&dir, &transaction)?;
    Ok(ConfigPackRollbackResult {
        transaction_id: transaction_id.to_string(),
        restored_paths: transaction
            .files
            .iter()
            .map(|item| item.target_path.clone())
            .collect(),
    })
}

fn prepare_import(
    paths: &ConfigPaths,
    request: &ConfigPackImportRequest,
) -> Result<PreparedImport> {
    let archive = read_pack_archive(&request.pack_path)?;
    let pack_name = archive.manifest.name.clone();
    if archive.manifest.schema_version > CONFIG_PACK_SCHEMA_VERSION {
        bail!(
            "pack schema {} is newer than supported schema {}",
            archive.manifest.schema_version,
            CONFIG_PACK_SCHEMA_VERSION
        );
    }
    let current_config = load_config(&paths.projects)?;
    let current_workspace = load_workspace_config(&paths.workspace)?;
    let current_workspaces = load_all_project_workspaces(&paths.project_workspaces)?;
    let current_sources = list_config_sources(&current_workspaces)?;
    let mut operations = Vec::new();
    let mut issues = Vec::new();
    let mut required_mappings = Vec::new();
    let mut required_environment = BTreeSet::new();
    let mut writes = Vec::new();
    let mut state_paths = BTreeSet::new();
    let included_operation_ids = request
        .included_operation_ids
        .as_ref()
        .map(|values| normalized_selection(values));
    for module in archive.manifest.modules.iter().filter(|module| {
        !matches!(
            module.key.as_str(),
            "projects" | "workspaces" | "config_sources"
        )
    }) {
        issues.push(ConfigPackIssue {
            severity: "warning".to_string(),
            code: "unsupported_module".to_string(),
            module: module.key.clone(),
            path: module.file.clone(),
            message: format!("unsupported module will be skipped: {}", module.key),
        });
    }

    if let Some(module) = archive.projects {
        validate_module_schema("projects", module.schema_version)?;
        let mut next_config = current_config.clone();
        let mut project_module_changed = false;
        let defaults_id = operation_id("projects", "defaults");
        let defaults_action = if request.strategy == ConfigPackConflictStrategy::Skip {
            "skip"
        } else {
            "merge"
        };
        let defaults_selected = operation_is_selected(&included_operation_ids, &defaults_id);
        operations.push(ConfigPackOperation {
            id: defaults_id,
            module: "projects".to_string(),
            key: "defaults".to_string(),
            action: defaults_action.to_string(),
            target: paths.projects.display().to_string(),
            summary: operation_summary("project defaults", "defaults", defaults_action),
            selected: defaults_selected,
        });
        if defaults_selected && defaults_action != "skip" {
            let mut defaults_value = serde_json::to_value(&module.defaults)?;
            resolve_import_value(
                &mut defaults_value,
                request,
                &current_config,
                &current_workspaces,
                &mut required_mappings,
                &mut required_environment,
                &mut issues,
                "projects.defaults",
            );
            let current_defaults_value = serde_json::to_value(&current_config.defaults)?;
            next_config.defaults =
                serde_json::from_value(deep_merge_json(current_defaults_value, defaults_value))?;
            project_module_changed = true;
        }
        for project in module.projects {
            let key = project.key.clone();
            let id = operation_id("projects", &key);
            let selected = operation_is_selected(&included_operation_ids, &id);
            let existing_index = next_config
                .projects
                .iter()
                .position(|item| item.key == project.key);
            let action = conflict_action(existing_index.is_some(), request.strategy);
            if !selected || action == "skip" {
                operations.push(ConfigPackOperation {
                    id,
                    module: "projects".to_string(),
                    key: key.clone(),
                    action: action.to_string(),
                    target: paths.projects.display().to_string(),
                    summary: operation_summary("project", &key, action),
                    selected,
                });
                continue;
            }
            let mut value = serde_json::to_value(project)?;
            resolve_import_value(
                &mut value,
                request,
                &current_config,
                &current_workspaces,
                &mut required_mappings,
                &mut required_environment,
                &mut issues,
                &format!("projects.{key}"),
            );
            let incoming: ProjectConfig = match serde_json::from_value(value) {
                Ok(incoming) => incoming,
                Err(error) => {
                    issues.push(issue_error(
                        "invalid_project",
                        "projects",
                        &key,
                        error.to_string(),
                    ));
                    continue;
                }
            };
            match (existing_index, action) {
                (None, "add") => next_config.projects.push(incoming),
                (Some(index), "merge") => {
                    next_config.projects[index] = serde_json::from_value(deep_merge_json(
                        serde_json::to_value(&next_config.projects[index])?,
                        serde_json::to_value(incoming)?,
                    ))?;
                }
                (Some(index), "replace") => next_config.projects[index] = incoming,
                _ => {}
            }
            project_module_changed = true;
            operations.push(ConfigPackOperation {
                id,
                module: "projects".to_string(),
                key: key.clone(),
                action: action.to_string(),
                target: paths.projects.display().to_string(),
                summary: operation_summary("project", &key, action),
                selected,
            });
        }
        next_config
            .projects
            .sort_by(|left, right| left.key.cmp(&right.key));
        if project_module_changed {
            writes.push(PreparedWrite {
                path: paths.projects.clone(),
                content: toml::to_string_pretty(&next_config)?.into_bytes(),
            });
            state_paths.insert(paths.projects.clone());
        }
    }

    if let Some(module) = archive.workspaces {
        validate_module_schema("workspaces", module.schema_version)?;
        if let Some(mut preferences) = module.preferences {
            let id = operation_id("preferences", "app");
            let action = if request.strategy == ConfigPackConflictStrategy::Skip {
                "skip"
            } else {
                "merge"
            };
            let selected = operation_is_selected(&included_operation_ids, &id);
            operations.push(ConfigPackOperation {
                id,
                module: "preferences".to_string(),
                key: "app".to_string(),
                action: action.to_string(),
                target: paths.workspace.display().to_string(),
                summary: operation_summary("preferences", "app", action),
                selected,
            });
            if selected && action != "skip" {
                let current_active = current_workspace.app.active_workspace.clone();
                preferences.active_workspace = current_active;
                let incoming = serde_json::to_value(preferences)?;
                let merged: WorkspaceAppConfig = serde_json::from_value(deep_merge_json(
                    serde_json::to_value(&current_workspace.app)?,
                    incoming,
                ))?;
                writes.push(PreparedWrite {
                    path: paths.workspace.clone(),
                    content: toml::to_string_pretty(&WorkspaceConfig { app: merged })?.into_bytes(),
                });
                state_paths.insert(paths.workspace.clone());
            }
        }
        for workspace in module.workspaces {
            let key = workspace.key.clone();
            let id = operation_id("workspaces", &key);
            let selected = operation_is_selected(&included_operation_ids, &id);
            let existing = current_workspaces.iter().find(|item| item.key == key);
            let action = conflict_action(existing.is_some(), request.strategy);
            if !selected || action == "skip" {
                operations.push(ConfigPackOperation {
                    id,
                    module: "workspaces".to_string(),
                    key: key.clone(),
                    action: action.to_string(),
                    target: paths.project_workspaces.display().to_string(),
                    summary: operation_summary("workspace", &key, action),
                    selected,
                });
                continue;
            }
            let mut value = serde_json::to_value(workspace)?;
            resolve_import_value(
                &mut value,
                request,
                &current_config,
                &current_workspaces,
                &mut required_mappings,
                &mut required_environment,
                &mut issues,
                &format!("workspaces.{key}"),
            );
            let mut incoming: ProjectWorkspaceConfig =
                match serde_json::from_value::<ProjectWorkspaceConfig>(value) {
                    Ok(workspace) => workspace,
                    Err(error) => {
                        issues.push(issue_error(
                            "invalid_workspace",
                            "workspaces",
                            &key,
                            error.to_string(),
                        ));
                        continue;
                    }
                };
            let Some(normalized_key) = normalize_project_workspace_key(&incoming.key) else {
                issues.push(issue_error(
                    "invalid_workspace_key",
                    "workspaces",
                    &key,
                    format!("workspace key is not safe for a configuration filename: {key}"),
                ));
                continue;
            };
            incoming.key = normalized_key;
            incoming = incoming.normalized();
            if incoming.is_system() {
                issues.push(issue_error(
                    "reserved_workspace",
                    "workspaces",
                    &key,
                    "the system workspace cannot be imported as a workspace module".to_string(),
                ));
                continue;
            }
            let existing = current_workspaces
                .iter()
                .find(|item| item.key == incoming.key);
            let action = conflict_action(existing.is_some(), request.strategy);
            let target = paths
                .project_workspaces
                .join(format!("{}.toml", incoming.key));
            let next = match (existing, action) {
                (Some(existing), "merge") => {
                    serde_json::from_value::<ProjectWorkspaceConfig>(deep_merge_json(
                        serde_json::to_value(existing)?,
                        serde_json::to_value(incoming)?,
                    ))?
                    .normalized()
                }
                (_, "add" | "replace") => incoming,
                _ => {
                    operations.push(ConfigPackOperation {
                        id,
                        module: "workspaces".to_string(),
                        key: key.clone(),
                        action: "skip".to_string(),
                        target: target.display().to_string(),
                        summary: operation_summary("workspace", &key, "skip"),
                        selected,
                    });
                    continue;
                }
            };
            operations.push(ConfigPackOperation {
                id,
                module: "workspaces".to_string(),
                key: key.clone(),
                action: action.to_string(),
                target: target.display().to_string(),
                summary: operation_summary("workspace", &key, action),
                selected,
            });
            writes.push(PreparedWrite {
                path: target.clone(),
                content: toml::to_string_pretty(&next)?.into_bytes(),
            });
            state_paths.insert(target);
        }
    }

    if let Some(module) = archive.sources {
        validate_module_schema("config_sources", module.schema_version)?;
        for source in module.sources {
            let target_id = request
                .config_source_mappings
                .get(&source.source_id)
                .map(String::as_str)
                .unwrap_or(&source.source_id);
            let target_source =
                resolve_config_source_from_sources(Some(target_id), &current_sources);
            let source_has_selected_files = source.files.keys().any(|file_key| {
                operation_is_selected(
                    &included_operation_ids,
                    &operation_id(
                        "config_sources",
                        &format!("{}.{}", source.source_id, file_key),
                    ),
                )
            });
            if let Err(error) = &target_source {
                if source_has_selected_files {
                    issues.push(issue_error(
                        "config_source_mapping_required",
                        "config_sources",
                        &source.source_id,
                        format!("target config source {target_id} is unavailable: {error}"),
                    ));
                }
            }
            for (file_key, mut incoming) in source.files {
                let key = format!("{}.{}", source.source_id, file_key);
                let id = operation_id("config_sources", &key);
                let selected = operation_is_selected(&included_operation_ids, &id);
                let Some(target_source) = target_source.as_ref().ok() else {
                    operations.push(ConfigPackOperation {
                        id,
                        module: "config_sources".to_string(),
                        key,
                        action: "skip".to_string(),
                        target: target_id.to_string(),
                        summary: operation_summary("config source file", &file_key, "skip"),
                        selected,
                    });
                    continue;
                };
                let Some(target) = config_source_file_path(target_source, &file_key) else {
                    operations.push(ConfigPackOperation {
                        id,
                        module: "config_sources".to_string(),
                        key,
                        action: "skip".to_string(),
                        target: target_id.to_string(),
                        summary: operation_summary("config source file", &file_key, "skip"),
                        selected,
                    });
                    if !selected {
                        continue;
                    }
                    issues.push(ConfigPackIssue {
                        severity: "warning".to_string(),
                        code: "unsupported_config_source_file".to_string(),
                        module: "config_sources".to_string(),
                        path: format!("{}.{}", source.source_id, file_key),
                        message: format!("target source does not support {file_key}"),
                    });
                    continue;
                };
                let exists = target.exists();
                let action = conflict_action(exists, request.strategy);
                operations.push(ConfigPackOperation {
                    id,
                    module: "config_sources".to_string(),
                    key,
                    action: action.to_string(),
                    target: target.display().to_string(),
                    summary: operation_summary("config source file", &file_key, action),
                    selected,
                });
                if !selected || action == "skip" {
                    continue;
                }
                resolve_import_value(
                    &mut incoming,
                    request,
                    &current_config,
                    &current_workspaces,
                    &mut required_mappings,
                    &mut required_environment,
                    &mut issues,
                    &format!("config_sources.{}.{}", source.source_id, file_key),
                );
                let next = if action == "merge" {
                    let current = read_toml_json(&target)?;
                    deep_merge_json(current, incoming)
                } else {
                    incoming
                };
                let toml_value: toml::Value = serde_json::from_value(next).with_context(|| {
                    format!("failed to prepare config source file: {}", target.display())
                })?;
                writes.push(PreparedWrite {
                    path: target.clone(),
                    content: toml::to_string_pretty(&toml_value)?.into_bytes(),
                });
                state_paths.insert(target);
            }
        }
    }

    if let Some(included) = &included_operation_ids {
        let known = operations
            .iter()
            .map(|operation| operation.id.as_str())
            .collect::<BTreeSet<_>>();
        for unknown in included
            .iter()
            .filter(|operation_id| !known.contains(operation_id.as_str()))
        {
            issues.push(issue_error(
                "unknown_operation_selection",
                "import",
                unknown,
                format!("selected import operation is unavailable: {unknown}"),
            ));
        }
    }
    dedupe_required_mappings(&mut required_mappings);
    if request.require_secrets {
        for environment in &required_environment {
            if std::env::var_os(environment).is_none() {
                issues.push(issue_error(
                    "missing_environment_secret",
                    "security",
                    environment,
                    format!("required environment variable is not set: {environment}"),
                ));
            }
        }
    }
    writes.sort_by(|left, right| left.path.cmp(&right.path));
    let duplicate_targets = writes
        .windows(2)
        .filter(|items| items[0].path == items[1].path)
        .map(|items| items[0].path.clone())
        .collect::<BTreeSet<_>>();
    for target in duplicate_targets {
        issues.push(issue_error(
            "duplicate_target",
            "import",
            &target.display().to_string(),
            "multiple pack entries resolve to the same target; update source mappings".to_string(),
        ));
    }
    writes.dedup_by(|left, right| left.path == right.path);
    let destination_state_sha256 = destination_state_hash(&state_paths)?;
    let created_at = Utc::now();
    let expires_at = created_at + Duration::hours(PLAN_TTL_HOURS);
    let write_fingerprints = writes
        .iter()
        .map(|write| {
            serde_json::json!({
                "path": write.path.display().to_string(),
                "sha256": sha256(&write.content),
            })
        })
        .collect::<Vec<_>>();
    let plan_seed = serde_json::to_vec(&serde_json::json!({
        "packSha256": archive.sha256,
        "destinationStateSha256": destination_state_sha256,
        "request": request,
        "operations": operations,
        "issues": issues,
        "requiredMappings": required_mappings,
        "requiredEnvironment": required_environment,
        "writeFingerprints": write_fingerprints,
    }))?;
    let plan_hash = format!("rdtpack-{}", sha256(&plan_seed));
    let blocker_count = issues
        .iter()
        .filter(|issue| issue.severity == "error")
        .count();
    let change_count = operations
        .iter()
        .filter(|item| item.selected && item.action != "skip")
        .count();
    let skip_count = operations
        .iter()
        .filter(|item| item.selected && item.action == "skip")
        .count();
    let excluded_count = operations.iter().filter(|item| !item.selected).count();
    Ok(PreparedImport {
        plan: ConfigPackImportPlan {
            plan_hash,
            created_at: created_at.to_rfc3339(),
            expires_at: expires_at.to_rfc3339(),
            pack_name,
            pack_path: request.pack_path.display().to_string(),
            pack_sha256: archive.sha256,
            strategy: request.strategy,
            operations,
            issues,
            required_mappings,
            required_environment: required_environment.into_iter().collect(),
            blocker_count,
            change_count,
            skip_count,
            excluded_count,
        },
        destination_state_sha256,
        writes,
    })
}

fn export_config_source(
    source: &ConfigSource,
    home: Option<&Path>,
    security: &mut ExportSecurityState,
) -> Result<ConfigPackSource> {
    let mut files = BTreeMap::new();
    for (key, path) in [
        ("navigation", Some(source.files.navigation.as_str())),
        ("actions", Some(source.files.actions.as_str())),
        ("links", Some(source.files.links.as_str())),
        ("proxy", source.files.proxy.as_deref()),
        (
            "runtime_overrides",
            source.files.runtime_overrides.as_deref(),
        ),
    ] {
        let Some(path) = path.map(PathBuf::from) else {
            continue;
        };
        if !path.exists() {
            continue;
        }
        let content = fs::read_to_string(&path)
            .with_context(|| format!("failed to read config source file: {}", path.display()))?;
        let toml_value: toml::Value = toml::from_str(&content)
            .with_context(|| format!("failed to parse config source file: {}", path.display()))?;
        let mut value = serde_json::to_value(toml_value)?;
        sanitize_json_value(
            &mut value,
            &format!("config_sources.{}.{}", source.id, key),
            security,
        );
        portable_json_paths(&mut value, &[], home, security, "");
        files.insert(key.to_string(), value);
    }
    Ok(ConfigPackSource {
        source_id: source.id.clone(),
        source_name: source.name.clone(),
        capabilities: source.capabilities.clone(),
        files,
    })
}

fn portable_typed_value<T>(
    value: T,
    roots: &[(PathBuf, String)],
    home: Option<&Path>,
    module: &str,
    security: &mut ExportSecurityState,
) -> Result<T>
where
    T: Serialize + for<'de> Deserialize<'de>,
{
    let mut json = serde_json::to_value(value)?;
    sanitize_json_value(&mut json, module, security);
    portable_json_paths(&mut json, roots, home, security, "");
    Ok(serde_json::from_value(json)?)
}

fn sanitize_defaults(defaults: &mut Defaults, security: &mut ExportSecurityState) {
    if defaults.jenkins_password.take().is_some() {
        security.sensitive_values_removed += 1;
        security
            .required_environment
            .insert(defaults.jenkins_password_env.clone());
    }
    for profile in defaults.jenkins_profiles.values_mut() {
        if profile.password.take().is_some() {
            security.sensitive_values_removed += 1;
            security
                .required_environment
                .insert(profile.password_env.clone());
        }
    }
    if defaults.gitlab_token.take().is_some() {
        security.sensitive_values_removed += 1;
        security
            .required_environment
            .insert(defaults.gitlab_token_env.clone());
    }
}

fn sanitize_json_value(value: &mut JsonValue, path: &str, security: &mut ExportSecurityState) {
    match value {
        JsonValue::Object(values) => {
            for (key, child) in values.iter_mut() {
                let child_path = format!("{path}.{key}");
                if is_sensitive_key(key, path) && !is_secret_reference(child) {
                    if !child.is_null() && child.as_str().is_none_or(|item| !item.is_empty()) {
                        let environment = secret_environment_name(key, path);
                        *child = JsonValue::String(format!("${{ENV:{environment}}}"));
                        security.sensitive_values_removed += 1;
                        security.required_environment.insert(environment);
                    }
                } else {
                    sanitize_json_value(child, &child_path, security);
                }
            }
        }
        JsonValue::Array(values) => {
            for (index, child) in values.iter_mut().enumerate() {
                sanitize_json_value(child, &format!("{path}[{index}]"), security);
            }
        }
        _ => {}
    }
}

fn is_sensitive_key(key: &str, path: &str) -> bool {
    let normalized = key.to_ascii_lowercase().replace('-', "_");
    if normalized.ends_with("_env") || normalized == "environment" {
        return false;
    }
    matches!(
        normalized.as_str(),
        "password"
            | "passwd"
            | "token"
            | "secret"
            | "api_key"
            | "apikey"
            | "authorization"
            | "proxy_authorization"
            | "private_key"
            | "client_secret"
            | "cookie"
            | "set_cookie"
    ) || normalized.ends_with("_password")
        || normalized.ends_with("_token")
        || normalized.ends_with("_secret")
        || normalized.ends_with("_api_key")
        || (normalized == "value" && path.contains("auth_helper"))
}

fn secret_environment_name(key: &str, path: &str) -> String {
    let seed = format!("{path}_{key}")
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect::<String>();
    let compact = seed
        .split('_')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("_");
    format!(
        "RDEVTOOL_PACK_{}",
        compact.chars().take(72).collect::<String>()
    )
}

fn is_secret_reference(value: &JsonValue) -> bool {
    value
        .as_str()
        .is_some_and(|value| value.starts_with("${ENV:") && value.ends_with('}'))
}

fn portable_json_paths(
    value: &mut JsonValue,
    roots: &[(PathBuf, String)],
    home: Option<&Path>,
    security: &mut ExportSecurityState,
    field: &str,
) {
    match value {
        JsonValue::Object(values) => {
            for (key, child) in values.iter_mut() {
                portable_json_paths(child, roots, home, security, key);
            }
        }
        JsonValue::Array(values) => {
            for child in values {
                portable_json_paths(child, roots, home, security, field);
            }
        }
        JsonValue::String(text) if is_path_field(field) => {
            let path = Path::new(text);
            if !path.is_absolute() {
                return;
            }
            let mut candidates = roots.to_vec();
            candidates.sort_by(|left, right| {
                right
                    .0
                    .components()
                    .count()
                    .cmp(&left.0.components().count())
            });
            for (root, placeholder) in candidates {
                if let Ok(relative) = path.strip_prefix(&root) {
                    *text = join_placeholder_path(&placeholder, relative);
                    security.portable_path_count += 1;
                    return;
                }
            }
            if let Some(home) = home {
                if let Ok(relative) = path.strip_prefix(home) {
                    *text = join_placeholder_path("${HOME}", relative);
                    security.portable_path_count += 1;
                }
            }
        }
        _ => {}
    }
}

fn is_path_field(field: &str) -> bool {
    matches!(
        field,
        "path"
            | "cwd"
            | "repo_path"
            | "root_dir"
            | "resource_dir"
            | "worklog_file"
            | "output_dir"
            | "browser_user_data_dir"
            | "web_actions_user_data_dir"
            | "password_fallback_file"
    ) || field.ends_with("_path")
        || field.ends_with("_dir")
}

fn join_placeholder_path(placeholder: &str, relative: &Path) -> String {
    if relative.as_os_str().is_empty() {
        placeholder.to_string()
    } else {
        format!(
            "{placeholder}/{}",
            relative.to_string_lossy().replace('\\', "/")
        )
    }
}

#[allow(clippy::too_many_arguments)]
fn resolve_import_value(
    value: &mut JsonValue,
    request: &ConfigPackImportRequest,
    config: &AppConfig,
    workspaces: &[ProjectWorkspaceConfig],
    required_mappings: &mut Vec<ConfigPackRequiredMapping>,
    required_environment: &mut BTreeSet<String>,
    issues: &mut Vec<ConfigPackIssue>,
    path: &str,
) {
    match value {
        JsonValue::Object(values) => {
            for (key, child) in values.iter_mut() {
                resolve_import_value(
                    child,
                    request,
                    config,
                    workspaces,
                    required_mappings,
                    required_environment,
                    issues,
                    &format!("{path}.{key}"),
                );
            }
            values.retain(|_, child| !child.is_null());
        }
        JsonValue::Array(values) => {
            for (index, child) in values.iter_mut().enumerate() {
                resolve_import_value(
                    child,
                    request,
                    config,
                    workspaces,
                    required_mappings,
                    required_environment,
                    issues,
                    &format!("{path}[{index}]"),
                );
            }
        }
        JsonValue::String(text) => {
            if let Some(environment) = parse_placeholder(text, "ENV") {
                required_environment.insert(environment.key.clone());
                if let Some(value) = std::env::var_os(&environment.key) {
                    *text = value.to_string_lossy().to_string();
                } else {
                    *value = JsonValue::Null;
                    issues.push(ConfigPackIssue {
                        severity: if request.require_secrets { "error" } else { "warning" }
                            .to_string(),
                        code: "secret_omitted".to_string(),
                        module: "security".to_string(),
                        path: path.to_string(),
                        message: format!(
                            "sensitive value was omitted; set {} before importing or configure it afterward",
                            environment.key
                        ),
                    });
                }
                return;
            }
            for kind in ["PROJECT_ROOT", "WORKSPACE_ROOT"] {
                let Some(placeholder) = parse_placeholder(text, kind) else {
                    continue;
                };
                let mapping = if kind == "PROJECT_ROOT" {
                    request
                        .project_root_mappings
                        .get(&placeholder.key)
                        .cloned()
                        .or_else(|| {
                            config
                                .projects
                                .iter()
                                .find(|project| project.key == placeholder.key)
                                .and_then(|project| project.repo_path.as_ref())
                                .map(|path| path.display().to_string())
                        })
                } else {
                    request
                        .workspace_root_mappings
                        .get(&placeholder.key)
                        .cloned()
                        .or_else(|| {
                            workspaces
                                .iter()
                                .find(|workspace| workspace.key == placeholder.key)
                                .and_then(|workspace| workspace.root_dir.as_ref())
                                .map(|path| path.display().to_string())
                        })
                };
                match mapping {
                    Some(root) if !root.trim().is_empty() => {
                        *text = join_resolved_path(&root, &placeholder.suffix);
                    }
                    _ => {
                        let suggested_path = suggested_mapping_path(kind, &placeholder.key);
                        required_mappings.push(ConfigPackRequiredMapping {
                            kind: if kind == "PROJECT_ROOT" {
                                "project"
                            } else {
                                "workspace"
                            }
                            .to_string(),
                            key: placeholder.key.clone(),
                            placeholder: format!("${{{kind}:{}}}", placeholder.key),
                            suggested_path,
                        });
                        issues.push(issue_error(
                            "path_mapping_required",
                            if kind == "PROJECT_ROOT" {
                                "projects"
                            } else {
                                "workspaces"
                            },
                            path,
                            format!("path mapping is required for {}", placeholder.key),
                        ));
                    }
                }
                return;
            }
            if let Some(home) = text.strip_prefix("${HOME}") {
                match std::env::var_os("HOME") {
                    Some(root) => {
                        *text = join_resolved_path(&root.to_string_lossy(), home);
                    }
                    None => issues.push(issue_error(
                        "home_unavailable",
                        "paths",
                        path,
                        "HOME is unavailable on this machine".to_string(),
                    )),
                }
            }
        }
        _ => {}
    }
}

struct ParsedPlaceholder {
    key: String,
    suffix: String,
}

fn parse_placeholder(value: &str, kind: &str) -> Option<ParsedPlaceholder> {
    let prefix = format!("${{{kind}:");
    let remainder = value.strip_prefix(&prefix)?;
    let end = remainder.find('}')?;
    let key = remainder[..end].to_string();
    (!key.is_empty()).then(|| ParsedPlaceholder {
        key,
        suffix: remainder[end + 1..].to_string(),
    })
}

fn join_resolved_path(root: &str, suffix: &str) -> String {
    let suffix = suffix.trim_start_matches(['/', '\\']);
    if suffix.is_empty() {
        root.to_string()
    } else {
        Path::new(root).join(suffix).display().to_string()
    }
}

fn suggested_mapping_path(kind: &str, key: &str) -> String {
    let base = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("~"))
        .join("Documents");
    if kind == "PROJECT_ROOT" {
        base.join("Projects").join(key)
    } else {
        base.join("rdevtool-workspaces").join(key)
    }
    .display()
    .to_string()
}

fn deep_merge_json(current: JsonValue, incoming: JsonValue) -> JsonValue {
    match (current, incoming) {
        (current, JsonValue::Null) => current,
        (JsonValue::Object(mut current), JsonValue::Object(incoming)) => {
            for (key, value) in incoming {
                let merged = current
                    .remove(&key)
                    .map(|existing| deep_merge_json(existing, value.clone()))
                    .unwrap_or(value);
                current.insert(key, merged);
            }
            JsonValue::Object(current)
        }
        (JsonValue::Array(mut current), JsonValue::Array(incoming)) => {
            for value in incoming {
                if let Some(identity) = json_identity(&value) {
                    if let Some(index) = current
                        .iter()
                        .position(|candidate| json_identity(candidate).as_ref() == Some(&identity))
                    {
                        current[index] = deep_merge_json(current[index].clone(), value);
                    } else {
                        current.push(value);
                    }
                } else if !current.contains(&value) {
                    current.push(value);
                }
            }
            JsonValue::Array(current)
        }
        (_, incoming) => incoming,
    }
}

fn json_identity(value: &JsonValue) -> Option<(String, String)> {
    let object = value.as_object()?;
    for key in ["key", "id", "name", "title"] {
        if let Some(value) = object.get(key).and_then(JsonValue::as_str) {
            return Some((key.to_string(), value.to_string()));
        }
    }
    None
}

fn conflict_action(exists: bool, strategy: ConfigPackConflictStrategy) -> &'static str {
    if !exists {
        return "add";
    }
    match strategy {
        ConfigPackConflictStrategy::Add | ConfigPackConflictStrategy::Skip => "skip",
        ConfigPackConflictStrategy::Merge => "merge",
        ConfigPackConflictStrategy::Replace => "replace",
    }
}

fn operation_id(module: &str, key: &str) -> String {
    format!("{module}:{key}")
}

fn operation_is_selected(
    included_operation_ids: &Option<BTreeSet<String>>,
    operation_id: &str,
) -> bool {
    included_operation_ids
        .as_ref()
        .map(|included| included.contains(operation_id))
        .unwrap_or(true)
}

fn operation_summary(kind: &str, key: &str, action: &str) -> String {
    format!("{action} {kind} {key}")
}

fn issue_error(code: &str, module: &str, path: &str, message: String) -> ConfigPackIssue {
    ConfigPackIssue {
        severity: "error".to_string(),
        code: code.to_string(),
        module: module.to_string(),
        path: path.to_string(),
        message,
    }
}

fn dedupe_required_mappings(values: &mut Vec<ConfigPackRequiredMapping>) {
    values.sort_by(|left, right| {
        left.kind
            .cmp(&right.kind)
            .then_with(|| left.key.cmp(&right.key))
    });
    values.dedup_by(|left, right| left.kind == right.kind && left.key == right.key);
}

fn config_source_file_path(source: &ConfigSource, key: &str) -> Option<PathBuf> {
    match key {
        "navigation" => Some(PathBuf::from(&source.files.navigation)),
        "actions" => Some(PathBuf::from(&source.files.actions)),
        "links" => Some(PathBuf::from(&source.files.links)),
        "proxy" => source.files.proxy.as_deref().map(PathBuf::from),
        "runtime_overrides" => source.files.runtime_overrides.as_deref().map(PathBuf::from),
        _ => None,
    }
}

fn read_toml_json(path: &Path) -> Result<JsonValue> {
    if !path.exists() {
        return Ok(JsonValue::Object(JsonMap::new()));
    }
    let content = fs::read_to_string(path)?;
    let value: toml::Value = toml::from_str(&content)?;
    Ok(serde_json::to_value(value)?)
}

fn push_module_entry<T: Serialize>(
    entries: &mut Vec<(ConfigPackModuleManifest, Vec<u8>)>,
    key: &str,
    file: &str,
    item_count: usize,
    module: &T,
) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(module)?;
    if bytes.len() as u64 > MAX_ENTRY_SIZE_BYTES {
        bail!("configuration pack module exceeds size limit: {key}");
    }
    entries.push((
        ConfigPackModuleManifest {
            key: key.to_string(),
            schema_version: CONFIG_PACK_SCHEMA_VERSION,
            file: file.to_string(),
            item_count,
            sha256: sha256(&bytes),
        },
        bytes,
    ));
    Ok(())
}

fn write_pack_archive(
    path: &Path,
    manifest: &ConfigPackManifest,
    modules: &[(ConfigPackModuleManifest, Vec<u8>)],
) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let options = FileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);
    zip.start_file(MANIFEST_ENTRY, options)?;
    zip.write_all(&serde_json::to_vec_pretty(manifest)?)?;
    zip.start_file(README_ENTRY, options)?;
    zip.write_all(
        b"rDevTool configuration pack\n\nInspect and plan this pack before applying it. Sensitive values are never exported directly.\n",
    )?;
    for (module, bytes) in modules {
        zip.start_file(&module.file, options)?;
        zip.write_all(bytes)?;
    }
    let bytes = zip.finish()?.into_inner();
    if bytes.len() as u64 > MAX_PACK_SIZE_BYTES {
        bail!("configuration pack exceeds {} bytes", MAX_PACK_SIZE_BYTES);
    }
    write_config_text_atomic(path, bytes)
        .with_context(|| format!("failed to write configuration pack: {}", path.display()))
}

fn read_pack_archive(path: &Path) -> Result<PackArchiveData> {
    let metadata = fs::metadata(path)
        .with_context(|| format!("failed to inspect configuration pack: {}", path.display()))?;
    if metadata.len() > MAX_PACK_SIZE_BYTES {
        bail!("configuration pack exceeds {} bytes", MAX_PACK_SIZE_BYTES);
    }
    let raw = fs::read(path)?;
    let file = File::open(path)?;
    let mut zip = ZipArchive::new(file).context("invalid .rdtpack ZIP container")?;
    if zip.len() > MAX_ENTRY_COUNT {
        bail!("configuration pack contains too many entries");
    }
    let mut names = BTreeSet::new();
    for index in 0..zip.len() {
        let entry = zip.by_index(index)?;
        let name = entry.name().to_string();
        if !is_safe_archive_entry(&name) || !names.insert(name.clone()) {
            bail!("unsafe or duplicate pack entry: {name}");
        }
        if entry.size() > MAX_ENTRY_SIZE_BYTES {
            bail!("pack entry exceeds size limit: {name}");
        }
    }
    let manifest_bytes = read_zip_entry(&mut zip, MANIFEST_ENTRY)?;
    let manifest: ConfigPackManifest =
        serde_json::from_slice(&manifest_bytes).context("failed to parse pack manifest")?;
    if manifest.format != CONFIG_PACK_FORMAT {
        bail!("unsupported configuration pack format: {}", manifest.format);
    }
    if manifest.modules.len() > MAX_ENTRY_COUNT {
        bail!("configuration pack manifest contains too many modules");
    }
    validate_unique_values(
        "module key",
        manifest.modules.iter().map(|module| module.key.as_str()),
    )?;
    validate_unique_values(
        "module file",
        manifest.modules.iter().map(|module| module.file.as_str()),
    )?;
    let mut projects: Option<ConfigPackProjectsModule> = None;
    let mut workspaces: Option<ConfigPackWorkspacesModule> = None;
    let mut sources: Option<ConfigPackSourcesModule> = None;
    for module in &manifest.modules {
        if !is_safe_archive_entry(&module.file) {
            bail!("unsafe module path in manifest: {}", module.file);
        }
        let bytes = read_zip_entry(&mut zip, &module.file)?;
        if sha256(&bytes) != module.sha256 {
            bail!("module checksum mismatch: {}", module.key);
        }
        match module.key.as_str() {
            "projects" => {
                let parsed: ConfigPackProjectsModule = serde_json::from_slice(&bytes)?;
                validate_module_manifest(module, parsed.schema_version, parsed.projects.len())?;
                projects = Some(parsed);
            }
            "workspaces" => {
                let parsed: ConfigPackWorkspacesModule = serde_json::from_slice(&bytes)?;
                validate_module_manifest(
                    module,
                    parsed.schema_version,
                    parsed.workspaces.len() + usize::from(parsed.preferences.is_some()),
                )?;
                workspaces = Some(parsed);
            }
            "config_sources" => {
                let parsed: ConfigPackSourcesModule = serde_json::from_slice(&bytes)?;
                validate_module_manifest(module, parsed.schema_version, parsed.sources.len())?;
                sources = Some(parsed);
            }
            _ => {}
        }
    }
    if let Some(module) = &projects {
        validate_unique_values(
            "project key",
            module.projects.iter().map(|project| project.key.as_str()),
        )?;
    }
    if let Some(module) = &workspaces {
        validate_unique_values(
            "workspace key",
            module
                .workspaces
                .iter()
                .map(|workspace| workspace.key.as_str()),
        )?;
    }
    if let Some(module) = &sources {
        validate_unique_values(
            "config source id",
            module
                .sources
                .iter()
                .map(|source| source.source_id.as_str()),
        )?;
    }
    Ok(PackArchiveData {
        manifest,
        projects,
        workspaces,
        sources,
        sha256: sha256(&raw),
        size_bytes: metadata.len(),
    })
}

fn read_zip_entry(zip: &mut ZipArchive<File>, name: &str) -> Result<Vec<u8>> {
    let entry = zip
        .by_name(name)
        .with_context(|| format!("missing pack entry: {name}"))?;
    if entry.size() > MAX_ENTRY_SIZE_BYTES {
        bail!("pack entry exceeds size limit: {name}");
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry
        .take(MAX_ENTRY_SIZE_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_ENTRY_SIZE_BYTES {
        bail!("pack entry exceeds size limit: {name}");
    }
    Ok(bytes)
}

fn is_safe_archive_entry(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('/')
        && !name.starts_with('\\')
        && !name
            .split(['/', '\\'])
            .any(|part| part == ".." || part.is_empty())
}

fn normalized_selection(values: &[String]) -> BTreeSet<String> {
    values
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect()
}

fn validate_requested_keys<'a>(
    kind: &str,
    requested: &BTreeSet<String>,
    available: impl Iterator<Item = &'a str>,
) -> Result<()> {
    let available = available.collect::<BTreeSet<_>>();
    let missing = requested
        .iter()
        .filter(|key| !available.contains(key.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        bail!("unknown {kind} keys: {}", missing.join(", "));
    }
    Ok(())
}

fn validate_unique_values<'a>(kind: &str, values: impl Iterator<Item = &'a str>) -> Result<()> {
    let mut seen = BTreeSet::new();
    let duplicates = values
        .filter(|value| !seen.insert(*value))
        .map(str::to_string)
        .collect::<BTreeSet<_>>();
    if !duplicates.is_empty() {
        bail!(
            "configuration pack contains duplicate {kind}s: {}",
            duplicates.into_iter().collect::<Vec<_>>().join(", ")
        );
    }
    Ok(())
}

fn validate_module_schema(module: &str, version: u16) -> Result<()> {
    if version > CONFIG_PACK_SCHEMA_VERSION {
        bail!("unsupported {module} module schema: {version}");
    }
    Ok(())
}

fn validate_module_manifest(
    manifest: &ConfigPackModuleManifest,
    schema_version: u16,
    item_count: usize,
) -> Result<()> {
    if manifest.schema_version != schema_version {
        bail!("module schema mismatch: {}", manifest.key);
    }
    if manifest.item_count != item_count {
        bail!("module item count mismatch: {}", manifest.key);
    }
    Ok(())
}

fn destination_state_hash(paths: &BTreeSet<PathBuf>) -> Result<String> {
    let mut digest = Sha256::new();
    for path in paths {
        digest.update(path.display().to_string().as_bytes());
        digest.update([0]);
        if path.exists() {
            digest.update(fs::read(path)?);
        } else {
            digest.update(b"<missing>");
        }
        digest.update([0xff]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn plans_dir(paths: &ConfigPaths) -> PathBuf {
    paths.dir.join("config-pack-plans")
}

fn transactions_dir(paths: &ConfigPaths) -> PathBuf {
    paths.dir.join("config-pack-backups")
}

fn transaction_dir(paths: &ConfigPaths, transaction_id: &str) -> PathBuf {
    transactions_dir(paths).join(transaction_id)
}

fn persist_import_plan(
    paths: &ConfigPaths,
    request: &ConfigPackImportRequest,
    prepared: &PreparedImport,
) -> Result<()> {
    let dir = plans_dir(paths);
    fs::create_dir_all(&dir)?;
    let stored = StoredImportPlan {
        plan_hash: prepared.plan.plan_hash.clone(),
        created_at: prepared.plan.created_at.clone(),
        expires_at: prepared.plan.expires_at.clone(),
        request: request.clone(),
        pack_sha256: prepared.plan.pack_sha256.clone(),
        destination_state_sha256: prepared.destination_state_sha256.clone(),
    };
    write_config_text_atomic(
        &dir.join(format!("{}.json", prepared.plan.plan_hash)),
        serde_json::to_vec_pretty(&stored)?,
    )
}

fn load_stored_plan(paths: &ConfigPaths, plan_hash: &str) -> Result<StoredImportPlan> {
    validate_plan_hash(plan_hash)?;
    let path = plans_dir(paths).join(format!("{plan_hash}.json"));
    Ok(serde_json::from_slice(&fs::read(&path).with_context(
        || format!("import plan not found: {plan_hash}"),
    )?)?)
}

fn validate_plan_hash(value: &str) -> Result<()> {
    if value.starts_with("rdtpack-")
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        Ok(())
    } else {
        bail!("invalid import plan hash")
    }
}

fn validate_transaction_id(value: &str) -> Result<()> {
    if !value.is_empty()
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        Ok(())
    } else {
        bail!("invalid transaction id")
    }
}

fn write_transaction_manifest(dir: &Path, transaction: &ConfigPackTransaction) -> Result<()> {
    write_config_text_atomic(
        &dir.join("transaction.json"),
        serde_json::to_vec_pretty(transaction)?,
    )
}

fn restore_originals(originals: &[(PathBuf, Option<Vec<u8>>)]) -> Result<()> {
    for (path, content) in originals {
        match content {
            Some(content) => write_config_text_atomic(path, content)?,
            None if path.exists() => fs::remove_file(path)?,
            None => {}
        }
    }
    Ok(())
}

fn default_true() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{BranchRules, WorkspaceConfig, save_config, save_workspace_config};

    fn test_paths(name: &str) -> ConfigPaths {
        let dir =
            std::env::temp_dir().join(format!("rdevtool-config-pack-{name}-{}", Uuid::new_v4()));
        fs::create_dir_all(dir.join("workspaces")).unwrap();
        ConfigPaths {
            projects: dir.join("projects.toml"),
            workspace: dir.join("workspace.toml"),
            project_workspaces: dir.join("workspaces"),
            dir,
        }
    }

    fn defaults() -> Defaults {
        serde_json::from_value(serde_json::json!({
            "jenkins_base_url": "https://ci.example.test",
            "jenkins_username": "demo",
            "jenkins_password": "do-not-export",
            "jenkins_password_env": "JENKINS_PASSWORD",
            "gitlab_token": "do-not-export",
            "gitlab_token_env": "GITLAB_TOKEN",
            "branch_rules": BranchRules::default()
        }))
        .unwrap()
    }

    fn project(path: &Path) -> ProjectConfig {
        serde_json::from_value(serde_json::json!({
            "key": "demo",
            "name": "Demo",
            "repo_path": path,
            "git_url": "https://example.test/demo.git",
            "dev": {
                "command": "npm run dev",
                "cwd": path,
                "env": { "API_TOKEN": "do-not-export" }
            }
        }))
        .unwrap()
    }

    fn seed(paths: &ConfigPaths, repo_path: &Path) {
        save_config(
            &paths.projects,
            &AppConfig {
                defaults: defaults(),
                projects: vec![project(repo_path)],
            },
        )
        .unwrap();
        save_workspace_config(&paths.workspace, &WorkspaceConfig::default()).unwrap();
        let system = ProjectWorkspaceConfig::default();
        fs::write(
            paths.project_workspaces.join("system.toml"),
            toml::to_string_pretty(&system).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn exported_pack_is_portable_and_does_not_contain_secrets() {
        let paths = test_paths("export");
        let repo = paths.dir.join("repos/demo");
        seed(&paths, &repo);
        let output = paths.dir.join("demo.rdtpack");
        let result = export_config_pack_with_paths(
            &paths,
            ConfigPackExportRequest {
                output_path: output.clone(),
                name: Some("Demo pack".to_string()),
                include_projects: true,
                include_workspaces: false,
                include_preferences: false,
                include_config_sources: false,
                include_dependencies: true,
                project_keys: vec!["demo".to_string()],
                workspace_keys: Vec::new(),
                config_source_ids: Vec::new(),
            },
        )
        .unwrap();

        assert_eq!(result.manifest.security.sensitive_values_removed, 3);
        let bytes = fs::read(&output).unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("do-not-export"));
        let archive = read_pack_archive(&output).unwrap();
        let exported = &archive.projects.unwrap().projects[0];
        assert_eq!(
            exported.repo_path.as_deref(),
            Some(Path::new("${PROJECT_ROOT:demo}"))
        );
    }

    #[test]
    fn import_requires_mapping_then_applies_and_rolls_back() {
        let source = test_paths("source");
        seed(&source, &source.dir.join("repos/demo"));
        let pack = source.dir.join("demo.rdtpack");
        export_config_pack_with_paths(
            &source,
            ConfigPackExportRequest {
                output_path: pack.clone(),
                name: None,
                include_projects: true,
                include_workspaces: false,
                include_preferences: false,
                include_config_sources: false,
                include_dependencies: true,
                project_keys: Vec::new(),
                workspace_keys: Vec::new(),
                config_source_ids: Vec::new(),
            },
        )
        .unwrap();

        let target = test_paths("target");
        let mut target_defaults = defaults();
        target_defaults.jenkins_password = Some("target-only-password".to_string());
        target_defaults.gitlab_token = Some("target-only-token".to_string());
        save_config(
            &target.projects,
            &AppConfig {
                defaults: target_defaults,
                projects: Vec::new(),
            },
        )
        .unwrap();
        save_workspace_config(&target.workspace, &WorkspaceConfig::default()).unwrap();
        fs::write(
            target.project_workspaces.join("system.toml"),
            toml::to_string_pretty(&ProjectWorkspaceConfig::default()).unwrap(),
        )
        .unwrap();
        let request = ConfigPackImportRequest {
            pack_path: pack,
            strategy: ConfigPackConflictStrategy::Merge,
            project_root_mappings: BTreeMap::new(),
            workspace_root_mappings: BTreeMap::new(),
            config_source_mappings: BTreeMap::new(),
            require_secrets: false,
            included_operation_ids: None,
        };
        let blocked = plan_config_pack_import_with_paths(&target, request.clone()).unwrap();
        assert!(blocked.blocker_count > 0);
        assert_eq!(blocked.required_mappings[0].key, "demo");

        let mut mapped = request;
        mapped.project_root_mappings.insert(
            "demo".to_string(),
            target.dir.join("projects/demo").display().to_string(),
        );
        let plan = plan_config_pack_import_with_paths(&target, mapped).unwrap();
        assert_eq!(plan.blocker_count, 0);
        let applied = apply_config_pack_import_with_paths(&target, &plan.plan_hash).unwrap();
        let imported = load_config(&target.projects).unwrap();
        assert_eq!(imported.projects.len(), 1);
        assert_eq!(
            imported.defaults.jenkins_password.as_deref(),
            Some("target-only-password")
        );
        assert_eq!(
            imported.defaults.gitlab_token.as_deref(),
            Some("target-only-token")
        );
        assert!(!applied.transaction_id.contains("rdtpack-"));
        rollback_config_pack_import_with_paths(&target, &applied.transaction_id).unwrap();
        assert!(load_config(&target.projects).unwrap().projects.is_empty());
    }

    #[test]
    fn selective_import_excludes_operations_and_records_transaction_history() {
        let source = test_paths("selective-source");
        seed(&source, &source.dir.join("repos/demo"));
        let pack = source.dir.join("demo.rdtpack");
        export_config_pack_with_paths(
            &source,
            ConfigPackExportRequest {
                output_path: pack.clone(),
                name: Some("Selective baseline".to_string()),
                include_projects: true,
                include_workspaces: false,
                include_preferences: false,
                include_config_sources: false,
                include_dependencies: true,
                project_keys: Vec::new(),
                workspace_keys: Vec::new(),
                config_source_ids: Vec::new(),
            },
        )
        .unwrap();

        let target = test_paths("selective-target");
        let target_repo = target.dir.join("existing/demo");
        seed(&target, &target_repo);
        let plan = plan_config_pack_import_with_paths(
            &target,
            ConfigPackImportRequest {
                pack_path: pack,
                strategy: ConfigPackConflictStrategy::Merge,
                project_root_mappings: BTreeMap::new(),
                workspace_root_mappings: BTreeMap::new(),
                config_source_mappings: BTreeMap::new(),
                require_secrets: false,
                included_operation_ids: Some(vec!["projects:defaults".to_string()]),
            },
        )
        .unwrap();

        assert_eq!(plan.blocker_count, 0);
        assert_eq!(plan.change_count, 1);
        assert_eq!(plan.excluded_count, 1);
        assert!(
            plan.operations
                .iter()
                .any(|operation| operation.id == "projects:demo" && !operation.selected)
        );
        let applied = apply_config_pack_import_with_paths(&target, &plan.plan_hash).unwrap();
        assert_eq!(
            load_config(&target.projects).unwrap().projects[0]
                .repo_path
                .as_deref(),
            Some(target_repo.as_path())
        );

        let history = list_config_pack_import_transactions_with_paths(&target).unwrap();
        assert!(history.issues.is_empty());
        assert_eq!(history.transactions.len(), 1);
        assert_eq!(history.transactions[0].pack_name, "Selective baseline");
        assert!(history.transactions[0].can_rollback);
        rollback_config_pack_import_with_paths(&target, &applied.transaction_id).unwrap();
        let history = list_config_pack_import_transactions_with_paths(&target).unwrap();
        assert!(!history.transactions[0].can_rollback);
        assert!(history.transactions[0].rolled_back_at.is_some());
    }

    #[test]
    fn rollback_refuses_to_overwrite_changes_made_after_import() {
        let source = test_paths("rollback-drift-source");
        seed(&source, &source.dir.join("repos/demo"));
        let pack = source.dir.join("demo.rdtpack");
        export_config_pack_with_paths(
            &source,
            ConfigPackExportRequest {
                output_path: pack.clone(),
                name: None,
                include_projects: true,
                include_workspaces: false,
                include_preferences: false,
                include_config_sources: false,
                include_dependencies: true,
                project_keys: Vec::new(),
                workspace_keys: Vec::new(),
                config_source_ids: Vec::new(),
            },
        )
        .unwrap();

        let target = test_paths("rollback-drift-target");
        seed(&target, &target.dir.join("repos/demo"));
        let mut mappings = BTreeMap::new();
        mappings.insert(
            "demo".to_string(),
            target.dir.join("mapped/demo").display().to_string(),
        );
        let plan = plan_config_pack_import_with_paths(
            &target,
            ConfigPackImportRequest {
                pack_path: pack,
                strategy: ConfigPackConflictStrategy::Merge,
                project_root_mappings: mappings,
                workspace_root_mappings: BTreeMap::new(),
                config_source_mappings: BTreeMap::new(),
                require_secrets: false,
                included_operation_ids: None,
            },
        )
        .unwrap();
        let applied = apply_config_pack_import_with_paths(&target, &plan.plan_hash).unwrap();
        fs::write(
            &target.projects,
            format!(
                "{}\n# manual edit\n",
                fs::read_to_string(&target.projects).unwrap()
            ),
        )
        .unwrap();

        let error =
            rollback_config_pack_import_with_paths(&target, &applied.transaction_id).unwrap_err();
        assert!(
            error
                .to_string()
                .contains("configuration changed after import")
        );
    }

    #[test]
    fn deep_merge_keeps_existing_and_merges_identified_arrays() {
        let current = serde_json::json!({
            "items": [{"key": "a", "left": 1}, {"key": "b", "value": 2}],
            "keep": true
        });
        let incoming = serde_json::json!({
            "items": [{"key": "a", "right": 2}, {"key": "c", "value": 3}]
        });
        let merged = deep_merge_json(current, incoming);
        assert_eq!(merged["items"].as_array().unwrap().len(), 3);
        assert_eq!(merged["items"][0]["left"], 1);
        assert_eq!(merged["items"][0]["right"], 2);
        assert_eq!(merged["keep"], true);
    }

    #[test]
    fn export_rejects_missing_workspace_project_dependencies() {
        let paths = test_paths("missing-dependency");
        seed(&paths, &paths.dir.join("repos/demo"));
        let mut workspace = ProjectWorkspaceConfig::default();
        workspace.key = "feature-a".to_string();
        workspace.name = "Feature A".to_string();
        workspace.projects = vec!["missing-project".to_string()];
        fs::write(
            paths.project_workspaces.join("feature-a.toml"),
            toml::to_string_pretty(&workspace).unwrap(),
        )
        .unwrap();

        let error = export_config_pack_with_paths(
            &paths,
            ConfigPackExportRequest {
                output_path: paths.dir.join("invalid.rdtpack"),
                name: None,
                include_projects: true,
                include_workspaces: true,
                include_preferences: false,
                include_config_sources: false,
                include_dependencies: true,
                project_keys: Vec::new(),
                workspace_keys: vec!["feature-a".to_string()],
                config_source_ids: Vec::new(),
            },
        )
        .unwrap_err();

        assert!(error.to_string().contains("missing-project"));
    }

    #[test]
    fn import_blocks_workspace_keys_that_could_escape_the_config_directory() {
        let source = test_paths("unsafe-workspace-source");
        let mut workspace = ProjectWorkspaceConfig::default();
        workspace.key = "../outside".to_string();
        workspace.name = "Unsafe".to_string();
        let pack = source.dir.join("unsafe.rdtpack");
        let module = ConfigPackWorkspacesModule {
            schema_version: CONFIG_PACK_SCHEMA_VERSION,
            preferences: None,
            workspaces: vec![workspace],
        };
        let mut entries = Vec::new();
        push_module_entry(&mut entries, "workspaces", WORKSPACES_ENTRY, 1, &module).unwrap();
        let manifest = ConfigPackManifest {
            format: CONFIG_PACK_FORMAT.to_string(),
            schema_version: CONFIG_PACK_SCHEMA_VERSION,
            pack_id: Uuid::new_v4().to_string(),
            name: "Unsafe".to_string(),
            created_at: Utc::now().to_rfc3339(),
            producer: ConfigPackProducer {
                app: "test".to_string(),
                version: "1".to_string(),
                platform: std::env::consts::OS.to_string(),
            },
            modules: entries.iter().map(|(entry, _)| entry.clone()).collect(),
            security: ConfigPackSecuritySummary::default(),
        };
        write_pack_archive(&pack, &manifest, &entries).unwrap();

        let target = test_paths("unsafe-workspace-target");
        seed(&target, &target.dir.join("repos/demo"));
        let plan = plan_config_pack_import_with_paths(
            &target,
            ConfigPackImportRequest {
                pack_path: pack,
                strategy: ConfigPackConflictStrategy::Merge,
                project_root_mappings: BTreeMap::new(),
                workspace_root_mappings: BTreeMap::new(),
                config_source_mappings: BTreeMap::new(),
                require_secrets: false,
                included_operation_ids: None,
            },
        )
        .unwrap();

        assert_eq!(plan.blocker_count, 1);
        assert_eq!(plan.issues[0].code, "invalid_workspace_key");
        assert!(!target.dir.join("outside.toml").exists());
    }
}
