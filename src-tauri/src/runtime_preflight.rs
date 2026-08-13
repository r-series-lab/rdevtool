use rdevtool_core::app_message::AppMessage;
use rdevtool_core::proxy::ProxyDashboard;
use rdevtool_core::runtime::{
    ProjectRuntimePreflightFix, ProjectRuntimePreflightResponse,
    refresh_project_runtime_preflight_summary,
};

pub(crate) fn enrich_bound_proxy_preflight(
    response: &mut ProjectRuntimePreflightResponse,
    source_id: &str,
    source_name: &str,
    profile_id: &str,
    dashboard: &ProxyDashboard,
) {
    let Some(check) = response
        .checks
        .iter_mut()
        .find(|check| check.key == "runtimeProxy")
    else {
        return;
    };
    let Some(profile) = dashboard
        .config
        .profiles
        .iter()
        .find(|profile| profile.id == profile_id || profile.name == profile_id)
    else {
        check.status_key = "error".to_string();
        check.status_label = "异常".to_string();
        check.status_message = AppMessage::new("runtime.preflight.check.status.error");
        check.detail = format!("绑定的代理配置不存在: {profile_id}");
        check.detail_message = Some(
            AppMessage::new("runtime.preflight.detail.runtime_proxy.missing_profile")
                .with_param("id", profile_id),
        );
        check.action = Some("打开本地代理，恢复该配置或重新绑定运行环境。".to_string());
        check.action_message = Some(AppMessage::new(
            "runtime.preflight.action.runtime_proxy.restore_or_rebind",
        ));
        check.fix = None;
        refresh_project_runtime_preflight_summary(response);
        return;
    };

    let status = dashboard
        .statuses
        .iter()
        .find(|status| status.profile_id == profile.id);
    let running = status.is_some_and(|status| status.running);
    let managed = status.is_some_and(|status| status.managed);
    let listen_url = status
        .map(|status| status.listen_url.clone())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| profile.listen_url());
    if running && managed {
        check.status_key = "ok".to_string();
        check.status_label = "正常".to_string();
        check.status_message = AppMessage::new("runtime.preflight.check.status.ok");
        check.detail = format!("{} 正在监听 {}", profile.name, listen_url);
        check.detail_message = Some(
            AppMessage::new("runtime.preflight.detail.runtime_proxy.listening")
                .with_param("name", profile.name.clone())
                .with_param("url", listen_url.clone()),
        );
        check.action = None;
        check.action_message = None;
        check.fix = None;
    } else if running {
        let owner = status
            .and_then(|status| status.owner.as_deref())
            .unwrap_or("外部进程");
        check.status_key = "error".to_string();
        check.status_label = "异常".to_string();
        check.status_message = AppMessage::new("runtime.preflight.check.status.error");
        check.detail = format!("{} 的端口由 {} 占用：{}", profile.name, owner, listen_url);
        check.detail_message = Some(
            AppMessage::new("runtime.preflight.detail.runtime_proxy.external")
                .with_param("name", profile.name.clone())
                .with_param("owner", owner)
                .with_param("url", listen_url.clone()),
        );
        check.action = Some("先确认并释放外部监听，或调整代理服务端口。".to_string());
        check.action_message = Some(AppMessage::new(
            "runtime.preflight.action.runtime_proxy.resolve_external",
        ));
        check.fix = None;
    } else {
        check.status_key = "warning".to_string();
        check.status_label = "未启动".to_string();
        check.status_message = AppMessage::new("runtime.preflight.check.status.warning");
        check.detail = format!("{} 尚未监听 {}", profile.name, listen_url);
        check.detail_message = Some(
            AppMessage::new("runtime.preflight.detail.runtime_proxy.stopped")
                .with_param("name", profile.name.clone())
                .with_param("url", listen_url.clone()),
        );
        check.action = Some("可先启动该代理，再重新执行启动预检。".to_string());
        check.action_message = Some(AppMessage::new(
            "runtime.preflight.action.runtime_proxy.start_then_retry",
        ));
        let mut fix = ProjectRuntimePreflightFix::new(
            "startProxy",
            "启动代理",
            format!("启动 {}，成功后重新检查项目运行条件。", profile.name),
        );
        fix.source_id = Some(source_id.to_string());
        fix.source_name = Some(source_name.to_string());
        fix.profile_id = Some(profile.id.clone());
        fix.profile_name = Some(profile.name.clone());
        fix.listen_url = Some(listen_url);
        check.fix = Some(fix);
    }
    refresh_project_runtime_preflight_summary(response);
}

pub(crate) fn mark_bound_proxy_preflight_unavailable(
    response: &mut ProjectRuntimePreflightResponse,
    detail: impl Into<String>,
) {
    let Some(check) = response
        .checks
        .iter_mut()
        .find(|check| check.key == "runtimeProxy")
    else {
        return;
    };
    check.status_key = "error".to_string();
    check.status_label = "异常".to_string();
    check.status_message = AppMessage::new("runtime.preflight.check.status.error");
    check.detail = detail.into();
    check.detail_message = Some(
        AppMessage::new("runtime.preflight.detail.runtime_proxy.unavailable")
            .with_param("detail", check.detail.clone()),
    );
    check.action = Some("检查当前工作区的代理配置源，修复后重新预检。".to_string());
    check.action_message = Some(AppMessage::new(
        "runtime.preflight.action.runtime_proxy.fix_source",
    ));
    check.fix = None;
    refresh_project_runtime_preflight_summary(response);
}

#[cfg(test)]
mod tests {
    use super::*;
    use rdevtool_core::proxy::{ProxyConfig, ProxyProfile, ProxyProfileRuntimeStatus};
    use rdevtool_core::runtime::{ProjectRuntimePreflightCheck, ProjectRuntimePreflightResponse};

