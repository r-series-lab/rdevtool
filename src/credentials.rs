use crate::config::{Defaults, JenkinsProfileConfig};
use anyhow::{Context, Result, anyhow, bail};
use std::env;
use std::fs;

pub fn load_jenkins_password(defaults: &Defaults) -> Result<String> {
    if let Some(password) = defaults
        .jenkins_password
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        return Ok(password.to_string());
    }

    if let Ok(password) = env::var(&defaults.jenkins_password_env) {
        if !password.trim().is_empty() {
            return Ok(password);
        }
    }

    let fallback_file = defaults
        .jenkins_password_fallback_file
        .as_ref()
        .with_context(|| {
            format!(
                "missing Jenkins password; set defaults.jenkins_password, env {}, or configure a fallback file",
                defaults.jenkins_password_env
            )
        })?;

    let content = fs::read_to_string(fallback_file).with_context(|| {
        format!(
            "failed to read Jenkins fallback file: {}",
            fallback_file.display()
        )
    })?;

    parse_password_from_project_config(&content, &defaults.jenkins_username).with_context(|| {
        format!(
            "failed to parse Jenkins password for user {} from {}",
            defaults.jenkins_username,
            fallback_file.display()
        )
    })
}

pub fn load_jenkins_profile_password(profile: &JenkinsProfileConfig) -> Result<String> {
    if let Some(password) = profile
        .password
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        return Ok(password.to_string());
    }

    if let Ok(password) = env::var(&profile.password_env) {
        if !password.trim().is_empty() {
            return Ok(password);
        }
    }

    let fallback_file = profile.password_fallback_file.as_ref().with_context(|| {
        format!(
            "missing Jenkins password; set profile password, env {}, or configure a fallback file",
            profile.password_env
        )
    })?;

    let content = fs::read_to_string(fallback_file).with_context(|| {
        format!(
            "failed to read Jenkins fallback file: {}",
            fallback_file.display()
        )
    })?;

    parse_password_from_project_config(&content, &profile.username).with_context(|| {
        format!(
            "failed to parse Jenkins password for user {} from {}",
            profile.username,
            fallback_file.display()
        )
    })
}

fn parse_password_from_project_config(content: &str, username: &str) -> Result<String> {
    for line in content.lines() {
        if let Some(rest) = line.trim().strip_prefix("- **账号：**") {
            let rest = rest.trim().trim_matches('`');
            let (user, password) = rest
                .split_once('/')
                .ok_or_else(|| anyhow!("account line is not in 'user / password' format"))?;
            if user.trim() == username {
                let password = password.trim().trim_matches('`').to_string();
                if password.is_empty() {
                    bail!("parsed empty Jenkins password");
                }
                return Ok(password);
            }
        }
    }

    bail!("no matching Jenkins account line found")
}

pub fn load_gitlab_token(defaults: &Defaults) -> Result<String> {
    if let Some(token) = defaults
        .gitlab_token
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        return Ok(token.to_string());
    }

    if let Ok(token) = env::var(&defaults.gitlab_token_env) {
        if !token.trim().is_empty() {
            return Ok(token);
        }
    }

    bail!(
        "missing GitLab token; set defaults.gitlab_token or env {}",
        defaults.gitlab_token_env
    )
}
