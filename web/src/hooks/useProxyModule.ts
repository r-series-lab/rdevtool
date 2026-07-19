import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ProxyDashboard,
  ProxyProfile,
  ProxyRequestDiagnosis,
  ProxyRequestDiagnosisInput,
  ProxyRule,
} from "../app-types";

export type ProxyDashboardLoadOptions = {
  silent?: boolean;
  sourceId?: string;
};

type UseProxyModuleOptions = {
  enabled: boolean;
  setError: (value: string) => void;
};

function firstProfileId(dashboard: ProxyDashboard | null) {
  return dashboard?.config.profiles[0]?.id ?? "";
}

export function useProxyModule({ enabled: _enabled, setError }: UseProxyModuleOptions) {
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
    (profileId: string, sourceId?: string) =>
      runDashboardTask(
        "正在启动代理服务",
        () => invoke<ProxyDashboard>("start_proxy_profile", { sourceId: sourceId ?? null, profileId }),
        sourceId,
      ),
    [runDashboardTask],
  );

  const stopProxyProfile = useCallback(
    (profileId: string, sourceId?: string) =>
      runDashboardTask(
        "正在停止代理服务",
        () => invoke<ProxyDashboard>("stop_proxy_profile", { sourceId: sourceId ?? null, profileId }),
        sourceId,
      ),
    [runDashboardTask],
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
