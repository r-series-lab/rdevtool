use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

const UI_PROFILE_MANIFEST: &str = include_str!("../ui_profiles.json");

pub const DEFAULT_RESOURCE_UI_PROFILE: &str = "resource-basic";
pub const DEFAULT_LINK_UI_PROFILE: &str = "link-local-debug";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiProfileManifest {
    pub schema_version: u32,
    pub profiles: Vec<UiProfileDefinition>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiProfileDefinition {
    pub id: String,
    pub scope: String,
    pub kind: String,
    pub label: String,
    pub description: String,
    #[serde(default)]
    pub features: Vec<String>,
}

pub fn ui_profile_manifest() -> Result<UiProfileManifest> {
    serde_json::from_str(UI_PROFILE_MANIFEST)
        .context("failed to parse built-in UI profile manifest")
}

pub fn ui_profile_definition(id: &str) -> Option<UiProfileDefinition> {
    let id = id.trim();
    if id.is_empty() {
        return None;
    }
    ui_profile_manifest()
        .ok()?
        .profiles
        .into_iter()
        .find(|profile| profile.id == id)
}

pub fn ui_profile_exists(id: &str) -> bool {
    ui_profile_definition(id).is_some()
}

pub fn ui_profile_kind(id: &str) -> Option<String> {
    ui_profile_definition(id).map(|profile| profile.kind)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn manifest_profiles_are_unique_and_complete() {
        let manifest = ui_profile_manifest().unwrap();
        assert_eq!(manifest.schema_version, 1);
        let ids = manifest
            .profiles
            .iter()
            .map(|profile| profile.id.as_str())
            .collect::<BTreeSet<_>>();
        assert_eq!(ids.len(), manifest.profiles.len());
        assert!(ids.contains(DEFAULT_RESOURCE_UI_PROFILE));
        assert!(ids.contains(DEFAULT_LINK_UI_PROFILE));
        assert!(ids.contains("link-proxy-only"));
        assert!(ids.contains("link-web-action"));
        assert!(manifest.profiles.iter().all(|profile| {
            !profile.scope.is_empty()
                && !profile.kind.is_empty()
                && !profile.label.is_empty()
                && !profile.description.is_empty()
        }));
    }

    #[test]
    fn link_profile_features_describe_the_dynamic_form() {
        let local = ui_profile_definition(DEFAULT_LINK_UI_PROFILE).unwrap();
        assert_eq!(local.scope, "link");
        assert!(local.features.iter().any(|feature| feature == "project"));
        assert!(local.features.iter().any(|feature| feature == "localFile"));
        assert!(local.features.iter().any(|feature| feature == "proxy"));
        assert!(local.features.iter().any(|feature| feature == "runtime"));

        let proxy = ui_profile_definition("link-proxy-only").unwrap();
        assert_eq!(proxy.features, vec!["proxyAction"]);
        let web_action = ui_profile_definition("link-web-action").unwrap();
        assert_eq!(web_action.features, vec!["webAction"]);
    }
}
