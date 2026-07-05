use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

const DEPLOY_HISTORY_LIMIT: usize = 20;

#[derive(Debug, Clone)]
pub struct Storage {
    db_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub tags: Vec<String>,
    pub is_pinned: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteRecord {
    pub id: String,
    pub title: String,
    pub content: String,
    pub summary: String,
    pub tags: Vec<String>,
    pub is_pinned: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryCommitInfo {
    pub short_hash: String,
    pub subject: String,
    pub committed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployHistoryEntry {
    pub history_key: String,
    pub project_key: String,
    pub project_name: String,
    pub mode: String,
    pub env: String,
    pub branch: String,
    pub state_key: String,
    pub state_label: String,
    pub detail: String,
    pub queue_url: Option<String>,
    pub build_url: Option<String>,
    pub params: Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDeployHistoryRequest {
    pub history_key: String,
    pub project_key: String,
    pub project_name: String,
    pub mode: String,
    pub env: Option<String>,
    pub branch: Option<String>,
    pub state_key: String,
    pub state_label: String,
    pub detail: String,
    pub queue_url: Option<String>,
    pub build_url: Option<String>,
    pub params: Value,
}

pub type BuildHistoryEntry = DeployHistoryEntry;
pub type SaveBuildHistoryRequest = SaveDeployHistoryRequest;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeHistoryEntry {
    pub history_key: String,
    pub project_key: String,
    pub project_name: String,
    pub source_branch: String,
    pub target_branch: String,
    pub success: bool,
    pub remote: bool,
    pub summary: String,
    pub detail: String,
    pub merged_commit: Option<String>,
    pub source_commit: Option<HistoryCommitInfo>,
    pub target_commit: Option<HistoryCommitInfo>,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMergeHistoryRequest {
    pub history_key: String,
    pub project_key: String,
    pub project_name: String,
    pub source_branch: String,
    pub target_branch: String,
    pub success: bool,
    pub remote: bool,
    pub summary: String,
    pub detail: String,
    pub merged_commit: Option<String>,
    pub source_commit: Option<HistoryCommitInfo>,
    pub target_commit: Option<HistoryCommitInfo>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveNoteRequest {
    pub id: String,
    pub title: String,
    pub content: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub is_pinned: bool,
}

impl Storage {
    pub fn new(db_path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }

        let storage = Self { db_path };
        storage.init_schema()?;
        Ok(storage)
    }

    pub fn new_default() -> Result<Self, String> {
        Self::new(default_storage_path())
    }

    fn open(&self) -> Result<Connection, String> {
        Connection::open(&self.db_path).map_err(|error| error.to_string())
    }

    fn init_schema(&self) -> Result<(), String> {
        let connection = self.open()?;
        connection
            .execute_batch(
                r#"
                PRAGMA journal_mode = WAL;
                PRAGMA foreign_keys = ON;

                CREATE TABLE IF NOT EXISTS kv_store (
                    namespace TEXT NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY(namespace, key)
                );

                CREATE TABLE IF NOT EXISTS notes (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    tags_json TEXT NOT NULL DEFAULT '[]',
                    is_pinned INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_notes_pinned_updated ON notes(is_pinned DESC, updated_at DESC);

                CREATE TABLE IF NOT EXISTS deploy_history (
                    history_key TEXT PRIMARY KEY,
                    project_key TEXT NOT NULL,
                    project_name TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    env TEXT NOT NULL,
                    branch TEXT NOT NULL,
                    state_key TEXT NOT NULL,
                    state_label TEXT NOT NULL,
                    detail TEXT NOT NULL,
                    queue_url TEXT,
                    build_url TEXT,
                    params_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_deploy_history_updated ON deploy_history(updated_at DESC);

                CREATE TABLE IF NOT EXISTS merge_history (
                    history_key TEXT PRIMARY KEY,
                    project_key TEXT NOT NULL,
                    project_name TEXT NOT NULL,
                    source_branch TEXT NOT NULL,
                    target_branch TEXT NOT NULL,
                    success INTEGER NOT NULL,
                    remote INTEGER NOT NULL,
                    summary TEXT NOT NULL,
                    detail TEXT NOT NULL,
                    merged_commit TEXT,
                    source_commit_json TEXT,
                    target_commit_json TEXT,
                    created_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_merge_history_created ON merge_history(created_at DESC);
                "#,
            )
            .map_err(|error| error.to_string())
    }

    pub fn get_json(&self, namespace: &str, key: &str) -> Result<Option<Value>, String> {
        let connection = self.open()?;
        let raw = connection
            .query_row(
                "SELECT value FROM kv_store WHERE namespace = ?1 AND key = ?2",
                params![namespace, key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;

        raw.map(|value| serde_json::from_str::<Value>(&value).map_err(|error| error.to_string()))
            .transpose()
    }

    pub fn set_json(&self, namespace: &str, key: &str, value: &Value) -> Result<(), String> {
        let connection = self.open()?;
        let now = now_iso();
        let payload = serde_json::to_string(value).map_err(|error| error.to_string())?;
        connection
            .execute(
                r#"
                INSERT INTO kv_store(namespace, key, value, updated_at)
                VALUES (?1, ?2, ?3, ?4)
                ON CONFLICT(namespace, key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
                "#,
                params![namespace, key, payload, now],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn delete_json(&self, namespace: &str, key: &str) -> Result<(), String> {
        let connection = self.open()?;
        connection
            .execute(
                "DELETE FROM kv_store WHERE namespace = ?1 AND key = ?2",
                params![namespace, key],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn list_notes(&self) -> Result<Vec<NoteSummary>, String> {
        self.search_notes(None, 24)
    }

    pub fn search_notes(
        &self,
        query: Option<&str>,
        limit: usize,
    ) -> Result<Vec<NoteSummary>, String> {
        let connection = self.open()?;
        let normalized_query = query
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| format!("%{}%", value.to_ascii_lowercase()));
        let limit = normalize_limit(limit, 24);
        let mut statement = connection
            .prepare(
                r#"
                SELECT id, title, summary, tags_json, is_pinned, created_at, updated_at
                FROM notes
                WHERE (?1 IS NULL)
                   OR lower(title) LIKE ?1
                   OR lower(summary) LIKE ?1
                   OR lower(content) LIKE ?1
                   OR lower(tags_json) LIKE ?1
                ORDER BY updated_at DESC, created_at DESC
                LIMIT ?2
                "#,
            )
            .map_err(|error| error.to_string())?;

        let rows = statement
            .query_map(params![normalized_query, limit], |row| {
                Ok(NoteSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    summary: row.get(2)?,
                    tags: parse_tags(&row.get::<_, String>(3)?),
                    is_pinned: row.get::<_, i64>(4)? != 0,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|error| error.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub fn get_note(&self, note_id: &str) -> Result<NoteRecord, String> {
        let connection = self.open()?;
        connection
            .query_row(
                r#"
                SELECT id, title, content, summary, tags_json, is_pinned, created_at, updated_at
                FROM notes
                WHERE id = ?1
                "#,
                params![note_id],
                |row| {
                    Ok(NoteRecord {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        content: row.get(2)?,
                        summary: row.get(3)?,
                        tags: parse_tags(&row.get::<_, String>(4)?),
                        is_pinned: row.get::<_, i64>(5)? != 0,
                        created_at: row.get(6)?,
                        updated_at: row.get(7)?,
                    })
                },
            )
            .map_err(|error| error.to_string())
    }

    pub fn create_note(&self, title: Option<&str>) -> Result<NoteRecord, String> {
        let connection = self.open()?;
        let now = now_iso();
        let final_title = normalize_title(title.unwrap_or("").trim());
        let id = Uuid::new_v4().to_string();
        let content = String::new();
        let summary = note_summary(&content);
        let tags_json = "[]";

        connection
            .execute(
                r#"
                INSERT INTO notes(id, title, content, summary, tags_json, is_pinned, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)
                "#,
                params![id, final_title, content, summary, tags_json, now, now],
            )
            .map_err(|error| error.to_string())?;

        self.get_note(&id)
    }

    pub fn list_all_notes(&self) -> Result<Vec<NoteRecord>, String> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                r#"
                SELECT id, title, content, summary, tags_json, is_pinned, created_at, updated_at
                FROM notes
                ORDER BY updated_at DESC, created_at DESC
                "#,
            )
            .map_err(|error| error.to_string())?;

        let rows = statement
            .query_map([], |row| {
                Ok(NoteRecord {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    content: row.get(2)?,
                    summary: row.get(3)?,
                    tags: parse_tags(&row.get::<_, String>(4)?),
                    is_pinned: row.get::<_, i64>(5)? != 0,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            })
            .map_err(|error| error.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub fn save_note(&self, request: SaveNoteRequest) -> Result<NoteRecord, String> {
        let connection = self.open()?;
        let now = now_iso();
        let title = normalize_title(request.title.trim());
        let tags = normalize_tags(request.tags);
        let tags_json = serde_json::to_string(&tags).map_err(|error| error.to_string())?;
        let summary = note_summary(&request.content);
        let existing_created_at = connection
            .query_row(
                "SELECT created_at FROM notes WHERE id = ?1",
                params![request.id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let created_at = existing_created_at.unwrap_or_else(|| now.clone());

        connection
            .execute(
                r#"
                INSERT INTO notes(id, title, content, summary, tags_json, is_pinned, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    content = excluded.content,
                    summary = excluded.summary,
                    tags_json = excluded.tags_json,
                    is_pinned = excluded.is_pinned,
                    updated_at = excluded.updated_at
                "#,
                params![
                    request.id,
                    title,
                    request.content,
                    summary,
                    tags_json,
                    if request.is_pinned { 1 } else { 0 },
                    created_at,
                    now
                ],
            )
            .map_err(|error| error.to_string())?;

        self.get_note(&request.id)
    }

    pub fn delete_note(&self, note_id: &str) -> Result<(), String> {
        let connection = self.open()?;
        connection
            .execute("DELETE FROM notes WHERE id = ?1", params![note_id])
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn clear_notes(&self) -> Result<usize, String> {
        let connection = self.open()?;
        connection
            .execute("DELETE FROM notes", [])
            .map_err(|error| error.to_string())
    }

    pub fn import_note_record(&self, record: NoteRecord) -> Result<(), String> {
        let connection = self.open()?;
        let tags = normalize_tags(record.tags);
        let tags_json = serde_json::to_string(&tags).map_err(|error| error.to_string())?;
        let title = normalize_title(record.title.trim());
        let summary = if record.summary.trim().is_empty() {
            note_summary(&record.content)
        } else {
            record.summary
        };

        connection
            .execute(
                r#"
                INSERT INTO notes(id, title, content, summary, tags_json, is_pinned, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    content = excluded.content,
                    summary = excluded.summary,
                    tags_json = excluded.tags_json,
                    is_pinned = excluded.is_pinned,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at
                "#,
                params![
                    record.id,
                    title,
                    record.content,
                    summary,
                    tags_json,
                    if record.is_pinned { 1 } else { 0 },
                    record.created_at,
                    record.updated_at
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn save_deploy_history(&self, request: SaveDeployHistoryRequest) -> Result<(), String> {
        let connection = self.open()?;
        let now = now_iso();
        let params_json =
            serde_json::to_string(&request.params).map_err(|error| error.to_string())?;
        let existing_created_at = connection
            .query_row(
                "SELECT created_at FROM deploy_history WHERE history_key = ?1",
                params![request.history_key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .unwrap_or_else(|| now.clone());

        connection
            .execute(
                r#"
                INSERT INTO deploy_history(
                    history_key, project_key, project_name, mode, env, branch, state_key, state_label,
                    detail, queue_url, build_url, params_json, created_at, updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
                ON CONFLICT(history_key) DO UPDATE SET
                    state_key = excluded.state_key,
                    state_label = excluded.state_label,
                    detail = excluded.detail,
                    queue_url = excluded.queue_url,
                    build_url = excluded.build_url,
                    params_json = excluded.params_json,
                    updated_at = excluded.updated_at
                "#,
                params![
                    request.history_key,
                    request.project_key,
                    request.project_name,
                    request.mode,
                    request.env.unwrap_or_default(),
                    request.branch.unwrap_or_default(),
                    request.state_key,
                    request.state_label,
                    request.detail,
                    request.queue_url,
                    request.build_url,
                    params_json,
                    existing_created_at,
                    now
                ],
            )
            .map_err(|error| error.to_string())?;
        prune_deploy_history(&connection)?;
        Ok(())
    }

    pub fn list_deploy_history(&self) -> Result<Vec<DeployHistoryEntry>, String> {
        self.list_deploy_history_filtered(None, DEPLOY_HISTORY_LIMIT)
    }

    pub fn clear_deploy_history(&self) -> Result<usize, String> {
        let connection = self.open()?;
        connection
            .execute("DELETE FROM deploy_history", [])
            .map_err(|error| error.to_string())
    }

    pub fn clear_deploy_history_for_projects(
        &self,
        project_keys: &[String],
    ) -> Result<usize, String> {
        if project_keys.is_empty() {
            return Ok(0);
        }
        let connection = self.open()?;
        let mut deleted = 0;
        for project_key in project_keys {
            deleted += connection
                .execute(
                    "DELETE FROM deploy_history WHERE project_key = ?1",
                    params![project_key],
                )
                .map_err(|error| error.to_string())?;
        }
        Ok(deleted)
    }

    pub fn list_all_deploy_history(&self) -> Result<Vec<DeployHistoryEntry>, String> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                r#"
                SELECT history_key, project_key, project_name, mode, env, branch, state_key, state_label,
                       detail, queue_url, build_url, params_json, created_at, updated_at
                FROM deploy_history
                ORDER BY updated_at DESC, created_at DESC
                "#,
            )
            .map_err(|error| error.to_string())?;

        let rows = statement
            .query_map([], |row| {
                let params_json = row.get::<_, String>(11)?;
                let params = serde_json::from_str::<Value>(&params_json).unwrap_or(Value::Null);
                Ok(DeployHistoryEntry {
                    history_key: row.get(0)?,
                    project_key: row.get(1)?,
                    project_name: row.get(2)?,
                    mode: row.get(3)?,
                    env: row.get(4)?,
                    branch: row.get(5)?,
                    state_key: row.get(6)?,
                    state_label: row.get(7)?,
                    detail: row.get(8)?,
                    queue_url: row.get(9)?,
                    build_url: row.get(10)?,
                    params,
                    created_at: row.get(12)?,
                    updated_at: row.get(13)?,
                })
            })
            .map_err(|error| error.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub fn import_deploy_history_entry(&self, entry: DeployHistoryEntry) -> Result<(), String> {
        let connection = self.open()?;
        let params_json =
            serde_json::to_string(&entry.params).map_err(|error| error.to_string())?;
        connection
            .execute(
                r#"
                INSERT INTO deploy_history(
                    history_key, project_key, project_name, mode, env, branch, state_key, state_label,
                    detail, queue_url, build_url, params_json, created_at, updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
                ON CONFLICT(history_key) DO UPDATE SET
                    project_key = excluded.project_key,
                    project_name = excluded.project_name,
                    mode = excluded.mode,
                    env = excluded.env,
                    branch = excluded.branch,
                    state_key = excluded.state_key,
                    state_label = excluded.state_label,
                    detail = excluded.detail,
                    queue_url = excluded.queue_url,
                    build_url = excluded.build_url,
                    params_json = excluded.params_json,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at
                "#,
                params![
                    entry.history_key,
                    entry.project_key,
                    entry.project_name,
                    entry.mode,
                    entry.env,
                    entry.branch,
                    entry.state_key,
                    entry.state_label,
                    entry.detail,
                    entry.queue_url,
                    entry.build_url,
                    params_json,
                    entry.created_at,
                    entry.updated_at
                ],
            )
            .map_err(|error| error.to_string())?;
        prune_deploy_history(&connection)?;
        Ok(())
    }

    pub fn list_deploy_history_filtered(
        &self,
        project_key: Option<&str>,
        limit: usize,
    ) -> Result<Vec<DeployHistoryEntry>, String> {
        let connection = self.open()?;
        let project_key = project_key
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);
        let limit = normalize_limit(limit, DEPLOY_HISTORY_LIMIT);
        let mut statement = connection
            .prepare(
                r#"
                SELECT history_key, project_key, project_name, mode, env, branch, state_key, state_label,
                       detail, queue_url, build_url, params_json, created_at, updated_at
                FROM deploy_history
                WHERE (?1 IS NULL OR project_key = ?1)
                ORDER BY updated_at DESC, created_at DESC
                LIMIT ?2
                "#,
            )
            .map_err(|error| error.to_string())?;

        let rows = statement
            .query_map(params![project_key, limit], |row| {
                let params_json = row.get::<_, String>(11)?;
                let params = serde_json::from_str::<Value>(&params_json).unwrap_or(Value::Null);
                Ok(DeployHistoryEntry {
                    history_key: row.get(0)?,
                    project_key: row.get(1)?,
                    project_name: row.get(2)?,
                    mode: row.get(3)?,
                    env: row.get(4)?,
                    branch: row.get(5)?,
                    state_key: row.get(6)?,
                    state_label: row.get(7)?,
                    detail: row.get(8)?,
                    queue_url: row.get(9)?,
                    build_url: row.get(10)?,
                    params,
                    created_at: row.get(12)?,
                    updated_at: row.get(13)?,
                })
            })
            .map_err(|error| error.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub fn save_merge_history(&self, request: SaveMergeHistoryRequest) -> Result<(), String> {
        let connection = self.open()?;
        let created_at = now_iso();
        let source_commit_json = request
            .source_commit
            .as_ref()
            .map(|value| serde_json::to_string(value).map_err(|error| error.to_string()))
            .transpose()?;
        let target_commit_json = request
            .target_commit
            .as_ref()
            .map(|value| serde_json::to_string(value).map_err(|error| error.to_string()))
            .transpose()?;

        connection
            .execute(
                r#"
                INSERT INTO merge_history(
                    history_key, project_key, project_name, source_branch, target_branch, success, remote,
                    summary, detail, merged_commit, source_commit_json, target_commit_json, created_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                ON CONFLICT(history_key) DO UPDATE SET
                    success = excluded.success,
                    remote = excluded.remote,
                    summary = excluded.summary,
                    detail = excluded.detail,
                    merged_commit = excluded.merged_commit,
                    source_commit_json = excluded.source_commit_json,
                    target_commit_json = excluded.target_commit_json
                "#,
                params![
                    request.history_key,
                    request.project_key,
                    request.project_name,
                    request.source_branch,
                    request.target_branch,
                    if request.success { 1 } else { 0 },
                    if request.remote { 1 } else { 0 },
                    request.summary,
                    request.detail,
                    request.merged_commit,
                    source_commit_json,
                    target_commit_json,
                    created_at
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn list_merge_history(&self) -> Result<Vec<MergeHistoryEntry>, String> {
        self.list_merge_history_filtered(None, 12)
    }

    pub fn clear_merge_history(&self) -> Result<usize, String> {
        let connection = self.open()?;
        connection
            .execute("DELETE FROM merge_history", [])
            .map_err(|error| error.to_string())
    }

    pub fn clear_merge_history_for_projects(
        &self,
        project_keys: &[String],
    ) -> Result<usize, String> {
        if project_keys.is_empty() {
            return Ok(0);
        }
        let connection = self.open()?;
        let mut deleted = 0;
        for project_key in project_keys {
            deleted += connection
                .execute(
                    "DELETE FROM merge_history WHERE project_key = ?1",
                    params![project_key],
                )
                .map_err(|error| error.to_string())?;
        }
        Ok(deleted)
    }

    pub fn list_all_merge_history(&self) -> Result<Vec<MergeHistoryEntry>, String> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                r#"
                SELECT history_key, project_key, project_name, source_branch, target_branch, success, remote,
                       summary, detail, merged_commit, source_commit_json, target_commit_json, created_at
                FROM merge_history
                ORDER BY created_at DESC
                "#,
            )
            .map_err(|error| error.to_string())?;

        let rows = statement
            .query_map([], |row| {
                let source_commit = parse_commit_json(row.get::<_, Option<String>>(10)?);
                let target_commit = parse_commit_json(row.get::<_, Option<String>>(11)?);
                Ok(MergeHistoryEntry {
                    history_key: row.get(0)?,
                    project_key: row.get(1)?,
                    project_name: row.get(2)?,
                    source_branch: row.get(3)?,
                    target_branch: row.get(4)?,
                    success: row.get::<_, i64>(5)? != 0,
                    remote: row.get::<_, i64>(6)? != 0,
                    summary: row.get(7)?,
                    detail: row.get(8)?,
                    merged_commit: row.get(9)?,
                    source_commit,
                    target_commit,
                    created_at: row.get(12)?,
                })
            })
            .map_err(|error| error.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub fn import_merge_history_entry(&self, entry: MergeHistoryEntry) -> Result<(), String> {
        let connection = self.open()?;
        let source_commit_json = entry
            .source_commit
            .as_ref()
            .map(|value| serde_json::to_string(value).map_err(|error| error.to_string()))
            .transpose()?;
        let target_commit_json = entry
            .target_commit
            .as_ref()
            .map(|value| serde_json::to_string(value).map_err(|error| error.to_string()))
            .transpose()?;

        connection
            .execute(
                r#"
                INSERT INTO merge_history(
                    history_key, project_key, project_name, source_branch, target_branch, success, remote,
                    summary, detail, merged_commit, source_commit_json, target_commit_json, created_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                ON CONFLICT(history_key) DO UPDATE SET
                    project_key = excluded.project_key,
                    project_name = excluded.project_name,
                    source_branch = excluded.source_branch,
                    target_branch = excluded.target_branch,
                    success = excluded.success,
                    remote = excluded.remote,
                    summary = excluded.summary,
                    detail = excluded.detail,
                    merged_commit = excluded.merged_commit,
                    source_commit_json = excluded.source_commit_json,
                    target_commit_json = excluded.target_commit_json,
                    created_at = excluded.created_at
                "#,
                params![
                    entry.history_key,
                    entry.project_key,
                    entry.project_name,
                    entry.source_branch,
                    entry.target_branch,
                    if entry.success { 1 } else { 0 },
                    if entry.remote { 1 } else { 0 },
                    entry.summary,
                    entry.detail,
                    entry.merged_commit,
                    source_commit_json,
                    target_commit_json,
                    entry.created_at
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn list_merge_history_filtered(
        &self,
        project_key: Option<&str>,
        limit: usize,
    ) -> Result<Vec<MergeHistoryEntry>, String> {
        let connection = self.open()?;
        let project_key = project_key
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);
        let limit = normalize_limit(limit, 12);
        let mut statement = connection
            .prepare(
                r#"
                SELECT history_key, project_key, project_name, source_branch, target_branch, success, remote,
                       summary, detail, merged_commit, source_commit_json, target_commit_json, created_at
                FROM merge_history
                WHERE (?1 IS NULL OR project_key = ?1)
                ORDER BY created_at DESC
                LIMIT ?2
                "#,
            )
            .map_err(|error| error.to_string())?;

        let rows = statement
            .query_map(params![project_key, limit], |row| {
                let source_commit = parse_commit_json(row.get::<_, Option<String>>(10)?);
                let target_commit = parse_commit_json(row.get::<_, Option<String>>(11)?);
                Ok(MergeHistoryEntry {
                    history_key: row.get(0)?,
                    project_key: row.get(1)?,
                    project_name: row.get(2)?,
                    source_branch: row.get(3)?,
                    target_branch: row.get(4)?,
                    success: row.get::<_, i64>(5)? != 0,
                    remote: row.get::<_, i64>(6)? != 0,
                    summary: row.get(7)?,
                    detail: row.get(8)?,
                    merged_commit: row.get(9)?,
                    source_commit,
                    target_commit,
                    created_at: row.get(12)?,
                })
            })
            .map_err(|error| error.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }
}

pub fn default_storage_path() -> PathBuf {
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home)
            .join(".rdevtool")
            .join("rdevtool.sqlite");
    }
    PathBuf::from(".rdevtool").join("rdevtool.sqlite")
}

fn normalize_title(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        "未命名笔记".to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::BTreeSet::new();
    let mut normalized = Vec::new();
    for raw in tags {
        let item = raw.trim();
        if item.is_empty() || !seen.insert(item.to_string()) {
            continue;
        }
        normalized.push(item.to_string());
    }
    normalized
}

fn parse_tags(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw)
        .map(normalize_tags)
        .unwrap_or_default()
}

fn parse_commit_json(raw: Option<String>) -> Option<HistoryCommitInfo> {
    raw.and_then(|value| serde_json::from_str::<HistoryCommitInfo>(&value).ok())
}

fn note_summary(content: &str) -> String {
    let first_line = content
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");

    if first_line.is_empty() {
        return "空白笔记".to_string();
    }

    truncate(first_line, 56)
}

fn truncate(value: &str, max_len: usize) -> String {
    let mut result = String::new();
    let mut count = 0usize;
    for ch in value.chars() {
        if count >= max_len {
            result.push('…');
            break;
        }
        result.push(ch);
        count += 1;
    }
    result
}

fn normalize_limit(limit: usize, default_limit: usize) -> usize {
    if limit == 0 {
        default_limit
    } else {
        limit.min(100)
    }
}

fn prune_deploy_history(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            r#"
            DELETE FROM deploy_history
            WHERE history_key NOT IN (
                SELECT history_key
                FROM deploy_history
                ORDER BY updated_at DESC, created_at DESC
                LIMIT ?1
            )
            "#,
            params![DEPLOY_HISTORY_LIMIT as i64],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn now_iso() -> String {
    Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

#[allow(dead_code)]
pub fn db_path(storage: &Storage) -> &Path {
    &storage.db_path
}
