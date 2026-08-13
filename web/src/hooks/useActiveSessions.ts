import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ProjectRuntimeEntry, ProxyDashboard } from "../app-types";
import {
  activeSessionsFrom,
  type ControlledBrowserSessionSnapshot,
  type RunningResourceActionSnapshot,
} from "../lib/activeSessions";
import { configSourceIdForWorkspace } from "../lib/configSources";

type UseActiveSessionsOptions = {
  enabled: boolean;
  workspaceKey: string;
  runtimeEntries: ProjectRuntimeEntry[];
  activeProjectKeys: string[];
  includeAllProjects: boolean;
};

export function useActiveSessions({
  enabled,
  workspaceKey,
  runtimeEntries,
  activeProjectKeys,
  includeAllProjects,
}: UseActiveSessionsOptions) {
  const [proxyDashboard, setProxyDashboard] = useState<ProxyDashboard | null>(null);
  const [browserSessions, setBrowserSessions] = useState<
    ControlledBrowserSessionSnapshot[]
  >([]);
  const [actionSessions, setActionSessions] = useState<RunningResourceActionSnapshot[]>([]);
  const [proxySourceId, setProxySourceId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastRefreshedAtMs, setLastRefreshedAtMs] = useState(0);
  const requestIdRef = useRef(0);
  const hasProxyDashboardRef = useRef(false);

  const refresh = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!enabled) {
      return;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!options.silent || !hasProxyDashboardRef.current) {
      setLoading(true);
    }
    try {
      const fallbackSourceId = configSourceIdForWorkspace(workspaceKey);
      const sourceId = await invoke<string>("get_config_source_preference", {
        workspaceKey: workspaceKey || "system",
        capability: "proxy",
      }).catch(() => fallbackSourceId);
      const [dashboard, browsers, actions] = await Promise.all([
        invoke<ProxyDashboard>("get_proxy_dashboard", {
          sourceId,
          workspaceKey: workspaceKey || "system",
        }),
        invoke<ControlledBrowserSessionSnapshot[]>(
          "list_controlled_browser_sessions",
        ).catch(() => []),
        invoke<RunningResourceActionSnapshot[]>(
          "list_running_resource_actions",
        ).catch(() => []),
      ]);
      if (requestId !== requestIdRef.current) {
        return;
      }
      setProxySourceId(sourceId);
      setProxyDashboard(dashboard);
      setBrowserSessions(browsers);
      setActionSessions(actions);
      hasProxyDashboardRef.current = true;
      setLastRefreshedAtMs(Date.now());
      setError("");
    } catch (reason) {
      if (requestId === requestIdRef.current) {
        setError(String(reason));
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [enabled, workspaceKey]);

  useEffect(() => {
    requestIdRef.current += 1;
    hasProxyDashboardRef.current = false;
    setProxyDashboard(null);
    setBrowserSessions([]);
    setActionSessions([]);
    setProxySourceId("");
    setLastRefreshedAtMs(0);
    setError("");
    if (enabled) {
      void refresh();
    }
  }, [enabled, refresh, workspaceKey]);

  const sessions = useMemo(
    () =>
      activeSessionsFrom(runtimeEntries, proxyDashboard, proxySourceId, {
        activeProjectKeys,
        actionSessions,
        browserSessions,
        includeAllProjects,
        observedAtMs: lastRefreshedAtMs,
        workspaceKey: workspaceKey || "system",
      }),
    [
      activeProjectKeys,
      actionSessions,
      browserSessions,
      includeAllProjects,
      lastRefreshedAtMs,
      proxyDashboard,
      proxySourceId,
      runtimeEntries,
      workspaceKey,
    ],
  );

  return {
    sessions,
    loading,
    error,
    lastRefreshedAtMs,
    refresh,
  };
}

export type ActiveSessionsState = ReturnType<typeof useActiveSessions>;
