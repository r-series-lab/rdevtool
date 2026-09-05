use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use anyhow::{Context, Result, bail};
use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};

use crate::config::default_config_dir;

const NOTES_INDEX: &str = "README.md";
const MAX_INDEXED_NOTE_BYTES: u64 = 512 * 1024;
const MAX_TOTAL_INDEXED_NOTE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_SCANNED_NOTE_FILES: usize = 1_000;
const MAX_NOTE_SUMMARY_CHARS: usize = 240;
const MAX_NOTE_TITLE_CHARS: usize = 120;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesInfo {
    pub notes_dir: PathBuf,
    pub index_path: PathBuf,
    pub inbox_dir: PathBuf,
    pub projects_dir: PathBuf,
    pub playbooks_dir: PathBuf,
    pub environments_dir: PathBuf,
    pub exists: bool,
    pub index_exists: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesInitResult {
    #[serde(flatten)]
    pub info: NotesInfo,
    pub created: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectNotesInfo {
    pub project_key: String,
    pub project_name: String,
    pub notes_root: PathBuf,
    pub project_dir: PathBuf,
    pub index_path: PathBuf,
    pub exists: bool,
    pub index_exists: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectNotesInitResult {
    #[serde(flatten)]
    pub info: ProjectNotesInfo,
    pub created: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDocumentSummary {
    pub source: String,
    pub scope: String,
    pub project_key: Option<String>,
    pub title: String,
    pub summary: String,
    pub match_excerpt: Option<String>,
    pub path: PathBuf,
    pub relative_path: PathBuf,
    pub updated_at_ms: Option<u64>,
    pub score: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesFileIndex {
    pub schema_version: u16,
    pub notes_root: PathBuf,
    pub project_key: Option<String>,
    pub scope: Option<String>,
    pub query: Option<String>,
    pub scanned_count: usize,
    pub matched_count: usize,
    pub truncated: bool,
    pub documents: Vec<NoteDocumentSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDocument {
    pub schema_version: u16,
    pub summary: NoteDocumentSummary,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveNoteDocumentLinkResult {
    pub document: NoteDocument,
    pub fragment: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNoteDocumentRequest {
    pub scope: String,
    #[serde(default)]
    pub project_key: Option<String>,
    #[serde(default)]
    pub project_name: Option<String>,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNoteDocumentResult {
    pub created: bool,
    pub document: NoteDocument,
}

pub fn notes_info() -> NotesInfo {
    notes_info_in(&default_config_dir())
}

pub fn init_notes() -> Result<NotesInitResult> {
    init_notes_in(&default_config_dir())
}

pub fn project_notes_info(project_key: &str, project_name: &str) -> Result<ProjectNotesInfo> {
    project_notes_info_in(&default_config_dir(), project_key, project_name)
}

pub fn init_project_notes(project_key: &str, project_name: &str) -> Result<ProjectNotesInitResult> {
    init_project_notes_in(&default_config_dir(), project_key, project_name)
}

pub fn search_note_documents(
    project_key: Option<&str>,
    query: Option<&str>,
    limit: usize,
) -> Result<NotesFileIndex> {
    search_note_documents_scoped(project_key, None, query, limit)
}

pub fn search_note_documents_scoped(
    project_key: Option<&str>,
    scope: Option<&str>,
    query: Option<&str>,
    limit: usize,
) -> Result<NotesFileIndex> {
    search_note_documents_scoped_in(&default_config_dir(), project_key, scope, query, limit)
}

pub fn read_note_document(path: &Path) -> Result<NoteDocument> {
    read_note_document_in(&default_config_dir(), path)
}

pub fn resolve_note_document_link(
    source_path: &Path,
    href: &str,
) -> Result<ResolveNoteDocumentLinkResult> {
    resolve_note_document_link_in(&default_config_dir(), source_path, href)
}

pub fn create_note_document(
    request: CreateNoteDocumentRequest,
) -> Result<CreateNoteDocumentResult> {
    create_note_document_in(&default_config_dir(), request)
}

fn notes_info_in(config_dir: &Path) -> NotesInfo {
    let notes_dir = config_dir.join("notes");
    let index_path = notes_dir.join(NOTES_INDEX);
    NotesInfo {
        inbox_dir: notes_dir.join("inbox"),
        projects_dir: notes_dir.join("projects"),
        playbooks_dir: notes_dir.join("playbooks"),
        environments_dir: notes_dir.join("environments"),
        exists: notes_dir.is_dir(),
        index_exists: index_path.is_file(),
        notes_dir,
        index_path,
    }
}

fn init_notes_in(config_dir: &Path) -> Result<NotesInitResult> {
    let info = notes_info_in(config_dir);
    ensure_real_directory(&info.notes_dir)?;
    for directory in [
        &info.inbox_dir,
        &info.projects_dir,
        &info.playbooks_dir,
        &info.environments_dir,
    ] {
        ensure_real_directory(directory)?;
    }
    let created = write_new_index(&info.index_path, notes_index())?;
    Ok(NotesInitResult {
        info: notes_info_in(config_dir),
        created,
    })
}

fn project_notes_info_in(
    config_dir: &Path,
    project_key: &str,
    project_name: &str,
) -> Result<ProjectNotesInfo> {
    validate_project_key(project_key)?;
    let notes_root = notes_info_in(config_dir).notes_dir;
    let project_dir = notes_root.join("projects").join(project_key);
    let index_path = project_dir.join(NOTES_INDEX);
    Ok(ProjectNotesInfo {
        project_key: project_key.to_string(),
        project_name: project_name.to_string(),
        exists: project_dir.is_dir(),
        index_exists: index_path.is_file(),
        notes_root,
        project_dir,
        index_path,
    })
}

fn init_project_notes_in(
    config_dir: &Path,
    project_key: &str,
    project_name: &str,
) -> Result<ProjectNotesInitResult> {
    init_notes_in(config_dir)?;
    let info = project_notes_info_in(config_dir, project_key, project_name)?;
    ensure_real_directory(&info.project_dir)?;
    let created = write_new_index(
        &info.index_path,
        &project_notes_index(project_key, project_name),
    )?;
    Ok(ProjectNotesInitResult {
        info: project_notes_info_in(config_dir, project_key, project_name)?,
        created,
    })
}

#[cfg(test)]
fn search_note_documents_in(
    config_dir: &Path,
    project_key: Option<&str>,
    query: Option<&str>,
    limit: usize,
) -> Result<NotesFileIndex> {
    search_note_documents_scoped_in(config_dir, project_key, None, query, limit)
}

fn search_note_documents_scoped_in(
    config_dir: &Path,
    project_key: Option<&str>,
    scope: Option<&str>,
    query: Option<&str>,
    limit: usize,
) -> Result<NotesFileIndex> {
    if let Some(project_key) = project_key {
        validate_project_key(project_key)?;
    }
    let normalized_scope = normalize_note_scope_filter(scope)?;
    let info = notes_info_in(config_dir);
    let normalized_query = query
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase());
    let query_tokens = normalized_query
        .as_deref()
        .map(|value| value.split_whitespace().collect::<Vec<_>>())
        .unwrap_or_default();
    let mut files = Vec::new();
    collect_markdown_files(&info.notes_dir, &info.notes_dir, &mut files)?;
    let mut scan_truncated = files.len() >= MAX_SCANNED_NOTE_FILES;
    files.sort();
    let scanned_count = files.len();
    let mut documents = Vec::new();
    let mut indexed_bytes = 0_u64;
    for path in files {
        let relative_path = path
            .strip_prefix(&info.notes_dir)
            .unwrap_or(&path)
            .to_path_buf();
        let (scope, document_project_key) = note_scope(&relative_path);
        if !note_scope_matches(
            scope,
            document_project_key.as_deref(),
            project_key,
            normalized_scope.as_deref(),
        ) {
            continue;
        }
        let metadata = fs::symlink_metadata(&path)
            .with_context(|| format!("failed to inspect note: {}", path.display()))?;
        if !metadata.is_file() || metadata.len() > MAX_INDEXED_NOTE_BYTES {
            continue;
        }
        if indexed_bytes.saturating_add(metadata.len()) > MAX_TOTAL_INDEXED_NOTE_BYTES {
            scan_truncated = true;
            break;
        }
        indexed_bytes += metadata.len();
        let content = fs::read_to_string(&path)
            .with_context(|| format!("failed to read note: {}", path.display()))?;
        let title = note_title(&content, &path);
        let summary = note_summary(&content);
        let match_excerpt = if query_tokens.is_empty() {
            None
        } else {
            note_match_excerpt(&content, &query_tokens)
        };
        let score = if query_tokens.is_empty() {
            default_note_score(scope, &relative_path)
        } else {
            note_match_score(&title, &relative_path, &content, &query_tokens)
        };
        if !query_tokens.is_empty() && score == 0 {
            continue;
        }
        documents.push(NoteDocumentSummary {
            source: "file".to_string(),
            scope: scope.to_string(),
            project_key: document_project_key,
            title,
            summary,
            match_excerpt,
            path,
            relative_path,
            updated_at_ms: metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                .map(|value| value.as_millis() as u64),
            score,
        });
    }
    documents.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| right.updated_at_ms.cmp(&left.updated_at_ms))
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });
    let matched_count = documents.len();
    let limit = limit.clamp(1, 100);
    documents.truncate(limit);
    Ok(NotesFileIndex {
        schema_version: 1,
        notes_root: info.notes_dir,
        project_key: project_key.map(ToString::to_string),
        scope: normalized_scope,
        query: normalized_query,
        scanned_count,
        matched_count,
        truncated: scan_truncated || matched_count > documents.len(),
        documents,
    })
}

fn read_note_document_in(config_dir: &Path, path: &Path) -> Result<NoteDocument> {
    let info = notes_info_in(config_dir);
    let (canonical_path, relative_path) = resolve_note_document_path(&info.notes_dir, path)?;
    let metadata = fs::symlink_metadata(&canonical_path)
        .with_context(|| format!("failed to inspect note: {}", canonical_path.display()))?;
    if !metadata.is_file() {
        bail!("note path is not a file: {}", canonical_path.display());
    }
    if metadata.len() > MAX_INDEXED_NOTE_BYTES {
        bail!(
            "note exceeds the {} byte read limit: {}",
            MAX_INDEXED_NOTE_BYTES,
            canonical_path.display()
        );
    }
    let content = fs::read_to_string(&canonical_path)
        .with_context(|| format!("failed to read note: {}", canonical_path.display()))?;
    let (scope, project_key) = note_scope(&relative_path);
    Ok(NoteDocument {
        schema_version: 1,
        summary: NoteDocumentSummary {
            source: "file".to_string(),
            scope: scope.to_string(),
            project_key,
            title: note_title(&content, &canonical_path),
            summary: note_summary(&content),
            match_excerpt: None,
            path: canonical_path,
            relative_path,
            updated_at_ms: metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                .map(|value| value.as_millis() as u64),
            score: 0,
        },
        content,
    })
}

fn resolve_note_document_link_in(
    config_dir: &Path,
    source_path: &Path,
    href: &str,
) -> Result<ResolveNoteDocumentLinkResult> {
    let href = href.trim();
    if href.is_empty() {
        bail!("note link is empty");
    }
    if href.starts_with("//") || has_uri_scheme(href) {
        bail!("external URLs are not note links: {href}");
    }

    let (path_and_query, encoded_fragment) = href
        .split_once('#')
        .map_or((href, None), |(path, fragment)| (path, Some(fragment)));
    let encoded_path = path_and_query
        .split_once('?')
        .map_or(path_and_query, |(path, _)| path);
    let decoded_path = percent_decode_str(encoded_path)
        .decode_utf8()
        .context("note link path is not valid UTF-8")?;
    let fragment = encoded_fragment
        .map(|value| {
            percent_decode_str(value)
                .decode_utf8()
                .context("note link fragment is not valid UTF-8")
                .map(|value| value.into_owned())
        })
        .transpose()?
        .filter(|value| !value.is_empty());

    let source = read_note_document_in(config_dir, source_path)?;
    let target_path = if decoded_path.is_empty() {
        source.summary.path.clone()
    } else if decoded_path.starts_with('/') {
        notes_info_in(config_dir)
            .notes_dir
            .join(decoded_path.trim_start_matches('/'))
    } else {
        source
            .summary
            .path
            .parent()
            .expect("validated note document has a parent directory")
            .join(decoded_path.as_ref())
    };

    Ok(ResolveNoteDocumentLinkResult {
        document: read_note_document_in(config_dir, &target_path)?,
        fragment,
    })
}

fn has_uri_scheme(value: &str) -> bool {
    let Some(separator) = value.find(':') else {
        return false;
    };
    let scheme = &value[..separator];
    !scheme.is_empty()
        && scheme
            .chars()
            .next()
            .is_some_and(|value| value.is_ascii_alphabetic())
        && scheme
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '+' | '-' | '.'))
}

fn create_note_document_in(
    config_dir: &Path,
    request: CreateNoteDocumentRequest,
) -> Result<CreateNoteDocumentResult> {
    let scope = normalize_creatable_note_scope(&request.scope)?;
    let title = normalize_note_title(&request.title)?;
    let info = init_notes_in(config_dir)?.info;
    let target_dir = match scope {
        "inbox" => info.inbox_dir,
        "playbook" => info.playbooks_dir,
        "environment" => info.environments_dir,
        "project" => {
            let project_key = request
                .project_key
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| anyhow::anyhow!("project scope requires projectKey"))?;
            validate_project_key(project_key)?;
            let project_name = request
                .project_name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(project_key);
            init_project_notes_in(config_dir, project_key, project_name)?
                .info
                .project_dir
        }
        _ => unreachable!("creatable scope is validated"),
    };
    ensure_real_directory(&target_dir)?;

    let stem = note_file_stem(&title);
    let content = note_template(scope, request.project_key.as_deref().map(str::trim), &title);
    let path = write_unique_note_file(&target_dir, &stem, &content)?;
    Ok(CreateNoteDocumentResult {
        created: true,
        document: read_note_document_in(config_dir, &path)?,
    })
}

fn resolve_note_document_path(notes_root: &Path, path: &Path) -> Result<(PathBuf, PathBuf)> {
    let root_metadata = fs::symlink_metadata(notes_root)
        .with_context(|| format!("notes root is not initialized: {}", notes_root.display()))?;
    if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
        bail!(
            "notes root must be a real directory: {}",
            notes_root.display()
        );
    }
    if path
        .extension()
        .is_none_or(|extension| !extension.to_string_lossy().eq_ignore_ascii_case("md"))
    {
        bail!("only Markdown notes can be read: {}", path.display());
    }

    let requested = if path.is_absolute() {
        path.to_path_buf()
    } else {
        notes_root.join(path)
    };
    if let Ok(relative_requested) = requested.strip_prefix(notes_root) {
        let mut current = notes_root.to_path_buf();
        for component in relative_requested.components() {
            match component {
                Component::Normal(value) => current.push(value),
                Component::CurDir => continue,
                Component::ParentDir => {
                    current.pop();
                    continue;
                }
                Component::RootDir | Component::Prefix(_) => continue,
            }
            if fs::symlink_metadata(&current)
                .is_ok_and(|metadata| metadata.file_type().is_symlink())
            {
                bail!(
                    "symbolic links are not allowed in note paths: {}",
                    current.display()
                );
            }
        }
    }
    let canonical_root = notes_root
        .canonicalize()
        .with_context(|| format!("failed to resolve notes root: {}", notes_root.display()))?;
    let canonical_path = requested
        .canonicalize()
        .with_context(|| format!("failed to resolve note path: {}", requested.display()))?;
    if canonical_path == canonical_root || !canonical_path.starts_with(&canonical_root) {
        bail!(
            "note path is outside the knowledge root: {}",
            path.display()
        );
    }
    let relative_path = canonical_path
        .strip_prefix(&canonical_root)
        .expect("validated note path prefix")
        .to_path_buf();
    let mut current = canonical_root.clone();
    for component in relative_path.components() {
        current.push(component.as_os_str());
        let metadata = fs::symlink_metadata(&current)
            .with_context(|| format!("failed to inspect note path: {}", current.display()))?;
        if metadata.file_type().is_symlink() {
            bail!(
                "symbolic links are not allowed in note paths: {}",
                current.display()
            );
        }
    }
    Ok((canonical_path, relative_path))
}

fn normalize_note_scope_filter(scope: Option<&str>) -> Result<Option<String>> {
    let scope = scope.map(str::trim).filter(|value| !value.is_empty());
    match scope {
        None | Some("all") => Ok(None),
        Some("inbox" | "project" | "playbook" | "environment" | "root") => {
            Ok(scope.map(ToString::to_string))
        }
        Some(value) => bail!("unsupported note scope: {value}"),
    }
}

fn normalize_creatable_note_scope(scope: &str) -> Result<&'static str> {
    match scope.trim() {
        "inbox" => Ok("inbox"),
        "project" => Ok("project"),
        "playbook" => Ok("playbook"),
        "environment" => Ok("environment"),
        value => bail!("unsupported creatable note scope: {value}"),
    }
}

