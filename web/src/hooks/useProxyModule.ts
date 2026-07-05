import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ProxyDashboard,
  ProxyProfile,
  ProxyRule,
} from "../app-types";

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
    ) => {
      setBusy(message);
      setLocalError("");
      setError("");
      try {
        return applyDashboard(await task());
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

  const loadProxyDashboard = useCallback(async () => {
    setLoading(true);
    setLocalError("");
    try {
      applyDashboard(await invoke<ProxyDashboard>("get_proxy_dashboard"));
    } catch (reason) {
      const text = String(reason);
      setLocalError(text);
      setError(text);
    } finally {
      setLoading(false);
    }
  }, [applyDashboard, setError]);

  const saveProxyProfile = useCallback(
    (profile: ProxyProfile) =>
      runDashboardTask("正在保存代理配置", () =>
        invoke<ProxyDashboard>("save_proxy_profile", { profile }),
      ),
    [runDashboardTask],
  );

  const deleteProxyProfile = useCallback(
    (profileId: string) =>
      runDashboardTask("正在删除代理配置", () =>
        invoke<ProxyDashboard>("delete_proxy_profile", { profileId }),
      ),
    [runDashboardTask],
  );

  const saveProxyRule = useCallback(
    (rule: ProxyRule) =>
      runDashboardTask("正在保存代理规则", () =>
        invoke<ProxyDashboard>("save_proxy_rule", { rule }),
      ),
    [runDashboardTask],
  );

  const deleteProxyRule = useCallback(
    (ruleId: string) =>
      runDashboardTask("正在删除代理规则", () =>
        invoke<ProxyDashboard>("delete_proxy_rule", { ruleId }),
      ),
    [runDashboardTask],
  );

  const startProxyProfile = useCallback(
    (profileId: string) =>
      runDashboardTask("正在启动代理服务", () =>
        invoke<ProxyDashboard>("start_proxy_profile", { profileId }),
      ),
    [runDashboardTask],
  );

  const stopProxyProfile = useCallback(
    (profileId: string) =>
      runDashboardTask("正在停止代理服务", () =>
        invoke<ProxyDashboard>("stop_proxy_profile", { profileId }),
      ),
    [runDashboardTask],
  );

  const clearProxyEvents = useCallback(
    (profileId?: string | null) =>
      runDashboardTask("正在清空代理记录", () =>
        invoke<ProxyDashboard>("clear_proxy_events", { profileId: profileId || null }),
      ),
    [runDashboardTask],
  );

  const exportProxyProfilePack = useCallback(
    (profileId: string, path: string) =>
      runDashboardTask("正在导出代理包", () =>
        invoke<ProxyDashboard>("export_proxy_profile_pack", { profileId, path }),
      ),
    [runDashboardTask],
  );

  const importProxyProfilePack = useCallback(
    (path: string) =>
      runDashboardTask("正在导入代理包", () =>
        invoke<ProxyDashboard>("import_proxy_profile_pack", { path }),
      ),
    [runDashboardTask],
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
  };
}
