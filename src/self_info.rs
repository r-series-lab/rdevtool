use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfIdentity {
    pub schema_version: u16,
    pub executable_path: PathBuf,
    pub canonical_executable_path: PathBuf,
    pub install_kind: String,
    pub version: String,
    pub build_commit: Option<String>,
    pub build_dirty: Option<bool>,
    pub build_profile: Option<String>,
    pub build_target: Option<String>,
    pub source_root: PathBuf,
    pub source_available: bool,
    pub current_source_commit: Option<String>,
    pub current_source_dirty: Option<bool>,
    pub source_commit_matches_build: Option<bool>,
    pub recommended_invocation: String,
    pub invocation_recommendation_reason: String,
    pub source_invocation: Option<String>,
}

pub fn collect_self_identity() -> SelfIdentity {
    let executable_path = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("rdevtool"));
    let canonical_executable_path = executable_path
        .canonicalize()
        .unwrap_or_else(|_| executable_path.clone());
    let source_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let source_available = source_root.join("Cargo.toml").is_file();
    let current_source_commit = source_available
        .then(|| git_output(&source_root, &["rev-parse", "HEAD"]))
        .flatten();
    let current_source_dirty = source_available
        .then(|| {
            git_output(
                &source_root,
                &["status", "--porcelain", "--untracked-files=normal"],
            )
            .map(|value| !value.trim().is_empty())
        })
        .flatten();
    let build_commit = option_env!("RDEVTOOL_BUILD_COMMIT").map(str::to_string);
    let source_commit_matches_build = build_commit
        .as_ref()
        .zip(current_source_commit.as_ref())
        .map(|(build, current)| build == current);
    let install_kind = option_env!("RDEVTOOL_INSTALL_KIND")
        .map(str::to_string)
        .unwrap_or_else(|| infer_install_kind(&canonical_executable_path));
    let recommended_invocation = shell_quote(&canonical_executable_path.to_string_lossy());
    let invocation_recommendation_reason = recommendation_reason(&install_kind).to_string();
    let source_invocation = source_available.then(|| {
        format!(
            "cargo run --quiet --manifest-path {} --",
            shell_quote(&source_root.join("Cargo.toml").to_string_lossy())
        )
    });

    SelfIdentity {
        schema_version: 1,
        install_kind,
        executable_path,
        canonical_executable_path,
        version: env!("CARGO_PKG_VERSION").to_string(),
        build_commit,
        build_dirty: option_env!("RDEVTOOL_BUILD_DIRTY").and_then(parse_bool),
        build_profile: option_env!("RDEVTOOL_BUILD_PROFILE").map(str::to_string),
        build_target: option_env!("RDEVTOOL_BUILD_TARGET").map(str::to_string),
        source_root,
        source_available,
        current_source_commit,
        current_source_dirty,
        source_commit_matches_build,
        recommended_invocation,
        invocation_recommendation_reason,
        source_invocation,
    }
}

fn recommendation_reason(install_kind: &str) -> &'static str {
    match install_kind {
        "installed" => "stableInstalledExecutable",
        "bundled" => "bundledExecutable",
        "development" => "explicitDevelopmentExecutable",
        _ => "currentExecutable",
    }
}

fn shell_quote(value: &str) -> String {
    if !value.is_empty()
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "/._-:".contains(character))
    {
        return value.to_string();
    }
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn infer_install_kind(executable: &Path) -> String {
    let value = executable.to_string_lossy();
    if value.contains(".app/Contents/MacOS/") {
        "bundled".to_string()
    } else if value.contains("/target/debug/") || value.contains("/target/release/") {
        "development".to_string()
    } else if value.contains("/bin/") {
        "installed".to_string()
    } else {
        "unknown".to_string()
    }
}

fn parse_bool(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" => Some(true),
        "0" | "false" | "no" => Some(false),
        _ => None,
    }
}

fn git_output(root: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{infer_install_kind, parse_bool, recommendation_reason, shell_quote};

    #[test]
    fn classifies_common_install_locations() {
        assert_eq!(
            infer_install_kind(Path::new("/repo/target/debug/rdevtool")),
            "development"
        );
        assert_eq!(
            infer_install_kind(Path::new(
                "/Applications/rDevTool.app/Contents/MacOS/rdevtool"
            )),
            "bundled"
        );
        assert_eq!(
            infer_install_kind(Path::new("/Users/demo/.local/bin/rdevtool")),
            "installed"
        );
    }

    #[test]
    fn parses_build_dirty_values() {
        assert_eq!(parse_bool("true"), Some(true));
        assert_eq!(parse_bool("0"), Some(false));
        assert_eq!(parse_bool("unknown"), None);
    }

    #[test]
    fn recommends_the_current_executable_by_install_kind() {
        assert_eq!(
            recommendation_reason("installed"),
            "stableInstalledExecutable"
        );
        assert_eq!(recommendation_reason("bundled"), "bundledExecutable");
        assert_eq!(
            recommendation_reason("development"),
            "explicitDevelopmentExecutable"
        );
        assert_eq!(recommendation_reason("unknown"), "currentExecutable");
    }

    #[test]
    fn quotes_invocation_paths_only_when_needed() {
        assert_eq!(
            shell_quote("/Users/demo/.local/bin/rdevtool"),
            "/Users/demo/.local/bin/rdevtool"
        );
        assert_eq!(
            shell_quote("/Users/demo/R Dev/rdevtool"),
            "'/Users/demo/R Dev/rdevtool'"
        );
        assert_eq!(shell_quote("a'b"), "'a'\"'\"'b'");
    }
}