fn normalize_note_title(title: &str) -> Result<String> {
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if title.is_empty() {
        bail!("note title is required");
    }
    if title.chars().count() > MAX_NOTE_TITLE_CHARS {
        bail!("note title must not exceed {MAX_NOTE_TITLE_CHARS} characters");
    }
    if title.chars().any(char::is_control) {
        bail!("note title contains unsupported control characters");
    }
    Ok(title)
}

fn note_file_stem(title: &str) -> String {
    let mut result = String::new();
    let mut separator_pending = false;
    for value in title.chars() {
        if value.is_alphanumeric() {
            if separator_pending && !result.is_empty() {
                result.push('-');
            }
            for lower in value.to_lowercase() {
                result.push(lower);
            }
            separator_pending = false;
        } else {
            separator_pending = true;
        }
        if result.chars().count() >= 72 {
            break;
        }
    }
    let result = result.trim_matches('-');
    if result.is_empty() {
        "note".to_string()
    } else {
        result.to_string()
    }
}

fn write_unique_note_file(directory: &Path, stem: &str, content: &str) -> Result<PathBuf> {
    for suffix in 1..=999 {
        let file_name = if suffix == 1 {
            format!("{stem}.md")
        } else {
            format!("{stem}-{suffix}.md")
        };
        let path = directory.join(file_name);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                file.write_all(content.as_bytes())
                    .with_context(|| format!("failed to write note: {}", path.display()))?;
                return Ok(path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(error)
                    .with_context(|| format!("failed to create note: {}", path.display()));
            }
        }
    }
    bail!("too many notes share the same file name: {stem}");
}

