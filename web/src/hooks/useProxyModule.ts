import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ProxyDashboard,
  ProxyProfile,
  ProxyRequestDiagnosis,
  ProxyRequestDiagnosisInput,
  ProxyRule,
} from "../app-types";
import type { ActivityRecorder, ActivityUpdater } from "../lib/activityCenter";

export type ProxyDashboardLoadOptions = {
  silent?: boolean;
  sourceId?: string;
};

type UseProxyModuleOptions = {
  enabled: boolean;
  setError: (value: string) => void;
  recordActivity?: ActivityRecorder;
  updateActivity?: ActivityUpdater;
};

function firstProfileId(dashboard: ProxyDashboard | null) {
  return dashboard?.config.profiles[0]?.id ?? "";
}

export function useProxyModule({
  enabled: _enabled,
  setError,
  recordActivity,
  updateActivity,
}: UseProxyModuleOptions) {
  const [dashboard, setDashboard] = useState<ProxyDashboard | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [localError, setLocalError] = useState("");
  const dashboardSourceIdRef = useRef("");
  const loadRequestIdRef = useRef(0);

  const selectedProfileExists = useMemo(
    () =>
      Boolean(
        selectedProfileId &&
          dashboard?.config.profiles.some((profile) => profile.id === selectedProfileId),
      ),
    [dashboard?.config.profiles, selectedProfileId],
  );

  useEffect(() => {
    if (!dashboard) {
      return;
    }
    if (!selectedProfileExists) {
      setSelectedProfileId(firstProfileId(dashboard));
    }
  }, [dashboard, selectedProfileExists]);

  const applyDashboard = useCallback((next: ProxyDashboard) => {
    setDashboard(next);
    setSelectedProfileId((current) =>
      current && next.config.profiles.some((profile) => profile.id === current)
        ? current
        : firstProfileId(next),
    );
    return next;
  }, []);

  const runDashboardTask = useCallback(
    async <T extends ProxyDashboard>(
      message: string,
      task: () => Promise<T>,
      sourceId?: string,
    ) => {
      loadRequestIdRef.current += 1;
      setBusy(message);
      setLocalError("");
      setError("");
      try {
        const next = applyDashboard(await task());
        if (sourceId) {
          dashboardSourceIdRef.current = sourceId;
        }
        return next;
      } catch (reason) {
        const text = String(reason);
        setLocalError(text);
        setError(text);
        throw reason;
      } finally {
        setBusy("");
      }
    },
    [applyDashboard, setError],
  );

  const loadProxyDashboard = useCallback(async (options: ProxyDashboardLoadOptions = {}) => {
    const requestedSourceId = options.sourceId ?? "default";
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    if (!options.silent) {
      setLoading(true);
      setLocalError("");
      if (dashboardSourceIdRef.current !== requestedSourceId) {
        setDashboard(null);
        setSelectedProfileId("");
      }
    }
    try {
      const next = await invoke<ProxyDashboard>("get_proxy_dashboard", {
        sourceId: options.sourceId ?? null,
      });
      if (loadRequestIdRef.current !== requestId) {
        return;
      }
      applyDashboard(next);
      dashboardSourceIdRef.current = requestedSourceId;
    } catch (reason) {
      if (loadRequestIdRef.current !== requestId) {
        return;
      }
      if (options.silent) {
        return;
      }
      const text = String(reason);
      setLocalError(text);
      setError(text);
    } finally {
      if (!options.silent && loadRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [applyDashboard, setError]);

  const saveProxyProfile = useCallback(
    (profile: ProxyProfile, sourceId?: string) =>
      runDashboardTask(
        "正在保存代理配置",
        () => invoke<ProxyDashboard>("save_proxy_profile", { sourceId: sourceId ?? null, profile }),
        sourceId,
      ),
    [runDashboardTask],
  );

  const deleteProxyProfile = useCallback(
    (profileId: string, sourceId?: string) =>
      runDashboardTask(
        "正在删除代理配置",
        () => invoke<ProxyDashboard>("delete_proxy_profile", { sourceId: sourceId ?? null, profileId }),
        sourceId,
      ),
    [runDashboardTask],
  );

  const saveProxyRule = useCallback(
    (rule: ProxyRule, sourceId?: string) =>
      runDashboardTask(
        "正在保存代理规则",
        () => invoke<ProxyDashboard>("save_proxy_rule", { sourceId: sourceId ?? null, rule }),
        sourceId,
      ),
    [runDashboardTask],
  );

  const deleteProxyRule = useCallback(
    (ruleId: string, sourceId?: string) =>
      runDashboardTask(
        "正在删除代理规则",
        () => invoke<ProxyDashboard>("delete_proxy_rule", { sourceId: sourceId ?? null, ruleId }),
        sourceId,
      ),
    [runDashboardTask],
  );

  const startProxyProfile = useCallback(
    async (profileId: string, sourceId?: string) => {
      const profileName = dashboard?.config.profiles.find(
        (profile) => profile.id === profileId,
      )?.name || profileId;
      const activityId = recordActivity?.({
        kind: "proxy",
        status: "running",
        title: "启动代理服务",
        summary: profileName,
        executionKey: `proxy:start:${sourceId || "default"}:${profileId}`,
        target: { page: "proxy" },
      }) || "";
      try {
        const next = await runDashboardTask(
          "正在启动代理服务",
          () => invoke<ProxyDashboard>("start_proxy_profile", {
            sourceId: sourceId ?? null,
            profileId,
            activityId: activityId || null,
            operationOrigin: "app",
          }),
          sourceId,
        );
        const profile = next.config.profiles.find((item) => item.id === profileId);
        const status = next.statuses.find((item) => item.profileId === profileId);
        const running = Boolean(status?.running);
        if (activityId) {
          updateActivity?.(activityId, {
            status: running ? "success" : "failed",
            title: running ? "代理服务已启动" : "代理服务启动失败",
            summary: `${profile?.name || profileName} · ${running ? "已启动" : "启动后未监听"}`,
            detail: status?.listenUrl || null,
            diagnostics: running
              ? []
              : [{
                  id: `proxy:start:${profileId}`,
                  type: "proxy.start",
                  label: profile?.name || profileName,
                  status: "failed",
                  summary: "代理启动后未监听预期地址",
                  risks: status?.listenUrl ? [`未监听 ${status.listenUrl}`] : [],
                }],
            action: running
              ? null
              : {
                  kind: "proxyRecover",
                  label: "检查并重新启动",
                  profileId,
                  profileName: profile?.name || profileName,
                  sourceId: sourceId || null,
                  replayAction: "start",
                },
          });
        }
        return next;
      } catch (reason) {
        if (activityId) {
          updateActivity?.(activityId, {
            status: "failed",
            summary: "代理服务启动失败",
            detail: String(reason),
            diagnostics: [{
              id: `proxy:start:${profileId}`,
              type: "proxy.start",
              label: profileName,
              status: "failed",
              summary: "代理服务启动失败",
              risks: [String(reason)],
            }],
            action: {
              kind: "proxyRecover",
              label: "检查并重新启动",
              profileId,
              profileName,
              sourceId: sourceId || null,
              replayAction: "start",
            },
          });
        }
        throw reason;
      }
    },
    [dashboard?.config.profiles, recordActivity, runDashboardTask, updateActivity],
  );

  const stopProxyProfile = useCallback(
    async (profileId: string, sourceId?: string) => {
      const profileName = dashboard?.config.profiles.find(
        (profile) => profile.id === profileId,
      )?.name || profileId;
      const activityId = recordActivity?.({
        kind: "proxy",
        status: "running",
        title: "停止代理服务",
        summary: profileName,
        executionKey: `proxy:stop:${sourceId || "default"}:${profileId}`,
        target: { page: "proxy" },
      }) || "";
      try {
        const next = await runDashboardTask(
          "正在停止代理服务",
          () => invoke<ProxyDashboard>("stop_proxy_profile", {
            sourceId: sourceId ?? null,
            profileId,
            activityId: activityId || null,
            operationOrigin: "app",
          }),
          sourceId,
        );
        const profile = next.config.profiles.find((item) => item.id === profileId);
        const status = next.statuses.find((item) => item.profileId === profileId);
        const running = Boolean(status?.running);
        if (activityId) {
          updateActivity?.(activityId, {
            status: running ? "failed" : "success",
            title: running ? "代理服务停止失败" : "代理服务已停止",
            summary: `${profile?.name || profileName} · ${running ? "停止后仍在监听" : "已停止"}`,
            detail: status?.listenUrl || null,
            diagnostics: running
              ? [{
                  id: `proxy:stop:${profileId}`,
                  type: "proxy.stop",
                  label: profile?.name || profileName,
                  status: "failed",
                  summary: "停止后仍在监听",
                  risks: status?.listenUrl ? [`仍在监听 ${status.listenUrl}`] : [],
                }]
              : [],
            action: running
              ? {
                  kind: "proxyRecover",
                  label: "检查并重新停止",
                  profileId,
                  profileName: profile?.name || profileName,
                  sourceId: sourceId || null,
                  replayAction: "stop",
                }
              : null,
          });
        }
        return next;
      } catch (reason) {
        if (activityId) {
          updateActivity?.(activityId, {
            status: "failed",
            summary: "代理服务停止失败",
            detail: String(reason),
            diagnostics: [{
              id: `proxy:stop:${profileId}`,
              type: "proxy.stop",
              label: profileName,
              status: "failed",
              summary: "代理服务停止失败",
              risks: [String(reason)],
            }],
            action: {
              kind: "proxyRecover",
              label: "检查并重新停止",
              profileId,
              profileName,
              sourceId: sourceId || null,
              replayAction: "stop",
            },
          });
        }
        throw reason;
      }
    },
    [dashboard?.config.profiles, recordActivity, runDashboardTask, updateActivity],
  );

  const clearProxyEvents = useCallback(
    (profileId?: string | null, sourceId?: string) =>
      runDashboardTask(
        "正在清空代理记录",
        () =>
          invoke<ProxyDashboard>("clear_proxy_events", {
            sourceId: sourceId ?? null,
            profileId: profileId || null,
          }),
        sourceId,
      ),
    [runDashboardTask],
  );

  const exportProxyProfilePack = useCallback(
    (profileId: string, path: string, sourceId?: string) =>
      runDashboardTask(
        "正在导出代理包",
        () =>
          invoke<ProxyDashboard>("export_proxy_profile_pack", {
            sourceId: sourceId ?? null,
            profileId,
            path,
          }),
        sourceId,
      ),
    [runDashboardTask],
  );

  const importProxyProfilePack = useCallback(
    (path: string, sourceId?: string) =>
      runDashboardTask(
        "正在导入代理包",
        () =>
          invoke<ProxyDashboard>("import_proxy_profile_pack", {
            sourceId: sourceId ?? null,
            path,
          }),
        sourceId,
      ),
    [runDashboardTask],
  );

  const diagnoseProxyRequest = useCallback(
    async (request: ProxyRequestDiagnosisInput, sourceId?: string) => {
      setBusy("正在诊断代理请求");
      setLocalError("");
      setError("");
      try {
        return await invoke<ProxyRequestDiagnosis>("diagnose_proxy_request", {
          sourceId: sourceId ?? null,
          ...request,
        });
      } catch (reason) {
        const text = String(reason);
        setLocalError(text);
        setError(text);
        throw reason;
      } finally {
        setBusy("");
      }
    },
    [setError],
  );

  return {
    dashboard,
    selectedProfileId,
    setSelectedProfileId,
    loading,
    busy,
    error: localError,
    loadProxyDashboard,
    saveProxyProfile,
    deleteProxyProfile,
    saveProxyRule,
    deleteProxyRule,
    startProxyProfile,
    stopProxyProfile,
    clearProxyEvents,
    exportProxyProfilePack,
    importProxyProfilePack,
    diagnoseProxyRequest,
  };
}
