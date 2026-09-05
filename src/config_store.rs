use anyhow::{Context, Result, anyhow};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(not(test))]
const CONFIG_LOCK_TIMEOUT: Duration = Duration::from_secs(2);
#[cfg(test)]
const CONFIG_LOCK_TIMEOUT: Duration = Duration::from_millis(100);
const CONFIG_LOCK_STALE_AFTER: Duration = Duration::from_secs(30);
const CONFIG_LOCK_POLL_INTERVAL: Duration = Duration::from_millis(25);
const INTERNAL_CONFIG_WRITE_TTL: Duration = Duration::from_secs(4);

static RECENT_INTERNAL_CONFIG_WRITES: OnceLock<Mutex<Vec<(PathBuf, Instant)>>> = OnceLock::new();

fn recent_internal_config_writes() -> &'static Mutex<Vec<(PathBuf, Instant)>> {
    RECENT_INTERNAL_CONFIG_WRITES.get_or_init(|| Mutex::new(Vec::new()))
}

pub fn register_internal_config_write(path: &Path) {
    let now = Instant::now();
    if let Ok(mut writes) = recent_internal_config_writes().lock() {
        writes.retain(|(_, recorded_at)| {
            now.duration_since(*recorded_at) <= INTERNAL_CONFIG_WRITE_TTL
        });
        if let Some((_, recorded_at)) = writes.iter_mut().find(|(target, _)| target == path) {
            *recorded_at = now;
        } else {
            writes.push((path.to_path_buf(), now));
        }
    }
}

pub fn is_recent_internal_config_write(path: &Path) -> bool {
    let now = Instant::now();
    recent_internal_config_writes()
        .lock()
        .map(|mut writes| {
            writes.retain(|(_, recorded_at)| {
                now.duration_since(*recorded_at) <= INTERNAL_CONFIG_WRITE_TTL
            });
            writes.iter().any(|(target, _)| target == path)
        })
        .unwrap_or(false)
}

pub fn with_config_file_lock<T>(path: &Path, operation: impl FnOnce() -> Result<T>) -> Result<T> {
    let _guard = ConfigFileLock::acquire(path)?;
    operation()
}

pub fn with_config_file_locks<T>(
    paths: impl IntoIterator<Item = PathBuf>,
    operation: impl FnOnce() -> Result<T>,
) -> Result<T> {
    let mut paths = paths.into_iter().collect::<Vec<_>>();
    paths.sort();
    paths.dedup();

    let mut guards = Vec::with_capacity(paths.len());
    for path in paths {
        guards.push(ConfigFileLock::acquire(&path)?);
    }
    operation()
}

pub fn write_config_text_atomic(path: &Path, content: impl AsRef<[u8]>) -> Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)
        .with_context(|| format!("failed to create config directory: {}", parent.display()))?;

    register_internal_config_write(path);
    let (temporary_path, mut temporary_file) = create_temporary_file(path)?;
    let result = (|| -> Result<()> {
        temporary_file
            .write_all(content.as_ref())
            .with_context(|| format!("failed to write config: {}", temporary_path.display()))?;
        if let Ok(metadata) = fs::metadata(path) {
            temporary_file
                .set_permissions(metadata.permissions())
                .with_context(|| {
                    format!(
                        "failed to preserve config permissions: {}",
                        temporary_path.display()
                    )
                })?;
        }
        temporary_file
            .sync_all()
            .with_context(|| format!("failed to sync config: {}", temporary_path.display()))?;
        drop(temporary_file);

        if path.exists() {
            let backup = backup_path(path);
            fs::copy(path, &backup).with_context(|| {
                format!(
                    "failed to back up config: {} -> {}",
                    path.display(),
                    backup.display()
                )
            })?;
        }

        replace_file(&temporary_path, path)
            .with_context(|| format!("failed to replace config: {}", path.display()))?;
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    result
}

pub fn copy_config_file_atomic(source: &Path, target: &Path) -> Result<u64> {
    let content =
        fs::read(source).with_context(|| format!("failed to read config: {}", source.display()))?;
    let size = content.len() as u64;
    write_config_text_atomic(target, content).with_context(|| {
        format!(
            "failed to copy config: {} -> {}",
            source.display(),
            target.display()
        )
    })?;
    Ok(size)
}

pub fn backup_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("config");
    path.with_file_name(format!("{file_name}.bak"))
}