fn ensure_real_directory(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                bail!(
                    "note directory must be a real directory: {}",
                    path.display()
                );
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(path)
                .with_context(|| format!("failed to create notes directory: {}", path.display()))?;
            let metadata = fs::symlink_metadata(path)
                .with_context(|| format!("failed to inspect note directory: {}", path.display()))?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                bail!(
                    "note directory must be a real directory: {}",
                    path.display()
                );
            }
        }
        Err(error) => {
            return Err(error)
                .with_context(|| format!("failed to inspect note directory: {}", path.display()));
        }
    }
    Ok(())
}

fn note_template(scope: &str, project_key: Option<&str>, title: &str) -> String {
    let body = match scope {
        "inbox" => "<!-- 整理后移动到项目、Playbook 或环境目录。 -->\n\n## 记录\n\n".to_string(),
        "project" => format!(
            "适用项目：`{}`\n\n## 结论\n\n## 背景\n\n## 验证记录\n\n",
            project_key.unwrap_or_default()
        ),
        "playbook" => "## 适用场景\n\n## 操作步骤\n\n## 验证方式\n\n".to_string(),
        "environment" => "## 适用范围\n\n## 环境约定\n\n## 验证记录\n\n".to_string(),
        _ => String::new(),
    };
    format!("# {title}\n\n{body}")
}

