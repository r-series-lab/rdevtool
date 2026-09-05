import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ProjectConfigEditorState,
  ProxyDashboard,
  ProxyProfile,
  RuntimeProfileDraft,
} from "../app-types";

type UseRuntimeProfilesOptions = {
  sourceId: string;
  onRefresh?: () => void | Promise<void>;
};

export function useRuntimeProfiles({ sourceId, onRefresh }: UseRuntimeProfilesOptions) {
  const [profiles, setProfiles] = useState<RuntimeProfileDraft[]>([]);
  const [proxyProfiles, setProxyProfiles] = useState<ProxyProfile[]>([]);
  const [profileIndex, setProfileIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [scope, setScope] = useState(sourceId === "default" ? "global" : "inherited");
  const [configPath, setConfigPath] = useState("");
  const loadingRef = useRef(false);
  const requestRef = useRef(0);
  const mutationRef = useRef(0);
  const sourceRef = useRef(sourceId);
  sourceRef.current = sourceId;

  useEffect(() => {
    requestRef.current += 1;
    mutationRef.current += 1;
    loadingRef.current = false;
    setProfiles([]);
    setProxyProfiles([]);
    setProfileIndex(0);
    setLoaded(false);
    setLoading(false);
    setSaving(false);
    setError("");
    setScope(sourceId === "default" ? "global" : "inherited");
    setConfigPath("");
  }, [sourceId]);

  const applyState = useCallback((state: ProjectConfigEditorState) => {
    setProfiles(state.runtimeProfiles ?? []);
    setScope(state.runtimeProfileScope ?? "global");
    setConfigPath(state.runtimeConfigPath ?? state.configPath ?? "");
  }, []);

  const loadProfiles = useCallback(
    async (preferredKey?: string | null) => {
      if (loadingRef.current) return;
      const requestId = ++requestRef.current;
      loadingRef.current = true;
      setLoading(true);
      setError("");
      try {
        const [state, proxyDashboard] = await Promise.all([
          invoke<ProjectConfigEditorState>("get_project_config_editor", { sourceId }),
          invoke<ProxyDashboard>("get_proxy_dashboard", { sourceId }).catch(() => null),
        ]);
        if (requestId !== requestRef.current || sourceRef.current !== sourceId) return;
        const nextProfiles = state.runtimeProfiles ?? [];
        applyState(state);
        setProxyProfiles(proxyDashboard?.config.profiles ?? []);
        const preferredIndex = preferredKey
          ? nextProfiles.findIndex((profile) => profile.key === preferredKey)
          : -1;
        setProfileIndex(preferredIndex >= 0 ? preferredIndex : 0);
      } catch (reason) {
        if (requestId === requestRef.current && sourceRef.current === sourceId) {
          setError(String(reason));
        }
      } finally {
        if (requestId === requestRef.current && sourceRef.current === sourceId) {
          setLoaded(true);
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [applyState, sourceId],
  );

  const persistProfiles = useCallback(
    async (nextProfiles: RuntimeProfileDraft[], selectedKey?: string) => {
      if (scope === "unsupported") {
        setError("当前配置源不支持运行环境模板覆盖。");
        return false;
      }
      setSaving(true);
      setError("");
      const mutationId = ++mutationRef.current;
      try {
        const state = await invoke<ProjectConfigEditorState>("save_runtime_profiles", {
          sourceId,
          request: { runtimeProfiles: nextProfiles },
        });
        if (mutationId !== mutationRef.current || sourceRef.current !== sourceId) return false;
        const savedProfiles = state.runtimeProfiles ?? [];
        const selectedIndex = selectedKey
          ? savedProfiles.findIndex((profile) => profile.key === selectedKey)
          : -1;
        const fallbackIndex = savedProfiles.length
          ? Math.min(profileIndex, savedProfiles.length - 1)
          : 0;
        applyState(state);
        setProfileIndex(selectedIndex >= 0 ? selectedIndex : fallbackIndex);
        await onRefresh?.();
        return true;
      } catch (reason) {
        if (mutationId === mutationRef.current && sourceRef.current === sourceId) {
          setError(String(reason));
        }
        return false;
      } finally {
        if (mutationId === mutationRef.current && sourceRef.current === sourceId) {
          setSaving(false);
        }
      }
    },
    [applyState, onRefresh, profileIndex, scope, sourceId],
  );

  const restoreInheritance = useCallback(async () => {
    if (scope !== "override") return false;
    setSaving(true);
    setError("");
    const mutationId = ++mutationRef.current;
    try {
      const state = await invoke<ProjectConfigEditorState>(
        "restore_runtime_profile_inheritance",
        { sourceId },
      );
      if (mutationId !== mutationRef.current || sourceRef.current !== sourceId) return false;
      applyState(state);
      setProfileIndex(0);
      await onRefresh?.();
      return true;
    } catch (reason) {
      if (mutationId === mutationRef.current && sourceRef.current === sourceId) {
        setError(String(reason));
      }
      return false;
    } finally {
      if (mutationId === mutationRef.current && sourceRef.current === sourceId) {
        setSaving(false);
      }
    }
  }, [applyState, onRefresh, scope, sourceId]);

  return {
    profiles,
    proxyProfiles,
    profileIndex,
    setProfileIndex,
    loaded,
    loading,
    saving,
    error,
    setError,
    scope,
    configPath,
    readOnly: scope === "unsupported",
    loadProfiles,
    persistProfiles,
    restoreInheritance,
  };
}
