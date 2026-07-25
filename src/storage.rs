use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::config::ProjectWorkspaceConfig;
use crate::core::{BranchTaskResponse, BuildStatusResponse};

const DEPLOY_HISTORY_LIMIT: usize = 20;
const MERGE_HISTORY_LIMIT: usize = 20;
const CURRENT_SCHEMA_VERSION: i64 = 2;

const SCHEMA_V1_SQL: &str = r#"
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
"#;

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
    #[serde(default)]
    pub workspace_key: Option<String>,
    #[serde(default)]
    pub project_instance_path: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDeployHistoryRequest {
    pub history_key: String,
    #[serde(default)]
    pub workspace_key: Option<String>,
    #[serde(default)]
    pub project_instance_path: Option<String>,
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
    #[serde(default)]
    pub workspace_key: Option<String>,
    #[serde(default)]
    pub project_instance_path: Option<String>,
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
    #[serde(default)]
    pub workspace_key: Option<String>,
    #[serde(default)]
    pub project_instance_path: Option<String>,
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
        let connection = Connection::open(&self.db_path).map_err(|error| error.to_string())?;
        connection
            .busy_timeout(Duration::from_secs(2))
            .map_err(|error| error.to_string())?;
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|error| error.to_string())?;
        Ok(connection)
    }

    fn init_schema(&self) -> Result<(), String> {
        let mut connection = self.open()?;
        connection
            .execute_batch("PRAGMA journal_mode = WAL;")
            .map_err(|error| error.to_string())?;
        migrate_schema(&mut connection)
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

    pub fn prepend_json_array(
        &self,
        namespace: &str,
        key: &str,
        value: Value,
        limit: usize,
    ) -> Result<Value, String> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let stored = transaction
            .query_row(
                "SELECT value FROM kv_store WHERE namespace = ?1 AND key = ?2",
                params![namespace, key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let mut items = stored
            .and_then(|stored| serde_json::from_str::<Value>(&stored).ok())
            .and_then(|value| value.as_array().cloned())
            .unwrap_or_default();
        if let Some(value_id) = value.get("id").and_then(Value::as_str) {
            items.retain(|item| item.get("id").and_then(Value::as_str) != Some(value_id));
        }
        items.insert(0, value);
        items.truncate(limit.max(1));
        let result = Value::Array(items);
        let payload = serde_json::to_string(&result).map_err(|error| error.to_string())?;
        transaction
            .execute(
                r#"
                INSERT INTO kv_store(namespace, key, value, updated_at)
                VALUES (?1, ?2, ?3, ?4)
                ON CONFLICT(namespace, key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
                "#,
                params![namespace, key, payload, now_iso()],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(result)
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
                    history_key, workspace_key, project_instance_path, project_key, project_name,
                    mode, env, branch, state_key, state_label, detail, queue_url, build_url,
                    params_json, created_at, updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
                ON CONFLICT(history_key) DO UPDATE SET
                    workspace_key = COALESCE(excluded.workspace_key, deploy_history.workspace_key),
                    project_instance_path = COALESCE(
                        excluded.project_instance_path,
                        deploy_history.project_instance_path
                    ),
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
                    request.workspace_key,
                    request.project_instance_path,
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

    pub fn update_deploy_history_status(
        &self,
        status: &BuildStatusResponse,
        requested_queue_url: Option<&str>,
        requested_build_url: Option<&str>,
        requested_project: Option<&str>,
        requested_workspace_key: Option<&str>,
    ) -> Result<Option<SaveDeployHistoryRequest>, String> {
        let has_url_identity = status.queue_url.is_some()
            || status.build_url.is_some()
            || requested_queue_url.is_some()
            || requested_build_url.is_some();
        let entry = self.list_all_deploy_history()?.into_iter().find(|entry| {
            if requested_workspace_key
                .is_some_and(|workspace_key| entry.workspace_key.as_deref() != Some(workspace_key))
            {
                return false;
            }
            let queue_matches = entry.queue_url.as_deref().is_some_and(|entry_url| {
                [status.queue_url.as_deref(), requested_queue_url]
                    .into_iter()
                    .flatten()
                    .any(|candidate| candidate == entry_url)
            });
            let build_matches = entry.build_url.as_deref().is_some_and(|entry_url| {
                [status.build_url.as_deref(), requested_build_url]
                    .into_iter()
                    .flatten()
                    .any(|candidate| candidate == entry_url)
            });
            queue_matches
                || build_matches
                || (!has_url_identity
                    && requested_project.is_some_and(|project| entry.project_key == project))
        });
        let Some(entry) = entry else {
            return Ok(None);
        };
        let request = SaveDeployHistoryRequest {
            history_key: entry.history_key,
            workspace_key: entry.workspace_key,
            project_instance_path: entry.project_instance_path,
            project_key: entry.project_key,
            project_name: entry.project_name,
            mode: entry.mode,
            env: Some(entry.env),
            branch: Some(entry.branch),
            state_key: status.state_key.clone(),
            state_label: status.state_label.clone(),
            detail: status.detail.clone(),
            queue_url: status.queue_url.clone().or(entry.queue_url),
            build_url: status.build_url.clone().or(entry.build_url),
            params: entry.params,
        };
        self.save_deploy_history(request.clone())?;
        Ok(Some(request))
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

    pub fn clear_deploy_history_for_workspace(&self, workspace_key: &str) -> Result<usize, String> {
        let connection = self.open()?;
        connection
            .execute(
                "DELETE FROM deploy_history WHERE workspace_key = ?1",
                params![workspace_key],
            )
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
                SELECT history_key, workspace_key, project_instance_path, project_key, project_name,
                       mode, env, branch, state_key, state_label, detail, queue_url, build_url,
                       params_json, created_at, updated_at
                FROM deploy_history
                ORDER BY updated_at DESC, created_at DESC
                "#,
            )
            .map_err(|error| error.to_string())?;

        let rows = statement
            .query_map([], |row| {
                let params_json = row.get::<_, String>(13)?;
                let params = serde_json::from_str::<Value>(&params_json).unwrap_or(Value::Null);
                Ok(DeployHistoryEntry {
                    history_key: row.get(0)?,
                    workspace_key: row.get(1)?,
                    project_instance_path: row.get(2)?,
                    project_key: row.get(3)?,
                    project_name: row.get(4)?,
                    mode: row.get(5)?,
                    env: row.get(6)?,
                    branch: row.get(7)?,
                    state_key: row.get(8)?,
                    state_label: row.get(9)?,
                    detail: row.get(10)?,
                    queue_url: row.get(11)?,
                    build_url: row.get(12)?,
                    params,
                    created_at: row.get(14)?,
                    updated_at: row.get(15)?,
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
                    history_key, workspace_key, project_instance_path, project_key, project_name,
                    mode, env, branch, state_key, state_label, detail, queue_url, build_url,
                    params_json, created_at, updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
                ON CONFLICT(history_key) DO UPDATE SET
                    workspace_key = excluded.workspace_key,
                    project_instance_path = excluded.project_instance_path,
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
                    entry.workspace_key,
                    entry.project_instance_path,
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
                SELECT history_key, workspace_key, project_instance_path, project_key, project_name,
                       mode, env, branch, state_key, state_label, detail, queue_url, build_url,
                       params_json, created_at, updated_at
                FROM deploy_history
                WHERE (?1 IS NULL OR project_key = ?1)
                ORDER BY updated_at DESC, created_at DESC
                LIMIT ?2
                "#,
            )
            .map_err(|error| error.to_string())?;

        let rows = statement
            .query_map(params![project_key, limit], |row| {
                let params_json = row.get::<_, String>(13)?;
                let params = serde_json::from_str::<Value>(&params_json).unwrap_or(Value::Null);
                Ok(DeployHistoryEntry {
                    history_key: row.get(0)?,
                    workspace_key: row.get(1)?,
                    project_instance_path: row.get(2)?,
                    project_key: row.get(3)?,
                    project_name: row.get(4)?,
                    mode: row.get(5)?,
                    env: row.get(6)?,
                    branch: row.get(7)?,
                    state_key: row.get(8)?,
                    state_label: row.get(9)?,
                    detail: row.get(10)?,
                    queue_url: row.get(11)?,
                    build_url: row.get(12)?,
                    params,
                    created_at: row.get(14)?,
                    updated_at: row.get(15)?,
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
                    history_key, workspace_key, project_instance_path, project_key, project_name,
                    source_branch, target_branch, success, remote, summary, detail, merged_commit,
                    source_commit_json, target_commit_json, created_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
                ON CONFLICT(history_key) DO UPDATE SET
                    workspace_key = COALESCE(excluded.workspace_key, merge_history.workspace_key),
                    project_instance_path = COALESCE(
                        excluded.project_instance_path,
                        merge_history.project_instance_path
                    ),
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
                    request.workspace_key,
                    request.project_instance_path,
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
        prune_merge_history(&connection)?;
        Ok(())
    }

    pub fn save_branch_task_merge_history(
        &self,
        workspace: &ProjectWorkspaceConfig,
        response: &BranchTaskResponse,
        origin: &str,
    ) -> Result<usize, String> {
        self.save_branch_task_merge_history_for_event(
            workspace,
            response,
            origin,
            &Uuid::new_v4().to_string(),
        )
        .map(|keys| keys.len())
    }

    pub fn save_branch_task_merge_history_for_event(
        &self,
        workspace: &ProjectWorkspaceConfig,
        response: &BranchTaskResponse,
        origin: &str,
        event_id: &str,
    ) -> Result<Vec<String>, String> {
        let origin = origin.trim();
        let origin = if origin.is_empty() { "unknown" } else { origin };
        let event_id = event_id.trim();
        let event_id = if event_id.is_empty() {
            Uuid::new_v4().to_string()
        } else {
            event_id.to_string()
        };
        let mut history_keys = Vec::new();

        for (index, item) in response.items.iter().enumerate() {
            let Some(target_branch) = item.target_branch.as_deref() else {
                continue;
            };
            let history_key = format!("branch-sync-{origin}-{event_id}-{index}");
            let target_commit = item.commit.as_ref().map(|commit| HistoryCommitInfo {
                short_hash: commit.short_hash.clone(),
                subject: commit.subject.clone(),
                committed_at: commit.committed_at.clone(),
            });
            self.save_merge_history(SaveMergeHistoryRequest {
                history_key: history_key.clone(),
                workspace_key: Some(workspace.key.clone()),
                project_instance_path: workspace
                    .project_instance_path(&item.project_key)
                    .map(|path| path.display().to_string()),
                project_key: item.project_key.clone(),
                project_name: item.project_name.clone(),
                source_branch: item.source_branch.clone(),
                target_branch: target_branch.to_string(),
                success: item.success,
                remote: item.remote,
                summary: item.summary.clone(),
                detail: item.detail.clone(),
                merged_commit: None,
                source_commit: None,
                target_commit,
            })?;
            history_keys.push(history_key);
        }

        Ok(history_keys)
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

    pub fn clear_merge_history_for_workspace(&self, workspace_key: &str) -> Result<usize, String> {
        let connection = self.open()?;
        connection
            .execute(
                "DELETE FROM merge_history WHERE workspace_key = ?1",
                params![workspace_key],
            )
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
                SELECT history_key, workspace_key, project_instance_path, project_key, project_name,
                       source_branch, target_branch, success, remote, summary, detail, merged_commit,
                       source_commit_json, target_commit_json, created_at
                FROM merge_history
                ORDER BY created_at DESC
                "#,
            )
            .map_err(|error| error.to_string())?;

        let rows = statement
            .query_map([], |row| {
                let source_commit = parse_commit_json(row.get::<_, Option<String>>(12)?);
                let target_commit = parse_commit_json(row.get::<_, Option<String>>(13)?);
                Ok(MergeHistoryEntry {
                    history_key: row.get(0)?,
                    workspace_key: row.get(1)?,
                    project_instance_path: row.get(2)?,
                    project_key: row.get(3)?,
                    project_name: row.get(4)?,
                    source_branch: row.get(5)?,
                    target_branch: row.get(6)?,
                    success: row.get::<_, i64>(7)? != 0,
                    remote: row.get::<_, i64>(8)? != 0,
                    summary: row.get(9)?,
                    detail: row.get(10)?,
                    merged_commit: row.get(11)?,
                    source_commit,
                    target_commit,
                    created_at: row.get(14)?,
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
                    history_key, workspace_key, project_instance_path, project_key, project_name,
                    source_branch, target_branch, success, remote, summary, detail, merged_commit,
                    source_commit_json, target_commit_json, created_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
                ON CONFLICT(history_key) DO UPDATE SET
                    workspace_key = excluded.workspace_key,
                    project_instance_path = excluded.project_instance_path,
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
                    entry.workspace_key,
                    entry.project_instance_path,
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
        prune_merge_history(&connection)?;
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
                SELECT history_key, workspace_key, project_instance_path, project_key, project_name,
                       source_branch, target_branch, success, remote, summary, detail, merged_commit,
                       source_commit_json, target_commit_json, created_at
                FROM merge_history
                WHERE (?1 IS NULL OR project_key = ?1)
                ORDER BY created_at DESC
                LIMIT ?2
                "#,
            )
            .map_err(|error| error.to_string())?;

        let rows = statement
            .query_map(params![project_key, limit], |row| {
                let source_commit = parse_commit_json(row.get::<_, Option<String>>(12)?);
                let target_commit = parse_commit_json(row.get::<_, Option<String>>(13)?);
                Ok(MergeHistoryEntry {
                    history_key: row.get(0)?,
                    workspace_key: row.get(1)?,
                    project_instance_path: row.get(2)?,
                    project_key: row.get(3)?,
                    project_name: row.get(4)?,
                    source_branch: row.get(5)?,
                    target_branch: row.get(6)?,
                    success: row.get::<_, i64>(7)? != 0,
                    remote: row.get::<_, i64>(8)? != 0,
                    summary: row.get(9)?,
                    detail: row.get(10)?,
                    merged_commit: row.get(11)?,
                    source_commit,
                    target_commit,
                    created_at: row.get(14)?,
                })
            })
            .map_err(|error| error.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }
}

fn migrate_schema(connection: &mut Connection) -> Result<(), String> {
    let mut version = connection
        .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
        .map_err(|error| error.to_string())?;
    if version > CURRENT_SCHEMA_VERSION {
        return Err(format!(
            "storage schema version {version} is newer than supported version {CURRENT_SCHEMA_VERSION}"
        ));
    }

    if version < 1 {
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        transaction
            .execute_batch(SCHEMA_V1_SQL)
            .map_err(|error| error.to_string())?;
        transaction
            .execute_batch("PRAGMA user_version = 1;")
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        version = 1;
    }

    if version < 2 {
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        ensure_history_scope_columns(&transaction)?;
        transaction
            .execute_batch(
                r#"
                CREATE INDEX IF NOT EXISTS idx_deploy_history_workspace_updated
                    ON deploy_history(workspace_key, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_merge_history_workspace_created
                    ON merge_history(workspace_key, created_at DESC);
                PRAGMA user_version = 2;
                "#,
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn ensure_history_scope_columns(connection: &Connection) -> Result<(), String> {
    ensure_table_column(connection, "deploy_history", "workspace_key", "TEXT")?;
    ensure_table_column(
        connection,
        "deploy_history",
        "project_instance_path",
        "TEXT",
    )?;
    ensure_table_column(connection, "merge_history", "workspace_key", "TEXT")?;
    ensure_table_column(connection, "merge_history", "project_instance_path", "TEXT")
}

fn ensure_table_column(
    connection: &Connection,
    table: &str,
    column: &str,
    column_type: &str,
) -> Result<(), String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| error.to_string())?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    if columns.iter().any(|current| current == column) {
        return Ok(());
    }
    connection
        .execute_batch(&format!(
            "ALTER TABLE {table} ADD COLUMN {column} {column_type}"
        ))
        .map_err(|error| error.to_string())
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
            WHERE history_key IN (
                SELECT history_key FROM (
                    SELECT
                        history_key,
                        ROW_NUMBER() OVER (
                            PARTITION BY COALESCE(workspace_key, '')
                            ORDER BY updated_at DESC, created_at DESC
                        ) AS scope_row
                    FROM deploy_history
                )
                WHERE scope_row > ?1
            )
            "#,
            params![DEPLOY_HISTORY_LIMIT as i64],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn prune_merge_history(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            r#"
            DELETE FROM merge_history
            WHERE history_key IN (
                SELECT history_key FROM (
                    SELECT
                        history_key,
                        ROW_NUMBER() OVER (
                            PARTITION BY COALESCE(workspace_key, '')
                            ORDER BY created_at DESC
                        ) AS scope_row
                    FROM merge_history
                )
                WHERE scope_row > ?1
            )
            "#,
            params![MERGE_HISTORY_LIMIT as i64],
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::BranchTaskItemResult;

    fn temp_db_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "rdevtool-storage-{label}-{}-{}.sqlite",
            std::process::id(),
            Uuid::new_v4()
        ))
    }

    #[test]
    fn prepends_and_limits_shared_json_history_atomically() {
        let path = temp_db_path("prepend-json-history");
        let storage = Storage::new(path.clone()).expect("create storage");

        storage
            .prepend_json_array(
                "branch-workflow",
                "history",
                serde_json::json!({ "id": "a" }),
                2,
            )
            .expect("prepend first item");
        storage
            .prepend_json_array(
                "branch-workflow",
                "history",
                serde_json::json!({ "id": "b" }),
                2,
            )
            .expect("prepend second item");
        let result = storage
            .prepend_json_array(
                "branch-workflow",
                "history",
                serde_json::json!({ "id": "a", "updated": true }),
                2,
            )
            .expect("replace and prepend first item");

        assert_eq!(
            result,
            serde_json::json!([
                { "id": "a", "updated": true },
                { "id": "b" }
            ])
        );
        assert_eq!(
            storage
                .get_json("branch-workflow", "history")
                .expect("load shared history"),
            Some(result)
        );
        remove_test_db(&path);
    }

    #[test]
    fn saves_batch_merge_items_in_shared_workspace_history() {
        let path = temp_db_path("branch-task-history");
        let storage = Storage::new(path.clone()).expect("create storage");
        let workspace = ProjectWorkspaceConfig {
            key: "feature-a".to_string(),
            name: "Feature A".to_string(),
            projects: vec!["alpha".to_string(), "beta".to_string()],
            ..ProjectWorkspaceConfig::default()
        };
        let response = BranchTaskResponse {
            task_kind: "sync".to_string(),
            success: false,
            summary: "成功 1 / 失败 1".to_string(),
            detail: "batch detail".to_string(),
            items: vec![
                BranchTaskItemResult {
                    project_key: "alpha".to_string(),
                    project_name: "Alpha".to_string(),
                    source_branch: "feature/a".to_string(),
                    target_branch: Some("main".to_string()),
                    output_path: None,
                    checkout_mode: None,
                    fallback_reason: None,
                    success: true,
                    status_key: "merged".to_string(),
                    status_label: "已合并".to_string(),
                    summary: "合并成功".to_string(),
                    detail: "merged".to_string(),
                    remote: true,
                    commit: None,
                },
                BranchTaskItemResult {
                    project_key: "beta".to_string(),
                    project_name: "Beta".to_string(),
                    source_branch: "feature/a".to_string(),
                    target_branch: Some("main".to_string()),
                    output_path: None,
                    checkout_mode: None,
                    fallback_reason: None,
                    success: false,
                    status_key: "source_missing".to_string(),
                    status_label: "失败".to_string(),
                    summary: "源分支不存在".to_string(),
                    detail: "远端不存在源分支 feature/a".to_string(),
                    remote: false,
                    commit: None,
                },
            ],
        };

        let saved = storage
            .save_branch_task_merge_history(&workspace, &response, "test")
            .expect("save batch history");
        let history = storage
            .list_all_merge_history()
            .expect("list batch history");

        assert_eq!(saved, 2);
        assert_eq!(history.len(), 2);
        assert!(
            history
                .iter()
                .all(|item| item.history_key.starts_with("branch-sync-test-"))
        );
        assert!(
            history
                .iter()
                .all(|item| { item.workspace_key.as_deref() == Some("feature-a") })
        );
        assert!(
            history
                .iter()
                .any(|item| { !item.success && item.detail.contains("远端不存在源分支") })
        );
        remove_test_db(&path);
    }

    fn remove_test_db(path: &Path) {
        let _ = fs::remove_file(path);
        let _ = fs::remove_file(format!("{}-wal", path.display()));
        let _ = fs::remove_file(format!("{}-shm", path.display()));
    }

    fn build_request(workspace_key: &str, index: usize) -> SaveDeployHistoryRequest {
        SaveDeployHistoryRequest {
            history_key: format!("{workspace_key}-{index}"),
            workspace_key: Some(workspace_key.to_string()),
            project_instance_path: Some(format!("/worktrees/{workspace_key}")),
            project_key: "demo".to_string(),
            project_name: "Demo".to_string(),
            mode: "default".to_string(),
            env: Some("test".to_string()),
            branch: Some(format!("feature/{workspace_key}")),
            state_key: "success".to_string(),
            state_label: "构建成功".to_string(),
            detail: "ok".to_string(),
            queue_url: None,
            build_url: None,
            params: Value::Object(Default::default()),
        }
    }

    #[test]
    fn migrates_v1_history_scope_columns_and_records_version() {
        let path = temp_db_path("migration");
        let connection = Connection::open(&path).expect("open test database");
        connection
            .execute_batch(SCHEMA_V1_SQL)
            .expect("create legacy tables");
        connection
            .execute_batch("PRAGMA user_version = 1;")
            .expect("record legacy schema version");
        drop(connection);

        let storage = Storage::new(path.clone()).expect("migrate storage");
        let connection = storage.open().expect("open migrated database");

        for table in ["deploy_history", "merge_history"] {
            let mut statement = connection
                .prepare(&format!("PRAGMA table_info({table})"))
                .expect("read table columns");
            let columns = statement
                .query_map([], |row| row.get::<_, String>(1))
                .expect("query table columns")
                .collect::<Result<Vec<_>, _>>()
                .expect("collect table columns");
            assert!(columns.iter().any(|column| column == "workspace_key"));
            assert!(
                columns
                    .iter()
                    .any(|column| column == "project_instance_path")
            );
        }
        let version = connection
            .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
            .expect("read schema version");
        assert_eq!(version, CURRENT_SCHEMA_VERSION);

        drop(connection);
        remove_test_db(&path);
    }

    #[test]
    fn rejects_storage_from_a_newer_schema_version() {
        let path = temp_db_path("future-schema");
        let connection = Connection::open(&path).expect("open test database");
        connection
            .execute_batch("PRAGMA user_version = 999;")
            .expect("record future schema version");
        drop(connection);

        let error = Storage::new(path.clone()).expect_err("reject future schema");
        assert!(error.contains("newer than supported"));
        remove_test_db(&path);
    }

    #[test]
    fn keeps_build_history_limit_per_workspace() {
        let path = temp_db_path("scope-limit");
        let storage = Storage::new(path.clone()).expect("create storage");

        for index in 0..=DEPLOY_HISTORY_LIMIT {
            storage
                .save_deploy_history(build_request("feature", index))
                .expect("save feature history");
            storage
                .save_deploy_history(build_request("release", index))
                .expect("save release history");
        }

        let history = storage
            .list_all_deploy_history()
            .expect("list scoped build history");
        let feature_count = history
            .iter()
            .filter(|entry| entry.workspace_key.as_deref() == Some("feature"))
            .count();
        let release_count = history
            .iter()
            .filter(|entry| entry.workspace_key.as_deref() == Some("release"))
            .count();
        assert_eq!(feature_count, DEPLOY_HISTORY_LIMIT);
        assert_eq!(release_count, DEPLOY_HISTORY_LIMIT);

        remove_test_db(&path);
    }

    #[test]
    fn updates_build_history_by_remote_url_or_local_project() {
        let path = temp_db_path("build-status-update");
        let storage = Storage::new(path.clone()).expect("create storage");
        let mut remote = build_request("feature", 1);
        remote.history_key = "http://jenkins/queue/item/42/".to_string();
        remote.queue_url = Some(remote.history_key.clone());
        let mut local = build_request("feature", 2);
        local.history_key = "activity-local-build".to_string();
        local.project_key = "local-app".to_string();
        local.project_name = "Local App".to_string();
        let mut other_workspace = build_request("release", 3);
        other_workspace.history_key = "other-workspace-local-build".to_string();
        other_workspace.project_key = "local-app".to_string();
        other_workspace.project_name = "Local App".to_string();
        storage
            .save_deploy_history(remote)
            .expect("save remote build history");
        storage
            .save_deploy_history(local)
            .expect("save local build history");
        storage
            .save_deploy_history(other_workspace)
            .expect("save other workspace build history");

        let remote_update = storage
            .update_deploy_history_status(
                &BuildStatusResponse {
                    queue_url: Some("http://jenkins/queue/item/42/".to_string()),
                    build_url: Some("http://jenkins/job/admin/42/".to_string()),
                    state_key: "success".to_string(),
                    state_label: "构建成功".to_string(),
                    detail: "SUCCESS".to_string(),
                },
                Some("http://jenkins/queue/item/42/"),
                None,
                None,
                Some("feature"),
            )
            .expect("update remote build")
            .expect("match remote build");
        assert_eq!(remote_update.state_key, "success");
        assert_eq!(
            remote_update.build_url.as_deref(),
            Some("http://jenkins/job/admin/42/")
        );

        let local_update = storage
            .update_deploy_history_status(
                &BuildStatusResponse {
                    queue_url: None,
                    build_url: None,
                    state_key: "failure".to_string(),
                    state_label: "构建失败".to_string(),
                    detail: "command exited with status 1".to_string(),
                },
                None,
                None,
                Some("local-app"),
                Some("feature"),
            )
            .expect("update local build")
            .expect("match local build");
        assert_eq!(local_update.history_key, "activity-local-build");
        assert_eq!(local_update.state_key, "failure");

        remove_test_db(&path);
    }
}