fn collect_markdown_files(root: &Path, directory: &Path, files: &mut Vec<PathBuf>) -> Result<()> {
    if files.len() >= MAX_SCANNED_NOTE_FILES || !directory.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(directory)
        .with_context(|| format!("failed to read notes directory: {}", directory.display()))?
    {
        if files.len() >= MAX_SCANNED_NOTE_FILES {
            break;
        }
        let entry = entry.with_context(|| {
            format!(
                "failed to read notes directory entry: {}",
                directory.display()
            )
        })?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .with_context(|| format!("failed to inspect note path: {}", path.display()))?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            if path.starts_with(root) {
                collect_markdown_files(root, &path, files)?;
            }
        } else if metadata.is_file()
            && path
                .extension()
                .is_some_and(|extension| extension.to_string_lossy().eq_ignore_ascii_case("md"))
        {
            files.push(path);
        }
    }
    Ok(())
}

fn note_scope(relative_path: &Path) -> (&'static str, Option<String>) {
    let components = relative_path
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>();
    match components.first().map(String::as_str) {
        Some("inbox") => ("inbox", None),
        Some("projects") => ("project", components.get(1).cloned()),
        Some("playbooks") => ("playbook", None),
        Some("environments") => ("environment", None),
        _ => ("root", None),
    }
}