fn create_temporary_file(path: &Path) -> Result<(PathBuf, File)> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("config");
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();

    for attempt in 0..32_u8 {
        let temporary_path = parent.join(format!(
            ".{file_name}.{}.{}.{}.tmp",
            std::process::id(),
            nonce,
            attempt
        ));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
        {
            Ok(file) => return Ok((temporary_path, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(error).with_context(|| {
                    format!(
                        "failed to create temporary config: {}",
                        temporary_path.display()
                    )
                });
            }
        }
    }

    Err(anyhow!(
        "failed to allocate temporary config file for {}",
        path.display()
    ))
}

struct ConfigFileLock {
    path: PathBuf,
}

impl ConfigFileLock {
    fn acquire(config_path: &Path) -> Result<Self> {
        let lock_path = config_lock_path(config_path);
        let parent = lock_path.parent().unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "failed to create config lock directory: {}",
                parent.display()
            )
        })?;
        let started = Instant::now();
        loop {
            match OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&lock_path)
            {
                Ok(mut file) => {
                    writeln!(file, "{}", std::process::id())?;
                    return Ok(Self { path: lock_path });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    let stale = fs::metadata(&lock_path)
                        .and_then(|metadata| metadata.modified())
                        .ok()
                        .and_then(|modified| modified.elapsed().ok())
                        .is_some_and(|age| age > CONFIG_LOCK_STALE_AFTER);
                    if stale {
                        let _ = fs::remove_file(&lock_path);
                        continue;
                    }
                    if started.elapsed() >= CONFIG_LOCK_TIMEOUT {
                        return Err(anyhow!(
                            "config is busy; try again: {}",
                            config_path.display()
                        ));
                    }
                    thread::sleep(CONFIG_LOCK_POLL_INTERVAL);
                }
                Err(error) => {
                    return Err(error).with_context(|| {
                        format!("failed to lock config: {}", config_path.display())
                    });
                }
            }
        }
    }
}

impl Drop for ConfigFileLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn config_lock_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("config");
    path.with_file_name(format!(".{file_name}.lock"))
}

#[cfg(not(target_os = "windows"))]
fn replace_file(temporary_path: &Path, path: &Path) -> std::io::Result<()> {
    fs::rename(temporary_path, path)
}

#[cfg(target_os = "windows")]
fn replace_file(temporary_path: &Path, path: &Path) -> std::io::Result<()> {
    if path.exists() {
        fs::remove_file(path)?;
    }
    fs::rename(temporary_path, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn test_dir() -> PathBuf {
        std::env::temp_dir().join(format!("rdevtool-config-store-{}", Uuid::new_v4()))
    }

    #[test]
    fn creates_parent_directories_and_config_file() {
        let root = test_dir();
        let path = root.join("nested").join("navigation.toml");
        write_config_text_atomic(&path, "version = 1\n").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "version = 1\n");
        assert!(is_recent_internal_config_write(&path));
        assert!(!backup_path(&path).exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preserves_the_previous_successful_version_as_backup() {
        let root = test_dir();
        let path = root.join("proxy.toml");
        write_config_text_atomic(&path, "version = 1\n").unwrap();
        write_config_text_atomic(&path, "version = 2\n").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "version = 2\n");
        assert_eq!(
            fs::read_to_string(backup_path(&path)).unwrap(),
            "version = 1\n"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn serializes_updates_for_the_same_config_file() {
        let root = test_dir();
        let path = root.join("workspace.toml");
        let nested_path = path.clone();
        with_config_file_lock(&path, || {
            assert!(with_config_file_lock(&nested_path, || Ok(())).is_err());
            Ok(())
        })
        .unwrap();
        with_config_file_lock(&path, || Ok(())).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn copies_config_bytes_with_an_atomic_target_write() {
        let root = test_dir();
        let source = root.join("source.toml");
        let target = root.join("nested").join("target.toml");
        fs::create_dir_all(&root).unwrap();
        fs::write(&source, b"version = 1\n").unwrap();

        assert_eq!(copy_config_file_atomic(&source, &target).unwrap(), 12);
        assert_eq!(fs::read(&target).unwrap(), b"version = 1\n");

        fs::remove_dir_all(root).unwrap();
    }
}
