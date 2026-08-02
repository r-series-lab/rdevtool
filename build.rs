use std::env;
use std::path::Path;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-env-changed=RDEVTOOL_BUILD_COMMIT");
    println!("cargo:rerun-if-env-changed=RDEVTOOL_BUILD_DIRTY");
    println!("cargo:rerun-if-env-changed=RDEVTOOL_INSTALL_KIND");
    println!("cargo:rerun-if-changed=.git/HEAD");
    println!("cargo:rerun-if-changed=.git/index");

    let manifest_dir = env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let root = Path::new(&manifest_dir);
    let commit = env::var("RDEVTOOL_BUILD_COMMIT")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| git_output(root, &["rev-parse", "HEAD"]));
    let dirty = env::var("RDEVTOOL_BUILD_DIRTY")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            git_output(root, &["status", "--porcelain", "--untracked-files=normal"])
                .map(|value| (!value.trim().is_empty()).to_string())
        });

    if let Some(commit) = commit {
        println!("cargo:rustc-env=RDEVTOOL_BUILD_COMMIT={commit}");
    }
    if let Some(dirty) = dirty {
        println!("cargo:rustc-env=RDEVTOOL_BUILD_DIRTY={dirty}");
    }
    if let Ok(value) = env::var("PROFILE") {
        println!("cargo:rustc-env=RDEVTOOL_BUILD_PROFILE={value}");
    }
    if let Ok(value) = env::var("TARGET") {
        println!("cargo:rustc-env=RDEVTOOL_BUILD_TARGET={value}");
    }
    if let Ok(value) = env::var("RDEVTOOL_INSTALL_KIND") {
        println!("cargo:rustc-env=RDEVTOOL_INSTALL_KIND={value}");
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
