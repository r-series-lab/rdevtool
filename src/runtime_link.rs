use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

use crate::config::{
    AppConfig, ProjectDebugProfileConfig, ProjectNetworkProxyConfig, RuntimeProfileConfig,
};
use crate::proxy::{ProxyConfig, ProxyProfile, validate_proxy_profile};

const DEFAULT_PROXY_BYPASS: &str = "localhost;127.0.0.1;::1";
const DEFAULT_NO_PROXY: &str = "localhost,127.0.0.1,::1";

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BindProxyRuntimeRequest {
    pub proxy_profile: String,
    #[serde(default)]
    pub runtime_profile_key: Option<String>,
    #[serde(default)]
    pub runtime_profile_label: Option<String>,
    #[serde(default)]
    pub project: Option<String>,
    #[serde(default)]
    pub debug_profile: Option<String>,
    #[serde(default)]
    pub create_debug_profile: bool,
    #[serde(default)]
    pub debug_profile_label: Option<String>,
    #[serde(default)]
    pub enable_network_proxy: bool,
    #[serde(default)]
    pub node_hook: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BindProxyRuntimeProfileResult {
    pub key: String,
    pub label: String,
    pub proxy_url: String,
    pub rdev_proxy_profile_id: String,
    pub network_proxy_enabled: bool,
    pub node_hook: bool,
    pub created: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BindProxyProjectDebugProfileResult {
    pub project_key: String,
    pub project_name: String,
    pub debug_profile_key: String,
    pub debug_profile_label: String,
    pub created: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BindProxyRuntimeResult {
    pub proxy_profile: ProxyProfile,
    pub runtime_profile: BindProxyRuntimeProfileResult,
    pub project_debug_profile: Option<BindProxyProjectDebugProfileResult>,
    pub warnings: Vec<String>,
}

pub fn bind_proxy_runtime_profile(
    config: &mut AppConfig,
    proxy_config: &ProxyConfig,
    request: BindProxyRuntimeRequest,
) -> Result<BindProxyRuntimeResult> {
    let proxy_profile = find_proxy_profile(proxy_config, &request.proxy_profile)?;
    validate_proxy_profile(&proxy_profile)?;

    let runtime_profile_key = request
        .runtime_profile_key
        .as_deref()
        .and_then(normalize_config_key)
        .unwrap_or_else(|| unique_runtime_profile_key(config, &proxy_profile));
    let runtime_profile_label = request
        .runtime_profile_label
        .as_deref()
        .and_then(normalize_text)
        .unwrap_or_else(|| format!("{} 运行配置", proxy_profile.name));
    let proxy_url = proxy_profile.listen_url();

    let runtime_profile_index = config
        .defaults
        .runtime_profiles
        .iter()
        .position(|profile| profile.key == runtime_profile_key);
    let runtime_profile_created = runtime_profile_index.is_none();
    if runtime_profile_created {
        config.defaults.runtime_profiles.push(RuntimeProfileConfig {
            key: runtime_profile_key.clone(),
            label: runtime_profile_label.clone(),
            browser: Some("Google Chrome".to_string()),
            browser_profile: None,
            browser_user_data_dir: None,
            web_actions_enabled: false,
            web_actions_port: 9223,
            web_actions_user_data_dir: None,
            browser_args: Vec::new(),
            proxy_url: proxy_url.clone(),
            rdev_proxy_profile_id: Some(proxy_profile.id.clone()),
            proxy_bypass: DEFAULT_PROXY_BYPASS.to_string(),
            host_resolver_rules: Vec::new(),
            network_proxy: ProjectNetworkProxyConfig::default(),
        });
    }

    let runtime_profile = config
        .defaults
        .runtime_profiles
        .iter_mut()
        .find(|profile| profile.key == runtime_profile_key)
        .expect("runtime profile exists after insert");
    runtime_profile.label = runtime_profile_label.clone();
    runtime_profile.rdev_proxy_profile_id = Some(proxy_profile.id.clone());
    runtime_profile.proxy_url = proxy_url.clone();
    if runtime_profile.proxy_bypass.trim().is_empty() {
        runtime_profile.proxy_bypass = DEFAULT_PROXY_BYPASS.to_string();
    }
    runtime_profile.network_proxy = if request.enable_network_proxy {
        ProjectNetworkProxyConfig {
            enabled: true,
            proxy_url: proxy_url.clone(),
            inject_env: true,
            node_hook: request.node_hook,
            no_proxy: DEFAULT_NO_PROXY.to_string(),
        }
    } else {
        ProjectNetworkProxyConfig::default()
    };

    let project_debug_profile = bind_project_debug_profile(
        config,
        request.project.as_deref(),
        request.debug_profile.as_deref(),
        request.create_debug_profile,
        request.debug_profile_label.as_deref(),
        &runtime_profile_key,
    )?;

    let runtime_profile = config
        .defaults
        .runtime_profiles
        .iter()
        .find(|profile| profile.key == runtime_profile_key)
        .expect("runtime profile exists after bind");

    Ok(BindProxyRuntimeResult {
        proxy_profile,
        runtime_profile: BindProxyRuntimeProfileResult {
            key: runtime_profile.key.clone(),
            label: runtime_profile.label.clone(),
            proxy_url: runtime_profile.proxy_url.clone(),
            rdev_proxy_profile_id: runtime_profile
                .rdev_proxy_profile_id
                .clone()
                .unwrap_or_default(),
            network_proxy_enabled: runtime_profile.network_proxy.enabled,
            node_hook: runtime_profile.network_proxy.node_hook,
            created: runtime_profile_created,
        },
        project_debug_profile,
        warnings: Vec::new(),
    })
}

fn find_proxy_profile(config: &ProxyConfig, value: &str) -> Result<ProxyProfile> {
    let value = value.trim();
    if value.is_empty() {
        bail!("proxy profile is required");
    }
    config
        .profiles
        .iter()
        .find(|profile| profile.id == value || profile.name == value)
        .cloned()
        .with_context(|| format!("proxy profile not found: {value}"))
}

fn bind_project_debug_profile(
    config: &mut AppConfig,
    project_key: Option<&str>,
    debug_profile_key: Option<&str>,
    create_debug_profile: bool,
    debug_profile_label: Option<&str>,
    runtime_profile_key: &str,
) -> Result<Option<BindProxyProjectDebugProfileResult>> {
    let Some(project_key) = project_key.and_then(normalize_config_key) else {
        return Ok(None);
    };
    let project = config
        .projects
        .iter_mut()
        .find(|project| project.key == project_key)
        .with_context(|| format!("project not found: {project_key}"))?;

    let requested_debug_key = debug_profile_key.and_then(normalize_config_key);
    let debug_profile_key = match requested_debug_key {
        Some(key) => key,
        None if create_debug_profile => unique_debug_profile_key(&project.debug_profiles),
        None => {
            bail!("debug profile is required unless createDebugProfile is true");
        }
    };

    let debug_profile_index = project
        .debug_profiles
        .iter()
        .position(|profile| profile.key == debug_profile_key);
    let debug_profile_created = debug_profile_index.is_none();
    if debug_profile_created {
        project.debug_profiles.push(ProjectDebugProfileConfig {
            key: debug_profile_key.clone(),
            label: debug_profile_label
                .and_then(normalize_text)
                .unwrap_or_else(|| "代理启动".to_string()),
            runtime_profile: Some(runtime_profile_key.to_string()),
            ..ProjectDebugProfileConfig::default()
        });
    }

    let debug_profile = project
        .debug_profiles
        .iter_mut()
        .find(|profile| profile.key == debug_profile_key)
        .expect("debug profile exists after insert");
    debug_profile.runtime_profile = Some(runtime_profile_key.to_string());
    if let Some(label) = debug_profile_label.and_then(normalize_text) {
        debug_profile.label = label;
    }
    if debug_profile.label.trim().is_empty() {
        debug_profile.label = debug_profile.key.clone();
    }

    Ok(Some(BindProxyProjectDebugProfileResult {
        project_key: project.key.clone(),
        project_name: project.name.clone(),
        debug_profile_key: debug_profile.key.clone(),
        debug_profile_label: debug_profile.label.clone(),
        created: debug_profile_created,
    }))
}

fn unique_runtime_profile_key(config: &AppConfig, profile: &ProxyProfile) -> String {
    let base = format!(
        "proxy-{}",
        slugify_key(&profile.name).unwrap_or_else(|| profile.id.clone())
    );
    unique_key(
        &base,
        config
            .defaults
            .runtime_profiles
            .iter()
            .map(|profile| profile.key.as_str()),
    )
}

fn unique_debug_profile_key(profiles: &[ProjectDebugProfileConfig]) -> String {
    unique_key("proxy", profiles.iter().map(|profile| profile.key.as_str()))
}

fn unique_key<'a>(base: &str, existing: impl Iterator<Item = &'a str>) -> String {
    let existing = existing.collect::<std::collections::BTreeSet<_>>();
    let base = normalize_config_key(base).unwrap_or_else(|| "proxy".to_string());
    if !existing.contains(base.as_str()) {
        return base;
    }
    let mut index = 2;
    loop {
        let candidate = format!("{base}-{index}");
        if !existing.contains(candidate.as_str()) {
            return candidate;
        }
        index += 1;
    }
}

fn normalize_config_key(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() || value.chars().any(char::is_whitespace) {
        return None;
    }
    Some(value.to_string())
}

fn normalize_text(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn slugify_key(value: &str) -> Option<String> {
    let mut output = String::new();
    let mut last_dash = false;
    for ch in value.trim().chars() {
        let next = if ch.is_ascii_alphanumeric() {
            last_dash = false;
            ch.to_ascii_lowercase()
        } else if ch == '-' || ch == '_' {
            if last_dash {
                continue;
            }
            last_dash = true;
            '-'
        } else {
            if last_dash {
                continue;
            }
            last_dash = true;
            '-'
        };
        output.push(next);
    }
    let output = output.trim_matches('-').to_string();
    (!output.is_empty()).then_some(output)
}
