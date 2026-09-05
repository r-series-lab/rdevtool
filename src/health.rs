use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::app_message::AppMessage;
use crate::config::default_config_dir;
use crate::log_support::DEFAULT_RUNTIME_LOG_MAX_BYTES;
use crate::self_info::{SelfIdentity, collect_self_identity};
use crate::storage::default_storage_path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthSnapshot {
    pub schema_version: u16,
    pub generated_at_ms: u64,
    pub status_key: String,
    pub status_label: String,
    pub status_message: AppMessage,
    pub summary: String,
    pub summary_message: AppMessage,
    pub identity: SelfIdentity,
    pub storage_total_bytes: u64,
    pub storage: Vec<HealthStorageEntry>,
    pub risks: Vec<HealthRisk>,
    pub recommended_actions: Vec<HealthRecommendedAction>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthStorageEntry {
    pub key: String,
    pub label: String,
    pub label_message: AppMessage,
    pub path: PathBuf,
    pub exists: bool,
    pub object_type: String,
    pub size_bytes: u64,
    pub file_count: u64,
    pub largest_file_path: Option<PathBuf>,
    pub largest_file_bytes: u64,
    pub status_key: String,
    pub detail: String,
    pub detail_message: AppMessage,
    pub inspect_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthRisk {
    pub code: String,
    pub severity: String,
    pub summary: String,
    pub summary_message: AppMessage,
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail_message: Option<AppMessage>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthRecommendedAction {
    pub command: String,
    pub reason: String,
    pub reason_message: AppMessage,
    pub risk: String,
}

#[derive(Debug, Default)]
struct PathUsage {
    exists: bool,
    object_type: String,
    size_bytes: u64,
    file_count: u64,
    largest_file_path: Option<PathBuf>,
    largest_file_bytes: u64,
    inspect_error: Option<String>,
}

pub fn collect_health_snapshot() -> HealthSnapshot {
    collect_health_snapshot_in(&default_config_dir(), collect_self_identity())
}

fn collect_health_snapshot_in(config_dir: &Path, identity: SelfIdentity) -> HealthSnapshot {
    let storage_db = if config_dir == default_config_dir() {
        default_storage_path()
    } else {
        config_dir.join("rdevtool.sqlite3")
    };
    let definitions = [
        ("runtimeLogs", "运行日志", config_dir.join("runtime-logs")),
        (
            "proxyRuntime",
            "代理运行记录",
            config_dir.join("proxy-runtime"),
        ),
        (
            "browserProfile",
            "受控浏览器档案",
            config_dir.join("chrome-cdp-profile"),
        ),
        ("notes", "知识笔记", config_dir.join("notes")),
        ("storage", "应用数据库", storage_db),
    ];
    let mut risks = Vec::new();
    let mut storage = Vec::new();

    for (key, label, path) in definitions {
        let usage = inspect_path_usage(&path);
        let mut status_key = if usage.inspect_error.is_some() {
            "warning"
        } else {
            "ok"
        };
        if key == "runtimeLogs" && usage.largest_file_bytes > DEFAULT_RUNTIME_LOG_MAX_BYTES {
            status_key = "warning";
            risks.push(HealthRisk {
                code: "runtimeLogOversized".to_string(),
                severity: "warning".to_string(),
                summary: "存在超过轮转阈值的运行日志".to_string(),
                summary_message: AppMessage::new("health.risk.runtime_log_oversized.summary"),
                detail: format!(
                    "{}（{} 字节）将在对应项目下次启动或重启时轮转",
                    usage
                        .largest_file_path
                        .as_deref()
                        .unwrap_or(&path)
                        .display(),
                    usage.largest_file_bytes
                ),
                detail_message: Some(
                    AppMessage::new("health.risk.runtime_log_oversized.detail")
                        .with_param(
                            "path",
                            usage
                                .largest_file_path
                                .as_deref()
                                .unwrap_or(&path)
                                .display()
                                .to_string(),
                        )
                        .with_param("bytes", usage.largest_file_bytes),
                ),
            });
        }
        if let Some(error) = usage.inspect_error.as_ref() {
            risks.push(HealthRisk {
                code: format!("{key}InspectFailed"),
                severity: "warning".to_string(),
                summary: format!("无法完整统计{label}"),
                summary_message: AppMessage::new(format!(
                    "health.risk.storage_inspect_failed.{key}.summary"
                )),
                detail: error.clone(),
                detail_message: None,
            });
        }
        storage.push(HealthStorageEntry {
            key: key.to_string(),
            label: label.to_string(),
            label_message: AppMessage::new(format!("health.storage.{key}.label")),
            path,
            exists: usage.exists,
            object_type: usage.object_type,
            size_bytes: usage.size_bytes,
            file_count: usage.file_count,
            largest_file_path: usage.largest_file_path,
            largest_file_bytes: usage.largest_file_bytes,
            status_key: status_key.to_string(),
            detail: format!("{} 个文件，共 {} 字节", usage.file_count, usage.size_bytes),
            detail_message: AppMessage::new("health.storage.detail")
                .with_param("count", usage.file_count)
                .with_param("bytes", usage.size_bytes),
            inspect_error: usage.inspect_error,
        });
    }

    if matches!(identity.install_kind.as_str(), "installed" | "bundled")
        && identity.source_commit_matches_build == Some(false)
    {
        risks.push(HealthRisk {
            code: "binarySourceMismatch".to_string(),
            severity: "warning".to_string(),
            summary: "当前可执行文件与本地源码版本不一致".to_string(),
            summary_message: AppMessage::new("health.risk.binary_source_mismatch.summary"),
            detail: format!(
                "build={} source={}",
                identity.build_commit.as_deref().unwrap_or("unknown"),
                identity
                    .current_source_commit
                    .as_deref()
                    .unwrap_or("unknown")
            ),
            detail_message: None,
        });
    }

    let warning_count = risks
        .iter()
        .filter(|risk| risk.severity == "warning")
        .count();
    let status_key = if warning_count > 0 { "warning" } else { "ok" };
    let status_label = if warning_count > 0 {
        "需要关注"
    } else {
        "正常"
    };
    let storage_total_bytes = storage.iter().map(|entry| entry.size_bytes).sum();
    let mut recommended_actions = Vec::new();
    if risks.iter().any(|risk| risk.code == "runtimeLogOversized") {
        recommended_actions.push(HealthRecommendedAction {
            command: "rdevtool --json artifacts cleanup-plan --kind runtimeLog".to_string(),
            reason: "先查看日志归属与活动状态，再决定是否清理；活跃日志不会被直接删除".to_string(),
            reason_message: AppMessage::new("health.action.review_runtime_logs.reason"),
            risk: "readOnly".to_string(),
        });
    }
    if risks.iter().any(|risk| risk.code == "binarySourceMismatch") {
        recommended_actions.push(HealthRecommendedAction {
            command: "rdevtool --json agent compatibility".to_string(),
            reason: "核对当前 CLI 与 rDevTool Skill 的命令和能力契约，再决定是否更新".to_string(),
            reason_message: AppMessage::new("health.action.check_agent_compatibility.reason"),
            risk: "readOnly".to_string(),
        });
    }

    HealthSnapshot {
        schema_version: 1,
        generated_at_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        status_key: status_key.to_string(),
        status_label: status_label.to_string(),
        status_message: AppMessage::new(if warning_count > 0 {
            "health.status.warning"
        } else {
            "health.status.ok"
        }),
        summary: if warning_count == 0 {
            "rDevTool 核心存储与当前可执行文件状态正常".to_string()
        } else {
            format!("发现 {warning_count} 个需要关注的问题")
        },
        summary_message: if warning_count == 0 {
            AppMessage::new("health.snapshot.ok")
        } else {
            AppMessage::new("health.snapshot.warning").with_param("count", warning_count)
        },
        identity,
        storage_total_bytes,
        storage,
        risks,
        recommended_actions,
    }
}

fn inspect_path_usage(path: &Path) -> PathUsage {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return PathUsage {
                object_type: "missing".to_string(),
                ..PathUsage::default()
            };
        }
        Err(error) => {
            return PathUsage {
                object_type: "unknown".to_string(),
                inspect_error: Some(format!("{}: {error}", path.display())),
                ..PathUsage::default()
            };
        }
    };
    if metadata.file_type().is_symlink() {
        return PathUsage {
            exists: true,
            object_type: "symlink".to_string(),
            inspect_error: Some(format!("拒绝跟随符号链接 {}", path.display())),
            ..PathUsage::default()
        };
    }
    if metadata.is_file() {
        return PathUsage {
            exists: true,
            object_type: "file".to_string(),
            size_bytes: metadata.len(),
            file_count: 1,
            largest_file_path: Some(path.to_path_buf()),
            largest_file_bytes: metadata.len(),
            inspect_error: None,
        };
    }
    if !metadata.is_dir() {
        return PathUsage {
            exists: true,
            object_type: "other".to_string(),
            ..PathUsage::default()
        };
    }

    let mut usage = PathUsage {
        exists: true,
        object_type: "directory".to_string(),
        ..PathUsage::default()
    };
    inspect_directory(path, &mut usage);
    usage
}

fn inspect_directory(path: &Path, usage: &mut PathUsage) {
    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(error) => {
            record_inspect_error(usage, format!("{}: {error}", path.display()));
            return;
        }
    };
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                record_inspect_error(usage, error.to_string());
                continue;
            }
        };
        let child_path = entry.path();
        let metadata = match fs::symlink_metadata(&child_path) {
            Ok(metadata) => metadata,
            Err(error) => {
                record_inspect_error(usage, format!("{}: {error}", child_path.display()));
                continue;
            }
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            inspect_directory(&child_path, usage);
            continue;
        }
        if metadata.is_file() {
            let size = metadata.len();
            usage.size_bytes = usage.size_bytes.saturating_add(size);
            usage.file_count = usage.file_count.saturating_add(1);
            if size > usage.largest_file_bytes {
                usage.largest_file_bytes = size;
                usage.largest_file_path = Some(child_path);
            }
        }
    }
}

