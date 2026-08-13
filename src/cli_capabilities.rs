use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use clap::Command;
use rdevtool_core::agent::{AgentCapabilities, AgentCommandCapability};
use rdevtool_core::operation::{OperationRisk, OperationStatus, RecommendedAction};
use rdevtool_core::self_info::{SelfIdentity, collect_self_identity};
use serde::{Deserialize, Serialize};

const COMPATIBILITY_SCHEMA_VERSION: u16 = 1;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillManifest {
    pub schema_version: u16,
    pub skill_version: String,
    pub generated_for_version: String,
    #[serde(default)]
    pub required_features: Vec<String>,
    #[serde(default)]
    pub required_commands: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompatibilityRequested {
    pub skill_manifest: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompatibilityEffective {
    pub skill_manifest: Option<PathBuf>,
    pub manifest_source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompatibilityObserved {
    pub cli: SelfIdentity,
    pub command_count: usize,
    pub feature_count: usize,
    pub skill: Option<SkillManifest>,
    pub missing_commands: Vec<String>,
    pub missing_features: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentCompatibilityReport {
    pub schema_version: u16,
    pub requested: CompatibilityRequested,
    pub effective: CompatibilityEffective,
    pub observed: CompatibilityObserved,
    pub status: OperationStatus,
    pub risks: Vec<OperationRisk>,
    pub recommended_actions: Vec<RecommendedAction>,
}

pub(crate) fn enrich_capabilities(value: &mut AgentCapabilities, root: Command) {
    value.command_specs = command_specs(root);
}

pub(crate) fn retain_context_command_specs(value: &mut AgentCapabilities) {
    let allowed = expand_legacy_command_groups(&value.commands);
    value
        .command_specs
        .retain(|command| allowed.contains(command.path.as_str()));
}

pub(crate) fn compatibility_report(
    root: Command,
    requested_manifest: Option<&Path>,
) -> Result<AgentCompatibilityReport> {
    let mut capabilities = rdevtool_core::agent::capabilities();
    enrich_capabilities(&mut capabilities, root);
    let identity = collect_self_identity();
    let (manifest_path, manifest_source) = resolve_manifest_path(requested_manifest);
    let manifest = manifest_path
        .as_deref()
        .map(read_skill_manifest)
        .transpose()?;
    let available_commands = capabilities
        .command_specs
        .iter()
        .map(|command| command.path.as_str())
        .collect::<BTreeSet<_>>();
    let available_features = capabilities
        .features
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let missing_commands = manifest
        .as_ref()
        .map(|manifest| {
            manifest
                .required_commands
                .iter()
                .filter(|command| !available_commands.contains(command.as_str()))
                .cloned()
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let missing_features = manifest
        .as_ref()
        .map(|manifest| {
            manifest
                .required_features
                .iter()
                .filter(|feature| !available_features.contains(feature.as_str()))
                .cloned()
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let mut risks = Vec::new();
    let mut recommended_actions = Vec::new();

    if manifest.is_none() {
        risks.push(OperationRisk {
            code: "skillManifestMissing".to_string(),
            severity: "warning".to_string(),
            detail: "No rDevTool Skill manifest was found; command compatibility was not verified."
                .to_string(),
        });
        recommended_actions.push(RecommendedAction {
            command: "rdevtool --json agent capabilities".to_string(),
            reason:
                "Inspect the installed CLI capabilities before following Skill command recipes."
                    .to_string(),
            risk: "readOnly".to_string(),
        });
    }
    if !missing_commands.is_empty() {
        risks.push(OperationRisk {
            code: "skillCommandsUnavailable".to_string(),
            severity: "error".to_string(),
            detail: format!(
                "The Skill requires commands unavailable in this CLI: {}",
                missing_commands.join(", ")
            ),
        });
    }
    if !missing_features.is_empty() {
        risks.push(OperationRisk {
            code: "skillFeaturesUnavailable".to_string(),
            severity: "error".to_string(),
            detail: format!(
                "The Skill requires features unavailable in this CLI: {}",
                missing_features.join(", ")
            ),
        });
    }
    if let Some(manifest) = manifest.as_ref()
        && manifest.generated_for_version != identity.version
    {
        risks.push(OperationRisk {
            code: "skillCliVersionMismatch".to_string(),
            severity: "warning".to_string(),
            detail: format!(
                "Skill {} targets CLI {}, current CLI is {}",
                manifest.skill_version, manifest.generated_for_version, identity.version
            ),
        });
    }
    if identity.source_commit_matches_build == Some(false) {
        risks.push(OperationRisk {
            code: "binarySourceMismatch".to_string(),
            severity: "warning".to_string(),
            detail: "The installed CLI and local source checkout are at different commits."
                .to_string(),
        });
    }

    let incompatible = !missing_commands.is_empty() || !missing_features.is_empty();
    if incompatible {
        recommended_actions.push(RecommendedAction {
            command: "rdevtool --json info".to_string(),
            reason: "Inspect the executable identity, then update the CLI and Skill from the same source revision."
                .to_string(),
            risk: "readOnly".to_string(),
        });
    }
    let status = if incompatible {
        OperationStatus {
            key: "incompatible".to_string(),
            label: "不兼容".to_string(),
            success: false,
            terminal: true,
            detail: "当前 CLI 缺少 Skill 所需能力".to_string(),
        }
    } else if manifest.is_none() || !risks.is_empty() {
        OperationStatus {
            key: "warning".to_string(),
            label: "需要关注".to_string(),
            success: false,
            terminal: true,
            detail: "CLI 可以使用，但兼容性尚未完全确认".to_string(),
        }
    } else {
        OperationStatus {
            key: "compatible".to_string(),
            label: "兼容".to_string(),
            success: true,
            terminal: true,
            detail: "CLI 满足 Skill 声明的命令与能力要求".to_string(),
        }
    };

    Ok(AgentCompatibilityReport {
        schema_version: COMPATIBILITY_SCHEMA_VERSION,
        requested: CompatibilityRequested {
            skill_manifest: requested_manifest.map(Path::to_path_buf),
        },
        effective: CompatibilityEffective {
            skill_manifest: manifest_path,
            manifest_source,
        },
        observed: CompatibilityObserved {
            cli: identity,
            command_count: capabilities.command_specs.len(),
            feature_count: capabilities.features.len(),
            skill: manifest,
            missing_commands,
            missing_features,
        },
        status,
        risks,
        recommended_actions,
    })
}

pub(crate) fn command_specs(mut root: Command) -> Vec<AgentCommandCapability> {
    root.build();
    let mut specs = Vec::new();
    collect_leaf_commands(&root, &[], &mut specs);
    specs.sort_by(|left, right| left.path.cmp(&right.path));
    specs
}

fn collect_leaf_commands(
    command: &Command,
    parents: &[String],
    output: &mut Vec<AgentCommandCapability>,
) {
    let children = command
        .get_subcommands()
        .filter(|child| child.get_name() != "help")
        .collect::<Vec<_>>();
    if parents.is_empty() {
        for child in children {
            collect_leaf_commands(child, &[child.get_name().to_string()], output);
        }
        return;
    }
    if children.is_empty() || !command.is_subcommand_required_set() {
        push_command_capability(command, parents, output);
    }
    if children.is_empty() {
        return;
    }
    for child in children {
        let mut path = parents.to_vec();
        path.push(child.get_name().to_string());
        collect_leaf_commands(child, &path, output);
    }
}

fn push_command_capability(
    command: &Command,
    parents: &[String],
    output: &mut Vec<AgentCommandCapability>,
) {
    let path = parents.join(" ");
    let risk = command_risk(&path).to_string();
    output.push(AgentCommandCapability {
        supports_json: !matches!(path.as_str(), "desktop" | "tui"),
        supports_follow: command
            .get_arguments()
            .any(|argument| argument.get_id().as_str() == "follow"),
        requires_confirmation: matches!(risk.as_str(), "remoteWrite" | "destructive" | "varies"),
        deprecated_by: deprecated_replacement(&path).map(str::to_string),
        path,
        risk,
    });
}

fn command_risk(path: &str) -> &'static str {
    if let Some(replacement) = deprecated_replacement(path) {
        return command_risk(replacement);
    }
    if path.split_whitespace().last() == Some("delete") {
        return "destructive";
    }
    if matches!(
        path,
        "action apply" | "action run" | "link run" | "workflow chain run"
    ) {
        return "varies";
    }
    if matches!(
        path,
        "build run"
            | "build trigger"
            | "deploy trigger"
            | "git merge"
            | "git merge-many"
            | "git push"
            | "workflow promote run"
            | "web-actions run"
            | "web-actions script"
    ) {
        return "remoteWrite";
    }
    let leaf = path.split_whitespace().last().unwrap_or(path);
    if matches!(
        leaf,
        "add"
            | "adopt"
            | "apply"
            | "archive"
            | "attach"
            | "clone"
            | "copy"
            | "create"
            | "focus"
            | "import"
            | "init"
            | "init-demand"
            | "migrate"
            | "open"
            | "restart"
            | "restore"
            | "run"
            | "save"
            | "scope"
            | "set-preferences"
            | "start"
            | "stop"
            | "switch"
            | "update"
            | "use"
            | "worklog-append"
    ) {
        "localWrite"
    } else {
        "readOnly"
    }
}

fn deprecated_replacement(path: &str) -> Option<&'static str> {
    match path {
        "list" => Some("projects list"),
        "show" => Some("projects show"),
        "branch" => Some("projects branch"),
        "branches" => Some("projects branches"),
        "envs" => Some("projects envs"),
        "options" => Some("projects options"),
        "plan" => Some("build plan"),
        "trigger" => Some("build run"),
        "status" => Some("build status"),
        "deploy targets" => Some("build targets"),
        "deploy plan" => Some("build plan"),
        "deploy trigger" => Some("build run"),
        "deploy status" => Some("build status"),
        "deploy history" => Some("build history"),
        "merge-overview" => Some("git overview"),
        "merge" => Some("git merge"),
        "sync-branches" => Some("git merge-many"),
        "create-branch" => Some("git create"),
        "checkout-branch" => Some("git clone"),
        "switch-branch" => Some("git switch"),
        "push-status" => Some("git push-status"),
        "push-branch" => Some("git push"),
        _ => None,
    }
}

fn expand_legacy_command_groups(groups: &[String]) -> BTreeSet<String> {
    groups
        .iter()
        .flat_map(|group| {
            let mut parts = group.split_whitespace().collect::<Vec<_>>();
            let alternatives = parts.pop().unwrap_or_default();
            alternatives
                .split('|')
                .map(move |alternative| {
                    let mut path = parts.clone();
                    path.push(alternative);
                    path.join(" ")
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

fn resolve_manifest_path(requested: Option<&Path>) -> (Option<PathBuf>, String) {
    if let Some(path) = requested {
        return (Some(path.to_path_buf()), "argument".to_string());
    }
    if let Some(path) = std::env::var_os("RDEVTOOL_SKILL_MANIFEST").map(PathBuf::from) {
        return (path.is_file().then_some(path), "environment".to_string());
    }
    let mut candidates = Vec::new();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        candidates.push(home.join(".codex/skills/rdevtool/manifest.json"));
        candidates.push(home.join(".agents/skills/rdevtool/manifest.json"));
    }
    candidates
        .push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("skills/rdevtool/manifest.json"));
    match candidates.into_iter().find(|path| path.is_file()) {
        Some(path) => (Some(path), "discovered".to_string()),
        None => (None, "missing".to_string()),
    }
}

fn read_skill_manifest(path: &Path) -> Result<SkillManifest> {
    let content = fs::read_to_string(path)
        .with_context(|| format!("read rDevTool Skill manifest: {}", path.display()))?;
    let manifest: SkillManifest = serde_json::from_str(&content)
        .with_context(|| format!("parse rDevTool Skill manifest: {}", path.display()))?;
    if manifest.schema_version != COMPATIBILITY_SCHEMA_VERSION {
        anyhow::bail!(
            "unsupported rDevTool Skill manifest schema {} at {}",
            manifest.schema_version,
            path.display()
        );
    }
    Ok(manifest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::{Arg, Command, CommandFactory};
    use std::fs;
    use uuid::Uuid;

    fn demo_cli() -> Command {
        Command::new("demo")
            .arg(Arg::new("json").long("json").global(true))
            .subcommand(Command::new("info"))
            .subcommand(
                Command::new("build")
                    .subcommand_required(true)
                    .subcommand(Command::new("run").arg(Arg::new("follow").long("follow"))),
            )
            .subcommand(
                Command::new("history")
                    .subcommand_required(true)
                    .subcommand(
                        Command::new("operations")
                            .subcommand(Command::new("show").arg(Arg::new("id"))),
                    ),
            )
            .subcommand(Command::new("delete"))
    }

    #[test]
    fn derives_structured_leaf_commands() {
        let specs = command_specs(demo_cli());
        let run = specs
            .iter()
            .find(|command| command.path == "build run")
            .expect("build run capability");
        assert_eq!(run.risk, "remoteWrite");
        assert!(run.supports_json);
        assert!(run.supports_follow);
        assert!(run.requires_confirmation);
        assert_eq!(
            specs
                .iter()
                .find(|command| command.path == "delete")
                .map(|command| command.risk.as_str()),
            Some("destructive")
        );
        assert_eq!(command_risk("trigger"), "remoteWrite");
        assert_eq!(command_risk("push-branch"), "remoteWrite");
        assert!(
            specs
                .iter()
                .any(|command| command.path == "history operations")
        );
        assert!(
            specs
                .iter()
                .any(|command| command.path == "history operations show")
        );
    }

    #[test]
    fn expands_legacy_grouped_commands() {
        let values = expand_legacy_command_groups(&[
            "workspace list|show".to_string(),
            "workflow chain list|run".to_string(),
        ]);
        assert!(values.contains("workspace list"));
        assert!(values.contains("workspace show"));
        assert!(values.contains("workflow chain run"));
    }

    #[test]
    fn reports_missing_manifest_requirements() {
        let path =
            std::env::temp_dir().join(format!("rdevtool-skill-manifest-{}.json", Uuid::new_v4()));
        fs::write(
            &path,
            serde_json::json!({
                "schemaVersion": 1,
                "skillVersion": "test",
                "generatedForVersion": env!("CARGO_PKG_VERSION"),
                "requiredFeatures": [],
                "requiredCommands": ["missing command"]
            })
            .to_string(),
        )
        .expect("write manifest");

        let report = compatibility_report(demo_cli(), Some(&path)).expect("compatibility report");
        assert_eq!(report.status.key, "incompatible");
        assert_eq!(report.observed.missing_commands, vec!["missing command"]);
        fs::remove_file(path).expect("remove manifest");
    }

    #[test]
    fn repository_skill_manifest_matches_the_real_cli() {
        let manifest =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("skills/rdevtool/manifest.json");
        let report = compatibility_report(crate::Cli::command(), Some(&manifest))
            .expect("repository Skill compatibility report");

        assert!(report.status.success, "{}", report.status.detail);
        assert!(report.observed.missing_commands.is_empty());
        assert!(report.observed.missing_features.is_empty());
    }
}