    fn response() -> ProjectRuntimePreflightResponse {
        ProjectRuntimePreflightResponse {
            project_key: "demo".to_string(),
            project_name: "Demo".to_string(),
            debug_profile_key: Some("local".to_string()),
            debug_profile_label: Some("Local".to_string()),
            runtime_profile_key: Some("shared".to_string()),
            runtime_profile_label: Some("Shared".to_string()),
            status_key: "ok".to_string(),
            status_label: "可启动".to_string(),
            status_message: AppMessage::new("runtime.preflight.status.ok"),
            summary: "关键链路正常".to_string(),
            summary_message: AppMessage::new("runtime.preflight.summary.ok"),
            target: None,
            checks: vec![ProjectRuntimePreflightCheck {
                key: "runtimeProxy".to_string(),
                title: "本地代理服务".to_string(),
                category: "network".to_string(),
                status_key: "ok".to_string(),
                status_label: "正常".to_string(),
                status_message: AppMessage::new("runtime.preflight.check.status.ok"),
                detail: "已绑定 local-proxy".to_string(),
                title_message: Some(AppMessage::new(
                    "runtime.preflight.check.title.runtime_proxy",
                )),
                detail_message: Some(
                    AppMessage::new("runtime.preflight.detail.runtime_proxy.bound")
                        .with_param("id", "local-proxy"),
                ),
                action: None,
                action_message: None,
                fix: None,
            }],
        }
    }

    fn dashboard(running: bool) -> ProxyDashboard {
        dashboard_with_ownership(running, running)
    }

    fn dashboard_with_ownership(running: bool, managed: bool) -> ProxyDashboard {
        let profile = ProxyProfile {
            id: "local-proxy".to_string(),
            name: "本地联调代理".to_string(),
            listen_port: 8791,
            ..ProxyProfile::default()
        };
        ProxyDashboard {
            config_path: "/tmp/proxy.toml".to_string(),
            config: ProxyConfig {
                profiles: vec![profile],
                rules: Vec::new(),
            },
            statuses: vec![ProxyProfileRuntimeStatus {
                profile_id: "local-proxy".to_string(),
                running,
                managed,
                version_compatible: managed || !running,
                listen_url: "http://127.0.0.1:8791".to_string(),
                pid: (running && managed).then_some(42),
                started_at: (running && managed).then(|| "2026-07-27T10:00:00Z".to_string()),
                owner: running.then(|| {
                    if managed {
                        "rDevTool proxy daemon (PID 42)".to_string()
                    } else {
                        "node (PID 81)".to_string()
                    }
                }),
                detail: if running && managed {
                    "proxy daemon is listening".to_string()
                } else if running {
                    "port is listening but is not owned by rDevTool daemon".to_string()
                } else {
                    "proxy daemon is stopped".to_string()
                },
            }],
            events: Vec::new(),
        }
    }

    #[test]
    fn offers_a_structured_fix_for_a_stopped_bound_proxy() {
        let mut response = response();
        enrich_bound_proxy_preflight(
            &mut response,
            "workspace-proxy",
            "工作区代理",
            "local-proxy",
            &dashboard(false),
        );

        assert_eq!(response.status_key, "warning");
        let check = &response.checks[0];
        assert_eq!(check.status_key, "warning");
        let fix = check.fix.as_ref().expect("proxy fix");
        assert_eq!(fix.kind, "startProxy");
        assert_eq!(fix.source_id.as_deref(), Some("workspace-proxy"));
        assert_eq!(fix.profile_id.as_deref(), Some("local-proxy"));
    }

    #[test]
    fn clears_the_fix_when_the_proxy_is_running() {
        let mut response = response();
        enrich_bound_proxy_preflight(
            &mut response,
            "workspace-proxy",
            "工作区代理",
            "local-proxy",
            &dashboard(true),
        );

        assert_eq!(response.status_key, "ok");
        assert_eq!(response.checks[0].status_key, "ok");
        assert!(response.checks[0].fix.is_none());
    }

    #[test]
    fn blocks_a_bound_proxy_owned_by_an_external_process() {
        let mut response = response();
        enrich_bound_proxy_preflight(
            &mut response,
            "workspace-proxy",
            "工作区代理",
            "local-proxy",
            &dashboard_with_ownership(true, false),
        );

        assert_eq!(response.status_key, "error");
        let check = &response.checks[0];
        assert_eq!(check.status_key, "error");
        assert!(check.detail.contains("node (PID 81)"));
        assert_eq!(
            check
                .detail_message
                .as_ref()
                .map(|message| message.key.as_str()),
            Some("runtime.preflight.detail.runtime_proxy.external")
        );
        assert!(check.fix.is_none());
    }

    #[test]
    fn reports_a_missing_bound_proxy_as_an_error() {
        let mut response = response();
        let mut dashboard = dashboard(false);
        dashboard.config.profiles.clear();
        dashboard.statuses.clear();
        enrich_bound_proxy_preflight(
            &mut response,
            "workspace-proxy",
            "工作区代理",
            "missing",
            &dashboard,
        );

        assert_eq!(response.status_key, "error");
        assert!(response.checks[0].detail.contains("missing"));
        assert!(response.checks[0].fix.is_none());
    }

    #[test]
    fn keeps_proxy_source_failures_inside_the_preflight_result() {
        let mut response = response();
        mark_bound_proxy_preflight_unavailable(&mut response, "工作区代理配置源不可读取");

        assert_eq!(response.status_key, "error");
        assert_eq!(response.checks[0].status_key, "error");
        assert!(response.checks[0].detail.contains("代理配置源不可读取"));
    }
}
