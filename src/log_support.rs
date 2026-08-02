use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

pub const DEFAULT_RUNTIME_LOG_MAX_BYTES: u64 = 32 * 1024 * 1024;
pub const DEFAULT_RUNTIME_LOG_ARCHIVES: usize = 4;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogRotationResult {
    pub path: PathBuf,
    pub rotated: bool,
    pub size_before_bytes: u64,
    pub max_bytes: u64,
    pub archive_count: usize,
}

pub fn rotate_runtime_log_if_needed(path: &Path) -> Result<LogRotationResult, String> {
    let max_bytes = env_u64(
        "RDEVTOOL_RUNTIME_LOG_MAX_BYTES",
        DEFAULT_RUNTIME_LOG_MAX_BYTES,
    )
    .max(1024 * 1024);
    let archive_count = env_usize(
        "RDEVTOOL_RUNTIME_LOG_ARCHIVES",
        DEFAULT_RUNTIME_LOG_ARCHIVES,
    )
    .clamp(1, 20);
    rotate_log_if_needed(path, max_bytes, archive_count)
}

pub fn rotate_log_if_needed(
    path: &Path,
    max_bytes: u64,
    archive_count: usize,
) -> Result<LogRotationResult, String> {
    let size_before_bytes = match fs::metadata(path) {
        Ok(metadata) => metadata.len(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => 0,
        Err(error) => return Err(format!("failed to inspect log {}: {error}", path.display())),
    };
    let archive_count = archive_count.max(1);
    if size_before_bytes <= max_bytes {
        return Ok(LogRotationResult {
            path: path.to_path_buf(),
            rotated: false,
            size_before_bytes,
            max_bytes,
            archive_count,
        });
    }

    let oldest = archive_path(path, archive_count);
    remove_file_if_exists(&oldest)?;
    for index in (1..archive_count).rev() {
        let source = archive_path(path, index);
        if source.exists() {
            fs::rename(&source, archive_path(path, index + 1)).map_err(|error| {
                format!("failed to rotate log archive {}: {error}", source.display())
            })?;
        }
    }
    fs::rename(path, archive_path(path, 1))
        .map_err(|error| format!("failed to rotate log {}: {error}", path.display()))?;

    Ok(LogRotationResult {
        path: path.to_path_buf(),
        rotated: true,
        size_before_bytes,
        max_bytes,
        archive_count,
    })
}

pub fn archive_path(path: &Path, index: usize) -> PathBuf {
    let mut value = OsString::from(path.as_os_str());
    value.push(format!(".{index}"));
    PathBuf::from(value)
}

fn remove_file_if_exists(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "failed to remove old log archive {}: {error}",
            path.display()
        )),
    }
}

fn env_u64(key: &str, fallback: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(fallback)
}

fn env_usize(key: &str, fallback: usize) -> usize {
    std::env::var(key)
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or(fallback)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use uuid::Uuid;

    use super::{archive_path, rotate_log_if_needed};

    #[test]
    fn rotates_oversized_logs_and_keeps_bounded_archives() {
        let root = std::env::temp_dir().join(format!("rdevtool-log-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp root");
        let path = root.join("runtime.log");
        fs::write(&path, "123456").expect("write active log");
        fs::write(archive_path(&path, 1), "previous").expect("write archive");

        let result = rotate_log_if_needed(&path, 4, 2).expect("rotate log");

        assert!(result.rotated);
        assert!(!path.exists());
        assert_eq!(
            fs::read_to_string(archive_path(&path, 1)).expect("read first archive"),
            "123456"
        );
        assert_eq!(
            fs::read_to_string(archive_path(&path, 2)).expect("read second archive"),
            "previous"
        );
        fs::remove_dir_all(root).expect("cleanup");
    }
}
