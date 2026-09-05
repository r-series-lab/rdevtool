use std::collections::BTreeSet;
use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use serde::Serialize;

pub const RDEVTOOL_CLI_PATH_ENV: &str = "RDEVTOOL_CLI_PATH";
const CLI_VERSION_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedRdevtoolCli {
    pub path: PathBuf,
    pub source: String,
    pub version: String,
}

#[derive(Debug, Clone)]
struct CliCandidate {
    path: PathBuf,
    source: &'static str,
    required: bool,
}

pub fn resolve_rdevtool_cli() -> Result<ResolvedRdevtoolCli> {
    let expected_version = env!("CARGO_PKG_VERSION");
    let candidates = cli_candidates()?;
    let mut seen = BTreeSet::new();
    let mut rejected = Vec::new();

    for candidate in candidates {
        let identity = candidate
            .path
            .canonicalize()
            .unwrap_or_else(|_| candidate.path.clone());
        if !seen.insert(identity) {
            continue;
        }
        if !candidate.path.is_file() {
            if candidate.required {
                bail!(
                    "rdevtool CLI configured by {} does not exist: {}",
                    candidate.source,
                    candidate.path.display()
                );
            }
            continue;
        }
        match probe_cli_version(&candidate.path) {
            Ok(version) if version == expected_version => {
                return Ok(ResolvedRdevtoolCli {
                    path: candidate.path,
                    source: candidate.source.to_string(),
                    version,
                });
            }
            Ok(version) => {
                let message = format!(
                    "{} has version {}, expected {} ({})",
                    candidate.path.display(),
                    version,
                    expected_version,
                    candidate.source
                );
                if candidate.required {
                    bail!(message);
                }
                rejected.push(message);
            }
            Err(error) => {
                let message = format!(
                    "{} is not a usable rdevtool CLI: {} ({})",
                    candidate.path.display(),
                    error,
                    candidate.source
                );
                if candidate.required {
                    bail!(message);
                }
                rejected.push(message);
            }
        }
    }

    let detail = if rejected.is_empty() {
        String::new()
    } else {
        format!(" Rejected candidates: {}", rejected.join("; "))
    };
    bail!(
        "unable to locate rdevtool CLI version {expected_version}; rebuild the App sidecar or set {RDEVTOOL_CLI_PATH_ENV}.{detail}"
    )
}

fn cli_candidates() -> Result<Vec<CliCandidate>> {
    let mut candidates = Vec::new();
    if let Some(explicit) = env::var_os(RDEVTOOL_CLI_PATH_ENV) {
        if explicit.is_empty() {
            bail!("{RDEVTOOL_CLI_PATH_ENV} cannot be empty");
        }
        candidates.push(CliCandidate {
            path: PathBuf::from(explicit),
            source: "environment",
            required: true,
        });
    }

    let current_exe = env::current_exe().context("failed to locate the App executable")?;
    if let Some(parent) = current_exe.parent() {
        candidates.push(CliCandidate {
            path: parent.join(cli_binary_name()),
            source: if is_macos_app_executable(&current_exe) {
                "bundled"
            } else {
                "executable-sibling"
            },
            required: is_macos_app_executable(&current_exe),
        });
    }

    if let Some(path) = env::var_os("PATH") {
        candidates.extend(env::split_paths(&path).map(|directory| CliCandidate {
            path: directory.join(cli_binary_name()),
            source: "path",
            required: false,
        }));
    }

    if let Some(home) = env::var_os("HOME").or_else(|| env::var_os("USERPROFILE")) {
        candidates.push(CliCandidate {
            path: PathBuf::from(home)
                .join(".local/bin")
                .join(cli_binary_name()),
            source: "user-install",
            required: false,
        });
    }
    for directory in ["/opt/homebrew/bin", "/usr/local/bin"] {
        candidates.push(CliCandidate {
            path: Path::new(directory).join(cli_binary_name()),
            source: "system-install",
            required: false,
        });
    }

    let source_root = Path::new(env!("CARGO_MANIFEST_DIR"));
    for profile in ["debug", "release"] {
        candidates.push(CliCandidate {
            path: source_root
                .join("target")
                .join(profile)
                .join(cli_binary_name()),
            source: "development",
            required: false,
        });
    }
    Ok(candidates)
}

fn probe_cli_version(path: &Path) -> Result<String> {
    probe_cli_version_with_timeout(path, CLI_VERSION_TIMEOUT)
}

fn probe_cli_version_with_timeout(path: &Path, timeout: Duration) -> Result<String> {
    let mut child = Command::new(path)
        .arg("--version")
        .stdin(Stdio::null())
        .stderr(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .with_context(|| format!("failed to run {} --version", path.display()))?;
    let started = Instant::now();
    loop {
        if child
            .try_wait()
            .with_context(|| format!("failed to inspect {} --version", path.display()))?
            .is_some()
        {
            break;
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            bail!("version command timed out after {}ms", timeout.as_millis());
        }
        thread::sleep(Duration::from_millis(20));
    }
    let output = child
        .wait_with_output()
        .with_context(|| format!("failed to collect {} --version", path.display()))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        bail!(
            "version command failed{}",
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {detail}")
            }
        );
    }
    parse_cli_version(&String::from_utf8_lossy(&output.stdout))
        .ok_or_else(|| anyhow::anyhow!("unexpected version output"))
}

fn parse_cli_version(output: &str) -> Option<String> {
    let mut parts = output.split_whitespace();
    let name = parts.next()?;
    let version = parts.next()?;
    (name == "rdevtool" && !version.is_empty()).then(|| version.to_string())
}

fn cli_binary_name() -> &'static str {
    if cfg!(windows) {
        "rdevtool.exe"
    } else {
        "rdevtool"
    }
}

fn is_macos_app_executable(path: &Path) -> bool {
    path.to_string_lossy().contains(".app/Contents/MacOS/")
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    #[cfg(unix)]
    use uuid::Uuid;

    use super::*;

    #[test]
    fn parses_only_the_expected_cli_version_shape() {
        assert_eq!(
            parse_cli_version("rdevtool 0.1.0\n").as_deref(),
            Some("0.1.0")
        );
        assert_eq!(parse_cli_version("other 0.1.0"), None);
        assert_eq!(parse_cli_version("rdevtool"), None);
    }

    #[test]
    fn recognizes_macos_bundle_executables() {
        assert!(is_macos_app_executable(Path::new(
            "/Applications/rDevTool.app/Contents/MacOS/rdevtool-tauri"
        )));
        assert!(!is_macos_app_executable(Path::new(
            "/workspace/target/debug/rdevtool-tauri"
        )));
    }

    #[cfg(unix)]
    #[test]
    fn bounds_cli_version_probes() {
        let path = env::temp_dir().join(format!("rdevtool-version-probe-{}", Uuid::new_v4()));
        fs::write(&path, "#!/bin/sh\nwhile :; do :; done\n").expect("write fake CLI");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755))
            .expect("make fake CLI executable");

        let started = Instant::now();
        let error = probe_cli_version_with_timeout(&path, Duration::from_millis(80))
            .expect_err("probe should time out");
        let _ = fs::remove_file(path);

        assert!(error.to_string().contains("timed out after 80ms"));
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}