fn note_scope_matches(
    scope: &str,
    document_project_key: Option<&str>,
    requested_project_key: Option<&str>,
    requested_scope: Option<&str>,
) -> bool {
    if requested_scope.is_some_and(|requested| requested != scope) {
        return false;
    }
    match requested_project_key {
        None => true,
        Some(requested) if scope == "project" => document_project_key == Some(requested),
        Some(_) => matches!(scope, "inbox" | "playbook" | "environment" | "root"),
    }
}

fn note_title(content: &str, path: &Path) -> String {
    content
        .lines()
        .map(str::trim)
        .find_map(|line| {
            line.strip_prefix("# ")
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .map(ToString::to_string)
        .or_else(|| {
            path.file_stem()
                .map(|value| value.to_string_lossy().to_string())
        })
        .unwrap_or_else(|| "未命名笔记".to_string())
}

fn note_summary(content: &str) -> String {
    let mut summary = String::new();
    for line in content.lines().map(str::trim) {
        if line.is_empty()
            || line.starts_with('#')
            || line.starts_with("```")
            || line.starts_with("<!--")
        {
            continue;
        }
        let line = line
            .trim_start_matches(['-', '*', '>'])
            .trim_start_matches(|value: char| {
                value.is_ascii_digit() || value == '.' || value == '、'
            })
            .trim();
        if line.is_empty() {
            continue;
        }
        if !summary.is_empty() {
            summary.push(' ');
        }
        append_bounded(&mut summary, line, MAX_NOTE_SUMMARY_CHARS);
        if summary.chars().count() >= MAX_NOTE_SUMMARY_CHARS {
            break;
        }
    }
    summary
}

fn note_match_excerpt(content: &str, tokens: &[&str]) -> Option<String> {
    const EXCERPT_CHARS: usize = 170;
    const CONTEXT_BEFORE_MATCH: usize = 48;

    for raw_line in content.lines() {
        let line = raw_line
            .trim()
            .trim_start_matches('#')
            .trim_start_matches(['-', '*', '>'])
            .trim_start_matches(|value: char| {
                value.is_ascii_digit() || value == '.' || value == '、'
            })
            .trim();
        if line.is_empty() || line.starts_with("```") || line.starts_with("<!--") {
            continue;
        }
        let normalized = line.to_ascii_lowercase();
        let Some(match_byte) = tokens
            .iter()
            .filter_map(|token| normalized.find(token))
            .min()
        else {
            continue;
        };
        let match_char = normalized[..match_byte].chars().count();
        let total_chars = line.chars().count();
        let start = match_char.saturating_sub(CONTEXT_BEFORE_MATCH);
        let end = (start + EXCERPT_CHARS).min(total_chars);
        let mut excerpt = line
            .chars()
            .skip(start)
            .take(end.saturating_sub(start))
            .collect::<String>();
        if start > 0 {
            excerpt.insert(0, '…');
        }
        if end < total_chars {
            excerpt.push('…');
        }
        return Some(excerpt);
    }
    None
}

fn append_bounded(target: &mut String, value: &str, max_chars: usize) {
    let remaining = max_chars.saturating_sub(target.chars().count());
    target.extend(value.chars().take(remaining));
}

fn note_match_score(title: &str, path: &Path, content: &str, tokens: &[&str]) -> usize {
    if tokens.is_empty() {
        return 0;
    }
    let title = title.to_ascii_lowercase();
    let path = path.to_string_lossy().to_ascii_lowercase();
    let content = content.to_ascii_lowercase();
    if !tokens
        .iter()
        .all(|token| title.contains(token) || path.contains(token) || content.contains(token))
    {
        return 0;
    }
    tokens
        .iter()
        .map(|token| {
            usize::from(title.contains(token)) * 5
                + usize::from(path.contains(token)) * 3
                + usize::from(content.contains(token))
        })
        .sum()
}

fn default_note_score(scope: &str, path: &Path) -> usize {
    let is_index = path
        .file_name()
        .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case(NOTES_INDEX));
    match (scope, is_index) {
        ("project", false) => 4,
        ("playbook" | "environment", false) => 3,
        ("inbox" | "root", false) => 2,
        (_, true) => 1,
        _ => 0,
    }
}

fn write_new_index(path: &Path, content: &str) -> Result<bool> {
    match OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(mut file) => {
            file.write_all(content.as_bytes())
                .with_context(|| format!("failed to initialize notes index: {}", path.display()))?;
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        Err(error) => Err(error)
            .with_context(|| format!("failed to initialize notes index: {}", path.display())),
    }
}

fn validate_project_key(project_key: &str) -> Result<()> {
    let mut components = Path::new(project_key).components();
    let valid = matches!(components.next(), Some(Component::Normal(_)))
        && components.next().is_none()
        && project_key != "."
        && project_key != "..";
    if !valid {
        bail!("project key must be a single safe path component: {project_key}");
    }
    Ok(())
}

fn notes_index() -> &'static str {
    "# rDevTool 知识笔记\n\n\
     此目录用于存放开发者、AI CLI 和自动化工具可直接读取的持久化 Markdown 知识。\n\n\
     ## 目录\n\n\
     - `inbox/`：尚未归类的临时知识草稿。\n\
     - `projects/`：应用专属经验，按 rDevTool project key 隔离。\n\
     - `playbooks/`：跨项目复用的操作与排障手册。\n\
     - `environments/`：共享环境、网络和认证约定。\n\n\
     ## 使用约定\n\n\
     - 不记录 token、Cookie、密码、私钥或其他敏感信息。\n\
     - 单次需求执行过程仍放在对应需求工作区的 worklog 中。\n\
     - 项目笔记只保留可跨需求复用的拓扑、命令、故障特征和验证结论。\n"
}

