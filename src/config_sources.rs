use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};

use crate::config::{
    ConfigPaths, ProjectWorkspaceConfig, WorkspaceConfig, default_config_dir,
    load_project_workspace_by_key, load_project_workspaces, load_workspace_config,
    normalize_project_workspace_key, save_project_workspace_config, save_workspace_config,
};
use crate::config_store::{
    copy_config_file_atomic, register_internal_config_write, with_config_file_lock,
    write_config_text_atomic,
};
use crate::ui_profiles::{DEFAULT_RESOURCE_UI_PROFILE, ui_profile_exists};

const DEFAULT_SOURCE_ID: &str = "default";
const CONFIG_SOURCES_FILE: &str = "config_sources.toml";
const CONFIG_SOURCE_PREFERENCE_PREFIX: &str = "configSource.";

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSourcesFile {
    #[serde(default)]
    pub sources: Vec<ConfigSourceDefinition>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSourceDefinition {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub base_dir: Option<String>,
    #[serde(default)]
    pub files: ConfigSourceFileDefinition,
    #[serde(default)]
    pub ui_profile: Option<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSourceFileDefinition {
    #[serde(default)]
    pub navigation: Option<String>,
    #[serde(default)]
    pub links: Option<String>,
    #[serde(default)]
    pub proxy: Option<String>,
    #[serde(default)]
    pub runtime_overrides: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSource {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub base_dir: String,
    pub files: ConfigSourceFiles,
    pub ui_profile: String,
    pub capabilities: Vec<String>,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSourceFiles {
    pub navigation: String,
    pub links: String,
    pub proxy: Option<String>,
    pub runtime_overrides: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyConfigSourceRequest {
    pub source_id: String,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub base_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSourceReference {
    pub id: String,
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSourceFileState {
    pub supported: bool,
    pub exists: bool,
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSourceFileComparison {
    pub key: String,
    pub capability: String,
    pub left: ConfigSourceFileState,
    pub right: ConfigSourceFileState,
    pub size_equal: Option<bool>,
    pub content_equal: Option<bool>,
    pub equivalent: bool,
    pub status: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSourceComparisonSummary {
    pub total: usize,
    pub matching: usize,
    pub differing: usize,
    pub missing_left: usize,
    pub missing_right: usize,
    pub missing_both: usize,
    pub capability_mismatches: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSourceComparison {
    pub left: ConfigSourceReference,
    pub right: ConfigSourceReference,
    pub identical: bool,
    pub summary: ConfigSourceComparisonSummary,
    pub files: Vec<ConfigSourceFileComparison>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSourceCopyFileResult {
    pub key: String,
    pub capability: String,
    pub status: String,
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSourceCopyResult {
    pub source: ConfigSourceReference,
    pub target: ConfigSource,
    pub copied_count: usize,
    pub missing_count: usize,
    pub files: Vec<ConfigSourceCopyFileResult>,
}

#[derive(Clone, Copy)]
struct ConfigSourceFileSpec {
    key: &'static str,
    capability: &'static str,
    file_name: &'static str,
}

const CONFIG_SOURCE_FILE_SPECS: [ConfigSourceFileSpec; 4] = [
    ConfigSourceFileSpec {
        key: "navigation",
        capability: "resource",
        file_name: "navigation.toml",
    },
    ConfigSourceFileSpec {
        key: "links",
        capability: "link",
        file_name: "links.toml",
    },
    ConfigSourceFileSpec {
        key: "proxy",
        capability: "proxy",
        file_name: "proxy.toml",
    },
    ConfigSourceFileSpec {
        key: "runtimeOverrides",
        capability: "runtime",
        file_name: "runtime_overrides.toml",
    },
];

pub fn config_sources_file_path() -> PathBuf {
    default_config_dir().join(CONFIG_SOURCES_FILE)
}

pub fn list_config_sources(workspaces: &[ProjectWorkspaceConfig]) -> Result<Vec<ConfigSource>> {
    let mut sources = vec![default_config_source()];
    sources.extend(workspaces.iter().filter_map(workspace_config_source));
    sources.extend(load_custom_config_sources()?);
    dedupe_sources(sources)
}

pub fn config_source_id_for_workspace(workspace: &ProjectWorkspaceConfig) -> String {
    if workspace.is_system() {
        return DEFAULT_SOURCE_ID.to_string();
    }
    normalize_project_workspace_key(&workspace.key)
        .map(|workspace_key| format!("workspace-{workspace_key}"))
        .unwrap_or_else(|| DEFAULT_SOURCE_ID.to_string())
}

pub fn preferred_config_source_id_for_workspace(
    workspace: &ProjectWorkspaceConfig,
    capability: &str,
) -> String {
    let Some(key) = config_source_preference_key(capability) else {
        return config_source_id_for_workspace(workspace);
    };
    workspace
        .metadata
        .get(&key)
        .and_then(|value| normalize_source_id(value))
        .unwrap_or_else(|| config_source_id_for_workspace(workspace))
}

pub fn preferred_config_source_id_for_scope(
    workspace: &ProjectWorkspaceConfig,
    app_workspace: &WorkspaceConfig,
    capability: &str,
) -> String {
    if !workspace.is_system() {
        return preferred_config_source_id_for_workspace(workspace, capability);
    }
    let Some(key) = config_source_preference_key(capability) else {
        return DEFAULT_SOURCE_ID.to_string();
    };
    app_workspace
        .app
        .config_source_preferences
        .get(&key)
        .and_then(|value| normalize_source_id(value))
        .unwrap_or_else(|| DEFAULT_SOURCE_ID.to_string())
}

pub fn set_config_source_preference_for_workspace(
    workspace: &mut ProjectWorkspaceConfig,
    capability: &str,
    source_id: Option<&str>,
) -> Result<()> {
    let key =
        config_source_preference_key(capability).ok_or_else(|| anyhow!("配置源能力不能为空"))?;
    match source_id.and_then(normalize_source_id) {
        Some(source_id) if source_id != config_source_id_for_workspace(workspace) => {
            workspace.metadata.insert(key, source_id);
        }
        _ => {
            workspace.metadata.remove(&key);
        }
    }
    Ok(())
}

pub fn set_config_source_preference_for_scope(
    workspace: &mut ProjectWorkspaceConfig,
    app_workspace: &mut WorkspaceConfig,
    capability: &str,
    source_id: Option<&str>,
) -> Result<()> {
    if !workspace.is_system() {
        return set_config_source_preference_for_workspace(workspace, capability, source_id);
    }
    let key =
        config_source_preference_key(capability).ok_or_else(|| anyhow!("配置源能力不能为空"))?;
    match source_id.and_then(normalize_source_id) {
        Some(source_id) if source_id != DEFAULT_SOURCE_ID => {
            app_workspace
                .app
                .config_source_preferences
                .insert(key, source_id);
        }
        _ => {
            app_workspace.app.config_source_preferences.remove(&key);
        }
    }
    Ok(())
}

pub fn load_config_source_preference(
    paths: &ConfigPaths,
    workspace_key: &str,
    capability: &str,
) -> Result<String> {
    let workspace = load_project_workspace_by_key(&paths.project_workspaces, workspace_key)?;
    let app_workspace = load_workspace_config(&paths.workspace)?;
    Ok(preferred_config_source_id_for_scope(
        &workspace,
        &app_workspace,
        capability,
    ))
}

pub fn save_config_source_preference(
    paths: &ConfigPaths,
    workspace_key: &str,
    capability: &str,
    source_id: &str,
) -> Result<ConfigSource> {
    let workspaces = load_project_workspaces(&paths.project_workspaces)?;
    let source = resolve_config_source(Some(source_id), &workspaces)?;
    if !source
        .capabilities
        .iter()
        .any(|item| item.eq_ignore_ascii_case(capability))
    {
        return Err(anyhow!("配置源不支持 {}：{}", capability, source.name));
    }

    let workspace = load_project_workspace_by_key(&paths.project_workspaces, workspace_key)?;
    let target_path = if workspace.is_system() {
        paths.workspace.clone()
    } else {
        paths
            .project_workspaces
            .join(format!("{}.toml", workspace.key))
    };
    with_config_file_lock(&target_path, || {
        let mut workspace =
            load_project_workspace_by_key(&paths.project_workspaces, workspace_key)?;
        let mut app_workspace = load_workspace_config(&paths.workspace)?;
        set_config_source_preference_for_scope(
            &mut workspace,
            &mut app_workspace,
            capability,
            Some(&source.id),
        )?;
        if workspace.is_system() {
            save_workspace_config(&paths.workspace, &app_workspace)?;
        } else {
            save_project_workspace_config(&target_path, &workspace.normalized())?;
        }
        Ok(())
    })?;
    Ok(source)
}

pub fn get_custom_config_source_definition(
    source_id: &str,
) -> Result<Option<ConfigSourceDefinition>> {
    let Some(source_id) = normalize_source_id(source_id) else {
        return Ok(None);
    };
    Ok(load_custom_config_source_definitions()?
        .into_iter()
        .find(|definition| {
            normalize_source_id(&definition.id)
                .is_some_and(|candidate| source_ids_match(&candidate, &source_id))
        }))
}

pub fn save_custom_config_source(
    workspaces: &[ProjectWorkspaceConfig],
    definition: ConfigSourceDefinition,
) -> Result<ConfigSource> {
    let definition = normalize_custom_definition(definition)?;
    let id = definition.id.clone();

    if generated_source_ids(workspaces)
        .iter()
        .any(|candidate| source_ids_match(candidate, &id))
    {
        return Err(anyhow!("配置源 ID 与内置或工作区配置源冲突：{id}"));
    }

    let source =
        custom_config_source(definition.clone()).ok_or_else(|| anyhow!("无法生成配置源：{id}"))?;
    fs::create_dir_all(&source.base_dir)
        .with_context(|| format!("failed to create config source dir: {}", source.base_dir))?;
    let registry_path = config_sources_file_path();
    with_config_file_lock(&registry_path, || {
        let mut definitions = load_custom_config_source_definitions()?;
        definitions.retain(|item| {
            normalize_source_id(&item.id).is_none_or(|candidate| !source_ids_match(&candidate, &id))
        });
        definitions.push(definition.clone());
        definitions.sort_by(|left, right| left.id.cmp(&right.id));
        save_custom_config_source_definitions(&definitions)
    })?;
    Ok(source)
}

pub fn delete_custom_config_source(
    workspaces: &[ProjectWorkspaceConfig],
    source_id: &str,
) -> Result<bool> {
    let source_id = normalize_source_id(source_id).ok_or_else(|| anyhow!("配置源 ID 不能为空"))?;
    if generated_source_ids(workspaces)
        .iter()
        .any(|candidate| source_ids_match(candidate, &source_id))
    {
        return Err(anyhow!("内置或工作区配置源不能删除：{source_id}"));
    }

    let registry_path = config_sources_file_path();
    with_config_file_lock(&registry_path, || {
        let mut definitions = load_custom_config_source_definitions()?;
        let before = definitions.len();
        definitions.retain(|item| {
            normalize_source_id(&item.id)
                .is_none_or(|candidate| !source_ids_match(&candidate, &source_id))
        });
        if definitions.len() == before {
            return Ok(false);
        }
        save_custom_config_source_definitions(&definitions)?;
        Ok(true)
    })
}

pub fn resolve_config_source(
    source_id: Option<&str>,
    workspaces: &[ProjectWorkspaceConfig],
) -> Result<ConfigSource> {
    let requested = source_id
        .and_then(normalize_source_id)
        .unwrap_or_else(|| DEFAULT_SOURCE_ID.to_string());
    if requested == DEFAULT_SOURCE_ID || requested == "global" {
        return Ok(default_config_source());
    }
    let dashed_requested = requested.replace('_', "-");
    if let Some(source) = workspaces
        .iter()
        .filter_map(workspace_config_source)
        .find(|source| source.id == requested || source.id.replace('_', "-") == dashed_requested)
    {
        return Ok(source);
    }
    load_custom_config_sources()?
        .into_iter()
        .find(|source| source.id == requested || source.id.replace('_', "-") == dashed_requested)
        .ok_or_else(|| anyhow!("config source not found: {requested}"))
}

pub fn compare_config_sources(
    workspaces: &[ProjectWorkspaceConfig],
    left_source_id: &str,
    right_source_id: &str,
) -> Result<ConfigSourceComparison> {
    let left = resolve_config_source(Some(left_source_id), workspaces)?;
    let right = resolve_config_source(Some(right_source_id), workspaces)?;
    compare_resolved_config_sources(&left, &right)
}

pub fn copy_config_source(
    workspaces: &[ProjectWorkspaceConfig],
    request: CopyConfigSourceRequest,
) -> Result<ConfigSourceCopyResult> {
    let source = resolve_config_source(Some(&request.source_id), workspaces)?;
    copy_resolved_config_source(workspaces, &source, request, &config_sources_file_path())
}

fn compare_resolved_config_sources(
    left: &ConfigSource,
    right: &ConfigSource,
) -> Result<ConfigSourceComparison> {
    let mut files = Vec::with_capacity(CONFIG_SOURCE_FILE_SPECS.len());
    for spec in CONFIG_SOURCE_FILE_SPECS {
        files.push(compare_config_source_file(left, right, spec)?);
    }

    let summary = ConfigSourceComparisonSummary {
        total: files.len(),
        matching: files.iter().filter(|file| file.equivalent).count(),
        differing: files.iter().filter(|file| !file.equivalent).count(),
        missing_left: files
            .iter()
            .filter(|file| {
                file.left.supported
                    && file.right.supported
                    && !file.left.exists
                    && file.right.exists
            })
            .count(),
        missing_right: files
            .iter()
            .filter(|file| {
                file.left.supported
                    && file.right.supported
                    && !file.right.exists
                    && file.left.exists
            })
            .count(),
        missing_both: files
            .iter()
            .filter(|file| {
                file.left.supported
                    && file.right.supported
                    && !file.left.exists
                    && !file.right.exists
            })
            .count(),
        capability_mismatches: files
            .iter()
            .filter(|file| file.left.supported != file.right.supported)
            .count(),
    };

    Ok(ConfigSourceComparison {
        left: config_source_reference(left),
        right: config_source_reference(right),
        identical: summary.differing == 0,
        summary,
        files,
    })
}

fn compare_config_source_file(
    left_source: &ConfigSource,
    right_source: &ConfigSource,
    spec: ConfigSourceFileSpec,
) -> Result<ConfigSourceFileComparison> {
    let left_path = config_source_file_path(left_source, spec);
    let right_path = config_source_file_path(right_source, spec);
    let left = inspect_config_source_file_state(
        left_path.as_deref(),
        config_source_supports(left_source, spec.capability),
    )?;
    let right = inspect_config_source_file_state(
        right_path.as_deref(),
        config_source_supports(right_source, spec.capability),
    )?;
    let comparable = left.supported && right.supported;
    let size_equal = match (comparable, left.size_bytes, right.size_bytes) {
        (true, Some(left), Some(right)) => Some(left == right),
        _ => None,
    };
    let content_equal = match (
        comparable,
        left.exists,
        right.exists,
        left_path.as_deref(),
        right_path.as_deref(),
    ) {
        (true, true, true, Some(left_path), Some(right_path)) => {
            Some(config_files_equal(left_path, right_path)?)
        }
        _ => None,
    };

    let (equivalent, status, summary) = if left.supported != right.supported {
        (false, "capabilityMismatch", "能力支持状态不一致")
    } else if !left.supported {
        (true, "unsupported", "两侧均未启用此能力")
    } else if !left.exists && !right.exists {
        (true, "missingBoth", "两侧配置文件均不存在")
    } else if !left.exists {
        (false, "missingLeft", "左侧配置文件不存在")
    } else if !right.exists {
        (false, "missingRight", "右侧配置文件不存在")
    } else if content_equal == Some(true) {
        (true, "equal", "文件内容一致")
    } else {
        (false, "different", "文件内容不同")
    };

    Ok(ConfigSourceFileComparison {
        key: spec.key.to_string(),
        capability: spec.capability.to_string(),
        left,
        right,
        size_equal,
        content_equal,
        equivalent,
        status: status.to_string(),
        summary: summary.to_string(),
    })
}

fn inspect_config_source_file_state(
    path: Option<&Path>,
    supported: bool,
) -> Result<ConfigSourceFileState> {
    let Some(path) = path else {
        return Ok(ConfigSourceFileState {
            supported,
            exists: false,
            size_bytes: None,
        });
    };
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ConfigSourceFileState {
                supported,
                exists: false,
                size_bytes: None,
            });
        }
        Err(error) => {
            return Err(error)
                .with_context(|| format!("failed to inspect config: {}", path.display()));
        }
    };
    if !metadata.is_file() {
        return Err(anyhow!(
            "config source path is not a file: {}",
            path.display()
        ));
    }
    Ok(ConfigSourceFileState {
        supported,
        exists: true,
        size_bytes: Some(metadata.len()),
    })
}

fn config_files_equal(left: &Path, right: &Path) -> Result<bool> {
    let mut left = BufReader::new(
        fs::File::open(left)
            .with_context(|| format!("failed to read config: {}", left.display()))?,
    );
    let mut right = BufReader::new(
        fs::File::open(right)
            .with_context(|| format!("failed to read config: {}", right.display()))?,
    );
    let mut left_buffer = [0_u8; 8192];
    let mut right_buffer = [0_u8; 8192];
    loop {
        let left_read = left.read(&mut left_buffer)?;
        let right_read = right.read(&mut right_buffer)?;
        if left_read != right_read || left_buffer[..left_read] != right_buffer[..right_read] {
            return Ok(false);
        }
        if left_read == 0 {
            return Ok(true);
        }
    }
}

fn copy_resolved_config_source(
    workspaces: &[ProjectWorkspaceConfig],
    source: &ConfigSource,
    request: CopyConfigSourceRequest,
    registry_path: &Path,
) -> Result<ConfigSourceCopyResult> {
    let requested_id =
        normalize_source_id(&request.id).ok_or_else(|| anyhow!("配置源 ID 不能为空"))?;
    let target_base_dir = match request.base_dir.as_deref() {
        Some(value) => {
            PathBuf::from(normalize_text(value).ok_or_else(|| anyhow!("配置源目录不能为空"))?)
        }
        None => default_config_dir().join("sources").join(&requested_id),
    };
    let target_files = ConfigSourceFileDefinition {
        navigation: config_source_supports(source, "resource")
            .then(|| "navigation.toml".to_string()),
        links: config_source_supports(source, "link").then(|| "links.toml".to_string()),
        proxy: config_source_supports(source, "proxy").then(|| "proxy.toml".to_string()),
        runtime_overrides: config_source_supports(source, "runtime")
            .then(|| "runtime_overrides.toml".to_string()),
    };
    let definition = normalize_custom_definition(ConfigSourceDefinition {
        id: request.id,
        name: request.name,
        kind: Some("custom".to_string()),
        base_dir: Some(display_path(&target_base_dir)),
        files: target_files,
        ui_profile: Some(source.ui_profile.clone()),
        capabilities: source.capabilities.clone(),
    })?;
    let target_base_dir = PathBuf::from(
        definition
            .base_dir
            .as_deref()
            .ok_or_else(|| anyhow!("配置源目录不能为空"))?,
    );
    let target = custom_config_source(definition.clone())
        .ok_or_else(|| anyhow!("无法生成配置源：{}", definition.id))?;
    if Path::new(&source.base_dir) == target_base_dir.as_path() {
        return Err(anyhow!("复制目标目录不能与来源目录相同"));
    }
    if generated_source_ids(workspaces)
        .iter()
        .any(|candidate| source_ids_match(candidate, &definition.id))
    {
        return Err(anyhow!(
            "配置源 ID 与内置或工作区配置源冲突：{}",
            definition.id
        ));
    }

    with_config_file_lock(registry_path, || {
        let mut definitions = load_custom_config_source_definitions_from(registry_path)?;
        if definitions.iter().any(|item| {
            normalize_source_id(&item.id)
                .is_some_and(|candidate| source_ids_match(&candidate, &definition.id))
        }) {
            return Err(anyhow!("配置源已存在：{}", definition.id));
        }
        validate_empty_copy_target(&target_base_dir)?;

        let target_parent = target_base_dir.parent().unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(target_parent).with_context(|| {
            format!(
                "failed to create config source parent: {}",
                target_parent.display()
            )
        })?;
        let staging_dir = target_parent.join(format!(
            ".{}.copy-{}",
            target_base_dir
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("config-source"),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir(&staging_dir).with_context(|| {
            format!(
                "failed to create copy staging dir: {}",
                staging_dir.display()
            )
        })?;

        let target_existed = target_base_dir.exists();
        let operation = (|| -> Result<ConfigSourceCopyResult> {
            let mut files = Vec::with_capacity(CONFIG_SOURCE_FILE_SPECS.len());
            for spec in CONFIG_SOURCE_FILE_SPECS {
                if !config_source_supports(source, spec.capability) {
                    files.push(ConfigSourceCopyFileResult {
                        key: spec.key.to_string(),
                        capability: spec.capability.to_string(),
                        status: "unsupported".to_string(),
                        size_bytes: None,
                    });
                    continue;
                }
                let source_path = config_source_file_path(source, spec);
                let Some(source_path) = source_path.filter(|path| path.exists()) else {
                    files.push(ConfigSourceCopyFileResult {
                        key: spec.key.to_string(),
                        capability: spec.capability.to_string(),
                        status: "missing".to_string(),
                        size_bytes: None,
                    });
                    continue;
                };
                if !source_path.is_file() {
                    return Err(anyhow!(
                        "config source path is not a file: {}",
                        source_path.display()
                    ));
                }
                let size =
                    copy_config_file_atomic(&source_path, &staging_dir.join(spec.file_name))?;
                files.push(ConfigSourceCopyFileResult {
                    key: spec.key.to_string(),
                    capability: spec.capability.to_string(),
                    status: "copied".to_string(),
                    size_bytes: Some(size),
                });
            }

            if target_existed {
                validate_empty_copy_target(&target_base_dir)?;
                fs::remove_dir(&target_base_dir).with_context(|| {
                    format!(
                        "failed to prepare empty copy target: {}",
                        target_base_dir.display()
                    )
                })?;
            }
            register_internal_config_write(&target_base_dir);
            fs::rename(&staging_dir, &target_base_dir).with_context(|| {
                format!(
                    "failed to activate copied config source: {}",
                    target_base_dir.display()
                )
            })?;

            definitions.push(definition.clone());
            definitions.sort_by(|left, right| left.id.cmp(&right.id));
            save_custom_config_source_definitions_to(registry_path, &definitions)?;

            let copied_count = files.iter().filter(|file| file.status == "copied").count();
            let missing_count = files.iter().filter(|file| file.status == "missing").count();
            Ok(ConfigSourceCopyResult {
                source: config_source_reference(source),
                target: target.clone(),
                copied_count,
                missing_count,
                files,
            })
        })();

        if operation.is_err() {
            let _ = fs::remove_dir_all(&staging_dir);
            if target_base_dir.exists() {
                let _ = fs::remove_dir_all(&target_base_dir);
            }
            if target_existed {
                let _ = fs::create_dir_all(&target_base_dir);
            }
        }
        operation
    })
}

fn validate_empty_copy_target(path: &Path) -> Result<()> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(error)
                .with_context(|| format!("failed to inspect copy target: {}", path.display()));
        }
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(anyhow!("配置源目标必须是空目录：{}", path.display()));
    }
    if fs::read_dir(path)
        .with_context(|| format!("failed to inspect copy target: {}", path.display()))?
        .next()
        .is_some()
    {
        return Err(anyhow!("配置源目标目录非空：{}", path.display()));
    }
    Ok(())
}

fn config_source_reference(source: &ConfigSource) -> ConfigSourceReference {
    ConfigSourceReference {
        id: source.id.clone(),
        name: source.name.clone(),
        kind: source.kind.clone(),
    }
}

fn config_source_supports(source: &ConfigSource, capability: &str) -> bool {
    source
        .capabilities
        .iter()
        .any(|item| item.eq_ignore_ascii_case(capability))
}

fn config_source_file_path(source: &ConfigSource, spec: ConfigSourceFileSpec) -> Option<PathBuf> {
    match spec.key {
        "navigation" => Some(PathBuf::from(&source.files.navigation)),
        "links" => Some(PathBuf::from(&source.files.links)),
        "proxy" => source.files.proxy.as_deref().map(PathBuf::from),
        "runtimeOverrides" => source.files.runtime_overrides.as_deref().map(PathBuf::from),
        _ => None,
    }
}

pub fn ensure_parent_dir(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create config source dir: {}", parent.display()))?;
    }
    Ok(())
}

fn default_config_source() -> ConfigSource {
    let base_dir = default_config_dir();
    ConfigSource {
        id: DEFAULT_SOURCE_ID.to_string(),
        name: "默认配置".to_string(),
        kind: "default".to_string(),
        base_dir: display_path(&base_dir),
        files: ConfigSourceFiles {
            navigation: display_path(&base_dir.join("navigation.toml")),
            links: display_path(&base_dir.join("links.toml")),
            proxy: Some(display_path(&base_dir.join("proxy.toml"))),
            runtime_overrides: Some(display_path(&base_dir.join("runtime_overrides.toml"))),
        },
        ui_profile: DEFAULT_RESOURCE_UI_PROFILE.to_string(),
        capabilities: default_capabilities(),
        is_default: true,
    }
}

fn workspace_config_source(workspace: &ProjectWorkspaceConfig) -> Option<ConfigSource> {
    if workspace.is_system() {
        return None;
    }
    let workspace_key = normalize_project_workspace_key(&workspace.key)?;
    let source_id = config_source_id_for_workspace(workspace);
    let base_dir = default_config_dir()
        .join("sources")
        .join("workspaces")
        .join(&workspace_key);
    let ui_profile = workspace
        .metadata
        .get("uiProfile")
        .or_else(|| workspace.metadata.get("ui_profile"))
        .map(String::as_str)
        .and_then(normalize_text)
        .filter(|profile| ui_profile_exists(profile))
        .unwrap_or_else(|| DEFAULT_RESOURCE_UI_PROFILE.to_string());
    Some(ConfigSource {
        id: source_id,
        name: format!("{} 配置", workspace.name.trim()),
        kind: "workspace".to_string(),
        base_dir: display_path(&base_dir),
        files: ConfigSourceFiles {
            navigation: display_path(&base_dir.join("navigation.toml")),
            links: display_path(&base_dir.join("links.toml")),
            proxy: Some(display_path(&base_dir.join("proxy.toml"))),
            runtime_overrides: Some(display_path(&base_dir.join("runtime_overrides.toml"))),
        },
        ui_profile,
        capabilities: default_capabilities(),
        is_default: false,
    })
}

fn load_custom_config_source_definitions() -> Result<Vec<ConfigSourceDefinition>> {
    load_custom_config_source_definitions_from(&config_sources_file_path())
}

fn load_custom_config_source_definitions_from(path: &Path) -> Result<Vec<ConfigSourceDefinition>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path)
        .with_context(|| format!("failed to read config sources: {}", path.display()))?;
    let config: ConfigSourcesFile = toml::from_str(&content)
        .with_context(|| format!("failed to parse config sources: {}", path.display()))?;
    Ok(config.sources)
}

fn load_custom_config_sources() -> Result<Vec<ConfigSource>> {
    Ok(load_custom_config_source_definitions()?
        .into_iter()
        .filter_map(custom_config_source)
        .collect())
}

fn save_custom_config_source_definitions(definitions: &[ConfigSourceDefinition]) -> Result<()> {
    let path = config_sources_file_path();
    save_custom_config_source_definitions_to(&path, definitions)
}

fn save_custom_config_source_definitions_to(
    path: &Path,
    definitions: &[ConfigSourceDefinition],
) -> Result<()> {
    ensure_parent_dir(path)?;
    let content = toml::to_string_pretty(&ConfigSourcesFile {
        sources: definitions.to_vec(),
    })
    .with_context(|| format!("failed to serialize config sources: {}", path.display()))?;
    write_config_text_atomic(path, content)
        .with_context(|| format!("failed to write config sources: {}", path.display()))?;
    Ok(())
}

fn normalize_custom_definition(
    mut definition: ConfigSourceDefinition,
) -> Result<ConfigSourceDefinition> {
    let id = normalize_source_id(&definition.id).ok_or_else(|| anyhow!("配置源 ID 不能为空"))?;
    if id == DEFAULT_SOURCE_ID || id == "global" {
        return Err(anyhow!("配置源 ID 为保留值：{id}"));
    }
    let name = normalize_text(&definition.name).ok_or_else(|| anyhow!("配置源名称不能为空"))?;
    let base_dir = definition
        .base_dir
        .as_deref()
        .and_then(normalize_text)
        .map(PathBuf::from);
    if base_dir.as_ref().is_some_and(|path| !path.is_absolute()) {
        return Err(anyhow!("配置源目录必须使用绝对路径"));
    }

    definition.id = id;
    definition.name = name;
    definition.kind = Some("custom".to_string());
    definition.base_dir = base_dir.map(|path| display_path(&path));
    let ui_profile = definition
        .ui_profile
        .as_deref()
        .and_then(normalize_text)
        .unwrap_or_else(|| DEFAULT_RESOURCE_UI_PROFILE.to_string());
    if !ui_profile_exists(&ui_profile) {
        return Err(anyhow!("不支持的界面配置：{ui_profile}"));
    }
    definition.ui_profile = Some(ui_profile);
    definition.capabilities = normalize_capabilities(definition.capabilities);
    definition.files = normalize_file_definition(definition.files);
    Ok(definition)
}

fn normalize_file_definition(files: ConfigSourceFileDefinition) -> ConfigSourceFileDefinition {
    ConfigSourceFileDefinition {
        navigation: files.navigation.as_deref().and_then(normalize_text),
        links: files.links.as_deref().and_then(normalize_text),
        proxy: files.proxy.as_deref().and_then(normalize_text),
        runtime_overrides: files.runtime_overrides.as_deref().and_then(normalize_text),
    }
}

fn config_source_preference_key(capability: &str) -> Option<String> {
    normalize_source_id(capability)
        .map(|capability| format!("{CONFIG_SOURCE_PREFERENCE_PREFIX}{capability}"))
}

fn generated_source_ids(workspaces: &[ProjectWorkspaceConfig]) -> BTreeSet<String> {
    let mut ids = BTreeSet::from([DEFAULT_SOURCE_ID.to_string(), "global".to_string()]);
    ids.extend(
        workspaces
            .iter()
            .filter_map(workspace_config_source)
            .map(|source| source.id),
    );
    ids
}

fn source_ids_match(left: &str, right: &str) -> bool {
    left == right || left.replace('_', "-") == right.replace('_', "-")
}

fn custom_config_source(definition: ConfigSourceDefinition) -> Option<ConfigSource> {
    let id = normalize_source_id(&definition.id)?;
    if id == DEFAULT_SOURCE_ID || id == "global" {
        return None;
    }
    let name = normalize_text(&definition.name).unwrap_or_else(|| id.clone());
    let base_dir = definition
        .base_dir
        .as_deref()
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .unwrap_or_else(|| default_config_dir().join("sources").join(&id));
    let kind = definition
        .kind
        .as_deref()
        .and_then(normalize_text)
        .unwrap_or_else(|| "custom".to_string());
    let ui_profile = definition
        .ui_profile
        .as_deref()
        .and_then(normalize_text)
        .filter(|profile| ui_profile_exists(profile))
        .unwrap_or_else(|| DEFAULT_RESOURCE_UI_PROFILE.to_string());
    let capabilities = normalize_capabilities(definition.capabilities);
    Some(ConfigSource {
        id,
        name,
        kind,
        base_dir: display_path(&base_dir),
        files: ConfigSourceFiles {
            navigation: display_path(&resolve_source_file(
                &base_dir,
                definition.files.navigation.as_deref(),
                "navigation.toml",
            )),
            links: display_path(&resolve_source_file(
                &base_dir,
                definition.files.links.as_deref(),
                "links.toml",
            )),
            proxy: Some(display_path(&resolve_source_file(
                &base_dir,
                definition.files.proxy.as_deref(),
                "proxy.toml",
            ))),
            runtime_overrides: Some(display_path(&resolve_source_file(
                &base_dir,
                definition.files.runtime_overrides.as_deref(),
                "runtime_overrides.toml",
            ))),
        },
        ui_profile,
        capabilities,
        is_default: false,
    })
}

fn resolve_source_file(base_dir: &Path, value: Option<&str>, fallback: &str) -> PathBuf {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return base_dir.join(fallback);
    };
    let path = PathBuf::from(value);
    if path.is_absolute() {
        path
    } else {
        base_dir.join(path)
    }
}

fn dedupe_sources(sources: Vec<ConfigSource>) -> Result<Vec<ConfigSource>> {
    let mut seen = std::collections::BTreeSet::new();
    let mut result = Vec::new();
    for source in sources {
        if !seen.insert(source.id.clone()) {
            continue;
        }
        result.push(source);
    }
    Ok(result)
}

fn normalize_capabilities(values: Vec<String>) -> Vec<String> {
    let mut result = values
        .into_iter()
        .filter_map(|value| normalize_text(&value))
        .collect::<Vec<_>>();
    if result.is_empty() {
        result = default_capabilities();
    }
    result.sort();
    result.dedup();
    result
}

fn default_capabilities() -> Vec<String> {
    vec![
        "resource".to_string(),
        "link".to_string(),
        "proxy".to_string(),
        "runtime".to_string(),
    ]
}

fn normalize_source_id(value: &str) -> Option<String> {
    let normalized = value
        .trim()
        .to_lowercase()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    (!normalized.is_empty()).then_some(normalized)
}

fn normalize_text(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn display_path(path: &Path) -> String {
    path.display().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "rdevtool-config-source-{label}-{}",
            uuid::Uuid::new_v4()
        ))
    }

    fn resolved_source(id: &str, name: &str, kind: &str, base_dir: &Path) -> ConfigSource {
        ConfigSource {
            id: id.to_string(),
            name: name.to_string(),
            kind: kind.to_string(),
            base_dir: display_path(base_dir),
            files: ConfigSourceFiles {
                navigation: display_path(&base_dir.join("navigation.toml")),
                links: display_path(&base_dir.join("links.toml")),
                proxy: Some(display_path(&base_dir.join("proxy.toml"))),
                runtime_overrides: Some(display_path(&base_dir.join("runtime_overrides.toml"))),
            },
            ui_profile: DEFAULT_RESOURCE_UI_PROFILE.to_string(),
            capabilities: default_capabilities(),
            is_default: kind == "default",
        }
    }

    fn copy_request(
        source_id: &str,
        id: &str,
        name: &str,
        base_dir: &Path,
    ) -> CopyConfigSourceRequest {
        CopyConfigSourceRequest {
            source_id: source_id.to_string(),
            id: id.to_string(),
            name: name.to_string(),
            base_dir: Some(display_path(base_dir)),
        }
    }

    fn definition(id: &str) -> ConfigSourceDefinition {
        ConfigSourceDefinition {
            id: id.to_string(),
            name: "  团队调试配置  ".to_string(),
            kind: Some("workspace".to_string()),
            base_dir: Some("/tmp/rdevtool-config-source".to_string()),
            files: ConfigSourceFileDefinition {
                navigation: Some(" config/navigation.toml ".to_string()),
                links: None,
                proxy: Some("proxy/team.toml".to_string()),
                runtime_overrides: None,
            },
            ui_profile: None,
            capabilities: vec!["proxy".to_string(), "link".to_string(), "proxy".to_string()],
        }
    }

    #[test]
    fn custom_definition_is_normalized_without_losing_file_mappings() {
        let normalized = normalize_custom_definition(definition(" Team / Dev ")).unwrap();
        assert_eq!(normalized.id, "team-dev");
        assert_eq!(normalized.name, "团队调试配置");
        assert_eq!(normalized.kind.as_deref(), Some("custom"));
        assert_eq!(
            normalized.ui_profile.as_deref(),
            Some(DEFAULT_RESOURCE_UI_PROFILE)
        );
        assert_eq!(normalized.capabilities, vec!["link", "proxy"]);
        assert_eq!(
            normalized.files.navigation.as_deref(),
            Some("config/navigation.toml")
        );
    }

    #[test]
    fn relative_file_mappings_resolve_from_the_source_directory() {
        let source = custom_config_source(definition("team-dev")).unwrap();
        assert_eq!(
            source.files.navigation,
            "/tmp/rdevtool-config-source/config/navigation.toml"
        );
        assert_eq!(
            source.files.proxy.as_deref(),
            Some("/tmp/rdevtool-config-source/proxy/team.toml")
        );
    }

    #[test]
    fn reserved_source_ids_are_rejected() {
        assert!(normalize_custom_definition(definition("default")).is_err());
        assert!(normalize_custom_definition(definition("global")).is_err());
    }

    #[test]
    fn unknown_ui_profiles_are_rejected() {
        let mut value = definition("team-dev");
        value.ui_profile = Some("external-script-profile".to_string());
        assert!(normalize_custom_definition(value).is_err());
    }

    #[test]
    fn workspace_source_id_matches_the_generated_source() {
        let workspace = ProjectWorkspaceConfig {
            key: "feature_cr260_ykd_car".to_string(),
            name: "CR260".to_string(),
            ..ProjectWorkspaceConfig::default()
        };
        assert_eq!(
            config_source_id_for_workspace(&workspace),
            "workspace-feature_cr260_ykd_car"
        );
    }

    #[test]
    fn workspace_can_prefer_an_explicit_source_per_capability() {
        let mut workspace = ProjectWorkspaceConfig {
            key: "feature-cr260".to_string(),
            name: "CR260".to_string(),
            ..ProjectWorkspaceConfig::default()
        };
        set_config_source_preference_for_workspace(&mut workspace, "proxy", Some("default"))
            .unwrap();
        assert_eq!(
            preferred_config_source_id_for_workspace(&workspace, "proxy"),
            "default"
        );
        assert_eq!(
            preferred_config_source_id_for_workspace(&workspace, "resource"),
            "workspace-feature-cr260"
        );
        set_config_source_preference_for_workspace(
            &mut workspace,
            "proxy",
            Some("workspace-feature-cr260"),
        )
        .unwrap();
        assert_eq!(
            preferred_config_source_id_for_workspace(&workspace, "proxy"),
            "workspace-feature-cr260"
        );
    }

    #[test]
    fn system_workspace_preferences_are_stored_in_app_workspace_config() {
        let mut workspace = ProjectWorkspaceConfig::default();
        let mut app_workspace = WorkspaceConfig::default();

        set_config_source_preference_for_scope(
            &mut workspace,
            &mut app_workspace,
            "proxy",
            Some("team-proxy"),
        )
        .unwrap();
        assert_eq!(
            preferred_config_source_id_for_scope(&workspace, &app_workspace, "proxy"),
            "team-proxy"
        );
        assert!(workspace.metadata.is_empty());

        set_config_source_preference_for_scope(
            &mut workspace,
            &mut app_workspace,
            "proxy",
            Some("default"),
        )
        .unwrap();
        assert_eq!(
            preferred_config_source_id_for_scope(&workspace, &app_workspace, "proxy"),
            "default"
        );
        assert!(app_workspace.app.config_source_preferences.is_empty());
    }

    #[test]
    fn system_scope_preference_round_trips_through_config_files() {
        let root = std::env::temp_dir().join(format!(
            "rdevtool-config-source-preference-{}",
            uuid::Uuid::new_v4()
        ));
        let paths = ConfigPaths {
            dir: root.clone(),
            projects: root.join("projects.toml"),
            workspace: root.join("workspace.toml"),
            project_workspaces: root.join("workspaces"),
        };
        fs::create_dir_all(&paths.project_workspaces).unwrap();
        save_workspace_config(&paths.workspace, &WorkspaceConfig::default()).unwrap();
        let workspace = ProjectWorkspaceConfig {
            key: "feature-a".to_string(),
            name: "Feature A".to_string(),
            ..ProjectWorkspaceConfig::default()
        };
        save_project_workspace_config(&paths.project_workspaces.join("feature-a.toml"), &workspace)
            .unwrap();

        let source =
            save_config_source_preference(&paths, "system", "proxy", "workspace-feature-a")
                .unwrap();
        assert_eq!(source.id, "workspace-feature-a");
        assert_eq!(
            load_config_source_preference(&paths, "system", "proxy").unwrap(),
            "workspace-feature-a"
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn comparison_reports_content_and_missing_file_differences_without_contents() {
        let root = test_dir("compare");
        let left_dir = root.join("left");
        let right_dir = root.join("right");
        fs::create_dir_all(&left_dir).unwrap();
        fs::create_dir_all(&right_dir).unwrap();
        fs::write(left_dir.join("navigation.toml"), "secret = 'same'\n").unwrap();
        fs::write(right_dir.join("navigation.toml"), "secret = 'same'\n").unwrap();
        fs::write(left_dir.join("links.toml"), "value = 'left'\n").unwrap();
        fs::write(right_dir.join("links.toml"), "value = 'rght'\n").unwrap();
        fs::write(right_dir.join("proxy.toml"), "enabled = true\n").unwrap();

        let comparison = compare_resolved_config_sources(
            &resolved_source("left", "Left", "default", &left_dir),
            &resolved_source("right", "Right", "workspace", &right_dir),
        )
        .unwrap();

        assert!(!comparison.identical);
        assert_eq!(
            comparison
                .files
                .iter()
                .map(|file| file.key.as_str())
                .collect::<Vec<_>>(),
            vec!["navigation", "links", "proxy", "runtimeOverrides"]
        );
        assert_eq!(comparison.files[0].status, "equal");
        assert_eq!(comparison.files[1].size_equal, Some(true));
        assert_eq!(comparison.files[1].content_equal, Some(false));
        assert_eq!(comparison.files[2].status, "missingLeft");
        assert_eq!(comparison.files[3].status, "missingBoth");
        assert_eq!(comparison.summary.missing_left, 1);
        assert_eq!(comparison.summary.missing_both, 1);
        let json = serde_json::to_string(&comparison).unwrap();
        assert!(!json.contains("secret ="));
        assert!(!json.contains("value ="));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn copy_creates_a_custom_source_and_skips_missing_files() {
        let root = test_dir("copy");
        let source_dir = root.join("source");
        let target_dir = root.join("target");
        let registry_path = root.join("config_sources.toml");
        fs::create_dir_all(&source_dir).unwrap();
        fs::write(source_dir.join("navigation.toml"), "version = 1\n").unwrap();
        fs::write(source_dir.join("links.toml"), "version = 2\n").unwrap();
        fs::write(
            source_dir.join("runtime_overrides.toml"),
            "runtimeProfiles = []\n",
        )
        .unwrap();
        let source = resolved_source("workspace-demo", "Demo", "workspace", &source_dir);

        let result = copy_resolved_config_source(
            &[],
            &source,
            copy_request("workspace-demo", "team-copy", "Team Copy", &target_dir),
            &registry_path,
        )
        .unwrap();

        assert_eq!(result.target.id, "team-copy");
        assert_eq!(result.target.kind, "custom");
        assert_eq!(result.copied_count, 3);
        assert_eq!(result.missing_count, 1);
        assert_eq!(
            fs::read(target_dir.join("links.toml")).unwrap(),
            b"version = 2\n"
        );
        assert!(!target_dir.join("proxy.toml").exists());
        let definitions = load_custom_config_source_definitions_from(&registry_path).unwrap();
        assert_eq!(definitions.len(), 1);
        assert_eq!(definitions[0].id, "team-copy");
        assert_eq!(definitions[0].kind.as_deref(), Some("custom"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn copy_rejects_duplicate_ids_before_touching_a_new_target() {
        let root = test_dir("duplicate");
        let source_dir = root.join("source");
        let first_target = root.join("first-target");
        let second_target = root.join("second-target");
        let registry_path = root.join("config_sources.toml");
        fs::create_dir_all(&source_dir).unwrap();
        fs::write(source_dir.join("navigation.toml"), "version = 1\n").unwrap();
        let source = resolved_source("default", "Default", "default", &source_dir);

        copy_resolved_config_source(
            &[],
            &source,
            copy_request("default", "team-copy", "First", &first_target),
            &registry_path,
        )
        .unwrap();
        let error = copy_resolved_config_source(
            &[],
            &source,
            copy_request("default", "team-copy", "Second", &second_target),
            &registry_path,
        )
        .unwrap_err();

        assert!(error.to_string().contains("配置源已存在"));
        assert!(!second_target.exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn copy_rejects_a_non_empty_target_directory() {
        let root = test_dir("non-empty");
        let source_dir = root.join("source");
        let target_dir = root.join("target");
        let registry_path = root.join("config_sources.toml");
        fs::create_dir_all(&source_dir).unwrap();
        fs::create_dir_all(&target_dir).unwrap();
        fs::write(target_dir.join("keep.txt"), "keep").unwrap();
        let source = resolved_source("default", "Default", "default", &source_dir);

        let error = copy_resolved_config_source(
            &[],
            &source,
            copy_request("default", "team-copy", "Team Copy", &target_dir),
            &registry_path,
        )
        .unwrap_err();

        assert!(error.to_string().contains("目标目录非空"));
        assert_eq!(
            fs::read_to_string(target_dir.join("keep.txt")).unwrap(),
            "keep"
        );
        assert!(!registry_path.exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn copy_rejects_default_and_workspace_targets() {
        let root = test_dir("generated-target");
        let source_dir = root.join("source");
        let registry_path = root.join("config_sources.toml");
        fs::create_dir_all(&source_dir).unwrap();
        let source = resolved_source("source", "Source", "custom", &source_dir);
        let workspace = ProjectWorkspaceConfig {
            key: "demo".to_string(),
            name: "Demo".to_string(),
            ..ProjectWorkspaceConfig::default()
        };

        let default_error = copy_resolved_config_source(
            std::slice::from_ref(&workspace),
            &source,
            copy_request("source", "default", "Default Copy", &root.join("default")),
            &registry_path,
        )
        .unwrap_err();
        let workspace_error = copy_resolved_config_source(
            std::slice::from_ref(&workspace),
            &source,
            copy_request(
                "source",
                "workspace-demo",
                "Workspace Copy",
                &root.join("workspace"),
            ),
            &registry_path,
        )
        .unwrap_err();

        assert!(default_error.to_string().contains("保留值"));
        assert!(workspace_error.to_string().contains("工作区配置源冲突"));
        assert!(!registry_path.exists());

        fs::remove_dir_all(root).unwrap();
    }
}