fn record_inspect_error(usage: &mut PathUsage, detail: String) {
    match usage.inspect_error.as_mut() {
        Some(current) => {
            current.push_str("; ");
            current.push_str(&detail);
        }
        None => usage.inspect_error = Some(detail),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use uuid::Uuid;

    use super::{collect_health_snapshot_in, inspect_path_usage};
    use crate::self_info::SelfIdentity;

    fn test_identity(root: &Path) -> SelfIdentity {
        SelfIdentity {
            schema_version: 1,
            executable_path: root.join("rdevtool"),
            canonical_executable_path: root.join("rdevtool"),
            install_kind: "development".to_string(),
            version: "test".to_string(),
            build_commit: None,
            build_dirty: Some(true),
            build_profile: Some("debug".to_string()),
            build_target: None,
            source_root: root.to_path_buf(),
            source_available: true,
            current_source_commit: None,
            current_source_dirty: Some(true),
            source_commit_matches_build: None,
            recommended_invocation: root.join("rdevtool").display().to_string(),
            invocation_recommendation_reason: "explicitDevelopmentExecutable".to_string(),
            source_invocation: Some(format!(
                "cargo run --quiet --manifest-path {}/Cargo.toml --",
                root.display()
            )),
        }
    }

    #[test]
    fn calculates_directory_usage_without_following_missing_paths() {
        let root = std::env::temp_dir().join(format!("rdevtool-health-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("nested")).expect("create temp root");
        fs::write(root.join("one.log"), "1234").expect("write first");
        fs::write(root.join("nested/two.log"), "123456").expect("write second");

        let usage = inspect_path_usage(&root);
        assert_eq!(usage.file_count, 2);
        assert_eq!(usage.size_bytes, 10);
        assert_eq!(usage.largest_file_bytes, 6);
        assert!(!inspect_path_usage(&root.join("missing")).exists);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn reports_oversized_runtime_logs_as_a_warning() {
        let root = std::env::temp_dir().join(format!("rdevtool-health-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("runtime-logs")).expect("create runtime log root");
        let log = fs::File::create(root.join("runtime-logs/demo.log")).expect("create log");
        log.set_len(crate::log_support::DEFAULT_RUNTIME_LOG_MAX_BYTES + 1)
            .expect("grow log");

        let snapshot = collect_health_snapshot_in(&root, test_identity(&root));
        assert_eq!(snapshot.status_key, "warning");
        assert!(
            snapshot
                .risks
                .iter()
                .any(|risk| risk.code == "runtimeLogOversized")
        );
        assert_eq!(snapshot.summary_message.key, "health.snapshot.warning");
        let risk = snapshot
            .risks
            .iter()
            .find(|risk| risk.code == "runtimeLogOversized")
            .expect("runtime log risk");
        assert_eq!(
            risk.summary_message.key,
            "health.risk.runtime_log_oversized.summary"
        );
        assert_eq!(
            risk.detail_message
                .as_ref()
                .map(|message| message.key.as_str()),
            Some("health.risk.runtime_log_oversized.detail")
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn recommends_agent_compatibility_for_binary_source_mismatch() {
        let root = std::env::temp_dir().join(format!("rdevtool-health-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp root");
        let mut identity = test_identity(&root);
        identity.install_kind = "installed".to_string();
        identity.build_commit = Some("build-commit".to_string());
        identity.current_source_commit = Some("source-commit".to_string());
        identity.source_commit_matches_build = Some(false);

        let snapshot = collect_health_snapshot_in(&root, identity);
        assert!(snapshot.recommended_actions.iter().any(|action| {
            action.command == "rdevtool --json agent compatibility"
                && action.reason_message.key == "health.action.check_agent_compatibility.reason"
        }));
        fs::remove_dir_all(root).expect("cleanup");
    }
}