fn project_notes_index(project_key: &str, project_name: &str) -> String {
    format!(
        "# {project_name}（{project_key}）项目笔记\n\n\
         此目录用于沉淀跨需求工作区复用的项目级联调经验。\n\n\
         ## 使用约定\n\n\
         - 按主题新建 Markdown 文件，并在下方登记链接与适用环境。\n\
         - 只记录可复用的拓扑、命令、故障特征和验证结论。\n\
         - 不记录 token、Cookie、密码、私钥或其他敏感信息。\n\
         - 单次需求过程记录仍放在对应需求工作区的 worklog 中。\n\n\
         ## 笔记索引\n\n\
         <!-- 在此添加主题笔记链接。 -->\n"
    )
}

#[cfg(test)]
mod tests {
    use std::fs;

    use uuid::Uuid;

    use super::{
        CreateNoteDocumentRequest, create_note_document_in, init_notes_in, init_project_notes_in,
        project_notes_info_in, read_note_document_in, resolve_note_document_link_in,
        search_note_documents_in, search_note_documents_scoped_in,
    };

    fn test_root() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("rdevtool-project-notes-test-{}", Uuid::new_v4()))
    }

    #[test]
    fn root_notes_init_creates_extensible_layout() {
        let root = test_root();
        let result = init_notes_in(&root).expect("initialize root notes");

        assert!(result.created);
        assert!(result.info.index_exists);
        assert!(result.info.inbox_dir.is_dir());
        assert!(result.info.projects_dir.is_dir());
        assert!(result.info.playbooks_dir.is_dir());
        assert!(result.info.environments_dir.is_dir());
        fs::remove_dir_all(&root).expect("cleanup");
    }

    #[test]
    fn project_notes_init_is_idempotent_and_does_not_overwrite_index() {
        let root = test_root();
        let first = init_project_notes_in(&root, "demo-console", "示例控制台").expect("first init");
        assert!(first.created);
        assert!(first.info.index_exists);
        assert_eq!(
            first.info.project_dir,
            root.join("notes").join("projects").join("demo-console")
        );

        fs::write(&first.info.index_path, "custom content").expect("write custom index");
        let second =
            init_project_notes_in(&root, "demo-console", "示例控制台").expect("second init");
        assert!(!second.created);
        assert_eq!(
            fs::read_to_string(&second.info.index_path).expect("read index"),
            "custom content"
        );
        fs::remove_dir_all(&root).expect("cleanup");
    }

    #[test]
    fn project_notes_rejects_path_traversal() {
        let root = test_root();
        assert!(project_notes_info_in(&root, "../outside", "bad").is_err());
        assert!(project_notes_info_in(&root, "nested/project", "bad").is_err());
    }

    #[test]
    fn file_index_searches_project_and_shared_notes_with_bounded_summaries() {
        let root = test_root();
        init_project_notes_in(&root, "demo-console", "示例控制台").expect("init project notes");
        init_project_notes_in(&root, "other", "其他项目").expect("init other project notes");
        fs::write(
            root.join("notes/projects/demo-console/proxy-debug.md"),
            "# 本地代理排障\n\n遇到接口 500 时先确认代理监听和下一跳。",
        )
        .expect("write project note");
        fs::write(
            root.join("notes/projects/other/proxy-debug.md"),
            "# 其他代理\n\n不应命中指定项目。",
        )
        .expect("write other note");
        fs::write(
            root.join("notes/playbooks/network.md"),
            "# 网络分层\n\n代理诊断应按层记录证据。",
        )
        .expect("write shared note");
        fs::write(
            root.join("notes/inbox/proxy-note.md"),
            "# 待整理代理记录\n\n先放入收件箱，后续再归档。",
        )
        .expect("write inbox note");

        let index = search_note_documents_in(&root, Some("demo-console"), Some("代理"), 10)
            .expect("search notes");
        assert_eq!(index.matched_count, 3);
        assert!(
            index
                .documents
                .iter()
                .any(|note| note.project_key.as_deref() == Some("demo-console"))
        );
        assert!(index.documents.iter().any(|note| note.scope == "playbook"));
        assert!(index.documents.iter().any(|note| note.scope == "inbox"));
        assert!(
            index
                .documents
                .iter()
                .all(|note| note.project_key.as_deref() != Some("other"))
        );
        assert!(
            index
                .documents
                .iter()
                .all(|note| note.summary.chars().count() <= 240)
        );
        fs::remove_dir_all(&root).expect("cleanup");
    }

    #[test]
    fn search_results_include_context_around_a_body_match() {
        let root = test_root();
        init_notes_in(&root).expect("initialize notes");
        fs::write(
            root.join("notes/playbooks/debug.md"),
            format!(
                "# 排障手册\n\n{}\n\n## 深入诊断\n\n先检查连接池，再定位唯一诊断关键词和对应请求。",
                "这是文档开头的通用说明。".repeat(32)
            ),
        )
        .expect("write note");

        let index = search_note_documents_in(&root, None, Some("唯一诊断关键词"), 10)
            .expect("search note body");
        assert_eq!(index.matched_count, 1);
        assert!(
            index.documents[0]
                .match_excerpt
                .as_deref()
                .is_some_and(|value| value.contains("唯一诊断关键词"))
        );
        assert!(!index.documents[0].summary.contains("唯一诊断关键词"));
        fs::remove_dir_all(&root).expect("cleanup");
    }

    #[test]
    fn resolves_relative_markdown_links_inside_the_knowledge_root() {
        let root = test_root();
        init_notes_in(&root).expect("initialize notes");
        let source = root.join("notes/playbooks/index.md");
        let target = root.join("notes/environments/共享 环境.md");
        fs::write(
            &source,
            "# 手册索引\n\n[环境](../environments/共享%20环境.md#验证记录)",
        )
        .expect("write source note");
        fs::write(&target, "# 共享环境\n\n## 验证记录\n\n已验证。").expect("write target note");

        let result = resolve_note_document_link_in(
            &root,
            &source,
            "../environments/共享%20环境.md#验证记录",
        )
        .expect("resolve note link");
        assert_eq!(result.document.summary.title, "共享环境");
        assert_eq!(result.fragment.as_deref(), Some("验证记录"));

        fs::write(root.join("outside.md"), "# Outside").expect("write outside note");
        let traversal = resolve_note_document_link_in(&root, &source, "../../outside.md")
            .expect_err("reject traversal");
        assert!(traversal.to_string().contains("outside the knowledge root"));
        assert!(
            resolve_note_document_link_in(&root, &source, "https://example.com").is_err(),
            "external URLs must not be resolved as local knowledge"
        );
        fs::remove_dir_all(&root).expect("cleanup");
    }

    #[test]
    fn creates_unique_scoped_notes_and_reads_them_within_the_knowledge_root() {
        let root = test_root();
        let first = create_note_document_in(
            &root,
            CreateNoteDocumentRequest {
                scope: "project".to_string(),
                project_key: Some("demo-console".to_string()),
                project_name: Some("示例控制台".to_string()),
                title: "代理排障".to_string(),
            },
        )
        .expect("create first note");
        let second = create_note_document_in(
            &root,
            CreateNoteDocumentRequest {
                scope: "project".to_string(),
                project_key: Some("demo-console".to_string()),
                project_name: Some("示例控制台".to_string()),
                title: "代理排障".to_string(),
            },
        )
        .expect("create second note");

        assert_ne!(
            first.document.summary.path, second.document.summary.path,
            "new notes must never overwrite an existing Markdown file"
        );
        assert_eq!(first.document.summary.scope, "project");
        assert!(first.document.content.contains("适用项目：`demo-console`"));
        let reread =
            read_note_document_in(&root, &first.document.summary.path).expect("read created note");
        assert_eq!(reread.summary.title, "代理排障");

        let project_index =
            search_note_documents_scoped_in(&root, Some("demo-console"), Some("project"), None, 24)
                .expect("index project notes");
        assert_eq!(
            project_index
                .documents
                .iter()
                .filter(|note| note.title == "代理排障")
                .count(),
            2
        );
        fs::remove_dir_all(&root).expect("cleanup");
    }

    #[test]
    fn rejects_reading_notes_outside_the_knowledge_root() {
        let root = test_root();
        init_notes_in(&root).expect("initialize notes");
        let outside = root.join("outside.md");
        fs::write(&outside, "# Outside").expect("write outside note");
        let error = read_note_document_in(&root, &outside).expect_err("reject outside note");
        assert!(error.to_string().contains("outside the knowledge root"));
        fs::remove_dir_all(&root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symbolic_links_even_when_the_target_stays_inside_the_knowledge_root() {
        use std::os::unix::fs::symlink;

        let root = test_root();
        init_notes_in(&root).expect("initialize notes");
        let target = root.join("notes/inbox/real.md");
        let link = root.join("notes/inbox/link.md");
        fs::write(&target, "# Real").expect("write real note");
        symlink(&target, &link).expect("create note symlink");

        let error = read_note_document_in(&root, &link).expect_err("reject note symlink");
        assert!(error.to_string().contains("symbolic links are not allowed"));
        fs::remove_dir_all(&root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_creating_notes_through_a_symbolic_linked_scope() {
        use std::os::unix::fs::symlink;

        let root = test_root();
        let outside = test_root();
        init_notes_in(&root).expect("initialize notes");
        fs::create_dir_all(&outside).expect("create outside directory");
        fs::remove_dir(root.join("notes/inbox")).expect("remove inbox");
        symlink(&outside, root.join("notes/inbox")).expect("link inbox outside");

        let error = create_note_document_in(
            &root,
            CreateNoteDocumentRequest {
                scope: "inbox".to_string(),
                project_key: None,
                project_name: None,
                title: "Unsafe".to_string(),
            },
        )
        .expect_err("reject linked scope");
        assert!(error.to_string().contains("real directory"));
        assert!(!outside.join("unsafe.md").exists());
        fs::remove_dir_all(&root).expect("cleanup root");
        fs::remove_dir_all(&outside).expect("cleanup outside");
    }
}
